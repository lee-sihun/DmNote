use std::collections::{BTreeSet, HashMap, HashSet};

use uuid::Uuid;

use crate::{
    defaults::default_keys,
    errors::EditorCommitError,
    models::{
        is_renderable_image_ref, AppStoreData, EditorBoundsV1, EditorDocumentV1,
        EditorElementTypeV1, EditorField, ElementShadowSpec, GraphPosition, KeyCounters,
        KeyMappings, KeyPosition, KeySlot, KnobPosition, ReactiveSpritePosition, SpriteTransform,
        StatPosition, EDITOR_SCHEMA_VERSION, MAX_SPRITE_POSES, MAX_SPRITE_POSE_TRIGGERS,
        SPRITE_IMAGE_DIMENSION_MAX, SPRITE_IMAGE_DIMENSION_MIN, SPRITE_PRESS_DURATION_MS_MAX,
        SPRITE_PRESS_DURATION_MS_MIN, SPRITE_TRANSFORM_OFFSET_MAX, SPRITE_TRANSFORM_OFFSET_MIN,
        SPRITE_TRANSFORM_ROTATION_MAX, SPRITE_TRANSFORM_ROTATION_MIN, SPRITE_TRANSFORM_SCALE_MAX,
        SPRITE_TRANSFORM_SCALE_MIN, SPRITE_TRANSITION_MS_MAX,
    },
};

#[cfg(test)]
use crate::models::EDITOR_OPS_VERSION;

mod limits;
mod request;
mod violations;

#[cfg(test)]
use limits::position_bounds;
use limits::validate_metric_limits;
pub(crate) use limits::{validate_editor_op_bounds, validate_editor_op_target_type};

pub(crate) use request::{
    decode_editor_commit_request, decode_exact_frozen_insert, gesture_request_fingerprint,
    next_revision, request_fingerprint, request_payload_size, validate_history_restore_metadata,
    validate_request_envelope, validate_revision, RequestFingerprint,
};
pub(crate) use violations::{
    validate_document_transition, validate_document_transition_with_keying, GrandfatherKeying,
};

#[cfg(test)]
use violations::{
    allowed_modes, collect_sprite_violations, collect_violations, is_grandfathered,
    InvalidValueSignature, NativeIdAliases, ValidationViolation, ViolationKey, ViolationOwner,
    ViolationPropertyPath,
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
pub(crate) const MAX_ABS_COORDINATE: f64 = 32_768.0;
pub(crate) const MAX_DIMENSION: f64 = 32_768.0;
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
