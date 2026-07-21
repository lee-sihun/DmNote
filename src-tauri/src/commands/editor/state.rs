use tauri::{AppHandle, Emitter, State, WebviewWindow};

use crate::{
    errors::CmdResult,
    models::{
        CommittedEditorChange, EditorCommitRequest, EditorCommitResult, EditorField,
        EditorGetResult,
    },
    services::preview_broker::PreviewBroker,
    state::AppState,
};

pub(crate) fn emit_best_effort<T: serde::Serialize>(app: &AppHandle, event: &str, payload: &T) {
    if let Err(error) = app.emit(event, payload) {
        log::error!("[Editor] failed to emit {event}: {error}");
    }
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

fn publish_editor_change_with_options(
    state: &AppState,
    app: &AppHandle,
    change: &CommittedEditorChange,
    legacy_fields: &[EditorField],
    key_runtime_policy: KeyRuntimePublishPolicy,
) {
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
pub fn editor_get(state: State<'_, AppState>) -> CmdResult<EditorGetResult> {
    Ok(state.store.editor_get())
}

#[tauri::command]
pub fn editor_commit(
    state: State<'_, AppState>,
    broker: State<'_, PreviewBroker>,
    app: AppHandle,
    window: WebviewWindow,
    request: EditorCommitRequest,
) -> CmdResult<EditorCommitResult> {
    let admission = state
        .admit_frontend_history_mutation(window.label())
        .map_err(|_| crate::errors::EditorCommitError::history_in_progress())?;
    let gesture_id = request.gesture_id.clone();
    let requested_fields = request.changes.included_fields();
    let previous_mode = requested_fields
        .contains(&EditorField::Keys)
        .then(|| state.keyboard.current_mode());
    let change = state
        .store
        .commit_editor_document_admitted(request, &admission)?;
    if change.event.is_some() {
        publish_editor_change(state.inner(), &app, &change, false);
    }
    if !change.replayed {
        publish_legacy_editor_fields(state.inner(), &app, &change, &requested_fields);
        if previous_mode.is_some_and(|mode| mode != change.selected_key_type) {
            emit_best_effort(
                &app,
                "keys:mode-changed",
                &serde_json::json!({ "mode": &change.selected_key_type }),
            );
        }
    }
    if let Some(gesture_id) = gesture_id {
        if let Err(error) = broker.finish_committed_session(
            window.label(),
            &gesture_id,
            Some(change.result.revision),
        ) {
            log::warn!("failed to finish committed preview session: {error}");
        }
    }
    if let Some(history_status) = change.history_status.as_ref() {
        emit_best_effort(&app, "history:status", history_status);
    }
    drop(admission);
    Ok(change.result)
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
                "layerGroups:changed",
            ]
        );
    }
}
