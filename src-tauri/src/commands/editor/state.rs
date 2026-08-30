use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::{
    commands::{run_blocking, run_prepared_mutation},
    errors::CmdResult,
    models::{CommittedEditorChange, EditorCommitResult, EditorField, EditorGetResult},
    services::{event_publisher::publish_event, preview_broker::PreviewBroker},
    state::{editor::decode_editor_commit_request, AppState},
};

pub(crate) fn emit_best_effort<T: serde::Serialize>(app: &AppHandle, event: &str, payload: &T) {
    publish_event(app, event, payload);
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum KeyRuntimePublishPolicy {
    ApplyWithCounters,
    AlreadyAppliedWithoutCounters,
}

fn legacy_event_name(field: EditorField) -> &'static str {
    match field {
        EditorField::Keys => "keys:changed",
        EditorField::KeyPositions => "positions:changed",
        EditorField::StatPositions => "statPositions:changed",
        EditorField::GraphPositions => "graphPositions:changed",
        EditorField::KnobPositions => "knobPositions:changed",
        EditorField::SpritePositions => "spritePositions:changed",
        EditorField::LayerGroups => "layerGroups:changed",
    }
}

fn projected_legacy_fields(
    project_legacy_events: bool,
    changed_fields: &[EditorField],
) -> &[EditorField] {
    if project_legacy_events {
        changed_fields
    } else {
        &[]
    }
}

fn commit_legacy_fields<'a>(
    is_ops: bool,
    requested_fields: &'a [EditorField],
    changed_fields: &'a [EditorField],
) -> &'a [EditorField] {
    if is_ops {
        changed_fields
    } else {
        requested_fields
    }
}

pub(crate) fn publish_legacy_editor_fields(
    state: &AppState,
    app: &AppHandle,
    change: &CommittedEditorChange,
    fields: &[EditorField],
) {
    for field in fields {
        let event = legacy_event_name(*field);
        match field {
            EditorField::Keys => {
                emit_best_effort(app, event, &change.document.keys);
            }
            EditorField::KeyPositions => {
                emit_best_effort(app, event, &change.document.key_positions);
            }
            EditorField::StatPositions => {
                emit_best_effort(app, event, &change.document.stat_positions);
            }
            EditorField::GraphPositions => {
                emit_best_effort(app, event, &change.document.graph_positions);
            }
            EditorField::KnobPositions => {
                emit_best_effort(app, event, &change.document.knob_positions);
            }
            EditorField::SpritePositions => {
                emit_best_effort(app, event, &change.document.sprite_positions);
            }
            EditorField::LayerGroups => {
                emit_best_effort(app, event, &change.document.layer_groups);
            }
        }
    }

    if fields.contains(&EditorField::Keys)
        && !change.result.changed_fields.contains(&EditorField::Keys)
    {
        state.apply_committed_editor_keys_without_counters(
            change.runtime_publication_generation,
            &change.document.keys,
            &change.selected_key_type,
        );
        state.obs_broadcast_counters();
    }

    if !fields.is_empty() && change.result.changed_fields.is_empty() {
        state.refresh_obs_snapshot();
    }
}

pub(crate) fn publish_editor_change(
    state: &AppState,
    app: &AppHandle,
    change: &CommittedEditorChange,
    project_legacy_events: bool,
) {
    let legacy_fields =
        projected_legacy_fields(project_legacy_events, &change.result.changed_fields);
    publish_editor_change_with_options(
        state,
        app,
        change,
        legacy_fields,
        KeyRuntimePublishPolicy::ApplyWithCounters,
    );
}

pub(crate) fn publish_legacy_editor_change(
    state: &AppState,
    app: &AppHandle,
    change: &CommittedEditorChange,
) {
    publish_editor_change(state, app, change, false);
    if let Some(history_status) = change.history_status.as_ref() {
        emit_best_effort(app, "history:status", history_status);
    }
}

fn publish_editor_change_with_options(
    state: &AppState,
    app: &AppHandle,
    change: &CommittedEditorChange,
    legacy_fields: &[EditorField],
    key_runtime_policy: KeyRuntimePublishPolicy,
) {
    state.publish_committed_key_sound_bindings(change);
    let Some(event) = change.event.as_ref() else {
        return;
    };
    emit_best_effort(app, "editor:committed", event);

    let keys_changed = change.result.changed_fields.contains(&EditorField::Keys);
    let previous_mode = (keys_changed
        && key_runtime_policy == KeyRuntimePublishPolicy::ApplyWithCounters)
        .then(|| state.keyboard.current_mode());
    if keys_changed && key_runtime_policy == KeyRuntimePublishPolicy::ApplyWithCounters {
        if let Err(error) = state.apply_committed_editor_key_runtime(
            app,
            change.runtime_publication_generation,
            &change.document.keys,
            &change.selected_key_type,
            &change.key_counters,
        ) {
            log::error!("[Editor] failed to publish committed key counters: {error:#}");
        }
    }

    if !legacy_fields.is_empty() {
        publish_legacy_editor_fields(state, app, change, legacy_fields);
    }

    if previous_mode.is_some_and(|mode| mode != change.selected_key_type) {
        emit_best_effort(
            app,
            "keys:mode-changed",
            &serde_json::json!({ "mode": &change.selected_key_type }),
        );
    }

    if keys_changed && key_runtime_policy == KeyRuntimePublishPolicy::ApplyWithCounters {
        state.obs_broadcast_counters();
    }

    if !change.result.changed_fields.is_empty() {
        state.refresh_obs_snapshot();
    }
}

pub(crate) fn publish_history_editor_change(
    state: &AppState,
    app: &AppHandle,
    change: &CommittedEditorChange,
) {
    publish_editor_change_with_options(
        state,
        app,
        change,
        &change.result.changed_fields,
        KeyRuntimePublishPolicy::AlreadyAppliedWithoutCounters,
    );
}

pub(crate) fn publish_editor_change_after_key_runtime(
    state: &AppState,
    app: &AppHandle,
    change: &CommittedEditorChange,
) {
    publish_editor_change_with_options(
        state,
        app,
        change,
        &[],
        KeyRuntimePublishPolicy::AlreadyAppliedWithoutCounters,
    );
}

#[tauri::command]
pub async fn editor_get(app: AppHandle) -> CmdResult<EditorGetResult> {
    run_blocking(app, |_, state| Ok(state.store.editor_get())).await
}

#[tauri::command]
pub async fn editor_commit(
    app: AppHandle,
    window: WebviewWindow,
    request: Value,
) -> CmdResult<EditorCommitResult> {
    let window_label = window.label().to_string();
    let committed_window_label = window_label.clone();
    run_prepared_mutation(
        app,
        move |_, state| {
            let request = decode_editor_commit_request(request).inspect_err(|error| {
                let validation_code = error
                    .details
                    .as_ref()
                    .and_then(|details| details.validation_code.as_deref())
                    .unwrap_or("UNKNOWN");
                log::info!(
                    target: "editor_commit",
                    "command=editor_commit outcome=validation_rejected validationCode={validation_code}"
                );
            })?;
            let admission = state
                .admit_frontend_history_mutation(&window_label)
                .map_err(|_| crate::errors::EditorCommitError::history_in_progress())?;
            Ok((request, admission))
        },
        move |app, state, (request, admission)| {
            let broker = app.state::<PreviewBroker>();
            let gesture_ids = request.echoed_gesture_ids();
            let is_ops = request.ops.is_some();
            let requested_fields = request
                .changes
                .as_ref()
                .map_or_else(Vec::new, |changes| changes.included_fields());
            let previous_mode = requested_fields
                .contains(&EditorField::Keys)
                .then(|| state.keyboard.current_mode());
            let (change, key_runtime_applied) = state
                .commit_editor_document_preserving_runtime_counters(app, request, &admission)?;
            for gesture_id in &gesture_ids {
                if let Err(error) = broker.finish_committed_session(
                    &committed_window_label,
                    gesture_id,
                    change.event.is_none(),
                ) {
                    log::warn!("failed to finish committed preview session: {error}");
                }
            }
            if change.event.is_some() {
                if key_runtime_applied {
                    publish_editor_change_after_key_runtime(state, app, &change);
                } else {
                    publish_editor_change(state, app, &change, false);
                }
            }
            if !change.replayed {
                let legacy_fields =
                    commit_legacy_fields(is_ops, &requested_fields, &change.result.changed_fields);
                publish_legacy_editor_fields(state, app, &change, legacy_fields);
                if previous_mode.is_some_and(|mode| mode != change.selected_key_type) {
                    emit_best_effort(
                        app,
                        "keys:mode-changed",
                        &serde_json::json!({ "mode": &change.selected_key_type }),
                    );
                }
            }
            if let Some(history_status) = change.history_status.as_ref() {
                emit_best_effort(app, "history:status", history_status);
            }
            drop(admission);
            Ok(change.result)
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_restore_uses_same_legacy_projection_for_every_editor_field() {
        let fields = [
            EditorField::Keys,
            EditorField::KeyPositions,
            EditorField::StatPositions,
            EditorField::GraphPositions,
            EditorField::KnobPositions,
            EditorField::SpritePositions,
            EditorField::LayerGroups,
        ];
        assert_eq!(&fields, projected_legacy_fields(true, &fields));
        assert_eq!(
            fields.map(legacy_event_name),
            [
                "keys:changed",
                "positions:changed",
                "statPositions:changed",
                "graphPositions:changed",
                "knobPositions:changed",
                "spritePositions:changed",
                "layerGroups:changed",
            ]
        );
    }

    #[test]
    fn semantic_ops_publish_their_actual_legacy_position_fields() {
        let changed_fields = [EditorField::KeyPositions];
        let selected = commit_legacy_fields(true, &[], &changed_fields);

        assert_eq!(selected, &changed_fields);
        assert_eq!(
            selected
                .iter()
                .copied()
                .map(legacy_event_name)
                .collect::<Vec<_>>(),
            ["positions:changed"]
        );

        let requested_fields = [EditorField::KeyPositions];
        assert_eq!(
            commit_legacy_fields(false, &requested_fields, &[]),
            &requested_fields
        );
    }

    #[test]
    fn invalid_raw_editor_envelope_returns_a_typed_validation_error() {
        let error = decode_editor_commit_request(serde_json::json!({
            "baseRevision": 0,
            "mutationId": uuid::Uuid::new_v4().to_string(),
            "changes": { "schemaVersion": 1 },
            "unknown": true,
        }))
        .unwrap_err();
        let wire = serde_json::to_value(crate::errors::CommandError::from(error)).unwrap();

        assert_eq!(wire["errorCode"], "VALIDATION_FAILED");
        assert_eq!(wire["details"]["validationCode"], "INVALID_REQUEST_PAYLOAD");
        assert_eq!(wire["retryable"], false);
    }
}
