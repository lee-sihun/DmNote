use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum GesturePhase {
    #[cfg(any(target_os = "windows", test))]
    Presenting,
    #[cfg(any(target_os = "windows", test))]
    Starting,
    Dragging,
}

impl GesturePhase {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            #[cfg(any(target_os = "windows", test))]
            Self::Presenting => "presenting",
            #[cfg(any(target_os = "windows", test))]
            Self::Starting => "starting",
            Self::Dragging => "dragging",
        }
    }
}

pub(super) struct ActiveGesture {
    pub(super) gesture_id: String,
    pub(super) origin: PanelDragOrigin,
    pub(super) phase: GesturePhase,
    #[cfg(any(target_os = "windows", test))]
    pub(super) start_native: Option<NativePoint>,
    #[cfg(any(target_os = "windows", test))]
    pub(super) snap_scale: Option<f64>,
    #[cfg(any(target_os = "windows", test))]
    pub(super) zoom_residual: Option<f64>,
    pub(super) dock_area_css: Option<PanelDragRect>,
    #[cfg(any(target_os = "windows", test))]
    pub(super) last_hint: Option<bool>,
    #[cfg(any(target_os = "windows", test))]
    pub(super) escape_latched: bool,
    #[cfg(any(target_os = "windows", test))]
    pub(super) enter_sender: Option<oneshot::Sender<()>>,
}

#[derive(Clone, Debug)]
pub(super) struct ReleasedGesture {
    pub(super) gesture_id: String,
    pub(super) origin: PanelDragOrigin,
    pub(super) start_native: Option<NativePoint>,
    pub(super) snap_scale: Option<f64>,
    pub(super) zoom_residual: Option<f64>,
    pub(super) dock_area_css: Option<PanelDragRect>,
}

#[derive(Default)]
pub(super) struct GestureMachine {
    pub(super) active: Option<ActiveGesture>,
    pub(super) released: Option<ReleasedGesture>,
}

#[cfg(any(target_os = "windows", test))]
pub(super) enum TimeoutResolution {
    Started,
    Failed(PanelDragEndedPayload),
    Stale,
}

impl GestureMachine {
    #[cfg(any(target_os = "windows", test))]
    pub(super) fn begin(&mut self, geometry: &PanelDragGeometry) -> Result<(), PanelDragError> {
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
    pub(super) fn prepare_starting(
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
    pub(super) fn is_presenting(&self, gesture_id: &str) -> bool {
        self.active.as_ref().is_some_and(|active| {
            active.gesture_id == gesture_id && active.phase == GesturePhase::Presenting
        })
    }

    #[cfg(any(target_os = "windows", test))]
    pub(super) fn observe_enter(
        &mut self,
    ) -> Option<(String, PanelDragOrigin, oneshot::Sender<()>)> {
        let active = self
            .active
            .as_mut()
            .filter(|active| active.phase == GesturePhase::Starting)?;
        active.phase = GesturePhase::Dragging;
        let sender = active.enter_sender.take()?;
        Some((active.gesture_id.clone(), active.origin, sender))
    }

    #[cfg(any(target_os = "windows", test))]
    pub(super) fn latch_escape(&mut self) {
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
    pub(super) fn finish_native_exit(&mut self) -> Option<PanelDragEndedPayload> {
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
    pub(super) fn finish_start(
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

    pub(super) fn finish_window_destroyed(&mut self) -> Option<PanelDragEndedPayload> {
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
    pub(super) fn resolve_timeout(&mut self, gesture_id: &str) -> TimeoutResolution {
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

    pub(super) fn disarm_dock_zone(&mut self, gesture_id: &str) -> bool {
        let active = self.active.as_mut().filter(|active| {
            active.gesture_id == gesture_id && active.phase == GesturePhase::Dragging
        });
        let Some(active) = active else {
            return false;
        };
        active.dock_area_css.take().is_some()
    }

    #[cfg(any(target_os = "windows", test))]
    pub(super) fn dock_snapshot(&self) -> Option<(String, Option<PanelDragRect>, f64)> {
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
    pub(super) fn update_hint(
        &mut self,
        gesture_id: &str,
        would_dock: bool,
    ) -> Option<PanelDragHintPayload> {
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

    pub(super) fn take_released(
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

    pub(super) fn clear(&mut self) -> Option<(String, PanelDragOrigin, GesturePhase)> {
        let cleared = self
            .active
            .take()
            .map(|active| (active.gesture_id, active.origin, active.phase));
        self.released = None;
        cleared
    }
}
