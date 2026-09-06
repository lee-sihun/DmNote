use crate::{
    defaults::default_keys,
    models::{
        AppStoreData, EditorElementGroupTargetV1, EditorElementPropertyPatchV1,
        EditorFrozenElementV1, EditorFrozenGroupV1, EditorFrozenKeySlotV1, EditorGroupUpdateV1,
        EditorOpResultStatusV1, EditorOpV1, EditorTargetGroupV1, EditorZUpdateV1, GraphPosition,
        GraphStatType, GraphType, KeyPosition, KnobPosition, LayerGroupDef, ReactiveSpritePosition,
        SpriteAnchor, SpriteImageMetrics, SpritePose, SpriteReferenceNaturalSize, SpriteTransform,
        StatPosition, StatType,
    },
    state::editor::{MAX_ABS_COORDINATE, MAX_DIMENSION},
    state::native_element_id::{
        backfill_store_element_ids, DUPLICATE_ELEMENT_ID, INVALID_ELEMENT_ID,
    },
};

use super::*;

const SPRITE_RESIZE_SCALE_PARITY_FIXTURE: &str =
    include_str!("../../../../tests/fixtures/sprite-resize-scale-parity.json");

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SpriteResizeScaleParityFixture {
    version: u16,
    comment: String,
    ranges: SpriteResizeScaleParityRanges,
    cases: Vec<SpriteResizeScaleParityCase>,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct SpriteResizeScaleParityRanges {
    offset: [f64; 2],
}

#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum SpriteResizeScaleParityField {
    Ratio,
    Offset,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SpriteResizeScaleParityCase {
    name: String,
    field: SpriteResizeScaleParityField,
    prev: f64,
    next: f64,
    value: Option<f64>,
    #[serde(rename = "expected")]
    _expected: f64,
    expected_hex: String,
}

fn resize_sprite_op(id: impl Into<String>, bounds: EditorBoundsV1) -> EditorOpV1 {
    EditorOpV1::ResizeSprite {
        id: id.into(),
        bounds,
    }
}

fn sprite_bounds(position: &ReactiveSpritePosition) -> EditorBoundsV1 {
    EditorBoundsV1 {
        dx: position.dx,
        dy: position.dy,
        width: position.width,
        height: position.height,
    }
}

#[test]
fn sprite_resize_scale_math_matches_shared_fixture_bits() {
    let fixture: SpriteResizeScaleParityFixture =
        serde_json::from_str(SPRITE_RESIZE_SCALE_PARITY_FIXTURE).unwrap();
    assert_eq!(fixture.version, 1);
    assert!(!fixture.comment.is_empty());
    assert_eq!(
        fixture.ranges.offset,
        [SPRITE_TRANSFORM_OFFSET_MIN, SPRITE_TRANSFORM_OFFSET_MAX]
    );
    for case in fixture.cases {
        let expected_bits = u64::from_str_radix(
            case.expected_hex
                .strip_prefix("0x")
                .expect("expectedHex must use the 0x prefix"),
            16,
        )
        .expect("expectedHex must contain IEEE754 f64 bits");
        let ratio = sprite_resize_ratio(case.prev, case.next);
        let actual = match case.field {
            SpriteResizeScaleParityField::Ratio => ratio,
            SpriteResizeScaleParityField::Offset => scale_sprite_resize_value(
                case.value.expect("scaled case must contain value"),
                ratio,
            ),
        };
        assert_eq!(
            actual.to_bits(),
            expected_bits,
            "case {} result bits",
            case.name
        );
    }
}

fn base_store() -> AppStoreData {
    let mut store = AppStoreData {
        keys: default_keys().clone(),
        key_positions: default_keys()
            .iter()
            .map(|(mode, keys)| (mode.clone(), vec![KeyPosition::default(); keys.len()]))
            .collect(),
        ..AppStoreData::default()
    };
    backfill_store_element_ids(&mut store);
    store
}

fn store_with_sprite() -> AppStoreData {
    let mut store = base_store();
    store
        .sprite_positions
        .insert("4key".to_string(), vec![ReactiveSpritePosition::default()]);
    backfill_store_element_ids(&mut store);
    store
}

fn insert_op(store: &AppStoreData) -> EditorOpV1 {
    let mut position = KeyPosition {
        id: uuid::Uuid::new_v4().to_string(),
        dx: 100.0,
        dy: 120.0,
        z_index: Some(50),
        group_id: Some("frozen-group".to_string()),
        ..KeyPosition::default()
    };
    position.width = 90.0;
    EditorOpV1::InsertFrozenElements {
        mode: "4key".to_string(),
        elements: vec![EditorFrozenElementV1::Key {
            slot: EditorFrozenKeySlotV1::Single("FROZEN".to_string()),
            position,
        }],
        groups: vec![EditorFrozenGroupV1 {
            id: "frozen-group".to_string(),
            name: "Frozen Group".to_string(),
        }],
        z_updates: vec![EditorZUpdateV1 {
            element_type: EditorElementTypeV1::Key,
            id: store.key_positions["4key"][0].id.clone(),
            z_index: 1,
        }],
    }
}

fn store_with_every_reorder_type() -> AppStoreData {
    let mut store = base_store();
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
            axis_id: "axis".to_string(),
            sensitivity: 1.0,
            reverse: false,
            position: KeyPosition::default(),
        }],
    );
    store
        .sprite_positions
        .insert("4key".to_string(), vec![ReactiveSpritePosition::default()]);
    backfill_store_element_ids(&mut store);
    store
}

fn complete_reorder_op(store: &AppStoreData) -> EditorOpV1 {
    let mut z_updates = Vec::new();
    for (element_type, ids) in [
        (
            EditorElementTypeV1::Key,
            store.key_positions["4key"]
                .iter()
                .map(|position| position.id.clone())
                .collect::<Vec<_>>(),
        ),
        (
            EditorElementTypeV1::Stat,
            store.stat_positions["4key"]
                .iter()
                .map(|position| position.position.id.clone())
                .collect(),
        ),
        (
            EditorElementTypeV1::Graph,
            store.graph_positions["4key"]
                .iter()
                .map(|position| position.position.id.clone())
                .collect(),
        ),
        (
            EditorElementTypeV1::Knob,
            store.knob_positions["4key"]
                .iter()
                .map(|position| position.position.id.clone())
                .collect(),
        ),
        (
            EditorElementTypeV1::Sprite,
            store.sprite_positions["4key"]
                .iter()
                .map(|position| position.id.clone())
                .collect(),
        ),
    ] {
        for id in ids {
            z_updates.push(EditorZUpdateV1 {
                element_type,
                id,
                z_index: z_updates.len() as i32 + 10,
            });
        }
    }
    EditorOpV1::ReorderElements {
        mode: "4key".to_string(),
        complete_mode_order: true,
        z_updates,
        group_updates: Vec::new(),
    }
}

fn patch_hidden_op(
    element_type: EditorElementTypeV1,
    id: impl Into<String>,
    hidden: bool,
) -> EditorOpV1 {
    EditorOpV1::PatchElement {
        element_type,
        id: id.into(),
        patch: EditorElementPropertyPatchV1::Hidden(hidden),
    }
}

fn patch_layer_name_op(
    element_type: EditorElementTypeV1,
    id: impl Into<String>,
    layer_name: Option<&str>,
) -> EditorOpV1 {
    EditorOpV1::PatchElement {
        element_type,
        id: id.into(),
        patch: EditorElementPropertyPatchV1::LayerName(layer_name.map(str::to_string)),
    }
}

fn patch_graph_type_op(
    element_type: EditorElementTypeV1,
    id: impl Into<String>,
    graph_type: GraphType,
) -> EditorOpV1 {
    EditorOpV1::PatchElement {
        element_type,
        id: id.into(),
        patch: EditorElementPropertyPatchV1::GraphType(graph_type),
    }
}

fn patch_graph_color_op(
    element_type: EditorElementTypeV1,
    id: impl Into<String>,
    graph_color: impl Into<String>,
) -> EditorOpV1 {
    EditorOpV1::PatchElement {
        element_type,
        id: id.into(),
        patch: EditorElementPropertyPatchV1::GraphColor(graph_color.into()),
    }
}

fn patch_property_op(
    element_type: EditorElementTypeV1,
    id: impl Into<String>,
    patch: EditorElementPropertyPatchV1,
) -> EditorOpV1 {
    EditorOpV1::PatchElement {
        element_type,
        id: id.into(),
        patch,
    }
}

fn validation_code(error: &EditorCommitError) -> Option<&str> {
    error
        .details
        .as_ref()
        .and_then(|details| details.validation_code.as_deref())
}

fn assert_note_body_glow_paint_equal(position: &KeyPosition) {
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

fn paint_descriptor(
    color: &str,
    gradient: Option<(f64, &[(&str, f64)])>,
) -> crate::models::EditorPaintDescriptorV1 {
    crate::models::EditorPaintDescriptorV1 {
        color: color.to_string(),
        gradient: gradient.map(|(angle, stops)| crate::models::EditorPaintGradientV1 {
            angle,
            stops: stops
                .iter()
                .map(|(color, pos)| crate::models::EditorPaintGradientStopV1 {
                    color: (*color).to_string(),
                    pos: *pos,
                })
                .collect(),
        }),
    }
}

#[test]
fn property_patch_pair_fallback_and_apply_noop_bool_are_stable() {
    let descriptor = paint_descriptor(
        "idle-first",
        Some((45.0, &[("idle-first", 0.0), ("idle-last", 1.0)])),
    );
    let expected_gradient = descriptor
        .gradient
        .as_ref()
        .map(EditorPaintGradientV1::to_gradient_spec);
    let mut position = KeyPosition {
        background_color: Some(descriptor.color.clone()),
        background_gradient: expected_gradient.clone(),
        active_background_color: Some("   ".to_string()),
        active_background_gradient: None,
        ..KeyPosition::default()
    };

    assert!(preserve_active_paint_fallback(
        &mut position,
        PaintSurface::Background
    ));
    assert_eq!(position.active_background_color, position.background_color);
    assert_eq!(
        position.active_background_gradient,
        position.background_gradient
    );
    assert!(!preserve_active_paint_fallback(
        &mut position,
        PaintSurface::Background
    ));

    let mut color = position.active_background_color.clone();
    let mut gradient = position.active_background_gradient.clone();
    assert!(!apply_paint_descriptor(
        &mut color,
        &mut gradient,
        &descriptor
    ));

    let replacement = paint_descriptor("replacement", None);
    assert!(apply_paint_descriptor(
        &mut color,
        &mut gradient,
        &replacement
    ));
    assert_eq!(color.as_deref(), Some("replacement"));
    assert!(gradient.is_none());
    assert!(!apply_paint_descriptor(
        &mut color,
        &mut gradient,
        &replacement
    ));

    position.active_background_color = Some("explicit-active".to_string());
    position.active_background_gradient = None;
    position.background_color = Some("new-idle".to_string());
    position.background_gradient = None;
    assert!(!preserve_active_paint_fallback(
        &mut position,
        PaintSurface::Background
    ));
    assert_eq!(
        position.active_background_color.as_deref(),
        Some("explicit-active")
    );
}

#[test]
fn property_patch_validation_precedence_and_synced_note_noop_are_stable() {
    let store = base_store();
    let original = store.clone();
    let invalid_descriptor = paint_descriptor(
        "mismatched-representative",
        Some((360.0, &[("first", 0.0), ("last", 1.0)])),
    );
    let error = prepare_editor_ops_transition(
        &store,
        &[
            patch_property_op(
                EditorElementTypeV1::Key,
                &store.key_positions["4key"][0].id,
                EditorElementPropertyPatchV1::Hidden(true),
            ),
            patch_property_op(
                EditorElementTypeV1::Key,
                uuid::Uuid::new_v4().to_string(),
                EditorElementPropertyPatchV1::BackgroundPaint(invalid_descriptor),
            ),
        ],
    )
    .unwrap_err();
    assert_eq!(validation_code(&error), Some("INVALID_PAINT_GRADIENT"));
    assert_eq!(
        error.message,
        "paint gradient angle must be finite and canonical between 0 and 360"
    );
    assert_eq!(store, original);

    let mut synced_store = base_store();
    let id = synced_store.key_positions["4key"][0].id.clone();
    let position = &mut synced_store.key_positions.get_mut("4key").unwrap()[0];
    position.note_color = NoteColor::Solid("same-note".to_string());
    position.note_gradient = None;
    position.note_glow_sync_paint = true;
    assert!(position.mirror_note_body_to_glow());
    let synced_original = synced_store.clone();
    let op = patch_property_op(
        EditorElementTypeV1::Key,
        id,
        EditorElementPropertyPatchV1::NotePaint(EditorNotePaintIntentV1::Color(
            crate::models::EditorNotePaintColorIntentV1 {
                color: EditorNoteColorV1::Solid("same-note".to_string()),
            },
        )),
    );
    let transition = prepare_editor_ops_transition(&synced_store, &[op]).unwrap();
    assert_eq!(
        transition.op_results[0].status,
        EditorOpResultStatusV1::NoChange
    );
    assert!(transition.changed_fields.is_empty());
    assert_eq!(
        transition.candidate,
        EditorDocumentV1::from_store(&synced_original)
    );
}

fn counter_fill_solid(color: &str) -> EditorCounterFillIntentV1 {
    EditorCounterFillIntentV1::Solid(crate::models::EditorCounterFillSolidIntentV1 {
        color: color.to_string(),
    })
}

fn counter_fill_gradient(
    color: &str,
    angle: f64,
    stops: &[(&str, f64)],
) -> EditorCounterFillIntentV1 {
    EditorCounterFillIntentV1::Gradient(crate::models::EditorCounterFillGradientIntentV1 {
        color: color.to_string(),
        gradient: crate::models::EditorPaintGradientV1 {
            angle,
            stops: stops
                .iter()
                .map(|(color, pos)| crate::models::EditorPaintGradientStopV1 {
                    color: (*color).to_string(),
                    pos: *pos,
                })
                .collect(),
        },
    })
}

fn shadow_leaf_color(color: &str) -> EditorShadowLeafPatchV1 {
    EditorShadowLeafPatchV1::Color(color.to_string())
}

fn shadow_leaf_offset_x(offset_x: f64) -> EditorShadowLeafPatchV1 {
    EditorShadowLeafPatchV1::OffsetX(offset_x)
}

fn shadow_leaf_offset_y(offset_y: f64) -> EditorShadowLeafPatchV1 {
    EditorShadowLeafPatchV1::OffsetY(offset_y)
}

fn shadow_leaf_blur(blur: f64) -> EditorShadowLeafPatchV1 {
    EditorShadowLeafPatchV1::Blur(blur)
}

struct PatchTargetMatrixRow {
    name: &'static str,
    allowed: &'static [EditorElementTypeV1],
    patch: EditorElementPropertyPatchV1,
}

// 속성 계열 × elementType 허용 매트릭스 - TS validator(src/types/editor.ts)와 동일 집합
fn patch_target_type_matrix() -> Vec<PatchTargetMatrixRow> {
    use crate::models::{
        EditorNoteBorderSideV1, ImageFit, ImageMode, ImageTransformLeafPatchV1, KeyCounterAlign,
        KeyCounterAlignMode, KeyCounterPlacement, NoteAlignment, StatType,
    };
    use EditorElementPropertyPatchV1 as Patch;
    use EditorElementTypeV1::{Graph, Key, Knob, Sprite, Stat};

    const ALL: &[EditorElementTypeV1] = &[Key, Stat, Graph, Knob, Sprite];
    const KEY_POSITION_TYPES: &[EditorElementTypeV1] = &[Key, Stat, Graph, Knob];
    const GRAPH_ONLY: &[EditorElementTypeV1] = &[Graph];
    const KNOB_ONLY: &[EditorElementTypeV1] = &[Knob];
    const STAT_ONLY: &[EditorElementTypeV1] = &[Stat];
    const KEY_ONLY: &[EditorElementTypeV1] = &[Key];
    const KEY_STAT: &[EditorElementTypeV1] = &[Key, Stat];
    const KEY_KNOB: &[EditorElementTypeV1] = &[Key, Knob];
    const KEY_STAT_KNOB: &[EditorElementTypeV1] = &[Key, Stat, Knob];

    let row = |name, allowed, patch| PatchTargetMatrixRow {
        name,
        allowed,
        patch,
    };
    let note_opacity = |opacity| {
        EditorNotePaintIntentV1::Opacity(crate::models::EditorNotePaintOpacityIntentV1 { opacity })
    };
    vec![
        row("hidden", ALL, Patch::Hidden(true)),
        row(
            "layerName",
            ALL,
            Patch::LayerName(Some("layer".to_string())),
        ),
        row("graphType", GRAPH_ONLY, Patch::GraphType(GraphType::Bar)),
        row(
            "graphColor",
            GRAPH_ONLY,
            Patch::GraphColor("#336699".to_string()),
        ),
        row("showAvgLine", GRAPH_ONLY, Patch::ShowAvgLine(false)),
        row(
            "graphAnimationEnabled",
            GRAPH_ONLY,
            Patch::GraphAnimationEnabled(true),
        ),
        row("graphSpeed", GRAPH_ONLY, Patch::GraphSpeed(120)),
        row("reverse", KNOB_ONLY, Patch::Reverse(true)),
        row("sensitivity", KNOB_ONLY, Patch::Sensitivity(1.5)),
        row("axisId", KNOB_ONLY, Patch::AxisId("axis-2".to_string())),
        row("useInlineStyles", ALL, Patch::UseInlineStyles(true)),
        row("fontWeight", KEY_POSITION_TYPES, Patch::FontWeight(700)),
        row("fontBold", KEY_POSITION_TYPES, Patch::FontBold(true)),
        row("fontItalic", KEY_POSITION_TYPES, Patch::FontItalic(true)),
        row(
            "fontUnderline",
            KEY_POSITION_TYPES,
            Patch::FontUnderline(true),
        ),
        row(
            "fontStrikethrough",
            KEY_POSITION_TYPES,
            Patch::FontStrikethrough(true),
        ),
        row(
            "fontFamily",
            KEY_POSITION_TYPES,
            Patch::FontFamily("Sans".to_string()),
        ),
        row(
            "displayText",
            KEY_POSITION_TYPES,
            Patch::DisplayText("A".to_string()),
        ),
        row("className", ALL, Patch::ClassName("custom".to_string())),
        row(
            "fontPaint",
            KEY_STAT,
            Patch::FontPaint(paint_descriptor("#ffffff", None)),
        ),
        row(
            "activeFontPaint",
            KEY_ONLY,
            Patch::ActiveFontPaint(paint_descriptor("#ff0000", None)),
        ),
        row(
            "shadow",
            KEY_STAT_KNOB,
            Patch::Shadow(shadow_leaf_color("#000000")),
        ),
        row(
            "activeShadow",
            KEY_KNOB,
            Patch::ActiveShadow(shadow_leaf_color("#000000")),
        ),
        row("shadowEnabled", KEY_STAT_KNOB, Patch::ShadowEnabled(true)),
        row(
            "backgroundPaint",
            KEY_POSITION_TYPES,
            Patch::BackgroundPaint(paint_descriptor("#112233", None)),
        ),
        row(
            "activeBackgroundPaint",
            KEY_KNOB,
            Patch::ActiveBackgroundPaint(paint_descriptor("#112233", None)),
        ),
        row(
            "borderPaint",
            KEY_POSITION_TYPES,
            Patch::BorderPaint(paint_descriptor("#112233", None)),
        ),
        row(
            "activeBorderPaint",
            KEY_KNOB,
            Patch::ActiveBorderPaint(paint_descriptor("#112233", None)),
        ),
        row("borderWidth", KEY_POSITION_TYPES, Patch::BorderWidth(2.0)),
        row("borderRadius", KEY_POSITION_TYPES, Patch::BorderRadius(8.0)),
        row("fontSize", KEY_POSITION_TYPES, Patch::FontSize(16.0)),
        row(
            "inactiveImage",
            KEY_POSITION_TYPES,
            Patch::InactiveImage("idle.png".to_string()),
        ),
        row(
            "activeImage",
            KEY_KNOB,
            Patch::ActiveImage("active.png".to_string()),
        ),
        row(
            "idleTransparent",
            KEY_POSITION_TYPES,
            Patch::IdleTransparent(true),
        ),
        row(
            "activeTransparent",
            KEY_KNOB,
            Patch::ActiveTransparent(true),
        ),
        row(
            "idleImageFit",
            KEY_POSITION_TYPES,
            Patch::IdleImageFit(ImageFit::Contain),
        ),
        row(
            "activeImageFit",
            KEY_KNOB,
            Patch::ActiveImageFit(ImageFit::Fill),
        ),
        row("imageMode", KEY_ONLY, Patch::ImageMode(ImageMode::Overlay)),
        row(
            "idleImageTransform",
            KEY_ONLY,
            Patch::IdleImageTransform(Some(ImageTransformLeafPatchV1::OffsetX(10.0))),
        ),
        row(
            "activeImageTransform",
            KEY_ONLY,
            Patch::ActiveImageTransform(Some(ImageTransformLeafPatchV1::Scale(1.5))),
        ),
        row(
            "soundPath",
            KEY_ONLY,
            Patch::SoundPath("sound.mp3".to_string()),
        ),
        row("soundEnabled", KEY_ONLY, Patch::SoundEnabled(true)),
        row("soundVolume", KEY_ONLY, Patch::SoundVolume(80.0)),
        row("counterEnabled", KEY_STAT, Patch::CounterEnabled(true)),
        row(
            "counterAnimationEnabled",
            KEY_STAT,
            Patch::CounterAnimationEnabled(true),
        ),
        row(
            "counterPlacement",
            KEY_STAT,
            Patch::CounterPlacement(KeyCounterPlacement::Outside),
        ),
        row(
            "counterAlign",
            KEY_STAT,
            Patch::CounterAlign(KeyCounterAlign::Top),
        ),
        row(
            "counterAlignMode",
            KEY_STAT,
            Patch::CounterAlignMode(KeyCounterAlignMode::Between),
        ),
        row("counterGap", KEY_STAT, Patch::CounterGap(4)),
        row("counterFontSize", KEY_STAT, Patch::CounterFontSize(14)),
        row("counterFontWeight", KEY_STAT, Patch::CounterFontWeight(500)),
        row("counterFontBold", KEY_STAT, Patch::CounterFontBold(true)),
        row(
            "counterFontItalic",
            KEY_STAT,
            Patch::CounterFontItalic(true),
        ),
        row(
            "counterFontUnderline",
            KEY_STAT,
            Patch::CounterFontUnderline(true),
        ),
        row(
            "counterFontStrikethrough",
            KEY_STAT,
            Patch::CounterFontStrikethrough(true),
        ),
        row(
            "counterFontFamily",
            KEY_STAT,
            Patch::CounterFontFamily("Sans".to_string()),
        ),
        row(
            "counterFillIdle",
            KEY_STAT,
            Patch::CounterFillIdle(counter_fill_solid("#ffffff")),
        ),
        row(
            "counterFillActive",
            KEY_ONLY,
            Patch::CounterFillActive(counter_fill_solid("#ffffff")),
        ),
        row(
            "counterAnimationPreset",
            KEY_STAT,
            Patch::CounterAnimationPreset(EditorCounterAnimationPresetIntentV1 {
                preset_id: "builtin-ease-out".to_string(),
                apply_preset_id: None,
                bezier: None,
                scale: None,
                duration_ms: None,
            }),
        ),
        row("statType", STAT_ONLY, Patch::StatType(StatType::Total)),
        row(
            "noteEffectEnabled",
            KEY_ONLY,
            Patch::NoteEffectEnabled(true),
        ),
        row("noteGlowEnabled", KEY_ONLY, Patch::NoteGlowEnabled(true)),
        row(
            "noteGlowSyncPaint",
            KEY_ONLY,
            Patch::NoteGlowSyncPaint(true),
        ),
        row("noteGlowSize", KEY_ONLY, Patch::NoteGlowSize(10.0)),
        row("notePaint", KEY_ONLY, Patch::NotePaint(note_opacity(80))),
        row(
            "noteGlowPaint",
            KEY_ONLY,
            Patch::NoteGlowPaint(note_opacity(60)),
        ),
        row(
            "noteBorderPaint",
            KEY_ONLY,
            Patch::NoteBorderPaint(crate::models::EditorNoteBorderPaintV1 {
                color: "#112233".to_string(),
                opacity: 80,
                gradient: None,
            }),
        ),
        row("noteOffsetX", KEY_ONLY, Patch::NoteOffsetX(Some(10.0))),
        row("noteOffsetY", KEY_ONLY, Patch::NoteOffsetY(Some(-10.0))),
        row("noteWidth", KEY_ONLY, Patch::NoteWidth(Some(40.0))),
        row("noteBorderWidth", KEY_ONLY, Patch::NoteBorderWidth(2.0)),
        row("noteBorderRadius", KEY_ONLY, Patch::NoteBorderRadius(8.0)),
        row(
            "noteAutoYCorrection",
            KEY_ONLY,
            Patch::NoteAutoYCorrection(true),
        ),
        row(
            "noteAlignment",
            KEY_ONLY,
            Patch::NoteAlignment(NoteAlignment::Left),
        ),
        row(
            "noteBorderSide",
            KEY_ONLY,
            Patch::NoteBorderSide(EditorNoteBorderSideV1::Vertical),
        ),
        row("rotation", KEY_POSITION_TYPES, Patch::Rotation(45.5)),
    ]
}

#[test]
fn patch_target_type_matrix_pins_all_variant_constraints() {
    let store = store_with_every_reorder_type();
    let target_id = |element_type: EditorElementTypeV1| match element_type {
        EditorElementTypeV1::Key => store.key_positions["4key"][0].id.clone(),
        EditorElementTypeV1::Stat => store.stat_positions["4key"][0].position.id.clone(),
        EditorElementTypeV1::Graph => store.graph_positions["4key"][0].position.id.clone(),
        EditorElementTypeV1::Knob => store.knob_positions["4key"][0].position.id.clone(),
        EditorElementTypeV1::Sprite => store.sprite_positions["4key"][0].id.clone(),
    };
    let rows = patch_target_type_matrix();

    // 전수 고정. 개수 리터럴은 강제가 아니다 - variant를 추가하고 매트릭스
    // 행을 빠뜨리면 개수만 맞춰도 통과한다. wire 태그 집합과 대조해
    // "모든 variant가 매트릭스에 있다"를 실제로 강제한다
    let row_tags = rows
        .iter()
        .map(|row| {
            serde_json::to_value(&row.patch).expect("patch must serialize")["property"]
                .as_str()
                .expect("adjacently tagged patch must carry property")
                .to_string()
        })
        .collect::<std::collections::BTreeSet<_>>();
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../tests/fixtures/editor-property-tags.json"
    ))
    .expect("property tag fixture must be valid json");
    let wire_tags = fixture["properties"]
        .as_array()
        .expect("fixture.properties must be an array")
        .iter()
        .map(|tag| {
            tag.as_str()
                .expect("property tag must be a string")
                .to_string()
        })
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(row_tags, wire_tags, "매트릭스 행과 wire 태그 집합이 다르다");
    assert_eq!(rows.len(), row_tags.len(), "매트릭스에 중복 variant가 있다");
    let distinct = rows
        .iter()
        .map(|row| std::mem::discriminant(&row.patch))
        .collect::<HashSet<_>>();
    assert_eq!(distinct.len(), rows.len());

    for row in &rows {
        for element_type in [
            EditorElementTypeV1::Key,
            EditorElementTypeV1::Stat,
            EditorElementTypeV1::Graph,
            EditorElementTypeV1::Knob,
            EditorElementTypeV1::Sprite,
        ] {
            // 선언 타입과 실제 요소 타입을 일치시켜 계열 제약만 판정되게 고정
            let ops = [patch_property_op(
                element_type,
                target_id(element_type),
                row.patch.clone(),
            )];
            let result = prepare_editor_ops_transition(&store, &ops);
            if row.allowed.contains(&element_type) {
                // 값은 전부 유효하므로 전체 성공이 곧 타입 검증 통과 증명
                assert!(
                    result.is_ok(),
                    "{} on {element_type:?} must pass: {:?}",
                    row.name,
                    result.err(),
                );
            } else {
                let Err(error) = result else {
                    panic!("{} on {element_type:?} must be rejected", row.name);
                };
                assert_eq!(
                    validation_code(&error),
                    Some("ELEMENT_TYPE_MISMATCH"),
                    "{} on {element_type:?}",
                    row.name,
                );
            }
        }
    }
}

#[test]
fn sprite_patch_element_allows_only_generic_properties() {
    let mut store = store_with_sprite();
    let sprite_id = store.sprite_positions["4key"][0].id.clone();
    for patch in [
        EditorElementPropertyPatchV1::Hidden(true),
        EditorElementPropertyPatchV1::LayerName(Some("sprite layer".to_string())),
        EditorElementPropertyPatchV1::ClassName("sprite-class".to_string()),
        EditorElementPropertyPatchV1::UseInlineStyles(true),
    ] {
        let transition = prepare_editor_ops_transition(
            &store,
            &[patch_property_op(
                EditorElementTypeV1::Sprite,
                &sprite_id,
                patch,
            )],
        )
        .unwrap();
        assert_eq!(
            transition.op_results[0].status,
            EditorOpResultStatusV1::Applied
        );
        assert_eq!(transition.changed_fields, [EditorField::SpritePositions]);
        store = transition.scratch;
    }

    let sprite = &store.sprite_positions["4key"][0];
    assert!(sprite.hidden);
    assert_eq!(sprite.layer_name.as_deref(), Some("sprite layer"));
    assert_eq!(sprite.class_name.as_deref(), Some("sprite-class"));
    assert_eq!(sprite.use_inline_styles, Some(true));

    let error = prepare_editor_ops_transition(
        &store,
        &[patch_property_op(
            EditorElementTypeV1::Sprite,
            &sprite_id,
            EditorElementPropertyPatchV1::InactiveImage("blocked.png".to_string()),
        )],
    )
    .unwrap_err();
    assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
}

#[test]
fn resize_sprite_wire_uses_only_kind_id_and_bounds() {
    let id = uuid::Uuid::new_v4().to_string();
    let bounds = EditorBoundsV1 {
        dx: 1.0,
        dy: 2.0,
        width: 300.0,
        height: 150.0,
    };
    let op = resize_sprite_op(&id, bounds);
    assert_eq!(
        serde_json::to_value(&op).unwrap(),
        serde_json::json!({
            "kind": "resizeSprite",
            "id": id,
            "bounds": {
                "dx": 1.0,
                "dy": 2.0,
                "width": 300.0,
                "height": 150.0,
            },
        })
    );
    assert!(serde_json::from_value::<EditorOpV1>(serde_json::json!({
        "kind": "resizeSprite",
        "id": uuid::Uuid::new_v4().to_string(),
        "bounds": {
            "dx": 1.0,
            "dy": 2.0,
            "width": 300.0,
            "height": 150.0,
        },
        "elementType": "sprite",
    }))
    .is_err());
}

#[test]
fn resize_sprite_scales_uniform_and_nonuniform_content() {
    let mut store = store_with_sprite();
    let position = &mut store.sprite_positions.get_mut("4key").unwrap()[0];
    position.dx = 10.0;
    position.dy = 20.0;
    position.width = 200.0;
    position.height = 100.0;
    position.pivot = SpriteAnchor { x: 0.25, y: 0.75 };
    position.idle_transform = SpriteTransform {
        x: 12.0,
        y: -6.0,
        rotation: 15.0,
        scale: 1.5,
    };
    position.poses = vec![SpritePose {
        pose_id: uuid::Uuid::new_v4().to_string(),
        transform: SpriteTransform {
            x: -30.0,
            y: 44.0,
            rotation: -90.0,
            scale: 0.5,
        },
        ..SpritePose::default()
    }];
    let original = position.clone();
    let id = position.id.clone();

    let nonuniform_bounds = EditorBoundsV1 {
        dx: 5.0,
        dy: 8.0,
        width: 400.0,
        height: 50.0,
    };
    let nonuniform =
        prepare_editor_ops_transition(&store, &[resize_sprite_op(&id, nonuniform_bounds)]).unwrap();
    let resized = &nonuniform.candidate.sprite_positions["4key"][0];
    assert_eq!(sprite_bounds(resized), nonuniform_bounds);
    assert_eq!(
        (resized.idle_transform.x, resized.idle_transform.y),
        (24.0, -3.0)
    );
    assert_eq!(
        (resized.poses[0].transform.x, resized.poses[0].transform.y),
        (-60.0, 22.0)
    );
    assert_eq!(
        resized.idle_transform.rotation,
        original.idle_transform.rotation
    );
    assert_eq!(resized.idle_transform.scale, original.idle_transform.scale);
    assert_eq!(
        resized.poses[0].transform.rotation,
        original.poses[0].transform.rotation
    );
    assert_eq!(
        resized.poses[0].transform.scale,
        original.poses[0].transform.scale
    );
    assert_eq!(resized.pivot, original.pivot);
    assert_eq!(
        nonuniform.op_results[0].status,
        EditorOpResultStatusV1::Applied
    );
    assert_eq!(nonuniform.op_results[0].bounds, Some(nonuniform_bounds));

    let uniform_bounds = EditorBoundsV1 {
        dx: -5.0,
        dy: -8.0,
        width: 400.0,
        height: 200.0,
    };
    let uniform =
        prepare_editor_ops_transition(&store, &[resize_sprite_op(id, uniform_bounds)]).unwrap();
    let resized = &uniform.candidate.sprite_positions["4key"][0];
    assert_eq!(
        (resized.idle_transform.x, resized.idle_transform.y),
        (24.0, -12.0)
    );
    assert_eq!(
        (resized.poses[0].transform.x, resized.poses[0].transform.y),
        (-60.0, 88.0)
    );
}

#[test]
fn resize_sprite_clamps_scaled_offsets_at_contract_boundaries() {
    let mut store = store_with_sprite();
    let position = &mut store.sprite_positions.get_mut("4key").unwrap()[0];
    position.width = 1.0;
    position.height = 1.0;
    position.idle_transform = SpriteTransform {
        x: 1.0,
        y: -1.0,
        ..SpriteTransform::default()
    };
    position.poses = vec![SpritePose {
        pose_id: uuid::Uuid::new_v4().to_string(),
        transform: SpriteTransform {
            x: -1.0,
            y: 1.0,
            ..SpriteTransform::default()
        },
        ..SpritePose::default()
    }];
    let id = position.id.clone();
    let bounds = EditorBoundsV1 {
        dx: MAX_ABS_COORDINATE,
        dy: -MAX_ABS_COORDINATE,
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
    };

    let transition =
        prepare_editor_ops_transition(&store, &[resize_sprite_op(id, bounds)]).unwrap();
    let resized = &transition.candidate.sprite_positions["4key"][0];
    assert_eq!(resized.idle_transform.x, SPRITE_TRANSFORM_OFFSET_MAX);
    assert_eq!(resized.idle_transform.y, SPRITE_TRANSFORM_OFFSET_MIN);
    assert_eq!(resized.poses[0].transform.x, SPRITE_TRANSFORM_OFFSET_MIN);
    assert_eq!(resized.poses[0].transform.y, SPRITE_TRANSFORM_OFFSET_MAX);
}

#[test]
fn resize_sprite_defends_zero_previous_dimensions_with_identity_ratios() {
    let mut position = ReactiveSpritePosition {
        width: 0.0,
        height: 0.0,
        idle_transform: SpriteTransform {
            x: 7.0,
            y: -8.0,
            ..SpriteTransform::default()
        },
        poses: vec![SpritePose {
            transform: SpriteTransform {
                x: 9.0,
                y: -10.0,
                ..SpriteTransform::default()
            },
            ..SpritePose::default()
        }],
        ..ReactiveSpritePosition::default()
    };
    let content_before = (position.idle_transform, position.poses.clone());
    let bounds = EditorBoundsV1 {
        dx: 11.0,
        dy: 12.0,
        width: 100.0,
        height: 200.0,
    };

    apply_sprite_resize(&mut position, &bounds);

    assert_eq!(sprite_bounds(&position), bounds);
    assert_eq!((position.idle_transform, position.poses,), content_before);
}

#[test]
fn resize_sprite_preserves_pivot_image_metadata() {
    let mut position = ReactiveSpritePosition {
        width: 200.0,
        height: 100.0,
        reference_natural_size: Some(SpriteReferenceNaturalSize {
            source: Some("/images/base.png".to_string()),
            width: 800,
            height: 600,
        }),
        poses: vec![SpritePose {
            image_override: Some("/images/pose.png".to_string()),
            image_override_metrics: Some(SpriteImageMetrics {
                source: "/images/pose.png".to_string(),
                width: 320,
                height: 240,
            }),
            ..SpritePose::default()
        }],
        ..ReactiveSpritePosition::default()
    };
    let metadata_before = (
        position.reference_natural_size.clone(),
        position.pivot,
        position.poses[0].image_override_metrics.clone(),
    );

    apply_sprite_resize(
        &mut position,
        &EditorBoundsV1 {
            dx: 10.0,
            dy: 20.0,
            width: 600.0,
            height: 250.0,
        },
    );

    assert_eq!(
        (
            position.reference_natural_size,
            position.pivot,
            position.poses[0].image_override_metrics.clone(),
        ),
        metadata_before
    );
}

#[test]
fn resize_sprite_reports_missing_and_no_change_with_bounds_contract() {
    let store = store_with_sprite();
    let position = &store.sprite_positions["4key"][0];
    let current_bounds = sprite_bounds(position);
    let current_document = EditorDocumentV1::from_store(&store);

    let no_change =
        prepare_editor_ops_transition(&store, &[resize_sprite_op(&position.id, current_bounds)])
            .unwrap();
    assert_eq!(no_change.candidate, current_document);
    assert_eq!(
        no_change.op_results[0].status,
        EditorOpResultStatusV1::NoChange
    );
    assert_eq!(no_change.op_results[0].bounds, Some(current_bounds));

    let missing = prepare_editor_ops_transition(
        &store,
        &[resize_sprite_op(
            uuid::Uuid::new_v4().to_string(),
            EditorBoundsV1 {
                dx: 20.0,
                dy: 30.0,
                width: 400.0,
                height: 250.0,
            },
        )],
    )
    .unwrap();
    assert_eq!(missing.candidate, current_document);
    assert_eq!(
        missing.op_results[0],
        EditorOpResultV1 {
            status: EditorOpResultStatusV1::TargetMissing,
            bounds: None,
        }
    );
}

#[test]
fn missing_bounds_targets_still_reject_invalid_bounds() {
    let store = store_with_sprite();
    let missing_id = uuid::Uuid::new_v4().to_string();
    let invalid_bounds = EditorBoundsV1 {
        dx: 20.0,
        dy: 30.0,
        width: 0.0,
        height: 250.0,
    };

    for op in [
        EditorOpV1::SetBounds {
            element_type: EditorElementTypeV1::Sprite,
            id: missing_id.clone(),
            bounds: invalid_bounds,
        },
        resize_sprite_op(missing_id.clone(), invalid_bounds),
    ] {
        let error = prepare_editor_ops_transition(&store, &[op]).unwrap_err();
        assert_eq!(validation_code(&error), Some("DIMENSION_OUT_OF_RANGE"));
    }
}

#[test]
fn sequential_sprite_resizes_use_candidate_bounds_for_each_ratio() {
    let mut store = store_with_sprite();
    let position = &mut store.sprite_positions.get_mut("4key").unwrap()[0];
    position.width = 200.0;
    position.height = 100.0;
    position.idle_transform = SpriteTransform {
        x: 10.0,
        y: -4.0,
        ..SpriteTransform::default()
    };
    position.poses = vec![SpritePose {
        pose_id: uuid::Uuid::new_v4().to_string(),
        transform: SpriteTransform {
            x: -6.0,
            y: 8.0,
            ..SpriteTransform::default()
        },
        ..SpritePose::default()
    }];
    let id = position.id.clone();
    let first_bounds = EditorBoundsV1 {
        dx: 10.0,
        dy: 20.0,
        width: 400.0,
        height: 200.0,
    };
    let second_bounds = EditorBoundsV1 {
        dx: -10.0,
        dy: -20.0,
        width: 100.0,
        height: 50.0,
    };

    let transition = prepare_editor_ops_transition(
        &store,
        &[
            resize_sprite_op(&id, first_bounds),
            resize_sprite_op(id, second_bounds),
        ],
    )
    .unwrap();
    let resized = &transition.candidate.sprite_positions["4key"][0];

    assert_eq!(sprite_bounds(resized), second_bounds);
    assert_eq!(
        (resized.idle_transform.x, resized.idle_transform.y),
        (5.0, -2.0)
    );
    assert_eq!(
        (resized.poses[0].transform.x, resized.poses[0].transform.y,),
        (-3.0, 4.0)
    );
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
        ]
    );
    assert_eq!(transition.op_results[1].bounds, Some(second_bounds));
}

#[test]
fn resize_sprite_type_mismatch_rejects_the_whole_mixed_batch() {
    let store = base_store();
    let before = store.clone();
    let first_id = store.key_positions["4key"][0].id.clone();
    let second_id = store.key_positions["4key"][1].id.clone();
    let error = prepare_editor_ops_transition(
        &store,
        &[
            EditorOpV1::SetBounds {
                element_type: EditorElementTypeV1::Key,
                id: first_id,
                bounds: EditorBoundsV1 {
                    dx: 100.0,
                    dy: 200.0,
                    width: 60.0,
                    height: 60.0,
                },
            },
            resize_sprite_op(
                second_id,
                EditorBoundsV1 {
                    dx: 10.0,
                    dy: 20.0,
                    width: 300.0,
                    height: 150.0,
                },
            ),
        ],
    )
    .unwrap_err();
    assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
    assert_eq!(store, before);
}

#[test]
fn sprite_set_bounds_updates_activity_bounds() {
    let store = store_with_sprite();
    let sprite_id = store.sprite_positions["4key"][0].id.clone();
    let bounds = EditorBoundsV1 {
        dx: 24.0,
        dy: -12.0,
        width: 360.0,
        height: 240.0,
    };
    let transition = prepare_editor_ops_transition(
        &store,
        &[EditorOpV1::SetBounds {
            element_type: EditorElementTypeV1::Sprite,
            id: sprite_id,
            bounds,
        }],
    )
    .unwrap();

    let sprite = &transition.candidate.sprite_positions["4key"][0];
    assert_eq!((sprite.dx, sprite.dy), (bounds.dx, bounds.dy));
    assert_eq!((sprite.width, sprite.height), (bounds.width, bounds.height));
    assert_eq!(transition.op_results[0].bounds, Some(bounds));
    assert_eq!(transition.changed_fields, [EditorField::SpritePositions]);
}

#[test]
fn sprite_delete_element_removes_sprite_and_its_empty_group() {
    let mut store = store_with_sprite();
    let sprite_id = store.sprite_positions["4key"][0].id.clone();
    store.sprite_positions.get_mut("4key").unwrap()[0].group_id = Some("sprite-group".to_string());
    store.layer_groups.insert(
        "4key".to_string(),
        vec![LayerGroupDef {
            id: "sprite-group".to_string(),
            name: "Sprite Group".to_string(),
        }],
    );

    let transition = prepare_editor_ops_transition(
        &store,
        &[EditorOpV1::DeleteElement {
            element_type: EditorElementTypeV1::Sprite,
            id: sprite_id,
        }],
    )
    .unwrap();

    assert!(transition.candidate.sprite_positions["4key"].is_empty());
    assert!(transition.candidate.layer_groups["4key"].is_empty());
    assert_eq!(
        transition.op_results[0].status,
        EditorOpResultStatusV1::Applied
    );
}

#[test]
fn sprite_reorder_elements_updates_z_index() {
    let store = store_with_sprite();
    let sprite_id = store.sprite_positions["4key"][0].id.clone();
    let transition = prepare_editor_ops_transition(
        &store,
        &[EditorOpV1::ReorderElements {
            mode: "4key".to_string(),
            complete_mode_order: false,
            z_updates: vec![EditorZUpdateV1 {
                element_type: EditorElementTypeV1::Sprite,
                id: sprite_id,
                z_index: 42,
            }],
            group_updates: Vec::new(),
        }],
    )
    .unwrap();

    assert_eq!(
        transition.candidate.sprite_positions["4key"][0].z_index,
        Some(42)
    );
    assert_eq!(
        transition.op_results[0].status,
        EditorOpResultStatusV1::Applied
    );
}

#[test]
fn sprite_set_element_groups_creates_and_assigns_group() {
    let store = store_with_sprite();
    let sprite_id = store.sprite_positions["4key"][0].id.clone();
    let transition = prepare_editor_ops_transition(
        &store,
        &[EditorOpV1::SetElementGroups {
            mode: "4key".to_string(),
            targets: vec![EditorElementGroupTargetV1 {
                element_type: EditorElementTypeV1::Sprite,
                id: sprite_id,
            }],
            target_group: Some(EditorTargetGroupV1::Create {
                id: "sprite-group".to_string(),
                name: "Sprite Group".to_string(),
            }),
        }],
    )
    .unwrap();

    assert_eq!(
        transition.candidate.sprite_positions["4key"][0]
            .group_id
            .as_deref(),
        Some("sprite-group")
    );
    assert_eq!(transition.candidate.layer_groups["4key"].len(), 1);
    assert_eq!(
        transition.op_results[0].status,
        EditorOpResultStatusV1::Applied
    );
}

#[test]
fn sprite_insert_frozen_elements_inserts_and_replays_idempotently() {
    let store = base_store();
    let sprite_id = uuid::Uuid::new_v4().to_string();
    let sprite = ReactiveSpritePosition {
        id: sprite_id.clone(),
        poses: vec![SpritePose {
            pose_id: uuid::Uuid::new_v4().to_string(),
            triggers: vec![store.key_positions["4key"][0].id.clone()],
            ..SpritePose::default()
        }],
        ..ReactiveSpritePosition::default()
    };
    let op = EditorOpV1::InsertFrozenElements {
        mode: "4key".to_string(),
        elements: vec![EditorFrozenElementV1::Sprite { position: sprite }],
        groups: Vec::new(),
        z_updates: Vec::new(),
    };
    let wire = serde_json::to_value(&op).unwrap();
    assert_eq!(wire["elements"][0]["elementType"], "sprite");
    assert_eq!(serde_json::from_value::<EditorOpV1>(wire).unwrap(), op);

    let inserted = prepare_editor_ops_transition(&store, std::slice::from_ref(&op)).unwrap();
    assert_eq!(inserted.candidate.sprite_positions["4key"][0].id, sprite_id);
    assert_eq!(
        inserted.op_results[0].status,
        EditorOpResultStatusV1::Applied
    );

    let replayed =
        prepare_editor_ops_transition(&inserted.scratch, std::slice::from_ref(&op)).unwrap();
    assert_eq!(
        replayed.op_results[0].status,
        EditorOpResultStatusV1::NoChange
    );
    assert_eq!(replayed.candidate, inserted.candidate);
}

#[test]
fn sprite_insert_frozen_elements_rejects_invalid_pose_id() {
    let store = base_store();
    let sprite = ReactiveSpritePosition {
        id: uuid::Uuid::new_v4().to_string(),
        poses: vec![SpritePose {
            pose_id: "not-a-uuid".to_string(),
            triggers: vec![store.key_positions["4key"][0].id.clone()],
            ..SpritePose::default()
        }],
        ..ReactiveSpritePosition::default()
    };
    let op = EditorOpV1::InsertFrozenElements {
        mode: "4key".to_string(),
        elements: vec![EditorFrozenElementV1::Sprite { position: sprite }],
        groups: Vec::new(),
        z_updates: Vec::new(),
    };

    let error = prepare_editor_ops_transition(&store, &[op]).unwrap_err();

    assert_eq!(validation_code(&error), Some(INVALID_ELEMENT_ID));
}

#[test]
fn sprite_insert_frozen_elements_rejects_cross_mode_duplicate_pose_id() {
    let mut store = store_with_sprite();
    let duplicate_pose_id = uuid::Uuid::new_v4().to_string();
    store.sprite_positions.get_mut("4key").unwrap()[0].poses = vec![SpritePose {
        pose_id: duplicate_pose_id.clone(),
        triggers: vec![store.key_positions["4key"][0].id.clone()],
        ..SpritePose::default()
    }];
    let sprite = ReactiveSpritePosition {
        id: uuid::Uuid::new_v4().to_string(),
        poses: vec![SpritePose {
            pose_id: duplicate_pose_id,
            triggers: vec![store.key_positions["5key"][0].id.clone()],
            ..SpritePose::default()
        }],
        ..ReactiveSpritePosition::default()
    };
    let op = EditorOpV1::InsertFrozenElements {
        mode: "5key".to_string(),
        elements: vec![EditorFrozenElementV1::Sprite { position: sprite }],
        groups: Vec::new(),
        z_updates: Vec::new(),
    };

    let error = prepare_editor_ops_transition(&store, &[op]).unwrap_err();

    assert_eq!(validation_code(&error), Some(DUPLICATE_ELEMENT_ID));
}

#[test]
fn frozen_insert_appends_key_pair_group_and_existing_z_as_one_transition() {
    let store = base_store();
    let op = insert_op(&store);
    let before_len = store.key_positions["4key"].len();

    let transition = prepare_editor_ops_transition(&store, std::slice::from_ref(&op)).unwrap();

    assert_eq!(
        transition.op_results,
        [EditorOpResultV1 {
            status: EditorOpResultStatusV1::Applied,
            bounds: None,
        }]
    );
    assert_eq!(transition.candidate.keys["4key"].len(), before_len + 1);
    assert_eq!(
        transition.candidate.key_positions["4key"].len(),
        before_len + 1
    );
    assert_eq!(
        transition.candidate.keys["4key"].last().unwrap(),
        &crate::models::KeySlot::Single("FROZEN".to_string())
    );
    assert_eq!(
        transition.candidate.key_positions["4key"][0].z_index,
        Some(1)
    );
    assert_eq!(transition.candidate.layer_groups["4key"].len(), 1);
    assert_eq!(
        transition.changed_fields,
        [
            EditorField::Keys,
            EditorField::KeyPositions,
            EditorField::LayerGroups,
        ]
    );

    let replay =
        prepare_editor_ops_transition(&transition.scratch, std::slice::from_ref(&op)).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay.op_results[0].status,
        EditorOpResultStatusV1::NoChange
    );
}

#[test]
fn frozen_insert_group_needs_a_native_or_plugin_member() {
    let store = base_store();
    // 삽입 요소가 그룹을 참조하지 않으면 거절
    let orphan = EditorOpV1::InsertFrozenElements {
        mode: "4key".to_string(),
        elements: vec![],
        groups: vec![EditorFrozenGroupV1 {
            id: "plugin-only-group".to_string(),
            name: "Plugin Only".to_string(),
        }],
        z_updates: vec![EditorZUpdateV1 {
            element_type: EditorElementTypeV1::Key,
            id: store.key_positions["4key"][0].id.clone(),
            z_index: 1,
        }],
    };
    let error = prepare_editor_ops_transition(&store, std::slice::from_ref(&orphan)).unwrap_err();
    assert_eq!(
        error
            .details
            .as_ref()
            .and_then(|details| details.validation_code.as_deref()),
        Some("UNREFERENCED_FROZEN_GROUP")
    );

    // 동봉 plugin_changes가 그 그룹의 멤버를 실었다면 생존해야 한다.
    // 구조 op는 단독 배치가 강제되므로 setElementGroups로 분리할 수 없다
    let mut plugin_refs = PluginGroupRefs::new();
    plugin_refs
        .entry("4key".to_string())
        .or_default()
        .insert("plugin-only-group".to_string());
    let transition = prepare_editor_ops_transition_with_plugin_refs(
        &store,
        std::slice::from_ref(&orphan),
        &plugin_refs,
    )
    .unwrap();
    assert_eq!(
        transition.candidate.layer_groups["4key"]
            .iter()
            .map(|group| group.id.as_str())
            .collect::<Vec<_>>(),
        ["plugin-only-group"]
    );
}

#[test]
fn frozen_insert_rejects_partial_or_different_existing_plan() {
    let store = base_store();
    let op = insert_op(&store);
    let mut partial = prepare_editor_ops_transition(&store, std::slice::from_ref(&op))
        .unwrap()
        .scratch;
    partial
        .key_positions
        .get_mut("4key")
        .unwrap()
        .last_mut()
        .unwrap()
        .width += 1.0;

    let error = prepare_editor_ops_transition(&partial, &[op]).unwrap_err();
    assert_eq!(validation_code(&error), Some("FROZEN_INSERT_CONFLICT"));
    assert_eq!(partial.key_positions["4key"].last().unwrap().width, 91.0);
}

#[test]
fn frozen_insert_appends_every_native_element_kind() {
    let store = base_store();
    let make_position = || KeyPosition {
        id: uuid::Uuid::new_v4().to_string(),
        ..KeyPosition::default()
    };
    let op = EditorOpV1::InsertFrozenElements {
        mode: "4key".to_string(),
        elements: vec![
            EditorFrozenElementV1::Key {
                slot: EditorFrozenKeySlotV1::Single("A".to_string()),
                position: make_position(),
            },
            EditorFrozenElementV1::Stat {
                position: StatPosition {
                    stat_type: StatType::Kps,
                    position: make_position(),
                },
            },
            EditorFrozenElementV1::Graph {
                position: GraphPosition {
                    stat_type: GraphStatType::Kps,
                    graph_type: GraphType::Line,
                    graph_speed: 100,
                    graph_color: "#123456".to_string(),
                    show_avg_line: true,
                    position: make_position(),
                },
            },
            EditorFrozenElementV1::Knob {
                position: KnobPosition {
                    axis_id: "axis".to_string(),
                    sensitivity: 1.0,
                    reverse: false,
                    position: make_position(),
                },
            },
        ],
        groups: Vec::new(),
        z_updates: Vec::new(),
    };

    let transition = prepare_editor_ops_transition(&store, &[op]).unwrap();
    assert_eq!(
        transition.changed_fields,
        [
            EditorField::Keys,
            EditorField::KeyPositions,
            EditorField::StatPositions,
            EditorField::GraphPositions,
            EditorField::KnobPositions,
        ]
    );
    assert_eq!(transition.candidate.stat_positions["4key"].len(), 1);
    assert_eq!(transition.candidate.graph_positions["4key"].len(), 1);
    assert_eq!(transition.candidate.knob_positions["4key"].len(), 1);
}

#[test]
fn frozen_insert_rejects_preexisting_group_as_partial_plan() {
    let mut store = base_store();
    store.layer_groups.insert(
        "4key".to_string(),
        vec![LayerGroupDef {
            id: "frozen-group".to_string(),
            name: "Frozen Group".to_string(),
        }],
    );
    let before = store.clone();

    let error = prepare_editor_ops_transition(&store, &[insert_op(&store)]).unwrap_err();
    assert_eq!(validation_code(&error), Some("FROZEN_INSERT_CONFLICT"));
    assert_eq!(store, before);
}

#[test]
fn frozen_insert_z_targets_are_exact_existing_type_and_mode() {
    let store = base_store();
    let op = insert_op(&store);
    let mut missing = op.clone();
    let EditorOpV1::InsertFrozenElements { z_updates, .. } = &mut missing else {
        unreachable!();
    };
    z_updates[0].id = uuid::Uuid::new_v4().to_string();
    assert_eq!(
        validation_code(&prepare_editor_ops_transition(&store, &[missing]).unwrap_err()),
        Some("FROZEN_INSERT_TARGET_MISSING")
    );

    let mut wrong_type = op.clone();
    let EditorOpV1::InsertFrozenElements { z_updates, .. } = &mut wrong_type else {
        unreachable!();
    };
    z_updates[0].element_type = EditorElementTypeV1::Graph;
    assert_eq!(
        validation_code(&prepare_editor_ops_transition(&store, &[wrong_type]).unwrap_err()),
        Some("ELEMENT_TYPE_MISMATCH")
    );

    let mut wrong_mode = op;
    let EditorOpV1::InsertFrozenElements { mode, .. } = &mut wrong_mode else {
        unreachable!();
    };
    *mode = "5key".to_string();
    assert_eq!(
        validation_code(&prepare_editor_ops_transition(&store, &[wrong_mode]).unwrap_err()),
        Some("FROZEN_INSERT_TARGET_MODE_MISMATCH")
    );
}

#[test]
fn frozen_insert_does_not_repair_a_malformed_key_pair() {
    let mut store = base_store();
    let op = insert_op(&store);
    store.keys.remove("4key");
    let before = store.clone();

    let error = prepare_editor_ops_transition(&store, &[op]).unwrap_err();
    assert!(matches!(
        validation_code(&error),
        Some("KEY_POSITION_MODE_MISMATCH" | "KEY_POSITION_LENGTH_MISMATCH")
    ));
    assert_eq!(store, before);
}

#[test]
fn frozen_insert_z_only_exact_plan_is_no_change() {
    let store = base_store();
    let target = &store.key_positions["4key"][0];
    let op = EditorOpV1::InsertFrozenElements {
        mode: "4key".to_string(),
        elements: Vec::new(),
        groups: Vec::new(),
        z_updates: vec![EditorZUpdateV1 {
            element_type: EditorElementTypeV1::Key,
            id: target.id.clone(),
            z_index: target.z_index.unwrap_or_default(),
        }],
    };
    let transition = prepare_editor_ops_transition(&store, &[op]).unwrap();
    assert!(transition.changed_fields.is_empty());
    assert_eq!(
        transition.op_results[0].status,
        EditorOpResultStatusV1::NoChange
    );
}

#[test]
fn complete_reorder_updates_every_native_type_and_cleans_empty_groups() {
    let mut store = store_with_every_reorder_type();
    let keys_before = store.keys.clone();
    let target_id = store.key_positions["4key"][0].id.clone();
    let reassigned_id = store.key_positions["4key"][1].id.clone();
    store.key_positions.get_mut("4key").unwrap()[0].group_id = Some("source-group".to_string());
    store.layer_groups.insert(
        "4key".to_string(),
        vec![
            LayerGroupDef {
                id: "source-group".to_string(),
                name: "Source".to_string(),
            },
            LayerGroupDef {
                id: "empty-group".to_string(),
                name: "Empty".to_string(),
            },
            LayerGroupDef {
                id: "target-group".to_string(),
                name: "Target".to_string(),
            },
        ],
    );
    let mut op = complete_reorder_op(&store);
    let EditorOpV1::ReorderElements { group_updates, .. } = &mut op else {
        unreachable!();
    };
    group_updates.push(EditorGroupUpdateV1 {
        element_type: EditorElementTypeV1::Key,
        id: target_id,
        group_id: None,
    });
    group_updates.push(EditorGroupUpdateV1 {
        element_type: EditorElementTypeV1::Key,
        id: reassigned_id,
        group_id: Some("target-group".to_string()),
    });

    let transition = prepare_editor_ops_transition(&store, std::slice::from_ref(&op)).unwrap();
    assert_eq!(
        transition.op_results,
        [EditorOpResultV1 {
            status: EditorOpResultStatusV1::Applied,
            bounds: None,
        }]
    );
    assert_eq!(transition.candidate.keys, keys_before);
    assert_eq!(
        transition.candidate.layer_groups["4key"],
        [LayerGroupDef {
            id: "target-group".to_string(),
            name: "Target".to_string(),
        }]
    );
    assert_eq!(
        transition.changed_fields,
        [
            EditorField::KeyPositions,
            EditorField::StatPositions,
            EditorField::GraphPositions,
            EditorField::KnobPositions,
            EditorField::SpritePositions,
            EditorField::LayerGroups,
        ]
    );

    let replay =
        prepare_editor_ops_transition(&transition.scratch, std::slice::from_ref(&op)).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay.op_results[0].status,
        EditorOpResultStatusV1::NoChange
    );
}

#[test]
fn group_structural_transition_is_frozen_atomic_and_cleans_only_empty_definitions() {
    let mut store = store_with_every_reorder_type();
    let key_id = store.key_positions["4key"][0].id.clone();
    let newcomer_id = store.key_positions["4key"][1].id.clone();
    let stat_id = store.stat_positions["4key"][0].position.id.clone();
    let graph_id = store.graph_positions["4key"][0].position.id.clone();
    let knob_id = store.knob_positions["4key"][0].position.id.clone();
    store.key_positions.get_mut("4key").unwrap()[0].group_id = Some("source-group".to_string());
    store.key_positions.get_mut("4key").unwrap()[1].group_id = Some("source-group".to_string());
    store.stat_positions.get_mut("4key").unwrap()[0]
        .position
        .group_id = Some("source-group".to_string());
    store.graph_positions.get_mut("4key").unwrap()[0]
        .position
        .group_id = Some("source-group".to_string());
    store.knob_positions.get_mut("4key").unwrap()[0]
        .position
        .group_id = Some("source-group".to_string());
    store.layer_groups.insert(
        "4key".to_string(),
        vec![
            LayerGroupDef {
                id: "source-group".to_string(),
                name: " Source ".to_string(),
            },
            LayerGroupDef {
                id: "empty-group".to_string(),
                name: "Empty".to_string(),
            },
        ],
    );
    let targets = vec![
        EditorElementGroupTargetV1 {
            element_type: EditorElementTypeV1::Key,
            id: key_id.clone(),
        },
        EditorElementGroupTargetV1 {
            element_type: EditorElementTypeV1::Stat,
            id: stat_id.clone(),
        },
        EditorElementGroupTargetV1 {
            element_type: EditorElementTypeV1::Graph,
            id: graph_id.clone(),
        },
        EditorElementGroupTargetV1 {
            element_type: EditorElementTypeV1::Knob,
            id: knob_id.clone(),
        },
    ];
    let create = EditorOpV1::SetElementGroups {
        mode: "4key".to_string(),
        targets: targets.clone(),
        target_group: Some(EditorTargetGroupV1::Create {
            id: " target group ".to_string(),
            name: " Target Name ".to_string(),
        }),
    };

    let transition = prepare_editor_ops_transition(&store, std::slice::from_ref(&create)).unwrap();
    assert_eq!(
        transition.op_results[0].status,
        EditorOpResultStatusV1::Applied
    );
    assert_eq!(
        transition.changed_fields,
        [
            EditorField::KeyPositions,
            EditorField::StatPositions,
            EditorField::GraphPositions,
            EditorField::KnobPositions,
            EditorField::LayerGroups,
        ]
    );
    assert_eq!(
        transition.candidate.key_positions["4key"][0]
            .group_id
            .as_deref(),
        Some(" target group ")
    );
    assert_eq!(
        transition.candidate.stat_positions["4key"][0]
            .position
            .group_id
            .as_deref(),
        Some(" target group ")
    );
    assert_eq!(
        transition.candidate.graph_positions["4key"][0]
            .position
            .group_id
            .as_deref(),
        Some(" target group ")
    );
    assert_eq!(
        transition.candidate.knob_positions["4key"][0]
            .position
            .group_id
            .as_deref(),
        Some(" target group ")
    );
    assert_eq!(
        transition.candidate.key_positions["4key"][1]
            .group_id
            .as_deref(),
        Some("source-group")
    );
    assert_eq!(
        transition.candidate.layer_groups["4key"],
        [
            LayerGroupDef {
                id: "source-group".to_string(),
                name: " Source ".to_string(),
            },
            LayerGroupDef {
                id: " target group ".to_string(),
                name: " Target Name ".to_string(),
            },
        ]
    );

    let existing = EditorOpV1::SetElementGroups {
        mode: "4key".to_string(),
        targets: targets.clone(),
        target_group: Some(EditorTargetGroupV1::Existing {
            id: " target group ".to_string(),
        }),
    };
    let no_change =
        prepare_editor_ops_transition(&transition.scratch, std::slice::from_ref(&existing))
            .unwrap();
    assert_eq!(
        no_change.op_results[0].status,
        EditorOpResultStatusV1::NoChange
    );
    assert!(no_change.changed_fields.is_empty());

    let mut cleanup_store = transition.scratch.clone();
    cleanup_store
        .layer_groups
        .get_mut("4key")
        .unwrap()
        .push(LayerGroupDef {
            id: "cleanup-only".to_string(),
            name: "Cleanup".to_string(),
        });
    let cleanup =
        prepare_editor_ops_transition(&cleanup_store, std::slice::from_ref(&existing)).unwrap();
    assert_eq!(
        cleanup.op_results[0].status,
        EditorOpResultStatusV1::Applied
    );
    assert_eq!(cleanup.changed_fields, [EditorField::LayerGroups]);

    let ungroup = EditorOpV1::SetElementGroups {
        mode: "4key".to_string(),
        targets,
        target_group: None,
    };
    let ungrouped = prepare_editor_ops_transition(&transition.scratch, &[ungroup]).unwrap();
    assert_eq!(
        ungrouped.op_results[0].status,
        EditorOpResultStatusV1::Applied
    );
    assert!(ungrouped.candidate.layer_groups["4key"]
        .iter()
        .all(|group| group.id != " target group "));
    assert_eq!(
        ungrouped.candidate.key_positions["4key"][1]
            .group_id
            .as_deref(),
        Some("source-group")
    );
    assert_eq!(
        ungrouped.candidate.key_positions["4key"]
            .iter()
            .find(|position| position.id == newcomer_id)
            .unwrap()
            .group_id
            .as_deref(),
        Some("source-group")
    );
}

#[test]
fn group_structural_transition_rejects_conflicts_and_reports_missing_atomically() {
    let mut store = store_with_every_reorder_type();
    let key_id = store.key_positions["4key"][0].id.clone();
    store.key_positions.get_mut("4key").unwrap()[0].group_id = Some("existing-group".to_string());
    store.layer_groups.insert(
        "4key".to_string(),
        vec![LayerGroupDef {
            id: "existing-group".to_string(),
            name: "Existing".to_string(),
        }],
    );
    let before = EditorDocumentV1::from_store(&store);
    let target = EditorElementGroupTargetV1 {
        element_type: EditorElementTypeV1::Key,
        id: key_id.clone(),
    };

    let missing = EditorOpV1::SetElementGroups {
        mode: "4key".to_string(),
        targets: vec![
            target.clone(),
            EditorElementGroupTargetV1 {
                element_type: EditorElementTypeV1::Graph,
                id: uuid::Uuid::new_v4().to_string(),
            },
        ],
        target_group: None,
    };
    let missing_transition = prepare_editor_ops_transition(&store, &[missing]).unwrap();
    assert_eq!(
        missing_transition.op_results[0].status,
        EditorOpResultStatusV1::TargetMissing
    );
    assert_eq!(missing_transition.candidate, before);
    assert!(missing_transition.changed_fields.is_empty());

    for invalid in [
        EditorOpV1::SetElementGroups {
            mode: "4key".to_string(),
            targets: vec![EditorElementGroupTargetV1 {
                element_type: EditorElementTypeV1::Graph,
                id: key_id.clone(),
            }],
            target_group: None,
        },
        EditorOpV1::SetElementGroups {
            mode: "5key".to_string(),
            targets: vec![target.clone()],
            target_group: None,
        },
    ] {
        let error = prepare_editor_ops_transition(&store, &[invalid]).unwrap_err();
        assert!(matches!(
            validation_code(&error),
            Some("ELEMENT_TYPE_MISMATCH" | "ELEMENT_GROUP_TARGET_MODE_MISMATCH")
        ));
        assert_eq!(EditorDocumentV1::from_store(&store), before);
    }

    for name in ["Existing", "Different"] {
        let collision = EditorOpV1::SetElementGroups {
            mode: "4key".to_string(),
            targets: vec![target.clone()],
            target_group: Some(EditorTargetGroupV1::Create {
                id: "existing-group".to_string(),
                name: name.to_string(),
            }),
        };
        let error = prepare_editor_ops_transition(&store, &[collision]).unwrap_err();
        assert_eq!(validation_code(&error), Some("LAYER_GROUP_ALREADY_EXISTS"));
    }

    let unknown_group = EditorOpV1::SetElementGroups {
        mode: "4key".to_string(),
        targets: vec![target],
        target_group: Some(EditorTargetGroupV1::Existing {
            id: "missing-group".to_string(),
        }),
    };
    let unknown = prepare_editor_ops_transition(&store, &[unknown_group]).unwrap();
    assert_eq!(
        unknown.op_results[0].status,
        EditorOpResultStatusV1::TargetMissing
    );
    assert_eq!(unknown.candidate, before);
}

#[test]
fn rename_layer_group_is_mode_scoped_raw_and_reports_missing() {
    let mut store = store_with_every_reorder_type();
    store.layer_groups.insert(
        "4key".to_string(),
        vec![LayerGroupDef {
            id: "legacy group".to_string(),
            name: "Old".to_string(),
        }],
    );
    store.layer_groups.insert(
        "5key".to_string(),
        vec![LayerGroupDef {
            id: "legacy group".to_string(),
            name: "Other Mode".to_string(),
        }],
    );
    let rename = EditorOpV1::RenameLayerGroup {
        mode: "4key".to_string(),
        group_id: "legacy group".to_string(),
        name: " Raw Name ".to_string(),
    };

    let applied = prepare_editor_ops_transition(&store, std::slice::from_ref(&rename)).unwrap();
    assert_eq!(
        applied.op_results[0].status,
        EditorOpResultStatusV1::Applied
    );
    assert_eq!(applied.changed_fields, [EditorField::LayerGroups]);
    assert_eq!(applied.candidate.layer_groups["4key"][0].name, " Raw Name ");
    assert_eq!(applied.candidate.layer_groups["5key"][0].name, "Other Mode");

    let replay =
        prepare_editor_ops_transition(&applied.scratch, std::slice::from_ref(&rename)).unwrap();
    assert_eq!(
        replay.op_results[0].status,
        EditorOpResultStatusV1::NoChange
    );
    assert!(replay.changed_fields.is_empty());

    let missing = EditorOpV1::RenameLayerGroup {
        mode: "4key".to_string(),
        group_id: "missing".to_string(),
        name: "Name".to_string(),
    };
    let missing_transition = prepare_editor_ops_transition(&store, &[missing]).unwrap();
    assert_eq!(
        missing_transition.op_results[0].status,
        EditorOpResultStatusV1::TargetMissing
    );
    assert!(missing_transition.changed_fields.is_empty());
}

#[test]
fn partial_reorder_preserves_groups_and_treats_raw_z_storage_as_state() {
    let mut store = base_store();
    let id = store.key_positions["4key"][0].id.clone();
    store.key_positions.get_mut("4key").unwrap()[0].z_index = None;
    store.layer_groups.insert(
        "4key".to_string(),
        vec![LayerGroupDef {
            id: "empty-group".to_string(),
            name: "Empty".to_string(),
        }],
    );
    let op = EditorOpV1::ReorderElements {
        mode: "4key".to_string(),
        complete_mode_order: false,
        z_updates: vec![EditorZUpdateV1 {
            element_type: EditorElementTypeV1::Key,
            id,
            z_index: 0,
        }],
        group_updates: Vec::new(),
    };

    let applied = prepare_editor_ops_transition(&store, std::slice::from_ref(&op)).unwrap();
    assert_eq!(
        applied.op_results[0].status,
        EditorOpResultStatusV1::Applied
    );
    assert_eq!(applied.candidate.key_positions["4key"][0].z_index, Some(0));
    assert_eq!(applied.candidate.layer_groups, store.layer_groups);

    let replay =
        prepare_editor_ops_transition(&applied.scratch, std::slice::from_ref(&op)).unwrap();
    assert_eq!(
        replay.op_results[0].status,
        EditorOpResultStatusV1::NoChange
    );
    assert!(replay.changed_fields.is_empty());
}

#[test]
fn reorder_rejects_incomplete_missing_wrong_mode_type_and_group_atomically() {
    let mut store = store_with_every_reorder_type();
    store.layer_groups.insert(
        "4key".to_string(),
        vec![LayerGroupDef {
            id: "known-group".to_string(),
            name: "Known".to_string(),
        }],
    );
    let before = store.clone();
    let complete = complete_reorder_op(&store);

    let mut incomplete = complete.clone();
    let EditorOpV1::ReorderElements { z_updates, .. } = &mut incomplete else {
        unreachable!();
    };
    z_updates.pop();
    assert_eq!(
        validation_code(&prepare_editor_ops_transition(&store, &[incomplete]).unwrap_err()),
        Some("INCOMPLETE_REORDER_PLAN")
    );

    let mut missing = complete.clone();
    let EditorOpV1::ReorderElements { z_updates, .. } = &mut missing else {
        unreachable!();
    };
    z_updates[0].id = uuid::Uuid::new_v4().to_string();
    assert_eq!(
        validation_code(&prepare_editor_ops_transition(&store, &[missing]).unwrap_err()),
        Some("REORDER_TARGET_MISSING")
    );

    let mut wrong_mode = complete.clone();
    let EditorOpV1::ReorderElements { mode, .. } = &mut wrong_mode else {
        unreachable!();
    };
    *mode = "5key".to_string();
    assert_eq!(
        validation_code(&prepare_editor_ops_transition(&store, &[wrong_mode]).unwrap_err()),
        Some("REORDER_TARGET_MODE_MISMATCH")
    );

    let mut wrong_type = complete.clone();
    let EditorOpV1::ReorderElements { z_updates, .. } = &mut wrong_type else {
        unreachable!();
    };
    z_updates[0].element_type = EditorElementTypeV1::Graph;
    assert_eq!(
        validation_code(&prepare_editor_ops_transition(&store, &[wrong_type]).unwrap_err()),
        Some("ELEMENT_TYPE_MISMATCH")
    );

    let mut unknown_group = complete;
    let EditorOpV1::ReorderElements {
        z_updates,
        group_updates,
        ..
    } = &mut unknown_group
    else {
        unreachable!();
    };
    group_updates.push(EditorGroupUpdateV1 {
        element_type: z_updates[0].element_type,
        id: z_updates[0].id.clone(),
        group_id: Some("unknown-group".to_string()),
    });
    assert_eq!(
        validation_code(&prepare_editor_ops_transition(&store, &[unknown_group]).unwrap_err()),
        Some("REORDER_GROUP_MISSING")
    );
    assert_eq!(store, before);
}

#[test]
fn reorder_does_not_repair_a_malformed_key_pair() {
    let mut store = base_store();
    let id = store.key_positions["4key"][0].id.clone();
    let op = EditorOpV1::ReorderElements {
        mode: "4key".to_string(),
        complete_mode_order: false,
        z_updates: vec![EditorZUpdateV1 {
            element_type: EditorElementTypeV1::Key,
            id,
            z_index: 99,
        }],
        group_updates: Vec::new(),
    };
    store.keys.remove("4key");
    let before = store.clone();

    let error = prepare_editor_ops_transition(&store, &[op]).unwrap_err();
    assert!(matches!(
        validation_code(&error),
        Some("KEY_POSITION_MODE_MISMATCH" | "KEY_POSITION_LENGTH_MISMATCH")
    ));
    assert_eq!(store, before);
}

#[test]
fn property_patches_apply_all_native_types_in_order_and_skip_missing_targets() {
    let store = store_with_every_reorder_type();
    let key_id = store.key_positions["4key"][0].id.clone();
    let stat_id = store.stat_positions["4key"][0].position.id.clone();
    let graph_id = store.graph_positions["4key"][0].position.id.clone();
    let knob_id = store.knob_positions["4key"][0].position.id.clone();
    let missing_id = uuid::Uuid::new_v4().to_string();
    let ops = vec![
        patch_hidden_op(EditorElementTypeV1::Key, key_id, true),
        patch_hidden_op(EditorElementTypeV1::Stat, stat_id, true),
        patch_hidden_op(EditorElementTypeV1::Graph, graph_id, true),
        patch_hidden_op(EditorElementTypeV1::Knob, knob_id, true),
        patch_hidden_op(EditorElementTypeV1::Key, missing_id, true),
    ];

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    assert!(transition.candidate.key_positions["4key"][0].hidden);
    assert!(
        transition.candidate.stat_positions["4key"][0]
            .position
            .hidden
    );
    assert!(
        transition.candidate.graph_positions["4key"][0]
            .position
            .hidden
    );
    assert!(
        transition.candidate.knob_positions["4key"][0]
            .position
            .hidden
    );
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );
    assert_eq!(
        transition.changed_fields,
        [
            EditorField::KeyPositions,
            EditorField::StatPositions,
            EditorField::GraphPositions,
            EditorField::KnobPositions,
        ]
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );
}

#[test]
fn layer_name_patches_apply_exact_values_and_clear_without_touching_other_fields() {
    let store = store_with_every_reorder_type();
    let key_id = store.key_positions["4key"][0].id.clone();
    let stat_id = store.stat_positions["4key"][0].position.id.clone();
    let graph_id = store.graph_positions["4key"][0].position.id.clone();
    let knob_id = store.knob_positions["4key"][0].position.id.clone();
    let missing_id = uuid::Uuid::new_v4().to_string();
    let already_clear = prepare_editor_ops_transition(
        &store,
        &[patch_layer_name_op(EditorElementTypeV1::Key, &key_id, None)],
    )
    .unwrap();
    assert_eq!(
        already_clear.op_results[0].status,
        EditorOpResultStatusV1::NoChange
    );
    assert!(already_clear.changed_fields.is_empty());

    let ops = vec![
        patch_layer_name_op(EditorElementTypeV1::Key, &key_id, Some("Key layer")),
        patch_layer_name_op(EditorElementTypeV1::Stat, stat_id, Some("Stat layer")),
        patch_layer_name_op(EditorElementTypeV1::Graph, graph_id, Some("Graph layer")),
        patch_layer_name_op(EditorElementTypeV1::Knob, knob_id, Some("Knob layer")),
        patch_layer_name_op(EditorElementTypeV1::Key, missing_id, None),
    ];

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    assert_eq!(
        transition.candidate.key_positions["4key"][0]
            .layer_name
            .as_deref(),
        Some("Key layer")
    );
    assert_eq!(
        transition.candidate.stat_positions["4key"][0]
            .position
            .layer_name
            .as_deref(),
        Some("Stat layer")
    );
    assert_eq!(
        transition.candidate.graph_positions["4key"][0]
            .position
            .layer_name
            .as_deref(),
        Some("Graph layer")
    );
    assert_eq!(
        transition.candidate.knob_positions["4key"][0]
            .position
            .layer_name
            .as_deref(),
        Some("Knob layer")
    );
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );
    assert_eq!(
        transition.changed_fields,
        [
            EditorField::KeyPositions,
            EditorField::StatPositions,
            EditorField::GraphPositions,
            EditorField::KnobPositions,
        ]
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay.op_results[0].status,
        EditorOpResultStatusV1::NoChange
    );

    let cleared = prepare_editor_ops_transition(
        &transition.scratch,
        &[patch_layer_name_op(EditorElementTypeV1::Key, key_id, None)],
    )
    .unwrap();
    assert_eq!(cleared.candidate.key_positions["4key"][0].layer_name, None);
    assert_eq!(
        cleared.op_results[0].status,
        EditorOpResultStatusV1::Applied
    );
}

#[test]
fn graph_type_patch_is_graph_only_and_preserves_other_graph_fields() {
    let store = store_with_every_reorder_type();
    let graph = &store.graph_positions["4key"][0];
    let graph_id = graph.position.id.clone();
    let missing_id = uuid::Uuid::new_v4().to_string();
    let ops = [
        patch_graph_type_op(EditorElementTypeV1::Graph, &graph_id, GraphType::Bar),
        patch_graph_type_op(EditorElementTypeV1::Graph, missing_id, GraphType::Line),
    ];

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    let changed = &transition.candidate.graph_positions["4key"][0];
    assert_eq!(changed.graph_type, GraphType::Bar);
    assert_eq!(changed.stat_type, graph.stat_type);
    assert_eq!(changed.graph_speed, graph.graph_speed);
    assert_eq!(changed.graph_color, graph.graph_color);
    assert_eq!(changed.show_avg_line, graph.show_avg_line);
    assert_eq!(changed.position, graph.position);
    assert_eq!(transition.changed_fields, [EditorField::GraphPositions]);
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay.op_results[0].status,
        EditorOpResultStatusV1::NoChange
    );

    let key_id = store.key_positions["4key"][0].id.clone();
    let error = prepare_editor_ops_transition(
        &store,
        &[
            patch_hidden_op(EditorElementTypeV1::Key, &key_id, true),
            patch_graph_type_op(EditorElementTypeV1::Key, key_id, GraphType::Bar),
        ],
    )
    .unwrap_err();
    assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
}

#[test]
fn graph_color_patch_preserves_raw_string_and_other_graph_fields() {
    let store = store_with_every_reorder_type();
    let graph = &store.graph_positions["4key"][0];
    let graph_id = graph.position.id.clone();
    let raw_color = "color(display-p3 1 0 0 / 0.5)";
    let ops = [
        patch_graph_color_op(EditorElementTypeV1::Graph, &graph_id, raw_color),
        patch_graph_color_op(
            EditorElementTypeV1::Graph,
            uuid::Uuid::new_v4().to_string(),
            "",
        ),
    ];

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    let changed = &transition.candidate.graph_positions["4key"][0];
    assert_eq!(changed.graph_color, raw_color);
    assert_eq!(changed.stat_type, graph.stat_type);
    assert_eq!(changed.graph_type, graph.graph_type);
    assert_eq!(changed.graph_speed, graph.graph_speed);
    assert_eq!(changed.show_avg_line, graph.show_avg_line);
    assert_eq!(changed.position, graph.position);
    assert_eq!(transition.changed_fields, [EditorField::GraphPositions]);
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay.op_results[0].status,
        EditorOpResultStatusV1::NoChange
    );

    let key_id = store.key_positions["4key"][0].id.clone();
    let error = prepare_editor_ops_transition(
        &store,
        &[
            patch_hidden_op(EditorElementTypeV1::Key, &key_id, true),
            patch_graph_color_op(EditorElementTypeV1::Key, key_id, "#FFFFFF"),
        ],
    )
    .unwrap_err();
    assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
}

#[test]
fn graph_and_knob_literal_patches_are_typed_leaf_intents() {
    let mut store = store_with_every_reorder_type();
    let graph_template = store.graph_positions["4key"][0].clone();
    let knob_template = store.knob_positions["4key"][0].clone();
    let graph_ids = (0..3)
        .map(|_| uuid::Uuid::new_v4().to_string())
        .collect::<Vec<_>>();
    let knob_ids = (0..3)
        .map(|_| uuid::Uuid::new_v4().to_string())
        .collect::<Vec<_>>();
    store.graph_positions.insert(
        "4key".to_string(),
        graph_ids
            .iter()
            .map(|id| GraphPosition {
                position: KeyPosition {
                    id: id.clone(),
                    graph_animation_enabled: None,
                    ..graph_template.position.clone()
                },
                ..graph_template.clone()
            })
            .collect(),
    );
    store.knob_positions.insert(
        "4key".to_string(),
        knob_ids
            .iter()
            .map(|id| KnobPosition {
                position: KeyPosition {
                    id: id.clone(),
                    ..knob_template.position.clone()
                },
                ..knob_template.clone()
            })
            .collect(),
    );
    let ops = vec![
        patch_property_op(
            EditorElementTypeV1::Graph,
            &graph_ids[0],
            EditorElementPropertyPatchV1::ShowAvgLine(!graph_template.show_avg_line),
        ),
        patch_property_op(
            EditorElementTypeV1::Graph,
            &graph_ids[1],
            EditorElementPropertyPatchV1::GraphAnimationEnabled(true),
        ),
        patch_property_op(
            EditorElementTypeV1::Graph,
            &graph_ids[2],
            EditorElementPropertyPatchV1::GraphSpeed(u32::MAX),
        ),
        patch_property_op(
            EditorElementTypeV1::Knob,
            &knob_ids[0],
            EditorElementPropertyPatchV1::Reverse(!knob_template.reverse),
        ),
        patch_property_op(
            EditorElementTypeV1::Knob,
            &knob_ids[1],
            EditorElementPropertyPatchV1::Sensitivity(-7.25),
        ),
        patch_property_op(
            EditorElementTypeV1::Knob,
            &knob_ids[2],
            EditorElementPropertyPatchV1::AxisId("  HIDA:raw  ".to_string()),
        ),
        patch_property_op(
            EditorElementTypeV1::Knob,
            uuid::Uuid::new_v4().to_string(),
            EditorElementPropertyPatchV1::AxisId("missing-axis".to_string()),
        ),
    ];

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    let graphs = &transition.candidate.graph_positions["4key"];
    let knobs = &transition.candidate.knob_positions["4key"];
    assert_eq!(graphs[0].show_avg_line, !graph_template.show_avg_line);
    assert_eq!(graphs[0].graph_color, graph_template.graph_color);
    assert_eq!(graphs[1].position.graph_animation_enabled, Some(true));
    assert_eq!(graphs[1].graph_speed, graph_template.graph_speed);
    assert_eq!(graphs[2].graph_speed, u32::MAX);
    assert_eq!(graphs[2].graph_type, graph_template.graph_type);
    assert_eq!(knobs[0].reverse, !knob_template.reverse);
    assert_eq!(knobs[0].sensitivity, knob_template.sensitivity);
    assert_eq!(knobs[1].sensitivity, -7.25);
    assert_eq!(knobs[1].axis_id, knob_template.axis_id);
    assert_eq!(knobs[2].axis_id, "  HIDA:raw  ");
    assert_eq!(knobs[2].reverse, knob_template.reverse);
    assert_eq!(knobs[2].sensitivity, knob_template.sensitivity);
    assert_eq!(
        transition.changed_fields,
        [EditorField::GraphPositions, EditorField::KnobPositions]
    );
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let key_id = store.key_positions["4key"][0].id.clone();
    for patch in [
        EditorElementPropertyPatchV1::ShowAvgLine(false),
        EditorElementPropertyPatchV1::GraphAnimationEnabled(false),
        EditorElementPropertyPatchV1::GraphSpeed(0),
        EditorElementPropertyPatchV1::Reverse(false),
        EditorElementPropertyPatchV1::Sensitivity(0.0),
        EditorElementPropertyPatchV1::AxisId(String::new()),
    ] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                patch_hidden_op(EditorElementTypeV1::Key, &key_id, true),
                patch_property_op(EditorElementTypeV1::Key, &key_id, patch),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
    }

    let invalid = patch_property_op(
        EditorElementTypeV1::Knob,
        &knob_ids[0],
        EditorElementPropertyPatchV1::Sensitivity(f64::INFINITY),
    );
    let error = prepare_editor_ops_transition(&store, &[invalid]).unwrap_err();
    assert_eq!(validation_code(&error), Some("INVALID_NUMBER"));
}

#[test]
fn inline_style_patch_preserves_raw_option_semantics_for_every_element_type() {
    let mut store = store_with_every_reorder_type();
    store.key_positions.get_mut("4key").unwrap()[0].use_inline_styles = None;
    store.stat_positions.get_mut("4key").unwrap()[0]
        .position
        .use_inline_styles = None;
    store.graph_positions.get_mut("4key").unwrap()[0]
        .position
        .use_inline_styles = None;
    store.knob_positions.get_mut("4key").unwrap()[0]
        .position
        .use_inline_styles = None;
    let targets = [
        (
            EditorElementTypeV1::Key,
            store.key_positions["4key"][0].id.clone(),
        ),
        (
            EditorElementTypeV1::Stat,
            store.stat_positions["4key"][0].position.id.clone(),
        ),
        (
            EditorElementTypeV1::Graph,
            store.graph_positions["4key"][0].position.id.clone(),
        ),
        (
            EditorElementTypeV1::Knob,
            store.knob_positions["4key"][0].position.id.clone(),
        ),
    ];
    let patch = EditorElementPropertyPatchV1::UseInlineStyles(false);
    let mut ops = targets
        .iter()
        .map(|(element_type, id)| patch_property_op(*element_type, id, patch.clone()))
        .collect::<Vec<_>>();
    ops.push(patch_property_op(
        EditorElementTypeV1::Key,
        uuid::Uuid::new_v4().to_string(),
        patch.clone(),
    ));

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    assert_eq!(
        transition.candidate.key_positions["4key"][0].use_inline_styles,
        Some(false)
    );
    assert_eq!(
        transition.candidate.stat_positions["4key"][0]
            .position
            .use_inline_styles,
        Some(false)
    );
    assert_eq!(
        transition.candidate.graph_positions["4key"][0]
            .position
            .use_inline_styles,
        Some(false)
    );
    assert_eq!(
        transition.candidate.knob_positions["4key"][0]
            .position
            .use_inline_styles,
        Some(false)
    );
    assert_eq!(
        transition.changed_fields,
        [
            EditorField::KeyPositions,
            EditorField::StatPositions,
            EditorField::GraphPositions,
            EditorField::KnobPositions,
        ]
    );
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let error = prepare_editor_ops_transition(
        &store,
        &[
            patch_property_op(EditorElementTypeV1::Key, &targets[0].1, patch.clone()),
            patch_property_op(EditorElementTypeV1::Stat, &targets[2].1, patch),
        ],
    )
    .unwrap_err();
    assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
    assert_eq!(store.key_positions["4key"][0].use_inline_styles, None);
}

#[test]
fn font_weight_patch_pins_implicit_bold_before_changing_weight() {
    let mut store = store_with_every_reorder_type();
    {
        let key = &mut store.key_positions.get_mut("4key").unwrap()[0];
        key.font_weight = Some(700);
        key.font_bold = None;
        key.counter.font_weight = 400;
        key.counter.font_bold = None;
    }
    {
        let stat = &mut store.stat_positions.get_mut("4key").unwrap()[0].position;
        stat.font_weight = None;
        stat.font_bold = None;
    }
    let key_id = store.key_positions["4key"][0].id.clone();
    let stat_id = store.stat_positions["4key"][0].position.id.clone();
    let ops = vec![
        patch_property_op(
            EditorElementTypeV1::Key,
            &key_id,
            EditorElementPropertyPatchV1::FontWeight(500),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            &key_id,
            EditorElementPropertyPatchV1::CounterFontWeight(700),
        ),
        patch_property_op(
            EditorElementTypeV1::Stat,
            &stat_id,
            EditorElementPropertyPatchV1::FontWeight(600),
        ),
    ];

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    let key = &transition.candidate.key_positions["4key"][0];
    // 레거시 (700, None)은 Bold였으므로 고정하고 굵기만 바꾼다
    assert_eq!(key.font_weight, Some(500));
    assert_eq!(key.font_bold, Some(true));
    // 카운터 (400, None)은 non-bold 고정 - (700, Some(false))라 재시작 시 레거시로 오인되지 않는다
    assert_eq!(key.counter.font_weight, 700);
    assert_eq!(key.counter.font_bold, Some(false));
    // 미설정 키 텍스트의 암묵 상태는 기본 Bold
    let stat = &transition.candidate.stat_positions["4key"][0].position;
    assert_eq!(stat.font_weight, Some(600));
    assert_eq!(stat.font_bold, Some(true));
}

#[test]
fn font_literal_patches_preserve_raw_options_across_native_types() {
    let mut store = store_with_every_reorder_type();
    store.key_positions.get_mut("4key").unwrap()[0].font_weight = None;
    store.key_positions.get_mut("4key").unwrap()[0]
        .counter
        .font_weight = 123;
    store.stat_positions.get_mut("4key").unwrap()[0]
        .position
        .font_italic = None;
    store.stat_positions.get_mut("4key").unwrap()[0]
        .position
        .counter
        .font_italic = true;
    store.graph_positions.get_mut("4key").unwrap()[0]
        .position
        .font_underline = None;
    store.graph_positions.get_mut("4key").unwrap()[0]
        .position
        .counter
        .font_underline = true;
    store.knob_positions.get_mut("4key").unwrap()[0]
        .position
        .font_strikethrough = None;
    store.knob_positions.get_mut("4key").unwrap()[0]
        .position
        .counter
        .font_strikethrough = true;
    let key_id = store.key_positions["4key"][0].id.clone();
    let stat_id = store.stat_positions["4key"][0].position.id.clone();
    let graph_id = store.graph_positions["4key"][0].position.id.clone();
    let knob_id = store.knob_positions["4key"][0].position.id.clone();
    let ops = vec![
        patch_property_op(
            EditorElementTypeV1::Key,
            &key_id,
            EditorElementPropertyPatchV1::FontWeight(400),
        ),
        patch_property_op(
            EditorElementTypeV1::Stat,
            &stat_id,
            EditorElementPropertyPatchV1::FontItalic(false),
        ),
        patch_property_op(
            EditorElementTypeV1::Graph,
            &graph_id,
            EditorElementPropertyPatchV1::FontUnderline(false),
        ),
        patch_property_op(
            EditorElementTypeV1::Knob,
            &knob_id,
            EditorElementPropertyPatchV1::FontStrikethrough(false),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            uuid::Uuid::new_v4().to_string(),
            EditorElementPropertyPatchV1::FontWeight(u32::MAX),
        ),
    ];

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    assert_eq!(
        transition.candidate.key_positions["4key"][0].font_weight,
        Some(400)
    );
    assert_eq!(
        transition.candidate.stat_positions["4key"][0]
            .position
            .font_italic,
        Some(false)
    );
    assert_eq!(
        transition.candidate.graph_positions["4key"][0]
            .position
            .font_underline,
        Some(false)
    );
    assert_eq!(
        transition.candidate.knob_positions["4key"][0]
            .position
            .font_strikethrough,
        Some(false)
    );
    assert_eq!(
        transition.candidate.key_positions["4key"][0]
            .counter
            .font_weight,
        123
    );
    assert!(
        transition.candidate.stat_positions["4key"][0]
            .position
            .counter
            .font_italic
    );
    assert!(
        transition.candidate.graph_positions["4key"][0]
            .position
            .counter
            .font_underline
    );
    assert!(
        transition.candidate.knob_positions["4key"][0]
            .position
            .counter
            .font_strikethrough
    );
    assert_eq!(
        transition.changed_fields,
        [
            EditorField::KeyPositions,
            EditorField::StatPositions,
            EditorField::GraphPositions,
            EditorField::KnobPositions,
        ]
    );
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let error = prepare_editor_ops_transition(
        &store,
        &[
            ops[0].clone(),
            patch_property_op(
                EditorElementTypeV1::Stat,
                &graph_id,
                EditorElementPropertyPatchV1::FontItalic(true),
            ),
        ],
    )
    .unwrap_err();
    assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
    assert_eq!(store.key_positions["4key"][0].font_weight, None);
}

#[test]
fn font_family_patch_preserves_nested_counter_and_raw_strings_across_native_types() {
    let mut store = store_with_every_reorder_type();
    store.key_positions.get_mut("4key").unwrap()[0]
        .counter
        .font_family = Some("counter-key".to_string());
    store.stat_positions.get_mut("4key").unwrap()[0]
        .position
        .counter
        .font_family = Some("counter-stat".to_string());
    store.graph_positions.get_mut("4key").unwrap()[0]
        .position
        .counter
        .font_family = Some("counter-graph".to_string());
    store.knob_positions.get_mut("4key").unwrap()[0]
        .position
        .counter
        .font_family = Some("counter-knob".to_string());
    let targets = [
        (
            EditorElementTypeV1::Key,
            store.key_positions["4key"][0].id.clone(),
            " raw-key ",
        ),
        (
            EditorElementTypeV1::Stat,
            store.stat_positions["4key"][0].position.id.clone(),
            "raw-stat",
        ),
        (
            EditorElementTypeV1::Graph,
            store.graph_positions["4key"][0].position.id.clone(),
            "raw-graph",
        ),
        (
            EditorElementTypeV1::Knob,
            store.knob_positions["4key"][0].position.id.clone(),
            "raw-knob",
        ),
    ];
    let ops = targets
        .iter()
        .map(|(element_type, id, font_family)| {
            patch_property_op(
                *element_type,
                id,
                EditorElementPropertyPatchV1::FontFamily((*font_family).to_string()),
            )
        })
        .chain(std::iter::once(patch_property_op(
            EditorElementTypeV1::Key,
            uuid::Uuid::new_v4().to_string(),
            EditorElementPropertyPatchV1::FontFamily("missing".to_string()),
        )))
        .collect::<Vec<_>>();

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    assert_eq!(
        transition.candidate.key_positions["4key"][0]
            .font_family
            .as_deref(),
        Some(" raw-key ")
    );
    assert_eq!(
        transition.candidate.stat_positions["4key"][0]
            .position
            .font_family
            .as_deref(),
        Some("raw-stat")
    );
    assert_eq!(
        transition.candidate.graph_positions["4key"][0]
            .position
            .font_family
            .as_deref(),
        Some("raw-graph")
    );
    assert_eq!(
        transition.candidate.knob_positions["4key"][0]
            .position
            .font_family
            .as_deref(),
        Some("raw-knob")
    );
    assert_eq!(
        transition.candidate.key_positions["4key"][0]
            .counter
            .font_family
            .as_deref(),
        Some("counter-key")
    );
    assert_eq!(
        transition.candidate.stat_positions["4key"][0]
            .position
            .counter
            .font_family
            .as_deref(),
        Some("counter-stat")
    );
    assert_eq!(
        transition.candidate.graph_positions["4key"][0]
            .position
            .counter
            .font_family
            .as_deref(),
        Some("counter-graph")
    );
    assert_eq!(
        transition.candidate.knob_positions["4key"][0]
            .position
            .counter
            .font_family
            .as_deref(),
        Some("counter-knob")
    );
    assert_eq!(
        transition.changed_fields,
        [
            EditorField::KeyPositions,
            EditorField::StatPositions,
            EditorField::GraphPositions,
            EditorField::KnobPositions,
        ]
    );
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let error = prepare_editor_ops_transition(
        &store,
        &[
            ops[0].clone(),
            patch_property_op(
                EditorElementTypeV1::Stat,
                &targets[2].1,
                EditorElementPropertyPatchV1::FontFamily("wrong-type".to_string()),
            ),
        ],
    )
    .unwrap_err();
    assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
    assert_eq!(store.key_positions["4key"][0].font_family, None);
}

#[test]
fn display_text_patch_materializes_raw_strings_across_native_types() {
    let mut store = store_with_every_reorder_type();
    for position in [
        &mut store.key_positions.get_mut("4key").unwrap()[0],
        &mut store.stat_positions.get_mut("4key").unwrap()[0].position,
        &mut store.graph_positions.get_mut("4key").unwrap()[0].position,
        &mut store.knob_positions.get_mut("4key").unwrap()[0].position,
    ] {
        position.display_text = None;
        position.layer_name = Some("layer-sibling".to_string());
        position.font_family = Some("font-sibling".to_string());
        position.counter.font_family = Some("counter-font-sibling".to_string());
        position.inactive_image = Some("image-sibling".to_string());
    }
    let targets = [
        (
            EditorElementTypeV1::Key,
            store.key_positions["4key"][0].id.clone(),
            "",
        ),
        (
            EditorElementTypeV1::Stat,
            store.stat_positions["4key"][0].position.id.clone(),
            "  raw stat  ",
        ),
        (
            EditorElementTypeV1::Graph,
            store.graph_positions["4key"][0].position.id.clone(),
            "raw graph",
        ),
        (
            EditorElementTypeV1::Knob,
            store.knob_positions["4key"][0].position.id.clone(),
            "raw knob",
        ),
    ];
    let ops = targets
        .iter()
        .map(|(element_type, id, display_text)| {
            patch_property_op(
                *element_type,
                id,
                EditorElementPropertyPatchV1::DisplayText((*display_text).to_string()),
            )
        })
        .chain(std::iter::once(patch_property_op(
            EditorElementTypeV1::Key,
            uuid::Uuid::new_v4().to_string(),
            EditorElementPropertyPatchV1::DisplayText("missing".to_string()),
        )))
        .collect::<Vec<_>>();

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    let actual = [
        &transition.candidate.key_positions["4key"][0],
        &transition.candidate.stat_positions["4key"][0].position,
        &transition.candidate.graph_positions["4key"][0].position,
        &transition.candidate.knob_positions["4key"][0].position,
    ];
    for (position, expected) in actual
        .into_iter()
        .zip(targets.iter().map(|target| target.2))
    {
        assert_eq!(position.display_text.as_deref(), Some(expected));
        assert_eq!(position.layer_name.as_deref(), Some("layer-sibling"));
        assert_eq!(position.font_family.as_deref(), Some("font-sibling"));
        assert_eq!(
            position.counter.font_family.as_deref(),
            Some("counter-font-sibling")
        );
        assert_eq!(position.inactive_image.as_deref(), Some("image-sibling"));
    }
    assert_eq!(
        transition.changed_fields,
        [
            EditorField::KeyPositions,
            EditorField::StatPositions,
            EditorField::GraphPositions,
            EditorField::KnobPositions,
        ]
    );
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let error = prepare_editor_ops_transition(
        &store,
        &[
            ops[0].clone(),
            patch_property_op(
                EditorElementTypeV1::Stat,
                &targets[2].1,
                EditorElementPropertyPatchV1::DisplayText("wrong-type".to_string()),
            ),
        ],
    )
    .unwrap_err();
    assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
    assert_eq!(store.key_positions["4key"][0].display_text, None);
}

#[test]
fn class_name_patch_materializes_raw_strings_across_native_types() {
    let mut store = store_with_every_reorder_type();
    for position in [
        &mut store.key_positions.get_mut("4key").unwrap()[0],
        &mut store.stat_positions.get_mut("4key").unwrap()[0].position,
        &mut store.graph_positions.get_mut("4key").unwrap()[0].position,
        &mut store.knob_positions.get_mut("4key").unwrap()[0].position,
    ] {
        position.class_name = None;
        position.display_text = Some("display-sibling".to_string());
        position.layer_name = Some("layer-sibling".to_string());
        position.font_family = Some("font-sibling".to_string());
        position.counter.font_family = Some("counter-font-sibling".to_string());
    }
    let targets = [
        (
            EditorElementTypeV1::Key,
            store.key_positions["4key"][0].id.clone(),
            "",
        ),
        (
            EditorElementTypeV1::Stat,
            store.stat_positions["4key"][0].position.id.clone(),
            "  raw stat class  ",
        ),
        (
            EditorElementTypeV1::Graph,
            store.graph_positions["4key"][0].position.id.clone(),
            "raw graph class",
        ),
        (
            EditorElementTypeV1::Knob,
            store.knob_positions["4key"][0].position.id.clone(),
            "raw knob class",
        ),
    ];
    let ops = targets
        .iter()
        .map(|(element_type, id, class_name)| {
            patch_property_op(
                *element_type,
                id,
                EditorElementPropertyPatchV1::ClassName((*class_name).to_string()),
            )
        })
        .chain(std::iter::once(patch_property_op(
            EditorElementTypeV1::Key,
            uuid::Uuid::new_v4().to_string(),
            EditorElementPropertyPatchV1::ClassName("missing".to_string()),
        )))
        .collect::<Vec<_>>();

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    let actual = [
        &transition.candidate.key_positions["4key"][0],
        &transition.candidate.stat_positions["4key"][0].position,
        &transition.candidate.graph_positions["4key"][0].position,
        &transition.candidate.knob_positions["4key"][0].position,
    ];
    for (position, expected) in actual
        .into_iter()
        .zip(targets.iter().map(|target| target.2))
    {
        assert_eq!(position.class_name.as_deref(), Some(expected));
        assert_eq!(position.display_text.as_deref(), Some("display-sibling"));
        assert_eq!(position.layer_name.as_deref(), Some("layer-sibling"));
        assert_eq!(position.font_family.as_deref(), Some("font-sibling"));
        assert_eq!(
            position.counter.font_family.as_deref(),
            Some("counter-font-sibling")
        );
    }
    assert_eq!(
        transition.changed_fields,
        [
            EditorField::KeyPositions,
            EditorField::StatPositions,
            EditorField::GraphPositions,
            EditorField::KnobPositions,
        ]
    );
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let error = prepare_editor_ops_transition(
        &store,
        &[
            ops[0].clone(),
            patch_property_op(
                EditorElementTypeV1::Stat,
                &targets[2].1,
                EditorElementPropertyPatchV1::ClassName("wrong-type".to_string()),
            ),
        ],
    )
    .unwrap_err();
    assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
    assert_eq!(store.key_positions["4key"][0].class_name, None);
}

#[test]
fn numeric_style_patches_preserve_raw_f64_ranges_and_siblings() {
    let mut store = store_with_every_reorder_type();
    for position in [
        &mut store.key_positions.get_mut("4key").unwrap()[0],
        &mut store.stat_positions.get_mut("4key").unwrap()[0].position,
        &mut store.graph_positions.get_mut("4key").unwrap()[0].position,
        &mut store.knob_positions.get_mut("4key").unwrap()[0].position,
    ] {
        position.border_width = None;
        position.border_radius = None;
        position.font_size = None;
        position.class_name = Some("class-sibling".to_string());
        position.display_text = Some("display-sibling".to_string());
        position.counter.font_size = 33;
    }
    let key_id = store.key_positions["4key"][0].id.clone();
    let stat_id = store.stat_positions["4key"][0].position.id.clone();
    let graph_id = store.graph_positions["4key"][0].position.id.clone();
    let knob_id = store.knob_positions["4key"][0].position.id.clone();
    let ops = vec![
        patch_property_op(
            EditorElementTypeV1::Key,
            &key_id,
            EditorElementPropertyPatchV1::BorderWidth(0.0),
        ),
        patch_property_op(
            EditorElementTypeV1::Stat,
            &stat_id,
            EditorElementPropertyPatchV1::BorderRadius(100.0),
        ),
        patch_property_op(
            EditorElementTypeV1::Graph,
            &graph_id,
            EditorElementPropertyPatchV1::FontSize(8.0),
        ),
        patch_property_op(
            EditorElementTypeV1::Knob,
            &knob_id,
            EditorElementPropertyPatchV1::BorderRadius(999.0),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            uuid::Uuid::new_v4().to_string(),
            EditorElementPropertyPatchV1::BorderWidth(1.0),
        ),
    ];

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    let actual = [
        &transition.candidate.key_positions["4key"][0],
        &transition.candidate.stat_positions["4key"][0].position,
        &transition.candidate.graph_positions["4key"][0].position,
        &transition.candidate.knob_positions["4key"][0].position,
    ];
    for position in actual {
        assert_eq!(position.class_name.as_deref(), Some("class-sibling"));
        assert_eq!(position.display_text.as_deref(), Some("display-sibling"));
        assert_eq!(position.counter.font_size, 33);
    }
    assert_eq!(
        transition.candidate.key_positions["4key"][0].border_width,
        Some(0.0)
    );
    assert_eq!(
        transition.candidate.stat_positions["4key"][0]
            .position
            .border_radius,
        Some(100.0)
    );
    assert_eq!(
        transition.candidate.graph_positions["4key"][0]
            .position
            .font_size,
        Some(8.0)
    );
    assert_eq!(
        transition.candidate.knob_positions["4key"][0]
            .position
            .border_radius,
        Some(999.0)
    );
    assert_eq!(
        transition.changed_fields,
        [
            EditorField::KeyPositions,
            EditorField::StatPositions,
            EditorField::GraphPositions,
            EditorField::KnobPositions,
        ]
    );
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let upper_boundaries = prepare_editor_ops_transition(
        &store,
        &[
            patch_property_op(
                EditorElementTypeV1::Stat,
                &stat_id,
                EditorElementPropertyPatchV1::BorderWidth(20.0),
            ),
            patch_property_op(
                EditorElementTypeV1::Graph,
                &graph_id,
                EditorElementPropertyPatchV1::FontSize(72.0),
            ),
        ],
    )
    .unwrap();
    assert_eq!(
        upper_boundaries.candidate.stat_positions["4key"][0]
            .position
            .border_width,
        Some(20.0)
    );
    assert_eq!(
        upper_boundaries.candidate.graph_positions["4key"][0]
            .position
            .font_size,
        Some(72.0)
    );

    let error = prepare_editor_ops_transition(
        &store,
        &[
            ops[0].clone(),
            patch_property_op(
                EditorElementTypeV1::Stat,
                &graph_id,
                EditorElementPropertyPatchV1::FontSize(16.0),
            ),
        ],
    )
    .unwrap_err();
    assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
    assert_eq!(store.key_positions["4key"][0].border_width, None);

    let invalid = [
        (
            EditorElementTypeV1::Key,
            EditorElementPropertyPatchV1::BorderWidth(-0.1),
            "BORDER_WIDTH_OUT_OF_RANGE",
        ),
        (
            EditorElementTypeV1::Key,
            EditorElementPropertyPatchV1::BorderWidth(20.1),
            "BORDER_WIDTH_OUT_OF_RANGE",
        ),
        (
            EditorElementTypeV1::Stat,
            EditorElementPropertyPatchV1::BorderRadius(100.1),
            "BORDER_RADIUS_OUT_OF_RANGE",
        ),
        (
            EditorElementTypeV1::Knob,
            EditorElementPropertyPatchV1::BorderRadius(999.1),
            "BORDER_RADIUS_OUT_OF_RANGE",
        ),
        (
            EditorElementTypeV1::Graph,
            EditorElementPropertyPatchV1::FontSize(7.9),
            "FONT_SIZE_OUT_OF_RANGE",
        ),
        (
            EditorElementTypeV1::Graph,
            EditorElementPropertyPatchV1::FontSize(72.1),
            "FONT_SIZE_OUT_OF_RANGE",
        ),
        (
            EditorElementTypeV1::Key,
            EditorElementPropertyPatchV1::BorderWidth(f64::NAN),
            "BORDER_WIDTH_OUT_OF_RANGE",
        ),
        (
            EditorElementTypeV1::Key,
            EditorElementPropertyPatchV1::FontSize(f64::INFINITY),
            "FONT_SIZE_OUT_OF_RANGE",
        ),
    ];
    for (element_type, patch, expected_code) in invalid {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                ops[0].clone(),
                patch_property_op(element_type, uuid::Uuid::new_v4().to_string(), patch),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some(expected_code));
        assert_eq!(store.key_positions["4key"][0].border_width, None);
    }
}

#[test]
fn inactive_image_patch_preserves_asset_siblings_and_raw_empty_across_native_types() {
    let mut store = store_with_every_reorder_type();
    for position in [
        &mut store.key_positions.get_mut("4key").unwrap()[0],
        &mut store.stat_positions.get_mut("4key").unwrap()[0].position,
        &mut store.graph_positions.get_mut("4key").unwrap()[0].position,
        &mut store.knob_positions.get_mut("4key").unwrap()[0].position,
    ] {
        position.inactive_image = None;
        position.active_image = Some("active-sibling.png".to_string());
        position.sound_path = Some("sound-sibling.wav".to_string());
    }
    let targets = [
        (
            EditorElementTypeV1::Key,
            store.key_positions["4key"][0].id.clone(),
        ),
        (
            EditorElementTypeV1::Stat,
            store.stat_positions["4key"][0].position.id.clone(),
        ),
        (
            EditorElementTypeV1::Graph,
            store.graph_positions["4key"][0].position.id.clone(),
        ),
        (
            EditorElementTypeV1::Knob,
            store.knob_positions["4key"][0].position.id.clone(),
        ),
    ];
    let raw = prepare_editor_ops_transition(
        &store,
        &[patch_property_op(
            EditorElementTypeV1::Key,
            &targets[0].1,
            EditorElementPropertyPatchV1::InactiveImage("  raw/path.png  ".to_string()),
        )],
    )
    .unwrap();
    assert_eq!(
        raw.candidate.key_positions["4key"][0]
            .inactive_image
            .as_deref(),
        Some("  raw/path.png  ")
    );
    let patch = EditorElementPropertyPatchV1::InactiveImage(String::new());
    let ops = targets
        .iter()
        .map(|(element_type, id)| patch_property_op(*element_type, id, patch.clone()))
        .chain(std::iter::once(patch_property_op(
            EditorElementTypeV1::Key,
            uuid::Uuid::new_v4().to_string(),
            patch.clone(),
        )))
        .collect::<Vec<_>>();

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    for position in [
        &transition.candidate.key_positions["4key"][0],
        &transition.candidate.stat_positions["4key"][0].position,
        &transition.candidate.graph_positions["4key"][0].position,
        &transition.candidate.knob_positions["4key"][0].position,
    ] {
        assert_eq!(position.inactive_image.as_deref(), Some(""));
        assert_eq!(position.active_image.as_deref(), Some("active-sibling.png"));
        assert_eq!(position.sound_path.as_deref(), Some("sound-sibling.wav"));
    }
    assert_eq!(
        transition.changed_fields,
        [
            EditorField::KeyPositions,
            EditorField::StatPositions,
            EditorField::GraphPositions,
            EditorField::KnobPositions,
        ]
    );
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let error = prepare_editor_ops_transition(
        &store,
        &[
            ops[0].clone(),
            patch_property_op(
                EditorElementTypeV1::Stat,
                &targets[2].1,
                EditorElementPropertyPatchV1::InactiveImage("wrong".to_string()),
            ),
        ],
    )
    .unwrap_err();
    assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
    assert_eq!(store.key_positions["4key"][0].inactive_image, None);
}

#[test]
fn active_image_patch_is_key_or_knob_only_and_preserves_asset_siblings() {
    let mut store = store_with_every_reorder_type();
    store.key_positions.get_mut("4key").unwrap()[0].active_image = None;
    store.knob_positions.get_mut("4key").unwrap()[0]
        .position
        .active_image = None;
    for position in [
        &mut store.key_positions.get_mut("4key").unwrap()[0],
        &mut store.knob_positions.get_mut("4key").unwrap()[0].position,
    ] {
        position.inactive_image = Some("idle-sibling.png".to_string());
        position.active_image_fit = Some(crate::models::ImageFit::Contain);
        position.active_transparent = true;
        position.counter.enabled = false;
    }
    let key_id = store.key_positions["4key"][0].id.clone();
    let knob_id = store.knob_positions["4key"][0].position.id.clone();
    let missing_id = uuid::Uuid::new_v4().to_string();
    let patch = EditorElementPropertyPatchV1::ActiveImage(String::new());
    let ops = vec![
        patch_property_op(EditorElementTypeV1::Key, &key_id, patch.clone()),
        patch_property_op(EditorElementTypeV1::Knob, &knob_id, patch.clone()),
        patch_property_op(EditorElementTypeV1::Key, &missing_id, patch.clone()),
    ];

    let raw = prepare_editor_ops_transition(
        &store,
        &[patch_property_op(
            EditorElementTypeV1::Knob,
            &knob_id,
            EditorElementPropertyPatchV1::ActiveImage("  raw/active.png  ".to_string()),
        )],
    )
    .unwrap();
    assert_eq!(
        raw.candidate.knob_positions["4key"][0]
            .position
            .active_image
            .as_deref(),
        Some("  raw/active.png  ")
    );

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    for position in [
        &transition.candidate.key_positions["4key"][0],
        &transition.candidate.knob_positions["4key"][0].position,
    ] {
        assert_eq!(position.active_image.as_deref(), Some(""));
        assert_eq!(position.inactive_image.as_deref(), Some("idle-sibling.png"));
        assert_eq!(
            position.active_image_fit,
            Some(crate::models::ImageFit::Contain)
        );
        assert!(position.active_transparent);
        assert!(!position.counter.enabled);
    }
    assert_eq!(
        transition.changed_fields,
        [EditorField::KeyPositions, EditorField::KnobPositions]
    );
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    for element_type in [EditorElementTypeV1::Stat, EditorElementTypeV1::Graph] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                ops[0].clone(),
                patch_property_op(
                    element_type,
                    uuid::Uuid::new_v4().to_string(),
                    patch.clone(),
                ),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
        assert_eq!(store.key_positions["4key"][0].active_image, None);
    }
}

#[test]
fn image_transparency_patches_preserve_opposite_state_and_asset_siblings() {
    let mut store = store_with_every_reorder_type();
    for position in [
        &mut store.key_positions.get_mut("4key").unwrap()[0],
        &mut store.stat_positions.get_mut("4key").unwrap()[0].position,
        &mut store.graph_positions.get_mut("4key").unwrap()[0].position,
        &mut store.knob_positions.get_mut("4key").unwrap()[0].position,
    ] {
        position.idle_transparent = false;
        position.active_transparent = false;
        position.inactive_image = Some("idle-sibling.png".to_string());
        position.active_image = Some("active-sibling.png".to_string());
        position.image_fit = Some(crate::models::ImageFit::Fill);
        position.idle_image_fit = Some(crate::models::ImageFit::Contain);
        position.active_image_fit = Some(crate::models::ImageFit::None);
        position.counter.enabled = true;
    }
    let targets = [
        (
            EditorElementTypeV1::Key,
            store.key_positions["4key"][0].id.clone(),
        ),
        (
            EditorElementTypeV1::Stat,
            store.stat_positions["4key"][0].position.id.clone(),
        ),
        (
            EditorElementTypeV1::Graph,
            store.graph_positions["4key"][0].position.id.clone(),
        ),
        (
            EditorElementTypeV1::Knob,
            store.knob_positions["4key"][0].position.id.clone(),
        ),
    ];
    let idle_patch = EditorElementPropertyPatchV1::IdleTransparent(true);
    let idle_ops = targets
        .iter()
        .map(|(element_type, id)| patch_property_op(*element_type, id, idle_patch.clone()))
        .chain(std::iter::once(patch_property_op(
            EditorElementTypeV1::Key,
            uuid::Uuid::new_v4().to_string(),
            idle_patch.clone(),
        )))
        .collect::<Vec<_>>();

    let idle = prepare_editor_ops_transition(&store, &idle_ops).unwrap();
    assert_eq!(
        idle.changed_fields,
        [
            EditorField::KeyPositions,
            EditorField::StatPositions,
            EditorField::GraphPositions,
            EditorField::KnobPositions,
        ]
    );
    assert_eq!(
        idle.op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );
    for position in [
        &idle.candidate.key_positions["4key"][0],
        &idle.candidate.stat_positions["4key"][0].position,
        &idle.candidate.graph_positions["4key"][0].position,
        &idle.candidate.knob_positions["4key"][0].position,
    ] {
        assert!(position.idle_transparent);
        assert!(!position.active_transparent);
        assert_eq!(position.inactive_image.as_deref(), Some("idle-sibling.png"));
        assert_eq!(position.active_image.as_deref(), Some("active-sibling.png"));
        assert_eq!(position.image_fit, Some(crate::models::ImageFit::Fill));
        assert_eq!(
            position.idle_image_fit,
            Some(crate::models::ImageFit::Contain)
        );
        assert_eq!(
            position.active_image_fit,
            Some(crate::models::ImageFit::None)
        );
        assert!(position.counter.enabled);
    }
    let idle_replay = prepare_editor_ops_transition(&idle.scratch, &idle_ops).unwrap();
    assert!(idle_replay.changed_fields.is_empty());
    assert_eq!(
        idle_replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let active_patch = EditorElementPropertyPatchV1::ActiveTransparent(true);
    let active_ops = vec![
        patch_property_op(
            EditorElementTypeV1::Key,
            &targets[0].1,
            active_patch.clone(),
        ),
        patch_property_op(
            EditorElementTypeV1::Knob,
            &targets[3].1,
            active_patch.clone(),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            uuid::Uuid::new_v4().to_string(),
            active_patch.clone(),
        ),
    ];
    let active = prepare_editor_ops_transition(&idle.scratch, &active_ops).unwrap();
    assert_eq!(
        active
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );
    assert!(active.candidate.key_positions["4key"][0].active_transparent);
    assert!(
        active.candidate.knob_positions["4key"][0]
            .position
            .active_transparent
    );
    assert!(active.candidate.key_positions["4key"][0].idle_transparent);
    assert!(
        active.candidate.knob_positions["4key"][0]
            .position
            .idle_transparent
    );

    for element_type in [EditorElementTypeV1::Stat, EditorElementTypeV1::Graph] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                idle_ops[0].clone(),
                patch_property_op(
                    element_type,
                    uuid::Uuid::new_v4().to_string(),
                    active_patch.clone(),
                ),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
        assert!(!store.key_positions["4key"][0].idle_transparent);
    }
}

#[test]
fn image_fit_patches_materialize_state_specific_values_and_preserve_siblings() {
    let mut store = store_with_every_reorder_type();
    for position in [
        &mut store.key_positions.get_mut("4key").unwrap()[0],
        &mut store.stat_positions.get_mut("4key").unwrap()[0].position,
        &mut store.graph_positions.get_mut("4key").unwrap()[0].position,
        &mut store.knob_positions.get_mut("4key").unwrap()[0].position,
    ] {
        position.image_fit = Some(crate::models::ImageFit::Cover);
        position.idle_image_fit = None;
        position.active_image_fit = None;
        position.idle_transparent = true;
        position.active_transparent = true;
        position.inactive_image = Some("idle-sibling.png".to_string());
        position.active_image = Some("active-sibling.png".to_string());
        position.counter.enabled = true;
    }
    let targets = [
        (
            EditorElementTypeV1::Key,
            store.key_positions["4key"][0].id.clone(),
        ),
        (
            EditorElementTypeV1::Stat,
            store.stat_positions["4key"][0].position.id.clone(),
        ),
        (
            EditorElementTypeV1::Graph,
            store.graph_positions["4key"][0].position.id.clone(),
        ),
        (
            EditorElementTypeV1::Knob,
            store.knob_positions["4key"][0].position.id.clone(),
        ),
    ];
    let idle_patch = EditorElementPropertyPatchV1::IdleImageFit(crate::models::ImageFit::Cover);
    let idle_ops = targets
        .iter()
        .map(|(element_type, id)| patch_property_op(*element_type, id, idle_patch.clone()))
        .chain(std::iter::once(patch_property_op(
            EditorElementTypeV1::Key,
            uuid::Uuid::new_v4().to_string(),
            idle_patch.clone(),
        )))
        .collect::<Vec<_>>();

    let idle = prepare_editor_ops_transition(&store, &idle_ops).unwrap();
    assert_eq!(
        idle.op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );
    for position in [
        &idle.candidate.key_positions["4key"][0],
        &idle.candidate.stat_positions["4key"][0].position,
        &idle.candidate.graph_positions["4key"][0].position,
        &idle.candidate.knob_positions["4key"][0].position,
    ] {
        assert_eq!(position.image_fit, Some(crate::models::ImageFit::Cover));
        assert_eq!(
            position.idle_image_fit,
            Some(crate::models::ImageFit::Cover)
        );
        assert_eq!(position.active_image_fit, None);
        assert!(position.idle_transparent);
        assert!(position.active_transparent);
        assert_eq!(position.inactive_image.as_deref(), Some("idle-sibling.png"));
        assert_eq!(position.active_image.as_deref(), Some("active-sibling.png"));
        assert!(position.counter.enabled);
    }
    let idle_replay = prepare_editor_ops_transition(&idle.scratch, &idle_ops).unwrap();
    assert!(idle_replay.changed_fields.is_empty());
    assert_eq!(
        idle_replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let active_patch = EditorElementPropertyPatchV1::ActiveImageFit(crate::models::ImageFit::Cover);
    let active_ops = vec![
        patch_property_op(
            EditorElementTypeV1::Key,
            &targets[0].1,
            active_patch.clone(),
        ),
        patch_property_op(
            EditorElementTypeV1::Knob,
            &targets[3].1,
            active_patch.clone(),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            uuid::Uuid::new_v4().to_string(),
            active_patch.clone(),
        ),
    ];
    let active = prepare_editor_ops_transition(&idle.scratch, &active_ops).unwrap();
    assert_eq!(
        active
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );
    assert_eq!(
        active.candidate.key_positions["4key"][0].active_image_fit,
        Some(crate::models::ImageFit::Cover)
    );
    assert_eq!(
        active.candidate.knob_positions["4key"][0]
            .position
            .active_image_fit,
        Some(crate::models::ImageFit::Cover)
    );

    for element_type in [EditorElementTypeV1::Stat, EditorElementTypeV1::Graph] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                idle_ops[0].clone(),
                patch_property_op(
                    element_type,
                    uuid::Uuid::new_v4().to_string(),
                    active_patch.clone(),
                ),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
        assert_eq!(store.key_positions["4key"][0].idle_image_fit, None);
    }
}

#[test]
fn element_rotation_patches_apply_noop_reset_and_reject_invalid_values() {
    let base = store_with_every_reorder_type();
    for (element_type, id, field) in [
        (
            EditorElementTypeV1::Key,
            base.key_positions["4key"][0].id.clone(),
            EditorField::KeyPositions,
        ),
        (
            EditorElementTypeV1::Stat,
            base.stat_positions["4key"][0].position.id.clone(),
            EditorField::StatPositions,
        ),
        (
            EditorElementTypeV1::Graph,
            base.graph_positions["4key"][0].position.id.clone(),
            EditorField::GraphPositions,
        ),
        (
            EditorElementTypeV1::Knob,
            base.knob_positions["4key"][0].position.id.clone(),
            EditorField::KnobPositions,
        ),
    ] {
        let mut store = base.clone();
        for rotation in [-180.0, 45.5, 180.0, 0.0] {
            let op = patch_property_op(
                element_type,
                &id,
                EditorElementPropertyPatchV1::Rotation(rotation),
            );
            let transition =
                prepare_editor_ops_transition(&store, std::slice::from_ref(&op)).unwrap();
            assert_eq!(
                transition.op_results[0].status,
                EditorOpResultStatusV1::Applied
            );
            assert_eq!(transition.changed_fields, [field]);
            let mut expected = EditorDocumentV1::from_store(&store);
            let position = match element_type {
                EditorElementTypeV1::Key => &mut expected.key_positions.get_mut("4key").unwrap()[0],
                EditorElementTypeV1::Stat => {
                    &mut expected.stat_positions.get_mut("4key").unwrap()[0].position
                }
                EditorElementTypeV1::Graph => {
                    &mut expected.graph_positions.get_mut("4key").unwrap()[0].position
                }
                EditorElementTypeV1::Knob => {
                    &mut expected.knob_positions.get_mut("4key").unwrap()[0].position
                }
                EditorElementTypeV1::Sprite => unreachable!(),
            };
            position.rotation = rotation;
            assert_eq!(transition.candidate, expected);
            store = transition.scratch;
            let replay = prepare_editor_ops_transition(&store, &[op]).unwrap();
            assert_eq!(
                replay.op_results[0].status,
                EditorOpResultStatusV1::NoChange
            );
            assert!(replay.changed_fields.is_empty());
            assert_eq!(replay.candidate, expected);
        }
        for rotation in [-180.1, 180.1, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let error = prepare_editor_ops_transition(
                &store,
                &[patch_property_op(
                    element_type,
                    &id,
                    EditorElementPropertyPatchV1::Rotation(rotation),
                )],
            )
            .unwrap_err();
            assert_eq!(validation_code(&error), Some("ROTATION_OUT_OF_RANGE"));
        }
    }
}

#[test]
fn image_transform_patches_seed_noop_reset_and_store_sparse_mode() {
    let store = store_with_every_reorder_type();
    let key_id = store.key_positions["4key"][0].id.clone();
    let ops = vec![
        patch_property_op(
            EditorElementTypeV1::Key,
            &key_id,
            EditorElementPropertyPatchV1::ImageMode(ImageMode::Overlay),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            &key_id,
            EditorElementPropertyPatchV1::IdleImageTransform(Some(
                ImageTransformLeafPatchV1::OffsetX(125.0),
            )),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            &key_id,
            EditorElementPropertyPatchV1::ActiveImageTransform(Some(
                ImageTransformLeafPatchV1::Scale(1.5),
            )),
        ),
    ];

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    let position = &transition.candidate.key_positions["4key"][0];
    assert_eq!(position.image_mode, Some(ImageMode::Overlay));
    assert_eq!(
        position.idle_image_transform,
        Some(ImageTransform {
            offset_x: 125.0,
            ..ImageTransform::default()
        })
    );
    assert_eq!(
        position.active_image_transform,
        Some(ImageTransform {
            scale: 1.5,
            ..ImageTransform::default()
        })
    );
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
        ]
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert!(replay
        .op_results
        .iter()
        .all(|result| result.status == EditorOpResultStatusV1::NoChange));

    let reset_ops = [
        patch_property_op(
            EditorElementTypeV1::Key,
            &key_id,
            EditorElementPropertyPatchV1::ImageMode(ImageMode::Replace),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            &key_id,
            EditorElementPropertyPatchV1::IdleImageTransform(None),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            &key_id,
            EditorElementPropertyPatchV1::ActiveImageTransform(None),
        ),
    ];
    let reset = prepare_editor_ops_transition(&transition.scratch, &reset_ops).unwrap();
    let position = &reset.candidate.key_positions["4key"][0];
    assert_eq!(position.image_mode, None);
    assert_eq!(position.idle_image_transform, None);
    assert_eq!(position.active_image_transform, None);
    assert!(reset
        .op_results
        .iter()
        .all(|result| result.status == EditorOpResultStatusV1::Applied));

    let reset_replay = prepare_editor_ops_transition(&reset.scratch, &reset_ops).unwrap();
    assert!(reset_replay.changed_fields.is_empty());
    assert!(reset_replay
        .op_results
        .iter()
        .all(|result| result.status == EditorOpResultStatusV1::NoChange));
}

#[test]
fn image_transform_properties_reject_non_keys_and_invalid_ranges() {
    let store = store_with_every_reorder_type();
    for patch in [
        EditorElementPropertyPatchV1::ImageMode(ImageMode::Overlay),
        EditorElementPropertyPatchV1::IdleImageTransform(Some(
            ImageTransformLeafPatchV1::Rotation(45.0),
        )),
        EditorElementPropertyPatchV1::ActiveImageTransform(None),
    ] {
        for (element_type, id) in [
            (
                EditorElementTypeV1::Stat,
                store.stat_positions["4key"][0].position.id.clone(),
            ),
            (
                EditorElementTypeV1::Graph,
                store.graph_positions["4key"][0].position.id.clone(),
            ),
            (
                EditorElementTypeV1::Knob,
                store.knob_positions["4key"][0].position.id.clone(),
            ),
        ] {
            let error = prepare_editor_ops_transition(
                &store,
                &[patch_property_op(element_type, id, patch.clone())],
            )
            .unwrap_err();
            assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
        }
    }

    let key_id = store.key_positions["4key"][0].id.clone();
    for patch in [
        ImageTransformLeafPatchV1::OffsetX(-500.1),
        ImageTransformLeafPatchV1::OffsetY(f64::INFINITY),
        ImageTransformLeafPatchV1::Rotation(180.1),
        ImageTransformLeafPatchV1::Scale(0.09),
        ImageTransformLeafPatchV1::Scale(f64::NAN),
    ] {
        let error = prepare_editor_ops_transition(
            &store,
            &[patch_property_op(
                EditorElementTypeV1::Key,
                &key_id,
                EditorElementPropertyPatchV1::IdleImageTransform(Some(patch)),
            )],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some("INVALID_IMAGE_TRANSFORM"));
    }
}

#[test]
fn sound_path_patch_is_key_only_and_preserves_sound_and_asset_siblings() {
    let mut store = store_with_every_reorder_type();
    for position in store.key_positions.get_mut("4key").unwrap() {
        position.sound_path = None;
        position.sound_enabled = Some(true);
        position.sound_volume = Some(137.5);
        position.inactive_image = Some("idle-sibling.png".to_string());
        position.active_image = Some("active-sibling.png".to_string());
        position.counter.enabled = false;
    }
    let key_ids = store.key_positions["4key"]
        .iter()
        .take(2)
        .map(|position| position.id.clone())
        .collect::<Vec<_>>();
    let patch = EditorElementPropertyPatchV1::SoundPath(String::new());
    let ops = key_ids
        .iter()
        .map(|id| patch_property_op(EditorElementTypeV1::Key, id, patch.clone()))
        .chain(std::iter::once(patch_property_op(
            EditorElementTypeV1::Key,
            uuid::Uuid::new_v4().to_string(),
            patch.clone(),
        )))
        .collect::<Vec<_>>();

    let raw = prepare_editor_ops_transition(
        &store,
        &[patch_property_op(
            EditorElementTypeV1::Key,
            &key_ids[0],
            EditorElementPropertyPatchV1::SoundPath("  raw/sound.wav  ".to_string()),
        )],
    )
    .unwrap();
    assert_eq!(
        raw.candidate.key_positions["4key"][0].sound_path.as_deref(),
        Some("  raw/sound.wav  ")
    );

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    for position in transition.candidate.key_positions["4key"].iter().take(2) {
        assert_eq!(position.sound_path.as_deref(), Some(""));
        assert_eq!(position.sound_enabled, Some(true));
        assert_eq!(position.sound_volume, Some(137.5));
        assert_eq!(position.inactive_image.as_deref(), Some("idle-sibling.png"));
        assert_eq!(position.active_image.as_deref(), Some("active-sibling.png"));
        assert!(!position.counter.enabled);
    }
    assert_eq!(transition.changed_fields, [EditorField::KeyPositions]);
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    for element_type in [
        EditorElementTypeV1::Stat,
        EditorElementTypeV1::Graph,
        EditorElementTypeV1::Knob,
    ] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                ops[0].clone(),
                patch_property_op(
                    element_type,
                    uuid::Uuid::new_v4().to_string(),
                    patch.clone(),
                ),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
        assert!(store.key_positions["4key"]
            .iter()
            .all(|position| position.sound_path.is_none()));
    }
}

#[test]
fn sound_enabled_patch_materializes_false_and_preserves_siblings_atomically() {
    let mut store = store_with_every_reorder_type();
    let key_ids = store.key_positions["4key"]
        .iter()
        .take(2)
        .map(|position| position.id.clone())
        .collect::<Vec<_>>();
    for (index, position) in store
        .key_positions
        .get_mut("4key")
        .unwrap()
        .iter_mut()
        .take(2)
        .enumerate()
    {
        position.sound_enabled = if index == 0 { None } else { Some(false) };
        position.sound_path = Some("sounds/sibling.wav".to_string());
        position.sound_volume = Some(137.5);
        position.inactive_image = Some("idle-sibling.png".to_string());
        position.active_image = Some("active-sibling.png".to_string());
        position.counter.enabled = false;
    }
    let patch = EditorElementPropertyPatchV1::SoundEnabled(false);
    let ops = vec![
        patch_property_op(EditorElementTypeV1::Key, &key_ids[0], patch.clone()),
        patch_property_op(EditorElementTypeV1::Key, &key_ids[1], patch.clone()),
        patch_property_op(
            EditorElementTypeV1::Key,
            uuid::Uuid::new_v4().to_string(),
            patch.clone(),
        ),
    ];

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    for position in transition.candidate.key_positions["4key"].iter().take(2) {
        assert_eq!(position.sound_enabled, Some(false));
        assert_eq!(position.sound_path.as_deref(), Some("sounds/sibling.wav"));
        assert_eq!(position.sound_volume, Some(137.5));
        assert_eq!(position.inactive_image.as_deref(), Some("idle-sibling.png"));
        assert_eq!(position.active_image.as_deref(), Some("active-sibling.png"));
        assert!(!position.counter.enabled);
    }
    assert_eq!(transition.changed_fields, [EditorField::KeyPositions]);
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    for element_type in [
        EditorElementTypeV1::Stat,
        EditorElementTypeV1::Graph,
        EditorElementTypeV1::Knob,
    ] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                ops[0].clone(),
                patch_property_op(
                    element_type,
                    uuid::Uuid::new_v4().to_string(),
                    patch.clone(),
                ),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
        assert_eq!(store.key_positions["4key"][0].sound_enabled, None);
    }
}

#[test]
fn sound_volume_patch_materializes_default_and_validates_range_atomically() {
    let mut store = store_with_every_reorder_type();
    let key_ids = store.key_positions["4key"]
        .iter()
        .take(2)
        .map(|position| position.id.clone())
        .collect::<Vec<_>>();
    for (index, position) in store
        .key_positions
        .get_mut("4key")
        .unwrap()
        .iter_mut()
        .take(2)
        .enumerate()
    {
        position.sound_volume = if index == 0 { None } else { Some(100.0) };
        position.sound_path = Some("sounds/sibling.wav".to_string());
        position.sound_enabled = Some(true);
        position.inactive_image = Some("idle-sibling.png".to_string());
        position.active_image = Some("active-sibling.png".to_string());
        position.counter.enabled = false;
    }
    let patch = EditorElementPropertyPatchV1::SoundVolume(100.0);
    let ops = vec![
        patch_property_op(EditorElementTypeV1::Key, &key_ids[0], patch.clone()),
        patch_property_op(EditorElementTypeV1::Key, &key_ids[1], patch.clone()),
        patch_property_op(
            EditorElementTypeV1::Key,
            uuid::Uuid::new_v4().to_string(),
            patch.clone(),
        ),
    ];

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    for position in transition.candidate.key_positions["4key"].iter().take(2) {
        assert_eq!(position.sound_volume, Some(100.0));
        assert_eq!(position.sound_path.as_deref(), Some("sounds/sibling.wav"));
        assert_eq!(position.sound_enabled, Some(true));
        assert_eq!(position.inactive_image.as_deref(), Some("idle-sibling.png"));
        assert_eq!(position.active_image.as_deref(), Some("active-sibling.png"));
        assert!(!position.counter.enabled);
    }
    assert_eq!(transition.changed_fields, [EditorField::KeyPositions]);
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );
    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    for element_type in [
        EditorElementTypeV1::Stat,
        EditorElementTypeV1::Graph,
        EditorElementTypeV1::Knob,
    ] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                ops[0].clone(),
                patch_property_op(
                    element_type,
                    uuid::Uuid::new_v4().to_string(),
                    patch.clone(),
                ),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
        assert_eq!(store.key_positions["4key"][0].sound_volume, None);
    }
    for invalid in [-1.0, 200.1, f64::NAN, f64::INFINITY] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                ops[0].clone(),
                patch_property_op(
                    EditorElementTypeV1::Key,
                    uuid::Uuid::new_v4().to_string(),
                    EditorElementPropertyPatchV1::SoundVolume(invalid),
                ),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some("SOUND_VOLUME_OUT_OF_RANGE"));
        assert_eq!(store.key_positions["4key"][0].sound_volume, None);
    }
    for boundary in [0.0, 200.0] {
        prepare_editor_ops_transition(
            &store,
            &[patch_property_op(
                EditorElementTypeV1::Key,
                &key_ids[0],
                EditorElementPropertyPatchV1::SoundVolume(boundary),
            )],
        )
        .unwrap();
    }
}

#[test]
fn counter_boolean_patches_preserve_nested_siblings_and_reject_wrong_types_atomically() {
    let mut store = store_with_every_reorder_type();
    let key_id = store.key_positions["4key"][0].id.clone();
    let stat_id = store.stat_positions["4key"][0].position.id.clone();
    let missing_id = uuid::Uuid::new_v4().to_string();
    {
        let counter = &mut store.key_positions.get_mut("4key").unwrap()[0].counter;
        counter.enabled = true;
        counter.placement = crate::models::KeyCounterPlacement::Outside;
        counter.animation.enabled = true;
        counter.animation.preset_id = Some("builtin-linear".to_string());
        counter.animation.scale = 1.75;
    }
    {
        let counter = &mut store.stat_positions.get_mut("4key").unwrap()[0]
            .position
            .counter;
        counter.enabled = true;
        counter.placement = crate::models::KeyCounterPlacement::Outside;
        counter.animation.enabled = true;
        counter.animation.preset_id = Some("builtin-linear".to_string());
        counter.animation.scale = 1.75;
    }
    let counter_enabled = EditorElementPropertyPatchV1::CounterEnabled(false);
    let animation_enabled = EditorElementPropertyPatchV1::CounterAnimationEnabled(false);
    let ops = vec![
        patch_property_op(EditorElementTypeV1::Key, &key_id, counter_enabled.clone()),
        patch_property_op(
            EditorElementTypeV1::Stat,
            &stat_id,
            animation_enabled.clone(),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            &missing_id,
            counter_enabled.clone(),
        ),
    ];

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    let key_counter = &transition.candidate.key_positions["4key"][0].counter;
    assert!(!key_counter.enabled);
    assert!(key_counter.animation.enabled);
    assert_eq!(
        key_counter.animation.preset_id.as_deref(),
        Some("builtin-linear")
    );
    assert_eq!(key_counter.animation.scale, 1.75);
    assert!(matches!(
        key_counter.placement,
        crate::models::KeyCounterPlacement::Outside
    ));
    let stat_counter = &transition.candidate.stat_positions["4key"][0]
        .position
        .counter;
    assert!(stat_counter.enabled);
    assert!(!stat_counter.animation.enabled);
    assert_eq!(
        stat_counter.animation.preset_id.as_deref(),
        Some("builtin-linear")
    );
    assert_eq!(stat_counter.animation.scale, 1.75);
    assert!(matches!(
        stat_counter.placement,
        crate::models::KeyCounterPlacement::Outside
    ));
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let cross_ops = vec![
        patch_property_op(EditorElementTypeV1::Key, &key_id, animation_enabled.clone()),
        patch_property_op(EditorElementTypeV1::Stat, &stat_id, counter_enabled.clone()),
        patch_property_op(
            EditorElementTypeV1::Stat,
            uuid::Uuid::new_v4().to_string(),
            animation_enabled.clone(),
        ),
    ];
    let cross = prepare_editor_ops_transition(&store, &cross_ops).unwrap();
    assert!(
        !cross.candidate.key_positions["4key"][0]
            .counter
            .animation
            .enabled
    );
    assert!(
        !cross.candidate.stat_positions["4key"][0]
            .position
            .counter
            .enabled
    );
    assert_eq!(
        cross
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );
    let cross_replay = prepare_editor_ops_transition(&cross.scratch, &cross_ops).unwrap();
    assert_eq!(
        cross_replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    for (element_type, patch) in [
        (EditorElementTypeV1::Graph, counter_enabled),
        (EditorElementTypeV1::Knob, animation_enabled),
    ] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                ops[0].clone(),
                patch_property_op(element_type, uuid::Uuid::new_v4().to_string(), patch),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
        assert!(store.key_positions["4key"][0].counter.enabled);
        assert!(
            store.stat_positions["4key"][0]
                .position
                .counter
                .animation
                .enabled
        );
    }
}

#[test]
fn counter_layout_patches_change_one_leaf_and_preserve_hidden_siblings_atomically() {
    let mut store = store_with_every_reorder_type();
    let key_ids = store.key_positions["4key"]
        .iter()
        .take(2)
        .map(|position| position.id.clone())
        .collect::<Vec<_>>();
    let mut second_stat = store.stat_positions["4key"][0].clone();
    second_stat.position.id = uuid::Uuid::new_v4().to_string();
    store
        .stat_positions
        .get_mut("4key")
        .unwrap()
        .push(second_stat);
    let stat_ids = store.stat_positions["4key"]
        .iter()
        .take(2)
        .map(|position| position.position.id.clone())
        .collect::<Vec<_>>();
    for counter in store.key_positions.get_mut("4key").unwrap()[..2]
        .iter_mut()
        .map(|position| &mut position.counter)
        .chain(
            store.stat_positions.get_mut("4key").unwrap()[..2]
                .iter_mut()
                .map(|position| &mut position.position.counter),
        )
    {
        counter.enabled = false;
        counter.placement = crate::models::KeyCounterPlacement::Inside;
        counter.align = crate::models::KeyCounterAlign::Bottom;
        counter.align_mode = crate::models::KeyCounterAlignMode::Between;
        counter.gap = 7;
        counter.fill.idle = "fill-sibling".to_string();
        counter.fill.active = "active-fill-sibling".to_string();
        counter.font_family = Some("font-sibling".to_string());
        counter.animation.enabled = false;
        counter.animation.preset_id = Some("builtin-linear".to_string());
        counter.animation.scale = 1.75;
    }
    let originals = [
        store.key_positions["4key"][0].counter.clone(),
        store.key_positions["4key"][1].counter.clone(),
        store.stat_positions["4key"][0].position.counter.clone(),
        store.stat_positions["4key"][1].position.counter.clone(),
    ];
    let placement =
        EditorElementPropertyPatchV1::CounterPlacement(crate::models::KeyCounterPlacement::Outside);
    let align = EditorElementPropertyPatchV1::CounterAlign(crate::models::KeyCounterAlign::Right);
    let align_mode =
        EditorElementPropertyPatchV1::CounterAlignMode(crate::models::KeyCounterAlignMode::Center);
    let gap = EditorElementPropertyPatchV1::CounterGap(u32::MAX);
    let ops = vec![
        patch_property_op(EditorElementTypeV1::Key, &key_ids[0], placement.clone()),
        patch_property_op(EditorElementTypeV1::Key, &key_ids[1], align.clone()),
        patch_property_op(EditorElementTypeV1::Stat, &stat_ids[0], align_mode.clone()),
        patch_property_op(EditorElementTypeV1::Stat, &stat_ids[1], gap.clone()),
        patch_property_op(
            EditorElementTypeV1::Key,
            uuid::Uuid::new_v4().to_string(),
            gap.clone(),
        ),
    ];

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    let actual = [
        transition.candidate.key_positions["4key"][0]
            .counter
            .clone(),
        transition.candidate.key_positions["4key"][1]
            .counter
            .clone(),
        transition.candidate.stat_positions["4key"][0]
            .position
            .counter
            .clone(),
        transition.candidate.stat_positions["4key"][1]
            .position
            .counter
            .clone(),
    ];
    let mut expected = originals.clone();
    expected[0].placement = crate::models::KeyCounterPlacement::Outside;
    expected[1].align = crate::models::KeyCounterAlign::Right;
    expected[2].align_mode = crate::models::KeyCounterAlignMode::Center;
    expected[3].gap = u32::MAX;
    assert_eq!(actual, expected);
    assert!(matches!(
        actual[0].align_mode,
        crate::models::KeyCounterAlignMode::Between
    ));
    assert_eq!(
        transition.changed_fields,
        [EditorField::KeyPositions, EditorField::StatPositions]
    );
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    for (element_type, patch) in [
        (EditorElementTypeV1::Graph, placement),
        (EditorElementTypeV1::Knob, align),
        (EditorElementTypeV1::Graph, align_mode),
        (EditorElementTypeV1::Knob, gap),
    ] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                ops[0].clone(),
                patch_property_op(element_type, uuid::Uuid::new_v4().to_string(), patch),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
        assert_eq!(store.key_positions["4key"][0].counter, originals[0]);
    }
}

#[test]
fn counter_typography_patches_preserve_siblings_and_validate_types_and_ranges_atomically() {
    let mut store = store_with_every_reorder_type();
    let key_ids = store.key_positions["4key"]
        .iter()
        .take(2)
        .map(|position| position.id.clone())
        .collect::<Vec<_>>();
    let first_stat = store.stat_positions["4key"][0].clone();
    for _ in 0..3 {
        let mut stat = first_stat.clone();
        stat.position.id = uuid::Uuid::new_v4().to_string();
        store.stat_positions.get_mut("4key").unwrap().push(stat);
    }
    let stat_ids = store.stat_positions["4key"]
        .iter()
        .take(4)
        .map(|position| position.position.id.clone())
        .collect::<Vec<_>>();
    for counter in store.key_positions.get_mut("4key").unwrap()[..2]
        .iter_mut()
        .map(|position| &mut position.counter)
        .chain(
            store.stat_positions.get_mut("4key").unwrap()[..4]
                .iter_mut()
                .map(|position| &mut position.position.counter),
        )
    {
        counter.font_size = 16;
        counter.font_weight = 400;
        counter.font_italic = false;
        counter.font_underline = false;
        counter.font_strikethrough = false;
        counter.font_family = Some("font-sibling".to_string());
        counter.fill.idle = "fill-sibling".to_string();
        counter.fill.active = "active-fill-sibling".to_string();
        counter.placement = crate::models::KeyCounterPlacement::Outside;
        counter.animation.preset_id = Some("builtin-linear".to_string());
    }
    store.stat_positions.get_mut("4key").unwrap()[3]
        .position
        .counter
        .font_family = None;
    store.stat_positions.get_mut("4key").unwrap()[3]
        .position
        .font_family = Some("top-level-font-sibling".to_string());
    let originals = [
        store.key_positions["4key"][0].counter.clone(),
        store.key_positions["4key"][1].counter.clone(),
        store.stat_positions["4key"][0].position.counter.clone(),
        store.stat_positions["4key"][1].position.counter.clone(),
        store.stat_positions["4key"][2].position.counter.clone(),
        store.stat_positions["4key"][3].position.counter.clone(),
    ];
    let patches = [
        EditorElementPropertyPatchV1::CounterFontSize(72),
        EditorElementPropertyPatchV1::CounterFontWeight(900),
        EditorElementPropertyPatchV1::CounterFontItalic(true),
        EditorElementPropertyPatchV1::CounterFontUnderline(true),
        EditorElementPropertyPatchV1::CounterFontStrikethrough(true),
        EditorElementPropertyPatchV1::CounterFontFamily("  raw-counter-font  ".to_string()),
    ];
    let ops = vec![
        patch_property_op(EditorElementTypeV1::Key, &key_ids[0], patches[0].clone()),
        patch_property_op(EditorElementTypeV1::Key, &key_ids[1], patches[1].clone()),
        patch_property_op(EditorElementTypeV1::Stat, &stat_ids[0], patches[2].clone()),
        patch_property_op(EditorElementTypeV1::Stat, &stat_ids[1], patches[3].clone()),
        patch_property_op(EditorElementTypeV1::Stat, &stat_ids[2], patches[4].clone()),
        patch_property_op(EditorElementTypeV1::Stat, &stat_ids[3], patches[5].clone()),
        patch_property_op(
            EditorElementTypeV1::Key,
            uuid::Uuid::new_v4().to_string(),
            patches[0].clone(),
        ),
    ];

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    let actual = [
        transition.candidate.key_positions["4key"][0]
            .counter
            .clone(),
        transition.candidate.key_positions["4key"][1]
            .counter
            .clone(),
        transition.candidate.stat_positions["4key"][0]
            .position
            .counter
            .clone(),
        transition.candidate.stat_positions["4key"][1]
            .position
            .counter
            .clone(),
        transition.candidate.stat_positions["4key"][2]
            .position
            .counter
            .clone(),
        transition.candidate.stat_positions["4key"][3]
            .position
            .counter
            .clone(),
    ];
    let mut expected = originals.clone();
    expected[0].font_size = 72;
    expected[1].font_weight = 900;
    expected[2].font_italic = true;
    expected[3].font_underline = true;
    expected[4].font_strikethrough = true;
    expected[5].font_family = Some("  raw-counter-font  ".to_string());
    assert_eq!(actual, expected);
    assert_eq!(
        transition.candidate.stat_positions["4key"][3]
            .position
            .font_family
            .as_deref(),
        Some("top-level-font-sibling")
    );
    assert_eq!(
        transition.changed_fields,
        [EditorField::KeyPositions, EditorField::StatPositions]
    );
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    for (element_type, patch) in [
        (EditorElementTypeV1::Graph, patches[0].clone()),
        (EditorElementTypeV1::Knob, patches[1].clone()),
        (EditorElementTypeV1::Graph, patches[2].clone()),
        (EditorElementTypeV1::Knob, patches[3].clone()),
        (EditorElementTypeV1::Graph, patches[4].clone()),
        (EditorElementTypeV1::Knob, patches[5].clone()),
    ] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                ops[0].clone(),
                patch_property_op(element_type, uuid::Uuid::new_v4().to_string(), patch),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
        assert_eq!(store.key_positions["4key"][0].counter, originals[0]);
    }

    for (patch, code) in [
        (
            EditorElementPropertyPatchV1::CounterFontSize(7),
            "COUNTER_FONT_SIZE_OUT_OF_RANGE",
        ),
        (
            EditorElementPropertyPatchV1::CounterFontSize(73),
            "COUNTER_FONT_SIZE_OUT_OF_RANGE",
        ),
        (
            EditorElementPropertyPatchV1::CounterFontWeight(99),
            "COUNTER_FONT_WEIGHT_OUT_OF_RANGE",
        ),
        (
            EditorElementPropertyPatchV1::CounterFontWeight(901),
            "COUNTER_FONT_WEIGHT_OUT_OF_RANGE",
        ),
    ] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                ops[0].clone(),
                patch_property_op(EditorElementTypeV1::Stat, &stat_ids[0], patch),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some(code));
        assert_eq!(store.key_positions["4key"][0].counter, originals[0]);
    }

    let lower_boundaries = prepare_editor_ops_transition(
        &store,
        &[
            patch_property_op(
                EditorElementTypeV1::Key,
                &key_ids[0],
                EditorElementPropertyPatchV1::CounterFontSize(8),
            ),
            patch_property_op(
                EditorElementTypeV1::Stat,
                &stat_ids[0],
                EditorElementPropertyPatchV1::CounterFontWeight(100),
            ),
        ],
    )
    .unwrap();
    assert_eq!(
        lower_boundaries.candidate.key_positions["4key"][0]
            .counter
            .font_size,
        8
    );
    assert_eq!(
        lower_boundaries.candidate.stat_positions["4key"][0]
            .position
            .counter
            .font_weight,
        100
    );
}

#[test]
fn counter_fill_intents_apply_atomic_pairs_and_reject_noncanonical_plans() {
    let mut store = store_with_every_reorder_type();
    let key_ids = store.key_positions["4key"]
        .iter()
        .take(2)
        .map(|position| position.id.clone())
        .collect::<Vec<_>>();
    let stat_id = store.stat_positions["4key"][0].position.id.clone();
    for counter in store.key_positions.get_mut("4key").unwrap()[..2]
        .iter_mut()
        .map(|position| &mut position.counter)
        .chain(std::iter::once(
            &mut store.stat_positions.get_mut("4key").unwrap()[0]
                .position
                .counter,
        ))
    {
        counter.fill.idle = "idle-before".to_string();
        counter.fill.active = "active-before".to_string();
        counter.fill_idle_gradient = Some(GradientSpec::from_canonical_parts(
            15.0,
            vec![
                crate::models::GradientStop {
                    color: "old-idle".to_string(),
                    pos: 0.0,
                },
                crate::models::GradientStop {
                    color: "old-idle-end".to_string(),
                    pos: 1.0,
                },
            ],
        ));
        counter.fill_active_gradient = Some(GradientSpec::from_canonical_parts(
            30.0,
            vec![
                crate::models::GradientStop {
                    color: "old-active".to_string(),
                    pos: 0.0,
                },
                crate::models::GradientStop {
                    color: "old-active-end".to_string(),
                    pos: 1.0,
                },
            ],
        ));
        counter.gap = 19;
        counter.font_family = Some("font-sibling".to_string());
        counter.animation.preset_id = Some("builtin-linear".to_string());
    }
    let originals = [
        store.key_positions["4key"][0].counter.clone(),
        store.key_positions["4key"][1].counter.clone(),
        store.stat_positions["4key"][0].position.counter.clone(),
    ];
    let idle_gradient = counter_fill_gradient(
        "rgba(170,187,204,1)",
        45.0,
        &[("#ABC", 0.0), ("#112233", 1.0)],
    );
    let active_gradient = counter_fill_gradient(
        "rgba(1,2,3,0.5)",
        90.0,
        &[("rgba(1, 2, 3, 0.5)", 0.0), ("transparent", 1.0)],
    );
    let ops = vec![
        patch_property_op(
            EditorElementTypeV1::Key,
            &key_ids[0],
            EditorElementPropertyPatchV1::CounterFillIdle(idle_gradient.clone()),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            &key_ids[1],
            EditorElementPropertyPatchV1::CounterFillActive(active_gradient.clone()),
        ),
        patch_property_op(
            EditorElementTypeV1::Stat,
            &stat_id,
            EditorElementPropertyPatchV1::CounterFillIdle(counter_fill_solid("  raw solid  ")),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            uuid::Uuid::new_v4().to_string(),
            EditorElementPropertyPatchV1::CounterFillIdle(counter_fill_solid("missing")),
        ),
    ];

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    assert_eq!(
        transition.changed_fields,
        [EditorField::KeyPositions, EditorField::StatPositions]
    );
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );
    let actual = [
        transition.candidate.key_positions["4key"][0]
            .counter
            .clone(),
        transition.candidate.key_positions["4key"][1]
            .counter
            .clone(),
        transition.candidate.stat_positions["4key"][0]
            .position
            .counter
            .clone(),
    ];
    let mut expected = originals.clone();
    expected[0].fill.idle = "rgba(170,187,204,1)".to_string();
    expected[0].fill_idle_gradient = match &idle_gradient {
        EditorCounterFillIntentV1::Gradient(intent) => Some(intent.gradient.to_gradient_spec()),
        EditorCounterFillIntentV1::Solid(_) => unreachable!(),
    };
    expected[1].fill.active = "rgba(1,2,3,0.5)".to_string();
    expected[1].fill_active_gradient = match &active_gradient {
        EditorCounterFillIntentV1::Gradient(intent) => Some(intent.gradient.to_gradient_spec()),
        EditorCounterFillIntentV1::Solid(_) => unreachable!(),
    };
    expected[2].fill.idle = "  raw solid  ".to_string();
    expected[2].fill_idle_gradient = None;
    assert_eq!(actual, expected);
    assert_eq!(actual[0].fill.active, originals[0].fill.active);
    assert_eq!(
        actual[0].fill_active_gradient,
        originals[0].fill_active_gradient
    );
    assert_eq!(actual[1].fill.idle, originals[1].fill.idle);
    assert_eq!(
        actual[1].fill_idle_gradient,
        originals[1].fill_idle_gradient
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    for (invalid, code) in [
        (
            counter_fill_gradient("#ABC", 45.0, &[("#ABC", 0.0), ("#fff", 1.0)]),
            "COUNTER_FILL_COLOR_GRADIENT_MISMATCH",
        ),
        (
            counter_fill_gradient("rgba(170,187,204,1)", -0.0, &[("#ABC", 0.0), ("#fff", 1.0)]),
            "INVALID_PAINT_GRADIENT",
        ),
    ] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                ops[0].clone(),
                patch_property_op(
                    EditorElementTypeV1::Key,
                    uuid::Uuid::new_v4().to_string(),
                    EditorElementPropertyPatchV1::CounterFillIdle(invalid),
                ),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some(code));
        assert_eq!(store.key_positions["4key"][0].counter, originals[0]);
    }

    for (element_type, patch) in [
        (
            EditorElementTypeV1::Graph,
            EditorElementPropertyPatchV1::CounterFillIdle(counter_fill_solid("idle")),
        ),
        (
            EditorElementTypeV1::Knob,
            EditorElementPropertyPatchV1::CounterFillIdle(counter_fill_solid("idle")),
        ),
        (
            EditorElementTypeV1::Stat,
            EditorElementPropertyPatchV1::CounterFillActive(counter_fill_solid("active")),
        ),
    ] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                ops[0].clone(),
                patch_property_op(element_type, uuid::Uuid::new_v4().to_string(), patch),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
        assert_eq!(store.key_positions["4key"][0].counter, originals[0]);
    }
}

#[test]
fn counter_animation_preset_patch_uses_current_library_and_preserves_unmasked_fields() {
    let mut store = store_with_every_reorder_type();
    let preset = CounterAnimationPreset {
        id: "user-current".to_string(),
        name: "Current".to_string(),
        source: crate::models::CounterAnimationSource::User,
        label_key: None,
        bezier: [0.1, 0.2, 0.8, 0.9],
        scale: 1.25,
        duration_ms: 420,
    };
    store.counter_animation_presets.push(preset.clone());
    let key_id = store.key_positions["4key"][0].id.clone();
    let stat_id = store.stat_positions["4key"][0].position.id.clone();
    let missing_id = uuid::Uuid::new_v4().to_string();
    {
        let animation = &mut store.key_positions.get_mut("4key").unwrap()[0]
            .counter
            .animation;
        animation.enabled = false;
        animation.preset_id = Some("builtin-ease-out".to_string());
        animation.bezier = [0.3, 0.4, 0.5, 0.6];
        animation.scale = 0.75;
        animation.duration_ms = 777;
    }
    let partial = EditorElementPropertyPatchV1::CounterAnimationPreset(
        EditorCounterAnimationPresetIntentV1 {
            preset_id: preset.id.clone(),
            apply_preset_id: None,
            bezier: None,
            scale: Some(preset.scale),
            duration_ms: None,
        },
    );
    let full = EditorElementPropertyPatchV1::CounterAnimationPreset(
        EditorCounterAnimationPresetIntentV1 {
            preset_id: preset.id.clone(),
            apply_preset_id: Some(true),
            bezier: Some(preset.bezier),
            scale: Some(preset.scale),
            duration_ms: Some(preset.duration_ms),
        },
    );
    let ops = vec![
        patch_property_op(EditorElementTypeV1::Key, &key_id, partial.clone()),
        patch_property_op(EditorElementTypeV1::Stat, &stat_id, full.clone()),
        patch_property_op(EditorElementTypeV1::Key, &missing_id, full.clone()),
    ];

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    let key_animation = &transition.candidate.key_positions["4key"][0]
        .counter
        .animation;
    assert!(!key_animation.enabled);
    assert_eq!(key_animation.preset_id.as_deref(), Some("builtin-ease-out"));
    assert_eq!(key_animation.bezier, [0.3, 0.4, 0.5, 0.6]);
    assert_eq!(key_animation.scale, preset.scale);
    assert_eq!(key_animation.duration_ms, 777);
    let stat_animation = &transition.candidate.stat_positions["4key"][0]
        .position
        .counter
        .animation;
    assert_eq!(
        stat_animation.preset_id.as_deref(),
        Some(preset.id.as_str())
    );
    assert_eq!(stat_animation.bezier, preset.bezier);
    assert_eq!(stat_animation.scale, preset.scale);
    assert_eq!(stat_animation.duration_ms, preset.duration_ms);
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let id_only = EditorElementPropertyPatchV1::CounterAnimationPreset(
        EditorCounterAnimationPresetIntentV1 {
            preset_id: preset.id.clone(),
            apply_preset_id: None,
            bezier: None,
            scale: None,
            duration_ms: None,
        },
    );
    prepare_editor_ops_transition(
        &store,
        &[patch_property_op(
            EditorElementTypeV1::Key,
            &key_id,
            id_only,
        )],
    )
    .unwrap();

    let stale = EditorElementPropertyPatchV1::CounterAnimationPreset(
        EditorCounterAnimationPresetIntentV1 {
            preset_id: preset.id.clone(),
            apply_preset_id: None,
            bezier: Some(preset.bezier),
            scale: Some(preset.scale + 0.01),
            duration_ms: Some(preset.duration_ms),
        },
    );
    let error = prepare_editor_ops_transition(
        &store,
        &[
            ops[0].clone(),
            patch_property_op(EditorElementTypeV1::Stat, &stat_id, stale),
        ],
    )
    .unwrap_err();
    assert_eq!(
        validation_code(&error),
        Some("COUNTER_ANIMATION_PRESET_MISMATCH")
    );
    assert_eq!(
        store.key_positions["4key"][0]
            .counter
            .animation
            .preset_id
            .as_deref(),
        Some("builtin-ease-out")
    );

    let missing_preset = EditorElementPropertyPatchV1::CounterAnimationPreset(
        EditorCounterAnimationPresetIntentV1 {
            preset_id: "user-deleted".to_string(),
            apply_preset_id: Some(true),
            bezier: None,
            scale: None,
            duration_ms: None,
        },
    );
    let error = prepare_editor_ops_transition(
        &store,
        &[patch_property_op(
            EditorElementTypeV1::Key,
            &key_id,
            missing_preset,
        )],
    )
    .unwrap_err();
    assert_eq!(
        validation_code(&error),
        Some("COUNTER_ANIMATION_PRESET_NOT_FOUND")
    );

    for invalid in [
        EditorCounterAnimationPresetIntentV1 {
            preset_id: preset.id.clone(),
            apply_preset_id: None,
            bezier: Some([f64::NAN, 0.2, 0.8, 0.9]),
            scale: None,
            duration_ms: None,
        },
        EditorCounterAnimationPresetIntentV1 {
            preset_id: preset.id.clone(),
            apply_preset_id: None,
            bezier: Some([-0.1, 0.2, 0.8, 0.9]),
            scale: None,
            duration_ms: None,
        },
        EditorCounterAnimationPresetIntentV1 {
            preset_id: preset.id.clone(),
            apply_preset_id: None,
            bezier: None,
            scale: Some(f64::INFINITY),
            duration_ms: None,
        },
        EditorCounterAnimationPresetIntentV1 {
            preset_id: preset.id.clone(),
            apply_preset_id: None,
            bezier: None,
            scale: None,
            duration_ms: Some(0),
        },
        EditorCounterAnimationPresetIntentV1 {
            preset_id: preset.id.clone(),
            apply_preset_id: None,
            bezier: None,
            scale: None,
            duration_ms: Some(5001),
        },
    ] {
        let error = prepare_editor_ops_transition(
            &store,
            &[patch_property_op(
                EditorElementTypeV1::Key,
                &key_id,
                EditorElementPropertyPatchV1::CounterAnimationPreset(invalid),
            )],
        )
        .unwrap_err();
        assert_eq!(
            validation_code(&error),
            Some("INVALID_COUNTER_ANIMATION_PRESET_VALUE")
        );
    }

    for element_type in [EditorElementTypeV1::Graph, EditorElementTypeV1::Knob] {
        let error = prepare_editor_ops_transition(
            &store,
            &[patch_property_op(
                element_type,
                uuid::Uuid::new_v4().to_string(),
                full.clone(),
            )],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
    }
}

#[test]
fn stat_type_patch_is_stat_only_and_preserves_embedded_position() {
    let mut store = store_with_every_reorder_type();
    store.graph_positions.get_mut("4key").unwrap()[0].stat_type = GraphStatType::KpsMax;
    let stat = store.stat_positions["4key"][0].clone();
    let graph = store.graph_positions["4key"][0].clone();
    let stat_id = stat.position.id.clone();
    let missing_id = uuid::Uuid::new_v4().to_string();
    let patch = EditorElementPropertyPatchV1::StatType(StatType::Total);
    let ops = vec![
        patch_property_op(EditorElementTypeV1::Stat, &stat_id, patch.clone()),
        patch_property_op(EditorElementTypeV1::Stat, missing_id, patch.clone()),
    ];

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    assert_eq!(
        transition.candidate.stat_positions["4key"][0].stat_type,
        StatType::Total
    );
    assert_eq!(
        transition.candidate.stat_positions["4key"][0].position,
        stat.position
    );
    assert_eq!(transition.candidate.graph_positions["4key"][0], graph);
    assert_eq!(transition.changed_fields, [EditorField::StatPositions]);
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let error = prepare_editor_ops_transition(
        &store,
        &[
            ops[0].clone(),
            patch_property_op(EditorElementTypeV1::Graph, &stat_id, patch),
        ],
    )
    .unwrap_err();
    assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
    assert_eq!(store.stat_positions["4key"][0], stat);
    assert_eq!(store.graph_positions["4key"][0], graph);
}

#[test]
fn note_literal_patches_are_key_only_and_preserve_border_side_raw_state() {
    let mut store = base_store();
    let ids = store
        .key_positions
        .values()
        .flat_map(|positions| positions.iter().map(|position| position.id.clone()))
        .take(5)
        .collect::<Vec<_>>();
    assert_eq!(ids.len(), 5);
    let legacy_id = store
        .key_positions
        .values_mut()
        .flat_map(|positions| positions.iter_mut())
        .find(|position| !ids.contains(&position.id))
        .map(|position| {
            position.note_border_side = Some("diagonal".to_string());
            position.id.clone()
        })
        .expect("default modes contain an untargeted key");
    let ops = vec![
        patch_property_op(
            EditorElementTypeV1::Key,
            &ids[0],
            EditorElementPropertyPatchV1::NoteEffectEnabled(false),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            &ids[1],
            EditorElementPropertyPatchV1::NoteGlowEnabled(true),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            &ids[2],
            EditorElementPropertyPatchV1::NoteAutoYCorrection(false),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            &ids[3],
            EditorElementPropertyPatchV1::NoteAlignment(crate::models::NoteAlignment::Right),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            &ids[4],
            EditorElementPropertyPatchV1::NoteBorderSide(
                crate::models::EditorNoteBorderSideV1::All,
            ),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            uuid::Uuid::new_v4().to_string(),
            EditorElementPropertyPatchV1::NoteGlowEnabled(true),
        ),
    ];

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    let changed = transition
        .candidate
        .key_positions
        .values()
        .flat_map(|positions| positions.iter())
        .map(|position| (position.id.as_str(), position))
        .collect::<HashMap<_, _>>();
    assert!(!changed[ids[0].as_str()].note_effect_enabled);
    assert!(changed[ids[1].as_str()].note_glow_enabled);
    assert!(!changed[ids[2].as_str()].note_auto_y_correction);
    assert_eq!(
        changed[ids[3].as_str()].note_alignment,
        crate::models::NoteAlignment::Right
    );
    assert_eq!(
        changed[ids[4].as_str()].note_border_side.as_deref(),
        Some("all")
    );
    assert_eq!(
        changed[legacy_id.as_str()].note_border_side.as_deref(),
        Some("diagonal")
    );
    assert_eq!(transition.changed_fields, [EditorField::KeyPositions]);
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    for (element_type, id) in [
        (EditorElementTypeV1::Stat, ids[1].clone()),
        (EditorElementTypeV1::Graph, uuid::Uuid::new_v4().to_string()),
    ] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                ops[0].clone(),
                patch_property_op(
                    element_type,
                    id,
                    EditorElementPropertyPatchV1::NoteGlowEnabled(true),
                ),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
    }
    assert!(store.key_positions.values().flatten().all(|position| {
        position.note_effect_enabled
            && !position.note_glow_enabled
            && position.note_auto_y_correction
            && (position.id == legacy_id || position.note_border_side.is_none())
    }));
}

#[test]
fn note_glow_sync_enable_mirrors_body_paint_and_replays_as_no_change() {
    let mut store = base_store();
    let id = store.key_positions["4key"][0].id.clone();
    let position = &mut store.key_positions.get_mut("4key").unwrap()[0];
    position.note_color = NoteColor::Gradient {
        top: "#112233".to_string(),
        bottom: "#445566".to_string(),
    };
    position.note_gradient = serde_json::from_value(serde_json::json!({
        "angle": 180,
        "stops": [
            { "color": "#112233", "pos": 0 },
            { "color": "rgba(68, 85, 102, 0.5)", "pos": 1 }
        ]
    }))
    .unwrap();
    position.note_opacity = 80;
    position.note_opacity_top = Some(80);
    position.note_opacity_bottom = Some(40);
    position.note_glow_color = Some(NoteColor::Solid("stale".to_string()));
    position.note_glow_opacity = 70;

    let op = patch_property_op(
        EditorElementTypeV1::Key,
        &id,
        EditorElementPropertyPatchV1::NoteGlowSyncPaint(true),
    );
    let transition = prepare_editor_ops_transition(&store, std::slice::from_ref(&op)).unwrap();
    let changed = &transition.candidate.key_positions["4key"][0];
    assert!(changed.note_glow_sync_paint);
    assert_note_body_glow_paint_equal(changed);
    assert_eq!(
        transition.op_results[0].status,
        EditorOpResultStatusV1::Applied
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &[op]).unwrap();
    assert_eq!(
        replay.op_results[0].status,
        EditorOpResultStatusV1::NoChange
    );
}

#[test]
fn synced_note_paint_variants_mirror_every_body_paint_field() {
    let mut store = base_store();
    let id = store.key_positions["4key"][0].id.clone();
    let position = &mut store.key_positions.get_mut("4key").unwrap()[0];
    position.note_glow_sync_paint = true;
    position.note_color = NoteColor::Gradient {
        top: "#010203".to_string(),
        bottom: "#040506".to_string(),
    };
    position.note_gradient = serde_json::from_value(serde_json::json!({
        "angle": 45,
        "stops": [
            { "color": "#010203", "pos": 0 },
            { "color": "#040506", "pos": 1 }
        ]
    }))
    .unwrap();
    position.note_opacity = 90;
    position.note_opacity_top = Some(90);
    position.note_opacity_bottom = Some(90);
    assert!(position.mirror_note_body_to_glow());

    let descriptor = EditorElementPropertyPatchV1::NotePaint(EditorNotePaintIntentV1::Descriptor(
        crate::models::EditorNotePaintDescriptorIntentV1 {
            color: EditorNoteColorV1::Gradient(crate::models::EditorNoteGradientColorV1 {
                kind: crate::models::EditorNoteGradientColorKindV1::Gradient,
                top: "#112233".to_string(),
                bottom: "#445566".to_string(),
            }),
            opacity: 60,
            gradient: Some(crate::models::EditorPaintGradientV1 {
                angle: 90.0,
                stops: vec![
                    crate::models::EditorPaintGradientStopV1 {
                        color: "#112233".to_string(),
                        pos: 0.0,
                    },
                    crate::models::EditorPaintGradientStopV1 {
                        color: "rgba(68, 85, 102, 0.5)".to_string(),
                        pos: 1.0,
                    },
                ],
            }),
        },
    ));
    let color = EditorElementPropertyPatchV1::NotePaint(EditorNotePaintIntentV1::Color(
        crate::models::EditorNotePaintColorIntentV1 {
            color: EditorNoteColorV1::Solid("#AABBCC".to_string()),
        },
    ));
    let opacity = EditorElementPropertyPatchV1::NotePaint(EditorNotePaintIntentV1::Opacity(
        crate::models::EditorNotePaintOpacityIntentV1 { opacity: 55 },
    ));
    let gradient_opacity =
        EditorElementPropertyPatchV1::NotePaint(EditorNotePaintIntentV1::GradientOpacity(
            crate::models::EditorNotePaintGradientOpacityIntentV1 {
                opacity: 70,
                opacity_top: 65,
                opacity_bottom: 35,
            },
        ));

    for patch in [descriptor, color, opacity, gradient_opacity] {
        let transition = prepare_editor_ops_transition(
            &store,
            &[patch_property_op(EditorElementTypeV1::Key, &id, patch)],
        )
        .unwrap();
        let changed = &transition.candidate.key_positions["4key"][0];
        assert_note_body_glow_paint_equal(changed);
        assert_eq!(
            transition.op_results[0].status,
            EditorOpResultStatusV1::Applied
        );
    }
}

#[test]
fn synced_note_glow_paint_rejects_the_whole_transition() {
    let mut store = base_store();
    let id = store.key_positions["4key"][0].id.clone();
    let position = &mut store.key_positions.get_mut("4key").unwrap()[0];
    position.note_glow_sync_paint = true;
    assert!(position.mirror_note_body_to_glow());
    let original = store.clone();

    let error = prepare_editor_ops_transition(
        &store,
        &[
            patch_property_op(
                EditorElementTypeV1::Key,
                &id,
                EditorElementPropertyPatchV1::Hidden(true),
            ),
            patch_property_op(
                EditorElementTypeV1::Key,
                &id,
                EditorElementPropertyPatchV1::NoteGlowPaint(EditorNotePaintIntentV1::Opacity(
                    crate::models::EditorNotePaintOpacityIntentV1 { opacity: 70 },
                )),
            ),
        ],
    )
    .unwrap_err();

    assert_eq!(validation_code(&error), Some("NOTE_GLOW_PAINT_SYNC_LOCKED"));
    assert_eq!(store, original);
}

#[test]
fn note_glow_sync_disable_preserves_the_mirrored_paint() {
    let mut store = base_store();
    let id = store.key_positions["4key"][0].id.clone();
    let position = &mut store.key_positions.get_mut("4key").unwrap()[0];
    position.note_glow_sync_paint = true;
    position.note_color = NoteColor::Solid("#123456".to_string());
    position.note_opacity = 73;
    position.note_opacity_top = Some(63);
    position.note_opacity_bottom = Some(53);
    assert!(position.mirror_note_body_to_glow());
    let before = position.clone();

    let transition = prepare_editor_ops_transition(
        &store,
        &[patch_property_op(
            EditorElementTypeV1::Key,
            &id,
            EditorElementPropertyPatchV1::NoteGlowSyncPaint(false),
        )],
    )
    .unwrap();
    let changed = &transition.candidate.key_positions["4key"][0];
    assert!(!changed.note_glow_sync_paint);
    assert_eq!(changed.note_glow_gradient, before.note_glow_gradient);
    assert_eq!(changed.note_glow_opacity, before.note_glow_opacity);
    assert_eq!(changed.note_glow_color, before.note_glow_color);
    assert_eq!(changed.note_glow_opacity_top, before.note_glow_opacity_top);
    assert_eq!(
        changed.note_glow_opacity_bottom,
        before.note_glow_opacity_bottom
    );
}

#[test]
fn unsynced_note_paint_preserves_glow_paint() {
    let mut store = base_store();
    let id = store.key_positions["4key"][0].id.clone();
    let position = &mut store.key_positions.get_mut("4key").unwrap()[0];
    position.note_glow_sync_paint = false;
    position.note_glow_color = Some(NoteColor::Solid("glow".to_string()));
    position.note_glow_opacity = 71;
    position.note_glow_opacity_top = Some(61);
    position.note_glow_opacity_bottom = Some(51);
    let before = position.clone();

    let transition = prepare_editor_ops_transition(
        &store,
        &[patch_property_op(
            EditorElementTypeV1::Key,
            &id,
            EditorElementPropertyPatchV1::NotePaint(EditorNotePaintIntentV1::Color(
                crate::models::EditorNotePaintColorIntentV1 {
                    color: EditorNoteColorV1::Solid("#AABBCC".to_string()),
                },
            )),
        )],
    )
    .unwrap();
    let changed = &transition.candidate.key_positions["4key"][0];
    assert_eq!(changed.note_glow_gradient, before.note_glow_gradient);
    assert_eq!(changed.note_glow_opacity, before.note_glow_opacity);
    assert_eq!(changed.note_glow_color, before.note_glow_color);
    assert_eq!(changed.note_glow_opacity_top, before.note_glow_opacity_top);
    assert_eq!(
        changed.note_glow_opacity_bottom,
        before.note_glow_opacity_bottom
    );
}

#[test]
fn note_glow_size_is_key_only_bounded_and_preserves_note_siblings() {
    let mut store = base_store();
    let id = store.key_positions["4key"][0].id.clone();
    let position = &mut store.key_positions.get_mut("4key").unwrap()[0];
    position.note_glow_size = 20.0;
    position.note_glow_enabled = true;
    position.note_glow_opacity = 71;
    position.note_glow_color = Some(crate::models::NoteColor::Solid("glow-sibling".to_string()));
    position.note_color = crate::models::NoteColor::Solid("note-sibling".to_string());
    position.note_border_width = Some(2.5);
    let original = position.clone();
    let patch = EditorElementPropertyPatchV1::NoteGlowSize(0.5);
    let ops = vec![
        patch_property_op(EditorElementTypeV1::Key, &id, patch.clone()),
        patch_property_op(
            EditorElementTypeV1::Key,
            uuid::Uuid::new_v4().to_string(),
            patch.clone(),
        ),
    ];

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    let changed = &transition.candidate.key_positions["4key"][0];
    assert_eq!(changed.note_glow_size, 0.5);
    assert_eq!(changed.note_glow_enabled, original.note_glow_enabled);
    assert_eq!(changed.note_glow_opacity, original.note_glow_opacity);
    assert_eq!(changed.note_glow_color, original.note_glow_color);
    assert_eq!(changed.note_color, original.note_color);
    assert_eq!(changed.note_border_width, original.note_border_width);
    assert_eq!(transition.changed_fields, [EditorField::KeyPositions]);
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    for value in [-0.1, 50.1, f64::NAN, f64::INFINITY] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                ops[0].clone(),
                patch_property_op(
                    EditorElementTypeV1::Key,
                    uuid::Uuid::new_v4().to_string(),
                    EditorElementPropertyPatchV1::NoteGlowSize(value),
                ),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some("NOTE_GLOW_SIZE_OUT_OF_RANGE"));
        assert_eq!(store.key_positions["4key"][0], original);
    }

    let lower = prepare_editor_ops_transition(
        &store,
        &[patch_property_op(
            EditorElementTypeV1::Key,
            &id,
            EditorElementPropertyPatchV1::NoteGlowSize(0.0),
        )],
    )
    .unwrap();
    assert_eq!(lower.candidate.key_positions["4key"][0].note_glow_size, 0.0);
    let upper = prepare_editor_ops_transition(
        &store,
        &[patch_property_op(
            EditorElementTypeV1::Key,
            &id,
            EditorElementPropertyPatchV1::NoteGlowSize(50.0),
        )],
    )
    .unwrap();
    assert_eq!(
        upper.candidate.key_positions["4key"][0].note_glow_size,
        50.0
    );

    for element_type in [
        EditorElementTypeV1::Stat,
        EditorElementTypeV1::Graph,
        EditorElementTypeV1::Knob,
    ] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                ops[0].clone(),
                patch_property_op(
                    element_type,
                    uuid::Uuid::new_v4().to_string(),
                    patch.clone(),
                ),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
        assert_eq!(store.key_positions["4key"][0], original);
    }
}

#[test]
fn note_gradient_descriptor_and_legacy_transitions_are_atomic() {
    let mut store = base_store();
    let id = store.key_positions["4key"][0].id.clone();
    let position = &mut store.key_positions.get_mut("4key").unwrap()[0];
    position.note_color = NoteColor::Solid("legacy".to_string());
    position.note_opacity = 90;
    position.note_opacity_top = Some(30);
    position.note_opacity_bottom = Some(70);

    let gradient = crate::models::EditorPaintGradientV1 {
        angle: 45.0,
        stops: vec![
            crate::models::EditorPaintGradientStopV1 {
                color: "rgba(17,34,51,.5)".to_string(),
                pos: 0.0,
            },
            crate::models::EditorPaintGradientStopV1 {
                color: "#44556640".to_string(),
                pos: 1.0,
            },
        ],
    };
    let descriptor = EditorElementPropertyPatchV1::NotePaint(EditorNotePaintIntentV1::Descriptor(
        crate::models::EditorNotePaintDescriptorIntentV1 {
            color: EditorNoteColorV1::Gradient(crate::models::EditorNoteGradientColorV1 {
                kind: crate::models::EditorNoteGradientColorKindV1::Gradient,
                top: "#112233".to_string(),
                bottom: "#445566".to_string(),
            }),
            opacity: 80,
            gradient: Some(gradient.clone()),
        },
    ));
    let first = prepare_editor_ops_transition(
        &store,
        &[patch_property_op(
            EditorElementTypeV1::Key,
            &id,
            descriptor.clone(),
        )],
    )
    .unwrap();
    let position = &first.candidate.key_positions["4key"][0];
    assert_eq!(position.note_gradient.as_ref().unwrap().angle, 45.0);
    assert_eq!(position.note_opacity, 80);
    assert_eq!(position.note_opacity_top, Some(40));
    assert_eq!(position.note_opacity_bottom, Some(20));
    assert_eq!(
        position.note_color,
        NoteColor::Gradient {
            top: "#112233".to_string(),
            bottom: "#445566".to_string(),
        }
    );

    let replay = prepare_editor_ops_transition(
        &first.scratch,
        &[patch_property_op(EditorElementTypeV1::Key, &id, descriptor)],
    )
    .unwrap();
    assert_eq!(
        replay.op_results[0].status,
        EditorOpResultStatusV1::NoChange
    );

    let opacity = EditorElementPropertyPatchV1::NotePaint(EditorNotePaintIntentV1::Opacity(
        crate::models::EditorNotePaintOpacityIntentV1 { opacity: 40 },
    ));
    let second = prepare_editor_ops_transition(
        &first.scratch,
        &[patch_property_op(EditorElementTypeV1::Key, &id, opacity)],
    )
    .unwrap();
    let position = &second.candidate.key_positions["4key"][0];
    assert!(position.note_gradient.is_some());
    assert_eq!(position.note_opacity_top, Some(20));
    assert_eq!(position.note_opacity_bottom, Some(10));

    let legacy_endpoints =
        EditorElementPropertyPatchV1::NotePaint(EditorNotePaintIntentV1::GradientOpacity(
            crate::models::EditorNotePaintGradientOpacityIntentV1 {
                opacity: 55,
                opacity_top: 11,
                opacity_bottom: 44,
            },
        ));
    let third = prepare_editor_ops_transition(
        &second.scratch,
        &[patch_property_op(
            EditorElementTypeV1::Key,
            &id,
            legacy_endpoints,
        )],
    )
    .unwrap();
    let position = &third.candidate.key_positions["4key"][0];
    assert!(position.note_gradient.is_none());
    assert_eq!(position.note_opacity, 55);
    assert_eq!(position.note_opacity_top, Some(11));
    assert_eq!(position.note_opacity_bottom, Some(44));

    let solid = EditorElementPropertyPatchV1::NoteGlowPaint(EditorNotePaintIntentV1::Descriptor(
        crate::models::EditorNotePaintDescriptorIntentV1 {
            color: EditorNoteColorV1::Solid("#AABBCC".to_string()),
            opacity: 35,
            gradient: None,
        },
    ));
    let fourth = prepare_editor_ops_transition(
        &third.scratch,
        &[patch_property_op(EditorElementTypeV1::Key, &id, solid)],
    )
    .unwrap();
    let position = &fourth.candidate.key_positions["4key"][0];
    assert!(position.note_glow_gradient.is_none());
    assert_eq!(
        position.note_glow_color,
        Some(NoteColor::Solid("#AABBCC".to_string()))
    );
    assert_eq!(position.note_glow_opacity, 35);
    assert_eq!(position.note_glow_opacity_top, Some(35));
    assert_eq!(position.note_glow_opacity_bottom, Some(35));
}

#[test]
fn note_gradient_descriptor_rejects_semantic_mismatches() {
    let store = base_store();
    let id = store.key_positions["4key"][0].id.clone();
    let gradient = |first: &str| crate::models::EditorPaintGradientV1 {
        angle: 45.0,
        stops: vec![
            crate::models::EditorPaintGradientStopV1 {
                color: first.to_string(),
                pos: 0.0,
            },
            crate::models::EditorPaintGradientStopV1 {
                color: "#445566".to_string(),
                pos: 1.0,
            },
        ],
    };
    let descriptor = |color, opacity, gradient| {
        EditorElementPropertyPatchV1::NotePaint(EditorNotePaintIntentV1::Descriptor(
            crate::models::EditorNotePaintDescriptorIntentV1 {
                color,
                opacity,
                gradient,
            },
        ))
    };

    let cases = [
        (
            descriptor(
                EditorNoteColorV1::Gradient(crate::models::EditorNoteGradientColorV1 {
                    kind: crate::models::EditorNoteGradientColorKindV1::Gradient,
                    top: "#000000".to_string(),
                    bottom: "#445566".to_string(),
                }),
                80,
                Some(gradient("#112233")),
            ),
            "PAINT_COLOR_GRADIENT_MISMATCH",
        ),
        (
            descriptor(
                EditorNoteColorV1::Gradient(crate::models::EditorNoteGradientColorV1 {
                    kind: crate::models::EditorNoteGradientColorKindV1::Gradient,
                    top: "#112233".to_string(),
                    bottom: "#445566".to_string(),
                }),
                80,
                None,
            ),
            "PAINT_COLOR_GRADIENT_MISMATCH",
        ),
        (
            descriptor(
                EditorNoteColorV1::Gradient(crate::models::EditorNoteGradientColorV1 {
                    kind: crate::models::EditorNoteGradientColorKindV1::Gradient,
                    top: "#112233".to_string(),
                    bottom: "#445566".to_string(),
                }),
                80,
                Some(gradient("transparent")),
            ),
            "INVALID_PAINT_GRADIENT",
        ),
        (
            descriptor(EditorNoteColorV1::Solid("#112233".to_string()), 101, None),
            "NOTE_OPACITY_OUT_OF_RANGE",
        ),
    ];

    for (patch, expected_code) in cases {
        let error = prepare_editor_ops_transition(
            &store,
            &[patch_property_op(EditorElementTypeV1::Key, &id, patch)],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some(expected_code));
    }
}

#[test]
fn note_paint_masks_preserve_siblings_materialize_options_and_reject_invalid_plans() {
    let mut store = base_store();
    let ids = [
        store.key_positions["4key"][0].id.clone(),
        store.key_positions["4key"][1].id.clone(),
        store.key_positions["4key"][2].id.clone(),
        store.key_positions["4key"][3].id.clone(),
        store.key_positions["5key"][0].id.clone(),
    ];
    let positions = store.key_positions.get_mut("4key").unwrap();
    positions[0].note_color = NoteColor::Solid("old-note".to_string());
    positions[0].note_opacity = 41;
    positions[0].note_opacity_top = Some(42);
    positions[0].note_opacity_bottom = Some(43);
    positions[1].note_opacity = 50;
    positions[1].note_opacity_top = Some(11);
    positions[1].note_opacity_bottom = Some(22);
    positions[2].note_glow_color = None;
    positions[2].note_glow_opacity = 71;
    positions[2].note_glow_opacity_top = Some(72);
    positions[2].note_glow_opacity_bottom = Some(73);
    positions[3].note_border_color = None;
    positions[3].note_border_opacity = 100;
    positions[3].note_border_gradient = serde_json::from_value(serde_json::json!({
        "angle": 45,
        "stops": [
            { "color": "#010203", "pos": 0 },
            { "color": "#040506", "pos": 1 }
        ]
    }))
    .unwrap();
    let full = &mut store.key_positions.get_mut("5key").unwrap()[0];
    full.note_glow_opacity = 65;
    full.note_glow_opacity_top = None;
    full.note_glow_opacity_bottom = None;
    full.note_glow_color = Some(NoteColor::Solid("glow-sibling".to_string()));
    let original = store.clone();

    let note_color = EditorElementPropertyPatchV1::NotePaint(EditorNotePaintIntentV1::Color(
        crate::models::EditorNotePaintColorIntentV1 {
            color: EditorNoteColorV1::Gradient(crate::models::EditorNoteGradientColorV1 {
                kind: crate::models::EditorNoteGradientColorKindV1::Gradient,
                top: "top".to_string(),
                bottom: "bottom".to_string(),
            }),
        },
    ));
    let note_opacity = EditorElementPropertyPatchV1::NotePaint(EditorNotePaintIntentV1::Opacity(
        crate::models::EditorNotePaintOpacityIntentV1 { opacity: 60 },
    ));
    let glow_color = EditorElementPropertyPatchV1::NoteGlowPaint(EditorNotePaintIntentV1::Color(
        crate::models::EditorNotePaintColorIntentV1 {
            color: EditorNoteColorV1::Solid(String::new()),
        },
    ));
    let border =
        EditorElementPropertyPatchV1::NoteBorderPaint(crate::models::EditorNoteBorderPaintV1 {
            color: "#FFFFFF".to_string(),
            opacity: 100,
            gradient: None,
        });
    let glow_tuple =
        EditorElementPropertyPatchV1::NoteGlowPaint(EditorNotePaintIntentV1::GradientOpacity(
            crate::models::EditorNotePaintGradientOpacityIntentV1 {
                opacity: 65,
                opacity_top: 10,
                opacity_bottom: 90,
            },
        ));
    let ops = vec![
        patch_property_op(EditorElementTypeV1::Key, &ids[0], note_color.clone()),
        patch_property_op(EditorElementTypeV1::Key, &ids[1], note_opacity.clone()),
        patch_property_op(EditorElementTypeV1::Key, &ids[2], glow_color.clone()),
        patch_property_op(EditorElementTypeV1::Key, &ids[3], border.clone()),
        patch_property_op(EditorElementTypeV1::Key, &ids[4], glow_tuple.clone()),
        patch_property_op(
            EditorElementTypeV1::Key,
            uuid::Uuid::new_v4().to_string(),
            note_color.clone(),
        ),
    ];

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    assert_eq!(transition.changed_fields, [EditorField::KeyPositions]);
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );
    let positions = &transition.candidate.key_positions["4key"];
    assert_eq!(
        positions[0].note_color,
        NoteColor::Gradient {
            top: "top".to_string(),
            bottom: "bottom".to_string(),
        }
    );
    assert_eq!(positions[0].note_opacity, 41);
    assert_eq!(positions[0].note_opacity_top, Some(42));
    assert_eq!(positions[0].note_opacity_bottom, Some(43));
    assert_eq!(positions[1].note_opacity, 60);
    assert_eq!(positions[1].note_opacity_top, Some(11));
    assert_eq!(positions[1].note_opacity_bottom, Some(22));
    assert_eq!(
        positions[2].note_glow_color,
        Some(NoteColor::Solid(String::new()))
    );
    assert_eq!(positions[2].note_glow_opacity, 71);
    assert_eq!(positions[2].note_glow_opacity_top, Some(72));
    assert_eq!(positions[2].note_glow_opacity_bottom, Some(73));
    assert_eq!(positions[3].note_border_color.as_deref(), Some("#FFFFFF"));
    assert_eq!(positions[3].note_border_opacity, 100);
    assert!(positions[3].note_border_gradient.is_none());
    let full = &transition.candidate.key_positions["5key"][0];
    assert_eq!(full.note_glow_opacity, 65);
    assert_eq!(full.note_glow_opacity_top, Some(10));
    assert_eq!(full.note_glow_opacity_bottom, Some(90));
    assert_eq!(
        full.note_glow_color,
        Some(NoteColor::Solid("glow-sibling".to_string()))
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    for (invalid, expected_code) in [
        (
            EditorElementPropertyPatchV1::NotePaint(EditorNotePaintIntentV1::Opacity(
                crate::models::EditorNotePaintOpacityIntentV1 { opacity: 101 },
            )),
            "NOTE_OPACITY_OUT_OF_RANGE",
        ),
        (
            EditorElementPropertyPatchV1::NoteBorderPaint(crate::models::EditorNoteBorderPaintV1 {
                color: "rgba(1,2,3,1)".to_string(),
                opacity: 100,
                gradient: None,
            }),
            "INVALID_NOTE_BORDER_COLOR",
        ),
    ] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                ops[0].clone(),
                patch_property_op(
                    EditorElementTypeV1::Key,
                    uuid::Uuid::new_v4().to_string(),
                    invalid,
                ),
            ],
        )
        .unwrap_err();
        assert_eq!(store, original);
        assert_eq!(
            error.error_code,
            crate::errors::EditorCommitErrorCode::ValidationFailed
        );
        assert_eq!(validation_code(&error), Some(expected_code));
    }
    for element_type in [
        EditorElementTypeV1::Stat,
        EditorElementTypeV1::Graph,
        EditorElementTypeV1::Knob,
    ] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                ops[0].clone(),
                patch_property_op(
                    element_type,
                    uuid::Uuid::new_v4().to_string(),
                    glow_color.clone(),
                ),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
        assert_eq!(store, original);
    }
}

#[test]
fn note_border_gradient_patch_is_atomic_canonical_and_strict() {
    let mut store = base_store();
    let id = store.key_positions["4key"][0].id.clone();
    let position = &mut store.key_positions.get_mut("4key").unwrap()[0];
    position.note_border_color = Some("#000000".to_string());
    position.note_border_opacity = 25;
    position.note_border_side = Some("vertical".to_string());
    let original = store.clone();

    let gradient = crate::models::EditorPaintGradientV1 {
        angle: 135.0,
        stops: vec![
            crate::models::EditorPaintGradientStopV1 {
                color: "rgba(17, 34, 51, .5)".to_string(),
                pos: 0.0,
            },
            crate::models::EditorPaintGradientStopV1 {
                color: "#ABC8".to_string(),
                pos: 1.0,
            },
        ],
    };
    let patch =
        EditorElementPropertyPatchV1::NoteBorderPaint(crate::models::EditorNoteBorderPaintV1 {
            color: "#112233".to_string(),
            opacity: 73,
            gradient: Some(gradient.clone()),
        });
    let ops = [patch_property_op(
        EditorElementTypeV1::Key,
        &id,
        patch.clone(),
    )];

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    assert_eq!(transition.changed_fields, [EditorField::KeyPositions]);
    assert_eq!(
        transition.op_results[0].status,
        EditorOpResultStatusV1::Applied
    );
    let position = &transition.candidate.key_positions["4key"][0];
    assert_eq!(position.note_border_color.as_deref(), Some("#112233"));
    assert_eq!(position.note_border_opacity, 73);
    assert_eq!(
        position.note_border_gradient,
        Some(gradient.to_gradient_spec())
    );
    assert_eq!(position.note_border_side.as_deref(), Some("vertical"));

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay.op_results[0].status,
        EditorOpResultStatusV1::NoChange
    );

    let invalid_cases = [
        (
            "#AABBCC",
            crate::models::EditorPaintGradientV1 {
                angle: 90.0,
                stops: vec![
                    crate::models::EditorPaintGradientStopV1 {
                        color: "#112233".to_string(),
                        pos: 0.0,
                    },
                    crate::models::EditorPaintGradientStopV1 {
                        color: "#445566".to_string(),
                        pos: 1.0,
                    },
                ],
            },
            "PAINT_COLOR_GRADIENT_MISMATCH",
        ),
        (
            "#112233",
            crate::models::EditorPaintGradientV1 {
                angle: 90.0,
                stops: vec![
                    crate::models::EditorPaintGradientStopV1 {
                        color: "#112233".to_string(),
                        pos: 0.0,
                    },
                    crate::models::EditorPaintGradientStopV1 {
                        color: "transparent".to_string(),
                        pos: 1.0,
                    },
                ],
            },
            "INVALID_PAINT_GRADIENT",
        ),
        (
            "#112233",
            crate::models::EditorPaintGradientV1 {
                angle: -0.0,
                stops: vec![
                    crate::models::EditorPaintGradientStopV1 {
                        color: "#112233".to_string(),
                        pos: 0.0,
                    },
                    crate::models::EditorPaintGradientStopV1 {
                        color: "#445566".to_string(),
                        pos: 1.0,
                    },
                ],
            },
            "INVALID_PAINT_GRADIENT",
        ),
    ];
    for (color, gradient, code) in invalid_cases {
        let error = prepare_editor_ops_transition(
            &store,
            &[patch_property_op(
                EditorElementTypeV1::Key,
                &id,
                EditorElementPropertyPatchV1::NoteBorderPaint(
                    crate::models::EditorNoteBorderPaintV1 {
                        color: color.to_string(),
                        opacity: 73,
                        gradient: Some(gradient),
                    },
                ),
            )],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some(code));
        assert_eq!(store, original);
    }
}

#[test]
fn note_numeric_patches_preserve_raw_options_bounds_and_siblings() {
    let mut store = base_store();
    let ids = [
        store.key_positions["4key"][0].id.clone(),
        store.key_positions["4key"][1].id.clone(),
        store.key_positions["4key"][2].id.clone(),
        store.key_positions["4key"][3].id.clone(),
        store.key_positions["5key"][0].id.clone(),
    ];
    for position in store.key_positions.values_mut().flatten() {
        position.note_color = crate::models::NoteColor::Solid("note-sibling".to_string());
        position.note_glow_size = 17.5;
        position.note_glow_opacity = 63;
    }
    store.key_positions.get_mut("4key").unwrap()[0].note_offset_x = Some(7.5);
    store.key_positions.get_mut("4key").unwrap()[1].note_offset_y = None;
    store.key_positions.get_mut("4key").unwrap()[2].note_width = Some(31.5);
    store.key_positions.get_mut("4key").unwrap()[3].note_border_width = None;
    store.key_positions.get_mut("5key").unwrap()[0].note_border_radius = None;
    let original = store.clone();

    let ops = vec![
        patch_property_op(
            EditorElementTypeV1::Key,
            &ids[0],
            EditorElementPropertyPatchV1::NoteOffsetX(None),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            &ids[1],
            EditorElementPropertyPatchV1::NoteOffsetY(Some(-12.5)),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            &ids[2],
            EditorElementPropertyPatchV1::NoteWidth(None),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            &ids[3],
            EditorElementPropertyPatchV1::NoteBorderWidth(0.0),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            &ids[4],
            EditorElementPropertyPatchV1::NoteBorderRadius(4.0),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            uuid::Uuid::new_v4().to_string(),
            EditorElementPropertyPatchV1::NoteWidth(Some(20.0)),
        ),
    ];

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    assert_eq!(transition.changed_fields, [EditorField::KeyPositions]);
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );
    let mut expected = original.clone();
    expected.key_positions.get_mut("4key").unwrap()[0].note_offset_x = None;
    expected.key_positions.get_mut("4key").unwrap()[1].note_offset_y = Some(-12.5);
    expected.key_positions.get_mut("4key").unwrap()[2].note_width = None;
    expected.key_positions.get_mut("4key").unwrap()[3].note_border_width = Some(0.0);
    expected.key_positions.get_mut("5key").unwrap()[0].note_border_radius = Some(4.0);
    assert_eq!(transition.scratch, expected);

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let offset_zero = prepare_editor_ops_transition(
        &store,
        &[patch_property_op(
            EditorElementTypeV1::Key,
            &ids[1],
            EditorElementPropertyPatchV1::NoteOffsetY(Some(0.0)),
        )],
    )
    .unwrap();
    assert_eq!(
        offset_zero.op_results[0].status,
        EditorOpResultStatusV1::Applied
    );
    assert_eq!(
        offset_zero.candidate.key_positions["4key"][1].note_offset_y,
        Some(0.0)
    );

    let boundary_ops = vec![
        patch_property_op(
            EditorElementTypeV1::Key,
            &ids[0],
            EditorElementPropertyPatchV1::NoteOffsetX(Some(-500.0)),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            &ids[1],
            EditorElementPropertyPatchV1::NoteOffsetY(Some(500.0)),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            &ids[2],
            EditorElementPropertyPatchV1::NoteWidth(Some(f64::MIN_POSITIVE)),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            &ids[3],
            EditorElementPropertyPatchV1::NoteBorderWidth(20.0),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            &ids[4],
            EditorElementPropertyPatchV1::NoteBorderRadius(100.0),
        ),
    ];
    prepare_editor_ops_transition(&store, &boundary_ops).unwrap();
    let lower_radius = prepare_editor_ops_transition(
        &store,
        &[patch_property_op(
            EditorElementTypeV1::Key,
            &ids[4],
            EditorElementPropertyPatchV1::NoteBorderRadius(1.0),
        )],
    )
    .unwrap();
    assert_eq!(
        lower_radius.candidate.key_positions["5key"][0].note_border_radius,
        Some(1.0)
    );

    let invalid_patches = [
        (
            EditorElementPropertyPatchV1::NoteOffsetX(Some(-500.1)),
            "NOTE_OFFSET_X_OUT_OF_RANGE",
        ),
        (
            EditorElementPropertyPatchV1::NoteOffsetY(Some(500.1)),
            "NOTE_OFFSET_Y_OUT_OF_RANGE",
        ),
        (
            EditorElementPropertyPatchV1::NoteOffsetY(Some(f64::INFINITY)),
            "NOTE_OFFSET_Y_OUT_OF_RANGE",
        ),
        (
            EditorElementPropertyPatchV1::NoteWidth(Some(0.0)),
            "NOTE_WIDTH_OUT_OF_RANGE",
        ),
        (
            EditorElementPropertyPatchV1::NoteWidth(Some(f64::NAN)),
            "NOTE_WIDTH_OUT_OF_RANGE",
        ),
        (
            EditorElementPropertyPatchV1::NoteBorderWidth(-0.1),
            "NOTE_BORDER_WIDTH_OUT_OF_RANGE",
        ),
        (
            EditorElementPropertyPatchV1::NoteBorderWidth(20.1),
            "NOTE_BORDER_WIDTH_OUT_OF_RANGE",
        ),
        (
            EditorElementPropertyPatchV1::NoteBorderRadius(-0.1),
            "NOTE_BORDER_RADIUS_OUT_OF_RANGE",
        ),
        (
            EditorElementPropertyPatchV1::NoteBorderRadius(100.1),
            "NOTE_BORDER_RADIUS_OUT_OF_RANGE",
        ),
    ];
    for (patch, code) in invalid_patches {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                ops[0].clone(),
                patch_property_op(
                    EditorElementTypeV1::Key,
                    uuid::Uuid::new_v4().to_string(),
                    patch,
                ),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some(code));
        assert_eq!(store, original);
    }

    for element_type in [
        EditorElementTypeV1::Stat,
        EditorElementTypeV1::Graph,
        EditorElementTypeV1::Knob,
    ] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                ops[0].clone(),
                patch_property_op(
                    element_type,
                    uuid::Uuid::new_v4().to_string(),
                    EditorElementPropertyPatchV1::NoteWidth(Some(20.0)),
                ),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
        assert_eq!(store, original);
    }
}

#[test]
fn paint_descriptors_apply_pairs_preserve_active_fallbacks_and_reject_invalid_plans() {
    let mut store = store_with_every_reorder_type();
    let key_id = store.key_positions["4key"][0].id.clone();
    let stat_id = store.stat_positions["4key"][0].position.id.clone();
    let graph_id = store.graph_positions["4key"][0].position.id.clone();
    let knob_id = store.knob_positions["4key"][0].position.id.clone();

    let key = &mut store.key_positions.get_mut("4key").unwrap()[0];
    key.background_color = Some(" key idle ".to_string());
    key.background_gradient = None;
    key.active_background_color = None;
    key.active_background_gradient = None;
    key.border_color = Some("key-border-sibling".to_string());
    key.font_color = Some("key-font-sibling".to_string());

    let stat = &mut store.stat_positions.get_mut("4key").unwrap()[0].position;
    stat.border_color = Some("stat-old".to_string());
    stat.border_gradient = None;
    stat.active_border_color = Some("stat-active-sibling".to_string());

    let graph = &mut store.graph_positions.get_mut("4key").unwrap()[0].position;
    graph.background_color = None;
    graph.background_gradient = None;
    graph.active_background_color = Some("graph-active-sibling".to_string());

    let knob = &mut store.knob_positions.get_mut("4key").unwrap()[0].position;
    knob.border_color = Some("stale-knob-base".to_string());
    knob.border_gradient = Some(GradientSpec::from_canonical_parts(
        90.0,
        vec![
            crate::models::GradientStop {
                color: "knob-old".to_string(),
                pos: 0.0,
            },
            crate::models::GradientStop {
                color: "knob-end".to_string(),
                pos: 1.0,
            },
        ],
    ));
    knob.active_border_color = Some("   ".to_string());
    knob.active_border_gradient = None;
    knob.background_color = Some("knob-background-sibling".to_string());

    let original = store.clone();
    let gradient_stops = [("new-key", 0.0), ("new-end", 0.5), ("tail", 1.0)];
    let ops = vec![
        patch_property_op(
            EditorElementTypeV1::Key,
            &key_id,
            EditorElementPropertyPatchV1::BackgroundPaint(paint_descriptor(
                "new-key",
                Some((45.0, &gradient_stops)),
            )),
        ),
        patch_property_op(
            EditorElementTypeV1::Stat,
            &stat_id,
            EditorElementPropertyPatchV1::BorderPaint(paint_descriptor("stat-new", None)),
        ),
        patch_property_op(
            EditorElementTypeV1::Graph,
            &graph_id,
            EditorElementPropertyPatchV1::BackgroundPaint(paint_descriptor("", None)),
        ),
        patch_property_op(
            EditorElementTypeV1::Knob,
            &knob_id,
            EditorElementPropertyPatchV1::BorderPaint(paint_descriptor("knob-new", None)),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            uuid::Uuid::new_v4().to_string(),
            EditorElementPropertyPatchV1::ActiveBackgroundPaint(paint_descriptor("missing", None)),
        ),
    ];

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    assert_eq!(
        transition.changed_fields,
        [
            EditorField::KeyPositions,
            EditorField::StatPositions,
            EditorField::GraphPositions,
            EditorField::KnobPositions,
        ]
    );
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let key = &transition.candidate.key_positions["4key"][0];
    assert_eq!(key.background_color.as_deref(), Some("new-key"));
    assert_eq!(key.background_gradient.as_ref().unwrap().angle, 45.0);
    assert_eq!(key.active_background_color.as_deref(), Some(" key idle "));
    assert!(key.active_background_gradient.is_none());
    assert_eq!(
        key.border_color,
        original.key_positions["4key"][0].border_color
    );
    assert_eq!(key.font_color, original.key_positions["4key"][0].font_color);

    let stat = &transition.candidate.stat_positions["4key"][0].position;
    assert_eq!(stat.border_color.as_deref(), Some("stat-new"));
    assert!(stat.border_gradient.is_none());
    assert_eq!(
        stat.active_border_color.as_deref(),
        Some("stat-active-sibling")
    );

    let graph = &transition.candidate.graph_positions["4key"][0].position;
    assert_eq!(graph.background_color.as_deref(), Some(""));
    assert_eq!(
        graph.active_background_color.as_deref(),
        Some("graph-active-sibling")
    );

    let knob = &transition.candidate.knob_positions["4key"][0].position;
    assert_eq!(knob.border_color.as_deref(), Some("knob-new"));
    assert!(knob.border_gradient.is_none());
    assert_eq!(knob.active_border_color.as_deref(), Some("stale-knob-base"));
    assert_eq!(
        knob.active_border_gradient,
        original.knob_positions["4key"][0].position.border_gradient
    );
    assert_eq!(
        knob.background_color.as_deref(),
        Some("knob-background-sibling")
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let fallback_only_op = patch_property_op(
        EditorElementTypeV1::Key,
        &key_id,
        EditorElementPropertyPatchV1::BackgroundPaint(paint_descriptor(" key idle ", None)),
    );
    let fallback_only =
        prepare_editor_ops_transition(&store, std::slice::from_ref(&fallback_only_op)).unwrap();
    assert_eq!(
        fallback_only.op_results[0].status,
        EditorOpResultStatusV1::Applied
    );
    assert_eq!(fallback_only.changed_fields, [EditorField::KeyPositions]);
    assert_eq!(
        fallback_only.candidate.key_positions["4key"][0]
            .background_color
            .as_deref(),
        Some(" key idle ")
    );
    assert_eq!(
        fallback_only.candidate.key_positions["4key"][0]
            .active_background_color
            .as_deref(),
        Some(" key idle ")
    );
    let fallback_replay = prepare_editor_ops_transition(
        &fallback_only.scratch,
        std::slice::from_ref(&fallback_only_op),
    )
    .unwrap();
    assert_eq!(
        fallback_replay.op_results[0].status,
        EditorOpResultStatusV1::NoChange
    );
    assert!(fallback_replay.changed_fields.is_empty());

    let key_active_id = store.key_positions["4key"][1].id.clone();
    let active_ops = [
        patch_property_op(
            EditorElementTypeV1::Key,
            key_active_id,
            EditorElementPropertyPatchV1::ActiveBackgroundPaint(paint_descriptor(
                "active-key",
                None,
            )),
        ),
        patch_property_op(
            EditorElementTypeV1::Knob,
            &knob_id,
            EditorElementPropertyPatchV1::ActiveBorderPaint(paint_descriptor("active-knob", None)),
        ),
    ];
    let active = prepare_editor_ops_transition(&transition.scratch, &active_ops).unwrap();
    assert_eq!(
        active.candidate.key_positions["4key"][1]
            .active_background_color
            .as_deref(),
        Some("active-key")
    );
    assert_eq!(
        active.candidate.knob_positions["4key"][0]
            .position
            .active_border_color
            .as_deref(),
        Some("active-knob")
    );

    let mut explicit_active_store = store.clone();
    explicit_active_store.key_positions.get_mut("4key").unwrap()[1].active_background_color =
        Some("explicit-active".to_string());
    explicit_active_store.key_positions.get_mut("4key").unwrap()[1].active_background_gradient =
        None;
    explicit_active_store.key_positions.get_mut("4key").unwrap()[1].background_color =
        Some("old-idle".to_string());
    let explicit_active = prepare_editor_ops_transition(
        &explicit_active_store,
        &[patch_property_op(
            EditorElementTypeV1::Key,
            &explicit_active_store.key_positions["4key"][1].id,
            EditorElementPropertyPatchV1::BackgroundPaint(paint_descriptor("new-idle", None)),
        )],
    )
    .unwrap();
    assert_eq!(
        explicit_active.candidate.key_positions["4key"][1]
            .active_background_color
            .as_deref(),
        Some("explicit-active")
    );

    for (descriptor, code) in [
        (
            paint_descriptor("a", Some((360.0, &[("a", 0.0), ("b", 1.0)]))),
            "INVALID_PAINT_GRADIENT",
        ),
        (
            paint_descriptor("a", Some((-0.0, &[("a", 0.0), ("b", 1.0)]))),
            "INVALID_PAINT_GRADIENT",
        ),
        (
            paint_descriptor("a", Some((90.0, &[("a", 0.5), ("b", 0.25)]))),
            "INVALID_PAINT_GRADIENT",
        ),
        (
            paint_descriptor("wrong", Some((90.0, &[("a", 0.0), ("b", 1.0)]))),
            "PAINT_COLOR_GRADIENT_MISMATCH",
        ),
        (
            paint_descriptor("a", Some((90.0, &[("a", 0.0)]))),
            "INVALID_PAINT_GRADIENT",
        ),
        (
            paint_descriptor(
                "a",
                Some((
                    90.0,
                    &[
                        ("a", 0.0),
                        ("b", 0.1),
                        ("c", 0.2),
                        ("d", 0.3),
                        ("e", 0.4),
                        ("f", 0.5),
                        ("g", 0.6),
                        ("h", 0.7),
                        ("i", 1.0),
                    ],
                )),
            ),
            "INVALID_PAINT_GRADIENT",
        ),
        (
            paint_descriptor("a", Some((90.0, &[("a", -0.0), ("b", 1.0)]))),
            "INVALID_PAINT_GRADIENT",
        ),
        (
            paint_descriptor("a", Some((90.0, &[("a", 0.0), ("b", 1.1)]))),
            "INVALID_PAINT_GRADIENT",
        ),
    ] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                ops[0].clone(),
                patch_property_op(
                    EditorElementTypeV1::Key,
                    uuid::Uuid::new_v4().to_string(),
                    EditorElementPropertyPatchV1::BackgroundPaint(descriptor),
                ),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some(code));
        assert_eq!(store, original);
    }

    let canonical_boundaries = prepare_editor_ops_transition(
        &store,
        &[patch_property_op(
            EditorElementTypeV1::Key,
            &store.key_positions["4key"][2].id,
            EditorElementPropertyPatchV1::BorderPaint(paint_descriptor(
                "a",
                Some((0.0, &[("a", 0.0), ("equal", 0.0), ("b", 1.0)])),
            )),
        )],
    )
    .unwrap();
    assert_eq!(
        canonical_boundaries.candidate.key_positions["4key"][2]
            .border_gradient
            .as_ref()
            .unwrap()
            .stops
            .len(),
        3
    );

    for element_type in [EditorElementTypeV1::Stat, EditorElementTypeV1::Graph] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                ops[0].clone(),
                patch_property_op(
                    element_type,
                    uuid::Uuid::new_v4().to_string(),
                    EditorElementPropertyPatchV1::ActiveBorderPaint(paint_descriptor(
                        "active", None,
                    )),
                ),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
        assert_eq!(store, original);
    }
}

#[test]
fn blank_font_paint_normalizes_to_none_and_blank_gradient_stops_are_rejected() {
    let mut store = store_with_every_reorder_type();
    let key_id = store.key_positions["4key"][0].id.clone();
    {
        let key = &mut store.key_positions.get_mut("4key").unwrap()[0];
        key.font_color = Some("stale-idle".to_string());
        key.font_gradient = None;
        key.active_font_color = Some("stale-active".to_string());
        key.active_font_gradient = None;
    }
    let original = store.clone();

    // 빈 solid는 커밋 시 None - 로드 정규화(normalize_blank_font_colors)와 수렴
    let ops = vec![
        patch_property_op(
            EditorElementTypeV1::Key,
            &key_id,
            EditorElementPropertyPatchV1::FontPaint(paint_descriptor("  ", None)),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            &key_id,
            EditorElementPropertyPatchV1::ActiveFontPaint(paint_descriptor("", None)),
        ),
    ];
    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    assert_eq!(transition.changed_fields, [EditorField::KeyPositions]);
    let position = &transition.candidate.key_positions["4key"][0];
    assert!(position.font_color.is_none());
    assert!(position.font_gradient.is_none());
    assert!(position.active_font_color.is_none());
    assert!(position.active_font_gradient.is_none());

    // 빈 stop 색 gradient는 커밋 거부 - 로드 시 대표색 진동 차단
    let error = prepare_editor_ops_transition(
        &store,
        &[patch_property_op(
            EditorElementTypeV1::Key,
            &key_id,
            EditorElementPropertyPatchV1::FontPaint(paint_descriptor(
                " ",
                Some((45.0, &[(" ", 0.0), ("#445566", 1.0)])),
            )),
        )],
    )
    .unwrap_err();
    assert_eq!(validation_code(&error), Some("INVALID_PAINT_GRADIENT"));
    assert_eq!(store, original);
}

#[test]
fn font_paint_patches_preserve_state_pairs_and_enforce_target_types() {
    let mut store = store_with_every_reorder_type();
    let key_ids = store.key_positions["4key"]
        .iter()
        .map(|position| position.id.clone())
        .collect::<Vec<_>>();
    let stat_id = store.stat_positions["4key"][0].position.id.clone();
    let graph_id = store.graph_positions["4key"][0].position.id.clone();
    let knob_id = store.knob_positions["4key"][0].position.id.clone();

    let idle_gradient = paint_descriptor(
        "idle-first",
        Some((30.0, &[("idle-first", 0.0), ("idle-last", 1.0)])),
    )
    .gradient
    .unwrap()
    .to_gradient_spec();
    let active_gradient = paint_descriptor(
        "active-first",
        Some((75.0, &[("active-first", 0.0), ("active-last", 1.0)])),
    )
    .gradient
    .unwrap()
    .to_gradient_spec();
    let keys = store.key_positions.get_mut("4key").unwrap();
    keys[0].font_color = None;
    keys[0].font_gradient = Some(idle_gradient.clone());
    keys[0].active_font_color = None;
    keys[0].active_font_gradient = None;
    keys[1].font_color = Some("idle-first".to_string());
    keys[1].font_gradient = Some(idle_gradient.clone());
    keys[1].active_font_color = Some("active-solid".to_string());
    keys[1].active_font_gradient = None;
    keys[2].font_color = Some("idle-solid".to_string());
    keys[2].font_gradient = None;
    keys[2].active_font_color = None;
    keys[2].active_font_gradient = Some(active_gradient.clone());
    keys[3].font_color = Some("same-idle".to_string());
    keys[3].font_gradient = None;
    keys[3].active_font_color = None;
    keys[3].active_font_gradient = None;

    let original = store.clone();
    let ops = vec![
        patch_property_op(
            EditorElementTypeV1::Key,
            &key_ids[0],
            EditorElementPropertyPatchV1::FontPaint(paint_descriptor("next-zero", None)),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            &key_ids[1],
            EditorElementPropertyPatchV1::FontPaint(paint_descriptor("next-one", None)),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            &key_ids[2],
            EditorElementPropertyPatchV1::FontPaint(paint_descriptor("next-two", None)),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            &key_ids[3],
            EditorElementPropertyPatchV1::FontPaint(paint_descriptor("same-idle", None)),
        ),
        patch_property_op(
            EditorElementTypeV1::Stat,
            &stat_id,
            EditorElementPropertyPatchV1::FontPaint(paint_descriptor(
                "stat-first",
                Some((90.0, &[("stat-first", 0.0), ("stat-last", 1.0)])),
            )),
        ),
    ];

    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    assert_eq!(
        transition.changed_fields,
        [EditorField::KeyPositions, EditorField::StatPositions]
    );
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
        ]
    );

    let keys = &transition.candidate.key_positions["4key"];
    assert_eq!(keys[0].active_font_color, None);
    assert_eq!(keys[0].active_font_gradient, Some(idle_gradient.clone()));
    assert_eq!(keys[1].active_font_color.as_deref(), Some("active-solid"));
    assert_eq!(keys[1].active_font_gradient, None);
    assert_eq!(keys[2].active_font_color, None);
    assert_eq!(keys[2].active_font_gradient, Some(active_gradient));
    assert_eq!(keys[3].active_font_color.as_deref(), Some("same-idle"));
    assert_eq!(keys[3].active_font_gradient, None);
    assert_eq!(
        transition.candidate.stat_positions["4key"][0]
            .position
            .font_color
            .as_deref(),
        Some("stat-first")
    );
    assert!(transition.candidate.stat_positions["4key"][0]
        .position
        .active_font_color
        .is_none());

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
        ]
    );

    let active_store = store.clone();
    let active = prepare_editor_ops_transition(
        &active_store,
        &[patch_property_op(
            EditorElementTypeV1::Key,
            &key_ids[0],
            EditorElementPropertyPatchV1::ActiveFontPaint(paint_descriptor(
                "active-direct",
                Some((15.0, &[("active-direct", 0.0), ("active-end", 1.0)])),
            )),
        )],
    )
    .unwrap();
    assert_eq!(
        active.candidate.key_positions["4key"][0]
            .active_font_color
            .as_deref(),
        Some("active-direct")
    );
    assert!(active.candidate.key_positions["4key"][0]
        .active_font_gradient
        .is_some());

    for (element_type, id) in [
        (EditorElementTypeV1::Stat, &stat_id),
        (EditorElementTypeV1::Graph, &graph_id),
        (EditorElementTypeV1::Knob, &knob_id),
    ] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                ops[0].clone(),
                patch_property_op(
                    element_type,
                    id,
                    EditorElementPropertyPatchV1::ActiveFontPaint(paint_descriptor(
                        "wrong-type",
                        None,
                    )),
                ),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
        assert_eq!(store, original);
    }

    for (element_type, id) in [
        (EditorElementTypeV1::Graph, &graph_id),
        (EditorElementTypeV1::Knob, &knob_id),
    ] {
        let error = prepare_editor_ops_transition(
            &store,
            &[patch_property_op(
                element_type,
                id,
                EditorElementPropertyPatchV1::FontPaint(paint_descriptor("wrong-type", None)),
            )],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
    }

    for patch in [
        EditorElementPropertyPatchV1::FontPaint(paint_descriptor(
            "mismatch",
            Some((45.0, &[("first", 0.0), ("last", 1.0)])),
        )),
        EditorElementPropertyPatchV1::ActiveFontPaint(paint_descriptor(
            "mismatch",
            Some((45.0, &[("first", 0.0), ("last", 1.0)])),
        )),
    ] {
        let error = prepare_editor_ops_transition(
            &store,
            &[patch_property_op(
                EditorElementTypeV1::Key,
                &key_ids[0],
                patch,
            )],
        )
        .unwrap_err();
        assert_eq!(
            validation_code(&error),
            Some("PAINT_COLOR_GRADIENT_MISMATCH")
        );
    }
}

#[test]
fn shadow_masks_seed_current_defaults_preserve_siblings_and_reject_invalid_plans() {
    let mut store = store_with_every_reorder_type();
    let key_id = store.key_positions["4key"][0].id.clone();
    let stat_id = store.stat_positions["4key"][0].position.id.clone();
    let knob_id = store.knob_positions["4key"][0].position.id.clone();

    let key = &mut store.key_positions.get_mut("4key").unwrap()[0];
    key.inactive_image = Some(" image.png ".to_string());
    key.shadow = None;
    key.active_shadow = Some(ElementShadowSpec {
        enabled: true,
        color: "key-active-sibling".to_string(),
        offset_x: 7.5,
        offset_y: -8.5,
        blur: 19.5,
    });
    let stat = &mut store.stat_positions.get_mut("4key").unwrap()[0].position;
    stat.shadow = Some(ElementShadowSpec {
        enabled: false,
        color: "stat-color-sibling".to_string(),
        offset_x: 1.5,
        offset_y: 2.5,
        blur: 3.5,
    });
    stat.active_shadow = Some(ElementShadowSpec {
        enabled: true,
        color: "stat-active-sentinel".to_string(),
        offset_x: 10.0,
        offset_y: 11.0,
        blur: 12.0,
    });
    let knob = &mut store.knob_positions.get_mut("4key").unwrap()[0].position;
    knob.shadow = None;
    knob.active_shadow = None;
    knob.idle_transparent = true;
    knob.active_transparent = false;
    knob.border_width = Some(2.0);
    knob.inactive_image = None;
    knob.active_image = Some("active.png".to_string());
    let original = store.clone();

    let ops = vec![
        patch_property_op(
            EditorElementTypeV1::Key,
            &key_id,
            EditorElementPropertyPatchV1::Shadow(shadow_leaf_color("new-shadow")),
        ),
        patch_property_op(
            EditorElementTypeV1::Stat,
            &stat_id,
            EditorElementPropertyPatchV1::Shadow(shadow_leaf_offset_x(-100.0)),
        ),
        patch_property_op(
            EditorElementTypeV1::Knob,
            &knob_id,
            EditorElementPropertyPatchV1::ShadowEnabled(true),
        ),
        patch_property_op(
            EditorElementTypeV1::Key,
            uuid::Uuid::new_v4().to_string(),
            EditorElementPropertyPatchV1::ActiveShadow(shadow_leaf_blur(100.0)),
        ),
    ];
    let transition = prepare_editor_ops_transition(&store, &ops).unwrap();
    assert_eq!(
        transition.changed_fields,
        [
            EditorField::KeyPositions,
            EditorField::StatPositions,
            EditorField::KnobPositions,
        ]
    );
    assert_eq!(
        transition
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::Applied,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );
    let key = transition.candidate.key_positions["4key"][0]
        .shadow
        .as_ref()
        .unwrap();
    assert!(!key.enabled);
    assert_eq!(key.color, "new-shadow");
    assert_eq!((key.offset_x, key.offset_y, key.blur), (0.0, 4.0, 10.0));
    assert_eq!(
        transition.candidate.key_positions["4key"][0].active_shadow,
        original.key_positions["4key"][0].active_shadow
    );
    let stat = transition.candidate.stat_positions["4key"][0]
        .position
        .shadow
        .as_ref()
        .unwrap();
    assert_eq!(stat.offset_x, -100.0);
    assert!(!stat.enabled);
    assert_eq!(stat.color, "stat-color-sibling");
    assert_eq!((stat.offset_y, stat.blur), (2.5, 3.5));
    assert_eq!(
        transition.candidate.stat_positions["4key"][0]
            .position
            .active_shadow,
        original.stat_positions["4key"][0].position.active_shadow
    );
    let knob = &transition.candidate.knob_positions["4key"][0].position;
    let idle = knob.shadow.as_ref().unwrap();
    let active = knob.active_shadow.as_ref().unwrap();
    assert!(idle.enabled && active.enabled);
    assert_eq!(idle.color, "rgba(0, 0, 0, 0.28)");
    assert_eq!((idle.offset_x, idle.offset_y, idle.blur), (0.0, 4.0, 10.0));
    assert_eq!(active.color, "rgba(0, 0, 0, 0.32)");
    assert_eq!(
        (active.offset_x, active.offset_y, active.blur),
        (0.0, 3.0, 8.0)
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &ops).unwrap();
    assert!(replay.changed_fields.is_empty());
    assert_eq!(
        replay
            .op_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        [
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::NoChange,
            EditorOpResultStatusV1::TargetMissing,
        ]
    );

    let mut stat_master_store = store.clone();
    stat_master_store.stat_positions.get_mut("4key").unwrap()[0]
        .position
        .shadow = None;
    let stat_active_before = stat_master_store.stat_positions["4key"][0]
        .position
        .active_shadow
        .clone();
    let stat_master = prepare_editor_ops_transition(
        &stat_master_store,
        &[patch_property_op(
            EditorElementTypeV1::Stat,
            &stat_id,
            EditorElementPropertyPatchV1::ShadowEnabled(false),
        )],
    )
    .unwrap();
    assert!(
        !stat_master.candidate.stat_positions["4key"][0]
            .position
            .shadow
            .as_ref()
            .unwrap()
            .enabled
    );
    assert_eq!(
        stat_master.candidate.stat_positions["4key"][0]
            .position
            .active_shadow,
        stat_active_before
    );

    for (element_type, active, configure) in [
        (EditorElementTypeV1::Key, false, "idle-image"),
        (EditorElementTypeV1::Key, true, "active-image"),
        (EditorElementTypeV1::Knob, false, "idle-transparent"),
        (EditorElementTypeV1::Knob, true, "active-transparent"),
        (EditorElementTypeV1::Knob, false, "idle-border"),
        (EditorElementTypeV1::Knob, true, "active-border"),
    ] {
        let mut seeded_store = store_with_every_reorder_type();
        let (id, position) = match element_type {
            EditorElementTypeV1::Key => {
                let position = &mut seeded_store.key_positions.get_mut("4key").unwrap()[0];
                (position.id.clone(), position)
            }
            EditorElementTypeV1::Knob => {
                let position =
                    &mut seeded_store.knob_positions.get_mut("4key").unwrap()[0].position;
                (position.id.clone(), position)
            }
            _ => unreachable!(),
        };
        position.shadow = None;
        position.active_shadow = None;
        position.inactive_image = None;
        position.active_image = None;
        position.idle_transparent = false;
        position.active_transparent = false;
        position.border_width = None;
        match configure {
            "idle-image" => position.inactive_image = Some("idle.png".to_string()),
            "active-image" => position.active_image = Some("active.png".to_string()),
            "idle-transparent" => position.idle_transparent = true,
            "active-transparent" => position.active_transparent = true,
            "idle-border" | "active-border" => position.border_width = Some(1.0),
            _ => unreachable!(),
        }
        let patch = if active {
            EditorElementPropertyPatchV1::ActiveShadow(shadow_leaf_blur(8.0))
        } else {
            EditorElementPropertyPatchV1::Shadow(shadow_leaf_blur(10.0))
        };
        let op = patch_property_op(element_type, id, patch);
        let seeded =
            prepare_editor_ops_transition(&seeded_store, std::slice::from_ref(&op)).unwrap();
        assert_eq!(
            seeded.op_results[0].status,
            EditorOpResultStatusV1::Applied,
            "{configure}"
        );
        let position = match element_type {
            EditorElementTypeV1::Key => &seeded.candidate.key_positions["4key"][0],
            EditorElementTypeV1::Knob => &seeded.candidate.knob_positions["4key"][0].position,
            _ => unreachable!(),
        };
        let shadow = if active {
            position.active_shadow.as_ref().unwrap()
        } else {
            position.shadow.as_ref().unwrap()
        };
        assert!(!shadow.enabled, "{configure}");
        let replay = prepare_editor_ops_transition(&seeded.scratch, &[op]).unwrap();
        assert_eq!(
            replay.op_results[0].status,
            EditorOpResultStatusV1::NoChange,
            "{configure}"
        );
    }

    for (patch, code) in [
        (shadow_leaf_color(""), "INVALID_ELEMENT_SHADOW"),
        (shadow_leaf_offset_x(100.1), "INVALID_ELEMENT_SHADOW"),
        (shadow_leaf_offset_y(f64::NAN), "INVALID_ELEMENT_SHADOW"),
        (shadow_leaf_blur(-0.1), "INVALID_ELEMENT_SHADOW"),
    ] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                ops[0].clone(),
                patch_property_op(
                    EditorElementTypeV1::Key,
                    uuid::Uuid::new_v4().to_string(),
                    EditorElementPropertyPatchV1::Shadow(patch),
                ),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some(code));
        assert_eq!(store, original);
    }

    for (element_type, patch) in [
        (
            EditorElementTypeV1::Graph,
            EditorElementPropertyPatchV1::Shadow(shadow_leaf_blur(4.0)),
        ),
        (
            EditorElementTypeV1::Graph,
            EditorElementPropertyPatchV1::ShadowEnabled(false),
        ),
        (
            EditorElementTypeV1::Stat,
            EditorElementPropertyPatchV1::ActiveShadow(shadow_leaf_offset_y(1.0)),
        ),
    ] {
        let error = prepare_editor_ops_transition(
            &store,
            &[
                ops[0].clone(),
                patch_property_op(element_type, uuid::Uuid::new_v4().to_string(), patch),
            ],
        )
        .unwrap_err();
        assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
        assert_eq!(store, original);
    }
}

#[test]
fn set_key_slot_follows_position_id_and_preserves_the_pair() {
    let mut store = base_store();
    store.keys.get_mut("4key").unwrap().swap(0, 1);
    store.key_positions.get_mut("4key").unwrap().swap(0, 1);
    let id = store.key_positions["4key"][1].id.clone();
    let op = EditorOpV1::SetKeySlot {
        id,
        slot: EditorFrozenKeySlotV1::Multi(crate::models::EditorFrozenMultiKeySlotV1 {
            keys: vec!["A".to_string(), "B".to_string()],
            match_mode: crate::models::SlotMatch::All,
        }),
    };

    let transition = prepare_editor_ops_transition(&store, std::slice::from_ref(&op)).unwrap();
    assert_eq!(
        transition.candidate.keys["4key"][1],
        crate::models::KeySlot::Multi {
            keys: vec!["A".to_string(), "B".to_string()],
            match_mode: crate::models::SlotMatch::All,
        }
    );
    assert_eq!(transition.candidate.key_positions, store.key_positions);
    assert_eq!(transition.changed_fields, [EditorField::Keys]);
    assert_eq!(
        transition.op_results[0].status,
        EditorOpResultStatusV1::Applied
    );

    let replay = prepare_editor_ops_transition(&transition.scratch, &[op]).unwrap();
    assert_eq!(
        replay.op_results[0].status,
        EditorOpResultStatusV1::NoChange
    );
    assert!(replay.changed_fields.is_empty());
}

#[test]
fn property_and_slot_type_mismatches_reject_the_whole_request() {
    let store = store_with_every_reorder_type();
    let before = store.clone();
    let key_id = store.key_positions["4key"][0].id.clone();
    let stat_id = store.stat_positions["4key"][0].position.id.clone();

    let property_error = prepare_editor_ops_transition(
        &store,
        &[
            patch_hidden_op(EditorElementTypeV1::Key, key_id, true),
            patch_layer_name_op(
                EditorElementTypeV1::Graph,
                stat_id.clone(),
                Some("Wrong type"),
            ),
        ],
    )
    .unwrap_err();
    assert_eq!(
        validation_code(&property_error),
        Some("ELEMENT_TYPE_MISMATCH")
    );

    let slot_error = prepare_editor_ops_transition(
        &store,
        &[EditorOpV1::SetKeySlot {
            id: stat_id,
            slot: EditorFrozenKeySlotV1::Single("A".to_string()),
        }],
    )
    .unwrap_err();
    assert_eq!(validation_code(&slot_error), Some("ELEMENT_TYPE_MISMATCH"));
    assert_eq!(store, before);
}
