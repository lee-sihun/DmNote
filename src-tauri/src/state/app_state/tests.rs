
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc, Arc,
    },
    thread,
    time::{Duration, Instant},
};

use super::{
    acknowledge_editor_flush_handshake, acknowledge_panel_close_request, apply_panel_bounds_change,
    begin_panel_close_request, bootstrap_keyboard_state, canonical_hold_duration_ms,
    changed_panel_max_height, clamp_overlay_dimension, collect_authorized_css_paths,
    collect_frontend_lifecycle_targets, drop_panel_hidden_with_main,
    frontend_history_mutation_blocked, frontend_lifecycle_restore_labels, global_css_watch_path,
    hide_panel_with_main_transition, initial_overlay_placement, install_history_handshake,
    install_lifecycle_handshake, is_panel_open_url, key_state_payload, main_window_starts_hidden,
    monitor_scale_is_usable, next_keyboard_recovery_plan, normalize_stored_overlay_bounds,
    overlay_close_action, overlay_reset_fallback_rect, panel_bounds_from_sample,
    panel_height_bounds, panel_position_beside_main, publish_panel_hidden_transition,
    publish_panel_visibility_transition, resolve_event_age_ms, resolve_panel_window_layout,
    restore_panel_with_main_transition, run_panel_close_timeout, should_create_overlay_on_startup,
    should_recover_keyboard_daemon, should_restore_panel_on_startup,
    stored_bounds_need_monitor_data, take_cancelable_editor_flush_handshake,
    take_editor_flush_handshake, take_panel_open_arm, AppState, EditorFlushAcknowledge,
    EditorFlushCompletion, EditorFlushHandshake, EditorFlushRequest, FrontendFlushAction,
    FrontendHistoryFlushPhase, FrontendHistoryFlushReady, FrontendLifecycleAction,
    KeyCounterEventEmitter, LifecycleHandshakeInstall, LogicalRect, MonitorData, MonitorSpec,
    MutationPublicationSequencer, Mutex, OverlayCloseAction, PanelBoundsChange,
    PanelBoundsPersistenceController, PanelBoundsPersistenceState, PanelBoundsSample,
    PanelCloseRequestState, PanelCloseRequestedPayload, PanelVisibilityEventEmitter,
    PanelVisibilityPayload, PanelVisibilityReason, PhysicalPosition, PhysicalSize,
    DEFAULT_OVERLAY_HEIGHT, DEFAULT_OVERLAY_WIDTH, HISTORY_FRONTEND_FLUSH_INTERRUPTED,
    KEYBOARD_DAEMON_STABLE_RUNTIME, KEYBOARD_RECOVERY_DELAYS_MS, OVERLAY_LABEL, PANEL_BESIDE_GAP,
    PANEL_INITIAL_HEIGHT, PANEL_LABEL, PANEL_MIN_HEIGHT, PANEL_OPEN_ARM_TIMEOUT, PANEL_WIDTH,
};
use crate::{
    keyboard::KeyboardManager,
    models::{
        AppStoreData, CustomCss, CustomTab, EditorCommitOrigin, EditorCommitRequest, EditorField,
        EditorFrozenKeySlotV1, EditorOpV1, GestureCommitRequest, GesturePluginInstancesChange,
        KeyCounters, KeySlot, OverlayBounds, PanelBounds, PluginPoint, SavedPluginInstance, TabCss,
        EDITOR_OPS_VERSION,
    },
    state::{
        history::{HistoryAdmissionGate, HistoryDirection, HistoryScope},
        local_asset_path::path_identity_key,
        store::{
            AppStore, AuxEditorResetTransactionOptions, AuxEditorTransactionOptions,
            PluginInstancesResetScope,
        },
    },
};
use std::path::Path;

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

#[test]
fn preset_mapping_commit_drops_queued_increment_for_replaced_key() {
    let directory = tempfile::tempdir().unwrap();
    let store = AppStore::initialize_for_test(directory.path()).unwrap();
    store
        .update(|data| data.key_counter_enabled = true)
        .unwrap();
    let state = Arc::new(AppState::initialize(store).unwrap());
    let emitter = NoopCounterEmitter;
    let mode = state.store.snapshot().selected_key_type;
    let replaced_key = state.store.snapshot().keys[&mode][0].canonical();
    let preserved_key = state.store.snapshot().keys[&mode][1].canonical();
    for expected in 1..=7 {
        assert_eq!(
            state.increment_key_counter_and_emit(&emitter, &mode, &preserved_key),
            Some(expected)
        );
    }
    assert_eq!(
        state.store.snapshot().key_counters[&mode][&preserved_key],
        0
    );
    let replacement_key = "QA PRESET REPLACEMENT";
    let commit_state = Arc::clone(&state);
    let commit_mode = mode.clone();
    let (barrier_ready_tx, barrier_ready_rx) = mpsc::channel();
    let (release_commit_tx, release_commit_rx) = mpsc::channel();
    let commit = thread::spawn(move || {
        let admission = commit_state.store.admit_editor_mutation().unwrap();
        commit_state.commit_preset_editor_transaction_preserving_runtime_counters(
            &NoopCounterEmitter,
            EditorCommitOrigin::LegacyAdapter("preset_load".to_string()),
            &[EditorField::Keys, EditorField::KeyPositions],
            admission,
            |data| {
                barrier_ready_tx.send(()).unwrap();
                release_commit_rx
                    .recv_timeout(Duration::from_secs(3))
                    .unwrap();
                data.keys.get_mut(&commit_mode).unwrap()[0] = KeySlot::from(replacement_key);
                Ok(())
            },
        )
    });
    barrier_ready_rx
        .recv_timeout(Duration::from_secs(3))
        .unwrap();
    assert_eq!(
        state.increment_key_counter_and_emit(&emitter, &mode, &replaced_key),
        None
    );
    release_commit_tx.send(()).unwrap();
    let (transaction, runtime_applied) = commit.join().unwrap().unwrap();

    assert!(runtime_applied);
    assert!(transaction
        .change
        .result
        .changed_fields
        .contains(&EditorField::Keys));
    assert!(!state.snapshot_key_counters()[&mode].contains_key(&replaced_key));
    assert_eq!(state.snapshot_key_counters()[&mode][replacement_key], 0);
    assert_eq!(state.snapshot_key_counters()[&mode][&preserved_key], 7);
    assert!(!state.store.snapshot().key_counters[&mode].contains_key(&replaced_key));
    assert_eq!(
        state.store.snapshot().key_counters[&mode][&preserved_key],
        7
    );
    state.shutdown();
    drop(state);
    let reloaded = AppStore::initialize_for_test(directory.path()).unwrap();
    assert!(!reloaded.snapshot().key_counters[&mode].contains_key(&replaced_key));
    assert_eq!(reloaded.snapshot().key_counters[&mode][&preserved_key], 7);
    reloaded.flush_and_shutdown().unwrap();
}

#[test]
fn startup_overlay_creation_covers_all_visibility_and_obs_combinations() {
    assert!(!should_create_overlay_on_startup(false, false));
    assert!(should_create_overlay_on_startup(false, true));
    assert!(!should_create_overlay_on_startup(true, false));
    assert!(!should_create_overlay_on_startup(true, true));
}

#[test]
fn key_mapping_commit_preserves_unflushed_runtime_counters() {
    let directory = std::env::temp_dir().join(format!(
        "dmnote-editor-live-counter-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&directory).unwrap();
    let state = AppState::initialize(AppStore::initialize_for_test(&directory).unwrap()).unwrap();
    state.key_counter_enabled.store(true, Ordering::SeqCst);
    let emitter = NoopCounterEmitter;
    let editor = state.store.editor_get();
    let mode = state.store.snapshot().selected_key_type;
    let preserved_key = editor.document.keys[&mode][0].canonical();

    for expected in 1..=7 {
        assert_eq!(
            state.increment_key_counter_and_emit(&emitter, &mode, &preserved_key),
            Some(expected)
        );
    }
    assert_eq!(
        state.store.snapshot().key_counters[&mode][&preserved_key],
        0
    );

    let replaced_key = editor.document.keys[&mode][1].canonical();
    let replaced_id = editor.document.key_positions[&mode][1].id.clone();
    let request = EditorCommitRequest {
        base_revision: editor.revision,
        mutation_id: uuid::Uuid::new_v4().to_string(),
        multi_key: false,
        gesture_id: None,
        gesture_ids: Vec::new(),
        changes: None,
        ops_version: Some(EDITOR_OPS_VERSION),
        ops: Some(vec![EditorOpV1::SetKeySlot {
            id: replaced_id,
            slot: EditorFrozenKeySlotV1::Single("QA NEW KEY".to_string()),
        }]),
    };
    let admission = state.store.admit_editor_mutation().unwrap();
    let (change, runtime_applied) = state
        .commit_editor_document_preserving_runtime_counters(&emitter, request, &admission)
        .unwrap();
    drop(admission);

    assert!(runtime_applied);
    assert_eq!(change.key_counters[&mode][&preserved_key], 7);
    assert_eq!(state.snapshot_key_counters()[&mode][&preserved_key], 7);
    let persisted = state.store.snapshot().key_counters;
    assert_eq!(persisted[&mode][&preserved_key], 7);
    assert_eq!(persisted[&mode]["QA NEW KEY"], 0);
    assert!(!persisted[&mode].contains_key(&replaced_key));

    state.shutdown();
    drop(state);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn history_mapping_change_restores_historical_counter_domain() {
    let directory = tempfile::tempdir().unwrap();
    let store = AppStore::initialize_for_test(directory.path()).unwrap();
    store
        .update(|data| data.key_counter_enabled = true)
        .unwrap();
    let state = AppState::initialize(store).unwrap();
    let emitter = NoopCounterEmitter;
    let editor = state.store.editor_get();
    let mode = state.store.snapshot().selected_key_type;
    let restored_key = editor.document.keys[&mode][0].canonical();
    let replaced_id = editor.document.key_positions[&mode][0].id.clone();
    let replacement_key = "QA HISTORY REPLACEMENT";
    for expected in 1..=12 {
        assert_eq!(
            state.increment_key_counter_and_emit(&emitter, &mode, &restored_key),
            Some(expected)
        );
    }
    assert!(!state.store.history_status().can_undo);
    let request = EditorCommitRequest {
        base_revision: editor.revision,
        mutation_id: uuid::Uuid::new_v4().to_string(),
        multi_key: false,
        gesture_id: None,
        gesture_ids: Vec::new(),
        changes: None,
        ops_version: Some(EDITOR_OPS_VERSION),
        ops: Some(vec![EditorOpV1::SetKeySlot {
            id: replaced_id,
            slot: EditorFrozenKeySlotV1::Single(replacement_key.to_string()),
        }]),
    };
    let admission = state.store.admit_editor_mutation().unwrap();
    let (committed, runtime_applied) = state
        .commit_editor_document_preserving_runtime_counters(&emitter, request, &admission)
        .unwrap();
    drop(admission);
    assert!(runtime_applied);
    assert!(!committed.key_counters[&mode].contains_key(&restored_key));
    assert_eq!(committed.key_counters[&mode][replacement_key], 0);

    let operation_id = uuid::Uuid::new_v4().to_string();
    let gate = state.store.history_gate();
    let history_barrier = gate.close(&operation_id).unwrap();
    state.begin_counter_history_barrier();
    let mut counter_guard = state.lock_key_counters_for_history();
    assert_eq!(
        state.increment_key_counter_and_emit(&emitter, &mode, replacement_key),
        None
    );
    let current_counters = counter_guard.clone();
    let undo = state
        .store
        .apply_history_operation(
            HistoryDirection::Undo,
            &operation_id,
            &current_counters,
            || {},
        )
        .unwrap();
    let change = undo.change.as_ref().unwrap();
    assert!(state.apply_history_editor_key_runtime_locked(&mut counter_guard, change));
    assert_eq!(
        state.increment_key_counter_and_emit(&emitter, &mode, &restored_key),
        None
    );
    state.finish_counter_history_barrier(
        &emitter,
        counter_guard,
        true,
        undo.runtime_publication_generation,
    );
    drop(history_barrier);

    let runtime = state.snapshot_key_counters();
    assert_eq!(runtime[&mode][&restored_key], 13);
    assert!(!runtime[&mode].contains_key(replacement_key));
    let persisted = state.store.snapshot().key_counters;
    assert_eq!(persisted[&mode][&restored_key], 12);
    assert!(!persisted[&mode].contains_key(replacement_key));

    state.shutdown();
    drop(state);
    let reloaded = AppStore::initialize_for_test(directory.path()).unwrap();
    assert_eq!(reloaded.snapshot().key_counters[&mode][&restored_key], 13);
    assert!(!reloaded.snapshot().key_counters[&mode].contains_key(replacement_key));
    reloaded.flush_and_shutdown().unwrap();
}

#[test]
fn custom_tab_create_preserves_unflushed_runtime_counters() {
    let directory = std::env::temp_dir().join(format!(
        "dmnote-custom-tab-live-counter-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&directory).unwrap();
    let state = AppState::initialize(AppStore::initialize_for_test(&directory).unwrap()).unwrap();
    state.key_counter_enabled.store(true, Ordering::SeqCst);
    let emitter = NoopCounterEmitter;
    let snapshot = state.store.snapshot();
    let mode = snapshot.selected_key_type;
    let preserved_key = snapshot.keys[&mode][0].canonical();

    for expected in 1..=7 {
        assert_eq!(
            state.increment_key_counter_and_emit(&emitter, &mode, &preserved_key),
            Some(expected)
        );
    }
    assert_eq!(
        state.store.snapshot().key_counters[&mode][&preserved_key],
        0
    );

    let tab_id = "qa-counter-tab".to_string();
    let admission = state.store.admit_editor_mutation().unwrap();
    let (transaction, runtime_applied) = state
        .commit_editor_transaction_preserving_runtime_counters(&emitter, |runtime_counters| {
            state
                .store
                .commit_aux_editor_transaction_with_runtime_counters_admission(
                    AuxEditorTransactionOptions {
                        scope: HistoryScope::CustomTabs,
                        observed_history_epoch: None,
                        origin: EditorCommitOrigin::LegacyAdapter("custom_tabs_create".to_string()),
                        touched_fields: &[EditorField::Keys, EditorField::KeyPositions],
                    },
                    admission,
                    runtime_counters,
                    |store| {
                        store.custom_tabs.push(CustomTab {
                            id: tab_id.clone(),
                            name: "QA Counter Tab".to_string(),
                        });
                        store.keys.insert(tab_id.clone(), Vec::new());
                        store.key_positions.insert(tab_id.clone(), Vec::new());
                        store.selected_key_type = tab_id.clone();
                        Ok(())
                    },
                )
        })
        .unwrap();

    assert!(runtime_applied);
    assert_eq!(state.snapshot_key_counters()[&mode][&preserved_key], 7);
    assert_eq!(
        state.store.snapshot().key_counters[&mode][&preserved_key],
        7
    );
    assert!(transaction.change.document.keys.contains_key(&tab_id));
    drop(transaction);

    assert_eq!(
        state.increment_key_counter_and_emit(&emitter, &mode, &preserved_key),
        Some(8)
    );

    let operation_id = uuid::Uuid::new_v4().to_string();
    let gate = state.store.history_gate();
    let barrier = gate.close(&operation_id).unwrap();
    state.begin_counter_history_barrier();
    let mut counter_guard = state.lock_key_counters_for_history();
    let current_counters = counter_guard.clone();
    let undo = state
        .store
        .apply_history_operation(
            HistoryDirection::Undo,
            &operation_id,
            &current_counters,
            || {},
        )
        .unwrap();
    assert!(state.apply_history_editor_key_runtime_locked(
        &mut counter_guard,
        undo.change.as_ref().unwrap(),
    ));
    state.finish_counter_history_barrier(
        &emitter,
        counter_guard,
        true,
        undo.runtime_publication_generation,
    );
    drop(barrier);
    assert_eq!(
        state.store.snapshot().key_counters[&mode][&preserved_key],
        8
    );
    assert_eq!(state.snapshot_key_counters()[&mode][&preserved_key], 8);

    state.shutdown();
    drop(state);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn custom_tab_delete_preserves_unflushed_runtime_counters() {
    let directory = std::env::temp_dir().join(format!(
        "dmnote-custom-tab-delete-live-counter-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&directory).unwrap();
    let state = AppState::initialize(AppStore::initialize_for_test(&directory).unwrap()).unwrap();
    state.key_counter_enabled.store(true, Ordering::SeqCst);
    let emitter = NoopCounterEmitter;
    let snapshot = state.store.snapshot();
    let mode = snapshot.selected_key_type;
    let preserved_key = snapshot.keys[&mode][0].canonical();
    let tab_id = "qa-counter-delete-tab".to_string();
    let create = state
        .store
        .commit_aux_editor_transaction(
            HistoryScope::CustomTabs,
            None,
            EditorCommitOrigin::LegacyAdapter("custom_tabs_create".to_string()),
            &[EditorField::Keys, EditorField::KeyPositions],
            |store| {
                store.custom_tabs.push(CustomTab {
                    id: tab_id.clone(),
                    name: "QA Counter Delete Tab".to_string(),
                });
                store.keys.insert(tab_id.clone(), Vec::new());
                store.key_positions.insert(tab_id.clone(), Vec::new());
                store.selected_key_type = tab_id.clone();
                Ok(())
            },
        )
        .unwrap();
    drop(create);

    for expected in 1..=7 {
        assert_eq!(
            state.increment_key_counter_and_emit(&emitter, &mode, &preserved_key),
            Some(expected)
        );
    }
    assert_eq!(
        state.store.snapshot().key_counters[&mode][&preserved_key],
        0
    );

    let admission = state.store.admit_editor_mutation().unwrap();
    let (transaction, runtime_applied) = state
        .commit_editor_transaction_preserving_runtime_counters(&emitter, |runtime_counters| {
            state
                .store
                .commit_aux_editor_reset_transaction_with_runtime_counters_admission(
                    AuxEditorResetTransactionOptions {
                        scope: HistoryScope::CustomTabs,
                        observed_history_epoch: None,
                        origin: EditorCommitOrigin::LegacyAdapter("custom_tabs_delete".to_string()),
                        touched_fields: &[
                            EditorField::Keys,
                            EditorField::KeyPositions,
                            EditorField::StatPositions,
                            EditorField::GraphPositions,
                            EditorField::KnobPositions,
                            EditorField::LayerGroups,
                        ],
                        plugin_instances_reset: PluginInstancesResetScope::Mode(tab_id.clone()),
                    },
                    admission,
                    runtime_counters,
                    |store| {
                        store.custom_tabs.retain(|tab| tab.id != tab_id);
                        store.keys.remove(&tab_id);
                        store.key_positions.remove(&tab_id);
                        store.stat_positions.remove(&tab_id);
                        store.graph_positions.remove(&tab_id);
                        store.knob_positions.remove(&tab_id);
                        store.layer_groups.remove(&tab_id);
                        store.key_counters.remove(&tab_id);
                        store.selected_key_type = mode.clone();
                        Ok(())
                    },
                )
        })
        .unwrap();

    assert!(runtime_applied);
    assert_eq!(state.snapshot_key_counters()[&mode][&preserved_key], 7);
    assert_eq!(
        state.store.snapshot().key_counters[&mode][&preserved_key],
        7
    );
    assert!(!transaction.change.document.keys.contains_key(&tab_id));
    drop(transaction);

    let operation_id = uuid::Uuid::new_v4().to_string();
    let gate = state.store.history_gate();
    let barrier = gate.close(&operation_id).unwrap();
    state
        .store
        .apply_history_operation(
            HistoryDirection::Undo,
            &operation_id,
            &state.snapshot_key_counters(),
            || {},
        )
        .unwrap();
    drop(barrier);
    assert_eq!(
        state.store.snapshot().key_counters[&mode][&preserved_key],
        7
    );

    state.shutdown();
    drop(state);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn custom_tab_restore_history_preserves_unflushed_runtime_counters() {
    let directory = std::env::temp_dir().join(format!(
        "dmnote-custom-tab-restore-live-counter-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&directory).unwrap();
    let state = AppState::initialize(AppStore::initialize_for_test(&directory).unwrap()).unwrap();
    state.key_counter_enabled.store(true, Ordering::SeqCst);
    let emitter = NoopCounterEmitter;
    let snapshot = state.store.snapshot();
    let mode = snapshot.selected_key_type;
    let preserved_key = snapshot.keys[&mode][0].canonical();
    let tab_id = "qa-counter-restore-tab".to_string();
    let create = state
        .store
        .commit_aux_editor_transaction(
            HistoryScope::CustomTabs,
            None,
            EditorCommitOrigin::LegacyAdapter("custom_tabs_create".to_string()),
            &[EditorField::Keys, EditorField::KeyPositions],
            |store| {
                store.custom_tabs.push(CustomTab {
                    id: tab_id.clone(),
                    name: "Before Restore".to_string(),
                });
                store.keys.insert(tab_id.clone(), Vec::new());
                store.key_positions.insert(tab_id.clone(), Vec::new());
                Ok(())
            },
        )
        .unwrap();
    drop(create);

    for expected in 1..=7 {
        assert_eq!(
            state.increment_key_counter_and_emit(&emitter, &mode, &preserved_key),
            Some(expected)
        );
    }
    let mut restored_tabs = state.store.snapshot().custom_tabs;
    restored_tabs[0].name = "After Restore".to_string();
    let admission = state.store.admit_editor_mutation().unwrap();
    let (transaction, runtime_applied) = state
        .commit_editor_transaction_preserving_runtime_counters(&emitter, |runtime_counters| {
            state
                .store
                .commit_aux_editor_transaction_with_runtime_counters_admission(
                    AuxEditorTransactionOptions {
                        scope: HistoryScope::CustomTabs,
                        observed_history_epoch: None,
                        origin: EditorCommitOrigin::LegacyAdapter(
                            "custom_tabs_restore".to_string(),
                        ),
                        touched_fields: &[],
                    },
                    admission,
                    runtime_counters,
                    |store| {
                        store.custom_tabs = restored_tabs;
                        Ok(())
                    },
                )
        })
        .unwrap();

    assert!(!runtime_applied);
    assert_eq!(
        state.store.snapshot().key_counters[&mode][&preserved_key],
        7
    );
    assert_eq!(state.store.snapshot().custom_tabs[0].name, "After Restore");
    drop(transaction);

    assert_eq!(
        state.increment_key_counter_and_emit(&emitter, &mode, &preserved_key),
        Some(8)
    );

    let operation_id = uuid::Uuid::new_v4().to_string();
    let gate = state.store.history_gate();
    let barrier = gate.close(&operation_id).unwrap();
    state
        .store
        .apply_history_operation(
            HistoryDirection::Undo,
            &operation_id,
            &state.snapshot_key_counters(),
            || {},
        )
        .unwrap();
    drop(barrier);
    assert_eq!(
        state.store.snapshot().key_counters[&mode][&preserved_key],
        8
    );
    assert_eq!(state.snapshot_key_counters()[&mode][&preserved_key], 8);
    assert_eq!(state.store.snapshot().custom_tabs[0].name, "Before Restore");

    state.shutdown();
    drop(state);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn mixed_gesture_history_preserves_live_and_restores_historical_counters() {
    let directory = std::env::temp_dir().join(format!(
        "dmnote-gesture-live-counter-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&directory).unwrap();
    let state = AppState::initialize(AppStore::initialize_for_test(&directory).unwrap()).unwrap();
    state.key_counter_enabled.store(true, Ordering::SeqCst);
    let emitter = NoopCounterEmitter;
    let editor = state.store.editor_get();
    let mode = state.store.snapshot().selected_key_type;
    let preserved_key = editor.document.keys[&mode][0].canonical();
    let replaced_key = editor.document.keys[&mode][1].canonical();

    for expected in 1..=7 {
        assert_eq!(
            state.increment_key_counter_and_emit(&emitter, &mode, &preserved_key),
            Some(expected)
        );
    }
    for expected in 1..=12 {
        assert_eq!(
            state.increment_key_counter_and_emit(&emitter, &mode, &replaced_key),
            Some(expected)
        );
    }
    assert_eq!(
        state.store.snapshot().key_counters[&mode][&preserved_key],
        0
    );

    let replaced_id = editor.document.key_positions[&mode][1].id.clone();
    let plugin_id = "qa-mixed-counter";
    let plugin_instance_id = uuid::Uuid::new_v4().to_string();
    let request = GestureCommitRequest {
        gesture_id: uuid::Uuid::new_v4().to_string(),
        mutation_id: uuid::Uuid::new_v4().to_string(),
        editor_base_revision: editor.revision,
        plugin_base_revision: state.store.plugin_model_revision(),
        observed_history_epoch: Some(state.store.history_status().history_epoch),
        authority_generation: 1,
        editor_changes: None,
        editor_ops_version: Some(EDITOR_OPS_VERSION),
        editor_ops: Some(vec![EditorOpV1::SetKeySlot {
            id: replaced_id,
            slot: EditorFrozenKeySlotV1::Single("QA MIXED KEY".to_string()),
        }]),
        plugin_changes: vec![GesturePluginInstancesChange {
            plugin_id: plugin_id.to_string(),
            instances: vec![SavedPluginInstance {
                instance_id: Some(plugin_instance_id.clone()),
                position: PluginPoint { x: 20.0, y: 30.0 },
                settings: None,
                measured_size: None,
                tab_id: None,
                hidden: false,
                z_index: None,
                group_id: None,
            }],
        }],
    };
    let admission = state.store.admit_editor_mutation().unwrap();
    let (committed, runtime_applied) = state
        .commit_gesture_preserving_runtime_counters(&emitter, request, admission)
        .unwrap();

    assert!(runtime_applied);
    assert_eq!(committed.outcome.changed_plugin_ids, [plugin_id]);
    let change = committed.outcome.change.as_ref().unwrap();
    assert_eq!(change.key_counters[&mode][&preserved_key], 7);
    assert_eq!(state.snapshot_key_counters()[&mode][&preserved_key], 7);
    let persisted = state.store.snapshot().key_counters;
    assert_eq!(persisted[&mode][&preserved_key], 7);
    assert_eq!(persisted[&mode]["QA MIXED KEY"], 0);
    assert!(!persisted[&mode].contains_key(&replaced_key));
    let (instances, revision) = state.store.plugin_instances_get(plugin_id).unwrap();
    assert_eq!(revision, 1);
    assert_eq!(instances.len(), 1);
    assert_eq!(
        instances[0].instance_id.as_deref(),
        Some(plugin_instance_id.as_str())
    );
    drop(committed);

    for expected in 1..=9 {
        assert_eq!(
            state.increment_key_counter_and_emit(&emitter, &mode, "QA MIXED KEY"),
            Some(expected)
        );
    }
    assert_eq!(
        state.increment_key_counter_and_emit(&emitter, &mode, &preserved_key),
        Some(8)
    );

    let operation_id = uuid::Uuid::new_v4().to_string();
    let gate = state.store.history_gate();
    let history_barrier = gate.close(&operation_id).unwrap();
    state.begin_counter_history_barrier();
    let mut counter_guard = state.lock_key_counters_for_history();
    let current_counters = counter_guard.clone();
    let undo = state
        .store
        .apply_history_operation(
            HistoryDirection::Undo,
            &operation_id,
            &current_counters,
            || {},
        )
        .unwrap();
    assert!(state.apply_history_editor_key_runtime_locked(
        &mut counter_guard,
        undo.change.as_ref().unwrap(),
    ));
    state.finish_counter_history_barrier(
        &emitter,
        counter_guard,
        true,
        undo.runtime_publication_generation,
    );
    drop(history_barrier);

    let restored = state.snapshot_key_counters();
    assert_eq!(restored[&mode][&replaced_key], 12);
    assert_eq!(restored[&mode][&preserved_key], 8);
    assert!(!restored[&mode].contains_key("QA MIXED KEY"));
    assert!(state
        .store
        .plugin_instances_get(plugin_id)
        .unwrap()
        .0
        .is_empty());

    state.shutdown();
    drop(state);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn committed_key_positions_refresh_key_sound_binding_cache() {
    let directory = std::env::temp_dir().join(format!(
        "dmnote-key-sound-binding-cache-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&directory).unwrap();
    let state = AppState::initialize(AppStore::initialize_for_test(&directory).unwrap()).unwrap();
    let initial = state.store.snapshot();
    let mode = initial.selected_key_type.clone();
    let sound_path = format!("/tmp/key-sound-{}.wav", uuid::Uuid::new_v4());
    let committed_path = sound_path.clone();
    let transaction = state
        .store
        .commit_legacy_editor_transaction(
            EditorCommitOrigin::LegacyAdapter("key_sound_binding_cache_test".to_string()),
            &[EditorField::KeyPositions],
            move |store| {
                let position = store
                    .key_positions
                    .get_mut(&mode)
                    .unwrap()
                    .first_mut()
                    .unwrap();
                position.sound_enabled = Some(true);
                position.sound_path = Some(format!("  {committed_path}  "));
                position.sound_volume = Some(150.0);
                Ok(())
            },
        )
        .unwrap();

    assert_ne!(
        state.resolve_key_sound_binding(&initial.selected_key_type, &[0]),
        Some((sound_path.clone(), 1.5))
    );
    assert!(state.publish_committed_key_sound_bindings(&transaction.change));
    assert_eq!(
        state.resolve_key_sound_binding(&initial.selected_key_type, &[0]),
        Some((sound_path, 1.5))
    );

    drop(transaction);
    state.shutdown();
    drop(state);
    std::fs::remove_dir_all(directory).unwrap();
}

// 장치 전환 대기는 번호표 밖 - 앞 번호표가 잡혀 있어도 엔진은 먼저 전환되고
// persist만 turn을 기다린다 (turn 안에서 기다리면 뒤 번호표 전부가 드라이버를 기다림)
#[test]
fn output_backend_switch_runs_before_publication_turn() {
    let directory = std::env::temp_dir().join(format!(
        "dmnote-output-backend-turn-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&directory).unwrap();
    let state =
        Arc::new(AppState::initialize(AppStore::initialize_for_test(&directory).unwrap()).unwrap());
    let blocking_ticket = state.issue_mutation_publication().unwrap();

    let (done_tx, done_rx) = mpsc::channel();
    let worker_state = Arc::clone(&state);
    let worker = thread::spawn(move || {
        let result = worker_state
            .key_sound_set_output_backend(crate::audio::KeySoundOutputBackend::DefaultDevice);
        done_tx.send(result.is_ok()).unwrap();
    });

    // 앞 번호표가 살아 있는 동안 persist는 turn을 기다린다
    assert!(done_rx.recv_timeout(Duration::from_millis(500)).is_err());
    assert!(state.store.snapshot().key_sound_output_backend.is_none());

    drop(blocking_ticket);
    assert!(done_rx
        .recv_timeout(Duration::from_secs(5))
        .expect("앞 번호표가 풀리면 persist가 완료된다"));
    worker.join().unwrap();
    assert!(state.store.snapshot().key_sound_output_backend.is_some());

    state.shutdown();
    drop(state);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn mutation_publication_preserves_ticket_order_when_first_worker_is_delayed() {
    let publication = Arc::new(MutationPublicationSequencer::default());
    let first = publication.issue().unwrap();
    let second = publication.issue().unwrap();
    let order = Arc::new(Mutex::new(Vec::new()));
    let (second_waiting_tx, second_waiting_rx) = mpsc::channel();
    let (second_done_tx, second_done_rx) = mpsc::channel();
    let second_order = Arc::clone(&order);
    let second_worker = thread::spawn(move || {
        second_waiting_tx.send(()).unwrap();
        second.run(|| second_order.lock().push(2));
        second_done_tx.send(()).unwrap();
    });
    second_waiting_rx
        .recv_timeout(Duration::from_secs(2))
        .unwrap();
    assert!(matches!(
        second_done_rx.recv_timeout(Duration::from_millis(50)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));

    let first_order = Arc::clone(&order);
    let first_worker = thread::spawn(move || first.run(|| first_order.lock().push(1)));
    first_worker.join().unwrap();
    second_done_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    second_worker.join().unwrap();
    assert_eq!(*order.lock(), vec![1, 2]);
}

// 커밋 커맨드 구조 재현: 뒤 번호표가 먼저 admit한 뒤 turn을 기다리고, 앞 번호표가
// 그 다음 admit → turn. lease가 잠금이면 앞 번호표가 admit에서 막혀 영구 교착
#[test]
fn plugin_authority_admission_does_not_block_earlier_publication_turn() {
    use crate::state::plugin::PluginRuntimeAuthority;

    let publication = Arc::new(MutationPublicationSequencer::default());
    let authority = Arc::new(PluginRuntimeAuthority::default());
    authority.reset().unwrap();
    let first = publication.issue().unwrap();
    let second = publication.issue().unwrap();
    let order = Arc::new(Mutex::new(Vec::new()));

    let (second_admitted_tx, second_admitted_rx) = mpsc::channel();
    let second_authority = Arc::clone(&authority);
    let second_order = Arc::clone(&order);
    let second_worker = thread::spawn(move || {
        let lease = second_authority.admit(1).unwrap();
        second_admitted_tx.send(()).unwrap();
        second.run(|| {
            second_authority.revalidate(lease).unwrap();
            second_order.lock().push(2);
        });
    });
    second_admitted_rx
        .recv_timeout(Duration::from_secs(2))
        .unwrap();

    let first_authority = Arc::clone(&authority);
    let first_order = Arc::clone(&order);
    let first_worker = thread::spawn(move || {
        let lease = first_authority.admit(1).unwrap();
        first.run(|| {
            first_authority.revalidate(lease).unwrap();
            first_order.lock().push(1);
        });
    });

    let (done_tx, done_rx) = mpsc::channel();
    thread::spawn(move || {
        first_worker.join().unwrap();
        second_worker.join().unwrap();
        done_tx.send(()).unwrap();
    });
    done_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("admit이 잠금을 들지 않아야 번호표 순서대로 진행된다");
    assert_eq!(*order.lock(), vec![1, 2]);
}

// 번호표 FIFO가 reset과 커밋을 직렬화한다 - reset 뒤 turn의 revalidate는 거절
#[test]
fn plugin_authority_revalidate_rejects_commit_admitted_before_reset() {
    use crate::state::plugin::PluginRuntimeAuthority;

    let publication = Arc::new(MutationPublicationSequencer::default());
    let authority = PluginRuntimeAuthority::default();
    authority.reset().unwrap();
    let lease = authority.admit(1).unwrap();

    let reset_ticket = publication.issue().unwrap();
    let commit_ticket = publication.issue().unwrap();
    reset_ticket.run(|| authority.reset().unwrap());
    let rejected = commit_ticket.run(|| authority.revalidate(lease));
    assert_eq!(
        rejected.unwrap_err(),
        "AUTHORITY_GENERATION_CHANGED".to_string()
    );
}

#[test]
fn mutation_publication_advances_after_unrun_ticket_is_dropped() {
    let publication = Arc::new(MutationPublicationSequencer::default());
    let first = publication.issue().unwrap();
    let second = publication.issue().unwrap();

    drop(first);

    assert_eq!(publication.state.lock().serving_ticket, 1);
    let mut ran = false;
    second.run(|| ran = true);
    assert!(ran);
}

#[test]
fn mutation_publication_advances_after_panicking_turn() {
    let publication = Arc::new(MutationPublicationSequencer::default());
    let first = publication.issue().unwrap();
    let second = publication.issue().unwrap();
    let order = Arc::new(Mutex::new(Vec::new()));
    let first_order = Arc::clone(&order);
    let first_worker = thread::spawn(move || {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            first.run(|| {
                first_order.lock().push(1);
                panic!("publication panic test");
            });
        }))
    });
    let second_order = Arc::clone(&order);
    let second_worker = thread::spawn(move || second.run(|| second_order.lock().push(2)));

    assert!(first_worker.join().unwrap().is_err());
    second_worker.join().unwrap();
    assert_eq!(*order.lock(), vec![1, 2]);
}

#[test]
fn history_close_drains_while_mutation_publication_is_held() {
    let publication = Arc::new(MutationPublicationSequencer::default());
    let ticket = publication.issue().unwrap();
    let gate = Arc::new(HistoryAdmissionGate::default());
    let admission = gate.admit_mutation().unwrap();
    let (publication_held_tx, publication_held_rx) = mpsc::channel();
    let (release_publication_tx, release_publication_rx) = mpsc::channel();
    let mutation = thread::spawn(move || {
        ticket.run(|| {
            publication_held_tx.send(()).unwrap();
            release_publication_rx.recv().unwrap();
            drop(admission);
        });
    });
    publication_held_rx
        .recv_timeout(Duration::from_secs(2))
        .unwrap();

    let barrier = gate.begin_close("history-close-publication-test").unwrap();
    let waiter = barrier.waiter();
    let (drained_tx, drained_rx) = mpsc::channel();
    let drain = thread::spawn(move || {
        drained_tx.send(waiter.wait_for_drain()).unwrap();
    });
    assert!(matches!(
        drained_rx.recv_timeout(Duration::from_millis(50)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));

    release_publication_tx.send(()).unwrap();
    assert_eq!(
        drained_rx.recv_timeout(Duration::from_secs(2)).unwrap(),
        Ok(())
    );
    mutation.join().unwrap();
    drain.join().unwrap();
    drop(barrier);
}

#[test]
fn overlay_close_preserves_visibility_while_windows_lifecycle_is_pending() {
    assert_eq!(
        overlay_close_action(false, true),
        OverlayCloseAction::PreserveVisibility
    );
}

#[test]
fn overlay_close_distinguishes_final_shutdown_from_user_close() {
    assert_eq!(
        overlay_close_action(true, true),
        OverlayCloseAction::AllowClose
    );
    assert_eq!(
        overlay_close_action(false, false),
        OverlayCloseAction::HideAndPersist
    );
}

#[test]
fn startup_panel_restore_requires_detached_without_obs_or_tray_start() {
    assert!(should_restore_panel_on_startup(false, false, true));
    assert!(!should_restore_panel_on_startup(false, false, false));
    assert!(!should_restore_panel_on_startup(true, false, true));
    assert!(!should_restore_panel_on_startup(false, true, true));
}

#[test]
fn startup_hidden_main_window_needs_both_tray_and_hidden_flags() {
    assert!(main_window_starts_hidden(true, true));
    assert!(!main_window_starts_hidden(false, true));
    assert!(!main_window_starts_hidden(true, false));
    // 메인 창 표시와 패널 복원이 같은 판정을 공유한다
    assert!(should_restore_panel_on_startup(
        false,
        main_window_starts_hidden(false, true),
        true
    ));
    assert!(!should_restore_panel_on_startup(
        false,
        main_window_starts_hidden(true, true),
        true
    ));
}

#[test]
fn panel_window_contract_uses_fixed_client_width() {
    assert_eq!(PANEL_LABEL, "panel");
    assert_eq!(PANEL_WIDTH, 240.0);
    assert_eq!(PANEL_INITIAL_HEIGHT, 712.0);
    assert_eq!(PANEL_MIN_HEIGHT, 712.0);
    // 넉넉한 화면에서는 하한이 그대로 유지됨
    assert_eq!(
        panel_height_bounds(Some(1_000.0)),
        (PANEL_MIN_HEIGHT, 900.0)
    );
    // 하한보다 좁은 작업 영역에서는 하한이 화면에 맞춰 내려감 - clamp 역전 방지
    assert_eq!(panel_height_bounds(Some(600.0)), (540.0, 540.0));
    let (min_height, max_height) = panel_height_bounds(None);
    assert_eq!(min_height, PANEL_MIN_HEIGHT);
    assert!(max_height >= min_height);
}

#[test]
fn panel_layout_never_exceeds_a_small_work_area() {
    let monitors = MonitorData {
        specs: vec![MonitorSpec {
            logical_origin_x: 0.0,
            logical_origin_y: 0.0,
            logical_width: 1_280.0,
            logical_height: 680.0,
            physical_origin_x: 0.0,
            physical_origin_y: 0.0,
            physical_width: 1_280.0,
            physical_height: 680.0,
            scale_factor: 1.0,
        }],
        primary_index: Some(0),
    };
    let layout = resolve_panel_window_layout(None, None, &monitors, None);

    assert!(layout.min_height <= layout.max_height);
    assert!(layout.height <= 680.0);
    assert_eq!(layout.height, layout.max_height);
}

fn work_area_spec(origin_x: f64, origin_y: f64, width: f64, height: f64) -> MonitorSpec {
    MonitorSpec {
        logical_origin_x: origin_x,
        logical_origin_y: origin_y,
        logical_width: width,
        logical_height: height,
        physical_origin_x: origin_x,
        physical_origin_y: origin_y,
        physical_width: width,
        physical_height: height,
        scale_factor: 1.0,
    }
}

fn main_rect(x: f64, y: f64, width: f64, height: f64) -> LogicalRect {
    LogicalRect {
        x,
        y,
        width,
        height,
    }
}

#[test]
fn panel_lands_beside_the_main_window_on_the_right() {
    let work_area = work_area_spec(0.0, 0.0, 1_920.0, 1_080.0);
    let position =
        panel_position_beside_main(&main_rect(400.0, 200.0, 900.0, 500.0), 400.0, &work_area);

    assert_eq!(position.x, 400.0 + 900.0 + PANEL_BESIDE_GAP);
    // 메인 창 세로 중앙
    assert_eq!(position.y, 250.0);
}

#[test]
fn panel_flips_to_the_left_when_the_right_side_has_no_room() {
    let work_area = work_area_spec(0.0, 0.0, 1_920.0, 1_080.0);
    let position =
        panel_position_beside_main(&main_rect(1_600.0, 200.0, 300.0, 500.0), 400.0, &work_area);

    assert_eq!(position.x, 1_600.0 - PANEL_BESIDE_GAP - PANEL_WIDTH);
    assert_eq!(position.y, 250.0);
}

#[test]
fn panel_clamps_into_the_work_area_when_neither_side_fits() {
    let work_area = work_area_spec(0.0, 0.0, 600.0, 800.0);
    let position =
        panel_position_beside_main(&main_rect(0.0, 0.0, 600.0, 400.0), 300.0, &work_area);

    assert_eq!(position.x, 600.0 - PANEL_WIDTH);
    assert_eq!(position.y, 50.0);
}

#[test]
fn panel_taller_than_the_work_area_clamps_to_its_top() {
    let work_area = work_area_spec(100.0, 50.0, 1_920.0, 1_000.0);
    let position =
        panel_position_beside_main(&main_rect(200.0, 400.0, 900.0, 500.0), 1_400.0, &work_area);

    assert_eq!(position.x, 200.0 + 900.0 + PANEL_BESIDE_GAP);
    assert_eq!(position.y, 50.0);
}

#[test]
fn panel_layout_keeps_stored_height_and_places_beside_main() {
    let monitors = MonitorData {
        specs: vec![work_area_spec(0.0, 0.0, 1_920.0, 1_080.0)],
        primary_index: Some(0),
    };
    let layout = resolve_panel_window_layout(
        Some(PanelBounds {
            x: 31.0,
            y: 47.0,
            height: 800.0,
        }),
        Some(main_rect(300.0, 100.0, 900.0, 500.0)),
        &monitors,
        None,
    );

    // 높이는 저장값 유지, 위치는 저장값을 무시하고 메인 옆으로 다시 계산
    assert_eq!(layout.height, 800.0);
    let position = layout.position.expect("panel should be placed beside main");
    assert_eq!(position.x, 300.0 + 900.0 + PANEL_BESIDE_GAP);
    // 세로 중앙이 화면 위로 넘치면 작업 영역 상단에 붙는다
    assert_eq!(position.y, 0.0);
}

#[test]
fn panel_open_arm_is_consumed_once_and_expires() {
    let now = Instant::now();
    let mut slot = None;
    assert!(!take_panel_open_arm(&mut slot, now));

    let mut slot = Some(now);
    assert!(take_panel_open_arm(
        &mut slot,
        now + Duration::from_millis(500)
    ));
    // 소비된 토큰은 다시 쓸 수 없다
    assert!(!take_panel_open_arm(
        &mut slot,
        now + Duration::from_millis(600)
    ));

    let mut slot = Some(now);
    assert!(!take_panel_open_arm(
        &mut slot,
        now + PANEL_OPEN_ARM_TIMEOUT + Duration::from_millis(1)
    ));
    assert!(slot.is_none());
}

#[test]
fn panel_open_accepts_only_blank_urls() {
    assert!(is_panel_open_url(""));
    assert!(is_panel_open_url("about:blank"));
    assert!(!is_panel_open_url("https://example.com"));
    assert!(!is_panel_open_url("tauri://localhost/panel/index.html"));
}

#[test]
fn settled_panel_bounds_convert_physical_geometry_once() {
    let bounds = panel_bounds_from_sample(PanelBoundsSample {
        position: PhysicalPosition::new(600, 300),
        position_scale_factor: 2.0,
        size: PhysicalSize::new(480, 1_600),
        size_scale_factor: 2.0,
        current_scale_factor: 2.0,
    });

    assert_eq!(bounds.x, 300.0);
    assert_eq!(bounds.y, 150.0);
    // 표본은 실측 그대로 - 하한은 복원 시 모니터 기준으로 다시 적용됨
    assert_eq!(bounds.height, 800.0);
}

#[test]
fn panel_bounds_controller_preserves_scale_domains_and_coalesces_events() {
    let mut sample = PanelBoundsSample {
        position: PhysicalPosition::new(600, 300),
        position_scale_factor: 2.0,
        size: PhysicalSize::new(480, 1_000),
        size_scale_factor: 2.0,
        current_scale_factor: 2.0,
    };
    apply_panel_bounds_change(
        &mut sample,
        PanelBoundsChange::ScaleFactorChanged {
            position: None,
            size: PhysicalSize::new(480, 1_000),
            scale_factor: 1.0,
        },
    );
    let bounds = panel_bounds_from_sample(sample);

    assert_eq!(bounds.x, 300.0);
    assert_eq!(bounds.y, 150.0);
    assert_eq!(bounds.height, 1_000.0);
    let mut state = PanelBoundsPersistenceState {
        latest: Some(sample),
        session: 1,
        active: true,
        ..PanelBoundsPersistenceState::default()
    };
    assert!(PanelBoundsPersistenceController::record_change(
        &mut state,
        1,
        PanelBoundsChange::Moved(PhysicalPosition::new(800, 400)),
    ));
    assert!(!PanelBoundsPersistenceController::record_change(
        &mut state,
        1,
        PanelBoundsChange::Resized(PhysicalSize::new(480, 1_200)),
    ));
    assert_eq!(
        (state.generation, state.worker_running, state.dirty),
        (2, true, true)
    );
    let mut empty_state = PanelBoundsPersistenceState {
        session: 1,
        active: true,
        ..PanelBoundsPersistenceState::default()
    };
    assert!(PanelBoundsPersistenceController::record_change(
        &mut empty_state,
        1,
        PanelBoundsChange::Snapshot(sample),
    ));
    assert_eq!(empty_state.latest, Some(sample));
}

#[test]
fn panel_move_skips_the_disk_write_while_resize_persists() {
    let sample = PanelBoundsSample {
        position: PhysicalPosition::new(600, 300),
        position_scale_factor: 2.0,
        size: PhysicalSize::new(480, 1_000),
        size_scale_factor: 2.0,
        current_scale_factor: 2.0,
    };
    let mut state = PanelBoundsPersistenceState {
        latest: Some(sample),
        session: 3,
        active: true,
        ..PanelBoundsPersistenceState::default()
    };

    // 이동도 워커는 깨운다 - 모니터 보정이 붙어 있기 때문
    assert!(PanelBoundsPersistenceController::record_change(
        &mut state,
        3,
        PanelBoundsChange::Moved(PhysicalPosition::new(800, 400)),
    ));
    let moved = PanelBoundsPersistenceController::take_dirty_work(&mut state)
        .expect("move still schedules worker work");
    assert!(!moved.persist);
    assert!(!state.persist_dirty);

    // 리사이즈는 복원에 쓰는 높이를 바꾸므로 저장 대상
    PanelBoundsPersistenceController::record_change(
        &mut state,
        3,
        PanelBoundsChange::Resized(PhysicalSize::new(480, 1_200)),
    );
    let resized = PanelBoundsPersistenceController::take_dirty_work(&mut state)
        .expect("resize schedules worker work");
    assert!(resized.persist);

    // 저장 실패는 저장 대상 표식까지 되살린다
    assert!(PanelBoundsPersistenceController::restore_failed_work(
        &mut state, &resized
    ));
    assert!(state.dirty);
    assert!(state.persist_dirty);

    // 뒤따르는 이동이 이미 잡힌 저장 대상을 지우지 않는다
    PanelBoundsPersistenceController::record_change(
        &mut state,
        3,
        PanelBoundsChange::Moved(PhysicalPosition::new(900, 500)),
    );
    assert!(
        PanelBoundsPersistenceController::take_dirty_work(&mut state)
            .expect("coalesced work stays scheduled")
            .persist
    );
}

#[test]
fn panel_reset_ignores_default_layout_resize_before_user_resize() {
    let mut state = PanelBoundsPersistenceState {
        latest: Some(PanelBoundsSample {
            position: PhysicalPosition::new(600, 300),
            position_scale_factor: 2.0,
            size: PhysicalSize::new(480, 2_000),
            size_scale_factor: 2.0,
            current_scale_factor: 2.0,
        }),
        unpersisted_default_height: Some(712.0),
        default_height_pending: true,
        session: 3,
        active: true,
        ..PanelBoundsPersistenceState::default()
    };

    PanelBoundsPersistenceController::record_change(
        &mut state,
        3,
        PanelBoundsChange::Resized(PhysicalSize::new(480, 1_600)),
    );
    assert!(
        !PanelBoundsPersistenceController::take_dirty_work(&mut state)
            .expect("intermediate reset size should schedule constraints")
            .persist
    );

    PanelBoundsPersistenceController::record_change(
        &mut state,
        3,
        PanelBoundsChange::Resized(PhysicalSize::new(480, 1_424)),
    );
    assert!(
        !PanelBoundsPersistenceController::take_dirty_work(&mut state)
            .expect("default reset size should schedule constraints")
            .persist
    );
    assert!(!state.default_height_pending);

    PanelBoundsPersistenceController::record_change(
        &mut state,
        3,
        PanelBoundsChange::Resized(PhysicalSize::new(480, 1_500)),
    );
    assert!(
        PanelBoundsPersistenceController::take_dirty_work(&mut state)
            .expect("user resize should schedule persistence")
            .persist
    );
    assert_eq!(state.unpersisted_default_height, None);
}

#[test]
fn panel_reset_at_default_height_persists_the_next_user_resize() {
    let mut state = PanelBoundsPersistenceState {
        latest: Some(PanelBoundsSample {
            position: PhysicalPosition::new(600, 300),
            position_scale_factor: 2.0,
            size: PhysicalSize::new(480, 1_424),
            size_scale_factor: 2.0,
            current_scale_factor: 2.0,
        }),
        unpersisted_default_height: Some(712.0),
        default_height_pending: false,
        session: 4,
        active: true,
        ..PanelBoundsPersistenceState::default()
    };

    PanelBoundsPersistenceController::record_change(
        &mut state,
        4,
        PanelBoundsChange::Resized(PhysicalSize::new(480, 1_500)),
    );

    assert!(
        PanelBoundsPersistenceController::take_dirty_work(&mut state)
            .expect("user resize should schedule persistence")
            .persist
    );
    assert_eq!(state.unpersisted_default_height, None);
}

#[test]
fn panel_tray_companion_flag_marks_only_windows_we_hid() {
    let hidden = AtomicBool::new(false);

    // 보이는 창만 감추고 표식을 남긴다
    assert!(hide_panel_with_main_transition(&hidden, true, || Ok(())).unwrap());
    assert!(hidden.load(Ordering::SeqCst));

    // 이미 숨은 창은 건드리지 않고 표식도 그대로
    assert!(!hide_panel_with_main_transition(&hidden, false, || panic!(
        "hidden window must not be hidden again"
    ))
    .unwrap());
    assert!(hidden.load(Ordering::SeqCst));

    // 복원에 성공하면 표식이 지워진다
    assert!(restore_panel_with_main_transition(&hidden, || Ok(())).unwrap());
    assert!(!hidden.load(Ordering::SeqCst));

    // 우리가 감추지 않은 창은 복원 대상이 아니다
    assert!(!restore_panel_with_main_transition(&hidden, || panic!(
        "untouched window must not be shown"
    ))
    .unwrap());
}

#[test]
fn panel_tray_companion_flag_survives_failed_window_calls() {
    let hidden = AtomicBool::new(false);

    // hide 실패는 표식을 세우지 않는다 - 세우면 남의 창을 깨운다
    assert!(
        hide_panel_with_main_transition(&hidden, true, || Err(anyhow::anyhow!("hide unavailable")))
            .is_err()
    );
    assert!(!hidden.load(Ordering::SeqCst));

    hide_panel_with_main_transition(&hidden, true, || Ok(())).unwrap();
    // show 실패는 표식을 되살린다
    assert!(
        restore_panel_with_main_transition(&hidden, || Err(anyhow::anyhow!("show unavailable")))
            .is_err()
    );
    assert!(hidden.load(Ordering::SeqCst));

    // 창이 파괴되면 동행 복원 대상도 사라진다
    assert!(drop_panel_hidden_with_main(&hidden));
    assert!(!hidden.load(Ordering::SeqCst));
    assert!(!drop_panel_hidden_with_main(&hidden));
}

#[test]
fn panel_bounds_deactivate_ignores_a_stale_session_token() {
    let sample = PanelBoundsSample {
        position: PhysicalPosition::new(600, 300),
        position_scale_factor: 2.0,
        size: PhysicalSize::new(480, 1_000),
        size_scale_factor: 2.0,
        current_scale_factor: 2.0,
    };
    let mut state = PanelBoundsPersistenceState {
        latest: Some(sample),
        applied_max_height: Some(900.0),
        session: 2,
        generation: 7,
        dirty: true,
        active: true,
        ..PanelBoundsPersistenceState::default()
    };

    assert!(!PanelBoundsPersistenceController::deactivate_state(
        &mut state, 1,
    ));
    assert!(state.active);
    assert_eq!(state.session, 2);
    assert_eq!(state.generation, 7);
    assert!(state.dirty);
    assert_eq!(state.latest, Some(sample));
    assert_eq!(state.applied_max_height, Some(900.0));
}

#[test]
fn panel_bounds_record_event_ignores_a_stale_session_token() {
    let sample = PanelBoundsSample {
        position: PhysicalPosition::new(600, 300),
        position_scale_factor: 2.0,
        size: PhysicalSize::new(480, 1_000),
        size_scale_factor: 2.0,
        current_scale_factor: 2.0,
    };
    let mut state = PanelBoundsPersistenceState {
        latest: Some(sample),
        session: 2,
        generation: 7,
        active: true,
        ..PanelBoundsPersistenceState::default()
    };

    assert!(!PanelBoundsPersistenceController::record_change(
        &mut state,
        1,
        PanelBoundsChange::Moved(PhysicalPosition::new(800, 400)),
    ));
    assert_eq!(state.latest, Some(sample));
    assert_eq!(state.generation, 7);
    assert!(!state.dirty);
    assert!(!state.worker_running);
}

#[test]
fn panel_bounds_flush_keeps_event_after_sample_that_old_code_overwrote() {
    let initial = PanelBoundsSample {
        position: PhysicalPosition::new(600, 300),
        position_scale_factor: 2.0,
        size: PhysicalSize::new(480, 1_000),
        size_scale_factor: 2.0,
        current_scale_factor: 2.0,
    };
    let state = Mutex::new(PanelBoundsPersistenceState {
        latest: Some(initial),
        session: 4,
        active: true,
        ..PanelBoundsPersistenceState::default()
    });
    let generation_before_sample = state.lock().generation;
    let sampled = state.lock().latest.unwrap();

    assert!(PanelBoundsPersistenceController::record_change(
        &mut state.lock(),
        4,
        PanelBoundsChange::Moved(PhysicalPosition::new(800, 400)),
    ));
    let expected = state.lock().latest.unwrap();
    let mut persisted = Vec::new();

    PanelBoundsPersistenceController::flush_samples(
        &state,
        generation_before_sample,
        Ok(sampled),
        |sample| {
            persisted.push(sample);
            Ok(())
        },
    )
    .unwrap();

    assert_eq!(persisted, vec![expected]);
    let state = state.lock();
    assert_eq!(state.latest, Some(expected));
    assert!(!state.dirty);
}

#[test]
fn panel_bounds_flush_and_event_interleave_without_loss_or_duplicate_sample() {
    let initial = PanelBoundsSample {
        position: PhysicalPosition::new(600, 300),
        position_scale_factor: 2.0,
        size: PhysicalSize::new(480, 1_000),
        size_scale_factor: 2.0,
        current_scale_factor: 2.0,
    };
    let state = Mutex::new(PanelBoundsPersistenceState {
        latest: Some(initial),
        session: 4,
        active: true,
        ..PanelBoundsPersistenceState::default()
    });
    let mut persisted = Vec::new();

    PanelBoundsPersistenceController::flush_samples(&state, 0, Ok(initial), |sample| {
        persisted.push(sample);
        if persisted.len() == 1 {
            assert!(PanelBoundsPersistenceController::record_change(
                &mut state.lock(),
                4,
                PanelBoundsChange::Moved(PhysicalPosition::new(800, 400)),
            ));
        }
        Ok(())
    })
    .unwrap();

    let mut expected_latest = initial;
    apply_panel_bounds_change(
        &mut expected_latest,
        PanelBoundsChange::Moved(PhysicalPosition::new(800, 400)),
    );
    assert_eq!(persisted, vec![initial, expected_latest]);
    let state = state.lock();
    assert_eq!(state.latest, Some(expected_latest));
    assert!(!state.dirty);
}

#[test]
fn panel_bounds_flush_uses_latest_when_window_read_fails() {
    let latest = PanelBoundsSample {
        position: PhysicalPosition::new(600, 300),
        position_scale_factor: 2.0,
        size: PhysicalSize::new(480, 1_000),
        size_scale_factor: 2.0,
        current_scale_factor: 2.0,
    };
    let state = Mutex::new(PanelBoundsPersistenceState {
        latest: Some(latest),
        session: 5,
        active: true,
        ..PanelBoundsPersistenceState::default()
    });
    let mut persisted = Vec::new();

    PanelBoundsPersistenceController::flush_samples(
        &state,
        0,
        Err(anyhow::anyhow!("window bounds unavailable")),
        |sample| {
            persisted.push(sample);
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(persisted, vec![latest]);

    let empty = Mutex::new(PanelBoundsPersistenceState::default());
    assert!(PanelBoundsPersistenceController::flush_samples(
        &empty,
        0,
        Err(anyhow::anyhow!("window bounds unavailable")),
        |_| panic!("missing bounds must not be persisted"),
    )
    .is_err());
}

#[test]
fn panel_bounds_flush_failure_restores_dirty_state() {
    let sample = PanelBoundsSample {
        position: PhysicalPosition::new(600, 300),
        position_scale_factor: 2.0,
        size: PhysicalSize::new(480, 1_000),
        size_scale_factor: 2.0,
        current_scale_factor: 2.0,
    };
    let state = Mutex::new(PanelBoundsPersistenceState {
        latest: Some(sample),
        session: 6,
        active: true,
        ..PanelBoundsPersistenceState::default()
    });

    assert!(
        PanelBoundsPersistenceController::flush_samples(&state, 0, Ok(sample), |_| Err(
            anyhow::anyhow!("disk unavailable")
        ),)
        .is_err()
    );
    assert!(state.lock().dirty);
}

#[test]
fn panel_bounds_flush_preserves_cleared_default_height() {
    let sample = PanelBoundsSample {
        position: PhysicalPosition::new(600, 300),
        position_scale_factor: 2.0,
        size: PhysicalSize::new(480, 1_424),
        size_scale_factor: 2.0,
        current_scale_factor: 2.0,
    };
    let state = Mutex::new(PanelBoundsPersistenceState {
        latest: Some(sample),
        unpersisted_default_height: Some(712.0),
        default_height_pending: false,
        session: 7,
        active: true,
        ..PanelBoundsPersistenceState::default()
    });

    let persisted = PanelBoundsPersistenceController::flush_samples(&state, 0, Ok(sample), |_| {
        panic!("default height must remain cleared")
    })
    .unwrap();

    assert!(!persisted);
    assert_eq!(state.lock().unpersisted_default_height, Some(712.0));
}

// 기동 복원 회귀: 방금 배치된 메인 창의 논리 좌표를 받으면 세로 중앙이 맞는다
#[test]
fn panel_restore_centers_on_the_freshly_placed_main_window() {
    let monitors = MonitorData {
        specs: vec![work_area_spec(0.0, 30.0, 2_560.0, 1_358.0)],
        primary_index: Some(0),
    };
    let main = LogicalRect {
        x: 829.0,
        y: 465.0,
        width: 902.0,
        height: 488.0,
    };
    let layout = resolve_panel_window_layout(
        Some(PanelBounds {
            x: 2_205.0,
            y: 185.0,
            height: 712.0,
        }),
        Some(main),
        &monitors,
        None,
    );

    assert_eq!(layout.height, 712.0);
    let position = layout.position.expect("panel should be placed beside main");
    assert_eq!(position.x, 1_747.0);
    assert_eq!(position.y, 353.0);
}

#[test]
fn panel_layout_leaves_placement_to_the_os_without_monitor_data() {
    let monitors = MonitorData {
        specs: Vec::new(),
        primary_index: None,
    };
    let layout = resolve_panel_window_layout(
        None,
        Some(main_rect(300.0, 100.0, 900.0, 500.0)),
        &monitors,
        None,
    );

    // 메인 좌표는 있어도 기준 화면을 못 고르면 붙일 자리를 계산할 수 없다
    assert!(layout.position.is_none());
    assert_eq!(layout.height, PANEL_INITIAL_HEIGHT);
}

#[test]
fn panel_follows_the_monitor_that_holds_the_main_window() {
    let monitors = MonitorData {
        specs: vec![
            work_area_spec(0.0, 0.0, 1_920.0, 1_080.0),
            work_area_spec(1_920.0, 0.0, 1_280.0, 800.0),
        ],
        primary_index: Some(0),
    };
    let layout = resolve_panel_window_layout(
        Some(PanelBounds {
            x: 31.0,
            y: 47.0,
            height: 800.0,
        }),
        Some(main_rect(2_000.0, 100.0, 900.0, 500.0)),
        &monitors,
        None,
    );

    // 주 모니터가 아니라 메인 창이 놓인 보조 모니터의 한계를 따른다
    assert_eq!(layout.max_height, 720.0);
    assert_eq!(layout.height, 720.0);
    let position = layout.position.expect("panel should be placed beside main");
    assert_eq!(position.x, 2_000.0 + 900.0 + PANEL_BESIDE_GAP);
    assert_eq!(position.y, 0.0);
}

#[test]
fn persisted_panel_height_clamps_and_position_waits_for_main_geometry() {
    let monitors = MonitorData {
        specs: Vec::new(),
        primary_index: None,
    };
    let layout = resolve_panel_window_layout(
        Some(PanelBounds {
            x: 31.0,
            y: 47.0,
            height: 200.0,
        }),
        None,
        &monitors,
        None,
    );

    assert_eq!(layout.height, PANEL_MIN_HEIGHT);
    // 메인 좌표를 못 읽으면 OS 기본 배치 - 저장된 x/y는 더 이상 위치가 아니다
    assert!(layout.position.is_none());
}

#[test]
fn panel_monitor_constraint_changes_only_for_a_new_valid_height() {
    assert_eq!(changed_panel_max_height(Some(900.0), 900.0), None);
    assert_eq!(changed_panel_max_height(Some(900.0), 900.4), None);
    assert_eq!(changed_panel_max_height(Some(900.0), 720.0), Some(720.0));
    assert_eq!(changed_panel_max_height(None, 720.0), Some(720.0));
    assert_eq!(changed_panel_max_height(Some(900.0), f64::NAN), None);
    assert_eq!(changed_panel_max_height(Some(900.0), 0.0), None);
}

#[derive(Default)]
struct TestPanelVisibilityEmitter {
    events: Mutex<Vec<PanelVisibilityPayload>>,
}

impl PanelVisibilityEventEmitter for TestPanelVisibilityEmitter {
    fn emit_panel_visibility(&self, payload: PanelVisibilityPayload) -> anyhow::Result<()> {
        self.events.lock().push(payload);
        Ok(())
    }
}

#[test]
fn panel_visibility_emits_each_open_state_transition_once() {
    let visible = AtomicBool::new(false);
    let emitter = TestPanelVisibilityEmitter::default();

    publish_panel_visibility_transition(&visible, &emitter, true, None).unwrap();
    publish_panel_visibility_transition(&visible, &emitter, true, None).unwrap();
    publish_panel_visibility_transition(
        &visible,
        &emitter,
        false,
        Some(PanelVisibilityReason::Closed),
    )
    .unwrap();

    assert_eq!(
        *emitter.events.lock(),
        vec![
            PanelVisibilityPayload {
                visible: true,
                reason: None,
            },
            PanelVisibilityPayload {
                visible: false,
                reason: Some(PanelVisibilityReason::Closed),
            }
        ]
    );
}

#[test]
fn panel_visibility_wire_distinguishes_closed_and_destroyed() {
    for (reason, expected) in [
        (PanelVisibilityReason::Closed, "closed"),
        (PanelVisibilityReason::Destroyed, "destroyed"),
    ] {
        let payload = PanelVisibilityPayload {
            visible: false,
            reason: Some(reason),
        };
        assert_eq!(
            serde_json::to_value(payload).unwrap(),
            serde_json::json!({ "visible": false, "reason": expected })
        );
    }

    assert_eq!(
        serde_json::to_value(PanelVisibilityPayload {
            visible: true,
            reason: None,
        })
        .unwrap(),
        serde_json::json!({ "visible": true })
    );
}

#[test]
fn panel_command_close_reason_wins_if_destroyed_event_arrives_first() {
    let visible = AtomicBool::new(true);
    let pending_reason = Mutex::new(Some(PanelVisibilityReason::Closed));
    let emitter = TestPanelVisibilityEmitter::default();

    publish_panel_hidden_transition(
        &visible,
        &pending_reason,
        &emitter,
        PanelVisibilityReason::Destroyed,
    )
    .unwrap();
    publish_panel_hidden_transition(
        &visible,
        &pending_reason,
        &emitter,
        PanelVisibilityReason::Destroyed,
    )
    .unwrap();

    assert_eq!(
        *emitter.events.lock(),
        vec![PanelVisibilityPayload {
            visible: false,
            reason: Some(PanelVisibilityReason::Closed),
        }]
    );
}

#[test]
fn panel_close_request_payload_uses_camel_case_request_id() {
    let payload = PanelCloseRequestedPayload {
        request_id: "close-1".to_string(),
    };

    assert_eq!(
        serde_json::to_value(payload).unwrap(),
        serde_json::json!({ "requestId": "close-1" })
    );
}

#[test]
fn panel_close_ack_cancels_timeout_fallback() {
    let state = Mutex::new(PanelCloseRequestState::Idle);
    let fallback_calls = Mutex::new(0usize);

    assert!(begin_panel_close_request(&state, "close-1"));
    assert!(acknowledge_panel_close_request(&state, "close-1"));
    assert!(!run_panel_close_timeout(&state, "close-1", || {
        *fallback_calls.lock() += 1;
        Ok(())
    })
    .unwrap());

    assert_eq!(*fallback_calls.lock(), 0);
    assert_eq!(*state.lock(), PanelCloseRequestState::Idle);
}

#[test]
fn panel_close_timeout_is_single_flight_for_repeated_clicks() {
    let state = Mutex::new(PanelCloseRequestState::Idle);
    let fallback_calls = Mutex::new(0usize);

    assert!(begin_panel_close_request(&state, "close-1"));
    assert!(!begin_panel_close_request(&state, "close-2"));
    assert!(!acknowledge_panel_close_request(&state, "close-2"));
    assert!(run_panel_close_timeout(&state, "close-1", || {
        *fallback_calls.lock() += 1;
        Ok(())
    })
    .unwrap());
    assert!(!run_panel_close_timeout(&state, "close-1", || {
        *fallback_calls.lock() += 1;
        Ok(())
    })
    .unwrap());

    assert_eq!(*fallback_calls.lock(), 1);
    assert_eq!(*state.lock(), PanelCloseRequestState::Idle);
}

#[test]
fn frontend_lifecycle_targets_skip_the_opener_hosted_panel() {
    // 패널 창은 메인 문서가 그리는 자식 - 자체 렌더러가 없어 ack를 낼 수 없다
    let open_labels = ["main", OVERLAY_LABEL, PANEL_LABEL];
    let targets =
        collect_frontend_lifecycle_targets(|label| open_labels.contains(&label).then_some(()));
    let labels = targets
        .into_iter()
        .map(|(label, ())| label)
        .collect::<Vec<_>>();

    assert_eq!(labels, vec!["main".to_string(), OVERLAY_LABEL.to_string()]);
}

#[test]
fn overlay_only_flush_failure_restores_every_original_handshake_target() {
    let target_windows = ["main", OVERLAY_LABEL]
        .into_iter()
        .map(str::to_string)
        .collect::<HashSet<_>>();
    let mut slot = Some(EditorFlushHandshake {
        id: "handshake-1".to_string(),
        completion: EditorFlushCompletion::Lifecycle(FrontendLifecycleAction::Quit),
        target_windows: target_windows.clone(),
        pending_windows: target_windows,
    });
    let active = slot.as_mut().expect("handshake should be active");
    assert!(active.pending_windows.remove("main"));
    assert_eq!(
        active.pending_windows,
        HashSet::from([OVERLAY_LABEL.to_string()])
    );

    let canceled = take_editor_flush_handshake(&mut slot, "handshake-1")
        .expect("overlay failure should cancel the handshake");

    assert_eq!(
        frontend_lifecycle_restore_labels(&canceled.target_windows),
        vec!["main", OVERLAY_LABEL]
    );
    assert!(slot.is_none());
}

#[test]
fn history_flush_request_keeps_existing_event_contract() {
    let payload = EditorFlushRequest {
        handshake_id: "history-1".to_string(),
        action: FrontendFlushAction::History,
    };

    assert_eq!(
        serde_json::to_value(payload).unwrap(),
        serde_json::json!({
            "handshakeId": "history-1",
            "action": "history"
        })
    );
}

#[test]
fn history_flush_completes_only_after_every_window_ack() {
    let (sender, mut receiver) = tokio::sync::oneshot::channel();
    let target_windows = ["main", PANEL_LABEL]
        .into_iter()
        .map(str::to_string)
        .collect::<HashSet<_>>();
    let mut slot = Some(EditorFlushHandshake {
        id: "history-1".to_string(),
        completion: EditorFlushCompletion::History {
            operation_id: "00000000-0000-0000-0000-000000000001".to_string(),
            sender: Some(sender),
            phase: FrontendHistoryFlushPhase::Collecting,
            barrier: None,
        },
        target_windows: target_windows.clone(),
        pending_windows: target_windows,
    });
    let gate = Arc::new(crate::state::history::HistoryAdmissionGate::default());

    assert!(acknowledge_editor_flush_handshake(&mut slot, "history-1", "main", &gate,).is_none());
    assert!(matches!(
        receiver.try_recv(),
        Err(tokio::sync::oneshot::error::TryRecvError::Empty)
    ));

    let closing = acknowledge_editor_flush_handshake(&mut slot, "history-1", PANEL_LABEL, &gate)
        .expect("last window should begin gate close");
    assert!(matches!(
        closing,
        EditorFlushAcknowledge::HistoryClosing { .. }
    ));
    assert!(gate.is_closed());
    assert!(slot.as_ref().is_some_and(|active| {
        active.completion.history_phase() == Some(FrontendHistoryFlushPhase::Closing)
    }));
    assert!(matches!(
        receiver.try_recv(),
        Err(tokio::sync::oneshot::error::TryRecvError::Empty)
    ));
}

#[test]
fn acknowledged_history_window_blocks_new_mutations_while_other_window_drains() {
    let (sender, _receiver) = tokio::sync::oneshot::channel();
    let targets = HashSet::from(["main".to_string(), PANEL_LABEL.to_string()]);
    let mut slot = Some(EditorFlushHandshake {
        id: "history-1".to_string(),
        completion: EditorFlushCompletion::History {
            operation_id: "00000000-0000-0000-0000-000000000001".to_string(),
            sender: Some(sender),
            phase: FrontendHistoryFlushPhase::Collecting,
            barrier: None,
        },
        target_windows: targets.clone(),
        pending_windows: targets,
    });

    let gate = Arc::new(crate::state::history::HistoryAdmissionGate::default());
    assert!(acknowledge_editor_flush_handshake(&mut slot, "history-1", "main", &gate,).is_none());
    assert!(frontend_history_mutation_blocked(&slot, "main"));
    assert!(!frontend_history_mutation_blocked(&slot, PANEL_LABEL));
}

#[test]
fn history_flush_ready_releases_gate_before_frontend_lock() {
    let gate = Arc::new(crate::state::history::HistoryAdmissionGate::default());
    let barrier = gate.close("00000000-0000-0000-0000-000000000001").unwrap();
    let release_count = Arc::new(AtomicUsize::new(0));
    let release_count_for_guard = Arc::clone(&release_count);
    let mut ready = FrontendHistoryFlushReady {
        barrier: Some(barrier),
        complete: Some(Box::new(move || {
            release_count_for_guard.fetch_add(1, Ordering::SeqCst);
        })),
    };

    let barrier = ready.take_barrier();
    assert!(gate.is_closed());
    drop(barrier);
    assert!(!gate.is_closed());
    assert_eq!(release_count.load(Ordering::SeqCst), 0);

    drop(ready);
    assert_eq!(release_count.load(Ordering::SeqCst), 1);
}

#[test]
fn lifecycle_flush_interrupts_history_but_history_cannot_replace_lifecycle() {
    let (history_sender, mut history_receiver) = tokio::sync::oneshot::channel();
    let mut slot = Some(EditorFlushHandshake {
        id: "history-1".to_string(),
        completion: EditorFlushCompletion::History {
            operation_id: "00000000-0000-0000-0000-000000000001".to_string(),
            sender: Some(history_sender),
            phase: FrontendHistoryFlushPhase::Collecting,
            barrier: None,
        },
        target_windows: HashSet::from(["main".to_string()]),
        pending_windows: HashSet::from(["main".to_string()]),
    });
    let lifecycle = EditorFlushHandshake {
        id: "quit-1".to_string(),
        completion: EditorFlushCompletion::Lifecycle(FrontendLifecycleAction::Quit),
        target_windows: HashSet::from(["main".to_string()]),
        pending_windows: HashSet::from(["main".to_string()]),
    };

    let LifecycleHandshakeInstall::InterruptedHistory(interrupted) =
        install_lifecycle_handshake(&mut slot, lifecycle)
    else {
        panic!("lifecycle should replace history");
    };
    let interrupted = *interrupted;
    let EditorFlushCompletion::History { sender, .. } = interrupted.completion else {
        panic!("interrupted completion should be history");
    };
    assert!(sender
        .expect("history sender should still be present")
        .send(Err(HISTORY_FRONTEND_FLUSH_INTERRUPTED.to_string()))
        .is_ok());
    assert!(matches!(
        history_receiver.try_recv().unwrap(),
        Err(error) if error == HISTORY_FRONTEND_FLUSH_INTERRUPTED
    ));

    let (next_history_sender, _next_history_receiver) = tokio::sync::oneshot::channel();
    let next_history = EditorFlushHandshake {
        id: "history-2".to_string(),
        completion: EditorFlushCompletion::History {
            operation_id: "00000000-0000-0000-0000-000000000002".to_string(),
            sender: Some(next_history_sender),
            phase: FrontendHistoryFlushPhase::Collecting,
            barrier: None,
        },
        target_windows: HashSet::from(["main".to_string()]),
        pending_windows: HashSet::from(["main".to_string()]),
    };
    assert!(!install_history_handshake(&mut slot, next_history));
    assert!(slot
        .as_ref()
        .is_some_and(|active| active.completion.is_lifecycle()));
}

#[test]
fn closing_history_can_time_out_and_reopen_the_gate() {
    let (sender, _receiver) = tokio::sync::oneshot::channel();
    let gate = Arc::new(crate::state::history::HistoryAdmissionGate::default());
    let mut slot = Some(EditorFlushHandshake {
        id: "history-closing".to_string(),
        completion: EditorFlushCompletion::History {
            operation_id: "00000000-0000-0000-0000-000000000003".to_string(),
            sender: Some(sender),
            phase: FrontendHistoryFlushPhase::Collecting,
            barrier: None,
        },
        target_windows: HashSet::from(["main".to_string()]),
        pending_windows: HashSet::from(["main".to_string()]),
    });

    assert!(matches!(
        acknowledge_editor_flush_handshake(&mut slot, "history-closing", "main", &gate,),
        Some(EditorFlushAcknowledge::HistoryClosing { .. })
    ));
    assert!(gate.is_closed());

    let timed_out = take_cancelable_editor_flush_handshake(&mut slot, "history-closing")
        .expect("closing history should remain cancelable");
    drop(timed_out);

    assert!(!gate.is_closed());
    assert!(slot.is_none());
}

#[test]
fn running_history_defers_lifecycle_and_blocks_new_history() {
    let mut slot = Some(EditorFlushHandshake {
        id: "history-running".to_string(),
        completion: EditorFlushCompletion::History {
            operation_id: "00000000-0000-0000-0000-000000000004".to_string(),
            sender: None,
            phase: FrontendHistoryFlushPhase::Running,
            barrier: None,
        },
        target_windows: HashSet::from(["main".to_string()]),
        pending_windows: HashSet::new(),
    });
    let lifecycle = EditorFlushHandshake {
        id: "quit-deferred".to_string(),
        completion: EditorFlushCompletion::Lifecycle(FrontendLifecycleAction::Quit),
        target_windows: HashSet::from(["main".to_string()]),
        pending_windows: HashSet::from(["main".to_string()]),
    };

    assert!(matches!(
        install_lifecycle_handshake(&mut slot, lifecycle),
        LifecycleHandshakeInstall::DeferredUntilHistoryComplete
    ));
    assert!(take_cancelable_editor_flush_handshake(&mut slot, "history-running").is_none());

    let (sender, _receiver) = tokio::sync::oneshot::channel();
    let next_history = EditorFlushHandshake {
        id: "history-next".to_string(),
        completion: EditorFlushCompletion::History {
            operation_id: "00000000-0000-0000-0000-000000000005".to_string(),
            sender: Some(sender),
            phase: FrontendHistoryFlushPhase::Collecting,
            barrier: None,
        },
        target_windows: HashSet::from(["main".to_string()]),
        pending_windows: HashSet::from(["main".to_string()]),
    };
    assert!(!install_history_handshake(&mut slot, next_history));
    assert!(take_cancelable_editor_flush_handshake(&mut slot, "history-old").is_none());
}

#[test]
fn bootstrap_keyboard_state_includes_mode_and_registered_event_key_names() {
    let manager = KeyboardManager::new(
        HashMap::from([("4key".to_string(), vec!["KeyD".into()])]),
        "4key",
    );

    assert!(manager.register_key_down("4key", "KeyD"));
    assert_eq!(
        bootstrap_keyboard_state(&manager),
        ("4key".to_string(), vec!["KeyD".to_string()])
    );
}

#[test]
fn event_age_uses_daemon_wall_clock_timestamp_when_sane() {
    assert_eq!(
        resolve_event_age_ms(Some(1_000.0), Some(1_025.5), 3.0),
        25.5
    );
}

#[test]
fn event_age_falls_back_for_invalid_wall_clock_delta() {
    for input_ts_ms in [Some(2_000.0), Some(f64::NAN), Some(-f64::INFINITY)] {
        assert_eq!(resolve_event_age_ms(input_ts_ms, Some(1_000.0), 7.0), 7.0);
    }
    assert_eq!(
        resolve_event_age_ms(Some(1_000.0), Some(11_001.0), 7.0),
        7.0
    );
    assert_eq!(resolve_event_age_ms(None, Some(1_000.0), 7.0), 7.0);
}

#[test]
fn key_state_payload_exposes_hold_duration_on_up_only() {
    let down = serde_json::to_value(key_state_payload(
        "A",
        "DOWN",
        "4key",
        2.0,
        true,
        Some(15.0),
    ))
    .unwrap();
    let up =
        serde_json::to_value(key_state_payload("A", "UP", "4key", 3.0, false, Some(15.0))).unwrap();
    let unmatched_up =
        serde_json::to_value(key_state_payload("A", "UP", "4key", 3.0, false, None)).unwrap();

    assert!(down.get("holdDurationMs").is_none());
    assert_eq!(up["holdDurationMs"], serde_json::json!(15.0));
    assert!(unmatched_up.get("holdDurationMs").is_none());
}

#[test]
fn canonical_hold_duration_requires_matching_transition_source() {
    assert_eq!(canonical_hold_duration_ms(true, Some(15.0)), Some(15.0));
    assert_eq!(canonical_hold_duration_ms(false, Some(15.0)), None);
    assert_eq!(canonical_hold_duration_ms(true, None), None);
}

#[test]
fn keyboard_recovery_backoff_grows_and_stops_at_the_limit() {
    let mut current_attempt = 0;
    for (index, delay_ms) in KEYBOARD_RECOVERY_DELAYS_MS.into_iter().enumerate() {
        let plan = next_keyboard_recovery_plan(current_attempt, Duration::ZERO).unwrap();
        assert_eq!(plan.attempt, index + 1);
        assert_eq!(plan.delay, Duration::from_millis(delay_ms));
        current_attempt = plan.attempt;
    }

    assert!(next_keyboard_recovery_plan(current_attempt, Duration::ZERO).is_none());
}

#[test]
fn stable_keyboard_daemon_resets_the_recovery_budget() {
    let plan = next_keyboard_recovery_plan(5, KEYBOARD_DAEMON_STABLE_RUNTIME).unwrap();

    assert_eq!(plan.attempt, 1);
    assert_eq!(plan.delay, Duration::from_millis(250));
}

#[test]
fn keyboard_recovery_guard_rejects_teardown_and_stale_tasks() {
    assert!(should_recover_keyboard_daemon(false, 7, Some(7), 7));
    assert!(!should_recover_keyboard_daemon(true, 7, Some(7), 7));
    assert!(!should_recover_keyboard_daemon(false, 8, Some(7), 7));
    assert!(!should_recover_keyboard_daemon(false, 7, Some(8), 7));
    assert!(!should_recover_keyboard_daemon(false, 7, None, 7));
}

#[test]
fn startup_authorizes_global_and_tab_css_paths_even_when_disabled() {
    let mut state = AppStoreData {
        use_custom_css: false,
        custom_css: CustomCss {
            path: Some("/tmp/global.css".to_string()),
            content: String::new(),
        },
        ..AppStoreData::default()
    };
    state.tab_css_overrides.insert(
        "4key".to_string(),
        TabCss {
            path: Some("/tmp/tab.css".to_string()),
            content: String::new(),
            enabled: false,
        },
    );

    let authorized = collect_authorized_css_paths(&state);

    assert!(authorized.contains(&path_identity_key(Path::new("/tmp/global.css"))));
    assert!(authorized.contains(&path_identity_key(Path::new("/tmp/tab.css"))));
    assert_eq!(global_css_watch_path(&state), None);
}

#[test]
fn overlay_dimension_clamp_covers_tall_track_layouts() {
    // 트랙 높이 상한(2000) + 키 영역 + 패딩 조합은 이전 상한 2000을 넘어 잘렸음
    assert_eq!(clamp_overlay_dimension(2400.0), 2400.0);
    assert_eq!(clamp_overlay_dimension(4096.0), 4096.0);
    assert_eq!(clamp_overlay_dimension(5000.0), 4096.0);
    assert_eq!(clamp_overlay_dimension(10.0), 100.0);
    assert_eq!(clamp_overlay_dimension(705.4), 705.0);
}

/// physical 3840x2160 단일 모니터 (logical 폭/높이는 scale로 나눈 값)
fn reset_test_monitors(scale: f64) -> MonitorData {
    MonitorData {
        specs: vec![MonitorSpec {
            logical_origin_x: 0.0,
            logical_origin_y: 0.0,
            logical_width: 3_840.0 / scale,
            logical_height: 2_160.0 / scale,
            physical_origin_x: 0.0,
            physical_origin_y: 0.0,
            physical_width: 3_840.0,
            physical_height: 2_160.0,
            scale_factor: scale,
        }],
        primary_index: Some(0),
    }
}

#[test]
fn overlay_reset_falls_back_to_stored_rect_when_window_is_absent() {
    // 오버레이를 끈 채 재시작하면 창이 없다 - 저장된 위치가 유일한 근거
    let monitors = reset_test_monitors(1.0);
    let stored = OverlayBounds {
        x: -3200.0,
        y: 980.0,
        width: 1240.0,
        height: 620.0,
    };
    let (position, size) = overlay_reset_fallback_rect(Some(&stored), true, &monitors);
    assert_eq!((position.x, position.y), (-3200.0, 980.0));
    assert_eq!((size.width, size.height), (1240.0, 620.0));
}

#[test]
fn overlay_reset_converts_legacy_physical_stored_rect() {
    // overlay_bounds_are_logical은 serde(default) = false라 구버전 store는 physical px다.
    // 이를 logical로 오인하면 겹침 판정이 배로 부풀어 엉뚱한 모니터를 고르고,
    // defer_overlay_bounds가 마커를 true로 굳혀 변환 기회가 영영 사라진다
    let monitors = reset_test_monitors(2.0);
    let legacy = OverlayBounds {
        x: 400.0,
        y: 200.0,
        width: 1720.0,
        height: 640.0,
    };

    let (position, size) = overlay_reset_fallback_rect(Some(&legacy), false, &monitors);
    assert_eq!((position.x, position.y), (200.0, 100.0));
    assert_eq!((size.width, size.height), (860.0, 320.0));

    // 마커가 true면 이미 환산된 값이므로 그대로 쓴다
    let (position, size) = overlay_reset_fallback_rect(Some(&legacy), true, &monitors);
    assert_eq!((position.x, position.y), (400.0, 200.0));
    assert_eq!((size.width, size.height), (1720.0, 640.0));
}

#[test]
fn overlay_reset_defaults_when_legacy_rect_cannot_be_converted() {
    // 모니터 정보를 못 얻으면 physical 값을 logical로 오인하느니 기본 크기가 안전하다
    let monitors = MonitorData {
        specs: Vec::new(),
        primary_index: None,
    };
    let legacy = OverlayBounds {
        x: 400.0,
        y: 200.0,
        width: 1720.0,
        height: 640.0,
    };
    let (position, size) = overlay_reset_fallback_rect(Some(&legacy), false, &monitors);
    assert_eq!((position.x, position.y), (0.0, 0.0));
    assert_eq!(
        (size.width, size.height),
        (DEFAULT_OVERLAY_WIDTH, DEFAULT_OVERLAY_HEIGHT)
    );
}

#[test]
fn stored_bounds_normalization_respects_the_logical_marker() {
    // resize_overlay의 initializing 분기도 같은 정규화를 거친다.
    // 마커를 무시하고 physical 좌표를 쓰면 defer_overlay_bounds가 마커를
    // true로 굳혀 좌표가 영구 고착된다
    let monitors = reset_test_monitors(2.0);
    let stored = OverlayBounds {
        x: 400.0,
        y: 200.0,
        width: 1720.0,
        height: 640.0,
    };

    let converted = normalize_stored_overlay_bounds(Some(&stored), false, &monitors, None)
        .expect("physical 좌표는 환산되어야 한다");
    assert_eq!((converted.x, converted.y), (200.0, 100.0));
    assert_eq!((converted.width, converted.height), (860.0, 320.0));

    let passthrough = normalize_stored_overlay_bounds(Some(&stored), true, &monitors, None)
        .expect("logical 좌표는 그대로 쓴다");
    assert_eq!((passthrough.x, passthrough.y), (400.0, 200.0));

    // 환산 근거가 없으면 None - 호출부가 창의 실제 위치를 유지하도록
    let blind = MonitorData::default();
    assert!(normalize_stored_overlay_bounds(Some(&stored), false, &blind, None).is_none());
    // 모니터가 없어도 창 scale이 살아 있으면 그것을 근거로 환산한다
    let by_window_scale = normalize_stored_overlay_bounds(Some(&stored), false, &blind, Some(2.0))
        .expect("창 scale이 2차 환산 근거가 되어야 한다");
    assert_eq!((by_window_scale.x, by_window_scale.y), (200.0, 100.0));
    assert_eq!(
        (by_window_scale.width, by_window_scale.height),
        (860.0, 320.0)
    );
    // 창 scale도 병리적이면 근거가 못 된다
    assert!(normalize_stored_overlay_bounds(Some(&stored), false, &blind, Some(0.0)).is_none());
    assert!(
        normalize_stored_overlay_bounds(Some(&stored), false, &blind, Some(f64::NAN)).is_none()
    );

    // 깨진 값은 마커와 무관하게 거른다
    let broken = OverlayBounds {
        x: f64::NAN,
        y: 20.0,
        width: 800.0,
        height: 300.0,
    };
    assert!(normalize_stored_overlay_bounds(Some(&broken), true, &monitors, None).is_none());
    assert!(normalize_stored_overlay_bounds(None, true, &monitors, None).is_none());
}

#[test]
fn monitor_data_is_gathered_only_for_unconverted_stored_bounds() {
    // 이 판단이 뒤집히면 initializing 분기가 환산 없이 physical 좌표를 써서
    // M1이 그대로 재발한다. 순수 정규화 테스트만으로는 잡히지 않는 배선이다
    let stored = OverlayBounds {
        x: 400.0,
        y: 200.0,
        width: 1720.0,
        height: 640.0,
    };
    assert!(stored_bounds_need_monitor_data(false, Some(&stored)));
    assert!(!stored_bounds_need_monitor_data(true, Some(&stored)));
    // 저장값이 없으면 환산할 대상 자체가 없다
    assert!(!stored_bounds_need_monitor_data(false, None));
    assert!(!stored_bounds_need_monitor_data(true, None));
}

#[test]
fn a_false_marker_on_logical_bounds_is_a_double_conversion() {
    // defer_overlay_bounds가 마커를 무조건 true로 세팅하는 것은 거짓말이 아니다.
    // 호출부가 넘기는 값은 전부 logical이며, 마커를 false로 "보존"하면
    // 다음 세션의 ensure_overlay_window가 x/y/w/h를 전부 다시 나눈다.
    // 신규 설치 후 위치 초기화(화면 중앙)가 절반 크기로 왼쪽 위에 뜨게 되는 경로
    let monitors = reset_test_monitors(2.0);
    let centered = OverlayBounds {
        x: 530.0,
        y: 380.0,
        width: 860.0,
        height: 320.0,
    };

    let double_converted = normalize_stored_overlay_bounds(Some(&centered), false, &monitors, None)
        .expect("마커가 false면 환산 대상이 된다");
    assert_eq!((double_converted.x, double_converted.y), (265.0, 190.0));
    assert_eq!(
        (double_converted.width, double_converted.height),
        (430.0, 160.0)
    );

    // 마커가 true여야 저장된 그대로 복원된다
    let preserved = normalize_stored_overlay_bounds(Some(&centered), true, &monitors, None)
        .expect("logical 값은 그대로 쓴다");
    assert_eq!((preserved.x, preserved.y), (530.0, 380.0));
    assert_eq!((preserved.width, preserved.height), (860.0, 320.0));
}

#[test]
fn pathological_monitor_scale_is_rejected() {
    // scale이 0/NaN인 모니터가 spec에 섞이면 logical 필드가 inf/NaN이 되어
    // clamp와 겹침 판정이 통째로 오염된다. from_monitor가 이 술어로 걸러낸다
    assert!(monitor_scale_is_usable(1.0));
    assert!(monitor_scale_is_usable(2.0));
    assert!(!monitor_scale_is_usable(0.0));
    assert!(!monitor_scale_is_usable(-1.0));
    assert!(!monitor_scale_is_usable(f64::NAN));
    assert!(!monitor_scale_is_usable(f64::INFINITY));
}

#[test]
fn initial_placement_clamps_with_the_size_being_applied() {
    // 초기화 resize는 콘텐츠 크기를 처음 확정하는 순간이라, 저장된 크기로
    // 판정하면 화면 안으로 되돌린다는 목적을 놓친다
    let monitors = reset_test_monitors(2.0); // logical 1920x1080
    let stored = OverlayBounds {
        x: 1900.0,
        y: 50.0,
        width: 860.0,
        height: 320.0,
    };

    // 이번에 적용될 크기는 1200x400 - 저장된 860 기준으로 clamp하면
    // 우측 끝이 1060+1200 = 2260이 되어 340px가 화면 밖에 남는다
    let placement = initial_overlay_placement(&stored, 1200.0, 400.0, &monitors);
    assert_eq!(placement.x, 1920.0 - 1200.0);
    assert!(placement.x + 1200.0 <= 1920.0);

    // 모니터 정보가 없으면 판정 근거가 없으므로 좌표를 그대로 둔다
    let blind = MonitorData::default();
    let untouched = initial_overlay_placement(&stored, 1200.0, 400.0, &blind);
    assert_eq!((untouched.x, untouched.y), (1900.0, 50.0));
}

#[test]
fn stored_bounds_normalization_rejects_overflowing_conversions() {
    // scale 가드는 0보다 크기만 하면 통과시키므로, 극단적으로 작은 scale에서
    // 나눗셈이 inf로 넘친다. 위치는 clamp 대상이 아니라 여기서 걸러야 store로 새지 않는다
    let monitors = MonitorData {
        specs: vec![MonitorSpec {
            logical_origin_x: 0.0,
            logical_origin_y: 0.0,
            logical_width: 1_920.0,
            logical_height: 1_080.0,
            physical_origin_x: 0.0,
            physical_origin_y: 0.0,
            physical_width: 1_920.0,
            physical_height: 1_080.0,
            scale_factor: 1e-300,
        }],
        primary_index: Some(0),
    };
    let stored = OverlayBounds {
        x: 1e200,
        y: 1e200,
        width: 1e200,
        height: 1e200,
    };
    assert!(normalize_stored_overlay_bounds(Some(&stored), false, &monitors, None).is_none());
}

#[test]
fn overlay_reset_fallback_repairs_missing_or_broken_stored_rect() {
    let monitors = reset_test_monitors(1.0);
    let (position, size) = overlay_reset_fallback_rect(None, true, &monitors);
    assert_eq!((position.x, position.y), (0.0, 0.0));
    assert_eq!(
        (size.width, size.height),
        (DEFAULT_OVERLAY_WIDTH, DEFAULT_OVERLAY_HEIGHT)
    );

    // 크기가 0이거나 NaN이면 중앙 정렬 계산이 무의미해진다
    let collapsed = OverlayBounds {
        x: 10.0,
        y: 20.0,
        width: 0.0,
        height: 300.0,
    };
    let (_, size) = overlay_reset_fallback_rect(Some(&collapsed), true, &monitors);
    assert_eq!(
        (size.width, size.height),
        (DEFAULT_OVERLAY_WIDTH, DEFAULT_OVERLAY_HEIGHT)
    );

    let broken = OverlayBounds {
        x: f64::NAN,
        y: 20.0,
        width: 800.0,
        height: 300.0,
    };
    let (_, size) = overlay_reset_fallback_rect(Some(&broken), true, &monitors);
    assert_eq!(
        (size.width, size.height),
        (DEFAULT_OVERLAY_WIDTH, DEFAULT_OVERLAY_HEIGHT)
    );

    // 저장된 크기가 한계를 넘으면 잘라 쓴다
    let oversized = OverlayBounds {
        x: 0.0,
        y: 0.0,
        width: 9000.0,
        height: 40.0,
    };
    let (_, size) = overlay_reset_fallback_rect(Some(&oversized), true, &monitors);
    assert_eq!((size.width, size.height), (4096.0, 100.0));
}
