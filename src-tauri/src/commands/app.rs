use tauri::State;

use crate::{app_state::AppState, models::BootstrapPayload};

#[tauri::command]
pub fn app_bootstrap(state: State<'_, AppState>) -> Result<BootstrapPayload, String> {
    Ok(state.bootstrap_payload())
}
