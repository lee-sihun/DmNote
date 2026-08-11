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

pub(crate) fn is_valid_element_id(id: &str) -> bool {
    Uuid::parse_str(id).is_ok_and(|id| !id.is_nil())
}

fn new_unique_id(reserved: &mut HashSet<String>) -> String {
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
            let valid = is_valid_element_id(id);
            if valid && seen.insert(id.clone()) {
                continue;
            }

            if !id.is_empty() || valid {
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

fn same_value_without_id<T: NativeElement>(left: &T, right: &T) -> bool {
    let mut left = left.clone();
    let mut right = right.clone();
    left.position_mut().id.clear();
    right.position_mut().id.clear();
    left == right
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

fn inherit_ids_by_value<T: NativeElement>(
    current_elements: &[T],
    candidate: &mut HashMap<String, Vec<T>>,
    consumed_current_ids: &mut HashSet<String>,
    reserved: &mut HashSet<String>,
) {
    for mode in sorted_modes(candidate) {
        let Some(elements) = candidate.get_mut(&mode) else {
            continue;
        };
        for element in elements {
            if !element.position().id.is_empty() {
                continue;
            }
            let inherited = current_elements.iter().find(|current_element| {
                let current_id = &current_element.position().id;
                !consumed_current_ids.contains(current_id)
                    && same_value_without_id(*current_element, &*element)
            });
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

fn adapt_v1_collection<T: NativeElement>(
    current: &HashMap<String, Vec<T>>,
    candidate: &mut HashMap<String, Vec<T>>,
    canonical_ids: &HashSet<String>,
    consumed_current_ids: &mut HashSet<String>,
    reserved: &mut HashSet<String>,
) {
    keep_or_rekey_supplied_ids(candidate, canonical_ids, consumed_current_ids, reserved);
    inherit_ids_by_value(
        &ordered_current_elements(current),
        candidate,
        consumed_current_ids,
        reserved,
    );
}

struct SlotPairedPosition {
    mode: String,
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
            let inherited = current_pairs.iter().find(|pair| {
                (!same_mode_only || pair.mode == mode)
                    && (!match_slot || pair.slot.as_ref() == slot)
                    && !consumed_current_ids.contains(&pair.position.id)
                    && same_value_without_id(&pair.position, &*element)
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
        adapt_v1_collection(
            &store.key_positions,
            candidate,
            canonical_ids,
            consumed_current_ids,
            reserved,
        );
        return;
    };

    keep_or_rekey_supplied_ids(candidate, canonical_ids, consumed_current_ids, reserved);

    let current_pairs = slot_paired_current_positions(&store.keys, &store.key_positions);
    // 웨이브 순서: 같은 모드 슬롯+값 → 모드 간 슬롯+값(모드 이동) →
    // 같은 모드 값(재바인딩) → 마지막 전역 값 폴백과 신규 발급
    for (match_slot, same_mode_only) in [(true, true), (true, false), (false, true)] {
        consume_slot_paired_ids(
            candidate,
            patch_keys,
            &current_pairs,
            consumed_current_ids,
            match_slot,
            same_mode_only,
        );
    }

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
mod tests {
    use std::collections::{HashMap, HashSet};

    use crate::models::{
        AppStoreData, EditorPatchV1, GraphPosition, GraphStatType, GraphType, KeyPosition,
        KnobPosition, SlotMatch, StatPosition, StatType,
    };

    use super::*;

    fn position(dx: f64) -> KeyPosition {
        KeyPosition {
            dx,
            ..KeyPosition::default()
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
    fn v1_rejects_nil_non_uuid_and_duplicate_supplied_ids() {
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

        let mut positions = store.key_positions.clone();
        let duplicate = positions["mode"][0].id.clone();
        positions.get_mut("mode").unwrap()[1].id = duplicate;
        let mut patch = EditorPatchV1 {
            key_positions: Some(positions),
            ..EditorPatchV1::default()
        };
        assert_eq!(
            validation_code(prepare_commit_patch_element_ids(&store, &mut patch).unwrap_err()),
            DUPLICATE_ELEMENT_ID
        );
    }
}
