use super::{
    compact_canonical_rgba, key_mappings_contain_multi, normalize_key_mappings, normalize_key_slot,
    note_border_representative_hex, scrub_removed_text_outline_fields, FadePosition, GradientSpec,
    GraphPosition, GraphStatType, GraphType, ImageTransform, KeyCounterAlign, KeyCounterAlignMode,
    KeyCounterColor, KeyCounterPlacement, KeyCounterSettings, KeyMappings, KeyPosition, KeySlot,
    KnobPosition, NoteAlignment, NoteColor, NoteSettings, SlotMatch, StatPosition, StatType,
    MAX_SLOT_KEYS, POSITION_COLLECTION_FIELDS,
};
use serde::Deserialize;

const NOTE_BORDER_STOP_COLOR_FIXTURE: &str =
    include_str!("../../../tests/fixtures/note-border-stop-colors.json");

#[derive(Deserialize)]
struct NoteBorderStopColorFixture {
    valid: Vec<ValidNoteBorderStopColor>,
    invalid: Vec<String>,
}

#[derive(Deserialize)]
struct ValidNoteBorderStopColor {
    input: String,
    representative: String,
}

#[test]
fn legacy_string_key_mappings_round_trip_without_loss() {
    let raw = serde_json::json!({
        "4key": ["A", "A+B", "+", ""]
    });

    let mappings: KeyMappings = serde_json::from_value(raw.clone()).unwrap();

    assert_eq!(serde_json::to_value(mappings).unwrap(), raw);
}

#[test]
fn legacy_700_weights_migrate_to_400_with_bold_modifier() {
    let mut raw = serde_json::to_value(KeyPosition::default()).unwrap();
    let object = raw.as_object_mut().unwrap();
    object.insert("fontWeight".to_string(), serde_json::json!(700));
    object.remove("fontBold");
    let counter = object["counter"].as_object_mut().unwrap();
    counter.insert("fontWeight".to_string(), serde_json::json!(700));
    counter.remove("fontBold");

    let mut position: KeyPosition = serde_json::from_value(raw).unwrap();
    assert!(position.migrate_legacy_font_weight());
    assert_eq!(position.font_weight, Some(400));
    assert_eq!(position.font_bold, Some(true));
    assert_eq!(position.counter.font_weight, 400);
    assert_eq!(position.counter.font_bold, Some(true));
    assert!(!position.migrate_legacy_font_weight());
}

#[test]
fn legacy_non_bold_weights_remain_sparse() {
    let mut raw = serde_json::to_value(KeyPosition::default()).unwrap();
    let object = raw.as_object_mut().unwrap();
    object.insert("fontWeight".to_string(), serde_json::json!(600));
    object.remove("fontBold");
    let counter = object["counter"].as_object_mut().unwrap();
    counter.insert("fontWeight".to_string(), serde_json::json!(500));
    counter.remove("fontBold");

    let mut position: KeyPosition = serde_json::from_value(raw).unwrap();
    assert!(!position.migrate_legacy_font_weight());
    assert_eq!(position.font_weight, Some(600));
    assert_eq!(position.font_bold, None);
    assert_eq!(position.counter.font_weight, 500);
    assert_eq!(position.counter.font_bold, None);
}

#[test]
fn element_id_defaults_to_empty_and_flattens_into_every_position_type() {
    let id = uuid::Uuid::new_v4().to_string();
    let position = KeyPosition {
        id: id.clone(),
        ..KeyPosition::default()
    };
    let mut values = [
        serde_json::to_value(&position).unwrap(),
        serde_json::to_value(StatPosition {
            stat_type: StatType::Kps,
            position: position.clone(),
        })
        .unwrap(),
        serde_json::to_value(GraphPosition {
            stat_type: GraphStatType::Kps,
            graph_type: GraphType::Line,
            graph_speed: 100,
            graph_color: "#123456".to_string(),
            show_avg_line: true,
            position: position.clone(),
        })
        .unwrap(),
        serde_json::to_value(KnobPosition {
            axis_id: "axis".to_string(),
            sensitivity: 1.0,
            reverse: false,
            position,
        })
        .unwrap(),
    ];

    assert!(values.iter().all(|value| value["id"] == id));
    for value in &mut values {
        value.as_object_mut().unwrap().remove("id");
    }
    let stat: StatPosition = serde_json::from_value(values[1].clone()).unwrap();
    let graph: GraphPosition = serde_json::from_value(values[2].clone()).unwrap();
    let knob: KnobPosition = serde_json::from_value(values[3].clone()).unwrap();
    assert!(stat.position.id.is_empty());
    assert!(graph.position.id.is_empty());
    assert!(knob.position.id.is_empty());

    let missing: KeyPosition = serde_json::from_value(serde_json::json!({
        "dx": 0,
        "dy": 0,
        "width": 60,
        "count": 0
    }))
    .unwrap();
    assert!(missing.id.is_empty());
}

#[test]
fn position_wrappers_preserve_legacy_missing_field_defaults_and_round_trip() {
    let base = serde_json::json!({
        "dx": 1,
        "dy": 2,
        "width": 60,
        "count": 3
    });
    let mut stat_value = base.clone();
    stat_value["statType"] = serde_json::json!("kpsAvg");
    let stat: StatPosition = serde_json::from_value(stat_value).unwrap();

    let mut graph_value = base.clone();
    graph_value["statType"] = serde_json::json!("total");
    graph_value["graphType"] = serde_json::json!("bar");
    graph_value["graphSpeed"] = serde_json::json!(120);
    graph_value["graphColor"] = serde_json::json!("#123456");
    let graph: GraphPosition = serde_json::from_value(graph_value).unwrap();

    let knob: KnobPosition = serde_json::from_value(base).unwrap();

    assert!(graph.show_avg_line);
    assert!(knob.axis_id.is_empty());
    assert_eq!(knob.sensitivity, 1.0);
    assert!(!knob.reverse);
    assert_eq!(
        serde_json::from_value::<StatPosition>(serde_json::to_value(&stat).unwrap()).unwrap(),
        stat
    );
    assert_eq!(
        serde_json::from_value::<GraphPosition>(serde_json::to_value(&graph).unwrap()).unwrap(),
        graph
    );
    assert_eq!(
        serde_json::from_value::<KnobPosition>(serde_json::to_value(&knob).unwrap()).unwrap(),
        knob
    );
}

#[test]
fn position_serialization_field_order_and_related_defaults_are_stable() {
    let position = KeyPosition::default();
    assert!(serde_json::to_string(&position).unwrap().starts_with(
        r#"{"dx":0.0,"dy":0.0,"width":60.0,"height":60.0,"hidden":false,"activeImage":null"#
    ));
    assert!(serde_json::to_string(&StatPosition {
        stat_type: StatType::Kps,
        position: position.clone(),
    })
    .unwrap()
    .starts_with(r#"{"statType":"kps","dx":0.0,"dy":0.0,"width":60.0"#));
    assert!(serde_json::to_string(&GraphPosition {
        stat_type: GraphStatType::KpsAvg,
        graph_type: GraphType::Bar,
        graph_speed: 120,
        graph_color: "#123456".to_string(),
        show_avg_line: false,
        position: position.clone(),
    })
    .unwrap()
    .starts_with(
        r##"{"statType":"kpsAvg","graphType":"bar","graphSpeed":120,"graphColor":"#123456","showAvgLine":false,"dx":0.0"##
    ));
    assert!(serde_json::to_string(&KnobPosition {
        axis_id: "axis".to_string(),
        sensitivity: 2.5,
        reverse: true,
        position,
    })
    .unwrap()
    .starts_with(r#"{"axisId":"axis","sensitivity":2.5,"reverse":true,"dx":0.0"#));
    assert_eq!(
        serde_json::to_string(&ImageTransform::default()).unwrap(),
        r#"{"offsetX":0.0,"offsetY":0.0,"rotation":0.0,"scale":1.0}"#
    );
    assert_eq!(NoteAlignment::default(), NoteAlignment::Center);
}

#[test]
fn new_surface_gradients_flatten_into_every_position_collection() {
    let position = KeyPosition {
        note_border_gradient: serde_json::from_value(serde_json::json!({
            "angle": 90,
            "stops": [
                { "color": "#112233", "pos": 0 },
                { "color": "#445566", "pos": 1 }
            ]
        }))
        .unwrap(),
        font_gradient: serde_json::from_value(serde_json::json!({
            "angle": 45,
            "stops": [
                { "color": "#556677", "pos": 0 },
                { "color": "#8899AA", "pos": 1 }
            ]
        }))
        .unwrap(),
        active_font_gradient: serde_json::from_value(serde_json::json!({
            "angle": 135,
            "stops": [
                { "color": "#AABBCC", "pos": 0 },
                { "color": "#DDEEFF", "pos": 1 }
            ]
        }))
        .unwrap(),
        ..KeyPosition::default()
    };
    let values = [
        serde_json::to_value(&position).unwrap(),
        serde_json::to_value(StatPosition {
            stat_type: StatType::Kps,
            position: position.clone(),
        })
        .unwrap(),
        serde_json::to_value(GraphPosition {
            stat_type: GraphStatType::Kps,
            graph_type: GraphType::Line,
            graph_speed: 100,
            graph_color: "#123456".to_string(),
            show_avg_line: true,
            position: position.clone(),
        })
        .unwrap(),
        serde_json::to_value(KnobPosition {
            axis_id: "axis".to_string(),
            sensitivity: 1.0,
            reverse: false,
            position,
        })
        .unwrap(),
    ];

    for value in values {
        assert_eq!(value["noteBorderGradient"]["angle"], 90.0);
        assert_eq!(value["fontGradient"]["angle"], 45.0);
        assert_eq!(value["activeFontGradient"]["angle"], 135.0);
    }
}

#[test]
fn multi_key_slot_wire_shape_and_canonical_are_stable() {
    let raw = serde_json::json!({ "keys": ["LEFT CTRL", "Z"], "match": "all" });

    let slot: KeySlot = serde_json::from_value(raw.clone()).unwrap();

    assert_eq!(
        slot,
        KeySlot::Multi {
            keys: vec!["LEFT CTRL".to_string(), "Z".to_string()],
            match_mode: SlotMatch::All,
        }
    );
    assert_eq!(slot.canonical(), "LEFT CTRL+Z");
    assert_eq!(serde_json::to_value(slot).unwrap(), raw);
}

#[test]
fn malformed_key_slots_normalize_without_deserialization_failure() {
    let too_many = (0..=MAX_SLOT_KEYS)
        .map(|index| serde_json::Value::String(format!("K{index}")))
        .collect::<Vec<_>>();
    let cases = [
        (serde_json::json!({ "keys": ["Z"] }), KeySlot::default()),
        (
            serde_json::json!({
                "keys": ["A", 7, "", "A", "B+C", "D|E", "B"],
                "match": "any",
                "ignored": true
            }),
            KeySlot::Multi {
                keys: vec!["A".to_string(), "B".to_string()],
                match_mode: SlotMatch::Any,
            },
        ),
        (
            serde_json::json!({ "keys": ["Z"], "match": "all" }),
            KeySlot::Single("Z".to_string()),
        ),
        (
            serde_json::json!({ "keys": [], "match": "any" }),
            KeySlot::default(),
        ),
        (
            serde_json::json!({ "keys": too_many, "match": "any" }),
            KeySlot::Multi {
                keys: (0..MAX_SLOT_KEYS)
                    .map(|index| format!("K{index}"))
                    .collect(),
                match_mode: SlotMatch::Any,
            },
        ),
        (serde_json::json!(42), KeySlot::default()),
        (serde_json::json!(["A", "B"]), KeySlot::default()),
        (serde_json::Value::Null, KeySlot::default()),
    ];

    for (raw, expected) in cases {
        let slot: KeySlot = serde_json::from_value(raw).unwrap();
        assert_eq!(slot, expected);
    }
}

#[test]
fn key_slot_wire_order_and_invalid_match_fallback_are_stable() {
    let slot = KeySlot::Multi {
        keys: vec!["A".to_string(), "B".to_string()],
        match_mode: SlotMatch::Any,
    };
    assert_eq!(
        serde_json::to_string(&slot).unwrap(),
        r#"{"keys":["A","B"],"match":"any"}"#
    );

    for raw in [
        serde_json::json!({ "keys": ["A", "B"], "match": "ALL" }),
        serde_json::json!({ "keys": ["A", "B"], "match": null }),
        serde_json::json!({ "keys": ["A", "B"] }),
    ] {
        assert_eq!(normalize_key_slot(raw.clone()), KeySlot::default());
        assert_eq!(
            serde_json::from_value::<KeySlot>(raw).unwrap(),
            KeySlot::default()
        );
    }

    for key in ["A+B", "A|B", "+"] {
        let slot: KeySlot = serde_json::from_value(serde_json::json!(key)).unwrap();
        assert_eq!(slot, KeySlot::Single(key.to_string()));
        assert_eq!(slot.canonical(), key);
    }
}

#[test]
fn key_mapping_normalization_preserves_first_seen_members_and_helper_semantics() {
    let mut mappings = KeyMappings::from([(
        "mode".to_string(),
        vec![
            KeySlot::Multi {
                keys: vec![
                    "A".to_string(),
                    String::new(),
                    "A".to_string(),
                    "B+C".to_string(),
                    "B".to_string(),
                    "C|D".to_string(),
                    "C".to_string(),
                ],
                match_mode: SlotMatch::Any,
            },
            KeySlot::Multi {
                keys: vec!["ONLY".to_string(), "ONLY".to_string()],
                match_mode: SlotMatch::All,
            },
            KeySlot::Multi {
                keys: Vec::new(),
                match_mode: SlotMatch::Any,
            },
            KeySlot::Single("A+B".to_string()),
        ],
    )]);

    assert!(key_mappings_contain_multi(&mappings));
    normalize_key_mappings(&mut mappings);

    let slots = &mappings["mode"];
    assert_eq!(
        slots,
        &[
            KeySlot::Multi {
                keys: vec!["A".to_string(), "B".to_string(), "C".to_string()],
                match_mode: SlotMatch::Any,
            },
            KeySlot::Single("ONLY".to_string()),
            KeySlot::default(),
            KeySlot::Single("A+B".to_string()),
        ]
    );
    assert_eq!(
        slots[0].members().map(String::as_str).collect::<Vec<_>>(),
        ["A", "B", "C"]
    );
    assert_eq!(slots[0].canonical(), "A|B|C");
    assert!(slots[0].is_multi());
    assert!(!slots[1].is_multi());
    assert!(slots[2].is_unassigned());
    assert!(key_mappings_contain_multi(&mappings));
}

#[test]
fn stat_type_wire_values_round_trip() {
    for (stat_type, wire_value) in [
        (StatType::Kps, "kps"),
        (StatType::KpsAvg, "kpsAvg"),
        (StatType::KpsMax, "kpsMax"),
        (StatType::Total, "total"),
    ] {
        let serialized = serde_json::to_value(&stat_type).unwrap();
        assert_eq!(serialized, wire_value);

        let restored: StatType = serde_json::from_value(serialized).unwrap();
        assert_eq!(restored, stat_type);
    }
}

// 필수 필드만 채운 최소 KeyPosition JSON. 시각 px 필드는 호출부에서 주입
fn key_position_json(visual_px: &str) -> String {
    format!(
        r##"{{
                "dx": 0.0, "dy": 0.0, "width": 60.0, "height": 60.0,
                "count": 0, "noteColor": "#FFFFFF", "noteOpacity": 80,
                {visual_px}
            }}"##
    )
}

// 기존 정수 저장값이 f64 필드로 그대로 역직렬화되는지 (하위 호환)
#[test]
fn visual_px_fields_accept_integer_json() {
    let json = key_position_json(r#""noteWidth": 100, "noteBorderRadius": 8, "noteGlowSize": 20"#);
    let pos: KeyPosition = serde_json::from_str(&json).unwrap();
    assert_eq!(pos.note_width, Some(100.0));
    assert_eq!(pos.note_border_radius, Some(8.0));
    assert_eq!(pos.note_glow_size, 20.0);
}

// 소수 저장값이 정상 역직렬화되는지
#[test]
fn visual_px_fields_accept_decimal_json() {
    let json =
        key_position_json(r#""noteWidth": 100.5, "noteBorderRadius": 8.5, "noteGlowSize": 20.5"#);
    let pos: KeyPosition = serde_json::from_str(&json).unwrap();
    assert_eq!(pos.note_width, Some(100.5));
    assert_eq!(pos.note_border_radius, Some(8.5));
    assert_eq!(pos.note_glow_size, 20.5);
}

// note_glow_size 미지정 시 기본값(10.0) 적용
#[test]
fn note_glow_size_defaults_to_10() {
    let json = key_position_json(r#""noteWidth": null"#);
    let pos: KeyPosition = serde_json::from_str(&json).unwrap();
    assert_eq!(pos.note_glow_size, 10.0);
    assert_eq!(pos.note_width, None);
}

#[test]
fn gradient_opacity_fields_survive_serde_round_trip() {
    let json = key_position_json(
        r#""noteOpacityTop": 91, "noteOpacityBottom": 37,
                "noteGlowOpacityTop": 64, "noteGlowOpacityBottom": 18"#,
    );
    let position: KeyPosition = serde_json::from_str(&json).unwrap();

    assert_eq!(position.note_opacity_top, Some(91));
    assert_eq!(position.note_opacity_bottom, Some(37));
    assert_eq!(position.note_glow_opacity_top, Some(64));
    assert_eq!(position.note_glow_opacity_bottom, Some(18));

    let serialized = serde_json::to_value(&position).unwrap();
    assert_eq!(serialized["noteOpacityTop"], 91);
    assert_eq!(serialized["noteOpacityBottom"], 37);
    assert_eq!(serialized["noteGlowOpacityTop"], 64);
    assert_eq!(serialized["noteGlowOpacityBottom"], 18);

    let restored: KeyPosition = serde_json::from_value(serialized).unwrap();
    assert_eq!(restored, position);
}

#[test]
fn note_settings_1_3_format_still_preserves_every_field() {
    // 1.3 시절 noteSettings 전체 필드 실형식
    let fixture = r#"{
            "borderRadius": 9,
            "speed": 456,
            "trackHeight": 222,
            "reverse": true,
            "fadePosition": "bottom",
            "delayedNoteEnabled": true,
            "shortNoteThresholdMs": 73,
            "shortNoteMinLengthPx": 41
        }"#;
    let settings: NoteSettings = serde_json::from_str(fixture).unwrap();

    assert_eq!(settings.border_radius, Some(9));
    assert_eq!(settings.speed, 456);
    assert_eq!(settings.track_height, 222);
    assert!(settings.reverse);
    assert_eq!(settings.fade_position, FadePosition::Bottom);
    assert!(settings.delayed_note_enabled);
    assert_eq!(settings.short_note_threshold_ms, 73);
    assert_eq!(settings.short_note_min_length_px, 41);
}

#[test]
fn key_position_1_0_missing_visual_fields_uses_legacy_defaults() {
    let position: KeyPosition =
        serde_json::from_str(r#"{"dx":777,"dy":12,"width":60,"count":42}"#).unwrap();

    assert_eq!(position.dx, 777.0);
    assert_eq!(position.count, 42);
    assert_eq!(position.height, 60.0);
    assert_eq!(position.note_color, NoteColor::Solid("#FFFFFF".to_string()));
    assert_eq!(position.note_opacity, 90);
    assert_eq!(position.shadow, None);
    assert_eq!(position.active_shadow, None);
}

#[test]
fn key_position_visual_effects_round_trip_without_rewriting_missing_defaults() {
    let fixture = serde_json::json!({
        "dx": 0,
        "dy": 0,
        "width": 60,
        "count": 0,
        "shadow": {
            "enabled": true,
            "color": "rgba(10, 20, 30, 0.45)",
            "offsetX": -2.0,
            "offsetY": 7.0,
            "blur": 18.0
        },
        "activeShadow": {
            "enabled": false,
            "color": "rgba(0, 0, 0, 0.32)",
            "offsetX": 0.0,
            "offsetY": 3.0,
            "blur": 8.0
        }
    });

    let position: KeyPosition = serde_json::from_value(fixture.clone()).unwrap();
    let serialized = serde_json::to_value(position).unwrap();

    assert_eq!(serialized.get("shadow"), fixture.get("shadow"));
    assert_eq!(serialized.get("activeShadow"), fixture.get("activeShadow"));
}

#[test]
fn gradient_spec_tolerates_legacy_shape_and_serializes_canonically() {
    let gradient: GradientSpec = serde_json::from_value(serde_json::json!({
        "type": "linear",
        "stops": [
            { "color": "c9", "pos": 1.4 },
            { "color": "c8", "pos": 0.8 },
            { "color": "c7", "pos": 0.7 },
            { "color": "c6", "pos": 0.6 },
            { "color": "c5", "pos": 0.5 },
            { "color": "c4", "pos": 0.4 },
            { "color": "c3", "pos": 0.3 },
            { "color": "c2", "pos": 0.2 },
            { "color": "c1", "pos": 0.1 },
            { "color": "c0", "pos": -0.2 }
        ]
    }))
    .unwrap();

    assert_eq!(gradient.angle, 90.0);
    assert_eq!(gradient.stops.len(), 8);
    assert_eq!(gradient.stops.first().unwrap().color, "c0");
    assert_eq!(gradient.stops.first().unwrap().pos, 0.0);
    assert_eq!(gradient.stops.last().unwrap().color, "c7");

    let canonical = serde_json::to_value(&gradient).unwrap();
    assert_eq!(canonical["angle"], 90.0);
    assert_eq!(canonical["stops"].as_array().unwrap().len(), 8);
    assert!(canonical.get("type").is_none());

    let restored: GradientSpec = serde_json::from_value(canonical.clone()).unwrap();
    assert_eq!(serde_json::to_value(restored).unwrap(), canonical);
}

#[test]
fn gradient_spec_rejects_fewer_than_two_stops() {
    let error = serde_json::from_value::<GradientSpec>(serde_json::json!({
        "angle": 90,
        "stops": [{ "color": "#FFFFFF", "pos": 0 }]
    }))
    .unwrap_err();

    assert!(error.to_string().contains("at least two stops"));
}

#[test]
fn gradient_spec_rejects_null_angle_but_preserves_stop_alpha_strings() {
    let error = serde_json::from_value::<GradientSpec>(serde_json::json!({
        "angle": null,
        "stops": [
            { "color": "rgba(1,2,3,0)", "pos": 0 },
            { "color": "rgba(1,2,3,1)", "pos": 1 }
        ]
    }))
    .unwrap_err();
    assert!(error.to_string().contains("invalid gradient angle"));

    let gradient: GradientSpec = serde_json::from_value(serde_json::json!({
        "stops": [
            { "color": "rgba(1,2,3,0)", "pos": 0 },
            { "color": "rgba(1,2,3,0.5)", "pos": 0.5 },
            { "color": "rgba(1,2,3,1)", "pos": 1 }
        ]
    }))
    .unwrap();
    assert_eq!(
        gradient
            .stops
            .iter()
            .map(|stop| stop.color.as_str())
            .collect::<Vec<_>>(),
        ["rgba(1,2,3,0)", "rgba(1,2,3,0.5)", "rgba(1,2,3,1)"]
    );
}

#[test]
fn note_border_stop_color_parser_matches_shared_fixture() {
    let fixture: NoteBorderStopColorFixture =
        serde_json::from_str(NOTE_BORDER_STOP_COLOR_FIXTURE).unwrap();

    for case in fixture.valid {
        assert_eq!(
            note_border_representative_hex(&case.input),
            Some(case.representative),
            "valid fixture mismatch for {:?}",
            case.input
        );
    }
    for input in fixture.invalid {
        assert_eq!(
            note_border_representative_hex(&input),
            None,
            "invalid fixture mismatch for {input:?}"
        );
    }
}

#[test]
fn new_gradient_fields_round_trip_and_missing_fields_remain_none() {
    let legacy: KeyPosition = serde_json::from_value(serde_json::json!({
        "dx": 0,
        "dy": 0,
        "width": 60,
        "count": 0
    }))
    .unwrap();
    assert!(legacy.note_gradient.is_none());
    assert!(legacy.note_glow_gradient.is_none());
    assert!(legacy.note_border_gradient.is_none());
    assert!(legacy.font_gradient.is_none());
    assert!(legacy.active_font_gradient.is_none());

    let value = serde_json::json!({
        "dx": 0,
        "dy": 0,
        "width": 60,
        "count": 0,
        "noteGradient": {
            "angle": 15,
            "stops": [
                { "color": "#1238", "pos": 0 },
                { "color": "rgba(4,5,6,.5)", "pos": 1 }
            ]
        },
        "noteGlowGradient": {
            "angle": 25,
            "stops": [
                { "color": "rgb(7,8,9)", "pos": 0 },
                { "color": "#ABC0", "pos": 1 }
            ]
        },
        "noteBorderColor": "#112233",
        "noteBorderGradient": {
            "angle": 45,
            "stops": [
                { "color": "rgba(17,34,51,.5)", "pos": 0 },
                { "color": "#ABC", "pos": 1 }
            ]
        },
        "fontColor": "#112233",
        "fontGradient": {
            "angle": 90,
            "stops": [
                { "color": "#112233", "pos": 0 },
                { "color": "#445566", "pos": 1 }
            ]
        },
        "activeFontColor": "#778899",
        "activeFontGradient": {
            "angle": 180,
            "stops": [
                { "color": "#778899", "pos": 0 },
                { "color": "#AABBCC", "pos": 1 }
            ]
        }
    });
    let position: KeyPosition = serde_json::from_value(value).unwrap();
    let serialized = serde_json::to_value(&position).unwrap();
    assert!(serialized.get("noteGradient").is_some());
    assert!(serialized.get("noteGlowGradient").is_some());
    assert!(serialized.get("noteBorderGradient").is_some());
    assert!(serialized.get("fontGradient").is_some());
    assert!(serialized.get("activeFontGradient").is_some());
    assert_eq!(
        serde_json::from_value::<KeyPosition>(serialized).unwrap(),
        position
    );
}

#[test]
fn removed_text_outline_fields_scrub_every_collection_in_place() {
    let position = serde_json::json!({
        "id": "keep-entry",
        "fontStrokeColor": "#111111",
        "activeFontStrokeColor": "#222222",
        "counter": {
            "stroke": { "idle": "#333333", "active": "#444444" },
            "strokeIdleGradient": { "stops": [] },
            "strokeActiveGradient": { "stops": [] },
            "fill": { "idle": "keep-idle", "active": "keep-active" }
        }
    });
    let mut value = serde_json::json!({
        "keyPositions": { "4key": [position.clone()] },
        "statPositions": { "4key": [position.clone()] },
        "graphPositions": { "4key": [position.clone()] },
        "knobPositions": { "4key": [position] }
    });

    assert!(scrub_removed_text_outline_fields(&mut value));
    for collection in POSITION_COLLECTION_FIELDS {
        let entries = value[collection]["4key"].as_array().unwrap();
        assert_eq!(entries.len(), 1);
        let position = entries[0].as_object().unwrap();
        assert_eq!(position["id"], "keep-entry");
        assert!(!position.contains_key("fontStrokeColor"));
        assert!(!position.contains_key("activeFontStrokeColor"));
        let counter = position["counter"].as_object().unwrap();
        assert!(!counter.contains_key("stroke"));
        assert!(!counter.contains_key("strokeIdleGradient"));
        assert!(!counter.contains_key("strokeActiveGradient"));
        assert_eq!(counter["fill"]["idle"], "keep-idle");
    }
    assert!(!scrub_removed_text_outline_fields(&mut value));
}

#[test]
fn note_gradients_atomically_canonicalize_color_and_alpha_shadows() {
    let mut position: KeyPosition = serde_json::from_value(serde_json::json!({
        "dx": 0,
        "dy": 0,
        "width": 60,
        "count": 0,
        "noteColor": "stale-body",
        "noteOpacity": 75,
        "noteOpacityTop": 1,
        "noteOpacityBottom": 2,
        "noteGradient": {
            "angle": 15,
            "stops": [
                { "color": "#1238", "pos": 0 },
                { "color": "rgba(4,5,6,.5)", "pos": 1 }
            ]
        },
        "noteGlowColor": "stale-glow",
        "noteGlowOpacity": 60,
        "noteGlowOpacityTop": 3,
        "noteGlowOpacityBottom": 4,
        "noteGlowGradient": {
            "angle": 25,
            "stops": [
                { "color": "rgb(7,8,9)", "pos": 0 },
                { "color": "#ABC0", "pos": 1 }
            ]
        }
    }))
    .unwrap();

    assert_eq!(position.canonicalize_gradient_pairs(), (true, true));
    assert_eq!(
        position.note_color,
        NoteColor::Gradient {
            top: "#112233".to_string(),
            bottom: "#040506".to_string(),
        }
    );
    assert_eq!(position.note_opacity_top, Some(40));
    assert_eq!(position.note_opacity_bottom, Some(38));
    assert_eq!(
        position.note_glow_color,
        Some(NoteColor::Gradient {
            top: "#070809".to_string(),
            bottom: "#AABBCC".to_string(),
        })
    );
    assert_eq!(position.note_glow_opacity_top, Some(60));
    assert_eq!(position.note_glow_opacity_bottom, Some(0));
    assert_eq!(position.canonicalize_gradient_pairs(), (false, false));
}

#[test]
fn synced_note_glow_canonicalization_refreshes_stale_mirror_without_pair_repair() {
    let mut position = KeyPosition {
        note_glow_sync_paint: true,
        note_color: NoteColor::Gradient {
            top: "#112233".to_string(),
            bottom: "#445566".to_string(),
        },
        note_gradient: serde_json::from_value(serde_json::json!({
            "angle": 180,
            "stops": [
                { "color": "#112233", "pos": 0 },
                { "color": "rgba(68, 85, 102, 0.5)", "pos": 1 }
            ]
        }))
        .unwrap(),
        note_opacity: 80,
        note_opacity_top: Some(80),
        note_opacity_bottom: Some(40),
        note_glow_color: Some(NoteColor::Solid("stale".to_string())),
        note_glow_opacity: 70,
        note_glow_opacity_top: Some(70),
        note_glow_opacity_bottom: Some(70),
        ..KeyPosition::default()
    };

    assert_eq!(position.canonicalize_gradient_pairs(), (true, false));
    assert_eq!(position.note_glow_gradient, position.note_gradient);
    assert_eq!(position.note_glow_opacity, position.note_opacity);
    assert_eq!(
        position.note_glow_color.as_ref(),
        Some(&position.note_color)
    );
    assert_eq!(position.note_glow_opacity_top, position.note_opacity_top);
    assert_eq!(
        position.note_glow_opacity_bottom,
        position.note_opacity_bottom
    );
}

#[test]
fn synced_note_glow_canonicalization_is_idempotent_when_mirror_matches() {
    let mut position = KeyPosition {
        note_glow_sync_paint: true,
        note_color: NoteColor::Solid("#112233".to_string()),
        note_opacity: 80,
        note_opacity_top: Some(70),
        note_opacity_bottom: Some(60),
        ..KeyPosition::default()
    };
    assert!(position.mirror_note_body_to_glow());

    assert_eq!(position.canonicalize_gradient_pairs(), (false, false));
}

#[test]
fn font_gradient_pairs_are_optional_and_canonicalize_representative_colors() {
    let mut position = KeyPosition {
        font_color: Some("stale-idle".to_string()),
        font_gradient: serde_json::from_value(serde_json::json!({
            "angle": 405,
            "stops": [
                { "color": "rgba(17, 34, 51, .5)", "pos": 0 },
                { "color": "#445566", "pos": 1 }
            ]
        }))
        .unwrap(),
        active_font_color: None,
        active_font_gradient: serde_json::from_value(serde_json::json!({
            "angle": -45,
            "stops": [
                { "color": "#778899", "pos": 0 },
                { "color": "rgb(170, 187, 204)", "pos": 1 }
            ]
        }))
        .unwrap(),
        ..KeyPosition::default()
    };

    assert_eq!(position.canonicalize_gradient_pairs(), (true, true));
    assert_eq!(position.font_color.as_deref(), Some("rgba(17, 34, 51, .5)"));
    assert_eq!(position.active_font_color.as_deref(), Some("#778899"));
    assert_eq!(position.font_gradient.as_ref().unwrap().angle, 45.0);
    assert_eq!(position.active_font_gradient.as_ref().unwrap().angle, 315.0);
    assert_eq!(position.canonicalize_gradient_pairs(), (false, false));

    let serialized_default = serde_json::to_value(KeyPosition::default()).unwrap();
    assert!(serialized_default.get("fontGradient").is_none());
    assert!(serialized_default.get("activeFontGradient").is_none());
}

#[test]
fn note_gradient_rejects_invalid_original_stop_before_truncation() {
    let mut position = KeyPosition {
        note_color: NoteColor::Solid("preserved".to_string()),
        note_gradient: serde_json::from_value(serde_json::json!({
            "angle": 90,
            "stops": [
                { "color": "#000000", "pos": 0.0 },
                { "color": "#111111", "pos": 0.1 },
                { "color": "#222222", "pos": 0.2 },
                { "color": "#333333", "pos": 0.3 },
                { "color": "#444444", "pos": 0.4 },
                { "color": "#555555", "pos": 0.5 },
                { "color": "#666666", "pos": 0.6 },
                { "color": "#777777", "pos": 0.7 },
                { "color": "invalid-discarded-stop", "pos": 1.0 }
            ]
        }))
        .unwrap(),
        ..KeyPosition::default()
    };

    assert_eq!(position.note_gradient.as_ref().unwrap().stops.len(), 8);
    assert_eq!(position.canonicalize_gradient_pairs(), (true, true));
    assert!(position.note_gradient.is_none());
    assert_eq!(
        position.note_color,
        NoteColor::Solid("preserved".to_string())
    );
}

#[test]
fn note_border_gradient_canonicalization_uses_hex_and_drops_invalid_stop() {
    let mut position: KeyPosition = serde_json::from_value(serde_json::json!({
        "dx": 0,
        "dy": 0,
        "width": 60,
        "count": 0,
        "noteBorderColor": "#000000",
        "noteBorderGradient": {
            "angle": 90,
            "stops": [
                { "color": "rgba(17, 34, 51, .5)", "pos": 0 },
                { "color": "#ABC", "pos": 1 }
            ]
        }
    }))
    .unwrap();

    assert_eq!(position.canonicalize_gradient_pairs(), (true, true));
    assert_eq!(position.note_border_color.as_deref(), Some("#112233"));
    assert!(position.note_border_gradient.is_some());
    assert_eq!(position.canonicalize_gradient_pairs(), (false, false));

    position.note_border_color = Some("#445566".to_string());
    position.note_border_gradient = serde_json::from_value(serde_json::json!({
        "angle": 90,
        "stops": [
            { "color": "#112233", "pos": 0 },
            { "color": "transparent", "pos": 1 }
        ]
    }))
    .unwrap();
    assert_eq!(position.canonicalize_gradient_pairs(), (true, true));
    assert_eq!(position.note_border_color.as_deref(), Some("#445566"));
    assert!(position.note_border_gradient.is_none());

    position.note_border_gradient = serde_json::from_value(serde_json::json!({
        "angle": 90,
        "stops": [
            { "color": "#000000", "pos": 0.0 },
            { "color": "#111111", "pos": 0.1 },
            { "color": "#222222", "pos": 0.2 },
            { "color": "#333333", "pos": 0.3 },
            { "color": "#444444", "pos": 0.4 },
            { "color": "#555555", "pos": 0.5 },
            { "color": "#666666", "pos": 0.6 },
            { "color": "#777777", "pos": 0.7 },
            { "color": "invalid-discarded-stop", "pos": 1.0 }
        ]
    }))
    .unwrap();
    assert_eq!(
        position.note_border_gradient.as_ref().unwrap().stops.len(),
        8
    );
    assert_eq!(position.canonicalize_gradient_pairs(), (true, true));
    assert!(position.note_border_gradient.is_none());
}

#[test]
fn counter_gradient_escape_differs_from_every_legacy_snapshot_literal() {
    let legacy_literals = [
        "#FFFFFF",
        "#000000",
        "rgba(121, 121, 121, 0.9)",
        "transparent",
    ];
    let visual_pairs = [
        ("#FFFFFF", "rgba(255,255,255,1)"),
        ("#000000", "rgba(0,0,0,1)"),
        ("rgba(121, 121, 121, 0.9)", "rgba(121,121,121,0.9)"),
    ];

    for (input, expected) in visual_pairs {
        let escaped = compact_canonical_rgba(input);
        assert_eq!(escaped, expected);
        assert!(legacy_literals.iter().all(|literal| escaped != *literal));
    }
}

#[test]
fn removed_custom_stroke_evidence_blocks_legacy_default_migration_permanently() {
    let legacy_counter = |stroke: serde_json::Value, gradient: bool| {
        let mut counter = serde_json::json!({
            "placement": "inside",
            "align": "top",
            "alignMode": "center",
            "fill": { "idle": "#FFFFFF", "active": "#000000" },
            "stroke": stroke,
            "gap": 6,
            "fontSize": 16,
            "fontWeight": 400,
            "fontFamily": null,
            "fontItalic": false,
            "fontUnderline": false,
            "fontStrikethrough": false
        });
        if gradient {
            counter["strokeIdleGradient"] = serde_json::json!({ "stops": [] });
        }
        counter
    };

    for counter in [
        legacy_counter(
            serde_json::json!({ "idle": "#123456", "active": "#FFFFFF" }),
            false,
        ),
        legacy_counter(
            serde_json::json!({ "idle": "#000000", "active": "#FFFFFF" }),
            true,
        ),
    ] {
        let mut raw = serde_json::json!({ "keyPositions": { "4key": [{ "counter": counter }] } });
        assert!(scrub_removed_text_outline_fields(&mut raw));
        let mut parsed: KeyCounterSettings =
            serde_json::from_value(raw["keyPositions"]["4key"][0]["counter"].clone()).unwrap();
        assert_eq!(parsed.fill.idle, "rgba(255,255,255,1)");
        assert!(!parsed.migrate_legacy_defaults());
        assert_eq!(parsed.align, KeyCounterAlign::Top);
    }

    let mut raw = serde_json::json!({
        "keyPositions": { "4key": [{
            "counter": legacy_counter(
                serde_json::json!({ "idle": "#000000", "active": "#FFFFFF" }),
                false,
            )
        }] }
    });
    assert!(scrub_removed_text_outline_fields(&mut raw));
    let mut parsed: KeyCounterSettings =
        serde_json::from_value(raw["keyPositions"]["4key"][0]["counter"].clone()).unwrap();
    assert!(parsed.migrate_legacy_defaults());
    assert_eq!(parsed.align, KeyCounterAlign::Bottom);
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreFeatureKeyPosition {
    background_color: Option<String>,
    counter: PreFeatureCounterSettings,
}

#[derive(serde::Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreUnifiedNotePosition {
    dx: f64,
    dy: f64,
    width: f64,
    count: u32,
    note_color: NoteColor,
    note_opacity: u32,
    note_opacity_top: Option<u32>,
    note_opacity_bottom: Option<u32>,
    note_glow_color: Option<NoteColor>,
    note_glow_opacity: u32,
    note_glow_opacity_top: Option<u32>,
    note_glow_opacity_bottom: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreFeatureCounterSettings {
    fill: KeyCounterColor,
    placement: KeyCounterPlacement,
    align: KeyCounterAlign,
    align_mode: KeyCounterAlignMode,
    gap: u32,
    font_size: u32,
    font_weight: u32,
    font_family: Option<String>,
    font_italic: bool,
    font_underline: bool,
    font_strikethrough: bool,
}

impl PreFeatureCounterSettings {
    fn matches_legacy_migration_snapshot(&self) -> bool {
        let shared = matches!(self.placement, KeyCounterPlacement::Inside)
            && matches!(self.align, KeyCounterAlign::Top)
            && matches!(self.align_mode, KeyCounterAlignMode::Center)
            && self.gap == 6
            && self.font_size == 16
            && self.font_family.is_none()
            && !self.font_italic
            && !self.font_underline
            && !self.font_strikethrough;
        let oldest =
            self.fill.idle == "#FFFFFF" && self.fill.active == "#000000" && self.font_weight == 400;
        let previous = self.fill.idle == "rgba(121, 121, 121, 0.9)"
            && self.fill.active == "#FFFFFF"
            && self.font_weight == 700;
        shared && (oldest || previous)
    }
}

#[test]
fn pre_feature_shadow_downgrade_ignores_gradients_without_triggering_migration() {
    for (legacy_fill, first_stop, expected_escape) in [
        ("#FFFFFF", "#FFFFFF", "rgba(255,255,255,1)"),
        (
            "rgba(121, 121, 121, 0.9)",
            "rgba(121, 121, 121, 0.9)",
            "rgba(121,121,121,0.9)",
        ),
    ] {
        let mut position: KeyPosition = serde_json::from_value(serde_json::json!({
            "dx": 0,
            "dy": 0,
            "width": 60,
            "count": 0,
            "backgroundColor": "#102030",
            "backgroundGradient": {
                "angle": 90,
                "stops": [
                    { "color": "#102030", "pos": 0 },
                    { "color": "#405060", "pos": 1 }
                ]
            },
            "counter": {
                "enabled": true,
                "placement": "inside",
                "align": "top",
                "alignMode": "center",
                "fill": {
                    "idle": legacy_fill,
                    "active": if legacy_fill == "#FFFFFF" { "#000000" } else { "#FFFFFF" }
                },
                "fillIdleGradient": {
                    "angle": 90,
                    "stops": [
                        { "color": first_stop, "pos": 0 },
                        { "color": "#654321", "pos": 1 }
                    ]
                },
                "gap": 6,
                "fontSize": 16,
                "fontWeight": if legacy_fill == "#FFFFFF" { 400 } else { 700 },
                "fontFamily": null,
                "fontItalic": false,
                "fontUnderline": false,
                "fontStrikethrough": false
            }
        }))
        .unwrap();

        let (_, pair_repaired) = position.canonicalize_gradient_pairs();
        assert!(pair_repaired);
        assert_eq!(position.counter.fill.idle, expected_escape);
        assert!(!position.counter.migrate_legacy_defaults());

        let serialized = serde_json::to_value(&position).unwrap();
        let shadow: PreFeatureKeyPosition = serde_json::from_value(serialized).unwrap();
        assert_eq!(shadow.background_color.as_deref(), Some("#102030"));
        assert_eq!(shadow.counter.fill.idle, expected_escape);
        assert!(!shadow.counter.matches_legacy_migration_snapshot());
    }
}

#[test]
fn pre_unification_round_trip_drops_siblings_and_preserves_note_shadows() {
    let mut position: KeyPosition = serde_json::from_value(serde_json::json!({
        "dx": 0,
        "dy": 0,
        "width": 60,
        "count": 0,
        "noteOpacity": 80,
        "noteGradient": {
            "angle": 45,
            "stops": [
                { "color": "rgba(17,34,51,.5)", "pos": 0 },
                { "color": "#44556640", "pos": 1 }
            ]
        },
        "noteGlowOpacity": 60,
        "noteGlowGradient": {
            "angle": 135,
            "stops": [
                { "color": "#77889980", "pos": 0 },
                { "color": "rgb(170,187,204)", "pos": 1 }
            ]
        }
    }))
    .unwrap();
    assert_eq!(position.canonicalize_gradient_pairs(), (true, true));
    let expected_note_color = position.note_color.clone();
    let expected_note_top = position.note_opacity_top;
    let expected_note_bottom = position.note_opacity_bottom;
    let expected_glow_color = position.note_glow_color.clone();
    let expected_glow_top = position.note_glow_opacity_top;
    let expected_glow_bottom = position.note_glow_opacity_bottom;

    let new_wire = serde_json::to_value(position).unwrap();
    let old: PreUnifiedNotePosition = serde_json::from_value(new_wire).unwrap();
    let old_wire = serde_json::to_value(old).unwrap();
    assert!(old_wire.get("noteGradient").is_none());
    assert!(old_wire.get("noteGlowGradient").is_none());

    let restored: KeyPosition = serde_json::from_value(old_wire).unwrap();
    assert!(restored.note_gradient.is_none());
    assert!(restored.note_glow_gradient.is_none());
    assert_eq!(restored.note_color, expected_note_color);
    assert_eq!(restored.note_opacity_top, expected_note_top);
    assert_eq!(restored.note_opacity_bottom, expected_note_bottom);
    assert_eq!(restored.note_glow_color, expected_glow_color);
    assert_eq!(restored.note_glow_opacity_top, expected_glow_top);
    assert_eq!(restored.note_glow_opacity_bottom, expected_glow_bottom);
}

#[test]
fn counter_migration_without_gradients_preserves_both_legacy_upgrade_branches() {
    for snapshot in [
        serde_json::json!({
            "placement": "inside",
            "align": "top",
            "alignMode": "center",
            "fill": { "idle": "#FFFFFF", "active": "#000000" },
            "stroke": { "idle": "#000000", "active": "#FFFFFF" },
            "gap": 6,
            "fontSize": 16,
            "fontWeight": 400,
            "fontFamily": null,
            "fontItalic": false,
            "fontUnderline": false,
            "fontStrikethrough": false
        }),
        serde_json::json!({
            "placement": "inside",
            "align": "top",
            "alignMode": "center",
            "fill": {
                "idle": "rgba(121, 121, 121, 0.9)",
                "active": "#FFFFFF"
            },
            "stroke": { "idle": "transparent", "active": "transparent" },
            "gap": 6,
            "fontSize": 16,
            "fontWeight": 700,
            "fontFamily": null,
            "fontItalic": false,
            "fontUnderline": false,
            "fontStrikethrough": false
        }),
    ] {
        let mut counter: KeyCounterSettings = serde_json::from_value(snapshot).unwrap();

        assert!(counter.migrate_legacy_defaults());
        assert_eq!(counter, KeyCounterSettings::default());
    }
}
