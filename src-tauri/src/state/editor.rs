use std::collections::{BTreeSet, HashMap, HashSet};

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    defaults::default_keys,
    errors::EditorCommitError,
    models::{
        AppStoreData, CustomTab, EditorBoundsV1, EditorCommitRequest, EditorDocumentV1,
        EditorElementTypeV1, EditorField, ElementShadowSpec, KeyCounters, KeyMappings, KeyPosition,
        KeySlot, EDITOR_COMMIT_SCHEMA_VERSION_V2, EDITOR_OPS_VERSION, EDITOR_SCHEMA_VERSION,
    },
};

pub(crate) const MAX_SAFE_EDITOR_REVISION: u64 = 9_007_199_254_740_991;
pub(crate) const MUTATION_ACK_CAPACITY: usize = 32;
pub(crate) const MAX_CUSTOM_TABS: usize = 30;
pub(crate) const MAX_SLOTS_PER_MEMBER: usize = 16;

const MAX_MUTATION_ID_BYTES: usize = 64;
const MAX_GESTURE_ID_BYTES: usize = 64;
// 프론트 editorCoordinator.ts의 MAX_PENDING_GESTURE_IDS와 동일한 IPC 상한
const MAX_GESTURE_IDS: usize = 32;
const MAX_MODE_ID_BYTES: usize = 128;
const MAX_MODES: usize = 64;
const MAX_ITEMS_PER_MODE: usize = 512;
const MAX_RENDER_ITEMS: usize = 4_096;
pub(crate) const MAX_EDITOR_OPS: usize = 4_096;
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum NativeElementKind {
    Key,
    Stat,
    Graph,
    Knob,
}

#[derive(Debug, Clone, Copy)]
struct NativeElementDiagnostic<'a> {
    kind: NativeElementKind,
    field: &'static str,
    mode: &'a str,
    index: usize,
    id: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum ViolationOwner {
    Mode { mode: String },
    Pair { mode: String },
    GroupOccurrence { mode: String, index: usize },
    DuplicateGroup { mode: String, id: String },
    NativeElement { kind: NativeElementKind, id: String },
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum ViolationPropertyPath {
    ModeId,
    Collection(&'static str),
    PairCollections,
    GroupId,
    GroupReference,
    KnobSensitivity,
    Shadow {
        name: &'static str,
        property: &'static str,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum InvalidValueSignature {
    None,
    Empty,
    FloatBits(u64),
    Text(String),
    PairPresence { keys: bool, key_positions: bool },
    PairLength { keys: usize, key_positions: usize },
    Count(usize),
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct ViolationKey {
    owner: ViolationOwner,
    code: &'static str,
    property_path: ViolationPropertyPath,
    invalid_value: InvalidValueSignature,
}

#[derive(Debug, Clone)]
struct ValidationViolation {
    key: ViolationKey,
    message: String,
}

impl ValidationViolation {
    fn new(key: ViolationKey, message: impl Into<String>) -> Self {
        Self {
            key,
            message: message.into(),
        }
    }

    fn code(&self) -> &'static str {
        self.key.code
    }
}

impl PartialEq for ValidationViolation {
    fn eq(&self, other: &Self) -> bool {
        self.key == other.key
    }
}

impl Eq for ValidationViolation {}

impl PartialOrd for ValidationViolation {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for ValidationViolation {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.key.cmp(&other.key)
    }
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

fn first_unknown_json_key(raw: &Value, canonical: &Value, path: &str) -> Option<String> {
    match (raw, canonical) {
        (Value::Object(raw), Value::Object(canonical)) => raw.iter().find_map(|(key, value)| {
            let child_path = format!("{path}.{key}");
            canonical.get(key).map_or_else(
                || Some(child_path.clone()),
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
        .any(|gesture_id| {
            gesture_id.len() > MAX_GESTURE_ID_BYTES || Uuid::parse_str(gesture_id).is_err()
        })
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
        if group.id.is_empty() || group.id.len() > MAX_GROUP_ID_BYTES {
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
            .is_some_and(|group_id| group_id.is_empty() || group_id.len() > MAX_GROUP_ID_BYTES)
        {
            return Err(EditorCommitError::validation(
                "INVALID_REORDER_GROUP_ID",
                "reorderElements group ID is empty or exceeds its limit",
            ));
        }
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

    if key_positions_touched
        && !keys_touched
        && key_position_id_order(&current.key_positions)
            != key_position_id_order(&candidate.key_positions)
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

fn key_position_id_order(
    collection: &HashMap<String, Vec<KeyPosition>>,
) -> Vec<(String, Vec<String>)> {
    let mut order = collection
        .iter()
        .map(|(mode, positions)| {
            (
                mode.clone(),
                positions
                    .iter()
                    .map(|position| position.id.clone())
                    .collect(),
            )
        })
        .collect::<Vec<_>>();
    order.sort_unstable_by(|left, right| left.0.cmp(&right.0));
    order
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
    let current_violation_keys = current_violations
        .iter()
        .map(|violation| violation.key.clone())
        .collect::<BTreeSet<_>>();
    validate_metric_limits(current, candidate)?;

    if let Some(violation) = candidate_violations.iter().find(|violation| {
        is_unconditional_structural_violation(violation.code())
            || !is_grandfathered(&current_violation_keys, violation)
    }) {
        return Err(EditorCommitError::validation(
            violation.code(),
            violation.message.clone(),
        ));
    }

    Ok(())
}

fn is_grandfathered(
    current_violation_keys: &BTreeSet<ViolationKey>,
    candidate: &ValidationViolation,
) -> bool {
    current_violation_keys.contains(&candidate.key)
}

fn is_unconditional_structural_violation(code: &str) -> bool {
    matches!(
        code,
        "KEY_POSITION_MODE_MISMATCH" | "KEY_POSITION_LENGTH_MISMATCH" | "DUPLICATE_GROUP_ID"
    )
}

fn allowed_modes(store: &AppStoreData) -> HashSet<String> {
    default_keys()
        .keys()
        .cloned()
        .chain(store.custom_tabs.iter().map(|tab| tab.id.clone()))
        .collect()
}

fn native_violation_key(
    kind: NativeElementKind,
    id: &str,
    code: &'static str,
    property_path: ViolationPropertyPath,
    invalid_value: InvalidValueSignature,
) -> ViolationKey {
    ViolationKey {
        owner: ViolationOwner::NativeElement {
            kind,
            id: id.to_string(),
        },
        code,
        property_path,
        invalid_value,
    }
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
                ViolationKey {
                    owner: ViolationOwner::Mode { mode: mode.clone() },
                    code: "INVALID_MODE_ID",
                    property_path: ViolationPropertyPath::ModeId,
                    invalid_value: InvalidValueSignature::Empty,
                },
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
                ViolationKey {
                    owner: ViolationOwner::Pair { mode: mode.clone() },
                    code: "KEY_POSITION_MODE_MISMATCH",
                    property_path: ViolationPropertyPath::PairCollections,
                    invalid_value: InvalidValueSignature::PairPresence {
                        keys: keys.is_some(),
                        key_positions: positions.is_some(),
                    },
                },
                format!("keys and keyPositions must contain the same mode '{mode}'"),
            ));
        }

        let key_count = keys.map_or(0, Vec::len);
        let position_count = positions.map_or(0, Vec::len);
        if key_count != position_count {
            violations.insert(ValidationViolation::new(
                ViolationKey {
                    owner: ViolationOwner::Pair { mode: mode.clone() },
                    code: "KEY_POSITION_LENGTH_MISMATCH",
                    property_path: ViolationPropertyPath::PairCollections,
                    invalid_value: InvalidValueSignature::PairLength {
                        keys: key_count,
                        key_positions: position_count,
                    },
                },
                format!("keys and keyPositions for mode '{mode}' have different lengths"),
            ));
        }
    }

    for (mode, positions) in &document.knob_positions {
        for (index, position) in positions.iter().enumerate() {
            if !position.sensitivity.is_finite() {
                violations.insert(ValidationViolation::new(
                    native_violation_key(
                        NativeElementKind::Knob,
                        &position.position.id,
                        "INVALID_NUMBER",
                        ViolationPropertyPath::KnobSensitivity,
                        InvalidValueSignature::FloatBits(position.sensitivity.to_bits()),
                    ),
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
    for (kind, field, mode, index, position) in document
        .key_positions
        .iter()
        .flat_map(|(mode, positions)| {
            positions.iter().enumerate().map(move |(index, position)| {
                (
                    NativeElementKind::Key,
                    "keyPositions",
                    mode,
                    index,
                    position,
                )
            })
        })
        .chain(
            document
                .stat_positions
                .iter()
                .flat_map(|(mode, positions)| {
                    positions.iter().enumerate().map(move |(index, position)| {
                        (
                            NativeElementKind::Stat,
                            "statPositions",
                            mode,
                            index,
                            &position.position,
                        )
                    })
                }),
        )
        .chain(
            document
                .graph_positions
                .iter()
                .flat_map(|(mode, positions)| {
                    positions.iter().enumerate().map(move |(index, position)| {
                        (
                            NativeElementKind::Graph,
                            "graphPositions",
                            mode,
                            index,
                            &position.position,
                        )
                    })
                }),
        )
        .chain(
            document
                .knob_positions
                .iter()
                .flat_map(|(mode, positions)| {
                    positions.iter().enumerate().map(move |(index, position)| {
                        (
                            NativeElementKind::Knob,
                            "knobPositions",
                            mode,
                            index,
                            &position.position,
                        )
                    })
                }),
        )
    {
        for (name, shadow) in [
            ("shadow", position.shadow.as_ref()),
            ("activeShadow", position.active_shadow.as_ref()),
        ] {
            if let Some(shadow) = shadow {
                collect_shadow_violations(
                    NativeElementDiagnostic {
                        kind,
                        field,
                        mode,
                        index,
                        id: &position.id,
                    },
                    name,
                    shadow,
                    violations,
                );
            }
        }
    }
}

fn collect_shadow_violations(
    element: NativeElementDiagnostic<'_>,
    name: &'static str,
    shadow: &ElementShadowSpec,
    violations: &mut BTreeSet<ValidationViolation>,
) {
    let NativeElementDiagnostic {
        kind,
        field,
        mode,
        index,
        id,
    } = element;
    if shadow.color.is_empty() {
        violations.insert(ValidationViolation::new(
            native_violation_key(
                kind,
                id,
                "INVALID_ELEMENT_SHADOW",
                ViolationPropertyPath::Shadow {
                    name,
                    property: "color",
                },
                InvalidValueSignature::Empty,
            ),
            format!("{field} {mode}[{index}].{name}.color must be a non-empty string"),
        ));
    }
    for (property, value) in [("offsetX", shadow.offset_x), ("offsetY", shadow.offset_y)] {
        if !value.is_finite() || !(MIN_SHADOW_OFFSET..=MAX_SHADOW_OFFSET).contains(&value) {
            violations.insert(ValidationViolation::new(
                native_violation_key(
                    kind,
                    id,
                    "INVALID_ELEMENT_SHADOW",
                    ViolationPropertyPath::Shadow { name, property },
                    InvalidValueSignature::FloatBits(value.to_bits()),
                ),
                format!(
                    "{field} {mode}[{index}].{name}.{property} must be a finite number between {MIN_SHADOW_OFFSET} and {MAX_SHADOW_OFFSET}"
                ),
            ));
        }
    }
    if !shadow.blur.is_finite() || !(MIN_SHADOW_BLUR..=MAX_SHADOW_BLUR).contains(&shadow.blur) {
        violations.insert(ValidationViolation::new(
            native_violation_key(
                kind,
                id,
                "INVALID_ELEMENT_SHADOW",
                ViolationPropertyPath::Shadow {
                    name,
                    property: "blur",
                },
                InvalidValueSignature::FloatBits(shadow.blur.to_bits()),
            ),
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
                ViolationKey {
                    owner: ViolationOwner::Mode { mode: mode.clone() },
                    code: "UNKNOWN_MODE",
                    property_path: ViolationPropertyPath::Collection(field),
                    invalid_value: InvalidValueSignature::None,
                },
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
    validate_aggregate_metric_limits(current, candidate)?;
    validate_mode_metric_limits(current, candidate)?;
    validate_per_owner_metric_limits(current, candidate)
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

fn validate_per_owner_metric_limits(
    current: &EditorDocumentV1,
    candidate: &EditorDocumentV1,
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
            let current_slot = candidate
                .key_positions
                .get(mode)
                .and_then(|positions| positions.get(slot_index))
                .and_then(|position| current_key_slots.get(position.id.as_str()))
                .copied();
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
                current_key_positions.get(position.id.as_str()).copied(),
                position,
            )?;
        }
    }

    let current_stat_positions = current
        .stat_positions
        .values()
        .flatten()
        .map(|position| (position.position.id.as_str(), &position.position))
        .collect::<HashMap<_, _>>();
    for (mode, positions) in &candidate.stat_positions {
        for (index, position) in positions.iter().enumerate() {
            validate_position_metrics(
                "statPositions",
                mode,
                index,
                current_stat_positions
                    .get(position.position.id.as_str())
                    .copied(),
                &position.position,
            )?;
        }
    }

    let current_graph_positions = current
        .graph_positions
        .values()
        .flatten()
        .map(|position| (position.position.id.as_str(), &position.position))
        .collect::<HashMap<_, _>>();
    for (mode, positions) in &candidate.graph_positions {
        for (index, position) in positions.iter().enumerate() {
            validate_position_metrics(
                "graphPositions",
                mode,
                index,
                current_graph_positions
                    .get(position.position.id.as_str())
                    .copied(),
                &position.position,
            )?;
        }
    }

    let current_knob_positions = current
        .knob_positions
        .values()
        .flatten()
        .map(|position| (position.position.id.as_str(), &position.position))
        .collect::<HashMap<_, _>>();
    for (mode, positions) in &candidate.knob_positions {
        for (index, position) in positions.iter().enumerate() {
            validate_position_metrics(
                "knobPositions",
                mode,
                index,
                current_knob_positions
                    .get(position.position.id.as_str())
                    .copied(),
                &position.position,
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
) -> Result<(), EditorCommitError> {
    validate_bounds_metrics(
        &format!("{field} {mode}[{index}]"),
        current.map(position_bounds),
        position_bounds(candidate),
    )
}

fn position_bounds(position: &KeyPosition) -> EditorBoundsV1 {
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
) -> Result<(), EditorCommitError> {
    for (name, current, candidate) in [
        ("dx", current.map(|bounds| bounds.dx), candidate.dx),
        ("dy", current.map(|bounds| bounds.dy), candidate.dy),
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

fn collect_group_violations(
    document: &EditorDocumentV1,
    violations: &mut BTreeSet<ValidationViolation>,
) -> HashMap<String, HashSet<String>> {
    let mut result = HashMap::new();
    for (mode, groups) in &document.layer_groups {
        let mut ids = HashSet::new();
        let mut counts = HashMap::new();
        for (index, group) in groups.iter().enumerate() {
            if group.id.is_empty() {
                violations.insert(ValidationViolation::new(
                    ViolationKey {
                        owner: ViolationOwner::GroupOccurrence {
                            mode: mode.clone(),
                            index,
                        },
                        code: "INVALID_GROUP_ID",
                        property_path: ViolationPropertyPath::GroupId,
                        invalid_value: InvalidValueSignature::Empty,
                    },
                    format!("layer group id at {mode}[{index}] is empty"),
                ));
            }
            ids.insert(group.id.clone());
            *counts.entry(group.id.clone()).or_insert(0usize) += 1;
        }
        for (id, count) in counts.into_iter().filter(|(_, count)| *count > 1) {
            violations.insert(ValidationViolation::new(
                ViolationKey {
                    owner: ViolationOwner::DuplicateGroup {
                        mode: mode.clone(),
                        id: id.clone(),
                    },
                    code: "DUPLICATE_GROUP_ID",
                    property_path: ViolationPropertyPath::GroupId,
                    invalid_value: InvalidValueSignature::Count(count),
                },
                format!("layer group id '{id}' is duplicated {count} times in mode '{mode}'"),
            ));
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
    for (kind, field, mode, index, position) in document
        .key_positions
        .iter()
        .flat_map(|(mode, positions)| {
            positions.iter().enumerate().map(move |(index, position)| {
                (
                    NativeElementKind::Key,
                    "keyPositions",
                    mode,
                    index,
                    position,
                )
            })
        })
        .chain(
            document
                .stat_positions
                .iter()
                .flat_map(|(mode, positions)| {
                    positions.iter().enumerate().map(move |(index, position)| {
                        (
                            NativeElementKind::Stat,
                            "statPositions",
                            mode,
                            index,
                            &position.position,
                        )
                    })
                }),
        )
        .chain(
            document
                .graph_positions
                .iter()
                .flat_map(|(mode, positions)| {
                    positions.iter().enumerate().map(move |(index, position)| {
                        (
                            NativeElementKind::Graph,
                            "graphPositions",
                            mode,
                            index,
                            &position.position,
                        )
                    })
                }),
        )
        .chain(
            document
                .knob_positions
                .iter()
                .flat_map(|(mode, positions)| {
                    positions.iter().enumerate().map(move |(index, position)| {
                        (
                            NativeElementKind::Knob,
                            "knobPositions",
                            mode,
                            index,
                            &position.position,
                        )
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
                native_violation_key(
                    kind,
                    &position.id,
                    "UNKNOWN_GROUP_ID",
                    ViolationPropertyPath::GroupReference,
                    InvalidValueSignature::Text(group_id.to_string()),
                ),
                format!("{field} {mode}[{index}] references unknown group '{group_id}'"),
            ));
        }
    }
}

pub(crate) fn sync_key_counters(counters: &mut KeyCounters, keys: &KeyMappings) {
    for (mode, key_list) in keys {
        let entry = counters.entry(mode.clone()).or_default();
        let canonical_keys = key_list
            .iter()
            .map(KeySlot::canonical)
            .collect::<HashSet<_>>();
        entry.retain(|key, _| canonical_keys.contains(key));
        for key in canonical_keys {
            entry.entry(key).or_insert(0);
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
        CustomTab, EditorBoundsV1, EditorCommitRequest, EditorDocumentV1,
        EditorElementPropertyPatchV1, EditorElementTypeV1, EditorFrozenKeySlotV1,
        EditorGroupUpdateV1, EditorOpResultStatusV1, EditorOpResultV1, EditorOpV1, EditorPatchV1,
        EditorZUpdateV1, ElementShadowSpec, GraphPosition, GraphStatType, GraphType, KeyPosition,
        KnobPosition, LayerGroupDef, StatPosition, StatType,
    };

    use super::*;

    fn request(keys: KeyMappings) -> EditorCommitRequest {
        EditorCommitRequest {
            base_revision: 0,
            mutation_id: Uuid::new_v4().to_string(),
            multi_key: false,
            gesture_id: None,
            gesture_ids: Vec::new(),
            changes: Some(EditorPatchV1 {
                keys: Some(keys),
                ..EditorPatchV1::default()
            }),
            ops_version: None,
            ops: None,
        }
    }

    fn ops_request(ops: Vec<EditorOpV1>) -> EditorCommitRequest {
        EditorCommitRequest {
            base_revision: 0,
            mutation_id: Uuid::new_v4().to_string(),
            multi_key: false,
            gesture_id: None,
            gesture_ids: Vec::new(),
            changes: None,
            ops_version: Some(EDITOR_OPS_VERSION),
            ops: Some(ops),
        }
    }

    fn set_bounds_op(id: impl Into<String>, element_type: EditorElementTypeV1) -> EditorOpV1 {
        EditorOpV1::SetBounds {
            element_type,
            id: id.into(),
            bounds: EditorBoundsV1 {
                dx: 10.0,
                dy: 20.0,
                width: 100.0,
                height: 50.0,
            },
        }
    }

    fn delete_element_op(id: impl Into<String>, element_type: EditorElementTypeV1) -> EditorOpV1 {
        EditorOpV1::DeleteElement {
            element_type,
            id: id.into(),
        }
    }

    fn patch_hidden_op(id: impl Into<String>, element_type: EditorElementTypeV1) -> EditorOpV1 {
        EditorOpV1::PatchElement {
            element_type,
            id: id.into(),
            patch: EditorElementPropertyPatchV1::Hidden(
                crate::models::EditorHiddenPropertyPatchV1 { hidden: true },
            ),
        }
    }

    fn frozen_insert_op(id: impl Into<String>) -> EditorOpV1 {
        EditorOpV1::InsertFrozenElements {
            mode: "4key".to_string(),
            elements: vec![crate::models::EditorFrozenElementV1::Key {
                slot: crate::models::EditorFrozenKeySlotV1::Single("FROZEN".to_string()),
                position: KeyPosition {
                    id: id.into(),
                    ..KeyPosition::default()
                },
            }],
            groups: Vec::new(),
            z_updates: Vec::new(),
        }
    }

    fn reorder_op(id: impl Into<String>, complete_mode_order: bool) -> EditorOpV1 {
        EditorOpV1::ReorderElements {
            mode: "4key".to_string(),
            complete_mode_order,
            z_updates: vec![EditorZUpdateV1 {
                element_type: EditorElementTypeV1::Key,
                id: id.into(),
                z_index: 7,
            }],
            group_updates: Vec::new(),
        }
    }

    fn validation_code(error: &EditorCommitError) -> Option<&str> {
        error
            .details
            .as_ref()
            .and_then(|details| details.validation_code.as_deref())
    }

    fn default_editor_store() -> AppStoreData {
        let mut store = AppStoreData {
            keys: crate::defaults::default_keys().clone(),
            key_positions: crate::defaults::default_positions().clone(),
            ..AppStoreData::default()
        };
        crate::state::native_element_id::backfill_store_element_ids(&mut store);
        store
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
        crate::state::native_element_id::backfill_store_element_ids(&mut store);
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
        left.insert("4key".to_string(), vec![KeySlot::from("A")]);
        left.insert("5key".to_string(), vec![KeySlot::from("B")]);

        let mut right = HashMap::new();
        right.insert("5key".to_string(), vec![KeySlot::from("B")]);
        right.insert("4key".to_string(), vec![KeySlot::from("A")]);

        assert_eq!(
            request_fingerprint(&request(left)).unwrap(),
            request_fingerprint(&request(right)).unwrap()
        );
    }

    #[test]
    fn canonical_fingerprint_includes_multi_key_capability() {
        let mut legacy = request(KeyMappings::new());
        let mut capable = legacy.clone();
        capable.multi_key = true;

        assert_ne!(
            request_fingerprint(&legacy).unwrap(),
            request_fingerprint(&capable).unwrap()
        );

        legacy.multi_key = true;
        assert_eq!(
            request_fingerprint(&legacy).unwrap(),
            request_fingerprint(&capable).unwrap()
        );
    }

    #[test]
    fn commit_envelope_defaults_multi_key_to_false() {
        let request = request(KeyMappings::new());
        let mut wire = serde_json::to_value(request).unwrap();
        wire.as_object_mut().unwrap().remove("multiKey");

        let decoded: EditorCommitRequest = serde_json::from_value(wire).unwrap();

        assert!(!decoded.multi_key);
        let mut capable = decoded;
        capable.multi_key = true;
        let encoded = serde_json::to_value(capable).unwrap();
        assert_eq!(encoded["multiKey"], true);
        assert!(encoded.get("opsVersion").is_none());
        assert!(encoded.get("ops").is_none());
    }

    #[test]
    fn editor_commit_wire_requires_exactly_one_mutation_shape() {
        let base = serde_json::json!({
            "baseRevision": 0,
            "mutationId": Uuid::new_v4().to_string(),
        });
        let changes = serde_json::json!({ "schemaVersion": EDITOR_SCHEMA_VERSION });
        let op = serde_json::json!({
            "kind": "setBounds",
            "elementType": "key",
            "id": Uuid::new_v4().to_string(),
            "bounds": { "dx": 0.0, "dy": 0.0, "width": 1.0, "height": 1.0 },
        });

        let mut patch_wire = base.clone();
        patch_wire["changes"] = changes.clone();
        let patch = decode_editor_commit_request(patch_wire).unwrap();
        assert!(patch.changes.is_some());
        assert!(patch.ops.is_none());

        let mut ops_wire = base.clone();
        ops_wire["opsVersion"] = serde_json::json!(EDITOR_OPS_VERSION);
        ops_wire["ops"] = serde_json::json!([op.clone()]);
        let ops = decode_editor_commit_request(ops_wire).unwrap();
        assert!(ops.changes.is_none());
        assert_eq!(ops.ops.unwrap().len(), 1);

        let encoded = serde_json::to_value(ops_request(vec![set_bounds_op(
            Uuid::new_v4().to_string(),
            EditorElementTypeV1::Key,
        )]))
        .unwrap();
        assert_eq!(encoded["ops"][0]["kind"], "setBounds");
        assert_eq!(encoded["ops"][0]["elementType"], "key");
        assert!(encoded.get("changes").is_none());

        let delete_id = Uuid::new_v4().to_string();
        let delete_wire = serde_json::json!({
            "baseRevision": 0,
            "mutationId": Uuid::new_v4().to_string(),
            "opsVersion": EDITOR_OPS_VERSION,
            "ops": [{
                "kind": "deleteElement",
                "elementType": "graph",
                "id": delete_id,
            }],
        });
        let delete = decode_editor_commit_request(delete_wire).unwrap();
        assert_eq!(
            delete.ops,
            Some(vec![delete_element_op(
                delete_id,
                EditorElementTypeV1::Graph,
            )])
        );
        let encoded_delete = serde_json::to_value(delete).unwrap();
        assert_eq!(encoded_delete["ops"][0]["kind"], "deleteElement");
        assert_eq!(encoded_delete["ops"][0]["elementType"], "graph");
        assert!(encoded_delete["ops"][0].get("bounds").is_none());

        let mut both = base.clone();
        both["changes"] = changes;
        both["opsVersion"] = serde_json::json!(EDITOR_OPS_VERSION);
        both["ops"] = serde_json::json!([op.clone()]);
        let error = decode_editor_commit_request(both).unwrap_err();
        assert_eq!(validation_code(&error), Some("INVALID_EDITOR_MUTATION"));

        for wire in [
            base.clone(),
            serde_json::json!({
                "baseRevision": 0,
                "mutationId": Uuid::new_v4().to_string(),
                "opsVersion": EDITOR_OPS_VERSION,
            }),
            serde_json::json!({
                "baseRevision": 0,
                "mutationId": Uuid::new_v4().to_string(),
                "opsVersion": EDITOR_OPS_VERSION,
                "ops": null,
            }),
            serde_json::json!({
                "baseRevision": 0,
                "mutationId": Uuid::new_v4().to_string(),
                "changes": null,
                "opsVersion": EDITOR_OPS_VERSION,
                "ops": [op],
            }),
        ] {
            let error = decode_editor_commit_request(wire).unwrap_err();
            assert_eq!(validation_code(&error), Some("INVALID_EDITOR_MUTATION"));
        }
    }

    #[test]
    fn editor_commit_wire_rejects_unknown_keys_at_each_new_boundary() {
        let valid_id = Uuid::new_v4().to_string();
        let valid = serde_json::json!({
            "baseRevision": 0,
            "mutationId": Uuid::new_v4().to_string(),
            "opsVersion": EDITOR_OPS_VERSION,
            "ops": [{
                "kind": "setBounds",
                "elementType": "key",
                "id": valid_id,
                "bounds": { "dx": 0.0, "dy": 0.0, "width": 1.0, "height": 1.0 },
            }],
        });

        let mut unknown_top_level = valid.clone();
        unknown_top_level["mode"] = serde_json::json!("4key");
        let mut unknown_op_key = valid.clone();
        unknown_op_key["ops"][0]["mode"] = serde_json::json!("4key");
        let mut unknown_bounds_key = valid.clone();
        unknown_bounds_key["ops"][0]["bounds"]["x"] = serde_json::json!(0);

        for wire in [unknown_top_level, unknown_op_key, unknown_bounds_key] {
            let error = decode_editor_commit_request(wire).unwrap_err();
            assert_eq!(validation_code(&error), Some("INVALID_REQUEST_PAYLOAD"));
        }

        for (field, value) in [
            ("kind", serde_json::json!("move")),
            ("elementType", serde_json::json!("Key")),
        ] {
            let mut wire = valid.clone();
            wire["ops"][0][field] = value;
            let error = decode_editor_commit_request(wire).unwrap_err();
            assert_eq!(validation_code(&error), Some("INVALID_REQUEST_PAYLOAD"));
        }

        let delete_with_bounds = serde_json::json!({
            "baseRevision": 0,
            "mutationId": Uuid::new_v4().to_string(),
            "opsVersion": EDITOR_OPS_VERSION,
            "ops": [{
                "kind": "deleteElement",
                "elementType": "key",
                "id": Uuid::new_v4().to_string(),
                "bounds": { "dx": 0.0, "dy": 0.0, "width": 1.0, "height": 1.0 },
            }],
        });
        let error = decode_editor_commit_request(delete_with_bounds).unwrap_err();
        assert_eq!(validation_code(&error), Some("INVALID_REQUEST_PAYLOAD"));
    }

    #[test]
    fn property_and_key_slot_wires_are_exact_and_canonical() {
        let property = serde_json::to_value(ops_request(vec![patch_hidden_op(
            Uuid::new_v4().to_string(),
            EditorElementTypeV1::Graph,
        )]))
        .unwrap();
        assert_eq!(property["ops"][0]["kind"], "patchElement");
        assert_eq!(
            property["ops"][0]["patch"],
            serde_json::json!({ "hidden": true })
        );
        decode_editor_commit_request(property.clone()).unwrap();

        let layer_name = serde_json::to_value(ops_request(vec![EditorOpV1::PatchElement {
            element_type: EditorElementTypeV1::Knob,
            id: Uuid::new_v4().to_string(),
            patch: EditorElementPropertyPatchV1::LayerName(
                crate::models::EditorLayerNamePropertyPatchV1 { layer_name: None },
            ),
        }]))
        .unwrap();
        assert_eq!(
            layer_name["ops"][0]["patch"],
            serde_json::json!({ "layerName": null })
        );
        decode_editor_commit_request(layer_name.clone()).unwrap();

        let graph_type = serde_json::to_value(ops_request(vec![EditorOpV1::PatchElement {
            element_type: EditorElementTypeV1::Graph,
            id: Uuid::new_v4().to_string(),
            patch: EditorElementPropertyPatchV1::GraphType(
                crate::models::EditorGraphTypePropertyPatchV1 {
                    graph_type: GraphType::Bar,
                },
            ),
        }]))
        .unwrap();
        assert_eq!(
            graph_type["ops"][0]["patch"],
            serde_json::json!({ "graphType": "bar" })
        );
        decode_editor_commit_request(graph_type.clone()).unwrap();

        let graph_color = serde_json::to_value(ops_request(vec![EditorOpV1::PatchElement {
            element_type: EditorElementTypeV1::Graph,
            id: Uuid::new_v4().to_string(),
            patch: EditorElementPropertyPatchV1::GraphColor(
                crate::models::EditorGraphColorPropertyPatchV1 {
                    graph_color: "not-normalized".to_string(),
                },
            ),
        }]))
        .unwrap();
        assert_eq!(
            graph_color["ops"][0]["patch"],
            serde_json::json!({ "graphColor": "not-normalized" })
        );
        decode_editor_commit_request(graph_color.clone()).unwrap();

        let paint = serde_json::to_value(ops_request(vec![EditorOpV1::PatchElement {
            element_type: EditorElementTypeV1::Key,
            id: Uuid::new_v4().to_string(),
            patch: EditorElementPropertyPatchV1::BackgroundPaint(
                crate::models::EditorBackgroundPaintPropertyPatchV1 {
                    background_paint: crate::models::EditorPaintDescriptorV1 {
                        color: "first".to_string(),
                        gradient: Some(crate::models::EditorPaintGradientV1 {
                            angle: 45.0,
                            stops: vec![
                                crate::models::EditorPaintGradientStopV1 {
                                    color: "first".to_string(),
                                    pos: 0.0,
                                },
                                crate::models::EditorPaintGradientStopV1 {
                                    color: "last".to_string(),
                                    pos: 1.0,
                                },
                            ],
                        }),
                    },
                },
            ),
        }]))
        .unwrap();
        assert_eq!(
            paint["ops"][0]["patch"],
            serde_json::json!({
                "backgroundPaint": {
                    "color": "first",
                    "gradient": {
                        "angle": 45.0,
                        "stops": [
                            { "color": "first", "pos": 0.0 },
                            { "color": "last", "pos": 1.0 }
                        ]
                    }
                }
            })
        );
        decode_editor_commit_request(paint.clone()).unwrap();

        let literal_properties = [
            (
                EditorElementTypeV1::Graph,
                EditorElementPropertyPatchV1::ShowAvgLine(
                    crate::models::EditorShowAvgLinePropertyPatchV1 {
                        show_avg_line: false,
                    },
                ),
                serde_json::json!({ "showAvgLine": false }),
            ),
            (
                EditorElementTypeV1::Graph,
                EditorElementPropertyPatchV1::GraphAnimationEnabled(
                    crate::models::EditorGraphAnimationEnabledPropertyPatchV1 {
                        graph_animation_enabled: true,
                    },
                ),
                serde_json::json!({ "graphAnimationEnabled": true }),
            ),
            (
                EditorElementTypeV1::Graph,
                EditorElementPropertyPatchV1::GraphSpeed(
                    crate::models::EditorGraphSpeedPropertyPatchV1 {
                        graph_speed: u32::MAX,
                    },
                ),
                serde_json::json!({ "graphSpeed": u32::MAX }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::Reverse(
                    crate::models::EditorReversePropertyPatchV1 { reverse: true },
                ),
                serde_json::json!({ "reverse": true }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::Sensitivity(
                    crate::models::EditorSensitivityPropertyPatchV1 { sensitivity: -7.25 },
                ),
                serde_json::json!({ "sensitivity": -7.25 }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::AxisId(crate::models::EditorAxisIdPropertyPatchV1 {
                    axis_id: "  HIDA:raw  ".to_string(),
                }),
                serde_json::json!({ "axisId": "  HIDA:raw  " }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::UseInlineStyles(
                    crate::models::EditorUseInlineStylesPropertyPatchV1 {
                        use_inline_styles: false,
                    },
                ),
                serde_json::json!({ "useInlineStyles": false }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::FontWeight(
                    crate::models::EditorFontWeightPropertyPatchV1 {
                        font_weight: u32::MAX,
                    },
                ),
                serde_json::json!({ "fontWeight": u32::MAX }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::FontItalic(
                    crate::models::EditorFontItalicPropertyPatchV1 { font_italic: false },
                ),
                serde_json::json!({ "fontItalic": false }),
            ),
            (
                EditorElementTypeV1::Graph,
                EditorElementPropertyPatchV1::FontUnderline(
                    crate::models::EditorFontUnderlinePropertyPatchV1 {
                        font_underline: true,
                    },
                ),
                serde_json::json!({ "fontUnderline": true }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::FontStrikethrough(
                    crate::models::EditorFontStrikethroughPropertyPatchV1 {
                        font_strikethrough: false,
                    },
                ),
                serde_json::json!({ "fontStrikethrough": false }),
            ),
            (
                EditorElementTypeV1::Graph,
                EditorElementPropertyPatchV1::FontFamily(
                    crate::models::EditorFontFamilyPropertyPatchV1 {
                        font_family: " raw-font ".to_string(),
                    },
                ),
                serde_json::json!({ "fontFamily": " raw-font " }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::DisplayText(
                    crate::models::EditorDisplayTextPropertyPatchV1 {
                        display_text: "  raw display  ".to_string(),
                    },
                ),
                serde_json::json!({ "displayText": "  raw display  " }),
            ),
            (
                EditorElementTypeV1::Graph,
                EditorElementPropertyPatchV1::ClassName(
                    crate::models::EditorClassNamePropertyPatchV1 {
                        class_name: "  raw class  ".to_string(),
                    },
                ),
                serde_json::json!({ "className": "  raw class  " }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::Shadow(crate::models::EditorShadowPropertyPatchV1 {
                    shadow: crate::models::EditorShadowLeafPatchV1::OffsetX(
                        crate::models::EditorShadowOffsetXLeafPatchV1 { offset_x: -12.5 },
                    ),
                }),
                serde_json::json!({ "shadow": { "offsetX": -12.5 } }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::ActiveShadow(
                    crate::models::EditorActiveShadowPropertyPatchV1 {
                        active_shadow: crate::models::EditorShadowLeafPatchV1::Color(
                            crate::models::EditorShadowColorLeafPatchV1 {
                                color: " raw-shadow ".to_string(),
                            },
                        ),
                    },
                ),
                serde_json::json!({ "activeShadow": { "color": " raw-shadow " } }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::ShadowEnabled(
                    crate::models::EditorShadowEnabledPropertyPatchV1 {
                        shadow_enabled: false,
                    },
                ),
                serde_json::json!({ "shadowEnabled": false }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::BorderWidth(
                    crate::models::EditorBorderWidthPropertyPatchV1 { border_width: 0.5 },
                ),
                serde_json::json!({ "borderWidth": 0.5 }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::BorderRadius(
                    crate::models::EditorBorderRadiusPropertyPatchV1 {
                        border_radius: 999.0,
                    },
                ),
                serde_json::json!({ "borderRadius": 999.0 }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::FontSize(
                    crate::models::EditorFontSizePropertyPatchV1 { font_size: 8.5 },
                ),
                serde_json::json!({ "fontSize": 8.5 }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::InactiveImage(
                    crate::models::EditorInactiveImagePropertyPatchV1 {
                        inactive_image: "  raw/path.png  ".to_string(),
                    },
                ),
                serde_json::json!({ "inactiveImage": "  raw/path.png  " }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::ActiveImage(
                    crate::models::EditorActiveImagePropertyPatchV1 {
                        active_image: "  raw/active.png  ".to_string(),
                    },
                ),
                serde_json::json!({ "activeImage": "  raw/active.png  " }),
            ),
            (
                EditorElementTypeV1::Graph,
                EditorElementPropertyPatchV1::IdleTransparent(
                    crate::models::EditorIdleTransparentPropertyPatchV1 {
                        idle_transparent: true,
                    },
                ),
                serde_json::json!({ "idleTransparent": true }),
            ),
            (
                EditorElementTypeV1::Knob,
                EditorElementPropertyPatchV1::ActiveTransparent(
                    crate::models::EditorActiveTransparentPropertyPatchV1 {
                        active_transparent: false,
                    },
                ),
                serde_json::json!({ "activeTransparent": false }),
            ),
            (
                EditorElementTypeV1::Graph,
                EditorElementPropertyPatchV1::IdleImageFit(
                    crate::models::EditorIdleImageFitPropertyPatchV1 {
                        idle_image_fit: crate::models::ImageFit::Contain,
                    },
                ),
                serde_json::json!({ "idleImageFit": "contain" }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::ActiveImageFit(
                    crate::models::EditorActiveImageFitPropertyPatchV1 {
                        active_image_fit: crate::models::ImageFit::None,
                    },
                ),
                serde_json::json!({ "activeImageFit": "none" }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::SoundPath(
                    crate::models::EditorSoundPathPropertyPatchV1 {
                        sound_path: "  raw/sound.wav  ".to_string(),
                    },
                ),
                serde_json::json!({ "soundPath": "  raw/sound.wav  " }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::SoundEnabled(
                    crate::models::EditorSoundEnabledPropertyPatchV1 {
                        sound_enabled: false,
                    },
                ),
                serde_json::json!({ "soundEnabled": false }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::SoundVolume(
                    crate::models::EditorSoundVolumePropertyPatchV1 {
                        sound_volume: 137.5,
                    },
                ),
                serde_json::json!({ "soundVolume": 137.5 }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::CounterEnabled(
                    crate::models::EditorCounterEnabledPropertyPatchV1 {
                        counter_enabled: false,
                    },
                ),
                serde_json::json!({ "counterEnabled": false }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterAnimationEnabled(
                    crate::models::EditorCounterAnimationEnabledPropertyPatchV1 {
                        counter_animation_enabled: true,
                    },
                ),
                serde_json::json!({ "counterAnimationEnabled": true }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::CounterPlacement(
                    crate::models::EditorCounterPlacementPropertyPatchV1 {
                        counter_placement: crate::models::KeyCounterPlacement::Outside,
                    },
                ),
                serde_json::json!({ "counterPlacement": "outside" }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterAlign(
                    crate::models::EditorCounterAlignPropertyPatchV1 {
                        counter_align: crate::models::KeyCounterAlign::Left,
                    },
                ),
                serde_json::json!({ "counterAlign": "left" }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::CounterAlignMode(
                    crate::models::EditorCounterAlignModePropertyPatchV1 {
                        counter_align_mode: crate::models::KeyCounterAlignMode::Between,
                    },
                ),
                serde_json::json!({ "counterAlignMode": "between" }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterGap(
                    crate::models::EditorCounterGapPropertyPatchV1 {
                        counter_gap: u32::MAX,
                    },
                ),
                serde_json::json!({ "counterGap": u32::MAX }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::CounterFontSize(
                    crate::models::EditorCounterFontSizePropertyPatchV1 {
                        counter_font_size: 72,
                    },
                ),
                serde_json::json!({ "counterFontSize": 72 }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterFontWeight(
                    crate::models::EditorCounterFontWeightPropertyPatchV1 {
                        counter_font_weight: 900,
                    },
                ),
                serde_json::json!({ "counterFontWeight": 900 }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::CounterFontItalic(
                    crate::models::EditorCounterFontItalicPropertyPatchV1 {
                        counter_font_italic: true,
                    },
                ),
                serde_json::json!({ "counterFontItalic": true }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterFontUnderline(
                    crate::models::EditorCounterFontUnderlinePropertyPatchV1 {
                        counter_font_underline: true,
                    },
                ),
                serde_json::json!({ "counterFontUnderline": true }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::CounterFontStrikethrough(
                    crate::models::EditorCounterFontStrikethroughPropertyPatchV1 {
                        counter_font_strikethrough: true,
                    },
                ),
                serde_json::json!({ "counterFontStrikethrough": true }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterFontFamily(
                    crate::models::EditorCounterFontFamilyPropertyPatchV1 {
                        counter_font_family: "  raw-counter-font  ".to_string(),
                    },
                ),
                serde_json::json!({ "counterFontFamily": "  raw-counter-font  " }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterFillIdle(
                    crate::models::EditorCounterFillIdlePropertyPatchV1 {
                        counter_fill_idle: crate::models::EditorCounterFillIntentV1::Solid(
                            crate::models::EditorCounterFillSolidIntentV1 {
                                color: "  raw solid  ".to_string(),
                            },
                        ),
                    },
                ),
                serde_json::json!({ "counterFillIdle": { "color": "  raw solid  " } }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::CounterFillActive(
                    crate::models::EditorCounterFillActivePropertyPatchV1 {
                        counter_fill_active: crate::models::EditorCounterFillIntentV1::Gradient(
                            crate::models::EditorCounterFillGradientIntentV1 {
                                color: "rgba(1,2,3,0.5)".to_string(),
                                gradient: crate::models::EditorPaintGradientV1 {
                                    angle: 90.0,
                                    stops: vec![
                                        crate::models::EditorPaintGradientStopV1 {
                                            color: "rgba(1, 2, 3, 0.5)".to_string(),
                                            pos: 0.0,
                                        },
                                        crate::models::EditorPaintGradientStopV1 {
                                            color: "transparent".to_string(),
                                            pos: 1.0,
                                        },
                                    ],
                                },
                            },
                        ),
                    },
                ),
                serde_json::json!({
                    "counterFillActive": {
                        "color": "rgba(1,2,3,0.5)",
                        "gradient": {
                            "angle": 90.0,
                            "stops": [
                                { "color": "rgba(1, 2, 3, 0.5)", "pos": 0.0 },
                                { "color": "transparent", "pos": 1.0 }
                            ]
                        }
                    }
                }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterStrokeIdle(
                    crate::models::EditorCounterStrokeIdlePropertyPatchV1 {
                        counter_stroke_idle: "  raw-idle-stroke  ".to_string(),
                    },
                ),
                serde_json::json!({ "counterStrokeIdle": "  raw-idle-stroke  " }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::CounterStrokeActive(
                    crate::models::EditorCounterStrokeActivePropertyPatchV1 {
                        counter_stroke_active: String::new(),
                    },
                ),
                serde_json::json!({ "counterStrokeActive": "" }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::CounterAnimationPreset(
                    crate::models::EditorCounterAnimationPresetPropertyPatchV1 {
                        counter_animation_preset:
                            crate::models::EditorCounterAnimationPresetIntentV1 {
                                preset_id: "user-motion".to_string(),
                                apply_preset_id: Some(true),
                                bezier: Some([0.1, 0.2, 0.8, 0.9]),
                                scale: Some(1.25),
                                duration_ms: Some(420),
                            },
                    },
                ),
                serde_json::json!({
                    "counterAnimationPreset": {
                        "presetId": "user-motion",
                        "applyPresetId": true,
                        "bezier": [0.1, 0.2, 0.8, 0.9],
                        "scale": 1.25,
                        "durationMs": 420
                    }
                }),
            ),
            (
                EditorElementTypeV1::Stat,
                EditorElementPropertyPatchV1::StatType(
                    crate::models::EditorStatTypePropertyPatchV1 {
                        stat_type: StatType::Total,
                    },
                ),
                serde_json::json!({ "statType": "total" }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteEffectEnabled(
                    crate::models::EditorNoteEffectEnabledPropertyPatchV1 {
                        note_effect_enabled: false,
                    },
                ),
                serde_json::json!({ "noteEffectEnabled": false }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteGlowEnabled(
                    crate::models::EditorNoteGlowEnabledPropertyPatchV1 {
                        note_glow_enabled: true,
                    },
                ),
                serde_json::json!({ "noteGlowEnabled": true }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteGlowSize(
                    crate::models::EditorNoteGlowSizePropertyPatchV1 {
                        note_glow_size: 20.5,
                    },
                ),
                serde_json::json!({ "noteGlowSize": 20.5 }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NotePaint(
                    crate::models::EditorNotePaintPropertyPatchV1 {
                        note_paint: crate::models::EditorNotePaintIntentV1::Color(
                            crate::models::EditorNotePaintColorIntentV1 {
                                color: crate::models::EditorNoteColorV1::Gradient(
                                    crate::models::EditorNoteGradientColorV1 {
                                        kind:
                                            crate::models::EditorNoteGradientColorKindV1::Gradient,
                                        top: "top".to_string(),
                                        bottom: "bottom".to_string(),
                                    },
                                ),
                            },
                        ),
                    },
                ),
                serde_json::json!({ "notePaint": { "color": { "type": "gradient", "top": "top", "bottom": "bottom" } } }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteGlowPaint(
                    crate::models::EditorNoteGlowPaintPropertyPatchV1 {
                        note_glow_paint: crate::models::EditorNotePaintIntentV1::GradientOpacity(
                            crate::models::EditorNotePaintGradientOpacityIntentV1 {
                                opacity: 70,
                                opacity_top: 10,
                                opacity_bottom: 90,
                            },
                        ),
                    },
                ),
                serde_json::json!({ "noteGlowPaint": { "opacity": 70, "opacityTop": 10, "opacityBottom": 90 } }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteBorderPaint(
                    crate::models::EditorNoteBorderPaintPropertyPatchV1 {
                        note_border_paint: crate::models::EditorNoteBorderPaintV1 {
                            color: "#A1b2C3".to_string(),
                            opacity: 55,
                        },
                    },
                ),
                serde_json::json!({ "noteBorderPaint": { "color": "#A1b2C3", "opacity": 55 } }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteOffsetX(
                    crate::models::EditorNoteOffsetXPropertyPatchV1 {
                        note_offset_x: None,
                    },
                ),
                serde_json::json!({ "noteOffsetX": null }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteOffsetY(
                    crate::models::EditorNoteOffsetYPropertyPatchV1 {
                        note_offset_y: Some(-12.5),
                    },
                ),
                serde_json::json!({ "noteOffsetY": -12.5 }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteWidth(
                    crate::models::EditorNoteWidthPropertyPatchV1 { note_width: None },
                ),
                serde_json::json!({ "noteWidth": null }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteBorderWidth(
                    crate::models::EditorNoteBorderWidthPropertyPatchV1 {
                        note_border_width: 0.0,
                    },
                ),
                serde_json::json!({ "noteBorderWidth": 0.0 }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteBorderRadius(
                    crate::models::EditorNoteBorderRadiusPropertyPatchV1 {
                        note_border_radius: 4.5,
                    },
                ),
                serde_json::json!({ "noteBorderRadius": 4.5 }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteAutoYCorrection(
                    crate::models::EditorNoteAutoYCorrectionPropertyPatchV1 {
                        note_auto_y_correction: false,
                    },
                ),
                serde_json::json!({ "noteAutoYCorrection": false }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteAlignment(
                    crate::models::EditorNoteAlignmentPropertyPatchV1 {
                        note_alignment: crate::models::NoteAlignment::Right,
                    },
                ),
                serde_json::json!({ "noteAlignment": "right" }),
            ),
            (
                EditorElementTypeV1::Key,
                EditorElementPropertyPatchV1::NoteBorderSide(
                    crate::models::EditorNoteBorderSidePropertyPatchV1 {
                        note_border_side: crate::models::EditorNoteBorderSideV1::All,
                    },
                ),
                serde_json::json!({ "noteBorderSide": "all" }),
            ),
        ];
        for (element_type, patch, expected) in literal_properties {
            let wire = serde_json::to_value(ops_request(vec![EditorOpV1::PatchElement {
                element_type,
                id: Uuid::new_v4().to_string(),
                patch,
            }]))
            .unwrap();
            assert_eq!(wire["ops"][0]["patch"], expected);
            decode_editor_commit_request(wire).unwrap();
        }

        let mut unknown_property = property.clone();
        unknown_property["ops"][0]["patch"]["zIndex"] = serde_json::json!(3);
        let mut unknown_op = property;
        unknown_op["ops"][0]["mode"] = serde_json::json!("4key");
        let mut missing_property = layer_name.clone();
        missing_property["ops"][0]["patch"] = serde_json::json!({});
        let mut multiple_properties = layer_name;
        multiple_properties["ops"][0]["patch"]["hidden"] = serde_json::json!(true);
        let mut invalid_graph_type = graph_type;
        invalid_graph_type["ops"][0]["patch"]["graphType"] = serde_json::json!("area");
        let mut invalid_graph_color = graph_color.clone();
        invalid_graph_color["ops"][0]["patch"]["graphColor"] = serde_json::json!(42);
        let invalid_literal_properties = [
            serde_json::json!({ "showAvgLine": 1 }),
            serde_json::json!({ "graphAnimationEnabled": null }),
            serde_json::json!({ "graphSpeed": -1 }),
            serde_json::json!({ "graphSpeed": 1.5 }),
            serde_json::json!({ "reverse": "true" }),
            serde_json::json!({ "sensitivity": "1" }),
            serde_json::json!({ "axisId": false }),
            serde_json::json!({ "axisId": "axis", "hidden": true }),
            serde_json::json!({ "axisId": "axis", "unexpected": true }),
            serde_json::json!({ "useInlineStyles": null }),
            serde_json::json!({ "fontWeight": -1 }),
            serde_json::json!({ "fontWeight": 1.5 }),
            serde_json::json!({ "fontItalic": null }),
            serde_json::json!({ "fontUnderline": 1 }),
            serde_json::json!({ "fontStrikethrough": "false" }),
            serde_json::json!({ "fontFamily": null }),
            serde_json::json!({ "displayText": null }),
            serde_json::json!({ "displayText": 1 }),
            serde_json::json!({ "displayText": "text", "hidden": true }),
            serde_json::json!({ "displayText": "text", "unexpected": true }),
            serde_json::json!({ "className": null }),
            serde_json::json!({ "className": 1 }),
            serde_json::json!({ "className": "class", "hidden": true }),
            serde_json::json!({ "className": "class", "unexpected": true }),
            serde_json::json!({ "shadow": {} }),
            serde_json::json!({ "shadow": { "offsetX": 1, "blur": 2 } }),
            serde_json::json!({ "shadow": { "color": "shadow", "unexpected": true } }),
            serde_json::json!({ "activeShadow": null }),
            serde_json::json!({ "activeShadow": { "offsetY": "1" } }),
            serde_json::json!({ "shadowEnabled": "false" }),
            serde_json::json!({ "shadow": { "blur": 1 }, "shadowEnabled": true }),
            serde_json::json!({ "backgroundPaint": {} }),
            serde_json::json!({ "backgroundPaint": { "color": "solid" } }),
            serde_json::json!({ "backgroundPaint": { "color": "solid", "gradient": null, "unexpected": true } }),
            serde_json::json!({ "backgroundPaint": { "color": "first", "gradient": { "stops": [{ "color": "first", "pos": 0 }, { "color": "last", "pos": 1 }] } } }),
            serde_json::json!({ "backgroundPaint": { "color": "first", "gradient": { "angle": 45 } } }),
            serde_json::json!({ "backgroundPaint": { "color": "first", "gradient": { "angle": 45, "stops": [{ "color": "first", "pos": 0 }, { "color": "last", "pos": 1 }], "unexpected": true } } }),
            serde_json::json!({ "backgroundPaint": { "color": "first", "gradient": { "angle": 45, "stops": [{ "color": "first", "pos": 0, "unexpected": true }, { "color": "last", "pos": 1 }] } } }),
            serde_json::json!({ "backgroundPaint": { "color": "first", "gradient": null }, "borderPaint": { "color": "border", "gradient": null } }),
            serde_json::json!({ "borderWidth": null }),
            serde_json::json!({ "borderWidth": "1" }),
            serde_json::json!({ "borderWidth": 1, "fontSize": 14 }),
            serde_json::json!({ "borderWidth": 1, "unexpected": true }),
            serde_json::json!({ "borderRadius": null }),
            serde_json::json!({ "borderRadius": "1" }),
            serde_json::json!({ "borderRadius": 1, "hidden": false }),
            serde_json::json!({ "fontSize": null }),
            serde_json::json!({ "fontSize": "14" }),
            serde_json::json!({ "fontSize": 14, "unexpected": true }),
            serde_json::json!({ "inactiveImage": null }),
            serde_json::json!({ "inactiveImage": "path", "hidden": false }),
            serde_json::json!({ "inactiveImage": "path", "unexpected": true }),
            serde_json::json!({ "activeImage": null }),
            serde_json::json!({ "activeImage": "path", "hidden": false }),
            serde_json::json!({ "activeImage": "path", "unexpected": true }),
            serde_json::json!({ "idleTransparent": null }),
            serde_json::json!({ "idleTransparent": "true" }),
            serde_json::json!({ "idleTransparent": true, "activeTransparent": false }),
            serde_json::json!({ "activeTransparent": 1 }),
            serde_json::json!({ "activeTransparent": false, "unexpected": true }),
            serde_json::json!({ "idleImageFit": "stretch" }),
            serde_json::json!({ "idleImageFit": null }),
            serde_json::json!({ "idleImageFit": "cover", "activeImageFit": "contain" }),
            serde_json::json!({ "activeImageFit": 1 }),
            serde_json::json!({ "activeImageFit": "fill", "unexpected": true }),
            serde_json::json!({ "soundPath": null }),
            serde_json::json!({ "soundPath": 1 }),
            serde_json::json!({ "soundPath": "path", "soundEnabled": true }),
            serde_json::json!({ "soundPath": "path", "unexpected": true }),
            serde_json::json!({ "soundEnabled": null }),
            serde_json::json!({ "soundEnabled": "true" }),
            serde_json::json!({ "soundEnabled": true, "unexpected": true }),
            serde_json::json!({ "soundVolume": null }),
            serde_json::json!({ "soundVolume": "100" }),
            serde_json::json!({ "soundVolume": 100, "soundEnabled": true }),
            serde_json::json!({ "soundVolume": 100, "unexpected": true }),
            serde_json::json!({ "counterEnabled": null }),
            serde_json::json!({ "counterAnimationEnabled": "true" }),
            serde_json::json!({ "counterEnabled": true, "counterAnimationEnabled": false }),
            serde_json::json!({ "counterPlacement": "center" }),
            serde_json::json!({ "counterAlign": "center" }),
            serde_json::json!({ "counterAlignMode": "outside" }),
            serde_json::json!({ "counterGap": -1 }),
            serde_json::json!({ "counterGap": 1.5 }),
            serde_json::json!({ "counterGap": 4_294_967_296_u64 }),
            serde_json::json!({ "counterPlacement": "inside", "counterAlign": "top" }),
            serde_json::json!({ "counterFontSize": -1 }),
            serde_json::json!({ "counterFontSize": 16.5 }),
            serde_json::json!({ "counterFontWeight": "400" }),
            serde_json::json!({ "counterFontItalic": null }),
            serde_json::json!({ "counterFontUnderline": 1 }),
            serde_json::json!({ "counterFontStrikethrough": "false" }),
            serde_json::json!({ "counterFontSize": 16, "counterFontWeight": 400 }),
            serde_json::json!({ "counterFontSize": 16, "unexpected": true }),
            serde_json::json!({ "counterFontFamily": null }),
            serde_json::json!({ "counterFontFamily": 1 }),
            serde_json::json!({ "counterFontFamily": "font", "counterFontItalic": true }),
            serde_json::json!({ "counterFontFamily": "font", "unexpected": true }),
            serde_json::json!({ "counterFillIdle": {} }),
            serde_json::json!({ "counterFillIdle": { "color": null } }),
            serde_json::json!({ "counterFillIdle": { "color": "solid", "gradient": null } }),
            serde_json::json!({ "counterFillActive": { "color": "first", "gradient": { "stops": [{ "color": "first", "pos": 0 }, { "color": "last", "pos": 1 }] } } }),
            serde_json::json!({ "counterFillActive": { "color": "first", "gradient": { "angle": 45, "stops": [{ "color": "first", "pos": 0 }, { "color": "last", "pos": 1 }], "unexpected": true } } }),
            serde_json::json!({ "counterFillIdle": { "color": "solid", "unexpected": true } }),
            serde_json::json!({ "counterFillIdle": { "color": "idle" }, "counterFillActive": { "color": "active" } }),
            serde_json::json!({ "counterStrokeIdle": null }),
            serde_json::json!({ "counterStrokeIdle": 1 }),
            serde_json::json!({ "counterStrokeIdle": "idle", "counterStrokeActive": "active" }),
            serde_json::json!({ "counterStrokeIdle": "idle", "unexpected": true }),
            serde_json::json!({ "counterStrokeActive": null }),
            serde_json::json!({ "counterStrokeActive": 1 }),
            serde_json::json!({ "counterStrokeActive": "active", "hidden": true }),
            serde_json::json!({ "counterAnimationPreset": null }),
            serde_json::json!({ "counterAnimationPreset": {} }),
            serde_json::json!({ "counterAnimationPreset": { "presetId": "preset", "enabled": true } }),
            serde_json::json!({ "counterAnimationPreset": { "presetId": "preset", "applyPresetId": false } }),
            serde_json::json!({ "counterAnimationPreset": { "presetId": "preset", "bezier": [0.1, 0.2, 0.8] } }),
            serde_json::json!({ "counterAnimationPreset": { "presetId": "preset", "durationMs": 1.5 } }),
            serde_json::json!({ "counterAnimationPreset": { "presetId": "preset" }, "hidden": true }),
            serde_json::json!({ "statType": "invalid" }),
            serde_json::json!({ "noteEffectEnabled": 1 }),
            serde_json::json!({ "noteGlowEnabled": null }),
            serde_json::json!({ "noteGlowSize": null }),
            serde_json::json!({ "noteGlowSize": "20" }),
            serde_json::json!({ "noteGlowSize": 20, "noteGlowEnabled": true }),
            serde_json::json!({ "noteGlowSize": 20, "unexpected": true }),
            serde_json::json!({ "notePaint": {} }),
            serde_json::json!({ "notePaint": { "color": { "top": "a", "bottom": "b" } } }),
            serde_json::json!({ "notePaint": { "color": { "type": "gradient", "top": "a", "bottom": "b", "unexpected": true } } }),
            serde_json::json!({ "notePaint": { "opacity": 50, "opacityTop": 40 } }),
            serde_json::json!({ "notePaint": { "color": "x", "opacity": 50 } }),
            serde_json::json!({ "noteGlowPaint": { "opacity": "70" } }),
            serde_json::json!({ "noteBorderPaint": { "color": "#FFFFFF" } }),
            serde_json::json!({ "noteBorderPaint": { "color": "#FFFFFF", "opacity": 100, "unexpected": true } }),
            serde_json::json!({ "notePaint": { "color": "x" }, "noteGlowPaint": { "color": "y" } }),
            serde_json::json!({ "noteOffsetX": "0" }),
            serde_json::json!({ "noteOffsetX": null, "noteOffsetY": null }),
            serde_json::json!({ "noteOffsetY": null, "unexpected": true }),
            serde_json::json!({ "noteWidth": "20" }),
            serde_json::json!({ "noteWidth": null, "hidden": true }),
            serde_json::json!({ "noteBorderWidth": null }),
            serde_json::json!({ "noteBorderWidth": "1" }),
            serde_json::json!({ "noteBorderRadius": null }),
            serde_json::json!({ "noteBorderRadius": 4, "unexpected": true }),
            serde_json::json!({ "noteAutoYCorrection": "false" }),
            serde_json::json!({ "noteAlignment": "bottom" }),
            serde_json::json!({ "noteBorderSide": "diagonal" }),
        ]
        .map(|patch| {
            let mut wire = graph_color.clone();
            wire["ops"][0]["patch"] = patch;
            wire
        });
        for wire in [
            unknown_property,
            unknown_op,
            missing_property,
            multiple_properties,
            invalid_graph_type,
            invalid_graph_color,
        ]
        .into_iter()
        .chain(invalid_literal_properties)
        {
            let error = decode_editor_commit_request(wire).unwrap_err();
            assert_eq!(validation_code(&error), Some("INVALID_REQUEST_PAYLOAD"));
        }

        let slot = EditorOpV1::SetKeySlot {
            id: Uuid::new_v4().to_string(),
            slot: EditorFrozenKeySlotV1::Multi(crate::models::EditorFrozenMultiKeySlotV1 {
                keys: vec!["A".to_string(), "B".to_string()],
                match_mode: crate::models::SlotMatch::Any,
            }),
        };
        let slot_wire = serde_json::to_value(ops_request(vec![slot])).unwrap();
        assert_eq!(slot_wire["ops"][0]["kind"], "setKeySlot");
        assert_eq!(slot_wire["ops"][0]["slot"]["match"], "any");
        decode_editor_commit_request(slot_wire.clone()).unwrap();

        let mut unknown_slot = slot_wire;
        unknown_slot["ops"][0]["slot"]["unexpected"] = serde_json::json!(true);
        let error = decode_editor_commit_request(unknown_slot).unwrap_err();
        assert_eq!(validation_code(&error), Some("INVALID_REQUEST_PAYLOAD"));

        let invalid_slot = ops_request(vec![EditorOpV1::SetKeySlot {
            id: Uuid::new_v4().to_string(),
            slot: EditorFrozenKeySlotV1::Multi(crate::models::EditorFrozenMultiKeySlotV1 {
                keys: vec!["A".to_string(), "A".to_string()],
                match_mode: crate::models::SlotMatch::All,
            }),
        }]);
        assert_eq!(
            validation_code(&validate_request_envelope(&invalid_slot).unwrap_err()),
            Some("INVALID_KEY_SLOT")
        );
    }

    #[test]
    fn frozen_insert_wire_is_exact_through_nested_full_records() {
        let request = ops_request(vec![frozen_insert_op(Uuid::new_v4().to_string())]);
        let mut valid = serde_json::to_value(request).unwrap();
        valid["ops"][0]["elements"][0]["position"]["unexpected"] = serde_json::json!(1);

        let error = decode_editor_commit_request(valid).unwrap_err();
        assert_eq!(validation_code(&error), Some("INVALID_REQUEST_PAYLOAD"));

        let mut invalid_slot = serde_json::to_value(ops_request(vec![frozen_insert_op(
            Uuid::new_v4().to_string(),
        )]))
        .unwrap();
        invalid_slot["ops"][0]["elements"][0]["slot"] = serde_json::json!({
            "keys": ["A", "B"],
            "match": "all",
            "unexpected": true,
        });
        let error = decode_editor_commit_request(invalid_slot).unwrap_err();
        assert_eq!(validation_code(&error), Some("INVALID_REQUEST_PAYLOAD"));
    }

    #[test]
    fn reorder_wire_is_exact_and_requires_explicit_nullable_group_id() {
        let target_id = Uuid::new_v4().to_string();
        let op = EditorOpV1::ReorderElements {
            mode: "4key".to_string(),
            complete_mode_order: true,
            z_updates: vec![EditorZUpdateV1 {
                element_type: EditorElementTypeV1::Key,
                id: target_id.clone(),
                z_index: 3,
            }],
            group_updates: vec![EditorGroupUpdateV1 {
                element_type: EditorElementTypeV1::Key,
                id: target_id,
                group_id: None,
            }],
        };
        let valid = serde_json::to_value(ops_request(vec![op])).unwrap();
        assert_eq!(valid["ops"][0]["kind"], "reorderElements");
        assert_eq!(valid["ops"][0]["completeModeOrder"], true);
        assert!(valid["ops"][0]["groupUpdates"][0]["groupId"].is_null());
        decode_editor_commit_request(valid.clone()).unwrap();

        let mut missing_group_id = valid.clone();
        missing_group_id["ops"][0]["groupUpdates"][0]
            .as_object_mut()
            .unwrap()
            .remove("groupId");
        let error = decode_editor_commit_request(missing_group_id).unwrap_err();
        assert_eq!(validation_code(&error), Some("INVALID_REQUEST_PAYLOAD"));

        let mut unknown_z = valid.clone();
        unknown_z["ops"][0]["zUpdates"][0]["unexpected"] = serde_json::json!(true);
        let mut unknown_group = valid;
        unknown_group["ops"][0]["groupUpdates"][0]["unexpected"] = serde_json::json!(true);
        for wire in [unknown_z, unknown_group] {
            let error = decode_editor_commit_request(wire).unwrap_err();
            assert_eq!(validation_code(&error), Some("INVALID_REQUEST_PAYLOAD"));
        }
    }

    #[test]
    fn reorder_is_a_bounded_sole_op_with_consistent_targets() {
        let id = Uuid::new_v4().to_string();
        let mixed = ops_request(vec![
            reorder_op(id.clone(), false),
            set_bounds_op(Uuid::new_v4().to_string(), EditorElementTypeV1::Key),
        ]);
        assert_eq!(
            validation_code(&validate_request_envelope(&mixed).unwrap_err()),
            Some("INVALID_REORDER_BATCH")
        );

        let empty = EditorOpV1::ReorderElements {
            mode: "4key".to_string(),
            complete_mode_order: false,
            z_updates: Vec::new(),
            group_updates: Vec::new(),
        };
        assert_eq!(
            validation_code(&validate_request_envelope(&ops_request(vec![empty])).unwrap_err()),
            Some("EMPTY_REORDER_BATCH")
        );

        let duplicate_z = EditorOpV1::ReorderElements {
            mode: "4key".to_string(),
            complete_mode_order: true,
            z_updates: vec![
                EditorZUpdateV1 {
                    element_type: EditorElementTypeV1::Key,
                    id: id.clone(),
                    z_index: 1,
                },
                EditorZUpdateV1 {
                    element_type: EditorElementTypeV1::Key,
                    id: id.clone(),
                    z_index: 2,
                },
            ],
            group_updates: Vec::new(),
        };
        assert_eq!(
            validation_code(
                &validate_request_envelope(&ops_request(vec![duplicate_z])).unwrap_err()
            ),
            Some("DUPLICATE_REORDER_Z_TARGET")
        );

        let group_without_z = EditorOpV1::ReorderElements {
            mode: "4key".to_string(),
            complete_mode_order: true,
            z_updates: vec![EditorZUpdateV1 {
                element_type: EditorElementTypeV1::Key,
                id: id.clone(),
                z_index: 1,
            }],
            group_updates: vec![EditorGroupUpdateV1 {
                element_type: EditorElementTypeV1::Key,
                id: Uuid::new_v4().to_string(),
                group_id: None,
            }],
        };
        assert_eq!(
            validation_code(
                &validate_request_envelope(&ops_request(vec![group_without_z])).unwrap_err()
            ),
            Some("REORDER_GROUP_TARGET_NOT_IN_ORDER")
        );

        let duplicate_group = EditorOpV1::ReorderElements {
            mode: "4key".to_string(),
            complete_mode_order: true,
            z_updates: vec![EditorZUpdateV1 {
                element_type: EditorElementTypeV1::Key,
                id: id.clone(),
                z_index: 1,
            }],
            group_updates: vec![
                EditorGroupUpdateV1 {
                    element_type: EditorElementTypeV1::Key,
                    id: id.clone(),
                    group_id: None,
                },
                EditorGroupUpdateV1 {
                    element_type: EditorElementTypeV1::Key,
                    id: id.clone(),
                    group_id: None,
                },
            ],
        };
        assert_eq!(
            validation_code(
                &validate_request_envelope(&ops_request(vec![duplicate_group])).unwrap_err()
            ),
            Some("DUPLICATE_REORDER_GROUP_TARGET")
        );

        let conflicting_type = EditorOpV1::ReorderElements {
            mode: "4key".to_string(),
            complete_mode_order: true,
            z_updates: vec![EditorZUpdateV1 {
                element_type: EditorElementTypeV1::Key,
                id: id.clone(),
                z_index: 1,
            }],
            group_updates: vec![EditorGroupUpdateV1 {
                element_type: EditorElementTypeV1::Graph,
                id: id.clone(),
                group_id: None,
            }],
        };
        assert_eq!(
            validation_code(
                &validate_request_envelope(&ops_request(vec![conflicting_type])).unwrap_err()
            ),
            Some("REORDER_TARGET_TYPE_CONFLICT")
        );

        let invalid_group_id = EditorOpV1::ReorderElements {
            mode: "4key".to_string(),
            complete_mode_order: true,
            z_updates: vec![EditorZUpdateV1 {
                element_type: EditorElementTypeV1::Key,
                id: id.clone(),
                z_index: 1,
            }],
            group_updates: vec![EditorGroupUpdateV1 {
                element_type: EditorElementTypeV1::Key,
                id: id.clone(),
                group_id: Some(String::new()),
            }],
        };
        assert_eq!(
            validation_code(
                &validate_request_envelope(&ops_request(vec![invalid_group_id])).unwrap_err()
            ),
            Some("INVALID_REORDER_GROUP_ID")
        );

        let partial_group = EditorOpV1::ReorderElements {
            mode: "4key".to_string(),
            complete_mode_order: false,
            z_updates: vec![EditorZUpdateV1 {
                element_type: EditorElementTypeV1::Key,
                id: id.clone(),
                z_index: 1,
            }],
            group_updates: vec![EditorGroupUpdateV1 {
                element_type: EditorElementTypeV1::Key,
                id: id.clone(),
                group_id: None,
            }],
        };
        assert_eq!(
            validation_code(
                &validate_request_envelope(&ops_request(vec![partial_group])).unwrap_err()
            ),
            Some("INVALID_PARTIAL_REORDER_GROUP_UPDATE")
        );

        let at_limit = EditorOpV1::ReorderElements {
            mode: "4key".to_string(),
            complete_mode_order: false,
            z_updates: (0..MAX_RENDER_ITEMS)
                .map(|index| EditorZUpdateV1 {
                    element_type: EditorElementTypeV1::Key,
                    id: Uuid::from_u128(index as u128 + 1).to_string(),
                    z_index: index as i32,
                })
                .collect(),
            group_updates: Vec::new(),
        };
        validate_request_envelope(&ops_request(vec![at_limit.clone()])).unwrap();
        let mut too_wide = at_limit;
        let EditorOpV1::ReorderElements { z_updates, .. } = &mut too_wide else {
            unreachable!();
        };
        z_updates.push(EditorZUpdateV1 {
            element_type: EditorElementTypeV1::Key,
            id: Uuid::from_u128(MAX_RENDER_ITEMS as u128 + 1).to_string(),
            z_index: 0,
        });
        assert_eq!(
            validation_code(&validate_request_envelope(&ops_request(vec![too_wide])).unwrap_err()),
            Some("REORDER_BATCH_TOO_LARGE")
        );

        let too_many_group_updates = EditorOpV1::ReorderElements {
            mode: "4key".to_string(),
            complete_mode_order: true,
            z_updates: vec![EditorZUpdateV1 {
                element_type: EditorElementTypeV1::Key,
                id: id.clone(),
                z_index: 1,
            }],
            group_updates: (0..=MAX_RENDER_ITEMS)
                .map(|index| EditorGroupUpdateV1 {
                    element_type: EditorElementTypeV1::Key,
                    id: Uuid::from_u128(index as u128 + 1).to_string(),
                    group_id: None,
                })
                .collect(),
        };
        assert_eq!(
            validation_code(
                &validate_request_envelope(&ops_request(vec![too_many_group_updates])).unwrap_err()
            ),
            Some("REORDER_BATCH_TOO_LARGE")
        );
    }

    #[test]
    fn frozen_insert_is_a_bounded_sole_op_with_unique_disjoint_ids() {
        let id = Uuid::new_v4().to_string();
        let mixed = ops_request(vec![
            frozen_insert_op(id.clone()),
            set_bounds_op(Uuid::new_v4().to_string(), EditorElementTypeV1::Key),
        ]);
        assert_eq!(
            validation_code(&validate_request_envelope(&mixed).unwrap_err()),
            Some("INVALID_FROZEN_INSERT_BATCH")
        );

        let duplicate = EditorOpV1::InsertFrozenElements {
            mode: "4key".to_string(),
            elements: vec![
                crate::models::EditorFrozenElementV1::Key {
                    slot: crate::models::EditorFrozenKeySlotV1::Single("A".to_string()),
                    position: KeyPosition {
                        id: id.clone(),
                        ..KeyPosition::default()
                    },
                },
                crate::models::EditorFrozenElementV1::Key {
                    slot: crate::models::EditorFrozenKeySlotV1::Single("B".to_string()),
                    position: KeyPosition {
                        id: id.clone(),
                        ..KeyPosition::default()
                    },
                },
            ],
            groups: Vec::new(),
            z_updates: Vec::new(),
        };
        assert_eq!(
            validation_code(&validate_request_envelope(&ops_request(vec![duplicate])).unwrap_err()),
            Some("DUPLICATE_FROZEN_INSERT_ID")
        );

        let overlap = EditorOpV1::InsertFrozenElements {
            mode: "4key".to_string(),
            elements: vec![crate::models::EditorFrozenElementV1::Key {
                slot: crate::models::EditorFrozenKeySlotV1::Single("A".to_string()),
                position: KeyPosition {
                    id: id.clone(),
                    ..KeyPosition::default()
                },
            }],
            groups: Vec::new(),
            z_updates: vec![crate::models::EditorZUpdateV1 {
                element_type: EditorElementTypeV1::Key,
                id,
                z_index: 1,
            }],
        };
        assert_eq!(
            validation_code(&validate_request_envelope(&ops_request(vec![overlap])).unwrap_err()),
            Some("FROZEN_INSERT_Z_TARGET_OVERLAP")
        );

        let malformed_slot = EditorOpV1::InsertFrozenElements {
            mode: "4key".to_string(),
            elements: vec![crate::models::EditorFrozenElementV1::Key {
                slot: crate::models::EditorFrozenKeySlotV1::Multi(
                    crate::models::EditorFrozenMultiKeySlotV1 {
                        keys: vec!["A".to_string()],
                        match_mode: crate::models::SlotMatch::All,
                    },
                ),
                position: KeyPosition {
                    id: Uuid::new_v4().to_string(),
                    ..KeyPosition::default()
                },
            }],
            groups: Vec::new(),
            z_updates: Vec::new(),
        };
        assert_eq!(
            validation_code(
                &validate_request_envelope(&ops_request(vec![malformed_slot])).unwrap_err()
            ),
            Some("INVALID_FROZEN_KEY_SLOT")
        );

        for match_mode in [crate::models::SlotMatch::All, crate::models::SlotMatch::Any] {
            let valid_multi = EditorOpV1::InsertFrozenElements {
                mode: "4key".to_string(),
                elements: vec![crate::models::EditorFrozenElementV1::Key {
                    slot: crate::models::EditorFrozenKeySlotV1::Multi(
                        crate::models::EditorFrozenMultiKeySlotV1 {
                            keys: vec!["A".to_string(), "B".to_string()],
                            match_mode,
                        },
                    ),
                    position: KeyPosition {
                        id: Uuid::new_v4().to_string(),
                        ..KeyPosition::default()
                    },
                }],
                groups: Vec::new(),
                z_updates: Vec::new(),
            };
            validate_request_envelope(&ops_request(vec![valid_multi])).unwrap();
        }

        for members in [
            vec!["A".to_string(), "A".to_string()],
            vec!["".to_string(), "B".to_string()],
            vec!["A+B".to_string(), "C".to_string()],
            vec!["A|B".to_string(), "C".to_string()],
        ] {
            let invalid_multi = EditorOpV1::InsertFrozenElements {
                mode: "4key".to_string(),
                elements: vec![crate::models::EditorFrozenElementV1::Key {
                    slot: crate::models::EditorFrozenKeySlotV1::Multi(
                        crate::models::EditorFrozenMultiKeySlotV1 {
                            keys: members,
                            match_mode: crate::models::SlotMatch::All,
                        },
                    ),
                    position: KeyPosition {
                        id: Uuid::new_v4().to_string(),
                        ..KeyPosition::default()
                    },
                }],
                groups: Vec::new(),
                z_updates: Vec::new(),
            };
            assert_eq!(
                validation_code(
                    &validate_request_envelope(&ops_request(vec![invalid_multi])).unwrap_err()
                ),
                Some("INVALID_FROZEN_KEY_SLOT")
            );
        }

        let inserted_id = Uuid::from_u128((MAX_RENDER_ITEMS + 1) as u128).to_string();
        let wide_plan = EditorOpV1::InsertFrozenElements {
            mode: "4key".to_string(),
            elements: vec![crate::models::EditorFrozenElementV1::Key {
                slot: crate::models::EditorFrozenKeySlotV1::Single("A".to_string()),
                position: KeyPosition {
                    id: inserted_id,
                    ..KeyPosition::default()
                },
            }],
            groups: Vec::new(),
            z_updates: (0..MAX_RENDER_ITEMS)
                .map(|index| crate::models::EditorZUpdateV1 {
                    element_type: EditorElementTypeV1::Key,
                    id: Uuid::from_u128(index as u128 + 1).to_string(),
                    z_index: index as i32,
                })
                .collect(),
        };
        validate_request_envelope(&ops_request(vec![wide_plan.clone()])).unwrap();

        let mut too_wide = wide_plan;
        let EditorOpV1::InsertFrozenElements { z_updates, .. } = &mut too_wide else {
            unreachable!();
        };
        z_updates.push(crate::models::EditorZUpdateV1 {
            element_type: EditorElementTypeV1::Key,
            id: Uuid::from_u128((MAX_RENDER_ITEMS + 2) as u128).to_string(),
            z_index: 0,
        });
        assert_eq!(
            validation_code(&validate_request_envelope(&ops_request(vec![too_wide])).unwrap_err()),
            Some("FROZEN_INSERT_BATCH_TOO_LARGE")
        );
    }

    #[test]
    fn editor_ops_enforce_version_count_ids_and_global_target_uniqueness() {
        let id = Uuid::new_v4().to_string();
        let mut unsupported = ops_request(vec![set_bounds_op(&id, EditorElementTypeV1::Key)]);
        unsupported.ops_version = Some(2);
        assert_eq!(
            validation_code(&validate_request_envelope(&unsupported).unwrap_err()),
            Some("UNSUPPORTED_OPS_VERSION")
        );

        let empty = ops_request(Vec::new());
        assert_eq!(
            validation_code(&validate_request_envelope(&empty).unwrap_err()),
            Some("EMPTY_EDITOR_OPS")
        );

        let at_limit = ops_request(
            (0..MAX_EDITOR_OPS)
                .map(|index| {
                    set_bounds_op(
                        Uuid::from_u128(index as u128 + 1).to_string(),
                        EditorElementTypeV1::Key,
                    )
                })
                .collect(),
        );
        validate_request_envelope(&at_limit).unwrap();

        let mut too_many = at_limit;
        too_many.ops.as_mut().unwrap().push(set_bounds_op(
            Uuid::from_u128(MAX_EDITOR_OPS as u128 + 1).to_string(),
            EditorElementTypeV1::Key,
        ));
        assert_eq!(
            validation_code(&validate_request_envelope(&too_many).unwrap_err()),
            Some("TOO_MANY_EDITOR_OPS")
        );

        let duplicate = ops_request(vec![
            set_bounds_op(&id, EditorElementTypeV1::Key),
            delete_element_op(&id, EditorElementTypeV1::Graph),
        ]);
        assert_eq!(
            validation_code(&validate_request_envelope(&duplicate).unwrap_err()),
            Some("DUPLICATE_EDITOR_OP_TARGET")
        );

        let nil = ops_request(vec![set_bounds_op(
            Uuid::nil().to_string(),
            EditorElementTypeV1::Key,
        )]);
        assert_eq!(
            validation_code(&validate_request_envelope(&nil).unwrap_err()),
            Some(crate::state::native_element_id::INVALID_ELEMENT_ID)
        );
    }

    #[test]
    fn editor_op_bounds_reuse_position_numeric_limits() {
        let valid = EditorBoundsV1 {
            dx: MAX_ABS_COORDINATE,
            dy: -MAX_ABS_COORDINATE,
            width: MAX_DIMENSION,
            height: 1.0,
        };
        validate_editor_op_bounds(0, None, valid).unwrap();

        for invalid in [
            EditorBoundsV1 {
                dx: f64::NAN,
                ..valid
            },
            EditorBoundsV1 {
                dy: MAX_ABS_COORDINATE + 1.0,
                ..valid
            },
            EditorBoundsV1 {
                width: 0.0,
                ..valid
            },
            EditorBoundsV1 {
                height: MAX_DIMENSION + 1.0,
                ..valid
            },
        ] {
            assert!(validate_editor_op_bounds(0, None, invalid).is_err());
        }

        let grandfathered = KeyPosition {
            width: MAX_DIMENSION + 2.0,
            ..KeyPosition::default()
        };
        validate_editor_op_bounds(
            0,
            Some(&grandfathered),
            EditorBoundsV1 {
                width: MAX_DIMENSION + 1.0,
                ..position_bounds(&grandfathered)
            },
        )
        .unwrap();

        let mismatch =
            validate_editor_op_target_type(0, EditorElementTypeV1::Graph, EditorElementTypeV1::Key)
                .unwrap_err();
        assert_eq!(validation_code(&mismatch), Some("ELEMENT_TYPE_MISMATCH"));
        assert!(!mismatch.retryable);
    }

    #[test]
    fn canonical_fingerprint_includes_editor_op_payload() {
        let id = Uuid::new_v4().to_string();
        let left = ops_request(vec![set_bounds_op(&id, EditorElementTypeV1::Key)]);
        let mut right = left.clone();
        let Some(EditorOpV1::SetBounds { bounds, .. }) =
            right.ops.as_mut().and_then(|ops| ops.first_mut())
        else {
            unreachable!();
        };
        bounds.width += 1.0;

        assert_ne!(
            request_fingerprint(&left).unwrap(),
            request_fingerprint(&right).unwrap()
        );

        let delete = ops_request(vec![delete_element_op(&id, EditorElementTypeV1::Key)]);
        assert_ne!(
            request_fingerprint(&left).unwrap(),
            request_fingerprint(&delete).unwrap()
        );
    }

    #[test]
    fn editor_op_results_use_the_exact_camel_case_wire_values() {
        let canonical = EditorBoundsV1 {
            dx: 1.0,
            dy: 2.0,
            width: 3.0,
            height: 4.0,
        };
        let wire = serde_json::to_value([
            EditorOpResultV1 {
                status: EditorOpResultStatusV1::Applied,
                bounds: Some(canonical),
            },
            EditorOpResultV1 {
                status: EditorOpResultStatusV1::NoChange,
                bounds: Some(canonical),
            },
            EditorOpResultV1 {
                status: EditorOpResultStatusV1::TargetMissing,
                bounds: None,
            },
        ])
        .unwrap();

        assert_eq!(wire[0]["status"], "applied");
        assert_eq!(wire[1]["status"], "noChange");
        assert_eq!(wire[2]["status"], "targetMissing");
        assert!(wire[2].get("bounds").is_none());
    }

    #[test]
    fn member_fanout_limit_accepts_sixteen_and_rejects_new_excess() {
        let store = default_editor_store();
        let current = EditorDocumentV1::from_store(&store);
        let mut at_limit = current.clone();
        at_limit
            .keys
            .get_mut("4key")
            .unwrap()
            .extend((0..MAX_SLOTS_PER_MEMBER).map(|index| KeySlot::Multi {
                keys: vec!["SHARED".to_string(), format!("K{index}")],
                match_mode: crate::models::SlotMatch::Any,
            }));
        at_limit
            .key_positions
            .get_mut("4key")
            .unwrap()
            .extend(vec![KeyPosition::default(); MAX_SLOTS_PER_MEMBER]);
        let mut at_limit_store = store.clone();
        at_limit.apply_to_store(&mut at_limit_store);

        validate_document_transition(&current, &at_limit, &store, &at_limit_store).unwrap();

        let mut over_limit = at_limit.clone();
        over_limit
            .keys
            .get_mut("4key")
            .unwrap()
            .push(KeySlot::Multi {
                keys: vec!["SHARED".to_string(), "EXTRA".to_string()],
                match_mode: crate::models::SlotMatch::Any,
            });
        over_limit
            .key_positions
            .get_mut("4key")
            .unwrap()
            .push(KeyPosition::default());
        let mut over_limit_store = at_limit_store.clone();
        over_limit.apply_to_store(&mut over_limit_store);

        let error = validate_document_transition(
            &at_limit,
            &over_limit,
            &at_limit_store,
            &over_limit_store,
        )
        .unwrap_err();
        assert_eq!(
            error.details.unwrap().validation_code.as_deref(),
            Some("TOO_MANY_SLOTS_PER_MEMBER")
        );

        validate_document_transition(
            &over_limit,
            &over_limit,
            &over_limit_store,
            &over_limit_store,
        )
        .unwrap();
    }

    #[test]
    fn counter_sync_uses_canonical_and_separates_any_from_all() {
        let keys = HashMap::from([(
            "mode".to_string(),
            vec![
                KeySlot::Single("A".to_string()),
                KeySlot::Multi {
                    keys: vec!["A".to_string(), "B".to_string()],
                    match_mode: crate::models::SlotMatch::Any,
                },
                KeySlot::Multi {
                    keys: vec!["A".to_string(), "B".to_string()],
                    match_mode: crate::models::SlotMatch::All,
                },
            ],
        )]);
        let mut counters = HashMap::from([(
            "mode".to_string(),
            HashMap::from([("A".to_string(), 7), ("stale".to_string(), 3)]),
        )]);

        sync_key_counters(&mut counters, &keys);

        assert_eq!(counters["mode"]["A"], 7);
        assert_eq!(counters["mode"]["A|B"], 0);
        assert_eq!(counters["mode"]["A+B"], 0);
        assert!(!counters["mode"].contains_key("stale"));
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
            .push(KeySlot::from("A"));

        let error = validate_paired_update(&current, &candidate, true, false).unwrap_err();
        assert_eq!(
            error.error_code,
            crate::errors::EditorCommitErrorCode::PairedUpdateRequired
        );
    }

    #[test]
    fn stage_four_paired_topology_uses_key_position_id_order() {
        let store = default_editor_store();
        let current = EditorDocumentV1::from_store(&store);

        let mut position_edit = current.clone();
        position_edit.key_positions.get_mut("4key").unwrap()[0].dx += 1.0;
        validate_paired_update(&current, &position_edit, false, true).unwrap();

        let mut positions_only_reorder = current.clone();
        positions_only_reorder
            .key_positions
            .get_mut("4key")
            .unwrap()
            .swap(0, 1);
        let error =
            validate_paired_update(&current, &positions_only_reorder, false, true).unwrap_err();
        assert_eq!(
            error.error_code,
            crate::errors::EditorCommitErrorCode::PairedUpdateRequired
        );
        assert!(!error.retryable);

        let mut paired_reorder = positions_only_reorder;
        paired_reorder.keys.get_mut("4key").unwrap().swap(0, 1);
        validate_paired_update(&current, &paired_reorder, true, true).unwrap();

        let mut keys_only = current.clone();
        keys_only.keys.get_mut("4key").unwrap()[0] = KeySlot::from("Changed");
        validate_paired_update(&current, &keys_only, true, false).unwrap();
    }

    #[test]
    fn unchanged_ghost_mode_is_grandfathered() {
        let mut store = AppStoreData::default();
        store
            .keys
            .insert("ghost".to_string(), vec![KeySlot::from("A")]);
        store
            .key_positions
            .insert("ghost".to_string(), vec![KeyPosition::default()]);
        let current = EditorDocumentV1::from_store(&store);
        let mut candidate = current.clone();
        candidate.keys.get_mut("ghost").unwrap()[0] = KeySlot::from("B");

        validate_document_transition(&current, &candidate, &store, &store).unwrap();
    }

    #[test]
    fn new_ghost_mode_is_rejected() {
        let store = AppStoreData::default();
        let current = EditorDocumentV1::from_store(&store);
        let mut candidate = current.clone();
        candidate
            .keys
            .insert("ghost".to_string(), vec![KeySlot::from("A")]);
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
            .insert("custom".to_string(), vec![KeySlot::from("A")]);
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
            .insert("custom".to_string(), vec![KeySlot::from("A")]);
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
    fn stage_four_grandfathering_ignores_diagnostic_message_changes() {
        let key = ViolationKey {
            owner: ViolationOwner::Mode {
                mode: "ghost".to_string(),
            },
            code: "UNKNOWN_MODE",
            property_path: ViolationPropertyPath::Collection("keys"),
            invalid_value: InvalidValueSignature::None,
        };
        let current = [ValidationViolation::new(key.clone(), "same message")]
            .into_iter()
            .map(|violation| violation.key)
            .collect();

        assert!(is_grandfathered(
            &current,
            &ValidationViolation::new(key, "different diagnostic message")
        ));
    }

    #[test]
    fn stage_four_stable_id_grandfathers_violation_after_reorder() {
        let mut store = default_editor_store();
        let mut shadow = valid_shadow();
        shadow.blur = MAX_SHADOW_BLUR + 1.0;
        store.key_positions.get_mut("4key").unwrap()[0].shadow = Some(shadow);
        let current = EditorDocumentV1::from_store(&store);

        let mut candidate = current.clone();
        candidate.keys.get_mut("4key").unwrap().swap(0, 1);
        candidate.key_positions.get_mut("4key").unwrap().swap(0, 1);
        let mut candidate_store = store.clone();
        candidate.apply_to_store(&mut candidate_store);

        validate_paired_update(&current, &candidate, true, true).unwrap();
        validate_document_transition(&current, &candidate, &store, &candidate_store).unwrap();
    }

    #[test]
    fn stage_four_native_violation_key_omits_mode_for_same_element() {
        let mut store = store_with_each_position_collection();
        let mut shadow = valid_shadow();
        shadow.blur = MAX_SHADOW_BLUR + 1.0;
        store.stat_positions.get_mut("4key").unwrap()[0]
            .position
            .shadow = Some(shadow);
        let current = EditorDocumentV1::from_store(&store);
        let mut candidate = current.clone();
        let moved = candidate
            .stat_positions
            .get_mut("4key")
            .unwrap()
            .pop()
            .unwrap();
        candidate
            .stat_positions
            .entry("5key".to_string())
            .or_default()
            .push(moved);
        let mut candidate_store = store.clone();
        candidate.apply_to_store(&mut candidate_store);

        validate_document_transition(&current, &candidate, &store, &candidate_store).unwrap();
    }

    #[test]
    fn stage_four_same_violation_on_a_different_id_is_rejected() {
        let mut store = default_editor_store();
        let mut shadow = valid_shadow();
        shadow.blur = MAX_SHADOW_BLUR + 1.0;
        store.key_positions.get_mut("4key").unwrap()[0].shadow = Some(shadow);
        let current = EditorDocumentV1::from_store(&store);
        let mut candidate = current.clone();
        candidate.key_positions.get_mut("4key").unwrap()[0].id = Uuid::new_v4().to_string();
        let mut candidate_store = store.clone();
        candidate.apply_to_store(&mut candidate_store);

        let error = validate_document_transition(&current, &candidate, &store, &candidate_store)
            .unwrap_err();
        assert_eq!(
            error.details.unwrap().validation_code.as_deref(),
            Some("INVALID_ELEMENT_SHADOW")
        );
    }

    #[test]
    fn unconditional_structural_violation_is_rejected_even_when_unchanged() {
        let mut store = default_editor_store();
        store.keys.get_mut("4key").unwrap().pop();
        let document = EditorDocumentV1::from_store(&store);

        let error = validate_document_transition(&document, &document, &store, &store).unwrap_err();
        assert_eq!(
            error.details.unwrap().validation_code.as_deref(),
            Some("KEY_POSITION_LENGTH_MISMATCH")
        );
    }

    #[test]
    fn stage_four_per_owner_limits_follow_stable_ids_across_reorder() {
        let mut label_store = default_editor_store();
        label_store.keys.get_mut("4key").unwrap()[0] =
            KeySlot::from("x".repeat(MAX_KEY_LABEL_BYTES + 1));
        let current_labels = EditorDocumentV1::from_store(&label_store);
        validate_document_transition(&current_labels, &current_labels, &label_store, &label_store)
            .unwrap();

        let mut moved_label = current_labels.clone();
        moved_label.keys.get_mut("4key").unwrap().swap(0, 1);
        moved_label
            .key_positions
            .get_mut("4key")
            .unwrap()
            .swap(0, 1);
        let mut moved_label_store = label_store.clone();
        moved_label.apply_to_store(&mut moved_label_store);
        validate_document_transition(
            &current_labels,
            &moved_label,
            &label_store,
            &moved_label_store,
        )
        .unwrap();

        let mut coordinate_store = default_editor_store();
        coordinate_store.key_positions.get_mut("4key").unwrap()[0].dx = MAX_ABS_COORDINATE + 1.0;
        let current_coordinates = EditorDocumentV1::from_store(&coordinate_store);
        validate_document_transition(
            &current_coordinates,
            &current_coordinates,
            &coordinate_store,
            &coordinate_store,
        )
        .unwrap();

        let mut moved_coordinate = current_coordinates.clone();
        moved_coordinate
            .key_positions
            .get_mut("4key")
            .unwrap()
            .swap(0, 1);
        moved_coordinate.keys.get_mut("4key").unwrap().swap(0, 1);
        let mut moved_coordinate_store = coordinate_store.clone();
        moved_coordinate.apply_to_store(&mut moved_coordinate_store);
        validate_document_transition(
            &current_coordinates,
            &moved_coordinate,
            &coordinate_store,
            &moved_coordinate_store,
        )
        .unwrap();
    }

    #[test]
    fn stage_four_new_element_has_no_metric_allowance() {
        let store = default_editor_store();
        let current = EditorDocumentV1::from_store(&store);
        let mut candidate = current.clone();
        candidate
            .keys
            .get_mut("4key")
            .unwrap()
            .push(KeySlot::from("NEW"));
        candidate
            .key_positions
            .get_mut("4key")
            .unwrap()
            .push(KeyPosition {
                id: Uuid::new_v4().to_string(),
                dx: MAX_ABS_COORDINATE + 1.0,
                ..KeyPosition::default()
            });
        let mut candidate_store = store.clone();
        candidate.apply_to_store(&mut candidate_store);

        let error = validate_document_transition(&current, &candidate, &store, &candidate_store)
            .unwrap_err();
        assert_eq!(
            error.details.unwrap().validation_code.as_deref(),
            Some("COORDINATE_OUT_OF_RANGE")
        );
    }

    #[test]
    fn stage_four_deleted_element_is_excluded_from_per_owner_comparison() {
        let mut store = default_editor_store();
        store.key_positions.get_mut("4key").unwrap()[0].dx = MAX_ABS_COORDINATE + 1.0;
        let current = EditorDocumentV1::from_store(&store);
        let deleted_id = current.key_positions["4key"][0].id.clone();
        let mut candidate = current.clone();
        candidate.keys.get_mut("4key").unwrap().remove(0);
        candidate.key_positions.get_mut("4key").unwrap().remove(0);
        let mut candidate_store = store.clone();
        candidate.apply_to_store(&mut candidate_store);

        validate_document_transition(&current, &candidate, &store, &candidate_store).unwrap();
        assert!(candidate.key_positions["4key"]
            .iter()
            .all(|position| position.id != deleted_id));
    }

    #[test]
    fn stage_four_multi_key_label_allowances_are_consumed_once() {
        let mut store = default_editor_store();
        store.keys.get_mut("4key").unwrap()[0] = KeySlot::Multi {
            keys: vec![
                "x".repeat(MAX_KEY_LABEL_BYTES + 100),
                "y".repeat(MAX_KEY_LABEL_BYTES + 200),
            ],
            match_mode: crate::models::SlotMatch::Any,
        };
        let current = EditorDocumentV1::from_store(&store);

        let mut non_increasing = current.clone();
        non_increasing.keys.get_mut("4key").unwrap()[0] = KeySlot::Multi {
            keys: vec![
                "a".repeat(MAX_KEY_LABEL_BYTES + 150),
                "b".repeat(MAX_KEY_LABEL_BYTES + 50),
            ],
            match_mode: crate::models::SlotMatch::Any,
        };
        let mut non_increasing_store = store.clone();
        non_increasing.apply_to_store(&mut non_increasing_store);
        validate_document_transition(&current, &non_increasing, &store, &non_increasing_store)
            .unwrap();

        let mut duplicated_allowance = non_increasing.clone();
        let KeySlot::Multi { keys, .. } =
            &mut duplicated_allowance.keys.get_mut("4key").unwrap()[0]
        else {
            unreachable!()
        };
        keys.push("c".repeat(MAX_KEY_LABEL_BYTES + 25));
        let mut duplicated_store = store.clone();
        duplicated_allowance.apply_to_store(&mut duplicated_store);
        let error = validate_document_transition(
            &current,
            &duplicated_allowance,
            &store,
            &duplicated_store,
        )
        .unwrap_err();
        assert_eq!(
            error.details.unwrap().validation_code.as_deref(),
            Some("KEY_LABEL_TOO_LONG")
        );
    }

    #[test]
    fn stage_four_group_name_limit_follows_group_id_after_reorder() {
        let mut store = default_editor_store();
        store.layer_groups.insert(
            "4key".to_string(),
            vec![
                LayerGroupDef {
                    id: "oversized".to_string(),
                    name: "x".repeat(MAX_GROUP_NAME_BYTES + 1),
                },
                LayerGroupDef {
                    id: "normal".to_string(),
                    name: "Normal".to_string(),
                },
            ],
        );
        let current = EditorDocumentV1::from_store(&store);
        let mut reordered = current.clone();
        reordered.layer_groups.get_mut("4key").unwrap().swap(0, 1);
        let mut reordered_store = store.clone();
        reordered.apply_to_store(&mut reordered_store);
        validate_document_transition(&current, &reordered, &store, &reordered_store).unwrap();

        let mut changed_id = reordered;
        changed_id.layer_groups.get_mut("4key").unwrap()[1].id = "new-id".to_string();
        let mut changed_id_store = store.clone();
        changed_id.apply_to_store(&mut changed_id_store);
        let error = validate_document_transition(&current, &changed_id, &store, &changed_id_store)
            .unwrap_err();
        assert_eq!(
            error.details.unwrap().validation_code.as_deref(),
            Some("GROUP_NAME_TOO_LONG")
        );
    }

    #[test]
    fn aggregate_render_limit_compares_total_candidate_and_current_counts() {
        let mut store = store_with_custom_modes(8);
        for index in 0..8 {
            let mode = format!("custom-{index}");
            store
                .keys
                .insert(mode.clone(), vec![KeySlot::default(); 512]);
            store
                .key_positions
                .insert(mode, vec![KeyPosition::default(); 512]);
        }
        store.stat_positions.insert(
            "custom-0".to_string(),
            vec![
                StatPosition {
                    stat_type: StatType::Kps,
                    position: KeyPosition::default(),
                };
                2
            ],
        );
        let current = EditorDocumentV1::from_store(&store);

        let mut same_total = current.clone();
        same_total.stat_positions.get_mut("custom-0").unwrap().pop();
        same_total.graph_positions.insert(
            "custom-0".to_string(),
            vec![GraphPosition {
                stat_type: GraphStatType::Kps,
                graph_type: GraphType::Line,
                graph_speed: 100,
                graph_color: "#123456".to_string(),
                show_avg_line: true,
                position: KeyPosition::default(),
            }],
        );
        let mut same_total_store = store.clone();
        same_total.apply_to_store(&mut same_total_store);
        validate_document_transition(&current, &same_total, &store, &same_total_store).unwrap();

        let mut increased = same_total.clone();
        increased
            .stat_positions
            .get_mut("custom-0")
            .unwrap()
            .push(StatPosition {
                stat_type: StatType::Kps,
                position: KeyPosition::default(),
            });
        let mut increased_store = same_total_store.clone();
        increased.apply_to_store(&mut increased_store);
        let error = validate_document_transition(&current, &increased, &store, &increased_store)
            .unwrap_err();
        assert_eq!(
            error.details.unwrap().validation_code.as_deref(),
            Some("TOO_MANY_RENDER_ITEMS")
        );
    }

    #[test]
    fn violation_categories_keep_their_existing_grandfathering_decisions() {
        let mut mode_store = AppStoreData::default();
        mode_store
            .keys
            .insert("ghost".to_string(), vec![KeySlot::from("A")]);
        mode_store
            .key_positions
            .insert("ghost".to_string(), vec![KeyPosition::default()]);
        let mode_document = EditorDocumentV1::from_store(&mode_store);
        validate_document_transition(&mode_document, &mode_document, &mode_store, &mode_store)
            .unwrap();

        let mut pair_store = default_editor_store();
        pair_store.keys.get_mut("4key").unwrap().pop();
        let pair_document = EditorDocumentV1::from_store(&pair_store);
        let pair_error =
            validate_document_transition(&pair_document, &pair_document, &pair_store, &pair_store)
                .unwrap_err();
        assert_eq!(
            pair_error.details.unwrap().validation_code.as_deref(),
            Some("KEY_POSITION_LENGTH_MISMATCH")
        );

        let mut group_store = default_editor_store();
        group_store.layer_groups.insert(
            "4key".to_string(),
            vec![LayerGroupDef {
                id: String::new(),
                name: "Group".to_string(),
            }],
        );
        let group_document = EditorDocumentV1::from_store(&group_store);
        validate_document_transition(&group_document, &group_document, &group_store, &group_store)
            .unwrap();

        let mut element_store = default_editor_store();
        let mut shadow = valid_shadow();
        shadow.blur = MAX_SHADOW_BLUR + 1.0;
        element_store.key_positions.get_mut("4key").unwrap()[0].shadow = Some(shadow);
        let element_document = EditorDocumentV1::from_store(&element_store);
        validate_document_transition(
            &element_document,
            &element_document,
            &element_store,
            &element_store,
        )
        .unwrap();
    }

    #[test]
    fn oversized_per_mode_collection_is_grandfathered_only_when_non_increasing() {
        let mut store = store_with_custom_modes(1);
        store.keys.insert(
            "custom-0".to_string(),
            (0..514)
                .map(|index| KeySlot::from(format!("Key{index}")))
                .collect(),
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
            .push(KeySlot::from("Extra"));
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
            (0..512)
                .map(|index| KeySlot::from(format!("Key{index}")))
                .collect(),
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
            .push(KeySlot::from("Extra"));
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
                .insert(mode.clone(), vec![KeySlot::default(); 512]);
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
            multi_key: false,
            gesture_id: None,
            gesture_ids: Vec::new(),
            changes: Some(EditorPatchV1::default()),
            ops_version: None,
            ops: None,
        };
        assert!(validate_request_envelope(&invalid).is_err());

        let mut oversized_gesture = request(KeyMappings::new());
        oversized_gesture.gesture_id = Some("가".repeat(22));
        assert_eq!(oversized_gesture.gesture_id.as_ref().unwrap().len(), 66);
        assert!(validate_request_envelope(&oversized_gesture).is_err());

        let mut oversized_merged_gesture = request(KeyMappings::new());
        oversized_merged_gesture.gesture_ids = vec!["가".repeat(22)];
        assert!(validate_request_envelope(&oversized_merged_gesture).is_err());

        let mut malformed_gesture = request(KeyMappings::new());
        malformed_gesture.gesture_ids = vec!["not-a-uuid".to_string()];
        let malformed_error = validate_request_envelope(&malformed_gesture).unwrap_err();
        assert_eq!(
            malformed_error.error_code,
            crate::errors::EditorCommitErrorCode::InvalidGestureId
        );
        assert!(!malformed_error.retryable);

        let mut too_many_gestures = request(KeyMappings::new());
        too_many_gestures.gesture_ids = (0..=MAX_GESTURE_IDS)
            .map(|index| Uuid::from_u128(index as u128 + 1).to_string())
            .collect();
        let count_error = validate_request_envelope(&too_many_gestures).unwrap_err();
        assert_eq!(
            count_error.error_code,
            crate::errors::EditorCommitErrorCode::TooManyGestureIds
        );
        assert!(!count_error.retryable);

        let mut representative_overflow = request(KeyMappings::new());
        representative_overflow.gesture_ids = (0..MAX_GESTURE_IDS)
            .map(|index| Uuid::from_u128(index as u128 + 1).to_string())
            .collect();
        representative_overflow.gesture_id = Some(Uuid::from_u128(u128::MAX).to_string());
        assert!(validate_request_envelope(&representative_overflow).is_err());
    }

    #[test]
    fn oversized_render_and_group_totals_only_allow_non_increasing_changes() {
        let mut render_store = store_with_custom_modes(8);
        for index in 0..8 {
            let mode = format!("custom-{index}");
            render_store
                .keys
                .insert(mode.clone(), vec![KeySlot::default(); 512]);
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
    fn pair_violations_stay_unconditional_but_group_references_follow_element_ids() {
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
        let mut reordered_reference = reference_document.clone();
        reordered_reference.keys.get_mut("4key").unwrap().swap(0, 1);
        reordered_reference
            .key_positions
            .get_mut("4key")
            .unwrap()
            .swap(0, 1);
        let mut reordered_store = reference_store.clone();
        reordered_reference.apply_to_store(&mut reordered_store);
        assert!(validate_document_transition(
            &reference_document,
            &reordered_reference,
            &reference_store,
            &reordered_store,
        )
        .is_ok());
    }

    #[test]
    fn compact_request_size_boundaries_are_exact() {
        fn sized_request(target_bytes: usize) -> EditorCommitRequest {
            let mut empty_keys = KeyMappings::new();
            empty_keys.insert("4key".to_string(), vec![KeySlot::default()]);
            let empty = request(empty_keys);
            let overhead = serde_json::to_vec(&empty).unwrap().len();
            assert!(target_bytes >= overhead);

            let mut keys = KeyMappings::new();
            keys.insert(
                "4key".to_string(),
                vec![KeySlot::from("x".repeat(target_bytes - overhead))],
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
