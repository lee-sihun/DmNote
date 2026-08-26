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
        EditorBoundsV1, EditorElementGroupTargetV1, EditorElementPropertyPatchV1,
        EditorElementTypeV1, EditorFrozenKeySlotV1, EditorGroupUpdateV1, EditorOpV1, EditorPatchV1,
        EditorTargetGroupV1, EditorZUpdateV1, GesturePluginInstancesChange, EDITOR_OPS_VERSION,
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

    fn property_op() -> EditorOpV1 {
        EditorOpV1::PatchElement {
            element_type: EditorElementTypeV1::Key,
            id: uuid::Uuid::new_v4().to_string(),
            patch: EditorElementPropertyPatchV1::Hidden(true),
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
    fn gesture_group_structural_wire_is_exact_tagged_and_required_nullable() {
        let target = EditorElementGroupTargetV1 {
            element_type: EditorElementTypeV1::Key,
            id: uuid::Uuid::new_v4().to_string(),
        };
        let mut request = gesture_request(&["plugin-a".to_string()]);
        request.editor_ops_version = Some(EDITOR_OPS_VERSION);
        request.editor_ops = Some(vec![EditorOpV1::SetElementGroups {
            mode: "4key".to_string(),
            targets: vec![target.clone()],
            target_group: Some(EditorTargetGroupV1::Create {
                id: " legacy group ".to_string(),
                name: " Raw Name ".to_string(),
            }),
        }]);
        let create = serde_json::to_value(request).unwrap();
        assert_eq!(
            create["editorOps"][0]["targetGroup"],
            serde_json::json!({
                "kind": "create",
                "id": " legacy group ",
                "name": " Raw Name ",
            })
        );
        let decoded = decode_gesture_commit_request(create.clone()).unwrap();
        validate_gesture_commit_request(&decoded).unwrap();

        let mut ungroup_request = gesture_request(&["plugin-a".to_string()]);
        ungroup_request.editor_ops_version = Some(EDITOR_OPS_VERSION);
        ungroup_request.editor_ops = Some(vec![EditorOpV1::SetElementGroups {
            mode: "4key".to_string(),
            targets: vec![target],
            target_group: None,
        }]);
        let ungroup = serde_json::to_value(ungroup_request).unwrap();
        assert!(ungroup["editorOps"][0]["targetGroup"].is_null());
        let decoded = decode_gesture_commit_request(ungroup.clone()).unwrap();
        validate_gesture_commit_request(&decoded).unwrap();

        let mut rename_request = gesture_request(&["plugin-a".to_string()]);
        rename_request.editor_ops_version = Some(EDITOR_OPS_VERSION);
        rename_request.editor_ops = Some(vec![EditorOpV1::RenameLayerGroup {
            mode: "4key".to_string(),
            group_id: "legacy-group".to_string(),
            name: "Name".to_string(),
        }]);
        let rename = serde_json::to_value(rename_request).unwrap();
        assert_eq!(rename["editorOps"][0]["groupId"], "legacy-group");
        let decoded = decode_gesture_commit_request(rename.clone()).unwrap();
        validate_gesture_commit_request(&decoded).unwrap();

        let mut missing_target_group = ungroup.clone();
        missing_target_group["editorOps"][0]
            .as_object_mut()
            .unwrap()
            .remove("targetGroup");
        let mut untagged = create.clone();
        untagged["editorOps"][0]["targetGroup"] = serde_json::json!({
            "id": "group",
            "name": "Group",
        });
        let mut combined = create.clone();
        combined["editorOps"][0]["targetGroup"] = serde_json::json!({
            "kind": "existing",
            "id": "group",
            "name": "No rename",
        });
        let mut target_extra = create.clone();
        target_extra["editorOps"][0]["targets"][0]["unexpected"] = serde_json::json!(true);
        let mut group_extra = create;
        group_extra["editorOps"][0]["targetGroup"]["unexpected"] = serde_json::json!(true);
        let mut rename_extra = rename;
        rename_extra["editorOps"][0]["unexpected"] = serde_json::json!(true);

        for invalid in [
            missing_target_group,
            untagged,
            combined,
            target_extra,
            group_extra,
            rename_extra,
        ] {
            let error = decode_gesture_commit_request(invalid).unwrap_err();
            assert_eq!(
                validation_code(error).as_deref(),
                Some("INVALID_REQUEST_PAYLOAD")
            );
        }
    }

    #[test]
    fn gesture_property_and_key_slot_wires_reject_unknown_nested_keys() {
        let mut property = gesture_request(&["plugin-a".to_string()]);
        property.editor_ops_version = Some(EDITOR_OPS_VERSION);
        property.editor_ops = Some(vec![property_op()]);
        let mut property_wire = serde_json::to_value(property).unwrap();
        property_wire["editorOps"][0]["patch"]["width"] = serde_json::json!(1);
        let error = decode_gesture_commit_request(property_wire).unwrap_err();
        assert_eq!(
            validation_code(error).as_deref(),
            Some("INVALID_REQUEST_PAYLOAD")
        );

        let mut layer_name = gesture_request(&["plugin-a".to_string()]);
        layer_name.editor_ops_version = Some(EDITOR_OPS_VERSION);
        layer_name.editor_ops = Some(vec![EditorOpV1::PatchElement {
            element_type: EditorElementTypeV1::Graph,
            id: uuid::Uuid::new_v4().to_string(),
            patch: EditorElementPropertyPatchV1::LayerName(None),
        }]);
        let layer_name_wire = serde_json::to_value(layer_name).unwrap();
        assert_eq!(
            layer_name_wire["editorOps"][0]["patch"],
            serde_json::json!({ "property": "layerName", "value": null })
        );
        decode_gesture_commit_request(layer_name_wire.clone()).unwrap();

        let mut graph_type = gesture_request(&["plugin-a".to_string()]);
        graph_type.editor_ops_version = Some(EDITOR_OPS_VERSION);
        graph_type.editor_ops = Some(vec![EditorOpV1::PatchElement {
            element_type: EditorElementTypeV1::Graph,
            id: uuid::Uuid::new_v4().to_string(),
            patch: EditorElementPropertyPatchV1::GraphType(crate::models::GraphType::Bar),
        }]);
        let graph_type_wire = serde_json::to_value(graph_type).unwrap();
        assert_eq!(
            graph_type_wire["editorOps"][0]["patch"],
            serde_json::json!({ "property": "graphType", "value": "bar" })
        );
        decode_gesture_commit_request(graph_type_wire.clone()).unwrap();

        let mut graph_color = gesture_request(&["plugin-a".to_string()]);
        graph_color.editor_ops_version = Some(EDITOR_OPS_VERSION);
        graph_color.editor_ops = Some(vec![EditorOpV1::PatchElement {
            element_type: EditorElementTypeV1::Graph,
            id: uuid::Uuid::new_v4().to_string(),
            patch: EditorElementPropertyPatchV1::GraphColor("not-normalized".to_string()),
        }]);
        let graph_color_wire = serde_json::to_value(graph_color).unwrap();
        assert_eq!(
            graph_color_wire["editorOps"][0]["patch"],
            serde_json::json!({ "property": "graphColor", "value": "not-normalized" })
        );
        decode_gesture_commit_request(graph_color_wire.clone()).unwrap();

        let mut paint = gesture_request(&["plugin-a".to_string()]);
        paint.editor_ops_version = Some(EDITOR_OPS_VERSION);
        paint.editor_ops = Some(vec![EditorOpV1::PatchElement {
            element_type: EditorElementTypeV1::Knob,
            id: uuid::Uuid::new_v4().to_string(),
            patch: EditorElementPropertyPatchV1::ActiveBorderPaint(
                crate::models::EditorPaintDescriptorV1 {
                    color: "active".to_string(),
                    gradient: None,
                },
            ),
        }]);
        let paint_wire = serde_json::to_value(paint).unwrap();
        assert_eq!(
            paint_wire["editorOps"][0]["patch"],
            serde_json::json!({ "property": "activeBorderPaint", "value": { "color": "active", "gradient": null } })
        );
        decode_gesture_commit_request(paint_wire.clone()).unwrap();

        let literal_properties = [
            (
                EditorElementTypeV1::Graph,
                EditorElementPropertyPatchV1::ShowAvgLine(true),
                serde_json::json!({ "property": "showAvgLine", "value": true }),
            ),
            (
                EditorElementTypeV1::Graph,
                EditorElementPropertyPatchV1::GraphAnimationEnabled(false),
                serde_json::json!({ "property": "graphAnimationEnabled", "value": false }),
            ),
            (
                EditorElementTypeV1::Graph,
                EditorElementPropertyPatchV1::GraphSpeed(0),
                serde_json::json!({ "property": "graphSpeed", "value": 0 }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::Reverse(true),
                serde_json::json!({ "property": "reverse", "value": true }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::Sensitivity(-7.25),
                serde_json::json!({ "property": "sensitivity", "value": -7.25 }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::AxisId("  HIDA:raw  ".to_string()),
                serde_json::json!({ "property": "axisId", "value": "  HIDA:raw  " }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::UseInlineStyles(false),
                serde_json::json!({ "property": "useInlineStyles", "value": false }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::FontWeight(400),
                serde_json::json!({ "property": "fontWeight", "value": 400 }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::FontItalic(false),
                serde_json::json!({ "property": "fontItalic", "value": false }),
            ),
            (
                EditorElementTypeV1::Graph,
                EditorElementPropertyPatchV1::FontUnderline(true),
                serde_json::json!({ "property": "fontUnderline", "value": true }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::FontStrikethrough(false),
                serde_json::json!({ "property": "fontStrikethrough", "value": false }),
            ),
            (
                EditorElementTypeV1::Graph,
                EditorElementPropertyPatchV1::FontFamily(" raw-font ".to_string()),
                serde_json::json!({ "property": "fontFamily", "value": " raw-font " }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::DisplayText("  raw display  ".to_string()),
                serde_json::json!({ "property": "displayText", "value": "  raw display  " }),
            ),
            (
                EditorElementTypeV1::Graph,
                EditorElementPropertyPatchV1::ClassName("  raw class  ".to_string()),
                serde_json::json!({ "property": "className", "value": "  raw class  " }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::FontPaint(crate::models::EditorPaintDescriptorV1 {
                    color: String::new(),
                    gradient: None,
                }),
                serde_json::json!({ "property": "fontPaint", "value": { "color": "", "gradient": null } }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::ActiveFontPaint(
                    crate::models::EditorPaintDescriptorV1 {
                        color: "  raw active font  ".to_string(),
                        gradient: None,
                    },
                ),
                serde_json::json!({ "property": "activeFontPaint", "value": { "color": "  raw active font  ", "gradient": null } }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::Shadow(crate::models::EditorShadowLeafPatchV1::Blur(
                    8.5,
                )),
                serde_json::json!({ "property": "shadow", "value": { "leaf": "blur", "value": 8.5 } }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::ActiveShadow(
                    crate::models::EditorShadowLeafPatchV1::OffsetY(-3.25),
                ),
                serde_json::json!({ "property": "activeShadow", "value": { "leaf": "offsetY", "value": -3.25 } }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::ShadowEnabled(true),
                serde_json::json!({ "property": "shadowEnabled", "value": true }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::BorderWidth(0.5),
                serde_json::json!({ "property": "borderWidth", "value": 0.5 }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::BorderRadius(999.0),
                serde_json::json!({ "property": "borderRadius", "value": 999.0 }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::FontSize(8.5),
                serde_json::json!({ "property": "fontSize", "value": 8.5 }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::InactiveImage(String::new()),
                serde_json::json!({ "property": "inactiveImage", "value": "" }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::ActiveImage("  active.png  ".to_string()),
                serde_json::json!({ "property": "activeImage", "value": "  active.png  " }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::IdleTransparent(true),
                serde_json::json!({ "property": "idleTransparent", "value": true }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::ActiveTransparent(false),
                serde_json::json!({ "property": "activeTransparent", "value": false }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::IdleImageFit(crate::models::ImageFit::Fill),
                serde_json::json!({ "property": "idleImageFit", "value": "fill" }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::ActiveImageFit(crate::models::ImageFit::Cover),
                serde_json::json!({ "property": "activeImageFit", "value": "cover" }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::SoundPath(String::new()),
                serde_json::json!({ "property": "soundPath", "value": "" }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::SoundEnabled(false),
                serde_json::json!({ "property": "soundEnabled", "value": false }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::SoundVolume(137.5),
                serde_json::json!({ "property": "soundVolume", "value": 137.5 }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::CounterEnabled(true),
                serde_json::json!({ "property": "counterEnabled", "value": true }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterAnimationEnabled(false),
                serde_json::json!({ "property": "counterAnimationEnabled", "value": false }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::CounterPlacement(
                    crate::models::KeyCounterPlacement::Outside,
                ),
                serde_json::json!({ "property": "counterPlacement", "value": "outside" }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterAlign(crate::models::KeyCounterAlign::Right),
                serde_json::json!({ "property": "counterAlign", "value": "right" }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::CounterAlignMode(
                    crate::models::KeyCounterAlignMode::Between,
                ),
                serde_json::json!({ "property": "counterAlignMode", "value": "between" }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterGap(u32::MAX),
                serde_json::json!({ "property": "counterGap", "value": u32::MAX }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::CounterFontSize(72),
                serde_json::json!({ "property": "counterFontSize", "value": 72 }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterFontWeight(900),
                serde_json::json!({ "property": "counterFontWeight", "value": 900 }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::CounterFontItalic(true),
                serde_json::json!({ "property": "counterFontItalic", "value": true }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterFontUnderline(true),
                serde_json::json!({ "property": "counterFontUnderline", "value": true }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::CounterFontStrikethrough(true),
                serde_json::json!({ "property": "counterFontStrikethrough", "value": true }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterFontFamily("  raw-counter-font  ".to_string()),
                serde_json::json!({ "property": "counterFontFamily", "value": "  raw-counter-font  " }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterFillIdle(
                    crate::models::EditorCounterFillIntentV1::Solid(
                        crate::models::EditorCounterFillSolidIntentV1 {
                            color: String::new(),
                        },
                    ),
                ),
                serde_json::json!({ "property": "counterFillIdle", "value": { "color": "" } }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::CounterFillActive(
                    crate::models::EditorCounterFillIntentV1::Gradient(
                        crate::models::EditorCounterFillGradientIntentV1 {
                            color: "rgba(170,187,204,1)".to_string(),
                            gradient: crate::models::EditorPaintGradientV1 {
                                angle: 180.0,
                                stops: vec![
                                    crate::models::EditorPaintGradientStopV1 {
                                        color: "#ABC".to_string(),
                                        pos: 0.0,
                                    },
                                    crate::models::EditorPaintGradientStopV1 {
                                        color: "transparent".to_string(),
                                        pos: 1.0,
                                    },
                                ],
                            },
                        },
                    ),
                ),
                serde_json::json!({ "property": "counterFillActive", "value": { "color": "rgba(170,187,204,1)", "gradient": { "angle": 180.0, "stops": [ { "color": "#ABC", "pos": 0.0 }, { "color": "transparent", "pos": 1.0 } ] } } }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterAnimationPreset(
                    crate::models::EditorCounterAnimationPresetIntentV1 {
                        preset_id: "builtin-ease-out".to_string(),
                        apply_preset_id: None,
                        bezier: None,
                        scale: None,
                        duration_ms: None,
                    },
                ),
                serde_json::json!({ "property": "counterAnimationPreset", "value": { "presetId": "builtin-ease-out" } }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::StatType(crate::models::StatType::Total),
                serde_json::json!({ "property": "statType", "value": "total" }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteEffectEnabled(false),
                serde_json::json!({ "property": "noteEffectEnabled", "value": false }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteGlowEnabled(true),
                serde_json::json!({ "property": "noteGlowEnabled", "value": true }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteGlowSyncPaint(true),
                serde_json::json!({ "property": "noteGlowSyncPaint", "value": true }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteGlowSize(19.75),
                serde_json::json!({ "property": "noteGlowSize", "value": 19.75 }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NotePaint(
                    crate::models::EditorNotePaintIntentV1::Color(
                        crate::models::EditorNotePaintColorIntentV1 {
                            color: crate::models::EditorNoteColorV1::Solid(String::new()),
                        },
                    ),
                ),
                serde_json::json!({ "property": "notePaint", "value": { "color": "" } }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteGlowPaint(
                    crate::models::EditorNotePaintIntentV1::Opacity(
                        crate::models::EditorNotePaintOpacityIntentV1 { opacity: 70 },
                    ),
                ),
                serde_json::json!({ "property": "noteGlowPaint", "value": { "opacity": 70 } }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteBorderPaint(
                    crate::models::EditorNoteBorderPaintV1 {
                        color: "#112233".to_string(),
                        opacity: 0,
                        gradient: None,
                    },
                ),
                serde_json::json!({ "property": "noteBorderPaint", "value": { "color": "#112233", "opacity": 0 } }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteOffsetX(Some(0.0)),
                serde_json::json!({ "property": "noteOffsetX", "value": 0.0 }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteOffsetY(None),
                serde_json::json!({ "property": "noteOffsetY", "value": null }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteWidth(Some(32.5)),
                serde_json::json!({ "property": "noteWidth", "value": 32.5 }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteBorderWidth(2.5),
                serde_json::json!({ "property": "noteBorderWidth", "value": 2.5 }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteBorderRadius(4.0),
                serde_json::json!({ "property": "noteBorderRadius", "value": 4.0 }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteAutoYCorrection(false),
                serde_json::json!({ "property": "noteAutoYCorrection", "value": false }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteAlignment(crate::models::NoteAlignment::Left),
                serde_json::json!({ "property": "noteAlignment", "value": "left" }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteBorderSide(
                    crate::models::EditorNoteBorderSideV1::Horizontal,
                ),
                serde_json::json!({ "property": "noteBorderSide", "value": "horizontal" }),
            ),
        ];
        for (element_type, patch, expected) in literal_properties {
            let mut request = gesture_request(&["plugin-a".to_string()]);
            request.editor_ops_version = Some(EDITOR_OPS_VERSION);
            request.editor_ops = Some(vec![EditorOpV1::PatchElement {
                element_type,
                id: uuid::Uuid::new_v4().to_string(),
                patch,
            }]);
            let wire = serde_json::to_value(request).unwrap();
            assert_eq!(wire["editorOps"][0]["patch"], expected);
            decode_gesture_commit_request(wire).unwrap();
        }

        let mut invalid_axis_id = graph_color_wire.clone();
        invalid_axis_id["editorOps"][0]["patch"] =
            serde_json::json!({ "property": "axisId", "value": false });
        let error = decode_gesture_commit_request(invalid_axis_id).unwrap_err();
        assert_eq!(
            validation_code(error).as_deref(),
            Some("INVALID_REQUEST_PAYLOAD")
        );
        for patch in [
            serde_json::json!({ "axisId": "axis", "hidden": true }),
            serde_json::json!({ "axisId": "axis", "unexpected": true }),
        ] {
            let mut invalid_axis_id = graph_color_wire.clone();
            invalid_axis_id["editorOps"][0]["patch"] = patch;
            let error = decode_gesture_commit_request(invalid_axis_id).unwrap_err();
            assert_eq!(
                validation_code(error).as_deref(),
                Some("INVALID_REQUEST_PAYLOAD")
            );
        }

        let mut invalid_graph_color = graph_color_wire;
        invalid_graph_color["editorOps"][0]["patch"]["graphColor"] = serde_json::json!(false);
        let error = decode_gesture_commit_request(invalid_graph_color).unwrap_err();
        assert_eq!(
            validation_code(error).as_deref(),
            Some("INVALID_REQUEST_PAYLOAD")
        );

        let mut invalid_font_family = layer_name_wire.clone();
        invalid_font_family["editorOps"][0]["patch"] =
            serde_json::json!({ "property": "fontFamily", "value": null });
        let error = decode_gesture_commit_request(invalid_font_family).unwrap_err();
        assert_eq!(
            validation_code(error).as_deref(),
            Some("INVALID_REQUEST_PAYLOAD")
        );

        for patch in [
            serde_json::json!({ "property": "displayText", "value": null }),
            serde_json::json!({ "property": "displayText", "value": 1 }),
            serde_json::json!({ "displayText": "text", "hidden": true }),
            serde_json::json!({ "displayText": "text", "unexpected": true }),
        ] {
            let mut invalid_display_text = layer_name_wire.clone();
            invalid_display_text["editorOps"][0]["patch"] = patch;
            let error = decode_gesture_commit_request(invalid_display_text).unwrap_err();
            assert_eq!(
                validation_code(error).as_deref(),
                Some("INVALID_REQUEST_PAYLOAD")
            );
        }

        for patch in [
            serde_json::json!({ "property": "className", "value": null }),
            serde_json::json!({ "property": "className", "value": 1 }),
            serde_json::json!({ "className": "class", "hidden": true }),
            serde_json::json!({ "className": "class", "unexpected": true }),
        ] {
            let mut invalid_class_name = layer_name_wire.clone();
            invalid_class_name["editorOps"][0]["patch"] = patch;
            let error = decode_gesture_commit_request(invalid_class_name).unwrap_err();
            assert_eq!(
                validation_code(error).as_deref(),
                Some("INVALID_REQUEST_PAYLOAD")
            );
        }

        for patch in [
            serde_json::json!({ "property": "fontPaint", "value": null }),
            serde_json::json!({ "property": "fontPaint", "value": { "color": "idle" } }),
            serde_json::json!({ "property": "activeFontPaint", "value": 1 }),
            serde_json::json!({ "fontPaint": { "color": "idle", "gradient": null }, "activeFontPaint": { "color": "active", "gradient": null } }),
            serde_json::json!({ "property": "fontPaint", "value": { "color": "idle", "gradient": null, "unexpected": true } }),
        ] {
            let mut invalid_font_color = layer_name_wire.clone();
            invalid_font_color["editorOps"][0]["patch"] = patch;
            let error = decode_gesture_commit_request(invalid_font_color).unwrap_err();
            assert_eq!(
                validation_code(error).as_deref(),
                Some("INVALID_REQUEST_PAYLOAD")
            );
        }

        for patch in [
            serde_json::json!({ "property": "shadow", "value": {} }),
            serde_json::json!({ "property": "shadow", "value": { "offsetX": 1, "blur": 2 } }),
            serde_json::json!({ "property": "shadow", "value": { "color": "shadow", "unexpected": true } }),
            serde_json::json!({ "property": "activeShadow", "value": null }),
            serde_json::json!({ "property": "activeShadow", "value": { "leaf": "offsetY", "value": "1" } }),
            serde_json::json!({ "property": "shadowEnabled", "value": "true" }),
            serde_json::json!({ "shadow": { "blur": 1 }, "hidden": false }),
        ] {
            let mut invalid_shadow = layer_name_wire.clone();
            invalid_shadow["editorOps"][0]["patch"] = patch;
            let error = decode_gesture_commit_request(invalid_shadow).unwrap_err();
            assert_eq!(
                validation_code(error).as_deref(),
                Some("INVALID_REQUEST_PAYLOAD")
            );
        }

        for patch in [
            serde_json::json!({ "property": "activeBorderPaint", "value": {} }),
            serde_json::json!({ "property": "activeBorderPaint", "value": { "color": "active" } }),
            serde_json::json!({ "property": "activeBorderPaint", "value": { "color": "active", "gradient": null, "unexpected": true } }),
            serde_json::json!({ "property": "activeBorderPaint", "value": { "color": "active", "gradient": { "stops": [{ "color": "active", "pos": 0 }, { "color": "tail", "pos": 1 }] } } }),
            serde_json::json!({ "property": "activeBorderPaint", "value": { "color": "active", "gradient": { "angle": 90 } } }),
            serde_json::json!({ "property": "activeBorderPaint", "value": { "color": "active", "gradient": { "angle": 90, "stops": [{ "color": "active", "pos": 0, "unexpected": true }, { "color": "tail", "pos": 1 }] } } }),
            serde_json::json!({ "activeBorderPaint": { "color": "active", "gradient": null }, "hidden": false }),
        ] {
            let mut invalid_paint = paint_wire.clone();
            invalid_paint["editorOps"][0]["patch"] = patch;
            let error = decode_gesture_commit_request(invalid_paint).unwrap_err();
            assert_eq!(
                validation_code(error).as_deref(),
                Some("INVALID_REQUEST_PAYLOAD")
            );
        }

        for patch in [
            serde_json::json!({ "property": "borderWidth", "value": null }),
            serde_json::json!({ "property": "borderWidth", "value": "1" }),
            serde_json::json!({ "borderWidth": 1, "fontSize": 14 }),
            serde_json::json!({ "borderWidth": 1, "unexpected": true }),
            serde_json::json!({ "property": "borderRadius", "value": null }),
            serde_json::json!({ "property": "borderRadius", "value": "1" }),
            serde_json::json!({ "borderRadius": 1, "hidden": false }),
            serde_json::json!({ "property": "fontSize", "value": null }),
            serde_json::json!({ "property": "fontSize", "value": "14" }),
            serde_json::json!({ "fontSize": 14, "unexpected": true }),
        ] {
            let mut invalid_numeric_style = layer_name_wire.clone();
            invalid_numeric_style["editorOps"][0]["patch"] = patch;
            let error = decode_gesture_commit_request(invalid_numeric_style).unwrap_err();
            assert_eq!(
                validation_code(error).as_deref(),
                Some("INVALID_REQUEST_PAYLOAD")
            );
        }

        for patch in [
            serde_json::json!({ "property": "inactiveImage", "value": null }),
            serde_json::json!({ "inactiveImage": "path", "hidden": false }),
            serde_json::json!({ "inactiveImage": "path", "unexpected": true }),
            serde_json::json!({ "property": "activeImage", "value": null }),
            serde_json::json!({ "activeImage": "path", "hidden": false }),
            serde_json::json!({ "activeImage": "path", "unexpected": true }),
            serde_json::json!({ "property": "idleTransparent", "value": null }),
            serde_json::json!({ "property": "idleTransparent", "value": "true" }),
            serde_json::json!({ "idleTransparent": true, "activeTransparent": false }),
            serde_json::json!({ "property": "activeTransparent", "value": 1 }),
            serde_json::json!({ "activeTransparent": false, "unexpected": true }),
            serde_json::json!({ "property": "idleImageFit", "value": "stretch" }),
            serde_json::json!({ "property": "idleImageFit", "value": null }),
            serde_json::json!({ "idleImageFit": "cover", "activeImageFit": "contain" }),
            serde_json::json!({ "property": "activeImageFit", "value": 1 }),
            serde_json::json!({ "activeImageFit": "none", "unexpected": true }),
            serde_json::json!({ "property": "soundPath", "value": null }),
            serde_json::json!({ "property": "soundPath", "value": 1 }),
            serde_json::json!({ "soundPath": "path", "soundEnabled": true }),
            serde_json::json!({ "soundPath": "path", "unexpected": true }),
            serde_json::json!({ "property": "soundEnabled", "value": null }),
            serde_json::json!({ "property": "soundEnabled", "value": "true" }),
            serde_json::json!({ "soundEnabled": true, "unexpected": true }),
            serde_json::json!({ "property": "soundVolume", "value": null }),
            serde_json::json!({ "property": "soundVolume", "value": "100" }),
            serde_json::json!({ "soundVolume": 100, "soundEnabled": true }),
            serde_json::json!({ "soundVolume": 100, "unexpected": true }),
            serde_json::json!({ "property": "counterEnabled", "value": 1 }),
            serde_json::json!({ "property": "counterAnimationEnabled", "value": null }),
            serde_json::json!({ "counterAnimationEnabled": true, "hidden": false }),
            serde_json::json!({ "property": "counterPlacement", "value": "center" }),
            serde_json::json!({ "property": "counterAlign", "value": "center" }),
            serde_json::json!({ "property": "counterAlignMode", "value": "outside" }),
            serde_json::json!({ "property": "counterGap", "value": -1 }),
            serde_json::json!({ "property": "counterGap", "value": 1.5 }),
            serde_json::json!({ "property": "counterGap", "value": 4_294_967_296_u64 }),
            serde_json::json!({ "counterPlacement": "inside", "counterAlign": "top" }),
            serde_json::json!({ "property": "counterFontSize", "value": -1 }),
            serde_json::json!({ "property": "counterFontWeight", "value": "400" }),
            serde_json::json!({ "property": "counterFontItalic", "value": null }),
            serde_json::json!({ "property": "counterFontUnderline", "value": 1 }),
            serde_json::json!({ "property": "counterFontStrikethrough", "value": "false" }),
            serde_json::json!({ "counterFontSize": 16, "counterFontWeight": 400 }),
            serde_json::json!({ "counterFontSize": 16, "unexpected": true }),
            serde_json::json!({ "property": "counterFontFamily", "value": null }),
            serde_json::json!({ "property": "counterFontFamily", "value": 1 }),
            serde_json::json!({ "counterFontFamily": "font", "counterFontItalic": true }),
            serde_json::json!({ "counterFontFamily": "font", "unexpected": true }),
            serde_json::json!({ "property": "counterFillIdle", "value": {} }),
            serde_json::json!({ "property": "counterFillIdle", "value": { "color": false } }),
            serde_json::json!({ "property": "counterFillIdle", "value": { "color": "solid", "gradient": null } }),
            serde_json::json!({ "property": "counterFillActive", "value": { "color": "first", "gradient": { "angle": 45 } } }),
            serde_json::json!({ "property": "counterFillActive", "value": { "color": "first", "gradient": { "angle": 45, "stops": [{ "color": "first", "pos": 0, "unexpected": true }, { "color": "last", "pos": 1 }] } } }),
            serde_json::json!({ "property": "counterFillIdle", "value": { "color": "solid", "unexpected": true } }),
            serde_json::json!({ "counterFillActive": { "color": "active" }, "hidden": false }),
            serde_json::json!({ "property": "counterAnimationPreset", "value": null }),
            serde_json::json!({ "property": "counterAnimationPreset", "value": {} }),
            serde_json::json!({ "property": "counterAnimationPreset", "value": { "presetId": "preset", "enabled": false } }),
            serde_json::json!({ "property": "counterAnimationPreset", "value": { "presetId": "preset", "applyPresetId": false } }),
            serde_json::json!({ "property": "counterAnimationPreset", "value": { "presetId": "preset", "scale": "1.2" } }),
            serde_json::json!({ "counterAnimationPreset": { "presetId": "preset" }, "hidden": true }),
            serde_json::json!({ "property": "noteGlowSize", "value": null }),
            serde_json::json!({ "property": "noteGlowSize", "value": "20" }),
            serde_json::json!({ "property": "noteGlowSyncPaint", "value": null }),
            serde_json::json!({ "noteGlowSize": 20, "noteGlowEnabled": true }),
            serde_json::json!({ "noteGlowSize": 20, "unexpected": true }),
            serde_json::json!({ "property": "notePaint", "value": {} }),
            serde_json::json!({ "property": "notePaint", "value": { "color": { "top": "a", "bottom": "b" } } }),
            serde_json::json!({ "property": "notePaint", "value": { "color": { "type": "gradient", "top": "a", "bottom": "b", "unexpected": true } } }),
            serde_json::json!({ "property": "notePaint", "value": { "opacity": 50, "opacityBottom": 60 } }),
            serde_json::json!({ "property": "noteGlowPaint", "value": { "color": "x", "opacity": 70 } }),
            serde_json::json!({ "property": "noteBorderPaint", "value": { "color": "#FFFFFF" } }),
            serde_json::json!({ "property": "noteBorderPaint", "value": { "color": "#FFFFFF", "opacity": "100" } }),
            serde_json::json!({ "notePaint": { "color": "x" }, "unexpected": true }),
            serde_json::json!({ "property": "noteOffsetX", "value": "0" }),
            serde_json::json!({ "noteOffsetX": null, "noteOffsetY": null }),
            serde_json::json!({ "noteOffsetY": null, "unexpected": true }),
            serde_json::json!({ "property": "noteWidth", "value": "20" }),
            serde_json::json!({ "noteWidth": null, "hidden": true }),
            serde_json::json!({ "property": "noteBorderWidth", "value": null }),
            serde_json::json!({ "property": "noteBorderWidth", "value": "1" }),
            serde_json::json!({ "property": "noteBorderRadius", "value": null }),
            serde_json::json!({ "noteBorderRadius": 4, "unexpected": true }),
        ] {
            let mut invalid_image = layer_name_wire.clone();
            invalid_image["editorOps"][0]["patch"] = patch;
            let error = decode_gesture_commit_request(invalid_image).unwrap_err();
            assert_eq!(
                validation_code(error).as_deref(),
                Some("INVALID_REQUEST_PAYLOAD")
            );
        }

        let mut invalid_stat_type = layer_name_wire.clone();
        invalid_stat_type["editorOps"][0]["patch"] =
            serde_json::json!({ "property": "statType", "value": "invalid" });
        let error = decode_gesture_commit_request(invalid_stat_type).unwrap_err();
        assert_eq!(
            validation_code(error).as_deref(),
            Some("INVALID_REQUEST_PAYLOAD")
        );

        let mut request = gesture_request(&["plugin-a".to_string()]);
        request.editor_ops_version = Some(EDITOR_OPS_VERSION);
        request.editor_ops = Some(vec![EditorOpV1::PatchElement {
            element_type: EditorElementTypeV1::Stat,
            id: uuid::Uuid::new_v4().to_string(),
            patch: EditorElementPropertyPatchV1::FontItalic(false),
        }]);
        let mut invalid_font = serde_json::to_value(request).unwrap();
        invalid_font["editorOps"][0]["patch"] =
            serde_json::json!({ "fontItalic": false, "fontWeight": 400 });
        let error = decode_gesture_commit_request(invalid_font).unwrap_err();
        assert_eq!(
            validation_code(error).as_deref(),
            Some("INVALID_REQUEST_PAYLOAD")
        );

        let mut invalid_graph_type = graph_type_wire;
        invalid_graph_type["editorOps"][0]["patch"]["graphType"] = serde_json::json!("area");
        let error = decode_gesture_commit_request(invalid_graph_type).unwrap_err();
        assert_eq!(
            validation_code(error).as_deref(),
            Some("INVALID_REQUEST_PAYLOAD")
        );

        let mut multiple_properties = layer_name_wire;
        multiple_properties["editorOps"][0]["patch"]["hidden"] = serde_json::json!(true);
        let error = decode_gesture_commit_request(multiple_properties).unwrap_err();
        assert_eq!(
            validation_code(error).as_deref(),
            Some("INVALID_REQUEST_PAYLOAD")
        );

        let mut slot = gesture_request(&["plugin-a".to_string()]);
        slot.editor_ops_version = Some(EDITOR_OPS_VERSION);
        slot.editor_ops = Some(vec![EditorOpV1::SetKeySlot {
            id: uuid::Uuid::new_v4().to_string(),
            slot: EditorFrozenKeySlotV1::Multi(crate::models::EditorFrozenMultiKeySlotV1 {
                keys: vec!["A".to_string(), "B".to_string()],
                match_mode: crate::models::SlotMatch::All,
            }),
        }]);
        let mut slot_wire = serde_json::to_value(slot).unwrap();
        slot_wire["editorOps"][0]["slot"]["unexpected"] = serde_json::json!(true);
        let error = decode_gesture_commit_request(slot_wire).unwrap_err();
        assert_eq!(
            validation_code(error).as_deref(),
            Some("INVALID_REQUEST_PAYLOAD")
        );
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
