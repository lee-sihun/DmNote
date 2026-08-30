use super::*;

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
