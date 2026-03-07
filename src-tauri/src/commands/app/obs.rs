use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};

use crate::{errors::CmdResult, models::obs::ObsStatus, state::AppState};

/// OBS 빌드 정적 파일 경로 탐색
pub fn resolve_obs_static_dir(app: &AppHandle) -> Option<PathBuf> {
    // 1. Tauri resource_dir/obs/ (프로덕션 번들)
    if let Ok(res) = app.path().resource_dir() {
        let obs = res.join("obs");
        if obs.join("index.html").exists() {
            return Some(obs);
        }
    }

    // 2. 실행 파일 기준 탐색 (dev mode: src-tauri/target/debug/)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let dev = exe_dir.join("../../../dist/renderer/obs");
            if dev.join("index.html").exists() {
                return dev.canonicalize().ok();
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
    if let Some(dir) = resolve_obs_static_dir(&app) {
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
    Ok(state.obs_bridge.status())
}

#[tauri::command]
pub fn obs_stop(state: State<'_, AppState>) -> CmdResult<ObsStatus> {
    state.obs_bridge.stop();
    Ok(state.obs_bridge.status())
}

#[tauri::command]
pub fn obs_status(state: State<'_, AppState>) -> CmdResult<ObsStatus> {
    Ok(state.obs_bridge.status())
}
