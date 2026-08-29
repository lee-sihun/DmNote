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
        EditorElementTypeV1, EditorField, ElementShadowSpec, GraphPosition, KeyCounters,
        KeyMappings, KeyPosition, KeySlot, KnobPosition, StatPosition,
        EDITOR_COMMIT_SCHEMA_VERSION_V2, EDITOR_OPS_VERSION, EDITOR_SCHEMA_VERSION,
    },
};

// JS Number.MAX_SAFE_INTEGER - 프론트와 오가는 모든 u64 리비전의 공통 wire 상한
pub(crate) const MAX_SAFE_WIRE_REVISION: u64 = 9_007_199_254_740_991;
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
// plugin group_id 검증(state/plugin.rs)도 이 상한을 공유 - 레이어 그룹 id 참조라 동일 규칙
pub(crate) const MAX_GROUP_ID_BYTES: usize = 256;
const MAX_GROUP_NAME_BYTES: usize = 1_024;
const MAX_ABS_COORDINATE: f64 = 32_768.0;
const MAX_DIMENSION: f64 = 32_768.0;
use crate::models::{
    SHADOW_BLUR_MAX as MAX_SHADOW_BLUR, SHADOW_BLUR_MIN as MIN_SHADOW_BLUR,
    SHADOW_OFFSET_MAX as MAX_SHADOW_OFFSET, SHADOW_OFFSET_MIN as MIN_SHADOW_OFFSET,
};
const REQUEST_WARNING_BYTES: usize = 1_024 * 1_024;
const MAX_REQUEST_BYTES: usize = 8 * 1_024 * 1_024;

// gestureId 규칙 단일 원천 - 프론트는 crypto.randomUUID()로 발급, editor/plugin 커밋 경로 공유
pub(crate) fn is_valid_gesture_id(gesture_id: &str) -> bool {
    gesture_id.len() <= MAX_GESTURE_ID_BYTES && Uuid::parse_str(gesture_id).is_ok()
}

// group_id 형상 규칙 단일 원천 - 비어있지 않고 바이트 상한 이내, plugin 인스턴스 검증도 공유
pub(crate) fn is_valid_group_id_shape(group_id: &str) -> bool {
    !group_id.is_empty() && group_id.len() <= MAX_GROUP_ID_BYTES
}

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
    ImageTransform {
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

// 관용의 신원 기준. 평상시에는 안정 ID로 요소를 짝지어, 새 요소가 남의 관용을
// 물려받지 못하게 한다. 프리셋 트랜잭션은 커밋 직전 모든 id를 재발급하므로
// ID 짝짓기가 성립하지 않아 (모드, index)로 되돌린다
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GrandfatherKeying {
    StableId,
    #[cfg(test)]
    ModeIndex,
    LegacyPresetModeIndex,
}

/// 기존 store에 있던 손실 없는 비정상 데이터는 유지하되 새 비정상 상태는 만들지 않음
pub(crate) fn validate_document_transition(
    current: &EditorDocumentV1,
    candidate: &EditorDocumentV1,
    current_store: &AppStoreData,
    candidate_store: &AppStoreData,
) -> Result<(), EditorCommitError> {
    validate_document_transition_with_keying(
        current,
        candidate,
        current_store,
        candidate_store,
        GrandfatherKeying::StableId,
    )
}

pub(crate) fn validate_document_transition_with_keying(
    current: &EditorDocumentV1,
    candidate: &EditorDocumentV1,
    current_store: &AppStoreData,
    candidate_store: &AppStoreData,
    keying: GrandfatherKeying,
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
    validate_metric_limits(current, candidate, keying)?;

    let native_id_alias = match keying {
        GrandfatherKeying::StableId => HashMap::new(),
        #[cfg(test)]
        GrandfatherKeying::ModeIndex => native_id_alias_by_slot(current, candidate),
        GrandfatherKeying::LegacyPresetModeIndex => native_id_alias_by_slot(current, candidate),
    };
    if let Some(violation) = candidate_violations.iter().find(|violation| {
        is_unconditional_structural_violation(violation.code())
            || !is_grandfathered(&current_violation_keys, violation, &native_id_alias)
    }) {
        return Err(EditorCommitError::validation(
            violation.code(),
            violation.message.clone(),
        ));
    }

    Ok(())
}

// 후보 요소 id → 같은 (모드, 자리)의 현재 요소 id. 프리셋 트랜잭션은 커밋
// 직전 id를 재발급하므로 신원으로는 관용 상대를 찾을 수 없다
fn native_id_alias_by_slot(
    current: &EditorDocumentV1,
    candidate: &EditorDocumentV1,
) -> HashMap<String, String> {
    let mut alias = HashMap::new();
    let mut collect = |current_ids: Vec<(&String, Vec<&str>)>,
                       candidate_ids: Vec<(&String, Vec<&str>)>| {
        let current_by_mode = current_ids.into_iter().collect::<HashMap<_, _>>();
        for (mode, ids) in candidate_ids {
            let Some(current_mode_ids) = current_by_mode.get(mode) else {
                continue;
            };
            for (index, id) in ids.into_iter().enumerate() {
                if let Some(current_id) = current_mode_ids.get(index) {
                    alias.insert(id.to_string(), current_id.to_string());
                }
            }
        }
    };

    collect(
        key_position_ids(&current.key_positions),
        key_position_ids(&candidate.key_positions),
    );
    collect(
        nested_position_ids(&current.stat_positions),
        nested_position_ids(&candidate.stat_positions),
    );
    collect(
        nested_position_ids(&current.graph_positions),
        nested_position_ids(&candidate.graph_positions),
    );
    collect(
        nested_position_ids(&current.knob_positions),
        nested_position_ids(&candidate.knob_positions),
    );
    alias
}

fn key_position_ids(collection: &HashMap<String, Vec<KeyPosition>>) -> Vec<(&String, Vec<&str>)> {
    collection
        .iter()
        .map(|(mode, positions)| {
            (
                mode,
                positions
                    .iter()
                    .map(|position| position.id.as_str())
                    .collect(),
            )
        })
        .collect()
}

fn nested_position_ids<T: HasKeyPosition>(
    collection: &HashMap<String, Vec<T>>,
) -> Vec<(&String, Vec<&str>)> {
    collection
        .iter()
        .map(|(mode, positions)| {
            (
                mode,
                positions
                    .iter()
                    .map(|element| element.key_position().id.as_str())
                    .collect(),
            )
        })
        .collect()
}

trait HasKeyPosition {
    fn key_position(&self) -> &KeyPosition;
}

impl HasKeyPosition for StatPosition {
    fn key_position(&self) -> &KeyPosition {
        &self.position
    }
}

impl HasKeyPosition for GraphPosition {
    fn key_position(&self) -> &KeyPosition {
        &self.position
    }
}

impl HasKeyPosition for KnobPosition {
    fn key_position(&self) -> &KeyPosition {
        &self.position
    }
}

fn is_grandfathered(
    current_violation_keys: &BTreeSet<ViolationKey>,
    candidate: &ValidationViolation,
    native_id_alias: &HashMap<String, String>,
) -> bool {
    if current_violation_keys.contains(&candidate.key) {
        return true;
    }
    if native_id_alias.is_empty() {
        return false;
    }
    // 재발급된 id는 같은 자리의 이전 신원으로 바꿔 한 번 더 대조한다
    let ViolationOwner::NativeElement { kind, id } = &candidate.key.owner else {
        return false;
    };
    let Some(current_id) = native_id_alias.get(id) else {
        return false;
    };
    let aliased = ViolationKey {
        owner: ViolationOwner::NativeElement {
            kind: *kind,
            id: current_id.clone(),
        },
        code: candidate.key.code,
        property_path: candidate.key.property_path.clone(),
        invalid_value: candidate.key.invalid_value.clone(),
    };
    current_violation_keys.contains(&aliased)
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
        // 이미지 변환도 그림자처럼 문서 단위로 검증한다 - property 패치 경로만 검사하면
        // 프리셋·플러그인·frozen insert로 범위 밖 값이 영속돼 다음 실행의 복구 세션을 유발한다
        for (name, transform) in [
            ("idleImageTransform", position.idle_image_transform.as_ref()),
            (
                "activeImageTransform",
                position.active_image_transform.as_ref(),
            ),
        ] {
            if let Some(transform) = transform {
                collect_image_transform_violations(
                    NativeElementDiagnostic {
                        kind,
                        field,
                        mode,
                        index,
                        id: &position.id,
                    },
                    name,
                    transform,
                    violations,
                );
            }
        }
    }
}

fn collect_image_transform_violations(
    element: NativeElementDiagnostic<'_>,
    name: &'static str,
    transform: &crate::models::ImageTransform,
    violations: &mut BTreeSet<ValidationViolation>,
) {
    use crate::models::{
        IMAGE_TRANSFORM_OFFSET_MAX, IMAGE_TRANSFORM_OFFSET_MIN, IMAGE_TRANSFORM_ROTATION_MAX,
        IMAGE_TRANSFORM_ROTATION_MIN, IMAGE_TRANSFORM_SCALE_MAX, IMAGE_TRANSFORM_SCALE_MIN,
    };
    let NativeElementDiagnostic {
        kind,
        field,
        mode,
        index,
        id,
    } = element;
    for (property, value, min, max) in [
        (
            "offsetX",
            transform.offset_x,
            IMAGE_TRANSFORM_OFFSET_MIN,
            IMAGE_TRANSFORM_OFFSET_MAX,
        ),
        (
            "offsetY",
            transform.offset_y,
            IMAGE_TRANSFORM_OFFSET_MIN,
            IMAGE_TRANSFORM_OFFSET_MAX,
        ),
        (
            "rotation",
            transform.rotation,
            IMAGE_TRANSFORM_ROTATION_MIN,
            IMAGE_TRANSFORM_ROTATION_MAX,
        ),
        (
            "scale",
            transform.scale,
            IMAGE_TRANSFORM_SCALE_MIN,
            IMAGE_TRANSFORM_SCALE_MAX,
        ),
    ] {
        if !value.is_finite() || !(min..=max).contains(&value) {
            violations.insert(ValidationViolation::new(
                native_violation_key(
                    kind,
                    id,
                    "INVALID_IMAGE_TRANSFORM",
                    ViolationPropertyPath::ImageTransform { name, property },
                    InvalidValueSignature::FloatBits(value.to_bits()),
                ),
                format!(
                    "{field} {mode}[{index}].{name}.{property} must be a finite number between {min} and {max}"
                ),
            ));
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
mod tests;
