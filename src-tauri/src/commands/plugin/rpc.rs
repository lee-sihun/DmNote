use tauri::{AppHandle, Emitter, WebviewWindow};

use crate::{
    commands::run_mutation,
    errors::{CmdResult, CommandError},
    models::PluginAuthoritySnapshot,
};

const MAIN_WINDOW_LABEL: &str = "main";

#[tauri::command]
pub async fn plugin_authority_reset(
    app: AppHandle,
    window: WebviewWindow,
) -> CmdResult<PluginAuthoritySnapshot> {
    if window.label() != MAIN_WINDOW_LABEL {
        return Err(CommandError::msg("PLUGIN_AUTHORITY_RESET_NOT_ALLOWED"));
    }
    // reset은 번호표 turn 안에서 - 커밋 커맨드가 잠금 대신 번호표 FIFO로 reset과
    // 직렬화되므로, turn 안 revalidate를 통과한 커밋은 reset 앞에서 완결된다
    run_mutation(app, |app, state| {
        let authority = state.reset_plugin_authority().map_err(CommandError::msg)?;
        let snapshot = PluginAuthoritySnapshot {
            authority_generation: authority.generation(),
            model_revision: state.store.plugin_model_revision(),
        };
        if let Err(error) = app.emit("plugin-rpc:authority-changed", &snapshot) {
            log::warn!("failed to publish plugin authority generation: {error}");
        }
        Ok(snapshot)
    })
    .await
}
