use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::{errors::CmdResult, models::obs::ObsStatus, state::AppState};

/// 저장된 토큰 재사용 또는 신규 생성 후 store에 저장
fn resolve_and_save_token(state: &AppState) -> String {
    let existing = state.store.with_state(|s| s.obs_token.clone());
    if let Some(token) = existing {
        if !token.is_empty() {
            return token;
        }
    }
    // 신규 생성 후 저장
    let token = Uuid::new_v4().simple().to_string();
    let t = token.clone();
    let _ = state.store.update(|s| {
        s.obs_token = Some(t.clone());
    });
    token
}

#[tauri::command]
pub async fn obs_start(
    app: AppHandle,
    state: State<'_, AppState>,
    port: Option<u16>,
) -> CmdResult<ObsStatus> {
    let port = port.unwrap_or(state.store.with_state(|s| s.obs_port));
    let token = resolve_and_save_token(&state);

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

    state
        .obs_bridge
        .start(port, token)
        .await
        .map_err(crate::errors::CommandError::msg)?;
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
    // store에 저장
    let t = token.clone();
    let _ = state.store.update(|s| {
        s.obs_token = Some(t.clone());
    });
    // 실행 중이면 bridge 메모리 토큰도 교체
    if state.obs_bridge.is_running() {
        state.obs_bridge.set_token(token);
    }
    let status = state.obs_bridge.status();
    let _ = app.emit("obs:status", &status);
    Ok(status)
}
