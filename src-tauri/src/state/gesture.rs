use std::collections::HashSet;

use serde_json::Value;

use crate::{
    errors::EditorCommitError,
    models::{EditorCommitRequest, GestureCommitRequest, PluginInstancesCommitRequest},
};

use super::{
    editor::{
        decode_exact_frozen_insert, request_payload_size, validate_request_envelope,
        validate_revision,
    },
    plugin::validate_plugin_instances_request,
};

const MAX_GESTURE_PLUGINS: usize = 64;
const MAX_GESTURE_REQUEST_BYTES: usize = 16 * 1024 * 1024;

pub(crate) fn decode_gesture_commit_request(
    value: Value,
) -> Result<GestureCommitRequest, EditorCommitError> {
    let has_frozen_insert = value
        .get("editorOps")
        .and_then(Value::as_array)
        .is_some_and(|ops| {
            ops.iter()
                .any(|op| op.get("kind").and_then(Value::as_str) == Some("insertFrozenElements"))
        });
    if !has_frozen_insert {
        return serde_json::from_value(value).map_err(|error| {
            EditorCommitError::validation(
                "INVALID_REQUEST_PAYLOAD",
                format!("invalid gesture request: {error}"),
            )
        });
    }
    decode_exact_frozen_insert(value, "gesture")
}

pub(crate) fn validate_gesture_commit_request(
    request: &GestureCommitRequest,
) -> Result<usize, EditorCommitError> {
    validate_revision(request.editor_base_revision)?;
    validate_revision(request.plugin_base_revision)?;
    validate_revision(request.authority_generation)?;
    if let Some(epoch) = request.observed_history_epoch {
        validate_revision(epoch)?;
    }

    let editor_envelope = match (
        request.editor_changes.as_ref(),
        request.editor_ops_version,
        request.editor_ops.as_ref(),
    ) {
        (Some(changes), None, None) => EditorCommitRequest {
            base_revision: request.editor_base_revision,
            mutation_id: request.mutation_id.clone(),
            multi_key: false,
            gesture_id: Some(request.gesture_id.clone()),
            gesture_ids: Vec::new(),
            changes: Some(changes.clone()),
            ops_version: None,
            ops: None,
        },
        (None, Some(version), Some(ops)) => EditorCommitRequest {
            base_revision: request.editor_base_revision,
            mutation_id: request.mutation_id.clone(),
            multi_key: false,
            gesture_id: Some(request.gesture_id.clone()),
            gesture_ids: Vec::new(),
            changes: None,
            ops_version: Some(version),
            ops: Some(ops.clone()),
        },
        // plugin-only도 기존과 같은 공통 mutation/gesture ID 검증을 통과
        (None, None, None) => EditorCommitRequest {
            base_revision: request.editor_base_revision,
            mutation_id: request.mutation_id.clone(),
            multi_key: false,
            gesture_id: Some(request.gesture_id.clone()),
            gesture_ids: Vec::new(),
            changes: Some(Default::default()),
            ops_version: None,
            ops: None,
        },
        _ => {
            return Err(EditorCommitError::validation(
                "INVALID_GESTURE_EDITOR_MUTATION",
                "gesture request must contain at most one complete editor mutation",
            ));
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        EditorBoundsV1, EditorElementTypeV1, EditorGroupUpdateV1, EditorOpV1, EditorPatchV1,
        EditorZUpdateV1, GesturePluginInstancesChange, EDITOR_OPS_VERSION,
    };

    fn gesture_request(plugin_ids: &[String]) -> GestureCommitRequest {
        GestureCommitRequest {
            gesture_id: uuid::Uuid::new_v4().to_string(),
            mutation_id: uuid::Uuid::new_v4().to_string(),
            editor_base_revision: 0,
            plugin_base_revision: 0,
            observed_history_epoch: None,
            authority_generation: 1,
            editor_changes: None,
            editor_ops_version: None,
            editor_ops: None,
            plugin_changes: plugin_ids
                .iter()
                .map(|plugin_id| GesturePluginInstancesChange {
                    plugin_id: plugin_id.clone(),
                    instances: Vec::new(),
                })
                .collect(),
        }
    }

    fn validation_code(error: EditorCommitError) -> Option<String> {
        error.details.and_then(|details| details.validation_code)
    }

    fn set_bounds_op() -> EditorOpV1 {
        EditorOpV1::SetBounds {
            element_type: EditorElementTypeV1::Key,
            id: uuid::Uuid::new_v4().to_string(),
            bounds: EditorBoundsV1 {
                dx: 1.0,
                dy: 2.0,
                width: 3.0,
                height: 4.0,
            },
        }
    }

    fn frozen_insert_op() -> EditorOpV1 {
        EditorOpV1::InsertFrozenElements {
            mode: "4key".to_string(),
            elements: vec![crate::models::EditorFrozenElementV1::Key {
                slot: crate::models::EditorFrozenKeySlotV1::Single("FROZEN".to_string()),
                position: crate::models::KeyPosition {
                    id: uuid::Uuid::new_v4().to_string(),
                    ..crate::models::KeyPosition::default()
                },
            }],
            groups: Vec::new(),
            z_updates: Vec::new(),
        }
    }

    fn reorder_op() -> EditorOpV1 {
        let id = uuid::Uuid::new_v4().to_string();
        EditorOpV1::ReorderElements {
            mode: "4key".to_string(),
            complete_mode_order: true,
            z_updates: vec![EditorZUpdateV1 {
                element_type: EditorElementTypeV1::Key,
                id: id.clone(),
                z_index: 1,
            }],
            group_updates: vec![EditorGroupUpdateV1 {
                element_type: EditorElementTypeV1::Key,
                id,
                group_id: None,
            }],
        }
    }

    #[test]
    fn gesture_allows_plugin_only_patch_or_ops_but_not_both_editor_mutations() {
        let plugin_ids = ["plugin-a".to_string()];
        let plugin_only = gesture_request(&plugin_ids);
        validate_gesture_commit_request(&plugin_only).unwrap();
        let mut invalid_plugin_only = plugin_only.clone();
        invalid_plugin_only.gesture_id = "not-a-uuid".to_string();
        assert_eq!(
            validate_gesture_commit_request(&invalid_plugin_only)
                .unwrap_err()
                .error_code,
            crate::errors::EditorCommitErrorCode::InvalidGestureId
        );

        let mut patch = plugin_only.clone();
        patch.editor_changes = Some(EditorPatchV1::default());
        validate_gesture_commit_request(&patch).unwrap();

        let mut ops = plugin_only.clone();
        ops.editor_ops_version = Some(EDITOR_OPS_VERSION);
        ops.editor_ops = Some(vec![set_bounds_op()]);
        validate_gesture_commit_request(&ops).unwrap();

        let mut both = ops.clone();
        both.editor_changes = Some(EditorPatchV1::default());
        assert_eq!(
            validation_code(validate_gesture_commit_request(&both).unwrap_err()).as_deref(),
            Some("INVALID_GESTURE_EDITOR_MUTATION")
        );

        for invalid in [
            GestureCommitRequest {
                editor_ops: None,
                ..ops.clone()
            },
            GestureCommitRequest {
                editor_ops_version: None,
                ..ops
            },
        ] {
            assert_eq!(
                validation_code(validate_gesture_commit_request(&invalid).unwrap_err()).as_deref(),
                Some("INVALID_GESTURE_EDITOR_MUTATION")
            );
        }
    }

    #[test]
    fn gesture_requires_at_least_one_plugin_change() {
        let error = validate_gesture_commit_request(&gesture_request(&[])).unwrap_err();

        assert_eq!(
            validation_code(error).as_deref(),
            Some("INVALID_GESTURE_PLUGIN_COUNT")
        );
    }

    #[test]
    fn gesture_frozen_insert_wire_rejects_unknown_nested_keys() {
        let mut request = gesture_request(&["plugin-a".to_string()]);
        request.editor_ops_version = Some(EDITOR_OPS_VERSION);
        request.editor_ops = Some(vec![frozen_insert_op()]);
        let mut wire = serde_json::to_value(request).unwrap();
        wire["editorOps"][0]["elements"][0]["position"]["unexpected"] = serde_json::json!(true);

        let error = decode_gesture_commit_request(wire).unwrap_err();
        assert_eq!(
            validation_code(error).as_deref(),
            Some("INVALID_REQUEST_PAYLOAD")
        );
    }

    #[test]
    fn gesture_reorder_wire_rejects_unknown_and_missing_nested_keys() {
        let mut request = gesture_request(&["plugin-a".to_string()]);
        request.editor_ops_version = Some(EDITOR_OPS_VERSION);
        request.editor_ops = Some(vec![reorder_op()]);
        let valid = serde_json::to_value(request).unwrap();

        let mut unknown_z = valid.clone();
        unknown_z["editorOps"][0]["zUpdates"][0]["unexpected"] = serde_json::json!(true);
        let mut unknown_group = valid.clone();
        unknown_group["editorOps"][0]["groupUpdates"][0]["unexpected"] = serde_json::json!(true);
        let mut missing_group_id = valid;
        missing_group_id["editorOps"][0]["groupUpdates"][0]
            .as_object_mut()
            .unwrap()
            .remove("groupId");

        for wire in [unknown_z, unknown_group, missing_group_id] {
            let error = decode_gesture_commit_request(wire).unwrap_err();
            assert_eq!(
                validation_code(error).as_deref(),
                Some("INVALID_REQUEST_PAYLOAD")
            );
        }
    }

    #[test]
    fn gesture_rejects_more_than_sixty_four_plugin_changes() {
        let plugin_ids = (0..65)
            .map(|index| format!("plugin-{index}"))
            .collect::<Vec<_>>();
        let error = validate_gesture_commit_request(&gesture_request(&plugin_ids)).unwrap_err();

        assert_eq!(
            validation_code(error).as_deref(),
            Some("INVALID_GESTURE_PLUGIN_COUNT")
        );
    }

    #[test]
    fn gesture_rejects_duplicate_plugin_changes() {
        let plugin_ids = vec!["plugin-a".to_string(), "plugin-a".to_string()];
        let error = validate_gesture_commit_request(&gesture_request(&plugin_ids)).unwrap_err();

        assert_eq!(
            validation_code(error).as_deref(),
            Some("DUPLICATE_GESTURE_PLUGIN")
        );
    }
}
