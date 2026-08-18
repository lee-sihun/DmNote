use std::{
    collections::{HashSet, VecDeque},
    io::{BufRead, BufReader},
    path::Path,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use anyhow::{anyhow, Context, Result};
use log::{error, warn};
use parking_lot::{Condvar, Mutex, RwLock};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Monitor, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_runtime_wry::wry::dpi::{LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize};
use tokio::sync::oneshot;

use super::{
    history::{
        HistoryAdmissionGate, HistoryAdmissionLease, HistoryBarrierLease, HistoryBarrierWaiter,
    },
    plugin::{PluginAuthorityLease, PluginRpcRouter, PluginRuntimeAuthority},
    store::AppStore,
};
#[cfg(debug_assertions)]
use crate::audio::KeySoundDispatchTrace;
use crate::errors::EditorCommitError;
use crate::{
    audio::{
        KeySoundEngine, KeySoundOutputBackend, KeySoundOutputDevices, KeySoundOutputState,
        KeySoundStatus,
    },
    keyboard::KeyboardManager,
    models::{
        overlay_resize_anchor_from_str, AppStoreData, BootstrapOverlayState, BootstrapPayload,
        DefaultsPayload, HistoryStatus, KeyCounterSettings, KeyCounters, KeyMappings, KeySlot,
        KeySoundOutputBackendPersist, OverlayBounds, OverlayResizeAnchor, PanelBounds,
        SettingsDiff, SettingsState, TabCssOverrides,
    },
    services::{css_watcher::CssWatcher, obs_bridge::ObsBridgeService, settings::SettingsService},
    state::local_asset_path::path_identity_key,
};

const OVERLAY_LABEL: &str = "overlay";
pub(crate) const PANEL_LABEL: &str = "panel";
const PANEL_ENTRYPOINT: &str = "panel/index.html";
const RAW_INPUT_WINDOW_LABELS: [&str; 3] = ["main", OVERLAY_LABEL, PANEL_LABEL];
const FRONTEND_LIFECYCLE_WINDOW_LABELS: [&str; 3] = ["main", OVERLAY_LABEL, PANEL_LABEL];
const TRAY_ICON_ID: &str = "background-tray";
const TRAY_MENU_SETTINGS_ID: &str = "tray-settings";
const TRAY_MENU_QUIT_ID: &str = "tray-quit";
const DEFAULT_OVERLAY_WIDTH: f64 = 860.0;
const DEFAULT_OVERLAY_HEIGHT: f64 = 320.0;
const MIN_OVERLAY_DIMENSION: f64 = 100.0;
// 넓은 배치에 트랙 높이를 크게 잡으면 이전 상한 2000에서 조용히 잘렸음
const MAX_OVERLAY_DIMENSION: f64 = 4096.0;

#[cfg(target_os = "macos")]
const OVERLAY_FRAME_APPLY_TIMEOUT_MS: u64 = 250;

fn clamp_overlay_dimension(value: f64) -> f64 {
    value
        .clamp(MIN_OVERLAY_DIMENSION, MAX_OVERLAY_DIMENSION)
        .round()
}

fn overlay_bounds_are_usable(bounds: &OverlayBounds) -> bool {
    bounds.x.is_finite()
        && bounds.y.is_finite()
        && bounds.width.is_finite()
        && bounds.height.is_finite()
        && bounds.width > 0.0
        && bounds.height > 0.0
}

/// 저장값이 있고 아직 환산되지 않았을 때만 모니터 정보가 필요하다.
/// 이 판단이 뒤집히면 physical 좌표가 환산 없이 쓰이므로 별도 술어로 고정한다
fn stored_bounds_need_monitor_data(
    bounds_are_logical: bool,
    stored: Option<&OverlayBounds>,
) -> bool {
    !bounds_are_logical && stored.is_some()
}

/// 저장된 사각형을 logical 좌표로 정규화한다.
/// 구버전 store는 physical px를 담고 있으므로(`overlay_bounds_are_logical == false`)
/// 환산 없이 쓰면 defer_overlay_bounds가 마커를 true로 굳혀 좌표가 영구 고착된다.
/// 환산에 실패하면 None - 호출부가 각자 안전한 대체 경로를 고른다
fn normalize_stored_overlay_bounds(
    stored: Option<&OverlayBounds>,
    bounds_are_logical: bool,
    monitors: &MonitorData,
) -> Option<OverlayBounds> {
    let usable = stored.filter(|bounds| overlay_bounds_are_usable(bounds))?;

    let normalized = if bounds_are_logical {
        usable.clone()
    } else {
        convert_physical_bounds_to_logical(usable, monitors)?
    };

    // 극단적으로 작은 scale로 나누면 inf로 넘칠 수 있어 결과도 재검증한다
    overlay_bounds_are_usable(&normalized).then_some(normalized)
}

/// 창이 없을 때 위치 초기화가 딛고 설 사각형.
/// 저장된 값을 쓰되, 없거나 깨졌거나 환산 불가면 기본 크기로 되돌린다
fn overlay_reset_fallback_rect(
    stored: Option<&OverlayBounds>,
    bounds_are_logical: bool,
    monitors: &MonitorData,
) -> (LogicalPosition<f64>, LogicalSize<f64>) {
    match normalize_stored_overlay_bounds(stored, bounds_are_logical, monitors) {
        Some(bounds) => (
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(
                clamp_overlay_dimension(bounds.width),
                clamp_overlay_dimension(bounds.height),
            ),
        ),
        None => (
            LogicalPosition::new(0.0, 0.0),
            LogicalSize::new(DEFAULT_OVERLAY_WIDTH, DEFAULT_OVERLAY_HEIGHT),
        ),
    }
}

const PANEL_WIDTH: f64 = 240.0;
// 피커가 트리거 행 아래에 그대로 들어갈 세로 여유 - 이보다 낮으면 팝업이
// 매번 위로 뒤집히거나 창 경계로 클램프됨. 늘리는 것만 허용
const PANEL_INITIAL_HEIGHT: f64 = 712.0;
const PANEL_MIN_HEIGHT: f64 = 712.0;
const PANEL_MAX_HEIGHT_RATIO: f64 = 0.9;
const PANEL_FALLBACK_MAX_HEIGHT: f64 = 10_000.0;
const PANEL_BOUNDS_DEBOUNCE_MS: u64 = 400;
const PANEL_CLOSE_ACK_TIMEOUT: Duration = Duration::from_millis(1_500);
const MAX_SELECTION_ELEMENTS: usize = 4_096;
const MAX_SELECTION_GROUP_IDS: usize = 4_096;
const MAX_SELECTION_ELEMENT_TYPE_BYTES: usize = 64;
const MAX_SELECTION_FULL_ID_BYTES: usize = 512;
const MAX_SELECTION_GROUP_ID_BYTES: usize = 512;
const MAX_SELECTION_MODE_BYTES: usize = 128;
const OVERLAY_MARGIN: f64 = 40.0;
const OVERLAY_BOUNDS_DEBOUNCE_MS: u64 = 400;
const OVERLAY_CREATION_LOCK_TIMEOUT: Duration = Duration::from_secs(10);
const EDITOR_FLUSH_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const SHUTDOWN_WATCHDOG_TIMEOUT: Duration = Duration::from_secs(5);
const SHUTDOWN_WATCHDOG_EXIT_CODE: i32 = 1;
const MAX_INPUT_EVENT_AGE_MS: f64 = 10_000.0;
const KEYBOARD_DAEMON_STABLE_RUNTIME: Duration = Duration::from_secs(30);
const KEYBOARD_RECOVERY_DELAYS_MS: [u64; 5] = [250, 500, 1_000, 2_000, 4_000];
pub(crate) const HISTORY_FRONTEND_FLUSH_BUSY: &str = "HISTORY_FRONTEND_FLUSH_BUSY";
pub(crate) const HISTORY_FRONTEND_FLUSH_CANCELED: &str = "HISTORY_FRONTEND_FLUSH_CANCELED";
pub(crate) const HISTORY_FRONTEND_FLUSH_EMIT_FAILED: &str = "HISTORY_FRONTEND_FLUSH_EMIT_FAILED";
pub(crate) const HISTORY_FRONTEND_FLUSH_INTERRUPTED: &str = "HISTORY_FRONTEND_FLUSH_INTERRUPTED";
pub(crate) const HISTORY_FRONTEND_FLUSH_TIMEOUT: &str = "HISTORY_FRONTEND_FLUSH_TIMEOUT";

struct ShutdownWatchdogState {
    armed: bool,
    stage: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct PanelBoundsSample {
    position: PhysicalPosition<i32>,
    position_scale_factor: f64,
    size: PhysicalSize<u32>,
    size_scale_factor: f64,
    current_scale_factor: f64,
}

#[derive(Debug, Clone, Copy)]
enum PanelBoundsChange {
    Snapshot(PanelBoundsSample),
    Moved(PhysicalPosition<i32>),
    Resized(PhysicalSize<u32>),
    ScaleFactorChanged {
        position: Option<PhysicalPosition<i32>>,
        size: PhysicalSize<u32>,
        scale_factor: f64,
    },
}

#[derive(Default)]
struct PanelBoundsPersistenceState {
    latest: Option<PanelBoundsSample>,
    window: Option<WebviewWindow>,
    applied_max_height: Option<f64>,
    session: u64,
    generation: u64,
    worker_running: bool,
    dirty: bool,
    active: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct PanelBoundsPersistWork {
    session: u64,
    generation: u64,
    sample: PanelBoundsSample,
}

struct PanelBoundsPersistenceController {
    store: Arc<AppStore>,
    state: Mutex<PanelBoundsPersistenceState>,
    persist_lock: Mutex<()>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum FrontendLifecycleAction {
    Quit,
    Restart,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum FrontendFlushAction {
    Quit,
    Restart,
    History,
}

impl From<FrontendLifecycleAction> for FrontendFlushAction {
    fn from(action: FrontendLifecycleAction) -> Self {
        match action {
            FrontendLifecycleAction::Quit => Self::Quit,
            FrontendLifecycleAction::Restart => Self::Restart,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EditorFlushRequest {
    handshake_id: String,
    action: FrontendFlushAction,
}

enum EditorFlushCompletion {
    Lifecycle(FrontendLifecycleAction),
    History {
        operation_id: String,
        sender: Option<oneshot::Sender<Result<FrontendHistoryFlushReady, String>>>,
        phase: FrontendHistoryFlushPhase,
        barrier: Option<HistoryBarrierLease>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FrontendHistoryFlushPhase {
    Collecting,
    Closing,
    Running,
}

impl EditorFlushCompletion {
    fn is_lifecycle(&self) -> bool {
        matches!(self, Self::Lifecycle(_))
    }

    fn is_history(&self) -> bool {
        matches!(self, Self::History { .. })
    }

    fn history_phase(&self) -> Option<FrontendHistoryFlushPhase> {
        match self {
            Self::History { phase, .. } => Some(*phase),
            Self::Lifecycle(_) => None,
        }
    }
}

pub(crate) struct FrontendHistoryFlushReady {
    barrier: Option<HistoryBarrierLease>,
    complete: Option<Box<dyn FnOnce() + Send>>,
}

impl FrontendHistoryFlushReady {
    pub(crate) fn take_barrier(&mut self) -> HistoryBarrierLease {
        self.barrier
            .take()
            .expect("history flush barrier can only be taken once")
    }
}

impl Drop for FrontendHistoryFlushReady {
    fn drop(&mut self) {
        drop(self.barrier.take());
        if let Some(complete) = self.complete.take() {
            complete();
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FrontendHistoryFlushReleased {
    handshake_id: String,
}

struct EditorFlushHandshake {
    id: String,
    completion: EditorFlushCompletion,
    target_windows: HashSet<String>,
    pending_windows: HashSet<String>,
}

fn take_editor_flush_handshake(
    slot: &mut Option<EditorFlushHandshake>,
    handshake_id: &str,
) -> Option<EditorFlushHandshake> {
    if slot
        .as_ref()
        .is_some_and(|active| active.id == handshake_id)
    {
        slot.take()
    } else {
        None
    }
}

fn take_cancelable_editor_flush_handshake(
    slot: &mut Option<EditorFlushHandshake>,
    handshake_id: &str,
) -> Option<EditorFlushHandshake> {
    if slot.as_ref().is_some_and(|active| {
        active.id == handshake_id
            && active.completion.history_phase() != Some(FrontendHistoryFlushPhase::Running)
    }) {
        slot.take()
    } else {
        None
    }
}

enum EditorFlushAcknowledge {
    LifecycleReady(EditorFlushHandshake),
    HistoryClosing {
        handshake_id: String,
        waiter: HistoryBarrierWaiter,
    },
    HistoryCloseFailed {
        handshake: EditorFlushHandshake,
        error: String,
    },
}

fn acknowledge_editor_flush_handshake(
    slot: &mut Option<EditorFlushHandshake>,
    handshake_id: &str,
    window_label: &str,
    history_gate: &Arc<HistoryAdmissionGate>,
) -> Option<EditorFlushAcknowledge> {
    {
        let active = slot.as_mut()?;
        if active.id != handshake_id || !active.pending_windows.remove(window_label) {
            return None;
        }
        if !active.pending_windows.is_empty() {
            return None;
        }
        if active.completion.is_lifecycle() {
            return slot.take().map(EditorFlushAcknowledge::LifecycleReady);
        }
    }
    begin_history_gate_close(slot, handshake_id, history_gate)
}

fn begin_history_gate_close(
    slot: &mut Option<EditorFlushHandshake>,
    handshake_id: &str,
    history_gate: &Arc<HistoryAdmissionGate>,
) -> Option<EditorFlushAcknowledge> {
    let operation_id = match slot.as_ref() {
        Some(EditorFlushHandshake {
            id,
            completion:
                EditorFlushCompletion::History {
                    operation_id,
                    phase: FrontendHistoryFlushPhase::Collecting,
                    ..
                },
            ..
        }) if id == handshake_id => operation_id.clone(),
        _ => return None,
    };
    match history_gate.begin_close(&operation_id) {
        Ok(next_barrier) => {
            let waiter = next_barrier.waiter();
            let active = slot
                .as_mut()
                .expect("history handshake disappeared while closing gate");
            let EditorFlushCompletion::History { phase, barrier, .. } = &mut active.completion
            else {
                unreachable!("history handshake changed while closing gate");
            };
            *phase = FrontendHistoryFlushPhase::Closing;
            *barrier = Some(next_barrier);
            Some(EditorFlushAcknowledge::HistoryClosing {
                handshake_id: handshake_id.to_string(),
                waiter,
            })
        }
        Err(error) => slot
            .take()
            .map(|handshake| EditorFlushAcknowledge::HistoryCloseFailed { handshake, error }),
    }
}

enum LifecycleHandshakeInstall {
    Installed,
    InterruptedHistory(Box<EditorFlushHandshake>),
    LifecycleAlreadyActive,
    DeferredUntilHistoryComplete,
}

fn install_lifecycle_handshake(
    slot: &mut Option<EditorFlushHandshake>,
    next: EditorFlushHandshake,
) -> LifecycleHandshakeInstall {
    if slot
        .as_ref()
        .is_some_and(|active| active.completion.is_lifecycle())
    {
        return LifecycleHandshakeInstall::LifecycleAlreadyActive;
    }
    if slot.as_ref().is_some_and(|active| {
        active.completion.history_phase() == Some(FrontendHistoryFlushPhase::Running)
    }) {
        return LifecycleHandshakeInstall::DeferredUntilHistoryComplete;
    }

    match slot.replace(next) {
        Some(interrupted) => LifecycleHandshakeInstall::InterruptedHistory(Box::new(interrupted)),
        None => LifecycleHandshakeInstall::Installed,
    }
}

fn install_history_handshake(
    slot: &mut Option<EditorFlushHandshake>,
    next: EditorFlushHandshake,
) -> bool {
    if slot.is_some() {
        return false;
    }
    *slot = Some(next);
    true
}

fn frontend_history_mutation_blocked(
    slot: &Option<EditorFlushHandshake>,
    window_label: &str,
) -> bool {
    slot.as_ref().is_some_and(|active| {
        active.completion.is_history() && !active.pending_windows.contains(window_label)
    })
}

fn emit_frontend_history_flush_released(
    app_handle: &AppHandle,
    handshake_id: &str,
    target_windows: &HashSet<String>,
) {
    let payload = FrontendHistoryFlushReleased {
        handshake_id: handshake_id.to_string(),
    };
    for label in target_windows {
        if let Err(error) = app_handle.emit_to(label, "app:history-flush-released", &payload) {
            log::warn!("failed to release history flush lock for {label}: {error}");
        }
    }
}

fn frontend_lifecycle_restore_labels(target_windows: &HashSet<String>) -> Vec<&'static str> {
    FRONTEND_LIFECYCLE_WINDOW_LABELS
        .into_iter()
        .filter(|label| target_windows.contains(*label))
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionSessionElement {
    pub element_type: String,
    pub full_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionSessionSnapshot {
    #[serde(default)]
    pub selected_elements: Vec<SelectionSessionElement>,
    #[serde(default)]
    pub selected_group_ids: Vec<String>,
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub selection_revision: u64,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PanelVisibilityPayload {
    visible: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<PanelVisibilityReason>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum PanelVisibilityReason {
    Closed,
    Destroyed,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PanelCloseRequestedPayload {
    request_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PanelViewState {
    pub mode: PanelViewMode,
    pub active_tab: PanelLayerTab,
    pub property_active_tab: PanelPropertyTab,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PanelViewMode {
    Layer,
    Property,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PanelLayerTab {
    Layer,
    Grid,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PanelPropertyTab {
    Style,
    Note,
    Counter,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PanelViewTarget {
    Main,
    Panel,
}

impl PanelViewTarget {
    fn matches_window(self, label: &str) -> bool {
        matches!(
            (self, label),
            (Self::Main, "main") | (Self::Panel, PANEL_LABEL)
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TargetedPanelViewState {
    target: PanelViewTarget,
    view_state: PanelViewState,
}

fn take_targeted_panel_view_state(
    slot: &mut Option<TargetedPanelViewState>,
    window_label: &str,
) -> Option<PanelViewState> {
    if slot
        .as_ref()
        .is_some_and(|pending| pending.target.matches_window(window_label))
    {
        slot.take().map(|pending| pending.view_state)
    } else {
        None
    }
}

fn clear_targeted_panel_view_state(
    slot: &mut Option<TargetedPanelViewState>,
    target: PanelViewTarget,
) {
    if slot
        .as_ref()
        .is_some_and(|pending| pending.target == target)
    {
        *slot = None;
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
enum PanelCloseRequestState {
    #[default]
    Idle,
    Pending(String),
    Closing,
}

trait PanelVisibilityEventEmitter {
    fn emit_panel_visibility(&self, payload: PanelVisibilityPayload) -> Result<()>;
}

impl PanelVisibilityEventEmitter for AppHandle {
    fn emit_panel_visibility(&self, payload: PanelVisibilityPayload) -> Result<()> {
        self.emit("panel:visibility", payload)?;
        Ok(())
    }
}

#[derive(Debug)]
struct QueuedCounterIncrement {
    mode: String,
    key: String,
}

#[derive(Debug, Default)]
struct CounterHistoryBarrierState {
    queueing: bool,
    active_increments: usize,
    queued: VecDeque<QueuedCounterIncrement>,
}

#[derive(Debug, Default)]
struct RuntimePublicationState {
    mappings_generation: u64,
    mode_generation: u64,
    counters_generation: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct KeyboardRecoveryPlan {
    attempt: usize,
    delay: Duration,
}

#[derive(Debug)]
pub(crate) struct AdmittedCounterMutation {
    pub(crate) counters: KeyCounters,
    pub(crate) history_status: Option<HistoryStatus>,
    _admission: HistoryAdmissionLease,
}

/// 카운터 write lock 내부 전용 이벤트 송신 경계
/// 동기 Rust listener에서 AppState 카운터 API 재진입 금지
pub(crate) trait KeyCounterEventEmitter {
    fn emit_key_counters(
        &self,
        counters: &KeyCounters,
        session_id: &str,
        revision: u64,
    ) -> Result<()>;
    fn emit_key_counter(
        &self,
        mode: &str,
        key: &str,
        count: u32,
        session_id: &str,
        revision: u64,
    ) -> Result<()>;
}

impl KeyCounterEventEmitter for AppHandle {
    fn emit_key_counters(
        &self,
        counters: &KeyCounters,
        session_id: &str,
        revision: u64,
    ) -> Result<()> {
        self.emit("keys:counters", counters)?;
        self.emit(
            "keys:counters-state",
            &json!({
                "sessionId": session_id,
                "revision": revision,
                "counters": counters,
            }),
        )?;
        Ok(())
    }

    fn emit_key_counter(
        &self,
        mode: &str,
        key: &str,
        count: u32,
        session_id: &str,
        revision: u64,
    ) -> Result<()> {
        self.emit(
            "keys:counter",
            &json!({
                "mode": mode,
                "key": key,
                "count": count,
                "sessionId": session_id,
                "revision": revision,
            }),
        )?;
        Ok(())
    }
}

fn should_create_overlay_on_startup(obs_mode_enabled: bool, overlay_visible: bool) -> bool {
    !obs_mode_enabled && overlay_visible
}

// 트레이 시작(main_window_hidden)에서는 복원 보류 - 숨은 메인 창 의존 방지(background throttling)
// 플래그는 유지되므로 다음 정상 기동 때 복원됨
fn should_restore_panel_on_startup(
    obs_mode_enabled: bool,
    main_window_hidden: bool,
    panel_detached: bool,
) -> bool {
    panel_detached && !obs_mode_enabled && !main_window_hidden
}

fn bootstrap_keyboard_state(keyboard: &KeyboardManager) -> (String, Vec<String>) {
    keyboard.current_mode_and_pressed_keys()
}

fn unix_epoch_ms() -> Option<f64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs_f64() * 1000.0)
}

fn resolve_event_age_ms(
    input_ts_ms: Option<f64>,
    now_wall_ms: Option<f64>,
    fallback_age_ms: f64,
) -> f64 {
    let Some(event_age_ms) = input_ts_ms
        .zip(now_wall_ms)
        .map(|(input_ts_ms, now_wall_ms)| now_wall_ms - input_ts_ms)
    else {
        return fallback_age_ms;
    };
    if event_age_ms.is_finite() && (0.0..=MAX_INPUT_EVENT_AGE_MS).contains(&event_age_ms) {
        event_age_ms
    } else {
        fallback_age_ms
    }
}

fn next_keyboard_recovery_plan(
    current_attempt: usize,
    daemon_uptime: Duration,
) -> Option<KeyboardRecoveryPlan> {
    let attempt = if daemon_uptime >= KEYBOARD_DAEMON_STABLE_RUNTIME {
        1
    } else {
        current_attempt.saturating_add(1)
    };
    let delay_ms = *KEYBOARD_RECOVERY_DELAYS_MS.get(attempt.checked_sub(1)?)?;
    Some(KeyboardRecoveryPlan {
        attempt,
        delay: Duration::from_millis(delay_ms),
    })
}

fn should_recover_keyboard_daemon(
    shutdown_started: bool,
    current_generation: u64,
    task_generation: Option<u64>,
    failed_generation: u64,
) -> bool {
    !shutdown_started
        && current_generation == failed_generation
        && task_generation == Some(failed_generation)
}

fn key_state_payload(
    key: &str,
    state: &str,
    mode: &str,
    event_age_ms: f64,
    is_down: bool,
    hold_duration_ms: Option<f64>,
) -> serde_json::Value {
    let mut payload =
        json!({ "key": key, "state": state, "mode": mode, "eventAgeMs": event_age_ms });
    if !is_down {
        if let Some(hold_duration_ms) = hold_duration_ms {
            payload["holdDurationMs"] = json!(hold_duration_ms);
        }
    }
    payload
}

fn canonical_hold_duration_ms(
    can_use_physical_hold_duration: bool,
    physical_hold_duration_ms: Option<f64>,
) -> Option<f64> {
    if can_use_physical_hold_duration {
        physical_hold_duration_ms
    } else {
        None
    }
}

fn collect_frontend_lifecycle_targets<T>(
    mut resolve: impl FnMut(&str) -> Option<T>,
) -> Vec<(String, T)> {
    FRONTEND_LIFECYCLE_WINDOW_LABELS
        .into_iter()
        .filter_map(|label| resolve(label).map(|target| (label.to_string(), target)))
        .collect()
}

fn validate_selection_session(snapshot: &SelectionSessionSnapshot) -> Result<(), String> {
    if snapshot.selected_elements.len() > MAX_SELECTION_ELEMENTS {
        return Err(format!(
            "selectedElements exceeds the {MAX_SELECTION_ELEMENTS} item limit"
        ));
    }
    if snapshot.selected_group_ids.len() > MAX_SELECTION_GROUP_IDS {
        return Err(format!(
            "selectedGroupIds exceeds the {MAX_SELECTION_GROUP_IDS} item limit"
        ));
    }
    if snapshot.mode.len() > MAX_SELECTION_MODE_BYTES {
        return Err(format!(
            "mode exceeds the {MAX_SELECTION_MODE_BYTES} byte limit"
        ));
    }
    let mut seen_element_ids = HashSet::new();
    for (index, element) in snapshot.selected_elements.iter().enumerate() {
        if element.element_type.len() > MAX_SELECTION_ELEMENT_TYPE_BYTES
            || !matches!(
                element.element_type.as_str(),
                "key" | "stat" | "graph" | "knob" | "plugin"
            )
        {
            return Err(format!("selectedElements[{index}].elementType is invalid"));
        }
        if element.full_id.is_empty()
            || element.full_id.len() > MAX_SELECTION_FULL_ID_BYTES
            || (element.element_type != "plugin"
                && !crate::state::native_element_id::is_valid_element_id(&element.full_id))
        {
            return Err(format!("selectedElements[{index}].fullId is invalid"));
        }
        if !seen_element_ids.insert(element.full_id.as_str()) {
            return Err(format!("selectedElements[{index}].fullId is duplicated"));
        }
    }
    let mut seen_group_ids = HashSet::new();
    for (index, group_id) in snapshot.selected_group_ids.iter().enumerate() {
        if group_id.is_empty()
            || group_id.len() > MAX_SELECTION_GROUP_ID_BYTES
            || !seen_group_ids.insert(group_id.as_str())
        {
            return Err(format!("selectedGroupIds[{index}] is invalid"));
        }
    }
    Ok(())
}

fn publish_selection_snapshot(
    session: &Mutex<SelectionSessionSnapshot>,
    mut snapshot: SelectionSessionSnapshot,
) -> Result<SelectionSessionSnapshot, String> {
    validate_selection_session(&snapshot)?;
    let mut current = session.lock();
    snapshot.selection_revision = current
        .selection_revision
        .checked_add(1)
        .ok_or_else(|| "selection revision overflow".to_string())?;
    *current = snapshot.clone();
    Ok(snapshot)
}

fn publish_panel_visibility_transition(
    visible_state: &AtomicBool,
    emitter: &dyn PanelVisibilityEventEmitter,
    visible: bool,
    reason: Option<PanelVisibilityReason>,
) -> Result<()> {
    let previous = visible_state.swap(visible, Ordering::SeqCst);
    if previous == visible {
        return Ok(());
    }
    let payload = PanelVisibilityPayload {
        visible,
        reason: if visible { None } else { reason },
    };
    if let Err(error) = emitter.emit_panel_visibility(payload) {
        let _ =
            visible_state.compare_exchange(visible, previous, Ordering::SeqCst, Ordering::SeqCst);
        return Err(error);
    }
    Ok(())
}

fn publish_panel_hidden_transition(
    visible_state: &AtomicBool,
    reason_state: &Mutex<Option<PanelVisibilityReason>>,
    emitter: &dyn PanelVisibilityEventEmitter,
    fallback_reason: PanelVisibilityReason,
) -> Result<()> {
    let reason = reason_state.lock().take().unwrap_or(fallback_reason);
    if let Err(error) =
        publish_panel_visibility_transition(visible_state, emitter, false, Some(reason))
    {
        let mut pending = reason_state.lock();
        if pending.is_none() {
            *pending = Some(reason);
        }
        return Err(error);
    }
    Ok(())
}

fn begin_panel_close_request(state: &Mutex<PanelCloseRequestState>, request_id: &str) -> bool {
    let mut current = state.lock();
    if *current != PanelCloseRequestState::Idle {
        return false;
    }
    *current = PanelCloseRequestState::Pending(request_id.to_string());
    true
}

fn acknowledge_panel_close_request(
    state: &Mutex<PanelCloseRequestState>,
    request_id: &str,
) -> bool {
    let mut current = state.lock();
    if !matches!(&*current, PanelCloseRequestState::Pending(active) if active == request_id) {
        return false;
    }
    *current = PanelCloseRequestState::Idle;
    true
}

fn claim_panel_close_timeout(state: &Mutex<PanelCloseRequestState>, request_id: &str) -> bool {
    let mut current = state.lock();
    if !matches!(&*current, PanelCloseRequestState::Pending(active) if active == request_id) {
        return false;
    }
    *current = PanelCloseRequestState::Closing;
    true
}

fn finish_panel_close(state: &Mutex<PanelCloseRequestState>) {
    *state.lock() = PanelCloseRequestState::Idle;
}

fn run_panel_close_timeout(
    state: &Mutex<PanelCloseRequestState>,
    request_id: &str,
    fallback: impl FnOnce() -> Result<()>,
) -> Result<bool> {
    if !claim_panel_close_timeout(state, request_id) {
        return Ok(false);
    }
    let result = fallback();
    finish_panel_close(state);
    result.map(|()| true)
}

pub struct AppState {
    pub store: Arc<AppStore>,
    pub settings: SettingsService,
    pub keyboard: KeyboardManager,
    overlay_visible: Arc<RwLock<bool>>,
    overlay_force_close: Arc<AtomicBool>,
    /// 오버레이 윈도우 초기화 중 Moved/Resized 이벤트에서 bounds 저장 억제
    overlay_initializing: Arc<AtomicBool>,
    /// 오버레이 생성·가시성 전환 single-flight 가드
    /// 메인 스레드 이벤트 콜백에서 획득 금지 — setup 훅은 이벤트 루프 가동 전이라 예외
    overlay_creation_lock: Mutex<()>,
    overlay_bounds_generation: Arc<AtomicU64>,
    selection_session: Mutex<SelectionSessionSnapshot>,
    plugin_authority: PluginRuntimeAuthority,
    plugin_rpc_router: PluginRpcRouter,
    panel_bounds_persistence: Arc<PanelBoundsPersistenceController>,
    panel_visible: AtomicBool,
    panel_creation_lock: Mutex<()>,
    panel_close_request: Mutex<PanelCloseRequestState>,
    panel_destroy_reason: Mutex<Option<PanelVisibilityReason>>,
    panel_view_state: Mutex<Option<TargetedPanelViewState>>,
    keyboard_task: RwLock<Option<KeyboardDaemonTask>>,
    keyboard_task_generation: AtomicU64,
    key_counters: Arc<RwLock<KeyCounters>>,
    key_counters_session_id: String,
    key_counters_revision: AtomicU64,
    counter_history_barrier: Mutex<CounterHistoryBarrierState>,
    counter_history_ready: Condvar,
    runtime_publication: Mutex<RuntimePublicationState>,
    key_counter_enabled: Arc<AtomicBool>,
    /// Raw input stream subscriber count - emit only when > 0
    raw_input_subscribers: Arc<std::sync::atomic::AtomicU32>,
    key_sound: Arc<KeySoundEngine>,
    /// 전역 CSS 상태와 워처 전환 직렬화
    css_operation_lock: Mutex<()>,
    /// 현재 세션에서 사용자가 승인한 CSS 경로
    authorized_css_paths: RwLock<HashSet<String>>,
    /// CSS 파일 핫리로딩 워처
    css_watcher: RwLock<Option<CssWatcher>>,
    /// OBS WebSocket 브릿지
    pub obs_bridge: Arc<ObsBridgeService>,
    /// OBS 모드 시작 전 오버레이 가시성 상태 (복원용)
    obs_previous_overlay_visible: Arc<RwLock<Option<bool>>>,
    shutdown_started: AtomicBool,
    process_exit_authorized: AtomicBool,
    shutdown_watchdog: Arc<Mutex<ShutdownWatchdogState>>,
    editor_flush_handshake: Arc<Mutex<Option<EditorFlushHandshake>>>,
    deferred_frontend_lifecycle: Mutex<Option<FrontendLifecycleAction>>,
}

impl AppState {
    pub fn initialize(store: AppStore) -> Result<Self> {
        if let Err(err) = store.recover_interrupted_processed_wav_replacements_now() {
            log::warn!("failed to recover interrupted processed WAVs during startup: {err}");
        }
        let store = Arc::new(store);
        let snapshot = store.snapshot();
        let keyboard =
            KeyboardManager::new(snapshot.keys.clone(), snapshot.selected_key_type.clone());
        let settings = SettingsService::new(store.clone());

        let mut initial_key_counters = snapshot.key_counters.clone();
        Self::sync_counters_with_keys_impl(&mut initial_key_counters, &snapshot.keys);
        let key_counters = Arc::new(RwLock::new(initial_key_counters));
        let key_counter_enabled = Arc::new(AtomicBool::new(snapshot.key_counter_enabled));
        // 저장된 출력 백엔드로 엔진을 처음부터 초기화 → "기본 장치 → ASIO" 전환 깜빡임 제거.
        let initial_backend = snapshot
            .key_sound_output_backend
            .clone()
            .map(output_backend_from_persist)
            .unwrap_or_default();
        let key_sound = Arc::new(KeySoundEngine::with_output_backend(initial_backend));
        let obs_bridge = Arc::new(ObsBridgeService::new(env!("CARGO_PKG_VERSION")));
        let authorized_css_paths = collect_authorized_css_paths(&snapshot);
        let panel_bounds_persistence =
            Arc::new(PanelBoundsPersistenceController::new(Arc::clone(&store)));
        let selection_session = SelectionSessionSnapshot {
            mode: snapshot.selected_key_type.clone(),
            ..SelectionSessionSnapshot::default()
        };

        Ok(Self {
            store,
            settings,
            keyboard,
            overlay_visible: Arc::new(RwLock::new(false)),
            overlay_force_close: Arc::new(AtomicBool::new(false)),
            overlay_initializing: Arc::new(AtomicBool::new(false)),
            overlay_creation_lock: Mutex::new(()),
            overlay_bounds_generation: Arc::new(AtomicU64::new(0)),
            selection_session: Mutex::new(selection_session),
            plugin_authority: PluginRuntimeAuthority::default(),
            plugin_rpc_router: PluginRpcRouter::default(),
            panel_bounds_persistence,
            panel_visible: AtomicBool::new(false),
            panel_creation_lock: Mutex::new(()),
            panel_close_request: Mutex::new(PanelCloseRequestState::Idle),
            panel_destroy_reason: Mutex::new(None),
            panel_view_state: Mutex::new(None),
            keyboard_task: RwLock::new(None),
            keyboard_task_generation: AtomicU64::new(0),
            key_counters,
            key_counters_session_id: uuid::Uuid::new_v4().simple().to_string(),
            key_counters_revision: AtomicU64::new(0),
            counter_history_barrier: Mutex::new(CounterHistoryBarrierState::default()),
            counter_history_ready: Condvar::new(),
            runtime_publication: Mutex::new(RuntimePublicationState::default()),
            key_counter_enabled,
            raw_input_subscribers: Arc::new(std::sync::atomic::AtomicU32::new(0)),
            key_sound,
            css_operation_lock: Mutex::new(()),
            authorized_css_paths: RwLock::new(authorized_css_paths),
            css_watcher: RwLock::new(None),
            obs_bridge,
            obs_previous_overlay_visible: Arc::new(RwLock::new(None)),
            shutdown_started: AtomicBool::new(false),
            process_exit_authorized: AtomicBool::new(false),
            shutdown_watchdog: Arc::new(Mutex::new(ShutdownWatchdogState {
                armed: false,
                stage: "shutdown initialization",
            })),
            editor_flush_handshake: Arc::new(Mutex::new(None)),
            deferred_frontend_lifecycle: Mutex::new(None),
        })
    }

    pub fn initialize_runtime(&self, app: &AppHandle) -> Result<()> {
        self.attach_main_window_handlers(app);
        let snapshot = self.store.snapshot();
        if should_create_overlay_on_startup(snapshot.obs_mode_enabled, snapshot.overlay_visible) {
            self.ensure_overlay_window(app)?;
        }
        if should_restore_panel_on_startup(
            snapshot.obs_mode_enabled,
            snapshot.main_window_hidden,
            snapshot.panel_detached,
        ) {
            if let Err(err) = self.restore_panel_window_on_startup(app) {
                log::warn!("failed to restore detached panel window: {err}");
            }
        }
        // 개발자 모드가 켜져 있으면 시작 시 DevTools 오픈 허용 및 자동 오픈 시도
        if snapshot.developer_mode_enabled {
            if let Some(main) = app.get_webview_window("main") {
                main.open_devtools();
            }
            if let Some(overlay) = app.get_webview_window("overlay") {
                overlay.open_devtools();
            }
            if let Some(panel) = app.get_webview_window(PANEL_LABEL) {
                panel.open_devtools();
            }
        }
        self.start_keyboard_hook(app.clone())?;
        // CSS 핫리로딩 워처 초기화
        self.initialize_css_watcher(app);
        // OBS 모드 자동 복원
        if snapshot.obs_mode_enabled {
            self.auto_start_obs(app);
        }
        Ok(())
    }

    fn attach_main_window_handlers(&self, app: &AppHandle) {
        let overlay_force_close = self.overlay_force_close.clone();
        if let Some(window) = app.get_webview_window("main") {
            attach_main_window_close_handler(window, overlay_force_close, app.clone());
            return;
        }

        let overlay_force_close = overlay_force_close.clone();
        let app_handle = app.clone();
        thread::spawn(move || {
            for _ in 0..15 {
                if let Some(window) = app_handle.get_webview_window("main") {
                    attach_main_window_close_handler(
                        window,
                        overlay_force_close.clone(),
                        app_handle.clone(),
                    );
                    break;
                }
                thread::sleep(Duration::from_millis(25));
            }
        });
    }

    pub fn show_main_window(&self, app: &AppHandle) -> Result<()> {
        let app_handle = app.clone();
        app.run_on_main_thread(move || {
            let state = app_handle.state::<AppState>();
            if let Err(err) = state.show_main_window_inner(&app_handle) {
                log::warn!("failed to show main window: {err}");
            }
        })?;
        Ok(())
    }

    fn show_main_window_inner(&self, app: &AppHandle) -> Result<()> {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.unminimize();
            main.show()?;
            let _ = main.set_focus();
        }

        remove_tray_icon(app);
        self.set_main_window_hidden(false)?;
        Ok(())
    }

    pub fn ensure_tray_icon_for_background(&self, app: &AppHandle) -> Result<()> {
        if app.tray_by_id(TRAY_ICON_ID).is_some() {
            return Ok(());
        }

        let snapshot = self.store.snapshot();
        let (settings_label, quit_label) = tray_menu_labels(&snapshot.language);

        let settings_item = MenuItem::with_id(
            app,
            TRAY_MENU_SETTINGS_ID,
            settings_label,
            true,
            None::<&str>,
        )?;
        let quit_item = MenuItem::with_id(app, TRAY_MENU_QUIT_ID, quit_label, true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&settings_item, &quit_item])?;
        let mut tray_builder = TrayIconBuilder::with_id(TRAY_ICON_ID)
            .menu(&menu)
            .show_menu_on_left_click(false);
        if let Some(icon) = app.default_window_icon().cloned() {
            tray_builder = tray_builder.icon(icon);
        }

        tray_builder
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    let state = tray.app_handle().state::<AppState>();
                    if let Err(err) = state.show_main_window(tray.app_handle()) {
                        log::error!("failed to show main window from tray click: {err}");
                    }
                }
            })
            .on_menu_event(move |app_handle, event| {
                if event.id() == TRAY_MENU_SETTINGS_ID {
                    let state = app_handle.state::<AppState>();
                    if let Err(err) = state.show_main_window(app_handle) {
                        log::error!("failed to show main window from tray: {err}");
                    }
                    return;
                }

                if event.id() == TRAY_MENU_QUIT_ID {
                    app_handle
                        .state::<AppState>()
                        .request_frontend_shutdown(app_handle.clone());
                }
            })
            .build(app)?;

        Ok(())
    }

    pub fn set_main_window_hidden(&self, hidden: bool) -> Result<()> {
        // 값이 그대로면 저장 생략 — 기동마다 전체 store 재기록(fsync) 방지
        if self
            .store
            .with_state(|state| state.main_window_hidden == hidden)
        {
            return Ok(());
        }
        let _ = self.store.update(|state| {
            state.main_window_hidden = hidden;
        })?;
        Ok(())
    }

    pub fn bootstrap_payload(&self) -> BootstrapPayload {
        let state = self.store.snapshot();
        let (current_mode, active_keys) = bootstrap_keyboard_state(&self.keyboard);
        let (key_counters, key_counters_revision) = {
            let counters = self.key_counters.read();
            (
                counters.clone(),
                self.key_counters_revision.load(Ordering::Relaxed),
            )
        };
        BootstrapPayload {
            defaults: DefaultsPayload {
                settings: SettingsState::default(),
                counter_settings: KeyCounterSettings::default(),
            },
            settings: state.settings_state(),
            keys: state.keys.clone(),
            positions: state.key_positions.clone(),
            stat_positions: state.stat_positions.clone(),
            graph_positions: state.graph_positions.clone(),
            knob_positions: state.knob_positions.clone(),
            custom_tabs: state.custom_tabs.clone(),
            selected_key_type: state.selected_key_type.clone(),
            current_mode,
            active_keys,
            overlay: BootstrapOverlayState {
                visible: *self.overlay_visible.read(),
                locked: state.overlay_locked,
                anchor: state.overlay_resize_anchor.as_str().to_string(),
            },
            key_counters,
            key_counters_session_id: self.key_counters_session_id.clone(),
            key_counters_revision,
            layer_groups: state.layer_groups.clone(),
            tab_note_overrides: state.tab_note_overrides.clone(),
            tab_css_overrides: state.tab_css_overrides.clone(),
            editor_revision: state.editor_revision,
        }
    }

    pub fn overlay_status(&self) -> BootstrapOverlayState {
        let state = self.store.snapshot();
        BootstrapOverlayState {
            visible: *self.overlay_visible.read(),
            locked: state.overlay_locked,
            anchor: state.overlay_resize_anchor.as_str().to_string(),
        }
    }

    pub fn emit_settings_changed(&self, diff: &SettingsDiff, app: &AppHandle) -> Result<()> {
        log::debug!(
            "[IPC] emit_settings_changed: {} fields changed",
            diff.changed_count()
        );
        self.apply_settings_effects(diff, app)?;
        if let Some(value) = diff.changed.key_counter_enabled {
            self.key_counter_enabled.store(value, Ordering::SeqCst);
        }
        // OBS 브릿지 캐시 갱신 (이벤트는 register_event_forwarding이 자동 포워딩)
        if self.obs_bridge.is_running() {
            let bp = self.bootstrap_payload();
            if let Ok(snap) = serde_json::to_value(&bp) {
                self.obs_bridge.update_snapshot(snap);
            }
        }
        // 전체 설정 페이로드 전송 방지 (임베디드 폰트 등 대용량 데이터 제외)
        let mut payload = diff.clone();
        payload.full = None;
        app.emit("settings:changed", payload)?;
        Ok(())
    }

    /// 저장된 토큰 재사용 또는 신규 생성 후 store에 저장
    /// 기존 토큰은 commit-after-persist로 디스크 저장이 보장되므로 재저장 생략
    pub fn resolve_and_save_obs_token(&self) -> Result<String> {
        if let Some(token) = self
            .store
            .with_state(|s| s.obs_token.clone())
            .filter(|token| !token.is_empty())
        {
            return Ok(token);
        }

        let token = uuid::Uuid::new_v4().simple().to_string();
        let t = token.clone();
        self.store.update(|s| {
            s.obs_token = Some(t.clone());
        })?;
        Ok(token)
    }

    /// 부팅 시 OBS 모드 자동 시작 (obs_mode_enabled=true일 때)
    fn auto_start_obs(&self, app: &AppHandle) {
        let bridge = self.obs_bridge.clone();
        let store = self.store.clone();
        let port = store.with_state(|s| s.obs_port);

        // 부팅 시에는 오버레이를 생성하지 않았으므로 이전 표시 상태만 저장
        // (initialize_runtime에서 obs_mode_enabled일 때 ensure_overlay_window 건너뜀)
        let was_visible = store.with_state(|s| s.overlay_visible);
        *self.obs_previous_overlay_visible.write() = Some(was_visible);

        // 저장 안 된 토큰으로 서버를 켜면 재부팅 후 기존 URL이 무효화되므로 시작 중단
        let token = match self.resolve_and_save_obs_token() {
            Ok(token) => token,
            Err(e) => {
                log::error!(
                    "[ObsBridge] auto-start 중단: 토큰 저장 실패 ({}) — obs_mode_enabled를 false로 복구",
                    e
                );
                let _ = store.update(|s| {
                    s.obs_mode_enabled = false;
                });
                self.obs_restore_overlay(app);
                let _ = app.emit("obs:status", &self.obs_bridge.status());
                return;
            }
        };
        let app_handle = app.clone();

        // dev 모드: Vite dev server로 리다이렉트
        if cfg!(debug_assertions) {
            let dev_url = "http://localhost:3400".to_string();
            log::info!("[ObsBridge] dev 모드: Vite dev server로 리다이렉트 ({dev_url})");
            bridge.set_dev_url(dev_url);
        } else {
            // 프로덕션: Tauri 임베딩 에셋으로 서빙
            let handle = app_handle.clone();
            let fetcher = std::sync::Arc::new(move |path: &str| {
                let resolver = handle.asset_resolver();
                resolver.get(path.into()).map(|asset| {
                    let mime = asset.mime_type.clone();
                    (asset.bytes.to_vec(), mime)
                })
            });
            bridge.set_asset_fetcher(fetcher);
        }

        // AppHandle 전달 (invoke_request 디스패치용)
        bridge.set_app_handle(app.clone());
        // Tauri 이벤트 → OBS WS 포워딩 리스너 등록
        bridge.register_event_forwarding(app);

        // async start를 tokio 런타임에서 실행
        tauri::async_runtime::spawn(async move {
            match bridge.start(port, token).await {
                Ok(actual_port) => {
                    log::info!("[ObsBridge] auto-start 성공 (port={})", actual_port);
                    // fallback 포트가 사용된 경우 store에 저장
                    if actual_port != port {
                        let _ = store.update(|s| {
                            s.obs_port = actual_port;
                        });
                    }
                    let state = app_handle.state::<AppState>();
                    // 초기 스냅샷 캐싱 (신규 클라이언트에 전송됨)
                    state.refresh_obs_snapshot();
                    let _ = app_handle.emit("obs:status", &state.obs_bridge.status());
                }
                Err(e) => {
                    log::error!(
                        "[ObsBridge] auto-start 실패: {} — obs_mode_enabled를 false로 복구",
                        e
                    );
                    let _ = store.update(|state| {
                        state.obs_mode_enabled = false;
                    });
                    // 실패 시 오버레이 복원 (윈도우 재생성 포함)
                    let state = app_handle.state::<AppState>();
                    state.obs_restore_overlay(&app_handle);
                    let _ = app_handle.emit("obs:status", &state.obs_bridge.status());
                }
            }
        });
    }

    /// OBS 시작 시 오버레이 윈도우 destroy (이전 상태 보존)
    pub fn obs_hide_overlay(&self, app: &AppHandle) {
        let was_visible = *self.overlay_visible.read();
        *self.obs_previous_overlay_visible.write() = Some(was_visible);
        // destroy()는 CloseRequested 이벤트 없이 즉시 윈도우를 파괴
        if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
            if let Err(e) = window.destroy() {
                log::warn!("[ObsBridge] 오버레이 destroy 실패: {}", e);
                // destroy 실패 시 hide로 fallback
                if was_visible {
                    if let Err(e) = self.set_overlay_visibility(app, false) {
                        log::warn!("[ObsBridge] 오버레이 hide fallback 실패: {}", e);
                    }
                }
                return;
            }
        }
        // destroy 성공(또는 윈도우 부재) 후 런타임 플래그만 갱신
        // store.overlay_visible은 변경하지 않음 — ensure_overlay_window가 재생성 시
        // 이 값을 기준으로 show/hide를 결정하므로, 원래 값을 유지해야 함
        *self.overlay_visible.write() = false;
        let _ = app.emit("overlay:visibility", &json!({ "visible": false }));
    }

    /// OBS 중지 시 오버레이 재생성 + 복원
    pub fn obs_restore_overlay(&self, app: &AppHandle) {
        let prev = self.obs_previous_overlay_visible.write().take();
        match prev {
            Some(true) => {
                // set_overlay_visibility(true) 내부에서 ensure_overlay_window + show + store 갱신 + emit 처리
                if let Err(e) = self.set_overlay_visibility(app, true) {
                    log::warn!("[ObsBridge] 오버레이 복원 실패: {}", e);
                }
            }
            Some(false) => {
                // 이전 상태가 hidden이었더라도 윈도우는 재생성 필요
                // (이후 sync 커맨드에서 WebView2 빌드 시 메시지 루프 블로킹 방지)
                if let Err(e) = self.ensure_overlay_window(app) {
                    log::warn!("[ObsBridge] 오버레이 윈도우 재생성 실패: {}", e);
                }
            }
            None => {}
        }
    }

    /// OBS 모드 활성화 여부
    pub fn is_obs_mode_active(&self) -> bool {
        self.obs_bridge.is_running()
    }

    /// OBS 브릿지용 전체 스냅샷 빌드 + 캐시 갱신 + 연결된 클라이언트에 broadcast
    pub fn refresh_obs_snapshot(&self) {
        if !self.obs_bridge.is_running() {
            return;
        }
        let payload = self.bootstrap_payload();
        if let Ok(snapshot) = serde_json::to_value(&payload) {
            self.obs_bridge.update_snapshot(snapshot);
            self.obs_bridge.broadcast_snapshot();
        }
    }

    /// OBS 브릿지 캐시 스냅샷 갱신 (이벤트는 register_event_forwarding이 자동 포워딩)
    /// CSS 등 개별 설정 변경이 OBS 런타임 상태(키 시그널, KPS)를 리셋하지 않도록 사용
    pub fn notify_obs_settings_diff(&self, _diff: serde_json::Value) {
        if !self.obs_bridge.is_running() {
            return;
        }
        let bp = self.bootstrap_payload();
        if let Ok(snap) = serde_json::to_value(&bp) {
            self.obs_bridge.update_snapshot(snap);
        }
    }

    /// OBS 브릿지 캐시 스냅샷 갱신 (카운터 이벤트는 register_event_forwarding이 자동 포워딩)
    pub fn obs_broadcast_counters(&self) {
        if !self.obs_bridge.is_running() {
            return;
        }
        let bp = self.bootstrap_payload();
        if let Ok(snap) = serde_json::to_value(&bp) {
            self.obs_bridge.update_snapshot(snap);
        }
    }

    pub fn set_overlay_visibility(&self, app: &AppHandle, visible: bool) -> Result<()> {
        log::debug!("[IPC] set_overlay_visibility: visible={}", visible);
        let _transition_guard = self
            .overlay_creation_lock
            .try_lock_for(OVERLAY_CREATION_LOCK_TIMEOUT)
            .ok_or_else(|| {
                anyhow!(
                    "timed out after {} seconds waiting for overlay creation lock",
                    OVERLAY_CREATION_LOCK_TIMEOUT.as_secs()
                )
            })?;

        if !visible {
            flush_deferred_overlay_bounds(&self.store, &self.overlay_bounds_generation)?;
        }

        if visible {
            // 오버레이를 열 때: 창이 없으면 생성하고 표시
            let window = self.ensure_overlay_window_while_locked(app)?;
            let snapshot = self.store.snapshot();
            show_overlay_window(&window, snapshot.always_on_top)?;

            // 오버레이가 숨겨진 동안 변경된 설정을 다시 적용
            window.set_ignore_cursor_events(snapshot.overlay_locked)?;
            window.set_always_on_top(snapshot.always_on_top)?;
            #[cfg(target_os = "macos")]
            apply_macos_overlay_fullscreen_behavior(&window, snapshot.always_on_top);
        } else {
            // 오버레이를 숨길 때: 창이 존재하는 경우에만 숨김
            // 창 미존재 시 무시 (창 생성하지 않음)
            if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
                hide_overlay_window(&window)?;
            }
        }

        // 창 조작 성공 후에만 영속. 저장 실패면 창 조작을 보상해 전 계층을 이전 상태로 복원
        if let Err(persist_err) = self.store.update(|state| {
            state.overlay_visible = visible;
        }) {
            let compensation = if visible {
                app.get_webview_window(OVERLAY_LABEL)
                    .map_or(Ok(()), |window| hide_overlay_window(&window))
            } else {
                match app.get_webview_window(OVERLAY_LABEL) {
                    Some(window) => {
                        let snapshot = self.store.snapshot();
                        show_overlay_window(&window, snapshot.always_on_top)
                    }
                    None => Ok(()),
                }
            };
            if let Err(comp_err) = compensation {
                // 보상 실패 — 실제 창 상태를 권위로 runtime과 이벤트를 동기화
                log::error!(
                    "[Overlay] 저장 실패 후 보상도 실패({comp_err}) — 창 상태({visible})를 권위로 동기화"
                );
                *self.overlay_visible.write() = visible;
                let _ = app.emit("overlay:visibility", &json!({ "visible": visible }));
            }
            return Err(persist_err);
        }

        *self.overlay_visible.write() = visible;
        app.emit("overlay:visibility", &json!({ "visible": visible }))?;
        Ok(())
    }

    pub fn set_overlay_lock(&self, app: &AppHandle, locked: bool, persist: bool) -> Result<()> {
        log::debug!(
            "[IPC] set_overlay_lock: locked={}, persist={}",
            locked,
            persist
        );
        if persist {
            let _ = self.store.update(|state| {
                state.overlay_locked = locked;
            })?;
        }

        // 오버레이가 보이는 상태일 때만 설정 적용
        // 비표시 상태: 설정값만 저장, 오버레이 열 때 적용
        let is_visible = *self.overlay_visible.read();
        if is_visible {
            if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
                window.set_ignore_cursor_events(locked)?;
            }
        }
        app.emit("overlay:lock", &json!({ "locked": locked }))?;
        Ok(())
    }

    pub fn shutdown(&self) {
        if self.shutdown_started.swap(true, Ordering::SeqCst) {
            return;
        }
        self.overlay_bounds_generation
            .fetch_add(1, Ordering::SeqCst);
        self.keyboard_task_generation.fetch_add(1, Ordering::SeqCst);
        let keyboard_task = {
            let mut task_guard = self.keyboard_task.write();
            task_guard.take()
        };
        if let Some(task) = keyboard_task {
            drop(task);
        }
        if let Some(watcher) = self.css_watcher.write().take() {
            watcher.shutdown();
        }
        if let Err(err) = self.persist_key_counters() {
            log::warn!("failed to persist key counters during shutdown: {err}");
        }
        if let Err(err) = self.store.flush_cleanup_and_shutdown() {
            log::warn!("failed to finalize store during shutdown: {err:#}");
        }
    }

    pub(crate) fn arm_shutdown_watchdog(&self, stage: &'static str) {
        {
            let mut watchdog = self.shutdown_watchdog.lock();
            if watchdog.armed {
                return;
            }
            watchdog.armed = true;
            watchdog.stage = stage;
        }
        let watchdog = self.shutdown_watchdog.clone();
        thread::spawn(move || {
            thread::sleep(SHUTDOWN_WATCHDOG_TIMEOUT);
            log::error!(
                "[Shutdown] watchdog exceeded {} seconds during '{}'; forcing process exit with code {}",
                SHUTDOWN_WATCHDOG_TIMEOUT.as_secs(),
                watchdog.lock().stage,
                SHUTDOWN_WATCHDOG_EXIT_CODE
            );
            std::process::exit(SHUTDOWN_WATCHDOG_EXIT_CODE);
        });
    }

    pub(crate) fn set_shutdown_watchdog_stage(&self, stage: &'static str) {
        self.shutdown_watchdog.lock().stage = stage;
    }

    pub fn is_process_exit_authorized(&self) -> bool {
        self.process_exit_authorized.load(Ordering::SeqCst)
    }

    fn authorize_process_exit(&self) {
        self.process_exit_authorized.store(true, Ordering::SeqCst);
    }

    pub fn request_frontend_shutdown(&self, app_handle: AppHandle) {
        self.request_frontend_lifecycle(app_handle, FrontendLifecycleAction::Quit);
    }

    pub fn request_frontend_restart(&self, app_handle: AppHandle) {
        self.request_frontend_lifecycle(app_handle, FrontendLifecycleAction::Restart);
    }

    pub fn acknowledge_frontend_lifecycle(
        &self,
        app_handle: AppHandle,
        handshake_id: &str,
        window_label: &str,
    ) {
        let prepared = {
            let mut handshake = self.editor_flush_handshake.lock();
            acknowledge_editor_flush_handshake(
                &mut handshake,
                handshake_id,
                window_label,
                &self.store.history_gate(),
            )
        };

        match prepared {
            Some(EditorFlushAcknowledge::LifecycleReady(completed)) => {
                self.complete_editor_flush_handshake(app_handle, completed);
            }
            Some(EditorFlushAcknowledge::HistoryClosing {
                handshake_id,
                waiter,
            }) => {
                let drain_result = waiter.wait_for_drain();
                self.finish_frontend_history_gate_close(app_handle, &handshake_id, drain_result);
            }
            Some(EditorFlushAcknowledge::HistoryCloseFailed { handshake, error }) => {
                log::warn!("failed to close history admission gate: {error}");
                self.fail_editor_flush_handshake(
                    &app_handle,
                    handshake,
                    HISTORY_FRONTEND_FLUSH_BUSY,
                );
            }
            None => {}
        }
    }

    pub(crate) fn admit_frontend_history_mutation(
        &self,
        window_label: &str,
    ) -> std::result::Result<HistoryAdmissionLease, EditorCommitError> {
        let handshake = self.editor_flush_handshake.lock();
        if frontend_history_mutation_blocked(&handshake, window_label) {
            return Err(EditorCommitError::history_in_progress());
        }
        self.store
            .history_gate()
            .admit_mutation()
            .map_err(|_| EditorCommitError::history_in_progress())
    }

    pub fn cancel_frontend_lifecycle(&self, app_handle: AppHandle, handshake_id: &str) {
        let canceled = {
            let mut handshake = self.editor_flush_handshake.lock();
            take_cancelable_editor_flush_handshake(&mut handshake, handshake_id)
        };
        if let Some(canceled) = canceled {
            self.fail_editor_flush_handshake(
                &app_handle,
                canceled,
                HISTORY_FRONTEND_FLUSH_CANCELED,
            );
        }
    }

    fn complete_editor_flush_handshake(
        &self,
        app_handle: AppHandle,
        completed: EditorFlushHandshake,
    ) {
        let EditorFlushHandshake { completion, .. } = completed;
        match completion {
            EditorFlushCompletion::Lifecycle(action) => {
                execute_frontend_lifecycle(app_handle, action, self.overlay_force_close.clone());
            }
            EditorFlushCompletion::History { .. } => {
                log::error!("history handshake completed through lifecycle path");
            }
        }
    }

    fn finish_frontend_history_gate_close(
        &self,
        app_handle: AppHandle,
        handshake_id: &str,
        drain_result: std::result::Result<(), String>,
    ) {
        if let Err(error) = drain_result {
            let failed = {
                let mut active = self.editor_flush_handshake.lock();
                take_cancelable_editor_flush_handshake(&mut active, handshake_id)
            };
            if let Some(failed) = failed {
                log::warn!("history admission drain was interrupted: {error}");
                self.fail_editor_flush_handshake(
                    &app_handle,
                    failed,
                    HISTORY_FRONTEND_FLUSH_INTERRUPTED,
                );
            }
            return;
        }

        let prepared = {
            let mut active = self.editor_flush_handshake.lock();
            let Some(handshake) = active.as_mut().filter(|item| item.id == handshake_id) else {
                return;
            };
            let EditorFlushCompletion::History {
                sender,
                phase,
                barrier,
                ..
            } = &mut handshake.completion
            else {
                return;
            };
            if *phase != FrontendHistoryFlushPhase::Closing {
                return;
            }
            let Some(sender) = sender.take() else {
                return;
            };
            let Some(barrier) = barrier.take() else {
                return;
            };
            *phase = FrontendHistoryFlushPhase::Running;
            Some((sender, barrier))
        };

        let Some((sender, barrier)) = prepared else {
            return;
        };
        let completion_app = app_handle.clone();
        let completion_id = handshake_id.to_string();
        let ready = FrontendHistoryFlushReady {
            barrier: Some(barrier),
            complete: Some(Box::new(move || {
                let state = completion_app.state::<AppState>();
                state.complete_frontend_history_operation(&completion_app, &completion_id);
            })),
        };
        let _ = sender.send(Ok(ready));
    }

    fn complete_frontend_history_operation(&self, app_handle: &AppHandle, handshake_id: &str) {
        let (completed, deferred_action) = {
            let mut active = self.editor_flush_handshake.lock();
            let is_running = active.as_ref().is_some_and(|handshake| {
                handshake.id == handshake_id
                    && handshake.completion.history_phase()
                        == Some(FrontendHistoryFlushPhase::Running)
            });
            if !is_running {
                return;
            }
            let completed = active
                .take()
                .expect("running history handshake disappeared");
            let deferred_action = self.deferred_frontend_lifecycle.lock().take();
            (completed, deferred_action)
        };
        emit_frontend_history_flush_released(app_handle, &completed.id, &completed.target_windows);
        if let Some(action) = deferred_action {
            self.request_frontend_lifecycle(app_handle.clone(), action);
        }
    }

    fn fail_editor_flush_handshake(
        &self,
        app_handle: &AppHandle,
        failed: EditorFlushHandshake,
        history_error: &'static str,
    ) {
        let EditorFlushHandshake {
            id,
            completion,
            target_windows,
            ..
        } = failed;
        match completion {
            EditorFlushCompletion::Lifecycle(_) => {
                #[cfg(target_os = "macos")]
                if let Err(error) = super::macos_termination::cancel_pending_termination(app_handle)
                {
                    log::warn!("failed to cancel pending macOS termination: {error}");
                }
                self.restore_frontend_lifecycle_windows(app_handle, &target_windows);
            }
            EditorFlushCompletion::History {
                sender, barrier, ..
            } => {
                drop(barrier);
                emit_frontend_history_flush_released(app_handle, &id, &target_windows);
                if let Some(sender) = sender {
                    let _ = sender.send(Err(history_error.to_string()));
                }
            }
        }
    }

    fn restore_frontend_lifecycle_windows(
        &self,
        app_handle: &AppHandle,
        target_windows: &HashSet<String>,
    ) {
        for label in frontend_lifecycle_restore_labels(target_windows) {
            match label {
                "main" => {
                    if let Err(error) = self.show_main_window(app_handle) {
                        log::warn!(
                            "failed to restore main window after canceled lifecycle: {error}"
                        );
                    }
                }
                OVERLAY_LABEL if *self.overlay_visible.read() => {
                    if let Err(error) = self.set_overlay_visibility(app_handle, true) {
                        log::warn!("failed to restore overlay after canceled lifecycle: {error}");
                    }
                }
                PANEL_LABEL => {
                    if let Some(panel) = app_handle.get_webview_window(PANEL_LABEL) {
                        if let Err(error) = panel.show() {
                            log::warn!("failed to restore panel after canceled lifecycle: {error}");
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn request_frontend_lifecycle(&self, app_handle: AppHandle, action: FrontendLifecycleAction) {
        if self.overlay_force_close.load(Ordering::SeqCst)
            || self.shutdown_started.load(Ordering::SeqCst)
        {
            return;
        }

        let targets =
            collect_frontend_lifecycle_targets(|label| app_handle.get_webview_window(label));
        let handshake_id = uuid::Uuid::new_v4().to_string();
        let target_windows = targets
            .iter()
            .map(|(label, _)| label.clone())
            .collect::<HashSet<_>>();
        let next_handshake = EditorFlushHandshake {
            id: handshake_id.clone(),
            completion: EditorFlushCompletion::Lifecycle(action),
            pending_windows: target_windows.clone(),
            target_windows,
        };
        let interrupted_history = {
            let mut active = self.editor_flush_handshake.lock();
            match install_lifecycle_handshake(&mut active, next_handshake) {
                LifecycleHandshakeInstall::Installed => None,
                LifecycleHandshakeInstall::InterruptedHistory(interrupted) => Some(*interrupted),
                LifecycleHandshakeInstall::LifecycleAlreadyActive => return,
                LifecycleHandshakeInstall::DeferredUntilHistoryComplete => {
                    let mut deferred = self.deferred_frontend_lifecycle.lock();
                    if deferred.is_none() {
                        *deferred = Some(action);
                    }
                    return;
                }
            }
        };
        if let Some(interrupted) = interrupted_history {
            self.fail_editor_flush_handshake(
                &app_handle,
                interrupted,
                HISTORY_FRONTEND_FLUSH_INTERRUPTED,
            );
        }

        if targets.is_empty() {
            let completed = {
                let mut active = self.editor_flush_handshake.lock();
                take_editor_flush_handshake(&mut active, &handshake_id)
            };
            if let Some(completed) = completed {
                self.complete_editor_flush_handshake(app_handle, completed);
            }
            return;
        }

        let request = EditorFlushRequest {
            handshake_id: handshake_id.clone(),
            action: action.into(),
        };
        let mut failed_windows = Vec::new();
        for (label, window) in &targets {
            if let Err(error) = window.emit("app:close-requested", &request) {
                log::warn!("failed to request editor flush from {label}: {error}");
                failed_windows.push(label.clone());
            }
        }

        if !failed_windows.is_empty() {
            let canceled = {
                let mut handshake = self.editor_flush_handshake.lock();
                take_editor_flush_handshake(&mut handshake, &handshake_id)
            };
            let Some(canceled) = canceled else {
                return;
            };
            log::warn!(
                "editor flush request failed for {:?}; lifecycle action canceled",
                failed_windows
            );
            self.fail_editor_flush_handshake(
                &app_handle,
                canceled,
                HISTORY_FRONTEND_FLUSH_EMIT_FAILED,
            );
            return;
        }

        self.schedule_editor_flush_timeout(app_handle, handshake_id);
    }

    pub(crate) fn request_frontend_history_flush(
        &self,
        app_handle: AppHandle,
        operation_id: &str,
    ) -> Result<oneshot::Receiver<Result<FrontendHistoryFlushReady, String>>, String> {
        if self.overlay_force_close.load(Ordering::SeqCst)
            || self.shutdown_started.load(Ordering::SeqCst)
        {
            return Err(HISTORY_FRONTEND_FLUSH_BUSY.to_string());
        }

        let targets =
            collect_frontend_lifecycle_targets(|label| app_handle.get_webview_window(label));
        let target_windows = targets
            .iter()
            .map(|(label, _)| label.clone())
            .collect::<HashSet<_>>();
        let handshake_id = uuid::Uuid::new_v4().to_string();
        let (sender, receiver) = oneshot::channel();
        let handshake = EditorFlushHandshake {
            id: handshake_id.clone(),
            completion: EditorFlushCompletion::History {
                operation_id: operation_id.to_string(),
                sender: Some(sender),
                phase: FrontendHistoryFlushPhase::Collecting,
                barrier: None,
            },
            pending_windows: target_windows.clone(),
            target_windows,
        };
        {
            let mut active = self.editor_flush_handshake.lock();
            if self.store.history_gate().is_closed()
                || !install_history_handshake(&mut active, handshake)
            {
                return Err(HISTORY_FRONTEND_FLUSH_BUSY.to_string());
            }
        }

        if targets.is_empty() {
            let prepared = {
                let mut active = self.editor_flush_handshake.lock();
                begin_history_gate_close(&mut active, &handshake_id, &self.store.history_gate())
            };
            match prepared {
                Some(EditorFlushAcknowledge::HistoryClosing {
                    handshake_id,
                    waiter,
                }) => {
                    let drain_result = waiter.wait_for_drain();
                    self.finish_frontend_history_gate_close(
                        app_handle,
                        &handshake_id,
                        drain_result,
                    );
                }
                Some(EditorFlushAcknowledge::HistoryCloseFailed { handshake, error }) => {
                    log::warn!("failed to close history admission gate: {error}");
                    self.fail_editor_flush_handshake(
                        &app_handle,
                        handshake,
                        HISTORY_FRONTEND_FLUSH_BUSY,
                    );
                }
                _ => {}
            }
            return Ok(receiver);
        }

        let request = EditorFlushRequest {
            handshake_id: handshake_id.clone(),
            action: FrontendFlushAction::History,
        };
        let mut failed_windows = Vec::new();
        for (label, window) in &targets {
            if let Err(error) = window.emit("app:close-requested", &request) {
                log::warn!("failed to request history flush from {label}: {error}");
                failed_windows.push(label.clone());
            }
        }

        if !failed_windows.is_empty() {
            let failed = {
                let mut active = self.editor_flush_handshake.lock();
                take_cancelable_editor_flush_handshake(&mut active, &handshake_id)
            };
            if let Some(failed) = failed {
                log::warn!(
                    "history frontend flush request failed for {:?}",
                    failed_windows
                );
                self.fail_editor_flush_handshake(
                    &app_handle,
                    failed,
                    HISTORY_FRONTEND_FLUSH_EMIT_FAILED,
                );
            }
            return Ok(receiver);
        }

        self.schedule_editor_flush_timeout(app_handle, handshake_id);
        Ok(receiver)
    }

    fn schedule_editor_flush_timeout(&self, app_handle: AppHandle, handshake_id: String) {
        let handshake = self.editor_flush_handshake.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(EDITOR_FLUSH_HANDSHAKE_TIMEOUT).await;
            let timed_out = {
                let mut active = handshake.lock();
                take_cancelable_editor_flush_handshake(&mut active, &handshake_id)
            };

            if let Some(timed_out) = timed_out {
                let state = app_handle.state::<AppState>();
                if timed_out.completion.is_lifecycle() {
                    log::warn!("editor flush handshake timed out; lifecycle action canceled");
                } else {
                    log::warn!("editor flush handshake timed out; history action canceled");
                }
                state.fail_editor_flush_handshake(
                    &app_handle,
                    timed_out,
                    HISTORY_FRONTEND_FLUSH_TIMEOUT,
                );
            }
        });
    }

    pub fn set_overlay_anchor(&self, app: &AppHandle, anchor: &str) -> Result<String> {
        let parsed = overlay_resize_anchor_from_str(anchor);
        let value: OverlayResizeAnchor =
            parsed.unwrap_or_else(|| self.store.snapshot().overlay_resize_anchor.clone());
        let updated = self.store.update(|state| {
            state.overlay_resize_anchor = value.clone();
        })?;
        app.emit("overlay:anchor", &json!({ "anchor": value.as_str() }))?;
        Ok(updated.overlay_resize_anchor.as_str().to_string())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn resize_overlay(
        &self,
        app: &AppHandle,
        width: f64,
        height: f64,
        anchor: Option<String>,
        content_top_offset: Option<f64>,
        fixed_position_delta_x: Option<f64>,
        fixed_position_delta_y: Option<f64>,
    ) -> Result<OverlayBounds> {
        // 오버레이가 이미 열려있을 때만 리사이즈 수행
        // 창 미존재 시 에러 반환 (자동 생성하지 않음)
        let window = app
            .get_webview_window(OVERLAY_LABEL)
            .ok_or_else(|| anyhow!("Overlay window is not open"))?;
        let anchor = anchor
            .and_then(|value| overlay_resize_anchor_from_str(&value))
            .unwrap_or_else(|| self.store.snapshot().overlay_resize_anchor.clone());

        let requested_width = width;
        let requested_height = height;
        let width = clamp_overlay_dimension(width);
        let height = clamp_overlay_dimension(height);
        // 잘린 경우 콘텐츠 일부가 창 밖에 남으므로 진단용 기록
        if (requested_width - width).abs() >= 0.5 || (requested_height - height).abs() >= 0.5 {
            log::warn!(
                "[overlay] resize clamped: requested {requested_width}x{requested_height} -> {width}x{height}"
            );
        }

        let scale_factor = window.scale_factor().unwrap_or(1.0);
        let position = window
            .outer_position()
            .map(|value| value.to_logical::<f64>(scale_factor))
            .unwrap_or_else(|_| LogicalPosition::new(0.0, 0.0));
        let size = window
            .outer_size()
            .map(|value| value.to_logical::<f64>(scale_factor))
            .unwrap_or_else(|_| LogicalSize::new(DEFAULT_OVERLAY_WIDTH, DEFAULT_OVERLAY_HEIGHT));

        let mut new_x = position.x;
        let mut new_y = position.y;
        let mut next_content_top_offset = None;

        // 초기화 중(첫 resize)에는 anchor 기반 position 재계산을 건너뛰고
        // store에 저장된 위치를 사용 (빌더 position이 무시될 수 있으므로)
        let initializing = self.overlay_initializing.swap(false, Ordering::SeqCst);
        if initializing {
            // store에서 저장된 위치를 가져와 사용 (빌더 position이 무시될 수 있으므로).
            // 구버전 store의 physical 좌표를 그대로 쓰면 뒤이은 defer_overlay_bounds가
            // 마커를 true로 굳혀 영구 고착되므로 환산을 거친다.
            // 환산 불가 시엔 창의 실제 위치를 유지하는 편이 안전하다
            let snapshot = self.store.snapshot();
            // 환산이 필요할 때만 모니터를 조회한다
            let monitors = if stored_bounds_need_monitor_data(
                snapshot.overlay_bounds_are_logical,
                snapshot.overlay_bounds.as_ref(),
            ) {
                MonitorData::gather(app)
            } else {
                MonitorData::default()
            };
            let restored = normalize_stored_overlay_bounds(
                snapshot.overlay_bounds.as_ref(),
                snapshot.overlay_bounds_are_logical,
                &monitors,
            );
            if let Some(stored) = restored {
                new_x = stored.x;
                new_y = stored.y;
            }
            // 초기화 중이라도 content_top_offset은 저장해야 다음 resize에서 delta 계산이 정확함
            if let Some(offset) = content_top_offset {
                if offset.is_finite() {
                    next_content_top_offset = Some(offset);
                }
            }
        } else {
            match anchor {
                OverlayResizeAnchor::BottomLeft => new_y += size.height - height,
                OverlayResizeAnchor::TopRight => new_x += size.width - width,
                OverlayResizeAnchor::BottomRight => {
                    new_x += size.width - width;
                    new_y += size.height - height;
                }
                OverlayResizeAnchor::Center => {
                    new_x += (size.width - width) / 2.0;
                    new_y += (size.height - height) / 2.0;
                }
                OverlayResizeAnchor::FixedPosition => {}
                OverlayResizeAnchor::TopLeft => {}
            }

            if anchor == OverlayResizeAnchor::FixedPosition {
                if let Some(delta_x) = fixed_position_delta_x.filter(|value| value.is_finite()) {
                    new_x += delta_x;
                }
                if let Some(delta_y) = fixed_position_delta_y.filter(|value| value.is_finite()) {
                    new_y += delta_y;
                }
            }

            if let Some(offset) = content_top_offset {
                if offset.is_finite() {
                    let previous = self
                        .store
                        .snapshot()
                        .overlay_last_content_top_offset
                        .unwrap_or(offset);
                    let delta = offset - previous;
                    if delta != 0.0 {
                        match anchor {
                            OverlayResizeAnchor::Center => new_y -= delta / 2.0,
                            OverlayResizeAnchor::BottomLeft | OverlayResizeAnchor::BottomRight => {}
                            OverlayResizeAnchor::FixedPosition => new_y -= delta,
                            _ => new_y -= delta,
                        }
                    }
                    next_content_top_offset = Some(offset);
                }
            }
        }

        // 크기·위치를 단일 네이티브 트랜잭션으로 적용 - 분리 호출은 창이 두 단계로 움직여 덜컥거림 유발
        let bounds = apply_overlay_frame(&window, new_x, new_y, width, height, scale_factor)?;

        defer_overlay_bounds(
            &self.store,
            &self.overlay_bounds_generation,
            bounds.clone(),
            next_content_top_offset,
        )?;

        log::debug!(
            "[IPC] resize_overlay: emit overlay:resized ({}x{} at {}, {})",
            bounds.width,
            bounds.height,
            bounds.x,
            bounds.y
        );
        app.emit(
            "overlay:resized",
            &json!({
                "x": bounds.x,
                "y": bounds.y,
                "width": bounds.width,
                "height": bounds.height,
            }),
        )?;

        Ok(bounds)
    }

    /// 오버레이를 겹침이 가장 큰 모니터(없으면 주 모니터) 작업 영역 가운데로 되돌린다.
    /// 창이 화면 밖으로 나가 잡을 수 없을 때의 탈출구이므로 표시 여부도 창 존재 여부도 따지지 않는다.
    /// 창이 없으면 저장된 위치만 갱신해, 다음에 오버레이를 켰을 때 제자리에 뜬다
    pub fn reset_overlay_position(&self, app: &AppHandle) -> Result<OverlayBounds> {
        let window = app.get_webview_window(OVERLAY_LABEL);
        let snapshot = self.store.snapshot();
        let stored = snapshot.overlay_bounds;
        // 저장된 사각형을 해석하려면 모니터 정보가 먼저 필요하다
        let monitors = MonitorData::gather(app);

        // 창도 모니터 정보도 없으면 착지점을 고를 근거가 전무하다. 임의 좌표로
        // 덮어써 성공을 보고하느니 실패시켜 저장된 값과 마커를 보존한다
        if window.is_none() && monitors.is_empty() {
            return Err(anyhow!("monitor information unavailable"));
        }

        let scale_factor = window
            .as_ref()
            .and_then(|value| value.scale_factor().ok())
            .unwrap_or(1.0);
        // 창이 없으면 저장된 값이, 그것도 없으면 기본 크기가 유일한 근거다
        let (position, size) = match window.as_ref() {
            Some(window) => (
                window
                    .outer_position()
                    .map(|value| value.to_logical::<f64>(scale_factor))
                    .unwrap_or_else(|_| LogicalPosition::new(0.0, 0.0)),
                window
                    .outer_size()
                    .map(|value| value.to_logical::<f64>(scale_factor))
                    .unwrap_or_else(|_| {
                        LogicalSize::new(DEFAULT_OVERLAY_WIDTH, DEFAULT_OVERLAY_HEIGHT)
                    }),
            ),
            None => overlay_reset_fallback_rect(
                stored.as_ref(),
                snapshot.overlay_bounds_are_logical,
                &monitors,
            ),
        };

        let target = monitors
            .find_best_overlap(position.x, position.y, size.width, size.height)
            .or_else(|| monitors.primary_spec());

        let placement = match target {
            Some(spec) => spec.clamp(
                spec.logical_origin_x + (spec.logical_width - size.width) / 2.0,
                spec.logical_origin_y + (spec.logical_height - size.height) / 2.0,
                size.width,
                size.height,
            ),
            // 모니터 정보를 못 얻으면 좌상단 여백 위치가 유일하게 안전한 착지점
            None => OverlayPosition {
                x: OVERLAY_MARGIN,
                y: OVERLAY_MARGIN,
            },
        };

        let bounds = match window.as_ref() {
            Some(window) => apply_overlay_frame(
                window,
                placement.x,
                placement.y,
                size.width,
                size.height,
                scale_factor,
            )?,
            None => OverlayBounds {
                x: placement.x,
                y: placement.y,
                width: size.width,
                height: size.height,
            },
        };

        // 크기가 그대로라 창 안에서의 콘텐츠 위치도 그대로 - 기준선을 건드리면
        // 다음 resize가 이동량을 두 번 반영한다
        defer_overlay_bounds(
            &self.store,
            &self.overlay_bounds_generation,
            bounds.clone(),
            None,
        )?;

        app.emit(
            "overlay:resized",
            &json!({
                "x": bounds.x,
                "y": bounds.y,
                "width": bounds.width,
                "height": bounds.height,
            }),
        )?;

        Ok(bounds)
    }

    pub fn start_keyboard_hook(&self, app: AppHandle) -> Result<()> {
        let mut task_guard = self.keyboard_task.write();
        if task_guard.is_some() {
            return Ok(());
        }
        self.start_keyboard_hook_locked(app, &mut task_guard, 0, None)
    }

    fn start_keyboard_hook_locked(
        &self,
        app: AppHandle,
        task_slot: &mut Option<KeyboardDaemonTask>,
        recovery_attempt: usize,
        expected_generation: Option<u64>,
    ) -> Result<()> {
        if self.shutdown_started.load(Ordering::SeqCst) {
            return Ok(());
        }

        let generation = if let Some(expected_generation) = expected_generation {
            let next_generation = expected_generation.wrapping_add(1);
            if self
                .keyboard_task_generation
                .compare_exchange(
                    expected_generation,
                    next_generation,
                    Ordering::SeqCst,
                    Ordering::SeqCst,
                )
                .is_err()
            {
                return Ok(());
            }
            next_generation
        } else {
            self.keyboard_task_generation
                .fetch_add(1, Ordering::SeqCst)
                .wrapping_add(1)
        };

        self.reset_keyboard_hook_state(&app);

        let daemon_started_at = Instant::now();

        let current_exe = std::env::current_exe().context("failed to locate dm-note executable")?;
        let shortcuts_json = serde_json::to_string(&self.store.settings_snapshot().shortcuts)
            .unwrap_or_else(|_| "{}".to_string());

        // Named Pipe 서버를 비동기로 준비 (daemon 스폰 전 블로킹 방지)
        #[cfg(target_os = "windows")]
        let pipe_receiver: Option<std::sync::mpsc::Receiver<Option<std::fs::File>>> = {
            use std::sync::mpsc;
            let (tx, rx) = mpsc::channel();
            std::thread::spawn(
                move || match crate::ipc::pipe_server_create("dmnote_keys_v1") {
                    Ok(f) => {
                        let _ = tx.send(Some(f));
                    }
                    Err(err) => {
                        warn!("failed to create named pipe: {err}");
                        let _ = tx.send(None);
                    }
                },
            );
            Some(rx)
        };
        #[cfg(not(target_os = "windows"))]
        let _pipe_receiver: Option<std::sync::mpsc::Receiver<Option<std::fs::File>>> = None;
        let mut child = Command::new(current_exe)
            .arg("--keyboard-daemon")
            .env("DMNOTE_HOTKEYS_V1", shortcuts_json)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("failed to spawn keyboard daemon process")?;

        let parent_stdin = child
            .stdin
            .take()
            .context("keyboard daemon stdin unavailable")?;
        let stdout = child
            .stdout
            .take()
            .context("keyboard daemon stdout unavailable")?;
        let stderr = child.stderr.take();

        let running = Arc::new(AtomicBool::new(true));
        let running_reader = running.clone();
        let keyboard = self.keyboard.clone();
        let app_handle = app.clone();

        let reader_handle = thread::Builder::new()
            .name("keyboard-daemon-reader".into())
            .spawn(move || {
            let mut keys_state_emit_count: u64 = 0;
                // Named Pipe 우선 사용; 불가 시 stdout fallback
                #[allow(unused_mut)]
                let mut reader: BufReader<Box<dyn std::io::Read + Send>> = {
                    #[cfg(target_os = "windows")]
                    {
                        if let Some(rx) = pipe_receiver {
                            // Pipe 준비 대기; 타임아웃 시 stdout fallback
                            match rx.recv_timeout(Duration::from_millis(1500)) {
                                Ok(Some(f)) => BufReader::new(Box::new(f)),
                                _ => BufReader::new(Box::new(stdout)),
                            }
                        } else {
                            BufReader::new(Box::new(stdout))
                        }
                    }
                    #[cfg(not(target_os = "windows"))]
                    {
                        BufReader::new(Box::new(stdout))
                    }
                };
                let mut overlay_window = app_handle.get_webview_window(OVERLAY_LABEL);
                // Windows에서 reader 스레드 우선순위 약간 상향
                #[cfg(target_os = "windows")]
                unsafe {
                    use windows::Win32::System::Threading::{GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_ABOVE_NORMAL};
                    let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_ABOVE_NORMAL);
                }

                let mut exit_reason = None;
                while running_reader.load(Ordering::SeqCst) {
                    let mut line = String::new();
                    match reader.read_line(&mut line) {
                        Ok(0) => {
                            exit_reason = Some(String::from("output EOF"));
                            break;
                        }
                        Ok(_) => {
                            let s = line.trim();
                            if s.is_empty() {
                                continue;
                            }

                            // DaemonCommand(글로벌 단축키) 파싱 우선 시도
                            if let Ok(command) = serde_json::from_str::<crate::ipc::DaemonCommand>(s) {
                                match command {
                                    crate::ipc::DaemonCommand::ToggleOverlay => {
                                        log::info!("[AppState] received ToggleOverlay command from daemon");
                                        let app_state = app_handle.state::<AppState>();
                                        if app_state.is_obs_mode_active() {
                                            log::info!("[AppState] OBS 모드 활성화 중 — 오버레이 토글 무시");
                                        } else {
                                        let is_visible = *app_state.overlay_visible.read();
                                        if let Err(err) = app_state.set_overlay_visibility(&app_handle, !is_visible) {
                                            log::error!("failed to toggle overlay visibility: {err}");
                                        }
                                        }
                                    }
                                    crate::ipc::DaemonCommand::ToggleOverlayLock => {
                                        log::info!("[AppState] received ToggleOverlayLock command from daemon");
                                        let app_state = app_handle.state::<AppState>();
                                        let current = app_state.store.snapshot().overlay_locked;
                                        match app_state.settings.apply_patch(crate::models::SettingsPatchInput {
                                            overlay_locked: Some(!current),
                                            ..Default::default()
                                        }) {
                                            Ok(diff) => {
                                                if let Err(err) = app_state.emit_settings_changed(&diff, &app_handle) {
                                                    log::error!("failed to apply overlay lock toggle: {err}");
                                                }
                                            }
                                            Err(err) => log::error!("failed to toggle overlay lock: {err}"),
                                        }
                                    }
                                    crate::ipc::DaemonCommand::ToggleAlwaysOnTop => {
                                        log::info!("[AppState] received ToggleAlwaysOnTop command from daemon");
                                        let app_state = app_handle.state::<AppState>();
                                        let current = app_state.store.snapshot().always_on_top;
                                        match app_state.settings.apply_patch(crate::models::SettingsPatchInput {
                                            always_on_top: Some(!current),
                                            ..Default::default()
                                        }) {
                                            Ok(diff) => {
                                                if let Err(err) = app_state.emit_settings_changed(&diff, &app_handle) {
                                                    log::error!("failed to apply always-on-top toggle: {err}");
                                                }
                                            }
                                            Err(err) => log::error!("failed to toggle always-on-top: {err}"),
                                        }
                                    }
                                }
                                continue;
                            }

                            // HID 축(노브) 메시지 → input:axis 이벤트 브로드캐스트
                            // (버튼은 아래 HookMessage 경로로 기존 키 시각화 재사용)
                            if let Ok(axis) =
                                serde_json::from_str::<crate::ipc::HidAxisMessage>(s)
                            {
                                let _ = app_handle.emit(
                                    "input:axis",
                                    &json!({
                                        "axisId": axis.axis_id,
                                        "value": axis.value,
                                        "full": axis.full,
                                    }),
                                );
                                continue;
                            }

                            // 입력 수신 시각 — 노트 위치의 프레임 양자화 보정용 age 측정 기준
                            let recv_at = Instant::now();

                            // 우선 형식: JSON 인코딩된 HookMessage (device 포함)
                            let parsed: Option<crate::ipc::HookMessage> =
                                serde_json::from_str(s).ok();

                            let message = if let Some(msg) = parsed {
                                if msg.labels.is_empty() {
                                    continue;
                                }
                                msg
                            } else {
                                // 레거시 간소 형식: "D:<label>" / "U:<label>"
                                if s.len() < 3
                                    || !s.as_bytes().get(1).map(|c| *c == b':').unwrap_or(false)
                                {
                                    continue;
                                }
                                let (state_ch, rest) = s.split_at(1);
                                let key = &rest[1..];
                                if key.is_empty() {
                                    continue;
                                }
                                crate::ipc::HookMessage {
                                    device: crate::ipc::InputDeviceKind::Keyboard,
                                    labels: vec![key.to_string()],
                                    state: if state_ch == "D" {
                                        crate::ipc::HookKeyState::Down
                                    } else {
                                        crate::ipc::HookKeyState::Up
                                    },
                                    physical_id: None,
                                    vk_code: None,
                                    scan_code: None,
                                    flags: None,
                                    hold_duration_ms: None,
                                    input_ts_ms: None,
                                }
                            };

                            let device_str = match message.device {
                                crate::ipc::InputDeviceKind::Keyboard => "keyboard",
                                crate::ipc::InputDeviceKind::Mouse => "mouse",
                                crate::ipc::InputDeviceKind::Gamepad => "gamepad",
                                crate::ipc::InputDeviceKind::Unknown => "unknown",
                            };
                            let state = match message.state {
                                crate::ipc::HookKeyState::Down => "DOWN",
                                crate::ipc::HookKeyState::Up => "UP",
                            };
                            let labels_for_emit = message.labels.clone();
                            let primary_label = labels_for_emit.first()
                                .cloned()
                                .unwrap_or_else(|| String::from(""));

                            // 구독자가 있을 때만 raw input 스트림 emit
                            let app_state = app_handle.state::<AppState>();
                            if app_state.raw_input_subscriber_count() > 0 {
                                let raw_payload = json!({
                                    "label": primary_label,
                                    "labels": labels_for_emit.clone(),
                                    "state": state,
                                    "device": device_str,
                                });

                                for label in RAW_INPUT_WINDOW_LABELS {
                                    if let Some(window) = app_handle.get_webview_window(label) {
                                        let _ = window.emit("input:raw", &raw_payload);
                                    }
                                }
                            }

                            let is_down = state == "DOWN";
                            let Some(outcome) = keyboard.match_and_register(
                                message.physical_id.as_deref(),
                                message.device,
                                message.labels.iter().map(String::as_str),
                                is_down,
                            ) else {
                                continue;
                            };

                            if let Some(pressed_label) = outcome.pressed_label.as_ref() {
                                if let Err(err) = app_handle.emit(
                                    "input:press",
                                    &json!({ "label": pressed_label, "mode": &outcome.mode }),
                                ) {
                                    error!("failed to emit input:press: {err}");
                                }
                            }

                            let fallback_age_ms = recv_at.elapsed().as_secs_f64() * 1000.0;
                            let event_age_ms = resolve_event_age_ms(
                                message.input_ts_ms,
                                unix_epoch_ms(),
                                fallback_age_ms,
                            );

                            // 키음은 물리 다운당 1회: press 기여 슬롯을 병합해
                            // 사운드 활성 첫 슬롯 설정 사용 (오디오 중첩 방지)
                            if is_down && message.device == crate::ipc::InputDeviceKind::Keyboard {
                                if let Some((_sound_canonical, sound_slot_indices)) =
                                    crate::keyboard::manager::collect_sound_dispatch(&outcome.events)
                                {
                                    if let Some((sound_path, per_key_volume)) = app_state
                                        .resolve_key_sound_binding(
                                            &outcome.mode,
                                            &sound_slot_indices,
                                        )
                                    {
                                        #[cfg(debug_assertions)]
                                        let key_sound_input_started_at = Instant::now();
                                        #[cfg(debug_assertions)]
                                        let key_sound_dispatch_started_at = Instant::now();
                                        #[cfg(debug_assertions)]
                                        let dispatch_ms = key_sound_dispatch_started_at
                                            .elapsed()
                                            .as_secs_f64()
                                            * 1000.0;
                                        #[cfg(debug_assertions)]
                                        let trace = KeySoundDispatchTrace::new(
                                            key_sound_input_started_at,
                                            dispatch_ms,
                                        );
                                        app_state.key_sound.play_file(
                                            &sound_path,
                                            per_key_volume,
                                            #[cfg(debug_assertions)]
                                            Some(trace),
                                            #[cfg(not(debug_assertions))]
                                            None,
                                        );
                                        #[cfg(debug_assertions)]
                                        if app_state.key_sound.latency_logging_enabled() {
                                            log::debug!(
                                                "[KeySound][Latency] route=dispatch dispatchMs={dispatch_ms:.3} mode={} key={} volume={:.3} path={}",
                                                outcome.mode,
                                                _sound_canonical,
                                                per_key_volume,
                                                sound_path
                                            );
                                        }
                                    } else {
                                        #[cfg(debug_assertions)]
                                        let key_sound_input_started_at = Instant::now();
                                        #[cfg(debug_assertions)]
                                        let key_sound_dispatch_started_at = Instant::now();
                                        #[cfg(debug_assertions)]
                                        let dispatch_ms = key_sound_dispatch_started_at
                                            .elapsed()
                                            .as_secs_f64()
                                            * 1000.0;
                                        #[cfg(debug_assertions)]
                                        let trace = KeySoundDispatchTrace::new(
                                            key_sound_input_started_at,
                                            dispatch_ms,
                                        );
                                        app_state.key_sound.play_labels(
                                            &message.labels,
                                            #[cfg(debug_assertions)]
                                            Some(trace),
                                            #[cfg(not(debug_assertions))]
                                            None,
                                        );
                                        #[cfg(debug_assertions)]
                                        if app_state.key_sound.latency_logging_enabled() {
                                            log::debug!(
                                                "[KeySound][Latency] route=dispatch dispatchMs={dispatch_ms:.3} mode={} key={} source=soundpack",
                                                outcome.mode,
                                                _sound_canonical
                                            );
                                        }
                                    }
                                }
                            }

                            for slot_event in outcome.events {
                                if slot_event.press && is_down {
                                    app_state.increment_key_counter_and_emit(
                                        &app_handle,
                                        &outcome.mode,
                                        &slot_event.canonical,
                                    );
                                }

                                let Some(is_active) = slot_event.transition else {
                                    continue;
                                };
                                let transition_state = if is_active { "DOWN" } else { "UP" };
                                let payload = key_state_payload(
                                    &slot_event.canonical,
                                    transition_state,
                                    &outcome.mode,
                                    event_age_ms,
                                    is_active,
                                    canonical_hold_duration_ms(
                                        slot_event.can_use_physical_hold_duration,
                                        message.hold_duration_ms,
                                    ),
                                );

                                let mut emitted = false;
                                if let Some(overlay) = overlay_window.as_ref() {
                                    match overlay.emit("keys:state", &payload) {
                                        Ok(_) => emitted = true,
                                        Err(err) => {
                                            error!("failed to emit keys:state to overlay: {err}");
                                            overlay_window = None;
                                        }
                                    }
                                }
                                if !emitted {
                                    if overlay_window.is_none() {
                                        overlay_window =
                                            app_handle.get_webview_window(OVERLAY_LABEL);
                                        if let Some(overlay) = overlay_window.as_ref() {
                                            if overlay.emit("keys:state", &payload).is_ok() {
                                                emitted = true;
                                            } else {
                                                overlay_window = None;
                                            }
                                        }
                                    }
                                    if !emitted {
                                        if app_state.is_obs_mode_active() {
                                            app_state.obs_bridge.broadcast_tauri_event(
                                                "keys:state".to_string(),
                                                payload.clone(),
                                            );
                                            emitted = true;
                                        } else if let Err(err) =
                                            app_handle.emit("keys:state", &payload)
                                        {
                                            error!("failed to emit keys:state (fallback): {err}");
                                        } else {
                                            emitted = true;
                                        }
                                    }
                                }

                                if emitted {
                                    keys_state_emit_count += 1;
                                    if keys_state_emit_count.is_multiple_of(500) {
                                        log::debug!(
                                            "[AppState] emitted keys:state {} times (last key={}, state={})",
                                            keys_state_emit_count,
                                            slot_event.canonical,
                                            transition_state
                                        );
                                    }
                                }
                            }
                        }
                        Err(err) => {
                            if err.kind() == std::io::ErrorKind::Interrupted
                                || err.kind() == std::io::ErrorKind::WouldBlock
                            {
                                continue;
                            }
                            exit_reason = Some(format!("output read failed: {err}"));
                            break;
                        }
                    }
                }
                if running_reader.load(Ordering::SeqCst) {
                    let exit_reason =
                        exit_reason.unwrap_or_else(|| String::from("reader loop stopped"));
                    let daemon_uptime = daemon_started_at.elapsed();
                    let recovery_plan =
                        next_keyboard_recovery_plan(recovery_attempt, daemon_uptime);
                    if let Some(plan) = recovery_plan {
                        warn!(
                            "keyboard daemon ended unexpectedly ({exit_reason}); scheduling recovery attempt {}/{} in {} ms",
                            plan.attempt,
                            KEYBOARD_RECOVERY_DELAYS_MS.len(),
                            plan.delay.as_millis()
                        );
                    } else {
                        error!(
                            "keyboard daemon ended unexpectedly ({exit_reason}); automatic recovery limit reached after {recovery_attempt} attempts"
                        );
                    }
                    AppState::schedule_keyboard_hook_recovery(
                        app_handle,
                        generation,
                        recovery_plan,
                    );
                }
            })
            .map_err(|err| anyhow!("failed to spawn keyboard daemon reader: {err}"))?;

        let stderr_handle = if let Some(stderr) = stderr {
            match thread::Builder::new()
                .name("keyboard-daemon-stderr".into())
                .spawn(move || {
                    let reader = BufReader::new(stderr);
                    for line in reader.lines() {
                        match line {
                            Ok(text) if !text.trim().is_empty() => {
                                warn!("keyboard-daemon stderr: {text}");
                            }
                            Ok(_) => {}
                            Err(err) => {
                                error!("error reading keyboard daemon stderr: {err}");
                                break;
                            }
                        }
                    }
                }) {
                Ok(handle) => Some(handle),
                Err(err) => {
                    warn!("failed to spawn keyboard daemon stderr reader: {err}");
                    None
                }
            }
        } else {
            None
        };

        *task_slot = Some(KeyboardDaemonTask {
            generation,
            running,
            reader_handle: Some(reader_handle),
            stderr_handle,
            parent_stdin: Some(parent_stdin),
            child: Some(child),
        });
        Ok(())
    }

    fn schedule_keyboard_hook_recovery(
        app: AppHandle,
        failed_generation: u64,
        plan: Option<KeyboardRecoveryPlan>,
    ) {
        let fallback_app = app.clone();
        let spawn_result = thread::Builder::new()
            .name("keyboard-daemon-supervisor".into())
            .spawn(move || {
                if let Some(plan) = plan {
                    thread::sleep(plan.delay);
                }
                let app_state = app.state::<AppState>();
                let mut task_guard = app_state.keyboard_task.write();
                let task_generation = task_guard.as_ref().map(|task| task.generation);
                if !should_recover_keyboard_daemon(
                    app_state.shutdown_started.load(Ordering::SeqCst),
                    app_state.keyboard_task_generation.load(Ordering::SeqCst),
                    task_generation,
                    failed_generation,
                ) {
                    log::debug!(
                        "keyboard daemon recovery canceled for generation {failed_generation}"
                    );
                    return;
                }

                let previous_task = task_guard.take();
                drop(previous_task);
                if let Some(plan) = plan {
                    if let Err(err) = app_state.start_keyboard_hook_locked(
                        app.clone(),
                        &mut task_guard,
                        plan.attempt,
                        Some(failed_generation),
                    ) {
                        error!(
                            "failed to recover keyboard daemon on attempt {}: {err:#}",
                            plan.attempt
                        );
                    }
                } else {
                    app_state.reset_keyboard_hook_state(&app);
                }
            });
        if let Err(err) = spawn_result {
            error!("failed to spawn keyboard daemon supervisor: {err}");
            fallback_app
                .state::<AppState>()
                .reset_keyboard_hook_state(&fallback_app);
        }
    }

    fn reset_keyboard_hook_state(&self, app: &AppHandle) {
        self.clear_active_keys();
        if let Err(err) = app.emit("keys:reset", &json!({ "reason": "hook_restart" })) {
            warn!("failed to emit keys:reset: {err}");
        }
    }

    fn restart_keyboard_hook(&self, app: AppHandle) -> Result<()> {
        self.keyboard_task_generation.fetch_add(1, Ordering::SeqCst);
        let mut task_guard = self.keyboard_task.write();
        let previous_task = task_guard.take();
        drop(previous_task);
        self.start_keyboard_hook_locked(app, &mut task_guard, 0, None)
    }

    pub fn selection_session(&self) -> SelectionSessionSnapshot {
        self.selection_session.lock().clone()
    }

    pub fn publish_selection_session(
        &self,
        app: &AppHandle,
        snapshot: SelectionSessionSnapshot,
    ) -> Result<SelectionSessionSnapshot, String> {
        let published = publish_selection_snapshot(&self.selection_session, snapshot)?;
        app.emit("selection:changed", &published)
            .map_err(|error| error.to_string())?;
        Ok(published)
    }

    pub(crate) fn plugin_authority(&self) -> &PluginRuntimeAuthority {
        &self.plugin_authority
    }

    pub(crate) fn plugin_rpc_router(&self) -> &PluginRpcRouter {
        &self.plugin_rpc_router
    }

    pub(crate) fn reset_plugin_authority(&self) -> Result<PluginAuthorityLease<'_>, String> {
        self.plugin_authority.reset(&self.plugin_rpc_router)
    }

    pub fn mark_plugin_authority_unavailable(&self) {
        self.plugin_authority
            .mark_unavailable(&self.plugin_rpc_router);
    }

    pub fn show_panel_window(&self, app: &AppHandle, view_state: PanelViewState) -> Result<()> {
        let _creation_guard = self.panel_creation_lock.lock();
        *self.panel_view_state.lock() = Some(TargetedPanelViewState {
            target: PanelViewTarget::Panel,
            view_state,
        });
        *self.panel_destroy_reason.lock() = None;
        let result = if let Some(window) = app.get_webview_window(PANEL_LABEL) {
            let _ = window.unminimize();
            window
                .show()
                .and_then(|()| window.set_focus())
                .map_err(anyhow::Error::from)
                .and_then(|()| {
                    publish_panel_visibility_transition(&self.panel_visible, app, true, None)
                })
        } else {
            self.create_panel_window(app).and_then(|_| {
                publish_panel_visibility_transition(&self.panel_visible, app, true, None)
            })
        };
        if result.is_ok() {
            // 재시작 복원용 분리 상태 기록 (bounds와 같은 deferred 기록 보증 수준)
            if let Err(err) = self
                .store
                .update_deferred(|data| data.panel_detached = true)
            {
                log::warn!("failed to record detached panel state: {err}");
            }
        }
        if result.is_err() && app.get_webview_window(PANEL_LABEL).is_none() {
            clear_targeted_panel_view_state(
                &mut self.panel_view_state.lock(),
                PanelViewTarget::Panel,
            );
        }
        result
    }

    // 재시작 시 분리 창 재생성: 기동 시점엔 뷰 핸드오프 상태가 없어 show_panel_window를 재사용하지 않음
    // panel_view_state가 비어 있으면 패널 엔트리가 기본 뷰로 뜨고,
    // 저장 bounds와 모니터 보정은 create_panel_window의 resolve_panel_window_layout이 처리
    fn restore_panel_window_on_startup(&self, app: &AppHandle) -> Result<()> {
        let _creation_guard = self.panel_creation_lock.lock();
        if app.get_webview_window(PANEL_LABEL).is_some() {
            return Ok(());
        }
        *self.panel_destroy_reason.lock() = None;
        self.create_panel_window(app)?;
        publish_panel_visibility_transition(&self.panel_visible, app, true, None)
    }

    pub fn take_panel_view_state(&self, window_label: &str) -> Option<PanelViewState> {
        take_targeted_panel_view_state(&mut self.panel_view_state.lock(), window_label)
    }

    pub fn close_panel_window(&self, app: &AppHandle, view_state: PanelViewState) -> Result<()> {
        let _creation_guard = self.panel_creation_lock.lock();
        *self.panel_view_state.lock() = Some(TargetedPanelViewState {
            target: PanelViewTarget::Main,
            view_state,
        });
        *self.panel_close_request.lock() = PanelCloseRequestState::Closing;
        let result = self.close_panel_window_inner(app, PanelVisibilityReason::Closed);
        finish_panel_close(&self.panel_close_request);
        if result.is_err() && app.get_webview_window(PANEL_LABEL).is_some() {
            clear_targeted_panel_view_state(
                &mut self.panel_view_state.lock(),
                PanelViewTarget::Main,
            );
        }
        result
    }

    fn close_panel_window_inner(
        &self,
        app: &AppHandle,
        reason: PanelVisibilityReason,
    ) -> Result<()> {
        // 도킹 상태 기록: 명시 재부착과 close-ack 타임아웃 강제 닫힘이 모두 이 경로를 지남
        // Destroyed 핸들러에서는 기록 금지 - 종료 시 shutdown_application이 panel.destroy()를
        // 직접 호출해 같은 핸들러로 들어오므로 분리 채 종료할 때마다 플래그가 지워짐
        if let Err(err) = self
            .store
            .update_deferred(|data| data.panel_detached = false)
        {
            log::warn!("failed to record docked panel state: {err}");
        }
        *self.panel_destroy_reason.lock() = Some(reason);
        let mut bounds_error = None;
        if let Some(window) = app.get_webview_window(PANEL_LABEL) {
            if let Err(error) = self.panel_bounds_persistence.flush_now(&window) {
                bounds_error = Some(error);
            }
            if let Err(error) = window.destroy() {
                self.clear_panel_destroy_reason(reason);
                // 창이 살아 있으면 여전히 분리 상태다. 도킹 기록을 되돌리지
                // 않으면 다음 기동에서 분리 패널이 복원되지 않는다
                if let Err(err) = self
                    .store
                    .update_deferred(|data| data.panel_detached = true)
                {
                    log::warn!("failed to restore detached panel state: {err}");
                }
                return Err(error.into());
            }
        }
        self.publish_panel_hidden(app, reason)?;
        if let Some(error) = bounds_error {
            return Err(error);
        }
        Ok(())
    }

    fn publish_panel_hidden(
        &self,
        app: &AppHandle,
        fallback_reason: PanelVisibilityReason,
    ) -> Result<()> {
        publish_panel_hidden_transition(
            &self.panel_visible,
            &self.panel_destroy_reason,
            app,
            fallback_reason,
        )
    }

    fn clear_panel_destroy_reason(&self, reason: PanelVisibilityReason) {
        let mut pending = self.panel_destroy_reason.lock();
        if *pending == Some(reason) {
            *pending = None;
        }
    }

    pub fn acknowledge_panel_window_close(&self, request_id: &str) -> bool {
        acknowledge_panel_close_request(&self.panel_close_request, request_id)
    }

    pub fn is_panel_window_open(&self, app: &AppHandle) -> bool {
        app.get_webview_window(PANEL_LABEL).is_some()
    }

    pub fn capture_and_flush_panel_bounds_for_lifecycle(&self, app: &AppHandle) -> Result<()> {
        if self.shutdown_started.load(Ordering::SeqCst) {
            return Ok(());
        }
        let _creation_guard = self.panel_creation_lock.lock();
        let Some(window) = app.get_webview_window(PANEL_LABEL) else {
            return Ok(());
        };
        self.panel_bounds_persistence.flush_now(&window)
    }

    pub fn handle_panel_window_destroyed(&self, app: &AppHandle) {
        self.plugin_rpc_router.remove_window(PANEL_LABEL);
        clear_targeted_panel_view_state(&mut self.panel_view_state.lock(), PanelViewTarget::Panel);
        finish_panel_close(&self.panel_close_request);
        if let Err(error) = self.publish_panel_hidden(app, PanelVisibilityReason::Destroyed) {
            log::warn!("failed to emit destroyed panel visibility: {error}");
        }
    }

    fn create_panel_window(&self, app: &AppHandle) -> Result<WebviewWindow> {
        let monitor_data = MonitorData::gather(app);
        let snapshot = self.store.snapshot();
        let stored_bounds = snapshot.panel_bounds;
        let layout = resolve_panel_window_layout(stored_bounds, &monitor_data, None);

        let mut builder = WebviewWindowBuilder::new(app, PANEL_LABEL, WebviewUrl::App(PANEL_ENTRYPOINT.into()))
                .title("DM Note - Panel")
                // 메인·오버레이와 같은 프레임리스 크롬 - 드래그 영역은 패널 상단 스트립이 담당
                .decorations(false)
                .transparent(true)
                .shadow(true)
                .resizable(true)
                .maximizable(false)
                .always_on_top(false)
                .skip_taskbar(false)
                .focused(false)
                // 비포커스 상태의 첫 클릭이 포커스 획득에만 소비되지 않게 함
                // (유틸리티 패널 관례 - 버튼이 첫 클릭에 바로 동작)
                .accept_first_mouse(true)
                .visible(true)
                .inner_size(PANEL_WIDTH, layout.height)
                .min_inner_size(PANEL_WIDTH, layout.min_height)
                .max_inner_size(PANEL_WIDTH, layout.max_height)
                .zoom_hotkeys_enabled(false);

        if let Some(position) = layout.position {
            builder = builder.position(position.x, position.y);
        }

        let window = builder.build().context("failed to create panel window")?;

        if let Some(position) = layout.position {
            if let Err(err) = window.set_position(LogicalPosition::new(position.x, position.y)) {
                log::warn!("failed to restore panel position after build: {err}");
            }
        }

        if snapshot.developer_mode_enabled {
            window.open_devtools();
        }

        self.configure_panel_window(&window, app, layout.max_height);
        Ok(window)
    }

    fn configure_panel_window(
        &self,
        window: &WebviewWindow,
        app: &AppHandle,
        initial_max_height: f64,
    ) {
        let bounds_session = self
            .panel_bounds_persistence
            .attach(window, initial_max_height);
        let bounds_persistence = Arc::clone(&self.panel_bounds_persistence);
        let panel_window = window.clone();
        let app_handle = app.clone();

        window.on_window_event(move |event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                match panel_bounds_sample_from_window(&panel_window) {
                    Ok(sample) => bounds_persistence
                        .record_event(bounds_session, PanelBoundsChange::Snapshot(sample)),
                    Err(err) => {
                        log::warn!("failed to capture panel bounds on close request: {err}")
                    }
                }
                let Some(state) = app_handle.try_state::<AppState>() else {
                    return;
                };
                let request_id = uuid::Uuid::new_v4().to_string();
                if !begin_panel_close_request(&state.panel_close_request, &request_id) {
                    return;
                }
                let payload = PanelCloseRequestedPayload {
                    request_id: request_id.clone(),
                };
                if let Err(err) = app_handle.emit("panel:close-requested", &payload) {
                    log::warn!("failed to emit panel close request: {err}");
                }
                let timeout_app = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(PANEL_CLOSE_ACK_TIMEOUT).await;
                    let Some(state) = timeout_app.try_state::<AppState>() else {
                        return;
                    };
                    let _creation_guard = state.panel_creation_lock.lock();
                    if let Err(error) =
                        run_panel_close_timeout(&state.panel_close_request, &request_id, || {
                            state.close_panel_window_inner(
                                &timeout_app,
                                PanelVisibilityReason::Destroyed,
                            )
                        })
                    {
                        log::warn!("failed to close panel after missing ack: {error}");
                    }
                });
            }
            WindowEvent::Moved(position) => {
                bounds_persistence
                    .record_event(bounds_session, PanelBoundsChange::Moved(*position));
            }
            WindowEvent::Resized(size) => {
                bounds_persistence.record_event(bounds_session, PanelBoundsChange::Resized(*size));
            }
            WindowEvent::ScaleFactorChanged {
                scale_factor,
                new_inner_size,
                ..
            } => {
                bounds_persistence.record_event(
                    bounds_session,
                    PanelBoundsChange::ScaleFactorChanged {
                        position: panel_window.outer_position().ok(),
                        size: *new_inner_size,
                        scale_factor: *scale_factor,
                    },
                );
            }
            WindowEvent::Destroyed => {
                bounds_persistence.deactivate(bounds_session);
            }
            _ => {}
        });
    }

    fn ensure_overlay_window(&self, app: &AppHandle) -> Result<WebviewWindow> {
        if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
            return Ok(window);
        }
        let _creation_guard = self.overlay_creation_lock.lock();
        self.ensure_overlay_window_while_locked(app)
    }

    fn ensure_overlay_window_while_locked(&self, app: &AppHandle) -> Result<WebviewWindow> {
        if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
            return Ok(window);
        }

        let snapshot = self.store.snapshot();
        let monitor_data = MonitorData::gather(app);

        let (mut bounds, had_bounds, mut bounds_are_logical) = if let Some(mut bounds) =
            snapshot.overlay_bounds.clone()
        {
            let mut is_logical = snapshot.overlay_bounds_are_logical;
            if !is_logical {
                if let Some(converted) = convert_physical_bounds_to_logical(&bounds, &monitor_data)
                {
                    bounds = converted;
                    is_logical = true;
                }
            }
            (bounds, true, is_logical)
        } else {
            (
                OverlayBounds {
                    x: 0.0,
                    y: 0.0,
                    width: DEFAULT_OVERLAY_WIDTH,
                    height: DEFAULT_OVERLAY_HEIGHT,
                },
                false,
                true,
            )
        };

        let original_x = bounds.x;
        let original_y = bounds.y;
        let position = self.compute_overlay_position(&bounds, had_bounds, &monitor_data);
        bounds.x = position.x;
        bounds.y = position.y;
        let position_was_adjusted =
            (bounds.x - original_x).abs() > 0.5 || (bounds.y - original_y).abs() > 0.5;
        if !monitor_data.is_empty() {
            bounds_are_logical = true;
        }

        self.overlay_initializing.store(true, Ordering::SeqCst);

        let window_builder = {
            let window_builder = WebviewWindowBuilder::new(
                app,
                OVERLAY_LABEL,
                WebviewUrl::App("overlay/index.html".into()),
            )
            .title("DM Note - Overlay")
            .decorations(false)
            .resizable(false)
            .maximizable(false)
            .zoom_hotkeys_enabled(false);

            let window_builder = window_builder.transparent(true);

            window_builder
        };

        let window = window_builder
            .always_on_top(true)
            .skip_taskbar(false)
            // 첫 표시를 SW_SHOWNOACTIVATE로 처리하도록 tao에 지시 (포커스 미탈취)
            .focused(false)
            .visible(snapshot.overlay_visible)
            .inner_size(bounds.width, bounds.height)
            .position(bounds.x, bounds.y)
            .shadow(false)
            .devtools(true)
            .build()
            .context("failed to create overlay window")?;

        // Windows에서 WebviewWindowBuilder::position()이 무시되는 경우가 있어
        // 빌드 직후 명시적으로 위치 재설정
        if let Err(err) = window.set_position(LogicalPosition::new(bounds.x, bounds.y)) {
            log::warn!("failed to set overlay position after build: {err}");
        }

        // Windows 접근성 텍스트 크기 설정에 의한 WebView2 스케일링을 보상
        let zoom = crate::compute_compensating_zoom();
        if crate::should_apply_compensating_zoom(zoom) {
            if let Err(err) = window.set_zoom(zoom) {
                log::warn!("failed to set overlay compensating zoom: {err}");
            }
        }

        // macOS 오버레이 창 포커스 탈취 방지
        #[cfg(target_os = "macos")]
        {
            if let Err(err) = window.set_focusable(false) {
                log::warn!("failed to set overlay non-focusable on macOS: {err}");
            }
        }

        // Windows 오버레이 창 포커스 수신 방지
        // set_focusable(false): tao가 FOCUSABLE 플래그로 WS_EX_NOACTIVATE를 추적 적용
        // (raw SetWindowLongW 적용 시 이후 tao의 스타일 재적용에서 NOACTIVATE가 소실됨)
        #[cfg(target_os = "windows")]
        {
            if let Err(err) = window.set_focusable(false) {
                log::warn!("failed to set overlay non-focusable: {err}");
            }
            // 시스템 컨텍스트 메뉴 비활성화
            if let Err(err) = disable_system_context_menu(&window) {
                log::warn!("failed to disable system context menu for overlay: {err}");
            }
        }

        window.set_ignore_cursor_events(snapshot.overlay_locked)?;
        window.set_always_on_top(snapshot.always_on_top)?;
        // show_overlay_window 내부에서 호출하므로, visible일 때만 적용
        // hidden 상태에서 호출 시 orderFrontRegardless가 윈도우를 강제 표시함
        #[cfg(target_os = "macos")]
        if snapshot.overlay_visible {
            apply_macos_overlay_fullscreen_behavior(&window, snapshot.always_on_top);
        }
        let _ = window.set_maximizable(false);

        self.configure_overlay_window(&window, app);

        // 위치가 보정되었거나 logical 플래그 동기화가 필요한 경우에만 store 갱신
        let needs_logical_sync = bounds_are_logical && !snapshot.overlay_bounds_are_logical;
        if position_was_adjusted || !had_bounds || needs_logical_sync {
            if let Err(err) = self.store.update(|state| {
                state.overlay_bounds = Some(bounds.clone());
                state.overlay_bounds_are_logical = bounds_are_logical;
            }) {
                log::warn!("failed to persist initial overlay bounds: {err}");
            }
        }

        // overlay_initializing은 첫 resize_overlay 호출 시 해제됨
        // (프론트엔드 초기 렌더에서 resize가 반드시 호출되므로)

        // 모든 플랫폼별 설정(WS_EX_NOACTIVATE 등)이 완료된 후,
        // store의 overlay_visible 상태에 따라 조건부 표시
        if snapshot.overlay_visible {
            // SW_SHOWNOACTIVATE 표시로 포커스 미탈취 보장
            show_overlay_window(&window, snapshot.always_on_top)?;
            *self.overlay_visible.write() = true;
        } else {
            hide_overlay_window(&window)?;
            *self.overlay_visible.write() = false;
        }

        Ok(window)
    }

    fn configure_overlay_window(&self, window: &WebviewWindow, app: &AppHandle) {
        let overlay_visible = self.overlay_visible.clone();
        let store = self.store.clone();
        let app_handle = app.clone();
        let overlay_window = window.clone();
        let force_close_flag = self.overlay_force_close.clone();
        let initializing_flag = self.overlay_initializing.clone();
        let bounds_generation = self.overlay_bounds_generation.clone();

        window.on_window_event(move |event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                if force_close_flag.load(Ordering::SeqCst) {
                    // 앱 종료 시 — 실제 close 허용
                    *overlay_visible.write() = false;
                } else {
                    api.prevent_close();
                    if let Err(err) =
                        flush_deferred_overlay_bounds(&store, &bounds_generation)
                    {
                        log::warn!("failed to flush overlay bounds on close: {err}");
                        return;
                    }
                    // 숨김 먼저, 저장은 성공 후 — set_overlay_visibility와 같은 전환 계약
                    if let Err(err) = overlay_window.hide() {
                        log::error!("failed to hide overlay window on close: {err}");
                        return;
                    }
                    if let Err(err) = store.update(|state| {
                        state.overlay_visible = false;
                    }) {
                        log::warn!("failed to persist overlay visibility on close: {err}");
                        // 보상: 숨김을 되돌려 전 계층을 이전 상태로 일치
                        if let Err(show_err) = overlay_window.show() {
                            // 보상 실패 — 실제 창 상태(숨김)를 권위로 runtime과 이벤트만 동기화
                            log::error!("failed to compensate overlay hide: {show_err}");
                            *overlay_visible.write() = false;
                            let _ = app_handle
                                .emit("overlay:visibility", &json!({ "visible": false }));
                        }
                        return;
                    }
                    *overlay_visible.write() = false;
                    if let Err(err) =
                        app_handle.emit("overlay:visibility", &json!({ "visible": false }))
                    {
                        log::error!("failed to emit overlay visibility change: {err}");
                    }
                }
            }
            WindowEvent::Focused(true) => {
                // WS_EX_NOACTIVATE 적용 시 미발생 예상 이벤트
                log::debug!("overlay received focus event (unexpected with WS_EX_NOACTIVATE)");
            }
            WindowEvent::Focused(false) => {
                let snapshot = store.snapshot();
                if let Err(err) = overlay_window.set_always_on_top(snapshot.always_on_top) {
                    log::warn!("failed to reapply always on top: {err}");
                }
                #[cfg(target_os = "macos")]
                apply_macos_overlay_fullscreen_behavior(&overlay_window, snapshot.always_on_top);
            }
            WindowEvent::Moved(_) | WindowEvent::Resized(_)
                // 윈도우 초기화 중에는 OS가 보고하는 좌표로 저장된 bounds를 덮어쓰지 않음
                if !initializing_flag.load(Ordering::SeqCst) => {
                    if let Err(err) = defer_overlay_bounds_from_window(
                        &overlay_window,
                        &store,
                        &bounds_generation,
                    ) {
                        log::warn!("failed to defer overlay bounds: {err}");
                    }
                }
            _ => {}
        });
    }

    fn compute_overlay_position(
        &self,
        bounds: &OverlayBounds,
        had_stored_bounds: bool,
        monitors: &MonitorData,
    ) -> OverlayPosition {
        // 최소 가시 면적 — 오버레이 전체 면적의 25% 또는 100×100 중 작은 값
        let min_visible_area = (bounds.width * bounds.height * 0.25).min(100.0 * 100.0);

        if monitors.is_empty() {
            return if had_stored_bounds {
                OverlayPosition {
                    x: bounds.x,
                    y: bounds.y,
                }
            } else {
                OverlayPosition {
                    x: OVERLAY_MARGIN,
                    y: OVERLAY_MARGIN,
                }
            };
        }

        let fallback = monitors
            .primary_spec()
            .cloned()
            .or_else(|| monitors.first().cloned());

        let Some(fallback_spec) = fallback else {
            return OverlayPosition {
                x: bounds.x,
                y: bounds.y,
            };
        };

        // 저장된 위치가 없으면 기본 위치로 배치 (clamp 적용)
        if !had_stored_bounds {
            let base_x = fallback_spec.logical_origin_x + fallback_spec.logical_width
                - bounds.width
                - OVERLAY_MARGIN;
            let base_y = fallback_spec.logical_origin_y + fallback_spec.logical_height
                - bounds.height
                - OVERLAY_MARGIN;
            return fallback_spec.clamp(base_x, base_y, bounds.width, bounds.height);
        }

        // 저장된 bounds와 가장 많이 겹치는 모니터 탐색
        if let Some(best) =
            monitors.find_best_overlap(bounds.x, bounds.y, bounds.width, bounds.height)
        {
            let area = best.intersection_area(bounds.x, bounds.y, bounds.width, bounds.height);
            if area >= min_visible_area {
                // 충분히 보이므로 저장 좌표 그대로 복원
                return OverlayPosition {
                    x: bounds.x,
                    y: bounds.y,
                };
            }
            // 겹침이 부족하면 해당 모니터에 clamp
            return best.clamp(bounds.x, bounds.y, bounds.width, bounds.height);
        }

        // 어떤 모니터와도 겹치지 않음 — fallback 모니터에 clamp
        fallback_spec.clamp(bounds.x, bounds.y, bounds.width, bounds.height)
    }

    fn apply_settings_effects(&self, diff: &SettingsDiff, app: &AppHandle) -> Result<()> {
        // 오버레이가 보이는 상태일 때만 설정 적용
        let is_visible = *self.overlay_visible.read();

        if let Some(value) = diff.changed.always_on_top {
            if is_visible {
                if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
                    window.set_always_on_top(value)?;
                    #[cfg(target_os = "macos")]
                    apply_macos_overlay_fullscreen_behavior(&window, value);
                }
            }
        }

        if let Some(value) = diff.changed.overlay_locked {
            // 오버레이가 보이는 상태일 때만 lock 설정 적용
            // 비표시 상태: 설정값 저장 완료, 오버레이 열 때 적용
            if is_visible {
                if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
                    window.set_ignore_cursor_events(value)?;
                }
            }
            app.emit("overlay:lock", &json!({ "locked": value }))?;
        }

        if let Some(enabled) = diff.changed.developer_mode_enabled {
            // 활성화 시에만 DevTools 열기
            if enabled {
                if let Some(main) = app.get_webview_window("main") {
                    main.open_devtools();
                }
                if let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) {
                    overlay.open_devtools();
                }
                if let Some(panel) = app.get_webview_window(PANEL_LABEL) {
                    panel.open_devtools();
                }
            }
        }

        if let Some(enabled) = diff.changed.tray_enabled {
            if !enabled {
                dispatch_remove_tray_icon(app)?;
                if let Err(err) = self.set_main_window_hidden(false) {
                    log::warn!(
                        "failed to clear main_window_hidden when disabling tray mode: {err}"
                    );
                }
            } else if self.store.snapshot().main_window_hidden {
                self.ensure_tray_icon_for_background(app)?;
            }
        }

        if diff.changed.shortcuts.is_some() {
            // 변경된 글로벌 단축키 적용을 위해 키보드 daemon 재시작
            self.restart_keyboard_hook(app.clone())?;
        }

        Ok(())
    }

    pub(crate) fn increment_key_counter_and_emit(
        &self,
        emitter: &dyn KeyCounterEventEmitter,
        mode: &str,
        key: &str,
    ) -> Option<u32> {
        if !self.key_counter_enabled.load(Ordering::Relaxed) {
            return None;
        }
        {
            let mut barrier = self.counter_history_barrier.lock();
            if barrier.queueing {
                barrier.queued.push_back(QueuedCounterIncrement {
                    mode: mode.to_string(),
                    key: key.to_string(),
                });
                return None;
            }
            barrier.active_increments = barrier.active_increments.saturating_add(1);
        }
        let mut counters = self.key_counters.write();
        let mode_entry = counters.entry(mode.to_string()).or_default();
        let count = mode_entry.entry(key.to_string()).or_insert(0);
        *count = count.saturating_add(1);
        let count = *count;
        let publication_generation = self.store.runtime_publication_generation();
        let mut publication = self.runtime_publication.lock();
        publication.counters_generation =
            publication.counters_generation.max(publication_generation);
        drop(publication);
        log::trace!(
            "[IPC] emit keys:counter: mode={}, key={}, count={}",
            mode,
            key,
            count
        );
        let revision = self.next_key_counters_revision();
        let emit_result =
            emitter.emit_key_counter(mode, key, count, &self.key_counters_session_id, revision);
        drop(counters);
        if let Err(err) = emit_result {
            error!("failed to emit keys:counter event: {err}");
        }
        let mut barrier = self.counter_history_barrier.lock();
        barrier.active_increments = barrier.active_increments.saturating_sub(1);
        if barrier.active_increments == 0 {
            self.counter_history_ready.notify_all();
        }
        Some(count)
    }

    pub fn snapshot_key_counters(&self) -> KeyCounters {
        self.key_counters.read().clone()
    }

    /// key_counters write lock 보유 중에만 호출 — 스냅샷과 이벤트 revision의 인과 순서 보장
    fn next_key_counters_revision(&self) -> u64 {
        self.key_counters_revision
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_add(1)
    }

    pub(crate) fn begin_counter_history_barrier(&self) {
        let mut barrier = self.counter_history_barrier.lock();
        debug_assert!(!barrier.queueing, "counter history barrier already active");
        barrier.queueing = true;
        while barrier.active_increments != 0 {
            self.counter_history_ready.wait(&mut barrier);
        }
    }

    pub(crate) fn lock_key_counters_for_history(
        &self,
    ) -> parking_lot::RwLockWriteGuard<'_, KeyCounters> {
        self.key_counters.write()
    }

    pub(crate) fn replace_history_counters_locked(
        &self,
        guard: &mut KeyCounters,
        generation: u64,
        counters: &KeyCounters,
    ) -> bool {
        let mut publication = self.runtime_publication.lock();
        if generation <= publication.counters_generation {
            return false;
        }
        *guard = counters.clone();
        publication.counters_generation = generation;
        true
    }

    pub(crate) fn finish_counter_history_barrier(
        &self,
        emitter: &dyn KeyCounterEventEmitter,
        mut counters: parking_lot::RwLockWriteGuard<'_, KeyCounters>,
        counters_restored: bool,
        publication_generation: u64,
    ) {
        let queued_count = {
            let mut barrier = self.counter_history_barrier.lock();
            let queued_count = barrier.queued.len();
            while let Some(increment) = barrier.queued.pop_front() {
                let count = counters
                    .entry(increment.mode)
                    .or_default()
                    .entry(increment.key)
                    .or_insert(0);
                *count = count.saturating_add(1);
            }
            barrier.queueing = false;
            queued_count
        };
        if queued_count != 0 {
            let mut publication = self.runtime_publication.lock();
            publication.counters_generation =
                publication.counters_generation.max(publication_generation);
        }
        if counters_restored || queued_count != 0 {
            let revision = self.next_key_counters_revision();
            if let Err(error) =
                emitter.emit_key_counters(&counters, &self.key_counters_session_id, revision)
            {
                log::error!("failed to emit restored key counters: {error:#}");
            }
        }
    }

    #[cfg(test)]
    fn update_key_counters_and_emit(
        &self,
        emitter: &dyn KeyCounterEventEmitter,
        observed_history_epoch: Option<u64>,
        updater: impl FnOnce(&mut KeyCounters),
    ) -> std::result::Result<AdmittedCounterMutation, EditorCommitError> {
        let admission = self.store.admit_editor_mutation()?;
        self.update_key_counters_and_emit_with_admission(
            emitter,
            observed_history_epoch,
            admission,
            updater,
        )
    }

    fn update_key_counters_and_emit_with_admission(
        &self,
        emitter: &dyn KeyCounterEventEmitter,
        observed_history_epoch: Option<u64>,
        admission: HistoryAdmissionLease,
        updater: impl FnOnce(&mut KeyCounters),
    ) -> std::result::Result<AdmittedCounterMutation, EditorCommitError> {
        let mut guard = self.key_counters.write();
        let before = guard.clone();
        let mut scratch = before.clone();
        updater(&mut scratch);
        let (persisted, history_status, publication_generation) = self
            .store
            .commit_key_counters_admitted(before, scratch, observed_history_epoch, &admission)?;
        let mut publication = self.runtime_publication.lock();
        if publication_generation > publication.counters_generation {
            *guard = persisted.clone();
            let revision = self.next_key_counters_revision();
            let emit_result =
                emitter.emit_key_counters(&guard, &self.key_counters_session_id, revision);
            publication.counters_generation = publication_generation;
            emit_result.map_err(|error| EditorCommitError::io(error.to_string()))?;
        }
        Ok(AdmittedCounterMutation {
            counters: persisted,
            history_status,
            _admission: admission,
        })
    }

    #[cfg(test)]
    pub(crate) fn reset_key_counters(
        &self,
        emitter: &dyn KeyCounterEventEmitter,
        observed_history_epoch: Option<u64>,
    ) -> std::result::Result<AdmittedCounterMutation, EditorCommitError> {
        self.update_key_counters_and_emit(emitter, observed_history_epoch, |counters| {
            for mode_entry in counters.values_mut() {
                for value in mode_entry.values_mut() {
                    *value = 0;
                }
            }
        })
    }

    pub(crate) fn reset_key_counters_with_admission(
        &self,
        emitter: &dyn KeyCounterEventEmitter,
        observed_history_epoch: Option<u64>,
        admission: HistoryAdmissionLease,
    ) -> std::result::Result<AdmittedCounterMutation, EditorCommitError> {
        self.update_key_counters_and_emit_with_admission(
            emitter,
            observed_history_epoch,
            admission,
            |counters| {
                for mode_entry in counters.values_mut() {
                    for value in mode_entry.values_mut() {
                        *value = 0;
                    }
                }
            },
        )
    }

    #[cfg(test)]
    pub(crate) fn replace_key_counters(
        &self,
        emitter: &dyn KeyCounterEventEmitter,
        counters: KeyCounters,
        observed_history_epoch: Option<u64>,
    ) -> std::result::Result<AdmittedCounterMutation, EditorCommitError> {
        self.update_key_counters_and_emit(emitter, observed_history_epoch, |scratch| {
            *scratch = counters;
        })
    }

    pub(crate) fn replace_key_counters_with_admission(
        &self,
        emitter: &dyn KeyCounterEventEmitter,
        counters: KeyCounters,
        observed_history_epoch: Option<u64>,
        admission: HistoryAdmissionLease,
    ) -> std::result::Result<AdmittedCounterMutation, EditorCommitError> {
        self.update_key_counters_and_emit_with_admission(
            emitter,
            observed_history_epoch,
            admission,
            |scratch| {
                *scratch = counters;
            },
        )
    }

    pub(crate) fn reset_mode_counters_with_admission(
        &self,
        emitter: &dyn KeyCounterEventEmitter,
        mode: &str,
        observed_history_epoch: Option<u64>,
        admission: HistoryAdmissionLease,
    ) -> std::result::Result<AdmittedCounterMutation, EditorCommitError> {
        self.update_key_counters_and_emit_with_admission(
            emitter,
            observed_history_epoch,
            admission,
            |counters| {
                if let Some(entry) = counters.get_mut(mode) {
                    for value in entry.values_mut() {
                        *value = 0;
                    }
                }
            },
        )
    }

    pub(crate) fn reset_single_key_counter_with_admission(
        &self,
        emitter: &dyn KeyCounterEventEmitter,
        mode: &str,
        key: &str,
        observed_history_epoch: Option<u64>,
        admission: HistoryAdmissionLease,
    ) -> std::result::Result<AdmittedCounterMutation, EditorCommitError> {
        self.update_key_counters_and_emit_with_admission(
            emitter,
            observed_history_epoch,
            admission,
            |counters| {
                if let Some(entry) = counters.get_mut(mode) {
                    if let Some(value) = entry.get_mut(key) {
                        *value = 0;
                    }
                }
            },
        )
    }

    pub fn clear_active_keys(&self) {
        self.keyboard.clear_active_keys();
    }

    pub fn persist_key_counters(&self) -> Result<KeyCounters> {
        let snapshot = self.key_counters.read().clone();
        self.store.set_key_counters(snapshot.clone())?;
        Ok(snapshot)
    }

    pub(crate) fn apply_committed_editor_key_runtime(
        &self,
        emitter: &dyn KeyCounterEventEmitter,
        generation: u64,
        keys: &KeyMappings,
        selected_key_type: &str,
        counters: &KeyCounters,
    ) -> Result<()> {
        let mut counter_guard = self.key_counters.write();
        self.apply_committed_editor_key_runtime_locked(
            emitter,
            &mut counter_guard,
            generation,
            keys,
            selected_key_type,
            counters,
        )
    }

    pub(crate) fn apply_committed_editor_key_runtime_locked(
        &self,
        emitter: &dyn KeyCounterEventEmitter,
        counter_guard: &mut KeyCounters,
        generation: u64,
        keys: &KeyMappings,
        selected_key_type: &str,
        counters: &KeyCounters,
    ) -> Result<()> {
        let mut publication = self.runtime_publication.lock();
        Self::apply_key_runtime_if_current(
            &self.keyboard,
            &mut publication,
            generation,
            keys,
            selected_key_type,
        );
        if generation <= publication.counters_generation {
            return Ok(());
        }
        *counter_guard = counters.clone();
        let revision = self.next_key_counters_revision();
        let emit_result =
            emitter.emit_key_counters(counter_guard, &self.key_counters_session_id, revision);
        publication.counters_generation = generation;
        emit_result
    }

    pub(crate) fn apply_committed_editor_keys_without_counters(
        &self,
        generation: u64,
        keys: &KeyMappings,
        selected_key_type: &str,
    ) -> bool {
        let mut publication = self.runtime_publication.lock();
        Self::apply_key_runtime_if_current(
            &self.keyboard,
            &mut publication,
            generation,
            keys,
            selected_key_type,
        )
    }

    fn apply_key_runtime_if_current(
        keyboard: &KeyboardManager,
        publication: &mut RuntimePublicationState,
        generation: u64,
        keys: &KeyMappings,
        selected_key_type: &str,
    ) -> bool {
        let mappings_current = generation >= publication.mappings_generation;
        let mode_current = generation >= publication.mode_generation
            && generation >= publication.mappings_generation;
        match (mappings_current, mode_current) {
            (true, true) => {
                keyboard.update_mappings_and_set_mode(keys.clone(), selected_key_type.to_string());
            }
            (true, false) => keyboard.update_mappings(keys.clone()),
            (false, true) => {
                keyboard.set_mode(selected_key_type.to_string());
            }
            (false, false) => {}
        }
        if mappings_current {
            publication.mappings_generation = generation;
        }
        if mode_current {
            publication.mode_generation = generation;
        }
        mode_current
    }

    fn sync_counters_with_keys_impl(target: &mut KeyCounters, keys: &KeyMappings) {
        target.retain(|mode, _| keys.contains_key(mode));
        for (mode, key_list) in keys.iter() {
            let entry = target.entry(mode.clone()).or_default();
            let canonical_keys = key_list
                .iter()
                .map(KeySlot::canonical)
                .collect::<HashSet<_>>();
            entry.retain(|key, _| canonical_keys.contains(key));
            for key in canonical_keys {
                entry.entry(key).or_insert(0);
            }
        }
    }

    /// Subscribe to raw input stream (increment subscriber count)
    pub fn subscribe_raw_input(&self) -> u32 {
        self.raw_input_subscribers.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Unsubscribe from raw input stream (decrement subscriber count)
    pub fn unsubscribe_raw_input(&self) -> u32 {
        let prev = self.raw_input_subscribers.fetch_sub(1, Ordering::SeqCst);
        if prev == 0 {
            // 언더플로우 방지
            self.raw_input_subscribers.store(0, Ordering::SeqCst);
            0
        } else {
            prev - 1
        }
    }

    /// Get current raw input subscriber count
    pub fn raw_input_subscriber_count(&self) -> u32 {
        self.raw_input_subscribers.load(Ordering::Relaxed)
    }

    pub fn key_sound_status(&self) -> KeySoundStatus {
        self.key_sound.status()
    }

    pub fn key_sound_set_enabled(&self, enabled: bool) -> KeySoundStatus {
        self.key_sound.set_enabled(enabled)
    }

    pub fn key_sound_set_volume(&self, volume: f32) -> KeySoundStatus {
        self.key_sound.set_volume(volume)
    }

    pub fn key_sound_set_latency_logging(&self, enabled: bool) -> KeySoundStatus {
        self.key_sound.set_latency_logging(enabled)
    }

    pub fn key_sound_list_output_devices(&self) -> KeySoundOutputDevices {
        self.key_sound.list_output_devices()
    }

    pub fn key_sound_set_output_backend(
        &self,
        backend: KeySoundOutputBackend,
    ) -> Result<KeySoundOutputState> {
        let requested = match &backend {
            KeySoundOutputBackend::DefaultDevice => KeySoundOutputBackend::DefaultDevice,
            KeySoundOutputBackend::Asio {
                driver_name,
                buffer_size,
            } => KeySoundOutputBackend::Asio {
                driver_name: driver_name.trim().to_string(),
                buffer_size: buffer_size.filter(|size| *size > 0),
            },
        };
        self.store.update(|state| {
            state.key_sound_output_backend = Some(output_backend_to_persist(requested));
        })?;
        Ok(self.key_sound.set_output_backend(backend))
    }

    pub fn key_sound_get_output_state(&self) -> KeySoundOutputState {
        self.key_sound.output_state()
    }

    pub fn key_sound_latency_logging_available(&self) -> bool {
        self.key_sound.latency_logging_available()
    }

    pub fn key_sound_load_soundpack(&self, soundpack_dir: &str) -> Result<KeySoundStatus, String> {
        self.key_sound
            .load_soundpack_dir(soundpack_dir)
            .map_err(|err| err.to_string())
    }

    pub fn key_sound_unload_soundpack(&self) -> KeySoundStatus {
        self.key_sound.unload_soundpack()
    }

    pub fn key_sound_invalidate_file_cache(&self, path: &str) {
        self.key_sound.invalidate_file_cache(path);
    }

    fn resolve_key_sound_binding(
        &self,
        mode: &str,
        slot_indices: &[usize],
    ) -> Option<(String, f32)> {
        self.store.with_state(|state| {
            let positions = state.key_positions.get(mode)?;

            for index in slot_indices {
                let Some(position) = positions.get(*index) else {
                    continue;
                };

                if !position.sound_enabled.unwrap_or(false) {
                    continue;
                }
                let Some(sound_path) = position.sound_path.as_ref() else {
                    continue;
                };
                let trimmed_path = sound_path.trim();
                if trimmed_path.is_empty() {
                    continue;
                }

                let volume_percent = position.sound_volume.unwrap_or(100.0);
                let per_key_volume = (volume_percent / 100.0).clamp(0.0, 2.0) as f32;
                return Some((trimmed_path.to_string(), per_key_volume));
            }

            None
        })
    }

    // ========== CSS 핫리로딩 관련 메서드 ==========

    pub(crate) fn lock_css_operation(&self) -> parking_lot::MutexGuard<'_, ()> {
        self.css_operation_lock.lock()
    }

    pub(crate) fn authorize_css_path(&self, path: &str) {
        self.authorized_css_paths
            .write()
            .insert(path_identity_key(Path::new(path)));
    }

    pub(crate) fn is_css_path_authorized(&self, path: &str) -> bool {
        self.authorized_css_paths
            .read()
            .contains(&path_identity_key(Path::new(path)))
    }

    pub(crate) fn resync_global_css_watcher(
        &self,
        previous: &AppStoreData,
        current: &AppStoreData,
    ) {
        let previous_path = global_css_watch_path(previous);
        let current_path = global_css_watch_path(current);
        if previous_path == current_path {
            return;
        }

        self.unwatch_global_css();
        if let Some(path) = current_path {
            if let Err(error) = self.watch_global_css(path) {
                log::warn!("[AppState] Failed to resync global CSS watcher: {error}");
            }
        }
    }

    /// CSS 워처 초기화
    fn initialize_css_watcher(&self, app: &AppHandle) {
        let watcher = CssWatcher::new(self.store.clone(), app.clone());
        watcher.initialize_from_store();
        *self.css_watcher.write() = Some(watcher);
        log::info!("[AppState] CSS watcher initialized");
    }

    /// 전역 CSS 파일 워칭 시작
    pub fn watch_global_css(&self, path: &str) -> Result<(), String> {
        if let Some(watcher) = self.css_watcher.read().as_ref() {
            watcher.watch_global(path)
        } else {
            Err("CSS watcher not initialized".to_string())
        }
    }

    /// 전역 CSS 파일 워칭 중지
    pub fn unwatch_global_css(&self) {
        if let Some(watcher) = self.css_watcher.read().as_ref() {
            watcher.unwatch_global();
        }
    }

    /// 탭별 CSS 파일 워칭 시작
    pub fn watch_tab_css(&self, path: &str, tab_id: &str) -> Result<(), String> {
        if let Some(watcher) = self.css_watcher.read().as_ref() {
            watcher.watch_tab(path, tab_id)
        } else {
            Err("CSS watcher not initialized".to_string())
        }
    }

    /// 탭별 CSS 파일 워칭 중지
    pub fn unwatch_tab_css(&self, tab_id: &str) {
        if let Some(watcher) = self.css_watcher.read().as_ref() {
            watcher.unwatch_tab(tab_id);
        }
    }

    pub(crate) fn resync_tab_css_watchers(&self, overrides: &TabCssOverrides) {
        if let Some(watcher) = self.css_watcher.read().as_ref() {
            watcher.resync_tabs(overrides);
        }
    }
}

fn global_css_watch_path(state: &AppStoreData) -> Option<&str> {
    state
        .use_custom_css
        .then_some(state.custom_css.path.as_deref())
        .flatten()
}

fn collect_authorized_css_paths(state: &AppStoreData) -> HashSet<String> {
    state
        .custom_css
        .path
        .iter()
        .chain(
            state
                .tab_css_overrides
                .values()
                .filter_map(|css| css.path.as_ref()),
        )
        .map(|path| path_identity_key(Path::new(path)))
        .collect()
}

impl Drop for AppState {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn output_backend_from_persist(value: KeySoundOutputBackendPersist) -> KeySoundOutputBackend {
    match value {
        KeySoundOutputBackendPersist::DefaultDevice => KeySoundOutputBackend::DefaultDevice,
        KeySoundOutputBackendPersist::Asio {
            driver_name,
            buffer_size,
        } => KeySoundOutputBackend::Asio {
            driver_name,
            buffer_size,
        },
    }
}

fn output_backend_to_persist(value: KeySoundOutputBackend) -> KeySoundOutputBackendPersist {
    match value {
        KeySoundOutputBackend::DefaultDevice => KeySoundOutputBackendPersist::DefaultDevice,
        KeySoundOutputBackend::Asio {
            driver_name,
            buffer_size,
        } => KeySoundOutputBackendPersist::Asio {
            driver_name,
            buffer_size,
        },
    }
}

fn attach_main_window_close_handler(
    window: WebviewWindow,
    overlay_force_close: Arc<AtomicBool>,
    app_handle: AppHandle,
) {
    // 시스템 컨텍스트 메뉴 비활성화
    #[cfg(target_os = "windows")]
    {
        if let Err(err) = disable_system_context_menu(&window) {
            log::warn!("failed to disable system context menu for main window: {err}");
        }
    }

    let main_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            if overlay_force_close.load(Ordering::SeqCst) {
                return;
            }

            let state = app_handle.state::<AppState>();
            if state.store.snapshot().tray_enabled {
                api.prevent_close();
                if let Err(err) = main_window.hide() {
                    log::warn!("failed to hide main window for tray mode: {err}");
                }
                if let Err(err) = state.set_main_window_hidden(true) {
                    log::warn!("failed to persist main hidden state: {err}");
                }
                if let Err(err) = state.ensure_tray_icon_for_background(&app_handle) {
                    log::warn!("failed to create tray icon: {err}");
                }
                return;
            }

            api.prevent_close();
            state.request_frontend_shutdown(app_handle.clone());
        }
    });
}

fn execute_frontend_lifecycle(
    app_handle: AppHandle,
    action: FrontendLifecycleAction,
    overlay_force_close: Arc<AtomicBool>,
) {
    match action {
        FrontendLifecycleAction::Quit => {
            if overlay_force_close.swap(true, Ordering::SeqCst) {
                return;
            }
            thread::spawn(move || shutdown_application(app_handle));
        }
        FrontendLifecycleAction::Restart => {
            if overlay_force_close.swap(true, Ordering::SeqCst) {
                return;
            }
            let state = app_handle.state::<AppState>();
            state.arm_shutdown_watchdog("app-restart");
            if let Err(err) = state.capture_and_flush_panel_bounds_for_lifecycle(&app_handle) {
                log::warn!("failed to persist panel bounds before restart: {err}");
            }
            state.shutdown();
            state.authorize_process_exit();
            #[cfg(target_os = "macos")]
            match super::macos_termination::restart_after_canceling_pending_termination(&app_handle)
            {
                Ok(true) => return,
                Ok(false) => {}
                Err(error) => {
                    log::warn!(
                        "failed to cancel pending macOS termination before restart: {error}"
                    );
                }
            }
            app_handle.request_restart();
        }
    }
}

fn tray_menu_labels(_language: &str) -> (&'static str, &'static str) {
    ("Settings", "Quit")
}

fn remove_tray_icon(app: &AppHandle) {
    let _ = app.remove_tray_by_id(TRAY_ICON_ID);
}

fn dispatch_remove_tray_icon(app: &AppHandle) -> Result<()> {
    let app_handle = app.clone();
    app.run_on_main_thread(move || remove_tray_icon(&app_handle))?;
    Ok(())
}

fn shutdown_application(app_handle: AppHandle) {
    app_handle
        .state::<AppState>()
        .arm_shutdown_watchdog("background state shutdown");

    let main_hidden = app_handle
        .get_webview_window("main")
        .and_then(|window| window.is_visible().ok().map(|visible| !visible))
        .unwrap_or(false);

    {
        let state = app_handle.state::<AppState>();
        let tray_enabled = state.store.snapshot().tray_enabled;
        let persist_hidden = tray_enabled && main_hidden;
        if let Err(err) = state.set_main_window_hidden(persist_hidden) {
            log::warn!("failed to persist main hidden state during shutdown: {err}");
        }
        if let Err(err) = state.capture_and_flush_panel_bounds_for_lifecycle(&app_handle) {
            log::warn!("failed to persist panel bounds during shutdown: {err}");
        }
        state.shutdown();
        state.set_shutdown_watchdog_stage("overlay window close");
    }

    if let Some(overlay) = app_handle.get_webview_window(OVERLAY_LABEL) {
        if let Err(err) = overlay.close() {
            log::warn!("failed to close overlay window during shutdown: {err}");
        }
    }
    if let Some(panel) = app_handle.get_webview_window(PANEL_LABEL) {
        if let Err(err) = panel.destroy() {
            log::warn!("failed to destroy panel window during shutdown: {err}");
        }
    }

    {
        let state = app_handle.state::<AppState>();
        state.authorize_process_exit();
        state.set_shutdown_watchdog_stage("main event loop exit dispatch");
    }
    #[cfg(target_os = "macos")]
    match super::macos_termination::complete_pending_termination(&app_handle) {
        Ok(true) => return,
        Ok(false) => {}
        Err(error) => {
            log::warn!("failed to complete pending macOS termination: {error}");
        }
    }
    let app_for_exit = app_handle.clone();
    if let Err(err) = app_handle.run_on_main_thread(move || {
        remove_tray_icon(&app_for_exit);
        app_for_exit.exit(0);
    }) {
        log::warn!("failed to dispatch tray cleanup during shutdown: {err}");
        app_handle.exit(0);
    }
}

/// 오버레이 창 알파를 페이드 - 트랙 예약 토글처럼 창 프레임과 콘텐츠가 함께 바뀌는 전환을 가린다
/// 창 프레임 변경과 웹뷰 리페인트는 프로세스 경계라 같은 프레임에 커밋될 수 없음
/// 반환값은 페이드 적용 여부 - false면 호출부가 가림 없이 즉시 전환해야 한다
pub(crate) fn fade_overlay_window(app: &AppHandle, alpha: f64, duration_ms: u64) -> Result<bool> {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
        // OBS 모드 등 창 미존재 시 무시
        return Ok(false);
    };
    #[cfg(target_os = "macos")]
    {
        let alpha = alpha.clamp(0.0, 1.0);
        let duration = (duration_ms as f64 / 1000.0).max(0.0);
        let target = window.clone();
        app.run_on_main_thread(move || {
            use objc::{class, msg_send, sel, sel_impl};

            match target.ns_window() {
                Ok(ns_window) => unsafe {
                    let ns_window = ns_window as *mut objc::runtime::Object;
                    if duration <= 0.0 {
                        let _: () = msg_send![ns_window, setAlphaValue: alpha];
                    } else {
                        let _: () = msg_send![class!(NSAnimationContext), beginGrouping];
                        let ctx: *mut objc::runtime::Object =
                            msg_send![class!(NSAnimationContext), currentContext];
                        let _: () = msg_send![ctx, setDuration: duration];
                        let animator: *mut objc::runtime::Object = msg_send![ns_window, animator];
                        let _: () = msg_send![animator, setAlphaValue: alpha];
                        let _: () = msg_send![class!(NSAnimationContext), endGrouping];
                    }
                },
                Err(err) => log::warn!("overlay fade: failed to get NSWindow handle: {err}"),
            }
        })?;
        Ok(true)
    }
    #[cfg(not(target_os = "macos"))]
    {
        // 네이티브 창 알파 미지원 - false를 돌려 렌더러가 콘텐츠 페이드로 대체한다
        let _ = (alpha, duration_ms, window);
        Ok(false)
    }
}

/// 오버레이 표시 시 알파를 1로 복원 - 페이드 도중 종료된 전환이 남긴 투명 상태의 마지막 방어선
#[cfg(target_os = "macos")]
fn reset_overlay_alpha(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    let target = window.clone();
    let _ = app.run_on_main_thread(move || {
        use objc::{msg_send, sel, sel_impl};

        if let Ok(ns_window) = target.ns_window() {
            let ns_window = ns_window as *mut objc::runtime::Object;
            unsafe {
                let _: () = msg_send![ns_window, setAlphaValue: 1.0f64];
            }
        }
    });
}

/// 오버레이 크기와 위치를 한 번의 네이티브 호출로 적용
/// set_size와 set_position을 나눠 부르면 창 이동이 두 트랜잭션으로 쪼개져 중간 프레임이 보인다
fn apply_overlay_frame(
    window: &WebviewWindow,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    scale_factor: f64,
) -> Result<OverlayBounds> {
    let requested = OverlayBounds {
        x,
        y,
        width,
        height,
    };
    #[cfg(target_os = "macos")]
    {
        use objc::{class, msg_send, sel, sel_impl};

        let _ = scale_factor;
        // 메인 스레드에서 큐잉 후 대기하면 교착하므로 직접 실행
        let on_main: bool = unsafe { msg_send![class!(NSThread), isMainThread] };
        if on_main {
            return Ok(apply_overlay_frame_macos(window, x, y, width, height).unwrap_or(requested));
        }

        let (tx, rx) = std::sync::mpsc::channel();
        let target = window.clone();
        window.app_handle().run_on_main_thread(move || {
            let _ = tx.send(apply_overlay_frame_macos(&target, x, y, width, height));
        })?;
        Ok(rx
            .recv_timeout(Duration::from_millis(OVERLAY_FRAME_APPLY_TIMEOUT_MS))
            .ok()
            .flatten()
            .unwrap_or(requested))
    }
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER};

        let hwnd = window.hwnd()?;
        let px = (x * scale_factor).round() as i32;
        let py = (y * scale_factor).round() as i32;
        let pw = (width * scale_factor).round() as i32;
        let ph = (height * scale_factor).round() as i32;
        unsafe {
            SetWindowPos(hwnd, None, px, py, pw, ph, SWP_NOZORDER | SWP_NOACTIVATE)?;
        }
        Ok(requested)
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let _ = scale_factor;
        window.set_size(LogicalSize::new(width, height))?;
        window.set_position(LogicalPosition::new(x, y))?;
        Ok(requested)
    }
}

/// tao 좌표(주 모니터 좌상단 원점)를 AppKit 좌표(주 모니터 좌하단 원점)로 변환해 setFrame 적용
#[cfg(target_os = "macos")]
fn apply_overlay_frame_macos(
    window: &WebviewWindow,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Option<OverlayBounds> {
    use cocoa::foundation::{NSPoint, NSRect, NSSize};
    use objc::{class, msg_send, sel, sel_impl};

    let fallback = || {
        let _ = window.set_size(LogicalSize::new(width, height));
        let _ = window.set_position(LogicalPosition::new(x, y));
    };

    match window.ns_window() {
        Ok(ns_window) => unsafe {
            let ns_window = ns_window as *mut objc::runtime::Object;

            let screens: *mut objc::runtime::Object = msg_send![class!(NSScreen), screens];
            let count: usize = msg_send![screens, count];
            if count == 0 {
                fallback();
                return None;
            }
            let primary: *mut objc::runtime::Object = msg_send![screens, objectAtIndex: 0usize];
            let screen_frame: NSRect = msg_send![primary, frame];

            let flipped_y = screen_frame.size.height - (y + height);
            let frame = NSRect::new(NSPoint::new(x, flipped_y), NSSize::new(width, height));
            let _: () = msg_send![ns_window, setFrame: frame display: true];

            // AppKit이 창을 화면 안으로 되밀 수 있어 실제 반영된 프레임을 읽는다
            let applied: NSRect = msg_send![ns_window, frame];
            Some(OverlayBounds {
                x: applied.origin.x,
                y: screen_frame.size.height - (applied.origin.y + applied.size.height),
                width: applied.size.width,
                height: applied.size.height,
            })
        },
        Err(err) => {
            log::warn!("overlay frame: failed to get NSWindow handle: {err}");
            fallback();
            None
        }
    }
}

fn show_overlay_window(window: &WebviewWindow, _always_on_top: bool) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};

        let hwnd = window.hwnd()?;
        unsafe {
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
        // tao 내부 VISIBLE 플래그 동기화 — raw ShowWindow는 tao 상태를 갱신하지 않아,
        // 이후 set_always_on_top/set_ignore_cursor_events 호출 시 tao가 창을 숨겨버림
        window.show()?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        reset_overlay_alpha(window);
        // 오버레이 표시 시 key/main 윈도우 전환 방지
        let _ = window.set_focusable(false);
        apply_macos_overlay_fullscreen_behavior(window, _always_on_top);
        window.show()?;
        apply_macos_overlay_fullscreen_behavior(window, _always_on_top);
        Ok(())
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        window.show()?;
        Ok(())
    }
}

fn hide_overlay_window(window: &WebviewWindow) -> Result<()> {
    // tao API 사용으로 내부 VISIBLE 플래그와 실제 창 상태 일치 유지
    window.hide()?;
    Ok(())
}

/// macOS 전체화면 Space에서도 오버레이가 보이도록 NSWindow 동작을 보정
/// 어떤 스레드에서 호출되든 안전하게 메인 스레드에서 AppKit API를 실행
#[cfg(target_os = "macos")]
fn apply_macos_overlay_fullscreen_behavior(window: &WebviewWindow, always_on_top: bool) {
    let app = window.app_handle().clone();
    let window = window.clone();
    let _ = app.run_on_main_thread(move || {
        apply_macos_overlay_fullscreen_behavior_inner(&window, always_on_top);
    });
}

#[cfg(target_os = "macos")]
fn apply_macos_overlay_fullscreen_behavior_inner(window: &WebviewWindow, always_on_top: bool) {
    use objc::{msg_send, sel, sel_impl};

    match window.ns_window() {
        Ok(ns_window) => unsafe {
            let ns_window = ns_window as *mut objc::runtime::Object;

            // 전체화면 Space 표시를 위한 레벨 및 컬렉션 동작 설정
            // NSStatusWindowLevel (25) 수준 적용
            let target_level: i64 = if always_on_top { 25 } else { 0 };
            let _: () = msg_send![ns_window, setLevel: target_level];

            let behavior: u64 = (1 << 0) | (1 << 8); // canJoinAllSpaces | fullScreenAuxiliary
            let _: () = msg_send![ns_window, setCollectionBehavior: behavior];

            let _: () = msg_send![ns_window, setHidesOnDeactivate: false];
            let _: () = msg_send![ns_window, orderFrontRegardless];

            log::info!("macOS overlay: level={target_level}, behavior={behavior}");
        },
        Err(err) => {
            log::warn!("macOS overlay: failed to get NSWindow handle: {err}");
        }
    }
}

/// 드래그 가능한 영역에서 시스템 컨텍스트 메뉴(이전 크기, 이동, 최소화 등)가 표시되지 않도록 설정
/// WM_INITMENU 메시지를 후킹하여 메뉴가 초기화될 때 창을 비활성화했다 활성화하여 메뉴를 취소시키는 방식
/// (Electron의 hookWindowMessage 방식과 동일)
#[cfg(target_os = "windows")]
fn disable_system_context_menu(window: &WebviewWindow) -> Result<()> {
    use windows::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        UI::{
            Shell::{DefSubclassProc, SetWindowSubclass},
            WindowsAndMessaging::{GetSystemMenu, WM_INITMENU},
        },
    };

    // EnableWindow는 user32.dll에서 직접 호출
    #[link(name = "user32")]
    extern "system" {
        fn EnableWindow(hwnd: isize, enable: i32) -> i32;
    }

    const SUBCLASS_ID: usize = 1;

    unsafe extern "system" fn subclass_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _uid_subclass: usize,
        _dw_ref_data: usize,
    ) -> LRESULT {
        if msg == WM_INITMENU {
            let system_menu = GetSystemMenu(hwnd, false);
            let is_system_menu = !system_menu.0.is_null() && (system_menu.0 as usize == wparam.0);
            if is_system_menu {
                // 시스템 메뉴만 차단하고, 앱이 띄우는 커스텀 메뉴(Menu.popup)는 허용
                EnableWindow(hwnd.0 as isize, 0); // FALSE
                EnableWindow(hwnd.0 as isize, 1); // TRUE
                return LRESULT(0);
            }
        }
        DefSubclassProc(hwnd, msg, wparam, lparam)
    }

    let hwnd = window.hwnd()?;
    let hwnd_win = HWND(hwnd.0);

    unsafe {
        SetWindowSubclass(hwnd_win, Some(subclass_proc), SUBCLASS_ID, 0)
            .ok()
            .map_err(|e| anyhow!("SetWindowSubclass failed: {e}"))?;
    }

    Ok(())
}

fn convert_physical_bounds_to_logical(
    bounds: &OverlayBounds,
    monitors: &MonitorData,
) -> Option<OverlayBounds> {
    if monitors.is_empty() {
        return None;
    }

    let center_x = bounds.x + bounds.width / 2.0;
    let center_y = bounds.y + bounds.height / 2.0;

    let scale = monitors
        .find_by_physical(center_x, center_y)
        .map(|spec| spec.scale_factor)
        .unwrap_or_else(|| monitors.fallback_scale());

    if !scale.is_finite() || scale <= 0.0 {
        return None;
    }

    Some(OverlayBounds {
        x: bounds.x / scale,
        y: bounds.y / scale,
        width: bounds.width / scale,
        height: bounds.height / scale,
    })
}

#[derive(Clone)]
struct MonitorSpec {
    logical_origin_x: f64,
    logical_origin_y: f64,
    logical_width: f64,
    logical_height: f64,
    physical_origin_x: f64,
    physical_origin_y: f64,
    physical_width: f64,
    physical_height: f64,
    scale_factor: f64,
}

impl MonitorSpec {
    fn from_monitor(monitor: Monitor) -> Option<Self> {
        let scale = monitor.scale_factor();
        let work_area = monitor.work_area();
        let origin = work_area.position;
        let size = work_area.size;

        let logical_origin = origin.to_logical::<f64>(scale);
        let logical_size = size.to_logical::<f64>(scale);

        Some(Self {
            logical_origin_x: logical_origin.x,
            logical_origin_y: logical_origin.y,
            logical_width: logical_size.width,
            logical_height: logical_size.height,
            physical_origin_x: origin.x as f64,
            physical_origin_y: origin.y as f64,
            physical_width: size.width as f64,
            physical_height: size.height as f64,
            scale_factor: scale,
        })
    }

    fn matches(&self, other: &Self) -> bool {
        (self.physical_origin_x - other.physical_origin_x).abs() < 0.5
            && (self.physical_origin_y - other.physical_origin_y).abs() < 0.5
            && (self.physical_width - other.physical_width).abs() < 0.5
            && (self.physical_height - other.physical_height).abs() < 0.5
            && (self.scale_factor - other.scale_factor).abs() < f64::EPSILON
    }

    fn contains_physical(&self, x: f64, y: f64) -> bool {
        x >= self.physical_origin_x
            && x <= self.physical_origin_x + self.physical_width
            && y >= self.physical_origin_y
            && y <= self.physical_origin_y + self.physical_height
    }

    /// 주어진 사각형과 이 모니터 work_area의 교차 영역 넓이 (logical px²)
    fn intersection_area(&self, x: f64, y: f64, width: f64, height: f64) -> f64 {
        let left = x.max(self.logical_origin_x);
        let top = y.max(self.logical_origin_y);
        let right = (x + width).min(self.logical_origin_x + self.logical_width);
        let bottom = (y + height).min(self.logical_origin_y + self.logical_height);
        (right - left).max(0.0) * (bottom - top).max(0.0)
    }

    fn clamp(&self, x: f64, y: f64, width: f64, height: f64) -> OverlayPosition {
        let max_x = self.logical_origin_x + (self.logical_width - width).max(0.0);
        let max_y = self.logical_origin_y + (self.logical_height - height).max(0.0);

        OverlayPosition {
            x: x.clamp(self.logical_origin_x, max_x),
            y: y.clamp(self.logical_origin_y, max_y),
        }
    }
}

#[derive(Default)]
struct MonitorData {
    specs: Vec<MonitorSpec>,
    primary_index: Option<usize>,
}

impl MonitorData {
    #[cfg(not(target_os = "macos"))]
    fn gather(app: &AppHandle) -> Self {
        Self::gather_inner(app)
    }

    /// macOS: available_monitors/primary_monitor의 Monitor 변환이 NSScreen(AppKit)을
    /// 호출 스레드에서 직접 접근함 → 메인 스레드 밖(async 커맨드 등)에서 호출 시 크래시 (#67)
    /// run_on_main_thread는 메인 스레드에서 호출되면 인라인 실행되므로 데드락 없음
    #[cfg(target_os = "macos")]
    fn gather(app: &AppHandle) -> Self {
        let empty = Self::default();
        let (tx, rx) = std::sync::mpsc::channel();
        let app_handle = app.clone();
        if let Err(err) = app.run_on_main_thread(move || {
            let _ = tx.send(Self::gather_inner(&app_handle));
        }) {
            log::warn!("monitor gather: failed to dispatch to main thread: {err}");
            return empty;
        }
        match rx.recv_timeout(std::time::Duration::from_secs(3)) {
            Ok(data) => data,
            Err(err) => {
                log::warn!("monitor gather: main thread result unavailable: {err}");
                empty
            }
        }
    }

    fn gather_inner(app: &AppHandle) -> Self {
        let mut specs: Vec<MonitorSpec> = app
            .available_monitors()
            .ok()
            .unwrap_or_default()
            .into_iter()
            .filter_map(MonitorSpec::from_monitor)
            .collect();

        let mut primary_index = None;
        if let Ok(Some(primary)) = app.primary_monitor() {
            if let Some(primary_spec) = MonitorSpec::from_monitor(primary) {
                primary_index = specs.iter().position(|spec| spec.matches(&primary_spec));

                if primary_index.is_none() {
                    specs.push(primary_spec);
                    primary_index = Some(specs.len() - 1);
                }
            }
        }

        Self {
            specs,
            primary_index,
        }
    }

    fn is_empty(&self) -> bool {
        self.specs.is_empty()
    }

    fn primary_spec(&self) -> Option<&MonitorSpec> {
        self.primary_index
            .and_then(|idx| self.specs.get(idx))
            .or_else(|| self.specs.first())
    }

    fn fallback_scale(&self) -> f64 {
        self.primary_spec()
            .map(|spec| spec.scale_factor)
            .unwrap_or(1.0)
    }

    fn find_by_physical(&self, x: f64, y: f64) -> Option<&MonitorSpec> {
        self.specs.iter().find(|spec| spec.contains_physical(x, y))
    }

    /// 주어진 사각형과 가장 많이 겹치는 모니터를 반환
    fn find_best_overlap(&self, x: f64, y: f64, width: f64, height: f64) -> Option<&MonitorSpec> {
        self.specs
            .iter()
            .max_by(|a, b| {
                a.intersection_area(x, y, width, height)
                    .partial_cmp(&b.intersection_area(x, y, width, height))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .filter(|spec| spec.intersection_area(x, y, width, height) > 0.0)
    }

    fn first(&self) -> Option<&MonitorSpec> {
        self.specs.first()
    }
}

struct PanelWindowLayout {
    position: Option<OverlayPosition>,
    height: f64,
    min_height: f64,
    max_height: f64,
}

// 작업 영역이 하한보다 좁으면 하한을 화면에 맞춰 낮춤 - 그러지 않으면 창 아래쪽이
// 화면 밖으로 나가 리사이즈 가장자리에 손이 닿지 않는다
fn panel_height_bounds(work_area_height: Option<f64>) -> (f64, f64) {
    let Some(work_area_height) =
        work_area_height.filter(|height| height.is_finite() && *height > 0.0)
    else {
        return (PANEL_MIN_HEIGHT, PANEL_FALLBACK_MAX_HEIGHT);
    };
    let max_height = work_area_height * PANEL_MAX_HEIGHT_RATIO;
    (PANEL_MIN_HEIGHT.min(max_height), max_height)
}

fn resolve_panel_window_layout(
    stored_bounds: Option<PanelBounds>,
    monitors: &MonitorData,
    fallback_height: Option<f64>,
) -> PanelWindowLayout {
    let target_monitor = stored_bounds
        .and_then(|bounds| {
            monitors.find_best_overlap(bounds.x, bounds.y, PANEL_WIDTH, bounds.height)
        })
        .or_else(|| monitors.primary_spec());
    let (min_height, max_height) =
        panel_height_bounds(target_monitor.map(|monitor| monitor.logical_height));
    // 저장된 높이가 없으면 메인 창 높이를 기본값으로 (프로그램 높이 동기)
    let requested_height = stored_bounds
        .map(|bounds| bounds.height)
        .or(fallback_height)
        .unwrap_or(PANEL_INITIAL_HEIGHT);
    let height = requested_height.clamp(min_height, max_height);
    let position = stored_bounds.map(|bounds| {
        target_monitor
            .map(|monitor| monitor.clamp(bounds.x, bounds.y, PANEL_WIDTH, height))
            .unwrap_or(OverlayPosition {
                x: bounds.x,
                y: bounds.y,
            })
    });

    PanelWindowLayout {
        position,
        height,
        min_height,
        max_height,
    }
}

fn changed_panel_max_height(previous: Option<f64>, next: f64) -> Option<f64> {
    if !next.is_finite() || next <= 0.0 {
        return None;
    }
    if previous.is_some_and(|value| (value - next).abs() < 0.5) {
        return None;
    }
    Some(next)
}

fn panel_bounds_sample_from_window(window: &WebviewWindow) -> Result<PanelBoundsSample> {
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    Ok(PanelBoundsSample {
        position: window.outer_position()?,
        position_scale_factor: scale_factor,
        size: window.inner_size()?,
        size_scale_factor: scale_factor,
        current_scale_factor: scale_factor,
    })
}

fn valid_panel_scale_factor(scale_factor: f64) -> f64 {
    if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    }
}

fn panel_bounds_from_sample(sample: PanelBoundsSample) -> PanelBounds {
    let position = sample
        .position
        .to_logical::<f64>(valid_panel_scale_factor(sample.position_scale_factor));
    let size = sample
        .size
        .to_logical::<f64>(valid_panel_scale_factor(sample.size_scale_factor));
    PanelBounds {
        x: position.x,
        y: position.y,
        height: size.height,
    }
}

fn apply_panel_bounds_change(sample: &mut PanelBoundsSample, change: PanelBoundsChange) {
    match change {
        PanelBoundsChange::Snapshot(snapshot) => *sample = snapshot,
        PanelBoundsChange::Moved(position) => {
            sample.position = position;
            sample.position_scale_factor = sample.current_scale_factor;
        }
        PanelBoundsChange::Resized(size) => {
            sample.size = size;
            sample.size_scale_factor = sample.current_scale_factor;
        }
        PanelBoundsChange::ScaleFactorChanged {
            position,
            size,
            scale_factor,
        } => {
            let scale_factor = valid_panel_scale_factor(scale_factor);
            sample.current_scale_factor = scale_factor;
            if let Some(position) = position {
                sample.position = position;
                sample.position_scale_factor = scale_factor;
            }
            sample.size = size;
            sample.size_scale_factor = scale_factor;
        }
    }
}

impl PanelBoundsPersistenceController {
    fn new(store: Arc<AppStore>) -> Self {
        Self {
            store,
            state: Mutex::new(PanelBoundsPersistenceState::default()),
            persist_lock: Mutex::new(()),
        }
    }

    fn attach(&self, window: &WebviewWindow, max_height: f64) -> u64 {
        let latest = panel_bounds_sample_from_window(window).ok();
        let mut state = self.state.lock();
        state.session = state.session.wrapping_add(1);
        state.latest = latest;
        state.window = Some(window.clone());
        state.applied_max_height = Some(max_height);
        state.generation = state.generation.wrapping_add(1);
        state.dirty = false;
        state.active = true;
        state.session
    }

    fn record_event(self: &Arc<Self>, session: u64, change: PanelBoundsChange) {
        let should_spawn = {
            let mut state = self.state.lock();
            if !state.active || state.session != session {
                return;
            }
            if state.latest.is_none() {
                state.latest = state
                    .window
                    .as_ref()
                    .and_then(|window| panel_bounds_sample_from_window(window).ok());
            }
            Self::record_change(&mut state, session, change)
        };
        if should_spawn {
            self.spawn_worker();
        }
    }

    fn record_change(
        state: &mut PanelBoundsPersistenceState,
        session: u64,
        change: PanelBoundsChange,
    ) -> bool {
        if !state.active || state.session != session {
            return false;
        }
        if let PanelBoundsChange::Snapshot(snapshot) = change {
            state.latest = Some(snapshot);
            return Self::mark_dirty(state);
        }
        let Some(latest) = state.latest.as_mut() else {
            return false;
        };
        apply_panel_bounds_change(latest, change);
        Self::mark_dirty(state)
    }

    fn mark_dirty(state: &mut PanelBoundsPersistenceState) -> bool {
        state.generation = state.generation.wrapping_add(1);
        state.dirty = true;
        let should_spawn = !state.worker_running;
        state.worker_running = true;
        should_spawn
    }

    fn take_dirty_work(state: &mut PanelBoundsPersistenceState) -> Option<PanelBoundsPersistWork> {
        let sample = state.latest.filter(|_| state.active && state.dirty)?;
        state.dirty = false;
        Some(PanelBoundsPersistWork {
            session: state.session,
            generation: state.generation,
            sample,
        })
    }

    fn work_is_current(state: &PanelBoundsPersistenceState, work: &PanelBoundsPersistWork) -> bool {
        state.active && state.session == work.session && state.generation == work.generation
    }

    fn restore_failed_work(
        state: &mut PanelBoundsPersistenceState,
        work: &PanelBoundsPersistWork,
    ) -> bool {
        if !Self::work_is_current(state, work) {
            return false;
        }
        state.dirty = true;
        true
    }

    fn persist_sample(&self, sample: PanelBoundsSample) -> Result<()> {
        let bounds = panel_bounds_from_sample(sample);
        self.store
            .update_deferred(move |data| {
                data.panel_bounds = Some(bounds);
            })
            .context("failed to capture settled panel bounds")?;
        self.store
            .flush()
            .context("failed to flush settled panel bounds")
    }

    fn persist_worker_work(&self, work: PanelBoundsPersistWork) -> Result<bool> {
        let _persist_guard = self.persist_lock.lock();
        if !Self::work_is_current(&self.state.lock(), &work) {
            return Ok(false);
        }
        self.persist_sample(work.sample)?;
        Ok(true)
    }

    fn spawn_worker(self: &Arc<Self>) {
        let controller = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(PANEL_BOUNDS_DEBOUNCE_MS)).await;
                let (work, window) = {
                    let mut state = controller.state.lock();
                    let Some(work) = Self::take_dirty_work(&mut state) else {
                        state.worker_running = false;
                        return;
                    };
                    (work, state.window.clone())
                };

                let persist_result = controller.persist_worker_work(work);
                if let Err(err) = &persist_result {
                    log::warn!("failed to persist settled panel bounds: {err:#}");
                }

                if let Some(window) = window {
                    let constraint_controller = Arc::clone(&controller);
                    let constraint_window = window.clone();
                    if let Err(err) = window.app_handle().run_on_main_thread(move || {
                        if let Err(err) = constraint_controller.apply_monitor_constraints(
                            &constraint_window,
                            work.session,
                            work.generation,
                        ) {
                            log::warn!("failed to update settled panel monitor constraints: {err}");
                        }
                    }) {
                        log::warn!("failed to schedule settled panel constraints: {err}");
                    }
                }

                let mut state = controller.state.lock();
                if persist_result.is_err() && Self::restore_failed_work(&mut state, &work) {
                    state.worker_running = false;
                    return;
                }
                if !state.active || !state.dirty {
                    state.worker_running = false;
                    return;
                }
            }
        });
    }

    fn apply_monitor_constraints(
        &self,
        window: &WebviewWindow,
        session: u64,
        generation: u64,
    ) -> Result<()> {
        let Some((min_height, monitor_max_height)) = window
            .current_monitor()?
            .and_then(MonitorSpec::from_monitor)
            .map(|monitor| panel_height_bounds(Some(monitor.logical_height)))
        else {
            return Ok(());
        };
        let max_height = {
            let state = self.state.lock();
            if !state.active || state.session != session || state.generation != generation {
                return Ok(());
            }
            changed_panel_max_height(state.applied_max_height, monitor_max_height)
        };
        let Some(max_height) = max_height else {
            return Ok(());
        };
        // 좁은 모니터로 옮겨가면 하한도 함께 내려야 창이 화면 밖으로 나가지 않음
        window.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize::new(
            PANEL_WIDTH,
            min_height,
        ))))?;
        window.set_max_size(Some(tauri::Size::Logical(tauri::LogicalSize::new(
            PANEL_WIDTH,
            max_height,
        ))))?;
        let mut state = self.state.lock();
        if state.active && state.session == session && state.generation == generation {
            state.applied_max_height = Some(max_height);
        }
        Ok(())
    }

    fn flush_now(&self, window: &WebviewWindow) -> Result<()> {
        let _persist_guard = self.persist_lock.lock();
        let generation_before_sample = self.state.lock().generation;
        let sampled = panel_bounds_sample_from_window(window);
        Self::flush_samples(&self.state, generation_before_sample, sampled, |sample| {
            self.persist_sample(sample)
        })
    }

    fn flush_samples(
        state_mutex: &Mutex<PanelBoundsPersistenceState>,
        generation_before_sample: u64,
        sampled: Result<PanelBoundsSample>,
        mut persist: impl FnMut(PanelBoundsSample) -> Result<()>,
    ) -> Result<()> {
        let mut work = {
            let mut state = state_mutex.lock();
            let sampled = match sampled {
                Ok(sample) => sample,
                Err(error) => state.latest.ok_or(error)?,
            };
            let sample = if state.generation != generation_before_sample {
                state.latest.unwrap_or(sampled)
            } else {
                sampled
            };
            state.latest = Some(sample);
            state.generation = state.generation.wrapping_add(1);
            state.dirty = false;
            PanelBoundsPersistWork {
                session: state.session,
                generation: state.generation,
                sample,
            }
        };

        loop {
            if let Err(error) = persist(work.sample) {
                Self::restore_failed_work(&mut state_mutex.lock(), &work);
                return Err(error);
            }
            let Some(next) = Self::take_dirty_work(&mut state_mutex.lock()) else {
                return Ok(());
            };
            work = next;
        }
    }

    fn deactivate(&self, session: u64) {
        let mut state = self.state.lock();
        Self::deactivate_state(&mut state, session);
    }

    fn deactivate_state(state: &mut PanelBoundsPersistenceState, session: u64) -> bool {
        if state.session != session {
            return false;
        }
        state.active = false;
        state.window = None;
        state.applied_max_height = None;
        state.generation = state.generation.wrapping_add(1);
        state.dirty = false;
        true
    }
}

fn defer_overlay_bounds_from_window(
    window: &WebviewWindow,
    store: &Arc<AppStore>,
    generation: &Arc<AtomicU64>,
) -> Result<()> {
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let position = window.outer_position()?.to_logical::<f64>(scale_factor);
    let size = window.outer_size()?.to_logical::<f64>(scale_factor);

    defer_overlay_bounds(
        store,
        generation,
        OverlayBounds {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        },
        None,
    )
}

fn defer_overlay_bounds(
    store: &Arc<AppStore>,
    generation: &Arc<AtomicU64>,
    bounds: OverlayBounds,
    content_top_offset: Option<f64>,
) -> Result<()> {
    store.update_deferred(move |state| {
        state.overlay_bounds = Some(bounds);
        state.overlay_bounds_are_logical = true;
        if let Some(offset) = content_top_offset {
            state.overlay_last_content_top_offset = Some(offset);
        }
    })?;
    let scheduled_generation = generation.fetch_add(1, Ordering::SeqCst).wrapping_add(1);

    let store = Arc::clone(store);
    let generation = Arc::clone(generation);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(OVERLAY_BOUNDS_DEBOUNCE_MS)).await;
        if generation.load(Ordering::SeqCst) != scheduled_generation {
            return;
        }
        if let Err(err) = store.flush() {
            log::warn!("failed to flush debounced overlay bounds: {err}");
        }
    });

    Ok(())
}

fn flush_deferred_overlay_bounds(store: &Arc<AppStore>, generation: &Arc<AtomicU64>) -> Result<()> {
    generation.fetch_add(1, Ordering::SeqCst);
    store.flush()
}

struct KeyboardDaemonTask {
    generation: u64,
    running: Arc<AtomicBool>,
    reader_handle: Option<JoinHandle<()>>,
    stderr_handle: Option<JoinHandle<()>>,
    parent_stdin: Option<ChildStdin>,
    child: Option<Child>,
}

impl Drop for KeyboardDaemonTask {
    fn drop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        self.parent_stdin.take();

        if let Some(child) = self.child.as_mut() {
            if let Err(err) = child.kill() {
                if err.kind() != std::io::ErrorKind::InvalidInput {
                    warn!("failed to kill keyboard daemon: {err}");
                }
            }
            let _ = child.wait();
        }

        if let Some(handle) = self.reader_handle.take() {
            let _ = handle.join();
        }

        if let Some(handle) = self.stderr_handle.take() {
            let _ = handle.join();
        }
    }
}

#[derive(Clone, Copy)]
struct OverlayPosition {
    x: f64,
    y: f64,
}

#[cfg(test)]
mod tests {
    use std::{
        collections::{HashMap, HashSet},
        sync::{
            atomic::{AtomicBool, AtomicUsize, Ordering},
            Arc,
        },
        time::Duration,
    };

    use super::{
        acknowledge_editor_flush_handshake, acknowledge_panel_close_request,
        apply_panel_bounds_change, begin_panel_close_request, bootstrap_keyboard_state,
        canonical_hold_duration_ms, changed_panel_max_height, clamp_overlay_dimension,
        collect_authorized_css_paths, collect_frontend_lifecycle_targets,
        frontend_history_mutation_blocked, frontend_lifecycle_restore_labels,
        global_css_watch_path, install_history_handshake, install_lifecycle_handshake,
        key_state_payload, next_keyboard_recovery_plan, normalize_stored_overlay_bounds,
        overlay_reset_fallback_rect, panel_bounds_from_sample, panel_height_bounds,
        publish_panel_hidden_transition, publish_panel_visibility_transition,
        publish_selection_snapshot, resolve_event_age_ms, resolve_panel_window_layout,
        run_panel_close_timeout, should_create_overlay_on_startup, should_recover_keyboard_daemon,
        should_restore_panel_on_startup, stored_bounds_need_monitor_data,
        take_cancelable_editor_flush_handshake, take_editor_flush_handshake,
        take_targeted_panel_view_state, validate_selection_session, EditorFlushAcknowledge,
        EditorFlushCompletion, EditorFlushHandshake, EditorFlushRequest, FrontendFlushAction,
        FrontendHistoryFlushPhase, FrontendHistoryFlushReady, FrontendLifecycleAction,
        LifecycleHandshakeInstall, MonitorData, MonitorSpec, Mutex, PanelBoundsChange,
        PanelBoundsPersistenceController, PanelBoundsPersistenceState, PanelBoundsSample,
        PanelCloseRequestState, PanelCloseRequestedPayload, PanelLayerTab, PanelPropertyTab,
        PanelViewMode, PanelViewState, PanelViewTarget, PanelVisibilityEventEmitter,
        PanelVisibilityPayload, PanelVisibilityReason, PhysicalPosition, PhysicalSize,
        SelectionSessionElement, SelectionSessionSnapshot, TargetedPanelViewState,
        DEFAULT_OVERLAY_HEIGHT, DEFAULT_OVERLAY_WIDTH, HISTORY_FRONTEND_FLUSH_INTERRUPTED,
        KEYBOARD_DAEMON_STABLE_RUNTIME, KEYBOARD_RECOVERY_DELAYS_MS, MAX_SELECTION_ELEMENTS,
        MAX_SELECTION_ELEMENT_TYPE_BYTES, MAX_SELECTION_FULL_ID_BYTES,
        MAX_SELECTION_GROUP_ID_BYTES, MAX_SELECTION_MODE_BYTES, OVERLAY_LABEL, PANEL_ENTRYPOINT,
        PANEL_INITIAL_HEIGHT, PANEL_LABEL, PANEL_MIN_HEIGHT, PANEL_WIDTH, RAW_INPUT_WINDOW_LABELS,
    };
    use crate::{
        keyboard::KeyboardManager,
        models::{AppStoreData, CustomCss, OverlayBounds, PanelBounds, TabCss},
        state::local_asset_path::path_identity_key,
    };
    use std::path::Path;

    #[test]
    fn startup_overlay_creation_covers_all_visibility_and_obs_combinations() {
        assert!(!should_create_overlay_on_startup(false, false));
        assert!(should_create_overlay_on_startup(false, true));
        assert!(!should_create_overlay_on_startup(true, false));
        assert!(!should_create_overlay_on_startup(true, true));
    }

    #[test]
    fn startup_panel_restore_requires_detached_without_obs_or_tray_start() {
        assert!(should_restore_panel_on_startup(false, false, true));
        assert!(!should_restore_panel_on_startup(false, false, false));
        assert!(!should_restore_panel_on_startup(true, false, true));
        assert!(!should_restore_panel_on_startup(false, true, true));
    }

    #[test]
    fn panel_window_contract_uses_fixed_client_width() {
        assert_eq!(PANEL_LABEL, "panel");
        assert_eq!(PANEL_ENTRYPOINT, "panel/index.html");
        assert_eq!(PANEL_WIDTH, 240.0);
        assert_eq!(PANEL_INITIAL_HEIGHT, 712.0);
        assert_eq!(PANEL_MIN_HEIGHT, 712.0);
        // 넉넉한 화면에서는 하한이 그대로 유지됨
        assert_eq!(
            panel_height_bounds(Some(1_000.0)),
            (PANEL_MIN_HEIGHT, 900.0)
        );
        // 하한보다 좁은 작업 영역에서는 하한이 화면에 맞춰 내려감 - clamp 역전 방지
        assert_eq!(panel_height_bounds(Some(600.0)), (540.0, 540.0));
        let (min_height, max_height) = panel_height_bounds(None);
        assert_eq!(min_height, PANEL_MIN_HEIGHT);
        assert!(max_height >= min_height);
    }

    #[test]
    fn panel_layout_never_exceeds_a_small_work_area() {
        let monitors = MonitorData {
            specs: vec![MonitorSpec {
                logical_origin_x: 0.0,
                logical_origin_y: 0.0,
                logical_width: 1_280.0,
                logical_height: 680.0,
                physical_origin_x: 0.0,
                physical_origin_y: 0.0,
                physical_width: 1_280.0,
                physical_height: 680.0,
                scale_factor: 1.0,
            }],
            primary_index: Some(0),
        };
        let layout = resolve_panel_window_layout(None, &monitors, None);

        assert!(layout.min_height <= layout.max_height);
        assert!(layout.height <= 680.0);
        assert_eq!(layout.height, layout.max_height);
    }

    #[test]
    fn raw_input_targets_include_detached_panel() {
        assert_eq!(
            RAW_INPUT_WINDOW_LABELS,
            ["main", OVERLAY_LABEL, PANEL_LABEL]
        );
    }

    fn note_panel_view_state() -> PanelViewState {
        PanelViewState {
            mode: PanelViewMode::Property,
            active_tab: PanelLayerTab::Grid,
            property_active_tab: PanelPropertyTab::Note,
        }
    }

    #[test]
    fn panel_view_state_rejects_invalid_missing_and_unknown_fields() {
        assert!(serde_json::from_value::<PanelViewState>(serde_json::json!({
            "mode": "property",
            "activeTab": "grid",
            "propertyActiveTab": "invalid"
        }))
        .is_err());
        assert!(serde_json::from_value::<PanelViewState>(serde_json::json!({
            "mode": "property",
            "activeTab": "grid"
        }))
        .is_err());
        assert!(serde_json::from_value::<PanelViewState>(serde_json::json!({
            "mode": "property",
            "activeTab": "grid",
            "propertyActiveTab": "note",
            "extra": true
        }))
        .is_err());
    }

    #[test]
    fn panel_view_state_is_consumed_once_by_its_target_window() {
        let expected = note_panel_view_state();
        let mut slot = Some(TargetedPanelViewState {
            target: PanelViewTarget::Panel,
            view_state: expected.clone(),
        });

        assert_eq!(take_targeted_panel_view_state(&mut slot, "main"), None);
        assert_eq!(
            take_targeted_panel_view_state(&mut slot, PANEL_LABEL),
            Some(expected)
        );
        assert_eq!(take_targeted_panel_view_state(&mut slot, PANEL_LABEL), None);
    }

    #[test]
    fn settled_panel_bounds_convert_physical_geometry_once() {
        let bounds = panel_bounds_from_sample(PanelBoundsSample {
            position: PhysicalPosition::new(600, 300),
            position_scale_factor: 2.0,
            size: PhysicalSize::new(480, 1_600),
            size_scale_factor: 2.0,
            current_scale_factor: 2.0,
        });

        assert_eq!(bounds.x, 300.0);
        assert_eq!(bounds.y, 150.0);
        // 표본은 실측 그대로 - 하한은 복원 시 모니터 기준으로 다시 적용됨
        assert_eq!(bounds.height, 800.0);
    }

    #[test]
    fn panel_bounds_controller_preserves_scale_domains_and_coalesces_events() {
        let mut sample = PanelBoundsSample {
            position: PhysicalPosition::new(600, 300),
            position_scale_factor: 2.0,
            size: PhysicalSize::new(480, 1_000),
            size_scale_factor: 2.0,
            current_scale_factor: 2.0,
        };
        apply_panel_bounds_change(
            &mut sample,
            PanelBoundsChange::ScaleFactorChanged {
                position: None,
                size: PhysicalSize::new(480, 1_000),
                scale_factor: 1.0,
            },
        );
        let bounds = panel_bounds_from_sample(sample);

        assert_eq!(bounds.x, 300.0);
        assert_eq!(bounds.y, 150.0);
        assert_eq!(bounds.height, 1_000.0);
        let mut state = PanelBoundsPersistenceState {
            latest: Some(sample),
            session: 1,
            active: true,
            ..PanelBoundsPersistenceState::default()
        };
        assert!(PanelBoundsPersistenceController::record_change(
            &mut state,
            1,
            PanelBoundsChange::Moved(PhysicalPosition::new(800, 400)),
        ));
        assert!(!PanelBoundsPersistenceController::record_change(
            &mut state,
            1,
            PanelBoundsChange::Resized(PhysicalSize::new(480, 1_200)),
        ));
        assert_eq!(
            (state.generation, state.worker_running, state.dirty),
            (2, true, true)
        );
        let mut empty_state = PanelBoundsPersistenceState {
            session: 1,
            active: true,
            ..PanelBoundsPersistenceState::default()
        };
        assert!(PanelBoundsPersistenceController::record_change(
            &mut empty_state,
            1,
            PanelBoundsChange::Snapshot(sample),
        ));
        assert_eq!(empty_state.latest, Some(sample));
    }

    #[test]
    fn panel_bounds_deactivate_ignores_a_stale_session_token() {
        let sample = PanelBoundsSample {
            position: PhysicalPosition::new(600, 300),
            position_scale_factor: 2.0,
            size: PhysicalSize::new(480, 1_000),
            size_scale_factor: 2.0,
            current_scale_factor: 2.0,
        };
        let mut state = PanelBoundsPersistenceState {
            latest: Some(sample),
            applied_max_height: Some(900.0),
            session: 2,
            generation: 7,
            dirty: true,
            active: true,
            ..PanelBoundsPersistenceState::default()
        };

        assert!(!PanelBoundsPersistenceController::deactivate_state(
            &mut state, 1,
        ));
        assert!(state.active);
        assert_eq!(state.session, 2);
        assert_eq!(state.generation, 7);
        assert!(state.dirty);
        assert_eq!(state.latest, Some(sample));
        assert_eq!(state.applied_max_height, Some(900.0));
    }

    #[test]
    fn panel_bounds_record_event_ignores_a_stale_session_token() {
        let sample = PanelBoundsSample {
            position: PhysicalPosition::new(600, 300),
            position_scale_factor: 2.0,
            size: PhysicalSize::new(480, 1_000),
            size_scale_factor: 2.0,
            current_scale_factor: 2.0,
        };
        let mut state = PanelBoundsPersistenceState {
            latest: Some(sample),
            session: 2,
            generation: 7,
            active: true,
            ..PanelBoundsPersistenceState::default()
        };

        assert!(!PanelBoundsPersistenceController::record_change(
            &mut state,
            1,
            PanelBoundsChange::Moved(PhysicalPosition::new(800, 400)),
        ));
        assert_eq!(state.latest, Some(sample));
        assert_eq!(state.generation, 7);
        assert!(!state.dirty);
        assert!(!state.worker_running);
    }

    #[test]
    fn panel_bounds_flush_keeps_event_after_sample_that_old_code_overwrote() {
        let initial = PanelBoundsSample {
            position: PhysicalPosition::new(600, 300),
            position_scale_factor: 2.0,
            size: PhysicalSize::new(480, 1_000),
            size_scale_factor: 2.0,
            current_scale_factor: 2.0,
        };
        let state = Mutex::new(PanelBoundsPersistenceState {
            latest: Some(initial),
            session: 4,
            active: true,
            ..PanelBoundsPersistenceState::default()
        });
        let generation_before_sample = state.lock().generation;
        let sampled = state.lock().latest.unwrap();

        assert!(PanelBoundsPersistenceController::record_change(
            &mut state.lock(),
            4,
            PanelBoundsChange::Moved(PhysicalPosition::new(800, 400)),
        ));
        let expected = state.lock().latest.unwrap();
        let mut persisted = Vec::new();

        PanelBoundsPersistenceController::flush_samples(
            &state,
            generation_before_sample,
            Ok(sampled),
            |sample| {
                persisted.push(sample);
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(persisted, vec![expected]);
        let state = state.lock();
        assert_eq!(state.latest, Some(expected));
        assert!(!state.dirty);
    }

    #[test]
    fn panel_bounds_flush_and_event_interleave_without_loss_or_duplicate_sample() {
        let initial = PanelBoundsSample {
            position: PhysicalPosition::new(600, 300),
            position_scale_factor: 2.0,
            size: PhysicalSize::new(480, 1_000),
            size_scale_factor: 2.0,
            current_scale_factor: 2.0,
        };
        let state = Mutex::new(PanelBoundsPersistenceState {
            latest: Some(initial),
            session: 4,
            active: true,
            ..PanelBoundsPersistenceState::default()
        });
        let mut persisted = Vec::new();

        PanelBoundsPersistenceController::flush_samples(&state, 0, Ok(initial), |sample| {
            persisted.push(sample);
            if persisted.len() == 1 {
                assert!(PanelBoundsPersistenceController::record_change(
                    &mut state.lock(),
                    4,
                    PanelBoundsChange::Moved(PhysicalPosition::new(800, 400)),
                ));
            }
            Ok(())
        })
        .unwrap();

        let mut expected_latest = initial;
        apply_panel_bounds_change(
            &mut expected_latest,
            PanelBoundsChange::Moved(PhysicalPosition::new(800, 400)),
        );
        assert_eq!(persisted, vec![initial, expected_latest]);
        let state = state.lock();
        assert_eq!(state.latest, Some(expected_latest));
        assert!(!state.dirty);
    }

    #[test]
    fn panel_bounds_flush_uses_latest_when_window_read_fails() {
        let latest = PanelBoundsSample {
            position: PhysicalPosition::new(600, 300),
            position_scale_factor: 2.0,
            size: PhysicalSize::new(480, 1_000),
            size_scale_factor: 2.0,
            current_scale_factor: 2.0,
        };
        let state = Mutex::new(PanelBoundsPersistenceState {
            latest: Some(latest),
            session: 5,
            active: true,
            ..PanelBoundsPersistenceState::default()
        });
        let mut persisted = Vec::new();

        PanelBoundsPersistenceController::flush_samples(
            &state,
            0,
            Err(anyhow::anyhow!("window bounds unavailable")),
            |sample| {
                persisted.push(sample);
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(persisted, vec![latest]);

        let empty = Mutex::new(PanelBoundsPersistenceState::default());
        assert!(PanelBoundsPersistenceController::flush_samples(
            &empty,
            0,
            Err(anyhow::anyhow!("window bounds unavailable")),
            |_| panic!("missing bounds must not be persisted"),
        )
        .is_err());
    }

    #[test]
    fn panel_bounds_flush_failure_restores_dirty_state() {
        let sample = PanelBoundsSample {
            position: PhysicalPosition::new(600, 300),
            position_scale_factor: 2.0,
            size: PhysicalSize::new(480, 1_000),
            size_scale_factor: 2.0,
            current_scale_factor: 2.0,
        };
        let state = Mutex::new(PanelBoundsPersistenceState {
            latest: Some(sample),
            session: 6,
            active: true,
            ..PanelBoundsPersistenceState::default()
        });

        assert!(
            PanelBoundsPersistenceController::flush_samples(&state, 0, Ok(sample), |_| Err(
                anyhow::anyhow!("disk unavailable")
            ),)
            .is_err()
        );
        assert!(state.lock().dirty);
    }

    #[test]
    fn persisted_panel_bounds_restore_with_height_clamping() {
        let monitors = MonitorData {
            specs: Vec::new(),
            primary_index: None,
        };
        let layout = resolve_panel_window_layout(
            Some(PanelBounds {
                x: 31.0,
                y: 47.0,
                height: 200.0,
            }),
            &monitors,
            None,
        );

        assert_eq!(layout.height, PANEL_MIN_HEIGHT);
        let position = layout.position.expect("stored position should be restored");
        assert_eq!(position.x, 31.0);
        assert_eq!(position.y, 47.0);
    }

    #[test]
    fn panel_monitor_constraint_changes_only_for_a_new_valid_height() {
        assert_eq!(changed_panel_max_height(Some(900.0), 900.0), None);
        assert_eq!(changed_panel_max_height(Some(900.0), 900.4), None);
        assert_eq!(changed_panel_max_height(Some(900.0), 720.0), Some(720.0));
        assert_eq!(changed_panel_max_height(None, 720.0), Some(720.0));
        assert_eq!(changed_panel_max_height(Some(900.0), f64::NAN), None);
        assert_eq!(changed_panel_max_height(Some(900.0), 0.0), None);
    }

    #[test]
    fn selection_publish_advances_backend_revision_and_get_matches() {
        let session = Mutex::new(SelectionSessionSnapshot {
            mode: "4key".to_string(),
            ..SelectionSessionSnapshot::default()
        });
        let first = publish_selection_snapshot(
            &session,
            SelectionSessionSnapshot {
                selected_elements: vec![SelectionSessionElement {
                    element_type: "key".to_string(),
                    full_id: "00000000-0000-4000-8000-000000000002".to_string(),
                }],
                selected_group_ids: vec!["group-1".to_string()],
                mode: "4key".to_string(),
                selection_revision: 999,
            },
        )
        .unwrap();
        let second = publish_selection_snapshot(&session, first.clone()).unwrap();

        assert_eq!(first.selection_revision, 1);
        assert_eq!(second.selection_revision, 2);
        assert_eq!(*session.lock(), second);
    }

    #[test]
    fn selection_validation_enforces_collection_and_string_limits() {
        let oversized_elements = SelectionSessionSnapshot {
            selected_elements: vec![
                SelectionSessionElement {
                    element_type: "key".to_string(),
                    full_id: "00000000-0000-4000-8000-000000000002".to_string(),
                };
                MAX_SELECTION_ELEMENTS + 1
            ],
            ..SelectionSessionSnapshot::default()
        };
        assert!(validate_selection_session(&oversized_elements).is_err());

        for invalid in [
            SelectionSessionSnapshot {
                selected_elements: vec![SelectionSessionElement {
                    element_type: "x".repeat(MAX_SELECTION_ELEMENT_TYPE_BYTES + 1),
                    full_id: "00000000-0000-4000-8000-000000000002".to_string(),
                }],
                ..SelectionSessionSnapshot::default()
            },
            SelectionSessionSnapshot {
                selected_elements: vec![SelectionSessionElement {
                    element_type: "key".to_string(),
                    full_id: "x".repeat(MAX_SELECTION_FULL_ID_BYTES + 1),
                }],
                ..SelectionSessionSnapshot::default()
            },
            SelectionSessionSnapshot {
                selected_group_ids: vec!["x".repeat(MAX_SELECTION_GROUP_ID_BYTES + 1)],
                ..SelectionSessionSnapshot::default()
            },
            SelectionSessionSnapshot {
                mode: "x".repeat(MAX_SELECTION_MODE_BYTES + 1),
                ..SelectionSessionSnapshot::default()
            },
        ] {
            assert!(validate_selection_session(&invalid).is_err());
        }
    }

    #[derive(Default)]
    struct TestPanelVisibilityEmitter {
        events: Mutex<Vec<PanelVisibilityPayload>>,
    }

    impl PanelVisibilityEventEmitter for TestPanelVisibilityEmitter {
        fn emit_panel_visibility(&self, payload: PanelVisibilityPayload) -> anyhow::Result<()> {
            self.events.lock().push(payload);
            Ok(())
        }
    }

    #[test]
    fn panel_visibility_emits_each_open_state_transition_once() {
        let visible = AtomicBool::new(false);
        let emitter = TestPanelVisibilityEmitter::default();

        publish_panel_visibility_transition(&visible, &emitter, true, None).unwrap();
        publish_panel_visibility_transition(&visible, &emitter, true, None).unwrap();
        publish_panel_visibility_transition(
            &visible,
            &emitter,
            false,
            Some(PanelVisibilityReason::Closed),
        )
        .unwrap();

        assert_eq!(
            *emitter.events.lock(),
            vec![
                PanelVisibilityPayload {
                    visible: true,
                    reason: None,
                },
                PanelVisibilityPayload {
                    visible: false,
                    reason: Some(PanelVisibilityReason::Closed),
                }
            ]
        );
    }

    #[test]
    fn panel_visibility_wire_distinguishes_closed_and_destroyed() {
        for (reason, expected) in [
            (PanelVisibilityReason::Closed, "closed"),
            (PanelVisibilityReason::Destroyed, "destroyed"),
        ] {
            let payload = PanelVisibilityPayload {
                visible: false,
                reason: Some(reason),
            };
            assert_eq!(
                serde_json::to_value(payload).unwrap(),
                serde_json::json!({ "visible": false, "reason": expected })
            );
        }

        assert_eq!(
            serde_json::to_value(PanelVisibilityPayload {
                visible: true,
                reason: None,
            })
            .unwrap(),
            serde_json::json!({ "visible": true })
        );
    }

    #[test]
    fn panel_command_close_reason_wins_if_destroyed_event_arrives_first() {
        let visible = AtomicBool::new(true);
        let pending_reason = Mutex::new(Some(PanelVisibilityReason::Closed));
        let emitter = TestPanelVisibilityEmitter::default();

        publish_panel_hidden_transition(
            &visible,
            &pending_reason,
            &emitter,
            PanelVisibilityReason::Destroyed,
        )
        .unwrap();
        publish_panel_hidden_transition(
            &visible,
            &pending_reason,
            &emitter,
            PanelVisibilityReason::Destroyed,
        )
        .unwrap();

        assert_eq!(
            *emitter.events.lock(),
            vec![PanelVisibilityPayload {
                visible: false,
                reason: Some(PanelVisibilityReason::Closed),
            }]
        );
    }

    #[test]
    fn panel_close_request_payload_uses_camel_case_request_id() {
        let payload = PanelCloseRequestedPayload {
            request_id: "close-1".to_string(),
        };

        assert_eq!(
            serde_json::to_value(payload).unwrap(),
            serde_json::json!({ "requestId": "close-1" })
        );
    }

    #[test]
    fn panel_close_ack_cancels_timeout_fallback() {
        let state = Mutex::new(PanelCloseRequestState::Idle);
        let fallback_calls = Mutex::new(0usize);

        assert!(begin_panel_close_request(&state, "close-1"));
        assert!(acknowledge_panel_close_request(&state, "close-1"));
        assert!(!run_panel_close_timeout(&state, "close-1", || {
            *fallback_calls.lock() += 1;
            Ok(())
        })
        .unwrap());

        assert_eq!(*fallback_calls.lock(), 0);
        assert_eq!(*state.lock(), PanelCloseRequestState::Idle);
    }

    #[test]
    fn panel_close_timeout_is_single_flight_for_repeated_clicks() {
        let state = Mutex::new(PanelCloseRequestState::Idle);
        let fallback_calls = Mutex::new(0usize);

        assert!(begin_panel_close_request(&state, "close-1"));
        assert!(!begin_panel_close_request(&state, "close-2"));
        assert!(!acknowledge_panel_close_request(&state, "close-2"));
        assert!(run_panel_close_timeout(&state, "close-1", || {
            *fallback_calls.lock() += 1;
            Ok(())
        })
        .unwrap());
        assert!(!run_panel_close_timeout(&state, "close-1", || {
            *fallback_calls.lock() += 1;
            Ok(())
        })
        .unwrap());

        assert_eq!(*fallback_calls.lock(), 1);
        assert_eq!(*state.lock(), PanelCloseRequestState::Idle);
    }

    #[test]
    fn frontend_lifecycle_targets_include_open_panel_only() {
        let open_labels = ["main", PANEL_LABEL];
        let targets =
            collect_frontend_lifecycle_targets(|label| open_labels.contains(&label).then_some(()));
        let labels = targets
            .into_iter()
            .map(|(label, ())| label)
            .collect::<Vec<_>>();

        assert_eq!(labels, vec!["main".to_string(), PANEL_LABEL.to_string()]);
    }

    #[test]
    fn panel_only_flush_failure_restores_every_original_handshake_target() {
        let target_windows = ["main", OVERLAY_LABEL, PANEL_LABEL]
            .into_iter()
            .map(str::to_string)
            .collect::<HashSet<_>>();
        let mut slot = Some(EditorFlushHandshake {
            id: "handshake-1".to_string(),
            completion: EditorFlushCompletion::Lifecycle(FrontendLifecycleAction::Quit),
            target_windows: target_windows.clone(),
            pending_windows: target_windows,
        });
        let active = slot.as_mut().expect("handshake should be active");
        assert!(active.pending_windows.remove("main"));
        assert!(active.pending_windows.remove(OVERLAY_LABEL));
        assert_eq!(
            active.pending_windows,
            HashSet::from([PANEL_LABEL.to_string()])
        );

        let canceled = take_editor_flush_handshake(&mut slot, "handshake-1")
            .expect("panel failure should cancel the handshake");

        assert_eq!(
            frontend_lifecycle_restore_labels(&canceled.target_windows),
            vec!["main", OVERLAY_LABEL, PANEL_LABEL]
        );
        assert!(slot.is_none());
    }

    #[test]
    fn history_flush_request_keeps_existing_event_contract() {
        let payload = EditorFlushRequest {
            handshake_id: "history-1".to_string(),
            action: FrontendFlushAction::History,
        };

        assert_eq!(
            serde_json::to_value(payload).unwrap(),
            serde_json::json!({
                "handshakeId": "history-1",
                "action": "history"
            })
        );
    }

    #[test]
    fn history_flush_completes_only_after_every_window_ack() {
        let (sender, mut receiver) = tokio::sync::oneshot::channel();
        let target_windows = ["main", PANEL_LABEL]
            .into_iter()
            .map(str::to_string)
            .collect::<HashSet<_>>();
        let mut slot = Some(EditorFlushHandshake {
            id: "history-1".to_string(),
            completion: EditorFlushCompletion::History {
                operation_id: "00000000-0000-0000-0000-000000000001".to_string(),
                sender: Some(sender),
                phase: FrontendHistoryFlushPhase::Collecting,
                barrier: None,
            },
            target_windows: target_windows.clone(),
            pending_windows: target_windows,
        });
        let gate = Arc::new(crate::state::history::HistoryAdmissionGate::default());

        assert!(
            acknowledge_editor_flush_handshake(&mut slot, "history-1", "main", &gate,).is_none()
        );
        assert!(matches!(
            receiver.try_recv(),
            Err(tokio::sync::oneshot::error::TryRecvError::Empty)
        ));

        let closing =
            acknowledge_editor_flush_handshake(&mut slot, "history-1", PANEL_LABEL, &gate)
                .expect("last window should begin gate close");
        assert!(matches!(
            closing,
            EditorFlushAcknowledge::HistoryClosing { .. }
        ));
        assert!(gate.is_closed());
        assert!(slot.as_ref().is_some_and(|active| {
            active.completion.history_phase() == Some(FrontendHistoryFlushPhase::Closing)
        }));
        assert!(matches!(
            receiver.try_recv(),
            Err(tokio::sync::oneshot::error::TryRecvError::Empty)
        ));
    }

    #[test]
    fn acknowledged_history_window_blocks_new_mutations_while_other_window_drains() {
        let (sender, _receiver) = tokio::sync::oneshot::channel();
        let targets = HashSet::from(["main".to_string(), PANEL_LABEL.to_string()]);
        let mut slot = Some(EditorFlushHandshake {
            id: "history-1".to_string(),
            completion: EditorFlushCompletion::History {
                operation_id: "00000000-0000-0000-0000-000000000001".to_string(),
                sender: Some(sender),
                phase: FrontendHistoryFlushPhase::Collecting,
                barrier: None,
            },
            target_windows: targets.clone(),
            pending_windows: targets,
        });

        let gate = Arc::new(crate::state::history::HistoryAdmissionGate::default());
        assert!(
            acknowledge_editor_flush_handshake(&mut slot, "history-1", "main", &gate,).is_none()
        );
        assert!(frontend_history_mutation_blocked(&slot, "main"));
        assert!(!frontend_history_mutation_blocked(&slot, PANEL_LABEL));
    }

    #[test]
    fn history_flush_ready_releases_gate_before_frontend_lock() {
        let gate = Arc::new(crate::state::history::HistoryAdmissionGate::default());
        let barrier = gate.close("00000000-0000-0000-0000-000000000001").unwrap();
        let release_count = Arc::new(AtomicUsize::new(0));
        let release_count_for_guard = Arc::clone(&release_count);
        let mut ready = FrontendHistoryFlushReady {
            barrier: Some(barrier),
            complete: Some(Box::new(move || {
                release_count_for_guard.fetch_add(1, Ordering::SeqCst);
            })),
        };

        let barrier = ready.take_barrier();
        assert!(gate.is_closed());
        drop(barrier);
        assert!(!gate.is_closed());
        assert_eq!(release_count.load(Ordering::SeqCst), 0);

        drop(ready);
        assert_eq!(release_count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn lifecycle_flush_interrupts_history_but_history_cannot_replace_lifecycle() {
        let (history_sender, mut history_receiver) = tokio::sync::oneshot::channel();
        let mut slot = Some(EditorFlushHandshake {
            id: "history-1".to_string(),
            completion: EditorFlushCompletion::History {
                operation_id: "00000000-0000-0000-0000-000000000001".to_string(),
                sender: Some(history_sender),
                phase: FrontendHistoryFlushPhase::Collecting,
                barrier: None,
            },
            target_windows: HashSet::from(["main".to_string()]),
            pending_windows: HashSet::from(["main".to_string()]),
        });
        let lifecycle = EditorFlushHandshake {
            id: "quit-1".to_string(),
            completion: EditorFlushCompletion::Lifecycle(FrontendLifecycleAction::Quit),
            target_windows: HashSet::from(["main".to_string()]),
            pending_windows: HashSet::from(["main".to_string()]),
        };

        let LifecycleHandshakeInstall::InterruptedHistory(interrupted) =
            install_lifecycle_handshake(&mut slot, lifecycle)
        else {
            panic!("lifecycle should replace history");
        };
        let interrupted = *interrupted;
        let EditorFlushCompletion::History { sender, .. } = interrupted.completion else {
            panic!("interrupted completion should be history");
        };
        assert!(sender
            .expect("history sender should still be present")
            .send(Err(HISTORY_FRONTEND_FLUSH_INTERRUPTED.to_string()))
            .is_ok());
        assert!(matches!(
            history_receiver.try_recv().unwrap(),
            Err(error) if error == HISTORY_FRONTEND_FLUSH_INTERRUPTED
        ));

        let (next_history_sender, _next_history_receiver) = tokio::sync::oneshot::channel();
        let next_history = EditorFlushHandshake {
            id: "history-2".to_string(),
            completion: EditorFlushCompletion::History {
                operation_id: "00000000-0000-0000-0000-000000000002".to_string(),
                sender: Some(next_history_sender),
                phase: FrontendHistoryFlushPhase::Collecting,
                barrier: None,
            },
            target_windows: HashSet::from(["main".to_string()]),
            pending_windows: HashSet::from(["main".to_string()]),
        };
        assert!(!install_history_handshake(&mut slot, next_history));
        assert!(slot
            .as_ref()
            .is_some_and(|active| active.completion.is_lifecycle()));
    }

    #[test]
    fn closing_history_can_time_out_and_reopen_the_gate() {
        let (sender, _receiver) = tokio::sync::oneshot::channel();
        let gate = Arc::new(crate::state::history::HistoryAdmissionGate::default());
        let mut slot = Some(EditorFlushHandshake {
            id: "history-closing".to_string(),
            completion: EditorFlushCompletion::History {
                operation_id: "00000000-0000-0000-0000-000000000003".to_string(),
                sender: Some(sender),
                phase: FrontendHistoryFlushPhase::Collecting,
                barrier: None,
            },
            target_windows: HashSet::from(["main".to_string()]),
            pending_windows: HashSet::from(["main".to_string()]),
        });

        assert!(matches!(
            acknowledge_editor_flush_handshake(&mut slot, "history-closing", "main", &gate,),
            Some(EditorFlushAcknowledge::HistoryClosing { .. })
        ));
        assert!(gate.is_closed());

        let timed_out = take_cancelable_editor_flush_handshake(&mut slot, "history-closing")
            .expect("closing history should remain cancelable");
        drop(timed_out);

        assert!(!gate.is_closed());
        assert!(slot.is_none());
    }

    #[test]
    fn running_history_defers_lifecycle_and_blocks_new_history() {
        let mut slot = Some(EditorFlushHandshake {
            id: "history-running".to_string(),
            completion: EditorFlushCompletion::History {
                operation_id: "00000000-0000-0000-0000-000000000004".to_string(),
                sender: None,
                phase: FrontendHistoryFlushPhase::Running,
                barrier: None,
            },
            target_windows: HashSet::from(["main".to_string()]),
            pending_windows: HashSet::new(),
        });
        let lifecycle = EditorFlushHandshake {
            id: "quit-deferred".to_string(),
            completion: EditorFlushCompletion::Lifecycle(FrontendLifecycleAction::Quit),
            target_windows: HashSet::from(["main".to_string()]),
            pending_windows: HashSet::from(["main".to_string()]),
        };

        assert!(matches!(
            install_lifecycle_handshake(&mut slot, lifecycle),
            LifecycleHandshakeInstall::DeferredUntilHistoryComplete
        ));
        assert!(take_cancelable_editor_flush_handshake(&mut slot, "history-running").is_none());

        let (sender, _receiver) = tokio::sync::oneshot::channel();
        let next_history = EditorFlushHandshake {
            id: "history-next".to_string(),
            completion: EditorFlushCompletion::History {
                operation_id: "00000000-0000-0000-0000-000000000005".to_string(),
                sender: Some(sender),
                phase: FrontendHistoryFlushPhase::Collecting,
                barrier: None,
            },
            target_windows: HashSet::from(["main".to_string()]),
            pending_windows: HashSet::from(["main".to_string()]),
        };
        assert!(!install_history_handshake(&mut slot, next_history));
        assert!(take_cancelable_editor_flush_handshake(&mut slot, "history-old").is_none());
    }

    #[test]
    fn bootstrap_keyboard_state_includes_mode_and_registered_event_key_names() {
        let manager = KeyboardManager::new(
            HashMap::from([("4key".to_string(), vec!["KeyD".into()])]),
            "4key",
        );

        assert!(manager.register_key_down("4key", "KeyD"));
        assert_eq!(
            bootstrap_keyboard_state(&manager),
            ("4key".to_string(), vec!["KeyD".to_string()])
        );
    }

    #[test]
    fn event_age_uses_daemon_wall_clock_timestamp_when_sane() {
        assert_eq!(
            resolve_event_age_ms(Some(1_000.0), Some(1_025.5), 3.0),
            25.5
        );
    }

    #[test]
    fn event_age_falls_back_for_invalid_wall_clock_delta() {
        for input_ts_ms in [Some(2_000.0), Some(f64::NAN), Some(-f64::INFINITY)] {
            assert_eq!(resolve_event_age_ms(input_ts_ms, Some(1_000.0), 7.0), 7.0);
        }
        assert_eq!(
            resolve_event_age_ms(Some(1_000.0), Some(11_001.0), 7.0),
            7.0
        );
        assert_eq!(resolve_event_age_ms(None, Some(1_000.0), 7.0), 7.0);
    }

    #[test]
    fn key_state_payload_exposes_hold_duration_on_up_only() {
        let down = key_state_payload("A", "DOWN", "4key", 2.0, true, Some(15.0));
        let up = key_state_payload("A", "UP", "4key", 3.0, false, Some(15.0));
        let unmatched_up = key_state_payload("A", "UP", "4key", 3.0, false, None);

        assert!(down.get("holdDurationMs").is_none());
        assert_eq!(up["holdDurationMs"], serde_json::json!(15.0));
        assert!(unmatched_up.get("holdDurationMs").is_none());
    }

    #[test]
    fn canonical_hold_duration_requires_matching_transition_source() {
        assert_eq!(canonical_hold_duration_ms(true, Some(15.0)), Some(15.0));
        assert_eq!(canonical_hold_duration_ms(false, Some(15.0)), None);
        assert_eq!(canonical_hold_duration_ms(true, None), None);
    }

    #[test]
    fn keyboard_recovery_backoff_grows_and_stops_at_the_limit() {
        let mut current_attempt = 0;
        for (index, delay_ms) in KEYBOARD_RECOVERY_DELAYS_MS.into_iter().enumerate() {
            let plan = next_keyboard_recovery_plan(current_attempt, Duration::ZERO).unwrap();
            assert_eq!(plan.attempt, index + 1);
            assert_eq!(plan.delay, Duration::from_millis(delay_ms));
            current_attempt = plan.attempt;
        }

        assert!(next_keyboard_recovery_plan(current_attempt, Duration::ZERO).is_none());
    }

    #[test]
    fn stable_keyboard_daemon_resets_the_recovery_budget() {
        let plan = next_keyboard_recovery_plan(5, KEYBOARD_DAEMON_STABLE_RUNTIME).unwrap();

        assert_eq!(plan.attempt, 1);
        assert_eq!(plan.delay, Duration::from_millis(250));
    }

    #[test]
    fn keyboard_recovery_guard_rejects_teardown_and_stale_tasks() {
        assert!(should_recover_keyboard_daemon(false, 7, Some(7), 7));
        assert!(!should_recover_keyboard_daemon(true, 7, Some(7), 7));
        assert!(!should_recover_keyboard_daemon(false, 8, Some(7), 7));
        assert!(!should_recover_keyboard_daemon(false, 7, Some(8), 7));
        assert!(!should_recover_keyboard_daemon(false, 7, None, 7));
    }

    #[test]
    fn startup_authorizes_global_and_tab_css_paths_even_when_disabled() {
        let mut state = AppStoreData {
            use_custom_css: false,
            custom_css: CustomCss {
                path: Some("/tmp/global.css".to_string()),
                content: String::new(),
            },
            ..AppStoreData::default()
        };
        state.tab_css_overrides.insert(
            "4key".to_string(),
            TabCss {
                path: Some("/tmp/tab.css".to_string()),
                content: String::new(),
                enabled: false,
            },
        );

        let authorized = collect_authorized_css_paths(&state);

        assert!(authorized.contains(&path_identity_key(Path::new("/tmp/global.css"))));
        assert!(authorized.contains(&path_identity_key(Path::new("/tmp/tab.css"))));
        assert_eq!(global_css_watch_path(&state), None);
    }

    #[test]
    fn overlay_dimension_clamp_covers_tall_track_layouts() {
        // 트랙 높이 상한(2000) + 키 영역 + 패딩 조합은 이전 상한 2000을 넘어 잘렸음
        assert_eq!(clamp_overlay_dimension(2400.0), 2400.0);
        assert_eq!(clamp_overlay_dimension(4096.0), 4096.0);
        assert_eq!(clamp_overlay_dimension(5000.0), 4096.0);
        assert_eq!(clamp_overlay_dimension(10.0), 100.0);
        assert_eq!(clamp_overlay_dimension(705.4), 705.0);
    }

    /// physical 3840x2160 단일 모니터 (logical 폭/높이는 scale로 나눈 값)
    fn reset_test_monitors(scale: f64) -> MonitorData {
        MonitorData {
            specs: vec![MonitorSpec {
                logical_origin_x: 0.0,
                logical_origin_y: 0.0,
                logical_width: 3_840.0 / scale,
                logical_height: 2_160.0 / scale,
                physical_origin_x: 0.0,
                physical_origin_y: 0.0,
                physical_width: 3_840.0,
                physical_height: 2_160.0,
                scale_factor: scale,
            }],
            primary_index: Some(0),
        }
    }

    #[test]
    fn overlay_reset_falls_back_to_stored_rect_when_window_is_absent() {
        // 오버레이를 끈 채 재시작하면 창이 없다 - 저장된 위치가 유일한 근거
        let monitors = reset_test_monitors(1.0);
        let stored = OverlayBounds {
            x: -3200.0,
            y: 980.0,
            width: 1240.0,
            height: 620.0,
        };
        let (position, size) = overlay_reset_fallback_rect(Some(&stored), true, &monitors);
        assert_eq!((position.x, position.y), (-3200.0, 980.0));
        assert_eq!((size.width, size.height), (1240.0, 620.0));
    }

    #[test]
    fn overlay_reset_converts_legacy_physical_stored_rect() {
        // overlay_bounds_are_logical은 serde(default) = false라 구버전 store는 physical px다.
        // 이를 logical로 오인하면 겹침 판정이 배로 부풀어 엉뚱한 모니터를 고르고,
        // defer_overlay_bounds가 마커를 true로 굳혀 변환 기회가 영영 사라진다
        let monitors = reset_test_monitors(2.0);
        let legacy = OverlayBounds {
            x: 400.0,
            y: 200.0,
            width: 1720.0,
            height: 640.0,
        };

        let (position, size) = overlay_reset_fallback_rect(Some(&legacy), false, &monitors);
        assert_eq!((position.x, position.y), (200.0, 100.0));
        assert_eq!((size.width, size.height), (860.0, 320.0));

        // 마커가 true면 이미 환산된 값이므로 그대로 쓴다
        let (position, size) = overlay_reset_fallback_rect(Some(&legacy), true, &monitors);
        assert_eq!((position.x, position.y), (400.0, 200.0));
        assert_eq!((size.width, size.height), (1720.0, 640.0));
    }

    #[test]
    fn overlay_reset_defaults_when_legacy_rect_cannot_be_converted() {
        // 모니터 정보를 못 얻으면 physical 값을 logical로 오인하느니 기본 크기가 안전하다
        let monitors = MonitorData {
            specs: Vec::new(),
            primary_index: None,
        };
        let legacy = OverlayBounds {
            x: 400.0,
            y: 200.0,
            width: 1720.0,
            height: 640.0,
        };
        let (position, size) = overlay_reset_fallback_rect(Some(&legacy), false, &monitors);
        assert_eq!((position.x, position.y), (0.0, 0.0));
        assert_eq!(
            (size.width, size.height),
            (DEFAULT_OVERLAY_WIDTH, DEFAULT_OVERLAY_HEIGHT)
        );
    }

    #[test]
    fn stored_bounds_normalization_respects_the_logical_marker() {
        // resize_overlay의 initializing 분기도 같은 정규화를 거친다.
        // 마커를 무시하고 physical 좌표를 쓰면 defer_overlay_bounds가 마커를
        // true로 굳혀 좌표가 영구 고착된다
        let monitors = reset_test_monitors(2.0);
        let stored = OverlayBounds {
            x: 400.0,
            y: 200.0,
            width: 1720.0,
            height: 640.0,
        };

        let converted = normalize_stored_overlay_bounds(Some(&stored), false, &monitors)
            .expect("physical 좌표는 환산되어야 한다");
        assert_eq!((converted.x, converted.y), (200.0, 100.0));
        assert_eq!((converted.width, converted.height), (860.0, 320.0));

        let passthrough = normalize_stored_overlay_bounds(Some(&stored), true, &monitors)
            .expect("logical 좌표는 그대로 쓴다");
        assert_eq!((passthrough.x, passthrough.y), (400.0, 200.0));

        // 환산 근거가 없으면 None - 호출부가 창의 실제 위치를 유지하도록
        let blind = MonitorData::default();
        assert!(normalize_stored_overlay_bounds(Some(&stored), false, &blind).is_none());

        // 깨진 값은 마커와 무관하게 거른다
        let broken = OverlayBounds {
            x: f64::NAN,
            y: 20.0,
            width: 800.0,
            height: 300.0,
        };
        assert!(normalize_stored_overlay_bounds(Some(&broken), true, &monitors).is_none());
        assert!(normalize_stored_overlay_bounds(None, true, &monitors).is_none());
    }

    #[test]
    fn monitor_data_is_gathered_only_for_unconverted_stored_bounds() {
        // 이 판단이 뒤집히면 initializing 분기가 환산 없이 physical 좌표를 써서
        // M1이 그대로 재발한다. 순수 정규화 테스트만으로는 잡히지 않는 배선이다
        let stored = OverlayBounds {
            x: 400.0,
            y: 200.0,
            width: 1720.0,
            height: 640.0,
        };
        assert!(stored_bounds_need_monitor_data(false, Some(&stored)));
        assert!(!stored_bounds_need_monitor_data(true, Some(&stored)));
        // 저장값이 없으면 환산할 대상 자체가 없다
        assert!(!stored_bounds_need_monitor_data(false, None));
        assert!(!stored_bounds_need_monitor_data(true, None));
    }

    #[test]
    fn stored_bounds_normalization_rejects_overflowing_conversions() {
        // scale 가드는 0보다 크기만 하면 통과시키므로, 극단적으로 작은 scale에서
        // 나눗셈이 inf로 넘친다. 위치는 clamp 대상이 아니라 여기서 걸러야 store로 새지 않는다
        let monitors = MonitorData {
            specs: vec![MonitorSpec {
                logical_origin_x: 0.0,
                logical_origin_y: 0.0,
                logical_width: 1_920.0,
                logical_height: 1_080.0,
                physical_origin_x: 0.0,
                physical_origin_y: 0.0,
                physical_width: 1_920.0,
                physical_height: 1_080.0,
                scale_factor: 1e-300,
            }],
            primary_index: Some(0),
        };
        let stored = OverlayBounds {
            x: 1e200,
            y: 1e200,
            width: 1e200,
            height: 1e200,
        };
        assert!(normalize_stored_overlay_bounds(Some(&stored), false, &monitors).is_none());
    }

    #[test]
    fn overlay_reset_fallback_repairs_missing_or_broken_stored_rect() {
        let monitors = reset_test_monitors(1.0);
        let (position, size) = overlay_reset_fallback_rect(None, true, &monitors);
        assert_eq!((position.x, position.y), (0.0, 0.0));
        assert_eq!(
            (size.width, size.height),
            (DEFAULT_OVERLAY_WIDTH, DEFAULT_OVERLAY_HEIGHT)
        );

        // 크기가 0이거나 NaN이면 중앙 정렬 계산이 무의미해진다
        let collapsed = OverlayBounds {
            x: 10.0,
            y: 20.0,
            width: 0.0,
            height: 300.0,
        };
        let (_, size) = overlay_reset_fallback_rect(Some(&collapsed), true, &monitors);
        assert_eq!(
            (size.width, size.height),
            (DEFAULT_OVERLAY_WIDTH, DEFAULT_OVERLAY_HEIGHT)
        );

        let broken = OverlayBounds {
            x: f64::NAN,
            y: 20.0,
            width: 800.0,
            height: 300.0,
        };
        let (_, size) = overlay_reset_fallback_rect(Some(&broken), true, &monitors);
        assert_eq!(
            (size.width, size.height),
            (DEFAULT_OVERLAY_WIDTH, DEFAULT_OVERLAY_HEIGHT)
        );

        // 저장된 크기가 한계를 넘으면 잘라 쓴다
        let oversized = OverlayBounds {
            x: 0.0,
            y: 0.0,
            width: 9000.0,
            height: 40.0,
        };
        let (_, size) = overlay_reset_fallback_rect(Some(&oversized), true, &monitors);
        assert_eq!((size.width, size.height), (4096.0, 100.0));
    }
}
