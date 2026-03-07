use tauri::State;

use crate::{
    errors::CmdResult,
    models::obs::ObsStatus,
    state::AppState,
};

#[tauri::command]
pub async fn obs_start(state: State<'_, AppState>, port: Option<u16>) -> CmdResult<ObsStatus> {
    let port = port.unwrap_or(state.store.with_state(|s| s.obs_port));
    state.obs_bridge.start(port).await.map_err(|e| {
        crate::errors::CommandError::msg(e)
    })?;
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
