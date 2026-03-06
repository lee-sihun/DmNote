use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use rfd::FileDialog;
use tauri::State;

use crate::{
    models::{
        FontSettings, FontType, GraphPositions, KeyMappings, KeyPositions, StatPositions,
        TabNoteOverrides,
    },
    state::AppState,
};

use super::{
    decode_image_data_url, is_remote_or_virtual_image_ref, local_source_path_from_image_ref,
    normalize_font_extension, normalize_image_extension, normalize_sound_extension,
    EmbeddedLocalFont, EmbeddedLocalImage, EmbeddedLocalSound, PresetFile, PresetOperationResult,
    BUILTIN_TAB_IDS, PRESET_LOCAL_IMAGE_PREFIX, PRESET_LOCAL_SOUND_PREFIX,
};

#[tauri::command]
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
        tab_note_overrides: {
            let overrides = snapshot.tab_note_overrides;
            if overrides.is_empty() {
                None
            } else {
                Some(overrides)
            }
        },
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

#[tauri::command]
pub fn preset_save_tab(state: State<'_, AppState>) -> Result<PresetOperationResult, String> {
    let preset_path = FileDialog::new()
        .set_file_name("preset-tab.json")
        .add_filter("DM NOTE Preset", &["json"])
        .save_file();

    let Some(path) = preset_path else {
        return Ok(PresetOperationResult {
            success: false,
            error: None,
        });
    };

    let snapshot = state.store.snapshot();
    let tab_id = snapshot.selected_key_type.clone();

    // Build single-tab maps for embed helpers
    let mut tab_key_positions: KeyPositions = HashMap::new();
    if let Some(positions) = snapshot.key_positions.get(&tab_id) {
        tab_key_positions.insert(tab_id.clone(), positions.clone());
    }
    let mut tab_stat_positions: StatPositions = HashMap::new();
    if let Some(positions) = snapshot.stat_positions.get(&tab_id) {
        tab_stat_positions.insert(tab_id.clone(), positions.clone());
    }
    let mut tab_graph_positions: GraphPositions = HashMap::new();
    if let Some(positions) = snapshot.graph_positions.get(&tab_id) {
        tab_graph_positions.insert(tab_id.clone(), positions.clone());
    }

    let used_font_families = collect_used_font_families(
        &tab_key_positions,
        &tab_stat_positions,
        &tab_graph_positions,
    );
    let (_font_settings, embedded_local_fonts) =
        build_preset_font_payload(&snapshot.font_settings, &used_font_families)?;
    let (tab_key_positions, tab_stat_positions, tab_graph_positions, embedded_local_images) =
        build_preset_image_payload(
            &tab_key_positions,
            &tab_stat_positions,
            &tab_graph_positions,
        )?;
    let (tab_key_positions, tab_stat_positions, tab_graph_positions, embedded_local_sounds) =
        build_preset_sound_payload(
            &tab_key_positions,
            &tab_stat_positions,
            &tab_graph_positions,
        )?;

    // Single-tab keys map
    let mut tab_keys: KeyMappings = HashMap::new();
    if let Some(keys) = snapshot.keys.get(&tab_id) {
        tab_keys.insert(tab_id.clone(), keys.clone());
    }

    // custom_tabs: only include if this is a custom (non-builtin) tab
    let custom_tabs = if BUILTIN_TAB_IDS.contains(&tab_id.as_str()) {
        None
    } else {
        let found = snapshot
            .custom_tabs
            .iter()
            .find(|ct| ct.id == tab_id)
            .cloned();
        found.map(|ct| vec![ct])
    };

    // tab_note_overrides: only the current tab's entry
    let tab_note_overrides = {
        let mut m: TabNoteOverrides = HashMap::new();
        if let Some(settings) = snapshot.tab_note_overrides.get(&tab_id) {
            m.insert(tab_id.clone(), settings.clone());
        }
        if m.is_empty() {
            None
        } else {
            Some(m)
        }
    };

    let preset = PresetFile {
        keys: Some(tab_keys),
        key_positions: Some(tab_key_positions),
        stat_positions: Some(tab_stat_positions),
        graph_positions: Some(tab_graph_positions),
        background_color: None,
        note_settings: None,
        note_effect: None,
        laboratory_enabled: None,
        custom_tabs,
        selected_key_type: Some(tab_id),
        use_custom_css: None,
        custom_css: None,
        use_custom_js: None,
        custom_js: None,
        font_settings: None,
        tab_note_overrides,
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
            maybe_insert_font_family(
                stat_position.position.counter.font_family.as_ref(),
                &mut used,
            );
        }
    }

    for positions in graph_positions.values() {
        for graph_position in positions {
            maybe_insert_font_family(graph_position.position.font_family.as_ref(), &mut used);
            maybe_insert_font_family(
                graph_position.position.counter.font_family.as_ref(),
                &mut used,
            );
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

            let extension =
                normalize_font_extension(source_path.extension().and_then(|ext| ext.to_str()));
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

    Ok((
        FontSettings {
            custom_fonts: exported_fonts,
        },
        embedded_local_fonts,
    ))
}

fn build_preset_image_payload(
    key_positions: &KeyPositions,
    stat_positions: &StatPositions,
    graph_positions: &GraphPositions,
) -> Result<
    (
        KeyPositions,
        StatPositions,
        GraphPositions,
        Vec<EmbeddedLocalImage>,
    ),
    String,
> {
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
        let image_id = uuid::Uuid::new_v4().to_string();
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
    let image_id = uuid::Uuid::new_v4().to_string();
    embedded_local_images.push(EmbeddedLocalImage {
        image_id: image_id.clone(),
        extension: Some(extension),
        data_base64: BASE64_STANDARD.encode(bytes),
    });
    path_to_image_id.insert(source_key, image_id.clone());
    *image_ref = Some(format!("{PRESET_LOCAL_IMAGE_PREFIX}{image_id}"));
    Ok(())
}

fn build_preset_sound_payload(
    key_positions: &KeyPositions,
    stat_positions: &StatPositions,
    graph_positions: &GraphPositions,
) -> Result<
    (
        KeyPositions,
        StatPositions,
        GraphPositions,
        Vec<EmbeddedLocalSound>,
    ),
    String,
> {
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
    let sound_id = uuid::Uuid::new_v4().to_string();
    embedded_local_sounds.push(EmbeddedLocalSound {
        sound_id: sound_id.clone(),
        extension: Some(extension),
        data_base64: BASE64_STANDARD.encode(bytes),
    });
    path_to_sound_id.insert(source_key, sound_id.clone());
    *sound_ref = Some(format!("{PRESET_LOCAL_SOUND_PREFIX}{sound_id}"));
    Ok(())
}
