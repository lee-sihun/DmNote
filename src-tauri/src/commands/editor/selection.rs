use tauri::{AppHandle, State};

use crate::state::{AppState, SelectionSessionSnapshot};

#[tauri::command]
pub fn selection_session_get(
    state: State<'_, AppState>,
) -> Result<SelectionSessionSnapshot, String> {
    Ok(state.selection_session())
}

#[tauri::command]
pub fn selection_session_publish(
    state: State<'_, AppState>,
    app: AppHandle,
    snapshot: SelectionSessionSnapshot,
) -> Result<SelectionSessionSnapshot, String> {
    state.publish_selection_session(&app, snapshot)
}
