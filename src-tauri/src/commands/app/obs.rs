use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::{errors::CmdResult, models::obs::ObsStatus, state::AppState};

#[tauri::command]
pub async fn obs_start(
    app: AppHandle,
    state: State<'_, AppState>,
    port: Option<u16>,
) -> CmdResult<ObsStatus> {
    let port = port.unwrap_or(state.store.with_state(|s| s.obs_port));

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
        .start(port)
        .await
        .map_err(crate::errors::CommandError::msg)?;
    // 초기 스냅샷 캐싱 (신규 클라이언트에 전송됨)
    state.refresh_obs_snapshot();
    // 오버레이 숨김 (이전 상태 보존)
    state.obs_hide_overlay(&app);
    Ok(state.obs_bridge.status())
}

#[tauri::command]
pub fn obs_stop(app: AppHandle, state: State<'_, AppState>) -> CmdResult<ObsStatus> {
    state.obs_bridge.stop();
    // 오버레이 복원
    state.obs_restore_overlay(&app);
    Ok(state.obs_bridge.status())
}

#[tauri::command]
pub fn obs_status(state: State<'_, AppState>) -> CmdResult<ObsStatus> {
    Ok(state.obs_bridge.status())
}
