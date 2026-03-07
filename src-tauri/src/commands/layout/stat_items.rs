use tauri::{AppHandle, Emitter, State};

use crate::{errors::CmdResult, models::StatPositions, state::AppState};

#[tauri::command]
pub fn stat_positions_get(state: State<'_, AppState>) -> CmdResult<StatPositions> {
    Ok(state.store.snapshot().stat_positions)
}

#[tauri::command]
pub fn stat_positions_update(
    state: State<'_, AppState>,
    app: AppHandle,
    positions: StatPositions,
) -> CmdResult<StatPositions> {
    let updated = state.store.update_stat_positions(positions)?;
    app.emit("statPositions:changed", &updated)?;
    state.refresh_obs_snapshot();
    Ok(updated)
}
