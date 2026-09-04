use super::*;
use crate::{
    keyboard::KeyboardManager,
    models::{AppStoreData, KeySlot, EDITOR_SCHEMA_VERSION},
    state::plugin::plugin_instances_storage_key,
};
use std::{
    collections::HashMap,
    sync::{mpsc, Arc},
    thread,
    time::{Duration, Instant},
};

fn patch(text: &str) -> EditorPatchV1 {
    EditorPatchV1 {
        schema_version: EDITOR_SCHEMA_VERSION,
        keys: Some(std::collections::HashMap::from([(
            "mode".to_string(),
            vec![text.into()],
        )])),
        ..EditorPatchV1::default()
    }
}

fn plugin_snapshot(plugin_id: &str) -> PluginElementsHistorySnapshot {
    PluginElementsHistorySnapshot {
        plugin_id: plugin_id.to_string(),
        instances: None,
    }
}

#[test]
fn custom_tabs_snapshot_keeps_patch_ownership_and_sorted_plugin_ids() {
    let plugin_a = plugin_instances_storage_key("plugin-a");
    let plugin_b = plugin_instances_storage_key("plugin-b");
    let plugin_z = plugin_instances_storage_key("plugin-z");
    let unrelated = "plugin_data_unrelated/settings".to_string();
    let mut before = AppStoreData::default();
    before
        .plugin_data
        .insert(plugin_z.clone(), serde_json::json!(["before-z"]));
    before
        .plugin_data
        .insert(plugin_a.clone(), serde_json::json!(["before-a"]));
    before
        .plugin_data
        .insert(unrelated.clone(), serde_json::json!({ "before": true }));
    let mut after = before.clone();
    after.plugin_data.remove(&plugin_z);
    after
        .plugin_data
        .insert(plugin_a.clone(), serde_json::json!(["after-a"]));
    after
        .plugin_data
        .insert(plugin_b.clone(), serde_json::json!(["after-b"]));
    after
        .plugin_data
        .insert(unrelated, serde_json::json!({ "after": true }));

    let snapshot = CustomTabsHistorySnapshot::from_transition(&before, &after);

    assert_eq!(
        snapshot.changed_plugin_ids(),
        ["plugin-a", "plugin-b", "plugin-z"]
    );
    assert_eq!(
        snapshot.plugin_instances_patch[&plugin_a],
        Some(serde_json::json!(["before-a"]))
    );
    assert_eq!(snapshot.plugin_instances_patch[&plugin_b], None);
    assert_eq!(
        snapshot.plugin_instances_patch[&plugin_z],
        Some(serde_json::json!(["before-z"]))
    );
    assert_eq!(snapshot.plugin_instances_patch.len(), 3);

    snapshot.apply_override_patches(&mut after);
    assert!(snapshot.matches_store(&after));
}

#[test]
fn compound_validation_and_payload_serialization_order_are_stable() {
    assert_eq!(
        validate_compound_snapshots(&[]).unwrap_err(),
        "compound history cannot be empty"
    );
    assert_eq!(
        validate_compound_snapshots(&[
            HistorySnapshot::Editor {
                changed_fields: vec![EditorField::Keys],
                before: Box::new(patch("first")),
                key_counters: None,
            },
            HistorySnapshot::Editor {
                changed_fields: vec![EditorField::Keys],
                before: Box::new(patch("second")),
                key_counters: None,
            },
            HistorySnapshot::Mode("unsupported-after-duplicate".to_string()),
        ])
        .unwrap_err(),
        "compound history contains duplicate editor snapshots"
    );
    assert_eq!(
        validate_compound_snapshots(&[
            HistorySnapshot::PluginElements(plugin_snapshot("plugin-a")),
            HistorySnapshot::PluginElements(plugin_snapshot("plugin-a")),
        ])
        .unwrap_err(),
        "compound history contains duplicate plugin snapshots"
    );
    assert_eq!(
        validate_compound_snapshots(&[HistorySnapshot::Mode("unsupported".to_string())])
            .unwrap_err(),
        "compound history contains an unsupported snapshot"
    );
    assert_eq!(
        normalize_gesture_ids(vec![
            "second".to_string(),
            "first".to_string(),
            "second".to_string(),
            "third".to_string(),
            "first".to_string(),
        ]),
        ["second", "first", "third"]
    );

    let before = HistorySnapshot::Mode("4key".to_string());
    let gesture_ids = vec!["first".to_string(), "second".to_string()];
    assert_eq!(
        serde_json::to_string(&HistoryEntryPayload {
            scope: HistoryScope::Mode,
            before: &before,
            gesture_ids: &gesture_ids,
        })
        .unwrap(),
        r#"{"scope":"mode","before":{"kind":"mode","value":"4key"},"gestureIds":["first","second"]}"#
    );
}

#[test]
fn preset_history_target_match_ignores_live_counter_drift() {
    let mut store = AppStoreData::default();
    let target = PresetFullHistorySnapshot::from_store(&store);
    store.key_counters.insert(
        "counter-only-mode".to_string(),
        HashMap::from([("counter-only-key".to_string(), 1)]),
    );

    assert_ne!(target, PresetFullHistorySnapshot::from_store(&store));
    assert!(target.matches_store(&store));
}

#[test]
fn shared_gesture_merges_editor_and_plugins_into_one_compound_entry() {
    let mut history = HistoryService::default();
    let gesture_id = uuid::Uuid::new_v4().to_string();

    let editor = history
        .prepare_entry(
            vec![EditorField::Keys],
            patch("before"),
            Some(gesture_id.clone()),
        )
        .unwrap();
    history.apply_record_plan(editor);
    for plugin_id in ["plugin-a", "plugin-b"] {
        let plugin = history
            .prepare_plugin_elements_entry(plugin_snapshot(plugin_id), Some(gesture_id.clone()))
            .unwrap();
        history.apply_record_plan(plugin);
    }

    assert_eq!(history.past.len(), 1);
    let entry = history.past.back().unwrap();
    assert_eq!(entry.scope, HistoryScope::Compound);
    let HistorySnapshot::Compound { snapshots } = &entry.before else {
        panic!("shared gesture must produce a compound snapshot");
    };
    assert_eq!(snapshots.len(), 3);
    assert!(matches!(snapshots[0], HistorySnapshot::Editor { .. }));
    assert!(matches!(
        &snapshots[1],
        HistorySnapshot::PluginElements(snapshot) if snapshot.plugin_id == "plugin-a"
    ));
    assert!(matches!(
        &snapshots[2],
        HistorySnapshot::PluginElements(snapshot) if snapshot.plugin_id == "plugin-b"
    ));
    assert_eq!(history.history_revision(), 1);
}

#[test]
fn delayed_shared_gesture_merges_in_place_without_reordering_later_entry() {
    let mut history = HistoryService::default();
    let gesture_id = uuid::Uuid::new_v4().to_string();
    let editor = history
        .prepare_entry(
            vec![EditorField::Keys],
            patch("before"),
            Some(gesture_id.clone()),
        )
        .unwrap();
    history.apply_record_plan(editor);

    let later = history
        .prepare_plugin_elements_entry(plugin_snapshot("later-plugin"), None)
        .unwrap();
    history.apply_record_plan(later);
    let delayed = history
        .prepare_plugin_elements_entry(plugin_snapshot("shared-plugin"), Some(gesture_id))
        .unwrap();
    history.apply_record_plan(delayed);

    assert_eq!(history.past.len(), 2);
    assert!(matches!(
        history.past.front().map(|entry| &entry.before),
        Some(HistorySnapshot::Compound { snapshots }) if snapshots.len() == 2
    ));
    assert!(matches!(
        history.past.back().map(|entry| &entry.before),
        Some(HistorySnapshot::PluginElements(snapshot))
            if snapshot.plugin_id == "later-plugin"
    ));
    assert_eq!(history.history_revision(), 2);
}

#[test]
fn repeated_editor_gesture_does_not_merge_across_an_intervening_entry() {
    let mut history = HistoryService::default();
    let gesture_id = uuid::Uuid::new_v4().to_string();
    let first = history
        .prepare_entry(
            vec![EditorField::Keys],
            patch("first"),
            Some(gesture_id.clone()),
        )
        .unwrap();
    history.apply_record_plan(first);
    let intervening = history
        .prepare_plugin_elements_entry(plugin_snapshot("later-plugin"), None)
        .unwrap();
    history.apply_record_plan(intervening);

    let repeated = history
        .prepare_entry(vec![EditorField::Keys], patch("repeated"), Some(gesture_id))
        .unwrap();
    assert!(matches!(repeated, HistoryRecordPlan::Entry(_)));
    history.apply_record_plan(repeated);

    assert_eq!(history.past.len(), 3);
    assert!(matches!(
        history.past.back().map(|entry| &entry.before),
        Some(HistorySnapshot::Editor { before, .. })
            if before.keys.as_ref().unwrap()["mode"] == [KeySlot::from("repeated")]
    ));
}

#[test]
fn merged_editor_gesture_aliases_absorb_only_the_top_plugin_entry() {
    let mut history = HistoryService::default();
    let first_gesture = uuid::Uuid::new_v4().to_string();
    let second_gesture = uuid::Uuid::new_v4().to_string();
    for (plugin_id, gesture_id) in [
        ("plugin-a", first_gesture.clone()),
        ("plugin-b", second_gesture.clone()),
    ] {
        let plugin = history
            .prepare_plugin_elements_entry(plugin_snapshot(plugin_id), Some(gesture_id))
            .unwrap();
        history.apply_record_plan(plugin);
    }

    let editor = history
        .prepare_entry_with_gesture_ids(
            vec![EditorField::Keys],
            patch("before"),
            None,
            vec![first_gesture.clone(), second_gesture.clone()],
        )
        .unwrap();
    history.apply_record_plan(editor);

    assert_eq!(history.past.len(), 2);
    let first_entry = history.past.front().unwrap();
    assert!(matches!(
        &first_entry.before,
        HistorySnapshot::PluginElements(snapshot) if snapshot.plugin_id == "plugin-a"
    ));
    assert_eq!(first_entry.gesture_ids, vec![first_gesture.clone()]);

    let top = history.past.back().unwrap();
    assert_eq!(top.gesture_ids, vec![first_gesture, second_gesture]);
    let HistorySnapshot::Compound { snapshots } = &top.before else {
        panic!("top history entry must be compound");
    };
    assert!(matches!(
        snapshots.as_slice(),
        [
            HistorySnapshot::PluginElements(plugin),
            HistorySnapshot::Editor { before, .. }
        ] if plugin.plugin_id == "plugin-b"
            && before.keys.as_ref().unwrap()["mode"] == [KeySlot::from("before")]
    ));
}

#[test]
fn multi_alias_editor_stays_above_a_later_editor_entry() {
    let mut history = HistoryService::default();
    let first_gesture = uuid::Uuid::new_v4().to_string();
    let second_gesture = uuid::Uuid::new_v4().to_string();
    for (plugin_id, gesture_id) in [
        ("plugin-a", first_gesture.clone()),
        ("plugin-b", second_gesture.clone()),
    ] {
        let plugin = history
            .prepare_plugin_elements_entry(plugin_snapshot(plugin_id), Some(gesture_id))
            .unwrap();
        history.apply_record_plan(plugin);
    }

    let intervening_gesture = uuid::Uuid::new_v4().to_string();
    let intervening_editor = history
        .prepare_entry(
            vec![EditorField::Keys],
            patch("before-intervening-editor"),
            Some(intervening_gesture.clone()),
        )
        .unwrap();
    history.apply_record_plan(intervening_editor);

    let latest_editor = history
        .prepare_entry_with_gesture_ids(
            vec![EditorField::Keys],
            patch("after-intervening-editor"),
            None,
            vec![first_gesture.clone(), second_gesture.clone()],
        )
        .unwrap();
    assert!(matches!(latest_editor, HistoryRecordPlan::Entry(_)));
    history.apply_record_plan(latest_editor);

    assert_eq!(history.past.len(), 4);
    let mut undo_order = history.past.iter().rev();
    let latest = undo_order.next().unwrap();
    assert_eq!(latest.gesture_ids, vec![first_gesture, second_gesture]);
    assert!(matches!(
        &latest.before,
        HistorySnapshot::Editor { before, .. }
            if before.keys.as_ref().unwrap()["mode"] == [KeySlot::from("after-intervening-editor")]
    ));

    let intervening = undo_order.next().unwrap();
    assert_eq!(intervening.gesture_ids, vec![intervening_gesture]);
    assert!(matches!(
        &intervening.before,
        HistorySnapshot::Editor { before, .. }
            if before.keys.as_ref().unwrap()["mode"] == [KeySlot::from("before-intervening-editor")]
    ));
}

#[test]
fn delayed_net_zero_merge_removes_only_its_original_entry() {
    let mut history = HistoryService::default();
    let gesture_id = uuid::Uuid::new_v4().to_string();
    let original = plugin_snapshot("shared-plugin");
    let first = history
        .prepare_plugin_elements_entry(original.clone(), Some(gesture_id.clone()))
        .unwrap();
    history.apply_record_plan(first);
    let later = history
        .prepare_plugin_elements_entry(plugin_snapshot("later-plugin"), None)
        .unwrap();
    history.apply_record_plan(later);

    let back_to_original = history
        .prepare_plugin_elements_entry(original.clone(), Some(gesture_id))
        .unwrap();
    history.apply_plugin_elements_record_plan(back_to_original, &original);

    assert_eq!(history.past.len(), 1);
    assert!(matches!(
        history.past.back().map(|entry| &entry.before),
        Some(HistorySnapshot::PluginElements(snapshot))
            if snapshot.plugin_id == "later-plugin"
    ));
}

#[test]
fn gesture_entry_merges_with_a_prior_same_gesture_plugin_entry() {
    let mut history = HistoryService::default();
    let gesture_id = uuid::Uuid::new_v4().to_string();
    let plugin = history
        .prepare_plugin_elements_entry(plugin_snapshot("plugin-a"), Some(gesture_id.clone()))
        .unwrap();
    history.apply_record_plan(plugin);

    let gesture = history
        .prepare_gesture_entry(
            vec![HistorySnapshot::Editor {
                changed_fields: vec![EditorField::Keys],
                before: Box::new(patch("before")),
                key_counters: None,
            }],
            gesture_id.clone(),
        )
        .unwrap();
    assert!(matches!(gesture, HistoryRecordPlan::Merge { .. }));
    history.apply_record_plan(gesture);

    assert_eq!(history.past.len(), 1);
    let entry = history.past.back().unwrap();
    assert_eq!(entry.scope, HistoryScope::Compound);
    assert_eq!(entry.gesture_ids, vec![gesture_id]);
    let HistorySnapshot::Compound { snapshots } = &entry.before else {
        panic!("same gesture must merge into one compound entry");
    };
    assert!(matches!(
        snapshots.as_slice(),
        [
            HistorySnapshot::PluginElements(plugin),
            HistorySnapshot::Editor { .. }
        ] if plugin.plugin_id == "plugin-a"
    ));
}

#[test]
fn repeated_gesture_commits_merge_and_keep_the_first_editor_before() {
    let mut history = HistoryService::default();
    let gesture_id = uuid::Uuid::new_v4().to_string();
    for (text, count) in [("first", 12), ("second", 3)] {
        let plan = history
            .prepare_gesture_entry(
                vec![
                    HistorySnapshot::Editor {
                        changed_fields: vec![EditorField::Keys],
                        before: Box::new(patch(text)),
                        key_counters: Some(HashMap::from([(
                            "mode".to_string(),
                            HashMap::from([(text.to_string(), count)]),
                        )])),
                    },
                    HistorySnapshot::PluginElements(plugin_snapshot("plugin-a")),
                ],
                gesture_id.clone(),
            )
            .unwrap();
        history.apply_record_plan(plan);
    }

    assert_eq!(history.past.len(), 1);
    let HistorySnapshot::Compound { snapshots } = &history.past.back().unwrap().before else {
        panic!("repeated gesture commits must stay one compound entry");
    };
    assert!(matches!(
        snapshots.as_slice(),
        [
            HistorySnapshot::Editor {
                before,
                key_counters: Some(key_counters),
                ..
            },
            HistorySnapshot::PluginElements(plugin)
        ] if before.keys.as_ref().unwrap()["mode"] == [KeySlot::from("first")]
            && key_counters["mode"]["first"] == 12
            && plugin.plugin_id == "plugin-a"
    ));
}

#[test]
fn gesture_entry_does_not_merge_across_different_gestures() {
    let mut history = HistoryService::default();
    let plugin = history
        .prepare_plugin_elements_entry(
            plugin_snapshot("plugin-a"),
            Some(uuid::Uuid::new_v4().to_string()),
        )
        .unwrap();
    history.apply_record_plan(plugin);

    let gesture = history
        .prepare_gesture_entry(
            vec![HistorySnapshot::Editor {
                changed_fields: vec![EditorField::Keys],
                before: Box::new(patch("before")),
                key_counters: None,
            }],
            uuid::Uuid::new_v4().to_string(),
        )
        .unwrap();
    assert!(matches!(gesture, HistoryRecordPlan::Entry(_)));
    history.apply_record_plan(gesture);

    assert_eq!(history.past.len(), 2);
}

#[test]
fn oversized_gesture_merge_falls_back_to_a_separate_entry() {
    let gesture_id = uuid::Uuid::new_v4().to_string();
    let editor_snapshots = vec![HistorySnapshot::Editor {
        changed_fields: vec![EditorField::Keys],
        before: Box::new(patch("before")),
        key_counters: None,
    }];
    let mut probe = HistoryService::default();
    let plugin = probe
        .prepare_plugin_elements_entry(plugin_snapshot("plugin-a"), Some(gesture_id.clone()))
        .unwrap();
    probe.apply_record_plan(plugin);
    let merged = probe
        .prepare_gesture_entry(editor_snapshots.clone(), gesture_id.clone())
        .unwrap();
    let HistoryRecordPlan::Merge { entry: merged, .. } = merged else {
        panic!("same gesture must prepare a compound merge");
    };
    let limit = merged.size_bytes - 1;

    let mut history = HistoryService::with_limits(limit, 32 * 1024 * 1024, 50);
    let plugin = history
        .prepare_plugin_elements_entry(plugin_snapshot("plugin-a"), Some(gesture_id.clone()))
        .unwrap();
    history.apply_record_plan(plugin);
    let fallback = history
        .prepare_gesture_entry(editor_snapshots, gesture_id)
        .unwrap();
    assert!(matches!(fallback, HistoryRecordPlan::Entry(_)));
    history.apply_record_plan(fallback);

    assert_eq!(history.past.len(), 2);
}

#[test]
fn compound_entry_counts_as_one_budget_slot() {
    let mut history = HistoryService::with_limits(8 * 1024 * 1024, 32 * 1024 * 1024, 1);
    let gesture_id = uuid::Uuid::new_v4().to_string();
    let editor = history
        .prepare_entry(
            vec![EditorField::Keys],
            patch("before"),
            Some(gesture_id.clone()),
        )
        .unwrap();
    history.apply_record_plan(editor);
    let plugin = history
        .prepare_plugin_elements_entry(plugin_snapshot("plugin-a"), Some(gesture_id))
        .unwrap();
    history.apply_record_plan(plugin);

    assert_eq!(history.past.len(), 1);
    assert!(history.status(false).can_undo);
}

#[test]
fn compound_merge_honors_combined_entry_size_limit() {
    let gesture_id = uuid::Uuid::new_v4().to_string();
    let mut probe = HistoryService::default();
    let editor = probe
        .prepare_entry(
            vec![EditorField::Keys],
            patch("before"),
            Some(gesture_id.clone()),
        )
        .unwrap();
    probe.apply_record_plan(editor);
    let compound = probe
        .prepare_plugin_elements_entry(plugin_snapshot("plugin-a"), Some(gesture_id.clone()))
        .unwrap();
    let HistoryRecordPlan::Merge {
        entry: compound, ..
    } = compound
    else {
        panic!("shared gesture must prepare a compound merge");
    };
    let limit = compound.size_bytes - 1;

    let mut history = HistoryService::with_limits(limit, 32 * 1024 * 1024, 50);
    let editor = history
        .prepare_entry(
            vec![EditorField::Keys],
            patch("before"),
            Some(gesture_id.clone()),
        )
        .unwrap();
    assert!(matches!(editor, HistoryRecordPlan::Entry(_)));
    history.apply_record_plan(editor);
    let oversized = history
        .prepare_plugin_elements_entry(plugin_snapshot("plugin-a"), Some(gesture_id))
        .unwrap();
    assert!(matches!(oversized, HistoryRecordPlan::Truncate));
}

#[test]
fn oversized_entry_truncates_both_stacks_atomically() {
    let mut history = HistoryService::with_limits(200, 1_000, 50);
    let first = history
        .prepare_entry(vec![EditorField::Keys], patch("first"), None)
        .unwrap();
    history.apply_record_plan(first);
    assert!(history.status(false).can_undo);

    let oversized = history
        .prepare_entry(vec![EditorField::Keys], patch(&"x".repeat(512)), None)
        .unwrap();
    assert!(matches!(oversized, HistoryRecordPlan::Truncate));
    history.apply_record_plan(oversized);

    let status = history.status(false);
    assert!(!status.can_undo);
    assert!(!status.can_redo);
    assert_eq!(status.truncated.unwrap().reason, HISTORY_ENTRY_TOO_LARGE);
    assert_eq!(status.history_revision, 2);
}

#[test]
fn total_budget_and_count_evict_least_recent_entries() {
    let sample = HistoryService::with_limits(1_000, 10_000, 50)
        .prepare_entry(vec![EditorField::Keys], patch("sample"), None)
        .unwrap();
    let HistoryRecordPlan::Entry(sample) = sample else {
        panic!("sample entry must fit");
    };
    let mut history = HistoryService::with_limits(1_000, sample.size_bytes * 2 + 1, 2);

    for value in ["one", "two", "three"] {
        let plan = history
            .prepare_entry(vec![EditorField::Keys], patch(value), None)
            .unwrap();
        history.apply_record_plan(plan);
    }

    assert_eq!(history.past.len(), 2);
    assert_eq!(
        history.past.front().unwrap().before,
        HistorySnapshot::Editor {
            changed_fields: vec![EditorField::Keys],
            before: Box::new(patch("two")),
            key_counters: None,
        }
    );
    assert_eq!(
        history.past.back().unwrap().before,
        HistorySnapshot::Editor {
            changed_fields: vec![EditorField::Keys],
            before: Box::new(patch("three")),
            key_counters: None,
        }
    );
}

#[test]
fn status_sequence_orders_reversed_busy_delivery_at_same_revision() {
    let mut history = HistoryService::default();
    let busy = history.issue_status(true);
    let idle = history.issue_status(false);

    assert_eq!(busy.history_revision, idle.history_revision);
    assert!(busy.busy);
    assert!(!idle.busy);
    assert!(idle.status_seq > busy.status_seq);

    let mut accepted = idle.clone();
    if busy.status_seq > accepted.status_seq {
        accepted = busy;
    }
    assert!(!accepted.busy);
    assert_eq!(accepted.status_seq, idle.status_seq);
}

#[test]
fn admission_gate_rejects_busy_and_stale_generations() {
    let gate = Arc::new(HistoryAdmissionGate::default());
    let stale = gate.try_admit().unwrap();
    let lease = gate.close("operation-a").unwrap();
    assert_eq!(gate.owner().as_deref(), Some("operation-a"));
    assert_eq!(gate.try_admit().unwrap_err(), HISTORY_IN_PROGRESS);
    drop(lease);

    assert_eq!(gate.revalidate(stale).unwrap_err(), HISTORY_IN_PROGRESS);
    assert!(gate.try_admit().is_ok());
}

#[test]
fn canceled_barrier_wakes_a_drain_waiter() {
    let gate = Arc::new(HistoryAdmissionGate::default());
    let admission = gate.admit_mutation().unwrap();
    let barrier = gate.begin_close("operation-canceled").unwrap();
    let waiter = barrier.waiter();
    let (result_tx, result_rx) = mpsc::channel();
    let wait_thread = thread::spawn(move || {
        result_tx.send(waiter.wait_for_drain()).unwrap();
    });

    drop(barrier);
    assert_eq!(
        result_rx.recv_timeout(Duration::from_secs(2)).unwrap(),
        Err(HISTORY_IN_PROGRESS.to_string())
    );
    drop(admission);
    wait_thread.join().unwrap();
}

#[test]
fn barrier_drains_admitted_runtime_publication_before_restore_mapping() {
    let gate = Arc::new(HistoryAdmissionGate::default());
    let keyboard = KeyboardManager::new(
        HashMap::from([("mode".to_string(), vec!["initial".into()])]),
        "mode",
    );
    let admission = gate.admit_mutation().unwrap();
    admission.revalidate_for(&gate).unwrap();
    let stale_keyboard = keyboard.clone();
    let (store_committed_tx, store_committed_rx) = mpsc::channel();
    let (publish_tx, publish_rx) = mpsc::channel();
    let mutation = thread::spawn(move || {
        store_committed_tx.send(()).unwrap();
        publish_rx.recv().unwrap();
        stale_keyboard.update_mappings_and_set_mode(
            HashMap::from([("mode".to_string(), vec!["stale".into()])]),
            "mode",
        );
        drop(admission);
    });
    store_committed_rx
        .recv_timeout(Duration::from_secs(2))
        .unwrap();

    let barrier_gate = Arc::clone(&gate);
    let restored_keyboard = keyboard.clone();
    let (restored_tx, restored_rx) = mpsc::channel();
    let barrier = thread::spawn(move || {
        let lease = barrier_gate.close("history-operation").unwrap();
        restored_keyboard.update_mappings_and_set_mode(
            HashMap::from([("mode".to_string(), vec!["restored".into()])]),
            "mode",
        );
        restored_tx.send(()).unwrap();
        drop(lease);
    });

    let deadline = Instant::now() + Duration::from_secs(2);
    while !gate.is_closed() {
        assert!(Instant::now() < deadline, "history gate did not close");
        thread::yield_now();
    }
    assert!(matches!(
        restored_rx.try_recv(),
        Err(mpsc::TryRecvError::Empty)
    ));

    publish_tx.send(()).unwrap();
    mutation.join().unwrap();
    restored_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    barrier.join().unwrap();

    assert!(keyboard.register_key_down("mode", "restored"));
    assert!(!keyboard.register_key_down("mode", "stale"));
}
