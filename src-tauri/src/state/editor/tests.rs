use std::collections::HashMap;

use crate::models::{
    CustomTab, EditorBoundsV1, EditorCommitRequest, EditorDocumentV1, EditorElementGroupTargetV1,
    EditorElementPropertyPatchV1, EditorElementTypeV1, EditorFrozenKeySlotV1, EditorGroupUpdateV1,
    EditorOpResultStatusV1, EditorOpResultV1, EditorOpV1, EditorPatchV1, EditorTargetGroupV1,
    EditorZUpdateV1, ElementShadowSpec, GraphPosition, GraphStatType, GraphType, KeyPosition,
    KnobPosition, LayerGroupDef, StatPosition, StatType,
};

use super::*;

fn request(keys: KeyMappings) -> EditorCommitRequest {
    EditorCommitRequest {
        base_revision: 0,
        mutation_id: Uuid::new_v4().to_string(),
        multi_key: false,
        gesture_id: None,
        gesture_ids: Vec::new(),
        changes: Some(EditorPatchV1 {
            keys: Some(keys),
            ..EditorPatchV1::default()
        }),
        ops_version: None,
        ops: None,
    }
}

fn ops_request(ops: Vec<EditorOpV1>) -> EditorCommitRequest {
    EditorCommitRequest {
        base_revision: 0,
        mutation_id: Uuid::new_v4().to_string(),
        multi_key: false,
        gesture_id: None,
        gesture_ids: Vec::new(),
        changes: None,
        ops_version: Some(EDITOR_OPS_VERSION),
        ops: Some(ops),
    }
}

fn set_bounds_op(id: impl Into<String>, element_type: EditorElementTypeV1) -> EditorOpV1 {
    EditorOpV1::SetBounds {
        element_type,
        id: id.into(),
        bounds: EditorBoundsV1 {
            dx: 10.0,
            dy: 20.0,
            width: 100.0,
            height: 50.0,
        },
    }
}

fn delete_element_op(id: impl Into<String>, element_type: EditorElementTypeV1) -> EditorOpV1 {
    EditorOpV1::DeleteElement {
        element_type,
        id: id.into(),
    }
}

fn patch_hidden_op(id: impl Into<String>, element_type: EditorElementTypeV1) -> EditorOpV1 {
    EditorOpV1::PatchElement {
        element_type,
        id: id.into(),
        patch: EditorElementPropertyPatchV1::Hidden(true),
    }
}

fn frozen_insert_op(id: impl Into<String>) -> EditorOpV1 {
    EditorOpV1::InsertFrozenElements {
        mode: "4key".to_string(),
        elements: vec![crate::models::EditorFrozenElementV1::Key {
            slot: crate::models::EditorFrozenKeySlotV1::Single("FROZEN".to_string()),
            position: KeyPosition {
                id: id.into(),
                ..KeyPosition::default()
            },
        }],
        groups: Vec::new(),
        z_updates: Vec::new(),
    }
}

fn reorder_op(id: impl Into<String>, complete_mode_order: bool) -> EditorOpV1 {
    EditorOpV1::ReorderElements {
        mode: "4key".to_string(),
        complete_mode_order,
        z_updates: vec![EditorZUpdateV1 {
            element_type: EditorElementTypeV1::Key,
            id: id.into(),
            z_index: 7,
        }],
        group_updates: Vec::new(),
    }
}

fn validation_code(error: &EditorCommitError) -> Option<&str> {
    error
        .details
        .as_ref()
        .and_then(|details| details.validation_code.as_deref())
}

fn default_editor_store() -> AppStoreData {
    let mut store = AppStoreData {
        keys: crate::defaults::default_keys().clone(),
        key_positions: crate::defaults::default_positions().clone(),
        ..AppStoreData::default()
    };
    crate::state::native_element_id::backfill_store_element_ids(&mut store);
    store
}

fn store_with_custom_modes(count: usize) -> AppStoreData {
    let mut store = AppStoreData::default();
    for index in 0..count {
        store.custom_tabs.push(CustomTab {
            id: format!("custom-{index}"),
            name: format!("Custom {index}"),
        });
    }
    store
}

fn store_with_each_position_collection() -> AppStoreData {
    let mut store = default_editor_store();
    store.stat_positions.insert(
        "4key".to_string(),
        vec![StatPosition {
            stat_type: StatType::Kps,
            position: KeyPosition::default(),
        }],
    );
    store.graph_positions.insert(
        "4key".to_string(),
        vec![GraphPosition {
            stat_type: GraphStatType::Kps,
            graph_type: GraphType::Line,
            graph_speed: 100,
            graph_color: "#123456".to_string(),
            show_avg_line: true,
            position: KeyPosition::default(),
        }],
    );
    store.knob_positions.insert(
        "4key".to_string(),
        vec![KnobPosition {
            axis_id: String::new(),
            sensitivity: 1.0,
            reverse: false,
            position: KeyPosition::default(),
        }],
    );
    crate::state::native_element_id::backfill_store_element_ids(&mut store);
    store
}

fn position_mut<'a>(document: &'a mut EditorDocumentV1, collection: &str) -> &'a mut KeyPosition {
    match collection {
        "keyPositions" => &mut document.key_positions.get_mut("4key").unwrap()[0],
        "statPositions" => &mut document.stat_positions.get_mut("4key").unwrap()[0].position,
        "graphPositions" => &mut document.graph_positions.get_mut("4key").unwrap()[0].position,
        "knobPositions" => &mut document.knob_positions.get_mut("4key").unwrap()[0].position,
        _ => unreachable!(),
    }
}

fn valid_shadow() -> ElementShadowSpec {
    ElementShadowSpec {
        enabled: true,
        color: "#123456".to_string(),
        offset_x: 0.0,
        offset_y: 0.0,
        blur: 12.0,
    }
}

#[test]
fn canonical_fingerprint_ignores_hash_map_insertion_order() {
    let mut left = HashMap::new();
    left.insert("4key".to_string(), vec![KeySlot::from("A")]);
    left.insert("5key".to_string(), vec![KeySlot::from("B")]);

    let mut right = HashMap::new();
    right.insert("5key".to_string(), vec![KeySlot::from("B")]);
    right.insert("4key".to_string(), vec![KeySlot::from("A")]);

    assert_eq!(
        request_fingerprint(&request(left)).unwrap(),
        request_fingerprint(&request(right)).unwrap()
    );
}

#[test]
fn canonical_fingerprint_includes_multi_key_capability() {
    let mut legacy = request(KeyMappings::new());
    let mut capable = legacy.clone();
    capable.multi_key = true;

    assert_ne!(
        request_fingerprint(&legacy).unwrap(),
        request_fingerprint(&capable).unwrap()
    );

    legacy.multi_key = true;
    assert_eq!(
        request_fingerprint(&legacy).unwrap(),
        request_fingerprint(&capable).unwrap()
    );
}

#[test]
fn commit_envelope_defaults_multi_key_to_false() {
    let request = request(KeyMappings::new());
    let mut wire = serde_json::to_value(request).unwrap();
    wire.as_object_mut().unwrap().remove("multiKey");

    let decoded: EditorCommitRequest = serde_json::from_value(wire).unwrap();

    assert!(!decoded.multi_key);
    let mut capable = decoded;
    capable.multi_key = true;
    let encoded = serde_json::to_value(capable).unwrap();
    assert_eq!(encoded["multiKey"], true);
    assert!(encoded.get("opsVersion").is_none());
    assert!(encoded.get("ops").is_none());
}

#[test]
fn editor_commit_wire_requires_exactly_one_mutation_shape() {
    let base = serde_json::json!({
        "baseRevision": 0,
        "mutationId": Uuid::new_v4().to_string(),
    });
    let changes = serde_json::json!({ "schemaVersion": EDITOR_SCHEMA_VERSION });
    let op = serde_json::json!({
        "kind": "setBounds",
        "elementType": "key",
        "id": Uuid::new_v4().to_string(),
        "bounds": { "dx": 0.0, "dy": 0.0, "width": 1.0, "height": 1.0 },
    });

    let mut patch_wire = base.clone();
    patch_wire["changes"] = changes.clone();
    let patch = decode_editor_commit_request(patch_wire).unwrap();
    assert!(patch.changes.is_some());
    assert!(patch.ops.is_none());

    let mut ops_wire = base.clone();
    ops_wire["opsVersion"] = serde_json::json!(EDITOR_OPS_VERSION);
    ops_wire["ops"] = serde_json::json!([op.clone()]);
    let ops = decode_editor_commit_request(ops_wire).unwrap();
    assert!(ops.changes.is_none());
    assert_eq!(ops.ops.unwrap().len(), 1);

    let encoded = serde_json::to_value(ops_request(vec![set_bounds_op(
        Uuid::new_v4().to_string(),
        EditorElementTypeV1::Key,
    )]))
    .unwrap();
    assert_eq!(encoded["ops"][0]["kind"], "setBounds");
    assert_eq!(encoded["ops"][0]["elementType"], "key");
    assert!(encoded.get("changes").is_none());

    let delete_id = Uuid::new_v4().to_string();
    let delete_wire = serde_json::json!({
        "baseRevision": 0,
        "mutationId": Uuid::new_v4().to_string(),
        "opsVersion": EDITOR_OPS_VERSION,
        "ops": [{
            "kind": "deleteElement",
            "elementType": "graph",
            "id": delete_id,
        }],
    });
    let delete = decode_editor_commit_request(delete_wire).unwrap();
    assert_eq!(
        delete.ops,
        Some(vec![delete_element_op(
            delete_id,
            EditorElementTypeV1::Graph,
        )])
    );
    let encoded_delete = serde_json::to_value(delete).unwrap();
    assert_eq!(encoded_delete["ops"][0]["kind"], "deleteElement");
    assert_eq!(encoded_delete["ops"][0]["elementType"], "graph");
    assert!(encoded_delete["ops"][0].get("bounds").is_none());

    let mut both = base.clone();
    both["changes"] = changes;
    both["opsVersion"] = serde_json::json!(EDITOR_OPS_VERSION);
    both["ops"] = serde_json::json!([op.clone()]);
    let error = decode_editor_commit_request(both).unwrap_err();
    assert_eq!(validation_code(&error), Some("INVALID_EDITOR_MUTATION"));

    for wire in [
        base.clone(),
        serde_json::json!({
            "baseRevision": 0,
            "mutationId": Uuid::new_v4().to_string(),
            "opsVersion": EDITOR_OPS_VERSION,
        }),
        serde_json::json!({
            "baseRevision": 0,
            "mutationId": Uuid::new_v4().to_string(),
            "opsVersion": EDITOR_OPS_VERSION,
            "ops": null,
        }),
        serde_json::json!({
            "baseRevision": 0,
            "mutationId": Uuid::new_v4().to_string(),
            "changes": null,
            "opsVersion": EDITOR_OPS_VERSION,
            "ops": [op],
        }),
    ] {
        let error = decode_editor_commit_request(wire).unwrap_err();
        assert_eq!(validation_code(&error), Some("INVALID_EDITOR_MUTATION"));
    }
}

#[test]
fn editor_commit_wire_rejects_unknown_keys_at_each_new_boundary() {
    let valid_id = Uuid::new_v4().to_string();
    let valid = serde_json::json!({
        "baseRevision": 0,
        "mutationId": Uuid::new_v4().to_string(),
        "opsVersion": EDITOR_OPS_VERSION,
        "ops": [{
            "kind": "setBounds",
            "elementType": "key",
            "id": valid_id,
            "bounds": { "dx": 0.0, "dy": 0.0, "width": 1.0, "height": 1.0 },
        }],
    });

    let mut unknown_top_level = valid.clone();
    unknown_top_level["mode"] = serde_json::json!("4key");
    let mut unknown_op_key = valid.clone();
    unknown_op_key["ops"][0]["mode"] = serde_json::json!("4key");
    let mut unknown_bounds_key = valid.clone();
    unknown_bounds_key["ops"][0]["bounds"]["x"] = serde_json::json!(0);

    for wire in [unknown_top_level, unknown_op_key, unknown_bounds_key] {
        let error = decode_editor_commit_request(wire).unwrap_err();
        assert_eq!(validation_code(&error), Some("INVALID_REQUEST_PAYLOAD"));
    }

    for (field, value) in [
        ("kind", serde_json::json!("move")),
        ("elementType", serde_json::json!("Key")),
    ] {
        let mut wire = valid.clone();
        wire["ops"][0][field] = value;
        let error = decode_editor_commit_request(wire).unwrap_err();
        assert_eq!(validation_code(&error), Some("INVALID_REQUEST_PAYLOAD"));
    }

    let delete_with_bounds = serde_json::json!({
        "baseRevision": 0,
        "mutationId": Uuid::new_v4().to_string(),
        "opsVersion": EDITOR_OPS_VERSION,
        "ops": [{
            "kind": "deleteElement",
            "elementType": "key",
            "id": Uuid::new_v4().to_string(),
            "bounds": { "dx": 0.0, "dy": 0.0, "width": 1.0, "height": 1.0 },
        }],
    });
    let error = decode_editor_commit_request(delete_with_bounds).unwrap_err();
    assert_eq!(validation_code(&error), Some("INVALID_REQUEST_PAYLOAD"));
}

#[test]
fn frozen_insert_wire_accepts_explicit_null_for_skipped_optional_fields() {
    let frozen = |counter: serde_json::Value| {
        serde_json::json!({
            "baseRevision": 0,
            "mutationId": Uuid::new_v4().to_string(),
            "opsVersion": EDITOR_OPS_VERSION,
            "ops": [{
                "kind": "insertFrozenElements",
                "mode": "4key",
                "elements": [{
                    "elementType": "key",
                    "slot": "A",
                    "position": {
                        "id": Uuid::new_v4().to_string(),
                        "dx": 0.0, "dy": 0.0, "width": 60.0, "height": 60.0, "count": 0,
                        "counter": counter,
                    },
                }],
                "groups": [],
                "zUpdates": [],
            }],
        })
    };

    // 프론트 정규화는 미지정 그라데이션을 null로 보낸다 - None은 재직렬화에서
    // 생략되지만 같은 뜻이므로 통과해야 한다
    decode_editor_commit_request(frozen(serde_json::json!({
        "enabled": true,
        "fillIdleGradient": null,
        "fillActiveGradient": null,
    })))
    .unwrap();

    // 빈 배열로 명시한 생략 필드(gestureIds)도 같은 규칙
    let mut with_empty_gesture_ids = frozen(serde_json::json!({ "enabled": true }));
    with_empty_gesture_ids["gestureIds"] = serde_json::json!([]);
    decode_editor_commit_request(with_empty_gesture_ids).unwrap();

    // 값이 실린 미지의 키는 여전히 거절
    let error = decode_editor_commit_request(frozen(serde_json::json!({
        "enabled": true,
        "fillActiveGradient": null,
        "fillHoverGradient": { "angle": 0, "stops": [] },
    })))
    .unwrap_err();
    assert_eq!(validation_code(&error), Some("INVALID_REQUEST_PAYLOAD"));
    assert!(error.message.contains("fillHoverGradient"));
}

#[test]
fn property_and_key_slot_wires_are_exact_and_canonical() {
    let property = serde_json::to_value(ops_request(vec![patch_hidden_op(
        Uuid::new_v4().to_string(),
        EditorElementTypeV1::Graph,
    )]))
    .unwrap();
    assert_eq!(property["ops"][0]["kind"], "patchElement");
    assert_eq!(
        property["ops"][0]["patch"],
        serde_json::json!({ "property": "hidden", "value": true })
    );
    decode_editor_commit_request(property.clone()).unwrap();

    let layer_name = serde_json::to_value(ops_request(vec![EditorOpV1::PatchElement {
        element_type: EditorElementTypeV1::Knob,
        id: Uuid::new_v4().to_string(),
        patch: EditorElementPropertyPatchV1::LayerName(None),
    }]))
    .unwrap();
    assert_eq!(
        layer_name["ops"][0]["patch"],
        serde_json::json!({ "property": "layerName", "value": null })
    );
    decode_editor_commit_request(layer_name.clone()).unwrap();

    let graph_type = serde_json::to_value(ops_request(vec![EditorOpV1::PatchElement {
        element_type: EditorElementTypeV1::Graph,
        id: Uuid::new_v4().to_string(),
        patch: EditorElementPropertyPatchV1::GraphType(GraphType::Bar),
    }]))
    .unwrap();
    assert_eq!(
        graph_type["ops"][0]["patch"],
        serde_json::json!({ "property": "graphType", "value": "bar" })
    );
    decode_editor_commit_request(graph_type.clone()).unwrap();

    let graph_color = serde_json::to_value(ops_request(vec![EditorOpV1::PatchElement {
        element_type: EditorElementTypeV1::Graph,
        id: Uuid::new_v4().to_string(),
        patch: EditorElementPropertyPatchV1::GraphColor("not-normalized".to_string()),
    }]))
    .unwrap();
    assert_eq!(
        graph_color["ops"][0]["patch"],
        serde_json::json!({ "property": "graphColor", "value": "not-normalized" })
    );
    decode_editor_commit_request(graph_color.clone()).unwrap();

    let paint = serde_json::to_value(ops_request(vec![EditorOpV1::PatchElement {
        element_type: EditorElementTypeV1::Key,
        id: Uuid::new_v4().to_string(),
        patch: EditorElementPropertyPatchV1::BackgroundPaint(
            crate::models::EditorPaintDescriptorV1 {
                color: "first".to_string(),
                gradient: Some(crate::models::EditorPaintGradientV1 {
                    angle: 45.0,
                    stops: vec![
                        crate::models::EditorPaintGradientStopV1 {
                            color: "first".to_string(),
                            pos: 0.0,
                        },
                        crate::models::EditorPaintGradientStopV1 {
                            color: "last".to_string(),
                            pos: 1.0,
                        },
                    ],
                }),
            },
        ),
    }]))
    .unwrap();
    assert_eq!(
        paint["ops"][0]["patch"],
        serde_json::json!({ "property": "backgroundPaint", "value": { "color": "first", "gradient": { "angle": 45.0, "stops": [ { "color": "first", "pos": 0.0 }, { "color": "last", "pos": 1.0 } ] } } })
    );
    decode_editor_commit_request(paint.clone()).unwrap();

    let literal_properties = [
        (
            EditorElementTypeV1::Graph,
            EditorElementPropertyPatchV1::ShowAvgLine(false),
            serde_json::json!({ "property": "showAvgLine", "value": false }),
        ),
        (
            EditorElementTypeV1::Graph,
            EditorElementPropertyPatchV1::GraphAnimationEnabled(true),
            serde_json::json!({ "property": "graphAnimationEnabled", "value": true }),
        ),
        (
            EditorElementTypeV1::Graph,
            EditorElementPropertyPatchV1::GraphSpeed(u32::MAX),
            serde_json::json!({ "property": "graphSpeed", "value": u32::MAX }),
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
            EditorElementTypeV1::Stat,
            EditorElementPropertyPatchV1::UseInlineStyles(false),
            serde_json::json!({ "property": "useInlineStyles", "value": false }),
        ),
        (
            EditorElementTypeV1::Key,
            EditorElementPropertyPatchV1::FontWeight(u32::MAX),
            serde_json::json!({ "property": "fontWeight", "value": u32::MAX }),
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
                color: "  raw font color  ".to_string(),
                gradient: None,
            }),
            serde_json::json!({ "property": "fontPaint", "value": { "color": "  raw font color  ", "gradient": null } }),
        ),
        (
            EditorElementTypeV1::Key,
            EditorElementPropertyPatchV1::ActiveFontPaint(crate::models::EditorPaintDescriptorV1 {
                color: String::new(),
                gradient: None,
            }),
            serde_json::json!({ "property": "activeFontPaint", "value": { "color": "", "gradient": null } }),
        ),
        (
            EditorElementTypeV1::Stat,
            EditorElementPropertyPatchV1::Shadow(crate::models::EditorShadowLeafPatchV1::OffsetX(
                -12.5,
            )),
            serde_json::json!({ "property": "shadow", "value": { "leaf": "offsetX", "value": -12.5 } }),
        ),
        (
            EditorElementTypeV1::Knob,
            EditorElementPropertyPatchV1::ActiveShadow(
                crate::models::EditorShadowLeafPatchV1::Color(" raw-shadow ".to_string()),
            ),
            serde_json::json!({ "property": "activeShadow", "value": { "leaf": "color", "value": " raw-shadow " } }),
        ),
        (
            EditorElementTypeV1::Key,
            EditorElementPropertyPatchV1::ShadowEnabled(false),
            serde_json::json!({ "property": "shadowEnabled", "value": false }),
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
            EditorElementTypeV1::Knob,
            EditorElementPropertyPatchV1::InactiveImage("  raw/path.png  ".to_string()),
            serde_json::json!({ "property": "inactiveImage", "value": "  raw/path.png  " }),
        ),
        (
            EditorElementTypeV1::Key,
            EditorElementPropertyPatchV1::ActiveImage("  raw/active.png  ".to_string()),
            serde_json::json!({ "property": "activeImage", "value": "  raw/active.png  " }),
        ),
        (
            EditorElementTypeV1::Graph,
            EditorElementPropertyPatchV1::IdleTransparent(true),
            serde_json::json!({ "property": "idleTransparent", "value": true }),
        ),
        (
            EditorElementTypeV1::Knob,
            EditorElementPropertyPatchV1::ActiveTransparent(false),
            serde_json::json!({ "property": "activeTransparent", "value": false }),
        ),
        (
            EditorElementTypeV1::Graph,
            EditorElementPropertyPatchV1::IdleImageFit(crate::models::ImageFit::Contain),
            serde_json::json!({ "property": "idleImageFit", "value": "contain" }),
        ),
        (
            EditorElementTypeV1::Key,
            EditorElementPropertyPatchV1::ActiveImageFit(crate::models::ImageFit::None),
            serde_json::json!({ "property": "activeImageFit", "value": "none" }),
        ),
        (
            EditorElementTypeV1::Key,
            EditorElementPropertyPatchV1::SoundPath("  raw/sound.wav  ".to_string()),
            serde_json::json!({ "property": "soundPath", "value": "  raw/sound.wav  " }),
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
            EditorElementPropertyPatchV1::CounterEnabled(false),
            serde_json::json!({ "property": "counterEnabled", "value": false }),
        ),
        (
            EditorElementTypeV1::Stat,
            EditorElementPropertyPatchV1::CounterAnimationEnabled(true),
            serde_json::json!({ "property": "counterAnimationEnabled", "value": true }),
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
            EditorElementPropertyPatchV1::CounterAlign(crate::models::KeyCounterAlign::Left),
            serde_json::json!({ "property": "counterAlign", "value": "left" }),
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
                        color: "  raw solid  ".to_string(),
                    },
                ),
            ),
            serde_json::json!({ "property": "counterFillIdle", "value": { "color": "  raw solid  " } }),
        ),
        (
            EditorElementTypeV1::Key,
            EditorElementPropertyPatchV1::CounterFillActive(
                crate::models::EditorCounterFillIntentV1::Gradient(
                    crate::models::EditorCounterFillGradientIntentV1 {
                        color: "rgba(1,2,3,0.5)".to_string(),
                        gradient: crate::models::EditorPaintGradientV1 {
                            angle: 90.0,
                            stops: vec![
                                crate::models::EditorPaintGradientStopV1 {
                                    color: "rgba(1, 2, 3, 0.5)".to_string(),
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
            serde_json::json!({ "property": "counterFillActive", "value": { "color": "rgba(1,2,3,0.5)", "gradient": { "angle": 90.0, "stops": [ { "color": "rgba(1, 2, 3, 0.5)", "pos": 0.0 }, { "color": "transparent", "pos": 1.0 } ] } } }),
        ),
        (
            EditorElementTypeV1::Stat,
            EditorElementPropertyPatchV1::CounterAnimationPreset(
                crate::models::EditorCounterAnimationPresetIntentV1 {
                    preset_id: "user-motion".to_string(),
                    apply_preset_id: Some(true),
                    bezier: Some([0.1, 0.2, 0.8, 0.9]),
                    scale: Some(1.25),
                    duration_ms: Some(420),
                },
            ),
            serde_json::json!({ "property": "counterAnimationPreset", "value": { "presetId": "user-motion", "applyPresetId": true, "bezier": [0.1, 0.2, 0.8, 0.9], "scale": 1.25, "durationMs": 420 } }),
        ),
        (
            EditorElementTypeV1::Stat,
            EditorElementPropertyPatchV1::StatType(StatType::Total),
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
            EditorElementPropertyPatchV1::NoteGlowSize(20.5),
            serde_json::json!({ "property": "noteGlowSize", "value": 20.5 }),
        ),
        (
            EditorElementTypeV1::Key,
            EditorElementPropertyPatchV1::NotePaint(crate::models::EditorNotePaintIntentV1::Color(
                crate::models::EditorNotePaintColorIntentV1 {
                    color: crate::models::EditorNoteColorV1::Gradient(
                        crate::models::EditorNoteGradientColorV1 {
                            kind: crate::models::EditorNoteGradientColorKindV1::Gradient,
                            top: "top".to_string(),
                            bottom: "bottom".to_string(),
                        },
                    ),
                },
            )),
            serde_json::json!({ "property": "notePaint", "value": { "color": { "type": "gradient", "top": "top", "bottom": "bottom" } } }),
        ),
        (
            EditorElementTypeV1::Key,
            EditorElementPropertyPatchV1::NoteGlowPaint(
                crate::models::EditorNotePaintIntentV1::GradientOpacity(
                    crate::models::EditorNotePaintGradientOpacityIntentV1 {
                        opacity: 70,
                        opacity_top: 10,
                        opacity_bottom: 90,
                    },
                ),
            ),
            serde_json::json!({ "property": "noteGlowPaint", "value": { "opacity": 70, "opacityTop": 10, "opacityBottom": 90 } }),
        ),
        (
            EditorElementTypeV1::Key,
            EditorElementPropertyPatchV1::NoteBorderPaint(crate::models::EditorNoteBorderPaintV1 {
                color: "#A1b2C3".to_string(),
                opacity: 55,
                gradient: None,
            }),
            serde_json::json!({ "property": "noteBorderPaint", "value": { "color": "#A1b2C3", "opacity": 55 } }),
        ),
        (
            EditorElementTypeV1::Key,
            EditorElementPropertyPatchV1::NoteOffsetX(None),
            serde_json::json!({ "property": "noteOffsetX", "value": null }),
        ),
        (
            EditorElementTypeV1::Key,
            EditorElementPropertyPatchV1::NoteOffsetY(Some(-12.5)),
            serde_json::json!({ "property": "noteOffsetY", "value": -12.5 }),
        ),
        (
            EditorElementTypeV1::Key,
            EditorElementPropertyPatchV1::NoteWidth(None),
            serde_json::json!({ "property": "noteWidth", "value": null }),
        ),
        (
            EditorElementTypeV1::Key,
            EditorElementPropertyPatchV1::NoteBorderWidth(0.0),
            serde_json::json!({ "property": "noteBorderWidth", "value": 0.0 }),
        ),
        (
            EditorElementTypeV1::Key,
            EditorElementPropertyPatchV1::NoteBorderRadius(4.5),
            serde_json::json!({ "property": "noteBorderRadius", "value": 4.5 }),
        ),
        (
            EditorElementTypeV1::Key,
            EditorElementPropertyPatchV1::NoteAutoYCorrection(false),
            serde_json::json!({ "property": "noteAutoYCorrection", "value": false }),
        ),
        (
            EditorElementTypeV1::Key,
            EditorElementPropertyPatchV1::NoteAlignment(crate::models::NoteAlignment::Right),
            serde_json::json!({ "property": "noteAlignment", "value": "right" }),
        ),
        (
            EditorElementTypeV1::Key,
            EditorElementPropertyPatchV1::NoteBorderSide(
                crate::models::EditorNoteBorderSideV1::All,
            ),
            serde_json::json!({ "property": "noteBorderSide", "value": "all" }),
        ),
    ];
    for (element_type, patch, expected) in literal_properties {
        let wire = serde_json::to_value(ops_request(vec![EditorOpV1::PatchElement {
            element_type,
            id: Uuid::new_v4().to_string(),
            patch,
        }]))
        .unwrap();
        assert_eq!(wire["ops"][0]["patch"], expected);
        decode_editor_commit_request(wire).unwrap();
    }

    let mut unknown_property = property.clone();
    unknown_property["ops"][0]["patch"]["zIndex"] = serde_json::json!(3);
    let mut unknown_op = property;
    unknown_op["ops"][0]["mode"] = serde_json::json!("4key");
    let mut missing_property = layer_name.clone();
    missing_property["ops"][0]["patch"] = serde_json::json!({});
    let mut multiple_properties = layer_name;
    multiple_properties["ops"][0]["patch"]["hidden"] = serde_json::json!(true);
    let mut invalid_graph_type = graph_type;
    invalid_graph_type["ops"][0]["patch"]["graphType"] = serde_json::json!("area");
    let mut invalid_graph_color = graph_color.clone();
    invalid_graph_color["ops"][0]["patch"]["graphColor"] = serde_json::json!(42);
    let invalid_literal_properties = [
            serde_json::json!({ "property": "showAvgLine", "value": 1 }),
            serde_json::json!({ "property": "graphAnimationEnabled", "value": null }),
            serde_json::json!({ "property": "graphSpeed", "value": -1 }),
            serde_json::json!({ "property": "graphSpeed", "value": 1.5 }),
            serde_json::json!({ "property": "reverse", "value": "true" }),
            serde_json::json!({ "property": "sensitivity", "value": "1" }),
            serde_json::json!({ "property": "axisId", "value": false }),
            serde_json::json!({ "axisId": "axis", "hidden": true }),
            serde_json::json!({ "axisId": "axis", "unexpected": true }),
            serde_json::json!({ "property": "useInlineStyles", "value": null }),
            serde_json::json!({ "property": "fontWeight", "value": -1 }),
            serde_json::json!({ "property": "fontWeight", "value": 1.5 }),
            serde_json::json!({ "property": "fontItalic", "value": null }),
            serde_json::json!({ "property": "fontUnderline", "value": 1 }),
            serde_json::json!({ "property": "fontStrikethrough", "value": "false" }),
            serde_json::json!({ "property": "fontFamily", "value": null }),
            serde_json::json!({ "property": "displayText", "value": null }),
            serde_json::json!({ "property": "displayText", "value": 1 }),
            serde_json::json!({ "displayText": "text", "hidden": true }),
            serde_json::json!({ "displayText": "text", "unexpected": true }),
            serde_json::json!({ "property": "className", "value": null }),
            serde_json::json!({ "property": "className", "value": 1 }),
            serde_json::json!({ "className": "class", "hidden": true }),
            serde_json::json!({ "className": "class", "unexpected": true }),
            serde_json::json!({ "property": "fontPaint", "value": null }),
            serde_json::json!({ "property": "fontPaint", "value": { "color": "idle" } }),
            serde_json::json!({ "property": "activeFontPaint", "value": false }),
            serde_json::json!({ "fontPaint": { "color": "idle", "gradient": null }, "activeFontPaint": { "color": "active", "gradient": null } }),
            serde_json::json!({ "property": "activeFontPaint", "value": { "color": "active", "gradient": null, "unexpected": true } }),
            serde_json::json!({ "property": "shadow", "value": {} }),
            serde_json::json!({ "property": "shadow", "value": { "offsetX": 1, "blur": 2 } }),
            serde_json::json!({ "property": "shadow", "value": { "color": "shadow", "unexpected": true } }),
            serde_json::json!({ "property": "activeShadow", "value": null }),
            serde_json::json!({ "property": "activeShadow", "value": { "leaf": "offsetY", "value": "1" } }),
            serde_json::json!({ "property": "shadowEnabled", "value": "false" }),
            serde_json::json!({ "shadow": { "blur": 1 }, "shadowEnabled": true }),
            serde_json::json!({ "property": "backgroundPaint", "value": {} }),
            serde_json::json!({ "property": "backgroundPaint", "value": { "color": "solid" } }),
            serde_json::json!({ "property": "backgroundPaint", "value": { "color": "solid", "gradient": null, "unexpected": true } }),
            serde_json::json!({ "property": "backgroundPaint", "value": { "color": "first", "gradient": { "stops": [{ "color": "first", "pos": 0 }, { "color": "last", "pos": 1 }] } } }),
            serde_json::json!({ "property": "backgroundPaint", "value": { "color": "first", "gradient": { "angle": 45 } } }),
            serde_json::json!({ "property": "backgroundPaint", "value": { "color": "first", "gradient": { "angle": 45, "stops": [{ "color": "first", "pos": 0 }, { "color": "last", "pos": 1 }], "unexpected": true } } }),
            serde_json::json!({ "property": "backgroundPaint", "value": { "color": "first", "gradient": { "angle": 45, "stops": [{ "color": "first", "pos": 0, "unexpected": true }, { "color": "last", "pos": 1 }] } } }),
            serde_json::json!({ "backgroundPaint": { "color": "first", "gradient": null }, "borderPaint": { "color": "border", "gradient": null } }),
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
            serde_json::json!({ "activeImageFit": "fill", "unexpected": true }),
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
            serde_json::json!({ "property": "counterEnabled", "value": null }),
            serde_json::json!({ "property": "counterAnimationEnabled", "value": "true" }),
            serde_json::json!({ "counterEnabled": true, "counterAnimationEnabled": false }),
            serde_json::json!({ "property": "counterPlacement", "value": "center" }),
            serde_json::json!({ "property": "counterAlign", "value": "center" }),
            serde_json::json!({ "property": "counterAlignMode", "value": "outside" }),
            serde_json::json!({ "property": "counterGap", "value": -1 }),
            serde_json::json!({ "property": "counterGap", "value": 1.5 }),
            serde_json::json!({ "property": "counterGap", "value": 4_294_967_296_u64 }),
            serde_json::json!({ "counterPlacement": "inside", "counterAlign": "top" }),
            serde_json::json!({ "property": "counterFontSize", "value": -1 }),
            serde_json::json!({ "property": "counterFontSize", "value": 16.5 }),
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
            serde_json::json!({ "property": "counterFillIdle", "value": { "color": null } }),
            serde_json::json!({ "property": "counterFillIdle", "value": { "color": "solid", "gradient": null } }),
            serde_json::json!({ "property": "counterFillActive", "value": { "color": "first", "gradient": { "stops": [{ "color": "first", "pos": 0 }, { "color": "last", "pos": 1 }] } } }),
            serde_json::json!({ "property": "counterFillActive", "value": { "color": "first", "gradient": { "angle": 45, "stops": [{ "color": "first", "pos": 0 }, { "color": "last", "pos": 1 }], "unexpected": true } } }),
            serde_json::json!({ "property": "counterFillIdle", "value": { "color": "solid", "unexpected": true } }),
            serde_json::json!({ "counterFillIdle": { "color": "idle" }, "counterFillActive": { "color": "active" } }),
            serde_json::json!({ "property": "counterAnimationPreset", "value": null }),
            serde_json::json!({ "property": "counterAnimationPreset", "value": {} }),
            serde_json::json!({ "property": "counterAnimationPreset", "value": { "presetId": "preset", "enabled": true } }),
            serde_json::json!({ "property": "counterAnimationPreset", "value": { "presetId": "preset", "applyPresetId": false } }),
            serde_json::json!({ "property": "counterAnimationPreset", "value": { "presetId": "preset", "bezier": [0.1, 0.2, 0.8] } }),
            serde_json::json!({ "property": "counterAnimationPreset", "value": { "presetId": "preset", "durationMs": 1.5 } }),
            serde_json::json!({ "counterAnimationPreset": { "presetId": "preset" }, "hidden": true }),
            serde_json::json!({ "property": "statType", "value": "invalid" }),
            serde_json::json!({ "property": "noteEffectEnabled", "value": 1 }),
            serde_json::json!({ "property": "noteGlowEnabled", "value": null }),
            serde_json::json!({ "property": "noteGlowSyncPaint", "value": null }),
            serde_json::json!({ "property": "noteGlowSize", "value": null }),
            serde_json::json!({ "property": "noteGlowSize", "value": "20" }),
            serde_json::json!({ "noteGlowSize": 20, "noteGlowEnabled": true }),
            serde_json::json!({ "noteGlowSize": 20, "unexpected": true }),
            serde_json::json!({ "property": "notePaint", "value": {} }),
            serde_json::json!({ "property": "notePaint", "value": { "color": { "top": "a", "bottom": "b" } } }),
            serde_json::json!({ "property": "notePaint", "value": { "color": { "type": "gradient", "top": "a", "bottom": "b", "unexpected": true } } }),
            serde_json::json!({ "property": "notePaint", "value": { "opacity": 50, "opacityTop": 40 } }),
            serde_json::json!({ "property": "notePaint", "value": { "color": "x", "opacity": 50 } }),
            serde_json::json!({ "property": "noteGlowPaint", "value": { "opacity": "70" } }),
            serde_json::json!({ "property": "noteBorderPaint", "value": { "color": "#FFFFFF" } }),
            serde_json::json!({ "property": "noteBorderPaint", "value": { "color": "#FFFFFF", "opacity": 100, "unexpected": true } }),
            serde_json::json!({ "notePaint": { "color": "x" }, "noteGlowPaint": { "color": "y" } }),
            serde_json::json!({ "property": "noteOffsetX", "value": "0" }),
            serde_json::json!({ "noteOffsetX": null, "noteOffsetY": null }),
            serde_json::json!({ "noteOffsetY": null, "unexpected": true }),
            serde_json::json!({ "property": "noteWidth", "value": "20" }),
            serde_json::json!({ "noteWidth": null, "hidden": true }),
            serde_json::json!({ "property": "noteBorderWidth", "value": null }),
            serde_json::json!({ "property": "noteBorderWidth", "value": "1" }),
            serde_json::json!({ "property": "noteBorderRadius", "value": null }),
            serde_json::json!({ "noteBorderRadius": 4, "unexpected": true }),
            serde_json::json!({ "property": "noteAutoYCorrection", "value": "false" }),
            serde_json::json!({ "property": "noteAlignment", "value": "bottom" }),
            serde_json::json!({ "property": "noteBorderSide", "value": "diagonal" }),
        ]
        .map(|patch| {
            let mut wire = graph_color.clone();
            wire["ops"][0]["patch"] = patch;
            wire
        });
    for wire in [
        unknown_property,
        unknown_op,
        missing_property,
        multiple_properties,
        invalid_graph_type,
        invalid_graph_color,
    ]
    .into_iter()
    .chain(invalid_literal_properties)
    {
        let error = decode_editor_commit_request(wire).unwrap_err();
        assert_eq!(validation_code(&error), Some("INVALID_REQUEST_PAYLOAD"));
    }

    let slot = EditorOpV1::SetKeySlot {
        id: Uuid::new_v4().to_string(),
        slot: EditorFrozenKeySlotV1::Multi(crate::models::EditorFrozenMultiKeySlotV1 {
            keys: vec!["A".to_string(), "B".to_string()],
            match_mode: crate::models::SlotMatch::Any,
        }),
    };
    let slot_wire = serde_json::to_value(ops_request(vec![slot])).unwrap();
    assert_eq!(slot_wire["ops"][0]["kind"], "setKeySlot");
    assert_eq!(slot_wire["ops"][0]["slot"]["match"], "any");
    decode_editor_commit_request(slot_wire.clone()).unwrap();

    let mut unknown_slot = slot_wire;
    unknown_slot["ops"][0]["slot"]["unexpected"] = serde_json::json!(true);
    let error = decode_editor_commit_request(unknown_slot).unwrap_err();
    assert_eq!(validation_code(&error), Some("INVALID_REQUEST_PAYLOAD"));

    let invalid_slot = ops_request(vec![EditorOpV1::SetKeySlot {
        id: Uuid::new_v4().to_string(),
        slot: EditorFrozenKeySlotV1::Multi(crate::models::EditorFrozenMultiKeySlotV1 {
            keys: vec!["A".to_string(), "A".to_string()],
            match_mode: crate::models::SlotMatch::All,
        }),
    }]);
    assert_eq!(
        validation_code(&validate_request_envelope(&invalid_slot).unwrap_err()),
        Some("INVALID_KEY_SLOT")
    );
}

#[test]
fn frozen_insert_wire_is_exact_through_nested_full_records() {
    let request = ops_request(vec![frozen_insert_op(Uuid::new_v4().to_string())]);
    let mut valid = serde_json::to_value(request).unwrap();
    valid["ops"][0]["elements"][0]["position"]["unexpected"] = serde_json::json!(1);

    let error = decode_editor_commit_request(valid).unwrap_err();
    assert_eq!(validation_code(&error), Some("INVALID_REQUEST_PAYLOAD"));

    let mut invalid_slot = serde_json::to_value(ops_request(vec![frozen_insert_op(
        Uuid::new_v4().to_string(),
    )]))
    .unwrap();
    invalid_slot["ops"][0]["elements"][0]["slot"] = serde_json::json!({
        "keys": ["A", "B"],
        "match": "all",
        "unexpected": true,
    });
    let error = decode_editor_commit_request(invalid_slot).unwrap_err();
    assert_eq!(validation_code(&error), Some("INVALID_REQUEST_PAYLOAD"));
}

#[test]
fn reorder_wire_is_exact_and_requires_explicit_nullable_group_id() {
    let target_id = Uuid::new_v4().to_string();
    let op = EditorOpV1::ReorderElements {
        mode: "4key".to_string(),
        complete_mode_order: true,
        z_updates: vec![EditorZUpdateV1 {
            element_type: EditorElementTypeV1::Key,
            id: target_id.clone(),
            z_index: 3,
        }],
        group_updates: vec![EditorGroupUpdateV1 {
            element_type: EditorElementTypeV1::Key,
            id: target_id,
            group_id: None,
        }],
    };
    let valid = serde_json::to_value(ops_request(vec![op])).unwrap();
    assert_eq!(valid["ops"][0]["kind"], "reorderElements");
    assert_eq!(valid["ops"][0]["completeModeOrder"], true);
    assert!(valid["ops"][0]["groupUpdates"][0]["groupId"].is_null());
    decode_editor_commit_request(valid.clone()).unwrap();

    let mut missing_group_id = valid.clone();
    missing_group_id["ops"][0]["groupUpdates"][0]
        .as_object_mut()
        .unwrap()
        .remove("groupId");
    let error = decode_editor_commit_request(missing_group_id).unwrap_err();
    assert_eq!(validation_code(&error), Some("INVALID_REQUEST_PAYLOAD"));

    let mut unknown_z = valid.clone();
    unknown_z["ops"][0]["zUpdates"][0]["unexpected"] = serde_json::json!(true);
    let mut unknown_group = valid;
    unknown_group["ops"][0]["groupUpdates"][0]["unexpected"] = serde_json::json!(true);
    for wire in [unknown_z, unknown_group] {
        let error = decode_editor_commit_request(wire).unwrap_err();
        assert_eq!(validation_code(&error), Some("INVALID_REQUEST_PAYLOAD"));
    }
}

#[test]
fn group_structural_wire_is_exact_tagged_required_and_sole() {
    let target_id = Uuid::new_v4().to_string();
    let target = EditorElementGroupTargetV1 {
        element_type: EditorElementTypeV1::Key,
        id: target_id.clone(),
    };
    let create = EditorOpV1::SetElementGroups {
        mode: "4key".to_string(),
        targets: vec![target.clone()],
        target_group: Some(EditorTargetGroupV1::Create {
            id: " legacy group ".to_string(),
            name: " Raw Name ".to_string(),
        }),
    };
    let create_wire = serde_json::to_value(ops_request(vec![create])).unwrap();
    assert_eq!(create_wire["ops"][0]["kind"], "setElementGroups");
    assert_eq!(create_wire["ops"][0]["targetGroup"]["kind"], "create");
    assert_eq!(create_wire["ops"][0]["targetGroup"]["id"], " legacy group ");
    decode_editor_commit_request(create_wire.clone()).unwrap();

    let ungroup = EditorOpV1::SetElementGroups {
        mode: "4key".to_string(),
        targets: vec![target.clone()],
        target_group: None,
    };
    let ungroup_wire = serde_json::to_value(ops_request(vec![ungroup])).unwrap();
    assert!(ungroup_wire["ops"][0]["targetGroup"].is_null());
    decode_editor_commit_request(ungroup_wire.clone()).unwrap();

    let existing = EditorOpV1::SetElementGroups {
        mode: "4key".to_string(),
        targets: vec![target],
        target_group: Some(EditorTargetGroupV1::Existing {
            id: "legacy-group".to_string(),
        }),
    };
    let existing_wire = serde_json::to_value(ops_request(vec![existing])).unwrap();
    assert_eq!(
        existing_wire["ops"][0]["targetGroup"],
        serde_json::json!({"kind": "existing", "id": "legacy-group"})
    );
    decode_editor_commit_request(existing_wire).unwrap();

    let rename = EditorOpV1::RenameLayerGroup {
        mode: " ".to_string(),
        group_id: " ".to_string(),
        name: " ".to_string(),
    };
    let rename_wire = serde_json::to_value(ops_request(vec![rename])).unwrap();
    assert_eq!(rename_wire["ops"][0]["kind"], "renameLayerGroup");
    decode_editor_commit_request(rename_wire.clone()).unwrap();

    let mut missing_target_group = ungroup_wire.clone();
    missing_target_group["ops"][0]
        .as_object_mut()
        .unwrap()
        .remove("targetGroup");
    let mut untagged = create_wire.clone();
    untagged["ops"][0]["targetGroup"] = serde_json::json!({
        "id": "group",
        "name": "Group",
    });
    let mut existing_with_name = create_wire.clone();
    existing_with_name["ops"][0]["targetGroup"] = serde_json::json!({
        "kind": "existing",
        "id": "group",
        "name": "No rename",
    });
    let mut create_without_name = create_wire.clone();
    create_without_name["ops"][0]["targetGroup"] = serde_json::json!({
        "kind": "create",
        "id": "group",
    });
    let mut target_extra = create_wire.clone();
    target_extra["ops"][0]["targets"][0]["unexpected"] = serde_json::json!(true);
    let mut group_extra = create_wire.clone();
    group_extra["ops"][0]["targetGroup"]["unexpected"] = serde_json::json!(true);
    let mut rename_extra = rename_wire;
    rename_extra["ops"][0]["unexpected"] = serde_json::json!(true);
    for invalid in [
        missing_target_group,
        untagged,
        existing_with_name,
        create_without_name,
        target_extra,
        group_extra,
        rename_extra,
    ] {
        let error = decode_editor_commit_request(invalid).unwrap_err();
        assert_eq!(validation_code(&error), Some("INVALID_REQUEST_PAYLOAD"));
    }

    // 빈 native targets 허용 - plugin-only 그룹 편집이 def 생성·정리를 실어야 함
    let empty = EditorOpV1::SetElementGroups {
        mode: "4key".to_string(),
        targets: Vec::new(),
        target_group: None,
    };
    validate_request_envelope(&ops_request(vec![empty])).unwrap();
    let at_limit = EditorOpV1::SetElementGroups {
        mode: "4key".to_string(),
        targets: (0..MAX_RENDER_ITEMS)
            .map(|index| EditorElementGroupTargetV1 {
                element_type: EditorElementTypeV1::Key,
                id: Uuid::from_u128(index as u128 + 1).to_string(),
            })
            .collect(),
        target_group: None,
    };
    validate_request_envelope(&ops_request(vec![at_limit.clone()])).unwrap();
    let mut too_many = at_limit;
    let EditorOpV1::SetElementGroups { targets, .. } = &mut too_many else {
        unreachable!();
    };
    targets.push(EditorElementGroupTargetV1 {
        element_type: EditorElementTypeV1::Key,
        id: Uuid::from_u128(MAX_RENDER_ITEMS as u128 + 1).to_string(),
    });
    assert_eq!(
        validation_code(&validate_request_envelope(&ops_request(vec![too_many])).unwrap_err()),
        Some("INVALID_ELEMENT_GROUP_TARGET_COUNT")
    );
    let duplicate = EditorOpV1::SetElementGroups {
        mode: "4key".to_string(),
        targets: vec![
            EditorElementGroupTargetV1 {
                element_type: EditorElementTypeV1::Key,
                id: target_id.clone(),
            },
            EditorElementGroupTargetV1 {
                element_type: EditorElementTypeV1::Graph,
                id: target_id,
            },
        ],
        target_group: None,
    };
    assert_eq!(
        validation_code(&validate_request_envelope(&ops_request(vec![duplicate])).unwrap_err()),
        Some("DUPLICATE_ELEMENT_GROUP_TARGET")
    );

    let accepted_uuid = Uuid::new_v4();
    for id in [
        accepted_uuid.simple().to_string(),
        accepted_uuid.braced().to_string(),
        accepted_uuid.urn().to_string(),
        accepted_uuid.hyphenated().to_string().to_uppercase(),
    ] {
        let op = EditorOpV1::SetElementGroups {
            mode: "4key".to_string(),
            targets: vec![EditorElementGroupTargetV1 {
                element_type: EditorElementTypeV1::Key,
                id,
            }],
            target_group: None,
        };
        validate_request_envelope(&ops_request(vec![op])).unwrap();
    }

    let mixed = ops_request(vec![
        EditorOpV1::RenameLayerGroup {
            mode: "4key".to_string(),
            group_id: "group".to_string(),
            name: "Name".to_string(),
        },
        set_bounds_op(Uuid::new_v4().to_string(), EditorElementTypeV1::Key),
    ]);
    assert_eq!(
        validation_code(&validate_request_envelope(&mixed).unwrap_err()),
        Some("INVALID_GROUP_STRUCTURAL_BATCH")
    );
}

#[test]
fn reorder_is_a_bounded_sole_op_with_consistent_targets() {
    let id = Uuid::new_v4().to_string();
    let mixed = ops_request(vec![
        reorder_op(id.clone(), false),
        set_bounds_op(Uuid::new_v4().to_string(), EditorElementTypeV1::Key),
    ]);
    assert_eq!(
        validation_code(&validate_request_envelope(&mixed).unwrap_err()),
        Some("INVALID_REORDER_BATCH")
    );

    let empty = EditorOpV1::ReorderElements {
        mode: "4key".to_string(),
        complete_mode_order: false,
        z_updates: Vec::new(),
        group_updates: Vec::new(),
    };
    assert_eq!(
        validation_code(&validate_request_envelope(&ops_request(vec![empty])).unwrap_err()),
        Some("EMPTY_REORDER_BATCH")
    );

    let duplicate_z = EditorOpV1::ReorderElements {
        mode: "4key".to_string(),
        complete_mode_order: true,
        z_updates: vec![
            EditorZUpdateV1 {
                element_type: EditorElementTypeV1::Key,
                id: id.clone(),
                z_index: 1,
            },
            EditorZUpdateV1 {
                element_type: EditorElementTypeV1::Key,
                id: id.clone(),
                z_index: 2,
            },
        ],
        group_updates: Vec::new(),
    };
    assert_eq!(
        validation_code(&validate_request_envelope(&ops_request(vec![duplicate_z])).unwrap_err()),
        Some("DUPLICATE_REORDER_Z_TARGET")
    );

    let group_without_z = EditorOpV1::ReorderElements {
        mode: "4key".to_string(),
        complete_mode_order: true,
        z_updates: vec![EditorZUpdateV1 {
            element_type: EditorElementTypeV1::Key,
            id: id.clone(),
            z_index: 1,
        }],
        group_updates: vec![EditorGroupUpdateV1 {
            element_type: EditorElementTypeV1::Key,
            id: Uuid::new_v4().to_string(),
            group_id: None,
        }],
    };
    assert_eq!(
        validation_code(
            &validate_request_envelope(&ops_request(vec![group_without_z])).unwrap_err()
        ),
        Some("REORDER_GROUP_TARGET_NOT_IN_ORDER")
    );

    let duplicate_group = EditorOpV1::ReorderElements {
        mode: "4key".to_string(),
        complete_mode_order: true,
        z_updates: vec![EditorZUpdateV1 {
            element_type: EditorElementTypeV1::Key,
            id: id.clone(),
            z_index: 1,
        }],
        group_updates: vec![
            EditorGroupUpdateV1 {
                element_type: EditorElementTypeV1::Key,
                id: id.clone(),
                group_id: None,
            },
            EditorGroupUpdateV1 {
                element_type: EditorElementTypeV1::Key,
                id: id.clone(),
                group_id: None,
            },
        ],
    };
    assert_eq!(
        validation_code(
            &validate_request_envelope(&ops_request(vec![duplicate_group])).unwrap_err()
        ),
        Some("DUPLICATE_REORDER_GROUP_TARGET")
    );

    let conflicting_type = EditorOpV1::ReorderElements {
        mode: "4key".to_string(),
        complete_mode_order: true,
        z_updates: vec![EditorZUpdateV1 {
            element_type: EditorElementTypeV1::Key,
            id: id.clone(),
            z_index: 1,
        }],
        group_updates: vec![EditorGroupUpdateV1 {
            element_type: EditorElementTypeV1::Graph,
            id: id.clone(),
            group_id: None,
        }],
    };
    assert_eq!(
        validation_code(
            &validate_request_envelope(&ops_request(vec![conflicting_type])).unwrap_err()
        ),
        Some("REORDER_TARGET_TYPE_CONFLICT")
    );

    let invalid_group_id = EditorOpV1::ReorderElements {
        mode: "4key".to_string(),
        complete_mode_order: true,
        z_updates: vec![EditorZUpdateV1 {
            element_type: EditorElementTypeV1::Key,
            id: id.clone(),
            z_index: 1,
        }],
        group_updates: vec![EditorGroupUpdateV1 {
            element_type: EditorElementTypeV1::Key,
            id: id.clone(),
            group_id: Some(String::new()),
        }],
    };
    assert_eq!(
        validation_code(
            &validate_request_envelope(&ops_request(vec![invalid_group_id])).unwrap_err()
        ),
        Some("INVALID_REORDER_GROUP_ID")
    );

    let partial_group = EditorOpV1::ReorderElements {
        mode: "4key".to_string(),
        complete_mode_order: false,
        z_updates: vec![EditorZUpdateV1 {
            element_type: EditorElementTypeV1::Key,
            id: id.clone(),
            z_index: 1,
        }],
        group_updates: vec![EditorGroupUpdateV1 {
            element_type: EditorElementTypeV1::Key,
            id: id.clone(),
            group_id: None,
        }],
    };
    assert_eq!(
        validation_code(&validate_request_envelope(&ops_request(vec![partial_group])).unwrap_err()),
        Some("INVALID_PARTIAL_REORDER_GROUP_UPDATE")
    );

    let at_limit = EditorOpV1::ReorderElements {
        mode: "4key".to_string(),
        complete_mode_order: false,
        z_updates: (0..MAX_RENDER_ITEMS)
            .map(|index| EditorZUpdateV1 {
                element_type: EditorElementTypeV1::Key,
                id: Uuid::from_u128(index as u128 + 1).to_string(),
                z_index: index as i32,
            })
            .collect(),
        group_updates: Vec::new(),
    };
    validate_request_envelope(&ops_request(vec![at_limit.clone()])).unwrap();
    let mut too_wide = at_limit;
    let EditorOpV1::ReorderElements { z_updates, .. } = &mut too_wide else {
        unreachable!();
    };
    z_updates.push(EditorZUpdateV1 {
        element_type: EditorElementTypeV1::Key,
        id: Uuid::from_u128(MAX_RENDER_ITEMS as u128 + 1).to_string(),
        z_index: 0,
    });
    assert_eq!(
        validation_code(&validate_request_envelope(&ops_request(vec![too_wide])).unwrap_err()),
        Some("REORDER_BATCH_TOO_LARGE")
    );

    let too_many_group_updates = EditorOpV1::ReorderElements {
        mode: "4key".to_string(),
        complete_mode_order: true,
        z_updates: vec![EditorZUpdateV1 {
            element_type: EditorElementTypeV1::Key,
            id: id.clone(),
            z_index: 1,
        }],
        group_updates: (0..=MAX_RENDER_ITEMS)
            .map(|index| EditorGroupUpdateV1 {
                element_type: EditorElementTypeV1::Key,
                id: Uuid::from_u128(index as u128 + 1).to_string(),
                group_id: None,
            })
            .collect(),
    };
    assert_eq!(
        validation_code(
            &validate_request_envelope(&ops_request(vec![too_many_group_updates])).unwrap_err()
        ),
        Some("REORDER_BATCH_TOO_LARGE")
    );
}

#[test]
fn frozen_insert_is_a_bounded_sole_op_with_unique_disjoint_ids() {
    let id = Uuid::new_v4().to_string();
    let mixed = ops_request(vec![
        frozen_insert_op(id.clone()),
        set_bounds_op(Uuid::new_v4().to_string(), EditorElementTypeV1::Key),
    ]);
    assert_eq!(
        validation_code(&validate_request_envelope(&mixed).unwrap_err()),
        Some("INVALID_FROZEN_INSERT_BATCH")
    );

    let duplicate = EditorOpV1::InsertFrozenElements {
        mode: "4key".to_string(),
        elements: vec![
            crate::models::EditorFrozenElementV1::Key {
                slot: crate::models::EditorFrozenKeySlotV1::Single("A".to_string()),
                position: KeyPosition {
                    id: id.clone(),
                    ..KeyPosition::default()
                },
            },
            crate::models::EditorFrozenElementV1::Key {
                slot: crate::models::EditorFrozenKeySlotV1::Single("B".to_string()),
                position: KeyPosition {
                    id: id.clone(),
                    ..KeyPosition::default()
                },
            },
        ],
        groups: Vec::new(),
        z_updates: Vec::new(),
    };
    assert_eq!(
        validation_code(&validate_request_envelope(&ops_request(vec![duplicate])).unwrap_err()),
        Some("DUPLICATE_FROZEN_INSERT_ID")
    );

    let overlap = EditorOpV1::InsertFrozenElements {
        mode: "4key".to_string(),
        elements: vec![crate::models::EditorFrozenElementV1::Key {
            slot: crate::models::EditorFrozenKeySlotV1::Single("A".to_string()),
            position: KeyPosition {
                id: id.clone(),
                ..KeyPosition::default()
            },
        }],
        groups: Vec::new(),
        z_updates: vec![crate::models::EditorZUpdateV1 {
            element_type: EditorElementTypeV1::Key,
            id,
            z_index: 1,
        }],
    };
    assert_eq!(
        validation_code(&validate_request_envelope(&ops_request(vec![overlap])).unwrap_err()),
        Some("FROZEN_INSERT_Z_TARGET_OVERLAP")
    );

    let malformed_slot = EditorOpV1::InsertFrozenElements {
        mode: "4key".to_string(),
        elements: vec![crate::models::EditorFrozenElementV1::Key {
            slot: crate::models::EditorFrozenKeySlotV1::Multi(
                crate::models::EditorFrozenMultiKeySlotV1 {
                    keys: vec!["A".to_string()],
                    match_mode: crate::models::SlotMatch::All,
                },
            ),
            position: KeyPosition {
                id: Uuid::new_v4().to_string(),
                ..KeyPosition::default()
            },
        }],
        groups: Vec::new(),
        z_updates: Vec::new(),
    };
    assert_eq!(
        validation_code(
            &validate_request_envelope(&ops_request(vec![malformed_slot])).unwrap_err()
        ),
        Some("INVALID_FROZEN_KEY_SLOT")
    );

    for match_mode in [crate::models::SlotMatch::All, crate::models::SlotMatch::Any] {
        let valid_multi = EditorOpV1::InsertFrozenElements {
            mode: "4key".to_string(),
            elements: vec![crate::models::EditorFrozenElementV1::Key {
                slot: crate::models::EditorFrozenKeySlotV1::Multi(
                    crate::models::EditorFrozenMultiKeySlotV1 {
                        keys: vec!["A".to_string(), "B".to_string()],
                        match_mode,
                    },
                ),
                position: KeyPosition {
                    id: Uuid::new_v4().to_string(),
                    ..KeyPosition::default()
                },
            }],
            groups: Vec::new(),
            z_updates: Vec::new(),
        };
        validate_request_envelope(&ops_request(vec![valid_multi])).unwrap();
    }

    for members in [
        vec!["A".to_string(), "A".to_string()],
        vec!["".to_string(), "B".to_string()],
        vec!["A+B".to_string(), "C".to_string()],
        vec!["A|B".to_string(), "C".to_string()],
    ] {
        let invalid_multi = EditorOpV1::InsertFrozenElements {
            mode: "4key".to_string(),
            elements: vec![crate::models::EditorFrozenElementV1::Key {
                slot: crate::models::EditorFrozenKeySlotV1::Multi(
                    crate::models::EditorFrozenMultiKeySlotV1 {
                        keys: members,
                        match_mode: crate::models::SlotMatch::All,
                    },
                ),
                position: KeyPosition {
                    id: Uuid::new_v4().to_string(),
                    ..KeyPosition::default()
                },
            }],
            groups: Vec::new(),
            z_updates: Vec::new(),
        };
        assert_eq!(
            validation_code(
                &validate_request_envelope(&ops_request(vec![invalid_multi])).unwrap_err()
            ),
            Some("INVALID_FROZEN_KEY_SLOT")
        );
    }

    let inserted_id = Uuid::from_u128((MAX_RENDER_ITEMS + 1) as u128).to_string();
    let wide_plan = EditorOpV1::InsertFrozenElements {
        mode: "4key".to_string(),
        elements: vec![crate::models::EditorFrozenElementV1::Key {
            slot: crate::models::EditorFrozenKeySlotV1::Single("A".to_string()),
            position: KeyPosition {
                id: inserted_id,
                ..KeyPosition::default()
            },
        }],
        groups: Vec::new(),
        z_updates: (0..MAX_RENDER_ITEMS)
            .map(|index| crate::models::EditorZUpdateV1 {
                element_type: EditorElementTypeV1::Key,
                id: Uuid::from_u128(index as u128 + 1).to_string(),
                z_index: index as i32,
            })
            .collect(),
    };
    validate_request_envelope(&ops_request(vec![wide_plan.clone()])).unwrap();

    let mut too_wide = wide_plan;
    let EditorOpV1::InsertFrozenElements { z_updates, .. } = &mut too_wide else {
        unreachable!();
    };
    z_updates.push(crate::models::EditorZUpdateV1 {
        element_type: EditorElementTypeV1::Key,
        id: Uuid::from_u128((MAX_RENDER_ITEMS + 2) as u128).to_string(),
        z_index: 0,
    });
    assert_eq!(
        validation_code(&validate_request_envelope(&ops_request(vec![too_wide])).unwrap_err()),
        Some("FROZEN_INSERT_BATCH_TOO_LARGE")
    );
}

#[test]
fn editor_ops_enforce_version_count_ids_and_global_target_uniqueness() {
    let id = Uuid::new_v4().to_string();
    // 구버전 1과 미래 버전 3 모두 거부, v1 이중 수용 없음
    for unsupported_version in [1, 3] {
        let mut unsupported = ops_request(vec![set_bounds_op(&id, EditorElementTypeV1::Key)]);
        unsupported.ops_version = Some(unsupported_version);
        assert_eq!(
            validation_code(&validate_request_envelope(&unsupported).unwrap_err()),
            Some("UNSUPPORTED_OPS_VERSION")
        );
    }

    let empty = ops_request(Vec::new());
    assert_eq!(
        validation_code(&validate_request_envelope(&empty).unwrap_err()),
        Some("EMPTY_EDITOR_OPS")
    );

    let at_limit = ops_request(
        (0..MAX_EDITOR_OPS)
            .map(|index| {
                set_bounds_op(
                    Uuid::from_u128(index as u128 + 1).to_string(),
                    EditorElementTypeV1::Key,
                )
            })
            .collect(),
    );
    validate_request_envelope(&at_limit).unwrap();

    let mut too_many = at_limit;
    too_many.ops.as_mut().unwrap().push(set_bounds_op(
        Uuid::from_u128(MAX_EDITOR_OPS as u128 + 1).to_string(),
        EditorElementTypeV1::Key,
    ));
    assert_eq!(
        validation_code(&validate_request_envelope(&too_many).unwrap_err()),
        Some("TOO_MANY_EDITOR_OPS")
    );

    let duplicate = ops_request(vec![
        set_bounds_op(&id, EditorElementTypeV1::Key),
        delete_element_op(&id, EditorElementTypeV1::Graph),
    ]);
    assert_eq!(
        validation_code(&validate_request_envelope(&duplicate).unwrap_err()),
        Some("DUPLICATE_EDITOR_OP_TARGET")
    );

    let nil = ops_request(vec![set_bounds_op(
        Uuid::nil().to_string(),
        EditorElementTypeV1::Key,
    )]);
    assert_eq!(
        validation_code(&validate_request_envelope(&nil).unwrap_err()),
        Some(crate::state::native_element_id::INVALID_ELEMENT_ID)
    );
}

#[test]
fn editor_op_bounds_reuse_position_numeric_limits() {
    let valid = EditorBoundsV1 {
        dx: MAX_ABS_COORDINATE,
        dy: -MAX_ABS_COORDINATE,
        width: MAX_DIMENSION,
        height: 1.0,
    };
    validate_editor_op_bounds(0, None, valid).unwrap();

    for invalid in [
        EditorBoundsV1 {
            dx: f64::NAN,
            ..valid
        },
        EditorBoundsV1 {
            dy: MAX_ABS_COORDINATE + 1.0,
            ..valid
        },
        EditorBoundsV1 {
            width: 0.0,
            ..valid
        },
        EditorBoundsV1 {
            height: MAX_DIMENSION + 1.0,
            ..valid
        },
    ] {
        assert!(validate_editor_op_bounds(0, None, invalid).is_err());
    }

    let grandfathered = KeyPosition {
        width: MAX_DIMENSION + 2.0,
        ..KeyPosition::default()
    };
    validate_editor_op_bounds(
        0,
        Some(&grandfathered),
        EditorBoundsV1 {
            width: MAX_DIMENSION + 1.0,
            ..position_bounds(&grandfathered)
        },
    )
    .unwrap();

    let mismatch =
        validate_editor_op_target_type(0, EditorElementTypeV1::Graph, EditorElementTypeV1::Key)
            .unwrap_err();
    assert_eq!(validation_code(&mismatch), Some("ELEMENT_TYPE_MISMATCH"));
    assert!(!mismatch.retryable);
}

#[test]
fn editor_op_bounds_report_coordinate_nan_before_dimension_errors() {
    let error = validate_editor_op_bounds(
        7,
        None,
        EditorBoundsV1 {
            dx: f64::NAN,
            dy: MAX_ABS_COORDINATE + 1.0,
            width: 0.0,
            height: f64::NAN,
        },
    )
    .unwrap_err();
    assert_eq!(validation_code(&error), Some("COORDINATE_OUT_OF_RANGE"));
    assert_eq!(
        error.message,
        format!("editor op 7.bounds.dx exceeds ±{MAX_ABS_COORDINATE}")
    );

    let error = validate_editor_op_bounds(
        8,
        None,
        EditorBoundsV1 {
            dx: 0.0,
            dy: 0.0,
            width: f64::NAN,
            height: 0.0,
        },
    )
    .unwrap_err();
    assert_eq!(validation_code(&error), Some("DIMENSION_OUT_OF_RANGE"));
    assert_eq!(
        error.message,
        format!("editor op 8.bounds.width must satisfy 0 < value <= {MAX_DIMENSION}")
    );
}

#[test]
fn canonical_fingerprint_includes_editor_op_payload() {
    let id = Uuid::new_v4().to_string();
    let left = ops_request(vec![set_bounds_op(&id, EditorElementTypeV1::Key)]);
    let mut right = left.clone();
    let Some(EditorOpV1::SetBounds { bounds, .. }) =
        right.ops.as_mut().and_then(|ops| ops.first_mut())
    else {
        unreachable!();
    };
    bounds.width += 1.0;

    assert_ne!(
        request_fingerprint(&left).unwrap(),
        request_fingerprint(&right).unwrap()
    );

    let delete = ops_request(vec![delete_element_op(&id, EditorElementTypeV1::Key)]);
    assert_ne!(
        request_fingerprint(&left).unwrap(),
        request_fingerprint(&delete).unwrap()
    );
}

#[test]
fn editor_op_results_use_the_exact_camel_case_wire_values() {
    let canonical = EditorBoundsV1 {
        dx: 1.0,
        dy: 2.0,
        width: 3.0,
        height: 4.0,
    };
    let wire = serde_json::to_value([
        EditorOpResultV1 {
            status: EditorOpResultStatusV1::Applied,
            bounds: Some(canonical),
        },
        EditorOpResultV1 {
            status: EditorOpResultStatusV1::NoChange,
            bounds: Some(canonical),
        },
        EditorOpResultV1 {
            status: EditorOpResultStatusV1::TargetMissing,
            bounds: None,
        },
    ])
    .unwrap();

    assert_eq!(wire[0]["status"], "applied");
    assert_eq!(wire[1]["status"], "noChange");
    assert_eq!(wire[2]["status"], "targetMissing");
    assert!(wire[2].get("bounds").is_none());
}

#[test]
fn member_fanout_limit_accepts_sixteen_and_rejects_new_excess() {
    let store = default_editor_store();
    let current = EditorDocumentV1::from_store(&store);
    let mut at_limit = current.clone();
    at_limit
        .keys
        .get_mut("4key")
        .unwrap()
        .extend((0..MAX_SLOTS_PER_MEMBER).map(|index| KeySlot::Multi {
            keys: vec!["SHARED".to_string(), format!("K{index}")],
            match_mode: crate::models::SlotMatch::Any,
        }));
    at_limit
        .key_positions
        .get_mut("4key")
        .unwrap()
        .extend(vec![KeyPosition::default(); MAX_SLOTS_PER_MEMBER]);
    let mut at_limit_store = store.clone();
    at_limit.apply_to_store(&mut at_limit_store);

    validate_document_transition(&current, &at_limit, &store, &at_limit_store).unwrap();

    let mut over_limit = at_limit.clone();
    over_limit
        .keys
        .get_mut("4key")
        .unwrap()
        .push(KeySlot::Multi {
            keys: vec!["SHARED".to_string(), "EXTRA".to_string()],
            match_mode: crate::models::SlotMatch::Any,
        });
    over_limit
        .key_positions
        .get_mut("4key")
        .unwrap()
        .push(KeyPosition::default());
    let mut over_limit_store = at_limit_store.clone();
    over_limit.apply_to_store(&mut over_limit_store);

    let error =
        validate_document_transition(&at_limit, &over_limit, &at_limit_store, &over_limit_store)
            .unwrap_err();
    assert_eq!(
        error.details.unwrap().validation_code.as_deref(),
        Some("TOO_MANY_SLOTS_PER_MEMBER")
    );

    validate_document_transition(
        &over_limit,
        &over_limit,
        &over_limit_store,
        &over_limit_store,
    )
    .unwrap();
}

#[test]
fn counter_sync_uses_canonical_and_separates_any_from_all() {
    let keys = HashMap::from([(
        "mode".to_string(),
        vec![
            KeySlot::Single("A".to_string()),
            KeySlot::Multi {
                keys: vec!["A".to_string(), "B".to_string()],
                match_mode: crate::models::SlotMatch::Any,
            },
            KeySlot::Multi {
                keys: vec!["A".to_string(), "B".to_string()],
                match_mode: crate::models::SlotMatch::All,
            },
        ],
    )]);
    let mut counters = HashMap::from([(
        "mode".to_string(),
        HashMap::from([("A".to_string(), 7), ("stale".to_string(), 3)]),
    )]);

    sync_key_counters(&mut counters, &keys);

    assert_eq!(counters["mode"]["A"], 7);
    assert_eq!(counters["mode"]["A|B"], 0);
    assert_eq!(counters["mode"]["A+B"], 0);
    assert!(!counters["mode"].contains_key("stale"));
}

#[test]
fn structural_single_field_update_requires_pair() {
    let store = AppStoreData::default();
    let current = EditorDocumentV1::from_store(&store);
    let mut candidate = current.clone();
    candidate
        .keys
        .entry("4key".to_string())
        .or_default()
        .push(KeySlot::from("A"));

    let error = validate_paired_update(&current, &candidate, true, false).unwrap_err();
    assert_eq!(
        error.error_code,
        crate::errors::EditorCommitErrorCode::PairedUpdateRequired
    );
}

#[test]
fn stage_four_paired_topology_uses_key_position_id_order() {
    let store = default_editor_store();
    let current = EditorDocumentV1::from_store(&store);

    let mut position_edit = current.clone();
    position_edit.key_positions.get_mut("4key").unwrap()[0].dx += 1.0;
    validate_paired_update(&current, &position_edit, false, true).unwrap();

    let mut positions_only_reorder = current.clone();
    positions_only_reorder
        .key_positions
        .get_mut("4key")
        .unwrap()
        .swap(0, 1);
    let error = validate_paired_update(&current, &positions_only_reorder, false, true).unwrap_err();
    assert_eq!(
        error.error_code,
        crate::errors::EditorCommitErrorCode::PairedUpdateRequired
    );
    assert!(!error.retryable);

    let mut paired_reorder = positions_only_reorder;
    paired_reorder.keys.get_mut("4key").unwrap().swap(0, 1);
    validate_paired_update(&current, &paired_reorder, true, true).unwrap();

    let mut keys_only = current.clone();
    keys_only.keys.get_mut("4key").unwrap()[0] = KeySlot::from("Changed");
    validate_paired_update(&current, &keys_only, true, false).unwrap();
}

#[test]
fn unchanged_ghost_mode_is_grandfathered() {
    let mut store = AppStoreData::default();
    store
        .keys
        .insert("ghost".to_string(), vec![KeySlot::from("A")]);
    store
        .key_positions
        .insert("ghost".to_string(), vec![KeyPosition::default()]);
    let current = EditorDocumentV1::from_store(&store);
    let mut candidate = current.clone();
    candidate.keys.get_mut("ghost").unwrap()[0] = KeySlot::from("B");

    validate_document_transition(&current, &candidate, &store, &store).unwrap();
}

#[test]
fn new_ghost_mode_is_rejected() {
    let store = AppStoreData::default();
    let current = EditorDocumentV1::from_store(&store);
    let mut candidate = current.clone();
    candidate
        .keys
        .insert("ghost".to_string(), vec![KeySlot::from("A")]);
    candidate
        .key_positions
        .insert("ghost".to_string(), vec![KeyPosition::default()]);

    let error = validate_document_transition(&current, &candidate, &store, &store).unwrap_err();
    assert_eq!(
        error.details.unwrap().validation_code.as_deref(),
        Some("UNKNOWN_MODE")
    );
}

#[test]
fn metadata_can_introduce_matching_custom_mode_in_same_transition() {
    let store = AppStoreData::default();
    let current = EditorDocumentV1::from_store(&store);
    let mut candidate_store = store.clone();
    candidate_store.custom_tabs.push(CustomTab {
        id: "custom".to_string(),
        name: "Custom".to_string(),
    });
    candidate_store
        .keys
        .insert("custom".to_string(), vec![KeySlot::from("A")]);
    candidate_store
        .key_positions
        .insert("custom".to_string(), vec![KeyPosition::default()]);
    let candidate = EditorDocumentV1::from_store(&candidate_store);

    validate_document_transition(&current, &candidate, &store, &candidate_store).unwrap();
}

#[test]
fn history_restore_requires_metadata_for_every_custom_editor_mode() {
    let mut store = AppStoreData::default();
    store
        .keys
        .insert("custom".to_string(), vec![KeySlot::from("A")]);
    store
        .key_positions
        .insert("custom".to_string(), vec![KeyPosition::default()]);
    let document = EditorDocumentV1::from_store(&store);

    let error = validate_history_restore_metadata(&document, &[], "4key").unwrap_err();

    assert_eq!(
        error.details.unwrap().validation_code.as_deref(),
        Some("CUSTOM_TAB_METADATA_MISSING")
    );
}

#[test]
fn history_restore_rejects_metadata_without_paired_editor_collections() {
    let document = EditorDocumentV1::from_store(&AppStoreData::default());
    let tabs = vec![CustomTab {
        id: "custom".to_string(),
        name: "Custom".to_string(),
    }];

    let error = validate_history_restore_metadata(&document, &tabs, "custom").unwrap_err();

    assert_eq!(
        error.details.unwrap().validation_code.as_deref(),
        Some("CUSTOM_TAB_DOCUMENT_MISSING")
    );
}

#[test]
fn coordinate_and_dimension_limits_accept_boundary_and_reject_one_past_it() {
    let store = default_editor_store();
    let current = EditorDocumentV1::from_store(&store);
    let mut boundary = current.clone();
    let position = &mut boundary.key_positions.get_mut("4key").unwrap()[0];
    position.dx = MAX_ABS_COORDINATE;
    position.dy = -MAX_ABS_COORDINATE;
    position.width = MAX_DIMENSION;
    position.height = MAX_DIMENSION;
    let mut boundary_store = store.clone();
    boundary.apply_to_store(&mut boundary_store);
    validate_document_transition(&current, &boundary, &store, &boundary_store).unwrap();

    for (name, value) in [
        ("dx", MAX_ABS_COORDINATE + 1.0),
        ("dy", -MAX_ABS_COORDINATE - 1.0),
        ("width", MAX_DIMENSION + 1.0),
        ("height", 0.0),
    ] {
        let mut invalid = current.clone();
        let position = &mut invalid.key_positions.get_mut("4key").unwrap()[0];
        match name {
            "dx" => position.dx = value,
            "dy" => position.dy = value,
            "width" => position.width = value,
            "height" => position.height = value,
            _ => unreachable!(),
        }
        let mut invalid_store = store.clone();
        invalid.apply_to_store(&mut invalid_store);
        assert!(
            validate_document_transition(&current, &invalid, &store, &invalid_store).is_err(),
            "{name}={value} should be rejected"
        );
    }
}

#[test]
fn oversized_coordinate_is_grandfathered_only_when_unchanged_or_decreased() {
    let mut store = default_editor_store();
    store.key_positions.get_mut("4key").unwrap()[0].dx = MAX_ABS_COORDINATE + 2.0;
    let current = EditorDocumentV1::from_store(&store);

    validate_document_transition(&current, &current, &store, &store).unwrap();

    let mut decreased = current.clone();
    decreased.key_positions.get_mut("4key").unwrap()[0].dx = MAX_ABS_COORDINATE + 1.0;
    let mut decreased_store = store.clone();
    decreased.apply_to_store(&mut decreased_store);
    validate_document_transition(&current, &decreased, &store, &decreased_store).unwrap();

    let mut increased = current.clone();
    increased.key_positions.get_mut("4key").unwrap()[0].dx = MAX_ABS_COORDINATE + 3.0;
    let mut increased_store = store.clone();
    increased.apply_to_store(&mut increased_store);
    assert!(validate_document_transition(&current, &increased, &store, &increased_store).is_err());
}

#[test]
fn editor_rejects_new_shadow_violations_in_every_position_collection() {
    let store = store_with_each_position_collection();
    let current = EditorDocumentV1::from_store(&store);

    for (collection, active, property, expected_path) in [
        (
            "keyPositions",
            false,
            "blur",
            "keyPositions 4key[0].shadow.blur",
        ),
        (
            "statPositions",
            true,
            "offsetX",
            "statPositions 4key[0].activeShadow.offsetX",
        ),
        (
            "graphPositions",
            false,
            "offsetY",
            "graphPositions 4key[0].shadow.offsetY",
        ),
        (
            "knobPositions",
            true,
            "color",
            "knobPositions 4key[0].activeShadow.color",
        ),
    ] {
        let mut candidate = current.clone();
        let mut shadow = valid_shadow();
        match property {
            "blur" => shadow.blur = MAX_SHADOW_BLUR + 0.1,
            "offsetX" => shadow.offset_x = MIN_SHADOW_OFFSET - 0.1,
            "offsetY" => shadow.offset_y = MAX_SHADOW_OFFSET + 0.1,
            "color" => shadow.color.clear(),
            _ => unreachable!(),
        }
        let position = position_mut(&mut candidate, collection);
        if active {
            position.active_shadow = Some(shadow);
        } else {
            position.shadow = Some(shadow);
        }
        let mut candidate_store = store.clone();
        candidate.apply_to_store(&mut candidate_store);

        let error = validate_document_transition(&current, &candidate, &store, &candidate_store)
            .unwrap_err();
        assert_eq!(
            error
                .details
                .as_ref()
                .and_then(|details| details.validation_code.as_deref()),
            Some("INVALID_ELEMENT_SHADOW")
        );
        assert!(error.message.contains(expected_path));
    }
}

#[test]
fn existing_shadow_violations_are_grandfathered_only_when_unchanged() {
    let mut store = default_editor_store();
    let position = &mut store.key_positions.get_mut("4key").unwrap()[0];
    let mut shadow = valid_shadow();
    shadow.blur = MAX_SHADOW_BLUR + 1.0;
    position.shadow = Some(shadow);
    let current = EditorDocumentV1::from_store(&store);

    let mut unrelated = current.clone();
    unrelated.key_positions.get_mut("4key").unwrap()[0].font_size = Some(18.0);
    let mut unrelated_store = store.clone();
    unrelated.apply_to_store(&mut unrelated_store);
    validate_document_transition(&current, &unrelated, &store, &unrelated_store).unwrap();

    let mut changed_shadow = current.clone();
    changed_shadow.key_positions.get_mut("4key").unwrap()[0]
        .shadow
        .as_mut()
        .unwrap()
        .blur += 1.0;
    let mut changed_shadow_store = store.clone();
    changed_shadow.apply_to_store(&mut changed_shadow_store);
    let shadow_error =
        validate_document_transition(&current, &changed_shadow, &store, &changed_shadow_store)
            .unwrap_err();
    assert_eq!(
        shadow_error
            .details
            .as_ref()
            .and_then(|details| details.validation_code.as_deref()),
        Some("INVALID_ELEMENT_SHADOW")
    );
}

// 이미지 변환도 그림자와 같은 문서 단위 검증 - 기존 값은 grandfather, 새 범위 밖 값은 거부
#[test]
fn image_transform_violations_are_rejected_unless_grandfathered() {
    let out_of_range = |scale: f64| crate::models::ImageTransform {
        offset_x: 0.0,
        offset_y: 0.0,
        rotation: 0.0,
        scale,
    };
    let mut store = default_editor_store();
    store.key_positions.get_mut("4key").unwrap()[0].idle_image_transform = Some(out_of_range(0.05));
    let current = EditorDocumentV1::from_store(&store);

    let mut unrelated = current.clone();
    unrelated.key_positions.get_mut("4key").unwrap()[0].font_size = Some(18.0);
    let mut unrelated_store = store.clone();
    unrelated.apply_to_store(&mut unrelated_store);
    validate_document_transition(&current, &unrelated, &store, &unrelated_store).unwrap();

    let mut changed = current.clone();
    changed.key_positions.get_mut("4key").unwrap()[0].idle_image_transform =
        Some(out_of_range(0.04));
    let mut changed_store = store.clone();
    changed.apply_to_store(&mut changed_store);
    let error =
        validate_document_transition(&current, &changed, &store, &changed_store).unwrap_err();
    assert_eq!(
        error
            .details
            .as_ref()
            .and_then(|details| details.validation_code.as_deref()),
        Some("INVALID_IMAGE_TRANSFORM")
    );
    assert!(error.message.contains("idleImageTransform.scale"));
}

#[test]
fn stage_four_grandfathering_ignores_diagnostic_message_changes() {
    let key = ViolationKey {
        owner: ViolationOwner::Mode {
            mode: "ghost".to_string(),
        },
        code: "UNKNOWN_MODE",
        property_path: ViolationPropertyPath::Collection("keys"),
        invalid_value: InvalidValueSignature::None,
    };
    let current = [ValidationViolation::new(key.clone(), "same message")]
        .into_iter()
        .map(|violation| violation.key)
        .collect();

    assert!(is_grandfathered(
        &current,
        &ValidationViolation::new(key, "different diagnostic message"),
        &HashMap::new()
    ));
}

#[test]
fn stage_four_stable_id_grandfathers_violation_after_reorder() {
    let mut store = default_editor_store();
    let mut shadow = valid_shadow();
    shadow.blur = MAX_SHADOW_BLUR + 1.0;
    store.key_positions.get_mut("4key").unwrap()[0].shadow = Some(shadow);
    let current = EditorDocumentV1::from_store(&store);

    let mut candidate = current.clone();
    candidate.keys.get_mut("4key").unwrap().swap(0, 1);
    candidate.key_positions.get_mut("4key").unwrap().swap(0, 1);
    let mut candidate_store = store.clone();
    candidate.apply_to_store(&mut candidate_store);

    validate_paired_update(&current, &candidate, true, true).unwrap();
    validate_document_transition(&current, &candidate, &store, &candidate_store).unwrap();
}

#[test]
fn stage_four_native_violation_key_omits_mode_for_same_element() {
    let mut store = store_with_each_position_collection();
    let mut shadow = valid_shadow();
    shadow.blur = MAX_SHADOW_BLUR + 1.0;
    store.stat_positions.get_mut("4key").unwrap()[0]
        .position
        .shadow = Some(shadow);
    let current = EditorDocumentV1::from_store(&store);
    let mut candidate = current.clone();
    let moved = candidate
        .stat_positions
        .get_mut("4key")
        .unwrap()
        .pop()
        .unwrap();
    candidate
        .stat_positions
        .entry("5key".to_string())
        .or_default()
        .push(moved);
    let mut candidate_store = store.clone();
    candidate.apply_to_store(&mut candidate_store);

    validate_document_transition(&current, &candidate, &store, &candidate_store).unwrap();
}

#[test]
fn stage_four_same_violation_on_a_different_id_is_rejected() {
    let mut store = default_editor_store();
    let mut shadow = valid_shadow();
    shadow.blur = MAX_SHADOW_BLUR + 1.0;
    store.key_positions.get_mut("4key").unwrap()[0].shadow = Some(shadow);
    let current = EditorDocumentV1::from_store(&store);
    let mut candidate = current.clone();
    candidate.key_positions.get_mut("4key").unwrap()[0].id = Uuid::new_v4().to_string();
    let mut candidate_store = store.clone();
    candidate.apply_to_store(&mut candidate_store);

    let error =
        validate_document_transition(&current, &candidate, &store, &candidate_store).unwrap_err();
    assert_eq!(
        error.details.unwrap().validation_code.as_deref(),
        Some("INVALID_ELEMENT_SHADOW")
    );
}

#[test]
fn preset_keying_grandfathers_rekeyed_elements_by_mode_and_index() {
    let mut store = default_editor_store();
    store.key_positions.get_mut("4key").unwrap()[0].dx = MAX_ABS_COORDINATE + 1.0;
    let current = EditorDocumentV1::from_store(&store);

    // 프리셋 로드는 검증 전에 모든 요소의 id를 재발급한다 - 값이 그대로여도
    // id 조회로는 관용 대상을 찾을 수 없다
    let mut candidate_store = store.clone();
    crate::state::native_element_id::rekey_store_element_ids(&mut candidate_store);
    let candidate = EditorDocumentV1::from_store(&candidate_store);

    let error =
        validate_document_transition(&current, &candidate, &store, &candidate_store).unwrap_err();
    assert_eq!(
        error.details.unwrap().validation_code.as_deref(),
        Some("COORDINATE_OUT_OF_RANGE")
    );

    validate_document_transition_with_keying(
        &current,
        &candidate,
        &store,
        &candidate_store,
        GrandfatherKeying::ModeIndex,
    )
    .unwrap();
}

#[test]
fn preset_keying_grandfathers_structural_and_label_violations_too() {
    let mut store = default_editor_store();
    // 그림자 위반과 과길이 라벨을 함께 가진 관용 store
    store.key_positions.get_mut("4key").unwrap()[0].shadow = Some(ElementShadowSpec {
        color: String::new(),
        ..valid_shadow()
    });
    store.keys.get_mut("4key").unwrap()[0] = KeySlot::from("x".repeat(MAX_KEY_LABEL_BYTES + 1));
    let current = EditorDocumentV1::from_store(&store);

    let mut candidate_store = store.clone();
    crate::state::native_element_id::rekey_store_element_ids(&mut candidate_store);
    let candidate = EditorDocumentV1::from_store(&candidate_store);

    // ID 기준으로는 관용 상대를 못 찾아 거부된다
    assert!(validate_document_transition(&current, &candidate, &store, &candidate_store).is_err());

    // 자리 기준이면 그림자·라벨 관용이 모두 유지된다
    validate_document_transition_with_keying(
        &current,
        &candidate,
        &store,
        &candidate_store,
        GrandfatherKeying::ModeIndex,
    )
    .unwrap();
}

#[test]
fn preset_keying_still_rejects_newly_raised_metrics() {
    let mut store = default_editor_store();
    store.key_positions.get_mut("4key").unwrap()[0].dx = MAX_ABS_COORDINATE + 1.0;
    let current = EditorDocumentV1::from_store(&store);

    let mut candidate_store = store.clone();
    crate::state::native_element_id::rekey_store_element_ids(&mut candidate_store);
    candidate_store.key_positions.get_mut("4key").unwrap()[1].dx = MAX_ABS_COORDINATE + 1.0;
    let candidate = EditorDocumentV1::from_store(&candidate_store);

    // (mode,index) 관용은 같은 자리의 기존 위반만 물려받는다 - 멀쩡하던
    // 자리가 새로 초과되면 프리셋 경로에서도 거부한다
    let error = validate_document_transition_with_keying(
        &current,
        &candidate,
        &store,
        &candidate_store,
        GrandfatherKeying::ModeIndex,
    )
    .unwrap_err();
    assert_eq!(
        error.details.unwrap().validation_code.as_deref(),
        Some("COORDINATE_OUT_OF_RANGE")
    );
}

#[test]
fn legacy_preset_keying_accepts_finite_historical_bounds_in_every_collection() {
    let store = store_with_each_position_collection();
    let current = EditorDocumentV1::from_store(&store);

    for collection in [
        "keyPositions",
        "statPositions",
        "graphPositions",
        "knobPositions",
    ] {
        let mut candidate = current.clone();
        let position = position_mut(&mut candidate, collection);
        position.dx = MAX_ABS_COORDINATE + 7_232.0;
        position.width = MAX_DIMENSION + 7_232.0;
        let mut candidate_store = store.clone();
        candidate.apply_to_store(&mut candidate_store);
        crate::state::native_element_id::rekey_store_element_ids(&mut candidate_store);
        let candidate = EditorDocumentV1::from_store(&candidate_store);

        let strict = validate_document_transition_with_keying(
            &current,
            &candidate,
            &store,
            &candidate_store,
            GrandfatherKeying::ModeIndex,
        )
        .unwrap_err();
        assert!(matches!(
            strict.details.unwrap().validation_code.as_deref(),
            Some("COORDINATE_OUT_OF_RANGE" | "DIMENSION_OUT_OF_RANGE")
        ));
        validate_document_transition_with_keying(
            &current,
            &candidate,
            &store,
            &candidate_store,
            GrandfatherKeying::LegacyPresetModeIndex,
        )
        .unwrap();
    }

    let mut invalid = current.clone();
    invalid.key_positions.get_mut("4key").unwrap()[0].dx = f64::NAN;
    let mut invalid_store = store.clone();
    invalid.apply_to_store(&mut invalid_store);
    assert!(validate_document_transition_with_keying(
        &current,
        &invalid,
        &store,
        &invalid_store,
        GrandfatherKeying::LegacyPresetModeIndex,
    )
    .is_err());
}

#[test]
fn legacy_preset_keying_still_rejects_non_positive_dimensions() {
    let store = store_with_each_position_collection();
    let current = EditorDocumentV1::from_store(&store);

    for (width, height) in [(0.0, 60.0), (-1.0, 60.0), (60.0, 0.0)] {
        let mut candidate = current.clone();
        let position = position_mut(&mut candidate, "keyPositions");
        position.width = width;
        position.height = height;
        let mut candidate_store = store.clone();
        candidate.apply_to_store(&mut candidate_store);
        crate::state::native_element_id::rekey_store_element_ids(&mut candidate_store);
        let candidate = EditorDocumentV1::from_store(&candidate_store);

        let error = validate_document_transition_with_keying(
            &current,
            &candidate,
            &store,
            &candidate_store,
            GrandfatherKeying::LegacyPresetModeIndex,
        )
        .unwrap_err();
        assert_eq!(
            error.details.unwrap().validation_code.as_deref(),
            Some("DIMENSION_OUT_OF_RANGE")
        );
    }
}

#[test]
fn unconditional_structural_violation_is_rejected_even_when_unchanged() {
    let mut store = default_editor_store();
    store.keys.get_mut("4key").unwrap().pop();
    let document = EditorDocumentV1::from_store(&store);

    let error = validate_document_transition(&document, &document, &store, &store).unwrap_err();
    assert_eq!(
        error.details.unwrap().validation_code.as_deref(),
        Some("KEY_POSITION_LENGTH_MISMATCH")
    );
}

#[test]
fn stage_four_per_owner_limits_follow_stable_ids_across_reorder() {
    let mut label_store = default_editor_store();
    label_store.keys.get_mut("4key").unwrap()[0] =
        KeySlot::from("x".repeat(MAX_KEY_LABEL_BYTES + 1));
    let current_labels = EditorDocumentV1::from_store(&label_store);
    validate_document_transition(&current_labels, &current_labels, &label_store, &label_store)
        .unwrap();

    let mut moved_label = current_labels.clone();
    moved_label.keys.get_mut("4key").unwrap().swap(0, 1);
    moved_label
        .key_positions
        .get_mut("4key")
        .unwrap()
        .swap(0, 1);
    let mut moved_label_store = label_store.clone();
    moved_label.apply_to_store(&mut moved_label_store);
    validate_document_transition(
        &current_labels,
        &moved_label,
        &label_store,
        &moved_label_store,
    )
    .unwrap();

    let mut coordinate_store = default_editor_store();
    coordinate_store.key_positions.get_mut("4key").unwrap()[0].dx = MAX_ABS_COORDINATE + 1.0;
    let current_coordinates = EditorDocumentV1::from_store(&coordinate_store);
    validate_document_transition(
        &current_coordinates,
        &current_coordinates,
        &coordinate_store,
        &coordinate_store,
    )
    .unwrap();

    let mut moved_coordinate = current_coordinates.clone();
    moved_coordinate
        .key_positions
        .get_mut("4key")
        .unwrap()
        .swap(0, 1);
    moved_coordinate.keys.get_mut("4key").unwrap().swap(0, 1);
    let mut moved_coordinate_store = coordinate_store.clone();
    moved_coordinate.apply_to_store(&mut moved_coordinate_store);
    validate_document_transition(
        &current_coordinates,
        &moved_coordinate,
        &coordinate_store,
        &moved_coordinate_store,
    )
    .unwrap();
}

#[test]
fn stage_four_new_element_has_no_metric_allowance() {
    let store = default_editor_store();
    let current = EditorDocumentV1::from_store(&store);
    let mut candidate = current.clone();
    candidate
        .keys
        .get_mut("4key")
        .unwrap()
        .push(KeySlot::from("NEW"));
    candidate
        .key_positions
        .get_mut("4key")
        .unwrap()
        .push(KeyPosition {
            id: Uuid::new_v4().to_string(),
            dx: MAX_ABS_COORDINATE + 1.0,
            ..KeyPosition::default()
        });
    let mut candidate_store = store.clone();
    candidate.apply_to_store(&mut candidate_store);

    let error =
        validate_document_transition(&current, &candidate, &store, &candidate_store).unwrap_err();
    assert_eq!(
        error.details.unwrap().validation_code.as_deref(),
        Some("COORDINATE_OUT_OF_RANGE")
    );
}

#[test]
fn stage_four_deleted_element_is_excluded_from_per_owner_comparison() {
    let mut store = default_editor_store();
    store.key_positions.get_mut("4key").unwrap()[0].dx = MAX_ABS_COORDINATE + 1.0;
    let current = EditorDocumentV1::from_store(&store);
    let deleted_id = current.key_positions["4key"][0].id.clone();
    let mut candidate = current.clone();
    candidate.keys.get_mut("4key").unwrap().remove(0);
    candidate.key_positions.get_mut("4key").unwrap().remove(0);
    let mut candidate_store = store.clone();
    candidate.apply_to_store(&mut candidate_store);

    validate_document_transition(&current, &candidate, &store, &candidate_store).unwrap();
    assert!(candidate.key_positions["4key"]
        .iter()
        .all(|position| position.id != deleted_id));
}

#[test]
fn stage_four_multi_key_label_allowances_are_consumed_once() {
    let mut store = default_editor_store();
    store.keys.get_mut("4key").unwrap()[0] = KeySlot::Multi {
        keys: vec![
            "x".repeat(MAX_KEY_LABEL_BYTES + 100),
            "y".repeat(MAX_KEY_LABEL_BYTES + 200),
        ],
        match_mode: crate::models::SlotMatch::Any,
    };
    let current = EditorDocumentV1::from_store(&store);

    let mut non_increasing = current.clone();
    non_increasing.keys.get_mut("4key").unwrap()[0] = KeySlot::Multi {
        keys: vec![
            "a".repeat(MAX_KEY_LABEL_BYTES + 150),
            "b".repeat(MAX_KEY_LABEL_BYTES + 50),
        ],
        match_mode: crate::models::SlotMatch::Any,
    };
    let mut non_increasing_store = store.clone();
    non_increasing.apply_to_store(&mut non_increasing_store);
    validate_document_transition(&current, &non_increasing, &store, &non_increasing_store).unwrap();

    let mut duplicated_allowance = non_increasing.clone();
    let KeySlot::Multi { keys, .. } = &mut duplicated_allowance.keys.get_mut("4key").unwrap()[0]
    else {
        unreachable!()
    };
    keys.push("c".repeat(MAX_KEY_LABEL_BYTES + 25));
    let mut duplicated_store = store.clone();
    duplicated_allowance.apply_to_store(&mut duplicated_store);
    let error =
        validate_document_transition(&current, &duplicated_allowance, &store, &duplicated_store)
            .unwrap_err();
    assert_eq!(
        error.details.unwrap().validation_code.as_deref(),
        Some("KEY_LABEL_TOO_LONG")
    );
}

#[test]
fn stage_four_group_name_limit_follows_group_id_after_reorder() {
    let mut store = default_editor_store();
    store.layer_groups.insert(
        "4key".to_string(),
        vec![
            LayerGroupDef {
                id: "oversized".to_string(),
                name: "x".repeat(MAX_GROUP_NAME_BYTES + 1),
            },
            LayerGroupDef {
                id: "normal".to_string(),
                name: "Normal".to_string(),
            },
        ],
    );
    let current = EditorDocumentV1::from_store(&store);
    let mut reordered = current.clone();
    reordered.layer_groups.get_mut("4key").unwrap().swap(0, 1);
    let mut reordered_store = store.clone();
    reordered.apply_to_store(&mut reordered_store);
    validate_document_transition(&current, &reordered, &store, &reordered_store).unwrap();

    let mut changed_id = reordered;
    changed_id.layer_groups.get_mut("4key").unwrap()[1].id = "new-id".to_string();
    let mut changed_id_store = store.clone();
    changed_id.apply_to_store(&mut changed_id_store);
    let error =
        validate_document_transition(&current, &changed_id, &store, &changed_id_store).unwrap_err();
    assert_eq!(
        error.details.unwrap().validation_code.as_deref(),
        Some("GROUP_NAME_TOO_LONG")
    );
}

#[test]
fn aggregate_render_limit_compares_total_candidate_and_current_counts() {
    let mut store = store_with_custom_modes(8);
    for index in 0..8 {
        let mode = format!("custom-{index}");
        store
            .keys
            .insert(mode.clone(), vec![KeySlot::default(); 512]);
        store
            .key_positions
            .insert(mode, vec![KeyPosition::default(); 512]);
    }
    store.stat_positions.insert(
        "custom-0".to_string(),
        vec![
            StatPosition {
                stat_type: StatType::Kps,
                position: KeyPosition::default(),
            };
            2
        ],
    );
    let current = EditorDocumentV1::from_store(&store);

    let mut same_total = current.clone();
    same_total.stat_positions.get_mut("custom-0").unwrap().pop();
    same_total.graph_positions.insert(
        "custom-0".to_string(),
        vec![GraphPosition {
            stat_type: GraphStatType::Kps,
            graph_type: GraphType::Line,
            graph_speed: 100,
            graph_color: "#123456".to_string(),
            show_avg_line: true,
            position: KeyPosition::default(),
        }],
    );
    let mut same_total_store = store.clone();
    same_total.apply_to_store(&mut same_total_store);
    validate_document_transition(&current, &same_total, &store, &same_total_store).unwrap();

    let mut increased = same_total.clone();
    increased
        .stat_positions
        .get_mut("custom-0")
        .unwrap()
        .push(StatPosition {
            stat_type: StatType::Kps,
            position: KeyPosition::default(),
        });
    let mut increased_store = same_total_store.clone();
    increased.apply_to_store(&mut increased_store);
    let error =
        validate_document_transition(&current, &increased, &store, &increased_store).unwrap_err();
    assert_eq!(
        error.details.unwrap().validation_code.as_deref(),
        Some("TOO_MANY_RENDER_ITEMS")
    );
}

#[test]
fn violation_categories_keep_their_existing_grandfathering_decisions() {
    let mut mode_store = AppStoreData::default();
    mode_store
        .keys
        .insert("ghost".to_string(), vec![KeySlot::from("A")]);
    mode_store
        .key_positions
        .insert("ghost".to_string(), vec![KeyPosition::default()]);
    let mode_document = EditorDocumentV1::from_store(&mode_store);
    validate_document_transition(&mode_document, &mode_document, &mode_store, &mode_store).unwrap();

    let mut pair_store = default_editor_store();
    pair_store.keys.get_mut("4key").unwrap().pop();
    let pair_document = EditorDocumentV1::from_store(&pair_store);
    let pair_error =
        validate_document_transition(&pair_document, &pair_document, &pair_store, &pair_store)
            .unwrap_err();
    assert_eq!(
        pair_error.details.unwrap().validation_code.as_deref(),
        Some("KEY_POSITION_LENGTH_MISMATCH")
    );

    let mut group_store = default_editor_store();
    group_store.layer_groups.insert(
        "4key".to_string(),
        vec![LayerGroupDef {
            id: String::new(),
            name: "Group".to_string(),
        }],
    );
    let group_document = EditorDocumentV1::from_store(&group_store);
    validate_document_transition(&group_document, &group_document, &group_store, &group_store)
        .unwrap();

    let mut element_store = default_editor_store();
    let mut shadow = valid_shadow();
    shadow.blur = MAX_SHADOW_BLUR + 1.0;
    element_store.key_positions.get_mut("4key").unwrap()[0].shadow = Some(shadow);
    let element_document = EditorDocumentV1::from_store(&element_store);
    validate_document_transition(
        &element_document,
        &element_document,
        &element_store,
        &element_store,
    )
    .unwrap();
}

#[test]
fn oversized_per_mode_collection_is_grandfathered_only_when_non_increasing() {
    let mut store = store_with_custom_modes(1);
    store.keys.insert(
        "custom-0".to_string(),
        (0..514)
            .map(|index| KeySlot::from(format!("Key{index}")))
            .collect(),
    );
    store
        .key_positions
        .insert("custom-0".to_string(), vec![KeyPosition::default(); 514]);
    let current = EditorDocumentV1::from_store(&store);
    validate_document_transition(&current, &current, &store, &store).unwrap();

    let mut decreased = current.clone();
    decreased.keys.get_mut("custom-0").unwrap().pop();
    decreased.key_positions.get_mut("custom-0").unwrap().pop();
    let mut decreased_store = store.clone();
    decreased.apply_to_store(&mut decreased_store);
    validate_document_transition(&current, &decreased, &store, &decreased_store).unwrap();

    let mut increased = current.clone();
    increased
        .keys
        .get_mut("custom-0")
        .unwrap()
        .push(KeySlot::from("Extra"));
    increased
        .key_positions
        .get_mut("custom-0")
        .unwrap()
        .push(KeyPosition::default());
    let mut increased_store = store.clone();
    increased.apply_to_store(&mut increased_store);
    assert!(validate_document_transition(&current, &increased, &store, &increased_store).is_err());
}

#[test]
fn oversized_mode_count_is_grandfathered_only_when_non_increasing() {
    let mut store = store_with_custom_modes(65);
    for index in 0..65 {
        store.keys.insert(format!("custom-{index}"), Vec::new());
        store
            .key_positions
            .insert(format!("custom-{index}"), Vec::new());
    }
    let current = EditorDocumentV1::from_store(&store);
    validate_document_transition(&current, &current, &store, &store).unwrap();

    let mut decreased = current.clone();
    decreased.keys.remove("custom-64");
    decreased.key_positions.remove("custom-64");
    let mut decreased_store = store.clone();
    decreased.apply_to_store(&mut decreased_store);
    validate_document_transition(&current, &decreased, &store, &decreased_store).unwrap();

    let mut increased_store = store.clone();
    increased_store.custom_tabs.push(CustomTab {
        id: "custom-65".to_string(),
        name: "Custom 65".to_string(),
    });
    let mut increased = current.clone();
    increased.keys.insert("custom-65".to_string(), Vec::new());
    increased
        .key_positions
        .insert("custom-65".to_string(), Vec::new());
    increased.apply_to_store(&mut increased_store);
    assert!(validate_document_transition(&current, &increased, &store, &increased_store).is_err());
}

#[test]
fn count_limits_accept_exact_boundaries_and_reject_boundary_plus_one() {
    let mode_store = store_with_custom_modes(65);
    let empty = EditorDocumentV1::from_store(&mode_store);
    let mut modes_at_limit = empty.clone();
    for index in 0..64 {
        modes_at_limit
            .keys
            .insert(format!("custom-{index}"), Vec::new());
        modes_at_limit
            .key_positions
            .insert(format!("custom-{index}"), Vec::new());
    }
    let mut modes_at_limit_store = mode_store.clone();
    modes_at_limit.apply_to_store(&mut modes_at_limit_store);
    validate_document_transition(&empty, &modes_at_limit, &mode_store, &modes_at_limit_store)
        .unwrap();
    let mut too_many_modes = modes_at_limit.clone();
    too_many_modes
        .keys
        .insert("custom-64".to_string(), Vec::new());
    too_many_modes
        .key_positions
        .insert("custom-64".to_string(), Vec::new());
    let mut too_many_modes_store = mode_store.clone();
    too_many_modes.apply_to_store(&mut too_many_modes_store);
    assert!(validate_document_transition(
        &empty,
        &too_many_modes,
        &mode_store,
        &too_many_modes_store,
    )
    .is_err());

    let collection_store = store_with_custom_modes(1);
    let collection_empty = EditorDocumentV1::from_store(&collection_store);
    let mut collection_at_limit = collection_empty.clone();
    collection_at_limit.keys.insert(
        "custom-0".to_string(),
        (0..512)
            .map(|index| KeySlot::from(format!("Key{index}")))
            .collect(),
    );
    collection_at_limit
        .key_positions
        .insert("custom-0".to_string(), vec![KeyPosition::default(); 512]);
    let mut collection_at_limit_store = collection_store.clone();
    collection_at_limit.apply_to_store(&mut collection_at_limit_store);
    validate_document_transition(
        &collection_empty,
        &collection_at_limit,
        &collection_store,
        &collection_at_limit_store,
    )
    .unwrap();
    let mut collection_too_large = collection_at_limit.clone();
    collection_too_large
        .keys
        .get_mut("custom-0")
        .unwrap()
        .push(KeySlot::from("Extra"));
    collection_too_large
        .key_positions
        .get_mut("custom-0")
        .unwrap()
        .push(KeyPosition::default());
    let mut collection_too_large_store = collection_store.clone();
    collection_too_large.apply_to_store(&mut collection_too_large_store);
    assert!(validate_document_transition(
        &collection_empty,
        &collection_too_large,
        &collection_store,
        &collection_too_large_store,
    )
    .is_err());

    let render_store = store_with_custom_modes(8);
    let render_empty = EditorDocumentV1::from_store(&render_store);
    let mut render_at_limit = render_empty.clone();
    for index in 0..8 {
        let mode = format!("custom-{index}");
        render_at_limit
            .keys
            .insert(mode.clone(), vec![KeySlot::default(); 512]);
        render_at_limit
            .key_positions
            .insert(mode, vec![KeyPosition::default(); 512]);
    }
    let mut render_at_limit_store = render_store.clone();
    render_at_limit.apply_to_store(&mut render_at_limit_store);
    validate_document_transition(
        &render_empty,
        &render_at_limit,
        &render_store,
        &render_at_limit_store,
    )
    .unwrap();
    let mut too_many_render_items = render_at_limit.clone();
    too_many_render_items.stat_positions.insert(
        "custom-0".to_string(),
        vec![StatPosition {
            stat_type: StatType::Kps,
            position: KeyPosition::default(),
        }],
    );
    let mut too_many_render_items_store = render_store.clone();
    too_many_render_items.apply_to_store(&mut too_many_render_items_store);
    assert!(validate_document_transition(
        &render_empty,
        &too_many_render_items,
        &render_store,
        &too_many_render_items_store,
    )
    .is_err());

    let group_store = store_with_custom_modes(9);
    let group_empty = EditorDocumentV1::from_store(&group_store);
    let mut groups_at_limit = group_empty.clone();
    for index in 0..8 {
        groups_at_limit.layer_groups.insert(
            format!("custom-{index}"),
            (0..512)
                .map(|group| LayerGroupDef {
                    id: format!("g-{index}-{group}"),
                    name: "Group".to_string(),
                })
                .collect(),
        );
    }
    let mut groups_at_limit_store = group_store.clone();
    groups_at_limit.apply_to_store(&mut groups_at_limit_store);
    validate_document_transition(
        &group_empty,
        &groups_at_limit,
        &group_store,
        &groups_at_limit_store,
    )
    .unwrap();
    let mut too_many_groups = groups_at_limit.clone();
    too_many_groups.layer_groups.insert(
        "custom-8".to_string(),
        vec![LayerGroupDef {
            id: "extra-group".to_string(),
            name: "Group".to_string(),
        }],
    );
    let mut too_many_groups_store = group_store.clone();
    too_many_groups.apply_to_store(&mut too_many_groups_store);
    assert!(validate_document_transition(
        &group_empty,
        &too_many_groups,
        &group_store,
        &too_many_groups_store,
    )
    .is_err());
}

#[test]
fn revision_and_request_id_wire_limits_are_enforced() {
    assert!(validate_revision(MAX_SAFE_WIRE_REVISION).is_ok());
    assert!(validate_revision(MAX_SAFE_WIRE_REVISION + 1).is_err());
    assert!(next_revision(MAX_SAFE_WIRE_REVISION).is_err());

    let invalid = EditorCommitRequest {
        base_revision: 0,
        mutation_id: "not-a-uuid".to_string(),
        multi_key: false,
        gesture_id: None,
        gesture_ids: Vec::new(),
        changes: Some(EditorPatchV1::default()),
        ops_version: None,
        ops: None,
    };
    assert!(validate_request_envelope(&invalid).is_err());

    let mut oversized_gesture = request(KeyMappings::new());
    oversized_gesture.gesture_id = Some("가".repeat(22));
    assert_eq!(oversized_gesture.gesture_id.as_ref().unwrap().len(), 66);
    assert!(validate_request_envelope(&oversized_gesture).is_err());

    let mut oversized_merged_gesture = request(KeyMappings::new());
    oversized_merged_gesture.gesture_ids = vec!["가".repeat(22)];
    assert!(validate_request_envelope(&oversized_merged_gesture).is_err());

    let mut malformed_gesture = request(KeyMappings::new());
    malformed_gesture.gesture_ids = vec!["not-a-uuid".to_string()];
    let malformed_error = validate_request_envelope(&malformed_gesture).unwrap_err();
    assert_eq!(
        malformed_error.error_code,
        crate::errors::EditorCommitErrorCode::InvalidGestureId
    );
    assert!(!malformed_error.retryable);

    let mut too_many_gestures = request(KeyMappings::new());
    too_many_gestures.gesture_ids = (0..=MAX_GESTURE_IDS)
        .map(|index| Uuid::from_u128(index as u128 + 1).to_string())
        .collect();
    let count_error = validate_request_envelope(&too_many_gestures).unwrap_err();
    assert_eq!(
        count_error.error_code,
        crate::errors::EditorCommitErrorCode::TooManyGestureIds
    );
    assert!(!count_error.retryable);

    let mut representative_overflow = request(KeyMappings::new());
    representative_overflow.gesture_ids = (0..MAX_GESTURE_IDS)
        .map(|index| Uuid::from_u128(index as u128 + 1).to_string())
        .collect();
    representative_overflow.gesture_id = Some(Uuid::from_u128(u128::MAX).to_string());
    assert!(validate_request_envelope(&representative_overflow).is_err());
}

#[test]
fn oversized_render_and_group_totals_only_allow_non_increasing_changes() {
    let mut render_store = store_with_custom_modes(8);
    for index in 0..8 {
        let mode = format!("custom-{index}");
        render_store
            .keys
            .insert(mode.clone(), vec![KeySlot::default(); 512]);
        render_store
            .key_positions
            .insert(mode, vec![KeyPosition::default(); 512]);
    }
    render_store.stat_positions.insert(
        "custom-0".to_string(),
        vec![
            StatPosition {
                stat_type: StatType::Kps,
                position: KeyPosition::default(),
            };
            2
        ],
    );
    let current_render = EditorDocumentV1::from_store(&render_store);
    validate_document_transition(
        &current_render,
        &current_render,
        &render_store,
        &render_store,
    )
    .unwrap();
    let mut less_render = current_render.clone();
    less_render
        .stat_positions
        .get_mut("custom-0")
        .unwrap()
        .pop();
    let mut less_render_store = render_store.clone();
    less_render.apply_to_store(&mut less_render_store);
    validate_document_transition(
        &current_render,
        &less_render,
        &render_store,
        &less_render_store,
    )
    .unwrap();
    let mut more_render = current_render.clone();
    more_render
        .stat_positions
        .get_mut("custom-0")
        .unwrap()
        .push(StatPosition {
            stat_type: StatType::Kps,
            position: KeyPosition::default(),
        });
    let mut more_render_store = render_store.clone();
    more_render.apply_to_store(&mut more_render_store);
    assert!(validate_document_transition(
        &current_render,
        &more_render,
        &render_store,
        &more_render_store,
    )
    .is_err());

    let mut group_store = store_with_custom_modes(9);
    for index in 0..8 {
        group_store.layer_groups.insert(
            format!("custom-{index}"),
            (0..512)
                .map(|group| LayerGroupDef {
                    id: format!("g-{index}-{group}"),
                    name: "Group".to_string(),
                })
                .collect(),
        );
    }
    group_store.layer_groups.insert(
        "custom-8".to_string(),
        vec![
            LayerGroupDef {
                id: "g-8-0".to_string(),
                name: "Group".to_string(),
            },
            LayerGroupDef {
                id: "g-8-1".to_string(),
                name: "Group".to_string(),
            },
        ],
    );
    let current_groups = EditorDocumentV1::from_store(&group_store);
    validate_document_transition(&current_groups, &current_groups, &group_store, &group_store)
        .unwrap();
    let mut less_groups = current_groups.clone();
    less_groups.layer_groups.get_mut("custom-8").unwrap().pop();
    let mut less_group_store = group_store.clone();
    less_groups.apply_to_store(&mut less_group_store);
    validate_document_transition(
        &current_groups,
        &less_groups,
        &group_store,
        &less_group_store,
    )
    .unwrap();
    let mut more_groups = current_groups.clone();
    more_groups
        .layer_groups
        .get_mut("custom-8")
        .unwrap()
        .push(LayerGroupDef {
            id: "g-8-2".to_string(),
            name: "Group".to_string(),
        });
    let mut more_group_store = group_store.clone();
    more_groups.apply_to_store(&mut more_group_store);
    assert!(validate_document_transition(
        &current_groups,
        &more_groups,
        &group_store,
        &more_group_store,
    )
    .is_err());
}

#[test]
fn pair_violations_stay_unconditional_but_group_references_follow_element_ids() {
    let mut pair_store = default_editor_store();
    pair_store.keys.get_mut("4key").unwrap().pop();
    let pair_document = EditorDocumentV1::from_store(&pair_store);
    assert!(
        validate_document_transition(&pair_document, &pair_document, &pair_store, &pair_store,)
            .is_err()
    );

    let mut reference_store = default_editor_store();
    reference_store.key_positions.get_mut("4key").unwrap()[0].group_id =
        Some("missing".to_string());
    let reference_document = EditorDocumentV1::from_store(&reference_store);
    let mut reordered_reference = reference_document.clone();
    reordered_reference.keys.get_mut("4key").unwrap().swap(0, 1);
    reordered_reference
        .key_positions
        .get_mut("4key")
        .unwrap()
        .swap(0, 1);
    let mut reordered_store = reference_store.clone();
    reordered_reference.apply_to_store(&mut reordered_store);
    assert!(validate_document_transition(
        &reference_document,
        &reordered_reference,
        &reference_store,
        &reordered_store,
    )
    .is_ok());
}

#[test]
fn compact_request_size_boundaries_are_exact() {
    fn sized_request(target_bytes: usize) -> EditorCommitRequest {
        let mut empty_keys = KeyMappings::new();
        empty_keys.insert("4key".to_string(), vec![KeySlot::default()]);
        let empty = request(empty_keys);
        let overhead = serde_json::to_vec(&empty).unwrap().len();
        assert!(target_bytes >= overhead);

        let mut keys = KeyMappings::new();
        keys.insert(
            "4key".to_string(),
            vec![KeySlot::from("x".repeat(target_bytes - overhead))],
        );
        let request = EditorCommitRequest {
            mutation_id: empty.mutation_id,
            ..request(keys)
        };
        assert_eq!(serde_json::to_vec(&request).unwrap().len(), target_bytes);
        request
    }

    assert_eq!(
        request_payload_size(&sized_request(REQUEST_WARNING_BYTES - 1)).unwrap(),
        REQUEST_WARNING_BYTES - 1
    );
    assert_eq!(
        request_payload_size(&sized_request(REQUEST_WARNING_BYTES)).unwrap(),
        REQUEST_WARNING_BYTES
    );
    assert_eq!(
        request_payload_size(&sized_request(MAX_REQUEST_BYTES)).unwrap(),
        MAX_REQUEST_BYTES
    );
    let error = request_payload_size(&sized_request(MAX_REQUEST_BYTES + 1)).unwrap_err();
    assert_eq!(
        error.details.unwrap().validation_code.as_deref(),
        Some("REQUEST_TOO_LARGE")
    );
}
