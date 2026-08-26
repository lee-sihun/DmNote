use tauri::AppHandle;

use crate::{commands::run_blocking, errors::CmdResult, models::BootstrapPayload};

#[tauri::command]
pub async fn app_bootstrap(app: AppHandle) -> CmdResult<BootstrapPayload> {
    run_blocking(app, |_, state| Ok(state.bootstrap_payload())).await
}
