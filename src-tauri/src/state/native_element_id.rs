use std::collections::{HashMap, HashSet};

use uuid::Uuid;

use crate::{
    errors::EditorCommitError,
    models::{
        AppStoreData, EditorDocumentV1, EditorPatchV1, GraphPosition, KeyMappings, KeyPosition,
        KeySlot, KnobPosition, StatPosition, EDITOR_COMMIT_SCHEMA_VERSION_V2,
        EDITOR_SCHEMA_VERSION,
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
    fn position(&self) -> &KeyPosition;
    fn position_mut(&mut self) -> &mut KeyPosition;
}

impl NativeElement for KeyPosition {
    fn position(&self) -> &KeyPosition {
        self
    }

    fn position_mut(&mut self) -> &mut KeyPosition {
        self
    }
}

impl NativeElement for StatPosition {
    fn position(&self) -> &KeyPosition {
        &self.position
    }

    fn position_mut(&mut self) -> &mut KeyPosition {
        &mut self.position
    }
}

impl NativeElement for GraphPosition {
    fn position(&self) -> &KeyPosition {
        &self.position
    }

    fn position_mut(&mut self) -> &mut KeyPosition {
        &mut self.position
    }
}

impl NativeElement for KnobPosition {
    fn position(&self) -> &KeyPosition {
        &self.position
    }

    fn position_mut(&mut self) -> &mut KeyPosition {
        &mut self.position
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
            let id = &element.position().id;
            if is_valid_element_id(id) && seen.insert(id.clone()) {
                continue;
            }

            // valid는 non-empty를 함의하므로 `|| valid`는 죽은 절이었다
            if !id.is_empty() {
                outcome.repaired = true;
            }
            let id = new_unique_id(reserved);
            seen.insert(id.clone());
            element.position_mut().id = id;
            outcome.changed = true;
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
    outcome
}

fn collect_collection_ids<T: NativeElement>(
    collection: &HashMap<String, Vec<T>>,
    ids: &mut HashSet<String>,
) {
    for elements in collection.values() {
        for element in elements {
            if is_valid_element_id(&element.position().id) {
                ids.insert(element.position().id.clone());
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
    ids
}

fn rekey_collection<T: NativeElement>(
    collection: &mut HashMap<String, Vec<T>>,
    reserved: &mut HashSet<String>,
) {
    for mode in sorted_modes(collection) {
        if let Some(elements) = collection.get_mut(&mode) {
            for element in elements {
                element.position_mut().id = new_unique_id(reserved);
            }
        }
    }
}

pub(crate) fn rekey_store_element_ids(store: &mut AppStoreData) {
    let mut reserved = collect_store_ids(store);
    rekey_collection(&mut store.key_positions, &mut reserved);
    rekey_collection(&mut store.stat_positions, &mut reserved);
    rekey_collection(&mut store.graph_positions, &mut reserved);
    rekey_collection(&mut store.knob_positions, &mut reserved);
}

fn rekey_collection_mode<T: NativeElement>(
    collection: &mut HashMap<String, Vec<T>>,
    mode: &str,
    reserved: &mut HashSet<String>,
) {
    if let Some(elements) = collection.get_mut(mode) {
        for element in elements {
            element.position_mut().id = new_unique_id(reserved);
        }
    }
}

pub(crate) fn rekey_mode_element_ids(store: &mut AppStoreData, mode: &str) {
    rekey_mode_element_ids_for_collections(store, mode, true, true, true, true);
}

pub(crate) fn rekey_mode_element_ids_for_collections(
    store: &mut AppStoreData,
    mode: &str,
    key_positions: bool,
    stat_positions: bool,
    graph_positions: bool,
    knob_positions: bool,
) {
    let mut reserved = collect_store_ids(store);
    if key_positions {
        rekey_collection_mode(&mut store.key_positions, mode, &mut reserved);
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
        let id = &element.position().id;
        if is_valid_element_id(id) && seen.insert(id.clone()) {
            continue;
        }

        // valid는 non-empty를 함의하므로 `|| valid`는 죽은 절이었다
        if !id.is_empty() {
            outcome.repaired = true;
        }
        let id = new_unique_id(reserved);
        seen.insert(id.clone());
        element.position_mut().id = id;
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
) -> BackfillOutcome {
    let mut seen = HashSet::new();
    collect_collection_ids_outside_target(&store.key_positions, mode, key_positions, &mut seen);
    collect_collection_ids_outside_target(&store.stat_positions, mode, stat_positions, &mut seen);
    collect_collection_ids_outside_target(&store.graph_positions, mode, graph_positions, &mut seen);
    collect_collection_ids_outside_target(&store.knob_positions, mode, knob_positions, &mut seen);
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
            if is_valid_element_id(&element.position().id) {
                ids.insert(element.position().id.clone());
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
            let id = &element.position().id;
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
            if !seen.insert(id.clone()) {
                return Err(EditorCommitError::validation(
                    DUPLICATE_ELEMENT_ID,
                    format!("native element ID {id} appears more than once in the commit"),
                ));
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
            let id = &element.position().id;
            if !id.is_empty() {
                owned.insert(id.clone(), (mode.clone(), index));
            }
        }
    }

    let mut occurrences: HashMap<String, Vec<(String, usize)>> = HashMap::new();
    for mode in sorted_modes(candidate) {
        let Some(elements) = candidate.get(&mode) else {
            continue;
        };
        for (index, element) in elements.iter().enumerate() {
            let id = &element.position().id;
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
                .entry(id.clone())
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
            element.position_mut().id.clear();
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
    Ok(())
}

/// id를 비운 값 사본. 비교마다 양쪽을 clone하지 않도록, 스캔 전에 한 번씩만
/// 만들어 재사용한다 (승계 웨이브의 순서·우선순위는 그대로 유지)
fn value_without_id<T: NativeElement>(element: &T) -> T {
    let mut copy = element.clone();
    copy.position_mut().id.clear();
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
            let id = element.position().id.clone();
            if id.is_empty() {
                continue;
            }
            if canonical_ids.contains(&id) {
                consumed_current_ids.insert(id);
            } else {
                element.position_mut().id = new_unique_id(reserved);
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
            if !element.position().id.is_empty() {
                continue;
            }
            let target = value_without_id(&*element);
            let inherited = current_elements
                .iter()
                .zip(&normalized_current)
                .find(|(current_element, normalized)| {
                    let current_id = &current_element.position().id;
                    !consumed_current_ids.contains(current_id) && **normalized == target
                })
                .map(|(current_element, _)| current_element);
            if let Some(current_element) = inherited {
                let id = current_element.position().id.clone();
                consumed_current_ids.insert(id.clone());
                element.position_mut().id = id;
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
            if !element.position().id.is_empty() {
                continue;
            }
            let target = value_without_id(&*element);
            let inherited = current_elements
                .iter()
                .zip(&normalized_current)
                .find(|(current_element, normalized)| {
                    let current_id = &current_element.position().id;
                    !consumed_current_ids.contains(current_id) && **normalized == target
                })
                .map(|(current_element, _)| current_element);
            if let Some(current_element) = inherited {
                let id = current_element.position().id.clone();
                consumed_current_ids.insert(id.clone());
                element.position_mut().id = id;
            } else {
                element.position_mut().id = new_unique_id(reserved);
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
            let id = &element.position().id;
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
            if !seen.insert(id.clone()) {
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
    validate_document_collection_ids(&document.knob_positions, &mut seen)
}

fn patch_includes_native_elements(patch: &EditorPatchV1) -> bool {
    patch.key_positions.is_some()
        || patch.stat_positions.is_some()
        || patch.graph_positions.is_some()
        || patch.knob_positions.is_some()
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
mod tests;
