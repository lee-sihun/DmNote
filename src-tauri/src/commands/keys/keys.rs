use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, State, WebviewWindow};

use crate::{
    commands::editor::state::{emit_best_effort, publish_editor_change},
    defaults::{default_keys, default_positions},
    errors::CmdResult,
    models::{
        AppStoreData, CommittedEditorChange, CustomCssPatch, CustomTab, EditorCommitOrigin,
        EditorDocumentV1, EditorField, KeyCounters, KeyMappings, KeyPositions, LayerGroups,
        NoteSettings, NoteSettingsPatch, SettingsPatchInput,
    },
    services::settings::apply_patch_to_store,
    state::{editor::validate_history_restore_metadata, history::HistoryScope, AppState},
};

const MAX_CUSTOM_TABS: usize = 30;

fn publish_legacy_key_noop_runtime(
    state: &AppState,
    _app: &AppHandle,
    change: &CommittedEditorChange,
) {
    state.apply_committed_editor_keys_without_counters(
        change.runtime_publication_generation,
        &change.document.keys,
        &change.selected_key_type,
    );
    state.obs_broadcast_counters();
    state.refresh_obs_snapshot();
}

fn emit_aux_history_status(app: &AppHandle, change: &CommittedEditorChange) {
    if let Some(status) = change.history_status.as_ref() {
        emit_best_effort(app, "history:status", status);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ModeResetKind {
    Default,
    Custom,
}

struct CustomTabDeletePlan {
    custom_tabs: Vec<CustomTab>,
    next_selected: String,
}

fn zeroed_counters(keys: &KeyMappings) -> KeyCounters {
    keys.iter()
        .map(|(mode, mode_keys)| {
            (
                mode.clone(),
                mode_keys.iter().map(|key| (key.canonical(), 0)).collect(),
            )
        })
        .collect()
}

fn reset_all_editor_data(store: &mut AppStoreData, keys: &KeyMappings, positions: &KeyPositions) {
    store.keys = keys.clone();
    store.key_positions = positions.clone();
    store.stat_positions.clear();
    store.graph_positions.clear();
    store.knob_positions.clear();
    store.layer_groups.clear();
    store.key_counters = zeroed_counters(keys);
    store.custom_tabs.clear();
    store.selected_key_type = "4key".to_string();
    store.tab_note_overrides.clear();
    store.tab_css_overrides.clear();
    crate::state::native_element_id::rekey_store_element_ids(store);
}

fn reset_mode_kind(store: &AppStoreData, mode: &str) -> Option<ModeResetKind> {
    if default_keys().contains_key(mode) {
        Some(ModeResetKind::Default)
    } else if store.custom_tabs.iter().any(|tab| tab.id == mode) {
        Some(ModeResetKind::Custom)
    } else {
        None
    }
}

fn is_selectable_mode(store: &AppStoreData, mode: &str) -> bool {
    default_keys().contains_key(mode)
        || (store.keys.contains_key(mode) && store.custom_tabs.iter().any(|tab| tab.id == mode))
}

fn select_mode_if_available(store: &mut AppStoreData, requested: &str) -> (bool, String) {
    if !is_selectable_mode(store, requested) {
        return (false, store.selected_key_type.clone());
    }
    store.selected_key_type = requested.to_string();
    (true, store.selected_key_type.clone())
}

#[cfg(test)]
fn set_mode_with<Commit, ApplyRuntime>(
    store: &AppStoreData,
    requested: String,
    commit: Commit,
    apply_runtime: ApplyRuntime,
) -> CmdResult<ModeResponse>
where
    Commit: FnOnce(String) -> CmdResult<String>,
    ApplyRuntime: FnOnce(&str) -> CmdResult<()>,
{
    if !is_selectable_mode(store, &requested) {
        return Ok(ModeResponse {
            success: false,
            mode: store.selected_key_type.clone(),
        });
    }

    let effective = commit(requested.clone())?;
    apply_runtime(&effective)?;
    Ok(ModeResponse {
        success: effective == requested,
        mode: effective,
    })
}

fn reset_mode_data(store: &mut AppStoreData, mode: &str, kind: ModeResetKind) {
    match kind {
        ModeResetKind::Default => {
            if let Some(keys) = default_keys().get(mode) {
                store.keys.insert(mode.to_string(), keys.clone());
            }
            if let Some(positions) = default_positions().get(mode) {
                store
                    .key_positions
                    .insert(mode.to_string(), positions.clone());
            }
        }
        ModeResetKind::Custom => {
            store.keys.insert(mode.to_string(), Vec::new());
            store.key_positions.insert(mode.to_string(), Vec::new());
        }
    }

    store.stat_positions.insert(mode.to_string(), Vec::new());
    store.graph_positions.insert(mode.to_string(), Vec::new());
    store.knob_positions.insert(mode.to_string(), Vec::new());
    store.layer_groups.remove(mode);
    store.tab_css_overrides.remove(mode);
    store.tab_note_overrides.remove(mode);

    let mode_keys = store.keys.get(mode).cloned().unwrap_or_default();
    store.key_counters.insert(
        mode.to_string(),
        mode_keys
            .into_iter()
            .map(|key| (key.canonical(), 0))
            .collect(),
    );
    crate::state::native_element_id::rekey_mode_element_ids(store, mode);
}

fn plan_custom_tab_delete(store: &AppStoreData, id: &str) -> Option<CustomTabDeletePlan> {
    let index = store.custom_tabs.iter().position(|tab| tab.id == id)?;
    let custom_tabs: Vec<CustomTab> = store
        .custom_tabs
        .iter()
        .filter(|tab| tab.id != id)
        .cloned()
        .collect();
    let selected_tab_deleted = store.selected_key_type == id;
    let next_selected = if selected_tab_deleted {
        if custom_tabs.is_empty() {
            "8key".to_string()
        } else {
            custom_tabs[if index > 0 { index - 1 } else { 0 }]
                .id
                .clone()
        }
    } else {
        store.selected_key_type.clone()
    };

    Some(CustomTabDeletePlan {
        custom_tabs,
        next_selected,
    })
}

fn delete_custom_tab_data(store: &mut AppStoreData, id: &str, plan: &CustomTabDeletePlan) {
    store.custom_tabs = plan.custom_tabs.clone();
    store.keys.remove(id);
    store.key_positions.remove(id);
    store.stat_positions.remove(id);
    store.graph_positions.remove(id);
    store.knob_positions.remove(id);
    store.layer_groups.remove(id);
    store.tab_css_overrides.remove(id);
    store.tab_note_overrides.remove(id);
    store.key_counters.remove(id);
    store.selected_key_type = plan.next_selected.clone();
}

#[derive(Serialize)]
pub struct ModeResponse {
    pub success: bool,
    pub mode: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetAllResponse {
    pub keys: KeyMappings,
    pub positions: KeyPositions,
    pub custom_tabs: Vec<CustomTab>,
    pub selected_key_type: String,
}

#[derive(Serialize)]
pub struct ResetModeResponse {
    pub success: bool,
    pub mode: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomTabChangePayload {
    pub custom_tabs: Vec<CustomTab>,
    pub selected_key_type: String,
}

#[derive(Serialize)]
pub struct CustomTabCreateResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<CustomTab>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct CustomTabDeleteResult {
    pub success: bool,
    pub selected: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub fn keys_get(state: State<'_, AppState>) -> CmdResult<KeyMappings> {
    Ok(state.store.snapshot().keys)
}

#[tauri::command]
pub fn positions_get(state: State<'_, AppState>) -> CmdResult<KeyPositions> {
    Ok(state.store.snapshot().key_positions)
}

#[tauri::command]
pub fn keys_get_counters(state: State<'_, AppState>) -> CmdResult<KeyCounters> {
    Ok(state.snapshot_key_counters())
}

#[tauri::command]
pub fn keys_set_mode(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    mode: String,
    observed_history_epoch: Option<u64>,
) -> CmdResult<ModeResponse> {
    let requested = mode.clone();
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction = state.store.commit_aux_editor_transaction_with_admission(
        HistoryScope::Mode,
        observed_history_epoch,
        EditorCommitOrigin::LegacyAdapter("keys_set_mode".to_string()),
        &[],
        admission,
        move |store| Ok(select_mode_if_available(store, &requested)),
    )?;
    let (success, effective) = transaction.value.clone();
    if success
        && state.apply_committed_editor_keys_without_counters(
            transaction.change.runtime_publication_generation,
            &transaction.change.document.keys,
            &effective,
        )
    {
        emit_best_effort(
            &app,
            "keys:mode-changed",
            &serde_json::json!({ "mode": &effective }),
        );
        state.refresh_obs_snapshot();
    }
    emit_aux_history_status(&app, &transaction.change);
    Ok(ModeResponse {
        success,
        mode: effective,
    })
}

#[tauri::command]
pub fn keys_reset_all(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
) -> CmdResult<ResetAllResponse> {
    let keys = default_keys().clone();
    let positions = default_positions().clone();
    let mut note_patch = NoteSettingsPatch::default();
    let defaults = NoteSettings::default();
    note_patch.frame_limit = Some(defaults.frame_limit);
    note_patch.speed = Some(defaults.speed);
    note_patch.track_height = Some(defaults.track_height);
    note_patch.reverse = Some(defaults.reverse);
    note_patch.fade_position = Some(defaults.fade_position.clone());
    note_patch.fade_top_px = Some(defaults.fade_top_px);
    note_patch.fade_bottom_px = Some(defaults.fade_bottom_px);
    note_patch.reverse_fade_top_px = Some(defaults.reverse_fade_top_px);
    note_patch.reverse_fade_bottom_px = Some(defaults.reverse_fade_bottom_px);
    note_patch.delayed_note_enabled = Some(defaults.delayed_note_enabled);
    note_patch.short_note_threshold_ms = Some(defaults.short_note_threshold_ms);
    note_patch.short_note_min_length_px = Some(defaults.short_note_min_length_px);
    note_patch.key_display_delay_ms = Some(defaults.key_display_delay_ms);
    let settings_patch = SettingsPatchInput {
        background_color: Some("transparent".to_string()),
        note_settings: Some(note_patch),
        laboratory_enabled: Some(false),
        use_custom_css: Some(false),
        custom_css: Some(CustomCssPatch {
            path: Some(None),
            content: Some(String::new()),
        }),
        note_effect: Some(false),
        overlay_locked: Some(false),
        ..SettingsPatchInput::default()
    };
    let css_operation_guard = state.lock_css_operation();
    let previous_css_state = state.store.snapshot();
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction = state
        .store
        .commit_legacy_editor_transaction_with_admission(
            EditorCommitOrigin::LegacyAdapter("keys_reset_all".to_string()),
            &[
                EditorField::Keys,
                EditorField::KeyPositions,
                EditorField::StatPositions,
                EditorField::GraphPositions,
                EditorField::KnobPositions,
                EditorField::LayerGroups,
            ],
            admission,
            move |store| {
                let cleared_tab_css_ids =
                    store.tab_css_overrides.keys().cloned().collect::<Vec<_>>();
                reset_all_editor_data(store, &keys, &positions);
                let settings_diff = apply_patch_to_store(store, &settings_patch);
                Ok((settings_diff, cleared_tab_css_ids))
            },
        )?;
    let current_css_state = state.store.snapshot();
    state.resync_global_css_watcher(&previous_css_state, &current_css_state);
    for tab_id in &transaction.value.1 {
        state.unwatch_tab_css(tab_id);
    }
    drop(css_operation_guard);
    publish_editor_change(state.inner(), &app, &transaction.change, false);
    if !transaction
        .change
        .result
        .changed_fields
        .contains(&EditorField::Keys)
    {
        publish_legacy_key_noop_runtime(state.inner(), &app, &transaction.change);
    }

    let (settings_diff, cleared_tab_css_ids) = transaction.value;
    let keys = transaction.change.document.keys;
    let positions = transaction.change.document.key_positions;
    let stat_positions = transaction.change.document.stat_positions;
    let graph_positions = transaction.change.document.graph_positions;
    let knob_positions = transaction.change.document.knob_positions;
    let layer_groups = transaction.change.document.layer_groups;
    let selected_key_type = transaction.change.selected_key_type;
    let custom_tabs: Vec<CustomTab> = Vec::new();
    let tab_note_overrides = crate::models::TabNoteOverrides::new();

    if let Err(error) = state.emit_settings_changed(&settings_diff, &app) {
        log::error!("[Keys] failed to publish reset settings: {error:#}");
    }

    emit_best_effort(&app, "keys:changed", &keys);
    emit_best_effort(&app, "positions:changed", &positions);
    emit_best_effort(&app, "statPositions:changed", &stat_positions);
    emit_best_effort(&app, "graphPositions:changed", &graph_positions);
    emit_best_effort(&app, "knobPositions:changed", &knob_positions);
    emit_best_effort(&app, "layerGroups:changed", &layer_groups);
    emit_best_effort(
        &app,
        "customTabs:changed",
        &CustomTabChangePayload {
            custom_tabs: custom_tabs.clone(),
            selected_key_type: selected_key_type.clone(),
        },
    );
    emit_best_effort(
        &app,
        "keys:mode-changed",
        &serde_json::json!({ "mode": &selected_key_type }),
    );
    emit_best_effort(&app, "css:use", &serde_json::json!({ "enabled": false }));
    emit_best_effort(
        &app,
        "css:content",
        &serde_json::json!({ "path": serde_json::Value::Null, "content": "" }),
    );
    emit_best_effort(&app, "tabNote:changed_all", &tab_note_overrides);
    for tab_id in cleared_tab_css_ids {
        emit_best_effort(
            &app,
            "tabCss:changed",
            &crate::commands::editor::css::TabCssResponse { tab_id, css: None },
        );
    }

    Ok(ResetAllResponse {
        keys,
        positions,
        custom_tabs,
        selected_key_type,
    })
}

#[tauri::command]
pub fn keys_reset_mode(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    mode: String,
) -> CmdResult<ResetModeResponse> {
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction = state
        .store
        .commit_legacy_editor_transaction_with_admission(
            EditorCommitOrigin::LegacyAdapter("keys_reset_mode".to_string()),
            &[
                EditorField::Keys,
                EditorField::KeyPositions,
                EditorField::StatPositions,
                EditorField::GraphPositions,
                EditorField::KnobPositions,
                EditorField::LayerGroups,
            ],
            admission,
            |store| {
                let Some(kind) = reset_mode_kind(store, &mode) else {
                    return Ok(None);
                };
                let cleared_tab_css = store.tab_css_overrides.contains_key(&mode);
                reset_mode_data(store, &mode, kind);
                Ok(Some((cleared_tab_css, store.tab_note_overrides.clone())))
            },
        )?;
    let Some((cleared_tab_css, tab_note_overrides)) = transaction.value else {
        return Ok(ResetModeResponse {
            success: false,
            mode,
        });
    };
    publish_editor_change(state.inner(), &app, &transaction.change, false);
    if !transaction
        .change
        .result
        .changed_fields
        .contains(&EditorField::Keys)
    {
        publish_legacy_key_noop_runtime(state.inner(), &app, &transaction.change);
    }

    if cleared_tab_css {
        state.unwatch_tab_css(&mode);
    }

    emit_best_effort(&app, "keys:changed", &transaction.change.document.keys);
    emit_best_effort(
        &app,
        "positions:changed",
        &transaction.change.document.key_positions,
    );
    emit_best_effort(
        &app,
        "statPositions:changed",
        &transaction.change.document.stat_positions,
    );
    emit_best_effort(
        &app,
        "graphPositions:changed",
        &transaction.change.document.graph_positions,
    );
    emit_best_effort(
        &app,
        "knobPositions:changed",
        &transaction.change.document.knob_positions,
    );
    emit_best_effort(
        &app,
        "layerGroups:changed",
        &transaction.change.document.layer_groups,
    );
    emit_best_effort(&app, "tabNote:changed_all", &tab_note_overrides);
    if cleared_tab_css {
        emit_best_effort(
            &app,
            "tabCss:changed",
            &crate::commands::editor::css::TabCssResponse {
                tab_id: mode.clone(),
                css: None,
            },
        );
    }

    Ok(ResetModeResponse {
        success: true,
        mode,
    })
}

#[tauri::command]
pub fn custom_tabs_list(state: State<'_, AppState>) -> CmdResult<Vec<CustomTab>> {
    Ok(state.store.snapshot().custom_tabs)
}

#[tauri::command]
pub fn custom_tabs_create(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    name: String,
    observed_history_epoch: Option<u64>,
) -> CmdResult<CustomTabCreateResult> {
    if name.trim().is_empty() {
        return Ok(CustomTabCreateResult {
            result: None,
            error: Some("invalid-name".to_string()),
        });
    }

    let trimmed = name.trim().to_string();
    let id = generate_custom_tab_id();
    let tab = CustomTab {
        id: id.clone(),
        name: trimmed,
    };
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction = state.store.commit_aux_editor_transaction_with_admission(
        HistoryScope::CustomTabs,
        observed_history_epoch,
        EditorCommitOrigin::LegacyAdapter("custom_tabs_create".to_string()),
        &[EditorField::Keys, EditorField::KeyPositions],
        admission,
        |store| {
            if store
                .custom_tabs
                .iter()
                .any(|existing| existing.name == tab.name)
            {
                return Ok(Err("duplicate-name".to_string()));
            }
            if store.custom_tabs.len() >= MAX_CUSTOM_TABS {
                return Ok(Err("max-reached".to_string()));
            }
            store.custom_tabs.push(tab.clone());
            store.keys.insert(id.clone(), Vec::new());
            store.key_positions.insert(id.clone(), Vec::new());
            store.selected_key_type = id.clone();
            Ok(Ok((tab.clone(), store.custom_tabs.clone())))
        },
    )?;
    let (tab, custom_tabs) = match transaction.value {
        Ok(result) => result,
        Err(error) => {
            return Ok(CustomTabCreateResult {
                result: None,
                error: Some(error),
            });
        }
    };
    publish_editor_change(state.inner(), &app, &transaction.change, false);

    emit_best_effort(
        &app,
        "customTabs:changed",
        &CustomTabChangePayload {
            custom_tabs: custom_tabs.clone(),
            selected_key_type: id.clone(),
        },
    );
    emit_best_effort(&app, "keys:changed", &transaction.change.document.keys);
    emit_best_effort(
        &app,
        "positions:changed",
        &transaction.change.document.key_positions,
    );
    emit_best_effort(
        &app,
        "keys:mode-changed",
        &serde_json::json!({ "mode": &id }),
    );
    emit_aux_history_status(&app, &transaction.change);

    Ok(CustomTabCreateResult {
        result: Some(tab),
        error: None,
    })
}

#[tauri::command]
pub fn custom_tabs_delete(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    id: String,
    observed_history_epoch: Option<u64>,
) -> CmdResult<CustomTabDeleteResult> {
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction = state.store.commit_aux_editor_transaction_with_admission(
        HistoryScope::CustomTabs,
        observed_history_epoch,
        EditorCommitOrigin::LegacyAdapter("custom_tabs_delete".to_string()),
        &[
            EditorField::Keys,
            EditorField::KeyPositions,
            EditorField::StatPositions,
            EditorField::GraphPositions,
            EditorField::KnobPositions,
            EditorField::LayerGroups,
        ],
        admission,
        |store| {
            let Some(plan) = plan_custom_tab_delete(store, &id) else {
                return Ok(Err(store.selected_key_type.clone()));
            };
            delete_custom_tab_data(store, &id, &plan);
            Ok(Ok((
                store.custom_tabs.clone(),
                store.selected_key_type.clone(),
                store.tab_note_overrides.clone(),
            )))
        },
    )?;
    let (custom_tabs, selected_key_type, tab_note_overrides) = match transaction.value {
        Ok(result) => result,
        Err(selected) => {
            return Ok(CustomTabDeleteResult {
                success: false,
                selected,
                error: Some("not-found".to_string()),
            });
        }
    };
    publish_editor_change(state.inner(), &app, &transaction.change, false);
    state.unwatch_tab_css(&id);

    emit_best_effort(
        &app,
        "customTabs:changed",
        &CustomTabChangePayload {
            custom_tabs,
            selected_key_type: selected_key_type.clone(),
        },
    );
    emit_best_effort(&app, "keys:changed", &transaction.change.document.keys);
    emit_best_effort(
        &app,
        "positions:changed",
        &transaction.change.document.key_positions,
    );
    emit_best_effort(
        &app,
        "statPositions:changed",
        &transaction.change.document.stat_positions,
    );
    emit_best_effort(
        &app,
        "graphPositions:changed",
        &transaction.change.document.graph_positions,
    );
    emit_best_effort(
        &app,
        "knobPositions:changed",
        &transaction.change.document.knob_positions,
    );
    emit_best_effort(
        &app,
        "layerGroups:changed",
        &transaction.change.document.layer_groups,
    );
    emit_best_effort(&app, "tabNote:changed_all", &tab_note_overrides);
    emit_best_effort(
        &app,
        "tabCss:changed",
        &crate::commands::editor::css::TabCssResponse {
            tab_id: id,
            css: None,
        },
    );
    emit_best_effort(
        &app,
        "keys:mode-changed",
        &serde_json::json!({ "mode": &selected_key_type }),
    );
    emit_aux_history_status(&app, &transaction.change);

    Ok(CustomTabDeleteResult {
        success: true,
        selected: selected_key_type,
        error: None,
    })
}

#[derive(Serialize)]
pub struct CustomTabSelectResult {
    pub success: bool,
    pub selected: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub fn custom_tabs_select(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    id: String,
    observed_history_epoch: Option<u64>,
) -> CmdResult<CustomTabSelectResult> {
    let requested = id;
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction = state.store.commit_aux_editor_transaction_with_admission(
        HistoryScope::Mode,
        observed_history_epoch,
        EditorCommitOrigin::LegacyAdapter("custom_tabs_select".to_string()),
        &[],
        admission,
        move |store| Ok(select_mode_if_available(store, &requested)),
    )?;
    let (success, selected) = transaction.value.clone();
    if success
        && state.apply_committed_editor_keys_without_counters(
            transaction.change.runtime_publication_generation,
            &transaction.change.document.keys,
            &selected,
        )
    {
        emit_best_effort(
            &app,
            "keys:mode-changed",
            &serde_json::json!({ "mode": &selected }),
        );
        state.refresh_obs_snapshot();
    }
    emit_aux_history_status(&app, &transaction.change);

    Ok(CustomTabSelectResult {
        success,
        selected,
        error: (!success).then(|| "not-found".to_string()),
    })
}

/// 커스텀 탭 목록과 선택 모드를 원자적으로 복원
#[tauri::command]
pub fn custom_tabs_restore(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    custom_tabs: Vec<CustomTab>,
    selected_key_type: String,
    observed_history_epoch: Option<u64>,
) -> CmdResult<()> {
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction = state.store.commit_aux_editor_transaction_with_admission(
        HistoryScope::CustomTabs,
        observed_history_epoch,
        EditorCommitOrigin::LegacyAdapter("custom_tabs_restore".to_string()),
        &[],
        admission,
        move |store| {
            validate_history_restore_metadata(
                &EditorDocumentV1::from_store(store),
                &custom_tabs,
                &selected_key_type,
            )?;
            store.custom_tabs = custom_tabs;
            store.selected_key_type = selected_key_type;
            Ok((store.custom_tabs.clone(), store.selected_key_type.clone()))
        },
    )?;
    let (custom_tabs, selected_key_type) = transaction.value;

    state.apply_committed_editor_keys_without_counters(
        transaction.change.runtime_publication_generation,
        &transaction.change.document.keys,
        &selected_key_type,
    );
    emit_best_effort(
        &app,
        "customTabs:changed",
        &CustomTabChangePayload {
            custom_tabs,
            selected_key_type: selected_key_type.clone(),
        },
    );
    emit_best_effort(
        &app,
        "keys:mode-changed",
        &serde_json::json!({ "mode": &selected_key_type }),
    );
    state.refresh_obs_snapshot();
    emit_aux_history_status(&app, &transaction.change);
    Ok(())
}

#[tauri::command]
pub fn keys_reset_counters(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    observed_history_epoch: Option<u64>,
) -> CmdResult<KeyCounters> {
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let mutation =
        state.reset_key_counters_with_admission(&app, observed_history_epoch, admission)?;
    state.obs_broadcast_counters();
    if let Some(status) = mutation.history_status.as_ref() {
        emit_best_effort(&app, "history:status", status);
    }
    Ok(mutation.counters)
}

#[tauri::command]
pub fn keys_reset_counters_mode(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    mode: String,
    observed_history_epoch: Option<u64>,
) -> CmdResult<KeyCounters> {
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let mutation =
        state.reset_mode_counters_with_admission(&app, &mode, observed_history_epoch, admission)?;
    state.obs_broadcast_counters();
    if let Some(status) = mutation.history_status.as_ref() {
        emit_best_effort(&app, "history:status", status);
    }
    Ok(mutation.counters)
}

#[tauri::command]
pub fn keys_reset_single_counter(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    mode: String,
    key: String,
    observed_history_epoch: Option<u64>,
) -> CmdResult<KeyCounters> {
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let mutation = state.reset_single_key_counter_with_admission(
        &app,
        &mode,
        &key,
        observed_history_epoch,
        admission,
    )?;
    state.obs_broadcast_counters();
    if let Some(status) = mutation.history_status.as_ref() {
        emit_best_effort(&app, "history:status", status);
    }
    Ok(mutation.counters)
}

#[tauri::command]
pub fn keys_set_counters(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    counters: KeyCounters,
    observed_history_epoch: Option<u64>,
) -> CmdResult<KeyCounters> {
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let mutation = state.replace_key_counters_with_admission(
        &app,
        counters,
        observed_history_epoch,
        admission,
    )?;
    state.obs_broadcast_counters();
    if let Some(status) = mutation.history_status.as_ref() {
        emit_best_effort(&app, "history:status", status);
    }
    Ok(mutation.counters)
}

#[tauri::command]
pub fn layer_groups_get(state: State<'_, AppState>) -> CmdResult<LayerGroups> {
    Ok(state.store.snapshot().layer_groups)
}

fn generate_custom_tab_id() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("custom-{}", now)
}

#[derive(Serialize)]
pub struct RawInputSubscribeResponse {
    pub count: u32,
}

/// Subscribe to raw input stream (increment subscriber count)
#[tauri::command]
pub fn raw_input_subscribe(state: State<'_, AppState>) -> CmdResult<RawInputSubscribeResponse> {
    let count = state.subscribe_raw_input();
    log::debug!("[RawInput] Subscribe: count = {}", count);
    Ok(RawInputSubscribeResponse { count })
}

/// Unsubscribe from raw input stream (decrement subscriber count)
#[tauri::command]
pub fn raw_input_unsubscribe(state: State<'_, AppState>) -> CmdResult<RawInputSubscribeResponse> {
    let count = state.unsubscribe_raw_input();
    log::debug!("[RawInput] Unsubscribe: count = {}", count);
    Ok(RawInputSubscribeResponse { count })
}

#[cfg(test)]
mod tests {
    use super::{
        delete_custom_tab_data, plan_custom_tab_delete, reset_all_editor_data, reset_mode_data,
        reset_mode_kind, select_mode_if_available, set_mode_with, ModeResetKind,
    };
    use crate::{
        defaults::{default_keys, default_positions},
        keyboard::KeyboardManager,
        models::{
            AppStoreData, CustomTab, GraphPosition, GraphStatType, GraphType, KeySlot,
            KnobPosition, LayerGroupDef, StatPosition, StatType, TabCss, TabNoteSettings,
        },
    };
    use std::{cell::Cell, collections::HashSet};

    const TARGET_TAB: &str = "custom-target";

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
    }

    #[test]
    fn reset_all_clears_knob_positions_and_zeroes_default_counters() {
        let mut store = populated_custom_tab_store();
        reset_all_editor_data(&mut store, default_keys(), default_positions());

        assert!(store.knob_positions.is_empty());
        assert!(store.custom_tabs.is_empty());
        assert_eq!(store.selected_key_type, "4key");
        assert!(store
            .key_counters
            .values()
            .flat_map(|mode| mode.values())
            .all(|count| *count == 0));
    }

    #[test]
    fn reset_all_issues_a_fresh_globally_unique_id_generation_each_time() {
        let mut store = populated_custom_tab_store();
        reset_all_editor_data(&mut store, default_keys(), default_positions());
        let first = store
            .key_positions
            .values()
            .flatten()
            .map(|position| position.id.clone())
            .collect::<HashSet<_>>();
        let first_count = store.key_positions.values().map(Vec::len).sum::<usize>();

        reset_all_editor_data(&mut store, default_keys(), default_positions());
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
}
