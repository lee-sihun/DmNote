use tauri::{ipc::Channel, State, WebviewWindow};

use crate::services::preview_broker::{PreviewBroker, PreviewEnvelope, PreviewPublishRequest};

#[tauri::command]
pub fn editor_preview_subscribe(
    broker: State<'_, PreviewBroker>,
    window: WebviewWindow,
    channel: Channel<PreviewEnvelope>,
) -> Result<u64, String> {
    broker.subscribe(window.label(), channel)
}

#[tauri::command]
pub fn editor_preview_publish(
    broker: State<'_, PreviewBroker>,
    window: WebviewWindow,
    request: PreviewPublishRequest,
) -> Result<(), String> {
    broker.publish(window.label(), request)
}

#[tauri::command]
pub fn editor_preview_cancel(
    broker: State<'_, PreviewBroker>,
    window: WebviewWindow,
    session_id: String,
) -> Result<(), String> {
    broker.cancel(window.label(), &session_id)
}
