use super::*;

pub(super) fn current_counter_animation_preset(
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

pub(super) fn validate_counter_animation_preset_patch(
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

pub(super) fn validate_paint_descriptor(
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

pub(super) fn validate_paint_gradient(
    gradient: &EditorPaintGradientV1,
) -> Result<(), EditorCommitError> {
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

pub(super) fn validate_counter_fill_intent(
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

pub(super) fn has_stored_paint_value(
    color: &Option<String>,
    gradient: &Option<GradientSpec>,
) -> bool {
    color
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
        || gradient.is_some()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PaintSurface {
    Background,
    Border,
    Font,
}

pub(super) fn preserve_active_paint_fallback(
    position: &mut KeyPosition,
    surface: PaintSurface,
) -> bool {
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

pub(super) fn apply_paint_descriptor(
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
pub(super) fn apply_font_paint_descriptor(
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

pub(super) fn patch_counter_fill(
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

pub(super) fn validate_shadow_leaf(
    patch: &EditorShadowLeafPatchV1,
) -> Result<(), EditorCommitError> {
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

pub(super) fn validate_image_transform_leaf(
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

pub(super) fn default_shadow_spec(
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

pub(super) fn apply_shadow_leaf(
    shadow: &mut ElementShadowSpec,
    patch: &EditorShadowLeafPatchV1,
) -> bool {
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

pub(super) fn apply_image_transform_leaf(
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

pub(super) fn patch_image_transform(
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

pub(super) fn patch_shadow(
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

pub(super) fn patch_shadow_enabled(
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

pub(super) fn validate_note_paint_intent(
    patch: &EditorNotePaintIntentV1,
) -> Result<(), EditorCommitError> {
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

pub(super) fn editor_note_color(color: &EditorNoteColorV1) -> NoteColor {
    match color {
        EditorNoteColorV1::Solid(color) => NoteColor::Solid(color.clone()),
        EditorNoteColorV1::Gradient(gradient) => NoteColor::Gradient {
            top: gradient.top.clone(),
            bottom: gradient.bottom.clone(),
        },
    }
}

pub(super) fn apply_note_gradient_shadow(
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

pub(super) fn patch_note_paint(
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

pub(super) fn validate_note_border_paint(
    patch: &EditorNoteBorderPaintV1,
) -> Result<(), EditorCommitError> {
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
