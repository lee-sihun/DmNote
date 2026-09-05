use super::*;

#[derive(Debug)]
pub(super) struct ElementLocation {
    pub(super) element_type: EditorElementTypeV1,
    pub(super) mode: String,
    pub(super) index: usize,
}

// key 계열 위치와 스프라이트가 공유하는 공통 필드의 가변 참조 묶음
pub(super) struct ElementCommonMut<'a> {
    pub(super) dx: &'a mut f64,
    pub(super) dy: &'a mut f64,
    pub(super) width: &'a mut f64,
    pub(super) height: &'a mut f64,
    pub(super) hidden: &'a mut bool,
    pub(super) z_index: &'a mut Option<i32>,
    pub(super) layer_name: &'a mut Option<String>,
    pub(super) group_id: &'a mut Option<String>,
    pub(super) class_name: &'a mut Option<String>,
    pub(super) use_inline_styles: &'a mut Option<bool>,
}

fn insert_location(
    locations: &mut HashMap<String, ElementLocation>,
    element_type: EditorElementTypeV1,
    mode: &str,
    index: usize,
    id: &str,
) -> Result<(), EditorCommitError> {
    if locations
        .insert(
            id.to_string(),
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
            format!("native element ID {id} is not globally unique"),
        ));
    }
    Ok(())
}

pub(super) fn build_element_locator(
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
            .sum::<usize>()
        + document
            .sprite_positions
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
                &position.id,
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
                &position.position.id,
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
                &position.position.id,
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
                &position.position.id,
            )?;
        }
    }
    for (mode, positions) in &document.sprite_positions {
        for (index, position) in positions.iter().enumerate() {
            insert_location(
                &mut locations,
                EditorElementTypeV1::Sprite,
                mode,
                index,
                &position.id,
            )?;
        }
    }

    Ok(locations)
}

fn key_position_common_mut(position: &mut KeyPosition) -> ElementCommonMut<'_> {
    ElementCommonMut {
        dx: &mut position.dx,
        dy: &mut position.dy,
        width: &mut position.width,
        height: &mut position.height,
        hidden: &mut position.hidden,
        z_index: &mut position.z_index,
        layer_name: &mut position.layer_name,
        group_id: &mut position.group_id,
        class_name: &mut position.class_name,
        use_inline_styles: &mut position.use_inline_styles,
    }
}

fn sprite_common_mut(position: &mut ReactiveSpritePosition) -> ElementCommonMut<'_> {
    ElementCommonMut {
        dx: &mut position.dx,
        dy: &mut position.dy,
        width: &mut position.width,
        height: &mut position.height,
        hidden: &mut position.hidden,
        z_index: &mut position.z_index,
        layer_name: &mut position.layer_name,
        group_id: &mut position.group_id,
        class_name: &mut position.class_name,
        use_inline_styles: &mut position.use_inline_styles,
    }
}

pub(super) fn element_common_at_mut<'a>(
    document: &'a mut EditorDocumentV1,
    location: &ElementLocation,
) -> Result<ElementCommonMut<'a>, EditorCommitError> {
    let common = match location.element_type {
        EditorElementTypeV1::Key => document
            .key_positions
            .get_mut(&location.mode)
            .and_then(|positions| positions.get_mut(location.index))
            .map(key_position_common_mut),
        EditorElementTypeV1::Stat => document
            .stat_positions
            .get_mut(&location.mode)
            .and_then(|positions| positions.get_mut(location.index))
            .map(|position| key_position_common_mut(&mut position.position)),
        EditorElementTypeV1::Graph => document
            .graph_positions
            .get_mut(&location.mode)
            .and_then(|positions| positions.get_mut(location.index))
            .map(|position| key_position_common_mut(&mut position.position)),
        EditorElementTypeV1::Knob => document
            .knob_positions
            .get_mut(&location.mode)
            .and_then(|positions| positions.get_mut(location.index))
            .map(|position| key_position_common_mut(&mut position.position)),
        EditorElementTypeV1::Sprite => document
            .sprite_positions
            .get_mut(&location.mode)
            .and_then(|positions| positions.get_mut(location.index))
            .map(sprite_common_mut),
    };
    common.ok_or_else(|| {
        EditorCommitError::validation(
            "ELEMENT_LOCATOR_INVALID",
            "native element locator no longer matches the editor document",
        )
    })
}

pub(super) fn sprite_at_mut<'a>(
    document: &'a mut EditorDocumentV1,
    location: &ElementLocation,
) -> Result<&'a mut ReactiveSpritePosition, EditorCommitError> {
    document
        .sprite_positions
        .get_mut(&location.mode)
        .and_then(|positions| positions.get_mut(location.index))
        .ok_or_else(|| {
            EditorCommitError::validation(
                "ELEMENT_LOCATOR_INVALID",
                "native element locator no longer matches the editor document",
            )
        })
}

pub(super) fn position_at_mut<'a>(
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
        EditorElementTypeV1::Sprite => None,
    };
    position.ok_or_else(|| {
        EditorCommitError::validation(
            "ELEMENT_LOCATOR_INVALID",
            "native element locator no longer matches the editor document",
        )
    })
}

pub(super) fn bounds_of(position: &KeyPosition) -> EditorBoundsV1 {
    EditorBoundsV1 {
        dx: position.dx,
        dy: position.dy,
        width: position.width,
        height: position.height,
    }
}

pub(super) fn element_bounds(
    document: &EditorDocumentV1,
    location: &ElementLocation,
) -> Option<EditorBoundsV1> {
    match location.element_type {
        EditorElementTypeV1::Sprite => document
            .sprite_positions
            .get(&location.mode)
            .and_then(|positions| positions.get(location.index))
            .map(|position| EditorBoundsV1 {
                dx: position.dx,
                dy: position.dy,
                width: position.width,
                height: position.height,
            }),
        _ => position_at(document, location).map(bounds_of),
    }
}

fn frozen_element_type(element: &EditorFrozenElementV1) -> EditorElementTypeV1 {
    match element {
        EditorFrozenElementV1::Key { .. } => EditorElementTypeV1::Key,
        EditorFrozenElementV1::Stat { .. } => EditorElementTypeV1::Stat,
        EditorFrozenElementV1::Graph { .. } => EditorElementTypeV1::Graph,
        EditorFrozenElementV1::Knob { .. } => EditorElementTypeV1::Knob,
        EditorFrozenElementV1::Sprite { .. } => EditorElementTypeV1::Sprite,
    }
}

fn frozen_element_group_id(element: &EditorFrozenElementV1) -> Option<&str> {
    match element {
        EditorFrozenElementV1::Key { position, .. } => position.group_id.as_deref(),
        EditorFrozenElementV1::Stat { position } => position.position.group_id.as_deref(),
        EditorFrozenElementV1::Graph { position } => position.position.group_id.as_deref(),
        EditorFrozenElementV1::Knob { position } => position.position.group_id.as_deref(),
        EditorFrozenElementV1::Sprite { position } => position.group_id.as_deref(),
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
        EditorFrozenElementV1::Sprite { position } => {
            document
                .sprite_positions
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
        && element_z_index(document, location)
            .is_some_and(|z_index| z_index.unwrap_or_default() == update.z_index)
}

fn element_z_index(document: &EditorDocumentV1, location: &ElementLocation) -> Option<Option<i32>> {
    match location.element_type {
        EditorElementTypeV1::Sprite => document
            .sprite_positions
            .get(&location.mode)
            .and_then(|positions| positions.get(location.index))
            .map(|position| position.z_index),
        _ => position_at(document, location).map(|position| position.z_index),
    }
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
        EditorElementTypeV1::Sprite => None,
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
        EditorFrozenElementV1::Sprite { position } => document
            .sprite_positions
            .entry(mode.to_string())
            .or_default()
            .push(position.clone()),
    }
}

pub(super) fn apply_frozen_insert(
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
            if let Some(position) = element.key_position_mut() {
                position.canonicalize_gradient_pairs();
                position.canonicalize_image_mode();
            } else if let EditorFrozenElementV1::Sprite { position } = &mut element {
                for pose in &mut position.poses {
                    pose.normalize_triggers();
                }
            }
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
        let common = element_common_at_mut(&mut candidate, location)?;
        if common.z_index.unwrap_or_default() != update.z_index {
            *common.z_index = Some(update.z_index);
        }
    }
    Ok((candidate, EditorOpResultStatusV1::Applied))
}

#[allow(clippy::too_many_arguments)]
pub(super) fn apply_reorder(
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
        let common = element_common_at_mut(&mut candidate, location)?;
        if *common.z_index != Some(update.z_index) {
            *common.z_index = Some(update.z_index);
            changed = true;
        }
    }
    for update in group_updates {
        let location = locations
            .get(&update.id)
            .expect("reorder group target was validated above");
        let common = element_common_at_mut(&mut candidate, location)?;
        if *common.group_id != update.group_id {
            common.group_id.clone_from(&update.group_id);
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

pub(super) fn apply_set_element_groups(
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
        let common = element_common_at_mut(&mut candidate, location)?;
        if common.group_id.as_ref() != next_group_id {
            *common.group_id = next_group_id.cloned();
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

pub(super) fn apply_rename_layer_group(
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

pub(super) fn apply_bounds(common: ElementCommonMut<'_>, bounds: &EditorBoundsV1) {
    *common.dx = bounds.dx;
    *common.dy = bounds.dy;
    *common.width = bounds.width;
    *common.height = bounds.height;
}

#[allow(clippy::neg_cmp_op_on_partial_ord)]
pub(super) fn sprite_resize_ratio(prev: f64, next: f64) -> f64 {
    if !(prev > 0.0) || !prev.is_finite() || !(next > 0.0) || !next.is_finite() {
        return 1.0;
    }
    let ratio = next / prev;
    if ratio.is_finite() {
        ratio
    } else {
        1.0
    }
}

pub(super) fn scale_sprite_resize_value(value: f64, ratio: f64) -> f64 {
    // 배율 1은 클램프 없는 완전 passthrough - 순수 이동이 검증상 유효한
    // 극소 치수(하한 미만)까지 비트 단위로 보존한다
    if ratio == 1.0 {
        return value;
    }
    (value * ratio).clamp(SPRITE_TRANSFORM_OFFSET_MIN, SPRITE_TRANSFORM_OFFSET_MAX)
}

fn scale_sprite_transform_offsets(transform: &mut SpriteTransform, sx: f64, sy: f64) {
    transform.x = scale_sprite_resize_value(transform.x, sx);
    transform.y = scale_sprite_resize_value(transform.y, sy);
}

pub(super) fn apply_sprite_resize(sprite: &mut ReactiveSpritePosition, bounds: &EditorBoundsV1) {
    let sx = sprite_resize_ratio(sprite.width, bounds.width);
    let sy = sprite_resize_ratio(sprite.height, bounds.height);

    sprite.dx = bounds.dx;
    sprite.dy = bounds.dy;
    sprite.width = bounds.width;
    sprite.height = bounds.height;
    scale_sprite_transform_offsets(&mut sprite.idle_transform, sx, sy);
    for pose in &mut sprite.poses {
        scale_sprite_transform_offsets(&mut pose.transform, sx, sy);
    }
}

pub(super) fn apply_bounds_op<F>(
    candidate: &mut EditorDocumentV1,
    locations: &HashMap<String, ElementLocation>,
    op_index: usize,
    id: &str,
    bounds: EditorBoundsV1,
    mutate: F,
) -> Result<EditorOpResultV1, EditorCommitError>
where
    F: FnOnce(
        &mut EditorDocumentV1,
        &ElementLocation,
        &EditorBoundsV1,
    ) -> Result<(), EditorCommitError>,
{
    let Some(location) = locations.get(id) else {
        validate_editor_op_bounds(op_index, None, bounds)?;
        return Ok(EditorOpResultV1 {
            status: EditorOpResultStatusV1::TargetMissing,
            bounds: None,
        });
    };

    let current_bounds = element_bounds(candidate, location).ok_or_else(|| {
        EditorCommitError::validation(
            "ELEMENT_LOCATOR_INVALID",
            "native element locator no longer matches the editor document",
        )
    })?;
    validate_editor_op_bounds(op_index, Some(current_bounds), bounds)?;
    let status = if current_bounds == bounds {
        EditorOpResultStatusV1::NoChange
    } else {
        mutate(candidate, location, &bounds)?;
        EditorOpResultStatusV1::Applied
    };
    Ok(EditorOpResultV1 {
        status,
        bounds: element_bounds(candidate, location),
    })
}

pub(super) fn delete_elements(
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
    if let Some(ids) = delete_ids.get(&EditorElementTypeV1::Sprite) {
        for positions in document.sprite_positions.values_mut() {
            positions.retain(|position| !ids.contains(&position.id));
        }
    }
}

pub(super) fn remove_empty_layer_groups(
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
        for position in document.sprite_positions.get(mode).into_iter().flatten() {
            collect(position.group_id.as_deref());
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
