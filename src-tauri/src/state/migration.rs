use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use dirs_next::config_dir;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{Map, Value};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

use super::{
    image_asset::{import_image_bytes, import_image_file},
    local_asset_path::{file_url_to_path, path_identity_key, FileUrlPath},
};

use crate::{
    custom_css::{
        canonicalize_legacy_css_path, migrate_custom_css_history_at_load,
        migrate_custom_css_history_timestamps, normalize_custom_css_history,
    },
    defaults::{default_keys, default_positions},
    models::{
        default_missing_note_gradient_multipliers, normalize_key_slot,
        scrub_removed_text_outline_fields, AppStoreData, CounterAnimationPreset, CustomCss,
        CustomCssHistoryEntry, CustomFont, CustomJs, CustomTab, FontType, FontWeightRange,
        GradientSpec, GraphPosition, GraphPositions, GraphStatType, GraphType, GridSettings,
        ImageMode, ImageTransform, JsPlugin, KeyCounters, KeyMappings, KeyPosition, KeyPositions,
        KeySlot, KnobPosition, KnobPositions, LayerGroupDef, LayerGroups, NoteSettings,
        OverlayBounds, ShortcutsState, SoundLibraryEntry, StatPosition, StatPositions, StatType,
        TabCss, TabNoteSettings, IMAGE_TRANSFORM_OFFSET_MAX, IMAGE_TRANSFORM_OFFSET_MIN,
        IMAGE_TRANSFORM_ROTATION_MAX, IMAGE_TRANSFORM_ROTATION_MIN, IMAGE_TRANSFORM_SCALE_MAX,
        IMAGE_TRANSFORM_SCALE_MIN, POSITION_COLLECTION_FIELDS,
    },
    services::font_metadata::parse_font_metadata,
};

const LEGACY_OVERLAY_WIDTH: f64 = 860.0;
const LEGACY_OVERLAY_HEIGHT: f64 = 320.0;
const APP_DATA_MARKER: &str = "com.dmnote.desktop";
const LEGACY_PANEL_DETACH_ENABLED_KEY: &str = "panelDetachEnabled";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AssetCategory {
    Sounds,
    Fonts,
    Images,
}

impl AssetCategory {
    fn directory_name(self) -> &'static str {
        match self {
            Self::Sounds => "sounds",
            Self::Fonts => "fonts",
            Self::Images => "images",
        }
    }

    fn from_directory_name(value: &str) -> Option<Self> {
        match value {
            "sounds" => Some(Self::Sounds),
            "fonts" => Some(Self::Fonts),
            "images" => Some(Self::Images),
            _ => None,
        }
    }
}

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
                let sound_library_migrated = migrate_sound_library_enabled(&mut value);
                let text_outline_scrubbed = scrub_removed_text_outline_fields(&mut value);
                // 메모리 보정만 하고 영속을 빼먹으면 시작마다 같은 보정이 반복된다
                let gradient_multipliers_defaulted =
                    default_store_note_gradient_multipliers(&mut value);
                match serde_json::from_value::<AppStoreData>(value.clone()) {
                    Ok(mut data) => {
                        let mut needs_persist = text_outline_scrubbed
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
                        let image_transform_repaired = repair_image_transforms(&mut data);
                        needs_persist |= image_transform_repaired;
                        needs_persist |= has_legacy_font_weight_state(&data);
                        let editor_revision_repaired = repair_editor_revision(&mut data);
                        needs_persist |= editor_revision_repaired;
                        let semantic_repaired = repair_semantic_identities(&mut data);
                        needs_persist |= semantic_repaired;
                        let layout_repaired = repair_custom_tab_key_layout_pairs(
                            &mut data,
                            value.get("keys"),
                            value.get("keyPositions"),
                        );
                        needs_persist |= layout_repaired;
                        needs_persist |= normalize_blank_font_colors(&mut data);
                        needs_persist |= canonicalize_image_modes(&mut data);
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
                                || editor_revision_repaired
                                || gradient_pair_repaired
                                || image_transform_repaired,
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

fn default_store_note_gradient_multipliers(value: &mut Value) -> bool {
    let mut changed = false;
    for collection in POSITION_COLLECTION_FIELDS {
        let Some(modes) = value.get_mut(collection).and_then(Value::as_object_mut) else {
            continue;
        };
        for position in modes.values_mut().filter_map(Value::as_array_mut).flatten() {
            changed |= default_missing_note_gradient_multipliers(position);
        }
    }
    changed
}

fn has_explicit_invalid_element_id(value: &Value) -> bool {
    POSITION_COLLECTION_FIELDS
        .into_iter()
        .filter_map(|field| value.get(field).and_then(Value::as_object))
        .flat_map(|modes| modes.values())
        .filter_map(Value::as_array)
        .flatten()
        .filter_map(Value::as_object)
        .filter_map(|element| element.get("id"))
        .any(|id| {
            id.as_str()
                .is_none_or(|id| !super::native_element_id::is_valid_element_id(id))
        })
}

fn current_unix_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

fn migrate_sound_library_enabled(value: &mut Value) -> bool {
    let Some(sound_library) = value.get_mut("soundLibrary").and_then(Value::as_object_mut) else {
        return false;
    };

    let mut changed = false;
    for entry in sound_library.values_mut().filter_map(Value::as_object_mut) {
        let Some(enabled) = entry.remove("enabled") else {
            continue;
        };

        changed = true;
        if !entry.contains_key("hidden") {
            if let Some(enabled) = enabled.as_bool() {
                entry.insert("hidden".to_string(), Value::Bool(!enabled));
            }
        }
    }
    changed
}

/// 레거시 노브 민감도 마이그레이션: 도수/카운트(구 기본 1.40625) → 순수 배율(1.0)
/// 배율 의미 전환 이전에 저장된 기본값만 1로 재매핑 (사용자 지정값은 유지)
fn migrate_legacy_knob_sensitivity(data: &mut AppStoreData) -> bool {
    const LEGACY_DEFAULT: f64 = 1.40625; // 360 / 256
    let mut changed = false;
    for positions in data.knob_positions.values_mut() {
        for knob in positions.iter_mut() {
            if knob.sensitivity == LEGACY_DEFAULT {
                knob.sensitivity = 1.0;
                changed = true;
            }
        }
    }
    changed
}

/// 타입은 맞지만 실제 식별자로 쓸 수 없는 항목을 로드 경계에서만 정리
fn repair_semantic_identities(data: &mut AppStoreData) -> bool {
    let mut changed = false;

    let original_font_len = data.font_settings.custom_fonts.len();
    data.font_settings
        .custom_fonts
        .retain(|font| !font.id.trim().is_empty() && !font.name.trim().is_empty());
    changed |= data.font_settings.custom_fonts.len() != original_font_len;

    for font in data.font_settings.custom_fonts.iter_mut() {
        let original_range_len = font.weight_ranges.len();
        font.weight_ranges.retain(|range| {
            (1..=1000).contains(&range.min)
                && (1..=1000).contains(&range.max)
                && range.min <= range.max
        });
        changed |= font.weight_ranges.len() != original_range_len;

        if font.font_type != FontType::Local {
            continue;
        }

        let invalid_path = font.local_path.as_ref().is_some_and(|path| {
            path.trim().is_empty()
                || (!Path::new(path.trim()).is_absolute()
                    && parse_portable_asset_reference(path).is_none())
        });
        if invalid_path {
            font.local_path = None;
            changed = true;
        }

        let has_embedded_source = font
            .css_content
            .as_deref()
            .is_some_and(|content| !content.trim().is_empty());
        if font.local_path.is_none() && !has_embedded_source && font.enabled {
            font.enabled = false;
            changed = true;
        }
    }

    changed
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

/// 로컬 폰트 base64 cssContent → 앱 데이터 경로 기반 파일로 변환
pub(crate) fn migrate_local_fonts_to_app_data(
    app_data_dir: &Path,
    data: &mut AppStoreData,
) -> bool {
    let mut changed = false;

    let has_local_fonts = data
        .font_settings
        .custom_fonts
        .iter()
        .any(|font| font.font_type == FontType::Local);
    if !has_local_fonts {
        return false;
    }

    let fonts_dir = app_data_dir.join("fonts");
    if let Err(err) = fs::create_dir_all(&fonts_dir) {
        log::warn!(
            "[Fonts] Failed to create fonts directory at {}: {err}",
            fonts_dir.display()
        );
        return false;
    }

    for font in data.font_settings.custom_fonts.iter_mut() {
        if font.font_type != FontType::Local {
            continue;
        }

        let local_path = match font.local_path.as_ref() {
            Some(path) if !path.trim().is_empty() => path.trim(),
            _ => "",
        };

        let source = (!local_path.is_empty()).then(|| PathBuf::from(local_path));
        let source_exists = source.as_ref().is_some_and(|path| path.exists());

        if let Some(source) = source.as_ref() {
            // 이미 앱 데이터 fonts 디렉터리 내부에 있으면 cssContent만 제거
            if source.starts_with(&fonts_dir) && source.exists() {
                if font.css_content.is_some() {
                    font.css_content = None;
                    changed = true;
                }
                continue;
            }

            if source_exists {
                let ext = source
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("ttf")
                    .to_lowercase();
                let dest = fonts_dir.join(format!("{}.{}", Uuid::new_v4(), ext));
                match fs::copy(source, &dest) {
                    Ok(_) => {
                        font.local_path = Some(dest.to_string_lossy().to_string());
                        font.css_content = None;
                        changed = true;
                        continue;
                    }
                    Err(err) => {
                        log::warn!(
                            "[Fonts] Failed to import local font from {}: {err}",
                            source.display()
                        );
                    }
                }
            }
        }

        let fallback_extension = source
            .as_ref()
            .and_then(|path| path.extension())
            .and_then(|extension| extension.to_str());
        if let Some((bytes, extension)) = font
            .css_content
            .as_deref()
            .and_then(|css| decode_font_data_url(css, fallback_extension))
        {
            let dest = fonts_dir.join(format!("{}.{}", Uuid::new_v4(), extension));
            match fs::write(&dest, bytes) {
                Ok(_) => {
                    font.local_path = Some(dest.to_string_lossy().to_string());
                    font.css_content = None;
                    changed = true;
                    continue;
                }
                Err(err) => {
                    log::warn!(
                        "[Fonts] Failed to restore embedded local font into {}: {err}",
                        dest.display()
                    );
                    continue;
                }
            }
        }

        if source_exists {
            continue;
        }

        // 외래 기기 자산 참조는 파일이 나중에 복사되면 재귀화로 치유됨 — 비활성화 보류
        if is_foreign_portable_asset_reference(app_data_dir, local_path) {
            continue;
        }

        // 복구 가능한 원본과 data URI가 모두 없을 때 비활성화만 수행
        // css_content는 보존 — 미지 mime 등 디코더 개선 시 재복구 여지 유지
        if font.enabled {
            font.enabled = false;
            changed = true;
        }
    }

    for font in data
        .font_settings
        .custom_fonts
        .iter_mut()
        .filter(|font| font.font_type == FontType::Local && font.weight_ranges.is_empty())
    {
        font.weight_ranges = font
            .local_path
            .as_deref()
            .filter(|path| !path.trim().is_empty())
            .and_then(|path| parse_font_metadata(Path::new(path)).ok())
            .map(|metadata| metadata.weight_ranges)
            .unwrap_or_else(|| vec![FontWeightRange { min: 400, max: 400 }]);
        changed = true;
    }

    changed
}

/// 키 이미지 data URL/로컬 파일 → 앱 데이터 디렉터리로 마이그레이션
pub(crate) fn migrate_key_images_to_app_data(app_data_dir: &Path, data: &mut AppStoreData) -> bool {
    let mut changed = false;

    let has_any_images = data.key_positions.values().any(|positions| {
        positions.iter().any(|position| {
            option_has_non_empty_text(&position.active_image)
                || option_has_non_empty_text(&position.inactive_image)
        })
    }) || data.stat_positions.values().any(|positions| {
        positions.iter().any(|stat_position| {
            option_has_non_empty_text(&stat_position.position.active_image)
                || option_has_non_empty_text(&stat_position.position.inactive_image)
        })
    }) || data.graph_positions.values().any(|positions| {
        positions.iter().any(|graph_position| {
            option_has_non_empty_text(&graph_position.position.active_image)
                || option_has_non_empty_text(&graph_position.position.inactive_image)
        })
    }) || data.knob_positions.values().any(|positions| {
        positions.iter().any(|knob_position| {
            option_has_non_empty_text(&knob_position.position.active_image)
                || option_has_non_empty_text(&knob_position.position.inactive_image)
        })
    });

    if !has_any_images {
        return false;
    }

    let images_dir = app_data_dir.join("images");
    if let Err(err) = fs::create_dir_all(&images_dir) {
        log::warn!(
            "[Images] Failed to create images directory at {}: {err}",
            images_dir.display()
        );
        return false;
    }

    for positions in data.key_positions.values_mut() {
        for position in positions.iter_mut() {
            changed |= migrate_image_reference_to_app_data(&images_dir, &mut position.active_image);
            changed |=
                migrate_image_reference_to_app_data(&images_dir, &mut position.inactive_image);
        }
    }

    for positions in data.stat_positions.values_mut() {
        for stat_position in positions.iter_mut() {
            changed |= migrate_image_reference_to_app_data(
                &images_dir,
                &mut stat_position.position.active_image,
            );
            changed |= migrate_image_reference_to_app_data(
                &images_dir,
                &mut stat_position.position.inactive_image,
            );
        }
    }

    for positions in data.graph_positions.values_mut() {
        for graph_position in positions.iter_mut() {
            changed |= migrate_image_reference_to_app_data(
                &images_dir,
                &mut graph_position.position.active_image,
            );
            changed |= migrate_image_reference_to_app_data(
                &images_dir,
                &mut graph_position.position.inactive_image,
            );
        }
    }

    for positions in data.knob_positions.values_mut() {
        for knob_position in positions.iter_mut() {
            changed |= migrate_image_reference_to_app_data(
                &images_dir,
                &mut knob_position.position.active_image,
            );
            changed |= migrate_image_reference_to_app_data(
                &images_dir,
                &mut knob_position.position.inactive_image,
            );
        }
    }

    changed
}

/// 다른 기기의 appData 자산 참조를 현재 기기의 실존 파일로 재연결
pub(crate) fn rehome_foreign_asset_references(
    app_data_dir: &Path,
    data: &mut AppStoreData,
) -> bool {
    let mut changed = false;

    for positions in data.key_positions.values_mut() {
        for position in positions {
            changed |= rehome_position_asset_references(app_data_dir, position);
        }
    }
    for positions in data.stat_positions.values_mut() {
        for position in positions {
            changed |= rehome_position_asset_references(app_data_dir, &mut position.position);
        }
    }
    for positions in data.graph_positions.values_mut() {
        for position in positions {
            changed |= rehome_position_asset_references(app_data_dir, &mut position.position);
        }
    }
    for positions in data.knob_positions.values_mut() {
        for position in positions {
            changed |= rehome_position_asset_references(app_data_dir, &mut position.position);
        }
    }

    for font in data
        .font_settings
        .custom_fonts
        .iter_mut()
        .filter(|font| font.font_type == FontType::Local)
    {
        changed |= rehome_optional_asset_reference(app_data_dir, &mut font.local_path);
    }

    let mut replacements: HashMap<String, Vec<(String, SoundLibraryEntry)>> = HashMap::new();
    for (foreign_key, entry) in &data.sound_library {
        let Some(local_key) = rehomed_asset_reference(app_data_dir, foreign_key) else {
            continue;
        };
        replacements
            .entry(local_key)
            .or_default()
            .push((foreign_key.clone(), entry.clone()));
    }
    for (local_key, candidates) in replacements {
        let Some((_, candidate_entry)) = candidates.first() else {
            continue;
        };
        let has_conflict = data
            .sound_library
            .get(&local_key)
            .is_some_and(|existing| existing != candidate_entry)
            || candidates.iter().any(|(_, entry)| entry != candidate_entry);
        if has_conflict {
            continue;
        }

        data.sound_library
            .entry(local_key)
            .or_insert_with(|| candidate_entry.clone());
        for (foreign_key, _) in candidates {
            data.sound_library.remove(&foreign_key);
        }
        changed = true;
    }

    changed
}

fn rehome_position_asset_references(app_data_dir: &Path, position: &mut KeyPosition) -> bool {
    rehome_optional_asset_reference(app_data_dir, &mut position.sound_path)
        | rehome_optional_asset_reference(app_data_dir, &mut position.active_image)
        | rehome_optional_asset_reference(app_data_dir, &mut position.inactive_image)
}

fn rehome_optional_asset_reference(app_data_dir: &Path, raw: &mut Option<String>) -> bool {
    let Some(current) = raw.as_ref() else {
        return false;
    };
    let Some(rehomed) = rehomed_asset_reference(app_data_dir, current) else {
        return false;
    };
    if *current == rehomed {
        return false;
    }
    *raw = Some(rehomed);
    true
}

fn rehomed_asset_reference(app_data_dir: &Path, raw: &str) -> Option<String> {
    if local_asset_reference_exists(raw) {
        return None;
    }
    let (category, file_name) = parse_portable_asset_reference(raw)?;
    let category_dir = app_data_dir.join(category.directory_name());
    let exact = category_dir.join(&file_name);
    let resolved = if exact.is_file() {
        exact
    } else {
        find_unique_normalized_file(&category_dir, &file_name)?
    };
    Some(resolved.to_string_lossy().into_owned())
}

fn local_asset_reference_exists(raw: &str) -> bool {
    let trimmed = raw.trim();
    match file_url_to_path(trimmed) {
        FileUrlPath::Path(path) => path.is_file(),
        FileUrlPath::Invalid => false,
        FileUrlPath::NotFileUrl => Path::new(trimmed).is_file(),
    }
}

fn find_unique_normalized_file(directory: &Path, expected_name: &str) -> Option<PathBuf> {
    let expected = expected_name.nfc().collect::<String>();
    let mut matches = fs::read_dir(directory)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            if !file_type.is_file() {
                return None;
            }
            let name = entry.file_name().into_string().ok()?;
            (name.nfc().collect::<String>() == expected).then_some(entry.path())
        });
    let first = matches.next()?;
    matches.next().is_none().then_some(first)
}

fn parse_portable_asset_reference(raw: &str) -> Option<(AssetCategory, String)> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("data:")
        || lower.starts_with("blob:")
        || lower.starts_with("asset:")
        || lower.starts_with("tauri:")
    {
        return None;
    }

    let portable = match file_url_to_path(trimmed) {
        FileUrlPath::Path(path) => path.to_string_lossy().into_owned(),
        FileUrlPath::Invalid => return None,
        FileUrlPath::NotFileUrl => {
            let bytes = trimmed.as_bytes();
            let windows_drive = bytes.len() >= 3
                && bytes[0].is_ascii_alphabetic()
                && bytes[1] == b':'
                && matches!(bytes[2], b'\\' | b'/');
            let verbatim_drive = lower.starts_with(r"\\?\")
                && bytes.get(4).is_some_and(u8::is_ascii_alphabetic)
                && bytes.get(5) == Some(&b':')
                && bytes
                    .get(6)
                    .is_some_and(|byte| matches!(byte, b'\\' | b'/'));
            let network = trimmed.starts_with(r"\\") || trimmed.starts_with("//");
            if !trimmed.starts_with('/') && !windows_drive && !verbatim_drive && !network {
                return None;
            }
            trimmed.to_string()
        }
    };

    let components = portable
        .split(['/', '\\'])
        .filter(|component| !component.is_empty())
        .collect::<Vec<_>>();
    if components
        .iter()
        .any(|component| *component == "." || *component == "..")
    {
        return None;
    }
    let marker_index = components
        .iter()
        .rposition(|component| component.eq_ignore_ascii_case(APP_DATA_MARKER))?;
    if components.len() != marker_index + 3 {
        return None;
    }
    let category = AssetCategory::from_directory_name(components[marker_index + 1])?;
    let file_name = components[marker_index + 2];
    if file_name.is_empty() {
        return None;
    }
    Some((category, file_name.to_string()))
}

/// 외래 기기의 appData 자산 참조인지 — 현재 appData 루트 하위면 로컬 참조로 간주
pub(crate) fn is_foreign_portable_asset_reference(app_data_dir: &Path, raw: &str) -> bool {
    if parse_portable_asset_reference(raw).is_none() {
        return false;
    }
    let trimmed = raw.trim();
    let resolved = match file_url_to_path(trimmed) {
        FileUrlPath::Path(path) => path,
        FileUrlPath::Invalid => return false,
        FileUrlPath::NotFileUrl => PathBuf::from(trimmed),
    };
    !path_is_under_root(&resolved, app_data_dir)
}

fn path_is_under_root(path: &Path, root: &Path) -> bool {
    if path_ancestor_matches_identity(path, root) {
        return true;
    }
    // 루트가 심링크 경유(/var ↔ /private/var)면 정규화 후 재비교
    fs::canonicalize(root)
        .map(|canonical| path_ancestor_matches_identity(path, &canonical))
        .unwrap_or(false)
}

// Windows 대소문자·verbatim 표기 차이를 identity 키로 흡수해 조상 비교
fn path_ancestor_matches_identity(path: &Path, root: &Path) -> bool {
    let root_key = path_identity_key(root);
    path.ancestors()
        .any(|ancestor| path_identity_key(ancestor) == root_key)
}

/// 개별 이미지 참조를 앱 데이터 디렉터리로 마이그레이션
fn migrate_image_reference_to_app_data(images_dir: &Path, image_ref: &mut Option<String>) -> bool {
    let Some(raw_value) = image_ref.clone() else {
        return false;
    };

    let trimmed = raw_value.trim();
    if trimmed.is_empty() {
        return false;
    }

    if let Some((bytes, extension)) = decode_image_data_url(trimmed) {
        match import_image_bytes(&bytes, images_dir, &extension) {
            Ok(imported) => {
                *image_ref = Some(imported.path.to_string_lossy().to_string());
                return true;
            }
            Err(err) => {
                log::warn!(
                    "[Images] Failed to migrate data URL image into {}: {err:#}",
                    images_dir.display()
                );
                return false;
            }
        }
    }

    let source = PathBuf::from(trimmed);
    if !source.is_absolute() || !source.exists() {
        return false;
    }
    if source.starts_with(images_dir) {
        return false;
    }

    let extension = normalize_image_extension(source.extension().and_then(|ext| ext.to_str()));
    match import_image_file(&source, images_dir, &extension) {
        Ok(imported) => {
            *image_ref = Some(imported.path.to_string_lossy().to_string());
            true
        }
        Err(err) => {
            log::warn!(
                "[Images] Failed to copy local image from {}: {err}",
                source.display()
            );
            false
        }
    }
}

/// `rgba(r, g, b, a)` 문자열을 `#RRGGBB`로 변환. rgba 형식이 아니거나 파싱 실패 시 None
fn rgba_to_hex(color: &str) -> Option<String> {
    let inner = color.trim().strip_prefix("rgba(")?.strip_suffix(')')?;
    let mut parts = inner.split(',');
    let r: u8 = parts.next()?.trim().parse().ok()?;
    let g: u8 = parts.next()?.trim().parse().ok()?;
    let b: u8 = parts.next()?.trim().parse().ok()?;
    Some(format!("#{r:02X}{g:02X}{b:02X}"))
}

/// noteBorderColor가 변환 가능한 rgba면 #RRGGBB로 교체 (그 외 입력은 그대로)
fn migrate_note_border_color(color: &mut Option<String>) {
    if let Some(hex) = color.as_deref().and_then(rgba_to_hex) {
        *color = Some(hex);
    }
}

/// store에 #RRGGBB로 변환 가능한 rgba noteBorderColor가 남아 있는지 (디스크 영속 판단용)
fn has_convertible_note_border_color(data: &AppStoreData) -> bool {
    let convertible = |color: &Option<String>| color.as_deref().and_then(rgba_to_hex).is_some();
    data.key_positions
        .values()
        .flatten()
        .any(|pos| convertible(&pos.note_border_color))
        || data
            .stat_positions
            .values()
            .flatten()
            .any(|stat| convertible(&stat.position.note_border_color))
        || data
            .graph_positions
            .values()
            .flatten()
            .any(|graph| convertible(&graph.position.note_border_color))
        || data
            .knob_positions
            .values()
            .flatten()
            .any(|knob| convertible(&knob.position.note_border_color))
}

/// store 데이터 정규화 및 레거시 마이그레이션 적용
pub(crate) fn normalize_state(mut data: AppStoreData) -> AppStoreData {
    remove_legacy_panel_detach_setting(&mut data);
    normalize_custom_css_history(&mut data.custom_css_history);
    repair_editor_revision(&mut data);
    normalize_blank_font_colors(&mut data);
    canonicalize_image_modes(&mut data);

    if data.keys.is_empty() {
        data.keys = default_keys().clone();
    } else {
        merge_default_modes(&mut data.keys, default_keys());
    }

    if data.key_positions.is_empty() {
        data.key_positions = default_positions().clone();
    } else {
        merge_default_positions(&mut data.key_positions, default_positions());
    }

    if !has_valid_selected_key_type(&data) {
        data.selected_key_type = "4key".to_string();
    }

    pad_key_position_lengths(&mut data.keys, &mut data.key_positions);

    // 레거시 마이그레이션: 전역 noteSettings.borderRadius → 키별 noteBorderRadius
    if let Some(legacy_border_radius) = data.note_settings.border_radius.take() {
        for positions in data.key_positions.values_mut() {
            for pos in positions.iter_mut() {
                pos.note_border_radius = Some(legacy_border_radius as f64);
            }
        }
    }

    // 마이그레이션: noteBorderColor에 잘못 저장된 rgba(...) → #RRGGBB 복구 (이슈 #73)
    // 배치 편집 경로가 정규화 없이 rgba 문자열을 저장해 오버레이에서 초록색으로 깨짐
    for positions in data.key_positions.values_mut() {
        for pos in positions.iter_mut() {
            migrate_note_border_color(&mut pos.note_border_color);
        }
    }
    for positions in data.stat_positions.values_mut() {
        for stat in positions.iter_mut() {
            migrate_note_border_color(&mut stat.position.note_border_color);
        }
    }
    for positions in data.graph_positions.values_mut() {
        for graph in positions.iter_mut() {
            migrate_note_border_color(&mut graph.position.note_border_color);
        }
    }
    for positions in data.knob_positions.values_mut() {
        for knob in positions.iter_mut() {
            migrate_note_border_color(&mut knob.position.note_border_color);
        }
    }

    // 레거시 마이그레이션: fadePosition enum → 방향별 픽셀 fade 값
    data.note_settings.migrate_fade_position();
    for tab in data.tab_note_overrides.values_mut() {
        tab.migrate_fade_position();
    }

    merge_default_counters(&mut data.key_counters, &data.keys);

    data.counter_animation_presets =
        crate::models::normalize_user_counter_animation_presets(data.counter_animation_presets);

    // 마이그레이션: 기존 기본 카운터 설정의 반전된 active 색상 보정
    // (레거시 패턴에 해당하는 경우만 적용, 사용자 커스텀은 유지)
    for positions in data.key_positions.values_mut() {
        for pos in positions.iter_mut() {
            pos.counter.migrate_legacy_defaults();
        }
    }
    for positions in data.stat_positions.values_mut() {
        for pos in positions.iter_mut() {
            pos.position.counter.migrate_legacy_defaults();
        }
    }
    for positions in data.graph_positions.values_mut() {
        for pos in positions.iter_mut() {
            pos.position.counter.migrate_legacy_defaults();
        }
    }

    migrate_legacy_font_weight_state(&mut data);

    let _ = data.custom_js.normalize();

    data
}

fn repair_image_transforms(data: &mut AppStoreData) -> bool {
    fn repair_transform(transform: &mut Option<ImageTransform>) -> bool {
        let Some(transform) = transform else {
            return false;
        };
        let identity = ImageTransform::default();
        let mut repaired = false;
        for (value, fallback, minimum, maximum) in [
            (
                &mut transform.offset_x,
                identity.offset_x,
                IMAGE_TRANSFORM_OFFSET_MIN,
                IMAGE_TRANSFORM_OFFSET_MAX,
            ),
            (
                &mut transform.offset_y,
                identity.offset_y,
                IMAGE_TRANSFORM_OFFSET_MIN,
                IMAGE_TRANSFORM_OFFSET_MAX,
            ),
            (
                &mut transform.rotation,
                identity.rotation,
                IMAGE_TRANSFORM_ROTATION_MIN,
                IMAGE_TRANSFORM_ROTATION_MAX,
            ),
            (
                &mut transform.scale,
                identity.scale,
                IMAGE_TRANSFORM_SCALE_MIN,
                IMAGE_TRANSFORM_SCALE_MAX,
            ),
        ] {
            if !value.is_finite() || !(minimum..=maximum).contains(value) {
                *value = fallback;
                repaired = true;
            }
        }
        repaired
    }

    fn repair_position(position: &mut KeyPosition) -> bool {
        repair_transform(&mut position.idle_image_transform)
            | repair_transform(&mut position.active_image_transform)
    }

    let mut repaired = false;
    for position in data.key_positions.values_mut().flatten() {
        repaired |= repair_position(position);
    }
    for position in data.stat_positions.values_mut().flatten() {
        repaired |= repair_position(&mut position.position);
    }
    for position in data.graph_positions.values_mut().flatten() {
        repaired |= repair_position(&mut position.position);
    }
    for position in data.knob_positions.values_mut().flatten() {
        repaired |= repair_position(&mut position.position);
    }
    repaired
}

fn has_legacy_font_weight_state(data: &AppStoreData) -> bool {
    data.key_positions
        .values()
        .flatten()
        .chain(
            data.stat_positions
                .values()
                .flatten()
                .map(|position| &position.position),
        )
        .chain(
            data.graph_positions
                .values()
                .flatten()
                .map(|position| &position.position),
        )
        .chain(
            data.knob_positions
                .values()
                .flatten()
                .map(|position| &position.position),
        )
        .any(|position| {
            (position.font_bold.is_none() && position.font_weight == Some(700))
                || (position.counter.font_bold.is_none() && position.counter.font_weight == 700)
        })
}

pub(crate) fn migrate_legacy_font_weight_state(data: &mut AppStoreData) -> bool {
    let mut changed = false;
    for position in data.key_positions.values_mut().flatten() {
        changed |= position.migrate_legacy_font_weight();
    }
    for position in data.stat_positions.values_mut().flatten() {
        changed |= position.position.migrate_legacy_font_weight();
    }
    for position in data.graph_positions.values_mut().flatten() {
        changed |= position.position.migrate_legacy_font_weight();
    }
    for position in data.knob_positions.values_mut().flatten() {
        changed |= position.position.migrate_legacy_font_weight();
    }
    changed
}

fn normalize_blank_font_colors(data: &mut AppStoreData) -> bool {
    fn normalize_position(position: &mut KeyPosition) -> bool {
        let mut changed = false;
        for color in [&mut position.font_color, &mut position.active_font_color] {
            if color
                .as_deref()
                .is_some_and(|value| value.trim().is_empty())
            {
                *color = None;
                changed = true;
            }
        }
        changed
    }

    let mut changed = false;
    for position in data.key_positions.values_mut().flatten() {
        changed |= normalize_position(position);
    }
    for stat in data.stat_positions.values_mut().flatten() {
        changed |= normalize_position(&mut stat.position);
    }
    for graph in data.graph_positions.values_mut().flatten() {
        changed |= normalize_position(&mut graph.position);
    }
    for knob in data.knob_positions.values_mut().flatten() {
        changed |= normalize_position(&mut knob.position);
    }
    changed
}

// image_mode replace 표현을 None으로 접는다 (KeyPosition::canonicalize_image_mode 참조)
pub(crate) fn canonicalize_image_modes(data: &mut AppStoreData) -> bool {
    let mut changed = false;
    for position in data.key_positions.values_mut().flatten() {
        changed |= position.canonicalize_image_mode();
    }
    for stat in data.stat_positions.values_mut().flatten() {
        changed |= stat.position.canonicalize_image_mode();
    }
    for graph in data.graph_positions.values_mut().flatten() {
        changed |= graph.position.canonicalize_image_mode();
    }
    for knob in data.knob_positions.values_mut().flatten() {
        changed |= knob.position.canonicalize_image_mode();
    }
    changed
}

fn remove_legacy_panel_detach_setting(data: &mut AppStoreData) -> bool {
    data.plugin_data
        .remove(LEGACY_PANEL_DETACH_ENABLED_KEY)
        .is_some()
}

pub(crate) fn canonicalize_gradient_pairs(data: &mut AppStoreData) -> (bool, bool) {
    let mut changed = false;
    let mut pair_repaired = false;

    for position in data.key_positions.values_mut().flatten() {
        let (position_changed, position_pair_repaired) = position.canonicalize_gradient_pairs();
        changed |= position_changed;
        pair_repaired |= position_pair_repaired;
    }
    for stat in data.stat_positions.values_mut().flatten() {
        let (position_changed, position_pair_repaired) =
            stat.position.canonicalize_gradient_pairs();
        changed |= position_changed;
        pair_repaired |= position_pair_repaired;
    }
    for graph in data.graph_positions.values_mut().flatten() {
        let (position_changed, position_pair_repaired) =
            graph.position.canonicalize_gradient_pairs();
        changed |= position_changed;
        pair_repaired |= position_pair_repaired;
    }
    for knob in data.knob_positions.values_mut().flatten() {
        let (position_changed, position_pair_repaired) =
            knob.position.canonicalize_gradient_pairs();
        changed |= position_changed;
        pair_repaired |= position_pair_repaired;
    }

    (changed, pair_repaired)
}

fn repair_editor_revision(data: &mut AppStoreData) -> bool {
    if data.editor_revision <= super::editor::MAX_SAFE_WIRE_REVISION {
        return false;
    }

    log::warn!(
        "[Store] Resetting unsafe editorRevision {} to 0 during load recovery",
        data.editor_revision
    );
    data.editor_revision = 0;
    true
}

fn has_valid_selected_key_type(data: &AppStoreData) -> bool {
    default_keys().contains_key(&data.selected_key_type)
        || (data.keys.contains_key(&data.selected_key_type)
            && data
                .custom_tabs
                .iter()
                .any(|tab| tab.id == data.selected_key_type))
}

/// 그룹 정의가 사라진 요소의 groupId를 해제 — dangling 참조는 UI에서 해석 불가
/// 정리 발생 여부를 반환 (로드 경로에서 needs_persist 판단에 사용)
///
/// 파일 로드·프리셋 임포트처럼 정의와 참조가 함께 확정되는 경계에서만 호출할 것.
/// 프론트는 positions(groupId 포함)를 먼저 저장하고 layerGroups를 나중에 저장하므로,
/// normalize_state 같은 부분 저장 경로에서 돌리면 새 그룹 생성이 파괴된다.
pub(crate) fn clear_dangling_group_ids(data: &mut AppStoreData) -> bool {
    clear_dangling_group_ids_in(
        &mut data.key_positions,
        &mut data.stat_positions,
        &mut data.graph_positions,
        &mut data.knob_positions,
        &data.layer_groups,
    )
}

pub(crate) fn clear_dangling_group_ids_in(
    key_positions: &mut KeyPositions,
    stat_positions: &mut StatPositions,
    graph_positions: &mut GraphPositions,
    knob_positions: &mut KnobPositions,
    layer_groups: &LayerGroups,
) -> bool {
    let valid_ids: HashMap<&str, HashSet<&str>> = layer_groups
        .iter()
        .map(|(tab, groups)| {
            (
                tab.as_str(),
                groups.iter().map(|group| group.id.as_str()).collect(),
            )
        })
        .collect();

    let is_dangling = |tab: &str, group_id: &Option<String>| {
        group_id.as_ref().is_some_and(|id| {
            !valid_ids
                .get(tab)
                .is_some_and(|ids| ids.contains(id.as_str()))
        })
    };

    let mut changed = false;
    for (tab, positions) in key_positions.iter_mut() {
        for position in positions.iter_mut() {
            if is_dangling(tab, &position.group_id) {
                position.group_id = None;
                changed = true;
            }
        }
    }
    for (tab, positions) in stat_positions.iter_mut() {
        for stat in positions.iter_mut() {
            if is_dangling(tab, &stat.position.group_id) {
                stat.position.group_id = None;
                changed = true;
            }
        }
    }
    for (tab, positions) in graph_positions.iter_mut() {
        for graph in positions.iter_mut() {
            if is_dangling(tab, &graph.position.group_id) {
                graph.position.group_id = None;
                changed = true;
            }
        }
    }
    for (tab, positions) in knob_positions.iter_mut() {
        for knob in positions.iter_mut() {
            if is_dangling(tab, &knob.position.group_id) {
                knob.position.group_id = None;
                changed = true;
            }
        }
    }
    changed
}

/// 누락된 모드만 기본값으로 채움
fn merge_default_modes(target: &mut KeyMappings, defaults: &KeyMappings) {
    for (mode, value) in defaults.iter() {
        target.entry(mode.clone()).or_insert_with(|| value.clone());
    }
}

/// 누락된 모드만 기본값으로 채움
fn merge_default_positions(target: &mut KeyPositions, defaults: &KeyPositions) {
    for (mode, positions) in defaults.iter() {
        target
            .entry(mode.clone())
            .or_insert_with(|| positions.clone());
    }
}

/// 인덱스 결합 배열의 길이 보정
pub(crate) fn pad_key_position_lengths(
    keys: &mut KeyMappings,
    positions: &mut KeyPositions,
) -> bool {
    let modes = keys
        .keys()
        .chain(positions.keys())
        .cloned()
        .collect::<HashSet<_>>();
    let mut changed = false;

    for mode in modes {
        let key_count = keys.get(&mode).map_or(0, Vec::len);
        let position_count = positions.get(&mode).map_or(0, Vec::len);
        if key_count > position_count {
            log::warn!(
                "[Store] Padding keyPositions mode '{mode}' from {position_count} to {key_count} entries"
            );
            positions
                .entry(mode)
                .or_default()
                .resize(key_count, KeyPosition::default());
            changed = true;
        } else if position_count > key_count {
            log::warn!(
                "[Store] Padding keys mode '{mode}' from {key_count} to {position_count} entries"
            );
            keys.entry(mode)
                .or_default()
                .resize(position_count, KeySlot::default());
            changed = true;
        }
    }

    changed
}

fn key_position_lengths_mismatch(keys: &KeyMappings, positions: &KeyPositions) -> bool {
    keys.keys()
        .chain(positions.keys())
        .any(|mode| keys.get(mode).map_or(0, Vec::len) != positions.get(mode).map_or(0, Vec::len))
}

/// 키 카운터 기본값 병합
fn merge_default_counters(target: &mut KeyCounters, keys: &KeyMappings) {
    for (mode, key_list) in keys.iter() {
        let entry = target.entry(mode.clone()).or_default();
        let canonical_keys = key_list
            .iter()
            .map(KeySlot::canonical)
            .collect::<HashSet<_>>();
        entry.retain(|key, _| canonical_keys.contains(key));
        for key in canonical_keys {
            entry.entry(key).or_insert(0);
        }
    }

    let available_modes: std::collections::HashSet<_> = keys.keys().cloned().collect();
    target.retain(|mode, _| available_modes.contains(mode));
}

/// 레거시/비정상 store 파일 필드별 복구
fn repair_legacy_state(value: Value) -> AppStoreData {
    let Value::Object(mut source) = value else {
        return normalize_state(AppStoreData::default());
    };
    migrate_legacy_repair_fields(&mut source);
    let source_keys = source.get("keys").cloned();
    let source_key_positions = source.get("keyPositions").cloned();

    let Value::Object(mut recovered) =
        serde_json::to_value(AppStoreData::default()).unwrap_or_else(|_| Value::Object(Map::new()))
    else {
        return normalize_state(AppStoreData::default());
    };

    for (field, value) in source {
        let previous = recovered.insert(field.clone(), value.clone());
        if serde_json::from_value::<AppStoreData>(Value::Object(recovered.clone())).is_err() {
            if let Some(partial) = recover_collection_field(&field, &value) {
                recovered.insert(field.clone(), partial);
                if serde_json::from_value::<AppStoreData>(Value::Object(recovered.clone())).is_ok()
                {
                    continue;
                }
            }

            log::warn!("[Store] Resetting invalid field to default: {field}");
            match previous {
                Some(value) => {
                    recovered.insert(field, value);
                }
                None => {
                    recovered.remove(&field);
                }
            }
        }
    }

    let mut data =
        serde_json::from_value::<AppStoreData>(Value::Object(recovered)).unwrap_or_default();
    migrate_legacy_knob_sensitivity(&mut data);
    repair_image_transforms(&mut data);
    repair_semantic_identities(&mut data);
    repair_custom_tab_key_layout_pairs(
        &mut data,
        source_keys.as_ref(),
        source_key_positions.as_ref(),
    );
    canonicalize_gradient_pairs(&mut data);
    canonicalize_image_modes(&mut data);
    migrate_custom_css_history_timestamps(&mut data.custom_css_history);
    normalize_state(data)
}

fn repair_custom_tab_key_layout_pairs(
    data: &mut AppStoreData,
    source_keys: Option<&Value>,
    source_key_positions: Option<&Value>,
) -> bool {
    let tab_ids = data
        .custom_tabs
        .iter()
        .map(|tab| tab.id.clone())
        .collect::<Vec<_>>();
    let mut repaired = false;

    for mode in tab_ids {
        let source_keys = source_mode_array(source_keys, &mode);
        let source_positions = source_mode_array(source_key_positions, &mode);

        match (source_keys, source_positions) {
            (Some(_), Some(_)) => {}
            (None, Some(positions)) => {
                log::warn!(
                    "[Store] Rebuilding invalid keys mode '{mode}' with {} unassigned entries during recovery",
                    positions.len()
                );
                data.keys
                    .insert(mode, vec![KeySlot::default(); positions.len()]);
                repaired = true;
            }
            (Some(keys), None) => {
                log::warn!(
                    "[Store] Rebuilding invalid keyPositions mode '{mode}' with {} default entries during recovery",
                    keys.len()
                );
                data.key_positions
                    .insert(mode, vec![KeyPosition::default(); keys.len()]);
                repaired = true;
            }
            (None, None) => {
                log::warn!(
                    "[Store] Initializing missing keys and keyPositions modes '{mode}' during recovery"
                );
                data.keys.insert(mode.clone(), Vec::new());
                data.key_positions.insert(mode, Vec::new());
                repaired = true;
            }
        }
    }

    repaired
}

fn source_mode_array<'a>(collection: Option<&'a Value>, mode: &str) -> Option<&'a [Value]> {
    collection?
        .as_object()?
        .get(mode)?
        .as_array()
        .map(Vec::as_slice)
}

fn recover_collection_field(field: &str, value: &Value) -> Option<Value> {
    match field {
        "noteSettings" => recover_object_fields::<NoteSettings>(field, value),
        "customTabs" => recover_array_entries::<CustomTab>(field, value),
        "keys" => recover_key_mapping_entries(value),
        "soundLibrary" => recover_sound_library_entries(value),
        "keyPositions" => recover_key_position_entries(field, value),
        "statPositions" => recover_key_position_backed_entries::<StatPosition>(
            field,
            value,
            has_valid_stat_identity,
        ),
        "graphPositions" => recover_key_position_backed_entries::<GraphPosition>(
            field,
            value,
            has_valid_graph_identity,
        ),
        "knobPositions" => recover_key_position_backed_entries::<KnobPosition>(
            field,
            value,
            has_valid_knob_identity,
        ),
        "layerGroups" => recover_position_entries::<LayerGroupDef>(field, value),
        "keyCounters" => recover_key_counter_entries(value),
        "customCss" => recover_object_fields::<CustomCss>(field, value),
        "customCssHistory" => recover_array_entries::<CustomCssHistoryEntry>(field, value),
        "fontSettings" => recover_font_settings(value),
        "counterAnimationPresets" => recover_array_entries::<CounterAnimationPreset>(field, value),
        "tabCssOverrides" => recover_map_object_entries::<TabCss>(field, value),
        "tabNoteOverrides" => recover_map_object_entries::<TabNoteSettings>(field, value),
        "customJs" => recover_custom_js(value),
        "gridSettings" => recover_object_fields::<GridSettings>(field, value),
        "shortcuts" => recover_object_fields::<ShortcutsState>(field, value),
        _ => None,
    }
}

fn recover_object_fields<T>(field: &str, value: &Value) -> Option<Value>
where
    T: Default + DeserializeOwned + Serialize,
{
    let Value::Object(source) = value else {
        return None;
    };
    let Value::Object(mut recovered) = serde_json::to_value(T::default()).ok()? else {
        return None;
    };

    for (name, entry) in source {
        let previous = recovered.insert(name.clone(), entry.clone());
        if serde_json::from_value::<T>(Value::Object(recovered.clone())).is_err() {
            log::warn!(
                "[Store] Resetting invalid {field} child '{name}' to its default during recovery"
            );
            match previous {
                Some(value) => {
                    recovered.insert(name.clone(), value);
                }
                None => {
                    recovered.remove(name);
                }
            }
        }
    }
    Some(Value::Object(recovered))
}

fn recover_key_position_fields(field: &str, value: &Value) -> Option<Value> {
    let Value::Object(source) = value else {
        return None;
    };
    let Value::Object(mut recovered) = recover_object_fields::<KeyPosition>(field, value)? else {
        return None;
    };

    // sparse 폰트 필드는 부재 자체가 레거시 의미를 가진다
    if !source.contains_key("fontWeight") {
        recovered.remove("fontWeight");
    }
    let source_weight_is_valid = source
        .get("fontWeight")
        .is_none_or(|entry| serde_json::from_value::<Option<u32>>(entry.clone()).is_ok());
    if !source.contains_key("fontBold") && source_weight_is_valid {
        recovered.remove("fontBold");
    }

    Some(Value::Object(recovered))
}

fn recover_array_entries<T>(field: &str, value: &Value) -> Option<Value>
where
    T: DeserializeOwned,
{
    let Value::Array(entries) = value else {
        return None;
    };

    let mut recovered = Vec::with_capacity(entries.len());
    for (index, entry) in entries.iter().enumerate() {
        match serde_json::from_value::<T>(entry.clone()) {
            Ok(_) => recovered.push(entry.clone()),
            Err(err) => {
                log::warn!(
                    "[Store] Removing invalid {field} entry '[{index}]' during recovery: {err}"
                );
            }
        }
    }
    Some(Value::Array(recovered))
}

fn recover_key_mapping_entries(value: &Value) -> Option<Value> {
    let Value::Object(modes) = value else {
        return None;
    };

    let defaults = default_keys();
    let mut recovered_modes = Map::new();
    for (mode, entries) in modes {
        let recovered_entries = match entries {
            Value::Array(entries) => entries
                .iter()
                .map(|entry| {
                    serde_json::to_value(normalize_key_slot(entry.clone()))
                        .unwrap_or(Value::String(String::new()))
                })
                .collect(),
            _ => {
                log::warn!(
                    "[Store] Replacing invalid keys mode '{mode}' during recovery: expected an array"
                );
                defaults
                    .get(mode)
                    .map(|keys| {
                        keys.iter()
                            .filter_map(|slot| serde_json::to_value(slot).ok())
                            .collect()
                    })
                    .unwrap_or_default()
            }
        };
        recovered_modes.insert(mode.clone(), Value::Array(recovered_entries));
    }
    Some(Value::Object(recovered_modes))
}

fn recover_key_counter_entries(value: &Value) -> Option<Value> {
    let Value::Object(modes) = value else {
        return None;
    };

    let mut recovered_modes = Map::new();
    for (mode, counters) in modes {
        let Value::Object(counters) = counters else {
            log::warn!(
                "[Store] Replacing invalid keyCounters mode '{mode}' with an empty map during recovery"
            );
            recovered_modes.insert(mode.clone(), Value::Object(Map::new()));
            continue;
        };

        let mut recovered_counters = Map::new();
        for (key, count) in counters {
            if serde_json::from_value::<u32>(count.clone()).is_ok() {
                recovered_counters.insert(key.clone(), count.clone());
            } else {
                log::warn!(
                    "[Store] Removing invalid keyCounters entry '{mode}.{key}' during recovery"
                );
            }
        }
        recovered_modes.insert(mode.clone(), Value::Object(recovered_counters));
    }
    Some(Value::Object(recovered_modes))
}

fn recover_custom_js(value: &Value) -> Option<Value> {
    let Value::Object(settings) = value else {
        return None;
    };
    let mut candidate = settings.clone();
    if let Some(plugins) = settings.get("plugins") {
        let recovered_plugins = recover_array_entries::<JsPlugin>("customJs.plugins", plugins)
            .unwrap_or_else(|| Value::Array(Vec::new()));
        candidate.insert("plugins".to_string(), recovered_plugins);
    }
    recover_object_fields::<CustomJs>("customJs", &Value::Object(candidate))
}

fn recover_sound_library_entries(value: &Value) -> Option<Value> {
    let Value::Object(entries) = value else {
        return None;
    };
    let default_entry = serde_json::to_value(SoundLibraryEntry::default()).ok()?;
    let mut recovered = Map::new();

    for (key, entry) in entries {
        if serde_json::from_value::<SoundLibraryEntry>(entry.clone()).is_ok() {
            recovered.insert(key.clone(), entry.clone());
            continue;
        }

        let entry_name = format!("soundLibrary.{key}");
        if let Some(partial) = recover_object_fields::<SoundLibraryEntry>(&entry_name, entry) {
            if serde_json::from_value::<SoundLibraryEntry>(partial.clone()).is_ok() {
                recovered.insert(key.clone(), partial);
                continue;
            }
        }

        // 외래 기기의 관리 사운드 경로 키도 재건 대상 — 삭제하면 재귀화 치유 기회가 사라짐
        let rebuildable_key = Path::new(key).is_absolute()
            || matches!(
                parse_portable_asset_reference(key),
                Some((AssetCategory::Sounds, _))
            );
        if rebuildable_key {
            log::warn!(
                "[Store] Rebuilding invalid soundLibrary entry '{key}' from its asset path during recovery"
            );
            recovered.insert(key.clone(), default_entry.clone());
        } else {
            log::warn!(
                "[Store] Removing invalid soundLibrary entry '{key}' with a non-absolute path during recovery"
            );
        }
    }

    Some(Value::Object(recovered))
}

fn recover_map_object_entries<T>(field: &str, value: &Value) -> Option<Value>
where
    T: Default + DeserializeOwned + Serialize,
{
    let Value::Object(entries) = value else {
        return None;
    };

    let mut recovered = Map::new();
    for (key, entry) in entries {
        if serde_json::from_value::<T>(entry.clone()).is_ok() {
            recovered.insert(key.clone(), entry.clone());
            continue;
        }

        let entry_name = format!("{field}.{key}");
        let Some(partial) = recover_object_fields::<T>(&entry_name, entry) else {
            log::warn!("[Store] Removing invalid {field} entry '{key}' during recovery");
            continue;
        };
        if serde_json::from_value::<T>(partial.clone()).is_ok() {
            recovered.insert(key.clone(), partial);
        } else {
            log::warn!("[Store] Removing unrecoverable {field} entry '{key}' during recovery");
        }
    }
    Some(Value::Object(recovered))
}

fn recover_key_position_backed_entries<T>(
    field: &str,
    value: &Value,
    has_valid_identity: fn(&Value) -> bool,
) -> Option<Value>
where
    T: DeserializeOwned,
{
    let Value::Object(modes) = value else {
        return None;
    };

    let mut recovered_modes = Map::new();
    for (mode, entries) in modes {
        let Value::Array(entries) = entries else {
            log::warn!(
                "[Store] Removing invalid {field} mode '{mode}' during recovery: expected an array"
            );
            continue;
        };

        let mut recovered_entries = Vec::with_capacity(entries.len());
        for (index, entry) in entries.iter().enumerate() {
            if serde_json::from_value::<T>(entry.clone()).is_ok() {
                recovered_entries.push(entry.clone());
                continue;
            }

            let entry_name = format!("{field}.{mode}[{index}]");
            let mut candidate = entry.clone();
            recover_image_transform_children(&entry_name, &mut candidate);
            recover_invalid_counter_fill_gradient_children(&entry_name, &mut candidate);
            if serde_json::from_value::<T>(candidate.clone()).is_ok() {
                recovered_entries.push(candidate);
                continue;
            }

            if !has_valid_identity(&candidate) {
                log::warn!(
                    "[Store] Removing invalid {field} entry '{mode}[{index}]' with a damaged identity during recovery"
                );
                continue;
            }

            let Some(partial) = recover_key_position_fields(&entry_name, &candidate) else {
                log::warn!(
                    "[Store] Removing invalid {field} entry '{mode}[{index}]' during recovery"
                );
                continue;
            };
            if serde_json::from_value::<T>(partial.clone()).is_ok() {
                recovered_entries.push(partial);
            } else {
                log::warn!(
                    "[Store] Removing invalid {field} entry '{mode}[{index}]' with damaged non-layout fields during recovery"
                );
            }
        }
        recovered_modes.insert(mode.clone(), Value::Array(recovered_entries));
    }

    Some(Value::Object(recovered_modes))
}

fn value_field_deserializes<T>(value: &Value, field: &str) -> bool
where
    T: DeserializeOwned,
{
    value
        .get(field)
        .is_some_and(|entry| serde_json::from_value::<T>(entry.clone()).is_ok())
}

fn has_valid_stat_identity(value: &Value) -> bool {
    value_field_deserializes::<StatType>(value, "statType")
}

fn has_valid_graph_identity(value: &Value) -> bool {
    value_field_deserializes::<GraphStatType>(value, "statType")
        && value_field_deserializes::<GraphType>(value, "graphType")
}

fn has_valid_knob_identity(value: &Value) -> bool {
    value.get("axisId").is_none_or(Value::is_string)
}

fn recover_key_position_entries(field: &str, value: &Value) -> Option<Value> {
    let Value::Object(modes) = value else {
        return None;
    };
    let default_position = match serde_json::to_value(KeyPosition::default()) {
        Ok(value) => value,
        Err(err) => {
            log::warn!("[Store] Failed to serialize the default {field} entry: {err}");
            return None;
        }
    };

    let mut recovered_modes = Map::new();
    for (mode, entries) in modes {
        let Value::Array(entries) = entries else {
            log::warn!(
                "[Store] Removing invalid {field} mode '{mode}' during recovery: expected an array"
            );
            continue;
        };

        let mut recovered_entries = Vec::with_capacity(entries.len());
        for (index, entry) in entries.iter().enumerate() {
            match serde_json::from_value::<KeyPosition>(entry.clone()) {
                Ok(_) => recovered_entries.push(entry.clone()),
                Err(err) => {
                    let entry_name = format!("{field}.{mode}[{index}]");
                    let mut candidate = entry.clone();
                    recover_image_transform_children(&entry_name, &mut candidate);
                    recover_invalid_counter_fill_gradient_children(&entry_name, &mut candidate);
                    let recovered = if serde_json::from_value::<KeyPosition>(candidate.clone())
                        .is_ok()
                    {
                        candidate
                    } else {
                        recover_key_position_fields(&entry_name, &candidate)
                        .filter(|candidate| {
                            serde_json::from_value::<KeyPosition>(candidate.clone()).is_ok()
                        })
                        .unwrap_or_else(|| {
                            log::warn!(
                                "[Store] Replacing invalid {field} entry '{mode}[{index}]' with default during recovery: {err}"
                            );
                            default_position.clone()
                        })
                    };
                    recovered_entries.push(recovered);
                }
            }
        }
        recovered_modes.insert(mode.clone(), Value::Array(recovered_entries));
    }
    Some(Value::Object(recovered_modes))
}

fn recover_image_transform_children(entry_name: &str, value: &mut Value) -> bool {
    let Some(position) = value.as_object_mut() else {
        return false;
    };
    let mut repaired = false;

    let invalid_mode = position
        .get("imageMode")
        .is_some_and(|mode| serde_json::from_value::<Option<ImageMode>>(mode.clone()).is_err());
    if invalid_mode {
        log::warn!("[Store] Resetting invalid {entry_name}.imageMode to None during recovery");
        position.remove("imageMode");
        repaired = true;
    }

    for field in ["idleImageTransform", "activeImageTransform"] {
        let invalid_object = position
            .get(field)
            .is_some_and(|transform| !transform.is_null() && !transform.is_object());
        if invalid_object {
            log::warn!("[Store] Resetting invalid {entry_name}.{field} to None during recovery");
            position.remove(field);
            repaired = true;
            continue;
        }
        let Some(transform) = position.get_mut(field).and_then(Value::as_object_mut) else {
            continue;
        };
        for (leaf, fallback, minimum, maximum) in [
            (
                "offsetX",
                0.0,
                IMAGE_TRANSFORM_OFFSET_MIN,
                IMAGE_TRANSFORM_OFFSET_MAX,
            ),
            (
                "offsetY",
                0.0,
                IMAGE_TRANSFORM_OFFSET_MIN,
                IMAGE_TRANSFORM_OFFSET_MAX,
            ),
            (
                "rotation",
                0.0,
                IMAGE_TRANSFORM_ROTATION_MIN,
                IMAGE_TRANSFORM_ROTATION_MAX,
            ),
            (
                "scale",
                1.0,
                IMAGE_TRANSFORM_SCALE_MIN,
                IMAGE_TRANSFORM_SCALE_MAX,
            ),
        ] {
            let invalid = transform
                .get(leaf)
                .and_then(Value::as_f64)
                .is_none_or(|value| !value.is_finite() || !(minimum..=maximum).contains(&value));
            if invalid {
                log::warn!(
                    "[Store] Resetting invalid {entry_name}.{field}.{leaf} to identity during recovery"
                );
                transform.insert(leaf.to_string(), serde_json::json!(fallback));
                repaired = true;
            }
        }
    }
    repaired
}

fn recover_invalid_counter_fill_gradient_children(entry_name: &str, value: &mut Value) -> bool {
    let Some(counter) = value.get_mut("counter").and_then(Value::as_object_mut) else {
        return false;
    };

    let mut changed = false;
    for field in ["fillIdleGradient", "fillActiveGradient"] {
        let invalid = counter.get(field).is_some_and(|gradient| {
            serde_json::from_value::<Option<GradientSpec>>(gradient.clone()).is_err()
        });
        if invalid {
            log::warn!(
                "[Store] Resetting invalid {entry_name}.counter.{field} to None during recovery"
            );
            counter.remove(field);
            changed = true;
        }
    }
    changed
}

fn recover_position_entries<T>(field: &str, value: &Value) -> Option<Value>
where
    T: DeserializeOwned,
{
    let Value::Object(modes) = value else {
        return None;
    };

    let mut recovered_modes = Map::new();
    for (mode, entries) in modes {
        let Value::Array(entries) = entries else {
            log::warn!(
                "[Store] Removing invalid {field} mode '{mode}' during recovery: expected an array"
            );
            continue;
        };

        let mut recovered_entries = Vec::with_capacity(entries.len());
        for (index, entry) in entries.iter().enumerate() {
            match serde_json::from_value::<T>(entry.clone()) {
                Ok(_) => recovered_entries.push(entry.clone()),
                Err(err) => {
                    log::warn!(
                        "[Store] Removing invalid {field} entry '{mode}[{index}]' during recovery: {err}"
                    );
                }
            }
        }
        recovered_modes.insert(mode.clone(), Value::Array(recovered_entries));
    }
    Some(Value::Object(recovered_modes))
}

fn recover_font_settings(value: &Value) -> Option<Value> {
    let Value::Object(settings) = value else {
        return None;
    };
    let mut recovered = settings.clone();
    let Some(custom_fonts) = settings.get("customFonts") else {
        return Some(Value::Object(recovered));
    };
    let Value::Array(custom_fonts) = custom_fonts else {
        log::warn!(
            "[Store] Removing invalid fontSettings.customFonts collection during recovery: expected an array"
        );
        recovered.insert("customFonts".to_string(), Value::Array(Vec::new()));
        return Some(Value::Object(recovered));
    };

    let mut recovered_fonts = Vec::with_capacity(custom_fonts.len());
    for (index, font) in custom_fonts.iter().enumerate() {
        let mut candidate = font.clone();
        let invalid_weight_ranges = candidate.get("weightRanges").is_some_and(|ranges| {
            serde_json::from_value::<Vec<FontWeightRange>>(ranges.clone()).is_err()
        });
        if invalid_weight_ranges {
            if let Some(object) = candidate.as_object_mut() {
                object.remove("weightRanges");
            }
            log::warn!(
                "[Store] Resetting invalid fontSettings.customFonts entry '[{index}].weightRanges' during recovery"
            );
        }

        match serde_json::from_value::<CustomFont>(candidate.clone()) {
            Ok(_) => recovered_fonts.push(candidate),
            Err(err) => {
                if let Some(recovered) = recover_local_font_enabled(&candidate) {
                    log::warn!(
                        "[Store] Disabling fontSettings.customFonts entry '[{index}]' with an invalid enabled field during recovery"
                    );
                    recovered_fonts.push(recovered);
                } else {
                    log::warn!(
                        "[Store] Removing invalid fontSettings.customFonts entry '[{index}]' during recovery: {err}"
                    );
                }
            }
        }
    }
    recovered.insert("customFonts".to_string(), Value::Array(recovered_fonts));
    Some(Value::Object(recovered))
}

fn recover_local_font_enabled(value: &Value) -> Option<Value> {
    let Value::Object(source) = value else {
        return None;
    };
    if source.get("enabled").is_some_and(Value::is_boolean) {
        return None;
    }
    let id = source.get("id").and_then(Value::as_str)?;
    let name = source.get("name").and_then(Value::as_str)?;
    if id.trim().is_empty() || name.trim().is_empty() {
        return None;
    }
    let font_type = source
        .get("type")
        .and_then(|font_type| serde_json::from_value::<FontType>(font_type.clone()).ok())?;
    if font_type != FontType::Local {
        return None;
    }
    let local_path = source.get("localPath").and_then(Value::as_str)?;
    let trimmed_path = local_path.trim();
    // 외래 기기의 관리 폰트 경로도 유효한 복구 정체성 — 항목 삭제 대신 비활성 복구
    let portable_font_path = matches!(
        parse_portable_asset_reference(trimmed_path),
        Some((AssetCategory::Fonts, _))
    );
    if trimmed_path.is_empty() || (!Path::new(trimmed_path).is_absolute() && !portable_font_path) {
        return None;
    }

    let mut candidate = source.clone();
    candidate.insert("enabled".to_string(), Value::Bool(false));
    serde_json::from_value::<CustomFont>(Value::Object(candidate.clone())).ok()?;
    Some(Value::Object(candidate))
}

fn migrate_legacy_repair_fields(fields: &mut Map<String, Value>) {
    promote_legacy_field(fields, "useCustomCss", "useCustomCSS");
    promote_legacy_field(fields, "customCss", "customCSS");
    promote_legacy_field(fields, "useCustomJs", "useCustomJS");
    promote_legacy_field(fields, "customJs", "customJS");

    let legacy_bounds = fields.remove("overlayWindowBounds");
    let legacy_position = fields.remove("overlayWindowPosition");
    if fields.contains_key("overlayBounds") {
        return;
    }
    if let Some(value) = legacy_bounds {
        if serde_json::from_value::<OverlayBounds>(value.clone()).is_ok() {
            fields.insert("overlayBounds".to_string(), value);
            return;
        }
    }
    if let Some(value) = legacy_position {
        if let Ok(position) = serde_json::from_value::<LegacyOverlayPosition>(value) {
            fields.insert(
                "overlayBounds".to_string(),
                serde_json::json!({
                    "x": position.x,
                    "y": position.y,
                    "width": LEGACY_OVERLAY_WIDTH,
                    "height": LEGACY_OVERLAY_HEIGHT,
                }),
            );
        }
    }
}

fn promote_legacy_field(fields: &mut Map<String, Value>, current: &str, legacy: &str) {
    if fields.contains_key(current) {
        return;
    }
    if let Some(value) = fields.remove(legacy) {
        fields.insert(current.to_string(), value);
    }
}

fn option_has_non_empty_text(value: &Option<String>) -> bool {
    value
        .as_ref()
        .map(|text| !text.trim().is_empty())
        .unwrap_or(false)
}

fn decode_font_data_url(
    value: &str,
    fallback_extension: Option<&str>,
) -> Option<(Vec<u8>, String)> {
    let lower = value.to_ascii_lowercase();
    let data_start = lower.find("data:")?;
    let data_url = &value[data_start..];
    let (header, raw_payload) = data_url.split_once(',')?;
    let header_lower = header.to_ascii_lowercase();
    if !header_lower.contains(";base64") {
        return None;
    }

    let mime = header_lower.strip_prefix("data:")?.split(';').next()?;
    let extension = match mime {
        "font/otf" | "application/x-font-opentype" => "otf",
        "font/woff" | "application/font-woff" | "application/x-font-woff" => "woff",
        "font/woff2" | "application/font-woff2" => "woff2",
        "font/ttf" | "application/x-font-ttf" => "ttf",
        _ if mime.starts_with("font/") => normalize_font_extension(fallback_extension),
        _ => return None,
    };
    let payload: String = raw_payload
        .chars()
        .take_while(|character| !matches!(character, ')' | '\'' | '"' | ';'))
        .filter(|character| !character.is_ascii_whitespace())
        .collect();
    if payload.is_empty() {
        return None;
    }

    let bytes = BASE64_STANDARD.decode(payload.as_bytes()).ok()?;
    Some((bytes, extension.to_string()))
}

fn normalize_font_extension(extension: Option<&str>) -> &'static str {
    match extension
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "otf" => "otf",
        "woff" => "woff",
        "woff2" => "woff2",
        _ => "ttf",
    }
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

#[derive(Deserialize)]
struct LegacyOverlayPosition {
    x: f64,
    y: f64,
}

#[cfg(test)]
mod tests;
