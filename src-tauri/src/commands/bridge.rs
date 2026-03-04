use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

/// 플러그인 간 윈도우 브릿지 메시지 전송
/// 모든 윈도우에 브로드캐스트
#[tauri::command]
pub async fn plugin_bridge_send(
    app: AppHandle,
    message_type: String,
    data: Option<Value>,
) -> Result<(), String> {
    log::debug!(
        "[IPC] plugin_bridge_send: type={}, data_size={}",
        message_type,
        data.as_ref().map(|d| d.to_string().len()).unwrap_or(0)
    );

    let payload = serde_json::json!({
        "type": message_type,
        "data": data,
    });

    app.emit("plugin-bridge:message", payload)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// 특정 윈도우에만 메시지 전송
#[tauri::command]
pub async fn plugin_bridge_send_to(
    app: AppHandle,
    target: String,
    message_type: String,
    data: Option<Value>,
) -> Result<(), String> {
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
        _ => return Err(format!("Unknown target window: {}", target)),
    };

    // 특정 윈도우에만 이벤트 전송
    if let Some(window) = app.get_webview_window(window_label) {
        window
            .emit("plugin-bridge:message", payload)
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err(format!("Window '{}' not found", window_label))
    }
}
