use tauri::{AppHandle, Emitter, State};

use crate::{models::StatPositions, state::AppState};

#[tauri::command]
pub fn stat_positions_get(state: State<'_, AppState>) -> Result<StatPositions, String> {
    Ok(state.store.snapshot().stat_positions)
}

#[tauri::command]
pub fn stat_positions_update(
    state: State<'_, AppState>,
    app: AppHandle,
    positions: StatPositions,
) -> Result<StatPositions, String> {
    let updated = state
        .store
        .update_stat_positions(positions)
        .map_err(|err| err.to_string())?;
    app.emit("statPositions:changed", &updated)
        .map_err(|err| err.to_string())?;
    Ok(updated)
}
