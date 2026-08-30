use std::collections::{HashMap, HashSet};

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    defaults::default_keys,
    errors::EditorCommitError,
    models::{
        CustomTab, EditorCommitRequest, EditorDocumentV1, EDITOR_COMMIT_SCHEMA_VERSION_V2,
        EDITOR_OPS_VERSION, EDITOR_SCHEMA_VERSION,
    },
};

use super::{
    is_valid_gesture_id, is_valid_group_id_shape, MAX_CUSTOM_TABS, MAX_EDITOR_OPS, MAX_GESTURE_IDS,
    MAX_GROUP_NAME_BYTES, MAX_MODE_ID_BYTES, MAX_MUTATION_ID_BYTES, MAX_RENDER_ITEMS,
    MAX_REQUEST_BYTES, MAX_SAFE_WIRE_REVISION, REQUEST_WARNING_BYTES,
};

pub(crate) type RequestFingerprint = [u8; 32];

const EDITOR_COMMIT_REQUEST_KEYS: &[&str] = &[
    "baseRevision",
    "mutationId",
    "multiKey",
    "gestureId",
    "gestureIds",
    "changes",
    "opsVersion",
    "ops",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FingerprintPayload<'a> {
    base_revision: u64,
    multi_key: bool,
    gesture_id: Option<&'a str>,
    gesture_ids: &'a [String],
    changes: &'a Option<crate::models::EditorPatchV1>,
    ops_version: &'a Option<u16>,
    ops: &'a Option<Vec<crate::models::EditorOpV1>>,
}

pub(crate) fn decode_editor_commit_request(
    value: Value,
) -> Result<EditorCommitRequest, EditorCommitError> {
    let Some(object) = value.as_object() else {
        return Err(EditorCommitError::validation(
            "INVALID_REQUEST_PAYLOAD",
            "editor request must be an object",
        ));
    };

    if let Some(key) = object
        .keys()
        .find(|key| !EDITOR_COMMIT_REQUEST_KEYS.contains(&key.as_str()))
    {
        return Err(EditorCommitError::validation(
            "INVALID_REQUEST_PAYLOAD",
            format!("editor request contains unknown key '{key}'"),
        ));
    }

    if ["changes", "opsVersion", "ops"]
        .into_iter()
        .any(|key| object.get(key).is_some_and(Value::is_null))
    {
        return Err(EditorCommitError::validation(
            "INVALID_EDITOR_MUTATION",
            "editor mutation fields cannot be null",
        ));
    }

    let has_changes = object.contains_key("changes");
    let has_ops_version = object.contains_key("opsVersion");
    let has_ops = object.contains_key("ops");
    let has_patch_mutation = has_changes && !has_ops_version && !has_ops;
    let has_ops_mutation = !has_changes && has_ops_version && has_ops;
    if !has_patch_mutation && !has_ops_mutation {
        return Err(EditorCommitError::validation(
            "INVALID_EDITOR_MUTATION",
            "editor request must contain changes or the opsVersion and ops pair",
        ));
    }

    let has_frozen_insert = value
        .get("ops")
        .and_then(Value::as_array)
        .is_some_and(|ops| {
            ops.iter()
                .any(|op| op.get("kind").and_then(Value::as_str) == Some("insertFrozenElements"))
        });
    if !has_frozen_insert {
        return serde_json::from_value(value).map_err(|error| {
            EditorCommitError::validation(
                "INVALID_REQUEST_PAYLOAD",
                format!("invalid editor request: {error}"),
            )
        });
    }

    decode_exact_frozen_insert(value, "editor")
}

pub(crate) fn decode_exact_frozen_insert<T>(
    value: Value,
    label: &str,
) -> Result<T, EditorCommitError>
where
    T: serde::de::DeserializeOwned + Serialize,
{
    let raw_value = value.clone();
    let request: T = serde_json::from_value(value).map_err(|error| {
        EditorCommitError::validation(
            "INVALID_REQUEST_PAYLOAD",
            format!("invalid {label} request: {error}"),
        )
    })?;
    let canonical = serde_json::to_value(&request).map_err(|error| {
        EditorCommitError::validation(
            "INVALID_REQUEST_PAYLOAD",
            format!("could not inspect decoded {label} request: {error}"),
        )
    })?;
    if let Some(path) = first_unknown_json_key(&raw_value, &canonical, label) {
        return Err(EditorCommitError::validation(
            "INVALID_REQUEST_PAYLOAD",
            format!("{label} request contains unknown key '{path}'"),
        ));
    }
    Ok(request)
}

fn carries_value(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Array(items) => !items.is_empty(),
        _ => true,
    }
}

fn first_unknown_json_key(raw: &Value, canonical: &Value, path: &str) -> Option<String> {
    match (raw, canonical) {
        (Value::Object(raw), Value::Object(canonical)) => raw.iter().find_map(|(key, value)| {
            let child_path = format!("{path}.{key}");
            canonical.get(key).map_or_else(
                // None·빈 배열은 재직렬화에서 생략된다(skip_serializing_if).
                // 프론트가 명시한 null·[]은 같은 뜻이고 실린 값이 없으므로
                // 미지의 키로 보지 않는다 - 값이 있는 키만 거절
                || carries_value(value).then(|| child_path.clone()),
                |canonical| first_unknown_json_key(value, canonical, &child_path),
            )
        }),
        (Value::Array(raw), Value::Array(canonical)) => {
            if raw.len() != canonical.len() {
                return Some(path.to_string());
            }
            raw.iter()
                .zip(canonical)
                .enumerate()
                .find_map(|(index, (value, canonical))| {
                    first_unknown_json_key(value, canonical, &format!("{path}[{index}]"))
                })
        }
        (Value::Object(_) | Value::Array(_), _) => Some(path.to_string()),
        _ => None,
    }
}

pub(crate) fn validate_request_envelope(
    request: &EditorCommitRequest,
) -> Result<(), EditorCommitError> {
    validate_revision(request.base_revision)?;

    match (&request.changes, request.ops_version, &request.ops) {
        (Some(changes), None, None) => {
            if !matches!(
                changes.schema_version,
                EDITOR_SCHEMA_VERSION | EDITOR_COMMIT_SCHEMA_VERSION_V2
            ) {
                return Err(EditorCommitError::validation(
                    "UNSUPPORTED_SCHEMA_VERSION",
                    format!(
                        "unsupported editor schema version {}",
                        changes.schema_version
                    ),
                ));
            }
        }
        (None, Some(version), Some(ops)) => {
            if version != EDITOR_OPS_VERSION {
                return Err(EditorCommitError::validation(
                    "UNSUPPORTED_OPS_VERSION",
                    format!("unsupported editor ops version {version}"),
                ));
            }
            if ops.is_empty() {
                return Err(EditorCommitError::validation(
                    "EMPTY_EDITOR_OPS",
                    "editor ops must contain at least one operation",
                ));
            }
            if ops.len() > MAX_EDITOR_OPS {
                return Err(EditorCommitError::validation(
                    "TOO_MANY_EDITOR_OPS",
                    format!("editor op count exceeds {MAX_EDITOR_OPS}"),
                ));
            }

            let frozen_insert_count = ops
                .iter()
                .filter(|op| matches!(op, crate::models::EditorOpV1::InsertFrozenElements { .. }))
                .count();
            if frozen_insert_count > 0 && (ops.len() != 1 || frozen_insert_count != 1) {
                return Err(EditorCommitError::validation(
                    "INVALID_FROZEN_INSERT_BATCH",
                    "insertFrozenElements must be the only editor op",
                ));
            }

            let reorder_count = ops
                .iter()
                .filter(|op| matches!(op, crate::models::EditorOpV1::ReorderElements { .. }))
                .count();
            if reorder_count > 0 && (ops.len() != 1 || reorder_count != 1) {
                return Err(EditorCommitError::validation(
                    "INVALID_REORDER_BATCH",
                    "reorderElements must be the only editor op",
                ));
            }

            let group_structural_count = ops
                .iter()
                .filter(|op| {
                    matches!(
                        op,
                        crate::models::EditorOpV1::SetElementGroups { .. }
                            | crate::models::EditorOpV1::RenameLayerGroup { .. }
                    )
                })
                .count();
            if group_structural_count > 0 && (ops.len() != 1 || group_structural_count != 1) {
                return Err(EditorCommitError::validation(
                    "INVALID_GROUP_STRUCTURAL_BATCH",
                    "group structural operations must be the only editor op",
                ));
            }

            let mut ids = HashSet::with_capacity(ops.len());
            for op in ops {
                let Some(id) = op.target_id() else {
                    match op {
                        crate::models::EditorOpV1::InsertFrozenElements { .. } => {
                            validate_frozen_insert_envelope(op)?;
                        }
                        crate::models::EditorOpV1::ReorderElements { .. } => {
                            validate_reorder_envelope(op)?;
                        }
                        crate::models::EditorOpV1::SetElementGroups { .. }
                        | crate::models::EditorOpV1::RenameLayerGroup { .. } => {
                            validate_group_structural_envelope(op)?;
                        }
                        _ => {}
                    }
                    continue;
                };
                if let crate::models::EditorOpV1::SetKeySlot { slot, .. } = op {
                    validate_key_slot(slot, "INVALID_KEY_SLOT", "setKeySlot")?;
                }
                if !crate::state::native_element_id::is_valid_element_id(id) {
                    return Err(EditorCommitError::validation(
                        crate::state::native_element_id::INVALID_ELEMENT_ID,
                        format!("editor op target '{id}' has an invalid ID"),
                    ));
                }
                if !ids.insert(id) {
                    return Err(EditorCommitError::validation(
                        "DUPLICATE_EDITOR_OP_TARGET",
                        format!("editor op target '{id}' appears more than once"),
                    ));
                }
            }
        }
        _ => {
            return Err(EditorCommitError::validation(
                "INVALID_EDITOR_MUTATION",
                "editor request must contain exactly one of changes or ops",
            ));
        }
    }

    if request.mutation_id.len() > MAX_MUTATION_ID_BYTES
        || Uuid::parse_str(&request.mutation_id).is_err()
    {
        return Err(EditorCommitError::validation(
            "INVALID_MUTATION_ID",
            "mutationId must be a UUID no longer than 64 bytes",
        ));
    }

    if request.gesture_ids.len() > MAX_GESTURE_IDS
        || request
            .gesture_ids
            .iter()
            .chain(request.gesture_id.iter())
            .collect::<HashSet<_>>()
            .len()
            > MAX_GESTURE_IDS
    {
        return Err(EditorCommitError::too_many_gesture_ids(MAX_GESTURE_IDS));
    }

    if request
        .gesture_id
        .iter()
        .chain(request.gesture_ids.iter())
        .any(|gesture_id| !is_valid_gesture_id(gesture_id))
    {
        return Err(EditorCommitError::invalid_gesture_id());
    }

    Ok(())
}

fn validate_frozen_insert_envelope(
    op: &crate::models::EditorOpV1,
) -> Result<(), EditorCommitError> {
    use crate::models::EditorOpV1;

    let EditorOpV1::InsertFrozenElements {
        mode,
        elements,
        groups,
        z_updates,
    } = op
    else {
        return Ok(());
    };

    if mode.is_empty() || mode.len() > MAX_MODE_ID_BYTES {
        return Err(EditorCommitError::validation(
            "INVALID_MODE_ID",
            "insertFrozenElements mode must be non-empty and within the mode ID limit",
        ));
    }
    if elements.is_empty() && z_updates.is_empty() {
        return Err(EditorCommitError::validation(
            "EMPTY_FROZEN_INSERT_BATCH",
            "insertFrozenElements must contain elements or zUpdates",
        ));
    }
    for (label, count) in [
        ("elements", elements.len()),
        ("groups", groups.len()),
        ("zUpdates", z_updates.len()),
    ] {
        if count > MAX_RENDER_ITEMS {
            return Err(EditorCommitError::validation(
                "FROZEN_INSERT_BATCH_TOO_LARGE",
                format!("insertFrozenElements {label} count exceeds {MAX_RENDER_ITEMS}"),
            ));
        }
    }
    let mut inserted_ids = HashSet::with_capacity(elements.len());
    for element in elements {
        if let crate::models::EditorFrozenElementV1::Key { slot, .. } = element {
            validate_frozen_key_slot(slot)?;
        }
        let id = element.id();
        if !crate::state::native_element_id::is_valid_element_id(id) {
            return Err(EditorCommitError::validation(
                crate::state::native_element_id::INVALID_ELEMENT_ID,
                format!("insertFrozenElements element '{id}' has an invalid ID"),
            ));
        }
        if !inserted_ids.insert(id) {
            return Err(EditorCommitError::validation(
                "DUPLICATE_FROZEN_INSERT_ID",
                format!("insertFrozenElements element '{id}' appears more than once"),
            ));
        }
    }

    let mut group_ids = HashSet::with_capacity(groups.len());
    for group in groups {
        if !is_valid_group_id_shape(&group.id) {
            return Err(EditorCommitError::validation(
                "INVALID_GROUP_ID",
                "insertFrozenElements group ID is empty or exceeds its limit",
            ));
        }
        if !group_ids.insert(group.id.as_str()) {
            return Err(EditorCommitError::validation(
                "DUPLICATE_GROUP_ID",
                format!(
                    "insertFrozenElements group '{}' appears more than once",
                    group.id
                ),
            ));
        }
    }

    let mut z_ids = HashSet::with_capacity(z_updates.len());
    for update in z_updates {
        if !crate::state::native_element_id::is_valid_element_id(&update.id) {
            return Err(EditorCommitError::validation(
                crate::state::native_element_id::INVALID_ELEMENT_ID,
                format!(
                    "insertFrozenElements z target '{}' has an invalid ID",
                    update.id
                ),
            ));
        }
        if inserted_ids.contains(update.id.as_str()) {
            return Err(EditorCommitError::validation(
                "FROZEN_INSERT_Z_TARGET_OVERLAP",
                format!(
                    "insertFrozenElements z target '{}' is also inserted",
                    update.id
                ),
            ));
        }
        if !z_ids.insert(update.id.as_str()) {
            return Err(EditorCommitError::validation(
                "DUPLICATE_FROZEN_Z_TARGET",
                format!(
                    "insertFrozenElements z target '{}' appears more than once",
                    update.id
                ),
            ));
        }
    }
    Ok(())
}

fn validate_reorder_envelope(op: &crate::models::EditorOpV1) -> Result<(), EditorCommitError> {
    use crate::models::EditorOpV1;

    let EditorOpV1::ReorderElements {
        mode,
        complete_mode_order,
        z_updates,
        group_updates,
    } = op
    else {
        return Ok(());
    };

    if mode.is_empty() || mode.len() > MAX_MODE_ID_BYTES {
        return Err(EditorCommitError::validation(
            "INVALID_MODE_ID",
            "reorderElements mode must be non-empty and within the mode ID limit",
        ));
    }
    if z_updates.is_empty() {
        return Err(EditorCommitError::validation(
            "EMPTY_REORDER_BATCH",
            "reorderElements must contain zUpdates",
        ));
    }
    for (label, count) in [
        ("zUpdates", z_updates.len()),
        ("groupUpdates", group_updates.len()),
    ] {
        if count > MAX_RENDER_ITEMS {
            return Err(EditorCommitError::validation(
                "REORDER_BATCH_TOO_LARGE",
                format!("reorderElements {label} count exceeds {MAX_RENDER_ITEMS}"),
            ));
        }
    }
    if !complete_mode_order && !group_updates.is_empty() {
        return Err(EditorCommitError::validation(
            "INVALID_PARTIAL_REORDER_GROUP_UPDATE",
            "partial reorderElements cannot contain groupUpdates",
        ));
    }

    let mut z_targets = HashMap::with_capacity(z_updates.len());
    for update in z_updates {
        if !crate::state::native_element_id::is_valid_element_id(&update.id) {
            return Err(EditorCommitError::validation(
                crate::state::native_element_id::INVALID_ELEMENT_ID,
                format!("reorderElements z target '{}' has an invalid ID", update.id),
            ));
        }
        if z_targets
            .insert(update.id.as_str(), update.element_type)
            .is_some()
        {
            return Err(EditorCommitError::validation(
                "DUPLICATE_REORDER_Z_TARGET",
                format!(
                    "reorderElements z target '{}' appears more than once",
                    update.id
                ),
            ));
        }
    }

    let mut group_targets = HashSet::with_capacity(group_updates.len());
    for update in group_updates {
        if !crate::state::native_element_id::is_valid_element_id(&update.id) {
            return Err(EditorCommitError::validation(
                crate::state::native_element_id::INVALID_ELEMENT_ID,
                format!(
                    "reorderElements group target '{}' has an invalid ID",
                    update.id
                ),
            ));
        }
        if !group_targets.insert(update.id.as_str()) {
            return Err(EditorCommitError::validation(
                "DUPLICATE_REORDER_GROUP_TARGET",
                format!(
                    "reorderElements group target '{}' appears more than once",
                    update.id
                ),
            ));
        }
        let Some(z_type) = z_targets.get(update.id.as_str()) else {
            return Err(EditorCommitError::validation(
                "REORDER_GROUP_TARGET_NOT_IN_ORDER",
                format!(
                    "reorderElements group target '{}' has no matching z target",
                    update.id
                ),
            ));
        };
        if *z_type != update.element_type {
            return Err(EditorCommitError::validation(
                "REORDER_TARGET_TYPE_CONFLICT",
                format!(
                    "reorderElements target '{}' uses conflicting element types",
                    update.id
                ),
            ));
        }
        if update
            .group_id
            .as_ref()
            .is_some_and(|group_id| !is_valid_group_id_shape(group_id))
        {
            return Err(EditorCommitError::validation(
                "INVALID_REORDER_GROUP_ID",
                "reorderElements group ID is empty or exceeds its limit",
            ));
        }
    }
    Ok(())
}

fn validate_group_structural_envelope(
    op: &crate::models::EditorOpV1,
) -> Result<(), EditorCommitError> {
    use crate::models::{EditorOpV1, EditorTargetGroupV1};

    let validate_mode = |mode: &str| {
        if mode.is_empty() || mode.len() > MAX_MODE_ID_BYTES {
            Err(EditorCommitError::validation(
                "INVALID_MODE_ID",
                "group structural mode must be non-empty and within the mode ID limit",
            ))
        } else {
            Ok(())
        }
    };
    let validate_group_id = |group_id: &str| {
        if !is_valid_group_id_shape(group_id) {
            Err(EditorCommitError::validation(
                "INVALID_GROUP_ID",
                "group ID must be non-empty and within its limit",
            ))
        } else {
            Ok(())
        }
    };
    let validate_group_name = |name: &str| {
        if name.is_empty() || name.len() > MAX_GROUP_NAME_BYTES {
            Err(EditorCommitError::validation(
                "INVALID_GROUP_NAME",
                "group name must be non-empty and within its limit",
            ))
        } else {
            Ok(())
        }
    };

    match op {
        EditorOpV1::SetElementGroups {
            mode,
            targets,
            target_group,
        } => {
            validate_mode(mode)?;
            // 빈 targets 허용 - plugin-only 그룹 편집은 그룹 def 생성·정리를
            // native 대상 없이 editor op에 실어야 한다 (플러그인 소속은 동반
            // plugin_changes가 운반)
            if targets.len() > MAX_RENDER_ITEMS {
                return Err(EditorCommitError::validation(
                    "INVALID_ELEMENT_GROUP_TARGET_COUNT",
                    format!(
                        "setElementGroups targets must contain at most {MAX_RENDER_ITEMS} entries"
                    ),
                ));
            }
            let mut target_ids = HashSet::with_capacity(targets.len());
            for target in targets {
                if !crate::state::native_element_id::is_valid_element_id(&target.id) {
                    return Err(EditorCommitError::validation(
                        crate::state::native_element_id::INVALID_ELEMENT_ID,
                        format!("setElementGroups target '{}' has an invalid ID", target.id),
                    ));
                }
                if !target_ids.insert(target.id.as_str()) {
                    return Err(EditorCommitError::validation(
                        "DUPLICATE_ELEMENT_GROUP_TARGET",
                        format!(
                            "setElementGroups target '{}' appears more than once",
                            target.id
                        ),
                    ));
                }
            }
            match target_group {
                Some(EditorTargetGroupV1::Existing { id }) => validate_group_id(id)?,
                Some(EditorTargetGroupV1::Create { id, name }) => {
                    validate_group_id(id)?;
                    validate_group_name(name)?;
                }
                None => {}
            }
        }
        EditorOpV1::RenameLayerGroup {
            mode,
            group_id,
            name,
        } => {
            validate_mode(mode)?;
            validate_group_id(group_id)?;
            validate_group_name(name)?;
        }
        _ => {}
    }
    Ok(())
}

fn validate_frozen_key_slot(
    slot: &crate::models::EditorFrozenKeySlotV1,
) -> Result<(), EditorCommitError> {
    validate_key_slot(slot, "INVALID_FROZEN_KEY_SLOT", "insertFrozenElements")
}

fn validate_key_slot(
    slot: &crate::models::EditorFrozenKeySlotV1,
    code: &'static str,
    operation: &'static str,
) -> Result<(), EditorCommitError> {
    let crate::models::EditorFrozenKeySlotV1::Multi(slot) = slot else {
        return Ok(());
    };
    let mut members = HashSet::with_capacity(slot.keys.len());
    if !(2..=crate::models::MAX_SLOT_KEYS).contains(&slot.keys.len())
        || slot.keys.iter().any(|member| {
            member.is_empty()
                || member.contains('+')
                || member.contains('|')
                || !members.insert(member.as_str())
        })
    {
        return Err(EditorCommitError::validation(
            code,
            format!("{operation} key slot is not canonical"),
        ));
    }
    Ok(())
}

pub(crate) fn validate_revision(revision: u64) -> Result<(), EditorCommitError> {
    if revision > MAX_SAFE_WIRE_REVISION {
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
        .filter(|revision| *revision <= MAX_SAFE_WIRE_REVISION)
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
    canonical_request_fingerprint(&FingerprintPayload {
        base_revision: request.base_revision,
        multi_key: request.multi_key,
        gesture_id: request.gesture_id.as_deref(),
        gesture_ids: &request.gesture_ids,
        changes: &request.changes,
        ops_version: &request.ops_version,
        ops: &request.ops,
    })
}

pub(crate) fn canonical_request_fingerprint(
    payload: &impl Serialize,
) -> Result<RequestFingerprint, EditorCommitError> {
    let value = serde_json::to_value(payload).map_err(|error| {
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
