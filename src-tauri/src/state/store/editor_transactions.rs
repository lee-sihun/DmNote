use super::*;
use crate::errors::EditorCommitErrorCode;

pub(super) fn ensure_generic_editor_unchanged(
    before: &AppStoreData,
    after: &AppStoreData,
) -> Result<()> {
    if before.editor_revision != after.editor_revision
        || EditorDocumentV1::from_store(before) != EditorDocumentV1::from_store(after)
    {
        return Err(anyhow!(
            "editor fields must be changed through an editor transaction"
        ));
    }
    Ok(())
}

pub(super) fn editor_error_outcome(code: EditorCommitErrorCode) -> &'static str {
    match code {
        EditorCommitErrorCode::RevisionConflict => "revision_conflict",
        EditorCommitErrorCode::PluginRevisionConflict => "plugin_revision_conflict",
        EditorCommitErrorCode::ValidationFailed => "validation_failed",
        EditorCommitErrorCode::TooManyGestureIds => "too_many_gesture_ids",
        EditorCommitErrorCode::InvalidGestureId => "invalid_gesture_id",
        EditorCommitErrorCode::PairedUpdateRequired => "paired_update_required",
        EditorCommitErrorCode::MultiKeyUnsupported => "multi_key_unsupported",
        EditorCommitErrorCode::MutationIdReused => "mutation_id_reused",
        EditorCommitErrorCode::HistoryInProgress => "history_in_progress",
        EditorCommitErrorCode::HistoryEpochConflict => "history_epoch_conflict",
        EditorCommitErrorCode::IoError => "io_error",
    }
}

pub(super) fn prepare_editor_patch_transition(
    current_store: &AppStoreData,
    changes: &crate::models::EditorPatchV1,
    touched_fields: &[EditorField],
) -> std::result::Result<
    (
        EditorDocumentV1,
        EditorDocumentV1,
        AppStoreData,
        Vec<EditorField>,
    ),
    EditorCommitError,
> {
    let current = EditorDocumentV1::from_store(current_store);
    let mut candidate = current.clone();
    candidate.apply_patch(changes);

    let mut scratch = current_store.clone();
    candidate.apply_to_store(&mut scratch);
    crate::state::migration::canonicalize_gradient_pairs(&mut scratch);
    crate::state::migration::canonicalize_image_modes(&mut scratch);
    candidate = EditorDocumentV1::from_store(&scratch);

    validate_paired_update(
        &current,
        &candidate,
        touched_fields.contains(&EditorField::Keys),
        touched_fields.contains(&EditorField::KeyPositions),
    )?;
    scratch.editor_revision = current_store.editor_revision;
    validate_document_transition(&current, &candidate, current_store, &scratch)?;
    let changed_fields = current.changed_fields(&candidate);

    Ok((current, candidate, scratch, changed_fields))
}

pub(super) fn require_history_entry(plan: HistoryRecordPlan) -> Result<HistoryEntry, String> {
    match plan {
        HistoryRecordPlan::Entry(entry) => Ok(*entry),
        HistoryRecordPlan::Merge { .. } => Err(HISTORY_INVALID_OPPOSITE_ENTRY.to_string()),
        HistoryRecordPlan::Truncate => Err(HISTORY_ENTRY_TOO_LARGE.to_string()),
    }
}

pub(super) fn editor_history_error(error: EditorCommitError) -> String {
    format!("{:?}: {}", error.error_code, error.message)
}

pub(super) fn validate_observed_history_epoch(
    history: &HistoryService,
    observed_history_epoch: Option<u64>,
) -> std::result::Result<(), EditorCommitError> {
    if observed_history_epoch.is_some_and(|observed| observed != history.history_epoch()) {
        return Err(EditorCommitError::history_epoch_conflict(
            history.history_epoch(),
        ));
    }
    Ok(())
}

pub(super) fn project_history_key_counters(
    current: &KeyCounters,
    historical: &KeyCounters,
    target_keys: &KeyMappings,
) -> KeyCounters {
    let mut projected = historical.clone();
    sync_key_counters(&mut projected, target_keys);
    for (mode, counters) in &mut projected {
        let Some(current_mode) = current.get(mode) else {
            continue;
        };
        for (key, count) in counters {
            if let Some(current_count) = current_mode.get(key) {
                *count = *current_count;
            }
        }
    }
    projected
}

pub(super) fn project_editor_history_key_counters(
    current: &KeyCounters,
    historical: Option<&KeyCounters>,
    target_keys: &KeyMappings,
) -> KeyCounters {
    let Some(historical) = historical else {
        let mut projected = current.clone();
        sync_key_counters(&mut projected, target_keys);
        return projected;
    };
    project_history_key_counters(current, historical, target_keys)
}

pub(super) fn insert_mutation_ack(
    acks: &mut VecDeque<MutationAck>,
    id: String,
    fingerprint: RequestFingerprint,
    result: EditorCommitResult,
) {
    if acks.len() == MUTATION_ACK_CAPACITY {
        acks.pop_front();
    }
    acks.push_back(MutationAck {
        id,
        fingerprint,
        result,
    });
}

pub(super) fn insert_gesture_mutation_ack(
    acks: &mut VecDeque<GestureMutationAck>,
    id: String,
    fingerprint: RequestFingerprint,
    result: GestureCommitResult,
) {
    if acks.len() == MUTATION_ACK_CAPACITY {
        acks.pop_front();
    }
    acks.push_back(GestureMutationAck {
        id,
        fingerprint,
        result,
    });
}
