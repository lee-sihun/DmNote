use std::{
    collections::{BTreeSet, HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use tauri::{AppHandle, Manager, WebviewWindow};
use uuid::Uuid;

use crate::{
    commands::dialog::parented_file_dialog,
    commands::editor::{
        css::TabCssResponse,
        state::{emit_best_effort, publish_editor_change_after_key_runtime},
    },
    commands::{issue_mutation_ticket, run_blocking},
    custom_css::validate_css_path,
    defaults::{default_keys, default_positions},
    errors::{CmdResult, CommandError},
    models::{
        default_missing_note_gradient_multipliers, normalize_key_mappings,
        scrub_removed_text_outline_fields, AppStoreData, CustomCss, CustomCssPatch, CustomJs,
        CustomJsPatch, EditorCommitOrigin, EditorField, FontSettings, FontType, GradientSpec,
        GraphPositions, KeyMappings, KeyPosition, KeyPositions, KeySlot, KnobPositions,
        LayerGroups, NoteSettings, NoteSettingsPatch, SettingsPatchInput, StatPositions, TabCss,
        TabCssOverrides, TabNoteSettings, POSITION_COLLECTION_FIELDS, SHADOW_BLUR_MAX,
        SHADOW_BLUR_MIN, SHADOW_OFFSET_MAX, SHADOW_OFFSET_MIN,
    },
    services::settings::apply_patch_to_store,
    state::{
        image_asset::{import_image_bytes, import_image_file},
        AppState,
    },
};

use super::{
    decode_image_data_url, normalize_font_extension, normalize_image_extension,
    normalize_sound_extension, option_has_non_empty_text, EmbeddedLocalFont, EmbeddedLocalImage,
    EmbeddedLocalSound, PresetFile, PresetOperationResult, PRESET_LOCAL_IMAGE_PREFIX,
    PRESET_LOCAL_SOUND_PREFIX,
};

mod imported_assets;
mod validation;

use imported_assets::{
    merge_prepared_tab_preset_fonts, migrate_imported_font_weights, prepare_tab_preset_fonts,
    restore_preset_local_fonts, restore_preset_local_images, restore_preset_local_sounds,
};
#[cfg(test)]
use imported_assets::{
    merge_tab_preset_fonts, restore_position_image_reference, restore_preset_local_fonts_in_dir,
    restore_preset_local_sounds_in_dir,
};
#[cfg(test)]
use validation::invalid_position_style_detail;
use validation::read_preset_file;
#[cfg(test)]
pub(crate) use validation::read_preset_file_for_simulation;

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

struct ImportedCssPaths {
    global: Option<String>,
    tabs: Vec<String>,
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
pub async fn preset_load(
    app: AppHandle,
    window: WebviewWindow,
) -> CmdResult<PresetOperationResult> {
    let picked = parented_file_dialog(&window, "DM NOTE Preset", &["json"])
        .pick_file()
        .await;

    let Some(file) = picked else {
        return Ok(PresetOperationResult {
            success: false,
            error: None,
        });
    };
    let path = file.path().to_path_buf();
    let window_label = window.label().to_string();
    run_blocking(app, move |app, state| {
        preset_load_from_path(app, state, &window_label, path)
    })
    .await
}

fn preset_load_from_path(
    app: &AppHandle,
    state: &AppState,
    window_label: &str,
    path: PathBuf,
) -> CmdResult<PresetOperationResult> {
    state.ensure_mutation_allowed().map_err(CommandError::msg)?;
    let mut preset = read_preset_file(&path)?;
    let has_imported_global_css = preset.custom_css.is_some();
    let current = state.store.snapshot();
    let resolved_settings = resolve_full_preset_settings(&mut preset, &current);

    let mut keys = preset.keys.unwrap_or_else(|| default_keys().clone());
    normalize_key_mappings(&mut keys);
    let mut positions = preset
        .key_positions
        .unwrap_or_else(|| default_positions().clone());
    let mut stat_positions = preset.stat_positions.unwrap_or_default();
    let mut graph_positions = preset.graph_positions.unwrap_or_default();
    let mut knob_positions = preset.knob_positions.unwrap_or_default();
    migrate_imported_font_weights(
        &mut positions,
        &mut stat_positions,
        &mut graph_positions,
        &mut knob_positions,
    );
    let custom_tabs = preset
        .custom_tabs
        .unwrap_or_else(|| synthesize_custom_tabs(&keys));
    let requested_selected_key_type = preset.selected_key_type;
    let preset_layer_groups = resolve_full_preset_layer_groups(preset.layer_groups, &keys);
    let preset_tab_css_overrides = preset
        .tab_css_overrides
        .map(|overrides| normalize_imported_tab_css_overrides(overrides, "preset_load"));

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
    let mut custom_css = resolved_settings.custom_css;
    normalize_imported_custom_css(&mut custom_css, "preset_load");
    let imported_css_paths = ImportedCssPaths {
        global: if has_imported_global_css {
            custom_css.path.clone()
        } else {
            None
        },
        tabs: preset_tab_css_overrides
            .as_ref()
            .into_iter()
            .flat_map(|overrides| overrides.values())
            .filter_map(|css| css.path.clone())
            .collect(),
    };
    let js_use = resolved_settings.use_custom_js;
    let custom_js = resolved_settings.custom_js;
    let has_font_settings = preset.font_settings.is_some();
    let mut preset_font_settings = preset.font_settings.clone().unwrap_or_default();
    if has_font_settings {
        restore_preset_local_fonts(
            app,
            &mut preset_font_settings,
            preset.embedded_local_fonts.as_deref(),
        )?;
    }
    restore_preset_local_images(
        app,
        &mut positions,
        &mut stat_positions,
        &mut graph_positions,
        &mut knob_positions,
        preset.embedded_local_images.as_deref(),
    )?;
    restore_preset_local_sounds(
        app,
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
    let ticket = issue_mutation_ticket(app)?;
    let admission = state.admit_frontend_history_mutation(window_label)?;
    ticket.run(move || {
        state.ensure_mutation_allowed().map_err(CommandError::msg)?;
        let css_operation_guard = state.lock_css_operation();
        let previous_css_state = state.store.snapshot();
        let (transaction, _) = state.commit_preset_editor_transaction_preserving_runtime_counters(
            app,
            EditorCommitOrigin::LegacyAdapter("preset_load".to_string()),
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
                rekey_full_preset_elements(store);
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
        if !transaction
            .change
            .result
            .changed_fields
            .contains(&EditorField::Keys)
        {
            state.apply_committed_editor_keys_without_counters(
                transaction.change.runtime_publication_generation,
                &transaction.change.document.keys,
                &transaction.change.selected_key_type,
            );
        }
        let current_css_state = state.store.snapshot();
        authorize_committed_preset_css_paths(state, &current_css_state, &imported_css_paths);
        state.resync_global_css_watcher(&previous_css_state, &current_css_state);
        sync_tab_css_runtime(state, app, &transaction.value.1, &transaction.value.4);
        drop(css_operation_guard);
        publish_editor_change_after_key_runtime(state, app, &transaction.change);
        state.obs_broadcast_counters();

        let history_status = transaction.change.history_status.clone();
        let (diff, _, custom_tabs, tab_note_overrides, _) = transaction.value;
        let selected_key_type = transaction.change.selected_key_type.clone();
        let keys = transaction.change.document.keys;
        let positions = transaction.change.document.key_positions;
        let stat_positions = transaction.change.document.stat_positions;
        let graph_positions = transaction.change.document.graph_positions;
        let knob_positions = transaction.change.document.knob_positions;
        let layer_groups = transaction.change.document.layer_groups;

        if let Err(error) = state.emit_settings_changed(&diff, app) {
            log::error!("[Preset] failed to publish settings change: {error:#}");
        }
        emit_best_effort(app, "layerGroups:changed", &layer_groups);
        // 프리셋 데이터를 단일 이벤트로 원자적 전달
        emit_best_effort(
            app,
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
        emit_best_effort(app, "css:use", &serde_json::json!({ "enabled": css_use }));
        emit_best_effort(app, "css:content", &custom_css);
        emit_best_effort(app, "js:use", &serde_json::json!({ "enabled": js_use }));
        emit_best_effort(app, "js:content", &custom_js);

        // OBS 브릿지: 프리셋 로드 시 전체 스냅샷 재전송
        state.refresh_obs_snapshot();
        if let Some(status) = history_status.as_ref() {
            emit_best_effort(app, "history:status", status);
        }
        Ok(PresetOperationResult {
            success: true,
            error: None,
        })
    })
}

#[tauri::command]
pub async fn preset_load_tab(
    app: AppHandle,
    window: WebviewWindow,
) -> CmdResult<PresetOperationResult> {
    let picked = parented_file_dialog(&window, "DM NOTE Preset", &["json"])
        .pick_file()
        .await;

    let Some(file) = picked else {
        return Ok(PresetOperationResult {
            success: false,
            error: None,
        });
    };
    let path = file.path().to_path_buf();
    let window_label = window.label().to_string();
    run_blocking(app, move |app, state| {
        preset_load_tab_from_path(app, state, &window_label, path)
    })
    .await
}

fn preset_load_tab_from_path(
    app: &AppHandle,
    state: &AppState,
    window_label: &str,
    path: PathBuf,
) -> CmdResult<PresetOperationResult> {
    state.ensure_mutation_allowed().map_err(CommandError::msg)?;
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

    let mut imported_keys = keys.unwrap_or_default();
    normalize_key_mappings(&mut imported_keys);
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

    migrate_imported_font_weights(
        &mut src_key_positions,
        &mut src_stat_positions,
        &mut src_graph_positions,
        &mut src_knob_positions,
    );

    let has_tab_note_overrides = tab_note_overrides.is_some();
    let mut imported_tab_note_overrides = tab_note_overrides.unwrap_or_default();
    for tab in imported_tab_note_overrides.values_mut() {
        tab.migrate_fade_position();
    }

    // 내장 에셋 복원
    restore_preset_local_images(
        app,
        &mut src_key_positions,
        &mut src_stat_positions,
        &mut src_graph_positions,
        &mut src_knob_positions,
        embedded_local_images.as_deref(),
    )?;
    restore_preset_local_sounds(
        app,
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
    let imported_tab_css = tab_css_overrides.map(|overrides| {
        overrides.get(&source_tab_id).cloned().map(|mut css| {
            normalize_imported_tab_css(&mut css, "preset_load_tab");
            css
        })
    });
    let imported_css_paths = ImportedCssPaths {
        global: None,
        tabs: imported_tab_css
            .as_ref()
            .and_then(|css| css.as_ref())
            .and_then(|css| css.path.clone())
            .into_iter()
            .collect(),
    };

    // 프리셋에 담긴 폰트를 현재 폰트 목록에 병합 (탭 로드는 전역 설정을 덮지 않음)
    let prepared_font_settings = if let Some(imported_fonts) = font_settings {
        prepare_tab_preset_fonts(&existing_font_settings, imported_fonts, |filtered_fonts| {
            restore_preset_local_fonts(app, filtered_fonts, embedded_local_fonts.as_deref())
        })?
    } else {
        None
    };

    let ticket = issue_mutation_ticket(app)?;
    let admission = state.admit_frontend_history_mutation(window_label)?;
    ticket.run(move || {
        state.ensure_mutation_allowed().map_err(CommandError::msg)?;
        let css_operation_guard = state.lock_css_operation();
        let (transaction, _) = state.commit_preset_editor_transaction_preserving_runtime_counters(
            app,
            EditorCommitOrigin::LegacyAdapter("preset_load_tab".to_string()),
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
                let previous_tab_css_overrides = store.tab_css_overrides.clone();
                let key_positions_written = imported_key_positions.is_some();
                let stat_positions_written = imported_stat_positions.is_some();
                let graph_positions_written = imported_graph_positions.is_some();
                let knob_positions_written = imported_knob_positions.is_some();
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
                rekey_tab_preset_elements(
                    store,
                    &current_tab_id,
                    key_positions_written,
                    stat_positions_written,
                    graph_positions_written,
                    knob_positions_written,
                );
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
        if !transaction
            .change
            .result
            .changed_fields
            .contains(&EditorField::Keys)
        {
            state.apply_committed_editor_keys_without_counters(
                transaction.change.runtime_publication_generation,
                &transaction.change.document.keys,
                &transaction.change.selected_key_type,
            );
        }
        authorize_committed_preset_css_paths(state, &state.store.snapshot(), &imported_css_paths);
        sync_tab_css_runtime(state, app, &transaction.value.1, &transaction.value.3);
        drop(css_operation_guard);
        publish_editor_change_after_key_runtime(state, app, &transaction.change);
        state.obs_broadcast_counters();
        let history_status = transaction.change.history_status.clone();
        let (settings_diff, _, full_tab_note_overrides, _) = transaction.value;
        let full_keys = transaction.change.document.keys;
        let full_positions = transaction.change.document.key_positions;
        let full_stat_positions = transaction.change.document.stat_positions;
        let full_graph_positions = transaction.change.document.graph_positions;
        let full_knob_positions = transaction.change.document.knob_positions;
        let full_layer_groups = transaction.change.document.layer_groups;

        if let Some(diff) = settings_diff.as_ref() {
            if let Err(error) = state.emit_settings_changed(diff, app) {
                log::error!("[Preset] failed to publish tab preset settings: {error:#}");
            }
        }

        emit_best_effort(app, "layerGroups:changed", &full_layer_groups);
        emit_best_effort(app, "keys:changed", &full_keys);
        emit_best_effort(app, "positions:changed", &full_positions);
        emit_best_effort(app, "statPositions:changed", &full_stat_positions);
        emit_best_effort(app, "graphPositions:changed", &full_graph_positions);
        emit_best_effort(app, "knobPositions:changed", &full_knob_positions);
        emit_best_effort(app, "tabNote:changed_all", &full_tab_note_overrides);

        // OBS 브릿지: 탭 프리셋 로드 시 전체 스냅샷 재전송
        state.refresh_obs_snapshot();
        if let Some(status) = history_status.as_ref() {
            emit_best_effort(app, "history:status", status);
        }
        Ok(PresetOperationResult {
            success: true,
            error: None,
        })
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

fn authorize_committed_preset_css_paths(
    state: &AppState,
    committed: &AppStoreData,
    imported: &ImportedCssPaths,
) {
    for path in committed_preset_css_paths(committed, imported) {
        state.authorize_css_path(&path);
    }
}

fn committed_preset_css_paths(
    committed: &AppStoreData,
    imported: &ImportedCssPaths,
) -> Vec<String> {
    let mut paths = BTreeSet::new();
    if let Some(path) = imported
        .global
        .as_ref()
        .filter(|path| committed.custom_css.path.as_ref() == Some(path))
    {
        paths.insert(path.clone());
    }
    for path in &imported.tabs {
        if committed
            .tab_css_overrides
            .values()
            .any(|css| css.path.as_ref() == Some(path))
        {
            paths.insert(path.clone());
        }
    }
    paths.into_iter().collect()
}

fn normalize_imported_custom_css(css: &mut CustomCss, operation: &str) {
    let Some(path) = css.path.clone() else {
        return;
    };
    match validate_css_path(Path::new(&path)) {
        Ok(loaded) => css.path = Some(loaded.canonical_path),
        Err(error) => {
            log::warn!(
                "[{operation}] Dropped invalid global CSS path code={} path={} detail={}",
                error.code.as_str(),
                path,
                error.detail
            );
            css.path = None;
        }
    }
}

fn normalize_imported_tab_css(css: &mut TabCss, operation: &str) {
    let Some(path) = css.path.clone() else {
        return;
    };
    match validate_css_path(Path::new(&path)) {
        Ok(loaded) => css.path = Some(loaded.canonical_path),
        Err(error) => {
            log::warn!(
                "[{operation}] Dropped invalid tab CSS path code={} path={} detail={}",
                error.code.as_str(),
                path,
                error.detail
            );
            css.path = None;
        }
    }
}

fn normalize_imported_tab_css_overrides(
    mut overrides: TabCssOverrides,
    operation: &str,
) -> TabCssOverrides {
    for css in overrides.values_mut() {
        normalize_imported_tab_css(css, operation);
    }
    overrides
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

fn align_imported_key_pair(keys: &mut Vec<KeySlot>, positions: &mut Vec<KeyPosition>) {
    if keys.len() < positions.len() {
        keys.resize(positions.len(), KeySlot::default());
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

fn rekey_full_preset_elements(store: &mut AppStoreData) {
    crate::state::native_element_id::rekey_store_element_ids(store);
}

fn rekey_tab_preset_elements(
    store: &mut AppStoreData,
    tab_id: &str,
    key_positions_written: bool,
    stat_positions_written: bool,
    graph_positions_written: bool,
    knob_positions_written: bool,
) {
    crate::state::native_element_id::rekey_mode_element_ids_for_collections(
        store,
        tab_id,
        key_positions_written,
        stat_positions_written,
        graph_positions_written,
        knob_positions_written,
    );
    // 프리셋이 위치를 주지 않은 컬렉션은 기존 요소가 값 그대로 남는다 -
    // 신원을 회전시키지 않고 정렬이 덧붙인 빈 항목만 채운다
    crate::state::native_element_id::backfill_mode_element_ids_for_collections(
        store,
        tab_id,
        !key_positions_written,
        !stat_positions_written,
        !graph_positions_written,
        !knob_positions_written,
    );
}

fn merge_tab_preset_key_pair(
    store: &mut AppStoreData,
    current_tab_id: &str,
    mut keys: Vec<KeySlot>,
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
mod tests;
