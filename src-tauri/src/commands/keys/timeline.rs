use serde_json::Value;
use tauri::State;

use crate::{
    errors::{CmdResult, CommandError},
    state::AppState,
};

#[tauri::command]
pub fn keys_timeline_checkpoint(state: State<'_, AppState>) -> CmdResult<Option<Value>> {
    Ok(state.obs_bridge.input_timeline_checkpoint())
}

#[tauri::command]
pub fn keys_timeline_recover(
    state: State<'_, AppState>,
    stream_id: Option<String>,
    after_revision: String,
) -> CmdResult<Value> {
    let revision = after_revision
        .parse::<u64>()
        .map_err(|_| CommandError::msg("Invalid timeline revision"))?;
    Ok(state
        .obs_bridge
        .input_timeline_recovery(stream_id.as_deref(), revision))
}
