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

pub const DAEMON_INPUT_STREAM_VERSION: u8 = 1;

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DaemonInputFrameKind {
    Input,
    Watermark,
}

/// 데몬 입력과 확정선을 같은 writer 순서로 전달하는 내부 wire envelope.
///
/// revision/source_time_us는 JavaScript safe integer 범위를 넘겨도 정밀도를
/// 잃지 않도록 문자열로 직렬화한다.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DaemonInputFrame {
    pub version: u8,
    pub stream_id: String,
    pub revision: String,
    pub source_time_us: String,
    pub kind: DaemonInputFrameKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    pub message: Option<HookMessage>,
}

impl DaemonInputFrame {
    pub fn input(
        stream_id: String,
        revision: u64,
        source_time_us: u64,
        message: HookMessage,
    ) -> Self {
        Self {
            version: DAEMON_INPUT_STREAM_VERSION,
            stream_id,
            revision: revision.to_string(),
            source_time_us: source_time_us.to_string(),
            kind: DaemonInputFrameKind::Input,
            message: Some(message),
        }
    }

    pub fn watermark(stream_id: String, revision: u64, source_time_us: u64) -> Self {
        Self {
            version: DAEMON_INPUT_STREAM_VERSION,
            stream_id,
            revision: revision.to_string(),
            source_time_us: source_time_us.to_string(),
            kind: DaemonInputFrameKind::Watermark,
            message: None,
        }
    }

    pub fn parsed_revision(&self) -> Option<u64> {
        self.revision.parse().ok()
    }

    pub fn parsed_source_time_us(&self) -> Option<u64> {
        self.source_time_us.parse().ok()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DaemonInputFrameOrder {
    NewStream,
    Next,
}

#[derive(Debug, Default)]
pub struct DaemonInputStreamCursor {
    stream_id: Option<String>,
    revision: u64,
    source_time_us: u64,
}

impl DaemonInputStreamCursor {
    pub fn observe(&mut self, frame: &DaemonInputFrame) -> Result<DaemonInputFrameOrder, String> {
        if frame.version != DAEMON_INPUT_STREAM_VERSION {
            return Err(format!(
                "unsupported daemon input stream version: {}",
                frame.version
            ));
        }
        let revision = frame
            .parsed_revision()
            .filter(|revision| *revision > 0)
            .ok_or_else(|| String::from("invalid daemon input revision"))?;
        let source_time_us = frame
            .parsed_source_time_us()
            .ok_or_else(|| String::from("invalid daemon input source time"))?;

        if self.stream_id.as_deref() != Some(frame.stream_id.as_str()) {
            if revision != 1 {
                return Err(format!(
                    "daemon input stream must start at revision 1, received {revision}"
                ));
            }
            self.stream_id = Some(frame.stream_id.clone());
            self.revision = revision;
            self.source_time_us = source_time_us;
            return Ok(DaemonInputFrameOrder::NewStream);
        }

        let expected = self
            .revision
            .checked_add(1)
            .ok_or_else(|| String::from("daemon input revision overflow"))?;
        if revision != expected {
            return Err(format!(
                "daemon input revision gap: expected {expected}, received {revision}"
            ));
        }
        if source_time_us < self.source_time_us {
            return Err(format!(
                "daemon input source time moved backwards: previous {}, received {source_time_us}",
                self.source_time_us
            ));
        }

        self.revision = revision;
        self.source_time_us = source_time_us;
        Ok(DaemonInputFrameOrder::Next)
    }
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
    use super::{
        DaemonInputFrame, DaemonInputFrameKind, DaemonInputFrameOrder, DaemonInputStreamCursor,
        HookKeyState, HookMessage, InputDeviceKind, DAEMON_INPUT_STREAM_VERSION,
    };

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

    #[test]
    fn daemon_input_frame_keeps_u64_fields_as_decimal_strings() {
        let revision = u64::MAX - 1;
        let source_time_us = u64::MAX - 2;
        let frame =
            DaemonInputFrame::watermark("stream-test".to_string(), revision, source_time_us);

        let value = serde_json::to_value(&frame).unwrap();
        assert_eq!(value["version"], DAEMON_INPUT_STREAM_VERSION);
        assert_eq!(value["kind"], "watermark");
        assert_eq!(value["revision"], revision.to_string());
        assert_eq!(value["source_time_us"], source_time_us.to_string());
        assert!(value.get("message").is_none());

        let parsed: DaemonInputFrame = serde_json::from_value(value).unwrap();
        assert_eq!(parsed.kind, DaemonInputFrameKind::Watermark);
        assert_eq!(parsed.parsed_revision(), Some(revision));
        assert_eq!(parsed.parsed_source_time_us(), Some(source_time_us));
    }

    #[test]
    fn daemon_input_frame_wraps_hook_message() {
        let frame = DaemonInputFrame::input(
            "stream-test".to_string(),
            7,
            42,
            HookMessage {
                device: InputDeviceKind::Keyboard,
                labels: vec!["A".to_string()],
                state: HookKeyState::Down,
                physical_id: None,
                vk_code: None,
                scan_code: None,
                flags: None,
                hold_duration_ms: None,
                input_ts_ms: None,
            },
        );

        let value = serde_json::to_value(&frame).unwrap();
        assert_eq!(value["kind"], "input");
        assert_eq!(value["message"]["labels"], serde_json::json!(["A"]));
        assert_eq!(frame.parsed_revision(), Some(7));
        assert_eq!(frame.parsed_source_time_us(), Some(42));
    }

    #[test]
    fn daemon_input_cursor_rejects_gap_and_backward_time() {
        let mut cursor = DaemonInputStreamCursor::default();
        let first = DaemonInputFrame::watermark("stream-a".to_string(), 1, 100);
        let next = DaemonInputFrame::watermark("stream-a".to_string(), 2, 101);
        let gap = DaemonInputFrame::watermark("stream-a".to_string(), 4, 102);
        let backward = DaemonInputFrame::watermark("stream-a".to_string(), 3, 99);
        let new_stream = DaemonInputFrame::watermark("stream-b".to_string(), 1, 0);

        assert_eq!(cursor.observe(&first), Ok(DaemonInputFrameOrder::NewStream));
        assert_eq!(cursor.observe(&next), Ok(DaemonInputFrameOrder::Next));
        assert!(cursor.observe(&gap).unwrap_err().contains("revision gap"));
        assert!(cursor.observe(&backward).unwrap_err().contains("backwards"));
        assert_eq!(
            cursor.observe(&new_stream),
            Ok(DaemonInputFrameOrder::NewStream)
        );
    }

    #[test]
    fn daemon_input_cursor_rejects_partial_new_stream() {
        let mut cursor = DaemonInputStreamCursor::default();
        let partial = DaemonInputFrame::watermark("stream-a".to_string(), 2, 100);

        assert!(cursor
            .observe(&partial)
            .unwrap_err()
            .contains("must start at revision 1"));
    }
}
