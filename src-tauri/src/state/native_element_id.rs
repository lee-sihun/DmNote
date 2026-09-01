use std::collections::{HashMap, HashSet};

use uuid::Uuid;

use crate::{
    errors::EditorCommitError,
    models::{
        AppStoreData, EditorDocumentV1, EditorPatchV1, GraphPosition, KeyMappings, KeyPosition,
        KeySlot, KnobPosition, ReactiveSpritePosition, SpritePose, StatPosition,
        EDITOR_COMMIT_SCHEMA_VERSION_V2, EDITOR_SCHEMA_VERSION,
    },
};

pub(crate) const INVALID_ELEMENT_ID: &str = "INVALID_ELEMENT_ID";
pub(crate) const MISSING_ELEMENT_ID: &str = "MISSING_ELEMENT_ID";
pub(crate) const DUPLICATE_ELEMENT_ID: &str = "DUPLICATE_ELEMENT_ID";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct BackfillOutcome {
    pub(crate) changed: bool,
    pub(crate) repaired: bool,
}

trait NativeElement: Clone + PartialEq {
    fn id(&self) -> &str;
    fn id_mut(&mut self) -> &mut String;
}

impl NativeElement for KeyPosition {
    fn id(&self) -> &str {
        &self.id
    }

    fn id_mut(&mut self) -> &mut String {
        &mut self.id
    }
}

impl NativeElement for StatPosition {
    fn id(&self) -> &str {
        &self.position.id
    }

    fn id_mut(&mut self) -> &mut String {
        &mut self.position.id
    }
}

impl NativeElement for GraphPosition {
    fn id(&self) -> &str {
        &self.position.id
    }

    fn id_mut(&mut self) -> &mut String {
        &mut self.position.id
    }
}

impl NativeElement for KnobPosition {
    fn id(&self) -> &str {
        &self.position.id
    }

    fn id_mut(&mut self) -> &mut String {
        &mut self.position.id
    }
}

impl NativeElement for ReactiveSpritePosition {
    fn id(&self) -> &str {
        &self.id
    }

    fn id_mut(&mut self) -> &mut String {
        &mut self.id
    }
}

/// 파서가 하이픈형·무하이픈형·`{...}`·`urn:uuid:`·대소문자 혼용을 모두 받는다.
/// 파싱 결과를 버리고 raw를 그대로 두는 것이 계약이다 - store.rs의
/// `alternate_uuid_spellings_remain_raw_distinct_through_load_bootstrap_and_event`가
/// 로드·bootstrap·이벤트 전 구간에서 raw 보존을 고정한다.
///
/// **element id에 `Uuid::parse_str(..).to_string()` 같은 정규화를 적용하지 말 것.**
/// 유일성 판정이 문자열 기준이라, 어디선가 정규화가 끼면 같은 UUID의 다른 표기를
/// 쓰던 두 요소가 하나로 붕괴한다
pub(crate) fn is_valid_element_id(id: &str) -> bool {
    Uuid::parse_str(id).is_ok_and(|id| !id.is_nil())
}

pub(crate) fn new_unique_id(reserved: &mut HashSet<String>) -> String {
    loop {
        let id = Uuid::new_v4().to_string();
        if reserved.insert(id.clone()) {
            return id;
        }
    }
}

fn sorted_modes<T>(collection: &HashMap<String, Vec<T>>) -> Vec<String> {
    let mut modes = collection.keys().cloned().collect::<Vec<_>>();
    modes.sort_unstable();
    modes
}

fn backfill_collection<T: NativeElement>(
    collection: &mut HashMap<String, Vec<T>>,
    seen: &mut HashSet<String>,
    reserved: &mut HashSet<String>,
    outcome: &mut BackfillOutcome,
) {
    for mode in sorted_modes(collection) {
        let Some(elements) = collection.get_mut(&mode) else {
            continue;
        };
        for element in elements {
            let id = element.id();
            if is_valid_element_id(id) && seen.insert(id.to_string()) {
                continue;
            }

            // valid는 non-empty를 함의하므로 `|| valid`는 죽은 절이었다
            if !id.is_empty() {
                outcome.repaired = true;
            }
            let id = new_unique_id(reserved);
            seen.insert(id.clone());
            *element.id_mut() = id;
            outcome.changed = true;
        }
    }
}

fn backfill_sprite_pose_ids(
    collection: &mut HashMap<String, Vec<ReactiveSpritePosition>>,
    mode: Option<&str>,
    seen: &mut HashSet<String>,
    reserved: &mut HashSet<String>,
    outcome: &mut BackfillOutcome,
) {
    for collection_mode in sorted_modes(collection) {
        if mode.is_some_and(|mode| mode != collection_mode) {
            continue;
        }
        let Some(sprites) = collection.get_mut(&collection_mode) else {
            continue;
        };
        for sprite in sprites {
            for pose in &mut sprite.poses {
                if is_valid_element_id(&pose.pose_id) && seen.insert(pose.pose_id.clone()) {
                    continue;
                }
                if !pose.pose_id.is_empty() {
                    outcome.repaired = true;
                }
                let id = new_unique_id(reserved);
                seen.insert(id.clone());
                pose.pose_id = id;
                outcome.changed = true;
            }
        }
    }
}

pub(crate) fn backfill_store_element_ids(store: &mut AppStoreData) -> BackfillOutcome {
    let mut seen = HashSet::new();
    let mut reserved = collect_store_ids(store);
    let mut outcome = BackfillOutcome::default();
    backfill_collection(
        &mut store.key_positions,
        &mut seen,
        &mut reserved,
        &mut outcome,
    );
    backfill_collection(
        &mut store.stat_positions,
        &mut seen,
        &mut reserved,
        &mut outcome,
    );
    backfill_collection(
        &mut store.graph_positions,
        &mut seen,
        &mut reserved,
        &mut outcome,
    );
    backfill_collection(
        &mut store.knob_positions,
        &mut seen,
        &mut reserved,
        &mut outcome,
    );
    backfill_collection(
        &mut store.sprite_positions,
        &mut seen,
        &mut reserved,
        &mut outcome,
    );
    backfill_sprite_pose_ids(
        &mut store.sprite_positions,
        None,
        &mut seen,
        &mut reserved,
        &mut outcome,
    );
    outcome
}

fn collect_collection_ids<T: NativeElement>(
    collection: &HashMap<String, Vec<T>>,
    ids: &mut HashSet<String>,
) {
    for elements in collection.values() {
        for element in elements {
            if is_valid_element_id(element.id()) {
                ids.insert(element.id().to_string());
            }
        }
    }
}

fn collect_store_ids(store: &AppStoreData) -> HashSet<String> {
    let mut ids = HashSet::new();
    collect_collection_ids(&store.key_positions, &mut ids);
    collect_collection_ids(&store.stat_positions, &mut ids);
    collect_collection_ids(&store.graph_positions, &mut ids);
    collect_collection_ids(&store.knob_positions, &mut ids);
    collect_collection_ids(&store.sprite_positions, &mut ids);
    for sprite in store.sprite_positions.values().flatten() {
        for pose in &sprite.poses {
            if is_valid_element_id(&pose.pose_id) {
                ids.insert(pose.pose_id.clone());
            }
        }
    }
    ids
}

fn rekey_collection<T: NativeElement>(
    collection: &mut HashMap<String, Vec<T>>,
    reserved: &mut HashSet<String>,
) {
    for mode in sorted_modes(collection) {
        if let Some(elements) = collection.get_mut(&mode) {
            for element in elements {
                *element.id_mut() = new_unique_id(reserved);
            }
        }
    }
}

fn rekey_key_collection(
    collection: &mut HashMap<String, Vec<KeyPosition>>,
    mode: Option<&str>,
    reserved: &mut HashSet<String>,
) -> HashMap<String, String> {
    let mut replacements = HashMap::new();
    for collection_mode in sorted_modes(collection) {
        if mode.is_some_and(|mode| mode != collection_mode) {
            continue;
        }
        let Some(elements) = collection.get_mut(&collection_mode) else {
            continue;
        };
        for element in elements {
            let old_id = element.id.clone();
            let new_id = new_unique_id(reserved);
            if !old_id.is_empty() {
                replacements.insert(old_id, new_id.clone());
            }
            element.id = new_id;
        }
    }
    replacements
}

fn rekey_sprite_pose_ids(
    collection: &mut HashMap<String, Vec<ReactiveSpritePosition>>,
    mode: Option<&str>,
    reserved: &mut HashSet<String>,
) {
    for collection_mode in sorted_modes(collection) {
        if mode.is_some_and(|mode| mode != collection_mode) {
            continue;
        }
        if let Some(sprites) = collection.get_mut(&collection_mode) {
            for sprite in sprites {
                for pose in &mut sprite.poses {
                    pose.pose_id = new_unique_id(reserved);
                }
            }
        }
    }
}

fn remap_sprite_triggers(
    collection: &mut HashMap<String, Vec<ReactiveSpritePosition>>,
    mode: Option<&str>,
    replacements: &HashMap<String, String>,
) {
    for (collection_mode, sprites) in collection {
        if mode.is_some_and(|mode| mode != collection_mode) {
            continue;
        }
        for sprite in sprites {
            for pose in &mut sprite.poses {
                for trigger in &mut pose.triggers {
                    if let Some(replacement) = replacements.get(trigger) {
                        trigger.clone_from(replacement);
                    }
                }
            }
        }
    }
}

pub(crate) fn rekey_store_element_ids(store: &mut AppStoreData) {
    let mut reserved = collect_store_ids(store);
    let key_replacements = rekey_key_collection(&mut store.key_positions, None, &mut reserved);
    rekey_collection(&mut store.stat_positions, &mut reserved);
    rekey_collection(&mut store.graph_positions, &mut reserved);
    rekey_collection(&mut store.knob_positions, &mut reserved);
    rekey_collection(&mut store.sprite_positions, &mut reserved);
    rekey_sprite_pose_ids(&mut store.sprite_positions, None, &mut reserved);
    remap_sprite_triggers(&mut store.sprite_positions, None, &key_replacements);
}

fn rekey_collection_mode<T: NativeElement>(
    collection: &mut HashMap<String, Vec<T>>,
    mode: &str,
    reserved: &mut HashSet<String>,
) {
    if let Some(elements) = collection.get_mut(mode) {
        for element in elements {
            *element.id_mut() = new_unique_id(reserved);
        }
    }
}

pub(crate) fn rekey_mode_element_ids(store: &mut AppStoreData, mode: &str) {
    rekey_mode_element_ids_for_collections(store, mode, true, true, true, true, true);
}

pub(crate) fn rekey_mode_element_ids_for_collections(
    store: &mut AppStoreData,
    mode: &str,
    key_positions: bool,
    stat_positions: bool,
    graph_positions: bool,
    knob_positions: bool,
    sprite_positions: bool,
) {
    let mut reserved = collect_store_ids(store);
    let mut key_replacements = HashMap::new();
    if key_positions {
        key_replacements =
            rekey_key_collection(&mut store.key_positions, Some(mode), &mut reserved);
    }
    if stat_positions {
        rekey_collection_mode(&mut store.stat_positions, mode, &mut reserved);
    }
    if graph_positions {
        rekey_collection_mode(&mut store.graph_positions, mode, &mut reserved);
    }
    if knob_positions {
        rekey_collection_mode(&mut store.knob_positions, mode, &mut reserved);
    }
    if sprite_positions {
        rekey_collection_mode(&mut store.sprite_positions, mode, &mut reserved);
        rekey_sprite_pose_ids(&mut store.sprite_positions, Some(mode), &mut reserved);
    }
    remap_sprite_triggers(&mut store.sprite_positions, Some(mode), &key_replacements);
}

fn backfill_collection_mode<T: NativeElement>(
    collection: &mut HashMap<String, Vec<T>>,
    mode: &str,
    seen: &mut HashSet<String>,
    reserved: &mut HashSet<String>,
    outcome: &mut BackfillOutcome,
) {
    let Some(elements) = collection.get_mut(mode) else {
        return;
    };
    for element in elements {
        let id = element.id();
        if is_valid_element_id(id) && seen.insert(id.to_string()) {
            continue;
        }

        // valid는 non-empty를 함의하므로 `|| valid`는 죽은 절이었다
        if !id.is_empty() {
            outcome.repaired = true;
        }
        let id = new_unique_id(reserved);
        seen.insert(id.clone());
        *element.id_mut() = id;
        outcome.changed = true;
    }
}

// 한 모드의 선택된 컬렉션만 채운다. 대상 밖 요소의 id를 seen에 먼저 담아
// 대상 안의 중복도 복구되고 새 id가 문서 전체에서 유일하도록 유지한다
pub(crate) fn backfill_mode_element_ids_for_collections(
    store: &mut AppStoreData,
    mode: &str,
    key_positions: bool,
    stat_positions: bool,
    graph_positions: bool,
    knob_positions: bool,
    sprite_positions: bool,
) -> BackfillOutcome {
    let mut seen = HashSet::new();
    collect_collection_ids_outside_target(&store.key_positions, mode, key_positions, &mut seen);
    collect_collection_ids_outside_target(&store.stat_positions, mode, stat_positions, &mut seen);
    collect_collection_ids_outside_target(&store.graph_positions, mode, graph_positions, &mut seen);
    collect_collection_ids_outside_target(&store.knob_positions, mode, knob_positions, &mut seen);
    collect_collection_ids_outside_target(
        &store.sprite_positions,
        mode,
        sprite_positions,
        &mut seen,
    );
    for (collection_mode, sprites) in &store.sprite_positions {
        if sprite_positions && collection_mode == mode {
            continue;
        }
        for sprite in sprites {
            for pose in &sprite.poses {
                if is_valid_element_id(&pose.pose_id) {
                    seen.insert(pose.pose_id.clone());
                }
            }
        }
    }
    let mut reserved = collect_store_ids(store);
    let mut outcome = BackfillOutcome::default();
    if key_positions {
        backfill_collection_mode(
            &mut store.key_positions,
            mode,
            &mut seen,
            &mut reserved,
            &mut outcome,
        );
    }
    if stat_positions {
        backfill_collection_mode(
            &mut store.stat_positions,
            mode,
            &mut seen,
            &mut reserved,
            &mut outcome,
        );
    }
    if graph_positions {
        backfill_collection_mode(
            &mut store.graph_positions,
            mode,
            &mut seen,
            &mut reserved,
            &mut outcome,
        );
    }
    if knob_positions {
        backfill_collection_mode(
            &mut store.knob_positions,
            mode,
            &mut seen,
            &mut reserved,
            &mut outcome,
        );
    }
    if sprite_positions {
        backfill_collection_mode(
            &mut store.sprite_positions,
            mode,
            &mut seen,
            &mut reserved,
            &mut outcome,
        );
        backfill_sprite_pose_ids(
            &mut store.sprite_positions,
            Some(mode),
            &mut seen,
            &mut reserved,
            &mut outcome,
        );
    }
    outcome
}

// 백필 대상(선택된 컬렉션 × 대상 모드) 밖의 id만 모은다
fn collect_collection_ids_outside_target<T: NativeElement>(
    collection: &HashMap<String, Vec<T>>,
    target_mode: &str,
    targeted: bool,
    ids: &mut HashSet<String>,
) {
    for (mode, elements) in collection {
        if targeted && mode == target_mode {
            continue;
        }
        for element in elements {
            if is_valid_element_id(element.id()) {
                ids.insert(element.id().to_string());
            }
        }
    }
}

fn validate_supplied_collection_ids<T: NativeElement>(
    collection: &HashMap<String, Vec<T>>,
    require_id: bool,
    seen: &mut HashSet<String>,
) -> Result<(), EditorCommitError> {
    for mode in sorted_modes(collection) {
        let Some(elements) = collection.get(&mode) else {
            continue;
        };
        for (index, element) in elements.iter().enumerate() {
            let id = element.id();
            if id.is_empty() {
                if require_id {
                    return Err(EditorCommitError::validation(
                        MISSING_ELEMENT_ID,
                        format!("native element {mode}[{index}] is missing an ID"),
                    ));
                }
                continue;
            }
            if !is_valid_element_id(id) {
                return Err(EditorCommitError::validation(
                    INVALID_ELEMENT_ID,
                    format!("native element {mode}[{index}] has an invalid ID"),
                ));
            }
            if !seen.insert(id.to_string()) {
                return Err(EditorCommitError::validation(
                    DUPLICATE_ELEMENT_ID,
                    format!("native element ID {id} appears more than once in the commit"),
                ));
            }
        }
    }
    Ok(())
}

fn validate_sprite_pose_ids(
    collection: &HashMap<String, Vec<ReactiveSpritePosition>>,
    require_id: bool,
    seen: &mut HashSet<String>,
) -> Result<(), EditorCommitError> {
    for mode in sorted_modes(collection) {
        let Some(sprites) = collection.get(&mode) else {
            continue;
        };
        for (sprite_index, sprite) in sprites.iter().enumerate() {
            for (pose_index, pose) in sprite.poses.iter().enumerate() {
                if pose.pose_id.is_empty() {
                    if require_id {
                        return Err(EditorCommitError::validation(
                            MISSING_ELEMENT_ID,
                            format!(
                                "sprite pose {mode}[{sprite_index}].poses[{pose_index}] is missing an ID"
                            ),
                        ));
                    }
                    continue;
                }
                if !is_valid_element_id(&pose.pose_id) {
                    return Err(EditorCommitError::validation(
                        INVALID_ELEMENT_ID,
                        format!(
                            "sprite pose {mode}[{sprite_index}].poses[{pose_index}] has an invalid ID"
                        ),
                    ));
                }
                if !seen.insert(pose.pose_id.clone()) {
                    return Err(EditorCommitError::validation(
                        DUPLICATE_ELEMENT_ID,
                        format!(
                            "native element ID {} appears more than once in the commit",
                            pose.pose_id
                        ),
                    ));
                }
            }
        }
    }
    Ok(())
}

fn validate_supplied_patch_ids(
    patch: &EditorPatchV1,
    require_id: bool,
) -> Result<HashSet<String>, EditorCommitError> {
    let mut seen = HashSet::new();
    if let Some(collection) = patch.key_positions.as_ref() {
        validate_supplied_collection_ids(collection, require_id, &mut seen)?;
    }
    if let Some(collection) = patch.stat_positions.as_ref() {
        validate_supplied_collection_ids(collection, require_id, &mut seen)?;
    }
    if let Some(collection) = patch.graph_positions.as_ref() {
        validate_supplied_collection_ids(collection, require_id, &mut seen)?;
    }
    if let Some(collection) = patch.knob_positions.as_ref() {
        validate_supplied_collection_ids(collection, require_id, &mut seen)?;
    }
    if let Some(collection) = patch.sprite_positions.as_ref() {
        validate_supplied_collection_ids(collection, require_id, &mut seen)?;
        validate_sprite_pose_ids(collection, require_id, &mut seen)?;
    }
    Ok(seen)
}

// v1은 id를 모르는 입력을 계속 받는 계약이라, 형식이 유효한데 소유가 어긋나거나
// (다른 컬렉션·삭제된 신원) 패치 안에서 중복된 id는 거부 대신 비워서 뒤의 승계·
// 신규 발급 경로로 넘긴다. 중복은 canonical 자리를 원본으로 보고 사본만 비운다
fn sanitize_v1_supplied_collection_ids<T: NativeElement>(
    candidate: &mut HashMap<String, Vec<T>>,
    current: &HashMap<String, Vec<T>>,
) -> Result<(), EditorCommitError> {
    let mut owned = HashMap::new();
    for mode in sorted_modes(current) {
        let Some(elements) = current.get(&mode) else {
            continue;
        };
        for (index, element) in elements.iter().enumerate() {
            let id = element.id();
            if !id.is_empty() {
                owned.insert(id.to_string(), (mode.clone(), index));
            }
        }
    }

    let mut occurrences: HashMap<String, Vec<(String, usize)>> = HashMap::new();
    for mode in sorted_modes(candidate) {
        let Some(elements) = candidate.get(&mode) else {
            continue;
        };
        for (index, element) in elements.iter().enumerate() {
            let id = element.id();
            if id.is_empty() {
                continue;
            }
            if !is_valid_element_id(id) {
                return Err(EditorCommitError::validation(
                    INVALID_ELEMENT_ID,
                    format!("native element {mode}[{index}] has an invalid ID"),
                ));
            }
            occurrences
                .entry(id.to_string())
                .or_default()
                .push((mode.clone(), index));
        }
    }

    let mut cleared = HashSet::new();
    for (id, slots) in &occurrences {
        let Some(canonical_slot) = owned.get(id) else {
            cleared.extend(slots.iter().cloned());
            continue;
        };
        if slots.len() == 1 {
            continue;
        }
        let keeper = slots
            .iter()
            .find(|slot| *slot == canonical_slot)
            .unwrap_or(&slots[0]);
        for slot in slots {
            if slot != keeper {
                cleared.insert(slot.clone());
            }
        }
    }

    for (mode, index) in cleared {
        if let Some(element) = candidate
            .get_mut(&mode)
            .and_then(|elements| elements.get_mut(index))
        {
            element.id_mut().clear();
        }
    }
    Ok(())
}

fn sanitize_v1_supplied_patch_ids(
    store: &AppStoreData,
    patch: &mut EditorPatchV1,
) -> Result<(), EditorCommitError> {
    if let Some(collection) = patch.key_positions.as_mut() {
        sanitize_v1_supplied_collection_ids(collection, &store.key_positions)?;
    }
    if let Some(collection) = patch.stat_positions.as_mut() {
        sanitize_v1_supplied_collection_ids(collection, &store.stat_positions)?;
    }
    if let Some(collection) = patch.graph_positions.as_mut() {
        sanitize_v1_supplied_collection_ids(collection, &store.graph_positions)?;
    }
    if let Some(collection) = patch.knob_positions.as_mut() {
        sanitize_v1_supplied_collection_ids(collection, &store.knob_positions)?;
    }
    if let Some(collection) = patch.sprite_positions.as_mut() {
        sanitize_v1_supplied_collection_ids(collection, &store.sprite_positions)?;
        let owned = store
            .sprite_positions
            .values()
            .flatten()
            .flat_map(|sprite| sprite.poses.iter().map(|pose| pose.pose_id.clone()))
            .collect::<HashSet<_>>();
        let mut seen = HashSet::new();
        for mode in sorted_modes(collection) {
            let Some(sprites) = collection.get_mut(&mode) else {
                continue;
            };
            for (sprite_index, sprite) in sprites.iter_mut().enumerate() {
                for (pose_index, pose) in sprite.poses.iter_mut().enumerate() {
                    if pose.pose_id.is_empty() {
                        continue;
                    }
                    if !is_valid_element_id(&pose.pose_id) {
                        return Err(EditorCommitError::validation(
                            INVALID_ELEMENT_ID,
                            format!(
                                "sprite pose {mode}[{sprite_index}].poses[{pose_index}] has an invalid ID"
                            ),
                        ));
                    }
                    if !owned.contains(&pose.pose_id) || !seen.insert(pose.pose_id.clone()) {
                        pose.pose_id.clear();
                    }
                }
            }
        }
    }
    Ok(())
}

fn adapt_v1_sprite_pose_ids(
    current: &HashMap<String, Vec<ReactiveSpritePosition>>,
    candidate: &mut HashMap<String, Vec<ReactiveSpritePosition>>,
    consumed_current_ids: &mut HashSet<String>,
    reserved: &mut HashSet<String>,
) {
    for mode in sorted_modes(candidate) {
        let Some(sprites) = candidate.get_mut(&mode) else {
            continue;
        };
        let current_sprites = current.get(&mode);
        for sprite in sprites {
            let current_sprite = current_sprites
                .and_then(|sprites| sprites.iter().find(|current| current.id == sprite.id));
            let normalized_current = current_sprite
                .map(|sprite| {
                    sprite
                        .poses
                        .iter()
                        .map(sprite_pose_value_without_id)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            for pose in &mut sprite.poses {
                if !pose.pose_id.is_empty() {
                    consumed_current_ids.insert(pose.pose_id.clone());
                    continue;
                }
                let target = sprite_pose_value_without_id(pose);
                let inherited = current_sprite.and_then(|sprite| {
                    sprite
                        .poses
                        .iter()
                        .zip(&normalized_current)
                        .find(|(current_pose, normalized)| {
                            is_valid_element_id(&current_pose.pose_id)
                                && !consumed_current_ids.contains(&current_pose.pose_id)
                                && **normalized == target
                        })
                        .map(|(current_pose, _)| current_pose.pose_id.clone())
                });
                if let Some(id) = inherited {
                    consumed_current_ids.insert(id.clone());
                    pose.pose_id = id;
                } else {
                    pose.pose_id = new_unique_id(reserved);
                }
            }
        }
    }
}

fn sprite_pose_value_without_id(pose: &SpritePose) -> SpritePose {
    let mut copy = pose.clone();
    copy.pose_id.clear();
    copy.normalize_triggers();
    copy
}

/// id를 비운 값 사본. 비교마다 양쪽을 clone하지 않도록, 스캔 전에 한 번씩만
/// 만들어 재사용한다 (승계 웨이브의 순서·우선순위는 그대로 유지)
fn value_without_id<T: NativeElement>(element: &T) -> T {
    let mut copy = element.clone();
    copy.id_mut().clear();
    copy
}

fn ordered_current_elements<T: NativeElement>(collection: &HashMap<String, Vec<T>>) -> Vec<T> {
    let mut elements = Vec::new();
    for mode in sorted_modes(collection) {
        if let Some(mode_elements) = collection.get(&mode) {
            elements.extend(mode_elements.iter().cloned());
        }
    }
    elements
}

fn keep_or_rekey_supplied_ids<T: NativeElement>(
    candidate: &mut HashMap<String, Vec<T>>,
    canonical_ids: &HashSet<String>,
    consumed_current_ids: &mut HashSet<String>,
    reserved: &mut HashSet<String>,
) {
    for mode in sorted_modes(candidate) {
        let Some(elements) = candidate.get_mut(&mode) else {
            continue;
        };
        for element in elements {
            let id = element.id().to_string();
            if id.is_empty() {
                continue;
            }
            if canonical_ids.contains(&id) {
                consumed_current_ids.insert(id);
            } else {
                *element.id_mut() = new_unique_id(reserved);
            }
        }
    }
}

// 같은 모드 안에서 빈 ID를 값으로 승계한다. 모드를 넘는 승계는 무관한 모드의
// 신원을 빼앗으므로 이 패스에서 제외한다
fn inherit_ids_by_value_within_mode<T: NativeElement>(
    current: &HashMap<String, Vec<T>>,
    candidate: &mut HashMap<String, Vec<T>>,
    consumed_current_ids: &mut HashSet<String>,
) {
    for mode in sorted_modes(candidate) {
        let Some(elements) = candidate.get_mut(&mode) else {
            continue;
        };
        let Some(current_elements) = current.get(&mode) else {
            continue;
        };
        let normalized_current: Vec<T> = current_elements.iter().map(value_without_id).collect();
        for element in elements {
            if !element.id().is_empty() {
                continue;
            }
            let target = value_without_id(&*element);
            let inherited = current_elements
                .iter()
                .zip(&normalized_current)
                .find(|(current_element, normalized)| {
                    let current_id = current_element.id();
                    !consumed_current_ids.contains(current_id) && **normalized == target
                })
                .map(|(current_element, _)| current_element);
            if let Some(current_element) = inherited {
                let id = current_element.id().to_string();
                consumed_current_ids.insert(id.clone());
                *element.id_mut() = id;
            }
        }
    }
}

fn inherit_ids_by_value<T: NativeElement>(
    current_elements: &[T],
    candidate: &mut HashMap<String, Vec<T>>,
    consumed_current_ids: &mut HashSet<String>,
    reserved: &mut HashSet<String>,
) {
    let normalized_current: Vec<T> = current_elements.iter().map(value_without_id).collect();
    for mode in sorted_modes(candidate) {
        let Some(elements) = candidate.get_mut(&mode) else {
            continue;
        };
        for element in elements {
            if !element.id().is_empty() {
                continue;
            }
            let target = value_without_id(&*element);
            let inherited = current_elements
                .iter()
                .zip(&normalized_current)
                .find(|(current_element, normalized)| {
                    let current_id = current_element.id();
                    !consumed_current_ids.contains(current_id) && **normalized == target
                })
                .map(|(current_element, _)| current_element);
            if let Some(current_element) = inherited {
                let id = current_element.id().to_string();
                consumed_current_ids.insert(id.clone());
                *element.id_mut() = id;
            } else {
                *element.id_mut() = new_unique_id(reserved);
            }
        }
    }
}

// keys를 동반하지 않는 keyPositions 패치에서만 쓴다. 그 경우 candidate는
// validate_paired_update가 형태 불변을 강제하므로 같은 길이 = 같은 슬롯 집합의
// 제자리 편집이고, index가 곧 신원이다(master 의미론). 형태 제약이 없는
// stat/graph/knob에 쓰면 같은 길이의 삭제+추가에서 새 요소가 삭제된 요소의
// 신원을 물려받는다
fn inherit_ids_by_index(
    current: &HashMap<String, Vec<KeyPosition>>,
    candidate: &mut HashMap<String, Vec<KeyPosition>>,
    consumed_current_ids: &mut HashSet<String>,
) {
    for mode in sorted_modes(candidate) {
        let Some(elements) = candidate.get_mut(&mode) else {
            continue;
        };
        let Some(current_elements) = current.get(&mode) else {
            continue;
        };
        if current_elements.len() != elements.len() {
            continue;
        }
        for (element, current_element) in elements.iter_mut().zip(current_elements) {
            if !element.id.is_empty() {
                continue;
            }
            let id = current_element.id.clone();
            if id.is_empty() || consumed_current_ids.contains(&id) {
                continue;
            }
            consumed_current_ids.insert(id.clone());
            element.id = id;
        }
    }
}

fn adapt_v1_collection<T: NativeElement>(
    current: &HashMap<String, Vec<T>>,
    candidate: &mut HashMap<String, Vec<T>>,
    canonical_ids: &HashSet<String>,
    consumed_current_ids: &mut HashSet<String>,
    reserved: &mut HashSet<String>,
) {
    keep_or_rekey_supplied_ids(candidate, canonical_ids, consumed_current_ids, reserved);
    // 승계 순서: 같은 모드 값 → 전역 값 폴백. index 승계는 형태가 고정된
    // keyPositions 단독 패치 전용이라 여기서는 쓰지 않는다
    inherit_ids_by_value_within_mode(current, candidate, consumed_current_ids);
    inherit_ids_by_value(
        &ordered_current_elements(current),
        candidate,
        consumed_current_ids,
        reserved,
    );
}

struct SlotPairedPosition {
    mode: String,
    index: usize,
    slot: Option<KeySlot>,
    position: KeyPosition,
}

fn slot_paired_current_positions(
    keys: &KeyMappings,
    positions: &HashMap<String, Vec<KeyPosition>>,
) -> Vec<SlotPairedPosition> {
    let mut pairs = Vec::new();
    for mode in sorted_modes(positions) {
        let Some(elements) = positions.get(&mode) else {
            continue;
        };
        let slots = keys.get(&mode);
        for (index, element) in elements.iter().enumerate() {
            pairs.push(SlotPairedPosition {
                mode: mode.clone(),
                index,
                slot: slots.and_then(|slots| slots.get(index)).cloned(),
                position: element.clone(),
            });
        }
    }
    pairs
}

// 한 웨이브: 아직 빈 ID인 후보에 조건(슬롯 일치 여부, 같은 모드 한정 여부)을
// 만족하는 미소진 현재 요소의 ID를 승계한다. 슬롯은 canonical 문자열이 아니라
// 구조적 동등성으로 비교한다 - Single("A+B")와 Multi([A,B], all)는 canonical이
// 같아도 다른 슬롯이다
fn consume_slot_paired_ids(
    candidate: &mut HashMap<String, Vec<KeyPosition>>,
    patch_keys: &KeyMappings,
    current_pairs: &[SlotPairedPosition],
    consumed_current_ids: &mut HashSet<String>,
    match_slot: bool,
    same_mode_only: bool,
) {
    let normalized_pairs: Vec<KeyPosition> = current_pairs
        .iter()
        .map(|pair| value_without_id(&pair.position))
        .collect();
    for mode in sorted_modes(candidate) {
        let Some(elements) = candidate.get_mut(&mode) else {
            continue;
        };
        let slots = patch_keys.get(&mode);
        for (index, element) in elements.iter_mut().enumerate() {
            if !element.id.is_empty() {
                continue;
            }
            let slot = slots.and_then(|slots| slots.get(index));
            if match_slot && slot.is_none() {
                continue;
            }
            let target = value_without_id(&*element);
            let inherited = current_pairs
                .iter()
                .zip(&normalized_pairs)
                .find(|(pair, normalized)| {
                    (!same_mode_only || pair.mode == mode)
                        && (!match_slot || pair.slot.as_ref() == slot)
                        && !consumed_current_ids.contains(&pair.position.id)
                        && **normalized == target
                })
                .map(|(pair, _)| pair);
            if let Some(pair) = inherited {
                let id = pair.position.id.clone();
                consumed_current_ids.insert(id.clone());
                element.id = id;
            }
        }
    }
}

// 값을 무시하고 같은 모드·같은 index의 슬롯 일치만으로 승계한다. 값 일치를
// 요구하는 앞 웨이브들이 모두 실패하는 경우 - 슬롯은 그대로인데 위치 값만
// 바뀐 이동 - 를 담당한다. index를 고정해 중복 슬롯끼리 교차 승계하지 않는다
fn consume_slot_only_ids(
    candidate: &mut HashMap<String, Vec<KeyPosition>>,
    patch_keys: &KeyMappings,
    current_pairs: &[SlotPairedPosition],
    consumed_current_ids: &mut HashSet<String>,
) {
    for mode in sorted_modes(candidate) {
        let Some(elements) = candidate.get_mut(&mode) else {
            continue;
        };
        let slots = patch_keys.get(&mode);
        for (index, element) in elements.iter_mut().enumerate() {
            if !element.id.is_empty() {
                continue;
            }
            let Some(slot) = slots.and_then(|slots| slots.get(index)) else {
                continue;
            };
            let inherited = current_pairs.iter().find(|pair| {
                pair.mode == mode
                    && pair.index == index
                    && pair.slot.as_ref() == Some(slot)
                    && !consumed_current_ids.contains(&pair.position.id)
            });
            if let Some(pair) = inherited {
                let id = pair.position.id.clone();
                consumed_current_ids.insert(id.clone());
                element.id = id;
            }
        }
    }
}

// v1 paired patch는 keys[i]-keyPositions[i] 결합이 신원 단서다. 값이 같은
// 위치가 여럿일 때 값만으로 승계하면 재정렬에서 ID가 다른 키 슬롯에 붙으므로
// 같은 모드의 (슬롯, 값) 정확 일치부터 소진하고, 모드 이동·재바인딩은
// 뒤 웨이브로 미뤄 무관한 모드의 ID를 먼저 빼앗지 않게 한다
fn adapt_v1_key_position_ids(
    store: &AppStoreData,
    patch_keys: Option<&KeyMappings>,
    candidate: &mut HashMap<String, Vec<KeyPosition>>,
    canonical_ids: &HashSet<String>,
    consumed_current_ids: &mut HashSet<String>,
    reserved: &mut HashSet<String>,
) {
    let Some(patch_keys) = patch_keys else {
        // keys 미동반 패치는 형태가 고정된다 - index가 신원이므로 값 승계보다
        // 먼저 제자리 id를 확정해 값 편집이 신원 회전으로 번지지 않게 한다
        keep_or_rekey_supplied_ids(candidate, canonical_ids, consumed_current_ids, reserved);
        inherit_ids_by_index(&store.key_positions, candidate, consumed_current_ids);
        inherit_ids_by_value_within_mode(&store.key_positions, candidate, consumed_current_ids);
        inherit_ids_by_value(
            &ordered_current_elements(&store.key_positions),
            candidate,
            consumed_current_ids,
            reserved,
        );
        return;
    };

    keep_or_rekey_supplied_ids(candidate, canonical_ids, consumed_current_ids, reserved);

    let current_pairs = slot_paired_current_positions(&store.keys, &store.key_positions);
    // 웨이브 순서: 같은 모드 슬롯+값 → 모드 간 슬롯+값(모드 이동) →
    // 같은 모드 index 슬롯(값 변경 이동) → 같은 모드 값(재바인딩) →
    // 마지막 전역 값 폴백과 신규 발급.
    // 슬롯 고정이 우연한 값 일치보다 강한 신원 단서라 값 웨이브보다 앞선다 -
    // 그래야 두 키의 좌표를 맞바꾸는 패치가 keys 동반 여부와 무관하게 같은
    // 결과(제자리 값 편집)를 낸다
    for (match_slot, same_mode_only) in [(true, true), (true, false)] {
        consume_slot_paired_ids(
            candidate,
            patch_keys,
            &current_pairs,
            consumed_current_ids,
            match_slot,
            same_mode_only,
        );
    }
    consume_slot_only_ids(candidate, patch_keys, &current_pairs, consumed_current_ids);
    consume_slot_paired_ids(
        candidate,
        patch_keys,
        &current_pairs,
        consumed_current_ids,
        false,
        true,
    );

    inherit_ids_by_value_within_mode(&store.key_positions, candidate, consumed_current_ids);
    inherit_ids_by_value(
        &ordered_current_elements(&store.key_positions),
        candidate,
        consumed_current_ids,
        reserved,
    );
}

fn adapt_v1_patch_ids(
    store: &AppStoreData,
    patch: &mut EditorPatchV1,
) -> Result<(), EditorCommitError> {
    sanitize_v1_supplied_patch_ids(store, patch)?;
    // 정화 후에는 남은 id가 모두 자기 컬렉션 소유이자 유일 - 이 호출은 수집과
    // 불변식 확인을 겸한다
    let supplied_ids = validate_supplied_patch_ids(patch, false)?;
    let canonical_ids = collect_store_ids(store);
    let mut consumed_current_ids = supplied_ids
        .iter()
        .filter(|id| canonical_ids.contains(*id))
        .cloned()
        .collect::<HashSet<_>>();
    let mut reserved = canonical_ids.clone();
    reserved.extend(supplied_ids);

    let patch_keys = patch.keys.clone();
    if let Some(collection) = patch.key_positions.as_mut() {
        adapt_v1_key_position_ids(
            store,
            patch_keys.as_ref(),
            collection,
            &canonical_ids,
            &mut consumed_current_ids,
            &mut reserved,
        );
    }
    if let Some(collection) = patch.stat_positions.as_mut() {
        adapt_v1_collection(
            &store.stat_positions,
            collection,
            &canonical_ids,
            &mut consumed_current_ids,
            &mut reserved,
        );
    }
    if let Some(collection) = patch.graph_positions.as_mut() {
        adapt_v1_collection(
            &store.graph_positions,
            collection,
            &canonical_ids,
            &mut consumed_current_ids,
            &mut reserved,
        );
    }
    if let Some(collection) = patch.knob_positions.as_mut() {
        adapt_v1_collection(
            &store.knob_positions,
            collection,
            &canonical_ids,
            &mut consumed_current_ids,
            &mut reserved,
        );
    }
    if let Some(collection) = patch.sprite_positions.as_mut() {
        adapt_v1_collection(
            &store.sprite_positions,
            collection,
            &canonical_ids,
            &mut consumed_current_ids,
            &mut reserved,
        );
        adapt_v1_sprite_pose_ids(
            &store.sprite_positions,
            collection,
            &mut consumed_current_ids,
            &mut reserved,
        );
    }
    Ok(())
}

fn validate_document_collection_ids<T: NativeElement>(
    collection: &HashMap<String, Vec<T>>,
    seen: &mut HashSet<String>,
) -> Result<(), EditorCommitError> {
    for mode in sorted_modes(collection) {
        let Some(elements) = collection.get(&mode) else {
            continue;
        };
        for (index, element) in elements.iter().enumerate() {
            let id = element.id();
            if id.is_empty() {
                return Err(EditorCommitError::validation(
                    MISSING_ELEMENT_ID,
                    format!("native element {mode}[{index}] is missing an ID"),
                ));
            }
            if !is_valid_element_id(id) {
                return Err(EditorCommitError::validation(
                    INVALID_ELEMENT_ID,
                    format!("native element {mode}[{index}] has an invalid ID"),
                ));
            }
            if !seen.insert(id.to_string()) {
                return Err(EditorCommitError::validation(
                    DUPLICATE_ELEMENT_ID,
                    format!("native element ID {id} is not globally unique"),
                ));
            }
        }
    }
    Ok(())
}

pub(crate) fn validate_document_element_ids(
    document: &EditorDocumentV1,
) -> Result<(), EditorCommitError> {
    let mut seen = HashSet::new();
    validate_document_collection_ids(&document.key_positions, &mut seen)?;
    validate_document_collection_ids(&document.stat_positions, &mut seen)?;
    validate_document_collection_ids(&document.graph_positions, &mut seen)?;
    validate_document_collection_ids(&document.knob_positions, &mut seen)?;
    validate_document_collection_ids(&document.sprite_positions, &mut seen)?;
    validate_sprite_pose_ids(&document.sprite_positions, true, &mut seen)
}

fn patch_includes_native_elements(patch: &EditorPatchV1) -> bool {
    patch.key_positions.is_some()
        || patch.stat_positions.is_some()
        || patch.graph_positions.is_some()
        || patch.knob_positions.is_some()
        || patch.sprite_positions.is_some()
}

pub(crate) fn prepare_commit_patch_element_ids(
    store: &AppStoreData,
    patch: &mut EditorPatchV1,
) -> Result<(), EditorCommitError> {
    if !patch_includes_native_elements(patch) {
        return Ok(());
    }

    match patch.schema_version {
        EDITOR_SCHEMA_VERSION => adapt_v1_patch_ids(store, patch)?,
        EDITOR_COMMIT_SCHEMA_VERSION_V2 => {
            validate_supplied_patch_ids(patch, true)?;
        }
        _ => {
            return Err(EditorCommitError::validation(
                "UNSUPPORTED_SCHEMA_VERSION",
                format!("unsupported editor schema version {}", patch.schema_version),
            ));
        }
    }

    let mut candidate = EditorDocumentV1::from_store(store);
    candidate.apply_patch(patch);
    validate_document_element_ids(&candidate)
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};

    use crate::models::{
        AppStoreData, EditorPatchV1, GraphPosition, GraphStatType, GraphType, KeyPosition,
        KnobPosition, ReactiveSpritePosition, SlotMatch, SpritePose, StatPosition, StatType,
    };

    use super::*;

    fn position(dx: f64) -> KeyPosition {
        KeyPosition {
            dx,
            ..KeyPosition::default()
        }
    }

    fn stat_position(stat_type: StatType, dx: f64) -> StatPosition {
        StatPosition {
            stat_type,
            position: position(dx),
        }
    }

    fn store_with_all_collections() -> AppStoreData {
        let mut store = AppStoreData {
            key_positions: HashMap::from([(
                "mode".to_string(),
                vec![position(1.0), position(2.0)],
            )]),
            stat_positions: HashMap::from([(
                "mode".to_string(),
                vec![StatPosition {
                    stat_type: StatType::Kps,
                    position: position(3.0),
                }],
            )]),
            graph_positions: HashMap::from([(
                "mode".to_string(),
                vec![GraphPosition {
                    stat_type: GraphStatType::KpsAvg,
                    graph_type: GraphType::Line,
                    graph_speed: 100,
                    graph_color: "#123456".to_string(),
                    show_avg_line: true,
                    position: position(4.0),
                }],
            )]),
            knob_positions: HashMap::from([(
                "mode".to_string(),
                vec![KnobPosition {
                    axis_id: "axis".to_string(),
                    sensitivity: 1.0,
                    reverse: false,
                    position: position(5.0),
                }],
            )]),
            ..AppStoreData::default()
        };
        rekey_store_element_ids(&mut store);
        store
    }

    fn all_ids(store: &AppStoreData) -> Vec<String> {
        let document = EditorDocumentV1::from_store(store);
        let mut ids = Vec::new();
        for positions in document.key_positions.values() {
            ids.extend(positions.iter().map(|position| position.id.clone()));
        }
        for positions in document.stat_positions.values() {
            ids.extend(
                positions
                    .iter()
                    .map(|position| position.position.id.clone()),
            );
        }
        for positions in document.graph_positions.values() {
            ids.extend(
                positions
                    .iter()
                    .map(|position| position.position.id.clone()),
            );
        }
        for positions in document.knob_positions.values() {
            ids.extend(
                positions
                    .iter()
                    .map(|position| position.position.id.clone()),
            );
        }
        ids
    }

    fn validation_code(error: EditorCommitError) -> String {
        error
            .details
            .and_then(|details| details.validation_code)
            .unwrap()
    }

    fn sprite_pose(trigger: u128, transform_x: f64) -> SpritePose {
        let mut pose = SpritePose {
            triggers: vec![Uuid::from_u128(trigger).to_string()],
            ..SpritePose::default()
        };
        pose.transform.x = transform_x;
        pose
    }

    fn store_with_sprites(sprites: Vec<ReactiveSpritePosition>) -> AppStoreData {
        let mut store = AppStoreData {
            sprite_positions: HashMap::from([("mode".to_string(), sprites)]),
            ..AppStoreData::default()
        };
        rekey_store_element_ids(&mut store);
        store
    }

    fn prepare_v1_sprite_patch(
        store: &AppStoreData,
        sprites: Vec<ReactiveSpritePosition>,
    ) -> Vec<ReactiveSpritePosition> {
        let mut patch = EditorPatchV1 {
            sprite_positions: Some(HashMap::from([("mode".to_string(), sprites)])),
            ..EditorPatchV1::default()
        };
        prepare_commit_patch_element_ids(store, &mut patch).unwrap();
        patch.sprite_positions.unwrap().remove("mode").unwrap()
    }

    #[test]
    fn backfill_assigns_globally_unique_sprite_and_pose_ids() {
        let duplicate = uuid::Uuid::new_v4().to_string();
        let mut store = AppStoreData::default();
        store.sprite_positions.insert(
            "mode".to_string(),
            vec![ReactiveSpritePosition {
                id: duplicate.clone(),
                poses: vec![
                    SpritePose {
                        pose_id: duplicate,
                        ..SpritePose::default()
                    },
                    SpritePose::default(),
                ],
                ..ReactiveSpritePosition::default()
            }],
        );

        let outcome = backfill_store_element_ids(&mut store);
        let sprite = &store.sprite_positions["mode"][0];
        let ids = [
            sprite.id.as_str(),
            sprite.poses[0].pose_id.as_str(),
            sprite.poses[1].pose_id.as_str(),
        ];

        assert!(outcome.changed);
        assert!(outcome.repaired);
        assert!(ids.iter().all(|id| is_valid_element_id(id)));
        assert_eq!(ids.into_iter().collect::<HashSet<_>>().len(), 3);
    }

    #[test]
    fn backfill_replaces_only_missing_invalid_and_duplicate_ids() {
        let mut store = store_with_all_collections();
        let kept_id = store.key_positions["mode"][0].id.clone();
        store.key_positions.get_mut("mode").unwrap()[0].active_image =
            Some("/images/kept.png".to_string());
        store.key_positions.get_mut("mode").unwrap()[0].sound_path =
            Some("/sounds/kept.wav".to_string());
        store.key_positions.get_mut("mode").unwrap()[1].id = kept_id.clone();
        store.stat_positions.get_mut("mode").unwrap()[0].position.id = "not-a-uuid".to_string();
        store.graph_positions.get_mut("mode").unwrap()[0]
            .position
            .id
            .clear();

        let outcome = backfill_store_element_ids(&mut store);

        assert_eq!(
            outcome,
            BackfillOutcome {
                changed: true,
                repaired: true
            }
        );
        assert_eq!(store.key_positions["mode"][0].id, kept_id);
        assert_eq!(
            store.key_positions["mode"][0].active_image.as_deref(),
            Some("/images/kept.png")
        );
        assert_eq!(
            store.key_positions["mode"][0].sound_path.as_deref(),
            Some("/sounds/kept.wav")
        );
        let ids = all_ids(&store);
        assert!(ids.iter().all(|id| is_valid_element_id(id)));
        assert_eq!(ids.iter().collect::<HashSet<_>>().len(), ids.len());
    }

    #[test]
    fn full_and_mode_rekey_create_fresh_globally_unique_generations() {
        let mut store = store_with_all_collections();
        let first = all_ids(&store).into_iter().collect::<HashSet<_>>();
        rekey_store_element_ids(&mut store);
        let second = all_ids(&store).into_iter().collect::<HashSet<_>>();
        rekey_mode_element_ids(&mut store, "mode");
        let third = all_ids(&store).into_iter().collect::<HashSet<_>>();

        assert!(first.is_disjoint(&second));
        assert!(second.is_disjoint(&third));
        assert_eq!(third.len(), 5);
    }

    #[test]
    fn v2_requires_valid_ids_and_checks_merged_global_uniqueness() {
        let store = store_with_all_collections();
        let mut valid = EditorPatchV1 {
            schema_version: EDITOR_COMMIT_SCHEMA_VERSION_V2,
            key_positions: Some(store.key_positions.clone()),
            ..EditorPatchV1::default()
        };
        prepare_commit_patch_element_ids(&store, &mut valid).unwrap();

        let mut missing = valid.clone();
        missing
            .key_positions
            .as_mut()
            .unwrap()
            .get_mut("mode")
            .unwrap()[0]
            .id
            .clear();
        assert_eq!(
            validation_code(prepare_commit_patch_element_ids(&store, &mut missing).unwrap_err()),
            MISSING_ELEMENT_ID
        );

        for invalid_id in [Uuid::nil().to_string(), "not-a-uuid".to_string()] {
            let mut invalid = valid.clone();
            invalid
                .key_positions
                .as_mut()
                .unwrap()
                .get_mut("mode")
                .unwrap()[0]
                .id = invalid_id;
            assert_eq!(
                validation_code(
                    prepare_commit_patch_element_ids(&store, &mut invalid).unwrap_err()
                ),
                INVALID_ELEMENT_ID
            );
        }

        let mut merged_duplicate = valid;
        merged_duplicate
            .key_positions
            .as_mut()
            .unwrap()
            .get_mut("mode")
            .unwrap()[0]
            .id = store.stat_positions["mode"][0].position.id.clone();
        assert_eq!(
            validation_code(
                prepare_commit_patch_element_ids(&store, &mut merged_duplicate).unwrap_err()
            ),
            DUPLICATE_ELEMENT_ID
        );
    }

    #[test]
    fn v2_sprite_patch_requires_valid_globally_unique_pose_ids() {
        let mut store = store_with_all_collections();
        store.sprite_positions.insert(
            "mode".to_string(),
            vec![ReactiveSpritePosition {
                poses: vec![SpritePose::default()],
                ..ReactiveSpritePosition::default()
            }],
        );
        rekey_store_element_ids(&mut store);
        let valid = EditorPatchV1 {
            schema_version: EDITOR_COMMIT_SCHEMA_VERSION_V2,
            sprite_positions: Some(store.sprite_positions.clone()),
            ..EditorPatchV1::default()
        };

        for invalid_pose_id in [Uuid::nil().to_string(), "not-a-uuid".to_string()] {
            let mut invalid = valid.clone();
            invalid
                .sprite_positions
                .as_mut()
                .unwrap()
                .get_mut("mode")
                .unwrap()[0]
                .poses[0]
                .pose_id = invalid_pose_id;
            assert_eq!(
                validation_code(
                    prepare_commit_patch_element_ids(&store, &mut invalid).unwrap_err()
                ),
                INVALID_ELEMENT_ID
            );
        }

        let duplicate_pose_id = store.sprite_positions["mode"][0].poses[0].pose_id.clone();
        let mut duplicate = valid;
        duplicate.sprite_positions.as_mut().unwrap().insert(
            "other-mode".to_string(),
            vec![ReactiveSpritePosition {
                id: Uuid::new_v4().to_string(),
                poses: vec![SpritePose {
                    pose_id: duplicate_pose_id,
                    ..SpritePose::default()
                }],
                ..ReactiveSpritePosition::default()
            }],
        );
        assert_eq!(
            validation_code(prepare_commit_patch_element_ids(&store, &mut duplicate).unwrap_err()),
            DUPLICATE_ELEMENT_ID
        );
    }

    #[test]
    fn v1_idless_sprite_pose_reorder_inherits_ids_by_value() {
        let store = store_with_sprites(vec![ReactiveSpritePosition {
            poses: vec![sprite_pose(10, 1.0), sprite_pose(20, 2.0)],
            ..ReactiveSpritePosition::default()
        }]);
        let original = &store.sprite_positions["mode"][0];
        let original_ids = original
            .poses
            .iter()
            .map(|pose| pose.pose_id.clone())
            .collect::<Vec<_>>();
        let mut candidate = original.clone();
        candidate.poses.swap(0, 1);
        for pose in &mut candidate.poses {
            pose.pose_id.clear();
        }

        let assigned = prepare_v1_sprite_patch(&store, vec![candidate]);

        assert_eq!(assigned[0].poses[0].pose_id, original_ids[1]);
        assert_eq!(assigned[0].poses[1].pose_id, original_ids[0]);
    }

    #[test]
    fn v1_idless_sprite_pose_value_change_gets_fresh_id() {
        let store = store_with_sprites(vec![ReactiveSpritePosition {
            poses: vec![sprite_pose(10, 1.0)],
            ..ReactiveSpritePosition::default()
        }]);
        let original = &store.sprite_positions["mode"][0];
        let original_pose_id = original.poses[0].pose_id.clone();
        let mut candidate = original.clone();
        candidate.poses[0].pose_id.clear();
        candidate.poses[0].transform.x = 9.0;

        let assigned = prepare_v1_sprite_patch(&store, vec![candidate]);
        let assigned_pose_id = &assigned[0].poses[0].pose_id;

        assert_ne!(assigned_pose_id, &original_pose_id);
        assert!(is_valid_element_id(assigned_pose_id));
    }

    #[test]
    fn v1_idless_sprite_pose_normalizes_triggers_for_value_matching() {
        let trigger_a = Uuid::from_u128(10).to_string();
        let trigger_b = Uuid::from_u128(20).to_string();
        let store = store_with_sprites(vec![ReactiveSpritePosition {
            poses: vec![SpritePose {
                triggers: vec![trigger_a.clone(), trigger_b.clone()],
                ..SpritePose::default()
            }],
            ..ReactiveSpritePosition::default()
        }]);
        let original = &store.sprite_positions["mode"][0];
        let original_pose_id = original.poses[0].pose_id.clone();
        let mut candidate = original.clone();
        candidate.poses[0].pose_id.clear();
        candidate.poses[0].triggers = vec![trigger_b, trigger_a.clone(), trigger_a];

        let assigned = prepare_v1_sprite_patch(&store, vec![candidate]);

        assert_eq!(assigned[0].poses[0].pose_id, original_pose_id);
    }

    #[test]
    fn v1_idless_sprite_pose_does_not_inherit_from_another_sprite() {
        let store = store_with_sprites(vec![
            ReactiveSpritePosition {
                poses: vec![sprite_pose(10, 1.0)],
                ..ReactiveSpritePosition::default()
            },
            ReactiveSpritePosition {
                poses: vec![sprite_pose(20, 2.0)],
                ..ReactiveSpritePosition::default()
            },
        ]);
        let sprites = &store.sprite_positions["mode"];
        let first_pose_id = sprites[0].poses[0].pose_id.clone();
        let second_pose_id = sprites[1].poses[0].pose_id.clone();
        let mut candidate = sprites.clone();
        candidate[0].poses[0] = candidate[1].poses[0].clone();
        candidate[0].poses[0].pose_id.clear();

        let assigned = prepare_v1_sprite_patch(&store, candidate);
        let assigned_pose_id = &assigned[0].poses[0].pose_id;

        assert_ne!(assigned_pose_id, &first_pose_id);
        assert_ne!(assigned_pose_id, &second_pose_id);
        assert!(is_valid_element_id(assigned_pose_id));
        assert_eq!(assigned[1].poses[0].pose_id, second_pose_id);
    }

    #[test]
    fn v1_idless_new_sprite_parent_gets_fresh_pose_ids() {
        let store = store_with_sprites(vec![ReactiveSpritePosition {
            poses: vec![sprite_pose(10, 1.0), sprite_pose(20, 2.0)],
            ..ReactiveSpritePosition::default()
        }]);
        let original = &store.sprite_positions["mode"][0];
        let original_pose_ids = original
            .poses
            .iter()
            .map(|pose| pose.pose_id.clone())
            .collect::<HashSet<_>>();
        let mut candidate = original.clone();
        candidate.id.clear();
        for pose in &mut candidate.poses {
            pose.pose_id.clear();
        }

        let assigned = prepare_v1_sprite_patch(&store, vec![candidate]);

        assert_ne!(assigned[0].id, original.id);
        assert!(assigned[0]
            .poses
            .iter()
            .all(|pose| !original_pose_ids.contains(&pose.pose_id)));
    }

    #[test]
    fn v1_idless_equal_sprite_poses_consume_current_ids_in_order() {
        let pose = sprite_pose(10, 1.0);
        let store = store_with_sprites(vec![ReactiveSpritePosition {
            poses: vec![pose.clone(), pose],
            ..ReactiveSpritePosition::default()
        }]);
        let original = &store.sprite_positions["mode"][0];
        let original_ids = original
            .poses
            .iter()
            .map(|pose| pose.pose_id.clone())
            .collect::<Vec<_>>();
        let mut candidate = original.clone();
        for pose in &mut candidate.poses {
            pose.pose_id.clear();
        }

        let assigned = prepare_v1_sprite_patch(&store, vec![candidate]);
        let assigned_ids = assigned[0]
            .poses
            .iter()
            .map(|pose| pose.pose_id.clone())
            .collect::<Vec<_>>();

        assert_eq!(assigned_ids, original_ids);
    }

    #[test]
    fn v1_preserves_explicit_current_ids_and_rekeys_stale_ids() {
        let store = store_with_all_collections();
        let current_id = store.key_positions["mode"][0].id.clone();
        let stale_id = Uuid::new_v4().to_string();
        let mut positions = store.key_positions.clone();
        positions.get_mut("mode").unwrap()[0].dx = 99.0;
        positions.get_mut("mode").unwrap()[1].id = stale_id.clone();
        let mut patch = EditorPatchV1 {
            key_positions: Some(positions),
            ..EditorPatchV1::default()
        };

        prepare_commit_patch_element_ids(&store, &mut patch).unwrap();

        let positions = &patch.key_positions.unwrap()["mode"];
        assert_eq!(positions[0].id, current_id);
        assert_ne!(positions[1].id, stale_id);
        assert!(is_valid_element_id(&positions[1].id));
    }

    #[test]
    fn v1_idless_reorder_append_and_tie_groups_are_deterministic() {
        let mut store = AppStoreData {
            key_positions: HashMap::from([(
                "mode".to_string(),
                vec![position(1.0), position(1.0), position(2.0)],
            )]),
            ..AppStoreData::default()
        };
        rekey_store_element_ids(&mut store);
        let original_ids = store.key_positions["mode"]
            .iter()
            .map(|position| position.id.clone())
            .collect::<Vec<_>>();
        let mut candidate = vec![position(1.0), position(1.0), position(2.0), position(3.0)];
        candidate.swap(0, 2);
        let mut first = EditorPatchV1 {
            key_positions: Some(HashMap::from([("mode".to_string(), candidate.clone())])),
            ..EditorPatchV1::default()
        };

        prepare_commit_patch_element_ids(&store, &mut first).unwrap();
        let assigned = first.key_positions.as_ref().unwrap()["mode"]
            .iter()
            .map(|position| position.id.clone())
            .collect::<Vec<_>>();
        assert_eq!(assigned[0], original_ids[2]);
        assert_eq!(assigned[1], original_ids[0]);
        assert_eq!(assigned[2], original_ids[1]);
        assert!(!original_ids.contains(&assigned[3]));

        let mut canonical = store.clone();
        canonical.key_positions = first.key_positions.unwrap();
        let mut repeated = EditorPatchV1 {
            key_positions: Some(HashMap::from([("mode".to_string(), candidate)])),
            ..EditorPatchV1::default()
        };
        prepare_commit_patch_element_ids(&canonical, &mut repeated).unwrap();
        let repeated_ids = repeated.key_positions.unwrap()["mode"]
            .iter()
            .map(|position| position.id.clone())
            .collect::<Vec<_>>();
        assert_eq!(repeated_ids, assigned);
    }

    #[test]
    fn v1_mixed_attribute_edit_reorder_and_append_succeeds() {
        let mut store = AppStoreData {
            key_positions: HashMap::from([(
                "mode".to_string(),
                vec![position(1.0), position(2.0)],
            )]),
            ..AppStoreData::default()
        };
        rekey_store_element_ids(&mut store);
        let first_id = store.key_positions["mode"][0].id.clone();
        let second_id = store.key_positions["mode"][1].id.clone();
        let mut edited = store.key_positions["mode"][1].clone();
        edited.dx = 20.0;
        let mut patch = EditorPatchV1 {
            key_positions: Some(HashMap::from([(
                "mode".to_string(),
                vec![edited, position(1.0), position(3.0)],
            )])),
            ..EditorPatchV1::default()
        };

        prepare_commit_patch_element_ids(&store, &mut patch).unwrap();

        let positions = &patch.key_positions.unwrap()["mode"];
        assert_eq!(positions[0].id, second_id);
        assert_eq!(positions[1].id, first_id);
        assert!(is_valid_element_id(&positions[2].id));
        assert_ne!(positions[2].id, first_id);
        assert_ne!(positions[2].id, second_id);
    }

    #[test]
    fn v1_idless_positions_only_value_change_keeps_ids_by_index() {
        let store = store_with_all_collections();
        let original = store.key_positions["mode"]
            .iter()
            .map(|position| position.id.clone())
            .collect::<Vec<_>>();
        let mut patch = EditorPatchV1 {
            key_positions: Some(HashMap::from([(
                "mode".to_string(),
                vec![position(50.0), position(2.0)],
            )])),
            ..EditorPatchV1::default()
        };

        prepare_commit_patch_element_ids(&store, &mut patch).unwrap();

        // 같은 길이 positions 단독 패치는 index가 신원 - 값이 바뀐 요소도 ID를
        // 유지해 id 순서가 보존되고 paired id-order 검사와 충돌하지 않는다
        let positions = &patch.key_positions.unwrap()["mode"];
        assert_eq!(positions[0].id, original[0]);
        assert_eq!(positions[1].id, original[1]);
    }

    #[test]
    fn v1_idless_positions_only_swap_is_treated_as_in_place_edits() {
        let store = store_with_all_collections();
        let original = store.key_positions["mode"]
            .iter()
            .map(|position| position.id.clone())
            .collect::<Vec<_>>();
        let mut patch = EditorPatchV1 {
            key_positions: Some(HashMap::from([(
                "mode".to_string(),
                vec![position(2.0), position(1.0)],
            )])),
            ..EditorPatchV1::default()
        };

        prepare_commit_patch_element_ids(&store, &mut patch).unwrap();

        // 같은 길이 값 스왑은 두 건의 제자리 값 편집으로 해석 - keys 미동반
        // 패치가 신원 재배열로 번지지 않는다
        let positions = &patch.key_positions.unwrap()["mode"];
        assert_eq!(positions[0].id, original[0]);
        assert_eq!(positions[1].id, original[1]);
    }

    #[test]
    fn v1_idless_equal_length_delete_and_append_does_not_reuse_the_deleted_id() {
        let mut store = AppStoreData {
            stat_positions: HashMap::from([(
                "mode".to_string(),
                vec![
                    stat_position(StatType::Kps, 1.0),
                    stat_position(StatType::Kps, 2.0),
                    stat_position(StatType::Kps, 3.0),
                ],
            )]),
            ..AppStoreData::default()
        };
        rekey_store_element_ids(&mut store);
        let ids = store.stat_positions["mode"]
            .iter()
            .map(|element| element.position.id.clone())
            .collect::<Vec<_>>();
        // 가운데를 지우고 새 요소를 덧붙인다 - 길이는 그대로다
        let mut patch = EditorPatchV1 {
            stat_positions: Some(HashMap::from([(
                "mode".to_string(),
                vec![
                    stat_position(StatType::Kps, 1.0),
                    stat_position(StatType::Kps, 3.0),
                    stat_position(StatType::Kps, 9.0),
                ],
            )])),
            ..EditorPatchV1::default()
        };

        prepare_commit_patch_element_ids(&store, &mut patch).unwrap();

        // 살아남은 요소는 값으로 자기 신원을 지키고, 신규 요소는 삭제된
        // 요소의 신원을 물려받지 않는다
        let positions = &patch.stat_positions.unwrap()["mode"];
        assert_eq!(positions[0].position.id, ids[0]);
        assert_eq!(positions[1].position.id, ids[2]);
        assert!(!ids.contains(&positions[2].position.id));
        assert!(is_valid_element_id(&positions[2].position.id));
    }

    #[test]
    fn v1_paired_value_swap_keeps_ids_with_their_slots() {
        let store = keyed_store(
            vec![KeySlot::from("A"), KeySlot::from("B")],
            vec![position(1.0), position(2.0)],
        );
        let id_a = store.key_positions["mode"][0].id.clone();
        let id_b = store.key_positions["mode"][1].id.clone();
        let mut patch = paired_patch(
            vec![KeySlot::from("A"), KeySlot::from("B")],
            vec![position(2.0), position(1.0)],
        );

        prepare_commit_patch_element_ids(&store, &mut patch).unwrap();

        // 슬롯이 그대로면 좌표 맞바꿈은 제자리 값 편집이다 - keys 미동반
        // 패치와 같은 결과를 낸다
        let positions = &patch.key_positions.unwrap()["mode"];
        assert_eq!(positions[0].id, id_a);
        assert_eq!(positions[1].id, id_b);
    }

    #[test]
    fn v1_idless_patch_prefers_same_mode_and_never_steals_across_modes() {
        let mut store = AppStoreData {
            stat_positions: HashMap::from([
                ("modeA".to_string(), Vec::new()),
                (
                    "modeB".to_string(),
                    vec![StatPosition {
                        stat_type: StatType::Kps,
                        position: position(10.0),
                    }],
                ),
            ]),
            ..AppStoreData::default()
        };
        rekey_store_element_ids(&mut store);
        let id_b = store.stat_positions["modeB"][0].position.id.clone();
        let mut patch = EditorPatchV1 {
            stat_positions: Some(HashMap::from([
                (
                    "modeA".to_string(),
                    vec![StatPosition {
                        stat_type: StatType::Kps,
                        position: position(10.0),
                    }],
                ),
                (
                    "modeB".to_string(),
                    vec![StatPosition {
                        stat_type: StatType::Kps,
                        position: position(10.0),
                    }],
                ),
            ])),
            ..EditorPatchV1::default()
        };

        prepare_commit_patch_element_ids(&store, &mut patch).unwrap();

        // 레이아웃을 다른 모드로 복사해도 원본 모드가 자기 ID를 지킨다
        let positions = patch.stat_positions.unwrap();
        assert_eq!(positions["modeB"][0].position.id, id_b);
        assert_ne!(positions["modeA"][0].position.id, id_b);
        assert!(is_valid_element_id(&positions["modeA"][0].position.id));
    }

    fn keyed_store(slots: Vec<KeySlot>, positions: Vec<KeyPosition>) -> AppStoreData {
        let mut store = AppStoreData {
            keys: HashMap::from([("mode".to_string(), slots)]),
            key_positions: HashMap::from([("mode".to_string(), positions)]),
            ..AppStoreData::default()
        };
        rekey_store_element_ids(&mut store);
        store
    }

    fn paired_patch(slots: Vec<KeySlot>, positions: Vec<KeyPosition>) -> EditorPatchV1 {
        EditorPatchV1 {
            keys: Some(HashMap::from([("mode".to_string(), slots)])),
            key_positions: Some(HashMap::from([("mode".to_string(), positions)])),
            ..EditorPatchV1::default()
        }
    }

    #[test]
    fn v1_paired_reorder_moves_ids_with_their_key_slots() {
        let store = keyed_store(
            vec![KeySlot::from("A"), KeySlot::from("B")],
            vec![position(1.0), position(1.0)],
        );
        let id_a = store.key_positions["mode"][0].id.clone();
        let id_b = store.key_positions["mode"][1].id.clone();
        let mut patch = paired_patch(
            vec![KeySlot::from("B"), KeySlot::from("A")],
            vec![position(1.0), position(1.0)],
        );

        prepare_commit_patch_element_ids(&store, &mut patch).unwrap();

        let positions = &patch.key_positions.unwrap()["mode"];
        assert_eq!(positions[0].id, id_b);
        assert_eq!(positions[1].id, id_a);
    }

    #[test]
    fn v1_paired_rebind_falls_back_to_value_inheritance() {
        let store = keyed_store(
            vec![KeySlot::from("A"), KeySlot::from("B")],
            vec![position(1.0), position(2.0)],
        );
        let id_a = store.key_positions["mode"][0].id.clone();
        let id_b = store.key_positions["mode"][1].id.clone();
        let mut patch = paired_patch(
            vec![KeySlot::from("A"), KeySlot::from("C")],
            vec![position(1.0), position(2.0)],
        );

        prepare_commit_patch_element_ids(&store, &mut patch).unwrap();

        let positions = &patch.key_positions.unwrap()["mode"];
        assert_eq!(positions[0].id, id_a);
        assert_eq!(positions[1].id, id_b);
    }

    #[test]
    fn v1_paired_slot_match_wins_over_earlier_value_steal() {
        let store = keyed_store(
            vec![KeySlot::from("A"), KeySlot::from("B")],
            vec![position(1.0), position(1.0)],
        );
        let id_a = store.key_positions["mode"][0].id.clone();
        let id_b = store.key_positions["mode"][1].id.clone();
        let mut patch = paired_patch(
            vec![KeySlot::from("C"), KeySlot::from("A")],
            vec![position(1.0), position(1.0)],
        );

        prepare_commit_patch_element_ids(&store, &mut patch).unwrap();

        // 슬롯 정확 일치(A)가 먼저 소진되고, 새 슬롯 C는 남은 값 승계를 받는다
        let positions = &patch.key_positions.unwrap()["mode"];
        assert_eq!(positions[1].id, id_a);
        assert_eq!(positions[0].id, id_b);
    }

    #[test]
    fn v1_paired_slot_keeps_id_when_only_the_position_value_changes() {
        let store = keyed_store(
            vec![KeySlot::from("A"), KeySlot::from("B")],
            vec![position(1.0), position(2.0)],
        );
        let id_a = store.key_positions["mode"][0].id.clone();
        let id_b = store.key_positions["mode"][1].id.clone();
        let mut patch = paired_patch(
            vec![KeySlot::from("A"), KeySlot::from("B")],
            vec![position(50.0), position(2.0)],
        );

        prepare_commit_patch_element_ids(&store, &mut patch).unwrap();

        // 슬롯이 그대로면 위치 값이 바뀌어도 신원이 유지된다 - 이동은 신원
        // 회전이 아니다
        let positions = &patch.key_positions.unwrap()["mode"];
        assert_eq!(positions[0].id, id_a);
        assert_eq!(positions[1].id, id_b);
    }

    #[test]
    fn v1_paired_duplicate_slots_keep_their_own_ids_by_index() {
        let store = keyed_store(
            vec![KeySlot::from("A"), KeySlot::from("A")],
            vec![position(1.0), position(2.0)],
        );
        let first = store.key_positions["mode"][0].id.clone();
        let second = store.key_positions["mode"][1].id.clone();
        let mut patch = paired_patch(
            vec![KeySlot::from("A"), KeySlot::from("A")],
            vec![position(10.0), position(20.0)],
        );

        prepare_commit_patch_element_ids(&store, &mut patch).unwrap();

        // 슬롯이 겹쳐도 index 정렬로 각자 자기 ID를 지킨다
        let positions = &patch.key_positions.unwrap()["mode"];
        assert_eq!(positions[0].id, first);
        assert_eq!(positions[1].id, second);
    }

    #[test]
    fn v1_paired_rebind_never_steals_ids_from_other_modes() {
        let mut store = AppStoreData {
            keys: HashMap::from([
                ("modeA".to_string(), vec![KeySlot::from("X")]),
                ("modeB".to_string(), vec![KeySlot::from("X")]),
            ]),
            key_positions: HashMap::from([
                ("modeA".to_string(), vec![position(1.0)]),
                ("modeB".to_string(), vec![position(1.0)]),
            ]),
            ..AppStoreData::default()
        };
        rekey_store_element_ids(&mut store);
        let id_a = store.key_positions["modeA"][0].id.clone();
        let id_b = store.key_positions["modeB"][0].id.clone();
        let mut patch = EditorPatchV1 {
            keys: Some(HashMap::from([
                ("modeA".to_string(), vec![KeySlot::from("Y")]),
                ("modeB".to_string(), vec![KeySlot::from("X")]),
            ])),
            key_positions: Some(HashMap::from([
                ("modeA".to_string(), vec![position(1.0)]),
                ("modeB".to_string(), vec![position(1.0)]),
            ])),
            ..EditorPatchV1::default()
        };

        prepare_commit_patch_element_ids(&store, &mut patch).unwrap();

        // modeB는 변경이 없으므로 자기 ID를 지키고, modeA 재바인딩은
        // 같은 모드 값 폴백으로 자기 ID를 유지한다
        let positions = patch.key_positions.unwrap();
        assert_eq!(positions["modeB"][0].id, id_b);
        assert_eq!(positions["modeA"][0].id, id_a);
    }

    #[test]
    fn v1_paired_slot_matching_is_structural_not_canonical() {
        let single = KeySlot::from("A+B");
        let multi = KeySlot::Multi {
            keys: vec!["A".to_string(), "B".to_string()],
            match_mode: SlotMatch::All,
        };
        assert_eq!(single.canonical(), multi.canonical());
        let store = keyed_store(
            vec![single.clone(), multi.clone()],
            vec![position(1.0), position(1.0)],
        );
        let id_single = store.key_positions["mode"][0].id.clone();
        let id_multi = store.key_positions["mode"][1].id.clone();
        let mut patch = paired_patch(vec![multi, single], vec![position(1.0), position(1.0)]);

        prepare_commit_patch_element_ids(&store, &mut patch).unwrap();

        // canonical이 같아도 구조가 다르면 각자의 슬롯을 따라간다
        let positions = &patch.key_positions.unwrap()["mode"];
        assert_eq!(positions[0].id, id_multi);
        assert_eq!(positions[1].id, id_single);
    }

    #[test]
    fn v1_stale_snapshot_id_never_revives_after_deletion() {
        let mut store = AppStoreData {
            key_positions: HashMap::from([("mode".to_string(), vec![position(1.0)])]),
            ..AppStoreData::default()
        };
        rekey_store_element_ids(&mut store);
        let deleted_id = store.key_positions["mode"][0].id.clone();
        let stale_element = store.key_positions["mode"][0].clone();
        store.key_positions.get_mut("mode").unwrap().clear();
        let mut patch = EditorPatchV1 {
            key_positions: Some(HashMap::from([("mode".to_string(), vec![stale_element])])),
            ..EditorPatchV1::default()
        };

        prepare_commit_patch_element_ids(&store, &mut patch).unwrap();

        let replacement_id = &patch.key_positions.unwrap()["mode"][0].id;
        assert_ne!(replacement_id, &deleted_id);
        assert!(is_valid_element_id(replacement_id));
    }

    #[test]
    fn v1_rejects_nil_and_non_uuid_supplied_ids() {
        let store = store_with_all_collections();
        for invalid_id in [Uuid::nil().to_string(), "not-a-uuid".to_string()] {
            let mut positions = store.key_positions.clone();
            positions.get_mut("mode").unwrap()[0].id = invalid_id;
            let mut patch = EditorPatchV1 {
                key_positions: Some(positions),
                ..EditorPatchV1::default()
            };
            assert_eq!(
                validation_code(prepare_commit_patch_element_ids(&store, &mut patch).unwrap_err()),
                INVALID_ELEMENT_ID
            );
        }
    }

    #[test]
    fn v1_duplicating_a_read_element_rekeys_the_copy_instead_of_failing() {
        let store = store_with_all_collections();
        let original = store.key_positions["mode"][0].id.clone();
        // 플러그인의 관용 패턴: 읽어온 위치 객체를 펼쳐 복사해 배열에 덧붙인다
        let mut positions = store.key_positions.clone();
        let mut copy = positions["mode"][0].clone();
        copy.dx = 300.0;
        positions.get_mut("mode").unwrap().push(copy);
        let mut patch = EditorPatchV1 {
            key_positions: Some(positions),
            ..EditorPatchV1::default()
        };

        prepare_commit_patch_element_ids(&store, &mut patch).unwrap();

        let positions = &patch.key_positions.unwrap()["mode"];
        assert_eq!(positions[0].id, original);
        assert_ne!(positions[2].id, original);
        assert!(is_valid_element_id(&positions[2].id));
    }

    #[test]
    fn v1_supplied_id_from_another_collection_is_rekeyed() {
        let store = store_with_all_collections();
        let stat_id = store.stat_positions["mode"][0].position.id.clone();
        let mut positions = store.key_positions.clone();
        positions.get_mut("mode").unwrap()[0].id = stat_id.clone();
        let mut patch = EditorPatchV1 {
            key_positions: Some(positions),
            ..EditorPatchV1::default()
        };

        prepare_commit_patch_element_ids(&store, &mut patch).unwrap();

        // 다른 컬렉션의 신원을 키 위치로 이식할 수 없다
        let positions = &patch.key_positions.unwrap()["mode"];
        assert_ne!(positions[0].id, stat_id);
        assert!(is_valid_element_id(&positions[0].id));
    }
}
