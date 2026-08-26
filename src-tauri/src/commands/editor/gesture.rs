use tauri::{AppHandle, State, WebviewWindow};

use crate::{
    commands::{
        editor::state::{emit_best_effort, publish_editor_change, publish_legacy_editor_fields},
        plugin::instances::publish_plugin_instances_changed,
    },
    errors::{CmdResult, EditorCommitError},
    models::{GestureCommitResult, PluginInstancesChangedPayload},
    services::preview_broker::PreviewBroker,
    state::{
        gesture::{decode_gesture_commit_request, validate_gesture_commit_request},
        AppState,
    },
};

#[tauri::command]
pub fn commit_gesture(
    state: State<'_, AppState>,
    broker: State<'_, PreviewBroker>,
    app: AppHandle,
    window: WebviewWindow,
    request: serde_json::Value,
) -> CmdResult<GestureCommitResult> {
    let request = decode_gesture_commit_request(request)?;
    validate_gesture_commit_request(&request)?;
    if window.label() != super::MAIN_WINDOW_LABEL {
        return Err(crate::errors::CommandError::msg(
            "GESTURE_MUTATION_NOT_ALLOWED",
        ));
    }

    let authority = state
        .plugin_authority()
        .admit(request.authority_generation)
        .map_err(crate::errors::CommandError::msg)?;
    let admission = state
        .admit_frontend_history_mutation(window.label())
        .map_err(|_| EditorCommitError::history_in_progress())?;
    let mutation_id = request.mutation_id.clone();
    let gesture_id = request.gesture_id.clone();
    let is_editor_ops = request.editor_ops.is_some();
    let requested_fields = request
        .editor_changes
        .as_ref()
        .map_or_else(Vec::new, |changes| changes.included_fields());
    let previous_mode = requested_fields
        .contains(&crate::models::EditorField::Keys)
        .then(|| state.keyboard.current_mode());

    let committed = state
        .store
        .commit_gesture_with_admission(request, admission)?;
    let outcome = &committed.outcome;
    if let Err(error) =
        broker.finish_committed_session(window.label(), &gesture_id, outcome.change.is_none())
    {
        log::warn!("failed to finish committed gesture preview session: {error}");
    }

    if let Some(change) = outcome.change.as_ref() {
        publish_editor_change(state.inner(), &app, change, false);
        if !outcome.replayed {
            let legacy_fields = if is_editor_ops {
                change.result.changed_fields.as_slice()
            } else {
                requested_fields.as_slice()
            };
            publish_legacy_editor_fields(state.inner(), &app, change, legacy_fields);
            if previous_mode.is_some_and(|mode| mode != change.selected_key_type) {
                emit_best_effort(
                    &app,
                    "keys:mode-changed",
                    &serde_json::json!({ "mode": &change.selected_key_type }),
                );
            }
        }
    }
    if !outcome.replayed {
        for plugin_id in &outcome.changed_plugin_ids {
            publish_plugin_instances_changed(
                &app,
                &PluginInstancesChangedPayload {
                    plugin_id: plugin_id.clone(),
                    revision: outcome.result.plugin_model_revision,
                    origin_mutation_id: Some(mutation_id.clone()),
                },
            );
        }
    }
    if let Some(status) = outcome.history_status.as_ref() {
        emit_best_effort(&app, "history:status", status);
    }

    let mut result = outcome.result.clone();
    result.authority_generation = authority.generation();
    Ok(result)
}
