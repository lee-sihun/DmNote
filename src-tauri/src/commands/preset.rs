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
        FontSettings, FontType, GraphPositions, NoteSettings, NoteSettingsPatch, SettingsPatchInput,
        StatPositions,
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
    graph_positions: Option<GraphPositions>,
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
    embedded_local_images: Option<Vec<EmbeddedLocalImage>>,
    embedded_local_sounds: Option<Vec<EmbeddedLocalSound>>,
}

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct EmbeddedLocalFont {
    font_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    extension: Option<String>,
    data_base64: String,
}

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct EmbeddedLocalImage {
    image_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    extension: Option<String>,
    data_base64: String,
}

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct EmbeddedLocalSound {
    sound_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    extension: Option<String>,
    data_base64: String,
}

const PRESET_LOCAL_IMAGE_PREFIX: &str = "dmnote-local-image://";
const PRESET_LOCAL_SOUND_PREFIX: &str = "dmnote-local-sound://";

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
    let used_font_families = collect_used_font_families(
        &snapshot.key_positions,
        &snapshot.stat_positions,
        &snapshot.graph_positions,
    );
    let (font_settings, embedded_local_fonts) =
        build_preset_font_payload(&snapshot.font_settings, &used_font_families)?;
    let (key_positions, stat_positions, graph_positions, embedded_local_images) =
        build_preset_image_payload(
            &snapshot.key_positions,
            &snapshot.stat_positions,
            &snapshot.graph_positions,
        )?;
    let (key_positions, stat_positions, graph_positions, embedded_local_sounds) =
        build_preset_sound_payload(&key_positions, &stat_positions, &graph_positions)?;

    let preset = PresetFile {
        keys: Some(snapshot.keys),
        key_positions: Some(key_positions),
        stat_positions: Some(stat_positions),
        graph_positions: Some(graph_positions),
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
        embedded_local_images: (!embedded_local_images.is_empty()).then_some(embedded_local_images),
        embedded_local_sounds: (!embedded_local_sounds.is_empty()).then_some(embedded_local_sounds),
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
    let mut positions = preset.key_positions.unwrap_or_else(|| default_positions().clone());
    let mut stat_positions = preset.stat_positions.unwrap_or_default();
    let mut graph_positions = preset.graph_positions.unwrap_or_default();
    let custom_tabs = preset
        .custom_tabs
        .unwrap_or_else(|| synthesize_custom_tabs(&keys));
    let snapshot = state.store.snapshot();
    let selected_key_type =
        choose_selected_key_type(preset.selected_key_type, &keys, snapshot.selected_key_type);

    let desired_settings = preset.note_settings.unwrap_or_else(NoteSettings::default);
    let mut note_patch = NoteSettingsPatch::default();
    note_patch.frame_limit = Some(desired_settings.frame_limit);
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
    restore_preset_local_images(
        &app,
        &mut positions,
        &mut stat_positions,
        &mut graph_positions,
        preset.embedded_local_images.as_deref(),
    )?;
    restore_preset_local_sounds(
        &app,
        &mut positions,
        &mut stat_positions,
        &mut graph_positions,
        preset.embedded_local_sounds.as_deref(),
    )?;

    state
        .store
        .update(|store| {
            store.keys = keys.clone();
            store.key_positions = positions.clone();
            store.stat_positions = stat_positions.clone();
            store.graph_positions = graph_positions.clone();
            store.custom_tabs = custom_tabs.clone();
            store.selected_key_type = selected_key_type.clone();
        })
        .map_err(|err| err.to_string())?;

    state.keyboard.update_mappings(keys.clone());
    state.keyboard.set_mode(selected_key_type.clone());

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
    app.emit("graphPositions:changed", &graph_positions)
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
    graph_positions: &GraphPositions,
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

    for positions in graph_positions.values() {
        for graph_position in positions {
            maybe_insert_font_family(graph_position.position.font_family.as_ref(), &mut used);
            maybe_insert_font_family(graph_position.position.counter.font_family.as_ref(), &mut used);
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

fn build_preset_image_payload(
    key_positions: &KeyPositions,
    stat_positions: &StatPositions,
    graph_positions: &GraphPositions,
) -> Result<(KeyPositions, StatPositions, GraphPositions, Vec<EmbeddedLocalImage>), String> {
    let mut exported_key_positions = key_positions.clone();
    let mut exported_stat_positions = stat_positions.clone();
    let mut exported_graph_positions = graph_positions.clone();
    let mut embedded_local_images = Vec::new();
    let mut path_to_image_id: HashMap<String, String> = HashMap::new();

    for positions in exported_key_positions.values_mut() {
        for position in positions.iter_mut() {
            rewrite_position_image_reference(
                &mut position.active_image,
                &mut embedded_local_images,
                &mut path_to_image_id,
            )?;
            rewrite_position_image_reference(
                &mut position.inactive_image,
                &mut embedded_local_images,
                &mut path_to_image_id,
            )?;
        }
    }

    for positions in exported_stat_positions.values_mut() {
        for stat_position in positions.iter_mut() {
            rewrite_position_image_reference(
                &mut stat_position.position.active_image,
                &mut embedded_local_images,
                &mut path_to_image_id,
            )?;
            rewrite_position_image_reference(
                &mut stat_position.position.inactive_image,
                &mut embedded_local_images,
                &mut path_to_image_id,
            )?;
        }
    }

    for positions in exported_graph_positions.values_mut() {
        for graph_position in positions.iter_mut() {
            rewrite_position_image_reference(
                &mut graph_position.position.active_image,
                &mut embedded_local_images,
                &mut path_to_image_id,
            )?;
            rewrite_position_image_reference(
                &mut graph_position.position.inactive_image,
                &mut embedded_local_images,
                &mut path_to_image_id,
            )?;
        }
    }

    Ok((
        exported_key_positions,
        exported_stat_positions,
        exported_graph_positions,
        embedded_local_images,
    ))
}

fn rewrite_position_image_reference(
    image_ref: &mut Option<String>,
    embedded_local_images: &mut Vec<EmbeddedLocalImage>,
    path_to_image_id: &mut HashMap<String, String>,
) -> Result<(), String> {
    let Some(current_value) = image_ref.clone() else {
        return Ok(());
    };
    let trimmed = current_value.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    // Keep external URLs as-is.
    if is_remote_or_virtual_image_ref(trimmed) {
        return Ok(());
    }

    if let Some((bytes, extension)) = decode_image_data_url(trimmed) {
        let image_id = Uuid::new_v4().to_string();
        embedded_local_images.push(EmbeddedLocalImage {
            image_id: image_id.clone(),
            extension: Some(extension),
            data_base64: BASE64_STANDARD.encode(bytes),
        });
        *image_ref = Some(format!("{PRESET_LOCAL_IMAGE_PREFIX}{image_id}"));
        return Ok(());
    }

    let Some(source_path) = local_source_path_from_image_ref(trimmed) else {
        return Ok(());
    };
    if !source_path.exists() {
        return Ok(());
    }

    let source_key = source_path.to_string_lossy().to_string();
    if let Some(existing_id) = path_to_image_id.get(&source_key) {
        *image_ref = Some(format!("{PRESET_LOCAL_IMAGE_PREFIX}{existing_id}"));
        return Ok(());
    }

    let bytes = match fs::read(&source_path) {
        Ok(bytes) => bytes,
        Err(err) => {
            log::warn!(
                "[Preset] Failed to read local image from '{}': {err}",
                source_path.display()
            );
            return Ok(());
        }
    };

    let extension = normalize_image_extension(source_path.extension().and_then(|ext| ext.to_str()));
    let image_id = Uuid::new_v4().to_string();
    embedded_local_images.push(EmbeddedLocalImage {
        image_id: image_id.clone(),
        extension: Some(extension),
        data_base64: BASE64_STANDARD.encode(bytes),
    });
    path_to_image_id.insert(source_key, image_id.clone());
    *image_ref = Some(format!("{PRESET_LOCAL_IMAGE_PREFIX}{image_id}"));
    Ok(())
}

fn restore_preset_local_images(
    app: &AppHandle,
    key_positions: &mut KeyPositions,
    stat_positions: &mut StatPositions,
    graph_positions: &mut GraphPositions,
    embedded_local_images: Option<&[EmbeddedLocalImage]>,
) -> Result<(), String> {
    let has_any_images = key_positions.values().any(|positions| {
        positions.iter().any(|position| {
            option_has_non_empty_text(&position.active_image)
                || option_has_non_empty_text(&position.inactive_image)
        })
    }) || stat_positions.values().any(|positions| {
        positions.iter().any(|stat_position| {
            option_has_non_empty_text(&stat_position.position.active_image)
                || option_has_non_empty_text(&stat_position.position.inactive_image)
        })
    }) || graph_positions.values().any(|positions| {
        positions.iter().any(|graph_position| {
            option_has_non_empty_text(&graph_position.position.active_image)
                || option_has_non_empty_text(&graph_position.position.inactive_image)
        })
    });

    if !has_any_images {
        return Ok(());
    }

    let embedded_map: HashMap<&str, &EmbeddedLocalImage> = embedded_local_images
        .unwrap_or(&[])
        .iter()
        .map(|image| (image.image_id.as_str(), image))
        .collect();
    let mut restored_path_cache: HashMap<String, String> = HashMap::new();

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("failed to resolve app data directory: {err}"))?;
    let images_dir = app_data_dir.join("images");
    fs::create_dir_all(&images_dir)
        .map_err(|err| format!("failed to create images directory: {err}"))?;

    for positions in key_positions.values_mut() {
        for position in positions.iter_mut() {
            restore_position_image_reference(
                &images_dir,
                &embedded_map,
                &mut restored_path_cache,
                &mut position.active_image,
            )?;
            restore_position_image_reference(
                &images_dir,
                &embedded_map,
                &mut restored_path_cache,
                &mut position.inactive_image,
            )?;
        }
    }

    for positions in stat_positions.values_mut() {
        for stat_position in positions.iter_mut() {
            restore_position_image_reference(
                &images_dir,
                &embedded_map,
                &mut restored_path_cache,
                &mut stat_position.position.active_image,
            )?;
            restore_position_image_reference(
                &images_dir,
                &embedded_map,
                &mut restored_path_cache,
                &mut stat_position.position.inactive_image,
            )?;
        }
    }

    for positions in graph_positions.values_mut() {
        for graph_position in positions.iter_mut() {
            restore_position_image_reference(
                &images_dir,
                &embedded_map,
                &mut restored_path_cache,
                &mut graph_position.position.active_image,
            )?;
            restore_position_image_reference(
                &images_dir,
                &embedded_map,
                &mut restored_path_cache,
                &mut graph_position.position.inactive_image,
            )?;
        }
    }

    Ok(())
}

fn restore_preset_local_sounds(
    app: &AppHandle,
    key_positions: &mut KeyPositions,
    stat_positions: &mut StatPositions,
    graph_positions: &mut GraphPositions,
    embedded_local_sounds: Option<&[EmbeddedLocalSound]>,
) -> Result<(), String> {
    let has_any_sounds = key_positions.values().any(|positions| {
        positions
            .iter()
            .any(|position| option_has_non_empty_text(&position.sound_path))
    }) || stat_positions.values().any(|positions| {
        positions
            .iter()
            .any(|stat_position| option_has_non_empty_text(&stat_position.position.sound_path))
    }) || graph_positions.values().any(|positions| {
        positions
            .iter()
            .any(|graph_position| option_has_non_empty_text(&graph_position.position.sound_path))
    });

    if !has_any_sounds {
        return Ok(());
    }

    let embedded_map: HashMap<&str, &EmbeddedLocalSound> = embedded_local_sounds
        .unwrap_or(&[])
        .iter()
        .map(|sound| (sound.sound_id.as_str(), sound))
        .collect();

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("failed to resolve app data directory: {err}"))?;
    let sounds_dir = app_data_dir.join("sounds");
    fs::create_dir_all(&sounds_dir)
        .map_err(|err| format!("failed to create sounds directory: {err}"))?;

    let mut restored_path_cache: HashMap<String, String> = HashMap::new();

    for positions in key_positions.values_mut() {
        for position in positions.iter_mut() {
            restore_position_sound_reference(
                &sounds_dir,
                &embedded_map,
                &mut restored_path_cache,
                &mut position.sound_path,
            )?;
        }
    }

    for positions in stat_positions.values_mut() {
        for stat_position in positions.iter_mut() {
            restore_position_sound_reference(
                &sounds_dir,
                &embedded_map,
                &mut restored_path_cache,
                &mut stat_position.position.sound_path,
            )?;
        }
    }

    for positions in graph_positions.values_mut() {
        for graph_position in positions.iter_mut() {
            restore_position_sound_reference(
                &sounds_dir,
                &embedded_map,
                &mut restored_path_cache,
                &mut graph_position.position.sound_path,
            )?;
        }
    }

    Ok(())
}

fn restore_position_sound_reference(
    sounds_dir: &Path,
    embedded_map: &HashMap<&str, &EmbeddedLocalSound>,
    restored_path_cache: &mut HashMap<String, String>,
    sound_ref: &mut Option<String>,
) -> Result<(), String> {
    let Some(current_value) = sound_ref.clone() else {
        return Ok(());
    };
    let trimmed = current_value.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    if let Some(sound_id) = trimmed.strip_prefix(PRESET_LOCAL_SOUND_PREFIX) {
        if let Some(restored_path) = restored_path_cache.get(sound_id) {
            *sound_ref = Some(restored_path.clone());
            return Ok(());
        }
        let Some(embedded) = embedded_map.get(sound_id) else {
            log::warn!(
                "[Preset] Missing embedded sound payload for id '{}'; clearing sound reference",
                sound_id
            );
            *sound_ref = None;
            return Ok(());
        };

        let bytes = match BASE64_STANDARD.decode(embedded.data_base64.as_bytes()) {
            Ok(bytes) => bytes,
            Err(err) => {
                log::warn!(
                    "[Preset] Failed to decode embedded sound '{}': {err}",
                    sound_id
                );
                *sound_ref = None;
                return Ok(());
            }
        };

        let extension = normalize_sound_extension(embedded.extension.as_deref());
        let dest_path = sounds_dir.join(format!("{}.{}", Uuid::new_v4(), extension));
        if let Err(err) = fs::write(&dest_path, bytes) {
            log::warn!(
                "[Preset] Failed to restore embedded sound '{}': {err}",
                sound_id
            );
            *sound_ref = None;
            return Ok(());
        }
        let restored = dest_path.to_string_lossy().to_string();
        restored_path_cache.insert(sound_id.to_string(), restored.clone());
        *sound_ref = Some(restored);
        return Ok(());
    }

    // 레거시 호환: 절대 경로가 현재 기기에서 유효하면 그대로 유지.
    let path = PathBuf::from(trimmed);
    if path.is_absolute() && path.exists() {
        return Ok(());
    }

    // 다른 기기에서 임포트된 프리셋: 경로를 해석할 수 없으면 초기화.
    *sound_ref = None;
    Ok(())
}

fn restore_position_image_reference(
    images_dir: &Path,
    embedded_map: &HashMap<&str, &EmbeddedLocalImage>,
    restored_path_cache: &mut HashMap<String, String>,
    image_ref: &mut Option<String>,
) -> Result<(), String> {
    let Some(current_value) = image_ref.clone() else {
        return Ok(());
    };
    let trimmed = current_value.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    if let Some(image_id) = trimmed.strip_prefix(PRESET_LOCAL_IMAGE_PREFIX) {
        if let Some(restored_path) = restored_path_cache.get(image_id) {
            *image_ref = Some(restored_path.clone());
            return Ok(());
        }
        let Some(embedded) = embedded_map.get(image_id) else {
            log::warn!(
                "[Preset] Missing embedded image payload for id '{}'; clearing image reference",
                image_id
            );
            *image_ref = None;
            return Ok(());
        };

        let bytes = match BASE64_STANDARD.decode(embedded.data_base64.as_bytes()) {
            Ok(bytes) => bytes,
            Err(err) => {
                log::warn!(
                    "[Preset] Failed to decode embedded image '{}': {err}",
                    image_id
                );
                *image_ref = None;
                return Ok(());
            }
        };
        let extension = normalize_image_extension(embedded.extension.as_deref());
        let dest_path = images_dir.join(format!("{}.{}", Uuid::new_v4(), extension));
        if let Err(err) = fs::write(&dest_path, bytes) {
            log::warn!(
                "[Preset] Failed to restore embedded image '{}': {err}",
                image_id
            );
            *image_ref = None;
            return Ok(());
        }
        let restored = dest_path.to_string_lossy().to_string();
        restored_path_cache.insert(image_id.to_string(), restored.clone());
        *image_ref = Some(restored);
        return Ok(());
    }

    // Legacy preset compatibility: convert data URL images to appdata file paths.
    if let Some((bytes, extension)) = decode_image_data_url(trimmed) {
        let dest_path = images_dir.join(format!("{}.{}", Uuid::new_v4(), extension));
        fs::write(&dest_path, bytes)
            .map_err(|err| format!("failed to restore data URL image: {err}"))?;
        *image_ref = Some(dest_path.to_string_lossy().to_string());
        return Ok(());
    }

    // Legacy compatibility: absolute local paths are copied into appdata/images.
    if let Some(source_path) = local_source_path_from_image_ref(trimmed) {
        if source_path.exists() {
            if source_path.starts_with(images_dir) {
                *image_ref = Some(source_path.to_string_lossy().to_string());
                return Ok(());
            }
            let extension =
                normalize_image_extension(source_path.extension().and_then(|ext| ext.to_str()));
            let dest_path = images_dir.join(format!("{}.{}", Uuid::new_v4(), extension));
            if let Err(err) = fs::copy(&source_path, &dest_path) {
                log::warn!(
                    "[Preset] Failed to copy local image from '{}': {err}",
                    source_path.display()
                );
                *image_ref = None;
                return Ok(());
            }
            *image_ref = Some(dest_path.to_string_lossy().to_string());
            return Ok(());
        }

        // Preset imported on another machine: unresolved absolute paths should fallback cleanly.
        *image_ref = None;
        return Ok(());
    }

    Ok(())
}

fn decode_image_data_url(value: &str) -> Option<(Vec<u8>, String)> {
    let (header, payload) = value.split_once(',')?;
    let header_lower = header.to_ascii_lowercase();
    if !header_lower.starts_with("data:image/") || !header_lower.contains(";base64") {
        return None;
    }

    let mime = header
        .split(';')
        .next()
        .and_then(|part| part.strip_prefix("data:"))
        .unwrap_or("image/png");
    let extension = extension_from_image_mime(mime);
    let bytes = BASE64_STANDARD.decode(payload.as_bytes()).ok()?;
    Some((bytes, extension))
}

fn extension_from_image_mime(mime: &str) -> String {
    match mime.trim().to_ascii_lowercase().as_str() {
        "image/jpeg" | "image/jpg" => "jpg".to_string(),
        "image/png" => "png".to_string(),
        "image/webp" => "webp".to_string(),
        "image/gif" => "gif".to_string(),
        "image/bmp" => "bmp".to_string(),
        "image/svg+xml" => "svg".to_string(),
        "image/x-icon" | "image/vnd.microsoft.icon" => "ico".to_string(),
        "image/avif" => "avif".to_string(),
        _ => "png".to_string(),
    }
}

fn normalize_image_extension(extension: Option<&str>) -> String {
    match extension
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "jpg".to_string(),
        "png" => "png".to_string(),
        "webp" => "webp".to_string(),
        "gif" => "gif".to_string(),
        "bmp" => "bmp".to_string(),
        "svg" => "svg".to_string(),
        "ico" => "ico".to_string(),
        "avif" => "avif".to_string(),
        _ => "png".to_string(),
    }
}

fn build_preset_sound_payload(
    key_positions: &KeyPositions,
    stat_positions: &StatPositions,
    graph_positions: &GraphPositions,
) -> Result<(KeyPositions, StatPositions, GraphPositions, Vec<EmbeddedLocalSound>), String> {
    let mut exported_key_positions = key_positions.clone();
    let mut exported_stat_positions = stat_positions.clone();
    let mut exported_graph_positions = graph_positions.clone();
    let mut embedded_local_sounds = Vec::new();
    let mut path_to_sound_id: HashMap<String, String> = HashMap::new();

    for positions in exported_key_positions.values_mut() {
        for position in positions.iter_mut() {
            rewrite_position_sound_reference(
                &mut position.sound_path,
                &mut embedded_local_sounds,
                &mut path_to_sound_id,
            )?;
        }
    }

    for positions in exported_stat_positions.values_mut() {
        for stat_position in positions.iter_mut() {
            rewrite_position_sound_reference(
                &mut stat_position.position.sound_path,
                &mut embedded_local_sounds,
                &mut path_to_sound_id,
            )?;
        }
    }

    for positions in exported_graph_positions.values_mut() {
        for graph_position in positions.iter_mut() {
            rewrite_position_sound_reference(
                &mut graph_position.position.sound_path,
                &mut embedded_local_sounds,
                &mut path_to_sound_id,
            )?;
        }
    }

    Ok((
        exported_key_positions,
        exported_stat_positions,
        exported_graph_positions,
        embedded_local_sounds,
    ))
}

fn rewrite_position_sound_reference(
    sound_ref: &mut Option<String>,
    embedded_local_sounds: &mut Vec<EmbeddedLocalSound>,
    path_to_sound_id: &mut HashMap<String, String>,
) -> Result<(), String> {
    let Some(current_value) = sound_ref.clone() else {
        return Ok(());
    };
    let trimmed = current_value.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    let source_path = PathBuf::from(trimmed);
    if !source_path.is_absolute() || !source_path.exists() {
        return Ok(());
    }

    let source_key = source_path.to_string_lossy().to_string();
    if let Some(existing_id) = path_to_sound_id.get(&source_key) {
        *sound_ref = Some(format!("{PRESET_LOCAL_SOUND_PREFIX}{existing_id}"));
        return Ok(());
    }

    let bytes = match fs::read(&source_path) {
        Ok(bytes) => bytes,
        Err(err) => {
            log::warn!(
                "[Preset] Failed to read local sound from '{}': {err}",
                source_path.display()
            );
            return Ok(());
        }
    };

    let extension = normalize_sound_extension(source_path.extension().and_then(|ext| ext.to_str()));
    let sound_id = Uuid::new_v4().to_string();
    embedded_local_sounds.push(EmbeddedLocalSound {
        sound_id: sound_id.clone(),
        extension: Some(extension),
        data_base64: BASE64_STANDARD.encode(bytes),
    });
    path_to_sound_id.insert(source_key, sound_id.clone());
    *sound_ref = Some(format!("{PRESET_LOCAL_SOUND_PREFIX}{sound_id}"));
    Ok(())
}

fn normalize_sound_extension(extension: Option<&str>) -> String {
    match extension
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "wav" => "wav".to_string(),
        "mp3" => "mp3".to_string(),
        "ogg" => "ogg".to_string(),
        "flac" => "flac".to_string(),
        "aac" => "aac".to_string(),
        _ => "wav".to_string(),
    }
}

fn local_source_path_from_image_ref(value: &str) -> Option<PathBuf> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some(stripped) = trimmed
        .strip_prefix("file:///")
        .or_else(|| trimmed.strip_prefix("file://"))
    {
        let mut candidate = stripped.to_string();
        if cfg!(target_os = "windows") {
            if candidate.starts_with('/') && candidate.as_bytes().get(2) == Some(&b':') {
                candidate = candidate[1..].to_string();
            }
            candidate = candidate.replace('/', "\\");
        }
        return Some(PathBuf::from(candidate));
    }

    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        Some(path)
    } else {
        None
    }
}

fn is_remote_or_virtual_image_ref(value: &str) -> bool {
    let lower = value.trim().to_ascii_lowercase();
    lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("blob:")
        || lower.starts_with("asset:")
        || lower.starts_with("tauri:")
}

fn option_has_non_empty_text(value: &Option<String>) -> bool {
    value
        .as_ref()
        .map(|text| !text.trim().is_empty())
        .unwrap_or(false)
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
