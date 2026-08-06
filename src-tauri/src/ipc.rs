use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum InputDeviceKind {
    Keyboard,
    Mouse,
    Gamepad,
    #[serde(other)]
    Unknown,
}

fn default_device_kind() -> InputDeviceKind {
    InputDeviceKind::Keyboard
}

/// Command messages from keyboard daemon (e.g., global hotkeys)
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
#[allow(clippy::enum_variant_names)]
pub enum DaemonCommand {
    /// Toggle overlay visibility (Ctrl+Shift+O)
    ToggleOverlay,
    /// Toggle overlay lock (global shortcut)
    ToggleOverlayLock,
    /// Toggle always-on-top (global shortcut)
    ToggleAlwaysOnTop,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HookMessage {
    /// Primary device type for this input event.
    #[serde(default = "default_device_kind")]
    pub device: InputDeviceKind,
    pub labels: Vec<String>,
    pub state: HookKeyState,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    pub physical_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    pub vk_code: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    pub scan_code: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    pub flags: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    pub hold_duration_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    pub input_ts_ms: Option<f64>,
}

#[repr(u8)]
#[derive(Debug, Serialize, Deserialize, Copy, Clone, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum HookKeyState {
    Down = 0,
    Up = 1,
}

/// HID 축(노브/스틱) 절대값 메시지.
/// 데몬이 throttle된 절대 raw 값을 전송하고, wrap 델타·누적은 프론트가 계산.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HidAxisMessage {
    /// 축 식별자 "HIDA:vid:pid:usagePage:usage"
    pub axis_id: String,
    /// 현재 절대 raw 값
    pub value: u32,
    /// wrap 모듈러스(예: 8-bit 노브 = 256)
    pub full: u32,
}

#[cfg(target_os = "windows")]
use windows::Win32::{
    Foundation::{GetLastError, ERROR_PIPE_CONNECTED},
    Storage::FileSystem::{
        CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
        PIPE_ACCESS_INBOUND,
    },
    System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, PIPE_READMODE_BYTE, PIPE_TYPE_BYTE, PIPE_WAIT,
    },
};

#[cfg(target_os = "windows")]
pub fn pipe_server_create(name: &str) -> anyhow::Result<std::fs::File> {
    use std::ffi::OsStr;
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::FromRawHandle;

    let path = format!("\\\\.\\pipe\\{}", name);
    let wide: Vec<u16> = OsStr::new(&path).encode_wide().chain(once(0)).collect();
    unsafe {
        let handle = CreateNamedPipeW(
            windows::core::PCWSTR(wide.as_ptr()),
            PIPE_ACCESS_INBOUND,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
            1,
            4096,
            4096,
            0,
            None,
        );
        if handle.0.is_null() {
            return Err(anyhow::anyhow!("CreateNamedPipeW failed"));
        }

        let res = ConnectNamedPipe(handle, None);
        if res.is_err() {
            // CreateNamedPipeW와 ConnectNamedPipe 사이에 클라이언트가 연결된 경우
            // ERROR_PIPE_CONNECTED 에러 반환 — 성공으로 처리
            let err = GetLastError();
            if err != ERROR_PIPE_CONNECTED {
                return Err(anyhow::anyhow!("ConnectNamedPipe failed: {:?}", err));
            }
        }
        let file = std::fs::File::from_raw_handle(handle.0);
        Ok(file)
    }
}

#[cfg(target_os = "windows")]
pub fn pipe_client_connect(name: &str) -> anyhow::Result<std::fs::File> {
    use std::ffi::OsStr;
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::FromRawHandle;

    let path = format!("\\\\.\\pipe\\{}", name);
    let wide: Vec<u16> = OsStr::new(&path).encode_wide().chain(once(0)).collect();
    unsafe {
        // GENERIC_WRITE
        const DESIRED_ACCESS: u32 = 0x40000000;
        let handle_res = CreateFileW(
            windows::core::PCWSTR(wide.as_ptr()),
            DESIRED_ACCESS,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            None,
        );
        let handle = match handle_res {
            Ok(h) => h,
            Err(e) => return Err(anyhow::anyhow!("CreateFileW to pipe failed: {}", e)),
        };
        let file = std::fs::File::from_raw_handle(handle.0);
        Ok(file)
    }
}

#[cfg(test)]
mod tests {
    use super::{HookKeyState, HookMessage, InputDeviceKind};

    #[test]
    fn hook_message_accepts_legacy_payload_without_timing_fields() {
        let message: HookMessage =
            serde_json::from_str(r#"{"device":"keyboard","labels":["A"],"state":"DOWN"}"#).unwrap();

        assert_eq!(message.hold_duration_ms, None);
        assert_eq!(message.input_ts_ms, None);
        assert_eq!(message.physical_id, None);
    }

    #[test]
    fn hook_message_omits_absent_timing_fields() {
        let message = HookMessage {
            device: InputDeviceKind::Keyboard,
            labels: vec!["A".to_string()],
            state: HookKeyState::Down,
            physical_id: None,
            vk_code: None,
            scan_code: None,
            flags: None,
            hold_duration_ms: None,
            input_ts_ms: None,
        };

        let value = serde_json::to_value(message).unwrap();
        assert!(value.get("hold_duration_ms").is_none());
        assert!(value.get("input_ts_ms").is_none());
    }

    #[test]
    fn hook_message_serializes_present_timing_fields() {
        let message = HookMessage {
            device: InputDeviceKind::Keyboard,
            labels: vec!["A".to_string()],
            state: HookKeyState::Up,
            physical_id: Some("keyboard:test".to_string()),
            vk_code: None,
            scan_code: None,
            flags: None,
            hold_duration_ms: Some(12.5),
            input_ts_ms: Some(1_500.25),
        };

        let value = serde_json::to_value(message).unwrap();
        assert_eq!(value["hold_duration_ms"], 12.5);
        assert_eq!(value["input_ts_ms"], 1_500.25);
        assert_eq!(value["physical_id"], "keyboard:test");
    }
}
