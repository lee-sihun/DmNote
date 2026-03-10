use tauri::{AppHandle, Emitter, State};

use crate::{errors::CmdResult, models::GraphPositions, state::AppState};

#[tauri::command]
pub fn graph_positions_get(state: State<'_, AppState>) -> CmdResult<GraphPositions> {
    Ok(state.store.snapshot().graph_positions)
}

#[tauri::command]
pub fn graph_positions_update(
    state: State<'_, AppState>,
    app: AppHandle,
    positions: GraphPositions,
) -> CmdResult<GraphPositions> {
    let updated = state.store.update_graph_positions(positions)?;
    app.emit("graphPositions:changed", &updated)?;
    state.refresh_obs_snapshot();
    Ok(updated)
}
