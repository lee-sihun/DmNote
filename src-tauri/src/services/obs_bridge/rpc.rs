use base64::Engine;
use serde_json::Value;
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponse, InvokeResponseBody};
use tauri::webview::InvokeRequest;

use crate::models::obs::InvokeRequestPayload;

pub(super) type RpcResult = Result<Value, Value>;
pub(super) type RpcSender = tokio::sync::mpsc::UnboundedSender<(String, RpcResult)>;

pub(super) const APP_HANDLE_NOT_AVAILABLE: &str = "AppHandle not available";
pub(super) const NO_WEBVIEW_AVAILABLE: &str = "No webview window available";

pub(super) const ALLOWED_WS_COMMANDS: &[&str] = &[
    "app_bootstrap",
    "settings_get",
    "editor_get",
    "layer_groups_get",
    "note_tab_get_all",
    "note_tab_get",
    "css_get",
    "css_get_use",
    "css_tab_get_all",
    "css_tab_get",
    "js_get",
    "js_get_use",
    "get_cursor_settings",
    "keys_get",
    "keys_get_counters",
    "positions_get",
    "stat_positions_get",
    "graph_positions_get",
    "knob_positions_get",
    "custom_tabs_list",
    "sound_list",
    "sound_load_original",
    "counter_animation_list",
    "plugin_bridge_send",
    "plugin_bridge_send_to",
    "raw_input_subscribe",
    "raw_input_unsubscribe",
    "plugin_storage_get",
    "plugin_storage_set",
    "plugin_storage_remove",
    "plugin_storage_keys",
    "plugin_storage_has_data",
    // 파괴적 bulk 삭제는 plugin_storage_clear와 동일하게 원격 차단
];

pub(super) fn is_allowed_command(command: &str) -> bool {
    ALLOWED_WS_COMMANDS.contains(&command)
}

pub(super) fn build_allowed_list() -> Vec<String> {
    ALLOWED_WS_COMMANDS
        .iter()
        .map(|command| command.to_string())
        .collect()
}

pub(super) fn parse_invoke_request(
    payload: &Value,
) -> Result<InvokeRequestPayload, serde_json::Error> {
    serde_json::from_value(payload.clone())
}

pub(super) fn invalid_invoke_request_error(error: &serde_json::Error) -> Value {
    serde_json::json!(format!("Invalid invoke_request: {error}"))
}

pub(super) fn command_not_allowed_error(command: &str) -> Value {
    serde_json::json!(format!("Command not allowed: {command}"))
}

pub(super) fn select_overlay_or_main<T, Overlay, Main>(overlay: Overlay, main: Main) -> Option<T>
where
    Overlay: FnOnce() -> Option<T>,
    Main: FnOnce() -> Option<T>,
{
    overlay().or_else(main)
}

pub(super) fn local_invoke_url() -> tauri::Url {
    // 플랫폼별 로컬 URL (Windows: http://tauri.localhost, macOS/Linux: tauri://localhost)
    if cfg!(windows) || cfg!(target_os = "android") {
        tauri::Url::parse("http://tauri.localhost").unwrap()
    } else {
        tauri::Url::parse("tauri://localhost").unwrap()
    }
}

pub(super) fn build_invoke_request(
    command: String,
    args: Value,
    local_url: tauri::Url,
    invoke_key: String,
) -> InvokeRequest {
    InvokeRequest {
        cmd: command,
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: local_url,
        body: InvokeBody::Json(args),
        headers: Default::default(),
        invoke_key,
    }
}

pub(super) fn project_invoke_response(response: InvokeResponse) -> RpcResult {
    match response {
        InvokeResponse::Ok(body) => {
            let value = match body {
                InvokeResponseBody::Json(json_str) => {
                    serde_json::from_str(&json_str).unwrap_or(Value::Null)
                }
                InvokeResponseBody::Raw(bytes) => {
                    // Raw bytes → base64 인코딩
                    Value::String(base64::engine::general_purpose::STANDARD.encode(&bytes))
                }
            };
            Ok(value)
        }
        InvokeResponse::Err(err) => Err(err.0),
    }
}

pub(super) fn send_rpc_response(rpc_tx: &RpcSender, request_id: String, result: RpcResult) {
    let _ = rpc_tx.send((request_id, result));
}
