use super::*;

impl AppState {
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

    pub(super) fn authorize_process_exit(&self) {
        self.process_exit_authorized.store(true, Ordering::SeqCst);
    }

    pub fn request_frontend_shutdown(&self, app_handle: AppHandle) {
        self.request_frontend_lifecycle(app_handle, FrontendLifecycleAction::Quit);
    }

    pub fn request_frontend_restart(&self, app_handle: AppHandle) {
        self.request_frontend_lifecycle(app_handle, FrontendLifecycleAction::Restart);
    }

    #[cfg(target_os = "windows")]
    pub(super) fn frontend_lifecycle_pending(&self) -> bool {
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
                if let Err(error) =
                    crate::state::window::macos_termination::cancel_pending_termination(app_handle)
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
}
