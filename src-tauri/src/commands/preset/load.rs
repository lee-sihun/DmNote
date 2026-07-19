use std::{
    collections::{BTreeSet, HashMap, HashSet},
    fs,
    path::Path,
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use rfd::FileDialog;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::{
    commands::editor::{
        css::TabCssResponse,
        state::{emit_best_effort, publish_editor_change},
    },
    defaults::{default_keys, default_positions},
    errors::{CmdResult, CommandError},
    models::{
        AppStoreData, CommittedEditorChange, CustomCss, CustomCssPatch, CustomJs, CustomJsPatch,
        EditorCommitOrigin, EditorField, FontSettings, FontType, GradientSpec, GraphPositions,
        KeyMappings, KeyPosition, KeyPositions, KnobPositions, LayerGroups, NoteSettings,
        NoteSettingsPatch, SettingsPatchInput, StatPositions, TabCssOverrides, TabNoteSettings,
        SHADOW_BLUR_MAX, SHADOW_BLUR_MIN, SHADOW_OFFSET_MAX, SHADOW_OFFSET_MIN,
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

fn apply_editor_runtime_best_effort(
    state: &AppState,
    app: &AppHandle,
    change: &CommittedEditorChange,
) {
    if let Err(error) = state.apply_committed_editor_key_runtime(
        app,
        &change.document.keys,
        &change.selected_key_type,
        &change.key_counters,
    ) {
        log::error!("[Preset] failed to publish committed key counters: {error:#}");
    }
    state.obs_broadcast_counters();
    state.refresh_obs_snapshot();
}

fn read_preset_file(path: &Path) -> CmdResult<PresetFile> {
    let content = fs::read_to_string(path)?;
    let value: serde_json::Value =
        serde_json::from_str(&content).map_err(|_| CommandError::msg("invalid-preset"))?;
    if let Some(detail) = invalid_position_style_detail(&value) {
        return Err(CommandError::msg(format!("invalid-preset: {detail}")));
    }
    serde_json::from_value(value).map_err(|_| CommandError::msg("invalid-preset"))
}

fn invalid_position_style_detail(preset: &serde_json::Value) -> Option<String> {
    const COLLECTIONS: [&str; 4] = [
        "keyPositions",
        "statPositions",
        "graphPositions",
        "knobPositions",
    ];
    const ELEMENT_FIELDS: [&str; 4] = [
        "backgroundGradient",
        "activeBackgroundGradient",
        "borderGradient",
        "activeBorderGradient",
    ];
    const COUNTER_FIELDS: [&str; 2] = ["fillIdleGradient", "fillActiveGradient"];
    const SHADOW_FIELDS: [&str; 2] = ["shadow", "activeShadow"];

    for collection_name in COLLECTIONS {
        let Some(modes) = preset
            .get(collection_name)
            .and_then(serde_json::Value::as_object)
        else {
            continue;
        };
        for (mode, entries) in modes {
            let Some(entries) = entries.as_array() else {
                continue;
            };
            for (index, entry) in entries.iter().enumerate() {
                let Some(entry) = entry.as_object() else {
                    continue;
                };
                for field in ELEMENT_FIELDS {
                    if let Some(error) = invalid_gradient_error(entry.get(field)) {
                        return Some(format!(
                            "{collection_name}[{mode:?}][{index}].{field}: {error}"
                        ));
                    }
                }
                for field in SHADOW_FIELDS {
                    // null은 Option 역직렬화와 동일하게 "값 없음" 취급
                    let Some(value) = entry.get(field).filter(|value| !value.is_null()) else {
                        continue;
                    };
                    if let Some((suffix, error)) = invalid_shadow_error(value) {
                        return Some(format!(
                            "{collection_name}[{mode:?}][{index}].{field}{suffix}: {error}"
                        ));
                    }
                }
                let Some(counter) = entry.get("counter").and_then(serde_json::Value::as_object)
                else {
                    continue;
                };
                for field in COUNTER_FIELDS {
                    if let Some(error) = invalid_gradient_error(counter.get(field)) {
                        return Some(format!(
                            "{collection_name}[{mode:?}][{index}].counter.{field}: {error}"
                        ));
                    }
                }
            }
        }
    }
    None
}

fn invalid_gradient_error(value: Option<&serde_json::Value>) -> Option<serde_json::Error> {
    value.and_then(|value| serde_json::from_value::<Option<GradientSpec>>(value.clone()).err())
}

fn invalid_shadow_error(value: &serde_json::Value) -> Option<(&'static str, &'static str)> {
    let Some(shadow) = value.as_object() else {
        return Some(("", "must be an object"));
    };
    if !shadow
        .get("enabled")
        .is_some_and(serde_json::Value::is_boolean)
    {
        return Some((".enabled", "must be a boolean"));
    }
    if shadow
        .get("color")
        .and_then(serde_json::Value::as_str)
        .is_none_or(str::is_empty)
    {
        return Some((".color", "must be a non-empty string"));
    }
    for field in ["offsetX", "offsetY"] {
        if !shadow
            .get(field)
            .and_then(serde_json::Value::as_f64)
            .is_some_and(|value| {
                value.is_finite() && (SHADOW_OFFSET_MIN..=SHADOW_OFFSET_MAX).contains(&value)
            })
        {
            let suffix = if field == "offsetX" {
                ".offsetX"
            } else {
                ".offsetY"
            };
            return Some((suffix, "must be a finite number between -100 and 100"));
        }
    }
    if !shadow
        .get("blur")
        .and_then(serde_json::Value::as_f64)
        .is_some_and(|value| {
            value.is_finite() && (SHADOW_BLUR_MIN..=SHADOW_BLUR_MAX).contains(&value)
        })
    {
        return Some((".blur", "must be a finite number between 0 and 100"));
    }
    None
}

#[cfg(test)]
pub(crate) fn read_preset_file_for_simulation(path: &Path) -> CmdResult<PresetFile> {
    read_preset_file(path)
}

struct ResolvedFullPresetSettings {
    background_color: String,
    note_settings: NoteSettings,
    note_effect: bool,
    laboratory_enabled: bool,
    use_custom_css: bool,
    custom_css: CustomCss,
    use_custom_js: bool,
    custom_js: CustomJs,
}

/// 과거 프리셋에 없던 전역 필드는 현재 값을 보존해 신규 설정을 지우지 않음
fn resolve_full_preset_settings(
    preset: &mut PresetFile,
    current: &AppStoreData,
) -> ResolvedFullPresetSettings {
    ResolvedFullPresetSettings {
        background_color: preset
            .background_color
            .take()
            .unwrap_or_else(|| current.background_color.clone()),
        note_settings: preset
            .note_settings
            .take()
            .unwrap_or_else(|| current.note_settings.clone()),
        note_effect: preset.note_effect.unwrap_or(current.note_effect),
        laboratory_enabled: preset
            .laboratory_enabled
            .unwrap_or(current.laboratory_enabled),
        use_custom_css: preset.use_custom_css.unwrap_or(current.use_custom_css),
        custom_css: preset
            .custom_css
            .take()
            .unwrap_or_else(|| current.custom_css.clone()),
        use_custom_js: preset.use_custom_js.unwrap_or(current.use_custom_js),
        custom_js: preset
            .custom_js
            .take()
            .unwrap_or_else(|| current.custom_js.clone()),
    }
}

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

    let mut preset = read_preset_file(&path)?;
    let current = state.store.snapshot();
    let resolved_settings = resolve_full_preset_settings(&mut preset, &current);

    let mut keys = preset.keys.unwrap_or_else(|| default_keys().clone());
    let mut positions = preset
        .key_positions
        .unwrap_or_else(|| default_positions().clone());
    let mut stat_positions = preset.stat_positions.unwrap_or_default();
    let mut graph_positions = preset.graph_positions.unwrap_or_default();
    let mut knob_positions = preset.knob_positions.unwrap_or_default();
    let custom_tabs = preset
        .custom_tabs
        .unwrap_or_else(|| synthesize_custom_tabs(&keys));
    let requested_selected_key_type = preset.selected_key_type;
    let preset_layer_groups = resolve_full_preset_layer_groups(preset.layer_groups, &keys);
    let preset_tab_css_overrides = preset.tab_css_overrides;

    let mut desired_settings = resolved_settings.note_settings;
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

    let css_use = resolved_settings.use_custom_css;
    let custom_css = resolved_settings.custom_css;
    let js_use = resolved_settings.use_custom_js;
    let custom_js = resolved_settings.custom_js;
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
    align_imported_key_collections(&mut keys, &mut positions);

    // 탭별 노트 설정 복원 (없으면 빈 맵으로 초기화 → 전역 폴백)
    let mut tab_note_overrides = preset.tab_note_overrides.unwrap_or_default();
    for tab in tab_note_overrides.values_mut() {
        tab.migrate_fade_position();
    }

    let settings_patch = SettingsPatchInput {
        background_color: Some(resolved_settings.background_color),
        note_settings: Some(note_patch),
        note_effect: Some(resolved_settings.note_effect),
        laboratory_enabled: Some(resolved_settings.laboratory_enabled),
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
    let transaction = state.store.commit_legacy_editor_transaction(
        EditorCommitOrigin::LegacyAdapter("preset_load".to_string()),
        &[
            EditorField::Keys,
            EditorField::KeyPositions,
            EditorField::StatPositions,
            EditorField::GraphPositions,
            EditorField::KnobPositions,
            EditorField::LayerGroups,
        ],
        move |store| {
            let previous_tab_css_overrides = store.tab_css_overrides.clone();
            let selected_key_type = choose_selected_key_type(
                requested_selected_key_type,
                &keys,
                store.selected_key_type.clone(),
            );
            store.keys = keys;
            store.key_positions = positions;
            store.stat_positions = stat_positions;
            store.graph_positions = graph_positions;
            store.knob_positions = knob_positions;
            store.custom_tabs = custom_tabs;
            store.selected_key_type = selected_key_type;
            store.tab_note_overrides = tab_note_overrides;
            store.layer_groups = preset_layer_groups;
            if let Some(tab_css_overrides) = preset_tab_css_overrides {
                store.tab_css_overrides = tab_css_overrides;
            }
            crate::state::migration::clear_dangling_group_ids(store);
            let diff = apply_patch_to_store(store, &settings_patch);
            Ok((
                diff,
                previous_tab_css_overrides,
                store.custom_tabs.clone(),
                store.tab_note_overrides.clone(),
                store.tab_css_overrides.clone(),
            ))
        },
    )?;
    publish_editor_change(state.inner(), &app, &transaction.change, false);
    if !transaction
        .change
        .result
        .changed_fields
        .contains(&EditorField::Keys)
    {
        apply_editor_runtime_best_effort(state.inner(), &app, &transaction.change);
    }

    let (diff, previous_tab_css_overrides, custom_tabs, tab_note_overrides, tab_css_overrides) =
        transaction.value;
    let selected_key_type = transaction.change.selected_key_type.clone();
    let keys = transaction.change.document.keys;
    let positions = transaction.change.document.key_positions;
    let stat_positions = transaction.change.document.stat_positions;
    let graph_positions = transaction.change.document.graph_positions;
    let knob_positions = transaction.change.document.knob_positions;
    let layer_groups = transaction.change.document.layer_groups;

    if let Err(error) = state.emit_settings_changed(&diff, &app) {
        log::error!("[Preset] failed to publish settings change: {error:#}");
    }
    emit_best_effort(&app, "layerGroups:changed", &layer_groups);
    sync_tab_css_runtime(
        state.inner(),
        &app,
        &previous_tab_css_overrides,
        &tab_css_overrides,
    );

    // 프리셋 데이터를 단일 이벤트로 원자적 전달
    emit_best_effort(
        &app,
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
    );
    emit_best_effort(&app, "css:use", &serde_json::json!({ "enabled": css_use }));
    emit_best_effort(&app, "css:content", &custom_css);
    emit_best_effort(&app, "js:use", &serde_json::json!({ "enabled": js_use }));
    emit_best_effort(&app, "js:content", &custom_js);

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

    let preset = read_preset_file(&path)?;

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

    let (current_tab_id, existing_font_settings) = state
        .store
        .with_state(|store| (store.selected_key_type.clone(), store.font_settings.clone()));

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

    let has_tab_note_overrides = tab_note_overrides.is_some();
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

    let imported_key_positions = src_key_positions.remove(&current_tab_id);
    let imported_stat_positions = src_stat_positions.remove(&current_tab_id);
    let imported_graph_positions = src_graph_positions.remove(&current_tab_id);
    let imported_knob_positions = src_knob_positions.remove(&current_tab_id);
    let imported_override = imported_tab_note_overrides.get(&source_tab_id).cloned();
    let imported_groups =
        layer_groups.map(|groups| groups.get(&source_tab_id).cloned().unwrap_or_default());
    let imported_tab_css =
        tab_css_overrides.map(|overrides| overrides.get(&source_tab_id).cloned());

    // 프리셋에 담긴 폰트를 현재 폰트 목록에 병합 (탭 로드는 전역 설정을 덮지 않음)
    let prepared_font_settings = if let Some(imported_fonts) = font_settings {
        prepare_tab_preset_fonts(&existing_font_settings, imported_fonts, |filtered_fonts| {
            restore_preset_local_fonts(&app, filtered_fonts, embedded_local_fonts.as_deref())
        })?
    } else {
        None
    };

    let transaction = state.store.commit_legacy_editor_transaction(
        EditorCommitOrigin::LegacyAdapter("preset_load_tab".to_string()),
        &[
            EditorField::Keys,
            EditorField::KeyPositions,
            EditorField::StatPositions,
            EditorField::GraphPositions,
            EditorField::KnobPositions,
            EditorField::LayerGroups,
        ],
        move |store| {
            let previous_tab_css_overrides = store.tab_css_overrides.clone();
            merge_tab_preset_key_pair(store, &current_tab_id, src_keys, imported_key_positions);
            if let Some(positions) = imported_stat_positions {
                store
                    .stat_positions
                    .insert(current_tab_id.clone(), positions);
            }
            if let Some(positions) = imported_graph_positions {
                store
                    .graph_positions
                    .insert(current_tab_id.clone(), positions);
            }
            if let Some(positions) = imported_knob_positions {
                store
                    .knob_positions
                    .insert(current_tab_id.clone(), positions);
            }
            apply_tab_note_override(
                store,
                &current_tab_id,
                has_tab_note_overrides,
                imported_override,
            );
            if let Some(groups) = imported_groups {
                store.layer_groups.insert(current_tab_id.clone(), groups);
            }
            if let Some(css) = imported_tab_css {
                if let Some(css) = css {
                    store.tab_css_overrides.insert(current_tab_id.clone(), css);
                } else {
                    store.tab_css_overrides.remove(&current_tab_id);
                }
            }

            let settings_diff = prepared_font_settings
                .and_then(|prepared| {
                    merge_prepared_tab_preset_fonts(&store.font_settings, prepared)
                })
                .map(|font_settings| {
                    apply_patch_to_store(
                        store,
                        &SettingsPatchInput {
                            font_settings: Some(font_settings),
                            ..SettingsPatchInput::default()
                        },
                    )
                });
            crate::state::migration::clear_dangling_group_ids(store);
            Ok((
                settings_diff,
                previous_tab_css_overrides,
                store.tab_note_overrides.clone(),
                store.tab_css_overrides.clone(),
            ))
        },
    )?;
    publish_editor_change(state.inner(), &app, &transaction.change, false);
    if !transaction
        .change
        .result
        .changed_fields
        .contains(&EditorField::Keys)
    {
        apply_editor_runtime_best_effort(state.inner(), &app, &transaction.change);
    }
    let (
        settings_diff,
        previous_tab_css_overrides,
        full_tab_note_overrides,
        full_tab_css_overrides,
    ) = transaction.value;
    let full_keys = transaction.change.document.keys;
    let full_positions = transaction.change.document.key_positions;
    let full_stat_positions = transaction.change.document.stat_positions;
    let full_graph_positions = transaction.change.document.graph_positions;
    let full_knob_positions = transaction.change.document.knob_positions;
    let full_layer_groups = transaction.change.document.layer_groups;

    if let Some(diff) = settings_diff.as_ref() {
        if let Err(error) = state.emit_settings_changed(diff, &app) {
            log::error!("[Preset] failed to publish tab preset settings: {error:#}");
        }
    }

    emit_best_effort(&app, "layerGroups:changed", &full_layer_groups);
    sync_tab_css_runtime(
        state.inner(),
        &app,
        &previous_tab_css_overrides,
        &full_tab_css_overrides,
    );
    emit_best_effort(&app, "keys:changed", &full_keys);
    emit_best_effort(&app, "positions:changed", &full_positions);
    emit_best_effort(&app, "statPositions:changed", &full_stat_positions);
    emit_best_effort(&app, "graphPositions:changed", &full_graph_positions);
    emit_best_effort(&app, "knobPositions:changed", &full_knob_positions);
    emit_best_effort(&app, "tabNote:changed_all", &full_tab_note_overrides);

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
) {
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

        emit_best_effort(
            app,
            "tabCss:changed",
            &TabCssResponse {
                tab_id: tab_id.clone(),
                css,
            },
        );
    }
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

fn align_imported_key_pair(keys: &mut Vec<String>, positions: &mut Vec<KeyPosition>) {
    if keys.len() < positions.len() {
        keys.resize(positions.len(), String::new());
    } else if positions.len() < keys.len() {
        positions.resize(keys.len(), KeyPosition::default());
    }
}

fn align_imported_key_collections(keys: &mut KeyMappings, positions: &mut KeyPositions) {
    let modes = keys
        .keys()
        .chain(positions.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    for mode in modes {
        let mode_keys = keys.entry(mode.clone()).or_default();
        let mode_positions = positions.entry(mode).or_default();
        align_imported_key_pair(mode_keys, mode_positions);
    }
}

fn merge_tab_preset_key_pair(
    store: &mut AppStoreData,
    current_tab_id: &str,
    mut keys: Vec<String>,
    imported_positions: Option<Vec<KeyPosition>>,
) {
    let mut positions = imported_positions.unwrap_or_else(|| {
        store
            .key_positions
            .get(current_tab_id)
            .cloned()
            .unwrap_or_default()
    });
    align_imported_key_pair(&mut keys, &mut positions);
    store.keys.insert(current_tab_id.to_string(), keys);
    store
        .key_positions
        .insert(current_tab_id.to_string(), positions);
}

#[cfg(test)]
fn merge_tab_preset_fonts(
    existing_font_settings: &FontSettings,
    imported_font_settings: FontSettings,
    restore_fonts: impl FnOnce(&mut FontSettings) -> CmdResult<()>,
) -> CmdResult<Option<FontSettings>> {
    let Some(prepared) = prepare_tab_preset_fonts(
        existing_font_settings,
        imported_font_settings,
        restore_fonts,
    )?
    else {
        return Ok(None);
    };
    Ok(merge_prepared_tab_preset_fonts(
        existing_font_settings,
        prepared,
    ))
}

fn prepare_tab_preset_fonts(
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

    Ok(Some(imported_font_settings))
}

fn merge_prepared_tab_preset_fonts(
    existing_font_settings: &FontSettings,
    mut prepared: FontSettings,
) -> Option<FontSettings> {
    let mut existing_names = existing_font_settings
        .custom_fonts
        .iter()
        .map(|font| font.name.clone())
        .collect::<HashSet<_>>();
    prepared
        .custom_fonts
        .retain(|font| existing_names.insert(font.name.clone()));
    if prepared.custom_fonts.is_empty() {
        return None;
    }

    let mut existing_ids = existing_font_settings
        .custom_fonts
        .iter()
        .map(|font| font.id.clone())
        .collect::<HashSet<_>>();
    for font in &mut prepared.custom_fonts {
        if existing_ids.contains(&font.id) {
            font.id = Uuid::new_v4().to_string();
        }
        existing_ids.insert(font.id.clone());
    }

    let mut merged = existing_font_settings.clone();
    merged.custom_fonts.extend(prepared.custom_fonts);
    Some(merged)
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
            log::warn!(
                "[Preset] Disabling font '{}' — no embedded payload and its file is missing on this machine",
                font.name
            );
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
        log::warn!(
            "[Preset] Clearing image reference to a file missing on this machine: {trimmed}"
        );
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
    log::warn!("[Preset] Clearing sound reference to a file missing on this machine: {trimmed}");
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

fn apply_tab_note_override(
    store: &mut AppStoreData,
    tab_id: &str,
    field_present: bool,
    imported: Option<TabNoteSettings>,
) {
    if !field_present {
        return;
    }
    if let Some(settings) = imported {
        store
            .tab_note_overrides
            .insert(tab_id.to_string(), settings);
    } else {
        store.tab_note_overrides.remove(tab_id);
    }
}

fn resolve_full_preset_layer_groups(
    imported: Option<LayerGroups>,
    keys: &KeyMappings,
) -> LayerGroups {
    imported.unwrap_or_else(|| {
        keys.keys()
            .cloned()
            .map(|mode| (mode, Vec::new()))
            .collect()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        defaults::{default_keys, default_positions},
        models::{CustomFont, JsPlugin, KnobPosition},
    };

    #[test]
    fn preset_source_bytes_remain_unchanged_on_success_and_parse_failure() {
        let temp_dir = std::env::temp_dir().join(format!(
            "dmnote-preset-read-only-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let source_path = temp_dir.join("source.json");

        let valid_source = br#"{
  "keys": { "custom": ["Q"] },
  "keyPositions": {
    "custom": [{ "dx": 12.5, "dy": -4.0, "width": 61.0, "count": 3 }]
  },
  "customJS": {
    "path": null,
    "content": "globalThis.oldPreset = true",
    "plugins": [{
      "id": "plugin-source",
      "name": "Source plugin",
      "path": null,
      "content": "void 0",
      "enabled": true
    }]
  },
  "embeddedLocalImages": [{
    "imageId": "image-source",
    "extension": "png",
    "dataBase64": "AA=="
  }]
}"#;
        std::fs::write(&source_path, valid_source).unwrap();
        let parsed = read_preset_file(&source_path).unwrap();
        assert_eq!(parsed.keys.as_ref().unwrap()["custom"], ["Q"]);
        assert_eq!(parsed.key_positions.as_ref().unwrap()["custom"][0].dx, 12.5);
        assert_eq!(
            parsed.custom_js.as_ref().unwrap().plugins[0].id,
            "plugin-source"
        );
        assert_eq!(
            parsed.embedded_local_images.as_ref().unwrap()[0].image_id,
            "image-source"
        );
        assert_eq!(std::fs::read(&source_path).unwrap(), valid_source);

        let invalid_source = b"{ invalid preset";
        std::fs::write(&source_path, invalid_source).unwrap();
        assert!(read_preset_file(&source_path).is_err());
        assert_eq!(std::fs::read(&source_path).unwrap(), invalid_source);

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn damaged_gradient_preset_reports_element_and_field_with_existing_error_code() {
        let temp_dir = std::env::temp_dir().join(format!(
            "dmnote-preset-gradient-error-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let source_path = temp_dir.join("source.json");
        let damaged_gradient = serde_json::json!({
            "angle": 90,
            "stops": [{ "color": "#FFFFFF", "pos": 0 }]
        });

        for (collection, field, counter_field) in [
            ("keyPositions", "backgroundGradient", false),
            ("statPositions", "activeBackgroundGradient", false),
            ("graphPositions", "borderGradient", false),
            ("knobPositions", "activeBorderGradient", false),
            ("keyPositions", "fillIdleGradient", true),
            ("statPositions", "fillActiveGradient", true),
        ] {
            let mut gradient_fields = serde_json::Map::new();
            gradient_fields.insert(field.to_string(), damaged_gradient.clone());
            let damaged_entry = if counter_field {
                let mut entry = serde_json::Map::new();
                entry.insert(
                    "counter".to_string(),
                    serde_json::Value::Object(gradient_fields),
                );
                serde_json::Value::Object(entry)
            } else {
                serde_json::Value::Object(gradient_fields)
            };
            let mut modes = serde_json::Map::new();
            modes.insert(
                "custom mode".to_string(),
                serde_json::json!([{}, damaged_entry]),
            );
            let mut preset = serde_json::Map::new();
            preset.insert(collection.to_string(), serde_json::Value::Object(modes));
            std::fs::write(
                &source_path,
                serde_json::to_vec(&serde_json::Value::Object(preset)).unwrap(),
            )
            .unwrap();

            let error = read_preset_file(&source_path)
                .err()
                .expect("damaged gradient preset must be rejected")
                .to_string();
            let field_path = if counter_field {
                format!("counter.{field}")
            } else {
                field.to_string()
            };
            let expected_prefix =
                format!("invalid-preset: {collection}[\"custom mode\"][1].{field_path}: ");
            assert!(
                error.starts_with(&expected_prefix),
                "unexpected gradient error: {error}"
            );
            assert!(error.contains("gradient must contain at least two stops"));
        }

        std::fs::write(&source_path, b"{ invalid preset").unwrap();
        assert_eq!(
            read_preset_file(&source_path)
                .err()
                .expect("invalid JSON preset must be rejected")
                .to_string(),
            "invalid-preset"
        );

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn invalid_shadow_preset_reports_exact_element_paths() {
        let temp_dir = std::env::temp_dir().join(format!(
            "dmnote-preset-shadow-error-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let source_path = temp_dir.join("source.json");
        for (collection, entry, expected_path, expected_reason) in [
            (
                "keyPositions",
                serde_json::json!({
                    "shadow": {
                        "enabled": true,
                        "color": "#123456",
                        "offsetX": 0,
                        "offsetY": 0,
                        "blur": 100.1
                    }
                }),
                "shadow.blur",
                "must be a finite number between 0 and 100",
            ),
            (
                "statPositions",
                serde_json::json!({
                    "activeShadow": {
                        "enabled": true,
                        "color": "#123456",
                        "offsetX": -100.1,
                        "offsetY": 0,
                        "blur": 12
                    }
                }),
                "activeShadow.offsetX",
                "must be a finite number between -100 and 100",
            ),
            (
                "graphPositions",
                serde_json::json!({
                    "shadow": {
                        "enabled": true,
                        "color": "#123456",
                        "offsetX": 0,
                        "offsetY": 100.1,
                        "blur": 12
                    }
                }),
                "shadow.offsetY",
                "must be a finite number between -100 and 100",
            ),
            (
                "knobPositions",
                serde_json::json!({ "activeShadow": [] }),
                "activeShadow",
                "must be an object",
            ),
            (
                "keyPositions",
                serde_json::json!({
                    "shadow": {
                        "enabled": true,
                        "color": "",
                        "offsetX": 0,
                        "offsetY": 0,
                        "blur": 12
                    }
                }),
                "shadow.color",
                "must be a non-empty string",
            ),
        ] {
            let preset = serde_json::json!({
                (collection): {
                    "custom mode": [{}, entry]
                }
            });
            std::fs::write(&source_path, serde_json::to_vec(&preset).unwrap()).unwrap();

            let error = read_preset_file(&source_path)
                .err()
                .expect("invalid shadow preset must be rejected")
                .to_string();
            assert_eq!(
                error,
                format!(
                    "invalid-preset: {collection}[\"custom mode\"][1].{expected_path}: {expected_reason}"
                )
            );
        }

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn null_shadow_fields_are_treated_as_absent() {
        let temp_dir = std::env::temp_dir().join(format!(
            "dmnote-preset-shadow-null-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let source_path = temp_dir.join("source.json");

        // 외부 생성·수동 편집 프리셋의 명시적 null은 Option 역직렬화처럼 값 없음
        let preset = serde_json::json!({
            "keyPositions": {
                "4key": [{
                    "dx": 0,
                    "dy": 0,
                    "width": 60,
                    "count": 0,
                    "shadow": null,
                    "activeShadow": null
                }]
            }
        });
        std::fs::write(&source_path, serde_json::to_vec(&preset).unwrap()).unwrap();

        let parsed = read_preset_file(&source_path).expect("null fields must parse as absent");
        let position = &parsed.key_positions.as_ref().unwrap()["4key"][0];
        assert!(position.shadow.is_none());
        assert!(position.active_shadow.is_none());

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn legacy_and_bounded_shadow_presets_still_parse() {
        let temp_dir = std::env::temp_dir().join(format!(
            "dmnote-preset-shadow-compatibility-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let source_path = temp_dir.join("source.json");

        let legacy = serde_json::json!({
            "keyPositions": {
                "4key": [{ "dx": 0, "dy": 0, "width": 60, "count": 0 }]
            }
        });
        std::fs::write(&source_path, serde_json::to_vec(&legacy).unwrap()).unwrap();
        let parsed_legacy = read_preset_file(&source_path).unwrap();
        let legacy_position = &parsed_legacy.key_positions.unwrap()["4key"][0];
        assert!(legacy_position.shadow.is_none());
        assert!(legacy_position.active_shadow.is_none());

        let position = serde_json::json!({
            "dx": 0,
            "dy": 0,
            "width": 60,
            "count": 0,
            "shadow": {
                "enabled": true,
                "color": "#123456",
                "offsetX": -100,
                "offsetY": 100,
                "blur": 100
            },
            "activeShadow": {
                "enabled": false,
                "color": "rgba(0, 0, 0, 0)",
                "offsetX": 100,
                "offsetY": -100,
                "blur": 0
            }
        });
        let mut stat = position.clone();
        stat.as_object_mut()
            .unwrap()
            .insert("statType".to_string(), serde_json::json!("kps"));
        let mut graph = position.clone();
        graph
            .as_object_mut()
            .unwrap()
            .extend(serde_json::Map::from_iter([
                ("statType".to_string(), serde_json::json!("kps")),
                ("graphType".to_string(), serde_json::json!("line")),
                ("graphSpeed".to_string(), serde_json::json!(100)),
                ("graphColor".to_string(), serde_json::json!("#123456")),
            ]));
        let bounded = serde_json::json!({
            "keyPositions": { "4key": [position.clone()] },
            "statPositions": { "4key": [stat] },
            "graphPositions": { "4key": [graph] },
            "knobPositions": { "4key": [position] }
        });
        std::fs::write(&source_path, serde_json::to_vec(&bounded).unwrap()).unwrap();
        let parsed = read_preset_file(&source_path).unwrap();
        assert_eq!(
            parsed.key_positions.as_ref().unwrap()["4key"][0]
                .shadow
                .as_ref()
                .unwrap()
                .blur,
            100.0
        );
        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn missing_legacy_global_fields_preserve_current_plugin_and_style_settings() {
        let current = AppStoreData {
            background_color: "#123456".to_string(),
            note_settings: NoteSettings {
                speed: 777,
                ..NoteSettings::default()
            },
            note_effect: true,
            laboratory_enabled: true,
            use_custom_css: true,
            custom_css: CustomCss {
                path: Some("/current/style.css".to_string()),
                content: ".current {}".to_string(),
            },
            use_custom_js: true,
            custom_js: CustomJs {
                path: None,
                content: "globalThis.current = true".to_string(),
                plugins: vec![JsPlugin {
                    id: "current-plugin".to_string(),
                    name: "Current plugin".to_string(),
                    path: None,
                    content: "void 0".to_string(),
                    enabled: true,
                }],
            },
            ..AppStoreData::default()
        };
        let mut legacy = PresetFile::default();

        let resolved = resolve_full_preset_settings(&mut legacy, &current);

        assert_eq!(resolved.background_color, current.background_color);
        assert_eq!(resolved.note_settings, current.note_settings);
        assert_eq!(resolved.note_effect, current.note_effect);
        assert_eq!(resolved.laboratory_enabled, current.laboratory_enabled);
        assert_eq!(resolved.use_custom_css, current.use_custom_css);
        assert_eq!(resolved.custom_css, current.custom_css);
        assert_eq!(resolved.use_custom_js, current.use_custom_js);
        assert_eq!(resolved.custom_js, current.custom_js);
    }

    #[test]
    fn tauri_130_literal_without_js_fields_preserves_installed_plugins() {
        let current = AppStoreData {
            use_custom_js: true,
            custom_js: CustomJs {
                path: None,
                content: "globalThis.current = true".to_string(),
                plugins: vec![JsPlugin {
                    id: "installed-plugin".to_string(),
                    name: "Installed plugin".to_string(),
                    path: None,
                    content: "globalThis.installed = true".to_string(),
                    enabled: true,
                }],
            },
            ..AppStoreData::default()
        };
        let mut preset: PresetFile = serde_json::from_value(serde_json::json!({
            "keys": { "4key": ["Q"] },
            "keyPositions": { "4key": [{ "dx": 1, "dy": 2, "width": 60, "count": 0 }] },
            "backgroundColor": "transparent"
        }))
        .unwrap();

        let resolved = resolve_full_preset_settings(&mut preset, &current);

        assert!(resolved.use_custom_js);
        assert_eq!(resolved.custom_js, current.custom_js);
    }

    #[test]
    fn tauri_161_literal_imports_its_plugin_list_exactly() {
        let mut current = AppStoreData::default();
        current.custom_js.plugins.push(JsPlugin {
            id: "current-plugin".to_string(),
            name: "Current plugin".to_string(),
            path: None,
            content: "void 0".to_string(),
            enabled: true,
        });
        let mut preset: PresetFile = serde_json::from_value(serde_json::json!({
            "useCustomJS": true,
            "customJS": {
                "path": null,
                "content": "globalThis.legacy = true",
                "plugins": [{
                    "id": "plugin-161",
                    "name": "Legacy plugin",
                    "path": null,
                    "content": "globalThis.plugin161 = true",
                    "enabled": true
                }]
            }
        }))
        .unwrap();

        let resolved = resolve_full_preset_settings(&mut preset, &current);

        assert!(resolved.use_custom_js);
        assert_eq!(resolved.custom_js.plugins.len(), 1);
        assert_eq!(resolved.custom_js.plugins[0].id, "plugin-161");
        assert!(!resolved
            .custom_js
            .plugins
            .iter()
            .any(|plugin| plugin.id == "current-plugin"));
    }

    #[test]
    fn explicit_empty_plugin_settings_still_clear_current_plugins() {
        let current = AppStoreData {
            use_custom_js: true,
            custom_js: CustomJs {
                plugins: vec![JsPlugin {
                    id: "current-plugin".to_string(),
                    name: "Current plugin".to_string(),
                    path: None,
                    content: "void 0".to_string(),
                    enabled: true,
                }],
                ..CustomJs::default()
            },
            ..AppStoreData::default()
        };
        let mut preset = PresetFile {
            use_custom_js: Some(false),
            custom_js: Some(CustomJs::default()),
            ..PresetFile::default()
        };

        let resolved = resolve_full_preset_settings(&mut preset, &current);

        assert!(!resolved.use_custom_js);
        assert_eq!(resolved.custom_js, CustomJs::default());
    }

    #[test]
    fn legacy_tab_preset_without_note_override_preserves_current_override() {
        let mut store = AppStoreData::default();
        let current = TabNoteSettings {
            speed: Some(654),
            ..TabNoteSettings::default()
        };
        store
            .tab_note_overrides
            .insert("4key".to_string(), current.clone());

        apply_tab_note_override(&mut store, "4key", false, None);

        assert_eq!(store.tab_note_overrides["4key"], current);
    }

    #[test]
    fn explicit_empty_tab_note_override_removes_current_override() {
        let mut store = AppStoreData::default();
        store.tab_note_overrides.insert(
            "4key".to_string(),
            TabNoteSettings {
                speed: Some(654),
                ..TabNoteSettings::default()
            },
        );

        apply_tab_note_override(&mut store, "4key", true, None);

        assert!(!store.tab_note_overrides.contains_key("4key"));
    }

    #[test]
    fn historical_full_preset_without_groups_starts_each_imported_mode_ungrouped() {
        let keys = KeyMappings::from([
            ("4key".to_string(), vec!["A".to_string()]),
            ("custom-old".to_string(), vec!["B".to_string()]),
        ]);

        let groups = resolve_full_preset_layer_groups(None, &keys);

        assert_eq!(groups.len(), 2);
        assert!(groups["4key"].is_empty());
        assert!(groups["custom-old"].is_empty());
    }

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
    fn tab_preset_key_pair_merge_preserves_other_modes_and_latest_target_positions() {
        let mut store = AppStoreData {
            keys: default_keys().clone(),
            key_positions: default_positions().clone(),
            ..AppStoreData::default()
        };
        store.key_positions.get_mut("4key").unwrap()[0].dx = 777.0;
        let untouched_keys = store.keys["5key"].clone();
        let untouched_positions = store.key_positions["5key"].clone();

        merge_tab_preset_key_pair(&mut store, "4key", vec!["Imported".to_string()], None);

        assert_eq!(store.keys["5key"], untouched_keys);
        assert_eq!(store.key_positions["5key"], untouched_positions);
        assert_eq!(store.key_positions["4key"][0].dx, 777.0);
        assert_eq!(store.keys["4key"][0], "Imported");
        assert_eq!(store.keys["4key"].len(), store.key_positions["4key"].len());
    }

    #[test]
    fn preset_import_alignment_repairs_each_mode_without_dropping_values() {
        let mut keys = KeyMappings::from([
            ("keys-only".to_string(), vec!["A".to_string()]),
            ("positions-long".to_string(), vec!["B".to_string()]),
        ]);
        let mut positions = KeyPositions::from([
            (
                "positions-only".to_string(),
                vec![KeyPosition {
                    dx: 123.0,
                    ..KeyPosition::default()
                }],
            ),
            (
                "positions-long".to_string(),
                vec![KeyPosition::default(), KeyPosition::default()],
            ),
        ]);

        align_imported_key_collections(&mut keys, &mut positions);

        assert_eq!(keys["keys-only"], vec!["A".to_string()]);
        assert_eq!(positions["keys-only"], vec![KeyPosition::default()]);
        assert_eq!(keys["positions-only"], vec![String::new()]);
        assert_eq!(positions["positions-only"][0].dx, 123.0);
        assert_eq!(keys["positions-long"], vec!["B".to_string(), String::new()]);
        assert_eq!(
            keys["positions-long"].len(),
            positions["positions-long"].len()
        );
    }

    #[test]
    fn tab_preset_font_restore_failure_keeps_existing_settings_unchanged() {
        let existing = FontSettings {
            custom_fonts: vec![CustomFont {
                id: "existing-id".to_string(),
                font_type: FontType::Local,
                name: "ExistingFont".to_string(),
                display_name: "Existing Font".to_string(),
                enabled: true,
                local_path: Some("/existing/font.ttf".to_string()),
                css_content: None,
            }],
        };
        let before = existing.clone();
        let imported = FontSettings {
            custom_fonts: vec![CustomFont {
                id: "imported-id".to_string(),
                font_type: FontType::Local,
                name: "ImportedFont".to_string(),
                display_name: "Imported Font".to_string(),
                enabled: true,
                local_path: None,
                css_content: None,
            }],
        };

        let result = prepare_tab_preset_fonts(&existing, imported, |fonts| {
            fonts.custom_fonts[0].local_path = Some("/staged/font.ttf".to_string());
            Err(CommandError::msg("restore-failed"))
        });

        assert!(result.is_err());
        assert_eq!(existing, before);
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
        assert_eq!(std::fs::read(&source_path).unwrap(), b"legacy-image");
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
