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

mod v1_adapter;

use v1_adapter::collect_collection_ids_outside_target;
pub(crate) use v1_adapter::{prepare_commit_patch_element_ids, validate_document_element_ids};

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

#[cfg(test)]
mod tests;
