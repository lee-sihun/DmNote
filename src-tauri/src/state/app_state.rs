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

mod window_geometry;

#[cfg(test)]
use window_geometry::{
    apply_panel_bounds_change, changed_panel_max_height, panel_bounds_from_sample,
    panel_height_bounds, panel_position_beside_main, MonitorSpec, PanelBoundsPersistenceState,
    PanelBoundsSample,
};
use window_geometry::{
    compute_overlay_position, convert_physical_bounds_to_logical, defer_overlay_bounds,
    defer_overlay_bounds_from_window, flush_deferred_overlay_bounds, main_window_content_origin,
    main_window_logical_rect, panel_bounds_sample_from_window, panel_client_to_outer_position,
    resolve_panel_window_layout, MonitorData, OverlayPosition, PanelBoundsChange,
    PanelBoundsPersistenceController, PanelWindowLayout,
};
pub use window_geometry::{LogicalPoint, LogicalRect, PanelDragContext};

use super::{
    history::{
        HistoryAdmissionGate, HistoryAdmissionLease, HistoryBarrierLease, HistoryBarrierWaiter,
    },
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
        SettingsDiff, SettingsState, TabCssOverrides,
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
/// 환산이 필요하다. 모니터 조회가 비어 환산 근거가 없으면 `fallback_scale`
/// (보통 창 자신의 scale)로 재시도한다 - 모니터 열거는 실패해도 창 scale은
/// 살아 있는 경우가 있어, 환산을 포기하고 physical 값을 그대로 쓰는 것보다 낫다.
/// 그래도 실패하면 None - 호출부가 각자 안전한 대체 경로를 고른다
fn normalize_stored_overlay_bounds(
    stored: Option<&OverlayBounds>,
    bounds_are_logical: bool,
    monitors: &MonitorData,
    fallback_scale: Option<f64>,
) -> Option<OverlayBounds> {
    let usable = stored.filter(|bounds| overlay_bounds_are_usable(bounds))?;

    let normalized = if bounds_are_logical {
        usable.clone()
    } else {
        match convert_physical_bounds_to_logical(usable, monitors) {
            Some(converted) => converted,
            None => {
                let scale = fallback_scale?;
                log::warn!(
                    "[overlay] monitor data unavailable; converting stored bounds with window scale {scale}"
                );
                scale_physical_bounds_to_logical(usable, scale)?
            }
        }
    };

    // 극단적으로 작은 scale로 나누면 inf로 넘칠 수 있어 결과도 재검증한다
    overlay_bounds_are_usable(&normalized).then_some(normalized)
}

/// 초기화 resize에서 복원 좌표를 어디에 놓을지 정한다.
/// 저장된 크기가 아니라 **이번에 적용될 크기**로 판정해야, 화면 안으로
/// 되돌린다는 목적을 실제로 달성한다 (콘텐츠 크기는 첫 resize에서 처음 확정됨)
fn initial_overlay_placement(
    stored: &OverlayBounds,
    width: f64,
    height: f64,
    monitors: &MonitorData,
) -> OverlayPosition {
    compute_overlay_position(
        &OverlayBounds {
            x: stored.x,
            y: stored.y,
            width,
            height,
        },
        true,
        monitors,
    )
}

fn monitor_scale_is_usable(scale: f64) -> bool {
    scale.is_finite() && scale > 0.0
}

/// 주어진 scale 하나로 physical 사각형을 logical로 나눈다
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
    stored: Option<&OverlayBounds>,
    bounds_are_logical: bool,
    monitors: &MonitorData,
) -> (LogicalPosition<f64>, LogicalSize<f64>) {
    // 창이 없는 경로라 창 scale을 근거로 쓸 수 없다
    match normalize_stored_overlay_bounds(stored, bounds_are_logical, monitors, None) {
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

        // 한 번만 조회한다 - 프레임 적용과 환산 근거가 서로 다른 값을 보면
        // 방금 얻은 멀쩡한 scale을 쥐고도 환산을 포기하는 일이 생긴다
        let window_scale = window.scale_factor().ok();
        let scale_factor = window_scale.unwrap_or(1.0);
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
            // 환산 불가 시엔 창의 실제 위치를 유지하는 편이 안전하다.
            // 겹침 구제도 이 레거시 마커 경로에서만 걸린다 - 마커가 true면
            // 창 생성 시 이미 배치가 확정됐다는 뜻이라 모니터를 조회하지 않는다
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
                window_scale,
            );
            if let Some(stored) = restored {
                let placement = initial_overlay_placement(&stored, width, height, &monitors);
                new_x = placement.x;
                new_y = placement.y;
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
    fn flush_panel_detached(&self) {
        if let Err(err) = self.store.flush() {
            log::warn!("failed to persist panel detached state: {err}");
        }
    }

    // 메인이 window.open을 부르기 직전에 세운다. 핸들러가 이 토큰을 1회 소비한다
    pub fn arm_panel_open(&self) {
        *self.panel_open_armed.lock() = Some(Instant::now());
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
        let main_rect = main_window_logical_rect(app);
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
        let main_rect = main_window_logical_rect(app);
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
                layout.position = Some(OverlayPosition {
                    x: outer.x,
                    y: outer.y,
                });
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
        let main_rect = main_window_logical_rect(app);
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
            if let Err(err) = window.set_position(LogicalPosition::new(position.x, position.y)) {
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
        let _creation_guard = self.panel_creation_lock.lock();
        let Some(window) = app.get_webview_window(PANEL_LABEL) else {
            return Ok(());
        };
        self.panel_bounds_persistence.flush_now(&window)
    }

    pub fn handle_panel_window_destroyed(&self, app: &AppHandle) {
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
        main_rect: Option<LogicalRect>,
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

        if let Some(position) = layout.position {
            builder = builder.position(position.x, position.y);
        }

        let window = builder.build().context("failed to create panel window")?;

        if let Some(position) = layout.position {
            if let Err(err) = window.set_position(LogicalPosition::new(position.x, position.y)) {
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
        let position = compute_overlay_position(&bounds, had_bounds, &monitor_data);
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
                    if let Err(err) = defer_overlay_bounds_from_window(
                        &overlay_window,
                        &store,
                        &bounds_generation,
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

#[cfg(test)]
mod tests;
