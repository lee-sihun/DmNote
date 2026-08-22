use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::errors::{CmdResult, CommandError};
use crate::services::event_publisher::publish_event;
use crate::state::AppState;

/// 플러그인 간 윈도우 브릿지 메시지 전송
/// 모든 윈도우에 브로드캐스트
#[tauri::command]
pub fn plugin_bridge_send(
    app: AppHandle,
    message_type: String,
    data: Option<Value>,
) -> CmdResult<()> {
    log::debug!(
        "[IPC] plugin_bridge_send: type={}, data_size={}",
        message_type,
        data.as_ref().map(|d| d.to_string().len()).unwrap_or(0)
    );

    let payload = serde_json::json!({
        "type": message_type,
        "data": data,
    });

    publish_event(&app, "plugin-bridge:message", payload);

    Ok(())
}

/// 특정 윈도우에만 메시지 전송
#[tauri::command]
pub fn plugin_bridge_send_to(
    app: AppHandle,
    state: State<'_, AppState>,
    target: String,
    message_type: String,
    data: Option<Value>,
) -> CmdResult<()> {
    log::debug!(
        "[IPC] plugin_bridge_send_to: target={}, type={}, data_size={}",
        target,
        message_type,
        data.as_ref().map(|d| d.to_string().len()).unwrap_or(0)
    );

    let payload = serde_json::json!({
        "type": message_type,
        "data": data,
    });

    // 타겟 윈도우 레이블 결정
    let window_label = match target.as_str() {
        "main" => "main",
        "overlay" => "overlay",
        _ => {
            return Err(CommandError::msg(format!(
                "Unknown target window: {}",
                target
            )))
        }
    };

    // Window::emit도 전역 발행이므로 publisher에서 한 번만 전송
    if app.get_webview_window(window_label).is_some() {
        publish_event(&app, "plugin-bridge:message", payload);
        Ok(())
    } else if window_label == "overlay" && state.is_obs_mode_active() {
        // OBS 모드에서는 overlay가 destroy된 상태
        publish_event(&app, "plugin-bridge:message", payload);
        Ok(())
    } else {
        Err(CommandError::msg(format!(
            "Window '{}' not found",
            window_label
        )))
    }
}
