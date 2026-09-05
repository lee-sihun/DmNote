use super::*;

// TS canonical 배열과 공유하는 property 태그 fixture
const PROPERTY_TAG_FIXTURE: &str =
    include_str!("../../../../tests/fixtures/editor-property-tags.json");

fn paint(color: &str) -> EditorPaintDescriptorV1 {
    EditorPaintDescriptorV1 {
        color: color.to_string(),
        gradient: None,
    }
}

// 75개 variant 전수: (patch, property 태그, value wire) 고정 표본
fn property_patch_samples() -> Vec<(
    EditorElementPropertyPatchV1,
    &'static str,
    serde_json::Value,
)> {
    use serde_json::json;
    use EditorElementPropertyPatchV1 as P;
    vec![
        (P::Hidden(true), "hidden", json!(true)),
        (
            P::LayerName(Some("layer".to_string())),
            "layerName",
            json!("layer"),
        ),
        (P::GraphType(GraphType::Bar), "graphType", json!("bar")),
        (
            P::GraphColor("#123456".to_string()),
            "graphColor",
            json!("#123456"),
        ),
        (P::ShowAvgLine(false), "showAvgLine", json!(false)),
        (
            P::GraphAnimationEnabled(true),
            "graphAnimationEnabled",
            json!(true),
        ),
        (P::GraphSpeed(7), "graphSpeed", json!(7)),
        (P::Reverse(true), "reverse", json!(true)),
        (P::Sensitivity(1.5), "sensitivity", json!(1.5)),
        (P::AxisId("axis-1".to_string()), "axisId", json!("axis-1")),
        (P::UseInlineStyles(true), "useInlineStyles", json!(true)),
        (P::FontWeight(700), "fontWeight", json!(700)),
        (P::FontBold(true), "fontBold", json!(true)),
        (P::FontItalic(true), "fontItalic", json!(true)),
        (P::FontUnderline(false), "fontUnderline", json!(false)),
        (P::FontStrikethrough(true), "fontStrikethrough", json!(true)),
        (
            P::FontFamily("font".to_string()),
            "fontFamily",
            json!("font"),
        ),
        (
            P::DisplayText("text".to_string()),
            "displayText",
            json!("text"),
        ),
        (
            P::ClassName("class".to_string()),
            "className",
            json!("class"),
        ),
        (
            P::FontPaint(paint("#111111")),
            "fontPaint",
            json!({ "color": "#111111", "gradient": null }),
        ),
        (
            P::ActiveFontPaint(paint("#222222")),
            "activeFontPaint",
            json!({ "color": "#222222", "gradient": null }),
        ),
        (
            P::Shadow(EditorShadowLeafPatchV1::Color(
                "rgba(0, 0, 0, 0.2)".to_string(),
            )),
            "shadow",
            json!({ "leaf": "color", "value": "rgba(0, 0, 0, 0.2)" }),
        ),
        (
            P::ActiveShadow(EditorShadowLeafPatchV1::OffsetY(-3.25)),
            "activeShadow",
            json!({ "leaf": "offsetY", "value": -3.25 }),
        ),
        (P::ShadowEnabled(false), "shadowEnabled", json!(false)),
        (
            P::BackgroundPaint(paint("#010101")),
            "backgroundPaint",
            json!({ "color": "#010101", "gradient": null }),
        ),
        (
            P::ActiveBackgroundPaint(paint("#020202")),
            "activeBackgroundPaint",
            json!({ "color": "#020202", "gradient": null }),
        ),
        (
            P::BorderPaint(paint("#030303")),
            "borderPaint",
            json!({ "color": "#030303", "gradient": null }),
        ),
        (
            P::ActiveBorderPaint(paint("#040404")),
            "activeBorderPaint",
            json!({ "color": "#040404", "gradient": null }),
        ),
        (P::BorderWidth(2.5), "borderWidth", json!(2.5)),
        (P::BorderRadius(8.5), "borderRadius", json!(8.5)),
        (P::FontSize(12.5), "fontSize", json!(12.5)),
        (
            P::InactiveImage("idle.png".to_string()),
            "inactiveImage",
            json!("idle.png"),
        ),
        (
            P::ActiveImage("active.png".to_string()),
            "activeImage",
            json!("active.png"),
        ),
        (P::IdleTransparent(true), "idleTransparent", json!(true)),
        (
            P::ActiveTransparent(false),
            "activeTransparent",
            json!(false),
        ),
        (
            P::IdleImageFit(ImageFit::Contain),
            "idleImageFit",
            json!("contain"),
        ),
        (
            P::ActiveImageFit(ImageFit::Fill),
            "activeImageFit",
            json!("fill"),
        ),
        (
            P::ImageMode(ImageMode::Overlay),
            "imageMode",
            json!("overlay"),
        ),
        (
            P::IdleImageTransform(Some(ImageTransformLeafPatchV1::Rotation(-45.5))),
            "idleImageTransform",
            json!({ "leaf": "rotation", "value": -45.5 }),
        ),
        (
            P::ActiveImageTransform(None),
            "activeImageTransform",
            serde_json::Value::Null,
        ),
        (
            P::SoundPath("sound.wav".to_string()),
            "soundPath",
            json!("sound.wav"),
        ),
        (P::SoundEnabled(true), "soundEnabled", json!(true)),
        (P::SoundVolume(80.5), "soundVolume", json!(80.5)),
        (P::CounterEnabled(true), "counterEnabled", json!(true)),
        (
            P::CounterAnimationEnabled(false),
            "counterAnimationEnabled",
            json!(false),
        ),
        (
            P::CounterPlacement(KeyCounterPlacement::Outside),
            "counterPlacement",
            json!("outside"),
        ),
        (
            P::CounterAlign(KeyCounterAlign::Top),
            "counterAlign",
            json!("top"),
        ),
        (
            P::CounterAlignMode(KeyCounterAlignMode::Between),
            "counterAlignMode",
            json!("between"),
        ),
        (P::CounterGap(4), "counterGap", json!(4)),
        (P::CounterFontSize(16), "counterFontSize", json!(16)),
        (P::CounterFontWeight(500), "counterFontWeight", json!(500)),
        (P::CounterFontBold(true), "counterFontBold", json!(true)),
        (P::CounterFontItalic(true), "counterFontItalic", json!(true)),
        (
            P::CounterFontUnderline(false),
            "counterFontUnderline",
            json!(false),
        ),
        (
            P::CounterFontStrikethrough(true),
            "counterFontStrikethrough",
            json!(true),
        ),
        (
            P::CounterFontFamily("counter-font".to_string()),
            "counterFontFamily",
            json!("counter-font"),
        ),
        (
            P::CounterFillIdle(EditorCounterFillIntentV1::Solid(
                EditorCounterFillSolidIntentV1 {
                    color: "#050505".to_string(),
                },
            )),
            "counterFillIdle",
            json!({ "color": "#050505" }),
        ),
        (
            P::CounterFillActive(EditorCounterFillIntentV1::Solid(
                EditorCounterFillSolidIntentV1 {
                    color: "#060606".to_string(),
                },
            )),
            "counterFillActive",
            json!({ "color": "#060606" }),
        ),
        (
            P::CounterAnimationPreset(EditorCounterAnimationPresetIntentV1 {
                preset_id: "preset".to_string(),
                apply_preset_id: None,
                bezier: None,
                scale: None,
                duration_ms: None,
            }),
            "counterAnimationPreset",
            json!({ "presetId": "preset" }),
        ),
        (P::StatType(StatType::Total), "statType", json!("total")),
        (P::NoteEffectEnabled(true), "noteEffectEnabled", json!(true)),
        (P::NoteGlowEnabled(false), "noteGlowEnabled", json!(false)),
        (P::NoteGlowSyncPaint(true), "noteGlowSyncPaint", json!(true)),
        (P::NoteGlowSize(6.5), "noteGlowSize", json!(6.5)),
        (
            P::NotePaint(EditorNotePaintIntentV1::Opacity(
                EditorNotePaintOpacityIntentV1 { opacity: 40 },
            )),
            "notePaint",
            json!({ "opacity": 40 }),
        ),
        (
            P::NoteGlowPaint(EditorNotePaintIntentV1::Opacity(
                EditorNotePaintOpacityIntentV1 { opacity: 60 },
            )),
            "noteGlowPaint",
            json!({ "opacity": 60 }),
        ),
        (
            P::NoteBorderPaint(EditorNoteBorderPaintV1 {
                color: "#0a0b0c".to_string(),
                opacity: 30,
                gradient: None,
            }),
            "noteBorderPaint",
            json!({ "color": "#0a0b0c", "opacity": 30 }),
        ),
        (P::NoteOffsetX(Some(11.5)), "noteOffsetX", json!(11.5)),
        (P::NoteOffsetY(Some(-12.5)), "noteOffsetY", json!(-12.5)),
        (P::NoteWidth(Some(13.5)), "noteWidth", json!(13.5)),
        (P::NoteBorderWidth(1.5), "noteBorderWidth", json!(1.5)),
        (P::NoteBorderRadius(9.5), "noteBorderRadius", json!(9.5)),
        (
            P::NoteAutoYCorrection(true),
            "noteAutoYCorrection",
            json!(true),
        ),
        (
            P::NoteAlignment(NoteAlignment::Right),
            "noteAlignment",
            json!("right"),
        ),
        (
            P::NoteBorderSide(EditorNoteBorderSideV1::Vertical),
            "noteBorderSide",
            json!("vertical"),
        ),
    ]
}

#[test]
fn property_patch_wire_pins_all_tag_value_pairs_and_roundtrips() {
    let samples = property_patch_samples();
    assert_eq!(samples.len(), 75);
    for (patch, tag, value) in samples {
        let wire = serde_json::to_value(&patch).unwrap();
        assert_eq!(
            wire,
            serde_json::json!({ "property": tag, "value": value }),
            "wire mismatch for {tag}"
        );
        let decoded: EditorElementPropertyPatchV1 = serde_json::from_value(wire).unwrap();
        assert_eq!(decoded, patch, "roundtrip mismatch for {tag}");
    }
}

#[test]
fn expanded_paint_values_keep_existing_property_tags_and_exact_keys() {
    let gradient = serde_json::json!({
        "angle": 90,
        "stops": [
            { "color": "#112233", "pos": 0 },
            { "color": "#445566", "pos": 1 }
        ]
    });
    let cases = [
        serde_json::json!({
            "property": "noteBorderPaint",
            "value": { "color": "#112233", "opacity": 80 }
        }),
        serde_json::json!({
            "property": "noteBorderPaint",
            "value": { "color": "#112233", "opacity": 80, "gradient": null }
        }),
        serde_json::json!({
            "property": "noteBorderPaint",
            "value": {
                "color": "#112233",
                "opacity": 80,
                "gradient": gradient.clone()
            }
        }),
        serde_json::json!({
            "property": "notePaint",
            "value": {
                "color": "#112233",
                "opacity": 80,
                "gradient": null
            }
        }),
        serde_json::json!({
            "property": "noteGlowPaint",
            "value": {
                "color": {
                    "type": "gradient",
                    "top": "#112233",
                    "bottom": "#445566"
                },
                "opacity": 80,
                "gradient": gradient
            }
        }),
    ];

    for wire in cases {
        let patch: EditorElementPropertyPatchV1 = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(
            serde_json::to_value(&patch).unwrap()["property"],
            wire["property"]
        );
    }

    for wire in [
        serde_json::json!({
            "property": "noteBorderPaint",
            "value": { "color": "#112233", "opacity": 80, "extra": true }
        }),
        serde_json::json!({
            "property": "notePaint",
            "value": { "color": "#112233", "opacity": 80 }
        }),
        serde_json::json!({
            "property": "noteGlowPaint",
            "value": {
                "color": "#112233",
                "opacity": 80,
                "gradient": null,
                "extra": true
            }
        }),
    ] {
        assert!(serde_json::from_value::<EditorElementPropertyPatchV1>(wire).is_err());
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PropertyTagFixture {
    version: u16,
    properties: Vec<String>,
}

fn property_tag_fixture() -> PropertyTagFixture {
    serde_json::from_str(PROPERTY_TAG_FIXTURE).unwrap()
}

#[test]
fn property_patch_tags_match_shared_fixture() {
    let fixture = property_tag_fixture();
    // 양방향 anchor: Rust 상수만 승격되는 사고도 fixture 대조로 잡는다
    assert_eq!(fixture.version, EDITOR_OPS_VERSION);
    let tags: Vec<String> = property_patch_samples()
        .iter()
        .map(|(_, tag, _)| (*tag).to_string())
        .collect();
    assert_eq!(tags, fixture.properties);
}

// serde가 알 수 없는 variant 오류에 나열하는 기대 목록에서 enum의
// wire 태그 전수를 기계적으로 추출 - 수기 목록 없이 variant 추가를 감지
fn wire_property_tags_from_serde() -> std::collections::BTreeSet<String> {
    let message = serde_json::from_value::<EditorElementPropertyPatchV1>(serde_json::json!({
        "property": "__unknown__",
        "value": null,
    }))
    .unwrap_err()
    .to_string();
    let (_, listed) = message
        .split_once("expected one of ")
        .expect("serde unknown-variant error must enumerate every variant");
    let tags: std::collections::BTreeSet<String> = listed
        .split(", ")
        .map(|tag| tag.trim().trim_matches('`').to_string())
        .collect();
    assert!(!tags.is_empty());
    tags
}

#[test]
fn sample_and_fixture_tags_cover_every_enum_variant() {
    let enum_tags = wire_property_tags_from_serde();
    let sample_tags: std::collections::BTreeSet<String> = property_patch_samples()
        .iter()
        .map(|(_, tag, _)| (*tag).to_string())
        .collect();
    let fixture_tags: std::collections::BTreeSet<String> =
        property_tag_fixture().properties.into_iter().collect();
    // variant 신규 추가 시 표본·fixture 갱신 누락을 단방향 드리프트 없이 차단
    assert_eq!(sample_tags, enum_tags);
    assert_eq!(fixture_tags, enum_tags);
}

#[test]
fn property_patch_rejects_untagged_extra_unknown_and_missing_fields() {
    use serde_json::json;
    let reject = |value: serde_json::Value| {
        assert!(
            serde_json::from_value::<EditorElementPropertyPatchV1>(value.clone()).is_err(),
            "expected rejection: {value}"
        );
    };
    // 옛 one-key 형식
    reject(json!({ "hidden": true }));
    reject(json!({ "graphType": "bar" }));
    // outer 추가 필드
    reject(json!({ "property": "hidden", "value": true, "extra": 1 }));
    // 알 수 없는 property
    reject(json!({ "property": "unknown", "value": 1 }));
    // property 누락
    reject(json!({ "value": true }));
    // 원시값 payload의 value 누락
    reject(json!({ "property": "hidden" }));
    // 잘못된 값 타입
    reject(json!({ "property": "hidden", "value": "true" }));
    // 중복 키
    for duplicated in [
        r#"{ "property": "hidden", "property": "hidden", "value": true }"#,
        r#"{ "property": "hidden", "value": true, "value": false }"#,
    ] {
        assert!(
            serde_json::from_str::<EditorElementPropertyPatchV1>(duplicated).is_err(),
            "expected duplicate key rejection: {duplicated}"
        );
    }
}

#[test]
fn nullable_variants_require_an_explicit_value_key() {
    use serde_json::json;
    use EditorElementPropertyPatchV1 as P;
    let cases = [
        ("layerName", P::LayerName(None)),
        ("noteOffsetX", P::NoteOffsetX(None)),
        ("noteOffsetY", P::NoteOffsetY(None)),
        ("noteWidth", P::NoteWidth(None)),
        ("idleImageTransform", P::IdleImageTransform(None)),
        ("activeImageTransform", P::ActiveImageTransform(None)),
    ];
    for (tag, expected_null) in cases {
        // value 키 자체가 없으면 None으로 통과하지 않고 거부
        assert!(
            serde_json::from_value::<EditorElementPropertyPatchV1>(json!({ "property": tag }))
                .is_err(),
            "expected missing value rejection for {tag}"
        );
        let decoded: EditorElementPropertyPatchV1 =
            serde_json::from_value(json!({ "property": tag, "value": null })).unwrap();
        assert_eq!(decoded, expected_null, "explicit null mismatch for {tag}");
    }
    let decoded: EditorElementPropertyPatchV1 = serde_json::from_value(json!({
        "property": "layerName",
        "value": "named"
    }))
    .unwrap();
    assert_eq!(decoded, P::LayerName(Some("named".to_string())));
}

#[test]
fn shadow_leaf_wire_requires_leaf_tag_and_exact_fields() {
    use serde_json::json;
    let decoded: EditorShadowLeafPatchV1 =
        serde_json::from_value(json!({ "leaf": "blur", "value": 4.5 })).unwrap();
    assert_eq!(decoded, EditorShadowLeafPatchV1::Blur(4.5));
    for invalid in [
        // 옛 one-key 형식
        json!({ "blur": 4.5 }),
        // leaf 누락
        json!({ "value": 4.5 }),
        // leaf 오타
        json!({ "leaf": "blr", "value": 4.5 }),
        // value 누락
        json!({ "leaf": "blur" }),
        // 추가 필드
        json!({ "leaf": "blur", "value": 4.5, "extra": 1 }),
        // 잘못된 값 타입
        json!({ "leaf": "offsetX", "value": "1" }),
    ] {
        assert!(
            serde_json::from_value::<EditorShadowLeafPatchV1>(invalid.clone()).is_err(),
            "expected shadow leaf rejection: {invalid}"
        );
    }
}

#[test]
fn image_transform_leaf_wire_requires_leaf_tag_and_exact_fields() {
    use serde_json::json;
    for (wire, expected) in [
        (
            json!({ "leaf": "offsetX", "value": -10.5 }),
            ImageTransformLeafPatchV1::OffsetX(-10.5),
        ),
        (
            json!({ "leaf": "offsetY", "value": 20.5 }),
            ImageTransformLeafPatchV1::OffsetY(20.5),
        ),
        (
            json!({ "leaf": "rotation", "value": 45.0 }),
            ImageTransformLeafPatchV1::Rotation(45.0),
        ),
        (
            json!({ "leaf": "scale", "value": 1.25 }),
            ImageTransformLeafPatchV1::Scale(1.25),
        ),
    ] {
        let decoded: ImageTransformLeafPatchV1 = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(decoded, expected);
        assert_eq!(serde_json::to_value(decoded).unwrap(), wire);
    }
    for invalid in [
        json!({ "scale": 1.0 }),
        json!({ "value": 1.0 }),
        json!({ "leaf": "zoom", "value": 1.0 }),
        json!({ "leaf": "scale" }),
        json!({ "leaf": "scale", "value": 1.0, "extra": true }),
        json!({ "leaf": "offsetX", "value": "1" }),
    ] {
        assert!(
            serde_json::from_value::<ImageTransformLeafPatchV1>(invalid.clone()).is_err(),
            "expected image transform leaf rejection: {invalid}"
        );
    }
}

#[test]
fn editor_request_detects_every_direct_key_mapping_mutation() {
    let request =
        |changes: Option<EditorPatchV1>, ops: Option<Vec<EditorOpV1>>| EditorCommitRequest {
            base_revision: 0,
            mutation_id: uuid::Uuid::new_v4().to_string(),
            multi_key: false,
            gesture_id: None,
            gesture_ids: Vec::new(),
            changes,
            ops_version: ops.as_ref().map(|_| EDITOR_OPS_VERSION),
            ops,
        };

    let key_patch = EditorPatchV1 {
        keys: Some(KeyMappings::new()),
        ..EditorPatchV1::default()
    };
    assert!(request(Some(key_patch), None).may_change_keys());
    assert!(request(
        None,
        Some(vec![EditorOpV1::SetKeySlot {
            id: uuid::Uuid::new_v4().to_string(),
            slot: EditorFrozenKeySlotV1::Single("A".to_string()),
        }]),
    )
    .may_change_keys());
    assert!(request(
        None,
        Some(vec![EditorOpV1::DeleteElement {
            element_type: EditorElementTypeV1::Key,
            id: uuid::Uuid::new_v4().to_string(),
        }]),
    )
    .may_change_keys());
    assert!(!request(
        None,
        Some(vec![EditorOpV1::SetBounds {
            element_type: EditorElementTypeV1::Key,
            id: uuid::Uuid::new_v4().to_string(),
            bounds: EditorBoundsV1 {
                dx: 1.0,
                dy: 2.0,
                width: 60.0,
                height: 60.0,
            },
        }]),
    )
    .may_change_keys());
}
