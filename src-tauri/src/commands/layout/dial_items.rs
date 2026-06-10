use tauri::{AppHandle, Emitter, State};

use crate::{errors::CmdResult, models::DialPositions, state::AppState};

#[tauri::command]
pub fn dial_positions_get(state: State<'_, AppState>) -> CmdResult<DialPositions> {
    Ok(state.store.snapshot().dial_positions)
}

#[tauri::command]
pub fn dial_positions_update(
    state: State<'_, AppState>,
    app: AppHandle,
    positions: DialPositions,
) -> CmdResult<DialPositions> {
    let updated = state.store.update_dial_positions(positions)?;
    app.emit("dialPositions:changed", &updated)?;
    state.refresh_obs_snapshot();
    Ok(updated)
}
