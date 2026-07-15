use tauri::{AppHandle, Emitter, State};

use crate::{
    errors::CmdResult,
    models::{
        CommittedEditorChange, EditorCommitRequest, EditorCommitResult, EditorField,
        EditorGetResult,
    },
    state::AppState,
};

pub(crate) fn emit_best_effort<T: serde::Serialize>(app: &AppHandle, event: &str, payload: &T) {
    if let Err(error) = app.emit(event, payload) {
        log::error!("[Editor] failed to emit {event}: {error}");
    }
}

pub(crate) fn publish_legacy_editor_fields(
    state: &AppState,
    app: &AppHandle,
    change: &CommittedEditorChange,
    fields: &[EditorField],
) {
    for field in fields {
        match field {
            EditorField::Keys => {
                emit_best_effort(app, "keys:changed", &change.document.keys);
            }
            EditorField::KeyPositions => {
                emit_best_effort(app, "positions:changed", &change.document.key_positions);
            }
            EditorField::StatPositions => {
                emit_best_effort(
                    app,
                    "statPositions:changed",
                    &change.document.stat_positions,
                );
            }
            EditorField::GraphPositions => {
                emit_best_effort(
                    app,
                    "graphPositions:changed",
                    &change.document.graph_positions,
                );
            }
            EditorField::KnobPositions => {
                emit_best_effort(
                    app,
                    "knobPositions:changed",
                    &change.document.knob_positions,
                );
            }
            EditorField::LayerGroups => {
                emit_best_effort(app, "layerGroups:changed", &change.document.layer_groups);
            }
        }
    }

    if fields.contains(&EditorField::Keys)
        && !change.result.changed_fields.contains(&EditorField::Keys)
    {
        if let Err(error) = state.apply_committed_editor_key_runtime(
            app,
            &change.document.keys,
            &change.selected_key_type,
            &change.key_counters,
        ) {
            log::error!("[Editor] failed to publish legacy key refresh: {error:#}");
        }
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
    let Some(event) = change.event.as_ref() else {
        return;
    };
    emit_best_effort(app, "editor:committed", event);

    let keys_changed = change.result.changed_fields.contains(&EditorField::Keys);
    let previous_mode = keys_changed.then(|| state.keyboard.current_mode());
    if keys_changed {
        if let Err(error) = state.apply_committed_editor_key_runtime(
            app,
            &change.document.keys,
            &change.selected_key_type,
            &change.key_counters,
        ) {
            log::error!("[Editor] failed to publish committed key counters: {error:#}");
        }
    }

    if project_legacy_events && !change.result.changed_fields.is_empty() {
        publish_legacy_editor_fields(state, app, change, &change.result.changed_fields);
    }

    if project_legacy_events && previous_mode.is_some_and(|mode| mode != change.selected_key_type) {
        emit_best_effort(
            app,
            "keys:mode-changed",
            &serde_json::json!({ "mode": &change.selected_key_type }),
        );
    }

    if keys_changed {
        state.obs_broadcast_counters();
    }

    if !change.result.changed_fields.is_empty() {
        state.refresh_obs_snapshot();
    }
}

#[tauri::command]
pub fn editor_get(state: State<'_, AppState>) -> CmdResult<EditorGetResult> {
    Ok(state.store.editor_get())
}

#[tauri::command]
pub fn editor_commit(
    state: State<'_, AppState>,
    app: AppHandle,
    request: EditorCommitRequest,
) -> CmdResult<EditorCommitResult> {
    let requested_fields = request.changes.included_fields();
    let previous_mode = requested_fields
        .contains(&EditorField::Keys)
        .then(|| state.keyboard.current_mode());
    let change = state.store.commit_editor_document(request)?;
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
    Ok(change.result)
}
