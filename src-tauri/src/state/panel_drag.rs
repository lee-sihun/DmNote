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

#[cfg(test)]
mod tests;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
use windows::schedule_native_hook_cleanup;
#[cfg(target_os = "windows")]
pub use windows::start_windows_drag;

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
