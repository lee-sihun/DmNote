use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::{
    app_state::AppState,
    defaults::{default_keys, default_positions},
    models::{
        CustomCssPatch, CustomTab, KeyCounters, KeyMappings, KeyPositions, LayerGroups, NoteSettings,
        NoteSettingsPatch, SettingsPatchInput,
    },
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

#[tauri::command(permission = "dmnote-allow-all")]
pub fn keys_get(state: State<'_, AppState>) -> Result<KeyMappings, String> {
    Ok(state.store.snapshot().keys)
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn positions_get(state: State<'_, AppState>) -> Result<KeyPositions, String> {
    Ok(state.store.snapshot().key_positions)
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn keys_update(
    state: State<'_, AppState>,
    app: AppHandle,
    mappings: KeyMappings,
) -> Result<KeyMappings, String> {
    let updated = state
        .store
        .update_keys(mappings)
        .map_err(|err| err.to_string())?;
    state.keyboard.update_mappings(updated.clone());
    app.emit("keys:changed", &updated)
        .map_err(|err| err.to_string())?;
    state.sync_counters_with_keys(&updated);
    app.emit("keys:counters", &state.snapshot_key_counters())
        .map_err(|err| err.to_string())?;
    Ok(updated)
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn positions_update(
    state: State<'_, AppState>,
    app: AppHandle,
    positions: KeyPositions,
) -> Result<KeyPositions, String> {
    let updated = state
        .store
        .update_positions(positions)
        .map_err(|err| err.to_string())?;
    app.emit("positions:changed", &updated)
        .map_err(|err| err.to_string())?;
    Ok(updated)
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn keys_set_mode(
    state: State<'_, AppState>,
    app: AppHandle,
    mode: String,
) -> Result<ModeResponse, String> {
    let success = state.keyboard.set_mode(mode.clone());
    let effective = if success {
        mode
    } else {
        state.keyboard.current_mode()
    };

    state
        .store
        .set_selected_key_type(effective.clone())
        .map_err(|err| err.to_string())?;

    app.emit(
        "keys:mode-changed",
        &serde_json::json!({ "mode": &effective }),
    )
    .map_err(|err| err.to_string())?;
    Ok(ModeResponse {
        success,
        mode: effective,
    })
}
#[tauri::command(permission = "dmnote-allow-all")]
pub fn keys_reset_all(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ResetAllResponse, String> {
    let keys = default_keys().clone();
    let positions = default_positions().clone();
    let selected_key_type = "4key".to_string();
    let custom_tabs: Vec<CustomTab> = Vec::new();

    state
        .store
        .update(|store| {
            store.keys = keys.clone();
            store.key_positions = positions.clone();
            store.custom_tabs = custom_tabs.clone();
            store.selected_key_type = selected_key_type.clone();
        })
        .map_err(|err| err.to_string())?;

    state.keyboard.update_mappings(keys.clone());
    state.keyboard.set_mode(selected_key_type.clone());
    state.sync_counters_with_keys(&keys);
    let counters_snapshot = state.reset_key_counters();
    state
        .persist_key_counters()
        .map_err(|err| err.to_string())?;

    let mut note_patch = NoteSettingsPatch::default();
    let defaults = NoteSettings::default();
    note_patch.frame_limit = Some(defaults.frame_limit);
    note_patch.speed = Some(defaults.speed);
    note_patch.track_height = Some(defaults.track_height);
    note_patch.reverse = Some(defaults.reverse);
    note_patch.fade_position = Some(defaults.fade_position.clone());
    note_patch.delayed_note_enabled = Some(defaults.delayed_note_enabled);
    note_patch.short_note_threshold_ms = Some(defaults.short_note_threshold_ms);
    note_patch.short_note_min_length_px = Some(defaults.short_note_min_length_px);

    let settings_diff = state
        .settings
        .apply_patch(SettingsPatchInput {
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
        })
        .map_err(|err| err.to_string())?;

    state
        .emit_settings_changed(&settings_diff, &app)
        .map_err(|err| err.to_string())?;

    app.emit("keys:changed", &keys)
        .map_err(|err| err.to_string())?;
    app.emit("positions:changed", &positions)
        .map_err(|err| err.to_string())?;
    app.emit(
        "customTabs:changed",
        &CustomTabChangePayload {
            custom_tabs: custom_tabs.clone(),
            selected_key_type: selected_key_type.clone(),
        },
    )
    .map_err(|err| err.to_string())?;
    app.emit(
        "keys:mode-changed",
        &serde_json::json!({ "mode": &selected_key_type }),
    )
    .map_err(|err| err.to_string())?;
    app.emit("css:use", &serde_json::json!({ "enabled": false }))
        .map_err(|err| err.to_string())?;
    app.emit(
        "css:content",
        &serde_json::json!({ "path": serde_json::Value::Null, "content": "" }),
    )
    .map_err(|err| err.to_string())?;
    app.emit("keys:counters", &counters_snapshot)
        .map_err(|err| err.to_string())?;

    Ok(ResetAllResponse {
        keys,
        positions,
        custom_tabs,
        selected_key_type,
    })
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn keys_reset_mode(
    state: State<'_, AppState>,
    app: AppHandle,
    mode: String,
) -> Result<ResetModeResponse, String> {
    let defaults = default_keys();
    if !defaults.contains_key(&mode) {
        return Ok(ResetModeResponse {
            success: false,
            mode,
        });
    }

    let default_pos = default_positions();

    let mut keys = state.store.snapshot().keys;
    if let Some(value) = defaults.get(&mode) {
        keys.insert(mode.clone(), value.clone());
    }
    let mut positions = state.store.snapshot().key_positions;
    if let Some(value) = default_pos.get(&mode) {
        positions.insert(mode.clone(), value.clone());
    }

    state
        .store
        .update(|store| {
            store.keys = keys.clone();
            store.key_positions = positions.clone();
        })
        .map_err(|err| err.to_string())?;

    state.keyboard.update_mappings(keys.clone());
    state.sync_counters_with_keys(&keys);
    state.reset_mode_counters(&mode);
    state
        .persist_key_counters()
        .map_err(|err| err.to_string())?;

    app.emit("keys:changed", &keys)
        .map_err(|err| err.to_string())?;
    app.emit("positions:changed", &positions)
        .map_err(|err| err.to_string())?;
    app.emit("keys:counters", &state.snapshot_key_counters())
        .map_err(|err| err.to_string())?;

    Ok(ResetModeResponse {
        success: true,
        mode,
    })
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn custom_tabs_list(state: State<'_, AppState>) -> Result<Vec<CustomTab>, String> {
    Ok(state.store.snapshot().custom_tabs)
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn custom_tabs_create(
    state: State<'_, AppState>,
    app: AppHandle,
    name: String,
) -> Result<CustomTabCreateResult, String> {
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

    state
        .store
        .update(|store| {
            store.custom_tabs = custom_tabs.clone();
            store.keys = keys.clone();
            store.key_positions = positions.clone();
            store.selected_key_type = id.clone();
        })
        .map_err(|err| err.to_string())?;

    state.keyboard.update_mappings(keys.clone());
    state.keyboard.set_mode(id.clone());
    state.sync_counters_with_keys(&keys);
    state.reset_mode_counters(&id);
    state
        .persist_key_counters()
        .map_err(|err| err.to_string())?;

    app.emit(
        "customTabs:changed",
        &CustomTabChangePayload {
            custom_tabs: custom_tabs.clone(),
            selected_key_type: id.clone(),
        },
    )
    .map_err(|err| err.to_string())?;
    app.emit("keys:changed", &keys)
        .map_err(|err| err.to_string())?;
    app.emit("positions:changed", &positions)
        .map_err(|err| err.to_string())?;
    app.emit("keys:mode-changed", &serde_json::json!({ "mode": &id }))
        .map_err(|err| err.to_string())?;
    app.emit("keys:counters", &state.snapshot_key_counters())
        .map_err(|err| err.to_string())?;

    Ok(CustomTabCreateResult {
        result: Some(tab),
        error: None,
    })
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn custom_tabs_delete(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
) -> Result<CustomTabDeleteResult, String> {
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

    state
        .store
        .update(|store| {
            store.custom_tabs = custom_tabs.clone();
            store.keys = keys.clone();
            store.key_positions = positions.clone();
            store.selected_key_type = next_selected.clone();
        })
        .map_err(|err| err.to_string())?;

    state.keyboard.update_mappings(keys.clone());
    state.keyboard.set_mode(next_selected.clone());
    state.sync_counters_with_keys(&keys);
    state
        .persist_key_counters()
        .map_err(|err| err.to_string())?;

    app.emit(
        "customTabs:changed",
        &CustomTabChangePayload {
            custom_tabs: custom_tabs.clone(),
            selected_key_type: next_selected.clone(),
        },
    )
    .map_err(|err| err.to_string())?;
    app.emit("keys:changed", &keys)
        .map_err(|err| err.to_string())?;
    app.emit("positions:changed", &positions)
        .map_err(|err| err.to_string())?;
    app.emit(
        "keys:mode-changed",
        &serde_json::json!({ "mode": &next_selected }),
    )
    .map_err(|err| err.to_string())?;
    app.emit("keys:counters", &state.snapshot_key_counters())
        .map_err(|err| err.to_string())?;

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

#[tauri::command(permission = "dmnote-allow-all")]
pub fn custom_tabs_select(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
) -> Result<CustomTabSelectResult, String> {
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

    state
        .store
        .set_selected_key_type(id.clone())
        .map_err(|err| err.to_string())?;
    state.keyboard.set_mode(id.clone());

    app.emit("keys:mode-changed", &serde_json::json!({ "mode": &id }))
        .map_err(|err| err.to_string())?;

    Ok(CustomTabSelectResult {
        success: true,
        selected: id,
        error: None,
    })
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn keys_reset_counters(state: State<'_, AppState>, app: AppHandle) -> Result<KeyCounters, String> {
    let snapshot = state.reset_key_counters();
    state
        .persist_key_counters()
        .map_err(|err| err.to_string())?;
    app.emit("keys:counters", &snapshot)
        .map_err(|err| err.to_string())?;
    Ok(snapshot)
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn keys_reset_counters_mode(
    state: State<'_, AppState>,
    app: AppHandle,
    mode: String,
) -> Result<KeyCounters, String> {
    state.reset_mode_counters(&mode);
    state
        .persist_key_counters()
        .map_err(|err| err.to_string())?;
    let snapshot = state.snapshot_key_counters();
    app.emit("keys:counters", &snapshot)
        .map_err(|err| err.to_string())?;
    Ok(snapshot)
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn keys_reset_single_counter(
    state: State<'_, AppState>,
    app: AppHandle,
    mode: String,
    key: String,
) -> Result<KeyCounters, String> {
    state.reset_single_key_counter(&mode, &key);
    state
        .persist_key_counters()
        .map_err(|err| err.to_string())?;
    let snapshot = state.snapshot_key_counters();
    app.emit("keys:counters", &snapshot)
        .map_err(|err| err.to_string())?;
    Ok(snapshot)
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn keys_set_counters(
    state: State<'_, AppState>,
    app: AppHandle,
    counters: KeyCounters,
) -> Result<KeyCounters, String> {
    let keys_snapshot = state.store.snapshot().keys;
    let updated = state
        .replace_key_counters(counters, &keys_snapshot)
        .map_err(|err| err.to_string())?;
    app.emit("keys:counters", &updated)
        .map_err(|err| err.to_string())?;
    Ok(updated)
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn layer_groups_get(state: State<'_, AppState>) -> Result<LayerGroups, String> {
    Ok(state.store.snapshot().layer_groups)
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn layer_groups_update(
    state: State<'_, AppState>,
    app: AppHandle,
    groups: LayerGroups,
) -> Result<LayerGroups, String> {
    let updated = state
        .store
        .update_layer_groups(groups)
        .map_err(|err| err.to_string())?;
    app.emit("layerGroups:changed", &updated)
        .map_err(|err| err.to_string())?;
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
#[tauri::command(permission = "dmnote-allow-all")]
pub fn raw_input_subscribe(state: State<'_, AppState>) -> Result<RawInputSubscribeResponse, String> {
    let count = state.subscribe_raw_input();
    log::debug!("[RawInput] Subscribe: count = {}", count);
    Ok(RawInputSubscribeResponse { count })
}

/// Unsubscribe from raw input stream (decrement subscriber count)
#[tauri::command(permission = "dmnote-allow-all")]
pub fn raw_input_unsubscribe(state: State<'_, AppState>) -> Result<RawInputSubscribeResponse, String> {
    let count = state.unsubscribe_raw_input();
    log::debug!("[RawInput] Unsubscribe: count = {}", count);
    Ok(RawInputSubscribeResponse { count })
}
