use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::{
    defaults::{default_keys, default_positions},
    errors::CmdResult,
    models::{
        AppStoreData, CustomCssPatch, CustomTab, KeyCounters, KeyMappings, KeyPositions,
        LayerGroups, NoteSettings, NoteSettingsPatch, SettingsPatchInput,
    },
    state::AppState,
};

const MAX_CUSTOM_TABS: usize = 30;

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
                mode_keys.iter().map(|key| (key.clone(), 0)).collect(),
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
        mode_keys.into_iter().map(|key| (key, 0)).collect(),
    );
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
pub struct KeysWithPositionsResponse {
    pub keys: KeyMappings,
    pub positions: KeyPositions,
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
pub fn keys_update(
    state: State<'_, AppState>,
    app: AppHandle,
    mappings: KeyMappings,
) -> CmdResult<KeyMappings> {
    let previous_mode = state.keyboard.current_mode();
    let (updated, selected_key_type) = state.store.update_keys(mappings)?;
    state
        .keyboard
        .update_mappings_and_set_mode(updated.clone(), selected_key_type.clone());
    app.emit("keys:changed", &updated)?;
    if previous_mode != selected_key_type {
        app.emit(
            "keys:mode-changed",
            &serde_json::json!({ "mode": &selected_key_type }),
        )?;
    }
    state.sync_counters_with_keys_and_emit(&app, &updated)?;
    state.obs_broadcast_counters();
    state.refresh_obs_snapshot();
    Ok(updated)
}

#[tauri::command]
pub fn keys_update_with_positions(
    state: State<'_, AppState>,
    app: AppHandle,
    mappings: KeyMappings,
    positions: KeyPositions,
) -> CmdResult<KeysWithPositionsResponse> {
    let previous_mode = state.keyboard.current_mode();
    let (keys, positions, selected_key_type) = state
        .store
        .update_keys_with_positions(mappings, positions)?;
    state
        .keyboard
        .update_mappings_and_set_mode(keys.clone(), selected_key_type.clone());
    app.emit("keys:changed", &keys)?;
    app.emit("positions:changed", &positions)?;
    if previous_mode != selected_key_type {
        app.emit(
            "keys:mode-changed",
            &serde_json::json!({ "mode": &selected_key_type }),
        )?;
    }
    state.sync_counters_with_keys_and_emit(&app, &keys)?;
    state.obs_broadcast_counters();
    state.refresh_obs_snapshot();
    Ok(KeysWithPositionsResponse { keys, positions })
}

#[tauri::command]
pub fn positions_update(
    state: State<'_, AppState>,
    app: AppHandle,
    positions: KeyPositions,
) -> CmdResult<KeyPositions> {
    let updated = state.store.update_positions(positions)?;
    app.emit("positions:changed", &updated)?;
    state.refresh_obs_snapshot();
    Ok(updated)
}

#[tauri::command]
pub fn keys_set_mode(
    state: State<'_, AppState>,
    app: AppHandle,
    mode: String,
) -> CmdResult<ModeResponse> {
    let snapshot = state.store.snapshot();
    set_mode_with(
        &snapshot,
        mode,
        |candidate| {
            state
                .store
                .set_selected_key_type(candidate)
                .map_err(Into::into)
        },
        |effective| {
            state.keyboard.set_mode(effective.to_string());
            app.emit(
                "keys:mode-changed",
                &serde_json::json!({ "mode": effective }),
            )?;
            state.refresh_obs_snapshot();
            Ok(())
        },
    )
}

#[tauri::command]
pub fn keys_reset_all(state: State<'_, AppState>, app: AppHandle) -> CmdResult<ResetAllResponse> {
    let keys = default_keys().clone();
    let positions = default_positions().clone();
    let stat_positions = crate::models::StatPositions::new();
    let graph_positions = crate::models::GraphPositions::new();
    let knob_positions = crate::models::KnobPositions::new();
    let layer_groups = LayerGroups::new();
    let tab_note_overrides = crate::models::TabNoteOverrides::new();
    let selected_key_type = "4key".to_string();
    let custom_tabs: Vec<CustomTab> = Vec::new();
    let cleared_tab_css_ids: Vec<String> = state
        .store
        .snapshot()
        .tab_css_overrides
        .keys()
        .cloned()
        .collect();

    state.update_store_with_key_counter_mirror_and_emit(&app, |store| {
        reset_all_editor_data(store, &keys, &positions);
    })?;

    state
        .keyboard
        .update_mappings_and_set_mode(keys.clone(), selected_key_type.clone());

    for tab_id in &cleared_tab_css_ids {
        state.unwatch_tab_css(tab_id);
    }

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

    let settings_diff = state.settings.apply_patch(SettingsPatchInput {
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
    })?;

    state.emit_settings_changed(&settings_diff, &app)?;

    app.emit("keys:changed", &keys)?;
    app.emit("positions:changed", &positions)?;
    app.emit("statPositions:changed", &stat_positions)?;
    app.emit("graphPositions:changed", &graph_positions)?;
    app.emit("knobPositions:changed", &knob_positions)?;
    app.emit("layerGroups:changed", &layer_groups)?;
    app.emit(
        "customTabs:changed",
        &CustomTabChangePayload {
            custom_tabs: custom_tabs.clone(),
            selected_key_type: selected_key_type.clone(),
        },
    )?;
    app.emit(
        "keys:mode-changed",
        &serde_json::json!({ "mode": &selected_key_type }),
    )?;
    app.emit("css:use", &serde_json::json!({ "enabled": false }))?;
    app.emit(
        "css:content",
        &serde_json::json!({ "path": serde_json::Value::Null, "content": "" }),
    )?;
    app.emit("tabNote:changed_all", &tab_note_overrides)?;
    for tab_id in cleared_tab_css_ids {
        app.emit(
            "tabCss:changed",
            &crate::commands::editor::css::TabCssResponse { tab_id, css: None },
        )?;
    }
    state.obs_broadcast_counters();
    state.refresh_obs_snapshot();

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
    mode: String,
) -> CmdResult<ResetModeResponse> {
    let snapshot = state.store.snapshot();
    let Some(kind) = reset_mode_kind(&snapshot, &mode) else {
        return Ok(ResetModeResponse {
            success: false,
            mode,
        });
    };
    let cleared_tab_css = snapshot.tab_css_overrides.contains_key(&mode);
    let updated = state.update_store_with_key_counter_mirror_and_emit(&app, |store| {
        reset_mode_data(store, &mode, kind);
    })?;

    state.keyboard.update_mappings(updated.keys.clone());

    if cleared_tab_css {
        state.unwatch_tab_css(&mode);
    }

    app.emit("keys:changed", &updated.keys)?;
    app.emit("positions:changed", &updated.key_positions)?;
    app.emit("statPositions:changed", &updated.stat_positions)?;
    app.emit("graphPositions:changed", &updated.graph_positions)?;
    app.emit("knobPositions:changed", &updated.knob_positions)?;
    app.emit("layerGroups:changed", &updated.layer_groups)?;
    app.emit("tabNote:changed_all", &updated.tab_note_overrides)?;
    if cleared_tab_css {
        app.emit(
            "tabCss:changed",
            &crate::commands::editor::css::TabCssResponse {
                tab_id: mode.clone(),
                css: None,
            },
        )?;
    }
    state.obs_broadcast_counters();
    state.refresh_obs_snapshot();

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
    name: String,
) -> CmdResult<CustomTabCreateResult> {
    if name.trim().is_empty() {
        return Ok(CustomTabCreateResult {
            result: None,
            error: Some("invalid-name".to_string()),
        });
    }

    let trimmed = name.trim().to_string();
    let snapshot = state.store.snapshot();
    if snapshot.custom_tabs.iter().any(|tab| tab.name == trimmed) {
        return Ok(CustomTabCreateResult {
            result: None,
            error: Some("duplicate-name".to_string()),
        });
    }
    if snapshot.custom_tabs.len() >= MAX_CUSTOM_TABS {
        return Ok(CustomTabCreateResult {
            result: None,
            error: Some("max-reached".to_string()),
        });
    }

    let id = generate_custom_tab_id();
    let tab = CustomTab {
        id: id.clone(),
        name: trimmed.clone(),
    };

    let mut custom_tabs = snapshot.custom_tabs.clone();
    custom_tabs.push(tab.clone());

    let mut keys = snapshot.keys.clone();
    keys.insert(id.clone(), Vec::new());
    let mut positions = snapshot.key_positions.clone();
    positions.insert(id.clone(), Vec::new());

    state.store.update(|store| {
        store.custom_tabs = custom_tabs.clone();
        store.keys = keys.clone();
        store.key_positions = positions.clone();
        store.selected_key_type = id.clone();
    })?;

    state
        .keyboard
        .update_mappings_and_set_mode(keys.clone(), id.clone());
    state.sync_counters_with_keys(&keys);
    state.reset_mode_counters(&app, &id)?;

    app.emit(
        "customTabs:changed",
        &CustomTabChangePayload {
            custom_tabs: custom_tabs.clone(),
            selected_key_type: id.clone(),
        },
    )?;
    app.emit("keys:changed", &keys)?;
    app.emit("positions:changed", &positions)?;
    app.emit("keys:mode-changed", &serde_json::json!({ "mode": &id }))?;
    state.obs_broadcast_counters();
    state.refresh_obs_snapshot();

    Ok(CustomTabCreateResult {
        result: Some(tab),
        error: None,
    })
}

#[tauri::command]
pub fn custom_tabs_delete(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
) -> CmdResult<CustomTabDeleteResult> {
    let snapshot = state.store.snapshot();
    let Some(plan) = plan_custom_tab_delete(&snapshot, &id) else {
        return Ok(CustomTabDeleteResult {
            success: false,
            selected: snapshot.selected_key_type,
            error: Some("not-found".to_string()),
        });
    };
    let updated = state.update_store_with_key_counter_mirror_and_emit(&app, |store| {
        delete_custom_tab_data(store, &id, &plan);
    })?;

    state
        .keyboard
        .update_mappings_and_set_mode(updated.keys.clone(), updated.selected_key_type.clone());
    state.unwatch_tab_css(&id);

    app.emit(
        "customTabs:changed",
        &CustomTabChangePayload {
            custom_tabs: updated.custom_tabs.clone(),
            selected_key_type: updated.selected_key_type.clone(),
        },
    )?;
    app.emit("keys:changed", &updated.keys)?;
    app.emit("positions:changed", &updated.key_positions)?;
    app.emit("statPositions:changed", &updated.stat_positions)?;
    app.emit("graphPositions:changed", &updated.graph_positions)?;
    app.emit("knobPositions:changed", &updated.knob_positions)?;
    app.emit("layerGroups:changed", &updated.layer_groups)?;
    app.emit("tabNote:changed_all", &updated.tab_note_overrides)?;
    app.emit(
        "tabCss:changed",
        &crate::commands::editor::css::TabCssResponse {
            tab_id: id,
            css: None,
        },
    )?;
    app.emit(
        "keys:mode-changed",
        &serde_json::json!({ "mode": &updated.selected_key_type }),
    )?;
    state.obs_broadcast_counters();
    state.refresh_obs_snapshot();

    Ok(CustomTabDeleteResult {
        success: true,
        selected: updated.selected_key_type,
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
    id: String,
) -> CmdResult<CustomTabSelectResult> {
    let snapshot = state.store.snapshot();
    if !is_selectable_mode(&snapshot, &id) {
        return Ok(CustomTabSelectResult {
            success: false,
            selected: snapshot.selected_key_type,
            error: Some("not-found".to_string()),
        });
    }

    let selected = state.store.set_selected_key_type(id)?;
    state.keyboard.set_mode(selected.clone());

    app.emit(
        "keys:mode-changed",
        &serde_json::json!({ "mode": &selected }),
    )?;
    state.refresh_obs_snapshot();

    Ok(CustomTabSelectResult {
        success: true,
        selected,
        error: None,
    })
}

/// undo/redo 시 커스텀 탭 목록 + 모드를 원자적으로 복원
#[tauri::command]
pub fn custom_tabs_restore(
    state: State<'_, AppState>,
    app: AppHandle,
    custom_tabs: Vec<CustomTab>,
    selected_key_type: String,
) -> CmdResult<()> {
    let updated = state.store.update(|store| {
        store.custom_tabs = custom_tabs.clone();
        store.selected_key_type = selected_key_type.clone();
    })?;

    state.keyboard.set_mode(updated.selected_key_type.clone());

    app.emit(
        "customTabs:changed",
        &CustomTabChangePayload {
            custom_tabs: updated.custom_tabs,
            selected_key_type: updated.selected_key_type.clone(),
        },
    )?;
    app.emit(
        "keys:mode-changed",
        &serde_json::json!({ "mode": &updated.selected_key_type }),
    )?;
    state.refresh_obs_snapshot();
    Ok(())
}

#[tauri::command]
pub fn keys_reset_counters(state: State<'_, AppState>, app: AppHandle) -> CmdResult<KeyCounters> {
    let snapshot = state.reset_key_counters(&app)?;
    state.obs_broadcast_counters();
    Ok(snapshot)
}

#[tauri::command]
pub fn keys_reset_counters_mode(
    state: State<'_, AppState>,
    app: AppHandle,
    mode: String,
) -> CmdResult<KeyCounters> {
    let snapshot = state.reset_mode_counters(&app, &mode)?;
    state.obs_broadcast_counters();
    Ok(snapshot)
}

#[tauri::command]
pub fn keys_reset_single_counter(
    state: State<'_, AppState>,
    app: AppHandle,
    mode: String,
    key: String,
) -> CmdResult<KeyCounters> {
    let snapshot = state.reset_single_key_counter(&app, &mode, &key)?;
    state.obs_broadcast_counters();
    Ok(snapshot)
}

#[tauri::command]
pub fn keys_set_counters(
    state: State<'_, AppState>,
    app: AppHandle,
    counters: KeyCounters,
) -> CmdResult<KeyCounters> {
    let keys_snapshot = state.store.snapshot().keys;
    let updated = state.replace_key_counters(&app, counters, &keys_snapshot)?;
    state.obs_broadcast_counters();
    Ok(updated)
}

#[tauri::command]
pub fn layer_groups_get(state: State<'_, AppState>) -> CmdResult<LayerGroups> {
    Ok(state.store.snapshot().layer_groups)
}

#[tauri::command]
pub fn layer_groups_update(
    state: State<'_, AppState>,
    app: AppHandle,
    groups: LayerGroups,
) -> CmdResult<LayerGroups> {
    let updated = state.store.update_layer_groups(groups)?;
    app.emit("layerGroups:changed", &updated)?;
    state.refresh_obs_snapshot();
    Ok(updated)
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
        reset_mode_kind, set_mode_with, ModeResetKind,
    };
    use crate::{
        defaults::{default_keys, default_positions},
        keyboard::KeyboardManager,
        models::{
            AppStoreData, CustomTab, GraphPosition, GraphStatType, GraphType, KnobPosition,
            LayerGroupDef, StatPosition, StatType, TabCss, TabNoteSettings,
        },
    };
    use std::cell::Cell;

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
            .insert(TARGET_TAB.to_string(), vec!["KeyD".to_string()]);
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
            .insert("ghost-mode".to_string(), vec!["KeyA".to_string()]);
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
}
