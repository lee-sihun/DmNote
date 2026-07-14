use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::{errors::CmdResult, models::obs::ObsStatus, state::AppState};

#[tauri::command]
pub async fn obs_start(app: AppHandle, state: State<'_, AppState>) -> CmdResult<ObsStatus> {
    let port = state.store.with_state(|s| s.obs_port);
    // 저장 불가면 시작 중단 — 서버가 쓰는 토큰은 반드시 디스크에 존재해야 함
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
    // Tauri 이벤트 → OBS WS 포워딩 리스너 등록
    state.obs_bridge.register_event_forwarding(&app);

    let actual_port = state
        .obs_bridge
        .start(port, token)
        .await
        .map_err(crate::errors::CommandError::msg)?;
    // 성공한 포트를 store에 저장 (fallback 시 다음 시작에 재사용)
    // 실패해도 서버는 이미 동작 중 — 다음 시작에 fallback을 다시 거치므로 경고만 남김
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
}

#[tauri::command]
pub async fn obs_stop(app: AppHandle, state: State<'_, AppState>) -> CmdResult<ObsStatus> {
    state.obs_bridge.stop();
    // 오버레이 재생성 + 복원 (async context에서 실행해야 WebView2 초기화가 정상 완료됨)
    state.obs_restore_overlay(&app);
    let status = state.obs_bridge.status();
    let _ = app.emit("obs:status", &status);
    Ok(status)
}

#[tauri::command]
pub fn obs_status(state: State<'_, AppState>) -> CmdResult<ObsStatus> {
    Ok(state.obs_bridge.status())
}

#[tauri::command]
pub fn obs_regenerate_token(app: AppHandle, state: State<'_, AppState>) -> CmdResult<ObsStatus> {
    let token = Uuid::new_v4().simple().to_string();
    // 디스크 저장이 성공한 뒤에만 메모리 토큰 교체 — 실패 시 구 토큰이 그대로 유효한 일관 상태 유지
    let t = token.clone();
    state.store.update(|s| {
        s.obs_token = Some(t.clone());
    })?;
    // 실행 중이면 bridge 메모리 토큰도 교체
    if state.obs_bridge.is_running() {
        state.obs_bridge.set_token(token);
    }
    let status = state.obs_bridge.status();
    let _ = app.emit("obs:status", &status);
    Ok(status)
}
