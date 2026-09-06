use super::*;
use crate::models::{ELEMENT_ROTATION_MAX, ELEMENT_ROTATION_MIN};

mod element_patch;

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
            EditorOpV1::ResizeSprite { id, .. } => Some((EditorElementTypeV1::Sprite, id)),
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
            if *element_type == EditorElementTypeV1::Sprite
                && !matches!(
                    patch,
                    EditorElementPropertyPatchV1::Hidden(_)
                        | EditorElementPropertyPatchV1::LayerName(_)
                        | EditorElementPropertyPatchV1::ClassName(_)
                        | EditorElementPropertyPatchV1::UseInlineStyles(_)
                )
            {
                return Err(EditorCommitError::validation(
                    "ELEMENT_TYPE_MISMATCH",
                    format!(
                        "editor op {op_index} sprite patch only allows hidden, layerName, className, or useInlineStyles"
                    ),
                ));
            }
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
                EditorElementPropertyPatchV1::Rotation(patch) => {
                    if !patch.is_finite()
                        || !(ELEMENT_ROTATION_MIN..=ELEMENT_ROTATION_MAX).contains(patch)
                    {
                        return Err(EditorCommitError::validation(
                            "ROTATION_OUT_OF_RANGE",
                            format!(
                                "editor op {op_index} rotation must be finite and between {ELEMENT_ROTATION_MIN} and {ELEMENT_ROTATION_MAX}"
                            ),
                        ));
                    }
                }
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
                op_results.push(apply_bounds_op(
                    &mut candidate,
                    &locations,
                    op_index,
                    id,
                    *bounds,
                    |candidate, location, bounds| {
                        apply_bounds(element_common_at_mut(candidate, location)?, bounds);
                        Ok(())
                    },
                )?);
            }
            EditorOpV1::ResizeSprite { id, bounds } => {
                op_results.push(apply_bounds_op(
                    &mut candidate,
                    &locations,
                    op_index,
                    id,
                    *bounds,
                    |candidate, location, bounds| {
                        apply_sprite_resize(sprite_at_mut(candidate, location)?, bounds);
                        Ok(())
                    },
                )?);
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
                let changed =
                    element_patch::apply_element_patch(&mut candidate, location, patch, op_index)?;
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
    validate_document_element_ids(&candidate)?;

    let mut scratch = current_store.clone();
    candidate.apply_to_store(&mut scratch);
    crate::state::migration::normalize_sprite_triggers(&mut scratch);
    candidate = EditorDocumentV1::from_store(&scratch);
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
