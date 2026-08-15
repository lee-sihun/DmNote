use tauri::{AppHandle, State};

use crate::errors::{CmdResult, CommandError};
use crate::state::{AppState, SelectionSessionSnapshot};

#[tauri::command]
pub fn selection_session_get(state: State<'_, AppState>) -> CmdResult<SelectionSessionSnapshot> {
    Ok(state.selection_session())
}

#[tauri::command]
pub fn selection_session_publish(
    state: State<'_, AppState>,
    app: AppHandle,
    snapshot: SelectionSessionSnapshot,
) -> CmdResult<SelectionSessionSnapshot> {
    state
        .publish_selection_session(&app, snapshot)
        .map_err(CommandError::msg)
}
