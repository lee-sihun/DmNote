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

fn stat_position(stat_type: StatType, dx: f64) -> StatPosition {
    StatPosition {
        stat_type,
        position: position(dx),
    }
}

fn store_with_all_collections() -> AppStoreData {
    let mut store = AppStoreData {
        key_positions: HashMap::from([("mode".to_string(), vec![position(1.0), position(2.0)])]),
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
            validation_code(prepare_commit_patch_element_ids(&store, &mut invalid).unwrap_err()),
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
        key_positions: HashMap::from([("mode".to_string(), vec![position(1.0), position(2.0)])]),
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
