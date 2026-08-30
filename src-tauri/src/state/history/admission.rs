use std::sync::{
    atomic::{AtomicU64, AtomicUsize, Ordering},
    Arc,
};

use parking_lot::{Condvar, Mutex};

use super::HISTORY_IN_PROGRESS;

const HISTORY_GATE_CLOSED_BIT: u64 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct HistoryAdmission {
    generation: u64,
}

#[derive(Debug, Default)]
pub(crate) struct HistoryAdmissionGate {
    generation: AtomicU64,
    active_mutations: AtomicUsize,
    drain_lock: Mutex<()>,
    drain_ready: Condvar,
    owner: Mutex<Option<String>>,
}

impl HistoryAdmissionGate {
    pub(crate) fn admit_mutation(self: &Arc<Self>) -> Result<HistoryAdmissionLease, String> {
        let generation = self.generation.load(Ordering::Acquire);
        if generation & HISTORY_GATE_CLOSED_BIT != 0 {
            return Err(HISTORY_IN_PROGRESS.to_string());
        }

        self.active_mutations.fetch_add(1, Ordering::AcqRel);
        let admitted_generation = self.generation.load(Ordering::Acquire);
        if admitted_generation != generation || admitted_generation & HISTORY_GATE_CLOSED_BIT != 0 {
            self.release_mutation();
            return Err(HISTORY_IN_PROGRESS.to_string());
        }

        Ok(HistoryAdmissionLease {
            gate: Arc::clone(self),
            admission: HistoryAdmission { generation },
        })
    }

    pub(crate) fn try_admit(&self) -> Result<HistoryAdmission, String> {
        let generation = self.generation.load(Ordering::Acquire);
        if generation & HISTORY_GATE_CLOSED_BIT != 0 {
            return Err(HISTORY_IN_PROGRESS.to_string());
        }
        Ok(HistoryAdmission { generation })
    }

    pub(crate) fn revalidate(&self, admission: HistoryAdmission) -> Result<(), String> {
        let generation = self.generation.load(Ordering::Acquire);
        if generation != admission.generation || generation & HISTORY_GATE_CLOSED_BIT != 0 {
            return Err(HISTORY_IN_PROGRESS.to_string());
        }
        Ok(())
    }

    pub(crate) fn begin_close(
        self: &Arc<Self>,
        operation_id: &str,
    ) -> Result<HistoryBarrierLease, String> {
        let mut owner = self.owner.lock();
        let generation = self.generation.load(Ordering::Acquire);
        if generation & HISTORY_GATE_CLOSED_BIT != 0 {
            return Err(HISTORY_IN_PROGRESS.to_string());
        }
        self.generation
            .compare_exchange(
                generation,
                generation.saturating_add(1),
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .map_err(|_| HISTORY_IN_PROGRESS.to_string())?;
        *owner = Some(operation_id.to_string());
        Ok(HistoryBarrierLease {
            gate: Arc::clone(self),
            operation_id: operation_id.to_string(),
            closed_generation: generation.saturating_add(1),
        })
    }

    #[cfg(test)]
    pub(crate) fn close(
        self: &Arc<Self>,
        operation_id: &str,
    ) -> Result<HistoryBarrierLease, String> {
        let lease = self.begin_close(operation_id)?;
        lease.wait_for_drain()?;
        Ok(lease)
    }

    fn wait_for_drain(&self, closed_generation: u64) -> Result<(), String> {
        let mut drain_guard = self.drain_lock.lock();
        while self.active_mutations.load(Ordering::Acquire) != 0 {
            if self.generation.load(Ordering::Acquire) != closed_generation {
                return Err(HISTORY_IN_PROGRESS.to_string());
            }
            self.drain_ready.wait(&mut drain_guard);
        }
        if self.generation.load(Ordering::Acquire) != closed_generation {
            return Err(HISTORY_IN_PROGRESS.to_string());
        }
        Ok(())
    }

    pub(crate) fn is_closed(&self) -> bool {
        self.generation.load(Ordering::Acquire) & HISTORY_GATE_CLOSED_BIT != 0
    }

    fn release_mutation(&self) {
        let previous = self.active_mutations.fetch_sub(1, Ordering::AcqRel);
        debug_assert!(previous > 0, "history admission lease underflow");
        if previous == 1 {
            let _drain_guard = self.drain_lock.lock();
            self.drain_ready.notify_all();
        }
    }

    #[cfg(test)]
    pub(crate) fn owner(&self) -> Option<String> {
        self.owner.lock().clone()
    }

    #[cfg(test)]
    pub(crate) fn active_mutations(&self) -> usize {
        self.active_mutations.load(Ordering::Acquire)
    }
}

#[derive(Debug)]
pub(crate) struct HistoryAdmissionLease {
    gate: Arc<HistoryAdmissionGate>,
    admission: HistoryAdmission,
}

impl HistoryAdmissionLease {
    pub(crate) fn revalidate_for(&self, gate: &Arc<HistoryAdmissionGate>) -> Result<(), String> {
        if !Arc::ptr_eq(&self.gate, gate) {
            return Err(HISTORY_IN_PROGRESS.to_string());
        }
        gate.revalidate(self.admission)
    }
}

impl Drop for HistoryAdmissionLease {
    fn drop(&mut self) {
        self.gate.release_mutation();
    }
}

pub(crate) struct HistoryBarrierLease {
    gate: Arc<HistoryAdmissionGate>,
    operation_id: String,
    closed_generation: u64,
}

#[derive(Clone)]
pub(crate) struct HistoryBarrierWaiter {
    gate: Arc<HistoryAdmissionGate>,
    closed_generation: u64,
}

impl HistoryBarrierLease {
    pub(crate) fn waiter(&self) -> HistoryBarrierWaiter {
        HistoryBarrierWaiter {
            gate: Arc::clone(&self.gate),
            closed_generation: self.closed_generation,
        }
    }

    #[cfg(test)]
    pub(crate) fn wait_for_drain(&self) -> Result<(), String> {
        self.gate.wait_for_drain(self.closed_generation)
    }
}

impl HistoryBarrierWaiter {
    pub(crate) fn wait_for_drain(&self) -> Result<(), String> {
        self.gate.wait_for_drain(self.closed_generation)
    }
}

impl Drop for HistoryBarrierLease {
    fn drop(&mut self) {
        let mut owner = self.gate.owner.lock();
        let generation = self.gate.generation.load(Ordering::Acquire);
        if generation != self.closed_generation {
            log::error!("history admission gate owner changed before release");
            return;
        }
        if owner.as_deref() != Some(self.operation_id.as_str()) {
            log::error!("history admission gate owner changed before release");
        }
        *owner = None;
        self.gate.generation.fetch_add(1, Ordering::Release);
        drop(owner);
        let _drain_guard = self.gate.drain_lock.lock();
        self.gate.drain_ready.notify_all();
    }
}
