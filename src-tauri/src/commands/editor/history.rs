use tauri::{AppHandle, State};

use crate::{
    commands::preset::PresetSnapshot,
    commands::{
        keys::keys::CustomTabChangePayload, plugin::instances::publish_plugin_instances_changed,
    },
    models::{AppStoreData, CustomCss, CustomJs, HistoryStatus, PluginInstancesChangedPayload},
    services::preview_broker::PreviewBroker,
    state::{
        history::{HistoryBarrierLease, HistoryDirection, PresetFullHistorySnapshot},
        store::HistoryAuxChange,
        AppState,
    },
};

use super::state::{emit_best_effort, publish_history_editor_change};

#[tauri::command]
pub fn history_status(state: State<'_, AppState>) -> HistoryStatus {
    state.store.history_status()
}

#[tauri::command]
pub async fn history_undo(
    state: State<'_, AppState>,
    broker: State<'_, PreviewBroker>,
    app: AppHandle,
    operation_id: String,
) -> Result<HistoryStatus, String> {
    validate_history_operation_id(&operation_id)?;
    let flush = state.request_frontend_history_flush(app.clone(), &operation_id)?;
    let mut flush = flush
        .await
        .map_err(|_| "HISTORY_FRONTEND_FLUSH_DROPPED".to_string())??;
    let result = run_history_operation(
        state.inner(),
        broker.inner(),
        &app,
        &operation_id,
        HistoryDirection::Undo,
        flush.take_barrier(),
    );
    drop(flush);
    result
}

#[tauri::command]
pub async fn history_redo(
    state: State<'_, AppState>,
    broker: State<'_, PreviewBroker>,
    app: AppHandle,
    operation_id: String,
) -> Result<HistoryStatus, String> {
    validate_history_operation_id(&operation_id)?;
    let flush = state.request_frontend_history_flush(app.clone(), &operation_id)?;
    let mut flush = flush
        .await
        .map_err(|_| "HISTORY_FRONTEND_FLUSH_DROPPED".to_string())??;
    let result = run_history_operation(
        state.inner(),
        broker.inner(),
        &app,
        &operation_id,
        HistoryDirection::Redo,
        flush.take_barrier(),
    );
    drop(flush);
    result
}

fn validate_history_operation_id(operation_id: &str) -> Result<(), String> {
    if operation_id.len() > 64 || uuid::Uuid::parse_str(operation_id).is_err() {
        return Err("INVALID_HISTORY_OPERATION_ID".to_string());
    }
    Ok(())
}

fn run_history_operation(
    state: &AppState,
    broker: &PreviewBroker,
    app: &AppHandle,
    operation_id: &str,
    direction: HistoryDirection,
    barrier: HistoryBarrierLease,
) -> Result<HistoryStatus, String> {
    let busy_status = state.store.history_status();
    emit_best_effort(app, "history:status", &busy_status);
    state.begin_counter_history_barrier();
    let mut counter_guard = state.lock_key_counters_for_history();
    let current_key_counters = counter_guard.clone();
    let previous_store = state.store.snapshot();
    let result =
        state
            .store
            .apply_history_operation(direction, operation_id, &current_key_counters, || {
                broker.cancel_all();
            });
    let committed_change = result
        .as_ref()
        .ok()
        .filter(|outcome| !outcome.replayed)
        .and_then(|outcome| outcome.change.as_ref());
    let mut counters_restored = false;
    if let Ok(outcome) = &result {
        match outcome.aux_change.as_ref() {
            Some(HistoryAuxChange::CustomTabs { snapshot, .. }) => {
                state.apply_committed_editor_keys_without_counters(
                    outcome.runtime_publication_generation,
                    &snapshot.document.keys,
                    &snapshot.selected_key_type,
                );
                counters_restored = state.replace_history_counters_locked(
                    &mut counter_guard,
                    outcome.runtime_publication_generation,
                    &snapshot.key_counters,
                );
            }
            Some(HistoryAuxChange::PresetFull { snapshot, .. }) => {
                state.apply_committed_editor_keys_without_counters(
                    outcome.runtime_publication_generation,
                    &snapshot.document.keys,
                    &snapshot.selected_key_type,
                );
                counters_restored = state.replace_history_counters_locked(
                    &mut counter_guard,
                    outcome.runtime_publication_generation,
                    &snapshot.key_counters,
                );
            }
            Some(HistoryAuxChange::Mode(mode)) => {
                let keys = state.store.snapshot().keys;
                state.apply_committed_editor_keys_without_counters(
                    outcome.runtime_publication_generation,
                    &keys,
                    mode,
                );
            }
            Some(HistoryAuxChange::Counters(counters)) => {
                counters_restored = state.replace_history_counters_locked(
                    &mut counter_guard,
                    outcome.runtime_publication_generation,
                    counters,
                );
            }
            Some(HistoryAuxChange::PluginElements { .. }) => {}
            None => {
                if let Some(change) = committed_change.filter(|change| {
                    change
                        .result
                        .changed_fields
                        .contains(&crate::models::EditorField::Keys)
                }) {
                    state.apply_committed_editor_keys_without_counters(
                        outcome.runtime_publication_generation,
                        &change.document.keys,
                        &change.selected_key_type,
                    );
                }
            }
        }
    }
    let publication_generation = result
        .as_ref()
        .map(|outcome| outcome.runtime_publication_generation)
        .unwrap_or_else(|_| state.store.runtime_publication_generation());
    state.finish_counter_history_barrier(
        app,
        counter_guard,
        counters_restored,
        publication_generation,
    );
    if let Ok(outcome) = &result {
        match outcome.aux_change.as_ref() {
            Some(HistoryAuxChange::CustomTabs { .. }) => {
                let restored_store = state.store.snapshot();
                let css_guard = state.lock_css_operation();
                state.resync_tab_css_watchers(&restored_store.tab_css_overrides);
                drop(css_guard);
            }
            Some(HistoryAuxChange::PresetFull { .. }) => {
                let restored_store = state.store.snapshot();
                let css_guard = state.lock_css_operation();
                state.resync_global_css_watcher(&previous_store, &restored_store);
                state.resync_tab_css_watchers(&restored_store.tab_css_overrides);
                drop(css_guard);
            }
            _ => {}
        }
    }
    if let Some(change) = committed_change {
        publish_history_editor_change(state, app, change);
    }
    if let Ok(outcome) = &result {
        publish_history_aux_change(state, app, outcome.aux_change.as_ref());
    }
    drop(barrier);

    match result {
        Ok(_) => {
            let status = state.store.history_status();
            emit_best_effort(app, "history:status", &status);
            Ok(status)
        }
        Err(error) => {
            let status = state.store.history_status();
            emit_best_effort(app, "history:status", &status);
            Err(error)
        }
    }
}

fn publish_history_aux_change(
    state: &AppState,
    app: &AppHandle,
    change: Option<&HistoryAuxChange>,
) {
    match change {
        Some(HistoryAuxChange::CustomTabs {
            snapshot,
            changed_tab_css_ids,
        }) => {
            let restored_store = state.store.snapshot();
            emit_best_effort(
                app,
                "customTabs:changed",
                &CustomTabChangePayload {
                    custom_tabs: snapshot.custom_tabs.clone(),
                    selected_key_type: snapshot.selected_key_type.clone(),
                },
            );
            emit_best_effort(
                app,
                "keys:mode-changed",
                &serde_json::json!({ "mode": &snapshot.selected_key_type }),
            );
            emit_best_effort(
                app,
                "tabNote:changed_all",
                &restored_store.tab_note_overrides,
            );
            for tab_id in changed_tab_css_ids {
                emit_best_effort(
                    app,
                    "tabCss:changed",
                    &crate::commands::editor::css::TabCssResponse {
                        tab_id: tab_id.clone(),
                        css: restored_store.tab_css_overrides.get(tab_id).cloned(),
                    },
                );
            }
            state.obs_broadcast_counters();
            state.refresh_obs_snapshot();
        }
        Some(HistoryAuxChange::PresetFull {
            snapshot,
            settings_diff,
            changed_tab_css_ids,
        }) => {
            let restored_store = state.store.snapshot();
            let projection =
                preset_history_event_projection(snapshot, &restored_store, changed_tab_css_ids);
            if let Err(error) = state.emit_settings_changed(settings_diff, app) {
                log::error!("failed to publish restored preset settings: {error:#}");
            }
            emit_best_effort(
                app,
                "customTabs:changed",
                &CustomTabChangePayload {
                    custom_tabs: projection.preset_snapshot.custom_tabs.clone(),
                    selected_key_type: projection.preset_snapshot.selected_key_type.clone(),
                },
            );
            emit_best_effort(
                app,
                "keys:mode-changed",
                &serde_json::json!({ "mode": &projection.preset_snapshot.selected_key_type }),
            );
            emit_best_effort(app, "layerGroups:changed", &snapshot.document.layer_groups);
            emit_best_effort(app, "preset:snapshot", &projection.preset_snapshot);
            emit_best_effort(
                app,
                "tabNote:changed_all",
                &projection.preset_snapshot.tab_note_overrides,
            );
            for payload in &projection.tab_css_changes {
                emit_best_effort(app, "tabCss:changed", payload);
            }
            emit_best_effort(
                app,
                "css:use",
                &serde_json::json!({ "enabled": projection.use_custom_css }),
            );
            emit_best_effort(app, "css:content", &projection.custom_css);
            emit_best_effort(
                app,
                "js:use",
                &serde_json::json!({ "enabled": projection.use_custom_js }),
            );
            emit_best_effort(app, "js:content", &projection.custom_js);
            state.obs_broadcast_counters();
            state.refresh_obs_snapshot();
        }
        Some(HistoryAuxChange::Mode(mode)) => {
            emit_best_effort(
                app,
                "keys:mode-changed",
                &serde_json::json!({ "mode": mode }),
            );
            state.refresh_obs_snapshot();
        }
        Some(HistoryAuxChange::Counters(_)) => {
            state.obs_broadcast_counters();
        }
        Some(HistoryAuxChange::PluginElements {
            plugin_id,
            revision,
        }) => {
            publish_plugin_instances_changed(
                app,
                &PluginInstancesChangedPayload {
                    plugin_id: plugin_id.clone(),
                    revision: *revision,
                    origin_mutation_id: None,
                },
            );
        }
        None => {}
    }
}

struct PresetHistoryEventProjection {
    preset_snapshot: PresetSnapshot,
    tab_css_changes: Vec<crate::commands::editor::css::TabCssResponse>,
    use_custom_css: bool,
    custom_css: CustomCss,
    use_custom_js: bool,
    custom_js: CustomJs,
}

fn preset_history_event_projection(
    snapshot: &PresetFullHistorySnapshot,
    restored_store: &AppStoreData,
    changed_tab_css_ids: &[String],
) -> PresetHistoryEventProjection {
    PresetHistoryEventProjection {
        preset_snapshot: PresetSnapshot {
            keys: snapshot.document.keys.clone(),
            positions: snapshot.document.key_positions.clone(),
            stat_positions: snapshot.document.stat_positions.clone(),
            graph_positions: snapshot.document.graph_positions.clone(),
            knob_positions: snapshot.document.knob_positions.clone(),
            custom_tabs: snapshot.custom_tabs.clone(),
            selected_key_type: snapshot.selected_key_type.clone(),
            tab_note_overrides: snapshot.settings.tab_note_overrides.clone(),
        },
        tab_css_changes: changed_tab_css_ids
            .iter()
            .map(|tab_id| crate::commands::editor::css::TabCssResponse {
                tab_id: tab_id.clone(),
                css: snapshot.tab_css_overrides.get(tab_id).cloned(),
            })
            .collect(),
        use_custom_css: snapshot.settings.use_custom_css,
        custom_css: snapshot.settings.custom_css.clone(),
        use_custom_js: snapshot.settings.use_custom_js,
        custom_js: restored_store.custom_js.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preset_history_projection_matches_preset_load_payloads() {
        let mut restored = AppStoreData {
            use_custom_css: true,
            custom_css: CustomCss {
                path: Some("/tmp/history.css".to_string()),
                content: ".history {}".to_string(),
            },
            use_custom_js: true,
            custom_js: CustomJs {
                path: Some("/tmp/history.js".to_string()),
                content: "history();".to_string(),
                ..CustomJs::default()
            },
            ..AppStoreData::default()
        };
        restored.tab_css_overrides.insert(
            "4key".to_string(),
            crate::models::TabCss {
                path: Some("/tmp/tab.css".to_string()),
                content: ".tab {}".to_string(),
                enabled: true,
            },
        );
        restored.tab_note_overrides.insert(
            "4key".to_string(),
            crate::models::TabNoteSettings {
                speed: Some(777),
                ..crate::models::TabNoteSettings::default()
            },
        );
        let snapshot = PresetFullHistorySnapshot::from_store(&restored);
        let changed_ids = vec!["4key".to_string()];

        let projection = preset_history_event_projection(&snapshot, &restored, &changed_ids);

        assert_eq!(projection.preset_snapshot.keys, restored.keys);
        assert_eq!(projection.preset_snapshot.positions, restored.key_positions);
        assert_eq!(
            projection.preset_snapshot.tab_note_overrides,
            restored.tab_note_overrides
        );
        assert_eq!(projection.use_custom_css, restored.use_custom_css);
        assert_eq!(projection.custom_css, restored.custom_css);
        assert_eq!(projection.use_custom_js, restored.use_custom_js);
        assert_eq!(projection.custom_js, restored.custom_js);
        assert_eq!(projection.tab_css_changes.len(), 1);
        assert_eq!(projection.tab_css_changes[0].tab_id, "4key");
        assert_eq!(
            projection.tab_css_changes[0].css,
            restored.tab_css_overrides.get("4key").cloned()
        );
    }
}
