use std::{
    collections::{BTreeSet, HashMap, HashSet, VecDeque},
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
use serde::Serialize;
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
    panel_drag::PanelDragController,
    plugin::{PluginAuthorityLease, PluginRuntimeAuthority},
    store::{
        AdmittedEditorTransaction, AdmittedGestureCommit, AppStore, PluginInstancesResetScope,
    },
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
        CommittedEditorChange, DefaultsPayload, EditorCommitRequest, GestureCommitRequest,
        HistoryStatus, KeyCounterSettings, KeyCounters, KeyMappings, KeyPositions, KeySlot,
        KeySoundOutputBackendPersist, OverlayBounds, OverlayResizeAnchor, PanelBounds,
        SettingsDiff, SettingsState, StoredOverlayBounds, StoredOverlayNativePosition,
        TabCssOverrides,
    },
    services::{
        css_watcher::CssWatcher,
        event_publisher::publish_event,
        obs_bridge::ObsBridgeService,
        overlay_hit::{OverlayHitRect, OverlayHitService},
        settings::SettingsService,
    },
    state::local_asset_path::path_identity_key,
};

const OVERLAY_LABEL: &str = "overlay";
pub(crate) const PANEL_LABEL: &str = "panel";
const FRONTEND_LIFECYCLE_WINDOW_LABELS: [&str; 2] = ["main", OVERLAY_LABEL];
// 메인이 window.open을 부르기 직전 arm하고, 이 시간 안에 온 요청만 패널 창으로 인정
const PANEL_OPEN_ARM_TIMEOUT: Duration = Duration::from_secs(2);
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

/// 저장된 사각형을 logical 좌표로 정규화한다.
/// 구버전 store는 physical px를 담고 있으므로(`overlay_bounds_are_logical == false`)
/// 환산이 필요하다. 모니터 조회가 비어 환산 근거가 없으면 `fallback_scale`
/// (보통 창 자신의 scale)로 재시도한다 - 모니터 열거는 실패해도 창 scale은
/// 살아 있는 경우가 있어, 환산을 포기하고 physical 값을 그대로 쓰는 것보다 낫다.
/// 그래도 실패하면 None - 호출부가 각자 안전한 대체 경로를 고른다
#[cfg(not(target_os = "windows"))]
fn normalize_stored_overlay_bounds(
    stored: Option<&StoredOverlayBounds>,
    bounds_are_logical: bool,
    monitors: &MonitorData,
    fallback_scale: Option<f64>,
) -> Option<OverlayBounds> {
    let usable = stored?.public_bounds();
    if !overlay_bounds_are_usable(&usable) {
        return None;
    }

    let normalized = if bounds_are_logical {
        usable
    } else {
        match convert_physical_bounds_to_logical(&usable, monitors) {
            Some(converted) => converted,
            None => {
                let scale = fallback_scale?;
                log::warn!(
                    "[overlay] monitor data unavailable; converting stored bounds with window scale {scale}"
                );
                scale_physical_bounds_to_logical(&usable, scale)?
            }
        }
    };

    // 극단적으로 작은 scale로 나누면 inf로 넘칠 수 있어 결과도 재검증한다
    overlay_bounds_are_usable(&normalized).then_some(normalized)
}

/// 초기화 resize에서 복원 좌표를 어디에 놓을지 정한다.
/// 저장된 크기가 아니라 **이번에 적용될 크기**로 판정해야, 화면 안으로
/// 되돌린다는 목적을 실제로 달성한다 (콘텐츠 크기는 첫 resize에서 처음 확정됨)
fn monitor_scale_is_usable(scale: f64) -> bool {
    scale.is_finite() && scale > 0.0
}

/// 주어진 scale 하나로 physical 사각형을 logical로 나눈다
#[cfg(not(target_os = "windows"))]
fn scale_physical_bounds_to_logical(bounds: &OverlayBounds, scale: f64) -> Option<OverlayBounds> {
    if !monitor_scale_is_usable(scale) {
        return None;
    }

    Some(OverlayBounds {
        x: bounds.x / scale,
        y: bounds.y / scale,
        width: bounds.width / scale,
        height: bounds.height / scale,
    })
}

/// 창이 없을 때 위치 초기화가 딛고 설 사각형.
/// 저장된 값을 쓰되, 없거나 깨졌거나 환산 불가면 기본 크기로 되돌린다
fn overlay_reset_fallback_rect(
    stored: Option<&StoredOverlayBounds>,
    bounds_are_logical: bool,
    monitors: &MonitorData,
) -> NativePlacement {
    resolve_overlay_placement(stored, bounds_are_logical, monitors).placement
}

const PANEL_WIDTH: f64 = 240.0;
// 분리 패널과 메인 창 사이 여백
const PANEL_BESIDE_GAP: f64 = 16.0;
// 피커가 트리거 행 아래에 그대로 들어갈 세로 여유 - 이보다 낮으면 팝업이
// 매번 위로 뒤집히거나 창 경계로 클램프됨. 늘리는 것만 허용
const PANEL_INITIAL_HEIGHT: f64 = 712.0;
const PANEL_MIN_HEIGHT: f64 = 712.0;
const PANEL_MAX_HEIGHT_RATIO: f64 = 0.9;
const PANEL_FALLBACK_MAX_HEIGHT: f64 = 10_000.0;
const PANEL_BOUNDS_DEBOUNCE_MS: u64 = 400;
const PANEL_CLOSE_ACK_TIMEOUT: Duration = Duration::from_millis(1_500);
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
pub(crate) const MUTATION_SHUTDOWN_STARTED: &str = "MUTATION_SHUTDOWN_STARTED";

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

impl PanelBoundsChange {
    // 복원에 쓰는 값은 높이뿐이라 이동은 디스크로 가지 않는다.
    // x/y는 store 호환을 위해 계속 기록만 되고 창 배치에는 쓰이지 않음
    fn changes_persisted_bounds(self) -> bool {
        !matches!(self, Self::Moved(_))
    }
}

#[derive(Default)]
struct PanelBoundsPersistenceState {
    latest: Option<PanelBoundsSample>,
    window: Option<WebviewWindow>,
    applied_max_height: Option<f64>,
    // 초기화로 발생한 resize가 비운 저장값을 되살리지 않게 하는 기본 높이 추적
    unpersisted_default_height: Option<f64>,
    default_height_pending: bool,
    session: u64,
    generation: u64,
    worker_running: bool,
    // dirty는 워커가 처리할 변경이 남았는지, persist_dirty는 그중 저장까지 필요한지
    dirty: bool,
    persist_dirty: bool,
    active: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct PanelBoundsPersistWork {
    session: u64,
    generation: u64,
    sample: PanelBoundsSample,
    persist: bool,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OverlayCloseAction {
    AllowClose,
    PreserveVisibility,
    HideAndPersist,
}

fn overlay_close_action(force_close: bool, lifecycle_pending: bool) -> OverlayCloseAction {
    if force_close {
        OverlayCloseAction::AllowClose
    } else if lifecycle_pending {
        OverlayCloseAction::PreserveVisibility
    } else {
        OverlayCloseAction::HideAndPersist
    }
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

#[cfg(any(target_os = "windows", test))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct PanelPresentSnapshot {
    panel_visible: bool,
    panel_detached: bool,
    panel_destroy_reason: Option<PanelVisibilityReason>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PanelCloseRequestedPayload {
    request_id: String,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyCountersStatePayload<'a> {
    session_id: &'a str,
    revision: u64,
    counters: &'a KeyCounters,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyCounterPayload<'a> {
    mode: &'a str,
    key: &'a str,
    count: u32,
    session_id: &'a str,
    revision: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InputAxisPayload<'a> {
    axis_id: &'a str,
    value: u32,
    full: u32,
}

#[derive(Serialize)]
struct RawInputPayload<'a> {
    label: &'a str,
    labels: &'a [String],
    state: &'a str,
    device: &'a str,
}

#[derive(Serialize)]
struct InputPressPayload<'a> {
    label: &'a str,
    mode: &'a str,
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
    key_sound_bindings_generation: u64,
}

#[derive(Debug, Clone, PartialEq)]
struct KeySoundBinding {
    sound_path: String,
    per_key_volume: f32,
}

type KeySoundBindingTable = HashMap<String, Vec<Option<KeySoundBinding>>>;

fn build_key_sound_binding_table(key_positions: &KeyPositions) -> KeySoundBindingTable {
    key_positions
        .iter()
        .map(|(mode, positions)| {
            let bindings = positions
                .iter()
                .map(|position| {
                    if !position.sound_enabled.unwrap_or(false) {
                        return None;
                    }
                    let sound_path = position.sound_path.as_deref()?.trim();
                    if sound_path.is_empty() {
                        return None;
                    }
                    let volume_percent = position.sound_volume.unwrap_or(100.0);
                    Some(KeySoundBinding {
                        sound_path: sound_path.to_string(),
                        per_key_volume: (volume_percent / 100.0).clamp(0.0, 2.0) as f32,
                    })
                })
                .collect();
            (mode.clone(), bindings)
        })
        .collect()
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
        publish_event(self, "keys:counters", counters);
        publish_event(
            self,
            "keys:counters-state",
            KeyCountersStatePayload {
                session_id,
                revision,
                counters,
            },
        );
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
        publish_event(
            self,
            "keys:counter",
            KeyCounterPayload {
                mode,
                key,
                count,
                session_id,
                revision,
            },
        );
        Ok(())
    }
}

fn should_create_overlay_on_startup(obs_mode_enabled: bool, overlay_visible: bool) -> bool {
    !obs_mode_enabled && overlay_visible
}

// 기동 시 메인 창을 트레이에 숨긴 채 둘지. 트레이가 꺼져 있으면 숨겨도 되살릴 방법이 없다.
// 메인 창 표시와 분리 패널 복원이 같은 판정을 쓰도록 여기 한 곳에서만 정한다
fn main_window_starts_hidden(tray_enabled: bool, main_window_hidden: bool) -> bool {
    tray_enabled && main_window_hidden
}

// 트레이 시작에서는 복원 보류 - 숨은 메인 창 의존 방지(background throttling)
// 플래그는 유지되므로 다음 정상 기동 때 복원됨.
// main_window_hidden에는 main_window_starts_hidden으로 확정한 최종 가시성을 넘긴다
fn should_restore_panel_on_startup(
    obs_mode_enabled: bool,
    main_window_hidden: bool,
    panel_detached: bool,
) -> bool {
    panel_detached && !obs_mode_enabled && !main_window_hidden
}

// arm 토큰은 1회 소비 - 만료됐거나 없으면 거부하고 슬롯도 비운다
fn take_panel_open_arm(slot: &mut Option<Instant>, now: Instant) -> bool {
    match slot.take() {
        Some(armed_at) => now.saturating_duration_since(armed_at) <= PANEL_OPEN_ARM_TIMEOUT,
        None => false,
    }
}

// 패널 창은 opener가 문서를 채우므로 빈 url(about:blank)로만 연다
fn is_panel_open_url(url: &str) -> bool {
    url.is_empty() || url == "about:blank"
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyStatePayload<'a> {
    key: &'a str,
    state: &'a str,
    mode: &'a str,
    event_age_ms: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    hold_duration_ms: Option<f64>,
}

fn key_state_payload<'a>(
    key: &'a str,
    state: &'a str,
    mode: &'a str,
    event_age_ms: f64,
    is_down: bool,
    hold_duration_ms: Option<f64>,
) -> KeyStatePayload<'a> {
    KeyStatePayload {
        key,
        state,
        mode,
        event_age_ms,
        hold_duration_ms: if is_down { None } else { hold_duration_ms },
    }
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

// 메인과 함께 감추는 전환. 이미 숨은 창은 건너뛰고, hide가 실패해도 표식을 세우지 않는다 -
// 우리가 감춘 창만 되돌리기 위한 표식이라 거짓 표식은 남의 창을 깨운다
fn hide_panel_with_main_transition(
    hidden_flag: &AtomicBool,
    visible: bool,
    hide: impl FnOnce() -> Result<()>,
) -> Result<bool> {
    if !visible {
        return Ok(false);
    }
    hide()?;
    Ok(!hidden_flag.swap(true, Ordering::SeqCst))
}

// 우리가 감췄던 패널만 되돌린다. show가 실패하면 표식을 되살려 다음 트레이 복귀에 남긴다
fn restore_panel_with_main_transition(
    hidden_flag: &AtomicBool,
    show: impl FnOnce() -> Result<()>,
) -> Result<bool> {
    if !hidden_flag.swap(false, Ordering::SeqCst) {
        return Ok(false);
    }
    if let Err(error) = show() {
        hidden_flag.store(true, Ordering::SeqCst);
        return Err(error);
    }
    Ok(true)
}

// 창이 사라지면 동행 복원 대상도 사라진다
fn drop_panel_hidden_with_main(hidden_flag: &AtomicBool) -> bool {
    hidden_flag.swap(false, Ordering::SeqCst)
}

pub struct AppState {
    pub store: Arc<AppStore>,
    pub settings: SettingsService,
    pub keyboard: KeyboardManager,
    overlay_visible: Arc<RwLock<bool>>,
    overlay_force_close: Arc<AtomicBool>,
    /// 오버레이 윈도우 초기화 중 Moved/Resized 이벤트에서 bounds 저장 억제
    overlay_initializing: Arc<AtomicBool>,
    overlay_resolved_placement: Arc<Mutex<Option<ResolvedOverlayPlacement>>>,
    overlay_placement_trust: Arc<Mutex<OverlayPlacementTrust>>,
    /// 오버레이 생성·가시성 전환 single-flight 가드
    /// 메인 스레드 이벤트 콜백에서 획득 금지 — setup 훅은 이벤트 루프 가동 전이라 예외
    overlay_creation_lock: Mutex<()>,
    /// 키 영역 히트 창. 내부 잠금은 store·overlay_creation_lock·번호표와 교차하지 않는다 -
    /// reconcile 경로에서 store.update를 호출하면 이 불변식이 깨진다
    overlay_hit: OverlayHitService,
    overlay_bounds_generation: Arc<AtomicU64>,
    plugin_authority: PluginRuntimeAuthority,
    panel_bounds_persistence: Arc<PanelBoundsPersistenceController>,
    panel_visible: AtomicBool,
    /// 트레이 숨김에 동행해 우리가 감춘 분리 패널 표식
    /// 메인이 다시 보일 때 이 표식이 선 창만 되돌린다
    panel_hidden_with_main: AtomicBool,
    panel_creation_lock: Mutex<()>,
    panel_drag: Arc<PanelDragController>,
    panel_close_request: Mutex<PanelCloseRequestState>,
    panel_destroy_reason: Mutex<Option<PanelVisibilityReason>>,
    /// 메인이 window.open 직전에 세우는 1회용 토큰 - 플러그인 JS 등 임의의 window.open이
    /// 패널 라벨 창을 만들지 못하게 fail-closed
    panel_open_armed: Mutex<Option<Instant>>,
    /// 기동 시 분리 상태 복원 요청 - 메인 렌더러가 부트스트랩 뒤 1회 소비해 window.open으로 연다
    panel_restore_pending: AtomicBool,
    keyboard_task: RwLock<Option<KeyboardDaemonTask>>,
    keyboard_task_generation: AtomicU64,
    key_counters: Arc<RwLock<KeyCounters>>,
    key_counters_session_id: String,
    key_counters_revision: AtomicU64,
    counter_history_barrier: Mutex<CounterHistoryBarrierState>,
    counter_history_ready: Condvar,
    runtime_publication: Mutex<RuntimePublicationState>,
    mutation_publication: Arc<MutationPublicationSequencer>,
    key_counter_enabled: Arc<AtomicBool>,
    /// Raw input stream subscriber count - emit only when > 0
    raw_input_subscribers: Arc<std::sync::atomic::AtomicU32>,
    key_sound: Arc<KeySoundEngine>,
    key_sound_bindings: RwLock<Arc<KeySoundBindingTable>>,
    key_sound_output_generation: Arc<AtomicU64>,
    // 잠금 순서: key_sound_output_persistence_lock → 번호표 turn (역순 금지)
    key_sound_output_persistence_lock: Arc<Mutex<()>>,
    /// 전역 CSS 상태와 워처 전환 직렬화
    css_operation_lock: Mutex<()>,
    /// 현재 세션에서 사용자가 승인한 CSS 경로
    authorized_css_paths: RwLock<HashSet<String>>,
    /// CSS 파일 핫리로딩 워처
    css_watcher: RwLock<Option<CssWatcher>>,
    /// OBS WebSocket 브릿지
    pub obs_bridge: Arc<ObsBridgeService>,
    /// OBS 시작, 중지, 토큰 회전 직렬화
    /// 잠금 순서: OBS lifecycle mutex -> mutation ticket, 역순 금지
    pub(crate) obs_lifecycle_lock: tokio::sync::Mutex<()>,
    /// OBS 모드 시작 전 오버레이 가시성 상태 (복원용)
    obs_previous_overlay_visible: Arc<RwLock<Option<bool>>>,
    shutdown_started: AtomicBool,
    process_exit_authorized: AtomicBool,
    shutdown_watchdog: Arc<Mutex<ShutdownWatchdogState>>,
    editor_flush_handshake: Arc<Mutex<Option<EditorFlushHandshake>>>,
    deferred_frontend_lifecycle: Mutex<Option<FrontendLifecycleAction>>,
}

#[derive(Default)]
struct MutationPublicationState {
    next_ticket: u64,
    serving_ticket: u64,
    completed_tickets: BTreeSet<u64>,
    exhausted: bool,
}

#[derive(Default)]
pub(crate) struct MutationPublicationSequencer {
    state: Mutex<MutationPublicationState>,
    turn_ready: Condvar,
}

pub(crate) struct MutationPublicationTicket {
    sequencer: Arc<MutationPublicationSequencer>,
    number: u64,
}

impl MutationPublicationSequencer {
    fn issue(self: &Arc<Self>) -> std::result::Result<MutationPublicationTicket, &'static str> {
        let mut state = self.state.lock();
        if state.exhausted {
            return Err("MUTATION_SEQUENCE_EXHAUSTED");
        }
        let number = state.next_ticket;
        if number == u64::MAX {
            state.exhausted = true;
        } else {
            state.next_ticket = number + 1;
        }
        Ok(MutationPublicationTicket {
            sequencer: Arc::clone(self),
            number,
        })
    }

    fn wait_for_turn(&self, number: u64) {
        let mut state = self.state.lock();
        while state.serving_ticket != number {
            self.turn_ready.wait(&mut state);
        }
    }

    fn complete(&self, number: u64) {
        let mut state = self.state.lock();
        if number < state.serving_ticket {
            return;
        }
        if number != state.serving_ticket {
            state.completed_tickets.insert(number);
            return;
        }

        loop {
            if state.serving_ticket == u64::MAX {
                break;
            }
            state.serving_ticket += 1;
            let serving_ticket = state.serving_ticket;
            if !state.completed_tickets.remove(&serving_ticket) {
                break;
            }
        }
        self.turn_ready.notify_all();
    }
}

impl MutationPublicationTicket {
    pub(crate) fn run<T>(self, mutation: impl FnOnce() -> T) -> T {
        self.sequencer.wait_for_turn(self.number);
        mutation()
    }
}

impl Drop for MutationPublicationTicket {
    fn drop(&mut self) {
        self.sequencer.complete(self.number);
    }
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
        // 저장된 출력 백엔드 초기화, 전환 깜빡임 방지
        let initial_backend = snapshot
            .key_sound_output_backend
            .clone()
            .map(output_backend_from_persist)
            .unwrap_or_default();
        let key_sound_output_generation = Arc::new(AtomicU64::new(0));
        let key_sound_output_persistence_lock = Arc::new(Mutex::new(()));
        let fallback_store = Arc::clone(&store);
        let fallback_generation = Arc::clone(&key_sound_output_generation);
        let fallback_persistence_lock = Arc::clone(&key_sound_output_persistence_lock);
        let key_sound = Arc::new(KeySoundEngine::with_output_backend(
            initial_backend,
            Arc::new(move |failed, settled| {
                let fallback_store = Arc::clone(&fallback_store);
                let fallback_generation = Arc::clone(&fallback_generation);
                let fallback_persistence_lock = Arc::clone(&fallback_persistence_lock);
                let generation = fallback_generation.load(Ordering::Acquire);
                if let Err(err) =
                    thread::Builder::new()
                        .name("key-sound-fallback-persist".to_string())
                        .spawn(move || {
                            let _persistence_guard = fallback_persistence_lock.lock();
                            let failed = output_backend_to_persist(failed);
                            let settled = output_backend_to_persist(settled);
                            if let Err(err) = fallback_store.update(move |state| {
                                if fallback_generation.load(Ordering::Acquire) == generation
                                    && state.key_sound_output_backend.as_ref().is_some_and(
                                        |current| output_backend_targets_match(current, &failed),
                                    )
                                {
                                    state.key_sound_output_backend = Some(settled);
                                }
                            }) {
                                log::warn!("failed to persist fallback output backend: {err:#}");
                            }
                        })
                {
                    log::warn!("failed to spawn fallback output persistence thread: {err}");
                }
            }),
        ));
        let key_sound_bindings = Arc::new(build_key_sound_binding_table(&snapshot.key_positions));
        let obs_bridge = Arc::new(ObsBridgeService::new(env!("CARGO_PKG_VERSION")));
        let authorized_css_paths = collect_authorized_css_paths(&snapshot);
        let panel_bounds_persistence =
            Arc::new(PanelBoundsPersistenceController::new(Arc::clone(&store)));

        Ok(Self {
            store,
            settings,
            keyboard,
            overlay_visible: Arc::new(RwLock::new(false)),
            overlay_force_close: Arc::new(AtomicBool::new(false)),
            overlay_initializing: Arc::new(AtomicBool::new(false)),
            overlay_resolved_placement: Arc::new(Mutex::new(None)),
            overlay_placement_trust: Arc::new(Mutex::new(OverlayPlacementTrust::Clean)),
            overlay_creation_lock: Mutex::new(()),
            overlay_hit: OverlayHitService::new(
                snapshot.overlay_visible,
                snapshot.overlay_locked,
                snapshot.always_on_top,
            ),
            overlay_bounds_generation: Arc::new(AtomicU64::new(0)),
            plugin_authority: PluginRuntimeAuthority::default(),
            panel_bounds_persistence,
            panel_visible: AtomicBool::new(false),
            panel_hidden_with_main: AtomicBool::new(false),
            panel_creation_lock: Mutex::new(()),
            panel_drag: Arc::new(PanelDragController::default()),
            panel_close_request: Mutex::new(PanelCloseRequestState::Idle),
            panel_destroy_reason: Mutex::new(None),
            panel_open_armed: Mutex::new(None),
            panel_restore_pending: AtomicBool::new(false),
            keyboard_task: RwLock::new(None),
            keyboard_task_generation: AtomicU64::new(0),
            key_counters,
            key_counters_session_id: uuid::Uuid::new_v4().simple().to_string(),
            key_counters_revision: AtomicU64::new(0),
            counter_history_barrier: Mutex::new(CounterHistoryBarrierState::default()),
            counter_history_ready: Condvar::new(),
            runtime_publication: Mutex::new(RuntimePublicationState::default()),
            mutation_publication: Arc::new(MutationPublicationSequencer::default()),
            key_counter_enabled,
            raw_input_subscribers: Arc::new(std::sync::atomic::AtomicU32::new(0)),
            key_sound,
            key_sound_bindings: RwLock::new(key_sound_bindings),
            key_sound_output_generation,
            key_sound_output_persistence_lock,
            css_operation_lock: Mutex::new(()),
            authorized_css_paths: RwLock::new(authorized_css_paths),
            css_watcher: RwLock::new(None),
            obs_bridge,
            obs_lifecycle_lock: tokio::sync::Mutex::new(()),
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
        // 분리 패널 복원은 메인 창 배치가 끝난 뒤 restore_detached_panel_on_startup이 요청만 남긴다
        // 개발자 모드가 켜져 있으면 시작 시 DevTools 오픈 허용 및 자동 오픈 시도
        if snapshot.developer_mode_enabled {
            if let Some(main) = app.get_webview_window("main") {
                main.open_devtools();
            }
            if let Some(overlay) = app.get_webview_window("overlay") {
                overlay.open_devtools();
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
        // 패널을 먼저 되살린다 - macOS show는 makeKeyAndOrderFront고, Windows는 z-order만
        // 올린다(MARKER_DONT_FOCUS가 지워지지 않아 show는 언제나 비활성 표시).
        // 메인 show+set_focus를 항상 뒤에 둬야 포커스와 최상단이 메인에 남는다
        self.restore_detached_panel_with_main(app);
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

    /// 기동 시 메인 창을 트레이에 숨긴 채 띄울지. 분리 패널 복원도 이 판정을 따른다
    pub fn should_start_main_window_hidden(&self) -> bool {
        self.store.with_state(|state| {
            main_window_starts_hidden(state.tray_enabled, state.main_window_hidden)
        })
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
            sprite_positions: state.sprite_positions.clone(),
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
        // OBS 브릿지 캐시 갱신
        if self.obs_bridge.is_running() {
            let bp = self.bootstrap_payload();
            if let Ok(snap) = serde_json::to_value(&bp) {
                self.obs_bridge.update_snapshot(snap);
            }
        }
        // 전체 설정 페이로드 전송 방지 (임베디드 폰트 등 대용량 데이터 제외)
        let mut payload = diff.clone();
        payload.full = None;
        publish_event(app, "settings:changed", payload);
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

        // 부팅 시에는 오버레이를 생성하지 않았으므로 이전 표시 상태만 저장
        // (initialize_runtime에서 obs_mode_enabled일 때 ensure_overlay_window 건너뜀)
        let was_visible = store.with_state(|s| s.overlay_visible);
        *self.obs_previous_overlay_visible.write() = Some(was_visible);
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
        // async start를 tokio 런타임에서 실행
        tauri::async_runtime::spawn(async move {
            let state = app_handle.state::<AppState>();
            let _lifecycle_guard = state.obs_lifecycle_lock.lock().await;
            let port = store.with_state(|s| s.obs_port);
            // 미저장 토큰 사용 방지를 위한 시작 중단
            let token = match state.resolve_and_save_obs_token() {
                Ok(token) => token,
                Err(e) => {
                    log::error!(
                        "[ObsBridge] auto-start 중단: 토큰 저장 실패 ({e}), obs_mode_enabled를 false로 복구"
                    );
                    let _ = store.update(|s| {
                        s.obs_mode_enabled = false;
                    });
                    state.obs_restore_overlay(&app_handle);
                    let _ = app_handle.emit("obs:status", &state.obs_bridge.status());
                    return;
                }
            };

            match bridge.start(port, token).await {
                Ok(actual_port) => {
                    log::info!("[ObsBridge] auto-start 성공 (port={})", actual_port);
                    // fallback 포트가 사용된 경우 store에 저장
                    if actual_port != port {
                        let _ = store.update(|s| {
                            s.obs_port = actual_port;
                        });
                    }
                    // 초기 스냅샷 캐싱 (신규 클라이언트에 전송됨)
                    state.refresh_obs_snapshot();
                    let _ = app_handle.emit("obs:status", &state.obs_bridge.status());
                }
                Err(e) => {
                    log::error!(
                        "[ObsBridge] auto-start 실패: {}, obs_mode_enabled를 false로 복구",
                        e
                    );
                    let _ = store.update(|state| {
                        state.obs_mode_enabled = false;
                    });
                    // 실패 시 오버레이 복원 (윈도우 재생성 포함)
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
        if let Err(error) = self.overlay_hit.reset_for_parent_loss(app) {
            log::warn!("failed to reset overlay hit state for OBS mode: {error:#}");
        }
        // destroy 성공(또는 윈도우 부재) 후 런타임 플래그만 갱신
        // store.overlay_visible은 변경하지 않음 — ensure_overlay_window가 재생성 시
        // 이 값을 기준으로 show/hide를 결정하므로, 원래 값을 유지해야 함
        *self.overlay_visible.write() = false;
        publish_event(app, "overlay:visibility", json!({ "visible": false }));
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

    /// OBS 브릿지 캐시 스냅샷 갱신
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

    /// OBS 브릿지 카운터 스냅샷 갱신
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

            // 오버레이가 숨겨진 동안 변경된 설정을 다시 적용.
            // 본체는 상시 클릭 통과 - 실제 잠금은 히트 창이 강제한다
            window.set_ignore_cursor_events(true)?;
            window.set_always_on_top(snapshot.always_on_top)?;
            #[cfg(target_os = "macos")]
            apply_macos_overlay_fullscreen_behavior(&window, snapshot.always_on_top);
            if let Err(error) = self.overlay_hit.set_configuration(
                app,
                true,
                snapshot.overlay_locked,
                snapshot.always_on_top,
            ) {
                log::warn!("failed to configure overlay hit windows: {error:#}");
            }
        } else {
            // 오버레이를 숨길 때: 창이 존재하는 경우에만 숨김
            // 창 미존재 시 무시 (창 생성하지 않음)
            // 히트 창 먼저 - CloseRequested의 HideAndPersist와 같은 전환 순서
            if let Err(error) = self.overlay_hit.set_visible(app, false) {
                log::warn!("failed to hide overlay hit windows: {error:#}");
            }
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
                publish_event(app, "overlay:visibility", json!({ "visible": visible }));
            } else if let Err(error) = self.overlay_hit.set_visible(app, !visible) {
                log::warn!("failed to restore overlay hit visibility: {error:#}");
            }
            return Err(persist_err);
        }

        *self.overlay_visible.write() = visible;
        publish_event(app, "overlay:visibility", json!({ "visible": visible }));
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

        // 본체는 상시 클릭 통과라 잠금은 히트 창에만 반영한다
        if let Err(error) = self.overlay_hit.set_locked(app, locked) {
            log::warn!("failed to update overlay hit lock: {error:#}");
        }
        publish_event(app, "overlay:lock", json!({ "locked": locked }));
        Ok(())
    }

    pub fn sync_overlay_hit_regions(
        &self,
        app: &AppHandle,
        rects: Vec<OverlayHitRect>,
        revision: u64,
        device_pixel_ratio: f64,
        epoch: u64,
        renderer_session_id: String,
    ) -> Result<bool> {
        self.overlay_hit.sync_regions(
            app,
            rects,
            revision,
            device_pixel_ratio,
            epoch,
            renderer_session_id,
        )
    }

    pub fn overlay_hit_renderer_ready(
        &self,
        app: &AppHandle,
        renderer_session_id: String,
    ) -> Result<u64> {
        self.overlay_hit.renderer_ready(app, renderer_session_id)
    }

    pub fn overlay_hit_renderer_load_started(&self, app: &AppHandle) -> Result<()> {
        self.overlay_hit.renderer_load_started(app)
    }

    pub fn shutdown(&self) {
        if self.shutdown_started.swap(true, Ordering::SeqCst) {
            return;
        }
        self.panel_drag.clear_for_lifecycle(None, "shutdown");
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

    #[cfg(target_os = "windows")]
    fn frontend_lifecycle_pending(&self) -> bool {
        if self
            .editor_flush_handshake
            .lock()
            .as_ref()
            .is_some_and(|handshake| handshake.completion.is_lifecycle())
        {
            return true;
        }

        self.deferred_frontend_lifecycle.lock().is_some()
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

    pub(crate) fn ensure_mutation_allowed(&self) -> std::result::Result<(), &'static str> {
        if self.shutdown_started.load(Ordering::SeqCst) {
            return Err(MUTATION_SHUTDOWN_STARTED);
        }
        Ok(())
    }

    pub(crate) fn issue_mutation_publication(
        &self,
    ) -> std::result::Result<MutationPublicationTicket, &'static str> {
        self.ensure_mutation_allowed()?;
        self.mutation_publication.issue()
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
        publish_event(app, "overlay:anchor", json!({ "anchor": value.as_str() }));
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

        let initializing = self.overlay_initializing.load(Ordering::SeqCst);
        let resolved = initializing
            .then(|| self.overlay_resolved_placement.lock().clone())
            .flatten();
        let current = match resolved.as_ref() {
            Some(resolved) => resolved.placement,
            None => native_placement_from_window(&window)?,
        };
        let mut placement = if let Some(resolved) = resolved.as_ref() {
            resolved.for_size(width, height)
        } else {
            NativePlacement {
                width,
                height,
                ..current
            }
        };
        let mut next_content_top_offset = None;

        // 초기화 중(첫 resize)에는 anchor 기반 position 재계산을 건너뛰고
        // 기동 시 한 번 해석한 배치를 사용
        if initializing {
            // 초기화 중이라도 content_top_offset은 저장해야 다음 resize에서 delta 계산이 정확함
            if let Some(offset) = content_top_offset {
                if offset.is_finite() {
                    next_content_top_offset = Some(offset);
                }
            }
        } else {
            let scale = placement.target_scale;
            match anchor {
                OverlayResizeAnchor::BottomLeft => {
                    placement.position.y += (current.height - height) * scale
                }
                OverlayResizeAnchor::TopRight => {
                    placement.position.x += (current.width - width) * scale
                }
                OverlayResizeAnchor::BottomRight => {
                    placement.position.x += (current.width - width) * scale;
                    placement.position.y += (current.height - height) * scale;
                }
                OverlayResizeAnchor::Center => {
                    placement.position.x += (current.width - width) * scale / 2.0;
                    placement.position.y += (current.height - height) * scale / 2.0;
                }
                OverlayResizeAnchor::FixedPosition => {}
                OverlayResizeAnchor::TopLeft => {}
            }

            if anchor == OverlayResizeAnchor::FixedPosition {
                if let Some(delta_x) = fixed_position_delta_x.filter(|value| value.is_finite()) {
                    placement.position.x += delta_x * scale;
                }
                if let Some(delta_y) = fixed_position_delta_y.filter(|value| value.is_finite()) {
                    placement.position.y += delta_y * scale;
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
                            OverlayResizeAnchor::Center => {
                                placement.position.y -= delta * scale / 2.0
                            }
                            OverlayResizeAnchor::BottomLeft | OverlayResizeAnchor::BottomRight => {}
                            OverlayResizeAnchor::FixedPosition => {
                                placement.position.y -= delta * scale
                            }
                            _ => placement.position.y -= delta * scale,
                        }
                    }
                    next_content_top_offset = Some(offset);
                }
            }
        }

        // 크기·위치를 단일 네이티브 트랜잭션으로 적용 - 분리 호출은 창이 두 단계로 움직여 덜컥거림 유발
        let applied = apply_overlay_frame(&window, placement)?;
        if initializing {
            *self.overlay_resolved_placement.lock() = None;
            self.overlay_initializing.store(false, Ordering::SeqCst);
        }
        persist_overlay_placement(
            &self.store,
            &self.overlay_bounds_generation,
            &self.overlay_placement_trust,
            applied.clone(),
            next_content_top_offset,
            OverlayPersistenceAuthority::General,
        )?;
        let bounds = applied.public_bounds;

        log::debug!(
            "[IPC] resize_overlay: emit overlay:resized ({}x{} at {}, {})",
            bounds.width,
            bounds.height,
            bounds.x,
            bounds.y
        );
        publish_event(
            app,
            "overlay:resized",
            json!({
                "x": bounds.x,
                "y": bounds.y,
                "width": bounds.width,
                "height": bounds.height,
            }),
        );

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

        let current = match window.as_ref() {
            Some(window) => native_placement_from_window(window)?,
            None => overlay_reset_fallback_rect(
                stored.as_ref(),
                snapshot.overlay_bounds_are_logical,
                &monitors,
            ),
        };
        let target = monitors
            .find_best_overlap_native(current.native_rect())
            .or_else(|| monitors.primary_spec());
        let planned = match target {
            Some(spec) => {
                let width_native = spec.logical_length_to_native(current.width);
                let height_native = spec.logical_length_to_native(current.height);
                let rect = NativeRect {
                    x: spec.work_rect_native.x + (spec.work_rect_native.width - width_native) / 2.0,
                    y: spec.work_rect_native.y
                        + (spec.work_rect_native.height - height_native) / 2.0,
                    width: width_native,
                    height: height_native,
                };
                NativePlacement {
                    position: spec.clamp_native(rect),
                    width: current.width,
                    height: current.height,
                    target_scale: spec.logical_to_native_scale,
                }
            }
            None => NativePlacement {
                position: OverlayPosition {
                    x: OVERLAY_MARGIN * current.target_scale,
                    y: OVERLAY_MARGIN * current.target_scale,
                },
                ..current
            },
        };

        let applied = match window.as_ref() {
            Some(window) => apply_overlay_frame(window, planned)?,
            None => applied_overlay_frame_from_placement(planned),
        };

        // 크기가 그대로라 창 안에서의 콘텐츠 위치도 그대로 - 기준선을 건드리면
        // 다음 resize가 이동량을 두 번 반영한다
        persist_overlay_placement(
            &self.store,
            &self.overlay_bounds_generation,
            &self.overlay_placement_trust,
            applied.clone(),
            None,
            OverlayPersistenceAuthority::Reset,
        )?;
        let bounds = applied.public_bounds;

        publish_event(
            app,
            "overlay:resized",
            json!({
                "x": bounds.x,
                "y": bounds.y,
                "width": bounds.width,
                "height": bounds.height,
            }),
        );

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
                                publish_event(
                                    &app_handle,
                                    "input:axis",
                                    InputAxisPayload {
                                        axis_id: &axis.axis_id,
                                        value: axis.value,
                                        full: axis.full,
                                    },
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
                            let primary_label =
                                message.labels.first().map(String::as_str).unwrap_or("");

                            // 구독자가 있을 때만 raw input 스트림 emit
                            let app_state = app_handle.state::<AppState>();
                            if app_state.raw_input_subscriber_count() > 0 {
                                publish_event(
                                    &app_handle,
                                    "input:raw",
                                    RawInputPayload {
                                        label: primary_label,
                                        labels: &message.labels,
                                        state,
                                        device: device_str,
                                    },
                                );
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
                                publish_event(
                                    &app_handle,
                                    "input:press",
                                    InputPressPayload {
                                        label: pressed_label,
                                        mode: &outcome.mode,
                                    },
                                );
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

                                publish_event(&app_handle, "keys:state", payload);
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
        publish_event(app, "keys:reset", json!({ "reason": "hook_restart" }));
    }

    fn restart_keyboard_hook(&self, app: AppHandle) -> Result<()> {
        self.keyboard_task_generation.fetch_add(1, Ordering::SeqCst);
        let mut task_guard = self.keyboard_task.write();
        let previous_task = task_guard.take();
        drop(previous_task);
        self.start_keyboard_hook_locked(app, &mut task_guard, 0, None)
    }

    pub(crate) fn plugin_authority(&self) -> &PluginRuntimeAuthority {
        &self.plugin_authority
    }

    pub(crate) fn reset_plugin_authority(&self) -> Result<PluginAuthorityLease, String> {
        self.plugin_authority.reset()
    }

    pub fn mark_plugin_authority_unavailable(&self) {
        self.plugin_authority.mark_unavailable();
    }

    // 분리 상태 기록: 값 갱신만 창 전환과 같은 락 안에서 끝내 순서가 뒤집히지 않게 하고,
    // 디스크 대기는 flush_panel_detached가 락 밖에서 맡는다
    fn mark_panel_detached(&self, detached: bool) {
        if let Err(err) = self
            .store
            .update_deferred(move |data| data.panel_detached = detached)
        {
            log::warn!("failed to record panel detached={detached} state: {err}");
        }
    }

    // 드문 조작이라 즉시 디스크로 - deferred로 두면 강제 종료 때 유저가 고른 배치가 날아간다.
    // 반드시 panel_creation_lock을 놓은 뒤 부를 것: 저장 대기 동안 창 전환이 막힌다.
    // 사이에 반대 전환이 끝났다면 그쪽 저장이 이미 dirty를 걷어가 여기서 값을 되살리지 않는다
    pub(crate) fn flush_panel_detached(&self) {
        if let Err(err) = self.store.flush() {
            log::warn!("failed to persist panel detached state: {err}");
        }
    }

    // 메인이 window.open을 부르기 직전에 세운다. 핸들러가 이 토큰을 1회 소비한다
    pub fn arm_panel_open(&self) {
        *self.panel_open_armed.lock() = Some(Instant::now());
    }

    pub(crate) fn panel_drag_controller(&self) -> Arc<PanelDragController> {
        Arc::clone(&self.panel_drag)
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn try_lock_panel_creation_for_drag(
        &self,
    ) -> Option<parking_lot::MutexGuard<'_, ()>> {
        self.panel_creation_lock.try_lock()
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn record_panel_drag_presented(&self, app: &AppHandle) -> PanelPresentSnapshot {
        let panel_detached = self.store.snapshot().panel_detached;
        let mut destroy_reason = self.panel_destroy_reason.lock();
        let snapshot = PanelPresentSnapshot {
            panel_visible: self.panel_visible.load(Ordering::SeqCst),
            panel_detached,
            panel_destroy_reason: *destroy_reason,
        };
        *destroy_reason = None;
        drop(destroy_reason);
        if let Err(error) =
            publish_panel_visibility_transition(&self.panel_visible, app, true, None)
        {
            self.panel_visible.store(true, Ordering::SeqCst);
            log::warn!("failed to publish the visible panel state during native drag: {error}");
        }
        self.mark_panel_detached(true);
        snapshot
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn revert_panel_drag_presented(
        &self,
        app: &AppHandle,
        snapshot: PanelPresentSnapshot,
    ) {
        if let Err(error) = publish_panel_visibility_transition(
            &self.panel_visible,
            app,
            snapshot.panel_visible,
            snapshot.panel_destroy_reason,
        ) {
            self.panel_visible
                .store(snapshot.panel_visible, Ordering::SeqCst);
            log::warn!("failed to publish the restored panel state after native drag: {error}");
        }
        self.mark_panel_detached(snapshot.panel_detached);
        *self.panel_destroy_reason.lock() = snapshot.panel_destroy_reason;
    }

    fn take_panel_open_arm(&self) -> bool {
        take_panel_open_arm(&mut self.panel_open_armed.lock(), Instant::now())
    }

    // 메인 웹뷰의 window.open 요청을 패널 창으로 만든다 (on_new_window 핸들러 진입점).
    // WKUIDelegate/NewWindowRequested 콜백 안 - 메인 스레드에서 window.open이 동기로
    // 기다리는 중이라 메인 웹뷰 JS 왕복은 금지, 게터는 인라인이라 안전하다.
    // 창은 프로세스 수명 동안 한 번만 만든다: opener와 WKUserContentController를 공유해
    // 자식 웹뷰를 파괴하면 메인의 IPC 핸들러까지 제거된다(도킹은 hide, 파괴는 종료 시만)
    pub fn open_panel_window_for_request(
        &self,
        app: &AppHandle,
        url: &str,
        features: tauri::webview::NewWindowFeatures,
    ) -> Result<WebviewWindow> {
        if !self.take_panel_open_arm() {
            return Err(anyhow!(
                "window.open request was not armed as the panel window"
            ));
        }
        if !is_panel_open_url(url) {
            return Err(anyhow!(
                "panel window must be opened with an empty url, got {url}"
            ));
        }
        // 배치 정보는 락과 무관하니 락 밖에서 먼저 읽는다
        let main_rect = main_window_native_rect(app);
        let monitors = MonitorData::gather(app);
        // 메인 스레드 콜백이라 락은 try_lock만 - 잡고 있는 오프메인 태스크(ack 타임아웃)를
        // 기다리면 역전 데드락
        let Some(_creation_guard) = self.panel_creation_lock.try_lock() else {
            return Err(anyhow!("panel creation lock is busy"));
        };
        if app.get_webview_window(PANEL_LABEL).is_some() {
            return Err(anyhow!("panel window already exists"));
        }
        // 창은 숨긴 채 만든다 - 메인이 문서를 채운 뒤 present_panel_window로 드러내야
        // 빈 창이 한 프레임 비치지 않는다. 가시성 전환·분리 기록도 그쪽이 맡는다
        let window = self.create_panel_window(app, features, main_rect, &monitors)?;
        log::info!("panel window created as an opener child of main");
        Ok(window)
    }

    // 도킹(hide)돼 있던 패널 창을 다시 띄운다. 창이 없으면 메인이 window.open으로 만들어야 한다.
    // position이 있으면(드래그 드롭) 그 자리에, 없으면 메인 옆에 붙인다.
    // focus=false는 드래그 도중 tear-off용 - 포커스를 뺏으면 메인의 드래그 세션이 끊긴다
    pub fn present_panel_window(
        &self,
        app: &AppHandle,
        position: Option<LogicalPosition<f64>>,
        focus: bool,
    ) -> Result<()> {
        // 배치 정보는 락과 무관하니 락 밖에서 먼저 읽는다
        let main_rect = main_window_native_rect(app);
        let monitors = MonitorData::gather(app);
        let result = {
            let _creation_guard = self.panel_creation_lock.lock();
            let Some(window) = app.get_webview_window(PANEL_LABEL) else {
                return Err(anyhow!("panel window is not open"));
            };
            *self.panel_destroy_reason.lock() = None;
            // 재표시는 저장 높이만 이어받고 자리는 메인 옆으로 다시 잡는다 (기존 계약).
            // 드롭 위치가 오면 그 자리가 우선이다
            let stored_bounds = self.store.snapshot().panel_bounds;
            let mut layout = resolve_panel_window_layout(stored_bounds, main_rect, &monitors, None);
            if let Some(position) = position {
                let outer = panel_client_to_outer_position(&window, position.x, position.y);
                layout.position = Some(logical_position_to_native(&window, outer));
            }
            self.apply_panel_window_layout(&window, &layout);
            let _ = window.unminimize();
            // 네이티브 show가 적용된 뒤의 보조 작업 실패를 커맨드 실패로 돌려보내면
            // 프론트는 도킹으로 되돌아가지만 창은 이미 보여 서로 다른 상태가 된다.
            window.show().context("failed to show panel window")?;
            // Windows의 show는 z-order를 건드리지 않아 활성 창(메인) 뒤에 깔린다 -
            // 포커스는 그대로 두고 순서만 올린다 (드래그 tear-off 세션 유지)
            #[cfg(target_os = "windows")]
            raise_panel_window_without_activation(&window);
            if focus {
                if let Err(error) = window.set_focus() {
                    log::warn!("failed to focus the visible panel window: {error}");
                }
            }
            if let Err(error) =
                publish_panel_visibility_transition(&self.panel_visible, app, true, None)
            {
                // 이벤트 발행 실패 시 helper가 원래 값으로 되돌리므로 실제 창 상태로 재정렬
                self.panel_visible.store(true, Ordering::SeqCst);
                log::warn!("failed to publish the visible panel state: {error}");
            }
            self.mark_panel_detached(true);
            Ok(())
        };
        if result.is_ok() {
            self.flush_panel_detached();
        }
        result
    }

    // 드래그 중 창 이동 - 락·가시성 전환 없이 위치만 (bounds 세션이 Moved로 받아 적는다)
    pub fn move_panel_window_to(&self, app: &AppHandle, x: f64, y: f64) -> Result<()> {
        let window = app
            .get_webview_window(PANEL_LABEL)
            .ok_or_else(|| anyhow!("panel window is not open"))?;
        let position = panel_client_to_outer_position(&window, x, y);
        window
            .set_position(position)
            .context("failed to move panel window")
    }

    // 저장값을 비우고 기본 배치로 되돌린다. 창을 새로 보이거나 포커스를 옮기지 않는다.
    // 즉시 저장은 panel_creation_lock 밖에서 - 디스크 대기 동안 창 전환이 막힌다
    pub fn reset_panel_window_position(&self, app: &AppHandle) -> Result<()> {
        let main_rect = main_window_native_rect(app);
        let monitors = MonitorData::gather(app);
        let window = app.get_webview_window(PANEL_LABEL);
        let layout = window
            .as_ref()
            .map(|_| resolve_panel_window_layout(None, main_rect, &monitors, None));

        self.panel_bounds_persistence
            .clear_saved_bounds(layout.as_ref())?;

        if let (Some(window), Some(layout)) = (window, layout) {
            let _creation_guard = self.panel_creation_lock.lock();
            self.apply_panel_window_layout(&window, &layout);
        }
        Ok(())
    }

    // 헤더 드래그 세션 시작 시 한 번 읽는 값 - 도크 존 판정 기준 좌표
    pub fn panel_drag_context(&self, app: &AppHandle) -> PanelDragContext {
        PanelDragContext {
            main_frame: main_window_logical_rect(app),
            main_content_origin: main_window_content_origin(app),
        }
    }

    fn apply_panel_window_layout(&self, window: &WebviewWindow, layout: &PanelWindowLayout) {
        if let Err(err) =
            window.set_min_size(Some(LogicalSize::new(PANEL_WIDTH, layout.min_height)))
        {
            log::warn!("failed to apply panel min size: {err}");
        }
        if let Err(err) =
            window.set_max_size(Some(LogicalSize::new(PANEL_WIDTH, layout.max_height)))
        {
            log::warn!("failed to apply panel max size: {err}");
        }
        if let Err(err) = window.set_size(LogicalSize::new(PANEL_WIDTH, layout.height)) {
            log::warn!("failed to apply panel size: {err}");
        }
        if let Some(position) = layout.position {
            #[cfg(target_os = "windows")]
            let result = window.set_position(PhysicalPosition::new(
                position.x.round() as i32,
                position.y.round() as i32,
            ));
            #[cfg(not(target_os = "windows"))]
            let result = window.set_position(LogicalPosition::new(position.x, position.y));
            if let Err(err) = result {
                log::warn!("failed to apply panel position: {err}");
            }
        }
    }

    // 기동 시 분리 패널 복원 진입점. 창은 메인 렌더러만 만들 수 있으므로(opener 관계) 여기서는
    // 요청만 남기고, 메인이 부트스트랩 뒤 take_panel_restore_request로 1회 소비한다.
    // main_window_hidden은 트레이 아이콘 생성 실패 폴백까지 반영된 값이어야 한다
    pub fn restore_detached_panel_on_startup(&self, main_window_hidden: bool) {
        let snapshot = self.store.snapshot();
        let restore = should_restore_panel_on_startup(
            snapshot.obs_mode_enabled,
            main_window_hidden,
            snapshot.panel_detached,
        );
        self.panel_restore_pending.store(restore, Ordering::SeqCst);
    }

    pub fn take_panel_restore_request(&self) -> bool {
        self.panel_restore_pending.swap(false, Ordering::SeqCst)
    }

    // 트레이로 숨는 메인과 동행 - panel:visibility는 재부착 신호라 여기서 발행하지 않는다
    // (발행하면 메인이 인라인 패널을 다시 붙이고 열린 시트가 사라짐)
    // 메인 스레드에서 불리므로 panel_creation_lock을 잡지 않는다 - 락을 쥔 ack 타임아웃
    // 태스크가 메인 스레드 응답을 기다리는 구간(bounds 샘플링)이 있어 잡으면 역전 데드락.
    // 도킹된(hide) 창은 is_visible이 false라 표식이 서지 않는다
    fn hide_detached_panel_with_main(&self, app: &AppHandle) {
        self.panel_drag
            .clear_for_lifecycle(Some(app), "hiddenWithMain");
        let Some(window) = app.get_webview_window(PANEL_LABEL) else {
            return;
        };
        // 이미 숨어 있거나 최소화된 창은 건너뛴다 - 우리가 감추지 않은 창을 동행 복원 대상으로
        // 올리지 않기 위한 가드다. Windows의 is_visible은 최소화 창도 true라 is_minimized를 함께 본다
        let visible =
            window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
        let hidden = hide_panel_with_main_transition(&self.panel_hidden_with_main, visible, || {
            window.hide().map_err(anyhow::Error::from)
        });
        if let Err(err) = hidden {
            log::warn!("failed to hide detached panel with main window: {err}");
        }
    }

    // 메인이 트레이에서 나올 때, 우리가 감췄던 패널만 되돌린다
    fn restore_detached_panel_with_main(&self, app: &AppHandle) {
        let Some(window) = app.get_webview_window(PANEL_LABEL) else {
            drop_panel_hidden_with_main(&self.panel_hidden_with_main);
            return;
        };
        let restored = restore_panel_with_main_transition(&self.panel_hidden_with_main, || {
            // 메인 표시 경로와 같은 순서 - 최소화 해제부터
            let _ = window.unminimize();
            window.show().map_err(anyhow::Error::from)?;
            // present_panel_window와 같은 이유 - show가 z-order를 안 건드려 메인 뒤에 깔린다.
            // 메인을 위에 남기는 건 뒤따르는 main.show()+set_focus가 맡는다
            #[cfg(target_os = "windows")]
            raise_panel_window_without_activation(&window);
            Ok(())
        });
        if let Err(err) = restored {
            // 표식은 되살렸지만 자동 재시도는 없다 - 유저가 트레이로 다시 숨겼다 꺼내야 복원된다
            log::warn!("failed to show detached panel with main window: {err}");
        }
    }

    // 도킹: 창을 감추고 도킹 상태를 기록한다 (명시 재부착 경로)
    pub fn dock_panel_window(&self, app: &AppHandle) -> Result<()> {
        let result = {
            let _creation_guard = self.panel_creation_lock.lock();
            *self.panel_close_request.lock() = PanelCloseRequestState::Closing;
            let result = self.dock_panel_window_inner(app, PanelVisibilityReason::Closed);
            finish_panel_close(&self.panel_close_request);
            result
        };
        // 실패해 되돌린 경우도 저장한다 - 어느 쪽이든 마지막 값이 디스크에 남아야 다음 기동이 맞는다
        self.flush_panel_detached();
        result
    }

    // 메인 문서가 다시 로드되면 opener 쪽 WindowProxy가 사라진다 - 창은 살려 두고(파괴 금지)
    // 감춰서 새 문서가 다시 붙일 수 있게 한다. dev reload 대비.
    // on_page_load 콜백(메인 스레드)에서 불리므로 blocking lock 금지 - 락을 쥔 오프메인
    // 태스크(ack 타임아웃 등)가 메인 왕복 게터를 기다리는 구간과 겹치면 역전 데드락이다.
    // try_lock에 실패하면 그 경합 중인 전환이 이미 가시성을 정리하므로 건너뛴다
    pub fn dock_panel_window_for_main_reload(&self, app: &AppHandle) {
        if app.get_webview_window(PANEL_LABEL).is_none() {
            return;
        }
        let docked = {
            let Some(_creation_guard) = self.panel_creation_lock.try_lock() else {
                log::warn!("panel creation lock busy on main reload; docking skipped");
                return;
            };
            *self.panel_close_request.lock() = PanelCloseRequestState::Closing;
            let result = self.dock_panel_window_inner(app, PanelVisibilityReason::Closed);
            finish_panel_close(&self.panel_close_request);
            if let Err(err) = &result {
                log::warn!("failed to dock panel window on main reload: {err}");
            }
            result.is_ok()
        };
        // 도킹 기록 저장은 락을 놓은 뒤 - 저장 대기 동안 창 전환이 막히지 않게
        if docked {
            self.flush_panel_detached();
        }
    }

    fn dock_panel_window_inner(
        &self,
        app: &AppHandle,
        reason: PanelVisibilityReason,
    ) -> Result<()> {
        self.panel_drag.clear_for_lifecycle(Some(app), "docked");
        // 도킹 상태 기록: 명시 재부착과 close-ack 타임아웃 강제 도킹이 모두 이 경로를 지남
        // Destroyed 핸들러에서는 기록 금지 - 종료 시 shutdown_application이 panel.destroy()를
        // 직접 호출해 같은 핸들러로 들어오므로 분리 채 종료할 때마다 플래그가 지워짐.
        // 이 함수는 panel_creation_lock 안에서 도는 만큼 저장은 호출자가 락을 놓은 뒤 맡는다
        self.mark_panel_detached(false);
        *self.panel_destroy_reason.lock() = Some(reason);
        if let Some(window) = app.get_webview_window(PANEL_LABEL) {
            if let Err(error) = self.panel_bounds_persistence.flush_now(&window) {
                // 위치 저장 실패는 이미 적용될 도킹을 되돌릴 수 없으므로 별도로 기록
                log::warn!("failed to persist panel bounds before docking: {error}");
            }
            if let Err(error) = window.hide() {
                self.clear_panel_destroy_reason(reason);
                // 창이 보이면 여전히 분리 상태다. 도킹 기록을 되돌리지
                // 않으면 다음 기동에서 분리 패널이 복원되지 않는다
                self.mark_panel_detached(true);
                return Err(error.into());
            }
        }
        if let Err(error) = self.publish_panel_hidden(app, reason) {
            // 이벤트 발행 실패 시 helper가 가시성과 사유를 되돌린다. 네이티브 창은 이미
            // 숨겨졌으므로 실제 상태를 우선하고 다음 전환에 낡은 사유를 남기지 않는다
            self.panel_visible.store(false, Ordering::SeqCst);
            self.clear_panel_destroy_reason(reason);
            log::warn!("failed to publish the hidden panel state: {error}");
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

    pub fn capture_and_flush_panel_bounds_for_lifecycle(&self, app: &AppHandle) -> Result<()> {
        if self.shutdown_started.load(Ordering::SeqCst) {
            return Ok(());
        }
        self.panel_drag
            .clear_for_lifecycle(Some(app), "applicationLifecycle");
        let _creation_guard = self.panel_creation_lock.lock();
        let Some(window) = app.get_webview_window(PANEL_LABEL) else {
            return Ok(());
        };
        self.panel_bounds_persistence.flush_now(&window)
    }

    pub fn handle_panel_window_destroyed(&self, app: &AppHandle) {
        self.panel_drag.finish_window_destroyed(app);
        drop_panel_hidden_with_main(&self.panel_hidden_with_main);
        finish_panel_close(&self.panel_close_request);
        if let Err(error) = self.publish_panel_hidden(app, PanelVisibilityReason::Destroyed) {
            log::warn!("failed to emit destroyed panel visibility: {error}");
        }
    }

    // monitors는 호출자가 panel_creation_lock 밖에서 모아 넘긴다
    fn create_panel_window(
        &self,
        app: &AppHandle,
        features: tauri::webview::NewWindowFeatures,
        main_rect: Option<NativeRect>,
        monitors: &MonitorData,
    ) -> Result<WebviewWindow> {
        let snapshot = self.store.snapshot();
        let stored_bounds = snapshot.panel_bounds;
        let layout = resolve_panel_window_layout(stored_bounds, main_rect, monitors, None);

        // about:blank는 runtime-wry가 초기 네비게이션을 건너뛴다 - opener가 문서를 채우고,
        // WebView2의 "NewWindow는 네비게이션 전이어야 함" 요건도 이걸로 맞는다.
        // window_features는 opener의 configuration/environment를 물려주는 필수 호출이라
        // 크기·위치를 덮어쓰기 전에 먼저 둔다
        let mut builder = WebviewWindowBuilder::new(
            app,
            PANEL_LABEL,
            WebviewUrl::External("about:blank".parse().expect("about:blank url")),
        )
        .window_features(features)
        .title("DM Note - Panel")
        // 메인·오버레이와 같은 프레임리스 크롬 - 드래그 영역은 패널 상단 스트립이 담당
        .decorations(false)
        // Windows는 DWM이 실루엣을 소유하므로(windows_window_corners) 모서리 바깥을 비출
        // 필요가 없다. 투명이면 wry가 WebView2 기본 배경을 (0,0,0,0)으로 못박고 빌더
        // background_color를 버려, 리사이즈로 새로 드러난 띠가 그대로 비친다.
        // 메인 창(transparent: false + backgroundColor)과 같은 구성
        .transparent(cfg!(not(target_os = "windows")))
        .shadow(true)
        .resizable(true)
        .maximizable(false)
        .always_on_top(false)
        .skip_taskbar(false)
        .focused(false)
        // 비포커스 상태의 첫 클릭이 포커스 획득에만 소비되지 않게 함
        // (유틸리티 패널 관례 - 버튼이 첫 클릭에 바로 동작)
        .accept_first_mouse(true)
        .visible(false)
        .inner_size(PANEL_WIDTH, layout.height)
        .min_inner_size(PANEL_WIDTH, layout.min_height)
        .max_inner_size(PANEL_WIDTH, layout.max_height)
        .zoom_hotkeys_enabled(false);

        // 컨트롤러 생성 옵션에 실려야 첫 프레임부터 유효하다 - build() 이후 런타임 호출은
        // 이미 내비게이션이 시작된 뒤라 늦다. 실제 색은 렌더러가 토큰을 읽어 덮는다
        #[cfg(target_os = "windows")]
        {
            builder = builder.background_color(super::windows_window_corners::SEED_FILL);
        }

        #[cfg(not(target_os = "windows"))]
        if let Some(position) = layout.position {
            builder = builder.position(position.x, position.y);
        }

        let window = builder.build().context("failed to create panel window")?;

        if let Some(position) = layout.position {
            #[cfg(target_os = "windows")]
            let result = window.set_position(PhysicalPosition::new(
                position.x.round() as i32,
                position.y.round() as i32,
            ));
            #[cfg(not(target_os = "windows"))]
            let result = window.set_position(LogicalPosition::new(position.x, position.y));
            if let Err(err) = result {
                log::warn!("failed to restore panel position after build: {err}");
            }
        }

        // Windows 접근성 텍스트 배율 보상 - about:blank는 네비게이션이 없어
        // zoom-guard(on_page_load)가 이 창에 닿지 않는다. 메인과 같은 배율을 직접 적용
        let zoom = crate::compute_compensating_zoom();
        if crate::should_apply_compensating_zoom(zoom) {
            // 성공도 남긴다 - WebView2가 이후 네비게이션에서 리셋하면 로그 부재로 판별해야 한다
            match window.set_zoom(zoom) {
                Ok(()) => log::info!("[zoom-guard] panel window compensating zoom={zoom:.6}"),
                Err(err) => log::warn!("failed to set panel compensating zoom: {err}"),
            }
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
        // 웹 콘텐츠가 그리는 라운딩은 리사이즈 프레임을 못 따라옴 - 실루엣은 컴포지터가 소유
        #[cfg(target_os = "macos")]
        super::macos_window_corners::apply_rounded_corners(app, window);
        // Windows는 DWM이 이미 자기 반경으로 자르고 있어 웹 라운딩과 어긋난다 - 반경 지정이
        // 불가능하므로 실루엣을 DWM에 넘기고 웹은 사각으로 채운다 (메인 창과 같은 처리)
        #[cfg(target_os = "windows")]
        super::windows_window_corners::apply_initial_chrome(window);

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
                    let closed = {
                        let _creation_guard = state.panel_creation_lock.lock();
                        match run_panel_close_timeout(
                            &state.panel_close_request,
                            &request_id,
                            || {
                                state.dock_panel_window_inner(
                                    &timeout_app,
                                    PanelVisibilityReason::Closed,
                                )
                            },
                        ) {
                            Ok(claimed) => claimed,
                            Err(error) => {
                                log::warn!("failed to close panel after missing ack: {error}");
                                true
                            }
                        }
                    };
                    // 도킹 기록 저장은 락을 놓은 뒤 - 저장 대기 동안 창 전환이 막히지 않게
                    if closed {
                        state.flush_panel_detached();
                    }
                });
            }
            WindowEvent::Moved(position) => {
                bounds_persistence
                    .record_event(bounds_session, PanelBoundsChange::Moved(*position));
                #[cfg(target_os = "windows")]
                if let Some(state) = app_handle.try_state::<AppState>() {
                    state.panel_drag.handle_moved(&app_handle);
                }
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
        let mut resolved = resolve_overlay_placement(
            snapshot.overlay_bounds.as_ref(),
            snapshot.overlay_bounds_are_logical,
            &monitor_data,
        );

        self.overlay_initializing.store(true, Ordering::SeqCst);
        *self.overlay_resolved_placement.lock() = None;

        let mut window_builder = WebviewWindowBuilder::new(
            app,
            OVERLAY_LABEL,
            WebviewUrl::App("overlay/index.html".into()),
        )
        .title("DM Note - Overlay")
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .zoom_hotkeys_enabled(false)
        .transparent(true)
            .always_on_top(true)
            .skip_taskbar(false)
            // 첫 표시를 SW_SHOWNOACTIVATE로 처리하도록 tao에 지시 (포커스 미탈취)
            .focused(false)
            .inner_size(resolved.placement.width, resolved.placement.height)
            .shadow(false)
            .devtools(true);
        #[cfg(target_os = "windows")]
        {
            window_builder = window_builder.visible(false);
        }
        #[cfg(not(target_os = "windows"))]
        {
            window_builder = window_builder
                .visible(snapshot.overlay_visible && resolved.pending_scale_resolution.is_none())
                .position(resolved.placement.position.x, resolved.placement.position.y);
        }

        let window = match window_builder.build() {
            Ok(window) => window,
            Err(error) => {
                self.overlay_initializing.store(false, Ordering::SeqCst);
                return Err(error).context("failed to create overlay window");
            }
        };
        if resolved.pending_scale_resolution.is_some() {
            let completed = overlay_restore_window_scale(&window)
                .ok()
                .and_then(|scale| complete_overlay_scale_resolution(resolved.clone(), scale));
            let Some(completed) = completed else {
                self.overlay_initializing.store(false, Ordering::SeqCst);
                let _ = window.destroy();
                return Err(anyhow!(
                    "failed to resolve initial overlay placement from the window scale"
                ));
            };
            resolved = completed;
        }

        log::debug!(
            "[overlay] restore source={} nativeRejectReason={} candidateCount={} selectedMonitor={} selectedScale={} visibilityAdjustment={}",
            resolved.source.as_str(),
            resolved.native_reject_reason.as_str(),
            resolved.candidate_count,
            resolved.selected_monitor.as_deref().unwrap_or("none"),
            resolved.selected_scale,
            resolved.visibility_adjustment,
        );
        log::trace!(
            "[overlay] restore nativePosition=({}, {}) logicalSize={}x{}",
            resolved.placement.position.x,
            resolved.placement.position.y,
            resolved.placement.width,
            resolved.placement.height,
        );
        *self.overlay_resolved_placement.lock() = Some(resolved.clone());
        #[cfg(target_os = "windows")]
        {
            *self.overlay_placement_trust.lock() = resolved.source.initial_trust();
        }
        #[cfg(not(target_os = "windows"))]
        {
            *self.overlay_placement_trust.lock() = OverlayPlacementTrust::Clean;
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

        let applied = match apply_overlay_frame(&window, resolved.placement) {
            Ok(applied) => applied,
            Err(error) => {
                self.overlay_initializing.store(false, Ordering::SeqCst);
                *self.overlay_resolved_placement.lock() = None;
                let _ = window.destroy();
                return Err(error.context("failed to apply initial overlay frame"));
            }
        };

        // 본체는 상시 클릭 통과 - 실제 잠금은 히트 창이 강제한다
        window.set_ignore_cursor_events(true)?;
        window.set_always_on_top(snapshot.always_on_top)?;
        if let Err(error) = self.overlay_hit.set_configuration(
            app,
            snapshot.overlay_visible,
            snapshot.overlay_locked,
            snapshot.always_on_top,
        ) {
            log::warn!("failed to configure overlay hit windows: {error:#}");
        }
        // show_overlay_window 내부에서 호출하므로, visible일 때만 적용
        // hidden 상태에서 호출 시 orderFrontRegardless가 윈도우를 강제 표시함
        #[cfg(target_os = "macos")]
        if snapshot.overlay_visible {
            apply_macos_overlay_fullscreen_behavior(&window, snapshot.always_on_top);
        }
        let _ = window.set_maximizable(false);

        self.configure_overlay_window(&window, app);
        #[cfg(target_os = "windows")]
        if let Err(error) = install_overlay_move_observer(
            &window,
            Arc::clone(&self.store),
            Arc::clone(&self.overlay_bounds_generation),
            Arc::clone(&self.overlay_placement_trust),
        ) {
            self.overlay_initializing.store(false, Ordering::SeqCst);
            *self.overlay_resolved_placement.lock() = None;
            let _ = window.destroy();
            return Err(error.context("failed to install overlay move observer"));
        }

        #[cfg(target_os = "windows")]
        let needs_marker_sync = resolved.source == OverlayRestoreSource::LegacyPhysical;
        #[cfg(not(target_os = "windows"))]
        let needs_marker_sync = !monitor_data.is_empty() && !snapshot.overlay_bounds_are_logical;
        if resolved.visibility_adjustment || snapshot.overlay_bounds.is_none() || needs_marker_sync
        {
            if let Err(err) = persist_overlay_placement(
                &self.store,
                &self.overlay_bounds_generation,
                &self.overlay_placement_trust,
                applied,
                None,
                OverlayPersistenceAuthority::General,
            ) {
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
        let resolved_placement = self.overlay_resolved_placement.clone();
        let bounds_generation = self.overlay_bounds_generation.clone();
        let placement_trust = self.overlay_placement_trust.clone();
        let overlay_hit = self.overlay_hit.clone();

        window.on_window_event(move |event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                #[cfg(target_os = "windows")]
                let lifecycle_pending = app_handle
                    .try_state::<AppState>()
                    .is_some_and(|state| state.frontend_lifecycle_pending());
                #[cfg(not(target_os = "windows"))]
                let lifecycle_pending = false;

                match overlay_close_action(
                    force_close_flag.load(Ordering::SeqCst),
                    lifecycle_pending,
                ) {
                    OverlayCloseAction::AllowClose => {
                        // 앱 종료 시 — 실제 close 허용.
                        // 히트 창 정리는 뒤따르는 Destroyed가 맡는다 - 종료 중
                        // 메인 스레드 디스패치는 도달을 보장할 수 없다
                        *overlay_visible.write() = false;
                    }
                    OverlayCloseAction::PreserveVisibility => {
                        // Windows의 작업 표시줄 그룹 종료가 오버레이에도 WM_CLOSE를 보내는 구간.
                        // 표시 상태를 보존하는 경로라 히트 창도 그대로 둔다
                        api.prevent_close();
                        log::debug!(
                            "[Overlay] preserving visibility during frontend lifecycle flush"
                        );
                    }
                    OverlayCloseAction::HideAndPersist => {
                        api.prevent_close();
                        if let Err(err) =
                            flush_deferred_overlay_bounds(&store, &bounds_generation)
                        {
                            log::warn!("failed to flush overlay bounds on close: {err}");
                            return;
                        }
                        // 숨김 먼저, 저장은 성공 후 — set_overlay_visibility와 같은 전환 계약
                        if let Err(err) = overlay_hit.set_visible(&app_handle, false) {
                            log::warn!("failed to hide overlay hit windows on close: {err:#}");
                        }
                        if let Err(err) = overlay_window.hide() {
                            log::error!("failed to hide overlay window on close: {err}");
                            let _ = overlay_hit.set_visible(&app_handle, true);
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
                                publish_event(
                                    &app_handle,
                                    "overlay:visibility",
                                    json!({ "visible": false }),
                                );
                            } else if let Err(error) =
                                overlay_hit.set_visible(&app_handle, true)
                            {
                                log::warn!("failed to restore overlay hit windows: {error:#}");
                            }
                            return;
                        }
                        *overlay_visible.write() = false;
                        publish_event(
                            &app_handle,
                            "overlay:visibility",
                            json!({ "visible": false }),
                        );
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
                    if let Err(err) = persist_overlay_placement_from_window(
                        &overlay_window,
                        &store,
                        &bounds_generation,
                        &placement_trust,
                        OverlayPersistenceAuthority::General,
                    ) {
                        log::warn!("failed to defer overlay bounds: {err}");
                    }
                    if let Err(err) = overlay_hit.reconcile(&app_handle) {
                        log::warn!("failed to follow overlay hit windows: {err:#}");
                    }
                }
            WindowEvent::ScaleFactorChanged { .. } => {
                if let Err(err) = overlay_hit.invalidate_for_scale_change(&app_handle) {
                    log::warn!("failed to invalidate scaled overlay hit regions: {err:#}");
                }
            }
            WindowEvent::Destroyed => {
                initializing_flag.store(false, Ordering::SeqCst);
                *resolved_placement.lock() = None;
                if let Err(err) = overlay_hit.reset_for_parent_loss(&app_handle) {
                    log::warn!("failed to reset overlay hit state after parent loss: {err:#}");
                }
            }
            _ => {}
        });
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
            if let Err(error) = self.overlay_hit.set_always_on_top(app, value) {
                log::warn!("failed to update overlay hit always-on-top: {error:#}");
            }
        }

        if let Some(value) = diff.changed.overlay_locked {
            // 본체는 상시 클릭 통과라 잠금은 히트 창에만 반영한다
            if let Err(error) = self.overlay_hit.set_locked(app, value) {
                log::warn!("failed to update overlay hit lock: {error:#}");
            }
            publish_event(app, "overlay:lock", json!({ "locked": value }));
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

    pub(crate) fn commit_editor_document_preserving_runtime_counters(
        &self,
        emitter: &dyn KeyCounterEventEmitter,
        request: EditorCommitRequest,
        admission: &HistoryAdmissionLease,
    ) -> std::result::Result<(CommittedEditorChange, bool), EditorCommitError> {
        if !request.may_change_keys() {
            return self
                .store
                .commit_editor_document_admitted(request, admission)
                .map(|change| (change, false));
        }

        self.begin_counter_history_barrier();
        let mut counter_guard = self.lock_key_counters_for_history();
        let result = self
            .store
            .commit_editor_document_with_runtime_counters_admitted(
                request,
                admission,
                &counter_guard,
            );
        let mut runtime_applied = false;
        if let Ok(change) = &result {
            if change.event.is_some()
                && change
                    .result
                    .changed_fields
                    .contains(&crate::models::EditorField::Keys)
            {
                self.apply_committed_editor_keys_without_counters(
                    change.runtime_publication_generation,
                    &change.document.keys,
                    &change.selected_key_type,
                );
                runtime_applied = self.replace_history_counters_locked(
                    &mut counter_guard,
                    change.runtime_publication_generation,
                    &change.key_counters,
                );
            }
        }
        let publication_generation = result
            .as_ref()
            .map(|change| change.runtime_publication_generation)
            .unwrap_or_else(|_| self.store.runtime_publication_generation());
        self.finish_counter_history_barrier(
            emitter,
            counter_guard,
            runtime_applied,
            publication_generation,
        );

        result.map(|change| (change, runtime_applied))
    }

    pub(crate) fn commit_gesture_preserving_runtime_counters(
        &self,
        emitter: &dyn KeyCounterEventEmitter,
        request: GestureCommitRequest,
        admission: HistoryAdmissionLease,
    ) -> std::result::Result<(AdmittedGestureCommit, bool), EditorCommitError> {
        if !request.may_change_keys() {
            return self
                .store
                .commit_gesture_with_admission(request, admission)
                .map(|committed| (committed, false));
        }

        self.begin_counter_history_barrier();
        let mut counter_guard = self.lock_key_counters_for_history();
        let result = self.store.commit_gesture_with_runtime_counters_admission(
            request,
            admission,
            &counter_guard,
        );
        let mut runtime_applied = false;
        if let Ok(committed) = &result {
            if let Some(change) = committed.outcome.change.as_ref() {
                if change
                    .result
                    .changed_fields
                    .contains(&crate::models::EditorField::Keys)
                {
                    self.apply_committed_editor_keys_without_counters(
                        change.runtime_publication_generation,
                        &change.document.keys,
                        &change.selected_key_type,
                    );
                    runtime_applied = self.replace_history_counters_locked(
                        &mut counter_guard,
                        change.runtime_publication_generation,
                        &change.key_counters,
                    );
                }
            }
        }
        let publication_generation = result
            .as_ref()
            .ok()
            .and_then(|committed| committed.outcome.change.as_ref())
            .map(|change| change.runtime_publication_generation)
            .unwrap_or_else(|| self.store.runtime_publication_generation());
        self.finish_counter_history_barrier(
            emitter,
            counter_guard,
            runtime_applied,
            publication_generation,
        );

        result.map(|committed| (committed, runtime_applied))
    }

    pub(crate) fn commit_editor_transaction_preserving_runtime_counters<T>(
        &self,
        emitter: &dyn KeyCounterEventEmitter,
        commit: impl FnOnce(
            &KeyCounters,
        )
            -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError>,
    ) -> std::result::Result<(AdmittedEditorTransaction<T>, bool), EditorCommitError> {
        self.begin_counter_history_barrier();
        let mut counter_guard = self.lock_key_counters_for_history();
        let result = commit(&counter_guard);
        let mut runtime_applied = false;
        if let Ok(transaction) = &result {
            let keys_changed = transaction
                .change
                .result
                .changed_fields
                .contains(&crate::models::EditorField::Keys);
            let counters_changed = transaction.change.key_counters != *counter_guard;
            if keys_changed {
                self.apply_committed_editor_keys_without_counters(
                    transaction.change.runtime_publication_generation,
                    &transaction.change.document.keys,
                    &transaction.change.selected_key_type,
                );
            }
            if keys_changed || counters_changed {
                runtime_applied = self.replace_history_counters_locked(
                    &mut counter_guard,
                    transaction.change.runtime_publication_generation,
                    &transaction.change.key_counters,
                );
            }
        }
        let publication_generation = result
            .as_ref()
            .map(|transaction| transaction.change.runtime_publication_generation)
            .unwrap_or_else(|_| self.store.runtime_publication_generation());
        self.finish_counter_history_barrier(
            emitter,
            counter_guard,
            runtime_applied,
            publication_generation,
        );

        result.map(|transaction| (transaction, runtime_applied))
    }

    pub(crate) fn commit_preset_editor_transaction_preserving_runtime_counters<T>(
        &self,
        emitter: &dyn KeyCounterEventEmitter,
        origin: crate::models::EditorCommitOrigin,
        touched_fields: &[crate::models::EditorField],
        admission: HistoryAdmissionLease,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<(AdmittedEditorTransaction<T>, bool), EditorCommitError> {
        self.commit_editor_transaction_preserving_runtime_counters(emitter, |runtime_counters| {
            self.store.commit_preset_editor_transaction_with_admission(
                origin,
                touched_fields,
                runtime_counters.clone(),
                admission,
                updater,
            )
        })
    }

    pub(crate) fn commit_legacy_editor_reset_preserving_runtime_counters<T>(
        &self,
        emitter: &dyn KeyCounterEventEmitter,
        origin: crate::models::EditorCommitOrigin,
        touched_fields: &[crate::models::EditorField],
        plugin_instances_reset: PluginInstancesResetScope,
        admission: HistoryAdmissionLease,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<(AdmittedEditorTransaction<T>, bool), EditorCommitError> {
        self.commit_editor_transaction_preserving_runtime_counters(emitter, |runtime_counters| {
            self.store
                .commit_legacy_editor_reset_transaction_with_runtime_counters_admission(
                    origin,
                    touched_fields,
                    plugin_instances_reset,
                    admission,
                    runtime_counters,
                    updater,
                )
        })
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

    pub(crate) fn apply_history_editor_key_runtime_locked(
        &self,
        counter_guard: &mut KeyCounters,
        change: &CommittedEditorChange,
    ) -> bool {
        if !change
            .result
            .changed_fields
            .contains(&crate::models::EditorField::Keys)
        {
            return false;
        }
        self.apply_committed_editor_keys_without_counters(
            change.runtime_publication_generation,
            &change.document.keys,
            &change.selected_key_type,
        );
        self.replace_history_counters_locked(
            counter_guard,
            change.runtime_publication_generation,
            &change.key_counters,
        )
    }

    pub(crate) fn finish_counter_history_barrier(
        &self,
        emitter: &dyn KeyCounterEventEmitter,
        mut counters: parking_lot::RwLockWriteGuard<'_, KeyCounters>,
        counters_restored: bool,
        publication_generation: u64,
    ) {
        let replayed_count = {
            let mut barrier = self.counter_history_barrier.lock();
            let mut replayed_count = 0;
            while let Some(increment) = barrier.queued.pop_front() {
                if let Some(count) = counters
                    .get_mut(&increment.mode)
                    .and_then(|mode| mode.get_mut(&increment.key))
                {
                    *count = count.saturating_add(1);
                    replayed_count += 1;
                }
            }
            barrier.queueing = false;
            replayed_count
        };
        if replayed_count != 0 {
            let mut publication = self.runtime_publication.lock();
            publication.counters_generation =
                publication.counters_generation.max(publication_generation);
        }
        if counters_restored || replayed_count != 0 {
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
        let _persistence_guard = self.key_sound_output_persistence_lock.lock();
        // 셧다운 뒤 요청은 장치를 열기 전에 거절 (persist 단계의 turn 검사와 동일 조건)
        self.ensure_mutation_allowed().map_err(anyhow::Error::msg)?;
        self.key_sound_output_generation
            .fetch_add(1, Ordering::AcqRel);
        // 장치 열기는 번호표 밖에서 기다린다 - turn 안에서 기다리면 드라이버가 멈춘 동안
        // 뒤 번호표(저장·커밋) 전부가 정지한다. 엔진 콜백은 저장 스레드만 생성하므로
        // 동기 대기 중 교착 없음
        let output_state = self.key_sound.set_output_backend(backend);
        let requested = output_state.requested.clone();
        // 잠금 순서: persistence_lock → 번호표. 번호표 보유자는 이 잠금을 잡지 않고
        // fallback persist 스레드는 잠금만 잡고 번호표는 잡지 않으므로 역순이 없다.
        // 잠금을 든 채 번호표를 받아야 겹친 요청의 엔진 전환 순서와 persist 순서가 일치한다
        let ticket = self
            .issue_mutation_publication()
            .map_err(anyhow::Error::msg)?;
        ticket.run(|| {
            self.ensure_mutation_allowed().map_err(anyhow::Error::msg)?;
            self.store.update(|state| {
                state.key_sound_output_backend = Some(output_backend_to_persist(requested));
            })
        })?;
        Ok(output_state)
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

    pub(crate) fn publish_committed_key_sound_bindings(
        &self,
        change: &CommittedEditorChange,
    ) -> bool {
        if !change
            .result
            .changed_fields
            .contains(&crate::models::EditorField::KeyPositions)
        {
            return false;
        }

        let bindings = Arc::new(build_key_sound_binding_table(
            &change.document.key_positions,
        ));
        let mut publication = self.runtime_publication.lock();
        if change.runtime_publication_generation < publication.key_sound_bindings_generation {
            return false;
        }
        *self.key_sound_bindings.write() = bindings;
        publication.key_sound_bindings_generation = change.runtime_publication_generation;
        true
    }

    fn resolve_key_sound_binding(
        &self,
        mode: &str,
        slot_indices: &[usize],
    ) -> Option<(String, f32)> {
        let bindings = Arc::clone(&self.key_sound_bindings.read());
        let mode_bindings = bindings.get(mode)?;

        slot_indices.iter().find_map(|index| {
            mode_bindings
                .get(*index)
                .and_then(Option::as_ref)
                .map(|binding| (binding.sound_path.clone(), binding.per_key_volume))
        })
    }

    // ========== CSS 핫리로딩 관련 메서드 ==========

    /// 잠금 순서: 번호표 turn -> CSS 잠금, 역순이면 preset_load와 교착
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
        KeySoundOutputBackendPersist::Device { id, name } => {
            KeySoundOutputBackend::Device { id, name }
        }
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
        KeySoundOutputBackend::Device { id, name } => {
            KeySoundOutputBackendPersist::Device { id, name }
        }
        KeySoundOutputBackend::Asio {
            driver_name,
            buffer_size,
        } => KeySoundOutputBackendPersist::Asio {
            driver_name,
            buffer_size,
        },
    }
}

fn output_backend_targets_match(
    left: &KeySoundOutputBackendPersist,
    right: &KeySoundOutputBackendPersist,
) -> bool {
    match (left, right) {
        (
            KeySoundOutputBackendPersist::DefaultDevice,
            KeySoundOutputBackendPersist::DefaultDevice,
        ) => true,
        (
            KeySoundOutputBackendPersist::Device { id: left_id, .. },
            KeySoundOutputBackendPersist::Device { id: right_id, .. },
        ) => left_id == right_id,
        (
            KeySoundOutputBackendPersist::Asio {
                driver_name: left_driver,
                ..
            },
            KeySoundOutputBackendPersist::Asio {
                driver_name: right_driver,
                ..
            },
        ) => left_driver == right_driver,
        _ => false,
    }
}

#[cfg(test)]
mod output_backend_tests {
    use super::{
        output_backend_from_persist, output_backend_targets_match, output_backend_to_persist,
    };
    use crate::{audio::KeySoundOutputBackend, models::KeySoundOutputBackendPersist};

    #[test]
    fn device_output_backend_persist_round_trip() {
        let backend = KeySoundOutputBackend::Device {
            id: "coreaudio:device-id".to_string(),
            name: "Speakers".to_string(),
        };
        let persisted = output_backend_to_persist(backend.clone());

        assert_eq!(
            persisted,
            KeySoundOutputBackendPersist::Device {
                id: "coreaudio:device-id".to_string(),
                name: "Speakers".to_string(),
            }
        );
        assert_eq!(output_backend_from_persist(persisted), backend);
    }

    #[test]
    fn device_output_backend_uses_camel_case_json() {
        let persisted = KeySoundOutputBackendPersist::Device {
            id: "wasapi:device-id".to_string(),
            name: "Headphones".to_string(),
        };

        assert_eq!(
            serde_json::to_value(persisted).unwrap(),
            serde_json::json!({
                "kind": "device",
                "id": "wasapi:device-id",
                "name": "Headphones"
            })
        );
    }

    #[test]
    fn output_backend_target_match_uses_stable_identifiers() {
        let default = KeySoundOutputBackendPersist::DefaultDevice;
        let device = KeySoundOutputBackendPersist::Device {
            id: "device-id".to_string(),
            name: "Old name".to_string(),
        };
        let renamed_device = KeySoundOutputBackendPersist::Device {
            id: "device-id".to_string(),
            name: "New name".to_string(),
        };
        let other_device = KeySoundOutputBackendPersist::Device {
            id: "other-device-id".to_string(),
            name: "Old name".to_string(),
        };
        let asio = KeySoundOutputBackendPersist::Asio {
            driver_name: "ASIO Driver".to_string(),
            buffer_size: Some(128),
        };
        let resized_asio = KeySoundOutputBackendPersist::Asio {
            driver_name: "ASIO Driver".to_string(),
            buffer_size: Some(256),
        };
        let other_asio = KeySoundOutputBackendPersist::Asio {
            driver_name: "Other ASIO Driver".to_string(),
            buffer_size: Some(128),
        };

        assert!(output_backend_targets_match(&default, &default));
        assert!(output_backend_targets_match(&device, &renamed_device));
        assert!(!output_backend_targets_match(&device, &other_device));
        assert!(output_backend_targets_match(&asio, &resized_asio));
        assert!(!output_backend_targets_match(&asio, &other_asio));
        assert!(!output_backend_targets_match(&default, &device));
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
                // 메인보다 먼저 감춰 macOS에서 패널이 잠시 key 창이 되는 것을 막음
                state.hide_detached_panel_with_main(&app_handle);
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
    placement: NativePlacement,
) -> Result<AppliedOverlayFrame> {
    #[cfg(target_os = "macos")]
    {
        use objc::{class, msg_send, sel, sel_impl};

        let requested = applied_overlay_frame_from_placement(placement);
        // 메인 스레드에서 큐잉 후 대기하면 교착하므로 직접 실행
        let on_main: bool = unsafe { msg_send![class!(NSThread), isMainThread] };
        if on_main {
            return Ok(apply_overlay_frame_macos(window, placement)
                .map(|public_bounds| AppliedOverlayFrame {
                    public_bounds,
                    native_position: None,
                })
                .unwrap_or(requested));
        }

        let (tx, rx) = std::sync::mpsc::channel();
        let target = window.clone();
        window.app_handle().run_on_main_thread(move || {
            let _ = tx.send(apply_overlay_frame_macos(&target, placement));
        })?;
        Ok(rx
            .recv_timeout(Duration::from_millis(OVERLAY_FRAME_APPLY_TIMEOUT_MS))
            .ok()
            .flatten()
            .map(|public_bounds| AppliedOverlayFrame {
                public_bounds,
                native_position: None,
            })
            .unwrap_or(requested))
    }
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER};

        let hwnd = window.hwnd()?;
        let px = placement.position.x.round() as i32;
        let py = placement.position.y.round() as i32;
        let pw = (placement.width * placement.target_scale).round() as i32;
        let ph = (placement.height * placement.target_scale).round() as i32;
        unsafe {
            SetWindowPos(hwnd, None, px, py, pw, ph, SWP_NOZORDER | SWP_NOACTIVATE)?;
        }
        applied_overlay_frame_from_window(window)
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        window.set_size(LogicalSize::new(placement.width, placement.height))?;
        window.set_position(LogicalPosition::new(
            placement.position.x,
            placement.position.y,
        ))?;
        applied_overlay_frame_from_window(window)
    }
}

/// tao 좌표(주 모니터 좌상단 원점)를 AppKit 좌표(주 모니터 좌하단 원점)로 변환해 setFrame 적용
#[cfg(target_os = "macos")]
fn apply_overlay_frame_macos(
    window: &WebviewWindow,
    placement: NativePlacement,
) -> Option<OverlayBounds> {
    use cocoa::foundation::{NSPoint, NSRect, NSSize};
    use objc::{class, msg_send, sel, sel_impl};

    let fallback = || {
        let _ = window.set_size(LogicalSize::new(placement.width, placement.height));
        let _ = window.set_position(LogicalPosition::new(
            placement.position.x,
            placement.position.y,
        ));
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

            let flipped_y = screen_frame.size.height - (placement.position.y + placement.height);
            let frame = NSRect::new(
                NSPoint::new(placement.position.x, flipped_y),
                NSSize::new(placement.width, placement.height),
            );
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

/// 분리 창을 포커스 이동 없이 메인 위로 올린다.
///
/// 빌더의 focused(false)가 tao에 MARKER_DONT_FOCUS를 남기는데, 이 플래그를 내리는 코드는
/// apply_diff가 값으로 받은 복사본만 바꾸므로 창 수명 내내 살아 있다. 그래서 show()는 항상
/// SW_SHOWNOACTIVATE로 나가고, 그건 활성 창 위로 올려주지 않아 패널이 메인 뒤에 깔린다.
/// 순서를 올리는 유일한 경로였던 set_focus는 드래그 tear-off에서 쓸 수 없다 -
/// 메인 웹뷰가 kill-focus를 받으면 mousedown 암시적 캡처가 풀려 드래그 세션이 끊긴다.
///
/// TOPMOST 밴드는 쓰지 않는다 - 한 프레임이라도 올라가면 always-on-top 오버레이 위로 나온다
#[cfg(target_os = "windows")]
fn raise_panel_window_without_activation(window: &WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE,
    };

    let hwnd = match window.hwnd() {
        Ok(hwnd) => hwnd,
        Err(err) => {
            log::warn!("failed to get panel HWND for z-order raise: {err}");
            return;
        }
    };
    if let Err(err) = unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND_TOP),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
        )
    } {
        log::warn!("failed to raise panel window above main: {err}");
    }
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

#[cfg(target_os = "windows")]
struct OverlayMoveObserverContext {
    store: Arc<AppStore>,
    generation: Arc<AtomicU64>,
    trust: Arc<Mutex<OverlayPlacementTrust>>,
    entered: AtomicBool,
}

#[cfg(target_os = "windows")]
fn install_overlay_move_observer(
    window: &WebviewWindow,
    store: Arc<AppStore>,
    generation: Arc<AtomicU64>,
    trust: Arc<Mutex<OverlayPlacementTrust>>,
) -> Result<()> {
    use std::panic::{catch_unwind, AssertUnwindSafe};
    use windows::Win32::{
        System::Threading::GetCurrentThreadId, UI::WindowsAndMessaging::GetWindowThreadProcessId,
    };

    let hwnd = window.hwnd()?;
    let owner_thread = unsafe { GetWindowThreadProcessId(hwnd, None) };
    if owner_thread == 0 {
        return Err(anyhow!("failed to identify overlay HWND owner thread"));
    }
    if owner_thread == unsafe { GetCurrentThreadId() } {
        return unsafe {
            install_overlay_move_observer_on_owner_thread(window, store, generation, trust)
        };
    }

    let (sender, receiver) = std::sync::mpsc::channel();
    let target = window.clone();
    window.app_handle().run_on_main_thread(move || {
        let result = catch_unwind(AssertUnwindSafe(|| unsafe {
            install_overlay_move_observer_on_owner_thread(&target, store, generation, trust)
        }))
        .unwrap_or_else(|_| Err(anyhow!("overlay move observer installation panicked")));
        let _ = sender.send(result);
    })?;
    receiver
        .recv_timeout(Duration::from_secs(3))
        .map_err(|error| anyhow!("overlay move observer owner result unavailable: {error}"))?
}

#[cfg(target_os = "windows")]
unsafe fn install_overlay_move_observer_on_owner_thread(
    window: &WebviewWindow,
    store: Arc<AppStore>,
    generation: Arc<AtomicU64>,
    trust: Arc<Mutex<OverlayPlacementTrust>>,
) -> Result<()> {
    use windows::Win32::{
        System::Threading::GetCurrentThreadId,
        UI::{Shell::SetWindowSubclass, WindowsAndMessaging::GetWindowThreadProcessId},
    };

    const SUBCLASS_ID: usize = 0x444d_4f50;

    let hwnd = window.hwnd()?;
    let owner_thread = unsafe { GetWindowThreadProcessId(hwnd, None) };
    if owner_thread == 0 || owner_thread != unsafe { GetCurrentThreadId() } {
        return Err(anyhow!(
            "overlay move observer installation requires the HWND owner thread"
        ));
    }
    let context = Box::into_raw(Box::new(OverlayMoveObserverContext {
        store,
        generation,
        trust,
        entered: AtomicBool::new(false),
    }));
    let installed = unsafe {
        SetWindowSubclass(
            hwnd,
            Some(overlay_move_subclass_proc),
            SUBCLASS_ID,
            context as usize,
        )
    };
    if !installed.as_bool() {
        unsafe { drop(Box::from_raw(context)) };
        return Err(anyhow!("failed to subclass overlay HWND"));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
unsafe fn applied_overlay_frame_from_hwnd(
    hwnd: windows::Win32::Foundation::HWND,
) -> Result<AppliedOverlayFrame> {
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
    use windows::Win32::{Foundation::RECT, UI::HiDpi::GetDpiForWindow};

    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect)? };
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    let scale = f64::from(dpi) / 96.0;
    applied_overlay_frame_from_native(
        NativeRect {
            x: f64::from(rect.left),
            y: f64::from(rect.top),
            width: f64::from(rect.right - rect.left),
            height: f64::from(rect.bottom - rect.top),
        },
        scale,
        true,
    )
    .ok_or_else(|| anyhow!("overlay HWND frame is invalid"))
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn overlay_move_subclass_proc(
    hwnd: windows::Win32::Foundation::HWND,
    message: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    subclass_id: usize,
    reference_data: usize,
) -> windows::Win32::Foundation::LRESULT {
    use std::panic::{catch_unwind, AssertUnwindSafe};
    use windows::Win32::UI::{
        Shell::{DefSubclassProc, RemoveWindowSubclass},
        WindowsAndMessaging::{WM_ENTERSIZEMOVE, WM_EXITSIZEMOVE, WM_NCDESTROY},
    };

    catch_unwind(AssertUnwindSafe(|| unsafe {
        let context = reference_data as *mut OverlayMoveObserverContext;
        if context.is_null() {
            return DefSubclassProc(hwnd, message, wparam, lparam);
        }
        match message {
            WM_ENTERSIZEMOVE => {
                (*context).entered.store(true, Ordering::Release);
            }
            WM_EXITSIZEMOVE => {
                if (*context).entered.swap(false, Ordering::AcqRel) {
                    match applied_overlay_frame_from_hwnd(hwnd).and_then(|frame| {
                        persist_overlay_placement(
                            &(*context).store,
                            &(*context).generation,
                            &(*context).trust,
                            frame,
                            None,
                            OverlayPersistenceAuthority::NativeMoveEnded,
                        )
                    }) {
                        Ok(()) => {}
                        Err(error) => {
                            log::warn!("failed to persist overlay move end: {error:#}")
                        }
                    }
                }
            }
            WM_NCDESTROY => {
                let _ = RemoveWindowSubclass(hwnd, Some(overlay_move_subclass_proc), subclass_id);
                let result = DefSubclassProc(hwnd, message, wparam, lparam);
                drop(Box::from_raw(context));
                return result;
            }
            _ => {}
        }
        DefSubclassProc(hwnd, message, wparam, lparam)
    }))
    .unwrap_or_else(|_| unsafe { DefSubclassProc(hwnd, message, wparam, lparam) })
}

#[cfg(not(target_os = "windows"))]
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

    scale_physical_bounds_to_logical(bounds, scale)
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct NativeRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl NativeRect {
    fn contains_point(&self, x: f64, y: f64) -> bool {
        x >= self.x && x <= self.x + self.width && y >= self.y && y <= self.y + self.height
    }

    fn intersection_area_native(&self, other: NativeRect) -> f64 {
        let left = self.x.max(other.x);
        let top = self.y.max(other.y);
        let right = (self.x + self.width).min(other.x + other.width);
        let bottom = (self.y + self.height).min(other.y + other.height);
        (right - left).max(0.0) * (bottom - top).max(0.0)
    }

    fn clamp_native(&self, rect: NativeRect) -> OverlayPosition {
        let max_x = self.x + (self.width - rect.width).max(0.0);
        let max_y = self.y + (self.height - rect.height).max(0.0);
        OverlayPosition {
            x: rect.x.clamp(self.x, max_x),
            y: rect.y.clamp(self.y, max_y),
        }
    }
}

#[derive(Clone, Debug)]
struct MonitorSpec {
    identity: String,
    enumeration_index: usize,
    full_rect_native: NativeRect,
    work_rect_native: NativeRect,
    full_rect_physical: NativeRect,
    scale_factor: f64,
    logical_to_native_scale: f64,
}

impl MonitorSpec {
    fn from_monitor(monitor: Monitor, enumeration_index: usize) -> Option<Self> {
        let scale = monitor.scale_factor();
        // 병리적 scale이 spec에 섞이면 환산이 조용히 깨진다
        if !monitor_scale_is_usable(scale) {
            return None;
        }
        let full_origin = *monitor.position();
        let full_size = *monitor.size();
        let work_area = monitor.work_area();
        let full_rect_physical = NativeRect {
            x: full_origin.x as f64,
            y: full_origin.y as f64,
            width: full_size.width as f64,
            height: full_size.height as f64,
        };
        let work_rect_physical = NativeRect {
            x: work_area.position.x as f64,
            y: work_area.position.y as f64,
            width: work_area.size.width as f64,
            height: work_area.size.height as f64,
        };
        #[cfg(target_os = "windows")]
        let (full_rect_native, work_rect_native, logical_to_native_scale) =
            (full_rect_physical, work_rect_physical, scale);
        #[cfg(not(target_os = "windows"))]
        let (full_rect_native, work_rect_native, logical_to_native_scale) = (
            NativeRect {
                x: full_rect_physical.x / scale,
                y: full_rect_physical.y / scale,
                width: full_rect_physical.width / scale,
                height: full_rect_physical.height / scale,
            },
            NativeRect {
                x: work_rect_physical.x / scale,
                y: work_rect_physical.y / scale,
                width: work_rect_physical.width / scale,
                height: work_rect_physical.height / scale,
            },
            1.0,
        );
        let identity = format!(
            "{}@{}:{}:{}:{}",
            monitor.name().map(String::as_str).unwrap_or("unnamed"),
            full_origin.x,
            full_origin.y,
            full_size.width,
            full_size.height
        );

        Some(Self {
            identity,
            enumeration_index,
            full_rect_native,
            work_rect_native,
            full_rect_physical,
            scale_factor: scale,
            logical_to_native_scale,
        })
    }

    fn matches(&self, other: &Self) -> bool {
        (self.full_rect_physical.x - other.full_rect_physical.x).abs() < 0.5
            && (self.full_rect_physical.y - other.full_rect_physical.y).abs() < 0.5
            && (self.full_rect_physical.width - other.full_rect_physical.width).abs() < 0.5
            && (self.full_rect_physical.height - other.full_rect_physical.height).abs() < 0.5
            && (self.scale_factor - other.scale_factor).abs() < f64::EPSILON
    }

    #[cfg(not(target_os = "windows"))]
    fn contains_physical(&self, x: f64, y: f64) -> bool {
        self.full_rect_physical.contains_point(x, y)
    }

    fn logical_length_to_native(&self, value: f64) -> f64 {
        value * self.logical_to_native_scale
    }

    fn native_length_to_logical(&self, value: f64) -> f64 {
        value / self.logical_to_native_scale
    }

    fn intersection_area_native(&self, rect: NativeRect) -> f64 {
        self.full_rect_native.intersection_area_native(rect)
    }

    fn clamp_native(&self, rect: NativeRect) -> OverlayPosition {
        self.work_rect_native.clamp_native(rect)
    }
}

#[derive(Clone, Debug, Default)]
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
            .enumerate()
            .filter_map(|(index, monitor)| MonitorSpec::from_monitor(monitor, index))
            .collect();

        let mut primary_index = None;
        if let Ok(Some(primary)) = app.primary_monitor() {
            if let Some(primary_spec) = MonitorSpec::from_monitor(primary, usize::MAX) {
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

    #[cfg(not(target_os = "windows"))]
    fn fallback_scale(&self) -> f64 {
        self.primary_spec()
            .map(|spec| spec.scale_factor)
            .unwrap_or(1.0)
    }

    #[cfg(not(target_os = "windows"))]
    fn find_by_physical(&self, x: f64, y: f64) -> Option<&MonitorSpec> {
        self.specs.iter().find(|spec| spec.contains_physical(x, y))
    }

    /// full monitor rect 기준 최대 겹침, 동률이면 고유한 열거 인덱스 순
    fn find_best_overlap_native(&self, rect: NativeRect) -> Option<&MonitorSpec> {
        self.specs
            .iter()
            .filter(|spec| spec.intersection_area_native(rect) > 0.0)
            .min_by(|a, b| {
                b.intersection_area_native(rect)
                    .total_cmp(&a.intersection_area_native(rect))
                    .then_with(|| a.enumeration_index.cmp(&b.enumeration_index))
            })
    }

    #[cfg(any(target_os = "windows", test))]
    fn find_by_native_point(&self, x: f64, y: f64) -> Option<&MonitorSpec> {
        self.specs
            .iter()
            .find(|spec| spec.full_rect_native.contains_point(x, y))
    }

    fn first(&self) -> Option<&MonitorSpec> {
        self.specs.first()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OverlayRestoreSource {
    #[cfg(any(target_os = "windows", test))]
    TrustedNative,
    LegacyPhysical,
    InferredLogical,
    Default,
}

impl OverlayRestoreSource {
    fn as_str(self) -> &'static str {
        match self {
            #[cfg(any(target_os = "windows", test))]
            Self::TrustedNative => "native",
            Self::LegacyPhysical => "legacyPhysical",
            Self::InferredLogical => "inferredLogical",
            Self::Default => "default",
        }
    }

    #[cfg(any(target_os = "windows", test))]
    fn initial_trust(self) -> OverlayPlacementTrust {
        if self == Self::InferredLogical {
            OverlayPlacementTrust::Tainted
        } else {
            OverlayPlacementTrust::Clean
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum NativeRejectReason {
    #[cfg(any(target_os = "windows", test))]
    None,
    #[cfg(any(target_os = "windows", test))]
    Missing,
    #[cfg(any(target_os = "windows", test))]
    EchoMismatch,
    #[cfg(any(target_os = "windows", test))]
    Invalid,
    #[cfg(not(target_os = "windows"))]
    Unused,
}

impl NativeRejectReason {
    fn as_str(self) -> &'static str {
        match self {
            #[cfg(any(target_os = "windows", test))]
            Self::None => "none",
            #[cfg(any(target_os = "windows", test))]
            Self::Missing => "missing",
            #[cfg(any(target_os = "windows", test))]
            Self::EchoMismatch => "echoMismatch",
            #[cfg(any(target_os = "windows", test))]
            Self::Invalid => "invalid",
            #[cfg(not(target_os = "windows"))]
            Self::Unused => "unused",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OverlayPlacementTrust {
    Clean,
    #[cfg(any(target_os = "windows", test))]
    Tainted,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OverlayPersistenceAuthority {
    General,
    #[cfg(any(target_os = "windows", test))]
    NativeMoveEnded,
    Reset,
}

impl OverlayPersistenceAuthority {
    fn establishes_trust(self) -> bool {
        match self {
            Self::General => false,
            #[cfg(any(target_os = "windows", test))]
            Self::NativeMoveEnded => true,
            Self::Reset => true,
        }
    }
}

fn next_overlay_placement_trust(
    current: OverlayPlacementTrust,
    authority: OverlayPersistenceAuthority,
) -> OverlayPlacementTrust {
    if authority.establishes_trust() {
        OverlayPlacementTrust::Clean
    } else {
        current
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct NativePlacement {
    position: OverlayPosition,
    width: f64,
    height: f64,
    target_scale: f64,
}

impl NativePlacement {
    fn native_rect(self) -> NativeRect {
        NativeRect {
            x: self.position.x,
            y: self.position.y,
            width: self.width * self.target_scale,
            height: self.height * self.target_scale,
        }
    }
}

#[derive(Clone, Debug)]
enum PendingOverlayScaleResolution {
    #[cfg(any(target_os = "windows", test))]
    Windows { stored: Option<OverlayBounds> },
    #[cfg(not(target_os = "windows"))]
    NonWindowsLegacyPhysical { stored: OverlayBounds },
}

#[derive(Clone, Debug)]
struct ResolvedOverlayPlacement {
    placement: NativePlacement,
    resize_basis: NativePlacement,
    had_stored_bounds: bool,
    source: OverlayRestoreSource,
    native_reject_reason: NativeRejectReason,
    candidate_count: usize,
    selected_monitor: Option<String>,
    selected_scale: f64,
    visibility_adjustment: bool,
    monitors: MonitorData,
    pending_scale_resolution: Option<PendingOverlayScaleResolution>,
}

#[derive(Clone, Copy)]
struct OverlayRestoreMetadata {
    source: OverlayRestoreSource,
    native_reject_reason: NativeRejectReason,
    candidate_count: usize,
    visibility_adjustment: bool,
}

impl ResolvedOverlayPlacement {
    fn for_size(&self, width: f64, height: f64) -> NativePlacement {
        finalize_native_placement(
            self.resize_basis.position,
            width,
            height,
            self.resize_basis.target_scale,
            self.had_stored_bounds,
            &self.monitors,
        )
        .0
    }
}

fn complete_overlay_scale_resolution(
    mut resolved: ResolvedOverlayPlacement,
    window_scale: f64,
) -> Option<ResolvedOverlayPlacement> {
    if !monitor_scale_is_usable(window_scale) {
        return None;
    }
    let Some(pending) = resolved.pending_scale_resolution.take() else {
        return Some(resolved);
    };

    let resize_basis = match pending {
        #[cfg(any(target_os = "windows", test))]
        PendingOverlayScaleResolution::Windows { stored } => match resolved.source {
            OverlayRestoreSource::TrustedNative => {
                let stored = stored?;
                NativePlacement {
                    position: resolved.resize_basis.position,
                    width: clamp_overlay_dimension(stored.width),
                    height: clamp_overlay_dimension(stored.height),
                    target_scale: window_scale,
                }
            }
            OverlayRestoreSource::LegacyPhysical => {
                let stored = stored?;
                NativePlacement {
                    position: OverlayPosition {
                        x: stored.x,
                        y: stored.y,
                    },
                    width: clamp_overlay_dimension(stored.width / window_scale),
                    height: clamp_overlay_dimension(stored.height / window_scale),
                    target_scale: window_scale,
                }
            }
            OverlayRestoreSource::InferredLogical => {
                let stored = stored?;
                NativePlacement {
                    position: OverlayPosition {
                        x: stored.x * window_scale,
                        y: stored.y * window_scale,
                    },
                    width: clamp_overlay_dimension(stored.width),
                    height: clamp_overlay_dimension(stored.height),
                    target_scale: window_scale,
                }
            }
            OverlayRestoreSource::Default => NativePlacement {
                position: OverlayPosition { x: 0.0, y: 0.0 },
                width: DEFAULT_OVERLAY_WIDTH,
                height: DEFAULT_OVERLAY_HEIGHT,
                target_scale: window_scale,
            },
        },
        #[cfg(not(target_os = "windows"))]
        PendingOverlayScaleResolution::NonWindowsLegacyPhysical { stored } => NativePlacement {
            position: OverlayPosition {
                x: stored.x / window_scale,
                y: stored.y / window_scale,
            },
            width: clamp_overlay_dimension(stored.width / window_scale),
            height: clamp_overlay_dimension(stored.height / window_scale),
            target_scale: 1.0,
        },
    };
    let result = finalize_native_placement(
        resize_basis.position,
        resize_basis.width,
        resize_basis.height,
        resize_basis.target_scale,
        resolved.had_stored_bounds,
        &resolved.monitors,
    );
    resolved.placement = result.0;
    resolved.resize_basis = resize_basis;
    resolved.selected_monitor = result.2.map(|spec| spec.identity.clone());
    resolved.selected_scale = window_scale;
    resolved.visibility_adjustment = result.1;
    Some(resolved)
}

#[derive(Clone, Debug)]
struct AppliedOverlayFrame {
    public_bounds: OverlayBounds,
    native_position: Option<OverlayPosition>,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelDragContext {
    /// 메인 창 outer 사각형 - content 원점 실측 실패 시 근사 폴백
    pub main_frame: Option<LogicalRect>,
    /// 메인 창 content(웹뷰) 원점 - 드래그 도크 존 판정 기준.
    /// Windows 메인 창은 프레임리스+그림자(tao undecorated-shadow 인셋, 좌우 약 8 논리 px·상단 0~2 물리 px)라
    /// outer와 어긋나고, 렌더러의 outerWidth-innerWidth는 WebView2에서 0이라 여기서 실측한다
    pub main_content_origin: Option<LogicalPoint>,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogicalPoint {
    pub x: f64,
    pub y: f64,
}

/// 논리 좌표계 사각형 - 창 게터가 주는 physical 값을 scale로 나눈 도메인
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogicalRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// 메인 창의 현재 사각형을 logical로 읽는다.
/// 창 게터는 메인 스레드로 왕복하므로 panel_creation_lock 밖에서만 호출할 것.
/// outer 기준이라 Windows 프레임과 macOS 타이틀바가 포함되는데, 패널은 그 바깥에 붙는 게 맞다
fn main_window_logical_rect(app: &AppHandle) -> Option<LogicalRect> {
    let window = app.get_webview_window("main")?;
    let scale = window
        .scale_factor()
        .ok()
        .filter(|scale| monitor_scale_is_usable(*scale))
        .unwrap_or(1.0);
    let position = window.outer_position().ok()?.to_logical::<f64>(scale);
    let size = window.outer_size().ok()?.to_logical::<f64>(scale);
    Some(LogicalRect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

/// 기본 배치용 플랫폼 네이티브 사각형
fn main_window_native_rect(app: &AppHandle) -> Option<NativeRect> {
    let window = app.get_webview_window("main")?;
    let position = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    #[cfg(target_os = "windows")]
    {
        Some(NativeRect {
            x: position.x as f64,
            y: position.y as f64,
            width: size.width as f64,
            height: size.height as f64,
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let scale = window
            .scale_factor()
            .ok()
            .filter(|scale| monitor_scale_is_usable(*scale))
            .unwrap_or(1.0);
        let position = position.to_logical::<f64>(scale);
        let size = size.to_logical::<f64>(scale);
        Some(NativeRect {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        })
    }
}

// 렌더러의 드롭 좌표는 "커서 - client 기준 grab 오프셋" = 원하는 client 원점이다.
// 패널 창도 프레임리스+그림자라 Windows에선 outer가 client보다 인셋만큼 크다 -
// set_position(outer)에 그대로 꽂으면 콘텐츠가 그만큼 밀리므로 실측 인셋으로 보정한다.
// macOS는 인셋 0이라 무변화. 실측 실패 시 보정 없이 진행
fn panel_client_to_outer_position(window: &WebviewWindow, x: f64, y: f64) -> LogicalPosition<f64> {
    let inset = window
        .scale_factor()
        .ok()
        .filter(|scale| monitor_scale_is_usable(*scale))
        .and_then(|scale| {
            let outer = window.outer_position().ok()?.to_logical::<f64>(scale);
            let inner = window.inner_position().ok()?.to_logical::<f64>(scale);
            Some((inner.x - outer.x, inner.y - outer.y))
        })
        .unwrap_or((0.0, 0.0));
    LogicalPosition::new(x - inset.0, y - inset.1)
}

fn logical_position_to_native(
    window: &WebviewWindow,
    position: LogicalPosition<f64>,
) -> OverlayPosition {
    #[cfg(target_os = "windows")]
    {
        let scale = window
            .scale_factor()
            .ok()
            .filter(|scale| monitor_scale_is_usable(*scale))
            .unwrap_or(1.0);
        OverlayPosition {
            x: position.x * scale,
            y: position.y * scale,
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        OverlayPosition {
            x: position.x,
            y: position.y,
        }
    }
}

/// 메인 창 content(웹뷰) 영역의 화면 논리 원점.
/// 렌더러 client 좌표 + 이 원점 = 화면 논리 좌표 (드래그 도크 존 판정에 사용)
fn main_window_content_origin(app: &AppHandle) -> Option<LogicalPoint> {
    let window = app.get_webview_window("main")?;
    let scale = window
        .scale_factor()
        .ok()
        .filter(|scale| monitor_scale_is_usable(*scale))
        .unwrap_or(1.0);
    let position = window.inner_position().ok()?.to_logical::<f64>(scale);
    Some(LogicalPoint {
        x: position.x,
        y: position.y,
    })
}

/// 분리 패널을 메인 창 오른쪽에 여백을 두고 세로 중앙으로 붙인다.
/// 오른쪽 자리가 모자라면 왼쪽, 양쪽 다 모자라면 작업 영역 안으로 밀어 넣는다
fn panel_position_beside_main(
    main: &NativeRect,
    panel_height: f64,
    work_area: &MonitorSpec,
) -> OverlayPosition {
    let panel_width_native = work_area.logical_length_to_native(PANEL_WIDTH);
    let panel_height_native = work_area.logical_length_to_native(panel_height);
    let gap_native = work_area.logical_length_to_native(PANEL_BESIDE_GAP);
    let right_x = main.x + main.width + gap_native;
    let left_x = main.x - gap_native - panel_width_native;
    let fits_right = right_x + panel_width_native
        <= work_area.work_rect_native.x + work_area.work_rect_native.width;
    let fits_left = left_x >= work_area.work_rect_native.x;
    // 양쪽 다 안 들어가면 오른쪽 후보를 넘겨 clamp가 작업 영역 오른쪽 끝에 붙이게 둔다
    let x = if fits_right || !fits_left {
        right_x
    } else {
        left_x
    };
    // 패널이 화면보다 높으면 clamp가 위쪽 정렬로 떨어뜨린다
    let y = main.y + (main.height - panel_height_native) / 2.0;
    work_area.clamp_native(NativeRect {
        x,
        y,
        width: panel_width_native,
        height: panel_height_native,
    })
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
    main_rect: Option<NativeRect>,
    monitors: &MonitorData,
    fallback_height: Option<f64>,
) -> PanelWindowLayout {
    // 기준 화면은 메인 창이 놓인 모니터 - 패널이 그 옆에 붙으니 높이 한계도 같은 화면을 따른다
    let target_monitor = main_rect
        .and_then(|rect| monitors.find_best_overlap_native(rect))
        .or_else(|| monitors.primary_spec());
    let (min_height, max_height) = panel_height_bounds(
        target_monitor
            .map(|monitor| monitor.native_length_to_logical(monitor.work_rect_native.height)),
    );
    // 저장된 높이가 없으면 메인 창 높이를 기본값으로 (프로그램 높이 동기)
    let requested_height = stored_bounds
        .map(|bounds| bounds.height)
        .or(fallback_height)
        .unwrap_or(PANEL_INITIAL_HEIGHT);
    let height = requested_height.clamp(min_height, max_height);
    // 위치는 열 때마다 메인 창 옆으로 다시 잡는다 - 저장된 x/y는 이동 기록으로만 남고 복원에 쓰지 않음.
    // 메인 좌표를 못 읽으면 OS 기본 배치에 맡긴다
    let position = main_rect
        .zip(target_monitor)
        .map(|(rect, monitor)| panel_position_beside_main(&rect, height, monitor));

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
        state.unpersisted_default_height = None;
        state.default_height_pending = false;
        state.generation = state.generation.wrapping_add(1);
        state.dirty = false;
        state.persist_dirty = false;
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
        let persist = change.changes_persisted_bounds();
        if let PanelBoundsChange::Snapshot(snapshot) = change {
            state.latest = Some(snapshot);
        } else {
            let Some(latest) = state.latest.as_mut() else {
                return false;
            };
            apply_panel_bounds_change(latest, change);
        }
        let persist = Self::should_persist_change(state, persist);
        Self::mark_dirty(state, persist)
    }

    fn should_persist_change(state: &mut PanelBoundsPersistenceState, persist: bool) -> bool {
        if !persist {
            return false;
        }
        let Some(default_height) = state.unpersisted_default_height else {
            return true;
        };
        let Some(sample) = state.latest else {
            state.unpersisted_default_height = None;
            state.default_height_pending = false;
            return true;
        };
        let height = panel_bounds_from_sample(sample).height;
        if (height - default_height).abs() < 0.5 {
            state.default_height_pending = false;
            return false;
        }
        if state.default_height_pending {
            return false;
        }
        state.unpersisted_default_height = None;
        true
    }

    // 이동만 바뀌어도 워커는 깨운다 - 모니터가 바뀌면 높이 한계를 다시 걸어야 하기 때문
    fn mark_dirty(state: &mut PanelBoundsPersistenceState, persist: bool) -> bool {
        state.generation = state.generation.wrapping_add(1);
        state.dirty = true;
        state.persist_dirty |= persist;
        let should_spawn = !state.worker_running;
        state.worker_running = true;
        should_spawn
    }

    fn take_dirty_work(state: &mut PanelBoundsPersistenceState) -> Option<PanelBoundsPersistWork> {
        let sample = state.latest.filter(|_| state.active && state.dirty)?;
        let persist = state.persist_dirty;
        state.dirty = false;
        state.persist_dirty = false;
        Some(PanelBoundsPersistWork {
            session: state.session,
            generation: state.generation,
            sample,
            persist,
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
        state.persist_dirty |= work.persist;
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

    fn clear_saved_bounds(&self, layout: Option<&PanelWindowLayout>) -> Result<()> {
        let _persist_guard = self.persist_lock.lock();
        self.store
            .update_deferred(|data| data.panel_bounds = None)
            .context("failed to clear saved panel bounds")?;
        self.store
            .flush()
            .context("failed to flush cleared panel bounds")?;

        let mut state = self.state.lock();
        let default_height = layout.map(|value| value.height);
        let current_height = state
            .latest
            .map(panel_bounds_from_sample)
            .map(|value| value.height);
        state.unpersisted_default_height = default_height;
        state.default_height_pending = default_height
            .zip(current_height)
            .is_none_or(|(default, current)| (default - current).abs() >= 0.5);
        state.applied_max_height = layout.map(|value| value.max_height);
        state.generation = state.generation.wrapping_add(1);
        state.dirty = false;
        state.persist_dirty = false;
        Ok(())
    }

    fn persist_worker_work(&self, work: PanelBoundsPersistWork) -> Result<bool> {
        // 이동만 바뀐 구간은 디스크를 건드리지 않는다 - 저장 값은 높이뿐이라 쓸 이유가 없다
        if !work.persist {
            return Ok(false);
        }
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
            .and_then(|monitor| MonitorSpec::from_monitor(monitor, 0))
            .map(|monitor| {
                panel_height_bounds(Some(
                    monitor.native_length_to_logical(monitor.work_rect_native.height),
                ))
            })
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
        let persisted =
            Self::flush_samples(&self.state, generation_before_sample, sampled, |sample| {
                self.persist_sample(sample)
            })?;
        if !persisted {
            self.store
                .flush()
                .context("failed to flush store with cleared panel bounds")?;
        }
        Ok(())
    }

    fn flush_samples(
        state_mutex: &Mutex<PanelBoundsPersistenceState>,
        generation_before_sample: u64,
        sampled: Result<PanelBoundsSample>,
        mut persist: impl FnMut(PanelBoundsSample) -> Result<()>,
    ) -> Result<bool> {
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
            state.persist_dirty = false;
            let persist = Self::should_persist_change(&mut state, true);
            PanelBoundsPersistWork {
                session: state.session,
                generation: state.generation,
                sample,
                persist,
            }
        };
        let mut persisted = false;

        loop {
            if work.persist {
                if let Err(error) = persist(work.sample) {
                    Self::restore_failed_work(&mut state_mutex.lock(), &work);
                    return Err(error);
                }
                persisted = true;
            }
            let next = {
                let mut state = state_mutex.lock();
                let Some(mut next) = Self::take_dirty_work(&mut state) else {
                    return Ok(persisted);
                };
                next.persist = Self::should_persist_change(&mut state, true);
                next
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
        state.unpersisted_default_height = None;
        state.default_height_pending = false;
        state.generation = state.generation.wrapping_add(1);
        state.dirty = false;
        state.persist_dirty = false;
        true
    }
}

fn compute_overlay_position_native(
    rect: NativeRect,
    native_scale: f64,
    had_stored_bounds: bool,
    monitors: &MonitorData,
) -> (OverlayPosition, bool, Option<&MonitorSpec>) {
    if monitors.is_empty() {
        let position = if had_stored_bounds {
            OverlayPosition {
                x: rect.x,
                y: rect.y,
            }
        } else {
            OverlayPosition {
                x: OVERLAY_MARGIN * native_scale,
                y: OVERLAY_MARGIN * native_scale,
            }
        };
        let adjusted = (position.x - rect.x).abs() > 0.5 || (position.y - rect.y).abs() > 0.5;
        return (position, adjusted, None);
    }

    let Some(fallback_spec) = monitors.primary_spec().or_else(|| monitors.first()) else {
        return (
            OverlayPosition {
                x: rect.x,
                y: rect.y,
            },
            false,
            None,
        );
    };

    if !had_stored_bounds {
        let margin = fallback_spec.logical_length_to_native(OVERLAY_MARGIN);
        let base = NativeRect {
            x: fallback_spec.work_rect_native.x + fallback_spec.work_rect_native.width
                - rect.width
                - margin,
            y: fallback_spec.work_rect_native.y + fallback_spec.work_rect_native.height
                - rect.height
                - margin,
            ..rect
        };
        let position = fallback_spec.clamp_native(base);
        return (position, true, Some(fallback_spec));
    }

    if let Some(best) = monitors.find_best_overlap_native(rect) {
        let area = best.intersection_area_native(rect);
        let min_visible_side = best.logical_length_to_native(100.0);
        let min_visible_area =
            (rect.width * rect.height * 0.25).min(min_visible_side * min_visible_side);
        if area >= min_visible_area {
            return (
                OverlayPosition {
                    x: rect.x,
                    y: rect.y,
                },
                false,
                Some(best),
            );
        }
        let position = best.clamp_native(rect);
        return (position, true, Some(best));
    }

    let position = fallback_spec.clamp_native(rect);
    (position, true, monitors.primary_spec())
}

fn finalize_native_placement(
    position: OverlayPosition,
    width: f64,
    height: f64,
    initial_scale: f64,
    had_stored_bounds: bool,
    monitors: &MonitorData,
) -> (NativePlacement, bool, Option<&MonitorSpec>) {
    let mut placement = NativePlacement {
        position,
        width,
        height,
        target_scale: initial_scale,
    };
    let (position, mut adjusted, mut selected) = compute_overlay_position_native(
        placement.native_rect(),
        placement.target_scale,
        had_stored_bounds,
        monitors,
    );
    placement.position = position;
    if let Some(spec) = selected {
        if (placement.target_scale - spec.logical_to_native_scale).abs() > f64::EPSILON {
            placement.target_scale = spec.logical_to_native_scale;
            let result = compute_overlay_position_native(
                placement.native_rect(),
                placement.target_scale,
                had_stored_bounds,
                monitors,
            );
            placement.position = result.0;
            adjusted |= result.1;
            selected = result.2;
        }
    }
    (placement, adjusted, selected)
}

#[cfg(any(target_os = "windows", test))]
fn stored_native_is_usable(native: &StoredOverlayNativePosition) -> bool {
    native.x.is_finite()
        && native.y.is_finite()
        && native.logical_echo_x.is_finite()
        && native.logical_echo_y.is_finite()
}

#[cfg(any(target_os = "windows", test))]
fn stored_native_echo_matches(
    stored: &StoredOverlayBounds,
    native: &StoredOverlayNativePosition,
) -> bool {
    native.logical_echo_x.to_bits() == stored.x.to_bits()
        && native.logical_echo_y.to_bits() == stored.y.to_bits()
}

#[cfg(any(target_os = "windows", test))]
fn resolve_windows_overlay_placement(
    stored: Option<&StoredOverlayBounds>,
    bounds_are_logical: bool,
    monitors: &MonitorData,
) -> ResolvedOverlayPlacement {
    let usable = stored.filter(|stored| overlay_bounds_are_usable(&stored.public_bounds()));
    let mut native_reject_reason = NativeRejectReason::Missing;

    let (placement, resize_basis, source, candidate_count, visibility_adjustment, selected) =
        if let Some(stored) = usable {
            if let Some(native) = stored.native_position.as_ref() {
                if !stored_native_is_usable(native) {
                    native_reject_reason = NativeRejectReason::Invalid;
                } else if !stored_native_echo_matches(stored, native) {
                    native_reject_reason = NativeRejectReason::EchoMismatch;
                } else {
                    native_reject_reason = NativeRejectReason::None;
                    let target = monitors
                        .find_by_native_point(native.x, native.y)
                        .or_else(|| monitors.primary_spec());
                    let initial_scale = target
                        .map(|spec| spec.logical_to_native_scale)
                        .unwrap_or(1.0);
                    let resize_basis = NativePlacement {
                        position: OverlayPosition {
                            x: native.x,
                            y: native.y,
                        },
                        width: clamp_overlay_dimension(stored.width),
                        height: clamp_overlay_dimension(stored.height),
                        target_scale: initial_scale,
                    };
                    let result = finalize_native_placement(
                        resize_basis.position,
                        resize_basis.width,
                        resize_basis.height,
                        resize_basis.target_scale,
                        true,
                        monitors,
                    );
                    let selected = result.2.cloned();
                    let resolved = resolved_overlay_placement(
                        result.0,
                        resize_basis,
                        true,
                        OverlayRestoreMetadata {
                            source: OverlayRestoreSource::TrustedNative,
                            native_reject_reason,
                            candidate_count: 0,
                            visibility_adjustment: result.1,
                        },
                        selected.as_ref(),
                        monitors,
                    );
                    return defer_windows_overlay_scale_resolution(resolved, usable);
                }
            }

            if !bounds_are_logical {
                let legacy_rect = NativeRect {
                    x: stored.x,
                    y: stored.y,
                    width: stored.width,
                    height: stored.height,
                };
                let target = monitors
                    .find_best_overlap_native(legacy_rect)
                    .or_else(|| monitors.primary_spec());
                let initial_scale = target
                    .map(|spec| spec.logical_to_native_scale)
                    .unwrap_or(1.0);
                let width = clamp_overlay_dimension(stored.width / initial_scale);
                let height = clamp_overlay_dimension(stored.height / initial_scale);
                let resize_basis = NativePlacement {
                    position: OverlayPosition {
                        x: stored.x,
                        y: stored.y,
                    },
                    width,
                    height,
                    target_scale: initial_scale,
                };
                let result = finalize_native_placement(
                    resize_basis.position,
                    resize_basis.width,
                    resize_basis.height,
                    resize_basis.target_scale,
                    true,
                    monitors,
                );
                (
                    result.0,
                    resize_basis,
                    OverlayRestoreSource::LegacyPhysical,
                    0,
                    result.1,
                    result.2,
                )
            } else {
                let mut candidates: Vec<(&MonitorSpec, NativePlacement)> = monitors
                    .specs
                    .iter()
                    .filter_map(|spec| {
                        let placement = NativePlacement {
                            position: OverlayPosition {
                                x: stored.x * spec.logical_to_native_scale,
                                y: stored.y * spec.logical_to_native_scale,
                            },
                            width: clamp_overlay_dimension(stored.width),
                            height: clamp_overlay_dimension(stored.height),
                            target_scale: spec.logical_to_native_scale,
                        };
                        spec.full_rect_native
                            .contains_point(placement.position.x, placement.position.y)
                            .then_some((spec, placement))
                    })
                    .collect();
                // tao 열거 인덱스는 후보마다 고유
                candidates.sort_by_key(|(spec, _)| spec.enumeration_index);
                let candidate_count = candidates.len();
                let initial = candidates
                    .first()
                    .map(|(_, placement)| *placement)
                    .unwrap_or_else(|| {
                        let scale = monitors
                            .primary_spec()
                            .map(|spec| spec.logical_to_native_scale)
                            .unwrap_or(1.0);
                        NativePlacement {
                            position: OverlayPosition {
                                x: stored.x * scale,
                                y: stored.y * scale,
                            },
                            width: clamp_overlay_dimension(stored.width),
                            height: clamp_overlay_dimension(stored.height),
                            target_scale: scale,
                        }
                    });
                let result = finalize_native_placement(
                    initial.position,
                    initial.width,
                    initial.height,
                    initial.target_scale,
                    true,
                    monitors,
                );
                (
                    result.0,
                    initial,
                    OverlayRestoreSource::InferredLogical,
                    candidate_count,
                    result.1,
                    result.2,
                )
            }
        } else {
            let scale = monitors
                .primary_spec()
                .map(|spec| spec.logical_to_native_scale)
                .unwrap_or(1.0);
            let resize_basis = NativePlacement {
                position: OverlayPosition { x: 0.0, y: 0.0 },
                width: DEFAULT_OVERLAY_WIDTH,
                height: DEFAULT_OVERLAY_HEIGHT,
                target_scale: scale,
            };
            let result = finalize_native_placement(
                resize_basis.position,
                resize_basis.width,
                resize_basis.height,
                resize_basis.target_scale,
                false,
                monitors,
            );
            (
                result.0,
                resize_basis,
                OverlayRestoreSource::Default,
                0,
                result.1,
                result.2,
            )
        };

    let resolved = resolved_overlay_placement(
        placement,
        resize_basis,
        source != OverlayRestoreSource::Default,
        OverlayRestoreMetadata {
            source,
            native_reject_reason,
            candidate_count,
            visibility_adjustment,
        },
        selected,
        monitors,
    );
    defer_windows_overlay_scale_resolution(resolved, usable)
}

#[cfg(any(target_os = "windows", test))]
fn defer_windows_overlay_scale_resolution(
    mut resolved: ResolvedOverlayPlacement,
    stored: Option<&StoredOverlayBounds>,
) -> ResolvedOverlayPlacement {
    if resolved.monitors.is_empty() {
        resolved.pending_scale_resolution = Some(PendingOverlayScaleResolution::Windows {
            stored: stored.map(StoredOverlayBounds::public_bounds),
        });
    }
    resolved
}

fn resolved_overlay_placement(
    placement: NativePlacement,
    resize_basis: NativePlacement,
    had_stored_bounds: bool,
    metadata: OverlayRestoreMetadata,
    selected: Option<&MonitorSpec>,
    monitors: &MonitorData,
) -> ResolvedOverlayPlacement {
    ResolvedOverlayPlacement {
        placement,
        resize_basis,
        had_stored_bounds,
        source: metadata.source,
        native_reject_reason: metadata.native_reject_reason,
        candidate_count: metadata.candidate_count,
        selected_monitor: selected.map(|spec| spec.identity.clone()),
        selected_scale: selected
            .map(|spec| spec.scale_factor)
            .unwrap_or(placement.target_scale),
        visibility_adjustment: metadata.visibility_adjustment,
        monitors: monitors.clone(),
        pending_scale_resolution: None,
    }
}

#[cfg(target_os = "windows")]
fn resolve_overlay_placement(
    stored: Option<&StoredOverlayBounds>,
    bounds_are_logical: bool,
    monitors: &MonitorData,
) -> ResolvedOverlayPlacement {
    resolve_windows_overlay_placement(stored, bounds_are_logical, monitors)
}

#[cfg(not(target_os = "windows"))]
fn resolve_overlay_placement(
    stored: Option<&StoredOverlayBounds>,
    bounds_are_logical: bool,
    monitors: &MonitorData,
) -> ResolvedOverlayPlacement {
    let usable = stored
        .map(StoredOverlayBounds::public_bounds)
        .filter(overlay_bounds_are_usable);
    let normalized = normalize_stored_overlay_bounds(stored, bounds_are_logical, monitors, None);
    let needs_window_scale =
        !bounds_are_logical && monitors.is_empty() && normalized.is_none() && usable.is_some();
    let had_stored_bounds = normalized.is_some() || needs_window_scale;
    let bounds = normalized
        .or_else(|| needs_window_scale.then(|| usable.clone()).flatten())
        .unwrap_or(OverlayBounds {
            x: 0.0,
            y: 0.0,
            width: DEFAULT_OVERLAY_WIDTH,
            height: DEFAULT_OVERLAY_HEIGHT,
        });
    let resize_basis = NativePlacement {
        position: OverlayPosition {
            x: bounds.x,
            y: bounds.y,
        },
        width: clamp_overlay_dimension(bounds.width),
        height: clamp_overlay_dimension(bounds.height),
        target_scale: 1.0,
    };
    let result = finalize_native_placement(
        resize_basis.position,
        resize_basis.width,
        resize_basis.height,
        resize_basis.target_scale,
        had_stored_bounds,
        monitors,
    );
    let source = if !had_stored_bounds {
        OverlayRestoreSource::Default
    } else if bounds_are_logical {
        OverlayRestoreSource::InferredLogical
    } else {
        OverlayRestoreSource::LegacyPhysical
    };
    let mut resolved = resolved_overlay_placement(
        result.0,
        resize_basis,
        had_stored_bounds,
        OverlayRestoreMetadata {
            source,
            native_reject_reason: NativeRejectReason::Unused,
            candidate_count: 0,
            visibility_adjustment: result.1,
        },
        result.2,
        monitors,
    );
    if needs_window_scale {
        resolved.pending_scale_resolution =
            Some(PendingOverlayScaleResolution::NonWindowsLegacyPhysical {
                stored: usable.expect("validated legacy overlay bounds"),
            });
    }
    resolved
}

fn public_overlay_bounds_from_native(rect: NativeRect, native_scale: f64) -> Option<OverlayBounds> {
    if !monitor_scale_is_usable(native_scale)
        || ![rect.x, rect.y, rect.width, rect.height]
            .into_iter()
            .all(f64::is_finite)
        || rect.width <= 0.0
        || rect.height <= 0.0
    {
        return None;
    }
    Some(OverlayBounds {
        x: rect.x / native_scale,
        y: rect.y / native_scale,
        width: rect.width / native_scale,
        height: rect.height / native_scale,
    })
}

fn applied_overlay_frame_from_native(
    rect: NativeRect,
    native_scale: f64,
    include_native_position: bool,
) -> Option<AppliedOverlayFrame> {
    Some(AppliedOverlayFrame {
        public_bounds: public_overlay_bounds_from_native(rect, native_scale)?,
        native_position: include_native_position.then_some(OverlayPosition {
            x: rect.x,
            y: rect.y,
        }),
    })
}

fn overlay_restore_window_scale(window: &WebviewWindow) -> Result<f64> {
    #[cfg(target_os = "windows")]
    let scale = {
        use windows::Win32::UI::HiDpi::GetDpiForWindow;

        let hwnd = window.hwnd()?;
        f64::from(unsafe { GetDpiForWindow(hwnd) }) / 96.0
    };
    #[cfg(not(target_os = "windows"))]
    let scale = window.scale_factor()?;

    monitor_scale_is_usable(scale)
        .then_some(scale)
        .ok_or_else(|| anyhow!("overlay window scale is invalid"))
}

fn applied_overlay_frame_from_window(window: &WebviewWindow) -> Result<AppliedOverlayFrame> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = window.hwnd()?;
        return unsafe { applied_overlay_frame_from_hwnd(hwnd) };
    }
    #[cfg(not(target_os = "windows"))]
    {
        let scale = window.scale_factor()?;
        let position = window.outer_position()?;
        let size = window.outer_size()?;
        applied_overlay_frame_from_native(
            NativeRect {
                x: position.x as f64,
                y: position.y as f64,
                width: size.width as f64,
                height: size.height as f64,
            },
            scale,
            false,
        )
        .ok_or_else(|| anyhow!("overlay frame measurement is invalid"))
    }
}

fn native_placement_from_window(window: &WebviewWindow) -> Result<NativePlacement> {
    let frame = applied_overlay_frame_from_window(window)?;
    #[cfg(target_os = "windows")]
    let scale = window.scale_factor()?;
    #[cfg(target_os = "windows")]
    let position = frame
        .native_position
        .ok_or_else(|| anyhow!("overlay native position is unavailable"))?;
    #[cfg(not(target_os = "windows"))]
    let position = OverlayPosition {
        x: frame.public_bounds.x,
        y: frame.public_bounds.y,
    };
    #[cfg(target_os = "windows")]
    let target_scale = scale;
    #[cfg(not(target_os = "windows"))]
    let target_scale = 1.0;
    Ok(NativePlacement {
        position,
        width: frame.public_bounds.width,
        height: frame.public_bounds.height,
        target_scale,
    })
}

fn applied_overlay_frame_from_placement(placement: NativePlacement) -> AppliedOverlayFrame {
    #[cfg(target_os = "windows")]
    let include_native_position = true;
    #[cfg(not(target_os = "windows"))]
    let include_native_position = false;
    applied_overlay_frame_from_native(
        placement.native_rect(),
        placement.target_scale,
        include_native_position,
    )
    .expect("validated overlay placement")
}

fn persist_overlay_placement_from_window(
    window: &WebviewWindow,
    store: &Arc<AppStore>,
    generation: &Arc<AtomicU64>,
    trust: &Arc<Mutex<OverlayPlacementTrust>>,
    authority: OverlayPersistenceAuthority,
) -> Result<()> {
    let frame = applied_overlay_frame_from_window(window)?;
    persist_overlay_placement(store, generation, trust, frame, None, authority)
}

fn persist_overlay_placement(
    store: &Arc<AppStore>,
    generation: &Arc<AtomicU64>,
    trust: &Arc<Mutex<OverlayPlacementTrust>>,
    frame: AppliedOverlayFrame,
    content_top_offset: Option<f64>,
    authority: OverlayPersistenceAuthority,
) -> Result<()> {
    let mut trust_guard = trust.lock();
    let next_trust = next_overlay_placement_trust(*trust_guard, authority);
    #[cfg(target_os = "windows")]
    let include_native_position = true;
    #[cfg(not(target_os = "windows"))]
    let include_native_position = false;
    let stored = stored_overlay_bounds_for_persistence(&frame, next_trust, include_native_position);

    store.update_deferred(move |state| {
        state.overlay_bounds = Some(stored);
        state.overlay_bounds_are_logical = true;
        if let Some(offset) = content_top_offset {
            state.overlay_last_content_top_offset = Some(offset);
        }
    })?;
    *trust_guard = next_trust;
    drop(trust_guard);
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

fn stored_overlay_bounds_for_persistence(
    frame: &AppliedOverlayFrame,
    trust: OverlayPlacementTrust,
    include_native_position: bool,
) -> StoredOverlayBounds {
    let public = &frame.public_bounds;
    let native_position = if include_native_position && trust == OverlayPlacementTrust::Clean {
        frame
            .native_position
            .map(|position| StoredOverlayNativePosition {
                x: position.x,
                y: position.y,
                logical_echo_x: public.x,
                logical_echo_y: public.y,
            })
    } else {
        None
    };
    StoredOverlayBounds {
        x: public.x,
        y: public.y,
        width: public.width,
        height: public.height,
        native_position,
    }
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

#[derive(Clone, Copy, Debug, PartialEq)]
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
            mpsc, Arc,
        },
        thread,
        time::{Duration, Instant},
    };

    #[cfg(not(target_os = "windows"))]
    use super::normalize_stored_overlay_bounds;
    use super::{
        acknowledge_editor_flush_handshake, acknowledge_panel_close_request,
        applied_overlay_frame_from_native, apply_panel_bounds_change, begin_panel_close_request,
        bootstrap_keyboard_state, canonical_hold_duration_ms, changed_panel_max_height,
        clamp_overlay_dimension, collect_authorized_css_paths, collect_frontend_lifecycle_targets,
        complete_overlay_scale_resolution, drop_panel_hidden_with_main,
        frontend_history_mutation_blocked, frontend_lifecycle_restore_labels,
        global_css_watch_path, hide_panel_with_main_transition, install_history_handshake,
        install_lifecycle_handshake, is_panel_open_url, key_state_payload,
        main_window_starts_hidden, monitor_scale_is_usable, next_keyboard_recovery_plan,
        next_overlay_placement_trust, overlay_close_action, overlay_reset_fallback_rect,
        panel_bounds_from_sample, panel_height_bounds, panel_position_beside_main,
        publish_panel_hidden_transition, publish_panel_visibility_transition, resolve_event_age_ms,
        resolve_overlay_placement, resolve_panel_window_layout, resolve_windows_overlay_placement,
        restore_panel_with_main_transition, run_panel_close_timeout,
        should_create_overlay_on_startup, should_recover_keyboard_daemon,
        should_restore_panel_on_startup, stored_overlay_bounds_for_persistence,
        take_cancelable_editor_flush_handshake, take_editor_flush_handshake, take_panel_open_arm,
        AppState, EditorFlushAcknowledge, EditorFlushCompletion, EditorFlushHandshake,
        EditorFlushRequest, FrontendFlushAction, FrontendHistoryFlushPhase,
        FrontendHistoryFlushReady, FrontendLifecycleAction, KeyCounterEventEmitter,
        LifecycleHandshakeInstall, MonitorData, MonitorSpec, MutationPublicationSequencer, Mutex,
        NativeRect, NativeRejectReason, OverlayCloseAction, OverlayPersistenceAuthority,
        OverlayPlacementTrust, OverlayRestoreSource, PanelBoundsChange,
        PanelBoundsPersistenceController, PanelBoundsPersistenceState, PanelBoundsSample,
        PanelCloseRequestState, PanelCloseRequestedPayload, PanelPresentSnapshot,
        PanelVisibilityEventEmitter, PanelVisibilityPayload, PanelVisibilityReason,
        PhysicalPosition, PhysicalSize, DEFAULT_OVERLAY_HEIGHT, DEFAULT_OVERLAY_WIDTH,
        HISTORY_FRONTEND_FLUSH_INTERRUPTED, KEYBOARD_DAEMON_STABLE_RUNTIME,
        KEYBOARD_RECOVERY_DELAYS_MS, OVERLAY_LABEL, PANEL_BESIDE_GAP, PANEL_INITIAL_HEIGHT,
        PANEL_LABEL, PANEL_MIN_HEIGHT, PANEL_OPEN_ARM_TIMEOUT, PANEL_WIDTH,
    };
    use crate::{
        keyboard::KeyboardManager,
        models::{
            AppStoreData, CustomCss, CustomTab, EditorCommitOrigin, EditorCommitRequest,
            EditorField, EditorFrozenKeySlotV1, EditorOpV1, GestureCommitRequest,
            GesturePluginInstancesChange, KeyCounters, KeySlot, OverlayBounds, PanelBounds,
            PluginPoint, SavedPluginInstance, StoredOverlayBounds, StoredOverlayNativePosition,
            TabCss, EDITOR_OPS_VERSION,
        },
        state::{
            history::{HistoryAdmissionGate, HistoryDirection, HistoryScope},
            local_asset_path::path_identity_key,
            store::{
                AppStore, AuxEditorResetTransactionOptions, AuxEditorTransactionOptions,
                PluginInstancesResetScope,
            },
        },
    };
    use std::path::Path;

    struct NoopCounterEmitter;

    impl KeyCounterEventEmitter for NoopCounterEmitter {
        fn emit_key_counters(
            &self,
            _counters: &KeyCounters,
            _session_id: &str,
            _revision: u64,
        ) -> anyhow::Result<()> {
            Ok(())
        }

        fn emit_key_counter(
            &self,
            _mode: &str,
            _key: &str,
            _count: u32,
            _session_id: &str,
            _revision: u64,
        ) -> anyhow::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn preset_mapping_commit_drops_queued_increment_for_replaced_key() {
        let directory = tempfile::tempdir().unwrap();
        let store = AppStore::initialize_for_test(directory.path()).unwrap();
        store
            .update(|data| data.key_counter_enabled = true)
            .unwrap();
        let state = Arc::new(AppState::initialize(store).unwrap());
        let emitter = NoopCounterEmitter;
        let mode = state.store.snapshot().selected_key_type;
        let replaced_key = state.store.snapshot().keys[&mode][0].canonical();
        let preserved_key = state.store.snapshot().keys[&mode][1].canonical();
        for expected in 1..=7 {
            assert_eq!(
                state.increment_key_counter_and_emit(&emitter, &mode, &preserved_key),
                Some(expected)
            );
        }
        assert_eq!(
            state.store.snapshot().key_counters[&mode][&preserved_key],
            0
        );
        let replacement_key = "QA PRESET REPLACEMENT";
        let commit_state = Arc::clone(&state);
        let commit_mode = mode.clone();
        let (barrier_ready_tx, barrier_ready_rx) = mpsc::channel();
        let (release_commit_tx, release_commit_rx) = mpsc::channel();
        let commit = thread::spawn(move || {
            let admission = commit_state.store.admit_editor_mutation().unwrap();
            commit_state.commit_preset_editor_transaction_preserving_runtime_counters(
                &NoopCounterEmitter,
                EditorCommitOrigin::LegacyAdapter("preset_load".to_string()),
                &[EditorField::Keys, EditorField::KeyPositions],
                admission,
                |data| {
                    barrier_ready_tx.send(()).unwrap();
                    release_commit_rx
                        .recv_timeout(Duration::from_secs(3))
                        .unwrap();
                    data.keys.get_mut(&commit_mode).unwrap()[0] = KeySlot::from(replacement_key);
                    Ok(())
                },
            )
        });
        barrier_ready_rx
            .recv_timeout(Duration::from_secs(3))
            .unwrap();
        assert_eq!(
            state.increment_key_counter_and_emit(&emitter, &mode, &replaced_key),
            None
        );
        release_commit_tx.send(()).unwrap();
        let (transaction, runtime_applied) = commit.join().unwrap().unwrap();

        assert!(runtime_applied);
        assert!(transaction
            .change
            .result
            .changed_fields
            .contains(&EditorField::Keys));
        assert!(!state.snapshot_key_counters()[&mode].contains_key(&replaced_key));
        assert_eq!(state.snapshot_key_counters()[&mode][replacement_key], 0);
        assert_eq!(state.snapshot_key_counters()[&mode][&preserved_key], 7);
        assert!(!state.store.snapshot().key_counters[&mode].contains_key(&replaced_key));
        assert_eq!(
            state.store.snapshot().key_counters[&mode][&preserved_key],
            7
        );
        state.shutdown();
        drop(state);
        let reloaded = AppStore::initialize_for_test(directory.path()).unwrap();
        assert!(!reloaded.snapshot().key_counters[&mode].contains_key(&replaced_key));
        assert_eq!(reloaded.snapshot().key_counters[&mode][&preserved_key], 7);
        reloaded.flush_and_shutdown().unwrap();
    }

    #[test]
    fn startup_overlay_creation_covers_all_visibility_and_obs_combinations() {
        assert!(!should_create_overlay_on_startup(false, false));
        assert!(should_create_overlay_on_startup(false, true));
        assert!(!should_create_overlay_on_startup(true, false));
        assert!(!should_create_overlay_on_startup(true, true));
    }

    #[test]
    fn key_mapping_commit_preserves_unflushed_runtime_counters() {
        let directory = std::env::temp_dir().join(format!(
            "dmnote-editor-live-counter-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let state =
            AppState::initialize(AppStore::initialize_for_test(&directory).unwrap()).unwrap();
        state.key_counter_enabled.store(true, Ordering::SeqCst);
        let emitter = NoopCounterEmitter;
        let editor = state.store.editor_get();
        let mode = state.store.snapshot().selected_key_type;
        let preserved_key = editor.document.keys[&mode][0].canonical();

        for expected in 1..=7 {
            assert_eq!(
                state.increment_key_counter_and_emit(&emitter, &mode, &preserved_key),
                Some(expected)
            );
        }
        assert_eq!(
            state.store.snapshot().key_counters[&mode][&preserved_key],
            0
        );

        let replaced_key = editor.document.keys[&mode][1].canonical();
        let replaced_id = editor.document.key_positions[&mode][1].id.clone();
        let request = EditorCommitRequest {
            base_revision: editor.revision,
            mutation_id: uuid::Uuid::new_v4().to_string(),
            multi_key: false,
            gesture_id: None,
            gesture_ids: Vec::new(),
            changes: None,
            ops_version: Some(EDITOR_OPS_VERSION),
            ops: Some(vec![EditorOpV1::SetKeySlot {
                id: replaced_id,
                slot: EditorFrozenKeySlotV1::Single("QA NEW KEY".to_string()),
            }]),
        };
        let admission = state.store.admit_editor_mutation().unwrap();
        let (change, runtime_applied) = state
            .commit_editor_document_preserving_runtime_counters(&emitter, request, &admission)
            .unwrap();
        drop(admission);

        assert!(runtime_applied);
        assert_eq!(change.key_counters[&mode][&preserved_key], 7);
        assert_eq!(state.snapshot_key_counters()[&mode][&preserved_key], 7);
        let persisted = state.store.snapshot().key_counters;
        assert_eq!(persisted[&mode][&preserved_key], 7);
        assert_eq!(persisted[&mode]["QA NEW KEY"], 0);
        assert!(!persisted[&mode].contains_key(&replaced_key));

        state.shutdown();
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn history_mapping_change_restores_historical_counter_domain() {
        let directory = tempfile::tempdir().unwrap();
        let store = AppStore::initialize_for_test(directory.path()).unwrap();
        store
            .update(|data| data.key_counter_enabled = true)
            .unwrap();
        let state = AppState::initialize(store).unwrap();
        let emitter = NoopCounterEmitter;
        let editor = state.store.editor_get();
        let mode = state.store.snapshot().selected_key_type;
        let restored_key = editor.document.keys[&mode][0].canonical();
        let replaced_id = editor.document.key_positions[&mode][0].id.clone();
        let replacement_key = "QA HISTORY REPLACEMENT";
        for expected in 1..=12 {
            assert_eq!(
                state.increment_key_counter_and_emit(&emitter, &mode, &restored_key),
                Some(expected)
            );
        }
        assert!(!state.store.history_status().can_undo);
        let request = EditorCommitRequest {
            base_revision: editor.revision,
            mutation_id: uuid::Uuid::new_v4().to_string(),
            multi_key: false,
            gesture_id: None,
            gesture_ids: Vec::new(),
            changes: None,
            ops_version: Some(EDITOR_OPS_VERSION),
            ops: Some(vec![EditorOpV1::SetKeySlot {
                id: replaced_id,
                slot: EditorFrozenKeySlotV1::Single(replacement_key.to_string()),
            }]),
        };
        let admission = state.store.admit_editor_mutation().unwrap();
        let (committed, runtime_applied) = state
            .commit_editor_document_preserving_runtime_counters(&emitter, request, &admission)
            .unwrap();
        drop(admission);
        assert!(runtime_applied);
        assert!(!committed.key_counters[&mode].contains_key(&restored_key));
        assert_eq!(committed.key_counters[&mode][replacement_key], 0);

        let operation_id = uuid::Uuid::new_v4().to_string();
        let gate = state.store.history_gate();
        let history_barrier = gate.close(&operation_id).unwrap();
        state.begin_counter_history_barrier();
        let mut counter_guard = state.lock_key_counters_for_history();
        assert_eq!(
            state.increment_key_counter_and_emit(&emitter, &mode, replacement_key),
            None
        );
        let current_counters = counter_guard.clone();
        let undo = state
            .store
            .apply_history_operation(
                HistoryDirection::Undo,
                &operation_id,
                &current_counters,
                || {},
            )
            .unwrap();
        let change = undo.change.as_ref().unwrap();
        assert!(state.apply_history_editor_key_runtime_locked(&mut counter_guard, change));
        assert_eq!(
            state.increment_key_counter_and_emit(&emitter, &mode, &restored_key),
            None
        );
        state.finish_counter_history_barrier(
            &emitter,
            counter_guard,
            true,
            undo.runtime_publication_generation,
        );
        drop(history_barrier);

        let runtime = state.snapshot_key_counters();
        assert_eq!(runtime[&mode][&restored_key], 13);
        assert!(!runtime[&mode].contains_key(replacement_key));
        let persisted = state.store.snapshot().key_counters;
        assert_eq!(persisted[&mode][&restored_key], 12);
        assert!(!persisted[&mode].contains_key(replacement_key));

        state.shutdown();
        drop(state);
        let reloaded = AppStore::initialize_for_test(directory.path()).unwrap();
        assert_eq!(reloaded.snapshot().key_counters[&mode][&restored_key], 13);
        assert!(!reloaded.snapshot().key_counters[&mode].contains_key(replacement_key));
        reloaded.flush_and_shutdown().unwrap();
    }

    #[test]
    fn custom_tab_create_preserves_unflushed_runtime_counters() {
        let directory = std::env::temp_dir().join(format!(
            "dmnote-custom-tab-live-counter-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let state =
            AppState::initialize(AppStore::initialize_for_test(&directory).unwrap()).unwrap();
        state.key_counter_enabled.store(true, Ordering::SeqCst);
        let emitter = NoopCounterEmitter;
        let snapshot = state.store.snapshot();
        let mode = snapshot.selected_key_type;
        let preserved_key = snapshot.keys[&mode][0].canonical();

        for expected in 1..=7 {
            assert_eq!(
                state.increment_key_counter_and_emit(&emitter, &mode, &preserved_key),
                Some(expected)
            );
        }
        assert_eq!(
            state.store.snapshot().key_counters[&mode][&preserved_key],
            0
        );

        let tab_id = "qa-counter-tab".to_string();
        let admission = state.store.admit_editor_mutation().unwrap();
        let (transaction, runtime_applied) = state
            .commit_editor_transaction_preserving_runtime_counters(&emitter, |runtime_counters| {
                state
                    .store
                    .commit_aux_editor_transaction_with_runtime_counters_admission(
                        AuxEditorTransactionOptions {
                            scope: HistoryScope::CustomTabs,
                            observed_history_epoch: None,
                            origin: EditorCommitOrigin::LegacyAdapter(
                                "custom_tabs_create".to_string(),
                            ),
                            touched_fields: &[EditorField::Keys, EditorField::KeyPositions],
                        },
                        admission,
                        runtime_counters,
                        |store| {
                            store.custom_tabs.push(CustomTab {
                                id: tab_id.clone(),
                                name: "QA Counter Tab".to_string(),
                            });
                            store.keys.insert(tab_id.clone(), Vec::new());
                            store.key_positions.insert(tab_id.clone(), Vec::new());
                            store.selected_key_type = tab_id.clone();
                            Ok(())
                        },
                    )
            })
            .unwrap();

        assert!(runtime_applied);
        assert_eq!(state.snapshot_key_counters()[&mode][&preserved_key], 7);
        assert_eq!(
            state.store.snapshot().key_counters[&mode][&preserved_key],
            7
        );
        assert!(transaction.change.document.keys.contains_key(&tab_id));
        drop(transaction);

        assert_eq!(
            state.increment_key_counter_and_emit(&emitter, &mode, &preserved_key),
            Some(8)
        );

        let operation_id = uuid::Uuid::new_v4().to_string();
        let gate = state.store.history_gate();
        let barrier = gate.close(&operation_id).unwrap();
        state.begin_counter_history_barrier();
        let mut counter_guard = state.lock_key_counters_for_history();
        let current_counters = counter_guard.clone();
        let undo = state
            .store
            .apply_history_operation(
                HistoryDirection::Undo,
                &operation_id,
                &current_counters,
                || {},
            )
            .unwrap();
        assert!(state.apply_history_editor_key_runtime_locked(
            &mut counter_guard,
            undo.change.as_ref().unwrap(),
        ));
        state.finish_counter_history_barrier(
            &emitter,
            counter_guard,
            true,
            undo.runtime_publication_generation,
        );
        drop(barrier);
        assert_eq!(
            state.store.snapshot().key_counters[&mode][&preserved_key],
            8
        );
        assert_eq!(state.snapshot_key_counters()[&mode][&preserved_key], 8);

        state.shutdown();
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn custom_tab_delete_preserves_unflushed_runtime_counters() {
        let directory = std::env::temp_dir().join(format!(
            "dmnote-custom-tab-delete-live-counter-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let state =
            AppState::initialize(AppStore::initialize_for_test(&directory).unwrap()).unwrap();
        state.key_counter_enabled.store(true, Ordering::SeqCst);
        let emitter = NoopCounterEmitter;
        let snapshot = state.store.snapshot();
        let mode = snapshot.selected_key_type;
        let preserved_key = snapshot.keys[&mode][0].canonical();
        let tab_id = "qa-counter-delete-tab".to_string();
        let create = state
            .store
            .commit_aux_editor_transaction(
                HistoryScope::CustomTabs,
                None,
                EditorCommitOrigin::LegacyAdapter("custom_tabs_create".to_string()),
                &[EditorField::Keys, EditorField::KeyPositions],
                |store| {
                    store.custom_tabs.push(CustomTab {
                        id: tab_id.clone(),
                        name: "QA Counter Delete Tab".to_string(),
                    });
                    store.keys.insert(tab_id.clone(), Vec::new());
                    store.key_positions.insert(tab_id.clone(), Vec::new());
                    store.selected_key_type = tab_id.clone();
                    Ok(())
                },
            )
            .unwrap();
        drop(create);

        for expected in 1..=7 {
            assert_eq!(
                state.increment_key_counter_and_emit(&emitter, &mode, &preserved_key),
                Some(expected)
            );
        }
        assert_eq!(
            state.store.snapshot().key_counters[&mode][&preserved_key],
            0
        );

        let admission = state.store.admit_editor_mutation().unwrap();
        let (transaction, runtime_applied) = state
            .commit_editor_transaction_preserving_runtime_counters(&emitter, |runtime_counters| {
                state
                    .store
                    .commit_aux_editor_reset_transaction_with_runtime_counters_admission(
                        AuxEditorResetTransactionOptions {
                            scope: HistoryScope::CustomTabs,
                            observed_history_epoch: None,
                            origin: EditorCommitOrigin::LegacyAdapter(
                                "custom_tabs_delete".to_string(),
                            ),
                            touched_fields: &[
                                EditorField::Keys,
                                EditorField::KeyPositions,
                                EditorField::StatPositions,
                                EditorField::GraphPositions,
                                EditorField::KnobPositions,
                                EditorField::LayerGroups,
                            ],
                            plugin_instances_reset: PluginInstancesResetScope::Mode(tab_id.clone()),
                        },
                        admission,
                        runtime_counters,
                        |store| {
                            store.custom_tabs.retain(|tab| tab.id != tab_id);
                            store.keys.remove(&tab_id);
                            store.key_positions.remove(&tab_id);
                            store.stat_positions.remove(&tab_id);
                            store.graph_positions.remove(&tab_id);
                            store.knob_positions.remove(&tab_id);
                            store.layer_groups.remove(&tab_id);
                            store.key_counters.remove(&tab_id);
                            store.selected_key_type = mode.clone();
                            Ok(())
                        },
                    )
            })
            .unwrap();

        assert!(runtime_applied);
        assert_eq!(state.snapshot_key_counters()[&mode][&preserved_key], 7);
        assert_eq!(
            state.store.snapshot().key_counters[&mode][&preserved_key],
            7
        );
        assert!(!transaction.change.document.keys.contains_key(&tab_id));
        drop(transaction);

        let operation_id = uuid::Uuid::new_v4().to_string();
        let gate = state.store.history_gate();
        let barrier = gate.close(&operation_id).unwrap();
        state
            .store
            .apply_history_operation(
                HistoryDirection::Undo,
                &operation_id,
                &state.snapshot_key_counters(),
                || {},
            )
            .unwrap();
        drop(barrier);
        assert_eq!(
            state.store.snapshot().key_counters[&mode][&preserved_key],
            7
        );

        state.shutdown();
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn custom_tab_restore_history_preserves_unflushed_runtime_counters() {
        let directory = std::env::temp_dir().join(format!(
            "dmnote-custom-tab-restore-live-counter-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let state =
            AppState::initialize(AppStore::initialize_for_test(&directory).unwrap()).unwrap();
        state.key_counter_enabled.store(true, Ordering::SeqCst);
        let emitter = NoopCounterEmitter;
        let snapshot = state.store.snapshot();
        let mode = snapshot.selected_key_type;
        let preserved_key = snapshot.keys[&mode][0].canonical();
        let tab_id = "qa-counter-restore-tab".to_string();
        let create = state
            .store
            .commit_aux_editor_transaction(
                HistoryScope::CustomTabs,
                None,
                EditorCommitOrigin::LegacyAdapter("custom_tabs_create".to_string()),
                &[EditorField::Keys, EditorField::KeyPositions],
                |store| {
                    store.custom_tabs.push(CustomTab {
                        id: tab_id.clone(),
                        name: "Before Restore".to_string(),
                    });
                    store.keys.insert(tab_id.clone(), Vec::new());
                    store.key_positions.insert(tab_id.clone(), Vec::new());
                    Ok(())
                },
            )
            .unwrap();
        drop(create);

        for expected in 1..=7 {
            assert_eq!(
                state.increment_key_counter_and_emit(&emitter, &mode, &preserved_key),
                Some(expected)
            );
        }
        let mut restored_tabs = state.store.snapshot().custom_tabs;
        restored_tabs[0].name = "After Restore".to_string();
        let admission = state.store.admit_editor_mutation().unwrap();
        let (transaction, runtime_applied) = state
            .commit_editor_transaction_preserving_runtime_counters(&emitter, |runtime_counters| {
                state
                    .store
                    .commit_aux_editor_transaction_with_runtime_counters_admission(
                        AuxEditorTransactionOptions {
                            scope: HistoryScope::CustomTabs,
                            observed_history_epoch: None,
                            origin: EditorCommitOrigin::LegacyAdapter(
                                "custom_tabs_restore".to_string(),
                            ),
                            touched_fields: &[],
                        },
                        admission,
                        runtime_counters,
                        |store| {
                            store.custom_tabs = restored_tabs;
                            Ok(())
                        },
                    )
            })
            .unwrap();

        assert!(!runtime_applied);
        assert_eq!(
            state.store.snapshot().key_counters[&mode][&preserved_key],
            7
        );
        assert_eq!(state.store.snapshot().custom_tabs[0].name, "After Restore");
        drop(transaction);

        assert_eq!(
            state.increment_key_counter_and_emit(&emitter, &mode, &preserved_key),
            Some(8)
        );

        let operation_id = uuid::Uuid::new_v4().to_string();
        let gate = state.store.history_gate();
        let barrier = gate.close(&operation_id).unwrap();
        state
            .store
            .apply_history_operation(
                HistoryDirection::Undo,
                &operation_id,
                &state.snapshot_key_counters(),
                || {},
            )
            .unwrap();
        drop(barrier);
        assert_eq!(
            state.store.snapshot().key_counters[&mode][&preserved_key],
            8
        );
        assert_eq!(state.snapshot_key_counters()[&mode][&preserved_key], 8);
        assert_eq!(state.store.snapshot().custom_tabs[0].name, "Before Restore");

        state.shutdown();
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn mixed_gesture_history_preserves_live_and_restores_historical_counters() {
        let directory = std::env::temp_dir().join(format!(
            "dmnote-gesture-live-counter-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let state =
            AppState::initialize(AppStore::initialize_for_test(&directory).unwrap()).unwrap();
        state.key_counter_enabled.store(true, Ordering::SeqCst);
        let emitter = NoopCounterEmitter;
        let editor = state.store.editor_get();
        let mode = state.store.snapshot().selected_key_type;
        let preserved_key = editor.document.keys[&mode][0].canonical();
        let replaced_key = editor.document.keys[&mode][1].canonical();

        for expected in 1..=7 {
            assert_eq!(
                state.increment_key_counter_and_emit(&emitter, &mode, &preserved_key),
                Some(expected)
            );
        }
        for expected in 1..=12 {
            assert_eq!(
                state.increment_key_counter_and_emit(&emitter, &mode, &replaced_key),
                Some(expected)
            );
        }
        assert_eq!(
            state.store.snapshot().key_counters[&mode][&preserved_key],
            0
        );

        let replaced_id = editor.document.key_positions[&mode][1].id.clone();
        let plugin_id = "qa-mixed-counter";
        let plugin_instance_id = uuid::Uuid::new_v4().to_string();
        let request = GestureCommitRequest {
            gesture_id: uuid::Uuid::new_v4().to_string(),
            mutation_id: uuid::Uuid::new_v4().to_string(),
            editor_base_revision: editor.revision,
            plugin_base_revision: state.store.plugin_model_revision(),
            observed_history_epoch: Some(state.store.history_status().history_epoch),
            authority_generation: 1,
            editor_changes: None,
            editor_ops_version: Some(EDITOR_OPS_VERSION),
            editor_ops: Some(vec![EditorOpV1::SetKeySlot {
                id: replaced_id,
                slot: EditorFrozenKeySlotV1::Single("QA MIXED KEY".to_string()),
            }]),
            plugin_changes: vec![GesturePluginInstancesChange {
                plugin_id: plugin_id.to_string(),
                instances: vec![SavedPluginInstance {
                    instance_id: Some(plugin_instance_id.clone()),
                    position: PluginPoint { x: 20.0, y: 30.0 },
                    settings: None,
                    measured_size: None,
                    tab_id: None,
                    hidden: false,
                    z_index: None,
                    group_id: None,
                }],
            }],
        };
        let admission = state.store.admit_editor_mutation().unwrap();
        let (committed, runtime_applied) = state
            .commit_gesture_preserving_runtime_counters(&emitter, request, admission)
            .unwrap();

        assert!(runtime_applied);
        assert_eq!(committed.outcome.changed_plugin_ids, [plugin_id]);
        let change = committed.outcome.change.as_ref().unwrap();
        assert_eq!(change.key_counters[&mode][&preserved_key], 7);
        assert_eq!(state.snapshot_key_counters()[&mode][&preserved_key], 7);
        let persisted = state.store.snapshot().key_counters;
        assert_eq!(persisted[&mode][&preserved_key], 7);
        assert_eq!(persisted[&mode]["QA MIXED KEY"], 0);
        assert!(!persisted[&mode].contains_key(&replaced_key));
        let (instances, revision) = state.store.plugin_instances_get(plugin_id).unwrap();
        assert_eq!(revision, 1);
        assert_eq!(instances.len(), 1);
        assert_eq!(
            instances[0].instance_id.as_deref(),
            Some(plugin_instance_id.as_str())
        );
        drop(committed);

        for expected in 1..=9 {
            assert_eq!(
                state.increment_key_counter_and_emit(&emitter, &mode, "QA MIXED KEY"),
                Some(expected)
            );
        }
        assert_eq!(
            state.increment_key_counter_and_emit(&emitter, &mode, &preserved_key),
            Some(8)
        );

        let operation_id = uuid::Uuid::new_v4().to_string();
        let gate = state.store.history_gate();
        let history_barrier = gate.close(&operation_id).unwrap();
        state.begin_counter_history_barrier();
        let mut counter_guard = state.lock_key_counters_for_history();
        let current_counters = counter_guard.clone();
        let undo = state
            .store
            .apply_history_operation(
                HistoryDirection::Undo,
                &operation_id,
                &current_counters,
                || {},
            )
            .unwrap();
        assert!(state.apply_history_editor_key_runtime_locked(
            &mut counter_guard,
            undo.change.as_ref().unwrap(),
        ));
        state.finish_counter_history_barrier(
            &emitter,
            counter_guard,
            true,
            undo.runtime_publication_generation,
        );
        drop(history_barrier);

        let restored = state.snapshot_key_counters();
        assert_eq!(restored[&mode][&replaced_key], 12);
        assert_eq!(restored[&mode][&preserved_key], 8);
        assert!(!restored[&mode].contains_key("QA MIXED KEY"));
        assert!(state
            .store
            .plugin_instances_get(plugin_id)
            .unwrap()
            .0
            .is_empty());

        state.shutdown();
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn committed_key_positions_refresh_key_sound_binding_cache() {
        let directory = std::env::temp_dir().join(format!(
            "dmnote-key-sound-binding-cache-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let state =
            AppState::initialize(AppStore::initialize_for_test(&directory).unwrap()).unwrap();
        let initial = state.store.snapshot();
        let mode = initial.selected_key_type.clone();
        let sound_path = format!("/tmp/key-sound-{}.wav", uuid::Uuid::new_v4());
        let committed_path = sound_path.clone();
        let transaction = state
            .store
            .commit_legacy_editor_transaction(
                EditorCommitOrigin::LegacyAdapter("key_sound_binding_cache_test".to_string()),
                &[EditorField::KeyPositions],
                move |store| {
                    let position = store
                        .key_positions
                        .get_mut(&mode)
                        .unwrap()
                        .first_mut()
                        .unwrap();
                    position.sound_enabled = Some(true);
                    position.sound_path = Some(format!("  {committed_path}  "));
                    position.sound_volume = Some(150.0);
                    Ok(())
                },
            )
            .unwrap();

        assert_ne!(
            state.resolve_key_sound_binding(&initial.selected_key_type, &[0]),
            Some((sound_path.clone(), 1.5))
        );
        assert!(state.publish_committed_key_sound_bindings(&transaction.change));
        assert_eq!(
            state.resolve_key_sound_binding(&initial.selected_key_type, &[0]),
            Some((sound_path, 1.5))
        );

        drop(transaction);
        state.shutdown();
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }

    // 장치 전환 대기는 번호표 밖 - 앞 번호표가 잡혀 있어도 엔진은 먼저 전환되고
    // persist만 turn을 기다린다 (turn 안에서 기다리면 뒤 번호표 전부가 드라이버를 기다림)
    #[test]
    fn output_backend_switch_runs_before_publication_turn() {
        let directory = std::env::temp_dir().join(format!(
            "dmnote-output-backend-turn-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let state = Arc::new(
            AppState::initialize(AppStore::initialize_for_test(&directory).unwrap()).unwrap(),
        );
        let blocking_ticket = state.issue_mutation_publication().unwrap();

        let (done_tx, done_rx) = mpsc::channel();
        let worker_state = Arc::clone(&state);
        let worker = thread::spawn(move || {
            let result = worker_state
                .key_sound_set_output_backend(crate::audio::KeySoundOutputBackend::DefaultDevice);
            done_tx.send(result.is_ok()).unwrap();
        });

        // 앞 번호표가 살아 있는 동안 persist는 turn을 기다린다
        assert!(done_rx.recv_timeout(Duration::from_millis(500)).is_err());
        assert!(state.store.snapshot().key_sound_output_backend.is_none());

        drop(blocking_ticket);
        assert!(done_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("앞 번호표가 풀리면 persist가 완료된다"));
        worker.join().unwrap();
        assert!(state.store.snapshot().key_sound_output_backend.is_some());

        state.shutdown();
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn mutation_publication_preserves_ticket_order_when_first_worker_is_delayed() {
        let publication = Arc::new(MutationPublicationSequencer::default());
        let first = publication.issue().unwrap();
        let second = publication.issue().unwrap();
        let order = Arc::new(Mutex::new(Vec::new()));
        let (second_waiting_tx, second_waiting_rx) = mpsc::channel();
        let (second_done_tx, second_done_rx) = mpsc::channel();
        let second_order = Arc::clone(&order);
        let second_worker = thread::spawn(move || {
            second_waiting_tx.send(()).unwrap();
            second.run(|| second_order.lock().push(2));
            second_done_tx.send(()).unwrap();
        });
        second_waiting_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
        assert!(matches!(
            second_done_rx.recv_timeout(Duration::from_millis(50)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));

        let first_order = Arc::clone(&order);
        let first_worker = thread::spawn(move || first.run(|| first_order.lock().push(1)));
        first_worker.join().unwrap();
        second_done_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        second_worker.join().unwrap();
        assert_eq!(*order.lock(), vec![1, 2]);
    }

    // 커밋 커맨드 구조 재현: 뒤 번호표가 먼저 admit한 뒤 turn을 기다리고, 앞 번호표가
    // 그 다음 admit → turn. lease가 잠금이면 앞 번호표가 admit에서 막혀 영구 교착
    #[test]
    fn plugin_authority_admission_does_not_block_earlier_publication_turn() {
        use crate::state::plugin::PluginRuntimeAuthority;

        let publication = Arc::new(MutationPublicationSequencer::default());
        let authority = Arc::new(PluginRuntimeAuthority::default());
        authority.reset().unwrap();
        let first = publication.issue().unwrap();
        let second = publication.issue().unwrap();
        let order = Arc::new(Mutex::new(Vec::new()));

        let (second_admitted_tx, second_admitted_rx) = mpsc::channel();
        let second_authority = Arc::clone(&authority);
        let second_order = Arc::clone(&order);
        let second_worker = thread::spawn(move || {
            let lease = second_authority.admit(1).unwrap();
            second_admitted_tx.send(()).unwrap();
            second.run(|| {
                second_authority.revalidate(lease).unwrap();
                second_order.lock().push(2);
            });
        });
        second_admitted_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();

        let first_authority = Arc::clone(&authority);
        let first_order = Arc::clone(&order);
        let first_worker = thread::spawn(move || {
            let lease = first_authority.admit(1).unwrap();
            first.run(|| {
                first_authority.revalidate(lease).unwrap();
                first_order.lock().push(1);
            });
        });

        let (done_tx, done_rx) = mpsc::channel();
        thread::spawn(move || {
            first_worker.join().unwrap();
            second_worker.join().unwrap();
            done_tx.send(()).unwrap();
        });
        done_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("admit이 잠금을 들지 않아야 번호표 순서대로 진행된다");
        assert_eq!(*order.lock(), vec![1, 2]);
    }

    // 번호표 FIFO가 reset과 커밋을 직렬화한다 - reset 뒤 turn의 revalidate는 거절
    #[test]
    fn plugin_authority_revalidate_rejects_commit_admitted_before_reset() {
        use crate::state::plugin::PluginRuntimeAuthority;

        let publication = Arc::new(MutationPublicationSequencer::default());
        let authority = PluginRuntimeAuthority::default();
        authority.reset().unwrap();
        let lease = authority.admit(1).unwrap();

        let reset_ticket = publication.issue().unwrap();
        let commit_ticket = publication.issue().unwrap();
        reset_ticket.run(|| authority.reset().unwrap());
        let rejected = commit_ticket.run(|| authority.revalidate(lease));
        assert_eq!(
            rejected.unwrap_err(),
            "AUTHORITY_GENERATION_CHANGED".to_string()
        );
    }

    #[test]
    fn mutation_publication_advances_after_unrun_ticket_is_dropped() {
        let publication = Arc::new(MutationPublicationSequencer::default());
        let first = publication.issue().unwrap();
        let second = publication.issue().unwrap();

        drop(first);

        assert_eq!(publication.state.lock().serving_ticket, 1);
        let mut ran = false;
        second.run(|| ran = true);
        assert!(ran);
    }

    #[test]
    fn mutation_publication_advances_after_panicking_turn() {
        let publication = Arc::new(MutationPublicationSequencer::default());
        let first = publication.issue().unwrap();
        let second = publication.issue().unwrap();
        let order = Arc::new(Mutex::new(Vec::new()));
        let first_order = Arc::clone(&order);
        let first_worker = thread::spawn(move || {
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                first.run(|| {
                    first_order.lock().push(1);
                    panic!("publication panic test");
                });
            }))
        });
        let second_order = Arc::clone(&order);
        let second_worker = thread::spawn(move || second.run(|| second_order.lock().push(2)));

        assert!(first_worker.join().unwrap().is_err());
        second_worker.join().unwrap();
        assert_eq!(*order.lock(), vec![1, 2]);
    }

    #[test]
    fn history_close_drains_while_mutation_publication_is_held() {
        let publication = Arc::new(MutationPublicationSequencer::default());
        let ticket = publication.issue().unwrap();
        let gate = Arc::new(HistoryAdmissionGate::default());
        let admission = gate.admit_mutation().unwrap();
        let (publication_held_tx, publication_held_rx) = mpsc::channel();
        let (release_publication_tx, release_publication_rx) = mpsc::channel();
        let mutation = thread::spawn(move || {
            ticket.run(|| {
                publication_held_tx.send(()).unwrap();
                release_publication_rx.recv().unwrap();
                drop(admission);
            });
        });
        publication_held_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();

        let barrier = gate.begin_close("history-close-publication-test").unwrap();
        let waiter = barrier.waiter();
        let (drained_tx, drained_rx) = mpsc::channel();
        let drain = thread::spawn(move || {
            drained_tx.send(waiter.wait_for_drain()).unwrap();
        });
        assert!(matches!(
            drained_rx.recv_timeout(Duration::from_millis(50)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));

        release_publication_tx.send(()).unwrap();
        assert_eq!(
            drained_rx.recv_timeout(Duration::from_secs(2)).unwrap(),
            Ok(())
        );
        mutation.join().unwrap();
        drain.join().unwrap();
        drop(barrier);
    }

    #[test]
    fn overlay_close_preserves_visibility_while_windows_lifecycle_is_pending() {
        assert_eq!(
            overlay_close_action(false, true),
            OverlayCloseAction::PreserveVisibility
        );
    }

    #[test]
    fn overlay_close_distinguishes_final_shutdown_from_user_close() {
        assert_eq!(
            overlay_close_action(true, true),
            OverlayCloseAction::AllowClose
        );
        assert_eq!(
            overlay_close_action(false, false),
            OverlayCloseAction::HideAndPersist
        );
    }

    #[test]
    fn startup_panel_restore_requires_detached_without_obs_or_tray_start() {
        assert!(should_restore_panel_on_startup(false, false, true));
        assert!(!should_restore_panel_on_startup(false, false, false));
        assert!(!should_restore_panel_on_startup(true, false, true));
        assert!(!should_restore_panel_on_startup(false, true, true));
    }

    #[test]
    fn startup_hidden_main_window_needs_both_tray_and_hidden_flags() {
        assert!(main_window_starts_hidden(true, true));
        assert!(!main_window_starts_hidden(false, true));
        assert!(!main_window_starts_hidden(true, false));
        // 메인 창 표시와 패널 복원이 같은 판정을 공유한다
        assert!(should_restore_panel_on_startup(
            false,
            main_window_starts_hidden(false, true),
            true
        ));
        assert!(!should_restore_panel_on_startup(
            false,
            main_window_starts_hidden(true, true),
            true
        ));
    }

    #[test]
    fn panel_window_contract_uses_fixed_client_width() {
        assert_eq!(PANEL_LABEL, "panel");
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
            specs: vec![work_area_spec(0.0, 0.0, 1_280.0, 680.0)],
            primary_index: Some(0),
        };
        let layout = resolve_panel_window_layout(None, None, &monitors, None);

        assert!(layout.min_height <= layout.max_height);
        assert!(layout.height <= 680.0);
        assert_eq!(layout.height, layout.max_height);
    }

    fn work_area_spec(origin_x: f64, origin_y: f64, width: f64, height: f64) -> MonitorSpec {
        let rect = NativeRect {
            x: origin_x,
            y: origin_y,
            width,
            height,
        };
        MonitorSpec {
            identity: format!("monitor-{origin_x}-{origin_y}"),
            enumeration_index: 0,
            full_rect_native: rect,
            work_rect_native: rect,
            full_rect_physical: rect,
            scale_factor: 1.0,
            logical_to_native_scale: 1.0,
        }
    }

    fn main_rect(x: f64, y: f64, width: f64, height: f64) -> NativeRect {
        NativeRect {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn panel_lands_beside_the_main_window_on_the_right() {
        let work_area = work_area_spec(0.0, 0.0, 1_920.0, 1_080.0);
        let position =
            panel_position_beside_main(&main_rect(400.0, 200.0, 900.0, 500.0), 400.0, &work_area);

        assert_eq!(position.x, 400.0 + 900.0 + PANEL_BESIDE_GAP);
        // 메인 창 세로 중앙
        assert_eq!(position.y, 250.0);
    }

    #[test]
    fn panel_flips_to_the_left_when_the_right_side_has_no_room() {
        let work_area = work_area_spec(0.0, 0.0, 1_920.0, 1_080.0);
        let position =
            panel_position_beside_main(&main_rect(1_600.0, 200.0, 300.0, 500.0), 400.0, &work_area);

        assert_eq!(position.x, 1_600.0 - PANEL_BESIDE_GAP - PANEL_WIDTH);
        assert_eq!(position.y, 250.0);
    }

    #[test]
    fn panel_clamps_into_the_work_area_when_neither_side_fits() {
        let work_area = work_area_spec(0.0, 0.0, 600.0, 800.0);
        let position =
            panel_position_beside_main(&main_rect(0.0, 0.0, 600.0, 400.0), 300.0, &work_area);

        assert_eq!(position.x, 600.0 - PANEL_WIDTH);
        assert_eq!(position.y, 50.0);
    }

    #[test]
    fn panel_taller_than_the_work_area_clamps_to_its_top() {
        let work_area = work_area_spec(100.0, 50.0, 1_920.0, 1_000.0);
        let position =
            panel_position_beside_main(&main_rect(200.0, 400.0, 900.0, 500.0), 1_400.0, &work_area);

        assert_eq!(position.x, 200.0 + 900.0 + PANEL_BESIDE_GAP);
        assert_eq!(position.y, 50.0);
    }

    #[test]
    fn panel_layout_keeps_stored_height_and_places_beside_main() {
        let monitors = MonitorData {
            specs: vec![work_area_spec(0.0, 0.0, 1_920.0, 1_080.0)],
            primary_index: Some(0),
        };
        let layout = resolve_panel_window_layout(
            Some(PanelBounds {
                x: 31.0,
                y: 47.0,
                height: 800.0,
            }),
            Some(main_rect(300.0, 100.0, 900.0, 500.0)),
            &monitors,
            None,
        );

        // 높이는 저장값 유지, 위치는 저장값을 무시하고 메인 옆으로 다시 계산
        assert_eq!(layout.height, 800.0);
        let position = layout.position.expect("panel should be placed beside main");
        assert_eq!(position.x, 300.0 + 900.0 + PANEL_BESIDE_GAP);
        // 세로 중앙이 화면 위로 넘치면 작업 영역 상단에 붙는다
        assert_eq!(position.y, 0.0);
    }

    #[test]
    fn panel_open_arm_is_consumed_once_and_expires() {
        let now = Instant::now();
        let mut slot = None;
        assert!(!take_panel_open_arm(&mut slot, now));

        let mut slot = Some(now);
        assert!(take_panel_open_arm(
            &mut slot,
            now + Duration::from_millis(500)
        ));
        // 소비된 토큰은 다시 쓸 수 없다
        assert!(!take_panel_open_arm(
            &mut slot,
            now + Duration::from_millis(600)
        ));

        let mut slot = Some(now);
        assert!(!take_panel_open_arm(
            &mut slot,
            now + PANEL_OPEN_ARM_TIMEOUT + Duration::from_millis(1)
        ));
        assert!(slot.is_none());
    }

    #[test]
    fn panel_open_accepts_only_blank_urls() {
        assert!(is_panel_open_url(""));
        assert!(is_panel_open_url("about:blank"));
        assert!(!is_panel_open_url("https://example.com"));
        assert!(!is_panel_open_url("tauri://localhost/panel/index.html"));
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
    fn panel_move_skips_the_disk_write_while_resize_persists() {
        let sample = PanelBoundsSample {
            position: PhysicalPosition::new(600, 300),
            position_scale_factor: 2.0,
            size: PhysicalSize::new(480, 1_000),
            size_scale_factor: 2.0,
            current_scale_factor: 2.0,
        };
        let mut state = PanelBoundsPersistenceState {
            latest: Some(sample),
            session: 3,
            active: true,
            ..PanelBoundsPersistenceState::default()
        };

        // 이동도 워커는 깨운다 - 모니터 보정이 붙어 있기 때문
        assert!(PanelBoundsPersistenceController::record_change(
            &mut state,
            3,
            PanelBoundsChange::Moved(PhysicalPosition::new(800, 400)),
        ));
        let moved = PanelBoundsPersistenceController::take_dirty_work(&mut state)
            .expect("move still schedules worker work");
        assert!(!moved.persist);
        assert!(!state.persist_dirty);

        // 리사이즈는 복원에 쓰는 높이를 바꾸므로 저장 대상
        PanelBoundsPersistenceController::record_change(
            &mut state,
            3,
            PanelBoundsChange::Resized(PhysicalSize::new(480, 1_200)),
        );
        let resized = PanelBoundsPersistenceController::take_dirty_work(&mut state)
            .expect("resize schedules worker work");
        assert!(resized.persist);

        // 저장 실패는 저장 대상 표식까지 되살린다
        assert!(PanelBoundsPersistenceController::restore_failed_work(
            &mut state, &resized
        ));
        assert!(state.dirty);
        assert!(state.persist_dirty);

        // 뒤따르는 이동이 이미 잡힌 저장 대상을 지우지 않는다
        PanelBoundsPersistenceController::record_change(
            &mut state,
            3,
            PanelBoundsChange::Moved(PhysicalPosition::new(900, 500)),
        );
        assert!(
            PanelBoundsPersistenceController::take_dirty_work(&mut state)
                .expect("coalesced work stays scheduled")
                .persist
        );
    }

    #[test]
    fn panel_reset_ignores_default_layout_resize_before_user_resize() {
        let mut state = PanelBoundsPersistenceState {
            latest: Some(PanelBoundsSample {
                position: PhysicalPosition::new(600, 300),
                position_scale_factor: 2.0,
                size: PhysicalSize::new(480, 2_000),
                size_scale_factor: 2.0,
                current_scale_factor: 2.0,
            }),
            unpersisted_default_height: Some(712.0),
            default_height_pending: true,
            session: 3,
            active: true,
            ..PanelBoundsPersistenceState::default()
        };

        PanelBoundsPersistenceController::record_change(
            &mut state,
            3,
            PanelBoundsChange::Resized(PhysicalSize::new(480, 1_600)),
        );
        assert!(
            !PanelBoundsPersistenceController::take_dirty_work(&mut state)
                .expect("intermediate reset size should schedule constraints")
                .persist
        );

        PanelBoundsPersistenceController::record_change(
            &mut state,
            3,
            PanelBoundsChange::Resized(PhysicalSize::new(480, 1_424)),
        );
        assert!(
            !PanelBoundsPersistenceController::take_dirty_work(&mut state)
                .expect("default reset size should schedule constraints")
                .persist
        );
        assert!(!state.default_height_pending);

        PanelBoundsPersistenceController::record_change(
            &mut state,
            3,
            PanelBoundsChange::Resized(PhysicalSize::new(480, 1_500)),
        );
        assert!(
            PanelBoundsPersistenceController::take_dirty_work(&mut state)
                .expect("user resize should schedule persistence")
                .persist
        );
        assert_eq!(state.unpersisted_default_height, None);
    }

    #[test]
    fn panel_reset_at_default_height_persists_the_next_user_resize() {
        let mut state = PanelBoundsPersistenceState {
            latest: Some(PanelBoundsSample {
                position: PhysicalPosition::new(600, 300),
                position_scale_factor: 2.0,
                size: PhysicalSize::new(480, 1_424),
                size_scale_factor: 2.0,
                current_scale_factor: 2.0,
            }),
            unpersisted_default_height: Some(712.0),
            default_height_pending: false,
            session: 4,
            active: true,
            ..PanelBoundsPersistenceState::default()
        };

        PanelBoundsPersistenceController::record_change(
            &mut state,
            4,
            PanelBoundsChange::Resized(PhysicalSize::new(480, 1_500)),
        );

        assert!(
            PanelBoundsPersistenceController::take_dirty_work(&mut state)
                .expect("user resize should schedule persistence")
                .persist
        );
        assert_eq!(state.unpersisted_default_height, None);
    }

    #[test]
    fn panel_tray_companion_flag_marks_only_windows_we_hid() {
        let hidden = AtomicBool::new(false);

        // 보이는 창만 감추고 표식을 남긴다
        assert!(hide_panel_with_main_transition(&hidden, true, || Ok(())).unwrap());
        assert!(hidden.load(Ordering::SeqCst));

        // 이미 숨은 창은 건드리지 않고 표식도 그대로
        assert!(!hide_panel_with_main_transition(&hidden, false, || panic!(
            "hidden window must not be hidden again"
        ))
        .unwrap());
        assert!(hidden.load(Ordering::SeqCst));

        // 복원에 성공하면 표식이 지워진다
        assert!(restore_panel_with_main_transition(&hidden, || Ok(())).unwrap());
        assert!(!hidden.load(Ordering::SeqCst));

        // 우리가 감추지 않은 창은 복원 대상이 아니다
        assert!(!restore_panel_with_main_transition(&hidden, || panic!(
            "untouched window must not be shown"
        ))
        .unwrap());
    }

    #[test]
    fn panel_tray_companion_flag_survives_failed_window_calls() {
        let hidden = AtomicBool::new(false);

        // hide 실패는 표식을 세우지 않는다 - 세우면 남의 창을 깨운다
        assert!(
            hide_panel_with_main_transition(&hidden, true, || Err(anyhow::anyhow!(
                "hide unavailable"
            )))
            .is_err()
        );
        assert!(!hidden.load(Ordering::SeqCst));

        hide_panel_with_main_transition(&hidden, true, || Ok(())).unwrap();
        // show 실패는 표식을 되살린다
        assert!(
            restore_panel_with_main_transition(&hidden, || Err(anyhow::anyhow!(
                "show unavailable"
            )))
            .is_err()
        );
        assert!(hidden.load(Ordering::SeqCst));

        // 창이 파괴되면 동행 복원 대상도 사라진다
        assert!(drop_panel_hidden_with_main(&hidden));
        assert!(!hidden.load(Ordering::SeqCst));
        assert!(!drop_panel_hidden_with_main(&hidden));
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
    fn panel_bounds_flush_preserves_cleared_default_height() {
        let sample = PanelBoundsSample {
            position: PhysicalPosition::new(600, 300),
            position_scale_factor: 2.0,
            size: PhysicalSize::new(480, 1_424),
            size_scale_factor: 2.0,
            current_scale_factor: 2.0,
        };
        let state = Mutex::new(PanelBoundsPersistenceState {
            latest: Some(sample),
            unpersisted_default_height: Some(712.0),
            default_height_pending: false,
            session: 7,
            active: true,
            ..PanelBoundsPersistenceState::default()
        });

        let persisted =
            PanelBoundsPersistenceController::flush_samples(&state, 0, Ok(sample), |_| {
                panic!("default height must remain cleared")
            })
            .unwrap();

        assert!(!persisted);
        assert_eq!(state.lock().unpersisted_default_height, Some(712.0));
    }

    // 기동 복원 회귀: 방금 배치된 메인 창의 논리 좌표를 받으면 세로 중앙이 맞는다
    #[test]
    fn panel_restore_centers_on_the_freshly_placed_main_window() {
        let monitors = MonitorData {
            specs: vec![work_area_spec(0.0, 30.0, 2_560.0, 1_358.0)],
            primary_index: Some(0),
        };
        let main = NativeRect {
            x: 829.0,
            y: 465.0,
            width: 902.0,
            height: 488.0,
        };
        let layout = resolve_panel_window_layout(
            Some(PanelBounds {
                x: 2_205.0,
                y: 185.0,
                height: 712.0,
            }),
            Some(main),
            &monitors,
            None,
        );

        assert_eq!(layout.height, 712.0);
        let position = layout.position.expect("panel should be placed beside main");
        assert_eq!(position.x, 1_747.0);
        assert_eq!(position.y, 353.0);
    }

    #[test]
    fn panel_layout_leaves_placement_to_the_os_without_monitor_data() {
        let monitors = MonitorData {
            specs: Vec::new(),
            primary_index: None,
        };
        let layout = resolve_panel_window_layout(
            None,
            Some(main_rect(300.0, 100.0, 900.0, 500.0)),
            &monitors,
            None,
        );

        // 메인 좌표는 있어도 기준 화면을 못 고르면 붙일 자리를 계산할 수 없다
        assert!(layout.position.is_none());
        assert_eq!(layout.height, PANEL_INITIAL_HEIGHT);
    }

    #[test]
    fn panel_follows_the_monitor_that_holds_the_main_window() {
        let monitors = MonitorData {
            specs: vec![
                work_area_spec(0.0, 0.0, 1_920.0, 1_080.0),
                work_area_spec(1_920.0, 0.0, 1_280.0, 800.0),
            ],
            primary_index: Some(0),
        };
        let layout = resolve_panel_window_layout(
            Some(PanelBounds {
                x: 31.0,
                y: 47.0,
                height: 800.0,
            }),
            Some(main_rect(2_000.0, 100.0, 900.0, 500.0)),
            &monitors,
            None,
        );

        // 주 모니터가 아니라 메인 창이 놓인 보조 모니터의 한계를 따른다
        assert_eq!(layout.max_height, 720.0);
        assert_eq!(layout.height, 720.0);
        let position = layout.position.expect("panel should be placed beside main");
        assert_eq!(position.x, 2_000.0 + 900.0 + PANEL_BESIDE_GAP);
        assert_eq!(position.y, 0.0);
    }

    #[test]
    fn persisted_panel_height_clamps_and_position_waits_for_main_geometry() {
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
            None,
            &monitors,
            None,
        );

        assert_eq!(layout.height, PANEL_MIN_HEIGHT);
        // 메인 좌표를 못 읽으면 OS 기본 배치 - 저장된 x/y는 더 이상 위치가 아니다
        assert!(layout.position.is_none());
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
    fn panel_present_snapshot_restores_docked_state_after_hide() {
        let snapshot = PanelPresentSnapshot {
            panel_visible: false,
            panel_detached: false,
            panel_destroy_reason: Some(PanelVisibilityReason::Closed),
        };

        assert!(!snapshot.panel_visible);
        assert!(!should_restore_panel_on_startup(
            false,
            false,
            snapshot.panel_detached
        ));
        assert_eq!(
            snapshot.panel_destroy_reason,
            Some(PanelVisibilityReason::Closed)
        );
    }

    #[test]
    fn panel_present_snapshot_preserves_detached_state_for_tray_hide() {
        let snapshot = PanelPresentSnapshot {
            panel_visible: true,
            panel_detached: true,
            panel_destroy_reason: None,
        };

        assert!(snapshot.panel_visible);
        assert!(should_restore_panel_on_startup(
            false,
            false,
            snapshot.panel_detached
        ));
        assert_eq!(snapshot.panel_destroy_reason, None);
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
    fn frontend_lifecycle_targets_skip_the_opener_hosted_panel() {
        // 패널 창은 메인 문서가 그리는 자식 - 자체 렌더러가 없어 ack를 낼 수 없다
        let open_labels = ["main", OVERLAY_LABEL, PANEL_LABEL];
        let targets =
            collect_frontend_lifecycle_targets(|label| open_labels.contains(&label).then_some(()));
        let labels = targets
            .into_iter()
            .map(|(label, ())| label)
            .collect::<Vec<_>>();

        assert_eq!(labels, vec!["main".to_string(), OVERLAY_LABEL.to_string()]);
    }

    #[test]
    fn overlay_only_flush_failure_restores_every_original_handshake_target() {
        let target_windows = ["main", OVERLAY_LABEL]
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
        assert_eq!(
            active.pending_windows,
            HashSet::from([OVERLAY_LABEL.to_string()])
        );

        let canceled = take_editor_flush_handshake(&mut slot, "handshake-1")
            .expect("overlay failure should cancel the handshake");

        assert_eq!(
            frontend_lifecycle_restore_labels(&canceled.target_windows),
            vec!["main", OVERLAY_LABEL]
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
        let down = serde_json::to_value(key_state_payload(
            "A",
            "DOWN",
            "4key",
            2.0,
            true,
            Some(15.0),
        ))
        .unwrap();
        let up = serde_json::to_value(key_state_payload("A", "UP", "4key", 3.0, false, Some(15.0)))
            .unwrap();
        let unmatched_up =
            serde_json::to_value(key_state_payload("A", "UP", "4key", 3.0, false, None)).unwrap();

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
        let full_rect_physical = NativeRect {
            x: 0.0,
            y: 0.0,
            width: 3_840.0,
            height: 2_160.0,
        };
        let full_rect_native = NativeRect {
            x: 0.0,
            y: 0.0,
            width: 3_840.0 / scale,
            height: 2_160.0 / scale,
        };
        MonitorData {
            specs: vec![MonitorSpec {
                identity: "primary".to_string(),
                enumeration_index: 0,
                full_rect_native,
                work_rect_native: full_rect_native,
                full_rect_physical,
                scale_factor: scale,
                logical_to_native_scale: 1.0,
            }],
            primary_index: Some(0),
        }
    }

    fn windows_monitor_spec(
        identity: &str,
        enumeration_index: usize,
        full_rect_native: NativeRect,
        work_rect_native: NativeRect,
        scale_factor: f64,
    ) -> MonitorSpec {
        MonitorSpec {
            identity: identity.to_string(),
            enumeration_index,
            full_rect_native,
            work_rect_native,
            full_rect_physical: full_rect_native,
            scale_factor,
            logical_to_native_scale: scale_factor,
        }
    }

    fn stored_overlay(bounds: OverlayBounds) -> StoredOverlayBounds {
        bounds.into()
    }

    #[test]
    fn overlay_reset_falls_back_to_stored_rect_when_window_is_absent() {
        // 오버레이를 끈 채 재시작하면 저장값을 해석한 네이티브 배치가 기준
        let monitors = reset_test_monitors(1.0);
        let stored = stored_overlay(OverlayBounds {
            x: -3200.0,
            y: 980.0,
            width: 1240.0,
            height: 620.0,
        });
        let placement = overlay_reset_fallback_rect(Some(&stored), true, &monitors);
        assert_eq!((placement.position.x, placement.position.y), (0.0, 980.0));
        assert_eq!((placement.width, placement.height), (1240.0, 620.0));
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn overlay_reset_converts_legacy_physical_stored_rect() {
        // overlay_bounds_are_logical은 serde(default) = false라 구버전 store는 physical px다.
        // 이를 logical로 오인하면 겹침 판정이 배로 부풀어 엉뚱한 모니터를 고르고,
        // defer_overlay_bounds가 마커를 true로 굳혀 변환 기회가 영영 사라진다
        let monitors = reset_test_monitors(2.0);
        let legacy = stored_overlay(OverlayBounds {
            x: 400.0,
            y: 200.0,
            width: 1720.0,
            height: 640.0,
        });

        let placement = overlay_reset_fallback_rect(Some(&legacy), false, &monitors);
        assert_eq!((placement.position.x, placement.position.y), (200.0, 100.0));
        assert_eq!((placement.width, placement.height), (860.0, 320.0));

        // 마커가 true면 이미 환산된 값이므로 그대로 쓴다
        let placement = overlay_reset_fallback_rect(Some(&legacy), true, &monitors);
        assert_eq!((placement.position.x, placement.position.y), (400.0, 200.0));
        assert_eq!((placement.width, placement.height), (1720.0, 640.0));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_overlay_reset_uses_legacy_physical_and_logical_marker_paths() {
        let full = NativeRect {
            x: 0.0,
            y: 0.0,
            width: 3_840.0,
            height: 2_160.0,
        };
        let monitors = MonitorData {
            specs: vec![windows_monitor_spec("primary", 0, full, full, 2.0)],
            primary_index: Some(0),
        };
        let stored = stored_overlay(OverlayBounds {
            x: 400.0,
            y: 200.0,
            width: 1_720.0,
            height: 640.0,
        });

        let legacy = overlay_reset_fallback_rect(Some(&stored), false, &monitors);
        assert_eq!((legacy.position.x, legacy.position.y), (400.0, 200.0));
        assert_eq!((legacy.width, legacy.height), (860.0, 320.0));
        assert_eq!(legacy.target_scale, 2.0);

        let logical = overlay_reset_fallback_rect(Some(&stored), true, &monitors);
        assert_eq!((logical.position.x, logical.position.y), (800.0, 400.0));
        assert_eq!((logical.width, logical.height), (1_720.0, 640.0));
        assert_eq!(logical.target_scale, 2.0);
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn stored_bounds_normalization_respects_the_logical_marker() {
        // resize_overlay의 initializing 분기도 같은 정규화를 거친다.
        // 마커를 무시하고 physical 좌표를 쓰면 defer_overlay_bounds가 마커를
        // true로 굳혀 좌표가 영구 고착된다
        let monitors = reset_test_monitors(2.0);
        let stored = stored_overlay(OverlayBounds {
            x: 400.0,
            y: 200.0,
            width: 1720.0,
            height: 640.0,
        });

        let converted = normalize_stored_overlay_bounds(Some(&stored), false, &monitors, None)
            .expect("physical 좌표는 환산되어야 한다");
        assert_eq!((converted.x, converted.y), (200.0, 100.0));
        assert_eq!((converted.width, converted.height), (860.0, 320.0));

        let passthrough = normalize_stored_overlay_bounds(Some(&stored), true, &monitors, None)
            .expect("logical 좌표는 그대로 쓴다");
        assert_eq!((passthrough.x, passthrough.y), (400.0, 200.0));

        // 환산 근거가 없으면 None - 호출부가 창의 실제 위치를 유지하도록
        let blind = MonitorData::default();
        assert!(normalize_stored_overlay_bounds(Some(&stored), false, &blind, None).is_none());
        // 모니터가 없어도 창 scale이 살아 있으면 그것을 근거로 환산한다
        let by_window_scale =
            normalize_stored_overlay_bounds(Some(&stored), false, &blind, Some(2.0))
                .expect("창 scale이 2차 환산 근거가 되어야 한다");
        assert_eq!((by_window_scale.x, by_window_scale.y), (200.0, 100.0));
        assert_eq!(
            (by_window_scale.width, by_window_scale.height),
            (860.0, 320.0)
        );
        // 창 scale도 병리적이면 근거가 못 된다
        assert!(normalize_stored_overlay_bounds(Some(&stored), false, &blind, Some(0.0)).is_none());
        assert!(
            normalize_stored_overlay_bounds(Some(&stored), false, &blind, Some(f64::NAN)).is_none()
        );

        // 깨진 값은 마커와 무관하게 거른다
        let broken = stored_overlay(OverlayBounds {
            x: f64::NAN,
            y: 20.0,
            width: 800.0,
            height: 300.0,
        });
        assert!(normalize_stored_overlay_bounds(Some(&broken), true, &monitors, None).is_none());
        assert!(normalize_stored_overlay_bounds(None, true, &monitors, None).is_none());
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn a_false_marker_on_logical_bounds_is_a_double_conversion() {
        // defer_overlay_bounds가 마커를 무조건 true로 세팅하는 것은 거짓말이 아니다.
        // 호출부가 넘기는 값은 전부 logical이며, 마커를 false로 "보존"하면
        // 다음 세션의 ensure_overlay_window가 x/y/w/h를 전부 다시 나눈다.
        // 신규 설치 후 위치 초기화(화면 중앙)가 절반 크기로 왼쪽 위에 뜨게 되는 경로
        let monitors = reset_test_monitors(2.0);
        let centered = stored_overlay(OverlayBounds {
            x: 530.0,
            y: 380.0,
            width: 860.0,
            height: 320.0,
        });

        let double_converted =
            normalize_stored_overlay_bounds(Some(&centered), false, &monitors, None)
                .expect("마커가 false면 환산 대상이 된다");
        assert_eq!((double_converted.x, double_converted.y), (265.0, 190.0));
        assert_eq!(
            (double_converted.width, double_converted.height),
            (430.0, 160.0)
        );

        // 마커가 true여야 저장된 그대로 복원된다
        let preserved = normalize_stored_overlay_bounds(Some(&centered), true, &monitors, None)
            .expect("logical 값은 그대로 쓴다");
        assert_eq!((preserved.x, preserved.y), (530.0, 380.0));
        assert_eq!((preserved.width, preserved.height), (860.0, 320.0));
    }

    #[test]
    fn pathological_monitor_scale_is_rejected() {
        // scale이 0/NaN인 모니터가 spec에 섞이면 logical 필드가 inf/NaN이 되어
        // clamp와 겹침 판정이 통째로 오염된다. from_monitor가 이 술어로 걸러낸다
        assert!(monitor_scale_is_usable(1.0));
        assert!(monitor_scale_is_usable(2.0));
        assert!(!monitor_scale_is_usable(0.0));
        assert!(!monitor_scale_is_usable(-1.0));
        assert!(!monitor_scale_is_usable(f64::NAN));
        assert!(!monitor_scale_is_usable(f64::INFINITY));
    }

    #[test]
    fn initial_placement_clamps_with_the_size_being_applied() {
        // 초기화 resize는 콘텐츠 크기를 처음 확정하는 순간이라, 저장된 크기로
        // 판정하면 화면 안으로 되돌린다는 목적을 놓친다
        let monitors = reset_test_monitors(2.0); // logical 1920x1080
        let stored = stored_overlay(OverlayBounds {
            x: 1900.0,
            y: 50.0,
            width: 860.0,
            height: 320.0,
        });

        // 이번에 적용될 크기는 1200x400 - 저장된 860 기준으로 clamp하면
        // 우측 끝이 1060+1200 = 2260이 되어 340px가 화면 밖에 남는다
        let resolved = resolve_overlay_placement(Some(&stored), true, &monitors);
        let placement = resolved.for_size(1200.0, 400.0);
        assert_eq!(placement.position.x, 1920.0 - 1200.0);
        assert!(placement.position.x + 1200.0 <= 1920.0);

        // 모니터 정보가 없으면 판정 근거가 없으므로 좌표를 그대로 둔다
        let blind = MonitorData::default();
        let untouched =
            resolve_overlay_placement(Some(&stored), true, &blind).for_size(1200.0, 400.0);
        assert_eq!((untouched.position.x, untouched.position.y), (1900.0, 50.0));
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn stored_bounds_normalization_rejects_overflowing_conversions() {
        // scale 가드는 0보다 크기만 하면 통과시키므로, 극단적으로 작은 scale에서
        // 나눗셈이 inf로 넘친다. 위치는 clamp 대상이 아니라 여기서 걸러야 store로 새지 않는다
        let monitors = MonitorData {
            specs: vec![MonitorSpec {
                identity: "pathological".to_string(),
                enumeration_index: 0,
                full_rect_native: NativeRect {
                    x: 0.0,
                    y: 0.0,
                    width: 1_920.0,
                    height: 1_080.0,
                },
                work_rect_native: NativeRect {
                    x: 0.0,
                    y: 0.0,
                    width: 1_920.0,
                    height: 1_080.0,
                },
                full_rect_physical: NativeRect {
                    x: 0.0,
                    y: 0.0,
                    width: 1_920.0,
                    height: 1_080.0,
                },
                scale_factor: 1e-300,
                logical_to_native_scale: 1.0,
            }],
            primary_index: Some(0),
        };
        let stored = stored_overlay(OverlayBounds {
            x: 1e200,
            y: 1e200,
            width: 1e200,
            height: 1e200,
        });
        assert!(normalize_stored_overlay_bounds(Some(&stored), false, &monitors, None).is_none());
    }

    #[test]
    fn overlay_reset_fallback_repairs_missing_or_broken_stored_rect() {
        let monitors = reset_test_monitors(1.0);
        let placement = overlay_reset_fallback_rect(None, true, &monitors);
        assert_eq!(
            (placement.width, placement.height),
            (DEFAULT_OVERLAY_WIDTH, DEFAULT_OVERLAY_HEIGHT)
        );

        // 크기가 0이거나 NaN이면 중앙 정렬 계산이 무의미해진다
        let collapsed = stored_overlay(OverlayBounds {
            x: 10.0,
            y: 20.0,
            width: 0.0,
            height: 300.0,
        });
        let placement = overlay_reset_fallback_rect(Some(&collapsed), true, &monitors);
        assert_eq!(
            (placement.width, placement.height),
            (DEFAULT_OVERLAY_WIDTH, DEFAULT_OVERLAY_HEIGHT)
        );

        let broken = stored_overlay(OverlayBounds {
            x: f64::NAN,
            y: 20.0,
            width: 800.0,
            height: 300.0,
        });
        let placement = overlay_reset_fallback_rect(Some(&broken), true, &monitors);
        assert_eq!(
            (placement.width, placement.height),
            (DEFAULT_OVERLAY_WIDTH, DEFAULT_OVERLAY_HEIGHT)
        );

        // 저장된 크기가 한계를 넘으면 잘라 쓴다
        let oversized = stored_overlay(OverlayBounds {
            x: 0.0,
            y: 0.0,
            width: 9000.0,
            height: 40.0,
        });
        let placement = overlay_reset_fallback_rect(Some(&oversized), true, &monitors);
        assert_eq!((placement.width, placement.height), (4096.0, 100.0));
    }

    #[test]
    fn stored_overlay_native_is_removed_by_a_downgrade_round_trip() {
        let stored = StoredOverlayBounds {
            x: 900.0,
            y: 120.0,
            width: 860.0,
            height: 320.0,
            native_position: Some(StoredOverlayNativePosition {
                x: 1_800.0,
                y: 240.0,
                logical_echo_x: 900.0,
                logical_echo_y: 120.0,
            }),
        };
        let encoded = serde_json::to_value(&stored).unwrap();
        assert_eq!(
            encoded["nativePosition"]["logicalEchoX"].as_f64(),
            Some(900.0)
        );
        let old: OverlayBounds =
            serde_json::from_value(encoded).expect("구버전 공개 타입이 중첩 필드를 무시해야 한다");
        let restored: StoredOverlayBounds =
            serde_json::from_value(serde_json::to_value(old).unwrap()).unwrap();

        assert!(restored.native_position.is_none());
    }

    #[test]
    fn windows_restore_rejects_an_echo_mismatch() {
        let monitors = mixed_dpi_windows_monitors();
        let stored = StoredOverlayBounds {
            x: 1_000.0,
            y: 100.0,
            width: 860.0,
            height: 320.0,
            native_position: Some(StoredOverlayNativePosition {
                x: 2_000.0,
                y: 200.0,
                logical_echo_x: 999.0,
                logical_echo_y: 100.0,
            }),
        };
        let resolved = resolve_windows_overlay_placement(Some(&stored), true, &monitors);

        assert_eq!(resolved.source, OverlayRestoreSource::InferredLogical);
        assert_eq!(
            resolved.native_reject_reason,
            NativeRejectReason::EchoMismatch
        );
    }

    #[test]
    fn windows_restore_accepts_a_matching_native_echo() {
        let monitors = mixed_dpi_windows_monitors();
        let stored = StoredOverlayBounds {
            x: 1_000.0,
            y: 100.0,
            width: 860.0,
            height: 320.0,
            native_position: Some(StoredOverlayNativePosition {
                x: 2_000.0,
                y: 200.0,
                logical_echo_x: 1_000.0,
                logical_echo_y: 100.0,
            }),
        };
        let resolved = resolve_windows_overlay_placement(Some(&stored), true, &monitors);

        assert_eq!(resolved.source, OverlayRestoreSource::TrustedNative);
        assert_eq!(resolved.native_reject_reason, NativeRejectReason::None);
        assert_eq!(resolved.placement.position.x, 2_000.0);
        assert_eq!(resolved.placement.position.y, 200.0);
        assert_eq!(
            resolved.source.initial_trust(),
            OverlayPlacementTrust::Clean
        );
    }

    #[test]
    fn windows_legacy_physical_restore_uses_position_directly() {
        let monitors = mixed_dpi_windows_monitors();
        let stored = stored_overlay(OverlayBounds {
            x: 2_000.0,
            y: 200.0,
            width: 1_720.0,
            height: 640.0,
        });
        let resolved = resolve_windows_overlay_placement(Some(&stored), false, &monitors);

        assert_eq!(resolved.source, OverlayRestoreSource::LegacyPhysical);
        assert_eq!(resolved.placement.position.x, 2_000.0);
        assert_eq!(resolved.placement.position.y, 200.0);
        assert_eq!(resolved.placement.width, 860.0);
        assert_eq!(resolved.placement.height, 320.0);
    }

    #[test]
    fn windows_empty_monitor_inferred_restore_uses_window_scale() {
        let stored = stored_overlay(OverlayBounds {
            x: 1_000.0,
            y: 100.0,
            width: 860.0,
            height: 320.0,
        });
        let unresolved =
            resolve_windows_overlay_placement(Some(&stored), true, &MonitorData::default());
        assert!(unresolved.pending_scale_resolution.is_some());

        let resolved = complete_overlay_scale_resolution(unresolved, 2.0)
            .expect("창 배율로 inferred 복원을 확정해야 한다");
        assert_eq!(resolved.source, OverlayRestoreSource::InferredLogical);
        assert_eq!(resolved.placement.position.x, 2_000.0);
        assert_eq!(resolved.placement.position.y, 200.0);
        assert_eq!(resolved.placement.target_scale, 2.0);
        let resized = resolved.for_size(900.0, 400.0);
        assert_eq!(resized.position, resolved.placement.position);
        assert_eq!(resized.target_scale, 2.0);
    }

    #[test]
    fn windows_empty_monitor_legacy_restore_uses_window_scale() {
        let stored = stored_overlay(OverlayBounds {
            x: 2_000.0,
            y: 200.0,
            width: 1_720.0,
            height: 640.0,
        });
        let unresolved =
            resolve_windows_overlay_placement(Some(&stored), false, &MonitorData::default());
        assert!(unresolved.pending_scale_resolution.is_some());

        let resolved = complete_overlay_scale_resolution(unresolved, 2.0)
            .expect("창 배율로 legacy 복원을 확정해야 한다");
        assert_eq!(resolved.source, OverlayRestoreSource::LegacyPhysical);
        assert_eq!(resolved.placement.position.x, 2_000.0);
        assert_eq!(resolved.placement.position.y, 200.0);
        assert_eq!(resolved.placement.width, 860.0);
        assert_eq!(resolved.placement.height, 320.0);
        assert_eq!(resolved.placement.target_scale, 2.0);
        let resized = resolved.for_size(900.0, 400.0);
        assert_eq!(resized.position, resolved.placement.position);
        assert_eq!(resized.target_scale, 2.0);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_empty_monitor_legacy_restore_converts_with_window_scale() {
        let stored = stored_overlay(OverlayBounds {
            x: 2_000.0,
            y: 200.0,
            width: 1_720.0,
            height: 640.0,
        });
        let unresolved = resolve_overlay_placement(Some(&stored), false, &MonitorData::default());
        assert_eq!(unresolved.source, OverlayRestoreSource::LegacyPhysical);
        assert!(unresolved.pending_scale_resolution.is_some());

        let resolved = complete_overlay_scale_resolution(unresolved, 2.0)
            .expect("창 배율로 macOS legacy 복원을 환산해야 한다");
        assert_eq!(resolved.placement.position.x, 1_000.0);
        assert_eq!(resolved.placement.position.y, 100.0);
        assert_eq!(resolved.placement.width, 860.0);
        assert_eq!(resolved.placement.height, 320.0);
        assert_eq!(resolved.placement.target_scale, 1.0);
        let resized = resolved.for_size(900.0, 400.0);
        assert_eq!(resized.position, resolved.placement.position);
        assert_eq!(resized.target_scale, 1.0);
    }

    #[test]
    fn windows_inferred_restore_counts_multiple_and_zero_candidates() {
        let monitors = mixed_dpi_windows_monitors();
        let multiple = stored_overlay(OverlayBounds {
            x: 1_000.0,
            y: 100.0,
            width: 860.0,
            height: 320.0,
        });
        let multiple = resolve_windows_overlay_placement(Some(&multiple), true, &monitors);
        assert_eq!(multiple.source, OverlayRestoreSource::InferredLogical);
        assert_eq!(multiple.candidate_count, 2);
        assert_eq!(multiple.selected_monitor.as_deref(), Some("M1"));

        let zero = stored_overlay(OverlayBounds {
            x: 6_000.0,
            y: 100.0,
            width: 860.0,
            height: 320.0,
        });
        let zero = resolve_windows_overlay_placement(Some(&zero), true, &monitors);
        assert_eq!(zero.source, OverlayRestoreSource::InferredLogical);
        assert_eq!(zero.candidate_count, 0);
        assert!(zero.visibility_adjustment);
    }

    #[test]
    fn overlay_taint_is_cleared_only_by_move_end_or_reset() {
        assert_eq!(
            OverlayRestoreSource::InferredLogical.initial_trust(),
            OverlayPlacementTrust::Tainted
        );
        assert_eq!(
            next_overlay_placement_trust(
                OverlayPlacementTrust::Tainted,
                OverlayPersistenceAuthority::General,
            ),
            OverlayPlacementTrust::Tainted
        );
        for authority in [
            OverlayPersistenceAuthority::NativeMoveEnded,
            OverlayPersistenceAuthority::Reset,
        ] {
            assert_eq!(
                next_overlay_placement_trust(OverlayPlacementTrust::Tainted, authority),
                OverlayPlacementTrust::Clean
            );
        }
    }

    #[test]
    fn tainted_persistence_invalidates_native_until_trusted() {
        let frame = applied_overlay_frame_from_native(
            NativeRect {
                x: 2_000.0,
                y: 200.0,
                width: 1_720.0,
                height: 640.0,
            },
            2.0,
            true,
        )
        .unwrap();
        let tainted =
            stored_overlay_bounds_for_persistence(&frame, OverlayPlacementTrust::Tainted, true);
        assert!(tainted.native_position.is_none());

        let clean =
            stored_overlay_bounds_for_persistence(&frame, OverlayPlacementTrust::Clean, true);
        let native = clean.native_position.expect("clean 쓰기는 native를 기록");
        assert_eq!((native.x, native.y), (2_000.0, 200.0));
        assert_eq!(
            (native.logical_echo_x, native.logical_echo_y),
            (1_000.0, 100.0)
        );
    }

    #[test]
    fn native_overlap_selects_the_correct_mixed_dpi_monitor() {
        let monitors = mixed_dpi_windows_monitors();
        let rect = NativeRect {
            x: 1_600.0,
            y: 100.0,
            width: 1_720.0,
            height: 640.0,
        };
        let selected = monitors
            .find_best_overlap_native(rect)
            .expect("창이 두 모니터에 걸쳐 있어야 한다");

        assert_eq!(selected.identity, "M2");
        assert_eq!(selected.intersection_area_native(rect), 1_400.0 * 640.0);
    }

    #[test]
    fn public_overlay_adapter_exposes_only_logical_bounds() {
        let applied = applied_overlay_frame_from_native(
            NativeRect {
                x: 2_000.0,
                y: 200.0,
                width: 1_720.0,
                height: 640.0,
            },
            2.0,
            true,
        )
        .unwrap();
        assert_eq!(applied.public_bounds.x, 1_000.0);
        assert_eq!(applied.public_bounds.y, 100.0);
        assert_eq!(applied.public_bounds.width, 860.0);
        assert_eq!(applied.public_bounds.height, 320.0);

        let wire = serde_json::to_value(&applied.public_bounds).unwrap();
        assert_eq!(
            wire.get("x").and_then(serde_json::Value::as_f64),
            Some(1_000.0)
        );
        assert!(wire.get("nativePosition").is_none());
    }

    #[test]
    fn native_clamp_uses_work_area_but_overlap_uses_full_rect() {
        let spec = windows_monitor_spec(
            "taskbar",
            0,
            NativeRect {
                x: 0.0,
                y: 0.0,
                width: 1_920.0,
                height: 1_080.0,
            },
            NativeRect {
                x: 0.0,
                y: 0.0,
                width: 1_920.0,
                height: 1_040.0,
            },
            1.0,
        );
        let rect = NativeRect {
            x: 200.0,
            y: 1_020.0,
            width: 300.0,
            height: 60.0,
        };
        assert_eq!(spec.intersection_area_native(rect), 18_000.0);
        assert_eq!(spec.clamp_native(rect).y, 980.0);
    }

    fn mixed_dpi_windows_monitors() -> MonitorData {
        MonitorData {
            specs: vec![
                windows_monitor_spec(
                    "M1",
                    0,
                    NativeRect {
                        x: 0.0,
                        y: 0.0,
                        width: 1_920.0,
                        height: 1_080.0,
                    },
                    NativeRect {
                        x: 0.0,
                        y: 0.0,
                        width: 1_920.0,
                        height: 1_040.0,
                    },
                    1.0,
                ),
                windows_monitor_spec(
                    "M2",
                    1,
                    NativeRect {
                        x: 1_920.0,
                        y: 0.0,
                        width: 3_840.0,
                        height: 2_160.0,
                    },
                    NativeRect {
                        x: 1_920.0,
                        y: 0.0,
                        width: 3_840.0,
                        height: 2_080.0,
                    },
                    2.0,
                ),
            ],
            primary_index: Some(0),
        }
    }
}
