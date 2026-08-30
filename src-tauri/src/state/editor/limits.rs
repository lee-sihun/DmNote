use super::*;

pub(super) fn validate_metric_limits(
    current: &EditorDocumentV1,
    candidate: &EditorDocumentV1,
    keying: GrandfatherKeying,
) -> Result<(), EditorCommitError> {
    validate_aggregate_metric_limits(current, candidate)?;
    validate_mode_metric_limits(current, candidate)?;
    validate_per_owner_metric_limits(current, candidate, keying)
}

fn validate_aggregate_metric_limits(
    current: &EditorDocumentV1,
    candidate: &EditorDocumentV1,
) -> Result<(), EditorCommitError> {
    validate_count_limit(
        "TOO_MANY_MODES",
        "editor mode count",
        editor_modes(current).len(),
        editor_modes(candidate).len(),
        MAX_MODES,
    )?;

    validate_collection_limits("keys", &current.keys, &candidate.keys)?;
    validate_key_member_fanout(&current.keys, &candidate.keys)?;
    validate_collection_limits(
        "keyPositions",
        &current.key_positions,
        &candidate.key_positions,
    )?;
    validate_collection_limits(
        "statPositions",
        &current.stat_positions,
        &candidate.stat_positions,
    )?;
    validate_collection_limits(
        "graphPositions",
        &current.graph_positions,
        &candidate.graph_positions,
    )?;
    validate_collection_limits(
        "knobPositions",
        &current.knob_positions,
        &candidate.knob_positions,
    )?;
    validate_collection_limits(
        "layerGroups",
        &current.layer_groups,
        &candidate.layer_groups,
    )?;

    validate_count_limit(
        "TOO_MANY_RENDER_ITEMS",
        "render item count",
        render_item_count(current),
        render_item_count(candidate),
        MAX_RENDER_ITEMS,
    )?;
    validate_count_limit(
        "TOO_MANY_LAYER_GROUPS",
        "layer group count",
        current.layer_groups.values().map(Vec::len).sum(),
        candidate.layer_groups.values().map(Vec::len).sum(),
        MAX_LAYER_GROUPS,
    )?;

    Ok(())
}

fn validate_mode_metric_limits(
    current: &EditorDocumentV1,
    candidate: &EditorDocumentV1,
) -> Result<(), EditorCommitError> {
    let current_modes = editor_modes(current);
    for mode in editor_modes(candidate) {
        let current_len = current_modes
            .get(&mode)
            .map_or(0, |current_mode| current_mode.len());
        validate_count_limit(
            "MODE_ID_TOO_LONG",
            &format!("mode id '{mode}' byte length"),
            current_len,
            mode.len(),
            MAX_MODE_ID_BYTES,
        )?;
    }

    Ok(())
}

// keying에 따라 관용 상대를 찾는다. StableId는 안정 ID로, ModeIndex는 같은
// 모드의 같은 자리로 짝짓는다
fn grandfather_counterpart<'a, T>(
    keying: GrandfatherKeying,
    by_id: &HashMap<&str, &'a T>,
    current_collection: &'a HashMap<String, Vec<T>>,
    mode: &str,
    index: usize,
    id: &str,
    position_of: impl Fn(&'a T) -> &'a KeyPosition,
) -> Option<&'a KeyPosition> {
    match keying {
        GrandfatherKeying::StableId => by_id.get(id).map(|element| position_of(element)),
        #[cfg(test)]
        GrandfatherKeying::ModeIndex => current_collection
            .get(mode)
            .and_then(|elements| elements.get(index))
            .map(position_of),
        GrandfatherKeying::LegacyPresetModeIndex => current_collection
            .get(mode)
            .and_then(|elements| elements.get(index))
            .map(position_of),
    }
}

fn validate_per_owner_metric_limits(
    current: &EditorDocumentV1,
    candidate: &EditorDocumentV1,
    keying: GrandfatherKeying,
) -> Result<(), EditorCommitError> {
    let mut current_key_slots = HashMap::new();
    for (mode, positions) in &current.key_positions {
        let Some(slots) = current.keys.get(mode) else {
            continue;
        };
        for (position, slot) in positions.iter().zip(slots) {
            current_key_slots.insert(position.id.as_str(), slot);
        }
    }

    for (mode, keys) in &candidate.keys {
        for (slot_index, slot) in keys.iter().enumerate() {
            let current_slot = match keying {
                GrandfatherKeying::StableId => candidate
                    .key_positions
                    .get(mode)
                    .and_then(|positions| positions.get(slot_index))
                    .and_then(|position| current_key_slots.get(position.id.as_str()))
                    .copied(),
                #[cfg(test)]
                GrandfatherKeying::ModeIndex => current
                    .keys
                    .get(mode)
                    .and_then(|slots| slots.get(slot_index)),
                GrandfatherKeying::LegacyPresetModeIndex => current
                    .keys
                    .get(mode)
                    .and_then(|slots| slots.get(slot_index)),
            };
            validate_key_slot_label_limits(mode, slot_index, current_slot, slot)?;
        }
    }

    let current_groups = current
        .layer_groups
        .iter()
        .flat_map(|(mode, groups)| {
            groups
                .iter()
                .map(move |group| ((mode.as_str(), group.id.as_str()), group))
        })
        .collect::<HashMap<_, _>>();
    for (mode, groups) in &candidate.layer_groups {
        for (index, group) in groups.iter().enumerate() {
            let current_group = current_groups
                .get(&(mode.as_str(), group.id.as_str()))
                .copied();
            validate_count_limit(
                "GROUP_ID_TOO_LONG",
                &format!("layer group id {mode}[{index}] byte length"),
                current_group.map_or(0, |group| group.id.len()),
                group.id.len(),
                MAX_GROUP_ID_BYTES,
            )?;
            validate_count_limit(
                "GROUP_NAME_TOO_LONG",
                &format!("layer group name {mode}[{index}] byte length"),
                current_group.map_or(0, |group| group.name.len()),
                group.name.len(),
                MAX_GROUP_NAME_BYTES,
            )?;
        }
    }

    let current_key_positions = current
        .key_positions
        .values()
        .flatten()
        .map(|position| (position.id.as_str(), position))
        .collect::<HashMap<_, _>>();
    for (mode, positions) in &candidate.key_positions {
        for (index, position) in positions.iter().enumerate() {
            validate_position_metrics(
                "keyPositions",
                mode,
                index,
                grandfather_counterpart(
                    keying,
                    &current_key_positions,
                    &current.key_positions,
                    mode,
                    index,
                    &position.id,
                    |position| position,
                ),
                position,
                keying == GrandfatherKeying::LegacyPresetModeIndex,
            )?;
        }
    }

    let current_stat_positions = current
        .stat_positions
        .values()
        .flatten()
        .map(|position| (position.position.id.as_str(), position))
        .collect::<HashMap<_, _>>();
    for (mode, positions) in &candidate.stat_positions {
        for (index, position) in positions.iter().enumerate() {
            validate_position_metrics(
                "statPositions",
                mode,
                index,
                grandfather_counterpart(
                    keying,
                    &current_stat_positions,
                    &current.stat_positions,
                    mode,
                    index,
                    &position.position.id,
                    |element| &element.position,
                ),
                &position.position,
                keying == GrandfatherKeying::LegacyPresetModeIndex,
            )?;
        }
    }

    let current_graph_positions = current
        .graph_positions
        .values()
        .flatten()
        .map(|position| (position.position.id.as_str(), position))
        .collect::<HashMap<_, _>>();
    for (mode, positions) in &candidate.graph_positions {
        for (index, position) in positions.iter().enumerate() {
            validate_position_metrics(
                "graphPositions",
                mode,
                index,
                grandfather_counterpart(
                    keying,
                    &current_graph_positions,
                    &current.graph_positions,
                    mode,
                    index,
                    &position.position.id,
                    |element| &element.position,
                ),
                &position.position,
                keying == GrandfatherKeying::LegacyPresetModeIndex,
            )?;
        }
    }

    let current_knob_positions = current
        .knob_positions
        .values()
        .flatten()
        .map(|position| (position.position.id.as_str(), position))
        .collect::<HashMap<_, _>>();
    for (mode, positions) in &candidate.knob_positions {
        for (index, position) in positions.iter().enumerate() {
            validate_position_metrics(
                "knobPositions",
                mode,
                index,
                grandfather_counterpart(
                    keying,
                    &current_knob_positions,
                    &current.knob_positions,
                    mode,
                    index,
                    &position.position.id,
                    |element| &element.position,
                ),
                &position.position,
                keying == GrandfatherKeying::LegacyPresetModeIndex,
            )?;
        }
    }

    Ok(())
}

fn validate_key_slot_label_limits(
    mode: &str,
    slot_index: usize,
    current: Option<&KeySlot>,
    candidate: &KeySlot,
) -> Result<(), EditorCommitError> {
    let mut grandfathered_lengths = current
        .into_iter()
        .flat_map(KeySlot::members)
        .map(String::len)
        .filter(|length| *length > MAX_KEY_LABEL_BYTES)
        .collect::<Vec<_>>();
    grandfathered_lengths.sort_unstable();

    for (member_index, member) in candidate.members().enumerate() {
        if member.len() <= MAX_KEY_LABEL_BYTES {
            continue;
        }
        let Some(budget_index) = grandfathered_lengths
            .iter()
            .position(|length| member.len() <= *length)
        else {
            return Err(EditorCommitError::validation(
                "KEY_LABEL_TOO_LONG",
                format!(
                    "key label {mode}[{slot_index}].members[{member_index}] byte length exceeds {MAX_KEY_LABEL_BYTES} and has no matching stored allowance"
                ),
            ));
        };
        grandfathered_lengths.remove(budget_index);
    }

    Ok(())
}

fn editor_modes(document: &EditorDocumentV1) -> BTreeSet<String> {
    document
        .keys
        .keys()
        .chain(document.key_positions.keys())
        .chain(document.stat_positions.keys())
        .chain(document.graph_positions.keys())
        .chain(document.knob_positions.keys())
        .chain(document.layer_groups.keys())
        .cloned()
        .collect()
}

fn render_item_count(document: &EditorDocumentV1) -> usize {
    document.key_positions.values().map(Vec::len).sum::<usize>()
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
}

fn validate_collection_limits<T>(
    field: &str,
    current: &HashMap<String, Vec<T>>,
    candidate: &HashMap<String, Vec<T>>,
) -> Result<(), EditorCommitError> {
    for (mode, values) in candidate {
        validate_count_limit(
            "COLLECTION_TOO_LARGE",
            &format!("{field} mode '{mode}' item count"),
            current.get(mode).map_or(0, Vec::len),
            values.len(),
            MAX_ITEMS_PER_MODE,
        )?;
    }
    Ok(())
}

fn validate_key_member_fanout(
    current: &KeyMappings,
    candidate: &KeyMappings,
) -> Result<(), EditorCommitError> {
    for (mode, slots) in candidate {
        let current_counts = current
            .get(mode)
            .map(|slots| member_slot_counts(slots))
            .unwrap_or_default();
        for (member, count) in member_slot_counts(slots) {
            validate_count_limit(
                "TOO_MANY_SLOTS_PER_MEMBER",
                &format!("key member '{member}' slot count in mode '{mode}'"),
                current_counts.get(&member).copied().unwrap_or_default(),
                count,
                MAX_SLOTS_PER_MEMBER,
            )?;
        }
    }
    Ok(())
}

fn member_slot_counts(slots: &[KeySlot]) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for member in slots
        .iter()
        .flat_map(KeySlot::members)
        .filter(|member| !member.is_empty())
    {
        *counts.entry(member.clone()).or_default() += 1;
    }
    counts
}

fn validate_count_limit(
    code: &'static str,
    label: &str,
    current: usize,
    candidate: usize,
    limit: usize,
) -> Result<(), EditorCommitError> {
    if candidate <= limit || (current > limit && candidate <= current) {
        return Ok(());
    }
    Err(EditorCommitError::validation(
        code,
        format!("{label} exceeds {limit} and increases the stored metric"),
    ))
}

fn validate_position_metrics(
    field: &str,
    mode: &str,
    index: usize,
    current: Option<&KeyPosition>,
    candidate: &KeyPosition,
    allow_legacy_finite_bounds: bool,
) -> Result<(), EditorCommitError> {
    validate_bounds_metrics(
        &format!("{field} {mode}[{index}]"),
        current.map(position_bounds),
        position_bounds(candidate),
        allow_legacy_finite_bounds,
    )
}

pub(super) fn position_bounds(position: &KeyPosition) -> EditorBoundsV1 {
    EditorBoundsV1 {
        dx: position.dx,
        dy: position.dy,
        width: position.width,
        height: position.height,
    }
}

pub(crate) fn validate_editor_op_bounds(
    op_index: usize,
    current: Option<&KeyPosition>,
    bounds: EditorBoundsV1,
) -> Result<(), EditorCommitError> {
    validate_bounds_metrics(
        &format!("editor op {op_index}.bounds"),
        current.map(position_bounds),
        bounds,
        false,
    )
}

pub(crate) fn validate_editor_op_target_type(
    op_index: usize,
    requested: EditorElementTypeV1,
    actual: EditorElementTypeV1,
) -> Result<(), EditorCommitError> {
    if requested == actual {
        return Ok(());
    }
    Err(EditorCommitError::validation(
        "ELEMENT_TYPE_MISMATCH",
        format!("editor op {op_index} targets a {actual:?} element as {requested:?}"),
    ))
}

fn validate_bounds_metrics(
    label: &str,
    current: Option<EditorBoundsV1>,
    candidate: EditorBoundsV1,
    allow_legacy_finite_bounds: bool,
) -> Result<(), EditorCommitError> {
    for (name, current, candidate) in [
        ("dx", current.map(|bounds| bounds.dx), candidate.dx),
        ("dy", current.map(|bounds| bounds.dy), candidate.dy),
    ] {
        if (allow_legacy_finite_bounds && candidate.is_finite())
            || coordinate_within_limit(candidate)
            || current.is_some_and(|value| {
                !coordinate_within_limit(value)
                    && numeric_metric_non_increasing(value, candidate, false)
            })
        {
            continue;
        }
        return Err(EditorCommitError::validation(
            "COORDINATE_OUT_OF_RANGE",
            format!("{label}.{name} exceeds ±{MAX_ABS_COORDINATE}"),
        ));
    }

    for (name, current, candidate) in [
        ("width", current.map(|bounds| bounds.width), candidate.width),
        (
            "height",
            current.map(|bounds| bounds.height),
            candidate.height,
        ),
    ] {
        // 과거 프리셋의 범위 초과 치수는 관용하되 0·음수는 어떤 경로로도 허용하지 않는다
        if (allow_legacy_finite_bounds && candidate.is_finite() && candidate > 0.0)
            || dimension_within_limit(candidate)
            || current.is_some_and(|value| {
                !dimension_within_limit(value)
                    && numeric_metric_non_increasing(value, candidate, true)
            })
        {
            continue;
        }
        return Err(EditorCommitError::validation(
            "DIMENSION_OUT_OF_RANGE",
            format!("{label}.{name} must satisfy 0 < value <= {MAX_DIMENSION}"),
        ));
    }
    Ok(())
}

fn coordinate_within_limit(value: f64) -> bool {
    value.is_finite() && value.abs() <= MAX_ABS_COORDINATE
}

fn dimension_within_limit(value: f64) -> bool {
    value.is_finite() && value > 0.0 && value <= MAX_DIMENSION
}

fn numeric_metric_non_increasing(current: f64, candidate: f64, dimension: bool) -> bool {
    if !current.is_finite() || !candidate.is_finite() {
        return current.to_bits() == candidate.to_bits();
    }
    if dimension && (current <= 0.0 || candidate <= 0.0) {
        return current.to_bits() == candidate.to_bits();
    }
    if dimension {
        candidate <= current
    } else {
        candidate.abs() <= current.abs()
    }
}
