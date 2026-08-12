use std::collections::{HashMap, HashSet};

use crate::{
    errors::EditorCommitError,
    models::{
        AppStoreData, EditorBoundsV1, EditorDocumentV1, EditorElementTypeV1, EditorField,
        EditorOpResultStatusV1, EditorOpResultV1, EditorOpV1, KeyPosition,
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
        let (element_type, id) = match op {
            EditorOpV1::SetBounds {
                element_type, id, ..
            }
            | EditorOpV1::DeleteElement { element_type, id } => (*element_type, id),
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
