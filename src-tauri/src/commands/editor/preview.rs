use tauri::{ipc::Channel, State, WebviewWindow};

use crate::errors::{CmdResult, CommandError};
use crate::services::preview_broker::{PreviewBroker, PreviewEnvelope, PreviewPublishRequest};

#[tauri::command]
pub fn editor_preview_subscribe(
    broker: State<'_, PreviewBroker>,
    window: WebviewWindow,
    channel: Channel<PreviewEnvelope>,
) -> CmdResult<u64> {
    broker
        .subscribe(window.label(), channel)
        .map_err(CommandError::msg)
}

#[tauri::command]
pub fn editor_preview_publish(
    broker: State<'_, PreviewBroker>,
    window: WebviewWindow,
    request: PreviewPublishRequest,
) -> CmdResult<()> {
    broker
        .publish(window.label(), request)
        .map_err(CommandError::msg)
}

#[tauri::command]
pub fn editor_preview_cancel(
    broker: State<'_, PreviewBroker>,
    window: WebviewWindow,
    session_id: String,
) -> CmdResult<()> {
    broker
        .cancel(window.label(), &session_id)
        .map_err(CommandError::msg)
}
