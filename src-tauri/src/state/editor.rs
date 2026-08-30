use std::collections::{BTreeSet, HashMap, HashSet};

use uuid::Uuid;

use crate::{
    defaults::default_keys,
    errors::EditorCommitError,
    models::{
        AppStoreData, EditorBoundsV1, EditorDocumentV1, EditorElementTypeV1, EditorField,
        ElementShadowSpec, GraphPosition, KeyCounters, KeyMappings, KeyPosition, KeySlot,
        KnobPosition, StatPosition, EDITOR_SCHEMA_VERSION,
    },
};

#[cfg(test)]
use crate::models::EDITOR_OPS_VERSION;

mod limits;
mod request;

#[cfg(test)]
use limits::position_bounds;
use limits::validate_metric_limits;
pub(crate) use limits::{validate_editor_op_bounds, validate_editor_op_target_type};

pub(crate) use request::{
    canonical_request_fingerprint, decode_editor_commit_request, decode_exact_frozen_insert,
    next_revision, request_fingerprint, request_payload_size, validate_history_restore_metadata,
    validate_request_envelope, validate_revision, RequestFingerprint,
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
