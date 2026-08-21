use serde_json::Value;
use tauri::State;

use crate::{errors::CmdResult, state::AppState};

#[tauri::command]
pub fn keys_timeline_checkpoint(state: State<'_, AppState>) -> CmdResult<Option<Value>> {
    Ok(state.obs_bridge.input_timeline_checkpoint())
}
