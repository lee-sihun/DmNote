use tauri::{AppHandle, Emitter, State};

use crate::{app_state::AppState, models::GraphPositions};

#[tauri::command(permission = "dmnote-allow-all")]
pub fn graph_positions_get(state: State<'_, AppState>) -> Result<GraphPositions, String> {
    Ok(state.store.snapshot().graph_positions)
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn graph_positions_update(
    state: State<'_, AppState>,
    app: AppHandle,
    positions: GraphPositions,
) -> Result<GraphPositions, String> {
    let updated = state
        .store
        .update_graph_positions(positions)
        .map_err(|err| err.to_string())?;
    app.emit("graphPositions:changed", &updated)
        .map_err(|err| err.to_string())?;
    Ok(updated)
}
