use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use dirs_next::config_dir;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::{
    custom_css::{
        canonicalize_legacy_css_path, migrate_custom_css_history_at_load,
        migrate_custom_css_history_timestamps, normalize_custom_css_history,
    },
    defaults::{default_keys, default_positions},
    models::{
        default_missing_note_gradient_multipliers, default_sprite_press_duration_ms,
        default_sprite_transition_ms, is_renderable_image_ref, normalize_key_slot,
        scrub_removed_text_outline_fields, AppStoreData, CounterAnimationPreset, CustomCss,
        CustomCssHistoryEntry, CustomFont, CustomJs, CustomTab, FontType, FontWeightRange,
        GradientSpec, GraphPosition, GraphPositions, GraphStatType, GraphType, GridSettings,
        ImageMode, ImageTransform, JsPlugin, KeyCounters, KeyMappings, KeyPosition, KeyPositions,
        KeySlot, KnobPosition, KnobPositions, LayerGroupDef, LayerGroups, NoteSettings,
        ReactiveSpritePosition, ShortcutsState, SoundLibraryEntry, SpriteAnchor, SpritePositions,
        SpriteTransform, StatPosition, StatPositions, StatType, StoredOverlayBounds, TabCss,
        TabNoteSettings, ELEMENT_ROTATION_MAX, ELEMENT_ROTATION_MIN, IMAGE_TRANSFORM_OFFSET_MAX,
        IMAGE_TRANSFORM_OFFSET_MIN, IMAGE_TRANSFORM_ROTATION_MAX, IMAGE_TRANSFORM_ROTATION_MIN,
        IMAGE_TRANSFORM_SCALE_MAX, IMAGE_TRANSFORM_SCALE_MIN, POSITION_COLLECTION_FIELDS,
        SPRITE_IMAGE_DIMENSION_MAX, SPRITE_IMAGE_DIMENSION_MIN, SPRITE_PRESS_DURATION_MS_MAX,
        SPRITE_PRESS_DURATION_MS_MIN, SPRITE_TRANSFORM_OFFSET_MAX, SPRITE_TRANSFORM_OFFSET_MIN,
        SPRITE_TRANSFORM_ROTATION_MAX, SPRITE_TRANSFORM_ROTATION_MIN, SPRITE_TRANSFORM_SCALE_MAX,
        SPRITE_TRANSFORM_SCALE_MIN, SPRITE_TRANSITION_MS_MAX,
    },
};

use super::{
    editor, native_element_id,
    tab_metadata::{legacy_tab_order, normalize_bar_count, normalize_tab_order},
};

mod assets;
mod normalization;
mod recovery;

#[cfg(test)]
use assets::{
    decode_font_data_url, decode_image_data_url, normalize_font_extension,
    normalize_image_extension,
};
pub(crate) use assets::{
    fill_missing_sprite_image_metrics, is_foreign_portable_asset_reference,
    migrate_key_images_to_app_data, migrate_local_fonts_to_app_data,
    rehome_foreign_asset_references,
};
use assets::{parse_portable_asset_reference, AssetCategory};
#[cfg(test)]
use normalization::rgba_to_hex;
pub(crate) use normalization::{
    canonicalize_gradient_pairs, canonicalize_image_modes, clear_dangling_group_ids,
    migrate_legacy_sprite_wire, normalize_sprite_triggers, normalize_state,
};
#[allow(unused_imports)]
pub(crate) use normalization::{
    clear_dangling_group_ids_in, migrate_legacy_font_weight_state, pad_key_position_lengths,
};
use normalization::{
    current_unix_millis, default_store_note_gradient_multipliers,
    has_convertible_note_border_color, has_explicit_invalid_element_id,
    has_legacy_font_weight_state, has_valid_selected_key_type, key_position_lengths_mismatch,
    migrate_legacy_knob_sensitivity, migrate_legacy_sprite_positions_value,
    migrate_sound_library_enabled, normalize_blank_font_colors, remove_legacy_panel_detach_setting,
    repair_editor_revision, repair_native_position_ranges, repair_semantic_identities,
    repair_sprite_numeric_ranges,
};
#[cfg(test)]
use recovery::{
    recover_collection_field, recover_key_mapping_entries, recover_local_font_enabled,
    recover_sound_library_entries,
};
use recovery::{repair_custom_tab_key_layout_pairs, repair_legacy_state};

const LEGACY_OVERLAY_WIDTH: f64 = 860.0;
const LEGACY_OVERLAY_HEIGHT: f64 = 320.0;
const LEGACY_PANEL_DETACH_ENABLED_KEY: &str = "panelDetachEnabled";

pub(crate) struct LoadedStore {
    pub(crate) data: AppStoreData,
    pub(crate) needs_persist: bool,
    pub(crate) repaired: bool,
}

/// store 파일 로드 및 마이그레이션 적용
pub(crate) fn load_store_from_path(path: &Path) -> Result<LoadedStore> {
    // 바이트로 읽어 잘못된 UTF-8도 IO 에러 대신 JSON 파싱 실패로 흘려 복구 분기에 합류
    let content = fs::read(path)
        .with_context(|| format!("failed to read store file at {}", path.display()))?;
    let (state, needs_persist, repaired, seed_active_css_history, explicit_invalid_element_id) =
        match serde_json::from_slice::<Value>(&content) {
            Ok(mut value) => {
                let seed_active_css_history = value.get("customCssHistory").is_none();
                let explicit_invalid_element_id = has_explicit_invalid_element_id(&value);
                let sprite_wire_migrated = migrate_legacy_sprite_wire(&mut value);
                let has_tab_order = value.get("tabOrder").is_some();
                let has_bar_count = value.get("barCount").is_some();
                let sound_library_migrated = migrate_sound_library_enabled(&mut value);
                let text_outline_scrubbed = scrub_removed_text_outline_fields(&mut value);
                // 메모리 보정만 하고 영속을 빼먹으면 시작마다 같은 보정이 반복된다
                let gradient_multipliers_defaulted =
                    default_store_note_gradient_multipliers(&mut value);
                match serde_json::from_value::<AppStoreData>(value.clone()) {
                    Ok(mut data) => {
                        let mut needs_persist = text_outline_scrubbed
                            || sprite_wire_migrated
                            || sound_library_migrated
                            || gradient_multipliers_defaulted
                            || data.font_settings.custom_fonts.iter().any(|font| {
                                font.font_type == FontType::Local
                                    && font
                                        .css_content
                                        .as_ref()
                                        .map(|c| !c.trim().is_empty())
                                        .unwrap_or(false)
                            });
                        needs_persist |= remove_legacy_panel_detach_setting(&mut data);
                        // rgba로 깨진 noteBorderColor가 있으면 정규화 후 디스크에도 영속 (이슈 #73)
                        if has_convertible_note_border_color(&data) {
                            needs_persist = true;
                        }
                        if migrate_legacy_knob_sensitivity(&mut data) {
                            needs_persist = true;
                        }
                        let position_range_repaired = repair_native_position_ranges(&mut data);
                        needs_persist |= position_range_repaired;
                        let sprite_numeric_repaired = repair_sprite_numeric_ranges(&mut data);
                        needs_persist |= sprite_numeric_repaired;
                        needs_persist |= has_legacy_font_weight_state(&data);
                        let editor_revision_repaired = repair_editor_revision(&mut data);
                        needs_persist |= editor_revision_repaired;
                        let semantic_repaired = repair_semantic_identities(&mut data);
                        needs_persist |= semantic_repaired;
                        let tab_order_changed =
                            prepare_tab_order_for_load(&mut data, has_tab_order);
                        needs_persist |= tab_order_changed;
                        let bar_count_changed =
                            prepare_bar_count_for_load(&mut data, has_bar_count);
                        needs_persist |= bar_count_changed;
                        let layout_repaired = repair_custom_tab_key_layout_pairs(
                            &mut data,
                            value.get("keys"),
                            value.get("keyPositions"),
                        );
                        needs_persist |= layout_repaired;
                        needs_persist |= normalize_blank_font_colors(&mut data);
                        needs_persist |= canonicalize_image_modes(&mut data);
                        needs_persist |= normalize_sprite_triggers(&mut data);
                        let (gradient_changed, gradient_pair_repaired) =
                            canonicalize_gradient_pairs(&mut data);
                        needs_persist |= gradient_changed;
                        needs_persist |=
                            key_position_lengths_mismatch(&data.keys, &data.key_positions);
                        needs_persist |= !has_valid_selected_key_type(&data);
                        needs_persist |=
                            migrate_custom_css_history_timestamps(&mut data.custom_css_history);
                        let original_css_history = data.custom_css_history.clone();
                        let data = normalize_state(data);
                        needs_persist |= data.custom_css_history != original_css_history;
                        (
                            data,
                            needs_persist,
                            layout_repaired
                                || semantic_repaired
                                || (has_tab_order && tab_order_changed)
                                || (has_bar_count && bar_count_changed)
                                || editor_revision_repaired
                                || gradient_pair_repaired
                                || position_range_repaired
                                || sprite_numeric_repaired,
                            seed_active_css_history,
                            explicit_invalid_element_id,
                        )
                    }
                    Err(err) => {
                        log::warn!(
                            "[Store] Falling back to field-level recovery for {}: {err}",
                            path.display()
                        );
                        (
                            repair_legacy_state(value),
                            true,
                            true,
                            seed_active_css_history,
                            false,
                        )
                    }
                }
            }
            Err(err) => {
                log::warn!(
                    "[Store] Falling back to default recovery for invalid JSON at {}: {err}",
                    path.display()
                );
                (repair_legacy_state(Value::Null), true, true, false, false)
            }
        };
    // 로드 시점은 정의와 참조가 함께 확정되는 경계 — dangling groupId 정리
    // 정리가 발생하면 마이그레이션과 같은 경로로 디스크에도 영속
    let mut state = state;
    let mut needs_persist = needs_persist;
    let mut repaired = repaired;
    let active_css_path = seed_active_css_history
        .then(|| {
            state
                .custom_css
                .path
                .as_deref()
                .map(canonicalize_legacy_css_path)
        })
        .flatten();
    if let Some(path) = active_css_path.as_ref() {
        if state.custom_css.path.as_ref() != Some(path) {
            state.custom_css.path = Some(path.clone());
            needs_persist = true;
        }
    }
    needs_persist |= migrate_custom_css_history_at_load(
        &mut state.custom_css_history,
        active_css_path.as_deref(),
        current_unix_millis(),
    );
    if clear_dangling_group_ids(&mut state) {
        needs_persist = true;
    }
    let id_backfill = super::native_element_id::backfill_store_element_ids(&mut state);
    needs_persist |= id_backfill.changed;
    repaired |= id_backfill.repaired || explicit_invalid_element_id;
    // 플러그인 인스턴스 ID backfill도 recovery 합류 이후에 수행
    let plugin_id_backfill = super::plugin::backfill_plugin_instance_ids(&mut state);
    needs_persist |= plugin_id_backfill.changed;
    repaired |= plugin_id_backfill.repaired;
    if needs_persist {
        log::info!(
            "[Store] Persisting migrated store file at {}",
            path.display()
        );
    }
    Ok(LoadedStore {
        data: state,
        needs_persist,
        repaired,
    })
}

/// 레거시 store 파일 경로 탐색
pub(crate) fn find_legacy_store_file() -> Option<PathBuf> {
    // 고정된 레거시 경로: %APPDATA%/dm-note/config.json
    let base = config_dir()?;
    let candidate = base.join("dm-note").join("config.json");
    if candidate.exists() {
        Some(candidate)
    } else {
        None
    }
}

fn prepare_tab_order_for_load(data: &mut AppStoreData, has_tab_order: bool) -> bool {
    let original = data.tab_order.clone();
    if !has_tab_order {
        data.tab_order = legacy_tab_order(&data.custom_tabs);
    }
    data.tab_order = normalize_tab_order(&data.tab_order, &data.custom_tabs);
    data.tab_order != original
}

fn prepare_bar_count_for_load(data: &mut AppStoreData, has_bar_count: bool) -> bool {
    let original = data.bar_count;
    data.bar_count = normalize_bar_count(data.bar_count, &data.tab_order);
    !has_bar_count || data.bar_count != original
}

#[derive(Deserialize)]
struct LegacyOverlayPosition {
    x: f64,
    y: f64,
}

#[cfg(test)]
mod tests;
