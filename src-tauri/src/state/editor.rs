use std::collections::{BTreeSet, HashMap, HashSet};

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    defaults::default_keys,
    errors::EditorCommitError,
    models::{
        AppStoreData, CustomTab, EditorCommitRequest, EditorDocumentV1, EditorField,
        ElementShadowSpec, KeyCounters, KeyMappings, KeyPosition, EDITOR_SCHEMA_VERSION,
    },
};

pub(crate) const MAX_SAFE_EDITOR_REVISION: u64 = 9_007_199_254_740_991;
pub(crate) const MUTATION_ACK_CAPACITY: usize = 32;
pub(crate) const MAX_CUSTOM_TABS: usize = 30;

const MAX_MUTATION_ID_BYTES: usize = 64;
const MAX_GESTURE_ID_BYTES: usize = 64;
const MAX_MODE_ID_BYTES: usize = 128;
const MAX_MODES: usize = 64;
const MAX_ITEMS_PER_MODE: usize = 512;
const MAX_RENDER_ITEMS: usize = 4_096;
const MAX_LAYER_GROUPS: usize = 4_096;
const MAX_KEY_LABEL_BYTES: usize = 1_024;
const MAX_GROUP_ID_BYTES: usize = 256;
const MAX_GROUP_NAME_BYTES: usize = 1_024;
const MAX_ABS_COORDINATE: f64 = 32_768.0;
const MAX_DIMENSION: f64 = 32_768.0;
use crate::models::{
    SHADOW_BLUR_MAX as MAX_SHADOW_BLUR, SHADOW_BLUR_MIN as MIN_SHADOW_BLUR,
    SHADOW_OFFSET_MAX as MAX_SHADOW_OFFSET, SHADOW_OFFSET_MIN as MIN_SHADOW_OFFSET,
};
const REQUEST_WARNING_BYTES: usize = 1_024 * 1_024;
const MAX_REQUEST_BYTES: usize = 8 * 1_024 * 1_024;

pub(crate) type RequestFingerprint = [u8; 32];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FingerprintPayload<'a> {
    base_revision: u64,
    gesture_id: Option<&'a str>,
    changes: &'a crate::models::EditorPatchV1,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct ValidationViolation {
    identity: String,
    code: &'static str,
    message: String,
}

impl ValidationViolation {
    fn new(identity: impl Into<String>, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            identity: identity.into(),
            code,
            message: message.into(),
        }
    }
}

pub(crate) fn validate_request_envelope(
    request: &EditorCommitRequest,
) -> Result<(), EditorCommitError> {
    validate_revision(request.base_revision)?;

    if request.changes.schema_version != EDITOR_SCHEMA_VERSION {
        return Err(EditorCommitError::validation(
            "UNSUPPORTED_SCHEMA_VERSION",
            format!(
                "unsupported editor schema version {}",
                request.changes.schema_version
            ),
        ));
    }

    if request.mutation_id.len() > MAX_MUTATION_ID_BYTES
        || Uuid::parse_str(&request.mutation_id).is_err()
    {
        return Err(EditorCommitError::validation(
            "INVALID_MUTATION_ID",
            "mutationId must be a UUID no longer than 64 bytes",
        ));
    }

    if request
        .gesture_id
        .as_ref()
        .is_some_and(|gesture_id| gesture_id.len() > MAX_GESTURE_ID_BYTES)
    {
        return Err(EditorCommitError::validation(
            "INVALID_GESTURE_ID",
            "gestureId must be no longer than 64 bytes",
        ));
    }

    Ok(())
}

pub(crate) fn validate_revision(revision: u64) -> Result<(), EditorCommitError> {
    if revision > MAX_SAFE_EDITOR_REVISION {
        return Err(EditorCommitError::validation(
            "REVISION_OUT_OF_RANGE",
            "editor revision exceeds JavaScript's safe integer range",
        ));
    }
    Ok(())
}

pub(crate) fn next_revision(current: u64) -> Result<u64, EditorCommitError> {
    validate_revision(current)?;
    current
        .checked_add(1)
        .filter(|revision| *revision <= MAX_SAFE_EDITOR_REVISION)
        .ok_or_else(|| {
            EditorCommitError::validation(
                "REVISION_OUT_OF_RANGE",
                "editor revision cannot be incremented safely",
            )
        })
}

pub(crate) fn validate_history_restore_metadata(
    document: &EditorDocumentV1,
    custom_tabs: &[CustomTab],
    selected_key_type: &str,
) -> Result<(), EditorCommitError> {
    if custom_tabs.len() > MAX_CUSTOM_TABS {
        return Err(EditorCommitError::validation(
            "TOO_MANY_CUSTOM_TABS",
            format!("custom tab count exceeds {MAX_CUSTOM_TABS}"),
        ));
    }

    let built_in_modes = default_keys();
    let mut ids = HashSet::with_capacity(custom_tabs.len());
    let mut names = HashSet::with_capacity(custom_tabs.len());
    for tab in custom_tabs {
        let id = tab.id.trim();
        let name = tab.name.trim();
        if id.is_empty() || id.len() > MAX_MODE_ID_BYTES {
            return Err(EditorCommitError::validation(
                "INVALID_CUSTOM_TAB_ID",
                "custom tab id is empty or too long",
            ));
        }
        if name.is_empty() || name.len() > MAX_GROUP_NAME_BYTES {
            return Err(EditorCommitError::validation(
                "INVALID_CUSTOM_TAB_NAME",
                "custom tab name is empty or too long",
            ));
        }
        if built_in_modes.contains_key(id) || !ids.insert(id.to_string()) {
            return Err(EditorCommitError::validation(
                "DUPLICATE_CUSTOM_TAB_ID",
                format!("custom tab id '{id}' is duplicated or reserved"),
            ));
        }
        if !names.insert(name.to_string()) {
            return Err(EditorCommitError::validation(
                "DUPLICATE_CUSTOM_TAB_NAME",
                format!("custom tab name '{name}' is duplicated"),
            ));
        }
        if !document.keys.contains_key(id) || !document.key_positions.contains_key(id) {
            return Err(EditorCommitError::validation(
                "CUSTOM_TAB_DOCUMENT_MISSING",
                format!("custom tab '{id}' has no paired editor collections"),
            ));
        }
    }

    for mode in document.keys.keys() {
        if !built_in_modes.contains_key(mode) && !ids.contains(mode) {
            return Err(EditorCommitError::validation(
                "CUSTOM_TAB_METADATA_MISSING",
                format!("editor mode '{mode}' has no custom tab metadata"),
            ));
        }
    }

    let selected_is_valid =
        built_in_modes.contains_key(selected_key_type) || ids.contains(selected_key_type);
    if !selected_is_valid || !document.keys.contains_key(selected_key_type) {
        return Err(EditorCommitError::validation(
            "INVALID_SELECTED_MODE",
            format!("selected mode '{selected_key_type}' is not restorable"),
        ));
    }

    Ok(())
}

pub(crate) fn request_fingerprint(
    request: &EditorCommitRequest,
) -> Result<RequestFingerprint, EditorCommitError> {
    let value = serde_json::to_value(FingerprintPayload {
        base_revision: request.base_revision,
        gesture_id: request.gesture_id.as_deref(),
        changes: &request.changes,
    })
    .map_err(|error| {
        EditorCommitError::validation(
            "INVALID_REQUEST_PAYLOAD",
            format!("failed to serialize editor request: {error}"),
        )
    })?;

    let mut canonical = Vec::new();
    write_canonical_json(&value, &mut canonical).map_err(|error| {
        EditorCommitError::validation(
            "INVALID_REQUEST_PAYLOAD",
            format!("failed to canonicalize editor request: {error}"),
        )
    })?;

    Ok(Sha256::digest(canonical).into())
}

pub(crate) fn request_payload_size(
    request: &EditorCommitRequest,
) -> Result<usize, EditorCommitError> {
    let compact_size = serde_json::to_vec(request)
        .map_err(|error| {
            EditorCommitError::validation(
                "INVALID_REQUEST_PAYLOAD",
                format!("failed to serialize editor request: {error}"),
            )
        })?
        .len();
    if compact_size > MAX_REQUEST_BYTES {
        return Err(EditorCommitError::validation(
            "REQUEST_TOO_LARGE",
            format!("editor request exceeds the {MAX_REQUEST_BYTES} byte limit"),
        ));
    }
    if compact_size >= REQUEST_WARNING_BYTES {
        log::warn!("[Editor] Large editor request: {compact_size} compact bytes");
    }
    Ok(compact_size)
}

fn write_canonical_json(value: &Value, output: &mut Vec<u8>) -> serde_json::Result<()> {
    match value {
        Value::Null => output.extend_from_slice(b"null"),
        Value::Bool(value) => output.extend_from_slice(if *value { b"true" } else { b"false" }),
        Value::Number(value) => output.extend_from_slice(value.to_string().as_bytes()),
        Value::String(value) => output.extend_from_slice(serde_json::to_string(value)?.as_bytes()),
        Value::Array(values) => {
            output.push(b'[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    output.push(b',');
                }
                write_canonical_json(value, output)?;
            }
            output.push(b']');
        }
        Value::Object(values) => {
            output.push(b'{');
            let mut entries = values.iter().collect::<Vec<_>>();
            entries.sort_unstable_by_key(|(key, _)| *key);
            for (index, (key, value)) in entries.into_iter().enumerate() {
                if index > 0 {
                    output.push(b',');
                }
                output.extend_from_slice(serde_json::to_string(key)?.as_bytes());
                output.push(b':');
                write_canonical_json(value, output)?;
            }
            output.push(b'}');
        }
    }
    Ok(())
}

pub(crate) fn validate_paired_update(
    current: &EditorDocumentV1,
    candidate: &EditorDocumentV1,
    keys_touched: bool,
    key_positions_touched: bool,
) -> Result<(), EditorCommitError> {
    if keys_touched
        && !key_positions_touched
        && collection_shape(&current.keys) != collection_shape(&candidate.keys)
    {
        return Err(EditorCommitError::paired_update_required("keyPositions"));
    }

    if key_positions_touched
        && !keys_touched
        && collection_shape(&current.key_positions) != collection_shape(&candidate.key_positions)
    {
        return Err(EditorCommitError::paired_update_required("keys"));
    }

    Ok(())
}

fn collection_shape<T>(collection: &HashMap<String, Vec<T>>) -> Vec<(String, usize)> {
    let mut shape = collection
        .iter()
        .map(|(mode, values)| (mode.clone(), values.len()))
        .collect::<Vec<_>>();
    shape.sort_unstable();
    shape
}

/// 기존 store에 있던 손실 없는 비정상 데이터는 유지하되 새 비정상 상태는 만들지 않음
pub(crate) fn validate_document_transition(
    current: &EditorDocumentV1,
    candidate: &EditorDocumentV1,
    current_store: &AppStoreData,
    candidate_store: &AppStoreData,
) -> Result<(), EditorCommitError> {
    if candidate.schema_version != EDITOR_SCHEMA_VERSION {
        return Err(EditorCommitError::validation(
            "UNSUPPORTED_SCHEMA_VERSION",
            format!(
                "unsupported editor schema version {}",
                candidate.schema_version
            ),
        ));
    }

    let current_violations = collect_violations(current, &allowed_modes(current_store));
    let candidate_violations = collect_violations(candidate, &allowed_modes(candidate_store));
    validate_metric_limits(current, candidate)?;

    if let Some(violation) = candidate_violations.iter().find(|violation| {
        is_unconditional_structural_violation(violation.code)
            || !current_violations.contains(*violation)
    }) {
        return Err(EditorCommitError::validation(
            violation.code,
            violation.message.clone(),
        ));
    }

    Ok(())
}

fn is_unconditional_structural_violation(code: &str) -> bool {
    matches!(
        code,
        "KEY_POSITION_MODE_MISMATCH"
            | "KEY_POSITION_LENGTH_MISMATCH"
            | "DUPLICATE_GROUP_ID"
            | "UNKNOWN_GROUP_ID"
    )
}

fn allowed_modes(store: &AppStoreData) -> HashSet<String> {
    default_keys()
        .keys()
        .cloned()
        .chain(store.custom_tabs.iter().map(|tab| tab.id.clone()))
        .collect()
}

fn collect_violations(
    document: &EditorDocumentV1,
    allowed_modes: &HashSet<String>,
) -> BTreeSet<ValidationViolation> {
    let mut violations = BTreeSet::new();
    let all_modes = document
        .keys
        .keys()
        .chain(document.key_positions.keys())
        .chain(document.stat_positions.keys())
        .chain(document.graph_positions.keys())
        .chain(document.knob_positions.keys())
        .chain(document.layer_groups.keys())
        .cloned()
        .collect::<BTreeSet<_>>();

    for mode in &all_modes {
        if mode.is_empty() {
            violations.insert(ValidationViolation::new(
                format!("invalid-mode-id:{mode:?}"),
                "INVALID_MODE_ID",
                "mode id is empty",
            ));
        }
    }

    collect_collection_violations("keys", &document.keys, allowed_modes, &mut violations);
    collect_collection_violations(
        "keyPositions",
        &document.key_positions,
        allowed_modes,
        &mut violations,
    );
    collect_collection_violations(
        "statPositions",
        &document.stat_positions,
        allowed_modes,
        &mut violations,
    );
    collect_collection_violations(
        "graphPositions",
        &document.graph_positions,
        allowed_modes,
        &mut violations,
    );
    collect_collection_violations(
        "knobPositions",
        &document.knob_positions,
        allowed_modes,
        &mut violations,
    );
    collect_collection_violations(
        "layerGroups",
        &document.layer_groups,
        allowed_modes,
        &mut violations,
    );

    for mode in document.keys.keys().chain(document.key_positions.keys()) {
        let keys = document.keys.get(mode);
        let positions = document.key_positions.get(mode);
        if keys.is_some() != positions.is_some() {
            violations.insert(ValidationViolation::new(
                format!(
                    "paired-mode:{mode}:{}:{}",
                    keys.is_some(),
                    positions.is_some()
                ),
                "KEY_POSITION_MODE_MISMATCH",
                format!("keys and keyPositions must contain the same mode '{mode}'"),
            ));
        }

        let key_count = keys.map_or(0, Vec::len);
        let position_count = positions.map_or(0, Vec::len);
        if key_count != position_count {
            violations.insert(ValidationViolation::new(
                format!("paired-length:{mode}:{key_count}:{position_count}"),
                "KEY_POSITION_LENGTH_MISMATCH",
                format!("keys and keyPositions for mode '{mode}' have different lengths"),
            ));
        }
    }

    for (mode, positions) in &document.knob_positions {
        for (index, position) in positions.iter().enumerate() {
            if !position.sensitivity.is_finite() {
                violations.insert(ValidationViolation::new(
                    format!(
                        "knob-sensitivity:{mode}:{index}:{}",
                        position.sensitivity.to_bits()
                    ),
                    "INVALID_NUMBER",
                    format!("knob sensitivity at {mode}[{index}] is invalid"),
                ));
            }
        }
    }

    collect_position_style_violations(document, &mut violations);
    let group_ids = collect_group_violations(document, &mut violations);
    collect_group_reference_violations(document, &group_ids, &mut violations);
    violations
}

fn collect_position_style_violations(
    document: &EditorDocumentV1,
    violations: &mut BTreeSet<ValidationViolation>,
) {
    for (field, mode, index, position) in document
        .key_positions
        .iter()
        .flat_map(|(mode, positions)| {
            positions
                .iter()
                .enumerate()
                .map(move |(index, position)| ("keyPositions", mode, index, position))
        })
        .chain(
            document
                .stat_positions
                .iter()
                .flat_map(|(mode, positions)| {
                    positions.iter().enumerate().map(move |(index, position)| {
                        ("statPositions", mode, index, &position.position)
                    })
                }),
        )
        .chain(
            document
                .graph_positions
                .iter()
                .flat_map(|(mode, positions)| {
                    positions.iter().enumerate().map(move |(index, position)| {
                        ("graphPositions", mode, index, &position.position)
                    })
                }),
        )
        .chain(
            document
                .knob_positions
                .iter()
                .flat_map(|(mode, positions)| {
                    positions.iter().enumerate().map(move |(index, position)| {
                        ("knobPositions", mode, index, &position.position)
                    })
                }),
        )
    {
        for (name, shadow) in [
            ("shadow", position.shadow.as_ref()),
            ("activeShadow", position.active_shadow.as_ref()),
        ] {
            if let Some(shadow) = shadow {
                collect_shadow_violations(field, mode, index, name, shadow, violations);
            }
        }
    }
}

fn collect_shadow_violations(
    field: &str,
    mode: &str,
    index: usize,
    name: &str,
    shadow: &ElementShadowSpec,
    violations: &mut BTreeSet<ValidationViolation>,
) {
    if shadow.color.is_empty() {
        violations.insert(ValidationViolation::new(
            format!("element-shadow:{field}:{mode}:{index}:{name}:color-empty"),
            "INVALID_ELEMENT_SHADOW",
            format!("{field} {mode}[{index}].{name}.color must be a non-empty string"),
        ));
    }
    for (property, value) in [("offsetX", shadow.offset_x), ("offsetY", shadow.offset_y)] {
        if !value.is_finite() || !(MIN_SHADOW_OFFSET..=MAX_SHADOW_OFFSET).contains(&value) {
            violations.insert(ValidationViolation::new(
                format!(
                    "element-shadow:{field}:{mode}:{index}:{name}:{property}:{}",
                    value.to_bits()
                ),
                "INVALID_ELEMENT_SHADOW",
                format!(
                    "{field} {mode}[{index}].{name}.{property} must be a finite number between {MIN_SHADOW_OFFSET} and {MAX_SHADOW_OFFSET}"
                ),
            ));
        }
    }
    if !shadow.blur.is_finite() || !(MIN_SHADOW_BLUR..=MAX_SHADOW_BLUR).contains(&shadow.blur) {
        violations.insert(ValidationViolation::new(
            format!(
                "element-shadow:{field}:{mode}:{index}:{name}:blur:{}",
                shadow.blur.to_bits()
            ),
            "INVALID_ELEMENT_SHADOW",
            format!(
                "{field} {mode}[{index}].{name}.blur must be a finite number between {MIN_SHADOW_BLUR} and {MAX_SHADOW_BLUR}"
            ),
        ));
    }
}

fn collect_collection_violations<T>(
    field: &'static str,
    collection: &HashMap<String, Vec<T>>,
    allowed_modes: &HashSet<String>,
    violations: &mut BTreeSet<ValidationViolation>,
) {
    for (mode, values) in collection {
        if !allowed_modes.contains(mode) {
            violations.insert(ValidationViolation::new(
                format!("unknown-mode:{field}:{mode}"),
                "UNKNOWN_MODE",
                format!("{field} contains unknown mode '{mode}'"),
            ));
        }
        let _ = values;
    }
}

fn validate_metric_limits(
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

    for mode in editor_modes(candidate) {
        let current_len = editor_modes(current)
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

    for (mode, keys) in &candidate.keys {
        for (index, key) in keys.iter().enumerate() {
            let current_len = current
                .keys
                .get(mode)
                .and_then(|values| values.get(index))
                .map_or(0, String::len);
            validate_count_limit(
                "KEY_LABEL_TOO_LONG",
                &format!("key label {mode}[{index}] byte length"),
                current_len,
                key.len(),
                MAX_KEY_LABEL_BYTES,
            )?;
        }
    }

    for (mode, groups) in &candidate.layer_groups {
        for (index, group) in groups.iter().enumerate() {
            let current_group = current
                .layer_groups
                .get(mode)
                .and_then(|values| values.get(index));
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

    for (mode, positions) in &candidate.key_positions {
        for (index, position) in positions.iter().enumerate() {
            validate_position_metrics(
                "keyPositions",
                mode,
                index,
                current
                    .key_positions
                    .get(mode)
                    .and_then(|values| values.get(index)),
                position,
            )?;
        }
    }
    for (mode, positions) in &candidate.stat_positions {
        for (index, position) in positions.iter().enumerate() {
            validate_position_metrics(
                "statPositions",
                mode,
                index,
                current
                    .stat_positions
                    .get(mode)
                    .and_then(|values| values.get(index))
                    .map(|position| &position.position),
                &position.position,
            )?;
        }
    }
    for (mode, positions) in &candidate.graph_positions {
        for (index, position) in positions.iter().enumerate() {
            validate_position_metrics(
                "graphPositions",
                mode,
                index,
                current
                    .graph_positions
                    .get(mode)
                    .and_then(|values| values.get(index))
                    .map(|position| &position.position),
                &position.position,
            )?;
        }
    }
    for (mode, positions) in &candidate.knob_positions {
        for (index, position) in positions.iter().enumerate() {
            validate_position_metrics(
                "knobPositions",
                mode,
                index,
                current
                    .knob_positions
                    .get(mode)
                    .and_then(|values| values.get(index))
                    .map(|position| &position.position),
                &position.position,
            )?;
        }
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
) -> Result<(), EditorCommitError> {
    for (name, current, candidate) in [
        ("dx", current.map(|position| position.dx), candidate.dx),
        ("dy", current.map(|position| position.dy), candidate.dy),
    ] {
        if coordinate_within_limit(candidate)
            || current.is_some_and(|value| {
                !coordinate_within_limit(value)
                    && numeric_metric_non_increasing(value, candidate, false)
            })
        {
            continue;
        }
        return Err(EditorCommitError::validation(
            "COORDINATE_OUT_OF_RANGE",
            format!("{field} {mode}[{index}].{name} exceeds ±{MAX_ABS_COORDINATE}"),
        ));
    }

    for (name, current, candidate) in [
        (
            "width",
            current.map(|position| position.width),
            candidate.width,
        ),
        (
            "height",
            current.map(|position| position.height),
            candidate.height,
        ),
    ] {
        if dimension_within_limit(candidate)
            || current.is_some_and(|value| {
                !dimension_within_limit(value)
                    && numeric_metric_non_increasing(value, candidate, true)
            })
        {
            continue;
        }
        return Err(EditorCommitError::validation(
            "DIMENSION_OUT_OF_RANGE",
            format!("{field} {mode}[{index}].{name} must satisfy 0 < value <= {MAX_DIMENSION}"),
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

fn collect_group_violations(
    document: &EditorDocumentV1,
    violations: &mut BTreeSet<ValidationViolation>,
) -> HashMap<String, HashSet<String>> {
    let mut result = HashMap::new();
    for (mode, groups) in &document.layer_groups {
        let mut ids = HashSet::new();
        for (index, group) in groups.iter().enumerate() {
            if group.id.is_empty() {
                violations.insert(ValidationViolation::new(
                    format!("group-id:{mode}:{index}:{:?}", group.id),
                    "INVALID_GROUP_ID",
                    format!("layer group id at {mode}[{index}] is empty"),
                ));
            }
            if !ids.insert(group.id.clone()) {
                violations.insert(ValidationViolation::new(
                    format!("duplicate-group:{mode}:{}", group.id),
                    "DUPLICATE_GROUP_ID",
                    format!(
                        "layer group id '{}' is duplicated in mode '{mode}'",
                        group.id
                    ),
                ));
            }
        }
        result.insert(mode.clone(), ids);
    }
    result
}

fn collect_group_reference_violations(
    document: &EditorDocumentV1,
    group_ids: &HashMap<String, HashSet<String>>,
    violations: &mut BTreeSet<ValidationViolation>,
) {
    for (field, mode, index, position) in document
        .key_positions
        .iter()
        .flat_map(|(mode, positions)| {
            positions
                .iter()
                .enumerate()
                .map(move |(index, position)| ("keyPositions", mode, index, position))
        })
        .chain(
            document
                .stat_positions
                .iter()
                .flat_map(|(mode, positions)| {
                    positions.iter().enumerate().map(move |(index, position)| {
                        ("statPositions", mode, index, &position.position)
                    })
                }),
        )
        .chain(
            document
                .graph_positions
                .iter()
                .flat_map(|(mode, positions)| {
                    positions.iter().enumerate().map(move |(index, position)| {
                        ("graphPositions", mode, index, &position.position)
                    })
                }),
        )
        .chain(
            document
                .knob_positions
                .iter()
                .flat_map(|(mode, positions)| {
                    positions.iter().enumerate().map(move |(index, position)| {
                        ("knobPositions", mode, index, &position.position)
                    })
                }),
        )
    {
        let Some(group_id) = position.group_id.as_deref() else {
            continue;
        };
        let exists = group_ids
            .get(mode)
            .is_some_and(|ids| ids.contains(group_id));
        if !exists {
            violations.insert(ValidationViolation::new(
                format!("group-ref:{field}:{mode}:{index}:{group_id}"),
                "UNKNOWN_GROUP_ID",
                format!("{field} {mode}[{index}] references unknown group '{group_id}'"),
            ));
        }
    }
}

pub(crate) fn sync_key_counters(counters: &mut KeyCounters, keys: &KeyMappings) {
    for (mode, key_list) in keys {
        let entry = counters.entry(mode.clone()).or_default();
        entry.retain(|key, _| key_list.contains(key));
        for key in key_list {
            entry.entry(key.clone()).or_insert(0);
        }
    }

    counters.retain(|mode, _| keys.contains_key(mode));
}

pub(crate) fn repair_selected_mode(store: &mut AppStoreData) {
    let selected_is_valid = default_keys().contains_key(&store.selected_key_type)
        || (store.keys.contains_key(&store.selected_key_type)
            && store
                .custom_tabs
                .iter()
                .any(|tab| tab.id == store.selected_key_type));
    if !selected_is_valid {
        store.selected_key_type = "4key".to_string();
    }
}

pub(crate) fn touched_pair(fields: &[EditorField]) -> (bool, bool) {
    (
        fields.contains(&EditorField::Keys),
        fields.contains(&EditorField::KeyPositions),
    )
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::models::{
        CustomTab, EditorCommitRequest, EditorDocumentV1, EditorPatchV1, ElementShadowSpec,
        GraphPosition, GraphStatType, GraphType, KeyPosition, KnobPosition, LayerGroupDef,
        StatPosition, StatType,
    };

    use super::*;

    fn request(keys: KeyMappings) -> EditorCommitRequest {
        EditorCommitRequest {
            base_revision: 0,
            mutation_id: Uuid::new_v4().to_string(),
            gesture_id: None,
            changes: EditorPatchV1 {
                keys: Some(keys),
                ..EditorPatchV1::default()
            },
        }
    }

    fn default_editor_store() -> AppStoreData {
        AppStoreData {
            keys: crate::defaults::default_keys().clone(),
            key_positions: crate::defaults::default_positions().clone(),
            ..AppStoreData::default()
        }
    }

    fn store_with_custom_modes(count: usize) -> AppStoreData {
        let mut store = AppStoreData::default();
        for index in 0..count {
            store.custom_tabs.push(CustomTab {
                id: format!("custom-{index}"),
                name: format!("Custom {index}"),
            });
        }
        store
    }

    fn store_with_each_position_collection() -> AppStoreData {
        let mut store = default_editor_store();
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
                axis_id: String::new(),
                sensitivity: 1.0,
                reverse: false,
                position: KeyPosition::default(),
            }],
        );
        store
    }

    fn position_mut<'a>(
        document: &'a mut EditorDocumentV1,
        collection: &str,
    ) -> &'a mut KeyPosition {
        match collection {
            "keyPositions" => &mut document.key_positions.get_mut("4key").unwrap()[0],
            "statPositions" => &mut document.stat_positions.get_mut("4key").unwrap()[0].position,
            "graphPositions" => &mut document.graph_positions.get_mut("4key").unwrap()[0].position,
            "knobPositions" => &mut document.knob_positions.get_mut("4key").unwrap()[0].position,
            _ => unreachable!(),
        }
    }

    fn valid_shadow() -> ElementShadowSpec {
        ElementShadowSpec {
            enabled: true,
            color: "#123456".to_string(),
            offset_x: 0.0,
            offset_y: 0.0,
            blur: 12.0,
        }
    }

    #[test]
    fn canonical_fingerprint_ignores_hash_map_insertion_order() {
        let mut left = HashMap::new();
        left.insert("4key".to_string(), vec!["A".to_string()]);
        left.insert("5key".to_string(), vec!["B".to_string()]);

        let mut right = HashMap::new();
        right.insert("5key".to_string(), vec!["B".to_string()]);
        right.insert("4key".to_string(), vec!["A".to_string()]);

        assert_eq!(
            request_fingerprint(&request(left)).unwrap(),
            request_fingerprint(&request(right)).unwrap()
        );
    }

    #[test]
    fn structural_single_field_update_requires_pair() {
        let store = AppStoreData::default();
        let current = EditorDocumentV1::from_store(&store);
        let mut candidate = current.clone();
        candidate
            .keys
            .entry("4key".to_string())
            .or_default()
            .push("A".to_string());

        let error = validate_paired_update(&current, &candidate, true, false).unwrap_err();
        assert_eq!(
            error.error_code,
            crate::errors::EditorCommitErrorCode::PairedUpdateRequired
        );
    }

    #[test]
    fn unchanged_ghost_mode_is_grandfathered() {
        let mut store = AppStoreData::default();
        store
            .keys
            .insert("ghost".to_string(), vec!["A".to_string()]);
        store
            .key_positions
            .insert("ghost".to_string(), vec![KeyPosition::default()]);
        let current = EditorDocumentV1::from_store(&store);
        let mut candidate = current.clone();
        candidate.keys.get_mut("ghost").unwrap()[0] = "B".to_string();

        validate_document_transition(&current, &candidate, &store, &store).unwrap();
    }

    #[test]
    fn new_ghost_mode_is_rejected() {
        let store = AppStoreData::default();
        let current = EditorDocumentV1::from_store(&store);
        let mut candidate = current.clone();
        candidate
            .keys
            .insert("ghost".to_string(), vec!["A".to_string()]);
        candidate
            .key_positions
            .insert("ghost".to_string(), vec![KeyPosition::default()]);

        let error = validate_document_transition(&current, &candidate, &store, &store).unwrap_err();
        assert_eq!(
            error.details.unwrap().validation_code.as_deref(),
            Some("UNKNOWN_MODE")
        );
    }

    #[test]
    fn metadata_can_introduce_matching_custom_mode_in_same_transition() {
        let store = AppStoreData::default();
        let current = EditorDocumentV1::from_store(&store);
        let mut candidate_store = store.clone();
        candidate_store.custom_tabs.push(CustomTab {
            id: "custom".to_string(),
            name: "Custom".to_string(),
        });
        candidate_store
            .keys
            .insert("custom".to_string(), vec!["A".to_string()]);
        candidate_store
            .key_positions
            .insert("custom".to_string(), vec![KeyPosition::default()]);
        let candidate = EditorDocumentV1::from_store(&candidate_store);

        validate_document_transition(&current, &candidate, &store, &candidate_store).unwrap();
    }

    #[test]
    fn history_restore_requires_metadata_for_every_custom_editor_mode() {
        let mut store = AppStoreData::default();
        store
            .keys
            .insert("custom".to_string(), vec!["A".to_string()]);
        store
            .key_positions
            .insert("custom".to_string(), vec![KeyPosition::default()]);
        let document = EditorDocumentV1::from_store(&store);

        let error = validate_history_restore_metadata(&document, &[], "4key").unwrap_err();

        assert_eq!(
            error.details.unwrap().validation_code.as_deref(),
            Some("CUSTOM_TAB_METADATA_MISSING")
        );
    }

    #[test]
    fn history_restore_rejects_metadata_without_paired_editor_collections() {
        let document = EditorDocumentV1::from_store(&AppStoreData::default());
        let tabs = vec![CustomTab {
            id: "custom".to_string(),
            name: "Custom".to_string(),
        }];

        let error = validate_history_restore_metadata(&document, &tabs, "custom").unwrap_err();

        assert_eq!(
            error.details.unwrap().validation_code.as_deref(),
            Some("CUSTOM_TAB_DOCUMENT_MISSING")
        );
    }

    #[test]
    fn coordinate_and_dimension_limits_accept_boundary_and_reject_one_past_it() {
        let store = default_editor_store();
        let current = EditorDocumentV1::from_store(&store);
        let mut boundary = current.clone();
        let position = &mut boundary.key_positions.get_mut("4key").unwrap()[0];
        position.dx = MAX_ABS_COORDINATE;
        position.dy = -MAX_ABS_COORDINATE;
        position.width = MAX_DIMENSION;
        position.height = MAX_DIMENSION;
        let mut boundary_store = store.clone();
        boundary.apply_to_store(&mut boundary_store);
        validate_document_transition(&current, &boundary, &store, &boundary_store).unwrap();

        for (name, value) in [
            ("dx", MAX_ABS_COORDINATE + 1.0),
            ("dy", -MAX_ABS_COORDINATE - 1.0),
            ("width", MAX_DIMENSION + 1.0),
            ("height", 0.0),
        ] {
            let mut invalid = current.clone();
            let position = &mut invalid.key_positions.get_mut("4key").unwrap()[0];
            match name {
                "dx" => position.dx = value,
                "dy" => position.dy = value,
                "width" => position.width = value,
                "height" => position.height = value,
                _ => unreachable!(),
            }
            let mut invalid_store = store.clone();
            invalid.apply_to_store(&mut invalid_store);
            assert!(
                validate_document_transition(&current, &invalid, &store, &invalid_store).is_err(),
                "{name}={value} should be rejected"
            );
        }
    }

    #[test]
    fn oversized_coordinate_is_grandfathered_only_when_unchanged_or_decreased() {
        let mut store = default_editor_store();
        store.key_positions.get_mut("4key").unwrap()[0].dx = MAX_ABS_COORDINATE + 2.0;
        let current = EditorDocumentV1::from_store(&store);

        validate_document_transition(&current, &current, &store, &store).unwrap();

        let mut decreased = current.clone();
        decreased.key_positions.get_mut("4key").unwrap()[0].dx = MAX_ABS_COORDINATE + 1.0;
        let mut decreased_store = store.clone();
        decreased.apply_to_store(&mut decreased_store);
        validate_document_transition(&current, &decreased, &store, &decreased_store).unwrap();

        let mut increased = current.clone();
        increased.key_positions.get_mut("4key").unwrap()[0].dx = MAX_ABS_COORDINATE + 3.0;
        let mut increased_store = store.clone();
        increased.apply_to_store(&mut increased_store);
        assert!(
            validate_document_transition(&current, &increased, &store, &increased_store).is_err()
        );
    }

    #[test]
    fn editor_rejects_new_shadow_violations_in_every_position_collection() {
        let store = store_with_each_position_collection();
        let current = EditorDocumentV1::from_store(&store);

        for (collection, active, property, expected_path) in [
            (
                "keyPositions",
                false,
                "blur",
                "keyPositions 4key[0].shadow.blur",
            ),
            (
                "statPositions",
                true,
                "offsetX",
                "statPositions 4key[0].activeShadow.offsetX",
            ),
            (
                "graphPositions",
                false,
                "offsetY",
                "graphPositions 4key[0].shadow.offsetY",
            ),
            (
                "knobPositions",
                true,
                "color",
                "knobPositions 4key[0].activeShadow.color",
            ),
        ] {
            let mut candidate = current.clone();
            let mut shadow = valid_shadow();
            match property {
                "blur" => shadow.blur = MAX_SHADOW_BLUR + 0.1,
                "offsetX" => shadow.offset_x = MIN_SHADOW_OFFSET - 0.1,
                "offsetY" => shadow.offset_y = MAX_SHADOW_OFFSET + 0.1,
                "color" => shadow.color.clear(),
                _ => unreachable!(),
            }
            let position = position_mut(&mut candidate, collection);
            if active {
                position.active_shadow = Some(shadow);
            } else {
                position.shadow = Some(shadow);
            }
            let mut candidate_store = store.clone();
            candidate.apply_to_store(&mut candidate_store);

            let error =
                validate_document_transition(&current, &candidate, &store, &candidate_store)
                    .unwrap_err();
            assert_eq!(
                error
                    .details
                    .as_ref()
                    .and_then(|details| details.validation_code.as_deref()),
                Some("INVALID_ELEMENT_SHADOW")
            );
            assert!(error.message.contains(expected_path));
        }
    }

    #[test]
    fn existing_shadow_violations_are_grandfathered_only_when_unchanged() {
        let mut store = default_editor_store();
        let position = &mut store.key_positions.get_mut("4key").unwrap()[0];
        let mut shadow = valid_shadow();
        shadow.blur = MAX_SHADOW_BLUR + 1.0;
        position.shadow = Some(shadow);
        let current = EditorDocumentV1::from_store(&store);

        let mut unrelated = current.clone();
        unrelated.key_positions.get_mut("4key").unwrap()[0].font_size = Some(18.0);
        let mut unrelated_store = store.clone();
        unrelated.apply_to_store(&mut unrelated_store);
        validate_document_transition(&current, &unrelated, &store, &unrelated_store).unwrap();

        let mut changed_shadow = current.clone();
        changed_shadow.key_positions.get_mut("4key").unwrap()[0]
            .shadow
            .as_mut()
            .unwrap()
            .blur += 1.0;
        let mut changed_shadow_store = store.clone();
        changed_shadow.apply_to_store(&mut changed_shadow_store);
        let shadow_error =
            validate_document_transition(&current, &changed_shadow, &store, &changed_shadow_store)
                .unwrap_err();
        assert_eq!(
            shadow_error
                .details
                .as_ref()
                .and_then(|details| details.validation_code.as_deref()),
            Some("INVALID_ELEMENT_SHADOW")
        );
    }

    #[test]
    fn oversized_per_mode_collection_is_grandfathered_only_when_non_increasing() {
        let mut store = store_with_custom_modes(1);
        store.keys.insert(
            "custom-0".to_string(),
            (0..514).map(|index| format!("Key{index}")).collect(),
        );
        store
            .key_positions
            .insert("custom-0".to_string(), vec![KeyPosition::default(); 514]);
        let current = EditorDocumentV1::from_store(&store);
        validate_document_transition(&current, &current, &store, &store).unwrap();

        let mut decreased = current.clone();
        decreased.keys.get_mut("custom-0").unwrap().pop();
        decreased.key_positions.get_mut("custom-0").unwrap().pop();
        let mut decreased_store = store.clone();
        decreased.apply_to_store(&mut decreased_store);
        validate_document_transition(&current, &decreased, &store, &decreased_store).unwrap();

        let mut increased = current.clone();
        increased
            .keys
            .get_mut("custom-0")
            .unwrap()
            .push("Extra".to_string());
        increased
            .key_positions
            .get_mut("custom-0")
            .unwrap()
            .push(KeyPosition::default());
        let mut increased_store = store.clone();
        increased.apply_to_store(&mut increased_store);
        assert!(
            validate_document_transition(&current, &increased, &store, &increased_store).is_err()
        );
    }

    #[test]
    fn oversized_mode_count_is_grandfathered_only_when_non_increasing() {
        let mut store = store_with_custom_modes(65);
        for index in 0..65 {
            store.keys.insert(format!("custom-{index}"), Vec::new());
            store
                .key_positions
                .insert(format!("custom-{index}"), Vec::new());
        }
        let current = EditorDocumentV1::from_store(&store);
        validate_document_transition(&current, &current, &store, &store).unwrap();

        let mut decreased = current.clone();
        decreased.keys.remove("custom-64");
        decreased.key_positions.remove("custom-64");
        let mut decreased_store = store.clone();
        decreased.apply_to_store(&mut decreased_store);
        validate_document_transition(&current, &decreased, &store, &decreased_store).unwrap();

        let mut increased_store = store.clone();
        increased_store.custom_tabs.push(CustomTab {
            id: "custom-65".to_string(),
            name: "Custom 65".to_string(),
        });
        let mut increased = current.clone();
        increased.keys.insert("custom-65".to_string(), Vec::new());
        increased
            .key_positions
            .insert("custom-65".to_string(), Vec::new());
        increased.apply_to_store(&mut increased_store);
        assert!(
            validate_document_transition(&current, &increased, &store, &increased_store).is_err()
        );
    }

    #[test]
    fn count_limits_accept_exact_boundaries_and_reject_boundary_plus_one() {
        let mode_store = store_with_custom_modes(65);
        let empty = EditorDocumentV1::from_store(&mode_store);
        let mut modes_at_limit = empty.clone();
        for index in 0..64 {
            modes_at_limit
                .keys
                .insert(format!("custom-{index}"), Vec::new());
            modes_at_limit
                .key_positions
                .insert(format!("custom-{index}"), Vec::new());
        }
        let mut modes_at_limit_store = mode_store.clone();
        modes_at_limit.apply_to_store(&mut modes_at_limit_store);
        validate_document_transition(&empty, &modes_at_limit, &mode_store, &modes_at_limit_store)
            .unwrap();
        let mut too_many_modes = modes_at_limit.clone();
        too_many_modes
            .keys
            .insert("custom-64".to_string(), Vec::new());
        too_many_modes
            .key_positions
            .insert("custom-64".to_string(), Vec::new());
        let mut too_many_modes_store = mode_store.clone();
        too_many_modes.apply_to_store(&mut too_many_modes_store);
        assert!(validate_document_transition(
            &empty,
            &too_many_modes,
            &mode_store,
            &too_many_modes_store,
        )
        .is_err());

        let collection_store = store_with_custom_modes(1);
        let collection_empty = EditorDocumentV1::from_store(&collection_store);
        let mut collection_at_limit = collection_empty.clone();
        collection_at_limit.keys.insert(
            "custom-0".to_string(),
            (0..512).map(|index| format!("Key{index}")).collect(),
        );
        collection_at_limit
            .key_positions
            .insert("custom-0".to_string(), vec![KeyPosition::default(); 512]);
        let mut collection_at_limit_store = collection_store.clone();
        collection_at_limit.apply_to_store(&mut collection_at_limit_store);
        validate_document_transition(
            &collection_empty,
            &collection_at_limit,
            &collection_store,
            &collection_at_limit_store,
        )
        .unwrap();
        let mut collection_too_large = collection_at_limit.clone();
        collection_too_large
            .keys
            .get_mut("custom-0")
            .unwrap()
            .push("Extra".to_string());
        collection_too_large
            .key_positions
            .get_mut("custom-0")
            .unwrap()
            .push(KeyPosition::default());
        let mut collection_too_large_store = collection_store.clone();
        collection_too_large.apply_to_store(&mut collection_too_large_store);
        assert!(validate_document_transition(
            &collection_empty,
            &collection_too_large,
            &collection_store,
            &collection_too_large_store,
        )
        .is_err());

        let render_store = store_with_custom_modes(8);
        let render_empty = EditorDocumentV1::from_store(&render_store);
        let mut render_at_limit = render_empty.clone();
        for index in 0..8 {
            let mode = format!("custom-{index}");
            render_at_limit
                .keys
                .insert(mode.clone(), vec![String::new(); 512]);
            render_at_limit
                .key_positions
                .insert(mode, vec![KeyPosition::default(); 512]);
        }
        let mut render_at_limit_store = render_store.clone();
        render_at_limit.apply_to_store(&mut render_at_limit_store);
        validate_document_transition(
            &render_empty,
            &render_at_limit,
            &render_store,
            &render_at_limit_store,
        )
        .unwrap();
        let mut too_many_render_items = render_at_limit.clone();
        too_many_render_items.stat_positions.insert(
            "custom-0".to_string(),
            vec![StatPosition {
                stat_type: StatType::Kps,
                position: KeyPosition::default(),
            }],
        );
        let mut too_many_render_items_store = render_store.clone();
        too_many_render_items.apply_to_store(&mut too_many_render_items_store);
        assert!(validate_document_transition(
            &render_empty,
            &too_many_render_items,
            &render_store,
            &too_many_render_items_store,
        )
        .is_err());

        let group_store = store_with_custom_modes(9);
        let group_empty = EditorDocumentV1::from_store(&group_store);
        let mut groups_at_limit = group_empty.clone();
        for index in 0..8 {
            groups_at_limit.layer_groups.insert(
                format!("custom-{index}"),
                (0..512)
                    .map(|group| LayerGroupDef {
                        id: format!("g-{index}-{group}"),
                        name: "Group".to_string(),
                    })
                    .collect(),
            );
        }
        let mut groups_at_limit_store = group_store.clone();
        groups_at_limit.apply_to_store(&mut groups_at_limit_store);
        validate_document_transition(
            &group_empty,
            &groups_at_limit,
            &group_store,
            &groups_at_limit_store,
        )
        .unwrap();
        let mut too_many_groups = groups_at_limit.clone();
        too_many_groups.layer_groups.insert(
            "custom-8".to_string(),
            vec![LayerGroupDef {
                id: "extra-group".to_string(),
                name: "Group".to_string(),
            }],
        );
        let mut too_many_groups_store = group_store.clone();
        too_many_groups.apply_to_store(&mut too_many_groups_store);
        assert!(validate_document_transition(
            &group_empty,
            &too_many_groups,
            &group_store,
            &too_many_groups_store,
        )
        .is_err());
    }

    #[test]
    fn revision_and_request_id_wire_limits_are_enforced() {
        assert!(validate_revision(MAX_SAFE_EDITOR_REVISION).is_ok());
        assert!(validate_revision(MAX_SAFE_EDITOR_REVISION + 1).is_err());
        assert!(next_revision(MAX_SAFE_EDITOR_REVISION).is_err());

        let invalid = EditorCommitRequest {
            base_revision: 0,
            mutation_id: "not-a-uuid".to_string(),
            gesture_id: None,
            changes: EditorPatchV1::default(),
        };
        assert!(validate_request_envelope(&invalid).is_err());

        let mut oversized_gesture = request(KeyMappings::new());
        oversized_gesture.gesture_id = Some("가".repeat(22));
        assert_eq!(oversized_gesture.gesture_id.as_ref().unwrap().len(), 66);
        assert!(validate_request_envelope(&oversized_gesture).is_err());
    }

    #[test]
    fn oversized_render_and_group_totals_only_allow_non_increasing_changes() {
        let mut render_store = store_with_custom_modes(8);
        for index in 0..8 {
            let mode = format!("custom-{index}");
            render_store
                .keys
                .insert(mode.clone(), vec![String::new(); 512]);
            render_store
                .key_positions
                .insert(mode, vec![KeyPosition::default(); 512]);
        }
        render_store.stat_positions.insert(
            "custom-0".to_string(),
            vec![
                StatPosition {
                    stat_type: StatType::Kps,
                    position: KeyPosition::default(),
                };
                2
            ],
        );
        let current_render = EditorDocumentV1::from_store(&render_store);
        validate_document_transition(
            &current_render,
            &current_render,
            &render_store,
            &render_store,
        )
        .unwrap();
        let mut less_render = current_render.clone();
        less_render
            .stat_positions
            .get_mut("custom-0")
            .unwrap()
            .pop();
        let mut less_render_store = render_store.clone();
        less_render.apply_to_store(&mut less_render_store);
        validate_document_transition(
            &current_render,
            &less_render,
            &render_store,
            &less_render_store,
        )
        .unwrap();
        let mut more_render = current_render.clone();
        more_render
            .stat_positions
            .get_mut("custom-0")
            .unwrap()
            .push(StatPosition {
                stat_type: StatType::Kps,
                position: KeyPosition::default(),
            });
        let mut more_render_store = render_store.clone();
        more_render.apply_to_store(&mut more_render_store);
        assert!(validate_document_transition(
            &current_render,
            &more_render,
            &render_store,
            &more_render_store,
        )
        .is_err());

        let mut group_store = store_with_custom_modes(9);
        for index in 0..8 {
            group_store.layer_groups.insert(
                format!("custom-{index}"),
                (0..512)
                    .map(|group| LayerGroupDef {
                        id: format!("g-{index}-{group}"),
                        name: "Group".to_string(),
                    })
                    .collect(),
            );
        }
        group_store.layer_groups.insert(
            "custom-8".to_string(),
            vec![
                LayerGroupDef {
                    id: "g-8-0".to_string(),
                    name: "Group".to_string(),
                },
                LayerGroupDef {
                    id: "g-8-1".to_string(),
                    name: "Group".to_string(),
                },
            ],
        );
        let current_groups = EditorDocumentV1::from_store(&group_store);
        validate_document_transition(&current_groups, &current_groups, &group_store, &group_store)
            .unwrap();
        let mut less_groups = current_groups.clone();
        less_groups.layer_groups.get_mut("custom-8").unwrap().pop();
        let mut less_group_store = group_store.clone();
        less_groups.apply_to_store(&mut less_group_store);
        validate_document_transition(
            &current_groups,
            &less_groups,
            &group_store,
            &less_group_store,
        )
        .unwrap();
        let mut more_groups = current_groups.clone();
        more_groups
            .layer_groups
            .get_mut("custom-8")
            .unwrap()
            .push(LayerGroupDef {
                id: "g-8-2".to_string(),
                name: "Group".to_string(),
            });
        let mut more_group_store = group_store.clone();
        more_groups.apply_to_store(&mut more_group_store);
        assert!(validate_document_transition(
            &current_groups,
            &more_groups,
            &group_store,
            &more_group_store,
        )
        .is_err());
    }

    #[test]
    fn existing_pair_and_group_reference_violations_are_not_grandfathered() {
        let mut pair_store = default_editor_store();
        pair_store.keys.get_mut("4key").unwrap().pop();
        let pair_document = EditorDocumentV1::from_store(&pair_store);
        assert!(validate_document_transition(
            &pair_document,
            &pair_document,
            &pair_store,
            &pair_store,
        )
        .is_err());

        let mut reference_store = default_editor_store();
        reference_store.key_positions.get_mut("4key").unwrap()[0].group_id =
            Some("missing".to_string());
        let reference_document = EditorDocumentV1::from_store(&reference_store);
        assert!(validate_document_transition(
            &reference_document,
            &reference_document,
            &reference_store,
            &reference_store,
        )
        .is_err());
    }

    #[test]
    fn compact_request_size_boundaries_are_exact() {
        fn sized_request(target_bytes: usize) -> EditorCommitRequest {
            let mut empty_keys = KeyMappings::new();
            empty_keys.insert("4key".to_string(), vec![String::new()]);
            let empty = request(empty_keys);
            let overhead = serde_json::to_vec(&empty).unwrap().len();
            assert!(target_bytes >= overhead);

            let mut keys = KeyMappings::new();
            keys.insert(
                "4key".to_string(),
                vec!["x".repeat(target_bytes - overhead)],
            );
            let request = EditorCommitRequest {
                mutation_id: empty.mutation_id,
                ..request(keys)
            };
            assert_eq!(serde_json::to_vec(&request).unwrap().len(), target_bytes);
            request
        }

        assert_eq!(
            request_payload_size(&sized_request(REQUEST_WARNING_BYTES - 1)).unwrap(),
            REQUEST_WARNING_BYTES - 1
        );
        assert_eq!(
            request_payload_size(&sized_request(REQUEST_WARNING_BYTES)).unwrap(),
            REQUEST_WARNING_BYTES
        );
        assert_eq!(
            request_payload_size(&sized_request(MAX_REQUEST_BYTES)).unwrap(),
            MAX_REQUEST_BYTES
        );
        let error = request_payload_size(&sized_request(MAX_REQUEST_BYTES + 1)).unwrap_err();
        assert_eq!(
            error.details.unwrap().validation_code.as_deref(),
            Some("REQUEST_TOO_LARGE")
        );
    }
}
