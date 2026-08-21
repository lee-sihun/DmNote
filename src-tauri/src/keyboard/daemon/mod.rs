use std::{
    collections::HashMap,
    hash::Hash,
    io::{self, Read, Write},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Sender},
        Mutex, MutexGuard, OnceLock,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use crate::ipc::{DaemonCommand, DaemonInputFrame, HidAxisMessage, HookMessage};
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
    Hook {
        message: HookMessage,
        source_time_us: u64,
    },
    ResetInputStream,
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

    pub(super) fn send_hook(&self, message: HookMessage, captured: &InputCapture) {
        self.send(DaemonOutput::Hook {
            message,
            source_time_us: captured.source_time_us,
        });
    }
}

// 기능 전환 전 계측용 초기 cadence. 정확성은 이 값이 아니라 watermark
// 상한으로 보장하며, 출시 기본값은 플랫폼별 측정 후 확정한다.
const SOURCE_WATERMARK_INTERVAL: Duration = Duration::from_millis(16);

struct DaemonInputSequencer {
    stream_id: String,
    revision: u64,
}

impl DaemonInputSequencer {
    fn new() -> Self {
        Self {
            stream_id: uuid::Uuid::new_v4().to_string(),
            revision: 0,
        }
    }

    fn next_revision(&mut self) -> u64 {
        self.revision = self.revision.wrapping_add(1);
        self.revision
    }

    fn input(&mut self, message: HookMessage, source_time_us: u64) -> DaemonInputFrame {
        let revision = self.next_revision();
        DaemonInputFrame::input(self.stream_id.clone(), revision, source_time_us, message)
    }

    fn watermark(&mut self) -> DaemonInputFrame {
        let revision = self.next_revision();
        DaemonInputFrame::watermark(
            self.stream_id.clone(),
            revision,
            next_daemon_source_time_us(),
        )
    }
}

static DAEMON_SOURCE_ORIGIN: OnceLock<Instant> = OnceLock::new();
static DAEMON_SOURCE_LAST_TIME_US: AtomicU64 = AtomicU64::new(0);
static SOURCE_SEQUENCER_BARRIER: Mutex<()> = Mutex::new(());

fn next_daemon_source_time_us() -> u64 {
    let elapsed = DAEMON_SOURCE_ORIGIN
        .get_or_init(Instant::now)
        .elapsed()
        .as_micros()
        .min(u64::MAX as u128) as u64;
    let mut previous = DAEMON_SOURCE_LAST_TIME_US.load(Ordering::Relaxed);
    loop {
        let next = elapsed.max(previous.saturating_add(1));
        match DAEMON_SOURCE_LAST_TIME_US.compare_exchange_weak(
            previous,
            next,
            Ordering::Relaxed,
            Ordering::Relaxed,
        ) {
            Ok(_) => return next,
            Err(actual) => previous = actual,
        }
    }
}

fn write_json_line<T: serde::Serialize>(sink: &mut (dyn Write + Send), value: &T) -> Result<()> {
    let mut line = serde_json::to_vec(value)?;
    line.push(b'\n');
    sink.write_all(&line)?;
    Ok(())
}

fn write_output(sink: &mut (dyn Write + Send), output: &DaemonOutput) -> Result<()> {
    match output {
        // Hook은 start_output_writer에서 stream envelope로 직렬화한다.
        DaemonOutput::Hook { message, .. } => write_json_line(sink, message),
        DaemonOutput::ResetInputStream => Ok(()),
        DaemonOutput::Command(command) => write_json_line(sink, command),
        DaemonOutput::Axis(message) => write_json_line(sink, message),
    }
}

fn write_sequenced_output(
    sink: &mut (dyn Write + Send),
    sequencer: &mut DaemonInputSequencer,
    output: DaemonOutput,
) -> Result<()> {
    match output {
        DaemonOutput::Hook {
            message,
            source_time_us,
        } => {
            let frame = sequencer.input(message, source_time_us);
            write_json_line(sink, &frame)
        }
        DaemonOutput::ResetInputStream => {
            *sequencer = DaemonInputSequencer::new();
            Ok(())
        }
        output => write_output(sink, &output),
    }
}

pub(super) fn start_output_writer(mut sink: Box<dyn Write + Send>) -> io::Result<OutputSender> {
    let (sender, receiver) = mpsc::channel::<DaemonOutput>();
    thread::Builder::new()
        .name("keyboard-daemon-writer".into())
        .spawn(move || {
            let mut sequencer = DaemonInputSequencer::new();
            let mut next_watermark_at = Instant::now() + SOURCE_WATERMARK_INTERVAL;
            loop {
                let wait = next_watermark_at.saturating_duration_since(Instant::now());
                let output = match receiver.recv_timeout(wait) {
                    Ok(output) => Some(output),
                    Err(mpsc::RecvTimeoutError::Timeout) => None,
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                };

                let write_result = match output {
                    Some(output) => write_sequenced_output(&mut *sink, &mut sequencer, output),
                    None => Ok(()),
                };
                if let Err(err) = write_result {
                    eprintln!("keyboard daemon writer failed: {err}");
                    std::process::exit(1);
                }

                let now = Instant::now();
                if now >= next_watermark_at {
                    // 캡처 중인 입력의 source time이 watermark 뒤로 밀리지 않도록
                    // callback capture 구간과 watermark 발행을 배타 처리한다.
                    let _sequencer_guard = SOURCE_SEQUENCER_BARRIER
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());

                    // sequencer lock을 기다리는 사이 동일 capture가 등록한 나머지
                    // 출력까지 먼저 비운 뒤 확정선을 기록한다.
                    loop {
                        match receiver.try_recv() {
                            Ok(output) => {
                                if let Err(err) =
                                    write_sequenced_output(&mut *sink, &mut sequencer, output)
                                {
                                    eprintln!("keyboard daemon writer failed: {err}");
                                    std::process::exit(1);
                                }
                            }
                            Err(mpsc::TryRecvError::Empty) => break,
                            Err(mpsc::TryRecvError::Disconnected) => return,
                        }
                    }
                    let watermark = sequencer.watermark();
                    if let Err(err) = write_json_line(&mut *sink, &watermark) {
                        eprintln!("keyboard daemon writer failed: {err}");
                        std::process::exit(1);
                    }
                    // barrier/backlog 대기 이후 watermark 폭주 방지
                    next_watermark_at = Instant::now() + SOURCE_WATERMARK_INTERVAL;
                }
            }
        })?;
    Ok(OutputSender(sender))
}

pub(super) struct InputCapture {
    pub(super) instant: Instant,
    pub(super) input_ts_ms: Option<f64>,
    source_time_us: u64,
    _sequencer_guard: MutexGuard<'static, ()>,
}

impl InputCapture {
    pub(super) fn now() -> Self {
        let sequencer_guard = SOURCE_SEQUENCER_BARRIER
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let instant = Instant::now();
        let input_ts_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .map(|duration| duration.as_secs_f64() * 1000.0);
        Self {
            instant,
            input_ts_ms,
            source_time_us: next_daemon_source_time_us(),
            _sequencer_guard: sequencer_guard,
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
impl WindowsKeyboardPhysicalId {
    pub(super) fn opaque(self) -> String {
        match self {
            Self::ScanCode {
                device,
                scan_code,
                extension_flags,
            } => format!("windows:keyboard:scan:{device}:{scan_code}:{extension_flags}"),
            Self::VirtualKey { device, vk_code } => {
                format!("windows:keyboard:vk:{device}:{vk_code}")
            }
        }
    }
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
pub(super) enum WindowsPhysicalInputId {
    Keyboard(WindowsKeyboardPhysicalId),
    MouseButton(u8),
}

#[cfg(any(target_os = "windows", test))]
impl WindowsPhysicalInputId {
    pub(super) fn opaque(self) -> String {
        match self {
            Self::Keyboard(id) => id.opaque(),
            Self::MouseButton(button) => format!("windows:mouse:button:{button}"),
        }
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
impl WindowsHidPhysicalId {
    pub(super) fn opaque(self) -> String {
        format!(
            "windows:hid:{}:{}:{}",
            self.device, self.usage_page, self.usage
        )
    }
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
        windows_keyboard_physical_id, DaemonInputSequencer, DaemonOutput, HoldTracker,
        InputCapture, WindowsKeyboardPhysicalId, WindowsPhysicalInputId,
    };
    use crate::ipc::{
        DaemonCommand, DaemonInputFrameKind, HidAxisMessage, HookKeyState, HookMessage,
        InputDeviceKind,
    };

    struct DropSink {
        bytes: Vec<u8>,
        sender: Option<mpsc::Sender<Vec<u8>>>,
    }

    struct LineSink {
        sender: mpsc::Sender<Vec<u8>>,
    }

    impl Write for LineSink {
        fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
            self.sender
                .send(buffer.to_vec())
                .map_err(|_| std::io::ErrorKind::BrokenPipe)?;
            Ok(buffer.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn hook_message(label: &str) -> HookMessage {
        HookMessage {
            device: InputDeviceKind::Keyboard,
            labels: vec![label.to_string()],
            state: HookKeyState::Down,
            physical_id: Some(format!("keyboard:{label}")),
            vk_code: None,
            scan_code: None,
            flags: None,
            hold_duration_ms: None,
            input_ts_ms: None,
        }
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
    fn writer_queue_wraps_hook_and_preserves_non_input_wire_shapes() {
        let (sender, receiver) = mpsc::channel();
        let output = start_output_writer(Box::new(DropSink {
            bytes: Vec::new(),
            sender: Some(sender),
        }))
        .unwrap();
        let captured = InputCapture::now();
        output.send_hook(
            HookMessage {
                device: InputDeviceKind::Keyboard,
                labels: vec!["A".to_string()],
                state: HookKeyState::Down,
                physical_id: Some("windows:keyboard:scan:1:30:0".to_string()),
                vk_code: None,
                scan_code: None,
                flags: None,
                hold_duration_ms: None,
                input_ts_ms: Some(100.0),
            },
            &captured,
        );
        output.send(DaemonOutput::Command(DaemonCommand::ToggleOverlay));
        output.send(DaemonOutput::Axis(HidAxisMessage {
            axis_id: "axis".to_string(),
            value: 3,
            full: 16,
        }));
        drop(captured);
        drop(output);

        let bytes = receiver.recv_timeout(Duration::from_secs(1)).unwrap();
        let lines: Vec<serde_json::Value> = std::str::from_utf8(&bytes)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();

        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0]["kind"], "input");
        assert_eq!(lines[0]["revision"], "1");
        assert_eq!(lines[0]["message"]["labels"], serde_json::json!(["A"]));
        assert_eq!(
            lines[0]["message"]["physical_id"],
            "windows:keyboard:scan:1:30:0"
        );
        assert_eq!(lines[1]["type"], "toggle_overlay");
        assert_eq!(lines[2]["axis_id"], "axis");
    }

    #[test]
    fn watermark_does_not_split_outputs_from_one_capture() {
        let captured = InputCapture::now();
        let (sender, receiver) = mpsc::channel();
        let output = start_output_writer(Box::new(LineSink { sender })).unwrap();

        std::thread::sleep(super::SOURCE_WATERMARK_INTERVAL + Duration::from_millis(10));
        output.send_hook(hook_message("A"), &captured);
        output.send_hook(hook_message("B"), &captured);
        drop(captured);

        let lines = (0..3)
            .map(|_| {
                let line = receiver.recv_timeout(Duration::from_secs(1)).unwrap();
                serde_json::from_slice::<serde_json::Value>(&line).unwrap()
            })
            .collect::<Vec<_>>();
        drop(output);

        assert_eq!(lines[0]["kind"], "input");
        assert_eq!(lines[1]["kind"], "input");
        assert_eq!(lines[2]["kind"], "watermark");
        assert_eq!(lines[0]["source_time_us"], lines[1]["source_time_us"]);
        let input_time = lines[1]["source_time_us"]
            .as_str()
            .unwrap()
            .parse::<u64>()
            .unwrap();
        let watermark_time = lines[2]["source_time_us"]
            .as_str()
            .unwrap()
            .parse::<u64>()
            .unwrap();
        assert!(watermark_time > input_time);
    }

    #[test]
    fn writer_reset_starts_a_new_input_stream() {
        let (sender, receiver) = mpsc::channel();
        let output = start_output_writer(Box::new(DropSink {
            bytes: Vec::new(),
            sender: Some(sender),
        }))
        .unwrap();

        let first_capture = InputCapture::now();
        output.send_hook(hook_message("A"), &first_capture);
        drop(first_capture);
        output.send(DaemonOutput::ResetInputStream);
        let second_capture = InputCapture::now();
        output.send_hook(hook_message("B"), &second_capture);
        drop(second_capture);
        drop(output);

        let bytes = receiver.recv_timeout(Duration::from_secs(1)).unwrap();
        let lines = std::str::from_utf8(&bytes)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap())
            .collect::<Vec<_>>();

        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["revision"], "1");
        assert_eq!(lines[1]["revision"], "1");
        assert_ne!(lines[0]["stream_id"], lines[1]["stream_id"]);
    }

    #[test]
    fn sequencer_revision_and_time_are_monotonic() {
        let mut sequencer = DaemonInputSequencer::new();
        let captured = InputCapture::now();
        let input = sequencer.input(
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
            captured.source_time_us,
        );
        drop(captured);
        let watermark = sequencer.watermark();

        assert_eq!(input.kind, DaemonInputFrameKind::Input);
        assert_eq!(watermark.kind, DaemonInputFrameKind::Watermark);
        assert_eq!(input.stream_id, watermark.stream_id);
        assert_eq!(input.parsed_revision(), Some(1));
        assert_eq!(watermark.parsed_revision(), Some(2));
        assert!(watermark.parsed_source_time_us() > input.parsed_source_time_us());
    }

    #[test]
    fn input_capture_holds_source_sequencer_barrier() {
        let captured = InputCapture::now();

        assert!(super::SOURCE_SEQUENCER_BARRIER.try_lock().is_err());
        drop(captured);
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
        assert_eq!(base.opaque(), "windows:keyboard:scan:7:29:0".to_string());
        assert_eq!(
            extended.opaque(),
            "windows:keyboard:scan:7:29:1".to_string()
        );
        assert_eq!(fallback.opaque(), "windows:keyboard:vk:7:162".to_string());
    }

    #[test]
    fn windows_main_and_numpad_enter_and_mouse_have_distinct_opaque_ids() {
        let main_enter = WindowsPhysicalInputId::Keyboard(windows_keyboard_physical_id(
            1, 28, false, false, 0x0d,
        ));
        let numpad_enter = WindowsPhysicalInputId::Keyboard(windows_keyboard_physical_id(
            1, 28, true, false, 0x0d,
        ));
        let mouse = WindowsPhysicalInputId::MouseButton(1);

        assert_ne!(main_enter.opaque(), numpad_enter.opaque());
        assert_eq!(mouse.opaque(), "windows:mouse:button:1");
    }

    #[test]
    fn windows_physical_ids_include_device_handle() {
        assert_ne!(
            windows_keyboard_physical_id(1, 30, false, false, 0x41).opaque(),
            windows_keyboard_physical_id(2, 30, false, false, 0x41).opaque()
        );
        assert_ne!(
            windows_keyboard_physical_id(1, 30, false, false, 0x41),
            windows_keyboard_physical_id(2, 30, false, false, 0x41)
        );
        assert_ne!(
            windows_hid_physical_id(1, 9, 1).opaque(),
            windows_hid_physical_id(2, 9, 1).opaque()
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
        assert_eq!(
            windows_hid_physical_id(1, 9, 1).opaque(),
            "windows:hid:1:9:1"
        );
    }
}
