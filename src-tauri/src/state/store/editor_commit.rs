use super::*;
use crate::state::native_element_id;

impl AppStore {
    #[cfg(test)]
    pub fn commit_editor_document(
        &self,
        request: EditorCommitRequest,
    ) -> std::result::Result<CommittedEditorChange, EditorCommitError> {
        let admission = self.admit_editor_mutation()?;
        if request.may_change_keys() {
            let counters = self.snapshot().key_counters;
            self.commit_editor_document_with_runtime_counters_admitted(
                request, &admission, &counters,
            )
        } else {
            self.commit_editor_document_admitted(request, &admission)
        }
    }

    pub(crate) fn admit_editor_mutation(
        &self,
    ) -> std::result::Result<HistoryAdmissionLease, EditorCommitError> {
        self.history_gate
            .admit_mutation()
            .map_err(|error| match error.as_str() {
                HISTORY_IN_PROGRESS => EditorCommitError::history_in_progress(),
                _ => EditorCommitError::io(error),
            })
    }

    pub(crate) fn commit_editor_document_admitted(
        &self,
        request: EditorCommitRequest,
        admission: &HistoryAdmissionLease,
    ) -> std::result::Result<CommittedEditorChange, EditorCommitError> {
        if request.may_change_keys() {
            return Err(key_counter_baseline_required());
        }
        self.commit_editor_document_admitted_with_runtime_counters(request, admission, None)
    }

    pub(crate) fn commit_editor_document_with_runtime_counters_admitted(
        &self,
        request: EditorCommitRequest,
        admission: &HistoryAdmissionLease,
        runtime_counters: &KeyCounters,
    ) -> std::result::Result<CommittedEditorChange, EditorCommitError> {
        self.commit_editor_document_admitted_with_runtime_counters(
            request,
            admission,
            Some(runtime_counters),
        )
    }

    fn commit_editor_document_admitted_with_runtime_counters(
        &self,
        request: EditorCommitRequest,
        admission: &HistoryAdmissionLease,
        runtime_counters: Option<&KeyCounters>,
    ) -> std::result::Result<CommittedEditorChange, EditorCommitError> {
        let started = Instant::now();
        let base_revision = request.base_revision;
        let mutation_id = uuid::Uuid::parse_str(&request.mutation_id)
            .map(|id| id.hyphenated().to_string())
            .unwrap_or_else(|_| "<invalid>".to_string());
        let mutation_kind = if request.ops.is_some() {
            "ops"
        } else {
            "patch"
        };
        let ops_version = request
            .ops_version
            .map_or_else(|| "none".to_string(), |version| version.to_string());
        let op_count = request.ops.as_ref().map_or(0, Vec::len);
        let payload_size = request_payload_size(&request);
        let payload_bytes = payload_size.as_ref().copied().unwrap_or(0);
        let result = match payload_size {
            Ok(_) => self.commit_editor_document_inner(request, admission, runtime_counters),
            Err(error) => Err(error),
        };
        let current_revision = result
            .as_ref()
            .err()
            .and_then(|error| error.details.as_ref())
            .and_then(|details| details.current_revision)
            .unwrap_or_else(|| self.state.read().data.editor_revision);
        let (outcome, changed_fields) = match &result {
            Ok(change) if change.event.is_some() => {
                ("committed", change.result.changed_fields.as_slice())
            }
            Ok(change) if change.result.changed_fields.is_empty() => {
                ("no_op", change.result.changed_fields.as_slice())
            }
            Ok(change) => ("replay", change.result.changed_fields.as_slice()),
            Err(error) => (editor_error_outcome(error.error_code), &[][..]),
        };
        let (applied_count, no_change_count, target_missing_count) = result
            .as_ref()
            .ok()
            .and_then(|change| change.result.op_results.as_ref())
            .map(|results| {
                results
                    .iter()
                    .fold((0, 0, 0), |counts, result| match result.status {
                        EditorOpResultStatusV1::Applied => (counts.0 + 1, counts.1, counts.2),
                        EditorOpResultStatusV1::NoChange => (counts.0, counts.1 + 1, counts.2),
                        EditorOpResultStatusV1::TargetMissing => (counts.0, counts.1, counts.2 + 1),
                    })
            })
            .unwrap_or_default();
        let ack_replay = result.as_ref().is_ok_and(|change| change.replayed);
        let validation_code = result
            .as_ref()
            .err()
            .and_then(|error| error.details.as_ref())
            .and_then(|details| details.validation_code.as_deref())
            .unwrap_or("none");
        // 문서·patch 원문 없이 경계 메타데이터만 기록
        log::info!(
            target: "editor_commit",
            "command=editor_commit mutationId={mutation_id} mutationKind={mutation_kind} opsVersion={ops_version} opCount={op_count} baseRevision={base_revision} currentRevision={current_revision} outcome={outcome} validationCode={validation_code} ackReplay={ack_replay} opApplied={applied_count} opNoChange={no_change_count} opTargetMissing={target_missing_count} changedFields={changed_fields:?} durationMs={} payloadBytes={payload_bytes}",
            started.elapsed().as_millis()
        );
        result
    }

    fn commit_editor_document_inner(
        &self,
        mut request: EditorCommitRequest,
        admission: &HistoryAdmissionLease,
        runtime_counters: Option<&KeyCounters>,
    ) -> std::result::Result<CommittedEditorChange, EditorCommitError> {
        if let Some(changes) = request.changes.as_mut() {
            if let Some(keys) = changes.keys.as_mut() {
                normalize_key_mappings(keys);
            }
        }
        validate_request_envelope(&request)?;
        let fingerprint = request_fingerprint(&request)?;
        let mut guard = self
            .lock_for_update()
            .map_err(|error| EditorCommitError::io(error.to_string()))?;
        admission
            .revalidate_for(&self.history_gate)
            .map_err(|_| EditorCommitError::history_in_progress())?;

        if let Some(ack) = guard
            .mutation_acks
            .iter()
            .find(|ack| ack.id == request.mutation_id)
        {
            if ack.fingerprint != fingerprint {
                return Err(EditorCommitError::mutation_id_reused());
            }
            return Ok(CommittedEditorChange {
                result: ack.result.clone(),
                event: None,
                replayed: true,
                document: EditorDocumentV1::from_store(&guard.data),
                selected_key_type: guard.data.selected_key_type.clone(),
                key_counters: guard.data.key_counters.clone(),
                history_status: None,
                plugin_instances_changes: Vec::new(),
                runtime_publication_generation: guard.revision,
            });
        }

        if request.base_revision != guard.data.editor_revision {
            return Err(EditorCommitError::revision_conflict(
                guard.data.editor_revision,
            ));
        }

        if request
            .changes
            .as_ref()
            .is_some_and(|changes| changes.keys.is_some())
            && key_mappings_contain_multi(&guard.data.keys)
            && !request.multi_key
        {
            return Err(EditorCommitError::multi_key_unsupported());
        }

        let gesture_id = request.history_gesture_id();
        let gesture_ids = request.echoed_gesture_ids();
        let options = EditorPatchCommitOptions {
            mutation_id: request.mutation_id.clone(),
            gesture_id,
            gesture_ids,
            origin: EditorCommitOrigin::StrictEditorCommit,
            record_history: true,
            apply_key_side_effects: true,
            enforce_touched_fields: false,
        };
        let change = if let Some(changes) = request.changes.as_mut() {
            native_element_id::prepare_commit_patch_element_ids(&guard.data, changes)?;
            let touched_fields = changes.included_fields();
            self.commit_editor_patch_locked(
                &mut guard,
                changes,
                &touched_fields,
                runtime_counters,
                options,
            )?
        } else if let Some(ops) = request.ops.as_ref() {
            self.commit_editor_ops_locked(&mut guard, ops, runtime_counters, options)?
        } else {
            return Err(EditorCommitError::validation(
                "EDITOR_MUTATION_REQUIRED",
                "editor commit must contain exactly one mutation payload",
            ));
        };
        insert_mutation_ack(
            &mut guard.mutation_acks,
            request.mutation_id,
            fingerprint,
            change.result.clone(),
        );
        Ok(change)
    }

    pub(super) fn commit_editor_patch_locked(
        &self,
        guard: &mut VersionedStoreState,
        changes: &crate::models::EditorPatchV1,
        touched_fields: &[EditorField],
        runtime_counters: Option<&KeyCounters>,
        options: EditorPatchCommitOptions,
    ) -> std::result::Result<CommittedEditorChange, EditorCommitError> {
        let mut current_store = guard.data.clone();
        if let Some(counters) = runtime_counters {
            current_store.key_counters = counters.clone();
        }
        let (current, candidate, scratch, changed_fields) =
            prepare_editor_patch_transition(&current_store, changes, touched_fields)?;
        if options.enforce_touched_fields
            && changed_fields
                .iter()
                .any(|field| !touched_fields.contains(field))
        {
            return Err(EditorCommitError::validation(
                "HISTORY_RESTORE_CHANGED_UNDECLARED_FIELD",
                "history restore changed an editor field outside its entry",
            ));
        }
        self.commit_editor_transition_locked(
            guard,
            current_store,
            current,
            candidate,
            scratch,
            changed_fields,
            None,
            options,
        )
    }

    fn commit_editor_ops_locked(
        &self,
        guard: &mut VersionedStoreState,
        ops: &[crate::models::EditorOpV1],
        runtime_counters: Option<&KeyCounters>,
        options: EditorPatchCommitOptions,
    ) -> std::result::Result<CommittedEditorChange, EditorCommitError> {
        let mut current_store = guard.data.clone();
        if let Some(counters) = runtime_counters {
            current_store.key_counters = counters.clone();
        }
        let transition = prepare_editor_ops_transition(&current_store, ops)?;
        self.commit_editor_transition_locked(
            guard,
            current_store,
            transition.current,
            transition.candidate,
            transition.scratch,
            transition.changed_fields,
            Some(transition.op_results),
            options,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn commit_editor_transition_locked(
        &self,
        guard: &mut VersionedStoreState,
        current_store: AppStoreData,
        current: EditorDocumentV1,
        candidate: EditorDocumentV1,
        mut scratch: AppStoreData,
        changed_fields: Vec<EditorField>,
        op_results: Option<Vec<EditorOpResultV1>>,
        options: EditorPatchCommitOptions,
    ) -> std::result::Result<CommittedEditorChange, EditorCommitError> {
        if changed_fields.is_empty() {
            return Ok(CommittedEditorChange {
                result: EditorCommitResult {
                    revision: current_store.editor_revision,
                    changed_fields,
                    op_results,
                },
                event: None,
                replayed: false,
                document: current,
                selected_key_type: current_store.selected_key_type,
                key_counters: current_store.key_counters,
                history_status: None,
                plugin_instances_changes: Vec::new(),
                runtime_publication_generation: guard.revision,
            });
        }

        let history_plan = options
            .record_history
            .then(|| {
                guard.history.prepare_entry_with_gesture_ids(
                    changed_fields.clone(),
                    current.patch_for_fields(&changed_fields),
                    changed_fields
                        .contains(&EditorField::Keys)
                        .then(|| current_store.key_counters.clone()),
                    options.gesture_ids.clone(),
                )
            })
            .transpose()
            .map_err(|error| {
                EditorCommitError::validation("HISTORY_SERIALIZATION_FAILED", error)
            })?;

        let revision = next_revision(current_store.editor_revision)?;
        if options.apply_key_side_effects && changed_fields.contains(&EditorField::Keys) {
            sync_key_counters(&mut scratch.key_counters, &candidate.keys);
            repair_selected_mode(&mut scratch);
        }
        scratch.editor_revision = revision;
        let selected_key_type = scratch.selected_key_type.clone();
        let key_counters = scratch.key_counters.clone();

        self.commit_locked(guard, scratch, ())
            .map_err(|error| EditorCommitError::io(error.to_string()))?;

        let history_status = history_plan.map(|plan| {
            guard.history.apply_editor_record_plan(plan, &candidate);
            guard.history.issue_status(self.history_gate.is_closed())
        });
        let event = options.origin.event_name().map(|origin| EditorCommittedV1 {
            schema_version: EDITOR_SCHEMA_VERSION,
            revision,
            mutation_id: options.mutation_id,
            gesture_id: options.gesture_id,
            gesture_ids: options.gesture_ids,
            origin,
            changed_fields: changed_fields.clone(),
            patch: candidate.patch_for_fields(&changed_fields),
        });

        Ok(CommittedEditorChange {
            result: EditorCommitResult {
                revision,
                changed_fields,
                op_results,
            },
            event,
            replayed: false,
            document: candidate,
            selected_key_type,
            key_counters,
            history_status,
            plugin_instances_changes: Vec::new(),
            runtime_publication_generation: guard.revision,
        })
    }
}
