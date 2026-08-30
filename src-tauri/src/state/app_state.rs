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

mod counter_runtime;
mod frontend_lifecycle;
mod keyboard_runtime;
mod lifecycle_runtime;
mod overlay_runtime;
mod panel_runtime;
mod window_geometry;

use keyboard_runtime::{
    bootstrap_keyboard_state, build_key_sound_binding_table, KeySoundBindingTable,
    KeyboardDaemonTask,
};
#[cfg(test)]
use keyboard_runtime::{
    canonical_hold_duration_ms, key_state_payload, next_keyboard_recovery_plan,
    resolve_event_age_ms, should_recover_keyboard_daemon, KEYBOARD_DAEMON_STABLE_RUNTIME,
    KEYBOARD_RECOVERY_DELAYS_MS,
};
use lifecycle_runtime::{
    attach_main_window_close_handler, dispatch_remove_tray_icon, execute_frontend_lifecycle,
    remove_tray_icon, tray_menu_labels,
};

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

    pub(crate) fn plugin_authority(&self) -> &PluginRuntimeAuthority {
        &self.plugin_authority
    }

    pub(crate) fn reset_plugin_authority(&self) -> Result<PluginAuthorityLease, String> {
        self.plugin_authority.reset()
    }

    pub fn mark_plugin_authority_unavailable(&self) {
        self.plugin_authority.mark_unavailable();
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

#[cfg(test)]
mod tests;
