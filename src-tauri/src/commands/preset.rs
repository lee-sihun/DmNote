use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use crate::{
    app_state::AppState,
    defaults::{default_keys, default_positions},
    models::{
        CustomCss, CustomCssPatch, CustomJs, CustomJsPatch, CustomTab, KeyMappings, KeyPositions,
        FontSettings, FontType, NoteSettings, NoteSettingsPatch, SettingsPatchInput, StatPositions,
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
    font_settings: Option<FontSettings>,
    embedded_local_fonts: Option<Vec<EmbeddedLocalFont>>,
}

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct EmbeddedLocalFont {
    font_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    extension: Option<String>,
    data_base64: String,
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
    let used_font_families = collect_used_font_families(&snapshot.key_positions, &snapshot.stat_positions);
    let (font_settings, embedded_local_fonts) =
        build_preset_font_payload(&snapshot.font_settings, &used_font_families)?;

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
        font_settings: Some(font_settings),
        embedded_local_fonts: (!embedded_local_fonts.is_empty()).then_some(embedded_local_fonts),
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
    let has_font_settings = preset.font_settings.is_some();
    let mut preset_font_settings = preset.font_settings.clone().unwrap_or_default();
    if has_font_settings {
        restore_preset_local_fonts(
            &app,
            &mut preset_font_settings,
            preset.embedded_local_fonts.as_deref(),
        )?;
    }

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
            font_settings: has_font_settings.then_some(preset_font_settings),
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

fn collect_used_font_families(
    key_positions: &KeyPositions,
    stat_positions: &StatPositions,
) -> HashSet<String> {
    let mut used = HashSet::new();

    for positions in key_positions.values() {
        for position in positions {
            maybe_insert_font_family(position.font_family.as_ref(), &mut used);
            maybe_insert_font_family(position.counter.font_family.as_ref(), &mut used);
        }
    }

    for positions in stat_positions.values() {
        for stat_position in positions {
            maybe_insert_font_family(stat_position.position.font_family.as_ref(), &mut used);
            maybe_insert_font_family(stat_position.position.counter.font_family.as_ref(), &mut used);
        }
    }

    used
}

fn maybe_insert_font_family(value: Option<&String>, target: &mut HashSet<String>) {
    if let Some(font_family) = value {
        let trimmed = font_family.trim();
        if !trimmed.is_empty() {
            target.insert(trimmed.to_string());
        }
    }
}

fn build_preset_font_payload(
    font_settings: &FontSettings,
    used_font_families: &HashSet<String>,
) -> Result<(FontSettings, Vec<EmbeddedLocalFont>), String> {
    let mut exported_fonts = Vec::new();
    let mut embedded_local_fonts = Vec::new();

    for font in font_settings.custom_fonts.iter() {
        if !used_font_families.contains(&font.name) {
            continue;
        }

        let mut next_font = font.clone();

        if next_font.font_type == FontType::Local {
            let local_path = match next_font.local_path.clone() {
                Some(path) if !path.trim().is_empty() => path,
                _ => {
                    log::warn!(
                        "[Preset] Local font '{}' has no path; exporting as disabled fallback",
                        next_font.display_name
                    );
                    next_font.local_path = None;
                    next_font.css_content = None;
                    next_font.enabled = false;
                    exported_fonts.push(next_font);
                    continue;
                }
            };

            let source_path = PathBuf::from(local_path);
            let bytes = match fs::read(&source_path) {
                Ok(bytes) => bytes,
                Err(err) => {
                    log::warn!(
                        "[Preset] Failed to read local font '{}' from '{}': {err}. Exporting as disabled fallback",
                        next_font.display_name,
                        source_path.display()
                    );
                    next_font.local_path = None;
                    next_font.css_content = None;
                    next_font.enabled = false;
                    exported_fonts.push(next_font);
                    continue;
                }
            };

            let extension = normalize_font_extension(source_path.extension().and_then(|ext| ext.to_str()));
            embedded_local_fonts.push(EmbeddedLocalFont {
                font_id: next_font.id.clone(),
                extension: Some(extension),
                data_base64: BASE64_STANDARD.encode(bytes),
            });

            // Preset portability: paths are reconstructed at import time.
            next_font.local_path = None;
            next_font.css_content = None;
        }

        exported_fonts.push(next_font);
    }

    Ok((FontSettings { custom_fonts: exported_fonts }, embedded_local_fonts))
}

fn restore_preset_local_fonts(
    app: &AppHandle,
    font_settings: &mut FontSettings,
    embedded_local_fonts: Option<&[EmbeddedLocalFont]>,
) -> Result<(), String> {
    let has_local_fonts = font_settings
        .custom_fonts
        .iter()
        .any(|font| font.font_type == FontType::Local);
    if !has_local_fonts {
        return Ok(());
    }

    let embedded_map: HashMap<&str, &EmbeddedLocalFont> = embedded_local_fonts
        .unwrap_or(&[])
        .iter()
        .map(|font| (font.font_id.as_str(), font))
        .collect();

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("failed to resolve app data directory: {err}"))?;
    let fonts_dir = app_data_dir.join("fonts");
    fs::create_dir_all(&fonts_dir)
        .map_err(|err| format!("failed to create fonts directory: {err}"))?;

    for font in font_settings.custom_fonts.iter_mut() {
        if font.font_type != FontType::Local {
            continue;
        }

        // Local fonts should always be served from the copied file path.
        font.css_content = None;

        if let Some(embedded) = embedded_map.get(font.id.as_str()) {
            let bytes = match BASE64_STANDARD.decode(embedded.data_base64.as_bytes()) {
                Ok(bytes) => bytes,
                Err(err) => {
                    log::warn!(
                        "[Preset] Failed to decode embedded local font '{}': {err}",
                        font.display_name
                    );
                    font.local_path = None;
                    font.enabled = false;
                    continue;
                }
            };

            let extension = normalize_font_extension(embedded.extension.as_deref());
            let dest_path = fonts_dir.join(format!("{}.{}", Uuid::new_v4(), extension));
            if let Err(err) = fs::write(&dest_path, bytes) {
                log::warn!(
                    "[Preset] Failed to restore local font file for '{}': {err}",
                    font.display_name
                );
                font.local_path = None;
                font.enabled = false;
                continue;
            }
            font.local_path = Some(dest_path.to_string_lossy().to_string());
            continue;
        }

        // Backward compatibility: keep legacy absolute paths when available.
        let has_existing_valid_path = font
            .local_path
            .as_ref()
            .map(|path| !path.trim().is_empty() && Path::new(path).exists())
            .unwrap_or(false);

        if !has_existing_valid_path {
            font.local_path = None;
            font.enabled = false;
        }
    }

    Ok(())
}

fn normalize_font_extension(extension: Option<&str>) -> String {
    match extension
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "otf" => "otf".to_string(),
        "woff" => "woff".to_string(),
        "woff2" => "woff2".to_string(),
        "ttf" => "ttf".to_string(),
        _ => "ttf".to_string(),
    }
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
