use std::fs;

use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::{
    app_state::AppState,
    defaults::{default_keys, default_positions},
    models::{
        CustomCss, CustomCssPatch, CustomJs, CustomJsPatch, CustomTab, KeyMappings, KeyPositions,
        NoteSettings, NoteSettingsPatch, SettingsPatchInput, StatPositions,
    },
};

#[derive(Serialize)]
pub struct PresetOperationResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PresetFile {
    keys: Option<KeyMappings>,
    key_positions: Option<KeyPositions>,
    stat_positions: Option<StatPositions>,
    background_color: Option<String>,
    note_settings: Option<NoteSettings>,
    note_effect: Option<bool>,
    laboratory_enabled: Option<bool>,
    custom_tabs: Option<Vec<CustomTab>>,
    selected_key_type: Option<String>,
    #[serde(rename = "useCustomCSS")]
    use_custom_css: Option<bool>,
    #[serde(rename = "customCSS")]
    custom_css: Option<CustomCss>,
    #[serde(rename = "useCustomJS")]
    use_custom_js: Option<bool>,
    #[serde(rename = "customJS")]
    custom_js: Option<CustomJs>,
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn preset_save(state: State<'_, AppState>) -> Result<PresetOperationResult, String> {
    let preset_path = FileDialog::new()
        .set_file_name("preset.json")
        .add_filter("DM NOTE Preset", &["json"])
        .save_file();

    let Some(path) = preset_path else {
        return Ok(PresetOperationResult {
            success: false,
            error: None,
        });
    };

    let snapshot = state.store.snapshot();
    let preset = PresetFile {
        keys: Some(snapshot.keys),
        key_positions: Some(snapshot.key_positions),
        stat_positions: Some(snapshot.stat_positions),
        background_color: Some(snapshot.background_color),
        note_settings: Some(snapshot.note_settings),
        note_effect: Some(snapshot.note_effect),
        laboratory_enabled: Some(snapshot.laboratory_enabled),
        custom_tabs: Some(snapshot.custom_tabs),
        selected_key_type: Some(snapshot.selected_key_type),
        use_custom_css: Some(snapshot.use_custom_css),
        custom_css: Some(snapshot.custom_css),
        use_custom_js: Some(snapshot.use_custom_js),
        custom_js: Some(snapshot.custom_js),
    };

    let json = serde_json::to_string_pretty(&preset).map_err(|err| err.to_string())?;
    fs::write(&path, json).map_err(|err| err.to_string())?;

    Ok(PresetOperationResult {
        success: true,
        error: None,
    })
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn preset_load(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<PresetOperationResult, String> {
    let picked = FileDialog::new()
        .add_filter("DM NOTE Preset", &["json"])
        .pick_file();

    let Some(path) = picked else {
        return Ok(PresetOperationResult {
            success: false,
            error: None,
        });
    };

    let content = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    let preset: PresetFile =
        serde_json::from_str(&content).map_err(|_| "invalid-preset".to_string())?;

    let keys = preset.keys.unwrap_or_else(|| default_keys().clone());
    let positions = preset.key_positions.unwrap_or_else(|| default_positions().clone());
    let stat_positions = preset.stat_positions.unwrap_or_default();
    let custom_tabs = preset
        .custom_tabs
        .unwrap_or_else(|| synthesize_custom_tabs(&keys));
    let snapshot = state.store.snapshot();
    let selected_key_type =
        choose_selected_key_type(preset.selected_key_type, &keys, snapshot.selected_key_type);

    state
        .store
        .update(|store| {
            store.keys = keys.clone();
            store.key_positions = positions.clone();
            store.stat_positions = stat_positions.clone();
            store.custom_tabs = custom_tabs.clone();
            store.selected_key_type = selected_key_type.clone();
        })
        .map_err(|err| err.to_string())?;

    state.keyboard.update_mappings(keys.clone());
    state.keyboard.set_mode(selected_key_type.clone());

    let desired_settings = preset.note_settings.unwrap_or_else(NoteSettings::default);
    let mut note_patch = NoteSettingsPatch::default();
    note_patch.speed = Some(desired_settings.speed);
    note_patch.track_height = Some(desired_settings.track_height);
    note_patch.reverse = Some(desired_settings.reverse);
    note_patch.fade_position = Some(desired_settings.fade_position);
    note_patch.delayed_note_enabled = Some(desired_settings.delayed_note_enabled);
    note_patch.short_note_threshold_ms = Some(desired_settings.short_note_threshold_ms);
    note_patch.short_note_min_length_px = Some(desired_settings.short_note_min_length_px);

    let css_use = preset.use_custom_css.unwrap_or(false);
    let custom_css = preset.custom_css.unwrap_or_default();
    let js_use = preset.use_custom_js.unwrap_or(false);
    let custom_js = preset.custom_js.unwrap_or_default();

    let diff = state
        .settings
        .apply_patch(SettingsPatchInput {
            background_color: Some(
                preset
                    .background_color
                    .unwrap_or_else(|| "transparent".to_string()),
            ),
            note_settings: Some(note_patch),
            note_effect: Some(preset.note_effect.unwrap_or(false)),
            laboratory_enabled: Some(preset.laboratory_enabled.unwrap_or(false)),
            use_custom_css: Some(css_use),
            custom_css: Some(CustomCssPatch {
                path: Some(custom_css.path.clone()),
                content: Some(custom_css.content.clone()),
            }),
            use_custom_js: Some(js_use),
            custom_js: Some(CustomJsPatch {
                path: Some(custom_js.path.clone()),
                content: Some(custom_js.content.clone()),
                plugins: Some(custom_js.plugins.clone()),
            }),
            ..SettingsPatchInput::default()
        })
        .map_err(|err| err.to_string())?;

    state
        .emit_settings_changed(&diff, &app)
        .map_err(|err| err.to_string())?;

    app.emit("keys:changed", &keys)
        .map_err(|err| err.to_string())?;
    app.emit("positions:changed", &positions)
        .map_err(|err| err.to_string())?;
    app.emit("statPositions:changed", &stat_positions)
        .map_err(|err| err.to_string())?;
    app.emit(
        "customTabs:changed",
        &crate::commands::keys::CustomTabChangePayload {
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
    app.emit("css:use", &serde_json::json!({ "enabled": css_use }))
        .map_err(|err| err.to_string())?;
    app.emit("css:content", &custom_css)
        .map_err(|err| err.to_string())?;
    app.emit("js:use", &serde_json::json!({ "enabled": js_use }))
        .map_err(|err| err.to_string())?;
    app.emit("js:content", &custom_js)
        .map_err(|err| err.to_string())?;

    Ok(PresetOperationResult {
        success: true,
        error: None,
    })
}

fn synthesize_custom_tabs(keys: &KeyMappings) -> Vec<CustomTab> {
    let default_modes = default_keys();
    let mut index = 0usize;
    keys.keys()
        .filter(|key| !default_modes.contains_key(*key))
        .map(|id| {
            index += 1;
            CustomTab {
                id: id.clone(),
                name: format!("Custom {}", index),
            }
        })
        .collect()
}

fn choose_selected_key_type(
    requested: Option<String>,
    keys: &KeyMappings,
    fallback: String,
) -> String {
    if let Some(req) = requested {
        if keys.contains_key(&req) {
            return req;
        }
    }
    if keys.contains_key(&fallback) {
        return fallback;
    }
    "4key".to_string()
}
