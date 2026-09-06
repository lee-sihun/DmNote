use super::{
    delete_custom_tab_data, plan_custom_tab_delete, rename_custom_tab_metadata,
    reorder_change_payload, reorder_tab_metadata, reset_all_editor_data,
    reset_all_editor_data_with_images, reset_mode_data, reset_mode_data_with_images,
    reset_mode_kind, select_mode_if_available, set_mode_with, ModeResetKind, TabOrderOpV1,
};
use crate::{
    defaults::{default_keys, default_positions, default_stat_positions},
    keyboard::KeyboardManager,
    models::{
        AppStoreData, CustomTab, EditorCommitOrigin, EditorField, GraphPosition, GraphStatType,
        GraphType, KeyCounters, KeySlot, KnobPosition, LayerGroupDef, StatPosition, StatType,
        TabCss, TabNoteSettings,
    },
    state::{
        app_state::KeyCounterEventEmitter,
        history::{HistoryDirection, HistoryScope},
        store::PluginInstancesResetScope,
        AppState, AppStore,
    },
};
use std::{cell::Cell, collections::HashSet};

const TARGET_TAB: &str = "custom-target";

struct NoopCounterEmitter;

impl KeyCounterEventEmitter for NoopCounterEmitter {
    fn emit_key_counters(
        &self,
        _counters: &KeyCounters,
        _session_id: &str,
        _revision: u64,
    ) -> anyhow::Result<()> {
        Ok(())
    }

    fn emit_key_counter(
        &self,
        _mode: &str,
        _key: &str,
        _count: u32,
        _session_id: &str,
        _revision: u64,
    ) -> anyhow::Result<()> {
        Ok(())
    }
}

fn populated_custom_tab_store() -> AppStoreData {
    let position = default_positions()
        .values()
        .next()
        .and_then(|positions| positions.first())
        .cloned()
        .expect("default position fixture");
    let mut store = AppStoreData {
        custom_tabs: vec![
            CustomTab {
                id: "custom-before".to_string(),
                name: "Before".to_string(),
            },
            CustomTab {
                id: TARGET_TAB.to_string(),
                name: "Target".to_string(),
            },
        ],
        selected_key_type: TARGET_TAB.to_string(),
        ..AppStoreData::default()
    };
    store
        .keys
        .insert(TARGET_TAB.to_string(), vec![KeySlot::from("KeyD")]);
    store
        .key_positions
        .insert(TARGET_TAB.to_string(), vec![position.clone()]);
    store.stat_positions.insert(
        TARGET_TAB.to_string(),
        vec![StatPosition {
            stat_type: StatType::Kps,
            position: position.clone(),
        }],
    );
    store.graph_positions.insert(
        TARGET_TAB.to_string(),
        vec![GraphPosition {
            stat_type: GraphStatType::Kps,
            graph_type: GraphType::Line,
            graph_speed: 1,
            graph_color: "#ffffff".to_string(),
            show_avg_line: true,
            position: position.clone(),
        }],
    );
    store.knob_positions.insert(
        TARGET_TAB.to_string(),
        vec![KnobPosition {
            axis_id: "axis".to_string(),
            sensitivity: 1.0,
            reverse: false,
            position,
        }],
    );
    store.layer_groups.insert(
        TARGET_TAB.to_string(),
        vec![LayerGroupDef {
            id: "group".to_string(),
            name: "Group".to_string(),
        }],
    );
    store
        .tab_css_overrides
        .insert(TARGET_TAB.to_string(), TabCss::default());
    store
        .tab_note_overrides
        .insert(TARGET_TAB.to_string(), TabNoteSettings::default());
    store.key_counters.insert(
        TARGET_TAB.to_string(),
        [("KeyD".to_string(), 7)].into_iter().collect(),
    );
    store
}

#[test]
fn deleting_selected_custom_tab_clears_all_tab_scoped_data() {
    let mut store = populated_custom_tab_store();
    store.bar_count = 5;
    let plan = plan_custom_tab_delete(&store, TARGET_TAB).expect("delete plan");

    assert_eq!(plan.next_selected, "custom-before");
    delete_custom_tab_data(&mut store, TARGET_TAB, &plan);

    assert!(!store.custom_tabs.iter().any(|tab| tab.id == TARGET_TAB));
    assert!(!store.keys.contains_key(TARGET_TAB));
    assert!(!store.key_positions.contains_key(TARGET_TAB));
    assert!(!store.stat_positions.contains_key(TARGET_TAB));
    assert!(!store.graph_positions.contains_key(TARGET_TAB));
    assert!(!store.knob_positions.contains_key(TARGET_TAB));
    assert!(!store.layer_groups.contains_key(TARGET_TAB));
    assert!(!store.tab_css_overrides.contains_key(TARGET_TAB));
    assert!(!store.tab_note_overrides.contains_key(TARGET_TAB));
    assert!(!store.key_counters.contains_key(TARGET_TAB));
    assert_eq!(store.selected_key_type, "custom-before");
    assert_eq!(store.bar_count, 4);
}

#[test]
fn deleting_first_selected_tab_chooses_next_builtin_neighbor() {
    let mut store = populated_custom_tab_store();
    store.tab_order = [TARGET_TAB, "4key", "custom-before", "5key", "6key", "8key"]
        .map(str::to_string)
        .to_vec();

    let plan = plan_custom_tab_delete(&store, TARGET_TAB).expect("delete plan");

    assert_eq!(plan.next_selected, "4key");
    assert_eq!(
        plan.tab_order,
        ["4key", "custom-before", "5key", "6key", "8key"]
    );
}

#[test]
fn rename_rejects_long_reserved_duplicate_and_builtin_targets() {
    let mut store = populated_custom_tab_store();

    let (_, long_error, _) = rename_custom_tab_metadata(&mut store, TARGET_TAB, "12345678901");
    let (_, reserved_error, _) = rename_custom_tab_metadata(&mut store, TARGET_TAB, "4key");
    let (_, duplicate_error, _) = rename_custom_tab_metadata(&mut store, TARGET_TAB, "Before");
    let (_, builtin_error, _) = rename_custom_tab_metadata(&mut store, "4key", "Built in");

    assert_eq!(long_error.as_deref(), Some("name-too-long"));
    assert_eq!(reserved_error.as_deref(), Some("reserved-name"));
    assert_eq!(duplicate_error.as_deref(), Some("duplicate-name"));
    assert_eq!(builtin_error.as_deref(), Some("unknown-tab"));
    assert_eq!(
        store
            .custom_tabs
            .iter()
            .find(|tab| tab.id == TARGET_TAB)
            .unwrap()
            .name,
        "Target"
    );
}

#[test]
fn reorder_applies_after_unrelated_tab_is_created() {
    let mut store = crate::state::migration::normalize_state(AppStoreData::default());
    let unrelated_id = "created-after-drag".to_string();
    store.custom_tabs.push(CustomTab {
        id: unrelated_id.clone(),
        name: "Created later".to_string(),
    });
    store.tab_order =
        crate::state::tab_metadata::normalize_tab_order(&store.tab_order, &store.custom_tabs);

    let (snapshot, error, changed) = reorder_tab_metadata(
        &mut store,
        &TabOrderOpV1::Swap {
            a: "4key".to_string(),
            b: "5key".to_string(),
        },
    );

    assert!(error.is_none());
    assert!(changed);
    assert_eq!(
        snapshot.tab_order,
        ["5key", "4key", "6key", "8key", unrelated_id.as_str()]
    );
}

#[test]
fn reorder_applies_after_unrelated_tab_is_deleted() {
    let mut store = crate::state::migration::normalize_state(AppStoreData::default());
    let unrelated_id = "deleted-after-drag".to_string();
    store.custom_tabs.push(CustomTab {
        id: unrelated_id.clone(),
        name: "Deleted later".to_string(),
    });
    store.tab_order.push(unrelated_id.clone());
    store.custom_tabs.retain(|tab| tab.id != unrelated_id);
    store.tab_order.retain(|id| id != &unrelated_id);

    let (snapshot, error, changed) = reorder_tab_metadata(
        &mut store,
        &TabOrderOpV1::Swap {
            a: "6key".to_string(),
            b: "8key".to_string(),
        },
    );

    assert!(error.is_none());
    assert!(changed);
    assert_eq!(snapshot.tab_order, ["4key", "5key", "8key", "6key"]);
}

#[test]
fn reorder_unknown_tab_repairs_noncanonical_metadata() {
    let mut store = crate::state::migration::normalize_state(AppStoreData::default());
    store.tab_order = ["4key", "unknown", "4key", "5key"]
        .map(str::to_string)
        .to_vec();
    store.bar_count = 9;

    let (snapshot, error, changed) = reorder_tab_metadata(
        &mut store,
        &TabOrderOpV1::Swap {
            a: "missing".to_string(),
            b: "5key".to_string(),
        },
    );

    assert_eq!(error.as_deref(), Some("unknown-tab"));
    assert!(changed);
    assert_eq!(snapshot.tab_order, ["4key", "5key", "6key", "8key"]);
    assert_eq!(snapshot.bar_count, 4);
    assert_eq!(store.tab_order, snapshot.tab_order);
    assert_eq!(store.bar_count, snapshot.bar_count);
    assert!(reorder_change_payload(&snapshot, changed).is_some());
}

#[test]
fn reorder_same_tab_repairs_noncanonical_metadata() {
    let mut store = crate::state::migration::normalize_state(AppStoreData::default());
    store.tab_order = ["4key", "unknown", "4key", "5key"]
        .map(str::to_string)
        .to_vec();
    store.bar_count = 9;

    let (snapshot, error, changed) = reorder_tab_metadata(
        &mut store,
        &TabOrderOpV1::Swap {
            a: "4key".to_string(),
            b: "4key".to_string(),
        },
    );

    assert!(error.is_none());
    assert!(changed);
    assert_eq!(snapshot.tab_order, ["4key", "5key", "6key", "8key"]);
    assert_eq!(snapshot.bar_count, 4);
    assert_eq!(store.tab_order, snapshot.tab_order);
    assert_eq!(store.bar_count, snapshot.bar_count);
    assert!(reorder_change_payload(&snapshot, changed).is_some());
}

#[test]
fn reorder_rejects_each_missing_operand_with_current_snapshot() {
    for op in [
        TabOrderOpV1::Swap {
            a: "missing".to_string(),
            b: "5key".to_string(),
        },
        TabOrderOpV1::Swap {
            a: "4key".to_string(),
            b: "missing".to_string(),
        },
    ] {
        let mut store = crate::state::migration::normalize_state(AppStoreData::default());
        let before = store.clone();

        let (snapshot, error, changed) = reorder_tab_metadata(&mut store, &op);

        assert_eq!(error.as_deref(), Some("unknown-tab"));
        assert!(!changed);
        assert_eq!(snapshot.custom_tabs, before.custom_tabs);
        assert_eq!(snapshot.tab_order, before.tab_order);
        assert_eq!(snapshot.bar_count, before.bar_count);
        assert_eq!(snapshot.selected_key_type, before.selected_key_type);
        assert_eq!(store, before);
    }
}

#[test]
fn reorder_same_tab_is_a_no_op() {
    let mut store = crate::state::migration::normalize_state(AppStoreData::default());
    let before = store.clone();

    let (snapshot, error, changed) = reorder_tab_metadata(
        &mut store,
        &TabOrderOpV1::Swap {
            a: "4key".to_string(),
            b: "4key".to_string(),
        },
    );

    assert!(error.is_none());
    assert!(!changed);
    assert_eq!(snapshot.tab_order, before.tab_order);
    assert_eq!(store, before);
}

#[test]
fn reorder_true_no_op_preserves_history_events_and_store() {
    let directory = tempfile::tempdir().unwrap();
    let store = AppStore::initialize_for_test(directory.path()).unwrap();
    let before = store.snapshot();
    let history_before = store.history_status();

    for (op, expected_error) in [
        (
            TabOrderOpV1::Swap {
                a: "4key".to_string(),
                b: "4key".to_string(),
            },
            None,
        ),
        (
            TabOrderOpV1::Swap {
                a: "missing".to_string(),
                b: "5key".to_string(),
            },
            Some("unknown-tab"),
        ),
    ] {
        let transaction = store
            .commit_aux_editor_transaction(
                HistoryScope::CustomTabs,
                None,
                EditorCommitOrigin::LegacyAdapter("tabs_reorder_test".to_string()),
                &[],
                |data| Ok(reorder_tab_metadata(data, &op)),
            )
            .unwrap();
        let (snapshot, error, changed) = &transaction.value;

        assert_eq!(error.as_deref(), expected_error);
        assert!(!changed);
        assert!(transaction.change.event.is_none());
        assert!(transaction.change.history_status.is_none());
        assert!(reorder_change_payload(snapshot, *changed).is_none());
        assert_eq!(store.snapshot(), before);
    }
    let history_after = store.history_status();
    assert_eq!(
        history_after.history_revision,
        history_before.history_revision
    );
    assert!(!history_after.can_undo);
    store.flush_and_shutdown().unwrap();
}

#[test]
fn reorder_history_undo_restores_tab_order_and_bar_count_together() {
    let directory = tempfile::tempdir().unwrap();
    let tab_id = "reorder-tab".to_string();
    let mut data = crate::state::migration::normalize_state(AppStoreData::default());
    data.custom_tabs.push(CustomTab {
        id: tab_id.clone(),
        name: "Reorder".to_string(),
    });
    data.keys.insert(tab_id.clone(), Vec::new());
    data.key_positions.insert(tab_id.clone(), Vec::new());
    data.tab_order = ["4key", "5key", "6key", "8key", tab_id.as_str()]
        .map(str::to_string)
        .to_vec();
    data.bar_count = 2;
    crate::state::native_element_id::backfill_store_element_ids(&mut data);
    std::fs::write(
        directory.path().join("store.json"),
        serde_json::to_vec_pretty(&data).unwrap(),
    )
    .unwrap();
    let store = AppStore::initialize_for_test(directory.path()).unwrap();
    let before = store.snapshot();
    let reordered = [tab_id.as_str(), "5key", "6key", "8key", "4key"]
        .map(str::to_string)
        .to_vec();

    store
        .commit_aux_editor_transaction(
            HistoryScope::CustomTabs,
            None,
            EditorCommitOrigin::LegacyAdapter("tabs_reorder_test".to_string()),
            &[],
            |data| {
                let (_, error, changed) = reorder_tab_metadata(
                    data,
                    &TabOrderOpV1::Swap {
                        a: "4key".to_string(),
                        b: tab_id.clone(),
                    },
                );
                assert!(error.is_none());
                assert!(changed);
                Ok(())
            },
        )
        .unwrap();
    assert_eq!(store.snapshot().tab_order, reordered);
    assert_eq!(store.snapshot().bar_count, 2);

    let operation_id = uuid::Uuid::new_v4().to_string();
    let gate = store.history_gate();
    let barrier = gate.close(&operation_id).unwrap();
    let counters = store.snapshot().key_counters;
    let undo = store
        .apply_history_operation(HistoryDirection::Undo, &operation_id, &counters, || {})
        .unwrap();
    drop(barrier);

    assert_eq!(store.snapshot().tab_order, before.tab_order);
    assert_eq!(store.snapshot().bar_count, before.bar_count);
    assert!(undo.status.can_redo);

    let operation_id = uuid::Uuid::new_v4().to_string();
    let barrier = gate.close(&operation_id).unwrap();
    let counters = store.snapshot().key_counters;
    let redo = store
        .apply_history_operation(HistoryDirection::Redo, &operation_id, &counters, || {})
        .unwrap();
    drop(barrier);

    assert_eq!(store.snapshot().tab_order, reordered);
    assert_eq!(store.snapshot().bar_count, 2);
    assert!(redo.status.can_undo);
    store.flush_and_shutdown().unwrap();
}

#[test]
fn tab_order_op_rejects_unknown_kind_and_unknown_fields() {
    let unknown_kind = serde_json::from_value::<TabOrderOpV1>(serde_json::json!({
        "kind": "move",
        "a": "4key",
        "b": "5key"
    }));
    let unknown_field = serde_json::from_value::<TabOrderOpV1>(serde_json::json!({
        "kind": "swap",
        "a": "4key",
        "b": "5key",
        "extra": true
    }));

    assert!(unknown_kind.is_err());
    assert!(unknown_field.is_err());
}

#[test]
fn reset_all_clears_knob_positions_and_zeroes_default_counters() {
    let mut store = populated_custom_tab_store();
    reset_all_editor_data(
        &mut store,
        default_keys(),
        default_positions(),
        default_stat_positions(),
    );

    assert!(store.knob_positions.is_empty());
    assert!(store.custom_tabs.is_empty());
    assert_eq!(store.selected_key_type, "4key");
    assert_eq!(store.stat_positions.len(), default_stat_positions().len());
    assert!(store
        .key_counters
        .values()
        .flat_map(|mode| mode.values())
        .all(|count| *count == 0));
}

#[test]
fn reset_all_issues_a_fresh_globally_unique_id_generation_each_time() {
    let mut store = populated_custom_tab_store();
    reset_all_editor_data(
        &mut store,
        default_keys(),
        default_positions(),
        default_stat_positions(),
    );
    let first = store
        .key_positions
        .values()
        .flatten()
        .map(|position| position.id.clone())
        .collect::<HashSet<_>>();
    let first_count = store.key_positions.values().map(Vec::len).sum::<usize>();

    reset_all_editor_data(
        &mut store,
        default_keys(),
        default_positions(),
        default_stat_positions(),
    );
    let second = store
        .key_positions
        .values()
        .flatten()
        .map(|position| position.id.clone())
        .collect::<HashSet<_>>();

    assert_eq!(first.len(), first_count);
    assert_eq!(second.len(), first_count);
    assert!(first.is_disjoint(&second));
    assert!(second
        .iter()
        .all(|id| crate::state::native_element_id::is_valid_element_id(id)));
}

#[test]
fn reset_all_migrates_default_data_url_images_immediately() {
    let dir = std::env::temp_dir().join(format!(
        "dmnote-reset-all-default-images-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let mut store = populated_custom_tab_store();

    reset_all_editor_data_with_images(
        &mut store,
        default_keys(),
        default_positions(),
        default_stat_positions(),
        &dir,
    );

    let positions = store
        .key_positions
        .values()
        .flatten()
        .chain(
            store
                .stat_positions
                .values()
                .flatten()
                .map(|stat| &stat.position),
        )
        .chain(
            store
                .graph_positions
                .values()
                .flatten()
                .map(|graph| &graph.position),
        )
        .chain(
            store
                .knob_positions
                .values()
                .flatten()
                .map(|knob| &knob.position),
        )
        .collect::<Vec<_>>();
    let image_paths = positions
        .iter()
        .flat_map(|position| [&position.active_image, &position.inactive_image])
        .flatten()
        .filter(|image| !image.is_empty())
        .collect::<Vec<_>>();
    assert!(!image_paths.is_empty());
    assert!(image_paths.iter().all(|image| !image.starts_with("data:")));
    assert!(image_paths
        .iter()
        .all(|image| std::path::Path::new(image.as_str()).is_file()));
    assert!(store
        .stat_positions
        .values()
        .flatten()
        .all(|stat| { crate::state::native_element_id::is_valid_element_id(&stat.position.id) }));

    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn custom_mode_reset_is_supported_and_preserves_tab_identity() {
    let mut store = populated_custom_tab_store();
    let tabs_before = store.custom_tabs.clone();
    let kind = reset_mode_kind(&store, TARGET_TAB);

    assert_eq!(kind, Some(ModeResetKind::Custom));
    reset_mode_data(&mut store, TARGET_TAB, kind.unwrap());

    assert_eq!(store.custom_tabs, tabs_before);
    assert!(store.keys[TARGET_TAB].is_empty());
    assert!(store.key_positions[TARGET_TAB].is_empty());
    assert!(store.stat_positions[TARGET_TAB].is_empty());
    assert!(store.graph_positions[TARGET_TAB].is_empty());
    assert!(store.knob_positions[TARGET_TAB].is_empty());
    assert!(!store.layer_groups.contains_key(TARGET_TAB));
    assert!(!store.tab_css_overrides.contains_key(TARGET_TAB));
    assert!(!store.tab_note_overrides.contains_key(TARGET_TAB));
    assert!(store.key_counters[TARGET_TAB].is_empty());
}

#[test]
fn default_mode_reset_clears_knob_positions() {
    let mut store = AppStoreData::default();
    store.knob_positions.insert(
        "4key".to_string(),
        populated_custom_tab_store().knob_positions[TARGET_TAB].clone(),
    );

    reset_mode_data(&mut store, "4key", ModeResetKind::Default);

    assert!(store.knob_positions["4key"].is_empty());
    assert_eq!(
        store.stat_positions["4key"].len(),
        default_stat_positions()["4key"].len()
    );
}

#[test]
fn ghost_mode_request_leaves_store_keyboard_and_events_unchanged() {
    let mut store = AppStoreData {
        selected_key_type: "8key".to_string(),
        ..AppStoreData::default()
    };
    store
        .keys
        .insert("ghost-mode".to_string(), vec![KeySlot::from("KeyA")]);
    let keyboard = KeyboardManager::new(store.keys.clone(), "8key");
    let commit_calls = Cell::new(0);
    let emit_calls = Cell::new(0);

    let response = set_mode_with(
        &store,
        "ghost-mode".to_string(),
        |candidate| {
            commit_calls.set(commit_calls.get() + 1);
            Ok(candidate)
        },
        |effective| {
            keyboard.set_mode(effective.to_string());
            emit_calls.set(emit_calls.get() + 1);
            Ok(())
        },
    )
    .unwrap();

    assert!(!response.success);
    assert_eq!(response.mode, "8key");
    assert_eq!(store.selected_key_type, "8key");
    assert_eq!(keyboard.current_mode(), "8key");
    assert_eq!(commit_calls.get(), 0);
    assert_eq!(emit_calls.get(), 0);
}

#[test]
fn absent_mode_request_remains_a_no_op() {
    let store = AppStoreData {
        selected_key_type: "8key".to_string(),
        ..AppStoreData::default()
    };
    let keyboard = KeyboardManager::new(store.keys.clone(), "8key");
    let commit_calls = Cell::new(0);
    let emit_calls = Cell::new(0);

    let response = set_mode_with(
        &store,
        "missing-mode".to_string(),
        |candidate| {
            commit_calls.set(commit_calls.get() + 1);
            Ok(candidate)
        },
        |effective| {
            keyboard.set_mode(effective.to_string());
            emit_calls.set(emit_calls.get() + 1);
            Ok(())
        },
    )
    .unwrap();

    assert!(!response.success);
    assert_eq!(response.mode, "8key");
    assert_eq!(store.selected_key_type, "8key");
    assert_eq!(keyboard.current_mode(), "8key");
    assert_eq!(commit_calls.get(), 0);
    assert_eq!(emit_calls.get(), 0);
}

#[test]
fn selection_after_concurrent_delete_uses_locked_store_state() {
    let stale_snapshot = populated_custom_tab_store();
    assert!(super::is_selectable_mode(&stale_snapshot, TARGET_TAB));

    let mut locked_store = stale_snapshot;
    let delete_plan = plan_custom_tab_delete(&locked_store, TARGET_TAB).unwrap();
    delete_custom_tab_data(&mut locked_store, TARGET_TAB, &delete_plan);
    let selected_after_delete = locked_store.selected_key_type.clone();

    let (success, selected) = select_mode_if_available(&mut locked_store, TARGET_TAB);

    assert!(!success);
    assert_eq!(selected, selected_after_delete);
    assert_eq!(locked_store.selected_key_type, selected_after_delete);
    assert!(!locked_store.keys.contains_key(TARGET_TAB));
}

#[test]
fn reset_mode_with_changed_keys_preserves_other_live_mode_counters() {
    let directory = tempfile::tempdir().unwrap();
    let store = AppStore::initialize_for_test(directory.path()).unwrap();
    store
        .update(|data| data.key_counter_enabled = true)
        .unwrap();
    let customized = store
        .commit_legacy_editor_transaction(
            EditorCommitOrigin::LegacyAdapter("reset-test-setup".to_string()),
            &[EditorField::Keys, EditorField::KeyPositions],
            |data| {
                data.keys.get_mut("4key").unwrap()[0] = KeySlot::from("QA RESET KEY");
                Ok(())
            },
        )
        .unwrap();
    drop(customized);
    let state = AppState::initialize(store).unwrap();
    let emitter = NoopCounterEmitter;
    let reset_mode = "4key";
    let reset_key = state.store.snapshot().keys[reset_mode][0].canonical();
    let preserved_mode = "5key";
    let preserved_key = state.store.snapshot().keys[preserved_mode][0].canonical();
    for expected in 1..=3 {
        assert_eq!(
            state.increment_key_counter_and_emit(&emitter, reset_mode, &reset_key),
            Some(expected)
        );
    }
    for expected in 1..=7 {
        assert_eq!(
            state.increment_key_counter_and_emit(&emitter, preserved_mode, &preserved_key),
            Some(expected)
        );
    }
    assert_eq!(
        state.store.snapshot().key_counters[preserved_mode][&preserved_key],
        0
    );

    let admission = state.store.admit_editor_mutation().unwrap();
    let (transaction, key_runtime_applied) = state
        .commit_legacy_editor_reset_preserving_runtime_counters(
            &emitter,
            EditorCommitOrigin::LegacyAdapter("keys_reset_mode".to_string()),
            &[
                EditorField::Keys,
                EditorField::KeyPositions,
                EditorField::StatPositions,
                EditorField::GraphPositions,
                EditorField::KnobPositions,
                EditorField::SpritePositions,
                EditorField::LayerGroups,
            ],
            PluginInstancesResetScope::Mode(reset_mode.to_string()),
            admission,
            |data| {
                reset_mode_data_with_images(
                    data,
                    reset_mode,
                    ModeResetKind::Default,
                    directory.path(),
                );
                Ok(())
            },
        )
        .unwrap();
    assert!(key_runtime_applied);
    assert!(transaction
        .change
        .result
        .changed_fields
        .contains(&EditorField::Keys));

    assert_eq!(
        state.snapshot_key_counters()[preserved_mode][&preserved_key],
        7
    );
    assert!(state.snapshot_key_counters()[reset_mode]
        .values()
        .all(|count| *count == 0));
    assert_eq!(
        state.store.snapshot().key_counters[preserved_mode][&preserved_key],
        7
    );
    state.shutdown();
}

#[test]
fn reset_mode_with_default_keys_applies_counter_only_reset_to_runtime() {
    let directory = tempfile::tempdir().unwrap();
    let store = AppStore::initialize_for_test(directory.path()).unwrap();
    store
        .update(|data| data.key_counter_enabled = true)
        .unwrap();
    let state = AppState::initialize(store).unwrap();
    let emitter = NoopCounterEmitter;
    let mode = "4key";
    let key = state.store.snapshot().keys[mode][0].canonical();
    for expected in 1..=7 {
        assert_eq!(
            state.increment_key_counter_and_emit(&emitter, mode, &key),
            Some(expected)
        );
    }
    assert_eq!(state.store.snapshot().key_counters[mode][&key], 0);
    let generation_before = state.store.runtime_publication_generation();

    let admission = state.store.admit_editor_mutation().unwrap();
    let (transaction, key_runtime_applied) = state
        .commit_legacy_editor_reset_preserving_runtime_counters(
            &emitter,
            EditorCommitOrigin::LegacyAdapter("keys_reset_mode".to_string()),
            &[
                EditorField::Keys,
                EditorField::KeyPositions,
                EditorField::StatPositions,
                EditorField::GraphPositions,
                EditorField::KnobPositions,
                EditorField::SpritePositions,
                EditorField::LayerGroups,
            ],
            PluginInstancesResetScope::Mode(mode.to_string()),
            admission,
            |data| {
                reset_mode_data_with_images(data, mode, ModeResetKind::Default, directory.path());
                Ok(())
            },
        )
        .unwrap();
    assert!(key_runtime_applied);
    assert!(!transaction
        .change
        .result
        .changed_fields
        .contains(&EditorField::Keys));
    assert!(transaction.change.runtime_publication_generation > generation_before);

    assert_eq!(state.snapshot_key_counters()[mode][&key], 0);
    assert_eq!(state.store.snapshot().key_counters[mode][&key], 0);
    state.shutdown();
}

#[test]
fn reset_mode_replays_queued_increment_for_unchanged_mapping() {
    let directory = tempfile::tempdir().unwrap();
    let store = AppStore::initialize_for_test(directory.path()).unwrap();
    store
        .update(|data| data.key_counter_enabled = true)
        .unwrap();
    let state = AppState::initialize(store).unwrap();
    let emitter = NoopCounterEmitter;
    let reset_mode = "4key";
    let reset_key = state.store.snapshot().keys[reset_mode][0].canonical();
    let preserved_mode = "5key";
    let preserved_key = state.store.snapshot().keys[preserved_mode][0].canonical();
    for expected in 1..=3 {
        assert_eq!(
            state.increment_key_counter_and_emit(&emitter, reset_mode, &reset_key),
            Some(expected)
        );
    }
    for expected in 1..=7 {
        assert_eq!(
            state.increment_key_counter_and_emit(&emitter, preserved_mode, &preserved_key),
            Some(expected)
        );
    }

    let admission = state.store.admit_editor_mutation().unwrap();
    let (_, key_runtime_applied) = state
        .commit_legacy_editor_reset_preserving_runtime_counters(
            &emitter,
            EditorCommitOrigin::LegacyAdapter("keys_reset_mode".to_string()),
            &[
                EditorField::Keys,
                EditorField::KeyPositions,
                EditorField::StatPositions,
                EditorField::GraphPositions,
                EditorField::KnobPositions,
                EditorField::SpritePositions,
                EditorField::LayerGroups,
            ],
            PluginInstancesResetScope::Mode(reset_mode.to_string()),
            admission,
            |data| {
                assert_eq!(
                    state.increment_key_counter_and_emit(&emitter, reset_mode, &reset_key,),
                    None
                );
                reset_mode_data_with_images(
                    data,
                    reset_mode,
                    ModeResetKind::Default,
                    directory.path(),
                );
                Ok(())
            },
        )
        .unwrap();

    assert!(key_runtime_applied);
    assert_eq!(state.snapshot_key_counters()[reset_mode][&reset_key], 1);
    assert_eq!(
        state.snapshot_key_counters()[preserved_mode][&preserved_key],
        7
    );
    assert_eq!(
        state.store.snapshot().key_counters[reset_mode][&reset_key],
        0
    );
    assert_eq!(
        state.store.snapshot().key_counters[preserved_mode][&preserved_key],
        7
    );
    state.shutdown();
}

#[test]
fn reset_mode_drops_queued_increment_for_replaced_key() {
    let directory = tempfile::tempdir().unwrap();
    let store = AppStore::initialize_for_test(directory.path()).unwrap();
    store
        .update(|data| data.key_counter_enabled = true)
        .unwrap();
    let mode = "4key";
    let replaced_key = "QA REPLACED KEY";
    let setup = store
        .commit_legacy_editor_transaction(
            EditorCommitOrigin::LegacyAdapter("reset-queue-test-setup".to_string()),
            &[EditorField::Keys, EditorField::KeyPositions],
            |data| {
                data.keys.get_mut(mode).unwrap()[0] = KeySlot::from(replaced_key);
                Ok(())
            },
        )
        .unwrap();
    drop(setup);
    let state = AppState::initialize(store).unwrap();
    let emitter = NoopCounterEmitter;

    let admission = state.store.admit_editor_mutation().unwrap();
    let (_, key_runtime_applied) = state
        .commit_legacy_editor_reset_preserving_runtime_counters(
            &emitter,
            EditorCommitOrigin::LegacyAdapter("keys_reset_mode".to_string()),
            &[
                EditorField::Keys,
                EditorField::KeyPositions,
                EditorField::StatPositions,
                EditorField::GraphPositions,
                EditorField::KnobPositions,
                EditorField::SpritePositions,
                EditorField::LayerGroups,
            ],
            PluginInstancesResetScope::Mode(mode.to_string()),
            admission,
            |data| {
                assert_eq!(
                    state.increment_key_counter_and_emit(&emitter, mode, replaced_key),
                    None
                );
                reset_mode_data_with_images(data, mode, ModeResetKind::Default, directory.path());
                Ok(())
            },
        )
        .unwrap();

    assert!(key_runtime_applied);
    assert!(!state.snapshot_key_counters()[mode].contains_key(replaced_key));
    assert!(!state.store.snapshot().key_counters[mode].contains_key(replaced_key));
    state.shutdown();
    drop(state);
    let reloaded = AppStore::initialize_for_test(directory.path()).unwrap();
    assert!(!reloaded.snapshot().key_counters[mode].contains_key(replaced_key));
    reloaded.flush_and_shutdown().unwrap();
}

#[test]
fn reset_all_drops_queued_increment_for_removed_custom_mode() {
    let directory = tempfile::tempdir().unwrap();
    let store = AppStore::initialize_for_test(directory.path()).unwrap();
    store
        .update(|data| data.key_counter_enabled = true)
        .unwrap();
    let mode = "qa-removed-custom-mode";
    let key = "QA REMOVED KEY";
    let mut position = default_positions()["4key"][0].clone();
    position.id = uuid::Uuid::new_v4().to_string();
    let setup = store
        .commit_legacy_editor_transaction(
            EditorCommitOrigin::LegacyAdapter("reset-queue-test-setup".to_string()),
            &[EditorField::Keys, EditorField::KeyPositions],
            |data| {
                data.custom_tabs.push(CustomTab {
                    id: mode.to_string(),
                    name: "Removed during reset".to_string(),
                });
                data.keys.insert(mode.to_string(), vec![KeySlot::from(key)]);
                data.key_positions.insert(mode.to_string(), vec![position]);
                data.selected_key_type = mode.to_string();
                Ok(())
            },
        )
        .unwrap();
    drop(setup);
    let state = AppState::initialize(store).unwrap();
    let emitter = NoopCounterEmitter;

    let admission = state.store.admit_editor_mutation().unwrap();
    let (_, key_runtime_applied) = state
        .commit_legacy_editor_reset_preserving_runtime_counters(
            &emitter,
            EditorCommitOrigin::LegacyAdapter("keys_reset_all".to_string()),
            &[
                EditorField::Keys,
                EditorField::KeyPositions,
                EditorField::StatPositions,
                EditorField::GraphPositions,
                EditorField::KnobPositions,
                EditorField::SpritePositions,
                EditorField::LayerGroups,
            ],
            PluginInstancesResetScope::All,
            admission,
            |data| {
                assert_eq!(
                    state.increment_key_counter_and_emit(&emitter, mode, key),
                    None
                );
                reset_all_editor_data_with_images(
                    data,
                    default_keys(),
                    default_positions(),
                    default_stat_positions(),
                    directory.path(),
                );
                Ok(())
            },
        )
        .unwrap();

    assert!(key_runtime_applied);
    assert!(!state.snapshot_key_counters().contains_key(mode));
    assert!(!state.store.snapshot().key_counters.contains_key(mode));
    state.shutdown();
    drop(state);
    let reloaded = AppStore::initialize_for_test(directory.path()).unwrap();
    assert!(!reloaded.snapshot().key_counters.contains_key(mode));
    reloaded.flush_and_shutdown().unwrap();
}

#[test]
fn reset_all_with_default_keys_applies_counter_only_reset_to_runtime() {
    let directory = tempfile::tempdir().unwrap();
    let store = AppStore::initialize_for_test(directory.path()).unwrap();
    store
        .update(|data| data.key_counter_enabled = true)
        .unwrap();
    let state = AppState::initialize(store).unwrap();
    let emitter = NoopCounterEmitter;
    let mode = "4key";
    let key = state.store.snapshot().keys[mode][0].canonical();
    for expected in 1..=7 {
        assert_eq!(
            state.increment_key_counter_and_emit(&emitter, mode, &key),
            Some(expected)
        );
    }
    assert_eq!(state.store.snapshot().key_counters[mode][&key], 0);
    let generation_before = state.store.runtime_publication_generation();

    let admission = state.store.admit_editor_mutation().unwrap();
    let (transaction, key_runtime_applied) = state
        .commit_legacy_editor_reset_preserving_runtime_counters(
            &emitter,
            EditorCommitOrigin::LegacyAdapter("keys_reset_all".to_string()),
            &[
                EditorField::Keys,
                EditorField::KeyPositions,
                EditorField::StatPositions,
                EditorField::GraphPositions,
                EditorField::KnobPositions,
                EditorField::SpritePositions,
                EditorField::LayerGroups,
            ],
            PluginInstancesResetScope::All,
            admission,
            |data| {
                reset_all_editor_data_with_images(
                    data,
                    default_keys(),
                    default_positions(),
                    default_stat_positions(),
                    directory.path(),
                );
                Ok(())
            },
        )
        .unwrap();
    assert!(key_runtime_applied);
    assert!(!transaction
        .change
        .result
        .changed_fields
        .contains(&EditorField::Keys));
    assert!(transaction.change.runtime_publication_generation > generation_before);

    assert_eq!(state.snapshot_key_counters()[mode][&key], 0);
    assert!(state
        .store
        .snapshot()
        .key_counters
        .values()
        .flat_map(|counters| counters.values())
        .all(|count| *count == 0));
    state.shutdown();
}

#[test]
fn reset_all_with_changed_keys_zeroes_every_live_counter() {
    let directory = tempfile::tempdir().unwrap();
    let store = AppStore::initialize_for_test(directory.path()).unwrap();
    store
        .update(|data| data.key_counter_enabled = true)
        .unwrap();
    let customized = store
        .commit_legacy_editor_transaction(
            EditorCommitOrigin::LegacyAdapter("reset-all-test-setup".to_string()),
            &[EditorField::Keys, EditorField::KeyPositions],
            |data| {
                data.keys.get_mut("4key").unwrap()[0] = KeySlot::from("QA RESET ALL KEY");
                Ok(())
            },
        )
        .unwrap();
    drop(customized);
    let state = AppState::initialize(store).unwrap();
    let emitter = NoopCounterEmitter;
    for mode in ["4key", "5key"] {
        let key = state.store.snapshot().keys[mode][0].canonical();
        for expected in 1..=7 {
            assert_eq!(
                state.increment_key_counter_and_emit(&emitter, mode, &key),
                Some(expected)
            );
        }
    }

    let admission = state.store.admit_editor_mutation().unwrap();
    let (transaction, key_runtime_applied) = state
        .commit_legacy_editor_reset_preserving_runtime_counters(
            &emitter,
            EditorCommitOrigin::LegacyAdapter("keys_reset_all".to_string()),
            &[
                EditorField::Keys,
                EditorField::KeyPositions,
                EditorField::StatPositions,
                EditorField::GraphPositions,
                EditorField::KnobPositions,
                EditorField::SpritePositions,
                EditorField::LayerGroups,
            ],
            PluginInstancesResetScope::All,
            admission,
            |data| {
                reset_all_editor_data_with_images(
                    data,
                    default_keys(),
                    default_positions(),
                    default_stat_positions(),
                    directory.path(),
                );
                Ok(())
            },
        )
        .unwrap();

    assert!(key_runtime_applied);
    assert!(transaction
        .change
        .result
        .changed_fields
        .contains(&EditorField::Keys));
    assert_eq!(transaction.change.document.keys, *default_keys());
    assert!(state
        .snapshot_key_counters()
        .values()
        .flat_map(|counters| counters.values())
        .all(|count| *count == 0));
    assert!(state
        .store
        .snapshot()
        .key_counters
        .values()
        .flat_map(|counters| counters.values())
        .all(|count| *count == 0));
    state.shutdown();
}
