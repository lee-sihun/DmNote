use std::sync::Arc;

#[cfg(target_os = "windows")]
use std::{
    sync::atomic::{AtomicUsize, Ordering},
    time::Duration,
};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
#[cfg(any(target_os = "windows", test))]
use tokio::sync::oneshot;

use crate::errors::{PanelDragError, PanelDragErrorCode};

const SNAP_BACK_PX: f64 = 30.0;
#[cfg(target_os = "windows")]
const DRAG_START_TIMEOUT: Duration = Duration::from_millis(750);
const MAX_GEOMETRY_VALUE: f64 = 10_000_000.0;
#[cfg(any(target_os = "windows", test))]
const MIN_ZOOM_RESIDUAL: f64 = 0.25;
#[cfg(any(target_os = "windows", test))]
const MAX_ZOOM_RESIDUAL: f64 = 4.0;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PanelDragOrigin {
    Docked,
    Detached,
}

impl PanelDragOrigin {
    fn as_str(self) -> &'static str {
        match self {
            Self::Docked => "docked",
            Self::Detached => "detached",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PanelDragPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PanelDragRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PanelDragGeometry {
    pub gesture_id: String,
    pub origin: PanelDragOrigin,
    pub grab_offset_css: PanelDragPoint,
    pub dock_area_css: Option<PanelDragRect>,
    pub press_client_css: PanelDragPoint,
    pub main_device_pixel_ratio: f64,
    pub panel_device_pixel_ratio: Option<f64>,
}

impl PanelDragGeometry {
    pub fn validate(&self) -> Result<(), PanelDragError> {
        if uuid::Uuid::parse_str(&self.gesture_id).is_err() {
            return Err(panel_drag_error(
                PanelDragErrorCode::InvalidGeometry,
                "gestureId must be a UUID",
            ));
        }
        if !point_is_usable(self.grab_offset_css)
            || !point_is_usable(self.press_client_css)
            || self.grab_offset_css.x < 0.0
            || self.grab_offset_css.y < 0.0
        {
            return Err(panel_drag_error(
                PanelDragErrorCode::InvalidGeometry,
                "panel drag points are invalid",
            ));
        }
        if self.dock_area_css.is_some_and(|rect| !rect_is_usable(rect)) {
            return Err(panel_drag_error(
                PanelDragErrorCode::InvalidGeometry,
                "dockAreaCss is invalid",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PanelDragOutcome {
    #[cfg(any(target_os = "windows", test))]
    Released,
    #[cfg(any(target_os = "windows", test))]
    Escaped,
    #[cfg(any(target_os = "windows", test))]
    ReleasedBeforeStart,
    #[cfg(any(target_os = "windows", test))]
    StartFailed,
    WindowDestroyed,
    /// 드래그 도중 생명주기 정리(도킹·트레이 숨김 등)가 제스처를 걷어갔다 -
    /// terminal 이벤트 없이 세션이 매달리지 않게 반드시 발행된다
    Canceled,
}

impl PanelDragOutcome {
    fn as_str(self) -> &'static str {
        match self {
            #[cfg(any(target_os = "windows", test))]
            Self::Released => "released",
            #[cfg(any(target_os = "windows", test))]
            Self::Escaped => "escaped",
            #[cfg(any(target_os = "windows", test))]
            Self::ReleasedBeforeStart => "releasedBeforeStart",
            #[cfg(any(target_os = "windows", test))]
            Self::StartFailed => "startFailed",
            Self::WindowDestroyed => "windowDestroyed",
            Self::Canceled => "canceled",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelDragEndedPayload {
    pub gesture_id: String,
    pub outcome: PanelDragOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub would_snap_back: Option<bool>,
}

#[cfg(any(target_os = "windows", test))]
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelDragHintPayload {
    pub gesture_id: String,
    pub would_dock: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelDragHitTestResult {
    pub gesture_id: String,
    pub would_dock: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct NativePoint {
    x: f64,
    y: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GesturePhase {
    #[cfg(any(target_os = "windows", test))]
    Presenting,
    #[cfg(any(target_os = "windows", test))]
    Starting,
    Dragging,
}

impl GesturePhase {
    fn as_str(self) -> &'static str {
        match self {
            #[cfg(any(target_os = "windows", test))]
            Self::Presenting => "presenting",
            #[cfg(any(target_os = "windows", test))]
            Self::Starting => "starting",
            Self::Dragging => "dragging",
        }
    }
}

struct ActiveGesture {
    gesture_id: String,
    origin: PanelDragOrigin,
    phase: GesturePhase,
    #[cfg(any(target_os = "windows", test))]
    start_native: Option<NativePoint>,
    #[cfg(any(target_os = "windows", test))]
    snap_scale: Option<f64>,
    #[cfg(any(target_os = "windows", test))]
    zoom_residual: Option<f64>,
    dock_area_css: Option<PanelDragRect>,
    #[cfg(any(target_os = "windows", test))]
    last_hint: Option<bool>,
    #[cfg(any(target_os = "windows", test))]
    escape_latched: bool,
    #[cfg(any(target_os = "windows", test))]
    enter_sender: Option<oneshot::Sender<()>>,
}

#[derive(Clone, Debug)]
struct ReleasedGesture {
    gesture_id: String,
    origin: PanelDragOrigin,
    start_native: Option<NativePoint>,
    snap_scale: Option<f64>,
    zoom_residual: Option<f64>,
    dock_area_css: Option<PanelDragRect>,
}

#[derive(Default)]
struct GestureMachine {
    active: Option<ActiveGesture>,
    released: Option<ReleasedGesture>,
}

#[cfg(any(target_os = "windows", test))]
enum TimeoutResolution {
    Started,
    Failed(PanelDragEndedPayload),
    Stale,
}

impl GestureMachine {
    #[cfg(any(target_os = "windows", test))]
    fn begin(&mut self, geometry: &PanelDragGeometry) -> Result<(), PanelDragError> {
        if self.active.is_some() {
            return Err(panel_drag_error(
                PanelDragErrorCode::DragStartFailed,
                "another panel drag gesture is active",
            ));
        }
        self.released = None;
        self.active = Some(ActiveGesture {
            gesture_id: geometry.gesture_id.clone(),
            origin: geometry.origin,
            phase: GesturePhase::Presenting,
            start_native: None,
            snap_scale: None,
            zoom_residual: None,
            dock_area_css: geometry.dock_area_css,
            #[cfg(any(target_os = "windows", test))]
            last_hint: None,
            escape_latched: false,
            enter_sender: None,
        });
        Ok(())
    }

    #[cfg(any(target_os = "windows", test))]
    fn prepare_starting(
        &mut self,
        gesture_id: &str,
        start_native: Option<NativePoint>,
        snap_scale: Option<f64>,
        zoom_residual: f64,
        enter_sender: oneshot::Sender<()>,
    ) -> Result<PanelDragOrigin, PanelDragError> {
        let active = self
            .active
            .as_mut()
            .filter(|active| {
                active.gesture_id == gesture_id && active.phase == GesturePhase::Presenting
            })
            .ok_or_else(|| {
                panel_drag_error(
                    PanelDragErrorCode::DragStartFailed,
                    "panel drag gesture is no longer presenting",
                )
            })?;
        active.phase = GesturePhase::Starting;
        active.start_native = start_native;
        active.snap_scale = snap_scale;
        active.zoom_residual = Some(zoom_residual);
        active.enter_sender = Some(enter_sender);
        Ok(active.origin)
    }

    #[cfg(any(target_os = "windows", test))]
    fn is_presenting(&self, gesture_id: &str) -> bool {
        self.active.as_ref().is_some_and(|active| {
            active.gesture_id == gesture_id && active.phase == GesturePhase::Presenting
        })
    }

    #[cfg(any(target_os = "windows", test))]
    fn observe_enter(&mut self) -> Option<(String, PanelDragOrigin, oneshot::Sender<()>)> {
        let active = self
            .active
            .as_mut()
            .filter(|active| active.phase == GesturePhase::Starting)?;
        active.phase = GesturePhase::Dragging;
        let sender = active.enter_sender.take()?;
        Some((active.gesture_id.clone(), active.origin, sender))
    }

    #[cfg(any(target_os = "windows", test))]
    fn latch_escape(&mut self) {
        if let Some(active) = self.active.as_mut().filter(|active| {
            matches!(
                active.phase,
                GesturePhase::Starting | GesturePhase::Dragging
            )
        }) {
            active.escape_latched = true;
        }
    }

    #[cfg(any(target_os = "windows", test))]
    fn finish_native_exit(&mut self) -> Option<PanelDragEndedPayload> {
        if self.active.as_ref()?.phase != GesturePhase::Dragging {
            return None;
        }
        let active = self.active.take()?;
        let outcome = classify_native_outcome(active.escape_latched);
        if outcome == PanelDragOutcome::Released {
            self.released = Some(ReleasedGesture {
                gesture_id: active.gesture_id.clone(),
                origin: active.origin,
                start_native: active.start_native,
                snap_scale: active.snap_scale,
                zoom_residual: active.zoom_residual,
                dock_area_css: active.dock_area_css,
            });
        } else {
            self.released = None;
        }
        log_transition(
            &active.gesture_id,
            GesturePhase::Dragging.as_str(),
            "idle",
            active.origin,
            Some(outcome),
        );
        Some(PanelDragEndedPayload {
            gesture_id: active.gesture_id,
            outcome,
            would_snap_back: None,
        })
    }

    #[cfg(target_os = "windows")]
    fn finish_start(
        &mut self,
        gesture_id: &str,
        outcome: PanelDragOutcome,
        would_snap_back: Option<bool>,
    ) -> Option<PanelDragEndedPayload> {
        let active = self
            .active
            .as_ref()
            .filter(|active| active.gesture_id == gesture_id)?;
        let gesture_id = active.gesture_id.clone();
        log_transition(
            &gesture_id,
            active.phase.as_str(),
            "idle",
            active.origin,
            Some(outcome),
        );
        self.active = None;
        self.released = None;
        Some(PanelDragEndedPayload {
            gesture_id,
            outcome,
            would_snap_back,
        })
    }

    fn finish_window_destroyed(&mut self) -> Option<PanelDragEndedPayload> {
        let active = self.active.take();
        self.released = None;
        active.map(|active| {
            log_transition(
                &active.gesture_id,
                active.phase.as_str(),
                "idle",
                active.origin,
                Some(PanelDragOutcome::WindowDestroyed),
            );
            PanelDragEndedPayload {
                gesture_id: active.gesture_id,
                outcome: PanelDragOutcome::WindowDestroyed,
                would_snap_back: None,
            }
        })
    }

    #[cfg(any(target_os = "windows", test))]
    fn resolve_timeout(&mut self, gesture_id: &str) -> TimeoutResolution {
        let Some(active) = self
            .active
            .as_ref()
            .filter(|active| active.gesture_id == gesture_id)
        else {
            return TimeoutResolution::Stale;
        };
        if active.phase == GesturePhase::Dragging {
            return TimeoutResolution::Started;
        }
        if active.phase != GesturePhase::Starting {
            return TimeoutResolution::Stale;
        }
        let payload = PanelDragEndedPayload {
            gesture_id: active.gesture_id.clone(),
            outcome: PanelDragOutcome::StartFailed,
            would_snap_back: None,
        };
        log_transition(
            &active.gesture_id,
            GesturePhase::Starting.as_str(),
            "idle",
            active.origin,
            Some(PanelDragOutcome::StartFailed),
        );
        self.active = None;
        self.released = None;
        TimeoutResolution::Failed(payload)
    }

    fn disarm_dock_zone(&mut self, gesture_id: &str) -> bool {
        let active = self.active.as_mut().filter(|active| {
            active.gesture_id == gesture_id && active.phase == GesturePhase::Dragging
        });
        let Some(active) = active else {
            return false;
        };
        active.dock_area_css.take().is_some()
    }

    #[cfg(any(target_os = "windows", test))]
    fn dock_snapshot(&self) -> Option<(String, Option<PanelDragRect>, f64)> {
        let active = self
            .active
            .as_ref()
            .filter(|active| active.phase == GesturePhase::Dragging)?;
        Some((
            active.gesture_id.clone(),
            active.dock_area_css,
            active.zoom_residual?,
        ))
    }

    #[cfg(any(target_os = "windows", test))]
    fn update_hint(&mut self, gesture_id: &str, would_dock: bool) -> Option<PanelDragHintPayload> {
        let active = self.active.as_mut().filter(|active| {
            active.gesture_id == gesture_id && active.phase == GesturePhase::Dragging
        })?;
        if active.last_hint == Some(would_dock) {
            return None;
        }
        active.last_hint = Some(would_dock);
        Some(PanelDragHintPayload {
            gesture_id: gesture_id.to_string(),
            would_dock,
        })
    }

    fn take_released(
        &mut self,
        gesture_id: &str,
        origin: PanelDragOrigin,
    ) -> Option<ReleasedGesture> {
        let released = self.released.as_ref()?;
        if released.gesture_id != gesture_id || released.origin != origin {
            return None;
        }
        self.released.take()
    }

    fn clear(&mut self) -> Option<(String, PanelDragOrigin, GesturePhase)> {
        let cleared = self
            .active
            .take()
            .map(|active| (active.gesture_id, active.origin, active.phase));
        self.released = None;
        cleared
    }
}

pub struct PanelDragController {
    machine: Arc<Mutex<GestureMachine>>,
    #[cfg(target_os = "windows")]
    native_context: Arc<AtomicUsize>,
}

impl Default for PanelDragController {
    fn default() -> Self {
        Self {
            machine: Arc::new(Mutex::new(GestureMachine::default())),
            #[cfg(target_os = "windows")]
            native_context: Arc::new(AtomicUsize::new(0)),
        }
    }
}

impl PanelDragController {
    #[cfg(target_os = "windows")]
    pub fn begin(&self, geometry: &PanelDragGeometry) -> Result<(), PanelDragError> {
        self.machine.lock().begin(geometry)?;
        log_transition(
            &geometry.gesture_id,
            "idle",
            GesturePhase::Presenting.as_str(),
            geometry.origin,
            None,
        );
        Ok(())
    }

    pub fn disarm_dock_zone(&self, gesture_id: &str) -> Result<(), PanelDragError> {
        if uuid::Uuid::parse_str(gesture_id).is_err() {
            return Err(panel_drag_error(
                PanelDragErrorCode::InvalidGeometry,
                "gestureId must be a UUID",
            ));
        }
        if !self.machine.lock().disarm_dock_zone(gesture_id) {
            log::debug!(
                "panel_drag stale-or-disarmed gestureId={gesture_id} action=disarmDockZone"
            );
        }
        Ok(())
    }

    #[cfg(target_os = "windows")]
    pub fn handle_moved(&self, app: &AppHandle) {
        let Some((gesture_id, dock_area_css, zoom_residual)) = self.machine.lock().dock_snapshot()
        else {
            return;
        };
        let Some(dock_area) = dock_area_css else {
            return;
        };
        let would_dock = (|| {
            let cursor = app.cursor_position().ok()?;
            let main = app.get_webview_window("main")?;
            let origin = main.inner_position().ok()?;
            let scale = main
                .scale_factor()
                .ok()
                .filter(|scale| scale_is_usable(*scale))?;
            let rect = dock_rect_native(
                NativePoint {
                    x: origin.x as f64,
                    y: origin.y as f64,
                },
                scale,
                zoom_residual,
                dock_area,
            )?;
            log::trace!(
                "panel_drag coordinates gestureId={} cursorX={} cursorY={} dockX={} dockY={} dockWidth={} dockHeight={} mainScale={} zoomResidual={}",
                gesture_id,
                cursor.x,
                cursor.y,
                rect.x,
                rect.y,
                rect.width,
                rect.height,
                scale,
                zoom_residual,
            );
            Some(point_in_rect(
                NativePoint {
                    x: cursor.x,
                    y: cursor.y,
                },
                rect,
            ))
        })()
            .unwrap_or(false);
        let payload = self.machine.lock().update_hint(&gesture_id, would_dock);
        if let Some(payload) = payload {
            emit_hint(app, payload);
        }
    }

    pub fn hit_test(
        &self,
        app: &AppHandle,
        gesture_id: &str,
        origin: PanelDragOrigin,
    ) -> Result<PanelDragHitTestResult, PanelDragError> {
        let result = self.hit_test_inner(app, gesture_id, origin);
        match &result {
            Ok(result) => log::info!(
                "panel_drag hitTest gestureId={} origin={} wouldDock={}",
                result.gesture_id,
                origin.as_str(),
                result.would_dock
            ),
            Err(error) => log::warn!(
                "panel_drag hitTestFailed gestureId={} code={}",
                gesture_id,
                error.error_code.as_str()
            ),
        }
        result
    }

    fn hit_test_inner(
        &self,
        app: &AppHandle,
        gesture_id: &str,
        origin: PanelDragOrigin,
    ) -> Result<PanelDragHitTestResult, PanelDragError> {
        let released = self
            .machine
            .lock()
            .take_released(gesture_id, origin)
            .ok_or_else(|| {
                panel_drag_error(
                    PanelDragErrorCode::InvalidGeometry,
                    "panel drag hit test requires a matching released gesture",
                )
            })?;
        let cursor = app.cursor_position().map_err(|error| {
            panel_drag_error(
                PanelDragErrorCode::MonitorUnavailable,
                format!("failed to read the release cursor position: {error}"),
            )
        })?;
        let cursor = NativePoint {
            x: cursor.x,
            y: cursor.y,
        };
        let would_dock = match released.origin {
            PanelDragOrigin::Docked => {
                let start = released.start_native.ok_or_else(|| {
                    panel_drag_error(
                        PanelDragErrorCode::InvalidGeometry,
                        "docked panel drag has no snapBack origin",
                    )
                })?;
                let scale = released
                    .snap_scale
                    .filter(|scale| scale_is_usable(*scale))
                    .ok_or_else(|| {
                        panel_drag_error(
                            PanelDragErrorCode::MonitorUnavailable,
                            "docked panel drag has no usable start scale",
                        )
                    })?;
                within_snap_back(start, cursor, scale)
            }
            PanelDragOrigin::Detached => released
                .dock_area_css
                .map(|dock_area| {
                    let residual = released.zoom_residual.ok_or_else(|| {
                        panel_drag_error(
                            PanelDragErrorCode::MonitorUnavailable,
                            "detached panel drag has no usable zoom residual",
                        )
                    })?;
                    dock_hit_test(app, cursor, dock_area, residual)
                })
                .transpose()?
                .unwrap_or(false),
        };
        Ok(PanelDragHitTestResult {
            gesture_id: released.gesture_id,
            would_dock,
        })
    }

    pub fn clear_for_lifecycle(&self, app: Option<&AppHandle>, reason: &str) {
        let cleared = {
            let mut machine = self.machine.lock();
            machine.clear()
        };
        if let Some((gesture_id, origin, phase)) = cleared {
            log_transition(
                &gesture_id,
                phase.as_str(),
                "idle",
                origin,
                Some(PanelDragOutcome::Canceled),
            );
            log::info!("panel_drag cleared gestureId={gesture_id} reason={reason}");
            // 락 해제 후 이 구간의 정리는 커맨드 응답으로 안 돌아갈 수 있다 -
            // terminal 이벤트를 발행해야 프론트 세션이 매달리지 않는다 (shutdown은 app 부재로 생략)
            if let Some(app) = app {
                emit_ended(
                    app,
                    PanelDragEndedPayload {
                        gesture_id,
                        outcome: PanelDragOutcome::Canceled,
                        would_snap_back: None,
                    },
                );
            }
        }
        #[cfg(target_os = "windows")]
        if let Some(app) = app {
            schedule_native_hook_cleanup(app, Arc::clone(&self.native_context));
        }
        #[cfg(not(target_os = "windows"))]
        let _ = app;
    }

    pub fn finish_window_destroyed(&self, app: &AppHandle) {
        let payload = self.machine.lock().finish_window_destroyed();
        if let Some(payload) = payload {
            emit_ended(app, payload);
        }
    }
}

#[derive(Clone, Copy)]
pub enum PanelDragStartMode {
    PresentAndStart,
    StartExisting,
}

impl PanelDragStartMode {
    fn expected_origin(self) -> PanelDragOrigin {
        match self {
            Self::PresentAndStart => PanelDragOrigin::Docked,
            Self::StartExisting => PanelDragOrigin::Detached,
        }
    }
}

#[cfg(target_os = "windows")]
pub async fn start_windows_drag(
    app: AppHandle,
    controller: Arc<PanelDragController>,
    geometry: PanelDragGeometry,
    mode: PanelDragStartMode,
) -> Result<(), PanelDragError> {
    geometry.validate()?;
    if geometry.origin != mode.expected_origin() {
        return Err(panel_drag_error(
            PanelDragErrorCode::InvalidGeometry,
            "panel drag origin does not match the start command",
        ));
    }
    controller.begin(&geometry)?;

    let (enter_sender, enter_receiver) = oneshot::channel();
    let (owner_sender, owner_receiver) = oneshot::channel();
    let owner_app = app.clone();
    let owner_controller = Arc::clone(&controller);
    let owner_geometry = geometry.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| unsafe {
            start_on_owner_thread(
                &owner_app,
                &owner_controller,
                &owner_geometry,
                mode,
                enter_sender,
            )
        }))
        .unwrap_or_else(|_| {
            owner_start_failure(
                &owner_controller,
                &owner_geometry.gesture_id,
                false,
                panel_drag_error(
                    PanelDragErrorCode::DragStartFailed,
                    "panel drag owner transaction panicked",
                ),
            )
        });
        let _ = owner_sender.send(result);
    }) {
        let payload = controller.machine.lock().finish_start(
            &geometry.gesture_id,
            PanelDragOutcome::StartFailed,
            None,
        );
        if let Some(payload) = payload {
            emit_ended(&app, payload);
        }
        return Err(panel_drag_error(
            match mode {
                PanelDragStartMode::PresentAndStart => PanelDragErrorCode::PresentFailed,
                PanelDragStartMode::StartExisting => PanelDragErrorCode::DragStartFailed,
            },
            format!("failed to dispatch panel drag to the owner thread: {error}"),
        ));
    }

    let owner_result = match owner_receiver.await {
        Ok(result) => result,
        Err(_) => {
            let payload = controller.machine.lock().finish_start(
                &geometry.gesture_id,
                PanelDragOutcome::StartFailed,
                None,
            );
            if let Some(payload) = payload {
                emit_ended(&app, payload);
            }
            return Err(panel_drag_error(
                PanelDragErrorCode::DragStartFailed,
                "panel drag owner transaction was canceled",
            ));
        }
    };
    let presented = owner_result.presented;
    if presented {
        app.state::<super::AppState>().flush_panel_detached();
    }
    match owner_result.status {
        OwnerStartStatus::Waiting => {}
        OwnerStartStatus::Finished(payload) => {
            emit_ended(&app, payload);
            return Ok(());
        }
        OwnerStartStatus::Failed { error, payload } => {
            log_start_failure(&geometry.gesture_id, error.error_code);
            if let Some(payload) = payload {
                emit_ended(&app, payload);
            }
            if presented {
                return Ok(());
            }
            return Err(error);
        }
    }

    match tokio::time::timeout(DRAG_START_TIMEOUT, enter_receiver).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) | Err(_) => {
            let result = resolve_start_timeout(&app, controller, &geometry.gesture_id).await;
            if presented && result.is_err() {
                Ok(())
            } else {
                result
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub async fn start_windows_drag(
    _app: AppHandle,
    _controller: Arc<PanelDragController>,
    geometry: PanelDragGeometry,
    mode: PanelDragStartMode,
) -> Result<(), PanelDragError> {
    geometry.validate()?;
    if geometry.origin != mode.expected_origin() {
        return Err(panel_drag_error(
            PanelDragErrorCode::InvalidGeometry,
            "panel drag origin does not match the start command",
        ));
    }
    Err(panel_drag_error(
        PanelDragErrorCode::DragStartFailed,
        "native panel dragging is only available on Windows",
    ))
}

fn dock_hit_test(
    app: &AppHandle,
    cursor: NativePoint,
    dock_area: PanelDragRect,
    zoom_residual: f64,
) -> Result<bool, PanelDragError> {
    let main = app.get_webview_window("main").ok_or_else(|| {
        panel_drag_error(
            PanelDragErrorCode::MonitorUnavailable,
            "main window is unavailable for panel drag hit testing",
        )
    })?;
    let origin = main.inner_position().map_err(|error| {
        panel_drag_error(
            PanelDragErrorCode::MonitorUnavailable,
            format!("failed to read the main content origin: {error}"),
        )
    })?;
    let scale = main
        .scale_factor()
        .ok()
        .filter(|scale| scale_is_usable(*scale))
        .ok_or_else(|| {
            panel_drag_error(
                PanelDragErrorCode::MonitorUnavailable,
                "main window scale is unavailable",
            )
        })?;
    let rect = dock_rect_native(
        NativePoint {
            x: origin.x as f64,
            y: origin.y as f64,
        },
        scale,
        zoom_residual,
        dock_area,
    )
    .ok_or_else(|| {
        panel_drag_error(
            PanelDragErrorCode::InvalidGeometry,
            "native dock area conversion failed",
        )
    })?;
    Ok(point_in_rect(cursor, rect))
}

#[derive(Clone, Copy)]
struct NativeRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn dock_rect_native(
    main_content_origin: NativePoint,
    main_scale: f64,
    zoom_residual: f64,
    dock_area_css: PanelDragRect,
) -> Option<NativeRect> {
    if !scale_is_usable(main_scale) || !rect_is_usable(dock_area_css) {
        return None;
    }
    let css_to_native_scale = main_scale * zoom_residual;
    let rect = NativeRect {
        x: main_content_origin.x + dock_area_css.x * css_to_native_scale,
        y: main_content_origin.y + dock_area_css.y * css_to_native_scale,
        width: dock_area_css.width * css_to_native_scale,
        height: dock_area_css.height * css_to_native_scale,
    };
    if [rect.x, rect.y, rect.width, rect.height]
        .into_iter()
        .all(f64::is_finite)
    {
        Some(rect)
    } else {
        None
    }
}

#[cfg(any(target_os = "windows", test))]
fn seed_panel_position_native(
    cursor: NativePoint,
    grab_offset_css: PanelDragPoint,
    target_scale: f64,
    panel_residual: f64,
    inset: NativePoint,
) -> NativePoint {
    let scale = target_scale * panel_residual;
    NativePoint {
        x: cursor.x - grab_offset_css.x * scale - inset.x,
        y: cursor.y - grab_offset_css.y * scale - inset.y,
    }
}

#[cfg(any(target_os = "windows", test))]
fn resolve_panel_seed_residual(
    panel_device_pixel_ratio: Option<f64>,
    panel_scale: Option<f64>,
    main_residual: f64,
) -> f64 {
    let Some(panel_device_pixel_ratio) = panel_device_pixel_ratio else {
        return main_residual;
    };
    let Some(panel_scale) = panel_scale.filter(|scale| scale_is_usable(*scale)) else {
        return main_residual;
    };
    calculate_zoom_residual(panel_device_pixel_ratio, panel_scale).unwrap_or(1.0)
}

fn point_in_rect(point: NativePoint, rect: NativeRect) -> bool {
    point.x >= rect.x
        && point.x <= rect.x + rect.width
        && point.y >= rect.y
        && point.y <= rect.y + rect.height
}

fn within_snap_back(start: NativePoint, end: NativePoint, main_scale: f64) -> bool {
    scale_is_usable(main_scale)
        && (end.x - start.x).hypot(end.y - start.y) <= SNAP_BACK_PX * main_scale
}

#[cfg(any(target_os = "windows", test))]
fn released_before_start_snap_back(
    start_native: Option<NativePoint>,
    end_native: NativePoint,
    snap_scale: Option<f64>,
) -> Option<bool> {
    Some(within_snap_back(start_native?, end_native, snap_scale?))
}

#[cfg(any(target_os = "windows", test))]
fn classify_native_outcome(escape_latched: bool) -> PanelDragOutcome {
    if escape_latched {
        PanelDragOutcome::Escaped
    } else {
        PanelDragOutcome::Released
    }
}

fn point_is_usable(point: PanelDragPoint) -> bool {
    point.x.is_finite()
        && point.y.is_finite()
        && point.x.abs() <= MAX_GEOMETRY_VALUE
        && point.y.abs() <= MAX_GEOMETRY_VALUE
}

fn rect_is_usable(rect: PanelDragRect) -> bool {
    point_is_usable(PanelDragPoint {
        x: rect.x,
        y: rect.y,
    }) && rect.width.is_finite()
        && rect.height.is_finite()
        && rect.width > 0.0
        && rect.height > 0.0
        && rect.width <= MAX_GEOMETRY_VALUE
        && rect.height <= MAX_GEOMETRY_VALUE
}

fn scale_is_usable(scale: f64) -> bool {
    scale.is_finite() && scale > 0.0
}

#[cfg(any(target_os = "windows", test))]
fn target_monitor_dpi(scale: f64) -> Option<u32> {
    let dpi = scale * 96.0;
    (scale_is_usable(scale) && dpi.is_finite() && dpi >= 1.0 && dpi <= u32::MAX as f64)
        .then(|| dpi.round() as u32)
}

#[cfg(any(target_os = "windows", test))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct UndecoratedShadowInsets {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[cfg(any(target_os = "windows", test))]
fn tao_undecorated_shadow_insets(
    dpi: u32,
    resize_frame_thickness: i32,
    padding_thickness: i32,
    windows_build: u32,
) -> UndecoratedShadowInsets {
    // Cargo.lock의 tao 0.35.3 calculate_insets_for_dpi 규칙과 결합
    let frame_thickness = resize_frame_thickness + padding_thickness;
    let top = if windows_build >= 22_000 {
        (dpi as f32 / 96.0).round() as i32
    } else {
        0
    };
    UndecoratedShadowInsets {
        left: frame_thickness,
        top,
        right: frame_thickness,
        bottom: frame_thickness,
    }
}

#[cfg(any(target_os = "windows", test))]
fn zoom_residual_is_usable(residual: f64) -> bool {
    residual.is_finite() && (MIN_ZOOM_RESIDUAL..=MAX_ZOOM_RESIDUAL).contains(&residual)
}

#[cfg(any(target_os = "windows", test))]
fn calculate_zoom_residual(device_pixel_ratio: f64, window_scale: f64) -> Option<f64> {
    if !device_pixel_ratio.is_finite() || !scale_is_usable(window_scale) {
        return None;
    }
    let residual = device_pixel_ratio / window_scale;
    zoom_residual_is_usable(residual).then_some(residual)
}

fn panel_drag_error(code: PanelDragErrorCode, message: impl Into<String>) -> PanelDragError {
    PanelDragError::new(code, message)
}

#[cfg(target_os = "windows")]
fn emit_hint(app: &AppHandle, payload: PanelDragHintPayload) {
    if let Err(error) = app.emit("panel:drag-hint", &payload) {
        log::warn!(
            "panel_drag emitFailed event=panel:drag-hint gestureId={} error={error}",
            payload.gesture_id
        );
    }
}

fn emit_ended(app: &AppHandle, payload: PanelDragEndedPayload) {
    if let Err(error) = app.emit("panel:drag-ended", &payload) {
        log::warn!(
            "panel_drag emitFailed event=panel:drag-ended gestureId={} outcome={} error={error}",
            payload.gesture_id,
            payload.outcome.as_str()
        );
    }
}

fn log_transition(
    gesture_id: &str,
    phase_before: &str,
    phase_after: &str,
    origin: PanelDragOrigin,
    outcome: Option<PanelDragOutcome>,
) {
    log::info!(
        "panel_drag transition gestureId={gesture_id} phaseBefore={phase_before} phaseAfter={phase_after} origin={} outcome={}",
        origin.as_str(),
        outcome.map(PanelDragOutcome::as_str).unwrap_or("none")
    );
}

#[cfg(target_os = "windows")]
fn log_start_failure(gesture_id: &str, code: PanelDragErrorCode) {
    log::warn!(
        "panel_drag startFailed gestureId={gesture_id} code={}",
        code.as_str()
    );
}

#[cfg(target_os = "windows")]
struct OwnerStartResult {
    presented: bool,
    status: OwnerStartStatus,
}

#[cfg(target_os = "windows")]
enum OwnerStartStatus {
    Waiting,
    Finished(PanelDragEndedPayload),
    Failed {
        error: PanelDragError,
        payload: Option<PanelDragEndedPayload>,
    },
}

#[cfg(target_os = "windows")]
struct NativeDragContext {
    app: AppHandle,
    machine: Arc<Mutex<GestureMachine>>,
    identity: Arc<AtomicUsize>,
    hwnd: usize,
    hook: AtomicUsize,
}

#[cfg(target_os = "windows")]
thread_local! {
    static HOOK_CONTEXT: std::cell::Cell<*mut NativeDragContext> = const {
        std::cell::Cell::new(std::ptr::null_mut())
    };
}

#[cfg(target_os = "windows")]
unsafe fn start_on_owner_thread(
    app: &AppHandle,
    controller: &Arc<PanelDragController>,
    geometry: &PanelDragGeometry,
    mode: PanelDragStartMode,
    enter_sender: oneshot::Sender<()>,
) -> OwnerStartResult {
    use tauri::PhysicalPosition;
    use windows::Win32::{
        Foundation::{LPARAM, POINT, WPARAM},
        UI::{
            Input::KeyboardAndMouse::{GetAsyncKeyState, ReleaseCapture, VK_LBUTTON, VK_RBUTTON},
            WindowsAndMessaging::{
                GetCursorPos, GetSystemMetrics, IsWindowVisible, PostMessageW, HTCAPTION,
                SM_SWAPBUTTON, WM_NCLBUTTONDOWN,
            },
        },
    };

    let Some(window) = app.get_webview_window(super::PANEL_LABEL) else {
        return owner_start_failure(
            controller,
            &geometry.gesture_id,
            false,
            panel_drag_error(PanelDragErrorCode::PanelNotOpen, "panel window is not open"),
        );
    };
    if !controller
        .machine
        .lock()
        .is_presenting(&geometry.gesture_id)
    {
        log::info!(
            "panel_drag staleOwnerSkipped gestureId={} action=start",
            geometry.gesture_id
        );
        return OwnerStartResult {
            presented: false,
            status: OwnerStartStatus::Failed {
                error: panel_drag_error(
                    PanelDragErrorCode::DragStartFailed,
                    "panel drag gesture was cleared before owner execution",
                ),
                payload: None,
            },
        };
    }
    if matches!(mode, PanelDragStartMode::StartExisting)
        && (!window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(false))
    {
        return owner_start_failure(
            controller,
            &geometry.gesture_id,
            false,
            panel_drag_error(
                PanelDragErrorCode::PanelNotOpen,
                "panel window is not visible",
            ),
        );
    }

    let (main_scale, main_residual) = match main_drag_scale(app, geometry) {
        Ok(metrics) => metrics,
        Err(error) => {
            return owner_start_failure(controller, &geometry.gesture_id, false, error);
        }
    };

    let mut cursor = POINT::default();
    if let Err(error) = unsafe { GetCursorPos(&mut cursor) } {
        return owner_start_failure(
            controller,
            &geometry.gesture_id,
            false,
            panel_drag_error(
                PanelDragErrorCode::MonitorUnavailable,
                format!("failed to read the drag cursor position: {error}"),
            ),
        );
    }

    let (start_native, snap_scale) = match geometry.origin {
        PanelDragOrigin::Docked => {
            match main_press_native(app, geometry.press_client_css, main_scale, main_residual) {
                Ok(value) => (Some(value.0), Some(value.1)),
                Err(error) => {
                    return owner_start_failure(controller, &geometry.gesture_id, false, error);
                }
            }
        }
        PanelDragOrigin::Detached => (None, None),
    };

    let mut presented = false;
    let mut present_snapshot = None;
    if matches!(mode, PanelDragStartMode::PresentAndStart) {
        let hwnd = match window.hwnd() {
            Ok(hwnd) => hwnd,
            Err(error) => {
                return owner_start_failure(
                    controller,
                    &geometry.gesture_id,
                    false,
                    panel_drag_error(
                        PanelDragErrorCode::PresentFailed,
                        format!("failed to get the panel HWND for presentation: {error}"),
                    ),
                );
            }
        };
        let monitor = match app.monitor_from_point(cursor.x as f64, cursor.y as f64) {
            Ok(Some(monitor)) if scale_is_usable(monitor.scale_factor()) => monitor,
            Ok(_) => {
                return owner_start_failure(
                    controller,
                    &geometry.gesture_id,
                    false,
                    panel_drag_error(
                        PanelDragErrorCode::MonitorUnavailable,
                        "cursor monitor is unavailable",
                    ),
                );
            }
            Err(error) => {
                return owner_start_failure(
                    controller,
                    &geometry.gesture_id,
                    false,
                    panel_drag_error(
                        PanelDragErrorCode::MonitorUnavailable,
                        format!("failed to resolve the cursor monitor: {error}"),
                    ),
                );
            }
        };
        let panel_scale = match geometry.panel_device_pixel_ratio {
            None => {
                log::debug!(
                    "panel_drag panelCoordinateScale gestureId={} panelDevicePixelRatio=missing mainZoomResidual={} source=mainResidual",
                    geometry.gesture_id,
                    main_residual,
                );
                None
            }
            Some(_) => match window.scale_factor() {
                Ok(panel_scale) if scale_is_usable(panel_scale) => Some(panel_scale),
                Ok(panel_scale) => {
                    log::warn!(
                        "panel_drag panelScaleFallback gestureId={} panelScale={} mainZoomResidual={}",
                        geometry.gesture_id,
                        panel_scale,
                        main_residual,
                    );
                    None
                }
                Err(error) => {
                    log::warn!(
                        "panel_drag panelScaleFallback gestureId={} error={} mainZoomResidual={}",
                        geometry.gesture_id,
                        error,
                        main_residual,
                    );
                    None
                }
            },
        };
        let panel_residual = resolve_panel_seed_residual(
            geometry.panel_device_pixel_ratio,
            panel_scale,
            main_residual,
        );
        if let (Some(panel_device_pixel_ratio), Some(panel_scale)) =
            (geometry.panel_device_pixel_ratio, panel_scale)
        {
            if calculate_zoom_residual(panel_device_pixel_ratio, panel_scale).is_some() {
                log::debug!(
                    "panel_drag panelCoordinateScale gestureId={} panelDevicePixelRatio={} panelScale={} panelZoomResidual={}",
                    geometry.gesture_id,
                    panel_device_pixel_ratio,
                    panel_scale,
                    panel_residual,
                );
            } else {
                log::warn!(
                    "panel_drag panelZoomResidualFallback gestureId={} panelDevicePixelRatio={} panelScale={} panelZoomResidual=1",
                    geometry.gesture_id,
                    panel_device_pixel_ratio,
                    panel_scale,
                );
            }
        }
        let inset =
            tao_undecorated_shadow_seed_inset(monitor.scale_factor()).unwrap_or_else(|| {
                log::warn!(
                    "panel_drag targetDpiInsetFallback gestureId={} targetScale={}",
                    geometry.gesture_id,
                    monitor.scale_factor()
                );
                match (window.outer_position(), window.inner_position()) {
                    (Ok(outer), Ok(inner)) => NativePoint {
                        x: (inner.x - outer.x) as f64,
                        y: (inner.y - outer.y) as f64,
                    },
                    _ => NativePoint { x: 0.0, y: 0.0 },
                }
            });
        let target = seed_panel_position_native(
            NativePoint {
                x: cursor.x as f64,
                y: cursor.y as f64,
            },
            geometry.grab_offset_css,
            monitor.scale_factor(),
            panel_residual,
            inset,
        );
        let target_x = target.x;
        let target_y = target.y;
        let Some(target_x) = checked_native_coordinate(target_x) else {
            return owner_start_failure(
                controller,
                &geometry.gesture_id,
                false,
                panel_drag_error(
                    PanelDragErrorCode::InvalidGeometry,
                    "panel seed X coordinate is out of range",
                ),
            );
        };
        let Some(target_y) = checked_native_coordinate(target_y) else {
            return owner_start_failure(
                controller,
                &geometry.gesture_id,
                false,
                panel_drag_error(
                    PanelDragErrorCode::InvalidGeometry,
                    "panel seed Y coordinate is out of range",
                ),
            );
        };
        {
            let state = app.state::<super::AppState>();
            let Some(_creation_guard) = state.try_lock_panel_creation_for_drag() else {
                return owner_start_failure(
                    controller,
                    &geometry.gesture_id,
                    false,
                    panel_drag_error(
                        PanelDragErrorCode::PresentFailed,
                        "panel creation lock is busy",
                    ),
                );
            };
            let _ = window.unminimize();
            if let Err(error) = window.set_position(PhysicalPosition::new(target_x, target_y)) {
                return owner_start_failure(
                    controller,
                    &geometry.gesture_id,
                    false,
                    panel_drag_error(
                        PanelDragErrorCode::PresentFailed,
                        format!("failed to seed the panel window position: {error}"),
                    ),
                );
            }
            if let Err(error) = window.show() {
                return owner_start_failure(
                    controller,
                    &geometry.gesture_id,
                    false,
                    panel_drag_error(
                        PanelDragErrorCode::PresentFailed,
                        format!("failed to show the panel window: {error}"),
                    ),
                );
            }
            presented = true;
            present_snapshot = Some(state.record_panel_drag_presented(app));
            if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
                return owner_start_failure(
                    controller,
                    &geometry.gesture_id,
                    presented,
                    panel_drag_error(
                        PanelDragErrorCode::PresentFailed,
                        "panel HWND did not become visible",
                    ),
                );
            }
        }
    }

    let context = match unsafe { ensure_native_observer(app, controller, &window) } {
        Ok(context) => context,
        Err(error) => {
            return owner_start_failure(controller, &geometry.gesture_id, presented, error);
        }
    };
    if let Err(error) = unsafe { install_native_hook(context) } {
        return owner_start_failure(controller, &geometry.gesture_id, presented, error);
    }
    let origin = match controller.machine.lock().prepare_starting(
        &geometry.gesture_id,
        start_native,
        snap_scale,
        main_residual,
        enter_sender,
    ) {
        Ok(origin) => origin,
        Err(error) => {
            unsafe { cleanup_native_hook(context) };
            let mut visible_after_failure = presented;
            if presented {
                match window.hide() {
                    Ok(()) => {
                        visible_after_failure = false;
                        if let Some(snapshot) = present_snapshot.take() {
                            app.state::<super::AppState>()
                                .revert_panel_drag_presented(app, snapshot);
                        } else {
                            log::warn!(
                                "panel_drag lifecycleStateRestoreMissing gestureId={}",
                                geometry.gesture_id
                            );
                        }
                        log::info!(
                            "panel_drag lifecycleHideRestored gestureId={} action=prepareStarting",
                            geometry.gesture_id
                        );
                    }
                    Err(error) => log::warn!(
                        "panel_drag lifecycleHideRestoreFailed gestureId={} error={error}",
                        geometry.gesture_id
                    ),
                }
            }
            return owner_start_failure(
                controller,
                &geometry.gesture_id,
                visible_after_failure,
                error,
            );
        }
    };
    log_transition(
        &geometry.gesture_id,
        GesturePhase::Presenting.as_str(),
        GesturePhase::Starting.as_str(),
        origin,
        None,
    );

    let primary_button_vk = if unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0 {
        VK_RBUTTON
    } else {
        VK_LBUTTON
    };
    let primary_button_down =
        unsafe { GetAsyncKeyState(primary_button_vk.0 as i32) } as u16 & 0x8000 != 0;
    if !primary_button_down {
        unsafe { cleanup_native_hook(context) };
        let would_snap_back = if geometry.origin == PanelDragOrigin::Docked {
            let mut release_cursor = POINT::default();
            match unsafe { GetCursorPos(&mut release_cursor) } {
                Ok(()) => released_before_start_snap_back(
                    start_native,
                    NativePoint {
                        x: release_cursor.x as f64,
                        y: release_cursor.y as f64,
                    },
                    snap_scale,
                ),
                Err(error) => {
                    log::warn!(
                        "panel_drag releasedBeforeStartCursorFailed gestureId={} error={error}",
                        geometry.gesture_id
                    );
                    None
                }
            }
        } else {
            None
        };
        if let Some(payload) = controller.machine.lock().finish_start(
            &geometry.gesture_id,
            PanelDragOutcome::ReleasedBeforeStart,
            would_snap_back,
        ) {
            return OwnerStartResult {
                presented,
                status: OwnerStartStatus::Finished(payload),
            };
        }
        return owner_start_failure(
            controller,
            &geometry.gesture_id,
            presented,
            panel_drag_error(
                PanelDragErrorCode::DragStartFailed,
                "panel drag gesture ended before native start",
            ),
        );
    }

    if let Err(error) = unsafe { ReleaseCapture() } {
        unsafe { cleanup_native_hook(context) };
        return owner_start_failure(
            controller,
            &geometry.gesture_id,
            presented,
            panel_drag_error(
                PanelDragErrorCode::DragStartFailed,
                format!("failed to release mouse capture: {error}"),
            ),
        );
    }
    let hwnd = windows_hwnd((*context).hwnd);
    let lparam = LPARAM(pack_cursor_lparam(cursor.x, cursor.y));
    if let Err(error) = unsafe {
        PostMessageW(
            Some(hwnd),
            WM_NCLBUTTONDOWN,
            WPARAM(HTCAPTION as usize),
            lparam,
        )
    } {
        unsafe { cleanup_native_hook(context) };
        return owner_start_failure(
            controller,
            &geometry.gesture_id,
            presented,
            panel_drag_error(
                PanelDragErrorCode::DragStartFailed,
                format!("failed to post the native drag message: {error}"),
            ),
        );
    }

    OwnerStartResult {
        presented,
        status: OwnerStartStatus::Waiting,
    }
}

#[cfg(target_os = "windows")]
fn owner_start_failure(
    controller: &PanelDragController,
    gesture_id: &str,
    presented: bool,
    error: PanelDragError,
) -> OwnerStartResult {
    unsafe { cleanup_controller_hook(controller) };
    let payload =
        controller
            .machine
            .lock()
            .finish_start(gesture_id, PanelDragOutcome::StartFailed, None);
    OwnerStartResult {
        presented,
        status: OwnerStartStatus::Failed { error, payload },
    }
}

#[cfg(target_os = "windows")]
fn main_press_native(
    app: &AppHandle,
    press_client_css: PanelDragPoint,
    main_scale: f64,
    zoom_residual: f64,
) -> Result<(NativePoint, f64), PanelDragError> {
    let main = app.get_webview_window("main").ok_or_else(|| {
        panel_drag_error(
            PanelDragErrorCode::MonitorUnavailable,
            "main window is unavailable for snapBack",
        )
    })?;
    let origin = main.inner_position().map_err(|error| {
        panel_drag_error(
            PanelDragErrorCode::MonitorUnavailable,
            format!("failed to read the main content origin: {error}"),
        )
    })?;
    let scale = main_scale * zoom_residual;
    let point = NativePoint {
        x: origin.x as f64 + press_client_css.x * scale,
        y: origin.y as f64 + press_client_css.y * scale,
    };
    if !point.x.is_finite() || !point.y.is_finite() {
        return Err(panel_drag_error(
            PanelDragErrorCode::InvalidGeometry,
            "snapBack origin conversion failed",
        ));
    }
    Ok((point, scale))
}

#[cfg(target_os = "windows")]
fn main_drag_scale(
    app: &AppHandle,
    geometry: &PanelDragGeometry,
) -> Result<(f64, f64), PanelDragError> {
    let main = app.get_webview_window("main").ok_or_else(|| {
        panel_drag_error(
            PanelDragErrorCode::MonitorUnavailable,
            "main window is unavailable for panel drag scaling",
        )
    })?;
    let main_scale = main
        .scale_factor()
        .ok()
        .filter(|scale| scale_is_usable(*scale))
        .ok_or_else(|| {
            panel_drag_error(
                PanelDragErrorCode::MonitorUnavailable,
                "main window scale is unavailable for panel drag scaling",
            )
        })?;
    let zoom_residual = calculate_zoom_residual(geometry.main_device_pixel_ratio, main_scale)
        .unwrap_or_else(|| {
            log::warn!(
                "panel_drag zoomResidualFallback gestureId={} mainDevicePixelRatio={} mainScale={} zoomResidual=1",
                geometry.gesture_id,
                geometry.main_device_pixel_ratio,
                main_scale,
            );
            1.0
        });
    log::debug!(
        "panel_drag coordinateScale gestureId={} mainDevicePixelRatio={} mainScale={} zoomResidual={}",
        geometry.gesture_id,
        geometry.main_device_pixel_ratio,
        main_scale,
        zoom_residual,
    );
    Ok((main_scale, zoom_residual))
}

#[cfg(target_os = "windows")]
fn tao_undecorated_shadow_seed_inset(target_scale: f64) -> Option<NativePoint> {
    use windows::Win32::UI::{
        HiDpi::GetSystemMetricsForDpi,
        WindowsAndMessaging::{SM_CXPADDEDBORDER, SM_CXSIZEFRAME},
    };

    let dpi = target_monitor_dpi(target_scale)?;
    let resize_frame_thickness = unsafe { GetSystemMetricsForDpi(SM_CXSIZEFRAME, dpi) };
    let padding_thickness = unsafe { GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi) };
    let insets = tao_undecorated_shadow_insets(
        dpi,
        resize_frame_thickness,
        padding_thickness,
        windows_build_number(),
    );
    Some(NativePoint {
        x: insets.left as f64,
        y: insets.top as f64,
    })
}

#[cfg(target_os = "windows")]
fn windows_build_number() -> u32 {
    use std::{mem::size_of, sync::OnceLock};

    #[repr(C)]
    struct OsVersionInfoW {
        size: u32,
        major: u32,
        minor: u32,
        build: u32,
        platform_id: u32,
        service_pack: [u16; 128],
    }

    #[link(name = "ntdll")]
    unsafe extern "system" {
        #[link_name = "RtlGetVersion"]
        fn rtl_get_version(version_info: *mut OsVersionInfoW) -> i32;
    }

    static BUILD: OnceLock<u32> = OnceLock::new();
    *BUILD.get_or_init(|| {
        let mut version_info: OsVersionInfoW = unsafe { std::mem::zeroed() };
        version_info.size = size_of::<OsVersionInfoW>() as u32;
        let status = unsafe { rtl_get_version(&mut version_info) };
        if status >= 0 {
            version_info.build
        } else {
            0
        }
    })
}

#[cfg(target_os = "windows")]
unsafe fn ensure_native_observer(
    app: &AppHandle,
    controller: &PanelDragController,
    window: &tauri::WebviewWindow,
) -> Result<*mut NativeDragContext, PanelDragError> {
    use windows::Win32::UI::Shell::SetWindowSubclass;

    const SUBCLASS_ID: usize = 0x444d_5044;

    let hwnd = window.hwnd().map_err(|error| {
        panel_drag_error(
            PanelDragErrorCode::DragStartFailed,
            format!("failed to get the panel HWND: {error}"),
        )
    })?;
    let hwnd_value = hwnd.0 as usize;
    let existing = controller.native_context.load(Ordering::Acquire);
    if existing != 0 {
        let context = existing as *mut NativeDragContext;
        if unsafe { (*context).hwnd } == hwnd_value {
            return Ok(context);
        }
        return Err(panel_drag_error(
            PanelDragErrorCode::DragStartFailed,
            "panel drag observer belongs to another HWND",
        ));
    }

    let context = Box::new(NativeDragContext {
        app: app.clone(),
        machine: Arc::clone(&controller.machine),
        identity: Arc::clone(&controller.native_context),
        hwnd: hwnd_value,
        hook: AtomicUsize::new(0),
    });
    let context = Box::into_raw(context);
    let installed = unsafe {
        SetWindowSubclass(
            hwnd,
            Some(panel_drag_subclass_proc),
            SUBCLASS_ID,
            context as usize,
        )
    };
    if !installed.as_bool() {
        unsafe { drop(Box::from_raw(context)) };
        return Err(panel_drag_error(
            PanelDragErrorCode::DragStartFailed,
            "failed to install the panel drag HWND observer",
        ));
    }
    controller
        .native_context
        .store(context as usize, Ordering::Release);
    Ok(context)
}

#[cfg(target_os = "windows")]
unsafe fn install_native_hook(context: *mut NativeDragContext) -> Result<(), PanelDragError> {
    use windows::Win32::{
        System::Threading::GetCurrentThreadId,
        UI::WindowsAndMessaging::{SetWindowsHookExW, WH_GETMESSAGE},
    };

    if unsafe { (*context).hook.load(Ordering::Acquire) } != 0 {
        return Err(panel_drag_error(
            PanelDragErrorCode::DragStartFailed,
            "panel drag Escape hook is already installed",
        ));
    }
    let occupied = HOOK_CONTEXT.with(|slot| {
        let current = slot.get();
        if current.is_null() || current == context {
            slot.set(context);
            false
        } else {
            true
        }
    });
    if occupied {
        return Err(panel_drag_error(
            PanelDragErrorCode::DragStartFailed,
            "another panel drag Escape hook is active",
        ));
    }
    let hook = match unsafe {
        SetWindowsHookExW(
            WH_GETMESSAGE,
            Some(panel_drag_message_hook),
            None,
            GetCurrentThreadId(),
        )
    } {
        Ok(hook) => hook,
        Err(error) => {
            HOOK_CONTEXT.with(|slot| {
                if slot.get() == context {
                    slot.set(std::ptr::null_mut());
                }
            });
            return Err(panel_drag_error(
                PanelDragErrorCode::DragStartFailed,
                format!("failed to install the panel drag Escape hook: {error}"),
            ));
        }
    };
    unsafe { (*context).hook.store(hook.0 as usize, Ordering::Release) };
    Ok(())
}

#[cfg(target_os = "windows")]
unsafe fn cleanup_native_hook(context: *mut NativeDragContext) {
    use windows::Win32::UI::WindowsAndMessaging::{UnhookWindowsHookEx, HHOOK};

    if context.is_null() {
        return;
    }
    let hook = unsafe { (*context).hook.swap(0, Ordering::AcqRel) };
    if hook != 0 {
        let _ = unsafe { UnhookWindowsHookEx(HHOOK(hook as *mut std::ffi::c_void)) };
    }
    HOOK_CONTEXT.with(|slot| {
        if slot.get() == context {
            slot.set(std::ptr::null_mut());
        }
    });
}

#[cfg(target_os = "windows")]
unsafe fn cleanup_controller_hook(controller: &PanelDragController) {
    let context = controller.native_context.load(Ordering::Acquire) as *mut NativeDragContext;
    if !context.is_null() {
        unsafe { cleanup_native_hook(context) };
    }
}

#[cfg(target_os = "windows")]
fn schedule_native_hook_cleanup(app: &AppHandle, identity: Arc<AtomicUsize>) {
    if identity.load(Ordering::Acquire) == 0 {
        return;
    }
    if let Err(error) = app.run_on_main_thread(move || {
        let context = identity.load(Ordering::Acquire) as *mut NativeDragContext;
        if !context.is_null() {
            unsafe { cleanup_native_hook(context) };
            let hwnd = unsafe { windows_hwnd((*context).hwnd) };
            let _ = unsafe {
                windows::Win32::UI::WindowsAndMessaging::SendMessageW(
                    hwnd,
                    windows::Win32::UI::WindowsAndMessaging::WM_CANCELMODE,
                    None,
                    None,
                )
            };
        }
    }) {
        log::warn!("panel_drag hookCleanupDispatchFailed error={error}");
    }
}

#[cfg(target_os = "windows")]
async fn resolve_start_timeout(
    app: &AppHandle,
    controller: Arc<PanelDragController>,
    gesture_id: &str,
) -> Result<(), PanelDragError> {
    let (sender, receiver) = oneshot::channel();
    let owner_controller = Arc::clone(&controller);
    let gesture_id_owned = gesture_id.to_string();
    if let Err(error) = app.run_on_main_thread(move || {
        let resolution = owner_controller
            .machine
            .lock()
            .resolve_timeout(&gesture_id_owned);
        if matches!(resolution, TimeoutResolution::Failed(_)) {
            unsafe { cleanup_controller_hook(&owner_controller) };
        }
        let _ = sender.send(resolution);
    }) {
        let payload =
            controller
                .machine
                .lock()
                .finish_start(gesture_id, PanelDragOutcome::StartFailed, None);
        if let Some(payload) = payload {
            emit_ended(app, payload);
        }
        log::warn!(
            "panel_drag startFailed gestureId={gesture_id} code=DRAG_START_NOT_OBSERVED dispatchError={error}"
        );
        return Err(panel_drag_error(
            PanelDragErrorCode::DragStartNotObserved,
            "native panel drag start was not observed",
        ));
    }
    match receiver.await.unwrap_or(TimeoutResolution::Stale) {
        TimeoutResolution::Started => Ok(()),
        TimeoutResolution::Failed(payload) => {
            emit_ended(app, payload);
            log::warn!(
                "panel_drag startFailed gestureId={gesture_id} code=DRAG_START_NOT_OBSERVED"
            );
            Err(panel_drag_error(
                PanelDragErrorCode::DragStartNotObserved,
                "native panel drag start was not observed",
            ))
        }
        TimeoutResolution::Stale => Err(panel_drag_error(
            PanelDragErrorCode::DragStartNotObserved,
            "native panel drag start observer became stale",
        )),
    }
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn panel_drag_subclass_proc(
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
        WindowsAndMessaging::{
            SendMessageW, WM_CANCELMODE, WM_ENTERSIZEMOVE, WM_EXITSIZEMOVE, WM_NCDESTROY,
        },
    };

    catch_unwind(AssertUnwindSafe(|| unsafe {
        let context = reference_data as *mut NativeDragContext;
        if context.is_null() {
            return DefSubclassProc(hwnd, message, wparam, lparam);
        }
        match message {
            WM_ENTERSIZEMOVE => {
                let observed = (*context).machine.lock().observe_enter();
                if let Some((gesture_id, origin, sender)) = observed {
                    log_transition(
                        &gesture_id,
                        GesturePhase::Starting.as_str(),
                        GesturePhase::Dragging.as_str(),
                        origin,
                        None,
                    );
                    let _ = sender.send(());
                } else {
                    let _ = SendMessageW(hwnd, WM_CANCELMODE, None, None);
                }
            }
            WM_EXITSIZEMOVE => {
                let payload = (*context).machine.lock().finish_native_exit();
                cleanup_native_hook(context);
                if let Some(payload) = payload {
                    emit_ended(&(*context).app, payload);
                }
            }
            WM_NCDESTROY => {
                let payload = (*context).machine.lock().finish_window_destroyed();
                cleanup_native_hook(context);
                let _ = RemoveWindowSubclass(hwnd, Some(panel_drag_subclass_proc), subclass_id);
                (*context).identity.store(0, Ordering::Release);
                if let Some(payload) = payload {
                    emit_ended(&(*context).app, payload);
                }
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

#[cfg(target_os = "windows")]
unsafe extern "system" fn panel_drag_message_hook(
    code: i32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use std::panic::{catch_unwind, AssertUnwindSafe};
    use windows::Win32::UI::{
        Input::KeyboardAndMouse::VK_ESCAPE,
        WindowsAndMessaging::{CallNextHookEx, MSG, WM_KEYDOWN, WM_SYSKEYDOWN},
    };

    let _ = catch_unwind(AssertUnwindSafe(|| unsafe {
        if code < 0 || lparam.0 == 0 {
            return;
        }
        let message = &*(lparam.0 as *const MSG);
        if matches!(message.message, WM_KEYDOWN | WM_SYSKEYDOWN)
            && message.wParam.0 == VK_ESCAPE.0 as usize
        {
            HOOK_CONTEXT.with(|slot| {
                if let Some(context) = slot.get().as_ref() {
                    context.machine.lock().latch_escape();
                }
            });
        }
    }));
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

#[cfg(target_os = "windows")]
fn windows_hwnd(value: usize) -> windows::Win32::Foundation::HWND {
    windows::Win32::Foundation::HWND(value as *mut std::ffi::c_void)
}

#[cfg(target_os = "windows")]
fn checked_native_coordinate(value: f64) -> Option<i32> {
    if !value.is_finite() || value < i32::MIN as f64 || value > i32::MAX as f64 {
        return None;
    }
    Some(value.round() as i32)
}

#[cfg(target_os = "windows")]
fn pack_cursor_lparam(x: i32, y: i32) -> isize {
    let packed = (x as u32 & 0xffff) | ((y as u32 & 0xffff) << 16);
    packed as isize
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geometry(origin: PanelDragOrigin) -> PanelDragGeometry {
        PanelDragGeometry {
            gesture_id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            origin,
            grab_offset_css: PanelDragPoint { x: 24.0, y: 18.0 },
            dock_area_css: Some(PanelDragRect {
                x: 620.0,
                y: 40.0,
                width: 288.0,
                height: 420.0,
            }),
            press_client_css: PanelDragPoint { x: 700.0, y: 60.0 },
            main_device_pixel_ratio: 1.5,
            panel_device_pixel_ratio: Some(1.5),
        }
    }

    #[test]
    fn geometry_rejects_non_uuid_and_non_finite_values() {
        let mut invalid_id = geometry(PanelDragOrigin::Docked);
        invalid_id.gesture_id = "gesture-1".to_string();
        assert_eq!(
            invalid_id.validate().unwrap_err().error_code,
            PanelDragErrorCode::InvalidGeometry
        );

        let mut invalid_rect = geometry(PanelDragOrigin::Detached);
        invalid_rect.dock_area_css.as_mut().unwrap().width = f64::NAN;
        assert_eq!(
            invalid_rect.validate().unwrap_err().error_code,
            PanelDragErrorCode::InvalidGeometry
        );
    }

    #[test]
    fn gesture_machine_allows_only_one_active_gesture() {
        let mut machine = GestureMachine::default();
        let first = geometry(PanelDragOrigin::Docked);
        machine.begin(&first).unwrap();

        let mut second = geometry(PanelDragOrigin::Detached);
        second.gesture_id = "6ba7b810-9dad-11d1-80b4-00c04fd430c8".to_string();
        assert_eq!(
            machine.begin(&second).unwrap_err().error_code,
            PanelDragErrorCode::DragStartFailed
        );
    }

    #[test]
    fn cleared_presenting_gesture_rejects_delayed_owner_start() {
        let mut machine = GestureMachine::default();
        let geometry = geometry(PanelDragOrigin::Docked);
        machine.begin(&geometry).unwrap();
        assert!(machine.is_presenting(&geometry.gesture_id));

        machine.clear();
        assert!(!machine.is_presenting(&geometry.gesture_id));
        let (sender, _receiver) = oneshot::channel();
        assert_eq!(
            machine
                .prepare_starting(&geometry.gesture_id, None, None, 1.0, sender)
                .unwrap_err()
                .error_code,
            PanelDragErrorCode::DragStartFailed
        );
    }

    #[test]
    fn cleared_starting_gesture_rejects_late_native_enter() {
        let mut machine = GestureMachine::default();
        let geometry = geometry(PanelDragOrigin::Detached);
        machine.begin(&geometry).unwrap();
        let (sender, _receiver) = oneshot::channel();
        machine
            .prepare_starting(&geometry.gesture_id, None, None, 1.0, sender)
            .unwrap();
        machine.clear();

        assert!(machine.observe_enter().is_none());
        assert!(machine.finish_native_exit().is_none());
    }

    #[test]
    fn gesture_machine_requires_presenting_starting_dragging_order() {
        let mut machine = GestureMachine::default();
        let geometry = geometry(PanelDragOrigin::Docked);
        machine.begin(&geometry).unwrap();
        let (sender, mut receiver) = oneshot::channel();
        machine
            .prepare_starting(
                &geometry.gesture_id,
                Some(NativePoint { x: 300.0, y: 200.0 }),
                Some(1.5),
                1.0,
                sender,
            )
            .unwrap();
        let (_, _, sender) = machine.observe_enter().unwrap();
        sender.send(()).unwrap();
        assert!(matches!(receiver.try_recv(), Ok(())));

        let ended = machine.finish_native_exit().unwrap();
        assert_eq!(ended.outcome, PanelDragOutcome::Released);
        assert_eq!(ended.would_snap_back, None);
        assert!(machine.active.is_none());
        assert!(machine
            .take_released(&geometry.gesture_id, PanelDragOrigin::Docked)
            .is_some());
        assert!(machine
            .take_released(&geometry.gesture_id, PanelDragOrigin::Docked)
            .is_none());
    }

    #[test]
    fn disarm_stops_dock_area_evaluation_without_a_synthetic_hint() {
        let mut machine = GestureMachine::default();
        let geometry = geometry(PanelDragOrigin::Detached);
        machine.begin(&geometry).unwrap();
        let (sender, _receiver) = oneshot::channel();
        machine
            .prepare_starting(&geometry.gesture_id, None, None, 1.0, sender)
            .unwrap();
        let _ = machine.observe_enter().unwrap();
        assert!(machine.update_hint(&geometry.gesture_id, true).is_some());
        assert!(machine.disarm_dock_zone(&geometry.gesture_id));
        let (_, dock_area, _) = machine.dock_snapshot().unwrap();
        assert_eq!(dock_area, None);
        assert_eq!(machine.active.as_ref().unwrap().last_hint, Some(true));
        assert!(!machine.disarm_dock_zone(&geometry.gesture_id));
    }

    #[test]
    fn start_timeout_clears_the_active_gesture() {
        let mut machine = GestureMachine::default();
        let geometry = geometry(PanelDragOrigin::Detached);
        machine.begin(&geometry).unwrap();
        let (sender, _receiver) = oneshot::channel();
        machine
            .prepare_starting(&geometry.gesture_id, None, None, 1.0, sender)
            .unwrap();

        let TimeoutResolution::Failed(payload) = machine.resolve_timeout(&geometry.gesture_id)
        else {
            panic!("starting gesture must fail on timeout");
        };
        assert_eq!(payload.outcome, PanelDragOutcome::StartFailed);
        assert_eq!(payload.would_snap_back, None);
        assert!(machine.active.is_none());
    }

    #[test]
    fn escaped_exit_does_not_leave_a_hit_test_receipt() {
        let mut machine = GestureMachine::default();
        let geometry = geometry(PanelDragOrigin::Docked);
        machine.begin(&geometry).unwrap();
        let (sender, _receiver) = oneshot::channel();
        machine
            .prepare_starting(
                &geometry.gesture_id,
                Some(NativePoint { x: 100.0, y: 80.0 }),
                Some(2.0),
                1.0,
                sender,
            )
            .unwrap();
        let _ = machine.observe_enter().unwrap();
        machine.latch_escape();

        let payload = machine.finish_native_exit().unwrap();
        assert_eq!(payload.outcome, PanelDragOutcome::Escaped);
        assert!(machine
            .take_released(&geometry.gesture_id, geometry.origin)
            .is_none());
    }

    #[test]
    fn dock_area_uses_main_inner_origin_and_main_scale() {
        let rect = dock_rect_native(
            NativePoint {
                x: 1920.0,
                y: -180.0,
            },
            1.5,
            1.0,
            PanelDragRect {
                x: 600.0,
                y: 20.0,
                width: 240.0,
                height: 400.0,
            },
        )
        .unwrap();
        assert_eq!(rect.x, 2820.0);
        assert_eq!(rect.y, -150.0);
        assert_eq!(rect.width, 360.0);
        assert_eq!(rect.height, 600.0);
        assert!(point_in_rect(
            NativePoint {
                x: 3180.0,
                y: 450.0,
            },
            rect
        ));
    }

    #[test]
    fn main_zoom_residual_applies_to_dock_css_lengths() {
        assert_eq!(calculate_zoom_residual(1.8, 1.5), Some(1.2));
        assert_eq!(calculate_zoom_residual(0.1, 1.0), None);
        assert_eq!(calculate_zoom_residual(5.0, 1.0), None);
        assert_eq!(calculate_zoom_residual(f64::NAN, 1.0), None);
        assert_eq!(calculate_zoom_residual(1.0, 0.0), None);

        let rect = dock_rect_native(
            NativePoint { x: 100.0, y: 50.0 },
            1.5,
            1.2,
            PanelDragRect {
                x: 10.0,
                y: 20.0,
                width: 30.0,
                height: 40.0,
            },
        )
        .unwrap();
        assert_eq!((rect.x, rect.y), (118.0, 86.0));
        assert!((rect.width - 54.0).abs() < 1e-9);
        assert_eq!(rect.height, 72.0);
    }

    #[test]
    fn panel_seed_follows_panel_residual_when_zoom_failures_are_asymmetric() {
        let cursor = NativePoint {
            x: 1_000.0,
            y: 800.0,
        };
        let grab_offset_css = PanelDragPoint { x: 24.0, y: 18.0 };
        let inset = NativePoint { x: 8.0, y: 2.0 };
        let main_residual = calculate_zoom_residual(1.2, 1.5).unwrap();
        let panel_residual = resolve_panel_seed_residual(Some(1.8), Some(1.5), main_residual);

        let seeded =
            seed_panel_position_native(cursor, grab_offset_css, 2.0, panel_residual, inset);
        let seeded_with_main =
            seed_panel_position_native(cursor, grab_offset_css, 2.0, main_residual, inset);

        assert!((seeded.x - 934.4).abs() < 1e-9);
        assert!((seeded.y - 754.8).abs() < 1e-9);
        assert_ne!(seeded, seeded_with_main);
    }

    #[test]
    fn panel_seed_matches_main_result_when_zoom_failures_are_symmetric() {
        let cursor = NativePoint {
            x: 1_000.0,
            y: 800.0,
        };
        let grab_offset_css = PanelDragPoint { x: 24.0, y: 18.0 };
        let inset = NativePoint { x: 8.0, y: 2.0 };
        let main_residual = calculate_zoom_residual(1.8, 1.5).unwrap();
        let panel_residual = resolve_panel_seed_residual(Some(2.4), Some(2.0), main_residual);

        let panel_seed =
            seed_panel_position_native(cursor, grab_offset_css, 2.0, panel_residual, inset);
        let main_seed =
            seed_panel_position_native(cursor, grab_offset_css, 2.0, main_residual, inset);
        assert!((panel_residual - main_residual).abs() < 1e-9);
        assert!((panel_seed.x - main_seed.x).abs() < 1e-9);
        assert!((panel_seed.y - main_seed.y).abs() < 1e-9);
    }

    #[test]
    fn missing_panel_dpr_uses_main_residual_without_reinterpreting_main_dpr() {
        let geometry: PanelDragGeometry = serde_json::from_value(serde_json::json!({
            "gestureId": "550e8400-e29b-41d4-a716-446655440000",
            "origin": "docked",
            "grabOffsetCss": { "x": 24.0, "y": 18.0 },
            "dockAreaCss": null,
            "pressClientCss": { "x": 700.0, "y": 60.0 },
            "mainDevicePixelRatio": 1.0,
            "panelDevicePixelRatio": null
        }))
        .unwrap();
        let main_residual = calculate_zoom_residual(geometry.main_device_pixel_ratio, 1.0).unwrap();

        assert_eq!(geometry.panel_device_pixel_ratio, None);
        assert_eq!(
            resolve_panel_seed_residual(
                geometry.panel_device_pixel_ratio,
                Some(2.0),
                main_residual,
            ),
            main_residual
        );
        assert_eq!(
            resolve_panel_seed_residual(
                Some(geometry.main_device_pixel_ratio),
                Some(2.0),
                main_residual,
            ),
            0.5
        );
    }

    #[test]
    fn tao_0353_undecorated_shadow_insets_match_common_dpi_metrics() {
        assert_eq!(target_monitor_dpi(1.0), Some(96));
        assert_eq!(target_monitor_dpi(1.5), Some(144));
        assert_eq!(target_monitor_dpi(2.0), Some(192));
        assert_eq!(target_monitor_dpi(0.0), None);
        assert_eq!(target_monitor_dpi(f64::NAN), None);

        for (scale, resize_frame, padding, side, top) in
            [(1.0, 4, 4, 8, 1), (1.5, 6, 6, 12, 2), (2.0, 8, 8, 16, 2)]
        {
            let dpi = target_monitor_dpi(scale).unwrap();
            assert_eq!(
                tao_undecorated_shadow_insets(dpi, resize_frame, padding, 22_000),
                UndecoratedShadowInsets {
                    left: side,
                    top,
                    right: side,
                    bottom: side,
                }
            );
            assert_eq!(side as f64 / scale, 8.0);
        }

        assert_eq!(
            tao_undecorated_shadow_insets(96, 4, 4, 19_045),
            UndecoratedShadowInsets {
                left: 8,
                top: 0,
                right: 8,
                bottom: 8,
            }
        );
    }

    #[test]
    fn snap_back_distance_uses_the_starting_main_scale() {
        let start = NativePoint { x: 100.0, y: 50.0 };
        assert!(within_snap_back(
            start,
            NativePoint { x: 145.0, y: 50.0 },
            1.5
        ));
        assert!(!within_snap_back(
            start,
            NativePoint { x: 145.1, y: 50.0 },
            1.5
        ));
    }

    #[test]
    fn released_before_start_reports_snap_back_distance() {
        let start = Some(NativePoint { x: 100.0, y: 50.0 });
        assert_eq!(
            released_before_start_snap_back(start, NativePoint { x: 145.0, y: 50.0 }, Some(1.5),),
            Some(true)
        );
        assert_eq!(
            released_before_start_snap_back(start, NativePoint { x: 145.1, y: 50.0 }, Some(1.5),),
            Some(false)
        );
    }

    #[test]
    fn escape_latch_classifies_native_exit() {
        assert_eq!(classify_native_outcome(false), PanelDragOutcome::Released);
        assert_eq!(classify_native_outcome(true), PanelDragOutcome::Escaped);
    }

    #[test]
    fn event_payloads_use_the_frontend_serde_names() {
        assert_eq!(
            serde_json::to_value(PanelDragEndedPayload {
                gesture_id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
                outcome: PanelDragOutcome::ReleasedBeforeStart,
                would_snap_back: Some(true),
            })
            .unwrap(),
            serde_json::json!({
                "gestureId": "550e8400-e29b-41d4-a716-446655440000",
                "outcome": "releasedBeforeStart",
                "wouldSnapBack": true
            })
        );
        assert_eq!(
            serde_json::to_value(PanelDragEndedPayload {
                gesture_id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
                outcome: PanelDragOutcome::Released,
                would_snap_back: None,
            })
            .unwrap(),
            serde_json::json!({
                "gestureId": "550e8400-e29b-41d4-a716-446655440000",
                "outcome": "released"
            })
        );
        assert_eq!(
            serde_json::to_value(PanelDragHintPayload {
                gesture_id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
                would_dock: true,
            })
            .unwrap(),
            serde_json::json!({
                "gestureId": "550e8400-e29b-41d4-a716-446655440000",
                "wouldDock": true
            })
        );
    }
}
