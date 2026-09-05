use std::{collections::HashSet, sync::Arc, time::Duration};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

use super::FrontendLifecycleAction;
use crate::state::history::{HistoryAdmissionGate, HistoryBarrierLease, HistoryBarrierWaiter};

pub(super) const EDITOR_FLUSH_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
pub(crate) const HISTORY_FRONTEND_FLUSH_BUSY: &str = "HISTORY_FRONTEND_FLUSH_BUSY";
pub(crate) const HISTORY_FRONTEND_FLUSH_CANCELED: &str = "HISTORY_FRONTEND_FLUSH_CANCELED";
pub(crate) const HISTORY_FRONTEND_FLUSH_EMIT_FAILED: &str = "HISTORY_FRONTEND_FLUSH_EMIT_FAILED";
pub(crate) const HISTORY_FRONTEND_FLUSH_INTERRUPTED: &str = "HISTORY_FRONTEND_FLUSH_INTERRUPTED";
pub(crate) const HISTORY_FRONTEND_FLUSH_TIMEOUT: &str = "HISTORY_FRONTEND_FLUSH_TIMEOUT";

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) enum FrontendFlushAction {
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
pub(super) struct EditorFlushRequest {
    pub(super) handshake_id: String,
    pub(super) action: FrontendFlushAction,
}

pub(super) enum EditorFlushCompletion {
    Lifecycle(FrontendLifecycleAction),
    History {
        operation_id: String,
        sender: Option<oneshot::Sender<Result<FrontendHistoryFlushReady, String>>>,
        phase: FrontendHistoryFlushPhase,
        barrier: Option<HistoryBarrierLease>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum FrontendHistoryFlushPhase {
    Collecting,
    Closing,
    Running,
}

impl EditorFlushCompletion {
    pub(super) fn is_lifecycle(&self) -> bool {
        matches!(self, Self::Lifecycle(_))
    }

    pub(super) fn is_history(&self) -> bool {
        matches!(self, Self::History { .. })
    }

    pub(super) fn history_phase(&self) -> Option<FrontendHistoryFlushPhase> {
        match self {
            Self::History { phase, .. } => Some(*phase),
            Self::Lifecycle(_) => None,
        }
    }
}

pub(crate) struct FrontendHistoryFlushReady {
    pub(super) barrier: Option<HistoryBarrierLease>,
    pub(super) complete: Option<Box<dyn FnOnce() + Send>>,
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

pub(super) struct EditorFlushHandshake {
    pub(super) id: String,
    pub(super) completion: EditorFlushCompletion,
    pub(super) target_windows: HashSet<String>,
    pub(super) pending_windows: HashSet<String>,
}

pub(super) fn take_editor_flush_handshake(
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

pub(super) fn take_cancelable_editor_flush_handshake(
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

pub(super) enum EditorFlushAcknowledge {
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

pub(super) fn acknowledge_editor_flush_handshake(
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

pub(super) fn begin_history_gate_close(
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

pub(super) enum LifecycleHandshakeInstall {
    Installed,
    InterruptedHistory(Box<EditorFlushHandshake>),
    LifecycleAlreadyActive,
    DeferredUntilHistoryComplete,
}

pub(super) fn install_lifecycle_handshake(
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

pub(super) fn install_history_handshake(
    slot: &mut Option<EditorFlushHandshake>,
    next: EditorFlushHandshake,
) -> bool {
    if slot.is_some() {
        return false;
    }
    *slot = Some(next);
    true
}

pub(super) fn frontend_history_mutation_blocked(
    slot: &Option<EditorFlushHandshake>,
    window_label: &str,
) -> bool {
    slot.as_ref().is_some_and(|active| {
        active.completion.is_history() && !active.pending_windows.contains(window_label)
    })
}

pub(super) fn emit_frontend_history_flush_released(
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
