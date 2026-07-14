use std::{
    collections::{BTreeSet, HashMap, HashSet},
    fs,
    path::Path,
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use rfd::FileDialog;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use crate::{
    commands::editor::css::TabCssResponse,
    defaults::{default_keys, default_positions},
    errors::{CmdResult, CommandError},
    models::{
        CustomCssPatch, CustomJsPatch, FontSettings, FontType, GraphPositions, KeyMappings,
        KeyPositions, KnobPositions, NoteSettingsPatch, SettingsPatchInput, StatPositions,
        TabCssOverrides,
    },
    services::settings::apply_patch_to_store,
    state::AppState,
};

use super::{
    decode_image_data_url, normalize_font_extension, normalize_image_extension,
    normalize_sound_extension, option_has_non_empty_text, EmbeddedLocalFont, EmbeddedLocalImage,
    EmbeddedLocalSound, PresetFile, PresetOperationResult, PRESET_LOCAL_IMAGE_PREFIX,
    PRESET_LOCAL_SOUND_PREFIX,
};

#[tauri::command]
pub fn preset_load(state: State<'_, AppState>, app: AppHandle) -> CmdResult<PresetOperationResult> {
    let picked = FileDialog::new()
        .add_filter("DM NOTE Preset", &["json"])
        .pick_file();

    let Some(path) = picked else {
        return Ok(PresetOperationResult {
            success: false,
            error: None,
        });
    };

    let content = fs::read_to_string(&path)?;
    let preset: PresetFile =
        serde_json::from_str(&content).map_err(|_| CommandError::msg("invalid-preset"))?;

    let keys = preset.keys.unwrap_or_else(|| default_keys().clone());
    let mut positions = preset
        .key_positions
        .unwrap_or_else(|| default_positions().clone());
    let mut stat_positions = preset.stat_positions.unwrap_or_default();
    let mut graph_positions = preset.graph_positions.unwrap_or_default();
    let mut knob_positions = preset.knob_positions.unwrap_or_default();
    let custom_tabs = preset
        .custom_tabs
        .unwrap_or_else(|| synthesize_custom_tabs(&keys));
    let snapshot = state.store.snapshot();
    let previous_tab_css_overrides = snapshot.tab_css_overrides.clone();
    let selected_key_type =
        choose_selected_key_type(preset.selected_key_type, &keys, snapshot.selected_key_type);
    let preset_layer_groups = preset.layer_groups;
    let preset_tab_css_overrides = preset.tab_css_overrides;

    let mut desired_settings = preset.note_settings.unwrap_or_default();
    desired_settings.migrate_fade_position();
    let note_patch = NoteSettingsPatch {
        frame_limit: Some(desired_settings.frame_limit),
        speed: Some(desired_settings.speed),
        track_height: Some(desired_settings.track_height),
        reverse: Some(desired_settings.reverse),
        fade_position: Some(desired_settings.fade_position),
        fade_top_px: Some(desired_settings.fade_top_px),
        fade_bottom_px: Some(desired_settings.fade_bottom_px),
        reverse_fade_top_px: Some(desired_settings.reverse_fade_top_px),
        reverse_fade_bottom_px: Some(desired_settings.reverse_fade_bottom_px),
        delayed_note_enabled: Some(desired_settings.delayed_note_enabled),
        short_note_threshold_ms: Some(desired_settings.short_note_threshold_ms),
        short_note_min_length_px: Some(desired_settings.short_note_min_length_px),
        key_display_delay_ms: Some(desired_settings.key_display_delay_ms),
    };

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
        &mut knob_positions,
        preset.embedded_local_images.as_deref(),
    )?;
    restore_preset_local_sounds(
        &app,
        &mut positions,
        &mut stat_positions,
        &mut graph_positions,
        &mut knob_positions,
        preset.embedded_local_sounds.as_deref(),
    )?;

    // 임포트 경계 — 정의와 참조가 함께 확정되므로 dangling groupId 정리
    // (프리셋에 그룹 정의가 없으면 현재 스토어의 그룹이 유지되므로 그 기준으로 검사)
    {
        let effective_layer_groups = preset_layer_groups
            .clone()
            .unwrap_or_else(|| snapshot.layer_groups.clone());
        crate::state::migration::clear_dangling_group_ids_in(
            &mut positions,
            &mut stat_positions,
            &mut graph_positions,
            &mut knob_positions,
            &effective_layer_groups,
        );
    }

    // 탭별 노트 설정 복원 (없으면 빈 맵으로 초기화 → 전역 폴백)
    let mut tab_note_overrides = preset.tab_note_overrides.unwrap_or_default();
    for tab in tab_note_overrides.values_mut() {
        tab.migrate_fade_position();
    }

    let settings_patch = SettingsPatchInput {
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
    };
    let mut settings_diff = None;
    let normalized = state.store.update(|store| {
        store.keys = keys.clone();
        store.key_positions = positions.clone();
        store.stat_positions = stat_positions.clone();
        store.graph_positions = graph_positions.clone();
        store.knob_positions = knob_positions.clone();
        store.custom_tabs = custom_tabs.clone();
        store.selected_key_type = selected_key_type.clone();
        store.tab_note_overrides = tab_note_overrides.clone();
        if let Some(layer_groups) = preset_layer_groups.as_ref() {
            store.layer_groups = layer_groups.clone();
        }
        if let Some(tab_css_overrides) = preset_tab_css_overrides.as_ref() {
            store.tab_css_overrides = tab_css_overrides.clone();
        }
        settings_diff = Some(apply_patch_to_store(store, &settings_patch));
    })?;
    let diff = settings_diff
        .ok_or_else(|| CommandError::msg("preset settings transaction did not produce a diff"))?;

    let keys = normalized.keys;
    let positions = normalized.key_positions;
    let stat_positions = normalized.stat_positions;
    let graph_positions = normalized.graph_positions;
    let knob_positions = normalized.knob_positions;
    let custom_tabs = normalized.custom_tabs;
    let selected_key_type = normalized.selected_key_type;
    let tab_note_overrides = normalized.tab_note_overrides;
    let layer_groups = normalized.layer_groups;
    let tab_css_overrides = normalized.tab_css_overrides;

    state
        .keyboard
        .update_mappings_and_set_mode(keys.clone(), selected_key_type.clone());

    state.emit_settings_changed(&diff, &app)?;
    app.emit("layerGroups:changed", &layer_groups)?;
    sync_tab_css_runtime(
        state.inner(),
        &app,
        &previous_tab_css_overrides,
        &tab_css_overrides,
    )?;

    // 프리셋 데이터를 단일 이벤트로 원자적 전달
    app.emit(
        "preset:snapshot",
        &super::PresetSnapshot {
            keys,
            positions,
            stat_positions,
            graph_positions,
            knob_positions,
            custom_tabs,
            selected_key_type,
            tab_note_overrides,
        },
    )?;
    app.emit("css:use", &serde_json::json!({ "enabled": css_use }))?;
    app.emit("css:content", &custom_css)?;
    app.emit("js:use", &serde_json::json!({ "enabled": js_use }))?;
    app.emit("js:content", &custom_js)?;

    // OBS 브릿지: 프리셋 로드 시 전체 스냅샷 재전송
    state.refresh_obs_snapshot();

    Ok(PresetOperationResult {
        success: true,
        error: None,
    })
}

#[tauri::command]
pub fn preset_load_tab(
    state: State<'_, AppState>,
    app: AppHandle,
) -> CmdResult<PresetOperationResult> {
    let picked = FileDialog::new()
        .add_filter("DM NOTE Preset", &["json"])
        .pick_file();

    let Some(path) = picked else {
        return Ok(PresetOperationResult {
            success: false,
            error: None,
        });
    };

    let content = fs::read_to_string(&path)?;
    let preset: PresetFile =
        serde_json::from_str(&content).map_err(|_| CommandError::msg("invalid-preset"))?;

    let PresetFile {
        keys,
        key_positions,
        stat_positions,
        graph_positions,
        knob_positions,
        selected_key_type,
        tab_note_overrides,
        layer_groups,
        tab_css_overrides,
        font_settings,
        embedded_local_fonts,
        embedded_local_images,
        embedded_local_sounds,
        ..
    } = preset;

    let mut snapshot = state.store.snapshot();
    let current_tab_id = snapshot.selected_key_type.clone();
    let previous_tab_css_overrides = snapshot.tab_css_overrides.clone();

    let imported_keys = keys.unwrap_or_default();
    let source_tab_id = choose_tab_preset_source_tab(
        &imported_keys,
        selected_key_type.as_deref(),
        &current_tab_id,
    )?;
    let src_keys = imported_keys
        .get(&source_tab_id)
        .cloned()
        .ok_or_else(|| CommandError::msg("invalid-tab-preset"))?;

    let imported_key_positions = key_positions.unwrap_or_default();
    let mut src_key_positions: KeyPositions = HashMap::new();
    if let Some(v) = imported_key_positions.get(&source_tab_id) {
        src_key_positions.insert(current_tab_id.clone(), v.clone());
    }

    let imported_stat_positions = stat_positions.unwrap_or_default();
    let mut src_stat_positions: StatPositions = HashMap::new();
    if let Some(v) = imported_stat_positions.get(&source_tab_id) {
        src_stat_positions.insert(current_tab_id.clone(), v.clone());
    }

    let imported_graph_positions = graph_positions.unwrap_or_default();
    let mut src_graph_positions: GraphPositions = HashMap::new();
    if let Some(v) = imported_graph_positions.get(&source_tab_id) {
        src_graph_positions.insert(current_tab_id.clone(), v.clone());
    }

    let imported_knob_positions = knob_positions.unwrap_or_default();
    let mut src_knob_positions: KnobPositions = HashMap::new();
    if let Some(v) = imported_knob_positions.get(&source_tab_id) {
        src_knob_positions.insert(current_tab_id.clone(), v.clone());
    }

    let mut imported_tab_note_overrides = tab_note_overrides.unwrap_or_default();
    for tab in imported_tab_note_overrides.values_mut() {
        tab.migrate_fade_position();
    }

    // 내장 에셋 복원
    restore_preset_local_images(
        &app,
        &mut src_key_positions,
        &mut src_stat_positions,
        &mut src_graph_positions,
        &mut src_knob_positions,
        embedded_local_images.as_deref(),
    )?;
    restore_preset_local_sounds(
        &app,
        &mut src_key_positions,
        &mut src_stat_positions,
        &mut src_graph_positions,
        &mut src_knob_positions,
        embedded_local_sounds.as_deref(),
    )?;

    // 전체 스토어 스냅샷에 병합
    snapshot
        .keys
        .insert(current_tab_id.clone(), src_keys.clone());
    if let Some(v) = src_key_positions.remove(&current_tab_id) {
        snapshot.key_positions.insert(current_tab_id.clone(), v);
    }
    if let Some(v) = src_stat_positions.remove(&current_tab_id) {
        snapshot.stat_positions.insert(current_tab_id.clone(), v);
    }
    if let Some(v) = src_graph_positions.remove(&current_tab_id) {
        snapshot.graph_positions.insert(current_tab_id.clone(), v);
    }
    if let Some(v) = src_knob_positions.remove(&current_tab_id) {
        snapshot.knob_positions.insert(current_tab_id.clone(), v);
    }
    let imported_override = imported_tab_note_overrides.get(&source_tab_id).cloned();
    if let Some(override_settings) = imported_override {
        snapshot
            .tab_note_overrides
            .insert(current_tab_id.clone(), override_settings);
    } else {
        snapshot.tab_note_overrides.remove(&current_tab_id);
    }

    if let Some(imported_layer_groups) = layer_groups {
        let groups = imported_layer_groups
            .get(&source_tab_id)
            .cloned()
            .unwrap_or_default();
        snapshot.layer_groups.insert(current_tab_id.clone(), groups);
    }

    if let Some(imported_tab_css_overrides) = tab_css_overrides {
        if let Some(css) = imported_tab_css_overrides.get(&source_tab_id) {
            snapshot
                .tab_css_overrides
                .insert(current_tab_id.clone(), css.clone());
        } else {
            snapshot.tab_css_overrides.remove(&current_tab_id);
        }
    }

    // 프리셋에 담긴 폰트를 현재 폰트 목록에 병합 (탭 로드는 전역 설정을 덮지 않음)
    let merged_font_settings = if let Some(imported_fonts) = font_settings {
        merge_tab_preset_fonts(&snapshot.font_settings, imported_fonts, |filtered_fonts| {
            restore_preset_local_fonts(&app, filtered_fonts, embedded_local_fonts.as_deref())
        })?
    } else {
        None
    };

    // 임포트 경계 — 병합이 끝난 전체 상태 기준으로 dangling groupId 정리
    crate::state::migration::clear_dangling_group_ids(&mut snapshot);

    let font_settings_patch = merged_font_settings.map(|font_settings| SettingsPatchInput {
        font_settings: Some(font_settings),
        ..SettingsPatchInput::default()
    });
    let mut settings_diff = None;
    let normalized = state.store.update(|store| {
        store.keys = snapshot.keys.clone();
        store.key_positions = snapshot.key_positions.clone();
        store.stat_positions = snapshot.stat_positions.clone();
        store.graph_positions = snapshot.graph_positions.clone();
        store.knob_positions = snapshot.knob_positions.clone();
        store.tab_note_overrides = snapshot.tab_note_overrides.clone();
        store.layer_groups = snapshot.layer_groups.clone();
        store.tab_css_overrides = snapshot.tab_css_overrides.clone();
        if let Some(patch) = font_settings_patch.as_ref() {
            settings_diff = Some(apply_patch_to_store(store, patch));
        }
    })?;

    let full_keys = normalized.keys;
    let full_positions = normalized.key_positions;
    let full_stat_positions = normalized.stat_positions;
    let full_graph_positions = normalized.graph_positions;
    let full_knob_positions = normalized.knob_positions;
    let full_tab_note_overrides = normalized.tab_note_overrides;
    let full_layer_groups = normalized.layer_groups;
    let full_tab_css_overrides = normalized.tab_css_overrides;

    state.keyboard.update_mappings(full_keys.clone());

    if let Some(diff) = settings_diff.as_ref() {
        state.emit_settings_changed(diff, &app)?;
    }

    app.emit("layerGroups:changed", &full_layer_groups)?;
    sync_tab_css_runtime(
        state.inner(),
        &app,
        &previous_tab_css_overrides,
        &full_tab_css_overrides,
    )?;
    app.emit("keys:changed", &full_keys)?;
    app.emit("positions:changed", &full_positions)?;
    app.emit("statPositions:changed", &full_stat_positions)?;
    app.emit("graphPositions:changed", &full_graph_positions)?;
    app.emit("knobPositions:changed", &full_knob_positions)?;
    app.emit("tabNote:changed_all", &full_tab_note_overrides)?;

    // OBS 브릿지: 탭 프리셋 로드 시 전체 스냅샷 재전송
    state.refresh_obs_snapshot();

    Ok(PresetOperationResult {
        success: true,
        error: None,
    })
}

fn sync_tab_css_runtime(
    state: &AppState,
    app: &AppHandle,
    previous: &TabCssOverrides,
    current: &TabCssOverrides,
) -> CmdResult<()> {
    let tab_ids: BTreeSet<String> = previous.keys().chain(current.keys()).cloned().collect();

    for tab_id in tab_ids {
        if previous.get(&tab_id) == current.get(&tab_id) {
            continue;
        }

        state.unwatch_tab_css(&tab_id);
        let css = current.get(&tab_id).cloned();
        if let Some(tab_css) = css.as_ref() {
            if tab_css.enabled {
                if let Some(path) = tab_css.path.as_deref() {
                    if let Err(error) = state.watch_tab_css(path, &tab_id) {
                        log::warn!("[Preset] 탭 CSS 감시 시작 실패 (tab={tab_id}): {error}");
                    }
                }
            }
        }

        app.emit(
            "tabCss:changed",
            &TabCssResponse {
                tab_id: tab_id.clone(),
                css,
            },
        )?;
    }

    Ok(())
}

fn choose_tab_preset_source_tab(
    keys: &KeyMappings,
    selected_key_type: Option<&str>,
    current_tab_id: &str,
) -> CmdResult<String> {
    if keys.is_empty() {
        return Err(CommandError::msg("invalid-tab-preset"));
    }

    if keys.contains_key(current_tab_id) {
        return Ok(current_tab_id.to_string());
    }

    if let Some(selected) = selected_key_type {
        if keys.contains_key(selected) {
            return Ok(selected.to_string());
        }
    }

    if keys.len() == 1 {
        if let Some(only) = keys.keys().next() {
            return Ok(only.clone());
        }
    }

    Err(CommandError::msg("tab-preset-ambiguous-source"))
}

fn merge_tab_preset_fonts(
    existing_font_settings: &FontSettings,
    mut imported_font_settings: FontSettings,
    restore_fonts: impl FnOnce(&mut FontSettings) -> CmdResult<()>,
) -> CmdResult<Option<FontSettings>> {
    let mut existing_names: HashSet<String> = existing_font_settings
        .custom_fonts
        .iter()
        .map(|font| font.name.clone())
        .collect();

    // 같은 이름은 기존 정의 유지 — 수용한 이름도 반영해 프리셋 내부 중복 방어
    imported_font_settings
        .custom_fonts
        .retain(|font| existing_names.insert(font.name.clone()));
    if imported_font_settings.custom_fonts.is_empty() {
        return Ok(None);
    }

    // 이름 필터 후 파일 복원 — 제외할 로컬 폰트의 고아 파일 생성 방지
    restore_fonts(&mut imported_font_settings)?;

    let mut existing_ids: HashSet<String> = existing_font_settings
        .custom_fonts
        .iter()
        .map(|font| font.id.clone())
        .collect();
    for font in imported_font_settings.custom_fonts.iter_mut() {
        if existing_ids.contains(&font.id) {
            font.id = Uuid::new_v4().to_string();
        }
        existing_ids.insert(font.id.clone());
    }

    let mut merged = existing_font_settings.clone();
    merged
        .custom_fonts
        .extend(imported_font_settings.custom_fonts);
    Ok(Some(merged))
}

fn restore_preset_local_fonts(
    app: &AppHandle,
    font_settings: &mut FontSettings,
    embedded_local_fonts: Option<&[EmbeddedLocalFont]>,
) -> CmdResult<()> {
    let has_local_fonts = font_settings
        .custom_fonts
        .iter()
        .any(|font| font.font_type == FontType::Local);
    if !has_local_fonts {
        return Ok(());
    }

    let app_data_dir = app.path().app_data_dir()?;
    let fonts_dir = app_data_dir.join("fonts");

    restore_preset_local_fonts_in_dir(&fonts_dir, font_settings, embedded_local_fonts)
}

fn restore_preset_local_fonts_in_dir(
    fonts_dir: &Path,
    font_settings: &mut FontSettings,
    embedded_local_fonts: Option<&[EmbeddedLocalFont]>,
) -> CmdResult<()> {
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

    fs::create_dir_all(fonts_dir)?;

    for font in font_settings.custom_fonts.iter_mut() {
        if font.font_type != FontType::Local {
            continue;
        }

        // 로컬 폰트는 항상 복사된 파일 경로로 제공
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

        // 하위 호환: 기존 절대 경로가 유효하면 유지
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

fn restore_preset_local_images(
    app: &AppHandle,
    key_positions: &mut KeyPositions,
    stat_positions: &mut StatPositions,
    graph_positions: &mut GraphPositions,
    knob_positions: &mut KnobPositions,
    embedded_local_images: Option<&[EmbeddedLocalImage]>,
) -> CmdResult<()> {
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
    }) || knob_positions.values().any(|positions| {
        positions.iter().any(|knob_position| {
            option_has_non_empty_text(&knob_position.position.active_image)
                || option_has_non_empty_text(&knob_position.position.inactive_image)
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

    let app_data_dir = app.path().app_data_dir()?;
    let images_dir = app_data_dir.join("images");
    fs::create_dir_all(&images_dir)?;

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

    for positions in knob_positions.values_mut() {
        for knob_position in positions.iter_mut() {
            restore_position_image_reference(
                &images_dir,
                &embedded_map,
                &mut restored_path_cache,
                &mut knob_position.position.active_image,
            )?;
            restore_position_image_reference(
                &images_dir,
                &embedded_map,
                &mut restored_path_cache,
                &mut knob_position.position.inactive_image,
            )?;
        }
    }

    Ok(())
}

fn restore_position_image_reference(
    images_dir: &Path,
    embedded_map: &HashMap<&str, &EmbeddedLocalImage>,
    restored_path_cache: &mut HashMap<String, String>,
    image_ref: &mut Option<String>,
) -> CmdResult<()> {
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

    // 레거시 Preset 호환: data URL 이미지를 appdata 파일 경로로 변환
    if let Some((bytes, extension)) = decode_image_data_url(trimmed) {
        let dest_path = images_dir.join(format!("{}.{}", Uuid::new_v4(), extension));
        fs::write(&dest_path, bytes)?;
        *image_ref = Some(dest_path.to_string_lossy().to_string());
        return Ok(());
    }

    // 레거시 호환: 로컬 절대 경로를 appdata/images로 복사
    if let Some(source_path) = super::local_source_path_from_image_ref(trimmed) {
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

        // 다른 기기에서 import된 Preset: 해석 불가한 절대 경로는 정상 fallback 처리
        *image_ref = None;
        return Ok(());
    }

    Ok(())
}

fn restore_preset_local_sounds(
    app: &AppHandle,
    key_positions: &mut KeyPositions,
    stat_positions: &mut StatPositions,
    graph_positions: &mut GraphPositions,
    knob_positions: &mut KnobPositions,
    embedded_local_sounds: Option<&[EmbeddedLocalSound]>,
) -> CmdResult<()> {
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
    }) || knob_positions.values().any(|positions| {
        positions
            .iter()
            .any(|knob_position| option_has_non_empty_text(&knob_position.position.sound_path))
    });

    if !has_any_sounds {
        return Ok(());
    }

    let app_data_dir = app.path().app_data_dir()?;
    let sounds_dir = app_data_dir.join("sounds");

    restore_preset_local_sounds_in_dir(
        &sounds_dir,
        key_positions,
        stat_positions,
        graph_positions,
        knob_positions,
        embedded_local_sounds,
    )
}

fn restore_preset_local_sounds_in_dir(
    sounds_dir: &Path,
    key_positions: &mut KeyPositions,
    stat_positions: &mut StatPositions,
    graph_positions: &mut GraphPositions,
    knob_positions: &mut KnobPositions,
    embedded_local_sounds: Option<&[EmbeddedLocalSound]>,
) -> CmdResult<()> {
    fs::create_dir_all(sounds_dir)?;

    let embedded_map: HashMap<&str, &EmbeddedLocalSound> = embedded_local_sounds
        .unwrap_or(&[])
        .iter()
        .map(|sound| (sound.sound_id.as_str(), sound))
        .collect();

    let mut restored_path_cache: HashMap<String, String> = HashMap::new();

    for positions in key_positions.values_mut() {
        for position in positions.iter_mut() {
            restore_position_sound_reference(
                sounds_dir,
                &embedded_map,
                &mut restored_path_cache,
                &mut position.sound_path,
            )?;
        }
    }

    for positions in stat_positions.values_mut() {
        for stat_position in positions.iter_mut() {
            restore_position_sound_reference(
                sounds_dir,
                &embedded_map,
                &mut restored_path_cache,
                &mut stat_position.position.sound_path,
            )?;
        }
    }

    for positions in graph_positions.values_mut() {
        for graph_position in positions.iter_mut() {
            restore_position_sound_reference(
                sounds_dir,
                &embedded_map,
                &mut restored_path_cache,
                &mut graph_position.position.sound_path,
            )?;
        }
    }

    for positions in knob_positions.values_mut() {
        for knob_position in positions.iter_mut() {
            restore_position_sound_reference(
                sounds_dir,
                &embedded_map,
                &mut restored_path_cache,
                &mut knob_position.position.sound_path,
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
) -> CmdResult<()> {
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
    let path = std::path::PathBuf::from(trimmed);
    if path.is_absolute() && path.exists() {
        return Ok(());
    }

    // 다른 기기에서 임포트된 프리셋: 경로를 해석할 수 없으면 초기화.
    *sound_ref = None;
    Ok(())
}

fn synthesize_custom_tabs(keys: &KeyMappings) -> Vec<crate::models::CustomTab> {
    let default_modes = default_keys();
    let mut index = 0usize;
    keys.keys()
        .filter(|key| !default_modes.contains_key(*key))
        .map(|id| {
            index += 1;
            crate::models::CustomTab {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        defaults::default_positions,
        models::{CustomFont, KnobPosition},
    };

    #[test]
    fn tab_preset_duplicate_font_does_not_create_embedded_file() {
        let temp_dir = std::env::temp_dir().join(format!(
            "dmnote-tab-preset-font-load-test-{}",
            uuid::Uuid::new_v4()
        ));
        let fonts_dir = temp_dir.join("fonts");
        std::fs::create_dir_all(&fonts_dir).unwrap();
        let existing_path = fonts_dir.join("existing.ttf");
        std::fs::write(&existing_path, b"existing-font").unwrap();

        let existing_fonts = FontSettings {
            custom_fonts: vec![CustomFont {
                id: "existing-id".to_string(),
                font_type: FontType::Local,
                name: "SharedFont".to_string(),
                display_name: "Existing Font".to_string(),
                enabled: true,
                local_path: Some(existing_path.to_string_lossy().to_string()),
                css_content: None,
            }],
        };
        let imported_font_id = "imported-id".to_string();
        let imported_fonts = FontSettings {
            custom_fonts: vec![CustomFont {
                id: imported_font_id.clone(),
                font_type: FontType::Local,
                name: "SharedFont".to_string(),
                display_name: "Imported Font".to_string(),
                enabled: true,
                local_path: None,
                css_content: None,
            }],
        };
        let embedded_fonts = vec![EmbeddedLocalFont {
            font_id: imported_font_id,
            extension: Some("ttf".to_string()),
            data_base64: BASE64_STANDARD.encode(b"imported-font"),
        }];
        let file_count_before = std::fs::read_dir(&fonts_dir).unwrap().count();

        let merged = merge_tab_preset_fonts(&existing_fonts, imported_fonts, |filtered_fonts| {
            restore_preset_local_fonts_in_dir(&fonts_dir, filtered_fonts, Some(&embedded_fonts))
        })
        .unwrap();

        assert!(merged.is_none());
        assert_eq!(
            std::fs::read_dir(&fonts_dir).unwrap().count(),
            file_count_before
        );
        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn legacy_percent_encoded_file_url_is_copied_on_import() {
        let temp_dir = std::env::temp_dir().join(format!(
            "dmnote-preset-image-url-load-test-{}",
            uuid::Uuid::new_v4()
        ));
        let source_dir = temp_dir.join("source folder");
        let images_dir = temp_dir.join("restored-images");
        std::fs::create_dir_all(&source_dir).unwrap();
        std::fs::create_dir_all(&images_dir).unwrap();
        let source_path = source_dir.join("image with space.png");
        std::fs::write(&source_path, b"legacy-image").unwrap();
        let mut image_ref = Some(url::Url::from_file_path(&source_path).unwrap().to_string());

        restore_position_image_reference(
            &images_dir,
            &HashMap::new(),
            &mut HashMap::new(),
            &mut image_ref,
        )
        .unwrap();

        let restored_path = Path::new(image_ref.as_deref().unwrap());
        assert!(restored_path.starts_with(&images_dir));
        assert_eq!(std::fs::read(restored_path).unwrap(), b"legacy-image");
        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn sound_restore_restores_knob_sound() {
        let temp_dir = std::env::temp_dir().join(format!(
            "dmnote-preset-knob-load-test-{}",
            uuid::Uuid::new_v4()
        ));
        let sounds_dir = temp_dir.join("sounds");
        let sound_id = "knob-sound";
        let embedded = vec![EmbeddedLocalSound {
            sound_id: sound_id.to_string(),
            extension: Some("wav".to_string()),
            data_base64: BASE64_STANDARD.encode(b"restored-knob-sound"),
        }];

        let mut position = default_positions()["4key"][0].clone();
        position.sound_path = Some(format!("{PRESET_LOCAL_SOUND_PREFIX}{sound_id}"));
        let mut knob_positions = KnobPositions::new();
        knob_positions.insert(
            "4key".to_string(),
            vec![KnobPosition {
                axis_id: "axis".to_string(),
                sensitivity: 1.0,
                reverse: false,
                position,
            }],
        );

        restore_preset_local_sounds_in_dir(
            &sounds_dir,
            &mut KeyPositions::new(),
            &mut StatPositions::new(),
            &mut GraphPositions::new(),
            &mut knob_positions,
            Some(&embedded),
        )
        .unwrap();

        let restored_path = Path::new(
            knob_positions["4key"][0]
                .position
                .sound_path
                .as_deref()
                .unwrap(),
        );
        assert!(restored_path.starts_with(&sounds_dir));
        assert_eq!(
            std::fs::read(restored_path).unwrap(),
            b"restored-knob-sound"
        );
        let _ = std::fs::remove_dir_all(temp_dir);
    }
}
