use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::{
    models::{
        PluginAuthoritySnapshot, PluginRpcRequest, PluginRpcRequestEnvelope, PluginRpcResponse,
    },
    state::{plugin::MAX_PLUGIN_RPC_BYTES, AppState},
};

const MAIN_WINDOW_LABEL: &str = "main";
const PANEL_WINDOW_LABEL: &str = "panel";

#[tauri::command]
pub fn plugin_rpc_send(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    target_window_label: String,
    request: PluginRpcRequest,
) -> Result<(), String> {
    crate::state::plugin::validate_plugin_rpc_request(&request)?;
    if window.label() != PANEL_WINDOW_LABEL {
        return Err("PLUGIN_RPC_SOURCE_NOT_ALLOWED".to_string());
    }
    if target_window_label != MAIN_WINDOW_LABEL {
        return Err("PLUGIN_RPC_TARGET_NOT_ALLOWED".to_string());
    }
    if app.get_webview_window(MAIN_WINDOW_LABEL).is_none() {
        return Err("AUTHORITY_UNAVAILABLE".to_string());
    }

    let _history_admission = state
        .admit_frontend_history_mutation(window.label())
        .map_err(|_| "HISTORY_IN_PROGRESS".to_string())?;
    let authority = state
        .plugin_authority()
        .admit(request.authority_generation)?;
    let current_model_revision = state.store.plugin_model_revision();
    let envelope = PluginRpcRequestEnvelope {
        protocol_version: request.protocol_version,
        request_id: request.request_id,
        source_window_label: window.label().to_string(),
        authority_generation: authority.generation(),
        expected_model_revision: request.expected_model_revision,
        operation: request.operation,
        payload: request.payload,
    };
    if serde_json::to_vec(&envelope)
        .map_err(|error| format!("INVALID_PLUGIN_RPC_REQUEST:{error}"))?
        .len()
        > MAX_PLUGIN_RPC_BYTES
    {
        return Err("PLUGIN_RPC_REQUEST_TOO_LARGE".to_string());
    }

    state.plugin_rpc_router().forward_request(
        &target_window_label,
        envelope,
        current_model_revision,
        |target, payload| {
            if app.get_webview_window(target).is_none() {
                return Err("AUTHORITY_UNAVAILABLE".to_string());
            }
            app.emit_to(target, "plugin-rpc:request", payload)
                .map_err(|error| error.to_string())
        },
    )?;
    Ok(())
}

#[tauri::command]
pub fn plugin_rpc_respond(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    response: PluginRpcResponse,
) -> Result<(), String> {
    crate::state::plugin::validate_plugin_rpc_response(&response)?;
    if window.label() != MAIN_WINDOW_LABEL {
        return Err("PLUGIN_RPC_RESPONDER_NOT_ALLOWED".to_string());
    }
    let _authority = state
        .plugin_authority()
        .admit(response.authority_generation)?;
    if response.model_revision != state.store.plugin_model_revision() {
        return Err("PLUGIN_MODEL_REVISION_MISMATCH".to_string());
    }
    state
        .plugin_rpc_router()
        .forward_response(window.label(), &response, |target, payload| {
            if app.get_webview_window(target).is_none() {
                return Err("PLUGIN_RPC_SOURCE_UNAVAILABLE".to_string());
            }
            app.emit_to(target, "plugin-rpc:response", payload)
                .map_err(|error| error.to_string())
        })
}

#[tauri::command]
pub fn plugin_authority_reset(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
) -> Result<PluginAuthoritySnapshot, String> {
    if window.label() != MAIN_WINDOW_LABEL {
        return Err("PLUGIN_AUTHORITY_RESET_NOT_ALLOWED".to_string());
    }
    let authority = state.reset_plugin_authority()?;
    let snapshot = PluginAuthoritySnapshot {
        authority_generation: authority.generation(),
        model_revision: state.store.plugin_model_revision(),
    };
    if let Err(error) = app.emit("plugin-rpc:authority-changed", &snapshot) {
        log::warn!("failed to publish plugin authority generation: {error}");
    }
    Ok(snapshot)
}
