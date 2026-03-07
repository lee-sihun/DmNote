use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::{
    defaults::{default_keys, default_positions},
    errors::CmdResult,
    models::{
        CustomCssPatch, CustomTab, KeyCounters, KeyMappings, KeyPositions, LayerGroups,
        NoteSettings, NoteSettingsPatch, SettingsPatchInput,
    },
    state::AppState,
};

const MAX_CUSTOM_TABS: usize = 30;

#[derive(Serialize)]
pub struct ModeResponse {
    pub success: bool,
    pub mode: String,
}

#[derive(Serialize)]
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
pub fn keys_update(
    state: State<'_, AppState>,
    app: AppHandle,
    mappings: KeyMappings,
) -> CmdResult<KeyMappings> {
    let updated = state.store.update_keys(mappings)?;
    state.keyboard.update_mappings(updated.clone());
    app.emit("keys:changed", &updated)?;
    state.sync_counters_with_keys(&updated);
    app.emit("keys:counters", &state.snapshot_key_counters())?;
    Ok(updated)
}

#[tauri::command]
pub fn positions_update(
    state: State<'_, AppState>,
    app: AppHandle,
    positions: KeyPositions,
) -> CmdResult<KeyPositions> {
    let updated = state.store.update_positions(positions)?;
    app.emit("positions:changed", &updated)?;
    Ok(updated)
}

#[tauri::command]
pub fn keys_set_mode(
    state: State<'_, AppState>,
    app: AppHandle,
    mode: String,
) -> CmdResult<ModeResponse> {
    let success = state.keyboard.set_mode(mode.clone());
    let effective = if success {
        mode
    } else {
        state.keyboard.current_mode()
    };

    state.transfer_active_keys(&effective);
    state.store.set_selected_key_type(effective.clone())?;

    app.emit(
        "keys:mode-changed",
        &serde_json::json!({ "mode": &effective }),
    )?;
    Ok(ModeResponse {
        success,
        mode: effective,
    })
}

#[tauri::command]
pub fn keys_reset_all(state: State<'_, AppState>, app: AppHandle) -> CmdResult<ResetAllResponse> {
    let keys = default_keys().clone();
    let positions = default_positions().clone();
    let stat_positions = crate::models::StatPositions::new();
    let graph_positions = crate::models::GraphPositions::new();
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

    state.store.update(|store| {
        store.keys = keys.clone();
        store.key_positions = positions.clone();
        store.stat_positions = stat_positions.clone();
        store.graph_positions = graph_positions.clone();
        store.layer_groups = layer_groups.clone();
        store.custom_tabs = custom_tabs.clone();
        store.selected_key_type = selected_key_type.clone();
        store.tab_note_overrides = tab_note_overrides.clone();
        store.tab_css_overrides.clear();
    })?;

    for tab_id in &cleared_tab_css_ids {
        state.unwatch_tab_css(tab_id);
    }

    state.keyboard.update_mappings(keys.clone());
    state.keyboard.set_mode(selected_key_type.clone());
    state.sync_counters_with_keys(&keys);
    let counters_snapshot = state.reset_key_counters();
    state.persist_key_counters()?;

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
    app.emit("keys:counters", &counters_snapshot)?;

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
    let defaults = default_keys();
    if !defaults.contains_key(&mode) {
        return Ok(ResetModeResponse {
            success: false,
            mode,
        });
    }

    let default_pos = default_positions();

    let snapshot = state.store.snapshot();
    let mut keys = snapshot.keys;
    if let Some(value) = defaults.get(&mode) {
        keys.insert(mode.clone(), value.clone());
    }
    let mut positions = snapshot.key_positions;
    if let Some(value) = default_pos.get(&mode) {
        positions.insert(mode.clone(), value.clone());
    }
    let mut stat_positions = snapshot.stat_positions;
    stat_positions.insert(mode.clone(), Vec::new());
    let mut graph_positions = snapshot.graph_positions;
    graph_positions.insert(mode.clone(), Vec::new());
    let mut layer_groups = snapshot.layer_groups;
    layer_groups.remove(&mode);
    let mut tab_note_overrides = snapshot.tab_note_overrides;
    tab_note_overrides.remove(&mode);
    let mut tab_css_overrides = snapshot.tab_css_overrides;
    let cleared_tab_css = tab_css_overrides.remove(&mode).is_some();

    state.store.update(|store| {
        store.keys = keys.clone();
        store.key_positions = positions.clone();
        store.stat_positions = stat_positions.clone();
        store.graph_positions = graph_positions.clone();
        store.layer_groups = layer_groups.clone();
        store.tab_note_overrides = tab_note_overrides.clone();
        store.tab_css_overrides = tab_css_overrides.clone();
    })?;

    if cleared_tab_css {
        state.unwatch_tab_css(&mode);
    }

    state.keyboard.update_mappings(keys.clone());
    state.sync_counters_with_keys(&keys);
    state.reset_mode_counters(&mode);
    state.persist_key_counters()?;

    app.emit("keys:changed", &keys)?;
    app.emit("positions:changed", &positions)?;
    app.emit("statPositions:changed", &stat_positions)?;
    app.emit("graphPositions:changed", &graph_positions)?;
    app.emit("layerGroups:changed", &layer_groups)?;
    app.emit("tabNote:changed_all", &tab_note_overrides)?;
    if cleared_tab_css {
        app.emit(
            "tabCss:changed",
            &crate::commands::editor::css::TabCssResponse {
                tab_id: mode.clone(),
                css: None,
            },
        )?;
    }
    app.emit("keys:counters", &state.snapshot_key_counters())?;

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

    state.keyboard.update_mappings(keys.clone());
    state.keyboard.set_mode(id.clone());
    state.sync_counters_with_keys(&keys);
    state.reset_mode_counters(&id);
    state.persist_key_counters()?;

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
    app.emit("keys:counters", &state.snapshot_key_counters())?;

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
    if !snapshot.custom_tabs.iter().any(|tab| tab.id == id) {
        return Ok(CustomTabDeleteResult {
            success: false,
            selected: snapshot.selected_key_type,
            error: Some("not-found".to_string()),
        });
    }

    let custom_tabs: Vec<CustomTab> = snapshot
        .custom_tabs
        .iter()
        .cloned()
        .filter(|tab| tab.id != id)
        .collect();
    let mut keys = snapshot.keys.clone();
    let mut positions = snapshot.key_positions.clone();
    keys.remove(&id);
    positions.remove(&id);

    let next_selected = if snapshot.selected_key_type == id {
        if let Some((index, _)) = snapshot
            .custom_tabs
            .iter()
            .enumerate()
            .find(|(_, tab)| tab.id == id)
        {
            if !custom_tabs.is_empty() {
                let pick = if index > 0 { index - 1 } else { 0 };
                custom_tabs[pick].id.clone()
            } else {
                "8key".to_string()
            }
        } else {
            "8key".to_string()
        }
    } else {
        snapshot.selected_key_type.clone()
    };

    state.store.update(|store| {
        store.custom_tabs = custom_tabs.clone();
        store.keys = keys.clone();
        store.key_positions = positions.clone();
        store.selected_key_type = next_selected.clone();
    })?;

    state.keyboard.update_mappings(keys.clone());
    state.keyboard.set_mode(next_selected.clone());
    state.sync_counters_with_keys(&keys);
    state.persist_key_counters()?;

    app.emit(
        "customTabs:changed",
        &CustomTabChangePayload {
            custom_tabs: custom_tabs.clone(),
            selected_key_type: next_selected.clone(),
        },
    )?;
    app.emit("keys:changed", &keys)?;
    app.emit("positions:changed", &positions)?;
    app.emit(
        "keys:mode-changed",
        &serde_json::json!({ "mode": &next_selected }),
    )?;
    app.emit("keys:counters", &state.snapshot_key_counters())?;

    Ok(CustomTabDeleteResult {
        success: true,
        selected: next_selected,
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
    let defaults = default_keys();
    let exists = defaults.contains_key(&id) || snapshot.custom_tabs.iter().any(|tab| tab.id == id);
    if !exists {
        return Ok(CustomTabSelectResult {
            success: false,
            selected: snapshot.selected_key_type,
            error: Some("not-found".to_string()),
        });
    }

    state.store.set_selected_key_type(id.clone())?;
    state.keyboard.set_mode(id.clone());
    state.transfer_active_keys(&id);

    app.emit("keys:mode-changed", &serde_json::json!({ "mode": &id }))?;

    Ok(CustomTabSelectResult {
        success: true,
        selected: id,
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
    state.store.update(|store| {
        store.custom_tabs = custom_tabs.clone();
        store.selected_key_type = selected_key_type.clone();
    })?;

    state.keyboard.set_mode(selected_key_type.clone());
    state.transfer_active_keys(&selected_key_type);

    app.emit(
        "customTabs:changed",
        &CustomTabChangePayload {
            custom_tabs,
            selected_key_type: selected_key_type.clone(),
        },
    )?;
    app.emit(
        "keys:mode-changed",
        &serde_json::json!({ "mode": &selected_key_type }),
    )?;
    Ok(())
}

#[tauri::command]
pub fn keys_reset_counters(state: State<'_, AppState>, app: AppHandle) -> CmdResult<KeyCounters> {
    let snapshot = state.reset_key_counters();
    state.persist_key_counters()?;
    app.emit("keys:counters", &snapshot)?;
    Ok(snapshot)
}

#[tauri::command]
pub fn keys_reset_counters_mode(
    state: State<'_, AppState>,
    app: AppHandle,
    mode: String,
) -> CmdResult<KeyCounters> {
    state.reset_mode_counters(&mode);
    state.persist_key_counters()?;
    let snapshot = state.snapshot_key_counters();
    app.emit("keys:counters", &snapshot)?;
    Ok(snapshot)
}

#[tauri::command]
pub fn keys_reset_single_counter(
    state: State<'_, AppState>,
    app: AppHandle,
    mode: String,
    key: String,
) -> CmdResult<KeyCounters> {
    state.reset_single_key_counter(&mode, &key);
    state.persist_key_counters()?;
    let snapshot = state.snapshot_key_counters();
    app.emit("keys:counters", &snapshot)?;
    Ok(snapshot)
}

#[tauri::command]
pub fn keys_set_counters(
    state: State<'_, AppState>,
    app: AppHandle,
    counters: KeyCounters,
) -> CmdResult<KeyCounters> {
    let keys_snapshot = state.store.snapshot().keys;
    let updated = state.replace_key_counters(counters, &keys_snapshot)?;
    app.emit("keys:counters", &updated)?;
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
