use std::collections::{HashMap, HashSet};

use crate::{
    errors::EditorCommitError,
    models::{
        compact_canonical_rgba, default_counter_animation_builtin_presets,
        note_border_representative_hex, note_gradient_shadow, AppStoreData, CounterAnimationPreset,
        EditorBoundsV1, EditorCounterAnimationPresetIntentV1, EditorCounterFillIntentV1,
        EditorDocumentV1, EditorElementGroupTargetV1, EditorElementPropertyPatchV1,
        EditorElementTypeV1, EditorField, EditorFrozenElementV1, EditorGroupUpdateV1,
        EditorNoteBorderPaintV1, EditorNoteColorV1, EditorNotePaintIntentV1,
        EditorOpResultStatusV1, EditorOpResultV1, EditorOpV1, EditorPaintDescriptorV1,
        EditorPaintGradientV1, EditorShadowLeafPatchV1, EditorTargetGroupV1, EditorZUpdateV1,
        ElementShadowSpec, GradientSpec, ImageMode, ImageTransform, ImageTransformLeafPatchV1,
        KeyPosition, LayerGroupDef, NoteColor, NoteGradientShadow, IMAGE_TRANSFORM_OFFSET_MAX,
        IMAGE_TRANSFORM_OFFSET_MIN, IMAGE_TRANSFORM_ROTATION_MAX, IMAGE_TRANSFORM_ROTATION_MIN,
        IMAGE_TRANSFORM_SCALE_MAX, IMAGE_TRANSFORM_SCALE_MIN, SHADOW_BLUR_MAX, SHADOW_BLUR_MIN,
        SHADOW_OFFSET_MAX, SHADOW_OFFSET_MIN,
    },
};

use super::editor::{
    validate_document_transition, validate_editor_op_bounds, validate_editor_op_target_type,
};
use super::native_element_id::DUPLICATE_ELEMENT_ID;
use super::plugin::{plugin_group_refs_from_store, PluginGroupRefs};

#[derive(Debug)]
pub(crate) struct PreparedEditorOpsTransition {
    pub(crate) current: EditorDocumentV1,
    pub(crate) candidate: EditorDocumentV1,
    pub(crate) scratch: AppStoreData,
    pub(crate) changed_fields: Vec<EditorField>,
    pub(crate) op_results: Vec<EditorOpResultV1>,
}

#[derive(Debug)]
struct ElementLocation {
    element_type: EditorElementTypeV1,
    mode: String,
    index: usize,
}

fn current_counter_animation_preset(
    store: &AppStoreData,
    preset_id: &str,
) -> Option<CounterAnimationPreset> {
    let mut preset = store
        .counter_animation_presets
        .iter()
        .find(|preset| preset.id == preset_id)
        .cloned()
        .or_else(|| {
            default_counter_animation_builtin_presets()
                .into_iter()
                .find(|preset| preset.id == preset_id)
        })?;
    preset.normalize();
    Some(preset)
}

fn validate_counter_animation_preset_patch(
    store: &AppStoreData,
    patch: &EditorCounterAnimationPresetIntentV1,
) -> Result<(), EditorCommitError> {
    if let Some(bezier) = patch.bezier {
        let valid = bezier.iter().enumerate().all(|(index, value)| {
            value.is_finite()
                && if matches!(index, 0 | 2) {
                    (0.0..=1.0).contains(value)
                } else {
                    (-2.0..=2.0).contains(value)
                }
        });
        if !valid {
            return Err(EditorCommitError::validation(
                "INVALID_COUNTER_ANIMATION_PRESET_VALUE",
                "counter animation bezier values are out of range",
            ));
        }
    }
    if patch.scale.is_some_and(|value| !value.is_finite()) {
        return Err(EditorCommitError::validation(
            "INVALID_COUNTER_ANIMATION_PRESET_VALUE",
            "counter animation scale must be finite",
        ));
    }
    if patch
        .duration_ms
        .is_some_and(|value| !(1..=5000).contains(&value))
    {
        return Err(EditorCommitError::validation(
            "INVALID_COUNTER_ANIMATION_PRESET_VALUE",
            "counter animation duration must be between 1 and 5000 milliseconds",
        ));
    }
    let preset = current_counter_animation_preset(store, &patch.preset_id).ok_or_else(|| {
        EditorCommitError::validation(
            "COUNTER_ANIMATION_PRESET_NOT_FOUND",
            format!("counter animation preset not found: {}", patch.preset_id),
        )
    })?;
    if patch.bezier.is_some_and(|value| value != preset.bezier)
        || patch.scale.is_some_and(|value| value != preset.scale)
        || patch
            .duration_ms
            .is_some_and(|value| value != preset.duration_ms)
    {
        return Err(EditorCommitError::validation(
            "COUNTER_ANIMATION_PRESET_MISMATCH",
            format!(
                "counter animation preset values are stale: {}",
                patch.preset_id
            ),
        ));
    }
    Ok(())
}

fn validate_paint_descriptor(
    descriptor: &EditorPaintDescriptorV1,
) -> Result<(), EditorCommitError> {
    let Some(gradient) = descriptor.gradient.as_ref() else {
        return Ok(());
    };
    validate_paint_gradient(gradient)?;
    if gradient
        .stops
        .first()
        .is_some_and(|stop| stop.color != descriptor.color)
    {
        return Err(EditorCommitError::validation(
            "PAINT_COLOR_GRADIENT_MISMATCH",
            "paint color must equal the first gradient stop color",
        ));
    }
    Ok(())
}

fn validate_paint_gradient(gradient: &EditorPaintGradientV1) -> Result<(), EditorCommitError> {
    if !gradient.angle.is_finite()
        || !(0.0..360.0).contains(&gradient.angle)
        || (gradient.angle == 0.0 && gradient.angle.is_sign_negative())
    {
        return Err(EditorCommitError::validation(
            "INVALID_PAINT_GRADIENT",
            "paint gradient angle must be finite and canonical between 0 and 360",
        ));
    }
    if !(2..=8).contains(&gradient.stops.len()) {
        return Err(EditorCommitError::validation(
            "INVALID_PAINT_GRADIENT",
            "paint gradient must contain between 2 and 8 stops",
        ));
    }
    let mut previous_pos = None;
    for stop in &gradient.stops {
        // 빈 stop 색은 로드 canonicalize가 빈 대표색을 만들어 blank 정규화와
        // 매 시작 진동한다 - 커밋에서 차단
        if stop.color.trim().is_empty() {
            return Err(EditorCommitError::validation(
                "INVALID_PAINT_GRADIENT",
                "paint gradient stop colors must not be blank",
            ));
        }
        if !stop.pos.is_finite()
            || !(0.0..=1.0).contains(&stop.pos)
            || (stop.pos == 0.0 && stop.pos.is_sign_negative())
        {
            return Err(EditorCommitError::validation(
                "INVALID_PAINT_GRADIENT",
                "paint gradient stop positions must be finite and between 0 and 1",
            ));
        }
        if previous_pos.is_some_and(|previous| stop.pos < previous) {
            return Err(EditorCommitError::validation(
                "INVALID_PAINT_GRADIENT",
                "paint gradient stops must be ordered by position",
            ));
        }
        previous_pos = Some(stop.pos);
    }
    Ok(())
}

fn validate_counter_fill_intent(
    intent: &EditorCounterFillIntentV1,
) -> Result<(), EditorCommitError> {
    let EditorCounterFillIntentV1::Gradient(intent) = intent else {
        return Ok(());
    };
    validate_paint_gradient(&intent.gradient)?;
    let representative = compact_canonical_rgba(
        &intent
            .gradient
            .stops
            .first()
            .expect("a validated counter fill gradient has at least two stops")
            .color,
    );
    if intent.color != representative {
        return Err(EditorCommitError::validation(
            "COUNTER_FILL_COLOR_GRADIENT_MISMATCH",
            "counter fill color must equal the compact first gradient stop color",
        ));
    }
    Ok(())
}

fn has_stored_paint_value(color: &Option<String>, gradient: &Option<GradientSpec>) -> bool {
    color
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
        || gradient.is_some()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PaintSurface {
    Background,
    Border,
    Font,
}

fn preserve_active_paint_fallback(position: &mut KeyPosition, surface: PaintSurface) -> bool {
    let (idle_color, idle_gradient, active_color, active_gradient) = match surface {
        PaintSurface::Background => (
            position.background_color.clone(),
            position.background_gradient.clone(),
            &mut position.active_background_color,
            &mut position.active_background_gradient,
        ),
        PaintSurface::Border => (
            position.border_color.clone(),
            position.border_gradient.clone(),
            &mut position.active_border_color,
            &mut position.active_border_gradient,
        ),
        PaintSurface::Font => (
            position.font_color.clone(),
            position.font_gradient.clone(),
            &mut position.active_font_color,
            &mut position.active_font_gradient,
        ),
    };
    if has_stored_paint_value(active_color, active_gradient) {
        return false;
    }

    let changed = *active_color != idle_color || *active_gradient != idle_gradient;
    *active_color = idle_color;
    *active_gradient = idle_gradient;
    changed
}

fn apply_paint_descriptor(
    color: &mut Option<String>,
    gradient: &mut Option<GradientSpec>,
    descriptor: &EditorPaintDescriptorV1,
) -> bool {
    let next_color = Some(descriptor.color.clone());
    let next_gradient = descriptor
        .gradient
        .as_ref()
        .map(|gradient| gradient.to_gradient_spec());
    let changed = *color != next_color || *gradient != next_gradient;
    *color = next_color;
    *gradient = next_gradient;
    changed
}

// font 전용: 빈 solid 색은 None으로 저장 - 로드 정규화(normalize_blank_font_colors)와
// 같은 의미라 커밋 직후 문서와 재로드 문서가 갈리지 않는다
fn apply_font_paint_descriptor(
    color: &mut Option<String>,
    gradient: &mut Option<GradientSpec>,
    descriptor: &EditorPaintDescriptorV1,
) -> bool {
    let next_color = Some(descriptor.color.clone()).filter(|value| !value.trim().is_empty());
    let next_gradient = descriptor
        .gradient
        .as_ref()
        .map(|gradient| gradient.to_gradient_spec());
    let changed = *color != next_color || *gradient != next_gradient;
    *color = next_color;
    *gradient = next_gradient;
    changed
}

fn patch_counter_fill(
    position: &mut KeyPosition,
    active: bool,
    intent: &EditorCounterFillIntentV1,
) -> bool {
    let (next_color, next_gradient) = match intent {
        EditorCounterFillIntentV1::Solid(intent) => (intent.color.clone(), None),
        EditorCounterFillIntentV1::Gradient(intent) => (
            intent.color.clone(),
            Some(intent.gradient.to_gradient_spec()),
        ),
    };
    let (color, gradient) = if active {
        (
            &mut position.counter.fill.active,
            &mut position.counter.fill_active_gradient,
        )
    } else {
        (
            &mut position.counter.fill.idle,
            &mut position.counter.fill_idle_gradient,
        )
    };
    let changed = *color != next_color || *gradient != next_gradient;
    *color = next_color;
    *gradient = next_gradient;
    changed
}

fn validate_shadow_leaf(patch: &EditorShadowLeafPatchV1) -> Result<(), EditorCommitError> {
    let valid_offset =
        |value: f64| value.is_finite() && (SHADOW_OFFSET_MIN..=SHADOW_OFFSET_MAX).contains(&value);
    // 닫힌 enum 전수 나열 - 신규 leaf가 검증 없이 통과하면 컴파일 에러로 드러나게
    let violation = match patch {
        EditorShadowLeafPatchV1::Color(color) => color
            .is_empty()
            .then_some("shadow color must be a non-empty string"),
        EditorShadowLeafPatchV1::OffsetX(offset_x) => (!valid_offset(*offset_x))
            .then_some("shadow offset X must be finite and between -100 and 100"),
        EditorShadowLeafPatchV1::OffsetY(offset_y) => (!valid_offset(*offset_y))
            .then_some("shadow offset Y must be finite and between -100 and 100"),
        EditorShadowLeafPatchV1::Blur(blur) => (!blur.is_finite()
            || !(SHADOW_BLUR_MIN..=SHADOW_BLUR_MAX).contains(blur))
        .then_some("shadow blur must be finite and between 0 and 100"),
    };
    violation.map_or(Ok(()), |message| {
        Err(EditorCommitError::validation(
            "INVALID_ELEMENT_SHADOW",
            message,
        ))
    })
}

fn validate_image_transform_leaf(
    patch: &ImageTransformLeafPatchV1,
) -> Result<(), EditorCommitError> {
    let violation = match patch {
        ImageTransformLeafPatchV1::OffsetX(value) => (!value.is_finite()
            || !(IMAGE_TRANSFORM_OFFSET_MIN..=IMAGE_TRANSFORM_OFFSET_MAX).contains(value))
        .then_some("image offset X must be finite and between -500 and 500"),
        ImageTransformLeafPatchV1::OffsetY(value) => (!value.is_finite()
            || !(IMAGE_TRANSFORM_OFFSET_MIN..=IMAGE_TRANSFORM_OFFSET_MAX).contains(value))
        .then_some("image offset Y must be finite and between -500 and 500"),
        ImageTransformLeafPatchV1::Rotation(value) => (!value.is_finite()
            || !(IMAGE_TRANSFORM_ROTATION_MIN..=IMAGE_TRANSFORM_ROTATION_MAX).contains(value))
        .then_some("image rotation must be finite and between -180 and 180"),
        ImageTransformLeafPatchV1::Scale(value) => (!value.is_finite()
            || !(IMAGE_TRANSFORM_SCALE_MIN..=IMAGE_TRANSFORM_SCALE_MAX).contains(value))
        .then_some("image scale must be finite and between 0.1 and 10"),
    };
    violation.map_or(Ok(()), |message| {
        Err(EditorCommitError::validation(
            "INVALID_IMAGE_TRANSFORM",
            message,
        ))
    })
}

fn default_shadow_spec(
    position: &KeyPosition,
    element_type: EditorElementTypeV1,
    active: bool,
) -> ElementShadowSpec {
    let has_image = if active {
        position
            .active_image
            .as_deref()
            .is_some_and(|path| !path.trim().is_empty())
            || position
                .inactive_image
                .as_deref()
                .is_some_and(|path| !path.trim().is_empty())
    } else {
        position
            .inactive_image
            .as_deref()
            .is_some_and(|path| !path.trim().is_empty())
    };
    let knob_suppressed = element_type == EditorElementTypeV1::Knob
        && (if active {
            position.active_transparent
        } else {
            position.idle_transparent
        } || position.border_width.unwrap_or(0.0) > 0.0);
    ElementShadowSpec {
        enabled: !(has_image || knob_suppressed),
        color: if active {
            "rgba(0, 0, 0, 0.32)".to_string()
        } else {
            "rgba(0, 0, 0, 0.28)".to_string()
        },
        offset_x: 0.0,
        offset_y: if active { 3.0 } else { 4.0 },
        blur: if active { 8.0 } else { 10.0 },
    }
}

fn apply_shadow_leaf(shadow: &mut ElementShadowSpec, patch: &EditorShadowLeafPatchV1) -> bool {
    match patch {
        EditorShadowLeafPatchV1::Color(color) => {
            if shadow.color == *color {
                false
            } else {
                shadow.color.clone_from(color);
                true
            }
        }
        EditorShadowLeafPatchV1::OffsetX(offset_x) => {
            if shadow.offset_x == *offset_x {
                false
            } else {
                shadow.offset_x = *offset_x;
                true
            }
        }
        EditorShadowLeafPatchV1::OffsetY(offset_y) => {
            if shadow.offset_y == *offset_y {
                false
            } else {
                shadow.offset_y = *offset_y;
                true
            }
        }
        EditorShadowLeafPatchV1::Blur(blur) => {
            if shadow.blur == *blur {
                false
            } else {
                shadow.blur = *blur;
                true
            }
        }
    }
}

fn apply_image_transform_leaf(
    transform: &mut ImageTransform,
    patch: &ImageTransformLeafPatchV1,
) -> bool {
    let target = match patch {
        ImageTransformLeafPatchV1::OffsetX(_) => &mut transform.offset_x,
        ImageTransformLeafPatchV1::OffsetY(_) => &mut transform.offset_y,
        ImageTransformLeafPatchV1::Rotation(_) => &mut transform.rotation,
        ImageTransformLeafPatchV1::Scale(_) => &mut transform.scale,
    };
    let value = match patch {
        ImageTransformLeafPatchV1::OffsetX(value)
        | ImageTransformLeafPatchV1::OffsetY(value)
        | ImageTransformLeafPatchV1::Rotation(value)
        | ImageTransformLeafPatchV1::Scale(value) => *value,
    };
    if *target == value {
        false
    } else {
        *target = value;
        true
    }
}

fn patch_image_transform(
    transform: &mut Option<ImageTransform>,
    patch: &Option<ImageTransformLeafPatchV1>,
) -> bool {
    let Some(patch) = patch else {
        return transform.take().is_some();
    };
    let seeded = transform.is_none();
    let transform = transform.get_or_insert_default();
    apply_image_transform_leaf(transform, patch) || seeded
}

fn patch_shadow(
    position: &mut KeyPosition,
    element_type: EditorElementTypeV1,
    active: bool,
    patch: &EditorShadowLeafPatchV1,
) -> bool {
    let seeded = if active {
        position.active_shadow.is_none()
    } else {
        position.shadow.is_none()
    };
    let default = seeded.then(|| default_shadow_spec(position, element_type, active));
    let shadow = if active {
        position
            .active_shadow
            .get_or_insert_with(|| default.unwrap())
    } else {
        position.shadow.get_or_insert_with(|| default.unwrap())
    };
    apply_shadow_leaf(shadow, patch) || seeded
}

fn patch_shadow_enabled(
    position: &mut KeyPosition,
    element_type: EditorElementTypeV1,
    enabled: bool,
) -> bool {
    let idle_seeded = position.shadow.is_none();
    let idle_default = idle_seeded.then(|| default_shadow_spec(position, element_type, false));
    let idle = position.shadow.get_or_insert_with(|| idle_default.unwrap());
    let mut changed = idle_seeded || idle.enabled != enabled;
    idle.enabled = enabled;

    if matches!(
        element_type,
        EditorElementTypeV1::Key | EditorElementTypeV1::Knob
    ) {
        let active_seeded = position.active_shadow.is_none();
        let active_default =
            active_seeded.then(|| default_shadow_spec(position, element_type, true));
        let active = position
            .active_shadow
            .get_or_insert_with(|| active_default.unwrap());
        changed |= active_seeded || active.enabled != enabled;
        active.enabled = enabled;
    }
    changed
}

fn validate_note_paint_intent(patch: &EditorNotePaintIntentV1) -> Result<(), EditorCommitError> {
    let valid_opacity = |value: u32| value <= 100;
    let valid = match patch {
        EditorNotePaintIntentV1::Descriptor(patch) => valid_opacity(patch.opacity),
        EditorNotePaintIntentV1::Color(_) => true,
        EditorNotePaintIntentV1::Opacity(patch) => valid_opacity(patch.opacity),
        EditorNotePaintIntentV1::GradientOpacity(patch) => {
            valid_opacity(patch.opacity)
                && valid_opacity(patch.opacity_top)
                && valid_opacity(patch.opacity_bottom)
        }
    };
    if !valid {
        return Err(EditorCommitError::validation(
            "NOTE_OPACITY_OUT_OF_RANGE",
            "note opacity values must be integers between 0 and 100",
        ));
    }

    let EditorNotePaintIntentV1::Descriptor(patch) = patch else {
        return Ok(());
    };
    let Some(gradient) = patch.gradient.as_ref() else {
        if matches!(patch.color, EditorNoteColorV1::Solid(_)) {
            return Ok(());
        }
        return Err(EditorCommitError::validation(
            "PAINT_COLOR_GRADIENT_MISMATCH",
            "note paint without a gradient must use a solid color",
        ));
    };

    validate_paint_gradient(gradient)?;
    let gradient = gradient.to_gradient_spec();
    let Some(shadow) = note_gradient_shadow(&gradient, patch.opacity) else {
        return Err(EditorCommitError::validation(
            "INVALID_PAINT_GRADIENT",
            "note gradient contains an unsupported stop color",
        ));
    };
    if editor_note_color(&patch.color) != shadow.color {
        return Err(EditorCommitError::validation(
            "PAINT_COLOR_GRADIENT_MISMATCH",
            "note paint color must equal the derived gradient shadow color",
        ));
    }
    Ok(())
}

fn editor_note_color(color: &EditorNoteColorV1) -> NoteColor {
    match color {
        EditorNoteColorV1::Solid(color) => NoteColor::Solid(color.clone()),
        EditorNoteColorV1::Gradient(gradient) => NoteColor::Gradient {
            top: gradient.top.clone(),
            bottom: gradient.bottom.clone(),
        },
    }
}

fn apply_note_gradient_shadow(
    position: &mut KeyPosition,
    glow: bool,
    shadow: NoteGradientShadow,
) -> bool {
    if glow {
        let changed = position.note_glow_color.as_ref() != Some(&shadow.color)
            || position.note_glow_opacity_top != Some(shadow.opacity_top)
            || position.note_glow_opacity_bottom != Some(shadow.opacity_bottom);
        position.note_glow_color = Some(shadow.color);
        position.note_glow_opacity_top = Some(shadow.opacity_top);
        position.note_glow_opacity_bottom = Some(shadow.opacity_bottom);
        changed
    } else {
        let changed = position.note_color != shadow.color
            || position.note_opacity_top != Some(shadow.opacity_top)
            || position.note_opacity_bottom != Some(shadow.opacity_bottom);
        position.note_color = shadow.color;
        position.note_opacity_top = Some(shadow.opacity_top);
        position.note_opacity_bottom = Some(shadow.opacity_bottom);
        changed
    }
}

fn patch_note_paint(
    position: &mut KeyPosition,
    glow: bool,
    patch: &EditorNotePaintIntentV1,
) -> bool {
    match patch {
        EditorNotePaintIntentV1::Descriptor(patch) => {
            let color = editor_note_color(&patch.color);
            let gradient = patch
                .gradient
                .as_ref()
                .map(EditorPaintGradientV1::to_gradient_spec);
            if let Some(gradient) = gradient {
                let shadow = note_gradient_shadow(&gradient, patch.opacity)
                    .expect("a validated note gradient has supported stop colors");
                let changed = if glow {
                    position.note_glow_gradient.as_ref() != Some(&gradient)
                        || position.note_glow_opacity != patch.opacity
                } else {
                    position.note_gradient.as_ref() != Some(&gradient)
                        || position.note_opacity != patch.opacity
                };
                if glow {
                    position.note_glow_gradient = Some(gradient);
                    position.note_glow_opacity = patch.opacity;
                } else {
                    position.note_gradient = Some(gradient);
                    position.note_opacity = patch.opacity;
                }
                changed | apply_note_gradient_shadow(position, glow, shadow)
            } else if glow {
                let changed = position.note_glow_gradient.is_some()
                    || position.note_glow_color.as_ref() != Some(&color)
                    || position.note_glow_opacity != patch.opacity
                    || position.note_glow_opacity_top != Some(patch.opacity)
                    || position.note_glow_opacity_bottom != Some(patch.opacity);
                position.note_glow_gradient = None;
                position.note_glow_color = Some(color);
                position.note_glow_opacity = patch.opacity;
                position.note_glow_opacity_top = Some(patch.opacity);
                position.note_glow_opacity_bottom = Some(patch.opacity);
                changed
            } else {
                let changed = position.note_gradient.is_some()
                    || position.note_color != color
                    || position.note_opacity != patch.opacity
                    || position.note_opacity_top != Some(patch.opacity)
                    || position.note_opacity_bottom != Some(patch.opacity);
                position.note_gradient = None;
                position.note_color = color;
                position.note_opacity = patch.opacity;
                position.note_opacity_top = Some(patch.opacity);
                position.note_opacity_bottom = Some(patch.opacity);
                changed
            }
        }
        EditorNotePaintIntentV1::Color(patch) => {
            let color = editor_note_color(&patch.color);
            if glow {
                let changed = position.note_glow_gradient.is_some()
                    || position.note_glow_color.as_ref() != Some(&color);
                position.note_glow_gradient = None;
                position.note_glow_color = Some(color);
                changed
            } else {
                let changed = position.note_gradient.is_some() || position.note_color != color;
                position.note_gradient = None;
                position.note_color = color;
                changed
            }
        }
        EditorNotePaintIntentV1::Opacity(patch) => {
            let gradient = if glow {
                position.note_glow_gradient.as_ref()
            } else {
                position.note_gradient.as_ref()
            };
            // store canonicalize가 §2A를 보장해 실패는 도달 불가 - 발동해도
            // 사용자 gradient를 지우지 않고 shadow 갱신만 건너뛴다 (비파괴)
            let shadow =
                gradient.and_then(|gradient| note_gradient_shadow(gradient, patch.opacity));
            let mut changed = if glow {
                let changed = position.note_glow_opacity != patch.opacity;
                position.note_glow_opacity = patch.opacity;
                changed
            } else {
                let changed = position.note_opacity != patch.opacity;
                position.note_opacity = patch.opacity;
                changed
            };
            if let Some(shadow) = shadow {
                changed |= apply_note_gradient_shadow(position, glow, shadow);
            }
            changed
        }
        EditorNotePaintIntentV1::GradientOpacity(patch) => {
            let (gradient, opacity, opacity_top, opacity_bottom) = if glow {
                (
                    &mut position.note_glow_gradient,
                    &mut position.note_glow_opacity,
                    &mut position.note_glow_opacity_top,
                    &mut position.note_glow_opacity_bottom,
                )
            } else {
                (
                    &mut position.note_gradient,
                    &mut position.note_opacity,
                    &mut position.note_opacity_top,
                    &mut position.note_opacity_bottom,
                )
            };
            let changed = gradient.is_some()
                || *opacity != patch.opacity
                || *opacity_top != Some(patch.opacity_top)
                || *opacity_bottom != Some(patch.opacity_bottom);
            *gradient = None;
            *opacity = patch.opacity;
            *opacity_top = Some(patch.opacity_top);
            *opacity_bottom = Some(patch.opacity_bottom);
            changed
        }
    }
}

fn validate_note_border_paint(patch: &EditorNoteBorderPaintV1) -> Result<(), EditorCommitError> {
    let valid_color = patch.color.len() == 7
        && patch.color.starts_with('#')
        && patch.color.as_bytes()[1..]
            .iter()
            .all(u8::is_ascii_hexdigit);
    if !valid_color {
        return Err(EditorCommitError::validation(
            "INVALID_NOTE_BORDER_COLOR",
            "note border color must use #RRGGBB format",
        ));
    }
    if patch.opacity > 100 {
        return Err(EditorCommitError::validation(
            "NOTE_OPACITY_OUT_OF_RANGE",
            "note border opacity must be an integer between 0 and 100",
        ));
    }

    let Some(gradient) = patch.gradient.as_ref() else {
        return Ok(());
    };
    validate_paint_gradient(gradient)?;
    for (index, stop) in gradient.stops.iter().enumerate() {
        if note_border_representative_hex(&stop.color).is_none() {
            return Err(EditorCommitError::validation(
                "INVALID_PAINT_GRADIENT",
                format!("note border gradient stop {index} has an unsupported color"),
            ));
        }
    }
    let representative = note_border_representative_hex(
        &gradient
            .stops
            .first()
            .expect("a validated note border gradient has at least two stops")
            .color,
    )
    .expect("all note border gradient stop colors were validated");
    if patch.color != representative {
        return Err(EditorCommitError::validation(
            "PAINT_COLOR_GRADIENT_MISMATCH",
            "note border color must equal the uppercase first gradient stop color",
        ));
    }
    Ok(())
}

fn insert_location(
    locations: &mut HashMap<String, ElementLocation>,
    element_type: EditorElementTypeV1,
    mode: &str,
    index: usize,
    position: &KeyPosition,
) -> Result<(), EditorCommitError> {
    if locations
        .insert(
            position.id.clone(),
            ElementLocation {
                element_type,
                mode: mode.to_string(),
                index,
            },
        )
        .is_some()
    {
        return Err(EditorCommitError::validation(
            DUPLICATE_ELEMENT_ID,
            format!("native element ID {} is not globally unique", position.id),
        ));
    }
    Ok(())
}

fn build_element_locator(
    document: &EditorDocumentV1,
) -> Result<HashMap<String, ElementLocation>, EditorCommitError> {
    let element_count = document.key_positions.values().map(Vec::len).sum::<usize>()
        + document
            .stat_positions
            .values()
            .map(Vec::len)
            .sum::<usize>()
        + document
            .graph_positions
            .values()
            .map(Vec::len)
            .sum::<usize>()
        + document
            .knob_positions
            .values()
            .map(Vec::len)
            .sum::<usize>();
    let mut locations = HashMap::with_capacity(element_count);

    for (mode, positions) in &document.key_positions {
        for (index, position) in positions.iter().enumerate() {
            insert_location(
                &mut locations,
                EditorElementTypeV1::Key,
                mode,
                index,
                position,
            )?;
        }
    }
    for (mode, positions) in &document.stat_positions {
        for (index, position) in positions.iter().enumerate() {
            insert_location(
                &mut locations,
                EditorElementTypeV1::Stat,
                mode,
                index,
                &position.position,
            )?;
        }
    }
    for (mode, positions) in &document.graph_positions {
        for (index, position) in positions.iter().enumerate() {
            insert_location(
                &mut locations,
                EditorElementTypeV1::Graph,
                mode,
                index,
                &position.position,
            )?;
        }
    }
    for (mode, positions) in &document.knob_positions {
        for (index, position) in positions.iter().enumerate() {
            insert_location(
                &mut locations,
                EditorElementTypeV1::Knob,
                mode,
                index,
                &position.position,
            )?;
        }
    }

    Ok(locations)
}

fn position_at_mut<'a>(
    document: &'a mut EditorDocumentV1,
    location: &ElementLocation,
) -> Result<&'a mut KeyPosition, EditorCommitError> {
    let position = match location.element_type {
        EditorElementTypeV1::Key => document
            .key_positions
            .get_mut(&location.mode)
            .and_then(|positions| positions.get_mut(location.index)),
        EditorElementTypeV1::Stat => document
            .stat_positions
            .get_mut(&location.mode)
            .and_then(|positions| positions.get_mut(location.index))
            .map(|position| &mut position.position),
        EditorElementTypeV1::Graph => document
            .graph_positions
            .get_mut(&location.mode)
            .and_then(|positions| positions.get_mut(location.index))
            .map(|position| &mut position.position),
        EditorElementTypeV1::Knob => document
            .knob_positions
            .get_mut(&location.mode)
            .and_then(|positions| positions.get_mut(location.index))
            .map(|position| &mut position.position),
    };
    position.ok_or_else(|| {
        EditorCommitError::validation(
            "ELEMENT_LOCATOR_INVALID",
            "native element locator no longer matches the editor document",
        )
    })
}

fn bounds_of(position: &KeyPosition) -> EditorBoundsV1 {
    EditorBoundsV1 {
        dx: position.dx,
        dy: position.dy,
        width: position.width,
        height: position.height,
    }
}

fn frozen_element_type(element: &EditorFrozenElementV1) -> EditorElementTypeV1 {
    match element {
        EditorFrozenElementV1::Key { .. } => EditorElementTypeV1::Key,
        EditorFrozenElementV1::Stat { .. } => EditorElementTypeV1::Stat,
        EditorFrozenElementV1::Graph { .. } => EditorElementTypeV1::Graph,
        EditorFrozenElementV1::Knob { .. } => EditorElementTypeV1::Knob,
    }
}

fn frozen_element_group_id(element: &EditorFrozenElementV1) -> Option<&str> {
    match element {
        EditorFrozenElementV1::Key { position, .. } => position.group_id.as_deref(),
        EditorFrozenElementV1::Stat { position } => position.position.group_id.as_deref(),
        EditorFrozenElementV1::Graph { position } => position.position.group_id.as_deref(),
        EditorFrozenElementV1::Knob { position } => position.position.group_id.as_deref(),
    }
}

fn frozen_element_matches(
    document: &EditorDocumentV1,
    location: &ElementLocation,
    element: &EditorFrozenElementV1,
) -> bool {
    if location.element_type != frozen_element_type(element) {
        return false;
    }
    match element {
        EditorFrozenElementV1::Key { slot, position } => {
            document
                .key_positions
                .get(&location.mode)
                .and_then(|positions| positions.get(location.index))
                == Some(position)
                && document
                    .keys
                    .get(&location.mode)
                    .and_then(|slots| slots.get(location.index))
                    .is_some_and(|current| current == &slot.to_key_slot())
        }
        EditorFrozenElementV1::Stat { position } => {
            document
                .stat_positions
                .get(&location.mode)
                .and_then(|positions| positions.get(location.index))
                == Some(position)
        }
        EditorFrozenElementV1::Graph { position } => {
            document
                .graph_positions
                .get(&location.mode)
                .and_then(|positions| positions.get(location.index))
                == Some(position)
        }
        EditorFrozenElementV1::Knob { position } => {
            document
                .knob_positions
                .get(&location.mode)
                .and_then(|positions| positions.get(location.index))
                == Some(position)
        }
    }
}

/// z_index의 None ↔ 0 판정은 op마다 다르다. 멱등 비교와 frozen insert는
/// `unwrap_or_default()`로 None을 0과 같게 보고, reorder는 `Option` 그대로
/// 비교해 None에 0을 쓰면 Applied로 잡는다. 프론트 낙관 적용기가 이 비대칭을
/// 그대로 미러하므로(editorCoordinator의 z 반영 분기) 한쪽만 바꾸면 두
/// 표현이 어긋난다. 통일하려면 양쪽을 함께 고쳐야 한다
fn z_update_matches(
    document: &EditorDocumentV1,
    location: &ElementLocation,
    update: &EditorZUpdateV1,
) -> bool {
    location.element_type == update.element_type
        && position_at(document, location)
            .is_some_and(|position| position.z_index.unwrap_or_default() == update.z_index)
}

fn position_at<'a>(
    document: &'a EditorDocumentV1,
    location: &ElementLocation,
) -> Option<&'a KeyPosition> {
    match location.element_type {
        EditorElementTypeV1::Key => document
            .key_positions
            .get(&location.mode)
            .and_then(|positions| positions.get(location.index)),
        EditorElementTypeV1::Stat => document
            .stat_positions
            .get(&location.mode)
            .and_then(|positions| positions.get(location.index))
            .map(|position| &position.position),
        EditorElementTypeV1::Graph => document
            .graph_positions
            .get(&location.mode)
            .and_then(|positions| positions.get(location.index))
            .map(|position| &position.position),
        EditorElementTypeV1::Knob => document
            .knob_positions
            .get(&location.mode)
            .and_then(|positions| positions.get(location.index))
            .map(|position| &position.position),
    }
}

fn append_frozen_element(
    document: &mut EditorDocumentV1,
    mode: &str,
    element: &EditorFrozenElementV1,
) {
    match element {
        EditorFrozenElementV1::Key { slot, position } => {
            document
                .keys
                .entry(mode.to_string())
                .or_default()
                .push(slot.to_key_slot());
            document
                .key_positions
                .entry(mode.to_string())
                .or_default()
                .push(position.clone());
        }
        EditorFrozenElementV1::Stat { position } => document
            .stat_positions
            .entry(mode.to_string())
            .or_default()
            .push(position.clone()),
        EditorFrozenElementV1::Graph { position } => document
            .graph_positions
            .entry(mode.to_string())
            .or_default()
            .push(position.clone()),
        EditorFrozenElementV1::Knob { position } => document
            .knob_positions
            .entry(mode.to_string())
            .or_default()
            .push(position.clone()),
    }
}

fn apply_frozen_insert(
    current: &EditorDocumentV1,
    locations: &HashMap<String, ElementLocation>,
    mode: &str,
    elements: &[EditorFrozenElementV1],
    groups: &[crate::models::EditorFrozenGroupV1],
    z_updates: &[EditorZUpdateV1],
    plugin_group_refs: &PluginGroupRefs,
) -> Result<(EditorDocumentV1, EditorOpResultStatusV1), EditorCommitError> {
    // payload의 gradient pair를 먼저 정규화한다. 나머지 위치 쓰기 경로는 전부
    // 정규화를 거치는데 이 경로만 빠져 base 색과 첫 stop이 어긋난 채 저장될 수
    // 있었다. 멱등 비교와 삽입이 같은 값을 보도록 비교 이전에 적용한다
    let normalized: Vec<EditorFrozenElementV1> = elements
        .iter()
        .cloned()
        .map(|mut element| {
            element.position_mut().canonicalize_gradient_pairs();
            element.position_mut().canonicalize_image_mode();
            element
        })
        .collect();
    let elements: &[EditorFrozenElementV1] = &normalized;
    let existing_elements = elements
        .iter()
        .map(|element| locations.get(element.id()))
        .collect::<Vec<_>>();
    let existing_groups = current
        .layer_groups
        .get(mode)
        .into_iter()
        .flatten()
        .map(|group| (group.id.as_str(), group))
        .collect::<HashMap<_, _>>();
    let inserted_group_refs = elements
        .iter()
        .filter_map(frozen_element_group_id)
        .collect::<HashSet<_>>();
    // 플러그인 멤버만 든 그룹도 생존 - 참조 집합은 커밋 후 상태 기준이라
    // gesture가 동봉한 plugin_changes의 소속이 이미 반영되어 있다
    // (apply_reorder·remove_empty_layer_groups와 같은 규칙)
    let plugin_refs = plugin_group_refs.get(mode);
    if let Some(group) = groups.iter().find(|group| {
        !inserted_group_refs.contains(group.id.as_str())
            && !plugin_refs.is_some_and(|refs| refs.contains(&group.id))
    }) {
        return Err(EditorCommitError::validation(
            "UNREFERENCED_FROZEN_GROUP",
            format!(
                "insertFrozenElements group '{}' has no inserted native or plugin member",
                group.id
            ),
        ));
    }

    for update in z_updates {
        let Some(location) = locations.get(&update.id) else {
            return Err(EditorCommitError::validation(
                "FROZEN_INSERT_TARGET_MISSING",
                format!("insertFrozenElements z target '{}' is missing", update.id),
            ));
        };
        // op_index 0 고정 - 구조 op는 envelope가 ops.len() == 1을 강제한다
        // (INVALID_FROZEN_INSERT_BATCH / INVALID_REORDER_BATCH /
        //  INVALID_GROUP_STRUCTURAL_BATCH). 그 전제가 완화되면 잘못된 인덱스를
        //  보고하게 되므로 함께 고쳐야 한다
        validate_editor_op_target_type(0, update.element_type, location.element_type)?;
        if location.mode != mode {
            return Err(EditorCommitError::validation(
                "FROZEN_INSERT_TARGET_MODE_MISMATCH",
                format!(
                    "insertFrozenElements z target '{}' is not in mode '{mode}'",
                    update.id
                ),
            ));
        }
    }

    let all_elements_absent = existing_elements.iter().all(Option::is_none);
    let all_groups_absent = groups
        .iter()
        .all(|group| !existing_groups.contains_key(group.id.as_str()));
    let all_elements_exact = elements
        .iter()
        .zip(&existing_elements)
        .all(|(element, location)| {
            location.is_some_and(|location| {
                location.mode == mode && frozen_element_matches(current, location, element)
            })
        });
    let all_groups_exact = groups.iter().all(|group| {
        existing_groups
            .get(group.id.as_str())
            .is_some_and(|current| current.name == group.name)
    });
    let all_z_exact = z_updates.iter().all(|update| {
        locations
            .get(&update.id)
            .is_some_and(|location| z_update_matches(current, location, update))
    });
    if all_elements_exact && all_groups_exact && all_z_exact {
        return Ok((current.clone(), EditorOpResultStatusV1::NoChange));
    }
    if !all_elements_absent || !all_groups_absent {
        return Err(EditorCommitError::validation(
            "FROZEN_INSERT_CONFLICT",
            "insertFrozenElements collides with a partially or differently realized plan",
        ));
    }

    let mut candidate = current.clone();
    if !groups.is_empty() {
        candidate
            .layer_groups
            .entry(mode.to_string())
            .or_default()
            .extend(groups.iter().map(|group| LayerGroupDef {
                id: group.id.clone(),
                name: group.name.clone(),
            }));
    }
    for element in elements {
        append_frozen_element(&mut candidate, mode, element);
    }
    for update in z_updates {
        let location = locations
            .get(&update.id)
            .expect("z target was validated above");
        let position = position_at_mut(&mut candidate, location)?;
        if position.z_index.unwrap_or_default() != update.z_index {
            position.z_index = Some(update.z_index);
        }
    }
    Ok((candidate, EditorOpResultStatusV1::Applied))
}

#[allow(clippy::too_many_arguments)]
fn apply_reorder(
    current: &EditorDocumentV1,
    locations: &HashMap<String, ElementLocation>,
    mode: &str,
    complete_mode_order: bool,
    z_updates: &[EditorZUpdateV1],
    group_updates: &[EditorGroupUpdateV1],
    plugin_group_refs: &PluginGroupRefs,
) -> Result<(EditorDocumentV1, EditorOpResultStatusV1), EditorCommitError> {
    for update in z_updates {
        let Some(location) = locations.get(&update.id) else {
            return Err(EditorCommitError::validation(
                "REORDER_TARGET_MISSING",
                format!("reorderElements target '{}' is missing", update.id),
            ));
        };
        validate_editor_op_target_type(0, update.element_type, location.element_type)?;
        if location.mode != mode {
            return Err(EditorCommitError::validation(
                "REORDER_TARGET_MODE_MISMATCH",
                format!(
                    "reorderElements target '{}' is not in mode '{mode}'",
                    update.id
                ),
            ));
        }
    }

    let known_groups = current
        .layer_groups
        .get(mode)
        .into_iter()
        .flatten()
        .map(|group| group.id.as_str())
        .collect::<HashSet<_>>();
    for update in group_updates {
        let Some(location) = locations.get(&update.id) else {
            return Err(EditorCommitError::validation(
                "REORDER_TARGET_MISSING",
                format!("reorderElements group target '{}' is missing", update.id),
            ));
        };
        validate_editor_op_target_type(0, update.element_type, location.element_type)?;
        if location.mode != mode {
            return Err(EditorCommitError::validation(
                "REORDER_TARGET_MODE_MISMATCH",
                format!(
                    "reorderElements group target '{}' is not in mode '{mode}'",
                    update.id
                ),
            ));
        }
        if update
            .group_id
            .as_deref()
            .is_some_and(|group_id| !known_groups.contains(group_id))
        {
            return Err(EditorCommitError::validation(
                "REORDER_GROUP_MISSING",
                format!(
                    "reorderElements target '{}' references an unknown group",
                    update.id
                ),
            ));
        }
    }

    if complete_mode_order {
        let mode_ids = locations
            .iter()
            .filter_map(|(id, location)| (location.mode == mode).then_some(id.as_str()))
            .collect::<HashSet<_>>();
        let update_ids = z_updates
            .iter()
            .map(|update| update.id.as_str())
            .collect::<HashSet<_>>();
        if mode_ids != update_ids {
            return Err(EditorCommitError::validation(
                "INCOMPLETE_REORDER_PLAN",
                "complete reorderElements must cover every native element in its mode",
            ));
        }
    }

    let mut candidate = current.clone();
    let mut changed = false;
    for update in z_updates {
        let location = locations
            .get(&update.id)
            .expect("reorder target was validated above");
        let position = position_at_mut(&mut candidate, location)?;
        if position.z_index != Some(update.z_index) {
            position.z_index = Some(update.z_index);
            changed = true;
        }
    }
    for update in group_updates {
        let location = locations
            .get(&update.id)
            .expect("reorder group target was validated above");
        let position = position_at_mut(&mut candidate, location)?;
        if position.group_id != update.group_id {
            position.group_id.clone_from(&update.group_id);
            changed = true;
        }
    }
    if complete_mode_order {
        let before = candidate.layer_groups.get(mode).map_or(0, Vec::len);
        remove_empty_layer_groups(
            &mut candidate,
            &HashSet::from([mode.to_string()]),
            plugin_group_refs,
        );
        changed |= candidate.layer_groups.get(mode).map_or(0, Vec::len) != before;
    }

    Ok((
        candidate,
        if changed {
            EditorOpResultStatusV1::Applied
        } else {
            EditorOpResultStatusV1::NoChange
        },
    ))
}

fn apply_set_element_groups(
    current: &EditorDocumentV1,
    locations: &HashMap<String, ElementLocation>,
    mode: &str,
    targets: &[EditorElementGroupTargetV1],
    target_group: &Option<EditorTargetGroupV1>,
    plugin_group_refs: &PluginGroupRefs,
) -> Result<(EditorDocumentV1, EditorOpResultStatusV1), EditorCommitError> {
    let mut target_missing = false;
    for target in targets {
        let Some(location) = locations.get(&target.id) else {
            target_missing = true;
            continue;
        };
        validate_editor_op_target_type(0, target.element_type, location.element_type)?;
        if location.mode != mode {
            return Err(EditorCommitError::validation(
                "ELEMENT_GROUP_TARGET_MODE_MISMATCH",
                format!(
                    "setElementGroups target '{}' is not in mode '{mode}'",
                    target.id
                ),
            ));
        }
    }
    if target_missing {
        return Ok((current.clone(), EditorOpResultStatusV1::TargetMissing));
    }

    let groups = current.layer_groups.get(mode);
    match target_group {
        Some(EditorTargetGroupV1::Existing { id })
            if !groups.into_iter().flatten().any(|group| group.id == *id) =>
        {
            return Ok((current.clone(), EditorOpResultStatusV1::TargetMissing));
        }
        Some(EditorTargetGroupV1::Create { id, .. })
            if groups.into_iter().flatten().any(|group| group.id == *id) =>
        {
            return Err(EditorCommitError::validation(
                "LAYER_GROUP_ALREADY_EXISTS",
                format!("layer group '{id}' already exists in mode '{mode}'"),
            ));
        }
        Some(_) | None => {}
    }

    let mut candidate = current.clone();
    if let Some(EditorTargetGroupV1::Create { id, name }) = target_group {
        candidate
            .layer_groups
            .entry(mode.to_string())
            .or_default()
            .push(LayerGroupDef {
                id: id.clone(),
                name: name.clone(),
            });
    }
    let next_group_id = target_group.as_ref().map(|group| match group {
        EditorTargetGroupV1::Existing { id } | EditorTargetGroupV1::Create { id, .. } => id,
    });
    for target in targets {
        let location = locations
            .get(&target.id)
            .expect("group target was validated above");
        let position = position_at_mut(&mut candidate, location)?;
        if position.group_id.as_ref() != next_group_id {
            position.group_id = next_group_id.cloned();
        }
    }
    remove_empty_layer_groups(
        &mut candidate,
        &HashSet::from([mode.to_string()]),
        plugin_group_refs,
    );

    let status = if candidate == *current {
        EditorOpResultStatusV1::NoChange
    } else {
        EditorOpResultStatusV1::Applied
    };
    Ok((candidate, status))
}

fn apply_rename_layer_group(
    current: &EditorDocumentV1,
    mode: &str,
    group_id: &str,
    name: &str,
) -> (EditorDocumentV1, EditorOpResultStatusV1) {
    let Some(current_group) = current
        .layer_groups
        .get(mode)
        .into_iter()
        .flatten()
        .find(|group| group.id == group_id)
    else {
        return (current.clone(), EditorOpResultStatusV1::TargetMissing);
    };
    if current_group.name == name {
        return (current.clone(), EditorOpResultStatusV1::NoChange);
    }

    let mut candidate = current.clone();
    let group = candidate
        .layer_groups
        .get_mut(mode)
        .and_then(|groups| groups.iter_mut().find(|group| group.id == group_id))
        .expect("rename group was validated above");
    name.clone_into(&mut group.name);
    (candidate, EditorOpResultStatusV1::Applied)
}

fn apply_bounds(position: &mut KeyPosition, bounds: &EditorBoundsV1) {
    position.dx = bounds.dx;
    position.dy = bounds.dy;
    position.width = bounds.width;
    position.height = bounds.height;
}

fn delete_elements(
    document: &mut EditorDocumentV1,
    delete_ids: &HashMap<EditorElementTypeV1, HashSet<String>>,
) {
    if let Some(ids) = delete_ids.get(&EditorElementTypeV1::Key) {
        for (mode, positions) in &mut document.key_positions {
            let deleted_indices = positions
                .iter()
                .enumerate()
                .filter_map(|(index, position)| ids.contains(&position.id).then_some(index))
                .collect::<HashSet<_>>();
            if deleted_indices.is_empty() {
                continue;
            }
            positions.retain(|position| !ids.contains(&position.id));
            if let Some(slots) = document.keys.get_mut(mode) {
                let mut index = 0usize;
                slots.retain(|_| {
                    let keep = !deleted_indices.contains(&index);
                    index += 1;
                    keep
                });
            }
        }
    }
    if let Some(ids) = delete_ids.get(&EditorElementTypeV1::Stat) {
        for positions in document.stat_positions.values_mut() {
            positions.retain(|position| !ids.contains(&position.position.id));
        }
    }
    if let Some(ids) = delete_ids.get(&EditorElementTypeV1::Graph) {
        for positions in document.graph_positions.values_mut() {
            positions.retain(|position| !ids.contains(&position.position.id));
        }
    }
    if let Some(ids) = delete_ids.get(&EditorElementTypeV1::Knob) {
        for positions in document.knob_positions.values_mut() {
            positions.retain(|position| !ids.contains(&position.position.id));
        }
    }
}

fn remove_empty_layer_groups(
    document: &mut EditorDocumentV1,
    affected_modes: &HashSet<String>,
    plugin_group_refs: &PluginGroupRefs,
) {
    for mode in affected_modes {
        let mut referenced_group_ids = HashSet::new();
        let mut collect = |group_id: Option<&str>| {
            if let Some(group_id) = group_id {
                referenced_group_ids.insert(group_id.to_string());
            }
        };
        for position in document.key_positions.get(mode).into_iter().flatten() {
            collect(position.group_id.as_deref());
        }
        for position in document.stat_positions.get(mode).into_iter().flatten() {
            collect(position.position.group_id.as_deref());
        }
        for position in document.graph_positions.get(mode).into_iter().flatten() {
            collect(position.position.group_id.as_deref());
        }
        for position in document.knob_positions.get(mode).into_iter().flatten() {
            collect(position.position.group_id.as_deref());
        }
        // 플러그인 멤버만 남은 그룹도 생존 - 참조 집합은 커밋 후 상태 기준
        // (gesture는 요청 동봉 plugin_changes, editor 단독은 store decode)
        let plugin_refs = plugin_group_refs.get(mode);
        if let Some(groups) = document.layer_groups.get_mut(mode) {
            groups.retain(|group| {
                referenced_group_ids.contains(&group.id)
                    || plugin_refs.is_some_and(|refs| refs.contains(&group.id))
            });
        }
    }
}

// editor 단독 commit: 플러그인 그룹 참조를 store 인스턴스 decode로 파생
pub(crate) fn prepare_editor_ops_transition(
    current_store: &AppStoreData,
    ops: &[EditorOpV1],
) -> Result<PreparedEditorOpsTransition, EditorCommitError> {
    let plugin_group_refs = plugin_group_refs_from_store(current_store, &HashSet::new());
    prepare_editor_ops_transition_with_plugin_refs(current_store, ops, &plugin_group_refs)
}

// gesture 경로 전용: editor op 적용이 pluginChanges보다 먼저 실행되므로
// 요청 동봉 plugin_changes에서 파생한 참조 집합을 우선 사용해야 한다
pub(crate) fn prepare_editor_ops_transition_with_plugin_refs(
    current_store: &AppStoreData,
    ops: &[EditorOpV1],
    plugin_group_refs: &PluginGroupRefs,
) -> Result<PreparedEditorOpsTransition, EditorCommitError> {
    let current = EditorDocumentV1::from_store(current_store);
    let locations = build_element_locator(&current)?;

    for (op_index, op) in ops.iter().enumerate() {
        let Some((element_type, id)) = (match op {
            EditorOpV1::SetBounds {
                element_type, id, ..
            }
            | EditorOpV1::DeleteElement { element_type, id }
            | EditorOpV1::PatchElement {
                element_type, id, ..
            } => Some((*element_type, id)),
            EditorOpV1::SetKeySlot { id, .. } => {
                if let Some(location) = locations.get(id) {
                    validate_editor_op_target_type(
                        op_index,
                        EditorElementTypeV1::Key,
                        location.element_type,
                    )?;
                }
                None
            }
            EditorOpV1::InsertFrozenElements { .. }
            | EditorOpV1::ReorderElements { .. }
            | EditorOpV1::SetElementGroups { .. }
            | EditorOpV1::RenameLayerGroup { .. } => None,
        }) else {
            continue;
        };
        if let Some(location) = locations.get(id) {
            validate_editor_op_target_type(op_index, element_type, location.element_type)?;
        }
        if let EditorOpV1::PatchElement {
            element_type,
            patch,
            ..
        } = op
        {
            // 속성 계열별 대상 타입 제약, variant 추가 시 컴파일 에러로 분류 강제
            match patch {
                // 그래프 전용
                EditorElementPropertyPatchV1::GraphType(_)
                | EditorElementPropertyPatchV1::GraphColor(_)
                | EditorElementPropertyPatchV1::ShowAvgLine(_)
                | EditorElementPropertyPatchV1::GraphAnimationEnabled(_)
                | EditorElementPropertyPatchV1::GraphSpeed(_) => {
                    validate_editor_op_target_type(
                        op_index,
                        EditorElementTypeV1::Graph,
                        *element_type,
                    )?;
                }
                // 노브 전용
                EditorElementPropertyPatchV1::Reverse(_)
                | EditorElementPropertyPatchV1::Sensitivity(_)
                | EditorElementPropertyPatchV1::AxisId(_) => {
                    validate_editor_op_target_type(
                        op_index,
                        EditorElementTypeV1::Knob,
                        *element_type,
                    )?;
                }
                // 스탯 전용
                EditorElementPropertyPatchV1::StatType(_) => {
                    validate_editor_op_target_type(
                        op_index,
                        EditorElementTypeV1::Stat,
                        *element_type,
                    )?;
                }
                // key·knob 한정 active shadow
                EditorElementPropertyPatchV1::ActiveShadow(patch) => {
                    if !matches!(
                        element_type,
                        EditorElementTypeV1::Key | EditorElementTypeV1::Knob
                    ) {
                        return Err(EditorCommitError::validation(
                            "ELEMENT_TYPE_MISMATCH",
                            format!(
                                "editor op {op_index} active shadow target must be key or knob"
                            ),
                        ));
                    }
                    validate_shadow_leaf(patch)?;
                }
                // key·stat·knob 한정 shadow
                EditorElementPropertyPatchV1::Shadow(_)
                | EditorElementPropertyPatchV1::ShadowEnabled(_) => {
                    if !matches!(
                        element_type,
                        EditorElementTypeV1::Key
                            | EditorElementTypeV1::Stat
                            | EditorElementTypeV1::Knob
                    ) {
                        return Err(EditorCommitError::validation(
                            "ELEMENT_TYPE_MISMATCH",
                            format!(
                                "editor op {op_index} shadow target must be key, stat, or knob"
                            ),
                        ));
                    }
                    if let EditorElementPropertyPatchV1::Shadow(patch) = patch {
                        validate_shadow_leaf(patch)?;
                    }
                }
                // key·knob 한정 active paint
                EditorElementPropertyPatchV1::ActiveBackgroundPaint(_)
                | EditorElementPropertyPatchV1::ActiveBorderPaint(_) => {
                    if !matches!(
                        element_type,
                        EditorElementTypeV1::Key | EditorElementTypeV1::Knob
                    ) {
                        return Err(EditorCommitError::validation(
                            "ELEMENT_TYPE_MISMATCH",
                            format!("editor op {op_index} active paint target must be key or knob"),
                        ));
                    }
                    let descriptor = match patch {
                        EditorElementPropertyPatchV1::ActiveBackgroundPaint(patch) => patch,
                        EditorElementPropertyPatchV1::ActiveBorderPaint(patch) => patch,
                        _ => unreachable!(),
                    };
                    validate_paint_descriptor(descriptor)?;
                }
                // key 전용 active font paint
                EditorElementPropertyPatchV1::ActiveFontPaint(patch) => {
                    if !matches!(element_type, EditorElementTypeV1::Key) {
                        return Err(EditorCommitError::validation(
                            "ELEMENT_TYPE_MISMATCH",
                            format!("editor op {op_index} active font paint target must be key"),
                        ));
                    }
                    validate_paint_descriptor(patch)?;
                }
                // 타입 무제약, paint 값 검증만
                EditorElementPropertyPatchV1::BackgroundPaint(patch) => {
                    validate_paint_descriptor(patch)?;
                }
                EditorElementPropertyPatchV1::BorderPaint(patch) => {
                    validate_paint_descriptor(patch)?;
                }
                // key·stat 한정 font paint
                EditorElementPropertyPatchV1::FontPaint(patch) => {
                    if !matches!(
                        element_type,
                        EditorElementTypeV1::Key | EditorElementTypeV1::Stat
                    ) {
                        return Err(EditorCommitError::validation(
                            "ELEMENT_TYPE_MISMATCH",
                            format!("editor op {op_index} font paint target must be key or stat"),
                        ));
                    }
                    validate_paint_descriptor(patch)?;
                }
                // key·knob 한정 active 이미지 상태
                EditorElementPropertyPatchV1::ActiveImage(_)
                | EditorElementPropertyPatchV1::ActiveTransparent(_)
                | EditorElementPropertyPatchV1::ActiveImageFit(_) => {
                    if !matches!(
                        element_type,
                        EditorElementTypeV1::Key | EditorElementTypeV1::Knob
                    ) {
                        return Err(EditorCommitError::validation(
                            "ELEMENT_TYPE_MISMATCH",
                            format!(
                                "editor op {op_index} active image state target must be key or knob"
                            ),
                        ));
                    }
                }
                // key 전용 active 이미지 transform
                EditorElementPropertyPatchV1::ActiveImageTransform(patch) => {
                    validate_editor_op_target_type(
                        op_index,
                        EditorElementTypeV1::Key,
                        *element_type,
                    )?;
                    if let Some(patch) = patch {
                        validate_image_transform_leaf(patch)?;
                    }
                }
                // key 전용 idle 이미지 transform
                EditorElementPropertyPatchV1::IdleImageTransform(patch) => {
                    validate_editor_op_target_type(
                        op_index,
                        EditorElementTypeV1::Key,
                        *element_type,
                    )?;
                    if let Some(patch) = patch {
                        validate_image_transform_leaf(patch)?;
                    }
                }
                // key 전용 공통 이미지 모드
                EditorElementPropertyPatchV1::ImageMode(_) => {
                    validate_editor_op_target_type(
                        op_index,
                        EditorElementTypeV1::Key,
                        *element_type,
                    )?;
                }
                // key·stat 한정 카운터 애니메이션 프리셋
                EditorElementPropertyPatchV1::CounterAnimationPreset(patch) => {
                    if !matches!(
                        element_type,
                        EditorElementTypeV1::Key | EditorElementTypeV1::Stat
                    ) {
                        return Err(EditorCommitError::validation(
                            "ELEMENT_TYPE_MISMATCH",
                            format!(
                                "editor op {op_index} counter animation target must be key or stat"
                            ),
                        ));
                    }
                    validate_counter_animation_preset_patch(current_store, patch)?;
                }
                // key·stat 한정 카운터
                EditorElementPropertyPatchV1::CounterEnabled(_)
                | EditorElementPropertyPatchV1::CounterAnimationEnabled(_)
                | EditorElementPropertyPatchV1::CounterPlacement(_)
                | EditorElementPropertyPatchV1::CounterAlign(_)
                | EditorElementPropertyPatchV1::CounterAlignMode(_)
                | EditorElementPropertyPatchV1::CounterGap(_)
                | EditorElementPropertyPatchV1::CounterFontSize(_)
                | EditorElementPropertyPatchV1::CounterFontWeight(_)
                | EditorElementPropertyPatchV1::CounterFontBold(_)
                | EditorElementPropertyPatchV1::CounterFontItalic(_)
                | EditorElementPropertyPatchV1::CounterFontUnderline(_)
                | EditorElementPropertyPatchV1::CounterFontStrikethrough(_)
                | EditorElementPropertyPatchV1::CounterFontFamily(_)
                | EditorElementPropertyPatchV1::CounterFillIdle(_) => {
                    if !matches!(
                        element_type,
                        EditorElementTypeV1::Key | EditorElementTypeV1::Stat
                    ) {
                        return Err(EditorCommitError::validation(
                            "ELEMENT_TYPE_MISMATCH",
                            format!("editor op {op_index} counter target must be key or stat"),
                        ));
                    }
                    if let EditorElementPropertyPatchV1::CounterFontSize(patch) = patch {
                        if !(8..=72).contains(patch) {
                            return Err(EditorCommitError::validation(
                                "COUNTER_FONT_SIZE_OUT_OF_RANGE",
                                format!(
                                    "editor op {op_index} counter font size must be between 8 and 72"
                                ),
                            ));
                        }
                    }
                    if let EditorElementPropertyPatchV1::CounterFontWeight(patch) = patch {
                        if !(100..=900).contains(patch) {
                            return Err(EditorCommitError::validation(
                                "COUNTER_FONT_WEIGHT_OUT_OF_RANGE",
                                format!(
                                    "editor op {op_index} counter font weight must be between 100 and 900"
                                ),
                            ));
                        }
                    }
                    if let EditorElementPropertyPatchV1::CounterFillIdle(patch) = patch {
                        validate_counter_fill_intent(patch)?;
                    }
                }
                // key 전용 카운터 active 계열
                EditorElementPropertyPatchV1::CounterFillActive(_) => {
                    validate_editor_op_target_type(
                        op_index,
                        EditorElementTypeV1::Key,
                        *element_type,
                    )?;
                    if let EditorElementPropertyPatchV1::CounterFillActive(patch) = patch {
                        validate_counter_fill_intent(patch)?;
                    }
                }
                // key 전용 사운드·노트
                EditorElementPropertyPatchV1::SoundPath(_)
                | EditorElementPropertyPatchV1::SoundEnabled(_)
                | EditorElementPropertyPatchV1::SoundVolume(_)
                | EditorElementPropertyPatchV1::NoteEffectEnabled(_)
                | EditorElementPropertyPatchV1::NoteGlowEnabled(_)
                | EditorElementPropertyPatchV1::NoteGlowSyncPaint(_)
                | EditorElementPropertyPatchV1::NoteGlowSize(_)
                | EditorElementPropertyPatchV1::NotePaint(_)
                | EditorElementPropertyPatchV1::NoteGlowPaint(_)
                | EditorElementPropertyPatchV1::NoteBorderPaint(_)
                | EditorElementPropertyPatchV1::NoteOffsetX(_)
                | EditorElementPropertyPatchV1::NoteOffsetY(_)
                | EditorElementPropertyPatchV1::NoteWidth(_)
                | EditorElementPropertyPatchV1::NoteBorderWidth(_)
                | EditorElementPropertyPatchV1::NoteBorderRadius(_)
                | EditorElementPropertyPatchV1::NoteAutoYCorrection(_)
                | EditorElementPropertyPatchV1::NoteAlignment(_)
                | EditorElementPropertyPatchV1::NoteBorderSide(_) => {
                    validate_editor_op_target_type(
                        op_index,
                        EditorElementTypeV1::Key,
                        *element_type,
                    )?;
                    if let EditorElementPropertyPatchV1::SoundVolume(patch) = patch {
                        if !patch.is_finite() || !(0.0..=200.0).contains(patch) {
                            return Err(EditorCommitError::validation(
                                "SOUND_VOLUME_OUT_OF_RANGE",
                                format!(
                                    "editor op {op_index} sound volume must be finite and between 0 and 200"
                                ),
                            ));
                        }
                    }
                    if let EditorElementPropertyPatchV1::NoteGlowSize(patch) = patch {
                        if !patch.is_finite() || !(0.0..=50.0).contains(patch) {
                            return Err(EditorCommitError::validation(
                                "NOTE_GLOW_SIZE_OUT_OF_RANGE",
                                format!(
                                    "editor op {op_index} note glow size must be finite and between 0 and 50"
                                ),
                            ));
                        }
                    }
                    match patch {
                        EditorElementPropertyPatchV1::NotePaint(patch) => {
                            validate_note_paint_intent(patch)?;
                        }
                        EditorElementPropertyPatchV1::NoteGlowPaint(patch) => {
                            validate_note_paint_intent(patch)?;
                        }
                        EditorElementPropertyPatchV1::NoteBorderPaint(patch) => {
                            validate_note_border_paint(patch)?;
                        }
                        _ => {}
                    }
                    if let EditorElementPropertyPatchV1::NoteOffsetX(patch) = patch {
                        if patch.is_some_and(|value| {
                            !value.is_finite() || !(-500.0..=500.0).contains(&value)
                        }) {
                            return Err(EditorCommitError::validation(
                                "NOTE_OFFSET_X_OUT_OF_RANGE",
                                format!(
                                    "editor op {op_index} note offset X must be null or finite and between -500 and 500"
                                ),
                            ));
                        }
                    }
                    if let EditorElementPropertyPatchV1::NoteOffsetY(patch) = patch {
                        if patch.is_some_and(|value| {
                            !value.is_finite() || !(-500.0..=500.0).contains(&value)
                        }) {
                            return Err(EditorCommitError::validation(
                                "NOTE_OFFSET_Y_OUT_OF_RANGE",
                                format!(
                                    "editor op {op_index} note offset Y must be null or finite and between -500 and 500"
                                ),
                            ));
                        }
                    }
                    if let EditorElementPropertyPatchV1::NoteWidth(patch) = patch {
                        if patch.is_some_and(|value| !value.is_finite() || value <= 0.0) {
                            return Err(EditorCommitError::validation(
                                "NOTE_WIDTH_OUT_OF_RANGE",
                                format!(
                                    "editor op {op_index} note width must be null or a positive finite number"
                                ),
                            ));
                        }
                    }
                    if let EditorElementPropertyPatchV1::NoteBorderWidth(patch) = patch {
                        if !patch.is_finite() || !(0.0..=20.0).contains(patch) {
                            return Err(EditorCommitError::validation(
                                "NOTE_BORDER_WIDTH_OUT_OF_RANGE",
                                format!(
                                    "editor op {op_index} note border width must be finite and between 0 and 20"
                                ),
                            ));
                        }
                    }
                    if let EditorElementPropertyPatchV1::NoteBorderRadius(patch) = patch {
                        if !patch.is_finite() || !(0.0..=100.0).contains(patch) {
                            return Err(EditorCommitError::validation(
                                "NOTE_BORDER_RADIUS_OUT_OF_RANGE",
                                format!(
                                    "editor op {op_index} note border radius must be finite and between 0 and 100"
                                ),
                            ));
                        }
                    }
                }
                // 타입 무제약, 값 범위 검증만
                EditorElementPropertyPatchV1::BorderWidth(patch) => {
                    if !patch.is_finite() || !(0.0..=20.0).contains(patch) {
                        return Err(EditorCommitError::validation(
                            "BORDER_WIDTH_OUT_OF_RANGE",
                            format!(
                                "editor op {op_index} border width must be finite and between 0 and 20"
                            ),
                        ));
                    }
                }
                EditorElementPropertyPatchV1::BorderRadius(patch) => {
                    let maximum = if matches!(element_type, EditorElementTypeV1::Knob) {
                        999.0
                    } else {
                        100.0
                    };
                    if !patch.is_finite() || !(0.0..=maximum).contains(patch) {
                        return Err(EditorCommitError::validation(
                            "BORDER_RADIUS_OUT_OF_RANGE",
                            format!(
                                "editor op {op_index} border radius must be finite and between 0 and {maximum}"
                            ),
                        ));
                    }
                }
                EditorElementPropertyPatchV1::FontSize(patch) => {
                    if !patch.is_finite() || !(8.0..=72.0).contains(patch) {
                        return Err(EditorCommitError::validation(
                            "FONT_SIZE_OUT_OF_RANGE",
                            format!(
                                "editor op {op_index} font size must be finite and between 8 and 72"
                            ),
                        ));
                    }
                }
                // 타입 무제약
                EditorElementPropertyPatchV1::Hidden(_)
                | EditorElementPropertyPatchV1::LayerName(_)
                | EditorElementPropertyPatchV1::UseInlineStyles(_)
                | EditorElementPropertyPatchV1::FontWeight(_)
                | EditorElementPropertyPatchV1::FontBold(_)
                | EditorElementPropertyPatchV1::FontItalic(_)
                | EditorElementPropertyPatchV1::FontUnderline(_)
                | EditorElementPropertyPatchV1::FontStrikethrough(_)
                | EditorElementPropertyPatchV1::FontFamily(_)
                | EditorElementPropertyPatchV1::DisplayText(_)
                | EditorElementPropertyPatchV1::ClassName(_)
                | EditorElementPropertyPatchV1::InactiveImage(_)
                | EditorElementPropertyPatchV1::IdleTransparent(_)
                | EditorElementPropertyPatchV1::IdleImageFit(_) => {}
            }
        }
    }

    let mut candidate = current.clone();
    let mut op_results = Vec::with_capacity(ops.len());
    let mut delete_ids = HashMap::<EditorElementTypeV1, HashSet<String>>::new();
    let mut delete_modes = HashSet::new();
    for (op_index, op) in ops.iter().enumerate() {
        match op {
            EditorOpV1::SetBounds { id, bounds, .. } => {
                let Some(location) = locations.get(id) else {
                    validate_editor_op_bounds(op_index, None, *bounds)?;
                    op_results.push(EditorOpResultV1 {
                        status: EditorOpResultStatusV1::TargetMissing,
                        bounds: None,
                    });
                    continue;
                };

                let position = position_at_mut(&mut candidate, location)?;
                validate_editor_op_bounds(op_index, Some(position), *bounds)?;
                let status = if bounds_of(position) == *bounds {
                    EditorOpResultStatusV1::NoChange
                } else {
                    apply_bounds(position, bounds);
                    EditorOpResultStatusV1::Applied
                };
                op_results.push(EditorOpResultV1 {
                    status,
                    bounds: Some(bounds_of(position)),
                });
            }
            EditorOpV1::DeleteElement { element_type, id } => {
                let Some(location) = locations.get(id) else {
                    op_results.push(EditorOpResultV1 {
                        status: EditorOpResultStatusV1::TargetMissing,
                        bounds: None,
                    });
                    continue;
                };
                delete_ids
                    .entry(*element_type)
                    .or_default()
                    .insert(id.clone());
                delete_modes.insert(location.mode.clone());
                op_results.push(EditorOpResultV1 {
                    status: EditorOpResultStatusV1::Applied,
                    bounds: None,
                });
            }
            EditorOpV1::PatchElement { id, patch, .. } => {
                let Some(location) = locations.get(id) else {
                    op_results.push(EditorOpResultV1 {
                        status: EditorOpResultStatusV1::TargetMissing,
                        bounds: None,
                    });
                    continue;
                };
                let changed = match patch {
                    EditorElementPropertyPatchV1::Hidden(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.hidden == *patch {
                            false
                        } else {
                            position.hidden = *patch;
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::LayerName(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.layer_name == *patch {
                            false
                        } else {
                            position.layer_name.clone_from(patch);
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::GraphType(patch) => {
                        let graph = candidate
                            .graph_positions
                            .get_mut(&location.mode)
                            .and_then(|positions| positions.get_mut(location.index))
                            .ok_or_else(|| {
                                EditorCommitError::validation(
                                    "ELEMENT_LOCATOR_INVALID",
                                    "graph property target no longer matches its stable ID",
                                )
                            })?;
                        if graph.graph_type == *patch {
                            false
                        } else {
                            graph.graph_type = patch.clone();
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::GraphColor(patch) => {
                        let graph = candidate
                            .graph_positions
                            .get_mut(&location.mode)
                            .and_then(|positions| positions.get_mut(location.index))
                            .ok_or_else(|| {
                                EditorCommitError::validation(
                                    "ELEMENT_LOCATOR_INVALID",
                                    "graph property target no longer matches its stable ID",
                                )
                            })?;
                        if graph.graph_color == *patch {
                            false
                        } else {
                            graph.graph_color.clone_from(patch);
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::ShowAvgLine(patch) => {
                        let graph = candidate
                            .graph_positions
                            .get_mut(&location.mode)
                            .and_then(|positions| positions.get_mut(location.index))
                            .ok_or_else(|| {
                                EditorCommitError::validation(
                                    "ELEMENT_LOCATOR_INVALID",
                                    "graph property target no longer matches its stable ID",
                                )
                            })?;
                        if graph.show_avg_line == *patch {
                            false
                        } else {
                            graph.show_avg_line = *patch;
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::GraphAnimationEnabled(patch) => {
                        let graph = candidate
                            .graph_positions
                            .get_mut(&location.mode)
                            .and_then(|positions| positions.get_mut(location.index))
                            .ok_or_else(|| {
                                EditorCommitError::validation(
                                    "ELEMENT_LOCATOR_INVALID",
                                    "graph property target no longer matches its stable ID",
                                )
                            })?;
                        if graph.position.graph_animation_enabled == Some(*patch) {
                            false
                        } else {
                            graph.position.graph_animation_enabled = Some(*patch);
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::GraphSpeed(patch) => {
                        let graph = candidate
                            .graph_positions
                            .get_mut(&location.mode)
                            .and_then(|positions| positions.get_mut(location.index))
                            .ok_or_else(|| {
                                EditorCommitError::validation(
                                    "ELEMENT_LOCATOR_INVALID",
                                    "graph property target no longer matches its stable ID",
                                )
                            })?;
                        if graph.graph_speed == *patch {
                            false
                        } else {
                            graph.graph_speed = *patch;
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::Reverse(patch) => {
                        let knob = candidate
                            .knob_positions
                            .get_mut(&location.mode)
                            .and_then(|positions| positions.get_mut(location.index))
                            .ok_or_else(|| {
                                EditorCommitError::validation(
                                    "ELEMENT_LOCATOR_INVALID",
                                    "knob property target no longer matches its stable ID",
                                )
                            })?;
                        if knob.reverse == *patch {
                            false
                        } else {
                            knob.reverse = *patch;
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::Sensitivity(patch) => {
                        let knob = candidate
                            .knob_positions
                            .get_mut(&location.mode)
                            .and_then(|positions| positions.get_mut(location.index))
                            .ok_or_else(|| {
                                EditorCommitError::validation(
                                    "ELEMENT_LOCATOR_INVALID",
                                    "knob property target no longer matches its stable ID",
                                )
                            })?;
                        if knob.sensitivity == *patch {
                            false
                        } else {
                            knob.sensitivity = *patch;
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::AxisId(patch) => {
                        let knob = candidate
                            .knob_positions
                            .get_mut(&location.mode)
                            .and_then(|positions| positions.get_mut(location.index))
                            .ok_or_else(|| {
                                EditorCommitError::validation(
                                    "ELEMENT_LOCATOR_INVALID",
                                    "knob property target no longer matches its stable ID",
                                )
                            })?;
                        if knob.axis_id == *patch {
                            false
                        } else {
                            knob.axis_id.clone_from(patch);
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::UseInlineStyles(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.use_inline_styles == Some(*patch) {
                            false
                        } else {
                            position.use_inline_styles = Some(*patch);
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::FontWeight(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.font_weight == Some(*patch) {
                            false
                        } else {
                            // Bold 미확정 요소는 굵기 변경 전 암묵 상태를 고정 - (700, None)이
                            // 새로 생기면 재시작 마이그레이션이 레거시 700으로 오인한다
                            if position.font_bold.is_none() {
                                position.font_bold =
                                    Some(matches!(position.font_weight, None | Some(700)));
                            }
                            position.font_weight = Some(*patch);
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::FontBold(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.font_bold == Some(*patch) {
                            false
                        } else {
                            position.font_bold = Some(*patch);
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::FontItalic(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.font_italic == Some(*patch) {
                            false
                        } else {
                            position.font_italic = Some(*patch);
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::FontUnderline(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.font_underline == Some(*patch) {
                            false
                        } else {
                            position.font_underline = Some(*patch);
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::FontStrikethrough(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.font_strikethrough == Some(*patch) {
                            false
                        } else {
                            position.font_strikethrough = Some(*patch);
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::FontFamily(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.font_family.as_deref() == Some(patch.as_str()) {
                            false
                        } else {
                            position.font_family = Some(patch.clone());
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::DisplayText(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.display_text.as_deref() == Some(patch.as_str()) {
                            false
                        } else {
                            position.display_text = Some(patch.clone());
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::ClassName(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.class_name.as_deref() == Some(patch.as_str()) {
                            false
                        } else {
                            position.class_name = Some(patch.clone());
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::FontPaint(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        let preserved = matches!(location.element_type, EditorElementTypeV1::Key)
                            && preserve_active_paint_fallback(position, PaintSurface::Font);
                        apply_font_paint_descriptor(
                            &mut position.font_color,
                            &mut position.font_gradient,
                            patch,
                        ) || preserved
                    }
                    EditorElementPropertyPatchV1::ActiveFontPaint(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        apply_font_paint_descriptor(
                            &mut position.active_font_color,
                            &mut position.active_font_gradient,
                            patch,
                        )
                    }
                    EditorElementPropertyPatchV1::Shadow(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        patch_shadow(position, location.element_type, false, patch)
                    }
                    EditorElementPropertyPatchV1::ActiveShadow(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        patch_shadow(position, location.element_type, true, patch)
                    }
                    EditorElementPropertyPatchV1::ShadowEnabled(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        patch_shadow_enabled(position, location.element_type, *patch)
                    }
                    EditorElementPropertyPatchV1::BackgroundPaint(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        let preserved =
                            matches!(
                                location.element_type,
                                EditorElementTypeV1::Key | EditorElementTypeV1::Knob
                            ) && preserve_active_paint_fallback(position, PaintSurface::Background);
                        apply_paint_descriptor(
                            &mut position.background_color,
                            &mut position.background_gradient,
                            patch,
                        ) || preserved
                    }
                    EditorElementPropertyPatchV1::ActiveBackgroundPaint(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        apply_paint_descriptor(
                            &mut position.active_background_color,
                            &mut position.active_background_gradient,
                            patch,
                        )
                    }
                    EditorElementPropertyPatchV1::BorderPaint(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        let preserved =
                            matches!(
                                location.element_type,
                                EditorElementTypeV1::Key | EditorElementTypeV1::Knob
                            ) && preserve_active_paint_fallback(position, PaintSurface::Border);
                        apply_paint_descriptor(
                            &mut position.border_color,
                            &mut position.border_gradient,
                            patch,
                        ) || preserved
                    }
                    EditorElementPropertyPatchV1::ActiveBorderPaint(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        apply_paint_descriptor(
                            &mut position.active_border_color,
                            &mut position.active_border_gradient,
                            patch,
                        )
                    }
                    EditorElementPropertyPatchV1::BorderWidth(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.border_width == Some(*patch) {
                            false
                        } else {
                            position.border_width = Some(*patch);
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::BorderRadius(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.border_radius == Some(*patch) {
                            false
                        } else {
                            position.border_radius = Some(*patch);
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::FontSize(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.font_size == Some(*patch) {
                            false
                        } else {
                            position.font_size = Some(*patch);
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::InactiveImage(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.inactive_image.as_deref() == Some(patch.as_str()) {
                            false
                        } else {
                            position.inactive_image = Some(patch.clone());
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::ActiveImage(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.active_image.as_deref() == Some(patch.as_str()) {
                            false
                        } else {
                            position.active_image = Some(patch.clone());
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::IdleTransparent(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.idle_transparent == *patch {
                            false
                        } else {
                            position.idle_transparent = *patch;
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::ActiveTransparent(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.active_transparent == *patch {
                            false
                        } else {
                            position.active_transparent = *patch;
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::IdleImageFit(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.idle_image_fit.as_ref() == Some(patch) {
                            false
                        } else {
                            position.idle_image_fit = Some(patch.clone());
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::ActiveImageFit(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.active_image_fit.as_ref() == Some(patch) {
                            false
                        } else {
                            position.active_image_fit = Some(patch.clone());
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::ImageMode(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        let next = match patch {
                            ImageMode::Replace => None,
                            ImageMode::Overlay => Some(ImageMode::Overlay),
                        };
                        if position.image_mode == next {
                            false
                        } else {
                            position.image_mode = next;
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::IdleImageTransform(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        patch_image_transform(&mut position.idle_image_transform, patch)
                    }
                    EditorElementPropertyPatchV1::ActiveImageTransform(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        patch_image_transform(&mut position.active_image_transform, patch)
                    }
                    EditorElementPropertyPatchV1::SoundPath(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.sound_path.as_deref() == Some(patch.as_str()) {
                            false
                        } else {
                            position.sound_path = Some(patch.clone());
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::SoundEnabled(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.sound_enabled == Some(*patch) {
                            false
                        } else {
                            position.sound_enabled = Some(*patch);
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::SoundVolume(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.sound_volume == Some(*patch) {
                            false
                        } else {
                            position.sound_volume = Some(*patch);
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::CounterEnabled(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.counter.enabled == *patch {
                            false
                        } else {
                            position.counter.enabled = *patch;
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::CounterAnimationEnabled(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.counter.animation.enabled == *patch {
                            false
                        } else {
                            position.counter.animation.enabled = *patch;
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::CounterPlacement(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.counter.placement == *patch {
                            false
                        } else {
                            position.counter.placement = patch.clone();
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::CounterAlign(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.counter.align == *patch {
                            false
                        } else {
                            position.counter.align = patch.clone();
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::CounterAlignMode(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.counter.align_mode == *patch {
                            false
                        } else {
                            position.counter.align_mode = patch.clone();
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::CounterGap(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.counter.gap == *patch {
                            false
                        } else {
                            position.counter.gap = *patch;
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::CounterFontSize(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.counter.font_size == *patch {
                            false
                        } else {
                            position.counter.font_size = *patch;
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::CounterFontWeight(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.counter.font_weight == *patch {
                            false
                        } else {
                            if position.counter.font_bold.is_none() {
                                position.counter.font_bold =
                                    Some(position.counter.font_weight == 700);
                            }
                            position.counter.font_weight = *patch;
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::CounterFontBold(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.counter.font_bold == Some(*patch) {
                            false
                        } else {
                            position.counter.font_bold = Some(*patch);
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::CounterFontItalic(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.counter.font_italic == *patch {
                            false
                        } else {
                            position.counter.font_italic = *patch;
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::CounterFontUnderline(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.counter.font_underline == *patch {
                            false
                        } else {
                            position.counter.font_underline = *patch;
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::CounterFontStrikethrough(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.counter.font_strikethrough == *patch {
                            false
                        } else {
                            position.counter.font_strikethrough = *patch;
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::CounterFontFamily(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.counter.font_family.as_deref() == Some(patch.as_str()) {
                            false
                        } else {
                            position.counter.font_family = Some(patch.clone());
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::CounterFillIdle(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        patch_counter_fill(position, false, patch)
                    }
                    EditorElementPropertyPatchV1::CounterFillActive(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        patch_counter_fill(position, true, patch)
                    }
                    EditorElementPropertyPatchV1::CounterAnimationPreset(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        let animation = &mut position.counter.animation;
                        let mut changed = false;
                        if patch.apply_preset_id == Some(true)
                            && animation.preset_id.as_deref() != Some(patch.preset_id.as_str())
                        {
                            animation.preset_id = Some(patch.preset_id.clone());
                            changed = true;
                        }
                        if let Some(bezier) = patch.bezier {
                            if animation.bezier != bezier {
                                animation.bezier = bezier;
                                changed = true;
                            }
                        }
                        if let Some(scale) = patch.scale {
                            if animation.scale != scale {
                                animation.scale = scale;
                                changed = true;
                            }
                        }
                        if let Some(duration_ms) = patch.duration_ms {
                            if animation.duration_ms != duration_ms {
                                animation.duration_ms = duration_ms;
                                changed = true;
                            }
                        }
                        changed
                    }
                    EditorElementPropertyPatchV1::StatType(patch) => {
                        let stat = candidate
                            .stat_positions
                            .get_mut(&location.mode)
                            .and_then(|positions| positions.get_mut(location.index))
                            .ok_or_else(|| {
                                EditorCommitError::validation(
                                    "ELEMENT_LOCATOR_INVALID",
                                    "stat property target no longer matches its stable ID",
                                )
                            })?;
                        if stat.stat_type == *patch {
                            false
                        } else {
                            stat.stat_type = patch.clone();
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::NoteEffectEnabled(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.note_effect_enabled == *patch {
                            false
                        } else {
                            position.note_effect_enabled = *patch;
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::NoteGlowEnabled(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.note_glow_enabled == *patch {
                            false
                        } else {
                            position.note_glow_enabled = *patch;
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::NoteGlowSyncPaint(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        let mut changed = position.note_glow_sync_paint != *patch;
                        position.note_glow_sync_paint = *patch;
                        if *patch {
                            changed |= position.mirror_note_body_to_glow();
                        }
                        changed
                    }
                    EditorElementPropertyPatchV1::NoteGlowSize(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.note_glow_size == *patch {
                            false
                        } else {
                            position.note_glow_size = *patch;
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::NotePaint(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        let mut changed = patch_note_paint(position, false, patch);
                        if position.note_glow_sync_paint {
                            changed |= position.mirror_note_body_to_glow();
                        }
                        changed
                    }
                    EditorElementPropertyPatchV1::NoteGlowPaint(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.note_glow_sync_paint {
                            return Err(EditorCommitError::validation(
                                "NOTE_GLOW_PAINT_SYNC_LOCKED",
                                format!(
                                    "editor op {op_index} note glow paint cannot be edited while paint sync is enabled"
                                ),
                            ));
                        }
                        patch_note_paint(position, true, patch)
                    }
                    EditorElementPropertyPatchV1::NoteBorderPaint(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        let next_gradient = patch
                            .gradient
                            .as_ref()
                            .map(EditorPaintGradientV1::to_gradient_spec);
                        let changed = position.note_border_color.as_deref()
                            != Some(patch.color.as_str())
                            || position.note_border_opacity != patch.opacity
                            || position.note_border_gradient != next_gradient;
                        position.note_border_color = Some(patch.color.clone());
                        position.note_border_opacity = patch.opacity;
                        position.note_border_gradient = next_gradient;
                        changed
                    }
                    EditorElementPropertyPatchV1::NoteOffsetX(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.note_offset_x == *patch {
                            false
                        } else {
                            position.note_offset_x = *patch;
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::NoteOffsetY(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.note_offset_y == *patch {
                            false
                        } else {
                            position.note_offset_y = *patch;
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::NoteWidth(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.note_width == *patch {
                            false
                        } else {
                            position.note_width = *patch;
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::NoteBorderWidth(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.note_border_width == Some(*patch) {
                            false
                        } else {
                            position.note_border_width = Some(*patch);
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::NoteBorderRadius(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.note_border_radius == Some(*patch) {
                            false
                        } else {
                            position.note_border_radius = Some(*patch);
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::NoteAutoYCorrection(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.note_auto_y_correction == *patch {
                            false
                        } else {
                            position.note_auto_y_correction = *patch;
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::NoteAlignment(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.note_alignment == *patch {
                            false
                        } else {
                            position.note_alignment = patch.clone();
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::NoteBorderSide(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        let note_border_side = patch.as_str();
                        if position.note_border_side.as_deref() == Some(note_border_side) {
                            false
                        } else {
                            position.note_border_side = Some(note_border_side.to_string());
                            true
                        }
                    }
                };
                op_results.push(EditorOpResultV1 {
                    status: if changed {
                        EditorOpResultStatusV1::Applied
                    } else {
                        EditorOpResultStatusV1::NoChange
                    },
                    bounds: None,
                });
            }
            EditorOpV1::SetKeySlot { id, slot } => {
                let Some(location) = locations.get(id) else {
                    op_results.push(EditorOpResultV1 {
                        status: EditorOpResultStatusV1::TargetMissing,
                        bounds: None,
                    });
                    continue;
                };
                let slots = candidate.keys.get_mut(&location.mode).ok_or_else(|| {
                    EditorCommitError::validation(
                        "ELEMENT_LOCATOR_INVALID",
                        "key slot mode no longer matches the paired position",
                    )
                })?;
                let current_slot = slots.get_mut(location.index).ok_or_else(|| {
                    EditorCommitError::validation(
                        "ELEMENT_LOCATOR_INVALID",
                        "key slot index no longer matches the paired position",
                    )
                })?;
                let next_slot = slot.to_key_slot();
                let status = if *current_slot == next_slot {
                    EditorOpResultStatusV1::NoChange
                } else {
                    *current_slot = next_slot;
                    EditorOpResultStatusV1::Applied
                };
                op_results.push(EditorOpResultV1 {
                    status,
                    bounds: None,
                });
            }
            EditorOpV1::InsertFrozenElements {
                mode,
                elements,
                groups,
                z_updates,
            } => {
                let (next, status) = apply_frozen_insert(
                    &candidate,
                    &locations,
                    mode,
                    elements,
                    groups,
                    z_updates,
                    plugin_group_refs,
                )?;
                candidate = next;
                op_results.push(EditorOpResultV1 {
                    status,
                    bounds: None,
                });
            }
            EditorOpV1::ReorderElements {
                mode,
                complete_mode_order,
                z_updates,
                group_updates,
            } => {
                let (next, status) = apply_reorder(
                    &candidate,
                    &locations,
                    mode,
                    *complete_mode_order,
                    z_updates,
                    group_updates,
                    plugin_group_refs,
                )?;
                candidate = next;
                op_results.push(EditorOpResultV1 {
                    status,
                    bounds: None,
                });
            }
            EditorOpV1::SetElementGroups {
                mode,
                targets,
                target_group,
            } => {
                let (next, status) = apply_set_element_groups(
                    &candidate,
                    &locations,
                    mode,
                    targets,
                    target_group,
                    plugin_group_refs,
                )?;
                candidate = next;
                op_results.push(EditorOpResultV1 {
                    status,
                    bounds: None,
                });
            }
            EditorOpV1::RenameLayerGroup {
                mode,
                group_id,
                name,
            } => {
                let (next, status) = apply_rename_layer_group(&candidate, mode, group_id, name);
                candidate = next;
                op_results.push(EditorOpResultV1 {
                    status,
                    bounds: None,
                });
            }
        }
    }
    delete_elements(&mut candidate, &delete_ids);
    remove_empty_layer_groups(&mut candidate, &delete_modes, plugin_group_refs);

    let mut scratch = current_store.clone();
    candidate.apply_to_store(&mut scratch);
    scratch.editor_revision = current_store.editor_revision;
    validate_document_transition(&current, &candidate, current_store, &scratch)?;
    let changed_fields = current.changed_fields(&candidate);

    Ok(PreparedEditorOpsTransition {
        current,
        candidate,
        scratch,
        changed_fields,
        op_results,
    })
}

#[cfg(test)]
mod tests;
