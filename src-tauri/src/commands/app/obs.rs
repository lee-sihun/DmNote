use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};

use crate::{errors::CmdResult, models::obs::ObsStatus, state::AppState};

/// OBS 빌드 정적 파일 루트 경로 탐색 (dist/renderer/)
/// obs/index.html이 ../assets/ 를 참조하므로, obs/ 상위인 renderer/ 루트를 반환
pub fn resolve_obs_static_dir(app: &AppHandle) -> Option<PathBuf> {
    // 1. Tauri resource_dir (프로덕션 번들)
    if let Ok(res) = app.path().resource_dir() {
        if res.join("obs/index.html").exists() {
            return Some(res);
        }
    }

    // 2. 실행 파일 기준 탐색 (dev mode: src-tauri/target/debug/)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let renderer_root = exe_dir.join("../../../dist/renderer");
            if renderer_root.join("obs/index.html").exists() {
                return renderer_root.canonicalize().ok();
            }
        }
    }

    None
}

#[tauri::command]
pub async fn obs_start(
    app: AppHandle,
    state: State<'_, AppState>,
    port: Option<u16>,
) -> CmdResult<ObsStatus> {
    let port = port.unwrap_or(state.store.with_state(|s| s.obs_port));

    // OBS 정적 파일 경로 설정
    // dev 모드에서는 Vite dev server 우선 사용 (stale 빌드 디렉토리 회피)
    if cfg!(debug_assertions) {
        let dev_url = "http://localhost:3400".to_string();
        log::info!("[ObsBridge] dev 모드: Vite dev server로 리다이렉트 ({dev_url})");
        state.obs_bridge.set_dev_url(dev_url);
    } else if let Some(dir) = resolve_obs_static_dir(&app) {
        log::info!("[ObsBridge] static_dir: {}", dir.display());
        state.obs_bridge.set_static_dir(dir);
    } else {
        log::warn!("[ObsBridge] OBS 정적 파일 디렉토리를 찾을 수 없음 (HTTP 서빙 비활성)");
    }

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
