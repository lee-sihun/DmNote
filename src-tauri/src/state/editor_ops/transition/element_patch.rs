use super::super::*;

pub(super) fn apply_element_patch(
    candidate: &mut EditorDocumentV1,
    location: &ElementLocation,
    patch: &EditorElementPropertyPatchV1,
    op_index: usize,
) -> Result<bool, EditorCommitError> {
    Ok(match patch {
        EditorElementPropertyPatchV1::Hidden(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.hidden == *patch {
                false
            } else {
                position.hidden = *patch;
                true
            }
        }
        EditorElementPropertyPatchV1::LayerName(patch) => {
            let position = position_at_mut(candidate, location)?;
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
            let position = position_at_mut(candidate, location)?;
            if position.use_inline_styles == Some(*patch) {
                false
            } else {
                position.use_inline_styles = Some(*patch);
                true
            }
        }
        EditorElementPropertyPatchV1::FontWeight(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.font_weight == Some(*patch) {
                false
            } else {
                // Bold 미확정 요소는 굵기 변경 전 암묵 상태를 고정 - (700, None)이
                // 새로 생기면 재시작 마이그레이션이 레거시 700으로 오인한다
                if position.font_bold.is_none() {
                    position.font_bold = Some(matches!(position.font_weight, None | Some(700)));
                }
                position.font_weight = Some(*patch);
                true
            }
        }
        EditorElementPropertyPatchV1::FontBold(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.font_bold == Some(*patch) {
                false
            } else {
                position.font_bold = Some(*patch);
                true
            }
        }
        EditorElementPropertyPatchV1::FontItalic(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.font_italic == Some(*patch) {
                false
            } else {
                position.font_italic = Some(*patch);
                true
            }
        }
        EditorElementPropertyPatchV1::FontUnderline(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.font_underline == Some(*patch) {
                false
            } else {
                position.font_underline = Some(*patch);
                true
            }
        }
        EditorElementPropertyPatchV1::FontStrikethrough(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.font_strikethrough == Some(*patch) {
                false
            } else {
                position.font_strikethrough = Some(*patch);
                true
            }
        }
        EditorElementPropertyPatchV1::FontFamily(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.font_family.as_deref() == Some(patch.as_str()) {
                false
            } else {
                position.font_family = Some(patch.clone());
                true
            }
        }
        EditorElementPropertyPatchV1::DisplayText(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.display_text.as_deref() == Some(patch.as_str()) {
                false
            } else {
                position.display_text = Some(patch.clone());
                true
            }
        }
        EditorElementPropertyPatchV1::ClassName(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.class_name.as_deref() == Some(patch.as_str()) {
                false
            } else {
                position.class_name = Some(patch.clone());
                true
            }
        }
        EditorElementPropertyPatchV1::FontPaint(patch) => {
            let position = position_at_mut(candidate, location)?;
            let preserved = matches!(location.element_type, EditorElementTypeV1::Key)
                && preserve_active_paint_fallback(position, PaintSurface::Font);
            apply_font_paint_descriptor(
                &mut position.font_color,
                &mut position.font_gradient,
                patch,
            ) || preserved
        }
        EditorElementPropertyPatchV1::ActiveFontPaint(patch) => {
            let position = position_at_mut(candidate, location)?;
            apply_font_paint_descriptor(
                &mut position.active_font_color,
                &mut position.active_font_gradient,
                patch,
            )
        }
        EditorElementPropertyPatchV1::Shadow(patch) => {
            let position = position_at_mut(candidate, location)?;
            patch_shadow(position, location.element_type, false, patch)
        }
        EditorElementPropertyPatchV1::ActiveShadow(patch) => {
            let position = position_at_mut(candidate, location)?;
            patch_shadow(position, location.element_type, true, patch)
        }
        EditorElementPropertyPatchV1::ShadowEnabled(patch) => {
            let position = position_at_mut(candidate, location)?;
            patch_shadow_enabled(position, location.element_type, *patch)
        }
        EditorElementPropertyPatchV1::BackgroundPaint(patch) => {
            let position = position_at_mut(candidate, location)?;
            let preserved = matches!(
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
            let position = position_at_mut(candidate, location)?;
            apply_paint_descriptor(
                &mut position.active_background_color,
                &mut position.active_background_gradient,
                patch,
            )
        }
        EditorElementPropertyPatchV1::BorderPaint(patch) => {
            let position = position_at_mut(candidate, location)?;
            let preserved = matches!(
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
            let position = position_at_mut(candidate, location)?;
            apply_paint_descriptor(
                &mut position.active_border_color,
                &mut position.active_border_gradient,
                patch,
            )
        }
        EditorElementPropertyPatchV1::BorderWidth(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.border_width == Some(*patch) {
                false
            } else {
                position.border_width = Some(*patch);
                true
            }
        }
        EditorElementPropertyPatchV1::BorderRadius(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.border_radius == Some(*patch) {
                false
            } else {
                position.border_radius = Some(*patch);
                true
            }
        }
        EditorElementPropertyPatchV1::FontSize(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.font_size == Some(*patch) {
                false
            } else {
                position.font_size = Some(*patch);
                true
            }
        }
        EditorElementPropertyPatchV1::InactiveImage(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.inactive_image.as_deref() == Some(patch.as_str()) {
                false
            } else {
                position.inactive_image = Some(patch.clone());
                true
            }
        }
        EditorElementPropertyPatchV1::ActiveImage(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.active_image.as_deref() == Some(patch.as_str()) {
                false
            } else {
                position.active_image = Some(patch.clone());
                true
            }
        }
        EditorElementPropertyPatchV1::IdleTransparent(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.idle_transparent == *patch {
                false
            } else {
                position.idle_transparent = *patch;
                true
            }
        }
        EditorElementPropertyPatchV1::ActiveTransparent(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.active_transparent == *patch {
                false
            } else {
                position.active_transparent = *patch;
                true
            }
        }
        EditorElementPropertyPatchV1::IdleImageFit(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.idle_image_fit.as_ref() == Some(patch) {
                false
            } else {
                position.idle_image_fit = Some(patch.clone());
                true
            }
        }
        EditorElementPropertyPatchV1::ActiveImageFit(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.active_image_fit.as_ref() == Some(patch) {
                false
            } else {
                position.active_image_fit = Some(patch.clone());
                true
            }
        }
        EditorElementPropertyPatchV1::ImageMode(patch) => {
            let position = position_at_mut(candidate, location)?;
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
            let position = position_at_mut(candidate, location)?;
            patch_image_transform(&mut position.idle_image_transform, patch)
        }
        EditorElementPropertyPatchV1::ActiveImageTransform(patch) => {
            let position = position_at_mut(candidate, location)?;
            patch_image_transform(&mut position.active_image_transform, patch)
        }
        EditorElementPropertyPatchV1::SoundPath(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.sound_path.as_deref() == Some(patch.as_str()) {
                false
            } else {
                position.sound_path = Some(patch.clone());
                true
            }
        }
        EditorElementPropertyPatchV1::SoundEnabled(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.sound_enabled == Some(*patch) {
                false
            } else {
                position.sound_enabled = Some(*patch);
                true
            }
        }
        EditorElementPropertyPatchV1::SoundVolume(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.sound_volume == Some(*patch) {
                false
            } else {
                position.sound_volume = Some(*patch);
                true
            }
        }
        EditorElementPropertyPatchV1::CounterEnabled(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.counter.enabled == *patch {
                false
            } else {
                position.counter.enabled = *patch;
                true
            }
        }
        EditorElementPropertyPatchV1::CounterAnimationEnabled(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.counter.animation.enabled == *patch {
                false
            } else {
                position.counter.animation.enabled = *patch;
                true
            }
        }
        EditorElementPropertyPatchV1::CounterPlacement(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.counter.placement == *patch {
                false
            } else {
                position.counter.placement = patch.clone();
                true
            }
        }
        EditorElementPropertyPatchV1::CounterAlign(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.counter.align == *patch {
                false
            } else {
                position.counter.align = patch.clone();
                true
            }
        }
        EditorElementPropertyPatchV1::CounterAlignMode(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.counter.align_mode == *patch {
                false
            } else {
                position.counter.align_mode = patch.clone();
                true
            }
        }
        EditorElementPropertyPatchV1::CounterGap(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.counter.gap == *patch {
                false
            } else {
                position.counter.gap = *patch;
                true
            }
        }
        EditorElementPropertyPatchV1::CounterFontSize(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.counter.font_size == *patch {
                false
            } else {
                position.counter.font_size = *patch;
                true
            }
        }
        EditorElementPropertyPatchV1::CounterFontWeight(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.counter.font_weight == *patch {
                false
            } else {
                if position.counter.font_bold.is_none() {
                    position.counter.font_bold = Some(position.counter.font_weight == 700);
                }
                position.counter.font_weight = *patch;
                true
            }
        }
        EditorElementPropertyPatchV1::CounterFontBold(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.counter.font_bold == Some(*patch) {
                false
            } else {
                position.counter.font_bold = Some(*patch);
                true
            }
        }
        EditorElementPropertyPatchV1::CounterFontItalic(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.counter.font_italic == *patch {
                false
            } else {
                position.counter.font_italic = *patch;
                true
            }
        }
        EditorElementPropertyPatchV1::CounterFontUnderline(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.counter.font_underline == *patch {
                false
            } else {
                position.counter.font_underline = *patch;
                true
            }
        }
        EditorElementPropertyPatchV1::CounterFontStrikethrough(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.counter.font_strikethrough == *patch {
                false
            } else {
                position.counter.font_strikethrough = *patch;
                true
            }
        }
        EditorElementPropertyPatchV1::CounterFontFamily(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.counter.font_family.as_deref() == Some(patch.as_str()) {
                false
            } else {
                position.counter.font_family = Some(patch.clone());
                true
            }
        }
        EditorElementPropertyPatchV1::CounterFillIdle(patch) => {
            let position = position_at_mut(candidate, location)?;
            patch_counter_fill(position, false, patch)
        }
        EditorElementPropertyPatchV1::CounterFillActive(patch) => {
            let position = position_at_mut(candidate, location)?;
            patch_counter_fill(position, true, patch)
        }
        EditorElementPropertyPatchV1::CounterAnimationPreset(patch) => {
            let position = position_at_mut(candidate, location)?;
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
            let position = position_at_mut(candidate, location)?;
            if position.note_effect_enabled == *patch {
                false
            } else {
                position.note_effect_enabled = *patch;
                true
            }
        }
        EditorElementPropertyPatchV1::NoteGlowEnabled(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.note_glow_enabled == *patch {
                false
            } else {
                position.note_glow_enabled = *patch;
                true
            }
        }
        EditorElementPropertyPatchV1::NoteGlowSyncPaint(patch) => {
            let position = position_at_mut(candidate, location)?;
            let mut changed = position.note_glow_sync_paint != *patch;
            position.note_glow_sync_paint = *patch;
            if *patch {
                changed |= position.mirror_note_body_to_glow();
            }
            changed
        }
        EditorElementPropertyPatchV1::NoteGlowSize(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.note_glow_size == *patch {
                false
            } else {
                position.note_glow_size = *patch;
                true
            }
        }
        EditorElementPropertyPatchV1::NotePaint(patch) => {
            let position = position_at_mut(candidate, location)?;
            let mut changed = patch_note_paint(position, false, patch);
            if position.note_glow_sync_paint {
                changed |= position.mirror_note_body_to_glow();
            }
            changed
        }
        EditorElementPropertyPatchV1::NoteGlowPaint(patch) => {
            let position = position_at_mut(candidate, location)?;
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
            let position = position_at_mut(candidate, location)?;
            let next_gradient = patch
                .gradient
                .as_ref()
                .map(EditorPaintGradientV1::to_gradient_spec);
            let changed = position.note_border_color.as_deref() != Some(patch.color.as_str())
                || position.note_border_opacity != patch.opacity
                || position.note_border_gradient != next_gradient;
            position.note_border_color = Some(patch.color.clone());
            position.note_border_opacity = patch.opacity;
            position.note_border_gradient = next_gradient;
            changed
        }
        EditorElementPropertyPatchV1::NoteOffsetX(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.note_offset_x == *patch {
                false
            } else {
                position.note_offset_x = *patch;
                true
            }
        }
        EditorElementPropertyPatchV1::NoteOffsetY(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.note_offset_y == *patch {
                false
            } else {
                position.note_offset_y = *patch;
                true
            }
        }
        EditorElementPropertyPatchV1::NoteWidth(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.note_width == *patch {
                false
            } else {
                position.note_width = *patch;
                true
            }
        }
        EditorElementPropertyPatchV1::NoteBorderWidth(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.note_border_width == Some(*patch) {
                false
            } else {
                position.note_border_width = Some(*patch);
                true
            }
        }
        EditorElementPropertyPatchV1::NoteBorderRadius(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.note_border_radius == Some(*patch) {
                false
            } else {
                position.note_border_radius = Some(*patch);
                true
            }
        }
        EditorElementPropertyPatchV1::NoteAutoYCorrection(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.note_auto_y_correction == *patch {
                false
            } else {
                position.note_auto_y_correction = *patch;
                true
            }
        }
        EditorElementPropertyPatchV1::NoteAlignment(patch) => {
            let position = position_at_mut(candidate, location)?;
            if position.note_alignment == *patch {
                false
            } else {
                position.note_alignment = patch.clone();
                true
            }
        }
        EditorElementPropertyPatchV1::NoteBorderSide(patch) => {
            let position = position_at_mut(candidate, location)?;
            let note_border_side = patch.as_str();
            if position.note_border_side.as_deref() == Some(note_border_side) {
                false
            } else {
                position.note_border_side = Some(note_border_side.to_string());
                true
            }
        }
    })
}
