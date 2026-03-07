use tauri::State;

use crate::{errors::CmdResult, models::BootstrapPayload, state::AppState};

#[tauri::command]
pub fn app_bootstrap(state: State<'_, AppState>) -> CmdResult<BootstrapPayload> {
    Ok(state.bootstrap_payload())
}
