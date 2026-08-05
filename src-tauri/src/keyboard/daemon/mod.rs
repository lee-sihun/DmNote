use std::{
    collections::HashMap,
    hash::Hash,
    io::{self, Read, Write},
    sync::mpsc::{self, Sender},
    thread,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use crate::ipc::{DaemonCommand, HidAxisMessage, HookMessage};
use crate::models::ShortcutsState;
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
use anyhow::anyhow;
use anyhow::Result;

#[cfg(target_os = "windows")]
mod windows;

// HID 입력 처리 (버튼/축 동적 디코딩)
#[cfg(target_os = "windows")]
mod windows_hid;

#[cfg(target_os = "macos")]
mod macos;

fn load_hotkeys_from_env() -> ShortcutsState {
    std::env::var("DMNOTE_HOTKEYS_V1")
        .ok()
        .and_then(|value| serde_json::from_str::<ShortcutsState>(&value).ok())
        .unwrap_or_default()
}

fn wait_for_parent_disconnect(reader: &mut impl Read) -> io::Result<()> {
    let mut buffer = [0_u8; 1];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => return Ok(()),
            Ok(_) => {}
            Err(err) if err.kind() == io::ErrorKind::Interrupted => {}
            Err(err) => return Err(err),
        }
    }
}

pub fn start_parent_liveness_watch() -> io::Result<()> {
    thread::Builder::new()
        .name("keyboard-parent-watch".into())
        .spawn(|| {
            let stdin = io::stdin();
            let mut stdin = stdin.lock();
            if let Err(err) = wait_for_parent_disconnect(&mut stdin) {
                eprintln!("keyboard parent watch failed: {err}");
            }
            std::process::exit(0);
        })
        .map(|_| ())
}

#[derive(Debug)]
pub(super) enum DaemonOutput {
    Hook(HookMessage),
    Command(DaemonCommand),
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    Axis(HidAxisMessage),
}

#[derive(Clone)]
pub(super) struct OutputSender(Sender<DaemonOutput>);

impl OutputSender {
    pub(super) fn send(&self, output: DaemonOutput) {
        if self.0.send(output).is_err() {
            eprintln!("keyboard daemon writer channel closed");
            std::process::exit(1);
        }
    }
}

fn write_output(sink: &mut (dyn Write + Send), output: &DaemonOutput) -> Result<()> {
    let mut line = match output {
        DaemonOutput::Hook(message) => serde_json::to_vec(message)?,
        DaemonOutput::Command(command) => serde_json::to_vec(command)?,
        DaemonOutput::Axis(message) => serde_json::to_vec(message)?,
    };
    line.push(b'\n');
    sink.write_all(&line)?;
    Ok(())
}

pub(super) fn start_output_writer(mut sink: Box<dyn Write + Send>) -> io::Result<OutputSender> {
    let (sender, receiver) = mpsc::channel::<DaemonOutput>();
    thread::Builder::new()
        .name("keyboard-daemon-writer".into())
        .spawn(move || {
            for output in receiver {
                if let Err(err) = write_output(&mut *sink, &output) {
                    eprintln!("keyboard daemon writer failed: {err}");
                    std::process::exit(1);
                }
            }
        })?;
    Ok(OutputSender(sender))
}

#[derive(Clone, Copy)]
pub(super) struct InputCapture {
    pub(super) instant: Instant,
    pub(super) input_ts_ms: Option<f64>,
}

impl InputCapture {
    pub(super) fn now() -> Self {
        let instant = Instant::now();
        let input_ts_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .map(|duration| duration.as_secs_f64() * 1000.0);
        Self {
            instant,
            input_ts_ms,
        }
    }
}

struct ActiveInput {
    pressed_at: Instant,
    labels: Vec<String>,
}

pub(super) struct HoldTracker<K> {
    active: HashMap<K, ActiveInput>,
}

impl<K> Default for HoldTracker<K> {
    fn default() -> Self {
        Self {
            active: HashMap::new(),
        }
    }
}

pub(super) struct ReleaseMetadata {
    pub(super) labels: Vec<String>,
    pub(super) hold_duration_ms: Option<f64>,
}

impl<K: Eq + Hash> HoldTracker<K> {
    pub(super) fn press(
        &mut self,
        physical_id: K,
        captured_at: Instant,
        labels: Vec<String>,
    ) -> Vec<String> {
        self.active
            .entry(physical_id)
            .or_insert_with(|| ActiveInput {
                pressed_at: captured_at,
                labels,
            })
            .labels
            .clone()
    }

    pub(super) fn release(
        &mut self,
        physical_id: K,
        captured_at: Instant,
        fallback_labels: Vec<String>,
    ) -> ReleaseMetadata {
        let Some(active) = self.active.remove(&physical_id) else {
            return ReleaseMetadata {
                labels: fallback_labels,
                hold_duration_ms: None,
            };
        };
        ReleaseMetadata {
            labels: active.labels,
            hold_duration_ms: captured_at
                .checked_duration_since(active.pressed_at)
                .map(|duration| duration.as_secs_f64() * 1000.0),
        }
    }
}

#[cfg(any(target_os = "windows", test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(super) enum WindowsKeyboardPhysicalId {
    ScanCode {
        device: usize,
        scan_code: u32,
        extension_flags: u8,
    },
    VirtualKey {
        device: usize,
        vk_code: u32,
    },
}

#[cfg(any(target_os = "windows", test))]
pub(super) fn windows_keyboard_physical_id(
    device: usize,
    scan_code: u32,
    is_e0: bool,
    is_e1: bool,
    vk_code: u32,
) -> WindowsKeyboardPhysicalId {
    if scan_code == 0 {
        return WindowsKeyboardPhysicalId::VirtualKey { device, vk_code };
    }
    WindowsKeyboardPhysicalId::ScanCode {
        device,
        scan_code,
        extension_flags: u8::from(is_e0) | (u8::from(is_e1) << 1),
    }
}

#[cfg(any(target_os = "windows", test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(super) struct WindowsHidPhysicalId {
    device: usize,
    usage_page: u16,
    usage: u16,
}

#[cfg(any(target_os = "windows", test))]
pub(super) fn windows_hid_physical_id(
    device: usize,
    usage_page: u16,
    usage: u16,
) -> WindowsHidPhysicalId {
    WindowsHidPhysicalId {
        device,
        usage_page,
        usage,
    }
}

pub fn run() -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        windows::run_raw_input()
    }

    #[cfg(target_os = "macos")]
    {
        macos::run_macos()
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err(anyhow!(
            "Raw input backend is only available on Windows and macOS"
        ))
    }
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Cursor, Write},
        sync::mpsc,
        time::{Duration, Instant},
    };

    use super::{
        start_output_writer, wait_for_parent_disconnect, windows_hid_physical_id,
        windows_keyboard_physical_id, DaemonOutput, HoldTracker, WindowsKeyboardPhysicalId,
    };
    use crate::ipc::{DaemonCommand, HidAxisMessage, HookKeyState, HookMessage, InputDeviceKind};

    struct DropSink {
        bytes: Vec<u8>,
        sender: Option<mpsc::Sender<Vec<u8>>>,
    }

    impl Write for DropSink {
        fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
            self.bytes.extend_from_slice(buffer);
            Ok(buffer.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl Drop for DropSink {
        fn drop(&mut self) {
            if let Some(sender) = self.sender.take() {
                let _ = sender.send(std::mem::take(&mut self.bytes));
            }
        }
    }

    #[test]
    fn parent_watch_returns_after_pipe_eof() {
        let mut reader = Cursor::new(Vec::<u8>::new());
        wait_for_parent_disconnect(&mut reader).unwrap();
    }

    #[test]
    fn parent_watch_ignores_bytes_until_pipe_eof() {
        let mut reader = Cursor::new(b"keepalive".to_vec());
        wait_for_parent_disconnect(&mut reader).unwrap();
        assert_eq!(reader.position(), b"keepalive".len() as u64);
    }

    #[test]
    fn writer_queue_preserves_output_order_and_wire_shapes() {
        let (sender, receiver) = mpsc::channel();
        let output = start_output_writer(Box::new(DropSink {
            bytes: Vec::new(),
            sender: Some(sender),
        }))
        .unwrap();
        output.send(DaemonOutput::Hook(HookMessage {
            device: InputDeviceKind::Keyboard,
            labels: vec!["A".to_string()],
            state: HookKeyState::Down,
            vk_code: None,
            scan_code: None,
            flags: None,
            hold_duration_ms: None,
            input_ts_ms: Some(100.0),
        }));
        output.send(DaemonOutput::Command(DaemonCommand::ToggleOverlay));
        output.send(DaemonOutput::Axis(HidAxisMessage {
            axis_id: "axis".to_string(),
            value: 3,
            full: 16,
        }));
        drop(output);

        let bytes = receiver.recv_timeout(Duration::from_secs(1)).unwrap();
        let lines: Vec<serde_json::Value> = std::str::from_utf8(&bytes)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();

        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0]["labels"], serde_json::json!(["A"]));
        assert_eq!(lines[1]["type"], "toggle_overlay");
        assert_eq!(lines[2]["axis_id"], "axis");
    }

    #[test]
    fn repeated_down_keeps_first_timestamp_and_labels() {
        let mut tracker = HoldTracker::<u8>::default();
        let started_at = Instant::now();

        assert_eq!(
            tracker.press(1, started_at, vec!["DOWN".to_string()]),
            vec!["DOWN"]
        );
        assert_eq!(
            tracker.press(
                1,
                started_at + Duration::from_millis(20),
                vec!["REPEAT".to_string()],
            ),
            vec!["DOWN"]
        );

        let release = tracker.release(
            1,
            started_at + Duration::from_millis(35),
            vec!["UP".to_string()],
        );
        assert_eq!(release.labels, vec!["DOWN"]);
        assert_eq!(release.hold_duration_ms, Some(35.0));
    }

    #[test]
    fn up_removes_active_press() {
        let mut tracker = HoldTracker::<u8>::default();
        let started_at = Instant::now();
        tracker.press(1, started_at, vec!["A".to_string()]);

        let first = tracker.release(1, started_at, vec!["A".to_string()]);
        let second = tracker.release(1, started_at, vec!["A".to_string()]);

        assert_eq!(first.hold_duration_ms, Some(0.0));
        assert_eq!(second.hold_duration_ms, None);
    }

    #[test]
    fn unmatched_up_has_no_hold_duration() {
        let mut tracker = HoldTracker::<u8>::default();
        let release = tracker.release(1, Instant::now(), vec!["A".to_string()]);

        assert_eq!(release.labels, vec!["A"]);
        assert_eq!(release.hold_duration_ms, None);
    }

    #[test]
    fn release_reuses_down_labels() {
        let mut tracker = HoldTracker::<u8>::default();
        let captured_at = Instant::now();
        tracker.press(1, captured_at, vec!["DOWN LABEL".to_string()]);

        let release = tracker.release(1, captured_at, vec!["UP LABEL".to_string()]);

        assert_eq!(release.labels, vec!["DOWN LABEL"]);
    }

    #[test]
    fn windows_keyboard_id_uses_scan_code_extensions_and_vk_fallback() {
        let base = windows_keyboard_physical_id(7, 29, false, false, 0x11);
        let extended = windows_keyboard_physical_id(7, 29, true, false, 0x11);
        let fallback = windows_keyboard_physical_id(7, 0, false, false, 0xA2);

        assert_ne!(base, extended);
        assert_eq!(
            fallback,
            WindowsKeyboardPhysicalId::VirtualKey {
                device: 7,
                vk_code: 0xA2,
            }
        );
    }

    #[test]
    fn windows_physical_ids_include_device_handle() {
        assert_ne!(
            windows_keyboard_physical_id(1, 30, false, false, 0x41),
            windows_keyboard_physical_id(2, 30, false, false, 0x41)
        );
        assert_ne!(
            windows_hid_physical_id(1, 9, 1),
            windows_hid_physical_id(2, 9, 1)
        );
        assert_ne!(
            windows_hid_physical_id(1, 9, 1),
            windows_hid_physical_id(1, 8, 1)
        );
        assert_ne!(
            windows_hid_physical_id(1, 9, 1),
            windows_hid_physical_id(1, 9, 2)
        );
    }
}
