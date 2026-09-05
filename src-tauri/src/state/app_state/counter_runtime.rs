use super::*;

impl AppState {
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

    pub(super) fn sync_counters_with_keys_impl(target: &mut KeyCounters, keys: &KeyMappings) {
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
}
