use super::*;

impl AppStore {
    #[cfg(test)]
    pub(crate) fn commit_legacy_editor_transaction<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        let key_counters = touched_fields
            .contains(&EditorField::Keys)
            .then(|| self.snapshot().key_counters);
        self.commit_editor_transaction_with_history(
            origin,
            touched_fields,
            EditorTransactionHistoryOptions {
                key_counters,
                ..EditorTransactionHistoryOptions::default()
            },
            updater,
        )
    }

    pub(crate) fn commit_legacy_editor_transaction_with_admission<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        admission: HistoryAdmissionLease,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        self.commit_editor_transaction_with_history_admission(
            origin,
            touched_fields,
            EditorTransactionHistoryOptions::default(),
            admission,
            updater,
        )
    }

    #[cfg(test)]
    pub(crate) fn commit_legacy_editor_reset_transaction_with_admission<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        plugin_instances_reset: PluginInstancesResetScope,
        admission: HistoryAdmissionLease,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        let counters = self.snapshot().key_counters;
        self.commit_legacy_editor_reset_transaction_with_runtime_counters_and_admission(
            origin,
            touched_fields,
            plugin_instances_reset,
            admission,
            Some(&counters),
            updater,
        )
    }

    pub(in crate::state) fn commit_legacy_editor_reset_transaction_with_runtime_counters_admission<
        T,
    >(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        plugin_instances_reset: PluginInstancesResetScope,
        admission: HistoryAdmissionLease,
        runtime_counters: &KeyCounters,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        self.commit_legacy_editor_reset_transaction_with_runtime_counters_and_admission(
            origin,
            touched_fields,
            plugin_instances_reset,
            admission,
            Some(runtime_counters),
            updater,
        )
    }

    fn commit_legacy_editor_reset_transaction_with_runtime_counters_and_admission<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        plugin_instances_reset: PluginInstancesResetScope,
        admission: HistoryAdmissionLease,
        runtime_counters: Option<&KeyCounters>,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        self.commit_editor_transaction_with_history_admission(
            origin,
            touched_fields,
            EditorTransactionHistoryOptions {
                plugin_instances_reset: Some(plugin_instances_reset),
                key_counters: runtime_counters.cloned(),
                ..EditorTransactionHistoryOptions::default()
            },
            admission,
            updater,
        )
    }

    pub(crate) fn commit_legacy_resource_deletion_with_admission<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        admission: HistoryAdmissionLease,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        self.commit_editor_transaction_with_history_admission(
            origin,
            touched_fields,
            EditorTransactionHistoryOptions {
                invalidate_history_on_store_only_change: true,
                ..EditorTransactionHistoryOptions::default()
            },
            admission,
            updater,
        )
    }

    #[cfg(test)]
    pub(crate) fn commit_legacy_resource_deletion<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        self.commit_editor_transaction_with_history(
            origin,
            touched_fields,
            EditorTransactionHistoryOptions {
                invalidate_history_on_store_only_change: true,
                ..EditorTransactionHistoryOptions::default()
            },
            updater,
        )
    }

    #[cfg(test)]
    pub(crate) fn commit_history_overlap_mutation<T>(
        &self,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedHistoryOverlapMutation<T>, EditorCommitError> {
        let admission = self.admit_editor_mutation()?;
        self.commit_history_overlap_mutation_with_admission(admission, updater)
    }

    pub(crate) fn commit_history_overlap_mutation_with_admission<T>(
        &self,
        admission: HistoryAdmissionLease,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedHistoryOverlapMutation<T>, EditorCommitError> {
        let mut guard = self
            .lock_for_update()
            .map_err(|error| EditorCommitError::io(error.to_string()))?;
        admission
            .revalidate_for(&self.history_gate)
            .map_err(|_| EditorCommitError::history_in_progress())?;

        let current_store = guard.data.clone();
        let current_overlap = PresetFullHistorySnapshot::from_store(&current_store);
        let mut scratch = current_store.clone();
        let value = updater(&mut scratch)?;
        if scratch.editor_revision != current_store.editor_revision
            || EditorDocumentV1::from_store(&scratch)
                != EditorDocumentV1::from_store(&current_store)
        {
            return Err(EditorCommitError::validation(
                "UNDECLARED_EDITOR_FIELD",
                "history overlap mutation changed an editor field",
            ));
        }
        let overlap_changed = !current_overlap.matches_store(&scratch);
        if scratch != current_store {
            self.commit_locked(&mut guard, scratch, ())
                .map_err(|error| EditorCommitError::io(error.to_string()))?;
        }
        let history_status = (overlap_changed && guard.history.invalidate_future())
            .then(|| guard.history.issue_status(self.history_gate.is_closed()));
        Ok(AdmittedHistoryOverlapMutation {
            value,
            history_status,
            _admission: admission,
        })
    }

    #[cfg(test)]
    pub(crate) fn commit_preset_editor_transaction<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        current_key_counters: KeyCounters,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        self.commit_editor_transaction_with_history(
            origin,
            touched_fields,
            EditorTransactionHistoryOptions {
                scope: Some(HistoryScope::PresetFull),
                observed_epoch: None,
                key_counters: Some(current_key_counters),
                ..EditorTransactionHistoryOptions::default()
            },
            updater,
        )
    }

    pub(in crate::state) fn commit_preset_editor_transaction_with_admission<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        current_key_counters: KeyCounters,
        admission: HistoryAdmissionLease,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        self.commit_editor_transaction_with_history_admission(
            origin,
            touched_fields,
            EditorTransactionHistoryOptions {
                scope: Some(HistoryScope::PresetFull),
                observed_epoch: None,
                key_counters: Some(current_key_counters),
                ..EditorTransactionHistoryOptions::default()
            },
            admission,
            updater,
        )
    }

    #[cfg(test)]
    pub(crate) fn commit_aux_editor_transaction<T>(
        &self,
        scope: HistoryScope,
        observed_history_epoch: Option<u64>,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        if !matches!(scope, HistoryScope::CustomTabs | HistoryScope::Mode) {
            return Err(EditorCommitError::validation(
                "INVALID_AUX_HISTORY_SCOPE",
                "aux editor transaction requires a custom tabs or mode scope",
            ));
        }
        let key_counters = touched_fields
            .contains(&EditorField::Keys)
            .then(|| self.snapshot().key_counters);
        self.commit_editor_transaction_with_history(
            origin,
            touched_fields,
            EditorTransactionHistoryOptions {
                scope: Some(scope),
                observed_epoch: observed_history_epoch,
                key_counters,
                ..EditorTransactionHistoryOptions::default()
            },
            updater,
        )
    }

    pub(crate) fn commit_aux_editor_transaction_with_admission<T>(
        &self,
        options: AuxEditorTransactionOptions<'_>,
        admission: HistoryAdmissionLease,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        self.commit_aux_editor_transaction_with_runtime_counters_and_admission(
            options, admission, None, updater,
        )
    }

    pub(crate) fn commit_aux_editor_transaction_with_runtime_counters_admission<T>(
        &self,
        options: AuxEditorTransactionOptions<'_>,
        admission: HistoryAdmissionLease,
        runtime_counters: &KeyCounters,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        self.commit_aux_editor_transaction_with_runtime_counters_and_admission(
            options,
            admission,
            Some(runtime_counters),
            updater,
        )
    }

    fn commit_aux_editor_transaction_with_runtime_counters_and_admission<T>(
        &self,
        options: AuxEditorTransactionOptions<'_>,
        admission: HistoryAdmissionLease,
        runtime_counters: Option<&KeyCounters>,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        if !matches!(options.scope, HistoryScope::CustomTabs | HistoryScope::Mode) {
            return Err(EditorCommitError::validation(
                "INVALID_AUX_HISTORY_SCOPE",
                "aux editor transaction requires a custom tabs or mode scope",
            ));
        }
        self.commit_editor_transaction_with_history_admission(
            options.origin,
            options.touched_fields,
            EditorTransactionHistoryOptions {
                scope: Some(options.scope),
                observed_epoch: options.observed_history_epoch,
                key_counters: runtime_counters.cloned(),
                ..EditorTransactionHistoryOptions::default()
            },
            admission,
            updater,
        )
    }

    #[cfg(test)]
    pub(crate) fn commit_aux_editor_reset_transaction_with_admission<T>(
        &self,
        options: AuxEditorResetTransactionOptions<'_>,
        admission: HistoryAdmissionLease,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        let counters = self.snapshot().key_counters;
        self.commit_aux_editor_reset_transaction_with_runtime_counters_and_admission(
            options,
            admission,
            Some(&counters),
            updater,
        )
    }

    pub(crate) fn commit_aux_editor_reset_transaction_with_runtime_counters_admission<T>(
        &self,
        options: AuxEditorResetTransactionOptions<'_>,
        admission: HistoryAdmissionLease,
        runtime_counters: &KeyCounters,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        self.commit_aux_editor_reset_transaction_with_runtime_counters_and_admission(
            options,
            admission,
            Some(runtime_counters),
            updater,
        )
    }

    fn commit_aux_editor_reset_transaction_with_runtime_counters_and_admission<T>(
        &self,
        options: AuxEditorResetTransactionOptions<'_>,
        admission: HistoryAdmissionLease,
        runtime_counters: Option<&KeyCounters>,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        if !matches!(options.scope, HistoryScope::CustomTabs | HistoryScope::Mode) {
            return Err(EditorCommitError::validation(
                "INVALID_AUX_HISTORY_SCOPE",
                "aux editor transaction requires a custom tabs or mode scope",
            ));
        }
        self.commit_editor_transaction_with_history_admission(
            options.origin,
            options.touched_fields,
            EditorTransactionHistoryOptions {
                scope: Some(options.scope),
                observed_epoch: options.observed_history_epoch,
                key_counters: runtime_counters.cloned(),
                plugin_instances_reset: Some(options.plugin_instances_reset),
                ..EditorTransactionHistoryOptions::default()
            },
            admission,
            updater,
        )
    }

    #[cfg(test)]
    fn commit_editor_transaction_with_history<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        history_options: EditorTransactionHistoryOptions,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        let admission = self.admit_editor_mutation()?;
        self.commit_editor_transaction_with_history_admission(
            origin,
            touched_fields,
            history_options,
            admission,
            updater,
        )
    }

    fn commit_editor_transaction_with_history_admission<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        history_options: EditorTransactionHistoryOptions,
        admission: HistoryAdmissionLease,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        let started = Instant::now();
        if touched_fields.contains(&EditorField::Keys) && history_options.key_counters.is_none() {
            return Err(key_counter_baseline_required());
        }
        let origin_name = origin
            .event_name()
            .unwrap_or_else(|| "loadRecovery".to_string());
        let result = self.commit_legacy_editor_transaction_inner(
            origin,
            touched_fields,
            &admission,
            history_options,
            updater,
        );
        let (outcome, changed_fields) = match &result {
            Ok(transaction) if transaction.change.result.changed_fields.is_empty() => (
                "no_editor_change",
                transaction.change.result.changed_fields.as_slice(),
            ),
            Ok(transaction) => (
                "committed",
                transaction.change.result.changed_fields.as_slice(),
            ),
            Err(error) => (editor_error_outcome(error.error_code), &[][..]),
        };
        // adapter 입력 원문 없이 origin과 결과만 기록
        log::info!(
            target: "editor_commit",
            "origin={origin_name} outcome={outcome} changedFields={changed_fields:?} durationMs={}",
            started.elapsed().as_millis()
        );
        result.map(|transaction| AdmittedEditorTransaction {
            value: transaction.value,
            change: transaction.change,
            _admission: admission,
        })
    }

    fn commit_legacy_editor_transaction_inner<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        admission: &HistoryAdmissionLease,
        history_options: EditorTransactionHistoryOptions,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<EditorTransactionResult<T>, EditorCommitError> {
        let mut guard = self
            .lock_for_update()
            .map_err(|error| EditorCommitError::io(error.to_string()))?;
        admission
            .revalidate_for(&self.history_gate)
            .map_err(|_| EditorCommitError::history_in_progress())?;
        validate_observed_history_epoch(&guard.history, history_options.observed_epoch)?;
        let current_store = guard.data.clone();
        let current = EditorDocumentV1::from_store(&current_store);
        let mut scratch = current_store.clone();
        if let Some(counters) = history_options.key_counters.as_ref() {
            scratch.key_counters = counters.clone();
        }
        let value = updater(&mut scratch)?;
        if matches!(
            history_options.scope,
            Some(HistoryScope::CustomTabs | HistoryScope::PresetFull)
        ) {
            scratch.tab_order = crate::state::tab_metadata::normalize_tab_order(
                &scratch.tab_order,
                &scratch.custom_tabs,
            );
            scratch.bar_count = crate::state::tab_metadata::normalize_bar_count(
                scratch.bar_count,
                &scratch.tab_order,
            );
        }
        let plugin_reset_applied =
            history_options
                .plugin_instances_reset
                .as_ref()
                .is_some_and(|scope| match scope {
                    PluginInstancesResetScope::All => true,
                    PluginInstancesResetScope::Mode(mode) => {
                        crate::defaults::default_keys().contains_key(mode)
                            || current_store.custom_tabs.iter().any(|tab| tab.id == *mode)
                    }
                });
        let affected_plugin_ids = history_options
            .plugin_instances_reset
            .as_ref()
            .filter(|_| plugin_reset_applied)
            .map(|scope| reset_plugin_instances_for_scope(&mut scratch, scope))
            .transpose()?
            .unwrap_or_default();
        crate::state::migration::canonicalize_gradient_pairs(&mut scratch);
        crate::state::migration::canonicalize_image_modes(&mut scratch);
        crate::state::migration::normalize_sprite_triggers(&mut scratch);

        // editorRevision은 이 트랜잭션만 관리
        scratch.editor_revision = current_store.editor_revision;
        let candidate = EditorDocumentV1::from_store(&scratch);
        let changed_fields = current.changed_fields(&candidate);
        if let Some(field) = changed_fields
            .iter()
            .find(|field| !touched_fields.contains(field))
        {
            return Err(EditorCommitError::validation(
                "UNDECLARED_EDITOR_FIELD",
                format!("editor field {field:?} changed outside the declared transaction scope"),
            ));
        }
        crate::state::native_element_id::validate_document_element_ids(&candidate)?;
        if changed_fields.contains(&EditorField::Keys) {
            repair_selected_mode(&mut scratch);
        }

        let (keys_touched, key_positions_touched) = touched_pair(touched_fields);
        validate_paired_update(&current, &candidate, keys_touched, key_positions_touched)?;
        // 프리셋 로드는 커밋 직전 모든 요소의 id를 재발급하므로 ID로는 관용
        // 상대를 찾을 수 없다 - 그 트랜잭션만 (모드, index) 짝짓기를 쓴다
        let keying = if history_options.scope == Some(HistoryScope::PresetFull) {
            GrandfatherKeying::LegacyPresetModeIndex
        } else {
            GrandfatherKeying::StableId
        };
        validate_document_transition_with_keying(
            &current,
            &candidate,
            &current_store,
            &scratch,
            keying,
        )?;

        if changed_fields.contains(&EditorField::Keys) {
            sync_key_counters(&mut scratch.key_counters, &candidate.keys);
        }

        let runtime_counters_changed = history_options
            .key_counters
            .as_ref()
            .is_some_and(|baseline| baseline != &scratch.key_counters);

        let history_plan = match history_options.scope {
            Some(HistoryScope::CustomTabs) => {
                let mut before =
                    CustomTabsHistorySnapshot::from_transition(&current_store, &scratch);
                if let Some(counters) = history_options.key_counters.as_ref() {
                    before.key_counters = counters.clone();
                }
                (!before.matches_store(&scratch))
                    .then(|| guard.history.prepare_custom_tabs_entry(before))
                    .transpose()
            }
            Some(HistoryScope::Mode) => (current_store.selected_key_type
                != scratch.selected_key_type)
                .then(|| {
                    guard
                        .history
                        .prepare_mode_entry(current_store.selected_key_type.clone())
                })
                .transpose(),
            Some(HistoryScope::PresetFull) => {
                let mut before = PresetFullHistorySnapshot::from_store(&current_store);
                if let Some(counters) = history_options.key_counters {
                    before.key_counters = counters;
                }
                (!before.matches_store(&scratch))
                    .then(|| guard.history.prepare_preset_full_entry(before))
                    .transpose()
            }
            Some(_) => {
                return Err(EditorCommitError::validation(
                    "INVALID_AUX_HISTORY_SCOPE",
                    "unsupported aux history scope",
                ));
            }
            None => Ok(None),
        }
        .map_err(|error| EditorCommitError::validation("HISTORY_SERIALIZATION_FAILED", error))?;

        let revision = if changed_fields.is_empty() {
            current_store.editor_revision
        } else {
            let revision = next_revision(current_store.editor_revision)?;
            scratch.editor_revision = revision;
            revision
        };

        let has_store_changes = scratch != current_store;
        let plugin_model_revision = if affected_plugin_ids.is_empty() {
            guard.plugin_model_revision
        } else {
            next_plugin_model_revision(guard.plugin_model_revision).map_err(|error| {
                EditorCommitError::validation("PLUGIN_MODEL_REVISION_OUT_OF_RANGE", error)
            })?
        };
        let selected_key_type = scratch.selected_key_type.clone();
        let key_counters = scratch.key_counters.clone();
        if has_store_changes || runtime_counters_changed {
            self.commit_locked(&mut guard, scratch, ())
                .map_err(|error| EditorCommitError::io(error.to_string()))?;
        }
        guard.plugin_model_revision = plugin_model_revision;
        let history_status = if let Some(plan) = history_plan {
            guard.history.apply_record_plan(plan);
            if plugin_reset_applied {
                guard.history.advance_epoch();
            }
            Some(guard.history.issue_status(self.history_gate.is_closed()))
        } else if plugin_reset_applied {
            // reset 전에 만들어져 이미 비행 중인 인스턴스 저장이 삭제 결과를
            // 되살리지 못하게 epoch를 성공 reset마다 전진
            if has_store_changes {
                guard.history.invalidate_all();
            }
            guard.history.advance_epoch();
            Some(guard.history.issue_status(self.history_gate.is_closed()))
        } else if history_options.scope.is_none() {
            let should_invalidate_history = !changed_fields.is_empty()
                || !affected_plugin_ids.is_empty()
                || (history_options.invalidate_history_on_store_only_change && has_store_changes);
            let history_changed = should_invalidate_history && guard.history.invalidate_all();
            history_changed.then(|| guard.history.issue_status(self.history_gate.is_closed()))
        } else {
            None
        };

        let event = if changed_fields.is_empty() {
            None
        } else {
            origin.event_name().map(|origin| EditorCommittedV1 {
                schema_version: EDITOR_SCHEMA_VERSION,
                revision,
                mutation_id: uuid::Uuid::new_v4().to_string(),
                gesture_id: None,
                gesture_ids: Vec::new(),
                origin,
                changed_fields: changed_fields.clone(),
                patch: candidate.patch_for_fields(&changed_fields),
            })
        };
        let change = CommittedEditorChange {
            result: EditorCommitResult {
                revision,
                changed_fields,
                op_results: None,
            },
            event,
            replayed: false,
            document: candidate,
            selected_key_type,
            key_counters,
            history_status,
            plugin_instances_changes: affected_plugin_ids
                .into_iter()
                .map(|plugin_id| PluginInstancesChangedPayload {
                    plugin_id,
                    revision: plugin_model_revision,
                    origin_mutation_id: None,
                })
                .collect(),
            runtime_publication_generation: guard.revision,
        };

        Ok(EditorTransactionResult { value, change })
    }
}
