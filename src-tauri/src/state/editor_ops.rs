use std::collections::{HashMap, HashSet};

use crate::{
    errors::EditorCommitError,
    models::{
        AppStoreData, EditorBoundsV1, EditorDocumentV1, EditorElementPropertyPatchV1,
        EditorElementTypeV1, EditorField, EditorFrozenElementV1, EditorGroupUpdateV1,
        EditorOpResultStatusV1, EditorOpResultV1, EditorOpV1, EditorZUpdateV1, KeyPosition,
        LayerGroupDef,
    },
};

use super::editor::{
    validate_document_transition, validate_editor_op_bounds, validate_editor_op_target_type,
};

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
            "DUPLICATE_ELEMENT_ID",
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
) -> Result<(EditorDocumentV1, EditorOpResultStatusV1), EditorCommitError> {
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
    if let Some(group) = groups
        .iter()
        .find(|group| !inserted_group_refs.contains(group.id.as_str()))
    {
        return Err(EditorCommitError::validation(
            "UNREFERENCED_FROZEN_GROUP",
            format!(
                "insertFrozenElements group '{}' has no inserted native member",
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

fn apply_reorder(
    current: &EditorDocumentV1,
    locations: &HashMap<String, ElementLocation>,
    mode: &str,
    complete_mode_order: bool,
    z_updates: &[EditorZUpdateV1],
    group_updates: &[EditorGroupUpdateV1],
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
        remove_empty_layer_groups(&mut candidate, &HashSet::from([mode.to_string()]));
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

fn remove_empty_layer_groups(document: &mut EditorDocumentV1, affected_modes: &HashSet<String>) {
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
        if let Some(groups) = document.layer_groups.get_mut(mode) {
            groups.retain(|group| referenced_group_ids.contains(&group.id));
        }
    }
}

pub(crate) fn prepare_editor_ops_transition(
    current_store: &AppStoreData,
    ops: &[EditorOpV1],
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
            EditorOpV1::InsertFrozenElements { .. } | EditorOpV1::ReorderElements { .. } => None,
        }) else {
            continue;
        };
        if let Some(location) = locations.get(id) {
            validate_editor_op_target_type(op_index, element_type, location.element_type)?;
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
                let position = position_at_mut(&mut candidate, location)?;
                let changed = match patch {
                    EditorElementPropertyPatchV1::Hidden(patch) => {
                        if position.hidden == patch.hidden {
                            false
                        } else {
                            position.hidden = patch.hidden;
                            true
                        }
                    }
                    EditorElementPropertyPatchV1::LayerName(patch) => {
                        if position.layer_name == patch.layer_name {
                            false
                        } else {
                            position.layer_name.clone_from(&patch.layer_name);
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
                let (next, status) =
                    apply_frozen_insert(&candidate, &locations, mode, elements, groups, z_updates)?;
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
                )?;
                candidate = next;
                op_results.push(EditorOpResultV1 {
                    status,
                    bounds: None,
                });
            }
        }
    }
    delete_elements(&mut candidate, &delete_ids);
    remove_empty_layer_groups(&mut candidate, &delete_modes);

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
            AppStoreData, EditorElementPropertyPatchV1, EditorFrozenElementV1, EditorFrozenGroupV1,
            EditorFrozenKeySlotV1, EditorGroupUpdateV1, EditorOpResultStatusV1, EditorOpV1,
            EditorZUpdateV1, GraphPosition, GraphStatType, GraphType, KeyPosition, KnobPosition,
            StatPosition, StatType,
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
            patch: EditorElementPropertyPatchV1::Hidden(
                crate::models::EditorHiddenPropertyPatchV1 { hidden },
            ),
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
            patch: EditorElementPropertyPatchV1::LayerName(
                crate::models::EditorLayerNamePropertyPatchV1 {
                    layer_name: layer_name.map(str::to_string),
                },
            ),
        }
    }

    fn validation_code(error: &EditorCommitError) -> Option<&str> {
        error
            .details
            .as_ref()
            .and_then(|details| details.validation_code.as_deref())
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
