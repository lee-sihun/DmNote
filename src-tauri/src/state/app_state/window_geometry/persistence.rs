use super::*;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(in crate::state::app_state) struct PanelBoundsSample {
    pub(in crate::state::app_state) position: PhysicalPosition<i32>,
    pub(in crate::state::app_state) position_scale_factor: f64,
    pub(in crate::state::app_state) size: PhysicalSize<u32>,
    pub(in crate::state::app_state) size_scale_factor: f64,
    pub(in crate::state::app_state) current_scale_factor: f64,
}

#[derive(Debug, Clone, Copy)]
pub(in crate::state::app_state) enum PanelBoundsChange {
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
    pub(in crate::state::app_state) fn changes_persisted_bounds(self) -> bool {
        !matches!(self, Self::Moved(_))
    }
}

#[derive(Default)]
pub(in crate::state::app_state) struct PanelBoundsPersistenceState {
    pub(in crate::state::app_state) latest: Option<PanelBoundsSample>,
    pub(in crate::state::app_state) window: Option<WebviewWindow>,
    pub(in crate::state::app_state) applied_max_height: Option<f64>,
    // 초기화로 발생한 resize가 비운 저장값을 되살리지 않게 하는 기본 높이 추적
    pub(in crate::state::app_state) unpersisted_default_height: Option<f64>,
    pub(in crate::state::app_state) default_height_pending: bool,
    pub(in crate::state::app_state) session: u64,
    pub(in crate::state::app_state) generation: u64,
    pub(in crate::state::app_state) worker_running: bool,
    // dirty는 워커가 처리할 변경이 남았는지, persist_dirty는 그중 저장까지 필요한지
    pub(in crate::state::app_state) dirty: bool,
    pub(in crate::state::app_state) persist_dirty: bool,
    pub(in crate::state::app_state) active: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(in crate::state::app_state) struct PanelBoundsPersistWork {
    pub(in crate::state::app_state) session: u64,
    pub(in crate::state::app_state) generation: u64,
    pub(in crate::state::app_state) sample: PanelBoundsSample,
    pub(in crate::state::app_state) persist: bool,
}

pub(in crate::state::app_state) struct PanelBoundsPersistenceController {
    store: Arc<AppStore>,
    state: Mutex<PanelBoundsPersistenceState>,
    persist_lock: Mutex<()>,
}

pub(in crate::state::app_state) fn changed_panel_max_height(
    previous: Option<f64>,
    next: f64,
) -> Option<f64> {
    if !next.is_finite() || next <= 0.0 {
        return None;
    }
    if previous.is_some_and(|value| (value - next).abs() < 0.5) {
        return None;
    }
    Some(next)
}

pub(in crate::state::app_state) fn panel_bounds_sample_from_window(
    window: &WebviewWindow,
) -> Result<PanelBoundsSample> {
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    Ok(PanelBoundsSample {
        position: window.outer_position()?,
        position_scale_factor: scale_factor,
        size: window.inner_size()?,
        size_scale_factor: scale_factor,
        current_scale_factor: scale_factor,
    })
}

pub(in crate::state::app_state) fn valid_panel_scale_factor(scale_factor: f64) -> f64 {
    if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    }
}

pub(in crate::state::app_state) fn panel_bounds_from_sample(
    sample: PanelBoundsSample,
) -> PanelBounds {
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

pub(in crate::state::app_state) fn apply_panel_bounds_change(
    sample: &mut PanelBoundsSample,
    change: PanelBoundsChange,
) {
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
    pub(in crate::state::app_state) fn new(store: Arc<AppStore>) -> Self {
        Self {
            store,
            state: Mutex::new(PanelBoundsPersistenceState::default()),
            persist_lock: Mutex::new(()),
        }
    }

    pub(in crate::state::app_state) fn attach(
        &self,
        window: &WebviewWindow,
        max_height: f64,
    ) -> u64 {
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

    pub(in crate::state::app_state) fn record_event(
        self: &Arc<Self>,
        session: u64,
        change: PanelBoundsChange,
    ) {
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

    pub(in crate::state::app_state) fn record_change(
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

    pub(in crate::state::app_state) fn should_persist_change(
        state: &mut PanelBoundsPersistenceState,
        persist: bool,
    ) -> bool {
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
    pub(in crate::state::app_state) fn mark_dirty(
        state: &mut PanelBoundsPersistenceState,
        persist: bool,
    ) -> bool {
        state.generation = state.generation.wrapping_add(1);
        state.dirty = true;
        state.persist_dirty |= persist;
        let should_spawn = !state.worker_running;
        state.worker_running = true;
        should_spawn
    }

    pub(in crate::state::app_state) fn take_dirty_work(
        state: &mut PanelBoundsPersistenceState,
    ) -> Option<PanelBoundsPersistWork> {
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

    pub(in crate::state::app_state) fn work_is_current(
        state: &PanelBoundsPersistenceState,
        work: &PanelBoundsPersistWork,
    ) -> bool {
        state.active && state.session == work.session && state.generation == work.generation
    }

    pub(in crate::state::app_state) fn restore_failed_work(
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

    pub(in crate::state::app_state) fn persist_sample(
        &self,
        sample: PanelBoundsSample,
    ) -> Result<()> {
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

    pub(in crate::state::app_state) fn clear_saved_bounds(
        &self,
        layout: Option<&PanelWindowLayout>,
    ) -> Result<()> {
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

    pub(in crate::state::app_state) fn persist_worker_work(
        &self,
        work: PanelBoundsPersistWork,
    ) -> Result<bool> {
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

    pub(in crate::state::app_state) fn spawn_worker(self: &Arc<Self>) {
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

    pub(in crate::state::app_state) fn apply_monitor_constraints(
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

    pub(in crate::state::app_state) fn flush_now(&self, window: &WebviewWindow) -> Result<()> {
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

    pub(in crate::state::app_state) fn flush_samples(
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

    pub(in crate::state::app_state) fn deactivate(&self, session: u64) {
        let mut state = self.state.lock();
        Self::deactivate_state(&mut state, session);
    }

    pub(in crate::state::app_state) fn deactivate_state(
        state: &mut PanelBoundsPersistenceState,
        session: u64,
    ) -> bool {
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
