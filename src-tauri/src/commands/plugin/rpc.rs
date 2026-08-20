use tauri::{AppHandle, Emitter, State, WebviewWindow};

use crate::{
    errors::{CmdResult, CommandError},
    models::PluginAuthoritySnapshot,
    state::AppState,
};

const MAIN_WINDOW_LABEL: &str = "main";

#[tauri::command]
pub fn plugin_authority_reset(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
) -> CmdResult<PluginAuthoritySnapshot> {
    if window.label() != MAIN_WINDOW_LABEL {
        return Err(CommandError::msg("PLUGIN_AUTHORITY_RESET_NOT_ALLOWED"));
    }
    let authority = state.reset_plugin_authority().map_err(CommandError::msg)?;
    let snapshot = PluginAuthoritySnapshot {
        authority_generation: authority.generation(),
        model_revision: state.store.plugin_model_revision(),
    };
    if let Err(error) = app.emit("plugin-rpc:authority-changed", &snapshot) {
        log::warn!("failed to publish plugin authority generation: {error}");
    }
    Ok(snapshot)
}
