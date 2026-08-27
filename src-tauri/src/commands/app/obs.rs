use std::{future::Future, sync::Arc};

use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::{commands::run_mutation, errors::CmdResult, models::obs::ObsStatus, state::AppState};

async fn run_obs_lifecycle<T, Operation, OperationFuture>(
    state: &AppState,
    operation: Operation,
) -> T
where
    Operation: FnOnce() -> OperationFuture,
    OperationFuture: Future<Output = T>,
{
    let _lifecycle_guard = state.obs_lifecycle_lock.lock().await;
    operation().await
}

async fn start_bridge_with_token(state: &AppState, port: u16, token: String) -> CmdResult<u16> {
    state
        .obs_bridge
        .start(port, token)
        .await
        .map_err(crate::errors::CommandError::msg)
}

fn persist_and_apply_obs_token(state: &AppState, token: String) -> CmdResult<ObsStatus> {
    // 디스크 저장 성공 뒤 메모리 토큰 교체, 실패 시 기존 인증 상태 유지
    let stored_token = token.clone();
    state.store.update(|s| {
        s.obs_token = Some(stored_token.clone());
    })?;
    if state.obs_bridge.is_running() {
        state.obs_bridge.set_token(token);
    }
    Ok(state.obs_bridge.status())
}

#[tauri::command]
pub async fn obs_start(app: AppHandle, state: State<'_, AppState>) -> CmdResult<ObsStatus> {
    run_obs_lifecycle(&state, || async {
        let port = state.store.with_state(|s| s.obs_port);
        // 저장 불가 시 시작 중단, 서버 토큰의 디스크 존재 보장
        let token = state.resolve_and_save_obs_token()?;

        // OBS 정적 파일 서빙 설정
        if cfg!(debug_assertions) {
            // dev 모드: Vite dev server로 리다이렉트
            let dev_url = "http://localhost:3400".to_string();
            log::info!("[ObsBridge] dev 모드: Vite dev server로 리다이렉트 ({dev_url})");
            state.obs_bridge.set_dev_url(dev_url);
        } else {
            // 프로덕션: Tauri 임베딩 에셋으로 서빙 (포터블 단일 exe 지원)
            let handle = app.clone();
            let fetcher = Arc::new(move |path: &str| {
                let resolver = handle.asset_resolver();
                resolver.get(path.into()).map(|asset| {
                    let mime = asset.mime_type.clone();
                    (asset.bytes.to_vec(), mime)
                })
            });
            state.obs_bridge.set_asset_fetcher(fetcher);
            log::info!("[ObsBridge] Tauri 임베딩 에셋으로 HTTP 서빙");
        }

        // AppHandle 전달 (invoke_request 디스패치용)
        state.obs_bridge.set_app_handle(app.clone());
        let actual_port = start_bridge_with_token(&state, port, token).await?;
        // 성공한 포트를 store에 저장 (fallback 시 다음 시작에 재사용)
        // 저장 실패 시 실행 서버 유지, 다음 시작에서 fallback 재시도
        if actual_port != port {
            if let Err(error) = state.store.update(|s| {
                s.obs_port = actual_port;
            }) {
                log::warn!("[ObsBridge] fallback 포트 저장 실패: {error}");
            }
        }
        // 초기 스냅샷 캐싱 (신규 클라이언트에 전송됨)
        state.refresh_obs_snapshot();
        // 오버레이 destroy (이전 상태 보존)
        state.obs_hide_overlay(&app);
        let status = state.obs_bridge.status();
        let _ = app.emit("obs:status", &status);
        Ok(status)
    })
    .await
}

#[tauri::command]
pub async fn obs_stop(app: AppHandle, state: State<'_, AppState>) -> CmdResult<ObsStatus> {
    run_obs_lifecycle(&state, || async {
        state.obs_bridge.stop();
        // 오버레이 재생성 + 복원 (async context에서 실행해야 WebView2 초기화가 정상 완료됨)
        state.obs_restore_overlay(&app);
        let status = state.obs_bridge.status();
        let _ = app.emit("obs:status", &status);
        Ok(status)
    })
    .await
}

#[tauri::command]
pub fn obs_status(state: State<'_, AppState>) -> CmdResult<ObsStatus> {
    Ok(state.obs_bridge.status())
}

#[tauri::command]
pub async fn obs_regenerate_token(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<ObsStatus> {
    run_obs_lifecycle(&state, || async move {
        // 잠금 순서 고정: OBS lifecycle mutex -> run_mutation mutation ticket
        // mutation ticket은 run_mutation의 blocking 작업 안에서만 보유
        let token = Uuid::new_v4().simple().to_string();
        run_mutation(app, move |app, state| {
            let status = persist_and_apply_obs_token(state, token)?;
            let _ = app.emit("obs:status", &status);
            Ok(status)
        })
        .await
    })
    .await
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use futures_util::{SinkExt, StreamExt};
    use tokio::sync::oneshot;
    use tokio_tungstenite::{connect_async, tungstenite::Message};

    use super::*;
    use crate::{
        models::obs::{make_envelope, ObsEnvelope, OBS_PROTOCOL_VERSION},
        state::AppStore,
    };

    fn test_directory(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("dmnote-{label}-{}", Uuid::new_v4()))
    }

    async fn authenticate(port: u16, token: &str) -> ObsEnvelope {
        let (mut websocket, _) = connect_async(format!("ws://127.0.0.1:{port}"))
            .await
            .expect("OBS WebSocket 연결 실패");
        let hello = make_envelope(
            "hello",
            0,
            serde_json::json!({ "token": token, "protocol": OBS_PROTOCOL_VERSION }),
        );
        websocket
            .send(Message::Text(hello.to_string()))
            .await
            .expect("OBS hello 전송 실패");

        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                match websocket.next().await {
                    Some(Ok(Message::Text(text))) => {
                        return serde_json::from_str(&text).expect("OBS 응답 파싱 실패");
                    }
                    Some(Ok(_)) => {}
                    Some(Err(error)) => panic!("OBS 응답 수신 실패: {error}"),
                    None => panic!("OBS 응답 전 연결 종료"),
                }
            }
        })
        .await
        .expect("OBS 인증 응답 타임아웃")
    }

    #[tokio::test]
    async fn lifecycle_lock_serializes_start_token_capture_and_regeneration() {
        let directory = test_directory("obs-token-lifecycle-race");
        let store = AppStore::initialize_for_test(&directory).unwrap();
        store
            .update(|data| {
                data.obs_token = Some("old-token".to_string());
            })
            .unwrap();
        let state = Arc::new(AppState::initialize(store).unwrap());

        let (captured_tx, captured_rx) = oneshot::channel();
        let (release_start_tx, release_start_rx) = oneshot::channel();
        let start_state = Arc::clone(&state);
        let start_task = tokio::spawn(async move {
            run_obs_lifecycle(&start_state, || async {
                let captured_token = start_state.resolve_and_save_obs_token().unwrap();
                captured_tx.send(captured_token.clone()).unwrap();
                release_start_rx.await.unwrap();
                let port = start_bridge_with_token(&start_state, 0, captured_token.clone())
                    .await
                    .unwrap();
                (port, captured_token)
            })
            .await
        });

        assert_eq!(captured_rx.await.unwrap(), "old-token");

        let (regenerate_attempted_tx, regenerate_attempted_rx) = oneshot::channel();
        let (regenerated_tx, mut regenerated_rx) = oneshot::channel();
        let regenerate_state = Arc::clone(&state);
        let regenerate_task = tokio::spawn(async move {
            regenerate_attempted_tx.send(()).unwrap();
            let status = run_obs_lifecycle(&regenerate_state, || async {
                persist_and_apply_obs_token(&regenerate_state, "new-token".to_string()).unwrap()
            })
            .await;
            regenerated_tx.send(status).unwrap();
        });

        regenerate_attempted_rx.await.unwrap();
        assert_eq!(
            state.store.with_state(|data| data.obs_token.clone()),
            Some("old-token".to_string())
        );
        assert!(matches!(
            regenerated_rx.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ));

        release_start_tx.send(()).unwrap();
        let (port, captured_token) = start_task.await.unwrap();
        let regenerated_status = regenerated_rx.await.unwrap();
        regenerate_task.await.unwrap();

        let stored_token = state.store.with_state(|data| data.obs_token.clone());
        let final_status = state.obs_bridge.status();
        assert_eq!(captured_token, "old-token");
        assert_eq!(stored_token.as_deref(), Some("new-token"));
        assert_eq!(regenerated_status.token.as_deref(), Some("new-token"));
        assert_eq!(final_status.token, stored_token);

        let rejected = authenticate(port, "old-token").await;
        assert_eq!(rejected.msg_type, "error");
        assert_eq!(rejected.payload["code"], "AUTH_FAILED");
        let accepted = authenticate(port, "new-token").await;
        assert_eq!(accepted.msg_type, "hello_ack");

        state.obs_bridge.stop();
        state.store.flush_and_shutdown().unwrap();
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
