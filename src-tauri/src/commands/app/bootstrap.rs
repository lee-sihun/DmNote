use tauri::State;

use crate::{models::BootstrapPayload, state::AppState};

#[tauri::command]
pub fn app_bootstrap(state: State<'_, AppState>) -> Result<BootstrapPayload, String> {
    Ok(state.bootstrap_payload())
}
