use std::collections::{HashMap, HashSet};

use crate::{
    errors::EditorCommitError,
    models::{
        compact_canonical_rgba, default_counter_animation_builtin_presets, AppStoreData,
        CounterAnimationPreset, EditorBoundsV1, EditorCounterAnimationPresetIntentV1,
        EditorCounterFillIntentV1, EditorDocumentV1, EditorElementGroupTargetV1,
        EditorElementPropertyPatchV1, EditorElementTypeV1, EditorField, EditorFrozenElementV1,
        EditorGroupUpdateV1, EditorNoteColorV1, EditorNotePaintIntentV1, EditorOpResultStatusV1,
        EditorOpResultV1, EditorOpV1, EditorPaintDescriptorV1, EditorPaintGradientV1,
        EditorShadowLeafPatchV1, EditorTargetGroupV1, EditorZUpdateV1, ElementShadowSpec,
        GradientSpec, KeyPosition, LayerGroupDef, NoteColor, SHADOW_BLUR_MAX, SHADOW_BLUR_MIN,
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

fn preserve_active_paint_fallback(position: &mut KeyPosition, background: bool) -> bool {
    let (idle_color, idle_gradient, active_color, active_gradient) = if background {
        (
            position.background_color.clone(),
            position.background_gradient.clone(),
            &mut position.active_background_color,
            &mut position.active_background_gradient,
        )
    } else {
        (
            position.border_color.clone(),
            position.border_gradient.clone(),
            &mut position.active_border_color,
            &mut position.active_border_gradient,
        )
    };
    if has_stored_paint_value(active_color, active_gradient)
        || !has_stored_paint_value(&idle_color, &idle_gradient)
    {
        return false;
    }

    let next_color = idle_gradient
        .as_ref()
        .and_then(|gradient| gradient.stops.first())
        .map(|stop| stop.color.clone())
        .or_else(|| idle_color.filter(|color| !color.trim().is_empty()));
    let changed = *active_color != next_color || *active_gradient != idle_gradient;
    *active_color = next_color;
    *active_gradient = idle_gradient;
    changed
}

fn preserve_active_font_color_fallback(position: &mut KeyPosition) -> bool {
    if position
        .active_font_color
        .as_deref()
        .is_some_and(|color| !color.trim().is_empty())
    {
        return false;
    }
    let Some(idle_color) = position
        .font_color
        .as_ref()
        .filter(|color| !color.trim().is_empty())
        .cloned()
    else {
        return false;
    };
    let changed = position.active_font_color.as_ref() != Some(&idle_color);
    position.active_font_color = Some(idle_color);
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
        EditorNotePaintIntentV1::Color(_) => true,
        EditorNotePaintIntentV1::Opacity(patch) => valid_opacity(patch.opacity),
        EditorNotePaintIntentV1::GradientOpacity(patch) => {
            valid_opacity(patch.opacity)
                && valid_opacity(patch.opacity_top)
                && valid_opacity(patch.opacity_bottom)
        }
    };
    if valid {
        Ok(())
    } else {
        Err(EditorCommitError::validation(
            "NOTE_OPACITY_OUT_OF_RANGE",
            "note opacity values must be integers between 0 and 100",
        ))
    }
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

fn patch_note_paint(
    position: &mut KeyPosition,
    glow: bool,
    patch: &EditorNotePaintIntentV1,
) -> bool {
    match patch {
        EditorNotePaintIntentV1::Color(patch) => {
            let color = editor_note_color(&patch.color);
            if glow {
                if position.note_glow_color.as_ref() == Some(&color) {
                    false
                } else {
                    position.note_glow_color = Some(color);
                    true
                }
            } else if position.note_color == color {
                false
            } else {
                position.note_color = color;
                true
            }
        }
        EditorNotePaintIntentV1::Opacity(patch) => {
            let opacity = if glow {
                &mut position.note_glow_opacity
            } else {
                &mut position.note_opacity
            };
            if *opacity == patch.opacity {
                false
            } else {
                *opacity = patch.opacity;
                true
            }
        }
        EditorNotePaintIntentV1::GradientOpacity(patch) => {
            let (opacity, opacity_top, opacity_bottom) = if glow {
                (
                    &mut position.note_glow_opacity,
                    &mut position.note_glow_opacity_top,
                    &mut position.note_glow_opacity_bottom,
                )
            } else {
                (
                    &mut position.note_opacity,
                    &mut position.note_opacity_top,
                    &mut position.note_opacity_bottom,
                )
            };
            let changed = *opacity != patch.opacity
                || *opacity_top != Some(patch.opacity_top)
                || *opacity_bottom != Some(patch.opacity_bottom);
            *opacity = patch.opacity;
            *opacity_top = Some(patch.opacity_top);
            *opacity_bottom = Some(patch.opacity_bottom);
            changed
        }
    }
}

fn validate_note_border_paint(color: &str, opacity: u32) -> Result<(), EditorCommitError> {
    let valid_color = color.len() == 7
        && color.starts_with('#')
        && color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit);
    if !valid_color {
        return Err(EditorCommitError::validation(
            "INVALID_NOTE_BORDER_COLOR",
            "note border color must use #RRGGBB format",
        ));
    }
    if opacity > 100 {
        return Err(EditorCommitError::validation(
            "NOTE_OPACITY_OUT_OF_RANGE",
            "note border opacity must be an integer between 0 and 100",
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
                // key·knob 한정 active font color
                EditorElementPropertyPatchV1::ActiveFontColor(_) => {
                    if !matches!(
                        element_type,
                        EditorElementTypeV1::Key | EditorElementTypeV1::Knob
                    ) {
                        return Err(EditorCommitError::validation(
                            "ELEMENT_TYPE_MISMATCH",
                            format!(
                                "editor op {op_index} active font color target must be key or knob"
                            ),
                        ));
                    }
                }
                // 타입 무제약, paint 값 검증만
                EditorElementPropertyPatchV1::BackgroundPaint(patch) => {
                    validate_paint_descriptor(patch)?;
                }
                EditorElementPropertyPatchV1::BorderPaint(patch) => {
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
                | EditorElementPropertyPatchV1::CounterFontItalic(_)
                | EditorElementPropertyPatchV1::CounterFontUnderline(_)
                | EditorElementPropertyPatchV1::CounterFontStrikethrough(_)
                | EditorElementPropertyPatchV1::CounterFontFamily(_)
                | EditorElementPropertyPatchV1::CounterFillIdle(_)
                | EditorElementPropertyPatchV1::CounterStrokeIdle(_) => {
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
                EditorElementPropertyPatchV1::CounterFillActive(_)
                | EditorElementPropertyPatchV1::CounterStrokeActive(_) => {
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
                            validate_note_border_paint(&patch.color, patch.opacity)?;
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
                        if !patch.is_finite() || !(1.0..=100.0).contains(patch) {
                            return Err(EditorCommitError::validation(
                                "NOTE_BORDER_RADIUS_OUT_OF_RANGE",
                                format!(
                                    "editor op {op_index} note border radius must be finite and between 1 and 100"
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
                | EditorElementPropertyPatchV1::FontItalic(_)
                | EditorElementPropertyPatchV1::FontUnderline(_)
                | EditorElementPropertyPatchV1::FontStrikethrough(_)
                | EditorElementPropertyPatchV1::FontFamily(_)
                | EditorElementPropertyPatchV1::DisplayText(_)
                | EditorElementPropertyPatchV1::ClassName(_)
                | EditorElementPropertyPatchV1::FontColor(_)
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
                            position.font_weight = Some(*patch);
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
                    EditorElementPropertyPatchV1::FontColor(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        let preserved = matches!(
                            location.element_type,
                            EditorElementTypeV1::Key | EditorElementTypeV1::Knob
                        ) && preserve_active_font_color_fallback(position);
                        let changed = position.font_color.as_deref() != Some(patch.as_str());
                        position.font_color = Some(patch.clone());
                        changed || preserved
                    }
                    EditorElementPropertyPatchV1::ActiveFontColor(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.active_font_color.as_deref() == Some(patch.as_str()) {
                            false
                        } else {
                            position.active_font_color = Some(patch.clone());
                            true
                        }
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
                        let preserved = matches!(
                            location.element_type,
                            EditorElementTypeV1::Key | EditorElementTypeV1::Knob
                        ) && preserve_active_paint_fallback(position, true);
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
                        let preserved = matches!(
                            location.element_type,
                            EditorElementTypeV1::Key | EditorElementTypeV1::Knob
                        ) && preserve_active_paint_fallback(position, false);
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
                            position.counter.font_weight = *patch;
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
                    EditorElementPropertyPatchV1::CounterStrokeIdle(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.counter.stroke.idle == *patch {
                            false
                        } else {
                            position.counter.stroke.idle = patch.clone();
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::CounterStrokeActive(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        if position.counter.stroke.active == *patch {
                            false
                        } else {
                            position.counter.stroke.active = patch.clone();
                            true
                        }
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
                        patch_note_paint(position, false, patch)
                    }
                    EditorElementPropertyPatchV1::NoteGlowPaint(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        patch_note_paint(position, true, patch)
                    }
                    EditorElementPropertyPatchV1::NoteBorderPaint(patch) => {
                        let position = position_at_mut(&mut candidate, location)?;
                        let changed = position.note_border_color.as_deref()
                            != Some(patch.color.as_str())
                            || position.note_border_opacity != patch.opacity;
                        position.note_border_color = Some(patch.color.clone());
                        position.note_border_opacity = patch.opacity;
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
mod tests {
    use crate::{
        defaults::{default_keys, default_positions},
        models::{
            AppStoreData, EditorElementGroupTargetV1, EditorElementPropertyPatchV1,
            EditorFrozenElementV1, EditorFrozenGroupV1, EditorFrozenKeySlotV1, EditorGroupUpdateV1,
            EditorOpResultStatusV1, EditorOpV1, EditorTargetGroupV1, EditorZUpdateV1,
            GraphPosition, GraphStatType, GraphType, KeyPosition, KnobPosition, StatPosition,
            StatType,
        },
        state::native_element_id::backfill_store_element_ids,
    };

    use super::*;

    fn base_store() -> AppStoreData {
        let mut store = AppStoreData {
            keys: default_keys().clone(),
            key_positions: default_positions().clone(),
            ..AppStoreData::default()
        };
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
            EditorNoteBorderSideV1, ImageFit, KeyCounterAlign, KeyCounterAlignMode,
            KeyCounterPlacement, NoteAlignment, StatType,
        };
        use EditorElementPropertyPatchV1 as Patch;
        use EditorElementTypeV1::{Graph, Key, Knob, Stat};

        const ALL: &[EditorElementTypeV1] = &[Key, Stat, Graph, Knob];
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
            EditorNotePaintIntentV1::Opacity(crate::models::EditorNotePaintOpacityIntentV1 {
                opacity,
            })
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
            row("fontWeight", ALL, Patch::FontWeight(700)),
            row("fontItalic", ALL, Patch::FontItalic(true)),
            row("fontUnderline", ALL, Patch::FontUnderline(true)),
            row("fontStrikethrough", ALL, Patch::FontStrikethrough(true)),
            row("fontFamily", ALL, Patch::FontFamily("Sans".to_string())),
            row("displayText", ALL, Patch::DisplayText("A".to_string())),
            row("className", ALL, Patch::ClassName("custom".to_string())),
            row("fontColor", ALL, Patch::FontColor("#ffffff".to_string())),
            row(
                "activeFontColor",
                KEY_KNOB,
                Patch::ActiveFontColor("#ff0000".to_string()),
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
                ALL,
                Patch::BackgroundPaint(paint_descriptor("#112233", None)),
            ),
            row(
                "activeBackgroundPaint",
                KEY_KNOB,
                Patch::ActiveBackgroundPaint(paint_descriptor("#112233", None)),
            ),
            row(
                "borderPaint",
                ALL,
                Patch::BorderPaint(paint_descriptor("#112233", None)),
            ),
            row(
                "activeBorderPaint",
                KEY_KNOB,
                Patch::ActiveBorderPaint(paint_descriptor("#112233", None)),
            ),
            row("borderWidth", ALL, Patch::BorderWidth(2.0)),
            row("borderRadius", ALL, Patch::BorderRadius(8.0)),
            row("fontSize", ALL, Patch::FontSize(16.0)),
            row(
                "inactiveImage",
                ALL,
                Patch::InactiveImage("idle.png".to_string()),
            ),
            row(
                "activeImage",
                KEY_KNOB,
                Patch::ActiveImage("active.png".to_string()),
            ),
            row("idleTransparent", ALL, Patch::IdleTransparent(true)),
            row(
                "activeTransparent",
                KEY_KNOB,
                Patch::ActiveTransparent(true),
            ),
            row("idleImageFit", ALL, Patch::IdleImageFit(ImageFit::Contain)),
            row(
                "activeImageFit",
                KEY_KNOB,
                Patch::ActiveImageFit(ImageFit::Fill),
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
                "counterStrokeIdle",
                KEY_STAT,
                Patch::CounterStrokeIdle("#000000".to_string()),
            ),
            row(
                "counterStrokeActive",
                KEY_ONLY,
                Patch::CounterStrokeActive("#000000".to_string()),
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
        };
        let rows = patch_target_type_matrix();

        // 전수 고정 - 중복 없는 71개 variant (신규 variant는 본문 match 컴파일 에러가 강제)
        assert_eq!(rows.len(), 71);
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
        let error =
            prepare_editor_ops_transition(&store, std::slice::from_ref(&orphan)).unwrap_err();
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

        let transition =
            prepare_editor_ops_transition(&store, std::slice::from_ref(&create)).unwrap();
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
        store.key_positions.get_mut("4key").unwrap()[0].group_id =
            Some("existing-group".to_string());
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

        let active_patch =
            EditorElementPropertyPatchV1::ActiveImageFit(crate::models::ImageFit::Cover);
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
            counter.stroke.active = "stroke-sibling".to_string();
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
        let placement = EditorElementPropertyPatchV1::CounterPlacement(
            crate::models::KeyCounterPlacement::Outside,
        );
        let align =
            EditorElementPropertyPatchV1::CounterAlign(crate::models::KeyCounterAlign::Right);
        let align_mode = EditorElementPropertyPatchV1::CounterAlignMode(
            crate::models::KeyCounterAlignMode::Center,
        );
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
            counter.stroke.active = "stroke-sibling".to_string();
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
            counter.stroke.idle = "stroke-sibling".to_string();
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
    fn counter_stroke_patches_preserve_every_other_counter_leaf() {
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
            counter.stroke.idle = "idle-before".to_string();
            counter.stroke.active = "active-before".to_string();
            counter.fill.idle = "fill-sibling".to_string();
            counter.fill_idle_gradient = Some(
                serde_json::from_value(serde_json::json!({
                    "angle": 45,
                    "stops": [
                        { "color": "#111111", "pos": 0 },
                        { "color": "#eeeeee", "pos": 1 }
                    ]
                }))
                .unwrap(),
            );
            counter.font_family = Some("font-sibling".to_string());
            counter.animation.preset_id = Some("builtin-linear".to_string());
        }
        let originals = [
            store.key_positions["4key"][0].counter.clone(),
            store.key_positions["4key"][1].counter.clone(),
            store.stat_positions["4key"][0].position.counter.clone(),
        ];
        let ops = vec![
            patch_property_op(
                EditorElementTypeV1::Key,
                &key_ids[0],
                EditorElementPropertyPatchV1::CounterStrokeIdle(String::new()),
            ),
            patch_property_op(
                EditorElementTypeV1::Key,
                &key_ids[1],
                EditorElementPropertyPatchV1::CounterStrokeActive(
                    "  raw active stroke  ".to_string(),
                ),
            ),
            patch_property_op(
                EditorElementTypeV1::Stat,
                &stat_id,
                EditorElementPropertyPatchV1::CounterStrokeIdle("raw stat stroke".to_string()),
            ),
            patch_property_op(
                EditorElementTypeV1::Key,
                uuid::Uuid::new_v4().to_string(),
                EditorElementPropertyPatchV1::CounterStrokeIdle("missing".to_string()),
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
        ];
        let mut expected = originals.clone();
        expected[0].stroke.idle.clear();
        expected[1].stroke.active = "  raw active stroke  ".to_string();
        expected[2].stroke.idle = "raw stat stroke".to_string();
        assert_eq!(actual, expected);
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

        for (element_type, patch) in [
            (
                EditorElementTypeV1::Graph,
                EditorElementPropertyPatchV1::CounterStrokeIdle("wrong".to_string()),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterStrokeActive("wrong".to_string()),
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
    fn note_glow_size_is_key_only_bounded_and_preserves_note_siblings() {
        let mut store = base_store();
        let id = store.key_positions["4key"][0].id.clone();
        let position = &mut store.key_positions.get_mut("4key").unwrap()[0];
        position.note_glow_size = 20.0;
        position.note_glow_enabled = true;
        position.note_glow_opacity = 71;
        position.note_glow_color =
            Some(crate::models::NoteColor::Solid("glow-sibling".to_string()));
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
        let note_opacity =
            EditorElementPropertyPatchV1::NotePaint(EditorNotePaintIntentV1::Opacity(
                crate::models::EditorNotePaintOpacityIntentV1 { opacity: 60 },
            ));
        let glow_color = EditorElementPropertyPatchV1::NoteGlowPaint(
            EditorNotePaintIntentV1::Color(crate::models::EditorNotePaintColorIntentV1 {
                color: EditorNoteColorV1::Solid(String::new()),
            }),
        );
        let border =
            EditorElementPropertyPatchV1::NoteBorderPaint(crate::models::EditorNoteBorderPaintV1 {
                color: "#FFFFFF".to_string(),
                opacity: 100,
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
                EditorElementPropertyPatchV1::NoteBorderPaint(
                    crate::models::EditorNoteBorderPaintV1 {
                        color: "rgba(1,2,3,1)".to_string(),
                        opacity: 100,
                    },
                ),
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
                EditorElementPropertyPatchV1::NoteBorderRadius(0.9),
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
                EditorElementPropertyPatchV1::ActiveBackgroundPaint(paint_descriptor(
                    "missing", None,
                )),
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
        assert_eq!(knob.active_border_color.as_deref(), Some("knob-old"));
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
                EditorElementPropertyPatchV1::ActiveBorderPaint(paint_descriptor(
                    "active-knob",
                    None,
                )),
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
        explicit_active_store.key_positions.get_mut("4key").unwrap()[1]
            .active_background_gradient = None;
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
    fn font_color_patches_preserve_active_fallbacks_and_reject_wrong_active_types() {
        let mut store = store_with_every_reorder_type();
        let key_id = store.key_positions["4key"][0].id.clone();
        let stat_id = store.stat_positions["4key"][0].position.id.clone();
        let graph_id = store.graph_positions["4key"][0].position.id.clone();
        let knob_id = store.knob_positions["4key"][0].position.id.clone();

        let key = &mut store.key_positions.get_mut("4key").unwrap()[0];
        key.font_color = Some(" key idle ".to_string());
        key.active_font_color = None;
        let stat = &mut store.stat_positions.get_mut("4key").unwrap()[0].position;
        stat.font_color = None;
        stat.active_font_color = Some("stat-active-sibling".to_string());
        let graph = &mut store.graph_positions.get_mut("4key").unwrap()[0].position;
        graph.font_color = Some("graph-old".to_string());
        graph.active_font_color = Some("graph-active-sibling".to_string());
        let knob = &mut store.knob_positions.get_mut("4key").unwrap()[0].position;
        knob.font_color = Some(" knob idle ".to_string());
        knob.active_font_color = Some("   ".to_string());

        let original = store.clone();
        let ops = vec![
            patch_property_op(
                EditorElementTypeV1::Key,
                &key_id,
                EditorElementPropertyPatchV1::FontColor(" key idle ".to_string()),
            ),
            patch_property_op(
                EditorElementTypeV1::Stat,
                &stat_id,
                EditorElementPropertyPatchV1::FontColor(String::new()),
            ),
            patch_property_op(
                EditorElementTypeV1::Graph,
                &graph_id,
                EditorElementPropertyPatchV1::FontColor(" graph new ".to_string()),
            ),
            patch_property_op(
                EditorElementTypeV1::Knob,
                &knob_id,
                EditorElementPropertyPatchV1::FontColor("knob-new".to_string()),
            ),
            patch_property_op(
                EditorElementTypeV1::Key,
                uuid::Uuid::new_v4().to_string(),
                EditorElementPropertyPatchV1::ActiveFontColor("missing".to_string()),
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

        let mut expected_key = original.key_positions["4key"][0].clone();
        expected_key.active_font_color = Some(" key idle ".to_string());
        assert_eq!(transition.candidate.key_positions["4key"][0], expected_key);
        let mut expected_stat = original.stat_positions["4key"][0].position.clone();
        expected_stat.font_color = Some(String::new());
        assert_eq!(
            transition.candidate.stat_positions["4key"][0].position,
            expected_stat
        );
        let mut expected_graph = original.graph_positions["4key"][0].position.clone();
        expected_graph.font_color = Some(" graph new ".to_string());
        assert_eq!(
            transition.candidate.graph_positions["4key"][0].position,
            expected_graph
        );
        let mut expected_knob = original.knob_positions["4key"][0].position.clone();
        expected_knob.font_color = Some("knob-new".to_string());
        expected_knob.active_font_color = Some(" knob idle ".to_string());
        assert_eq!(
            transition.candidate.knob_positions["4key"][0].position,
            expected_knob
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

        let mut active_store = store.clone();
        let active_key_id = active_store.key_positions["4key"][1].id.clone();
        active_store.key_positions.get_mut("4key").unwrap()[1].active_font_color = None;
        let active = prepare_editor_ops_transition(
            &active_store,
            &[
                patch_property_op(
                    EditorElementTypeV1::Key,
                    active_key_id,
                    EditorElementPropertyPatchV1::ActiveFontColor(String::new()),
                ),
                patch_property_op(
                    EditorElementTypeV1::Knob,
                    &knob_id,
                    EditorElementPropertyPatchV1::ActiveFontColor(" active raw ".to_string()),
                ),
            ],
        )
        .unwrap();
        assert_eq!(
            active.candidate.key_positions["4key"][1]
                .active_font_color
                .as_deref(),
            Some("")
        );
        assert_eq!(
            active.candidate.knob_positions["4key"][0]
                .position
                .active_font_color
                .as_deref(),
            Some(" active raw ")
        );

        for element_type in [EditorElementTypeV1::Stat, EditorElementTypeV1::Graph] {
            let error = prepare_editor_ops_transition(
                &store,
                &[
                    ops[0].clone(),
                    patch_property_op(
                        element_type,
                        uuid::Uuid::new_v4().to_string(),
                        EditorElementPropertyPatchV1::ActiveFontColor("wrong-type".to_string()),
                    ),
                ],
            )
            .unwrap_err();
            assert_eq!(validation_code(&error), Some("ELEMENT_TYPE_MISMATCH"));
            assert_eq!(store, original);
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
}
