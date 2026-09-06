use super::*;
use crate::state::native_element_id;

impl AppStore {
    #[cfg(test)]
    pub(crate) fn commit_gesture(
        &self,
        request: GestureCommitRequest,
    ) -> std::result::Result<AdmittedGestureCommit, EditorCommitError> {
        let admission = self.admit_editor_mutation()?;
        if request.may_change_keys() {
            let counters = self.snapshot().key_counters;
            self.commit_gesture_with_runtime_counters_admission(request, admission, &counters)
        } else {
            self.commit_gesture_with_admission(request, admission)
        }
    }

    pub(crate) fn commit_gesture_with_admission(
        &self,
        request: GestureCommitRequest,
        admission: HistoryAdmissionLease,
    ) -> std::result::Result<AdmittedGestureCommit, EditorCommitError> {
        if request.may_change_keys() {
            return Err(key_counter_baseline_required());
        }
        self.commit_gesture_with_runtime_counters_and_admission(request, admission, None)
    }

    pub(crate) fn commit_gesture_with_runtime_counters_admission(
        &self,
        request: GestureCommitRequest,
        admission: HistoryAdmissionLease,
        runtime_counters: &KeyCounters,
    ) -> std::result::Result<AdmittedGestureCommit, EditorCommitError> {
        self.commit_gesture_with_runtime_counters_and_admission(
            request,
            admission,
            Some(runtime_counters),
        )
    }

    fn commit_gesture_with_runtime_counters_and_admission(
        &self,
        request: GestureCommitRequest,
        admission: HistoryAdmissionLease,
        runtime_counters: Option<&KeyCounters>,
    ) -> std::result::Result<AdmittedGestureCommit, EditorCommitError> {
        validate_gesture_commit_request(&request)?;
        let outcome = self.commit_gesture_admitted(request, &admission, runtime_counters)?;
        Ok(AdmittedGestureCommit {
            outcome,
            _admission: admission,
        })
    }

    fn commit_gesture_admitted(
        &self,
        mut request: GestureCommitRequest,
        admission: &HistoryAdmissionLease,
        runtime_counters: Option<&KeyCounters>,
    ) -> std::result::Result<GestureCommitOutcome, EditorCommitError> {
        let fingerprint = gesture_request_fingerprint(&request)?;
        let mut guard = self
            .lock_for_update()
            .map_err(|error| EditorCommitError::io(error.to_string()))?;
        admission
            .revalidate_for(&self.history_gate)
            .map_err(|_| EditorCommitError::history_in_progress())?;

        if let Some(ack) = guard
            .gesture_mutation_acks
            .iter()
            .find(|ack| ack.id == request.mutation_id)
        {
            if ack.fingerprint != fingerprint {
                return Err(EditorCommitError::mutation_id_reused());
            }
            return Ok(GestureCommitOutcome {
                result: ack.result.clone(),
                change: None,
                changed_plugin_ids: Vec::new(),
                history_status: None,
                replayed: true,
            });
        }

        validate_observed_history_epoch(&guard.history, request.observed_history_epoch)?;
        if request.editor_base_revision != guard.data.editor_revision {
            return Err(EditorCommitError::revision_conflict(
                guard.data.editor_revision,
            ));
        }
        if request.plugin_base_revision != guard.plugin_model_revision {
            return Err(EditorCommitError::plugin_revision_conflict(
                guard.plugin_model_revision,
            ));
        }

        if let Some(changes) = request.editor_changes.as_mut() {
            changes.merge_omitted_sprite_fields(&guard.data.sprite_positions);
            native_element_id::prepare_commit_patch_element_ids(&guard.data, changes)?;
        }

        let mut current_store = guard.data.clone();
        if let Some(counters) = runtime_counters {
            current_store.key_counters = counters.clone();
        }
        let (current_editor, candidate_editor, mut scratch, changed_fields, editor_op_results) =
            if let Some(changes) = request.editor_changes.as_ref() {
                let touched_fields = changes.included_fields();
                let (current, candidate, scratch, changed_fields) =
                    prepare_editor_patch_transition(&current_store, changes, &touched_fields)?;
                (current, candidate, scratch, changed_fields, None)
            } else if let Some(ops) = request.editor_ops.as_ref() {
                // editor op 적용이 pluginChanges보다 먼저다 - 그룹 생존 판정은
                // 요청 동봉 plugin_changes(커밋 후 상태)를 우선, 미동봉 플러그인만 store
                let request_plugin_ids = request
                    .plugin_changes
                    .iter()
                    .map(|change| change.plugin_id.as_str())
                    .collect::<HashSet<_>>();
                let mut plugin_group_refs =
                    plugin_group_refs_from_store(&current_store, &request_plugin_ids);
                for change in &request.plugin_changes {
                    add_plugin_group_refs(&mut plugin_group_refs, &change.instances);
                }
                let transition = prepare_editor_ops_transition_with_plugin_refs(
                    &current_store,
                    ops,
                    &plugin_group_refs,
                )?;
                (
                    transition.current,
                    transition.candidate,
                    transition.scratch,
                    transition.changed_fields,
                    Some(transition.op_results),
                )
            } else {
                let current = EditorDocumentV1::from_store(&current_store);
                (
                    current.clone(),
                    current,
                    current_store.clone(),
                    Vec::new(),
                    None,
                )
            };

        let mut history_snapshots = Vec::with_capacity(request.plugin_changes.len() + 1);
        if !changed_fields.is_empty() {
            history_snapshots.push(HistorySnapshot::Editor {
                changed_fields: changed_fields.clone(),
                before: Box::new(current_editor.patch_for_fields(&changed_fields)),
                key_counters: changed_fields
                    .contains(&EditorField::Keys)
                    .then(|| current_store.key_counters.clone()),
            });
        }

        let mut changed_plugin_ids = Vec::new();
        for plugin_change in &request.plugin_changes {
            let current_snapshot =
                plugin_elements_snapshot(&current_store, &plugin_change.plugin_id).map_err(
                    |error| EditorCommitError::validation("INVALID_GESTURE_PLUGIN", error),
                )?;
            validate_plugin_instances_transition(
                current_snapshot.instances.as_deref().unwrap_or_default(),
                &plugin_change.instances,
            )
            .map_err(|error| {
                EditorCommitError::validation(
                    error.clone(),
                    format!(
                        "invalid plugin gesture transition '{}': {error}",
                        plugin_change.plugin_id
                    ),
                )
            })?;
            let canonical = PluginElementsHistorySnapshot {
                plugin_id: plugin_change.plugin_id.clone(),
                instances: (!plugin_change.instances.is_empty())
                    .then_some(plugin_change.instances.clone()),
            };
            if current_snapshot == canonical {
                continue;
            }
            apply_plugin_elements_snapshot(&mut scratch, &canonical)
                .map_err(|error| EditorCommitError::validation("INVALID_GESTURE_PLUGIN", error))?;
            history_snapshots.push(HistorySnapshot::PluginElements(current_snapshot));
            changed_plugin_ids.push(plugin_change.plugin_id.clone());
        }

        let editor_revision = if changed_fields.is_empty() {
            current_store.editor_revision
        } else {
            let revision = next_revision(current_store.editor_revision)?;
            if changed_fields.contains(&EditorField::Keys) {
                sync_key_counters(&mut scratch.key_counters, &candidate_editor.keys);
                repair_selected_mode(&mut scratch);
            }
            scratch.editor_revision = revision;
            revision
        };
        let plugin_model_revision = if changed_plugin_ids.is_empty() {
            guard.plugin_model_revision
        } else {
            next_plugin_model_revision(guard.plugin_model_revision).map_err(|error| {
                EditorCommitError::validation("PLUGIN_MODEL_REVISION_OUT_OF_RANGE", error)
            })?
        };
        let result = GestureCommitResult {
            editor_revision,
            changed_fields: changed_fields.clone(),
            editor_op_results: editor_op_results.clone(),
            plugin_model_revision,
            changed_plugin_ids: changed_plugin_ids.clone(),
            authority_generation: request.authority_generation,
        };

        if history_snapshots.is_empty() {
            insert_gesture_mutation_ack(
                &mut guard.gesture_mutation_acks,
                request.mutation_id,
                fingerprint,
                result.clone(),
            );
            return Ok(GestureCommitOutcome {
                result,
                change: None,
                changed_plugin_ids: Vec::new(),
                history_status: None,
                replayed: false,
            });
        }

        let history_plan = guard
            .history
            .prepare_gesture_entry(history_snapshots, request.gesture_id.clone())
            .map_err(|error| {
                EditorCommitError::validation("HISTORY_SERIALIZATION_FAILED", error)
            })?;
        if matches!(history_plan, HistoryRecordPlan::Truncate) {
            return Err(EditorCommitError::validation(
                HISTORY_ENTRY_TOO_LARGE,
                "gesture history entry exceeds the size limit",
            ));
        }

        let selected_key_type = scratch.selected_key_type.clone();
        let key_counters = scratch.key_counters.clone();
        self.commit_locked(&mut guard, scratch, ())
            .map_err(|error| EditorCommitError::io(error.to_string()))?;
        guard.plugin_model_revision = plugin_model_revision;
        guard.history.apply_record_plan(history_plan);
        let history_status = Some(guard.history.issue_status(self.history_gate.is_closed()));

        let change = (!changed_fields.is_empty()).then(|| CommittedEditorChange {
            result: EditorCommitResult {
                revision: editor_revision,
                changed_fields: changed_fields.clone(),
                op_results: editor_op_results,
            },
            event: Some(EditorCommittedV1 {
                schema_version: EDITOR_SCHEMA_VERSION,
                revision: editor_revision,
                mutation_id: request.mutation_id.clone(),
                gesture_id: Some(request.gesture_id.clone()),
                gesture_ids: vec![request.gesture_id],
                origin: EditorCommitOrigin::GestureCommit
                    .event_name()
                    .expect("gesture commits publish editor events"),
                changed_fields: changed_fields.clone(),
                patch: candidate_editor.patch_for_fields(&changed_fields),
            }),
            replayed: false,
            document: candidate_editor,
            selected_key_type,
            key_counters,
            history_status: None,
            plugin_instances_changes: Vec::new(),
            runtime_publication_generation: guard.revision,
        });

        insert_gesture_mutation_ack(
            &mut guard.gesture_mutation_acks,
            request.mutation_id,
            fingerprint,
            result.clone(),
        );
        Ok(GestureCommitOutcome {
            result,
            change,
            changed_plugin_ids,
            history_status,
            replayed: false,
        })
    }
}
