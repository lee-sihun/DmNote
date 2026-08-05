use std::collections::HashSet;

use crate::{
    errors::EditorCommitError,
    models::{EditorCommitRequest, GestureCommitRequest, PluginInstancesCommitRequest},
};

use super::{
    editor::{request_payload_size, validate_request_envelope, validate_revision},
    plugin::validate_plugin_instances_request,
};

const MAX_GESTURE_PLUGINS: usize = 64;
const MAX_GESTURE_REQUEST_BYTES: usize = 16 * 1024 * 1024;

pub(crate) fn validate_gesture_commit_request(
    request: &GestureCommitRequest,
) -> Result<usize, EditorCommitError> {
    validate_revision(request.editor_base_revision)?;
    validate_revision(request.plugin_base_revision)?;
    validate_revision(request.authority_generation)?;
    if let Some(epoch) = request.observed_history_epoch {
        validate_revision(epoch)?;
    }

    let editor_envelope = EditorCommitRequest {
        base_revision: request.editor_base_revision,
        mutation_id: request.mutation_id.clone(),
        gesture_id: Some(request.gesture_id.clone()),
        gesture_ids: Vec::new(),
        changes: request.editor_changes.clone().unwrap_or_default(),
    };
    validate_request_envelope(&editor_envelope)?;
    request_payload_size(&editor_envelope)?;

    if request.plugin_changes.is_empty() || request.plugin_changes.len() > MAX_GESTURE_PLUGINS {
        return Err(EditorCommitError::validation(
            "INVALID_GESTURE_PLUGIN_COUNT",
            format!("gesture transaction must contain between 1 and {MAX_GESTURE_PLUGINS} plugins"),
        ));
    }

    let mut plugin_ids = HashSet::with_capacity(request.plugin_changes.len());
    for change in &request.plugin_changes {
        if !plugin_ids.insert(change.plugin_id.as_str()) {
            return Err(EditorCommitError::validation(
                "DUPLICATE_GESTURE_PLUGIN",
                format!(
                    "gesture transaction contains duplicate plugin '{}'",
                    change.plugin_id
                ),
            ));
        }
        let plugin_request = PluginInstancesCommitRequest {
            plugin_id: change.plugin_id.clone(),
            instances: change.instances.clone(),
            mutation_id: request.mutation_id.clone(),
            gesture_id: Some(request.gesture_id.clone()),
            observed_history_epoch: request.observed_history_epoch,
            expected_model_revision: Some(request.plugin_base_revision),
            authority_generation: request.authority_generation,
        };
        validate_plugin_instances_request(&plugin_request).map_err(|error| {
            EditorCommitError::validation(
                error.clone(),
                format!(
                    "invalid plugin gesture change '{}': {error}",
                    change.plugin_id
                ),
            )
        })?;
    }

    let size = serde_json::to_vec(request)
        .map_err(|error| {
            EditorCommitError::validation(
                "INVALID_REQUEST_PAYLOAD",
                format!("failed to serialize gesture request: {error}"),
            )
        })?
        .len();
    if size > MAX_GESTURE_REQUEST_BYTES {
        return Err(EditorCommitError::validation(
            "REQUEST_TOO_LARGE",
            format!("gesture request exceeds the {MAX_GESTURE_REQUEST_BYTES} byte limit"),
        ));
    }
    Ok(size)
}
