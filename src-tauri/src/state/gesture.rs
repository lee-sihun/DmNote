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
        EditorBoundsV1, EditorElementPropertyPatchV1, EditorElementTypeV1, EditorFrozenKeySlotV1,
        EditorGroupUpdateV1, EditorOpV1, EditorPatchV1, EditorZUpdateV1,
        GesturePluginInstancesChange, EDITOR_OPS_VERSION,
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
            patch: EditorElementPropertyPatchV1::Hidden(
                crate::models::EditorHiddenPropertyPatchV1 { hidden: true },
            ),
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
            patch: EditorElementPropertyPatchV1::LayerName(
                crate::models::EditorLayerNamePropertyPatchV1 { layer_name: None },
            ),
        }]);
        let layer_name_wire = serde_json::to_value(layer_name).unwrap();
        assert_eq!(
            layer_name_wire["editorOps"][0]["patch"],
            serde_json::json!({ "layerName": null })
        );
        decode_gesture_commit_request(layer_name_wire.clone()).unwrap();

        let mut graph_type = gesture_request(&["plugin-a".to_string()]);
        graph_type.editor_ops_version = Some(EDITOR_OPS_VERSION);
        graph_type.editor_ops = Some(vec![EditorOpV1::PatchElement {
            element_type: EditorElementTypeV1::Graph,
            id: uuid::Uuid::new_v4().to_string(),
            patch: EditorElementPropertyPatchV1::GraphType(
                crate::models::EditorGraphTypePropertyPatchV1 {
                    graph_type: crate::models::GraphType::Bar,
                },
            ),
        }]);
        let graph_type_wire = serde_json::to_value(graph_type).unwrap();
        assert_eq!(
            graph_type_wire["editorOps"][0]["patch"],
            serde_json::json!({ "graphType": "bar" })
        );
        decode_gesture_commit_request(graph_type_wire.clone()).unwrap();

        let mut graph_color = gesture_request(&["plugin-a".to_string()]);
        graph_color.editor_ops_version = Some(EDITOR_OPS_VERSION);
        graph_color.editor_ops = Some(vec![EditorOpV1::PatchElement {
            element_type: EditorElementTypeV1::Graph,
            id: uuid::Uuid::new_v4().to_string(),
            patch: EditorElementPropertyPatchV1::GraphColor(
                crate::models::EditorGraphColorPropertyPatchV1 {
                    graph_color: "not-normalized".to_string(),
                },
            ),
        }]);
        let graph_color_wire = serde_json::to_value(graph_color).unwrap();
        assert_eq!(
            graph_color_wire["editorOps"][0]["patch"],
            serde_json::json!({ "graphColor": "not-normalized" })
        );
        decode_gesture_commit_request(graph_color_wire.clone()).unwrap();

        let literal_properties = [
            (
                EditorElementTypeV1::Graph,
                EditorElementPropertyPatchV1::ShowAvgLine(
                    crate::models::EditorShowAvgLinePropertyPatchV1 {
                        show_avg_line: true,
                    },
                ),
                serde_json::json!({ "showAvgLine": true }),
            ),
            (
                EditorElementTypeV1::Graph,
                EditorElementPropertyPatchV1::GraphAnimationEnabled(
                    crate::models::EditorGraphAnimationEnabledPropertyPatchV1 {
                        graph_animation_enabled: false,
                    },
                ),
                serde_json::json!({ "graphAnimationEnabled": false }),
            ),
            (
                EditorElementTypeV1::Graph,
                EditorElementPropertyPatchV1::GraphSpeed(
                    crate::models::EditorGraphSpeedPropertyPatchV1 { graph_speed: 0 },
                ),
                serde_json::json!({ "graphSpeed": 0 }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::Reverse(
                    crate::models::EditorReversePropertyPatchV1 { reverse: true },
                ),
                serde_json::json!({ "reverse": true }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::Sensitivity(
                    crate::models::EditorSensitivityPropertyPatchV1 { sensitivity: -7.25 },
                ),
                serde_json::json!({ "sensitivity": -7.25 }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::AxisId(crate::models::EditorAxisIdPropertyPatchV1 {
                    axis_id: "  HIDA:raw  ".to_string(),
                }),
                serde_json::json!({ "axisId": "  HIDA:raw  " }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::UseInlineStyles(
                    crate::models::EditorUseInlineStylesPropertyPatchV1 {
                        use_inline_styles: false,
                    },
                ),
                serde_json::json!({ "useInlineStyles": false }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::FontWeight(
                    crate::models::EditorFontWeightPropertyPatchV1 { font_weight: 400 },
                ),
                serde_json::json!({ "fontWeight": 400 }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::FontItalic(
                    crate::models::EditorFontItalicPropertyPatchV1 { font_italic: false },
                ),
                serde_json::json!({ "fontItalic": false }),
            ),
            (
                EditorElementTypeV1::Graph,
                EditorElementPropertyPatchV1::FontUnderline(
                    crate::models::EditorFontUnderlinePropertyPatchV1 {
                        font_underline: true,
                    },
                ),
                serde_json::json!({ "fontUnderline": true }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::FontStrikethrough(
                    crate::models::EditorFontStrikethroughPropertyPatchV1 {
                        font_strikethrough: false,
                    },
                ),
                serde_json::json!({ "fontStrikethrough": false }),
            ),
            (
                EditorElementTypeV1::Graph,
                EditorElementPropertyPatchV1::FontFamily(
                    crate::models::EditorFontFamilyPropertyPatchV1 {
                        font_family: " raw-font ".to_string(),
                    },
                ),
                serde_json::json!({ "fontFamily": " raw-font " }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::DisplayText(
                    crate::models::EditorDisplayTextPropertyPatchV1 {
                        display_text: "  raw display  ".to_string(),
                    },
                ),
                serde_json::json!({ "displayText": "  raw display  " }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::InactiveImage(
                    crate::models::EditorInactiveImagePropertyPatchV1 {
                        inactive_image: String::new(),
                    },
                ),
                serde_json::json!({ "inactiveImage": "" }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::ActiveImage(
                    crate::models::EditorActiveImagePropertyPatchV1 {
                        active_image: "  active.png  ".to_string(),
                    },
                ),
                serde_json::json!({ "activeImage": "  active.png  " }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::IdleTransparent(
                    crate::models::EditorIdleTransparentPropertyPatchV1 {
                        idle_transparent: true,
                    },
                ),
                serde_json::json!({ "idleTransparent": true }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::ActiveTransparent(
                    crate::models::EditorActiveTransparentPropertyPatchV1 {
                        active_transparent: false,
                    },
                ),
                serde_json::json!({ "activeTransparent": false }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::IdleImageFit(
                    crate::models::EditorIdleImageFitPropertyPatchV1 {
                        idle_image_fit: crate::models::ImageFit::Fill,
                    },
                ),
                serde_json::json!({ "idleImageFit": "fill" }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::ActiveImageFit(
                    crate::models::EditorActiveImageFitPropertyPatchV1 {
                        active_image_fit: crate::models::ImageFit::Cover,
                    },
                ),
                serde_json::json!({ "activeImageFit": "cover" }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::SoundPath(
                    crate::models::EditorSoundPathPropertyPatchV1 {
                        sound_path: String::new(),
                    },
                ),
                serde_json::json!({ "soundPath": "" }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::SoundEnabled(
                    crate::models::EditorSoundEnabledPropertyPatchV1 {
                        sound_enabled: false,
                    },
                ),
                serde_json::json!({ "soundEnabled": false }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::SoundVolume(
                    crate::models::EditorSoundVolumePropertyPatchV1 {
                        sound_volume: 137.5,
                    },
                ),
                serde_json::json!({ "soundVolume": 137.5 }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::CounterEnabled(
                    crate::models::EditorCounterEnabledPropertyPatchV1 {
                        counter_enabled: true,
                    },
                ),
                serde_json::json!({ "counterEnabled": true }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterAnimationEnabled(
                    crate::models::EditorCounterAnimationEnabledPropertyPatchV1 {
                        counter_animation_enabled: false,
                    },
                ),
                serde_json::json!({ "counterAnimationEnabled": false }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::CounterPlacement(
                    crate::models::EditorCounterPlacementPropertyPatchV1 {
                        counter_placement: crate::models::KeyCounterPlacement::Outside,
                    },
                ),
                serde_json::json!({ "counterPlacement": "outside" }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterAlign(
                    crate::models::EditorCounterAlignPropertyPatchV1 {
                        counter_align: crate::models::KeyCounterAlign::Right,
                    },
                ),
                serde_json::json!({ "counterAlign": "right" }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::CounterAlignMode(
                    crate::models::EditorCounterAlignModePropertyPatchV1 {
                        counter_align_mode: crate::models::KeyCounterAlignMode::Between,
                    },
                ),
                serde_json::json!({ "counterAlignMode": "between" }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterGap(
                    crate::models::EditorCounterGapPropertyPatchV1 {
                        counter_gap: u32::MAX,
                    },
                ),
                serde_json::json!({ "counterGap": u32::MAX }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::CounterFontSize(
                    crate::models::EditorCounterFontSizePropertyPatchV1 {
                        counter_font_size: 72,
                    },
                ),
                serde_json::json!({ "counterFontSize": 72 }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterFontWeight(
                    crate::models::EditorCounterFontWeightPropertyPatchV1 {
                        counter_font_weight: 900,
                    },
                ),
                serde_json::json!({ "counterFontWeight": 900 }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::CounterFontItalic(
                    crate::models::EditorCounterFontItalicPropertyPatchV1 {
                        counter_font_italic: true,
                    },
                ),
                serde_json::json!({ "counterFontItalic": true }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterFontUnderline(
                    crate::models::EditorCounterFontUnderlinePropertyPatchV1 {
                        counter_font_underline: true,
                    },
                ),
                serde_json::json!({ "counterFontUnderline": true }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::CounterFontStrikethrough(
                    crate::models::EditorCounterFontStrikethroughPropertyPatchV1 {
                        counter_font_strikethrough: true,
                    },
                ),
                serde_json::json!({ "counterFontStrikethrough": true }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterFontFamily(
                    crate::models::EditorCounterFontFamilyPropertyPatchV1 {
                        counter_font_family: "  raw-counter-font  ".to_string(),
                    },
                ),
                serde_json::json!({ "counterFontFamily": "  raw-counter-font  " }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterAnimationPreset(
                    crate::models::EditorCounterAnimationPresetPropertyPatchV1 {
                        counter_animation_preset:
                            crate::models::EditorCounterAnimationPresetIntentV1 {
                                preset_id: "builtin-ease-out".to_string(),
                                apply_preset_id: None,
                                bezier: None,
                                scale: None,
                                duration_ms: None,
                            },
                    },
                ),
                serde_json::json!({
                    "counterAnimationPreset": { "presetId": "builtin-ease-out" }
                }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::StatType(
                    crate::models::EditorStatTypePropertyPatchV1 {
                        stat_type: crate::models::StatType::Total,
                    },
                ),
                serde_json::json!({ "statType": "total" }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteEffectEnabled(
                    crate::models::EditorNoteEffectEnabledPropertyPatchV1 {
                        note_effect_enabled: false,
                    },
                ),
                serde_json::json!({ "noteEffectEnabled": false }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteGlowEnabled(
                    crate::models::EditorNoteGlowEnabledPropertyPatchV1 {
                        note_glow_enabled: true,
                    },
                ),
                serde_json::json!({ "noteGlowEnabled": true }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteAutoYCorrection(
                    crate::models::EditorNoteAutoYCorrectionPropertyPatchV1 {
                        note_auto_y_correction: false,
                    },
                ),
                serde_json::json!({ "noteAutoYCorrection": false }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteAlignment(
                    crate::models::EditorNoteAlignmentPropertyPatchV1 {
                        note_alignment: crate::models::NoteAlignment::Left,
                    },
                ),
                serde_json::json!({ "noteAlignment": "left" }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteBorderSide(
                    crate::models::EditorNoteBorderSidePropertyPatchV1 {
                        note_border_side: crate::models::EditorNoteBorderSideV1::Horizontal,
                    },
                ),
                serde_json::json!({ "noteBorderSide": "horizontal" }),
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
        invalid_axis_id["editorOps"][0]["patch"] = serde_json::json!({ "axisId": false });
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
        invalid_font_family["editorOps"][0]["patch"] = serde_json::json!({ "fontFamily": null });
        let error = decode_gesture_commit_request(invalid_font_family).unwrap_err();
        assert_eq!(
            validation_code(error).as_deref(),
            Some("INVALID_REQUEST_PAYLOAD")
        );

        for patch in [
            serde_json::json!({ "displayText": null }),
            serde_json::json!({ "displayText": 1 }),
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
            serde_json::json!({ "inactiveImage": null }),
            serde_json::json!({ "inactiveImage": "path", "hidden": false }),
            serde_json::json!({ "inactiveImage": "path", "unexpected": true }),
            serde_json::json!({ "activeImage": null }),
            serde_json::json!({ "activeImage": "path", "hidden": false }),
            serde_json::json!({ "activeImage": "path", "unexpected": true }),
            serde_json::json!({ "idleTransparent": null }),
            serde_json::json!({ "idleTransparent": "true" }),
            serde_json::json!({ "idleTransparent": true, "activeTransparent": false }),
            serde_json::json!({ "activeTransparent": 1 }),
            serde_json::json!({ "activeTransparent": false, "unexpected": true }),
            serde_json::json!({ "idleImageFit": "stretch" }),
            serde_json::json!({ "idleImageFit": null }),
            serde_json::json!({ "idleImageFit": "cover", "activeImageFit": "contain" }),
            serde_json::json!({ "activeImageFit": 1 }),
            serde_json::json!({ "activeImageFit": "none", "unexpected": true }),
            serde_json::json!({ "soundPath": null }),
            serde_json::json!({ "soundPath": 1 }),
            serde_json::json!({ "soundPath": "path", "soundEnabled": true }),
            serde_json::json!({ "soundPath": "path", "unexpected": true }),
            serde_json::json!({ "soundEnabled": null }),
            serde_json::json!({ "soundEnabled": "true" }),
            serde_json::json!({ "soundEnabled": true, "unexpected": true }),
            serde_json::json!({ "soundVolume": null }),
            serde_json::json!({ "soundVolume": "100" }),
            serde_json::json!({ "soundVolume": 100, "soundEnabled": true }),
            serde_json::json!({ "soundVolume": 100, "unexpected": true }),
            serde_json::json!({ "counterEnabled": 1 }),
            serde_json::json!({ "counterAnimationEnabled": null }),
            serde_json::json!({ "counterAnimationEnabled": true, "hidden": false }),
            serde_json::json!({ "counterPlacement": "center" }),
            serde_json::json!({ "counterAlign": "center" }),
            serde_json::json!({ "counterAlignMode": "outside" }),
            serde_json::json!({ "counterGap": -1 }),
            serde_json::json!({ "counterGap": 1.5 }),
            serde_json::json!({ "counterGap": 4_294_967_296_u64 }),
            serde_json::json!({ "counterPlacement": "inside", "counterAlign": "top" }),
            serde_json::json!({ "counterFontSize": -1 }),
            serde_json::json!({ "counterFontWeight": "400" }),
            serde_json::json!({ "counterFontItalic": null }),
            serde_json::json!({ "counterFontUnderline": 1 }),
            serde_json::json!({ "counterFontStrikethrough": "false" }),
            serde_json::json!({ "counterFontSize": 16, "counterFontWeight": 400 }),
            serde_json::json!({ "counterFontSize": 16, "unexpected": true }),
            serde_json::json!({ "counterFontFamily": null }),
            serde_json::json!({ "counterFontFamily": 1 }),
            serde_json::json!({ "counterFontFamily": "font", "counterFontItalic": true }),
            serde_json::json!({ "counterFontFamily": "font", "unexpected": true }),
            serde_json::json!({ "counterAnimationPreset": null }),
            serde_json::json!({ "counterAnimationPreset": {} }),
            serde_json::json!({ "counterAnimationPreset": { "presetId": "preset", "enabled": false } }),
            serde_json::json!({ "counterAnimationPreset": { "presetId": "preset", "applyPresetId": false } }),
            serde_json::json!({ "counterAnimationPreset": { "presetId": "preset", "scale": "1.2" } }),
            serde_json::json!({ "counterAnimationPreset": { "presetId": "preset" }, "hidden": true }),
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
        invalid_stat_type["editorOps"][0]["patch"] = serde_json::json!({ "statType": "invalid" });
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
            patch: EditorElementPropertyPatchV1::FontItalic(
                crate::models::EditorFontItalicPropertyPatchV1 { font_italic: false },
            ),
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
