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
    pub vk_code: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    pub scan_code: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    pub flags: Option<u32>,
}

#[repr(u8)]
#[derive(Debug, Serialize, Deserialize, Copy, Clone, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum HookKeyState {
    Down = 0,
    Up = 1,
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
        let file = std::fs::File::from_raw_handle(handle.0 as *mut std::ffi::c_void);
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
        let file = std::fs::File::from_raw_handle(handle.0 as *mut std::ffi::c_void);
        Ok(file)
    }
}
