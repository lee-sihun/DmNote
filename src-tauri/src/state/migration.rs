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
        normalize_key_slot, AppStoreData, CounterAnimationPreset, CustomCss, CustomCssHistoryEntry,
        CustomFont, CustomJs, CustomTab, FontType, GradientSpec, GraphPosition, GraphPositions,
        GraphStatType, GraphType, GridSettings, JsPlugin, KeyCounters, KeyMappings, KeyPosition,
        KeyPositions, KeySlot, KnobPosition, KnobPositions, LayerGroupDef, LayerGroups,
        NoteSettings, OverlayBounds, ShortcutsState, SoundLibraryEntry, StatPosition,
        StatPositions, StatType, TabCss, TabNoteSettings,
    },
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
                match serde_json::from_value::<AppStoreData>(value.clone()) {
                    Ok(mut data) => {
                        let mut needs_persist = sound_library_migrated
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
                                || gradient_pair_repaired,
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

fn has_explicit_invalid_element_id(value: &Value) -> bool {
    [
        "keyPositions",
        "statPositions",
        "graphPositions",
        "knobPositions",
    ]
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
}

/// store 데이터 정규화 및 레거시 마이그레이션 적용
pub(crate) fn normalize_state(mut data: AppStoreData) -> AppStoreData {
    remove_legacy_panel_detach_setting(&mut data);
    normalize_custom_css_history(&mut data.custom_css_history);
    repair_editor_revision(&mut data);

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
        .any(|position| position.font_bold.is_none() || position.counter.font_bold.is_none())
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
    repair_semantic_identities(&mut data);
    repair_custom_tab_key_layout_pairs(
        &mut data,
        source_keys.as_ref(),
        source_key_positions.as_ref(),
    );
    canonicalize_gradient_pairs(&mut data);
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
            recover_invalid_counter_gradient_children(&entry_name, &mut candidate);
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

            let Some(partial) = recover_object_fields::<KeyPosition>(&entry_name, &candidate)
            else {
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
                    recover_invalid_counter_gradient_children(&entry_name, &mut candidate);
                    let recovered = if serde_json::from_value::<KeyPosition>(candidate.clone())
                        .is_ok()
                    {
                        candidate
                    } else {
                        recover_object_fields::<KeyPosition>(&entry_name, &candidate)
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

fn recover_invalid_counter_gradient_children(entry_name: &str, value: &mut Value) -> bool {
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
        match serde_json::from_value::<CustomFont>(font.clone()) {
            Ok(_) => recovered_fonts.push(font.clone()),
            Err(err) => {
                if let Some(recovered) = recover_local_font_enabled(font) {
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
mod tests {
    use super::{
        load_store_from_path, migrate_local_fonts_to_app_data, migrate_sound_library_enabled,
        normalize_state, parse_portable_asset_reference, recover_key_mapping_entries,
        rehome_foreign_asset_references, rgba_to_hex, AssetCategory, LEGACY_OVERLAY_HEIGHT,
        LEGACY_OVERLAY_WIDTH, LEGACY_PANEL_DETACH_ENABLED_KEY,
    };
    use crate::{
        defaults::{default_keys, default_positions},
        models::{
            AppStoreData, CustomCssHistoryEntry, CustomFont, CustomTab, FontType, GraphPosition,
            GraphStatType, GraphType, KeyCounterAlign, KeyCounterAlignMode, KeyCounterColor,
            KeyCounterPlacement, KeyMappings, KeyPosition, KeySlot, KnobPosition, LayerGroupDef,
            OverlayBounds, SlotMatch, SoundLibraryEntry, StatPosition, StatType, TabCss,
            TabNoteSettings,
        },
    };
    use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
    use serde::{Deserialize, Serialize};
    use unicode_normalization::UnicodeNormalization;

    fn rehome_test_directory(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("dmnote-rehome-{label}-{}", uuid::Uuid::new_v4()))
    }

    // Windows에선 /tmp가 절대 경로가 아니므로 픽스처는 플랫폼별 절대 경로 사용
    fn absolute_fixture_path(name: &str) -> String {
        if cfg!(target_os = "windows") {
            format!(r"C:\tmp\{name}")
        } else {
            format!("/tmp/{name}")
        }
    }

    fn data_with_one_position() -> AppStoreData {
        AppStoreData {
            key_positions: default_positions().clone(),
            ..AppStoreData::default()
        }
    }

    fn tauri_store_fixture_base() -> serde_json::Value {
        serde_json::json!({
            "hardwareAcceleration": true,
            "alwaysOnTop": false,
            "overlayLocked": false,
            "noteEffect": true,
            "selectedKeyType": "fixture-tab",
            "customTabs": [{ "id": "fixture-tab", "name": "Fixture" }],
            "angleMode": "d3d11",
            "language": "ko",
            "laboratoryEnabled": false,
            "keys": { "fixture-tab": ["F13"] },
            "keyPositions": {
                "fixture-tab": [{
                    "dx": 13.0,
                    "dy": 14.0,
                    "width": 60.0,
                    "height": 60.0,
                    "activeImage": "",
                    "inactiveImage": "",
                    "count": 0,
                    "noteColor": "#FFFFFF",
                    "noteOpacity": 80
                }]
            },
            "keyCounters": { "fixture-tab": { "F13": 17 } },
            "backgroundColor": "#131415",
            "useCustomCss": false,
            "customCss": { "path": null, "content": "" },
            "overlayResizeAnchor": "top-left",
            "overlayBounds": null,
            "overlayLastContentTopOffset": null,
            "overlayBoundsAreLogical": false,
            "keyCounterEnabled": true
        })
    }

    fn load_literal_fixture(version: &str, fixture: &serde_json::Value) -> AppStoreData {
        let path = std::env::temp_dir().join(format!(
            "dmnote-tauri-{version}-store-fixture-{}.json",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&path, serde_json::to_vec_pretty(fixture).unwrap()).unwrap();
        let loaded = load_store_from_path(&path)
            .unwrap_or_else(|error| panic!("Tauri {version} fixture must load: {error:#}"));
        let _ = std::fs::remove_file(path);
        loaded.data
    }

    fn store_with_each_native_collection() -> AppStoreData {
        let mut data = normalize_state(AppStoreData {
            keys: default_keys().clone(),
            key_positions: default_positions().clone(),
            ..AppStoreData::default()
        });
        data.stat_positions.insert(
            "4key".to_string(),
            vec![StatPosition {
                stat_type: StatType::Kps,
                position: KeyPosition {
                    dx: 101.0,
                    ..KeyPosition::default()
                },
            }],
        );
        data.graph_positions.insert(
            "4key".to_string(),
            vec![GraphPosition {
                stat_type: GraphStatType::Kps,
                graph_type: GraphType::Line,
                graph_speed: 100,
                graph_color: "#123456".to_string(),
                show_avg_line: true,
                position: KeyPosition {
                    dx: 102.0,
                    ..KeyPosition::default()
                },
            }],
        );
        data.knob_positions.insert(
            "4key".to_string(),
            vec![KnobPosition {
                axis_id: "axis".to_string(),
                sensitivity: 1.0,
                reverse: false,
                position: KeyPosition {
                    dx: 103.0,
                    ..KeyPosition::default()
                },
            }],
        );
        crate::state::native_element_id::backfill_store_element_ids(&mut data);
        data
    }

    fn remove_all_native_ids(value: &mut serde_json::Value) {
        for field in [
            "keyPositions",
            "statPositions",
            "graphPositions",
            "knobPositions",
        ] {
            let Some(modes) = value
                .get_mut(field)
                .and_then(serde_json::Value::as_object_mut)
            else {
                continue;
            };
            for elements in modes
                .values_mut()
                .filter_map(serde_json::Value::as_array_mut)
            {
                for element in elements {
                    if let Some(element) = element.as_object_mut() {
                        element.remove("id");
                    }
                }
            }
        }
    }

    #[test]
    fn legacy_store_backfills_all_native_ids_and_reload_preserves_them() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-native-id-backfill-{}.json",
            uuid::Uuid::new_v4()
        ));
        let mut raw = serde_json::to_value(store_with_each_native_collection()).unwrap();
        remove_all_native_ids(&mut raw);
        std::fs::write(&path, serde_json::to_vec_pretty(&raw).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        let document = crate::models::EditorDocumentV1::from_store(&loaded.data);
        crate::state::native_element_id::validate_document_element_ids(&document).unwrap();
        let first_ids = [
            loaded.data.key_positions["4key"][0].id.clone(),
            loaded.data.stat_positions["4key"][0].position.id.clone(),
            loaded.data.graph_positions["4key"][0].position.id.clone(),
            loaded.data.knob_positions["4key"][0].position.id.clone(),
        ];
        assert_eq!(
            first_ids
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len(),
            4
        );
        assert!(loaded.needs_persist);
        assert!(!loaded.repaired);

        std::fs::write(&path, serde_json::to_vec_pretty(&loaded.data).unwrap()).unwrap();
        let reloaded = load_store_from_path(&path).unwrap();
        let second_ids = [
            reloaded.data.key_positions["4key"][0].id.clone(),
            reloaded.data.stat_positions["4key"][0].position.id.clone(),
            reloaded.data.graph_positions["4key"][0].position.id.clone(),
            reloaded.data.knob_positions["4key"][0].position.id.clone(),
        ];
        assert_eq!(second_ids, first_ids);
        assert!(!reloaded.needs_persist);
        assert!(!reloaded.repaired);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn invalid_and_duplicate_ids_are_repaired_without_touching_assets() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-native-id-repair-{}.json",
            uuid::Uuid::new_v4()
        ));
        let mut data = store_with_each_native_collection();
        data.stat_positions.get_mut("4key").unwrap()[0]
            .position
            .active_image = Some("/images/kept.png".to_string());
        data.stat_positions.get_mut("4key").unwrap()[0]
            .position
            .sound_path = Some("/sounds/kept.wav".to_string());
        let kept_key_id = data.key_positions["4key"][0].id.clone();
        let kept_knob_id = data.knob_positions["4key"][0].position.id.clone();
        let old_stat_id = data.stat_positions["4key"][0].position.id.clone();
        let old_graph_id = data.graph_positions["4key"][0].position.id.clone();
        let mut raw = serde_json::to_value(data).unwrap();
        raw["statPositions"]["4key"][0]["id"] = serde_json::json!(kept_key_id);
        raw["graphPositions"]["4key"][0]["id"] = serde_json::json!("");
        std::fs::write(&path, serde_json::to_vec_pretty(&raw).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();

        assert!(loaded.needs_persist);
        assert!(loaded.repaired);
        assert_eq!(loaded.data.key_positions["4key"][0].id, kept_key_id);
        assert_eq!(
            loaded.data.knob_positions["4key"][0].position.id,
            kept_knob_id
        );
        assert_ne!(
            loaded.data.stat_positions["4key"][0].position.id,
            old_stat_id
        );
        assert_ne!(
            loaded.data.graph_positions["4key"][0].position.id,
            old_graph_id
        );
        assert_eq!(
            loaded.data.stat_positions["4key"][0]
                .position
                .active_image
                .as_deref(),
            Some("/images/kept.png")
        );
        assert_eq!(
            loaded.data.stat_positions["4key"][0]
                .position
                .sound_path
                .as_deref(),
            Some("/sounds/kept.wav")
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn recovery_and_pair_padding_preserve_surviving_ids_before_backfill() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-native-id-recovery-order-{}.json",
            uuid::Uuid::new_v4()
        ));
        let data = store_with_each_native_collection();
        let surviving_key_id = data.key_positions["4key"][0].id.clone();
        let surviving_stat_id = data.stat_positions["4key"][0].position.id.clone();
        let original_position_len = data.key_positions["4key"].len();
        let mut raw = serde_json::to_value(data).unwrap();
        raw["keys"]["4key"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!("F24"));
        raw["statPositions"]["4key"][0]["dx"] = serde_json::json!("broken");
        std::fs::write(&path, serde_json::to_vec_pretty(&raw).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();

        assert!(loaded.repaired);
        assert_eq!(
            loaded.data.key_positions["4key"].len(),
            original_position_len + 1
        );
        assert_eq!(loaded.data.key_positions["4key"][0].id, surviving_key_id);
        assert_eq!(
            loaded.data.stat_positions["4key"][0].position.id,
            surviving_stat_id
        );
        assert!(crate::state::native_element_id::is_valid_element_id(
            &loaded.data.key_positions["4key"][original_position_len].id
        ));
        crate::state::native_element_id::validate_document_element_ids(
            &crate::models::EditorDocumentV1::from_store(&loaded.data),
        )
        .unwrap();
        let _ = std::fs::remove_file(path);
    }

    fn saved_plugin_instance_json(x: f64, instance_id: Option<&str>) -> serde_json::Value {
        let mut instance = serde_json::json!({
            "position": { "x": x, "y": 2.0 },
            "tabId": "4key"
        });
        if let Some(id) = instance_id {
            instance["instanceId"] = serde_json::json!(id);
        }
        instance
    }

    fn stored_plugin_instance_ids(data: &AppStoreData, plugin_id: &str) -> Vec<String> {
        data.plugin_data[&format!("plugin_data_{plugin_id}/instances")]
            .as_array()
            .unwrap()
            .iter()
            .map(|instance| instance["instanceId"].as_str().unwrap().to_string())
            .collect()
    }

    fn plugin_backfill_fixture_path(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "dmnote-plugin-instance-backfill-{label}-{}.json",
            uuid::Uuid::new_v4()
        ))
    }

    #[test]
    fn backfill_plugin_instances_assigns_unique_ids_and_reload_preserves_them() {
        let path = plugin_backfill_fixture_path("assign");
        let mut raw = serde_json::to_value(store_with_each_native_collection()).unwrap();
        let raw_object = raw.as_object_mut().unwrap();
        raw_object.insert(
            "plugin_data_alpha/instances".to_string(),
            serde_json::json!([
                saved_plugin_instance_json(1.0, None),
                saved_plugin_instance_json(2.0, None)
            ]),
        );
        raw_object.insert(
            "plugin_data_beta/instances".to_string(),
            serde_json::json!([saved_plugin_instance_json(3.0, None)]),
        );
        std::fs::write(&path, serde_json::to_vec_pretty(&raw).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        assert!(loaded.needs_persist);
        assert!(!loaded.repaired);
        let alpha_ids = stored_plugin_instance_ids(&loaded.data, "alpha");
        let beta_ids = stored_plugin_instance_ids(&loaded.data, "beta");
        let all_ids = alpha_ids.iter().chain(&beta_ids).collect::<Vec<_>>();
        assert_eq!(all_ids.len(), 3);
        assert!(all_ids
            .iter()
            .all(|id| crate::state::native_element_id::is_valid_element_id(id)));
        assert_eq!(
            all_ids
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len(),
            3
        );

        // 멱등: 영속 후 재로드에서 같은 ID 유지, 추가 변경 없음
        std::fs::write(&path, serde_json::to_vec_pretty(&loaded.data).unwrap()).unwrap();
        let reloaded = load_store_from_path(&path).unwrap();
        assert!(!reloaded.needs_persist);
        assert!(!reloaded.repaired);
        assert_eq!(
            stored_plugin_instance_ids(&reloaded.data, "alpha"),
            alpha_ids
        );
        assert_eq!(stored_plugin_instance_ids(&reloaded.data, "beta"), beta_ids);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn backfill_plugin_instances_preserves_existing_valid_ids() {
        let path = plugin_backfill_fixture_path("partial");
        let existing_id = uuid::Uuid::new_v4().to_string();
        let mut raw = serde_json::to_value(store_with_each_native_collection()).unwrap();
        raw.as_object_mut().unwrap().insert(
            "plugin_data_alpha/instances".to_string(),
            serde_json::json!([
                saved_plugin_instance_json(1.0, Some(&existing_id)),
                saved_plugin_instance_json(2.0, None)
            ]),
        );
        std::fs::write(&path, serde_json::to_vec_pretty(&raw).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        assert!(loaded.needs_persist);
        assert!(!loaded.repaired);
        let ids = stored_plugin_instance_ids(&loaded.data, "alpha");
        assert_eq!(ids[0], existing_id);
        assert_ne!(ids[1], existing_id);
        assert!(crate::state::native_element_id::is_valid_element_id(
            &ids[1]
        ));
        // 값 필드와 순서 보존
        let instances = loaded.data.plugin_data["plugin_data_alpha/instances"]
            .as_array()
            .unwrap();
        assert_eq!(instances[0]["position"]["x"], 1.0);
        assert_eq!(instances[1]["position"]["x"], 2.0);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn backfill_plugin_instances_reissues_invalid_ids_as_repair() {
        for invalid_id in ["not-a-uuid".to_string(), uuid::Uuid::nil().to_string()] {
            let path = plugin_backfill_fixture_path("invalid");
            let mut raw = serde_json::to_value(store_with_each_native_collection()).unwrap();
            raw.as_object_mut().unwrap().insert(
                "plugin_data_alpha/instances".to_string(),
                serde_json::json!([saved_plugin_instance_json(1.0, Some(&invalid_id))]),
            );
            std::fs::write(&path, serde_json::to_vec_pretty(&raw).unwrap()).unwrap();

            let loaded = load_store_from_path(&path).unwrap();
            assert!(loaded.needs_persist);
            assert!(loaded.repaired);
            let ids = stored_plugin_instance_ids(&loaded.data, "alpha");
            assert_ne!(ids[0], invalid_id);
            assert!(crate::state::native_element_id::is_valid_element_id(
                &ids[0]
            ));
            let _ = std::fs::remove_file(path);
        }
    }

    #[test]
    fn backfill_plugin_instances_repairs_in_plugin_duplicates_only() {
        let path = plugin_backfill_fixture_path("duplicate");
        let shared_id = uuid::Uuid::new_v4().to_string();
        let mut raw = serde_json::to_value(store_with_each_native_collection()).unwrap();
        let raw_object = raw.as_object_mut().unwrap();
        raw_object.insert(
            "plugin_data_alpha/instances".to_string(),
            serde_json::json!([
                saved_plugin_instance_json(1.0, Some(&shared_id)),
                saved_plugin_instance_json(2.0, Some(&shared_id))
            ]),
        );
        raw_object.insert(
            "plugin_data_beta/instances".to_string(),
            serde_json::json!([saved_plugin_instance_json(3.0, Some(&shared_id))]),
        );
        std::fs::write(&path, serde_json::to_vec_pretty(&raw).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        assert!(loaded.needs_persist);
        assert!(loaded.repaired);
        // 유일성은 커밋 검증과 같은 플러그인 키 단위 - alpha 내 중복만 수리,
        // 교차 중복인 beta[0]은 합법이라 보존
        let alpha_ids = stored_plugin_instance_ids(&loaded.data, "alpha");
        let beta_ids = stored_plugin_instance_ids(&loaded.data, "beta");
        assert_eq!(alpha_ids[0], shared_id);
        assert_ne!(alpha_ids[1], shared_id);
        assert!(crate::state::native_element_id::is_valid_element_id(
            &alpha_ids[1]
        ));
        assert_eq!(beta_ids, vec![shared_id]);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn backfill_plugin_instances_preserves_cross_plugin_duplicates_untouched() {
        let path = plugin_backfill_fixture_path("cross");
        let shared_id = uuid::Uuid::new_v4().to_string();
        let mut raw = serde_json::to_value(store_with_each_native_collection()).unwrap();
        let raw_object = raw.as_object_mut().unwrap();
        raw_object.insert(
            "plugin_data_alpha/instances".to_string(),
            serde_json::json!([saved_plugin_instance_json(1.0, Some(&shared_id))]),
        );
        raw_object.insert(
            "plugin_data_beta/instances".to_string(),
            serde_json::json!([saved_plugin_instance_json(2.0, Some(&shared_id))]),
        );
        std::fs::write(&path, serde_json::to_vec_pretty(&raw).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        // 교차 플러그인 중복만으로는 수리 대상이 아니다 - 불필요한 백업과
        // sweep 스킵을 유발하지 않게 무변경
        assert!(!loaded.needs_persist);
        assert!(!loaded.repaired);
        assert_eq!(
            stored_plugin_instance_ids(&loaded.data, "alpha"),
            vec![shared_id.clone()]
        );
        assert_eq!(
            stored_plugin_instance_ids(&loaded.data, "beta"),
            vec![shared_id]
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn backfill_plugin_instances_skips_undecodable_values_and_processes_the_rest() {
        let path = plugin_backfill_fixture_path("undecodable");
        let not_an_array = serde_json::json!({ "not": "array" });
        let unknown_field = serde_json::json!([{
            "position": { "x": 1.0, "y": 2.0 },
            "tabId": "4key",
            "handler": true
        }]);
        let mut raw = serde_json::to_value(store_with_each_native_collection()).unwrap();
        let raw_object = raw.as_object_mut().unwrap();
        raw_object.insert(
            "plugin_data_alpha/instances".to_string(),
            serde_json::json!([saved_plugin_instance_json(1.0, None)]),
        );
        raw_object.insert(
            "plugin_data_broken/instances".to_string(),
            not_an_array.clone(),
        );
        raw_object.insert(
            "plugin_data_weird/instances".to_string(),
            unknown_field.clone(),
        );
        std::fs::write(&path, serde_json::to_vec_pretty(&raw).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        assert!(loaded.needs_persist);
        assert!(!loaded.repaired);
        let alpha_ids = stored_plugin_instance_ids(&loaded.data, "alpha");
        assert!(crate::state::native_element_id::is_valid_element_id(
            &alpha_ids[0]
        ));
        // decode 불가 키는 원본 Value 그대로 보존 (런타임 read의 fail-closed에 위임)
        assert_eq!(
            loaded.data.plugin_data["plugin_data_broken/instances"],
            not_an_array
        );
        assert_eq!(
            loaded.data.plugin_data["plugin_data_weird/instances"],
            unknown_field
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn backfill_plugin_instances_runs_after_field_recovery() {
        let path = plugin_backfill_fixture_path("recovery");
        let mut raw = serde_json::to_value(store_with_each_native_collection()).unwrap();
        raw["statPositions"]["4key"][0]["dx"] = serde_json::json!("broken");
        raw.as_object_mut().unwrap().insert(
            "plugin_data_alpha/instances".to_string(),
            serde_json::json!([saved_plugin_instance_json(1.0, None)]),
        );
        std::fs::write(&path, serde_json::to_vec_pretty(&raw).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        assert!(loaded.needs_persist);
        assert!(loaded.repaired);
        let ids = stored_plugin_instance_ids(&loaded.data, "alpha");
        assert_eq!(ids.len(), 1);
        assert!(crate::state::native_element_id::is_valid_element_id(
            &ids[0]
        ));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn backfill_plugin_instances_leaves_empty_arrays_untouched() {
        let path = plugin_backfill_fixture_path("empty");
        let mut raw = serde_json::to_value(store_with_each_native_collection()).unwrap();
        raw.as_object_mut().unwrap().insert(
            "plugin_data_alpha/instances".to_string(),
            serde_json::json!([]),
        );
        std::fs::write(&path, serde_json::to_vec_pretty(&raw).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        assert!(!loaded.needs_persist);
        assert!(!loaded.repaired);
        assert_eq!(
            loaded.data.plugin_data["plugin_data_alpha/instances"],
            serde_json::json!([])
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn legacy_panel_detach_setting_is_removed_without_touching_plugin_data() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-panel-detach-setting-migration-{}.json",
            uuid::Uuid::new_v4()
        ));
        let data = normalize_state(AppStoreData {
            keys: default_keys().clone(),
            key_positions: default_positions().clone(),
            ..AppStoreData::default()
        });
        let mut raw = serde_json::to_value(data).unwrap();
        let raw_object = raw.as_object_mut().unwrap();
        raw_object.insert(
            LEGACY_PANEL_DETACH_ENABLED_KEY.to_string(),
            serde_json::json!(false),
        );
        raw_object.insert(
            "plugin_data_fixture/settings".to_string(),
            serde_json::json!({ "kept": true }),
        );
        std::fs::write(&path, serde_json::to_vec_pretty(&raw).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        assert!(loaded.needs_persist);
        assert!(!loaded.repaired);
        assert!(!loaded
            .data
            .plugin_data
            .contains_key(LEGACY_PANEL_DETACH_ENABLED_KEY));
        assert_eq!(
            loaded.data.plugin_data["plugin_data_fixture/settings"]["kept"],
            true
        );

        std::fs::write(&path, serde_json::to_vec_pretty(&loaded.data).unwrap()).unwrap();
        let reloaded = load_store_from_path(&path).unwrap();
        assert!(!reloaded.needs_persist);
        assert!(!reloaded.repaired);
        assert!(!reloaded
            .data
            .plugin_data
            .contains_key(LEGACY_PANEL_DETACH_ENABLED_KEY));
        assert_eq!(
            reloaded.data.plugin_data["plugin_data_fixture/settings"]["kept"],
            true
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn legacy_store_without_gradient_fields_preserves_position_bytes() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-no-gradient-byte-round-trip-{}.json",
            uuid::Uuid::new_v4()
        ));
        let data = normalize_state(AppStoreData {
            keys: default_keys().clone(),
            key_positions: default_positions().clone(),
            ..AppStoreData::default()
        });
        let original_position = data.key_positions["4key"][0].clone();
        let original = serde_json::to_vec_pretty(&data).unwrap();
        assert!(!String::from_utf8_lossy(&original).contains("Gradient"));
        std::fs::write(&path, &original).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        let mut reloaded_position = loaded.data.key_positions["4key"][0].clone();
        reloaded_position.id.clear();

        assert!(loaded.needs_persist);
        assert!(!loaded.repaired);
        assert_eq!(reloaded_position, original_position);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn noncanonical_gradient_store_repersist_and_reload_is_idempotent() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-gradient-canonical-reload-{}.json",
            uuid::Uuid::new_v4()
        ));
        let data = normalize_state(AppStoreData {
            keys: default_keys().clone(),
            key_positions: default_positions().clone(),
            ..AppStoreData::default()
        });
        let mut raw = serde_json::to_value(data).unwrap();
        let position = &mut raw["keyPositions"]["4key"][0];
        position["backgroundColor"] = serde_json::json!("#BADBAD");
        position["backgroundGradient"] = serde_json::json!({
            "type": "linear",
            "angle": 450,
            "stops": [
                { "color": "rgba(90, 162, 247, 1)", "pos": 1.4 },
                { "color": "rgba(139, 92, 246, 1)", "pos": -0.2 }
            ]
        });
        position["counter"]["fill"]["idle"] = serde_json::json!("#FFFFFF");
        position["counter"]["fillIdleGradient"] = serde_json::json!({
            "stops": [
                { "color": "#FFFFFF", "pos": 0 },
                { "color": "#000000", "pos": 1 }
            ]
        });
        std::fs::write(&path, serde_json::to_vec_pretty(&raw).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        let position = &loaded.data.key_positions["4key"][0];
        assert!(loaded.needs_persist);
        assert!(loaded.repaired);
        assert_eq!(
            position.background_color.as_deref(),
            Some("rgba(139, 92, 246, 1)")
        );
        assert_eq!(position.background_gradient.as_ref().unwrap().angle, 90.0);
        assert_eq!(
            position.background_gradient.as_ref().unwrap().stops[0].pos,
            0.0
        );
        assert_eq!(position.counter.fill.idle, "rgba(255,255,255,1)");

        std::fs::write(&path, serde_json::to_vec_pretty(&loaded.data).unwrap()).unwrap();
        let reloaded = load_store_from_path(&path).unwrap();
        assert!(!reloaded.needs_persist);
        assert!(!reloaded.repaired);
        assert_eq!(reloaded.data, loaded.data);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn invalid_counter_gradient_children_recover_without_losing_counter_siblings() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-counter-gradient-child-recovery-{}.json",
            uuid::Uuid::new_v4()
        ));
        let mut key_position = default_positions()["4key"][0].clone();
        key_position.counter.enabled = false;
        key_position.counter.placement = KeyCounterPlacement::Outside;
        key_position.counter.align = KeyCounterAlign::Left;
        key_position.counter.align_mode = KeyCounterAlignMode::Between;
        key_position.counter.fill = KeyCounterColor {
            idle: "#112233".to_string(),
            active: "#445566".to_string(),
        };
        key_position.counter.stroke = KeyCounterColor {
            idle: "#778899".to_string(),
            active: "#AABBCC".to_string(),
        };
        key_position.counter.gap = 17;
        key_position.counter.font_size = 33;
        key_position.counter.font_weight = 600;
        key_position.counter.font_family = Some("Recovery Font".to_string());
        key_position.counter.font_italic = true;
        key_position.counter.font_underline = true;
        key_position.counter.font_strikethrough = true;
        key_position.counter.animation.enabled = true;
        key_position.counter.animation.preset_id = Some("custom-recovery".to_string());
        key_position.counter.animation.bezier = [0.1, 0.2, 0.7, 0.8];
        key_position.counter.animation.scale = 1.25;
        key_position.counter.animation.duration_ms = 777;
        let expected_key_counter = key_position.counter.clone();

        let mut stat_position = StatPosition {
            stat_type: StatType::Kps,
            position: key_position.clone(),
        };
        stat_position.position.counter.fill.idle = "#ABCDEF".to_string();
        let expected_stat_counter = stat_position.position.counter.clone();

        let mut data = normalize_state(AppStoreData {
            keys: default_keys().clone(),
            key_positions: default_positions().clone(),
            ..AppStoreData::default()
        });
        data.key_positions.get_mut("4key").unwrap()[0] = key_position;
        data.stat_positions
            .insert("4key".to_string(), vec![stat_position]);
        let mut raw = serde_json::to_value(data).unwrap();
        raw["keyPositions"]["4key"][0]["counter"]["fillIdleGradient"] = serde_json::json!({
            "angle": 90,
            "stops": [{ "color": "#FFFFFF", "pos": 0 }]
        });
        raw["statPositions"]["4key"][0]["counter"]["fillActiveGradient"] = serde_json::json!({
            "angle": 90,
            "stops": [{ "color": "#000000", "pos": 1 }]
        });
        std::fs::write(&path, serde_json::to_vec_pretty(&raw).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        let key_counter = &loaded.data.key_positions["4key"][0].counter;
        let stat_counter = &loaded.data.stat_positions["4key"][0].position.counter;

        assert!(loaded.needs_persist);
        assert!(loaded.repaired);
        assert_eq!(key_counter, &expected_key_counter);
        assert_eq!(stat_counter, &expected_stat_counter);
        assert!(key_counter.fill_idle_gradient.is_none());
        assert!(stat_counter.fill_active_gradient.is_none());
        let _ = std::fs::remove_file(path);
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct HistoricalTauri13Store {
        #[serde(default)]
        keys: std::collections::HashMap<String, Vec<String>>,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct HistoricalTauri14PlusStore {
        #[serde(default)]
        keys: std::collections::HashMap<String, Vec<String>>,
        #[serde(default, flatten)]
        plugin_data: std::collections::HashMap<String, serde_json::Value>,
    }

    #[test]
    fn tauri_era_store_schema_transitions_preserve_editor_data() {
        let v1_3 = tauri_store_fixture_base();

        let mut v1_4 = tauri_store_fixture_base();
        v1_4.as_object_mut().unwrap().extend([
            ("developerModeEnabled".to_string(), serde_json::json!(true)),
            ("tabCssOverrides".to_string(), serde_json::json!({})),
            ("useCustomJs".to_string(), serde_json::json!(true)),
            (
                "customJs".to_string(),
                serde_json::json!({ "path": null, "content": "void 0" }),
            ),
            (
                "plugin:fixture".to_string(),
                serde_json::json!({ "kept": true }),
            ),
        ]);

        let mut v1_5 = v1_4.clone();
        v1_5.as_object_mut().unwrap().extend([
            (
                "statPositions".to_string(),
                serde_json::json!({
                    "fixture-tab": [{
                        "statType": "kps",
                        "dx": 80.0,
                        "dy": 14.0,
                        "width": 80.0,
                        "height": 40.0,
                        "activeImage": "",
                        "inactiveImage": "",
                        "count": 0,
                        "noteColor": "#FFFFFF",
                        "noteOpacity": 80
                    }]
                }),
            ),
            (
                "fontSettings".to_string(),
                serde_json::json!({ "customFonts": [] }),
            ),
            ("gridSettings".to_string(), serde_json::json!({})),
            ("shortcuts".to_string(), serde_json::json!({})),
        ]);

        let mut v1_6 = v1_5.clone();
        v1_6["keyPositions"]["fixture-tab"][0]["groupId"] = serde_json::json!("fixture-group");
        v1_6.as_object_mut().unwrap().extend([
            (
                "graphPositions".to_string(),
                serde_json::json!({
                    "fixture-tab": [{
                        "statType": "kpsAvg",
                        "graphType": "line",
                        "graphSpeed": 1000,
                        "graphColor": "#24BBB4",
                        "showAvgLine": true,
                        "dx": 170.0,
                        "dy": 14.0,
                        "width": 160.0,
                        "height": 80.0,
                        "activeImage": "",
                        "inactiveImage": "",
                        "count": 0,
                        "noteColor": "#FFFFFF",
                        "noteOpacity": 80
                    }]
                }),
            ),
            (
                "layerGroups".to_string(),
                serde_json::json!({
                    "fixture-tab": [{ "id": "fixture-group", "name": "Fixture group" }]
                }),
            ),
            ("counterAnimationPresets".to_string(), serde_json::json!([])),
            ("tabNoteOverrides".to_string(), serde_json::json!({})),
            ("soundLibrary".to_string(), serde_json::json!({})),
            ("obsModeEnabled".to_string(), serde_json::json!(false)),
            ("obsPort".to_string(), serde_json::json!(34891)),
            ("obsToken".to_string(), serde_json::Value::Null),
        ]);

        let mut v1_6_1 = v1_6.clone();
        v1_6_1.as_object_mut().unwrap().extend([
            (
                "knobPositions".to_string(),
                serde_json::json!({
                    "fixture-tab": [{
                        "axisId": "axis-x",
                        "sensitivity": 1.0,
                        "reverse": false,
                        "dx": 340.0,
                        "dy": 14.0,
                        "width": 80.0,
                        "height": 80.0,
                        "activeImage": "",
                        "inactiveImage": "",
                        "count": 0,
                        "noteColor": "#FFFFFF",
                        "noteOpacity": 80
                    }]
                }),
            ),
            ("keySoundOutputBackend".to_string(), serde_json::Value::Null),
        ]);

        for (version, fixture) in [
            ("1.3.0", v1_3),
            ("1.4.0", v1_4),
            ("1.5.1", v1_5),
            ("1.6.0", v1_6),
            ("1.6.1", v1_6_1),
        ] {
            let loaded = load_literal_fixture(version, &fixture);
            assert_eq!(loaded.editor_revision, 0, "{version}");
            assert_eq!(
                loaded.keys["fixture-tab"],
                vec![KeySlot::from("F13")],
                "{version}"
            );
            assert_eq!(loaded.key_positions["fixture-tab"][0].dx, 13.0, "{version}");
            assert_eq!(loaded.key_counters["fixture-tab"]["F13"], 17, "{version}");

            if version >= "1.4.0" {
                assert_eq!(loaded.plugin_data["plugin:fixture"]["kept"], true);
            }
            if version >= "1.5.1" {
                assert_eq!(loaded.stat_positions["fixture-tab"].len(), 1);
            }
            if version >= "1.6.0" {
                assert_eq!(loaded.graph_positions["fixture-tab"].len(), 1);
                assert_eq!(loaded.layer_groups["fixture-tab"][0].id, "fixture-group");
            }
            if version >= "1.6.1" {
                assert_eq!(loaded.knob_positions["fixture-tab"].len(), 1);
            }
        }
    }

    #[test]
    fn reverse_downgrade_models_document_unknown_revision_behavior() {
        let fixture = serde_json::json!({
            "keys": { "4key": ["Q"] },
            "editorRevision": 23
        });

        let v1_3: HistoricalTauri13Store = serde_json::from_value(fixture.clone()).unwrap();
        let v1_3_resaved = serde_json::to_value(v1_3).unwrap();
        assert!(v1_3_resaved.get("editorRevision").is_none());

        let mut v1_4_plus: HistoricalTauri14PlusStore = serde_json::from_value(fixture).unwrap();
        assert_eq!(v1_4_plus.plugin_data["editorRevision"], 23);
        let preserved = serde_json::to_value(&v1_4_plus).unwrap();
        assert_eq!(preserved["editorRevision"], 23);

        v1_4_plus.plugin_data.clear();
        let cleared = serde_json::to_value(v1_4_plus).unwrap();
        assert!(cleared.get("editorRevision").is_none());
    }

    // master(구버전) recover_key_mapping_entries의 동결 사본: 문자열이 아닌
    // 항목을 제자리 빈 문자열로 대체 (구버전 복구 동작, 2026-08 기준)
    fn frozen_legacy_recover_keys(entries: &serde_json::Value) -> Vec<String> {
        entries
            .as_array()
            .expect("keys mode must be an array")
            .iter()
            .map(|entry| entry.as_str().unwrap_or("").to_string())
            .collect()
    }

    #[test]
    fn downgrade_recovery_replaces_multi_slots_in_place_without_compaction() {
        // 신버전이 직렬화한 keys 와이어 형식이 구버전 복구에서 어떻게 열화되는지 고정
        let slots = vec![
            KeySlot::from("Q"),
            KeySlot::Multi {
                keys: vec!["A".to_string(), "B".to_string()],
                match_mode: SlotMatch::Any,
            },
            KeySlot::from("C"),
            KeySlot::Multi {
                keys: vec!["LEFT CTRL".to_string(), "Z".to_string()],
                match_mode: SlotMatch::All,
            },
            KeySlot::default(),
        ];
        let wire = serde_json::to_value(&slots).unwrap();

        let recovered = frozen_legacy_recover_keys(&wire);

        // 배열 길이 보존(keyPositions 인덱스 결합 불변식), Multi만 제자리 "" 대체
        assert_eq!(
            recovered,
            vec![
                "Q".to_string(),
                String::new(),
                "C".to_string(),
                String::new(),
                String::new(),
            ]
        );
    }

    #[test]
    fn reverse_downgrade_multi_key_fixture_enters_legacy_recovery_path() {
        let fixture = serde_json::json!({
            "keys": {
                "4key": [
                    { "keys": ["A", "B"], "match": "any" },
                    "C"
                ]
            }
        });

        assert!(serde_json::from_value::<HistoricalTauri13Store>(fixture.clone()).is_err());
        assert!(serde_json::from_value::<HistoricalTauri14PlusStore>(fixture).is_err());
    }

    #[test]
    fn key_mapping_recovery_normalizes_in_place_without_compacting_slots() {
        let raw = serde_json::json!({
            "mode": [
                { "keys": ["A", "B"], "match": "any" },
                { "keys": ["Z"], "match": "all" },
                { "keys": ["A", 7, "A", "B+C", "C"], "match": "all" },
                { "keys": ["A", "B"] },
                null
            ]
        });

        let recovered = recover_key_mapping_entries(&raw).unwrap();
        let mappings: KeyMappings = serde_json::from_value(recovered).unwrap();

        assert_eq!(mappings["mode"].len(), 5);
        assert_eq!(
            mappings["mode"],
            vec![
                KeySlot::Multi {
                    keys: vec!["A".to_string(), "B".to_string()],
                    match_mode: SlotMatch::Any,
                },
                KeySlot::Single("Z".to_string()),
                KeySlot::Multi {
                    keys: vec!["A".to_string(), "C".to_string()],
                    match_mode: SlotMatch::All,
                },
                KeySlot::default(),
                KeySlot::default(),
            ]
        );
    }

    #[test]
    fn normalize_state_keeps_single_count_and_separates_any_all_counters() {
        let keys = vec![
            KeySlot::Single("A".to_string()),
            KeySlot::Multi {
                keys: vec!["A".to_string(), "B".to_string()],
                match_mode: SlotMatch::Any,
            },
            KeySlot::Multi {
                keys: vec!["A".to_string(), "B".to_string()],
                match_mode: SlotMatch::All,
            },
        ];
        let data = normalize_state(AppStoreData {
            keys: KeyMappings::from([("4key".to_string(), keys)]),
            key_positions: crate::models::KeyPositions::from([(
                "4key".to_string(),
                vec![KeyPosition::default(); 3],
            )]),
            key_counters: crate::models::KeyCounters::from([(
                "4key".to_string(),
                std::collections::HashMap::from([
                    ("A".to_string(), 9),
                    ("A|B".to_string(), 4),
                    ("stale".to_string(), 7),
                ]),
            )]),
            ..AppStoreData::default()
        });

        assert_eq!(data.key_counters["4key"]["A"], 9);
        assert_eq!(data.key_counters["4key"]["A|B"], 4);
        assert_eq!(data.key_counters["4key"]["A+B"], 0);
        assert!(!data.key_counters["4key"].contains_key("stale"));
    }

    #[test]
    fn load_repairs_unsafe_editor_revision_without_touching_editor_data() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-unsafe-editor-revision-{}.json",
            uuid::Uuid::new_v4()
        ));
        let mut data = normalize_state(AppStoreData {
            keys: default_keys().clone(),
            key_positions: default_positions().clone(),
            ..AppStoreData::default()
        });
        data.editor_revision = crate::state::editor::MAX_SAFE_WIRE_REVISION + 1;
        data.key_positions.get_mut("4key").unwrap()[0].dx = 12_345.0;
        crate::state::native_element_id::backfill_store_element_ids(&mut data);
        let expected_keys = data.keys.clone();
        let expected_positions = data.key_positions.clone();
        std::fs::write(&path, serde_json::to_vec_pretty(&data).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();

        assert_eq!(loaded.data.editor_revision, 0);
        assert_eq!(loaded.data.keys, expected_keys);
        assert_eq!(loaded.data.key_positions, expected_positions);
        assert!(loaded.needs_persist);
        assert!(loaded.repaired);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn load_preserves_max_safe_editor_revision() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-max-safe-editor-revision-{}.json",
            uuid::Uuid::new_v4()
        ));
        let mut data = normalize_state(AppStoreData {
            keys: default_keys().clone(),
            key_positions: default_positions().clone(),
            ..AppStoreData::default()
        });
        data.editor_revision = crate::state::editor::MAX_SAFE_WIRE_REVISION;
        std::fs::write(&path, serde_json::to_vec_pretty(&data).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();

        assert_eq!(
            loaded.data.editor_revision,
            crate::state::editor::MAX_SAFE_WIRE_REVISION
        );
        assert!(!loaded.repaired);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn clear_dangling_group_ids_removes_ghosts_and_keeps_valid_ones() {
        let mut data = AppStoreData::default();
        let mut positions = default_positions().clone();
        if let Some(list) = positions.get_mut("4key") {
            list[0].group_id = Some("ghost-group".to_string());
            list[1].group_id = Some("real-group".to_string());
        }
        data.key_positions = positions;
        data.layer_groups.insert(
            "4key".to_string(),
            vec![LayerGroupDef {
                id: "real-group".to_string(),
                name: "Group".to_string(),
            }],
        );

        assert!(super::clear_dangling_group_ids(&mut data));
        let list = &data.key_positions["4key"];
        assert_eq!(list[0].group_id, None);
        assert_eq!(list[1].group_id.as_deref(), Some("real-group"));

        // 정리할 것이 없으면 변경 없음을 보고 (로드 시 불필요한 재저장 방지)
        assert!(!super::clear_dangling_group_ids(&mut data));
    }

    // 부분 저장(update_*)은 positions 먼저 → layerGroups 나중 순서로 들어오므로
    // normalize_state가 중간 상태의 신규 groupId를 지워선 안 됨
    #[test]
    fn normalize_state_preserves_group_ids_saved_before_group_definitions() {
        let mut data = AppStoreData::default();
        let mut positions = default_positions().clone();
        if let Some(list) = positions.get_mut("4key") {
            list[0].group_id = Some("group-created-just-now".to_string());
        }
        data.key_positions = positions;
        // layerGroups 정의는 아직 저장 전 (다음 커맨드에서 도착)

        let normalized = normalize_state(data);
        assert_eq!(
            normalized.key_positions["4key"][0].group_id.as_deref(),
            Some("group-created-just-now")
        );
    }

    #[test]
    fn load_clears_dangling_group_ids_from_disk() {
        let dir =
            std::env::temp_dir().join(format!("dmnote-dangling-load-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("store.json");

        let mut data = AppStoreData::default();
        let mut positions = default_positions().clone();
        if let Some(list) = positions.get_mut("4key") {
            list[0].group_id = Some("ghost-group".to_string());
        }
        data.key_positions = positions;
        std::fs::write(&path, serde_json::to_vec_pretty(&data).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        assert_eq!(loaded.data.key_positions["4key"][0].group_id, None);
        // 정리 결과가 디스크에도 영속되도록 재저장 필요 플래그가 올라가야 함
        assert!(loaded.needs_persist);

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn load_pads_every_key_position_length_mismatch_without_compaction() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-key-position-length-load-{}.json",
            uuid::Uuid::new_v4()
        ));
        let mut data = AppStoreData {
            keys: default_keys().clone(),
            key_positions: default_positions().clone(),
            ..AppStoreData::default()
        };
        data.keys.get_mut("4key").unwrap().push("F5".into());
        let preserved_position = KeyPosition {
            dx: 987.0,
            ..KeyPosition::default()
        };
        data.key_positions
            .get_mut("5key")
            .unwrap()
            .push(preserved_position.clone());
        data.keys
            .insert("keys-only".to_string(), vec!["A".into(), "B".into()]);
        data.key_positions.insert(
            "positions-only".to_string(),
            vec![preserved_position.clone()],
        );
        crate::state::native_element_id::backfill_store_element_ids(&mut data);
        let preserved_position = data.key_positions["5key"].last().unwrap().clone();
        std::fs::write(&path, serde_json::to_vec_pretty(&data).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        assert!(!loaded.repaired);
        assert!(loaded.needs_persist);
        assert_eq!(
            loaded.data.keys["4key"].last().unwrap(),
            &KeySlot::from("F5")
        );
        let padded_position = loaded.data.key_positions["4key"].last().unwrap();
        assert!(crate::state::native_element_id::is_valid_element_id(
            &padded_position.id
        ));
        let mut padded_without_id = padded_position.clone();
        padded_without_id.id.clear();
        assert_eq!(padded_without_id, KeyPosition::default());
        assert_eq!(
            loaded.data.key_positions["5key"].last().unwrap(),
            &preserved_position
        );
        assert!(loaded.data.keys["5key"].last().unwrap().is_unassigned());
        assert_eq!(loaded.data.key_positions["keys-only"].len(), 2);
        assert_eq!(loaded.data.keys["positions-only"], vec![KeySlot::default()]);

        let modes = loaded
            .data
            .keys
            .keys()
            .chain(loaded.data.key_positions.keys())
            .collect::<std::collections::HashSet<_>>();
        for mode in modes {
            assert_eq!(
                loaded.data.keys.get(mode).map_or(0, Vec::len),
                loaded.data.key_positions.get(mode).map_or(0, Vec::len),
                "mode {mode}"
            );
        }

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn normal_load_preserves_unbound_knobs_while_repairing_invalid_fonts() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-semantic-identity-load-{}.json",
            uuid::Uuid::new_v4()
        ));
        let mut data = AppStoreData::default();
        data.font_settings.custom_fonts = vec![
            CustomFont {
                id: "   ".to_string(),
                font_type: FontType::Web,
                name: "Invalid Font".to_string(),
                display_name: "Invalid Font".to_string(),
                enabled: true,
                local_path: None,
                css_content: Some("@font-face {}".to_string()),
            },
            CustomFont {
                id: "local-font".to_string(),
                font_type: FontType::Local,
                name: "Local Font".to_string(),
                display_name: "Local Font".to_string(),
                enabled: true,
                local_path: Some("relative/font.ttf".to_string()),
                css_content: None,
            },
        ];
        data.knob_positions.insert(
            "4key".to_string(),
            vec![
                KnobPosition {
                    axis_id: String::new(),
                    sensitivity: 1.0,
                    reverse: false,
                    position: default_positions()["4key"][0].clone(),
                },
                KnobPosition {
                    axis_id: "axis-valid".to_string(),
                    sensitivity: 1.0,
                    reverse: false,
                    position: default_positions()["4key"][1].clone(),
                },
            ],
        );
        std::fs::write(&path, serde_json::to_vec_pretty(&data).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();

        assert!(loaded.repaired);
        assert!(loaded.needs_persist);
        assert_eq!(loaded.data.font_settings.custom_fonts.len(), 1);
        let local = &loaded.data.font_settings.custom_fonts[0];
        assert_eq!(local.id, "local-font");
        assert!(!local.enabled);
        assert_eq!(local.local_path, None);
        assert_eq!(loaded.data.knob_positions["4key"].len(), 2);
        assert!(loaded.data.knob_positions["4key"][0].axis_id.is_empty());
        assert_eq!(loaded.data.knob_positions["4key"][1].axis_id, "axis-valid");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn unbound_knob_survives_load_normalize_and_resave() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-unbound-knob-roundtrip-{}.json",
            uuid::Uuid::new_v4()
        ));
        let mut data = AppStoreData {
            keys: default_keys().clone(),
            key_positions: default_positions().clone(),
            ..AppStoreData::default()
        };
        data.knob_positions.insert(
            "4key".to_string(),
            vec![KnobPosition {
                axis_id: String::new(),
                sensitivity: 1.0,
                reverse: false,
                position: default_positions()["4key"][0].clone(),
            }],
        );
        std::fs::write(&path, serde_json::to_vec_pretty(&data).unwrap()).unwrap();

        let first = load_store_from_path(&path).unwrap();
        assert!(!first.repaired);
        assert!(first.data.knob_positions["4key"][0].axis_id.is_empty());

        let normalized = normalize_state(first.data);
        std::fs::write(&path, serde_json::to_vec_pretty(&normalized).unwrap()).unwrap();
        let second = load_store_from_path(&path).unwrap();
        assert!(!second.repaired);
        assert_eq!(second.data.knob_positions["4key"].len(), 1);
        assert!(second.data.knob_positions["4key"][0].axis_id.is_empty());

        let _ = std::fs::remove_file(path);
    }
    use serde_json::{json, Value};

    const TEST_SOUND_PATH: &str = "/tmp/test-sound.wav";

    fn load_store_with_sound_entry(entry: Value) -> (AppStoreData, bool) {
        let path = std::env::temp_dir().join(format!(
            "dmnote-sound-migration-test-{}.json",
            uuid::Uuid::new_v4()
        ));
        let mut data = normalize_state(AppStoreData::default());
        crate::state::native_element_id::backfill_store_element_ids(&mut data);
        let mut value = serde_json::to_value(data).unwrap();
        value.as_object_mut().unwrap().insert(
            "soundLibrary".to_string(),
            json!({ TEST_SOUND_PATH: entry }),
        );
        std::fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        let _ = std::fs::remove_file(path);
        (loaded.data, loaded.needs_persist)
    }

    #[test]
    fn sound_library_enabled_false_migrates_to_hidden_true() {
        let mut value = json!({
            "soundLibrary": {
                TEST_SOUND_PATH: { "enabled": false }
            }
        });
        assert!(migrate_sound_library_enabled(&mut value));
        let entry = &value["soundLibrary"][TEST_SOUND_PATH];
        assert_eq!(entry["hidden"], true);
        assert!(entry.get("enabled").is_none());

        let (data, needs_persist) = load_store_with_sound_entry(json!({ "enabled": false }));
        assert!(data.sound_library[TEST_SOUND_PATH].hidden);
        assert!(needs_persist);
    }

    #[test]
    fn sound_library_enabled_true_migrates_to_hidden_false() {
        let (data, needs_persist) = load_store_with_sound_entry(json!({ "enabled": true }));
        assert!(!data.sound_library[TEST_SOUND_PATH].hidden);
        assert!(needs_persist);
    }

    #[test]
    fn sound_library_without_enabled_is_unchanged() {
        let mut value = json!({
            "soundLibrary": {
                TEST_SOUND_PATH: { "source": "local" }
            }
        });
        let original = value.clone();
        assert!(!migrate_sound_library_enabled(&mut value));
        assert_eq!(value, original);

        let (data, needs_persist) = load_store_with_sound_entry(json!({ "source": "local" }));
        assert!(!data.sound_library[TEST_SOUND_PATH].hidden);
        assert!(!needs_persist);
    }

    #[test]
    fn sound_library_hidden_takes_precedence_over_enabled() {
        let mut value = json!({
            "soundLibrary": {
                TEST_SOUND_PATH: { "hidden": false, "enabled": false }
            }
        });
        assert!(migrate_sound_library_enabled(&mut value));
        let entry = &value["soundLibrary"][TEST_SOUND_PATH];
        assert_eq!(entry["hidden"], false);
        assert!(entry.get("enabled").is_none());

        let (data, needs_persist) =
            load_store_with_sound_entry(json!({ "hidden": false, "enabled": false }));
        assert!(!data.sound_library[TEST_SOUND_PATH].hidden);
        assert!(needs_persist);
    }

    #[test]
    fn rgba_to_hex_converts_and_drops_alpha() {
        assert_eq!(
            rgba_to_hex("rgba(255, 0, 167, 1)").as_deref(),
            Some("#FF00A7")
        );
        assert_eq!(
            rgba_to_hex("rgba(18, 52, 86, 0)").as_deref(),
            Some("#123456")
        );
    }

    #[test]
    fn rgba_to_hex_ignores_non_rgba() {
        assert_eq!(rgba_to_hex("#FF00A7"), None);
        assert_eq!(rgba_to_hex("garbage"), None);
        assert_eq!(rgba_to_hex("rgba(300, 0, 0, 1)"), None); // u8 범위 초과
    }

    #[test]
    fn invalid_field_recovery_preserves_every_other_store_field() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-field-recovery-test-{}.json",
            uuid::Uuid::new_v4()
        ));
        let mut expected = AppStoreData {
            hardware_acceleration: false,
            always_on_top: false,
            overlay_bounds: Some(OverlayBounds {
                x: 11.0,
                y: 22.0,
                width: 933.0,
                height: 411.0,
            }),
            obs_mode_enabled: true,
            obs_port: 18_321,
            obs_token: Some("obs-token-sentinel".to_string()),
            ..AppStoreData::default()
        };
        expected.layer_groups.insert(
            "4key".to_string(),
            vec![LayerGroupDef {
                id: "layer-group-sentinel".to_string(),
                name: "Layer Group".to_string(),
            }],
        );
        expected.plugin_data.insert(
            "pluginData".to_string(),
            json!({ "sentinel": "plugin-data" }),
        );
        expected.plugin_data.insert(
            "obsSettings".to_string(),
            json!({ "sentinel": "obs-settings" }),
        );
        expected.grid_settings.grid_snap_size = 9;
        expected.knob_positions.insert(
            "4key".to_string(),
            vec![KnobPosition {
                axis_id: "knob-axis-sentinel".to_string(),
                sensitivity: 2.5,
                reverse: true,
                position: default_positions()["4key"][0].clone(),
            }],
        );
        expected.font_settings.custom_fonts.push(CustomFont {
            id: "custom-font-sentinel".to_string(),
            font_type: FontType::Web,
            name: "Custom Font".to_string(),
            display_name: "Custom Font".to_string(),
            enabled: true,
            local_path: None,
            css_content: Some("@font-face { font-family: Custom; }".to_string()),
        });
        expected.tab_css_overrides.insert(
            "custom-tab".to_string(),
            TabCss {
                path: Some("/tmp/custom-tab.css".to_string()),
                content: ".sentinel { color: red; }".to_string(),
                enabled: true,
            },
        );
        expected.tab_note_overrides.insert(
            "custom-tab".to_string(),
            TabNoteSettings {
                speed: Some(987),
                ..TabNoteSettings::default()
            },
        );
        expected.shortcuts.toggle_always_on_top.key = "F12".to_string();
        expected.sound_library.insert(
            "/tmp/sound-sentinel.wav".to_string(),
            SoundLibraryEntry {
                display_name: Some("Sound Sentinel".to_string()),
                ..SoundLibraryEntry::default()
            },
        );

        let mut fixture = serde_json::to_value(&expected).unwrap();
        assert!(serde_json::from_value::<AppStoreData>(fixture.clone()).is_ok());
        fixture.as_object_mut().unwrap().insert(
            "alwaysOnTop".to_string(),
            Value::String("invalid".to_string()),
        );
        std::fs::write(&path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        let _ = std::fs::remove_file(path);

        expected.always_on_top = AppStoreData::default().always_on_top;
        expected = normalize_state(expected);
        assert!(loaded.repaired);
        assert!(loaded.needs_persist);
        let mut actual_value = serde_json::to_value(&loaded.data).unwrap();
        let mut expected_value = serde_json::to_value(&expected).unwrap();
        remove_all_native_ids(&mut actual_value);
        remove_all_native_ids(&mut expected_value);
        assert_eq!(actual_value, expected_value);
    }

    #[test]
    fn electron_1_2_store_preserves_tabs_keys_settings_and_window_position() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-electron-1-2-store-test-{}.json",
            uuid::Uuid::new_v4()
        ));
        let fixture = json!({
            "hardwareAcceleration": false,
            "alwaysOnTop": false,
            "overlayLocked": true,
            "noteEffect": true,
            "noteSettings": {
                "borderRadius": 7,
                "speed": 321,
                "trackHeight": 123,
                "reverse": true,
                "fadePosition": "bottom",
                "delayedNoteEnabled": true,
                "shortNoteThresholdMs": 67,
                "shortNoteMinLengthPx": 43
            },
            "selectedKeyType": "legacy-tab",
            "customTabs": [{ "id": "legacy-tab", "name": "Legacy tab" }],
            "angleMode": "d3d11",
            "language": "en",
            "laboratoryEnabled": true,
            "keys": { "legacy-tab": ["A", "B"] },
            "keyPositions": {
                "legacy-tab": [
                    {
                        "dx": 777,
                        "dy": 88,
                        "width": 60,
                        "height": 60,
                        "activeImage": "",
                        "inactiveImage": "",
                        "count": 42,
                        "noteColor": "#ABCDEF",
                        "noteOpacity": 73
                    },
                    {
                        "dx": 888,
                        "dy": 99,
                        "width": 75,
                        "height": 65,
                        "activeImage": "",
                        "inactiveImage": "",
                        "count": 24,
                        "noteColor": "#FEDCBA",
                        "noteOpacity": 64
                    }
                ]
            },
            "backgroundColor": "#123456",
            "useCustomCSS": true,
            "customCSS": { "path": "/tmp/legacy.css", "content": ".legacy {}" },
            "overlayWindowPosition": { "x": 17, "y": 29 }
        });
        std::fs::write(&path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        let _ = std::fs::remove_file(path);

        assert!(loaded.repaired);
        assert_eq!(loaded.data.selected_key_type, "legacy-tab");
        assert_eq!(
            loaded.data.custom_tabs,
            vec![CustomTab {
                id: "legacy-tab".to_string(),
                name: "Legacy tab".to_string(),
            }]
        );
        assert_eq!(
            loaded.data.keys["legacy-tab"],
            vec![KeySlot::from("A"), KeySlot::from("B")]
        );
        assert_eq!(loaded.data.key_positions["legacy-tab"].len(), 2);
        assert_eq!(loaded.data.key_positions["legacy-tab"][0].dx, 777.0);
        assert_eq!(loaded.data.key_positions["legacy-tab"][1].dx, 888.0);
        assert_eq!(loaded.data.note_settings.speed, 321);
        assert_eq!(loaded.data.note_settings.track_height, 123);
        assert!(loaded.data.note_settings.reverse);
        assert!(loaded.data.use_custom_css);
        assert_eq!(
            loaded.data.custom_css.path.as_deref(),
            Some("/tmp/legacy.css")
        );
        assert_eq!(loaded.data.background_color, "#123456");
        assert_eq!(
            loaded.data.overlay_bounds,
            Some(OverlayBounds {
                x: 17.0,
                y: 29.0,
                width: LEGACY_OVERLAY_WIDTH,
                height: LEGACY_OVERLAY_HEIGHT,
            })
        );
    }

    #[test]
    fn tauri_1_3_store_preserves_custom_layout_without_repair_fallback() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-tauri-1-3-store-test-{}.json",
            uuid::Uuid::new_v4()
        ));
        let fixture = json!({
            "hardwareAcceleration": false,
            "alwaysOnTop": false,
            "overlayLocked": true,
            "noteEffect": true,
            "noteSettings": {
                "borderRadius": 9,
                "speed": 456,
                "trackHeight": 222,
                "reverse": true,
                "fadePosition": "bottom",
                "delayedNoteEnabled": true,
                "shortNoteThresholdMs": 73,
                "shortNoteMinLengthPx": 41
            },
            "selectedKeyType": "tauri-legacy-tab",
            "customTabs": [{ "id": "tauri-legacy-tab", "name": "Tauri legacy" }],
            "angleMode": "metal",
            "language": "ko",
            "laboratoryEnabled": true,
            "keys": { "tauri-legacy-tab": ["Q"] },
            "keyPositions": {
                "tauri-legacy-tab": [{
                    "dx": 654,
                    "dy": 87,
                    "width": 91,
                    "height": 63,
                    "activeImage": "/tmp/legacy-active.png",
                    "inactiveImage": "/tmp/legacy-idle.png",
                    "count": 19,
                    "noteColor": "#13579B",
                    "noteOpacity": 76
                }]
            },
            "keyCounters": { "tauri-legacy-tab": { "Q": 19 } },
            "backgroundColor": "#2468AC",
            "useCustomCss": true,
            "customCss": { "path": "/tmp/tauri-legacy.css", "content": ".tauri {}" },
            "overlayResizeAnchor": "top-left",
            "overlayBounds": { "x": 31, "y": 47, "width": 911, "height": 333 },
            "overlayLastContentTopOffset": 12.5,
            "overlayBoundsAreLogical": false,
            "keyCounterEnabled": true
        });
        std::fs::write(&path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        let _ = std::fs::remove_file(path);

        assert!(!loaded.repaired);
        assert_eq!(loaded.data.selected_key_type, "tauri-legacy-tab");
        assert_eq!(
            loaded.data.keys["tauri-legacy-tab"],
            vec![KeySlot::from("Q")]
        );
        assert_eq!(loaded.data.key_positions["tauri-legacy-tab"].len(), 1);
        let position = &loaded.data.key_positions["tauri-legacy-tab"][0];
        assert_eq!(position.dx, 654.0);
        assert_eq!(position.width, 91.0);
        assert_eq!(
            position.active_image.as_deref(),
            Some("/tmp/legacy-active.png")
        );
        assert_eq!(position.note_border_radius, Some(9.0));
        assert_eq!(loaded.data.key_counters["tauri-legacy-tab"]["Q"], 19);
        assert_eq!(loaded.data.note_settings.speed, 456);
        assert_eq!(loaded.data.background_color, "#2468AC");
        assert!(loaded.data.use_custom_css);
    }

    #[test]
    fn custom_tabs_and_keys_recover_without_compacting_parallel_arrays() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-tab-key-entry-recovery-test-{}.json",
            uuid::Uuid::new_v4()
        ));
        let alpha_tab = CustomTab {
            id: "alpha-tab".to_string(),
            name: "Alpha".to_string(),
        };
        let beta_tab = CustomTab {
            id: "beta-tab".to_string(),
            name: "Beta".to_string(),
        };
        let empty_mode_tab = CustomTab {
            id: "empty-mode".to_string(),
            name: "Empty mode".to_string(),
        };
        let mut positions = vec![default_positions()["4key"][0].clone(); 5];
        for (index, position) in positions.iter_mut().enumerate() {
            position.dx = ((index + 1) * 101) as f64;
        }

        let mut fixture = serde_json::to_value(AppStoreData::default()).unwrap();
        let fields = fixture.as_object_mut().unwrap();
        fields.insert(
            "customTabs".to_string(),
            json!([
                serde_json::to_value(&alpha_tab).unwrap(),
                42,
                serde_json::to_value(&beta_tab).unwrap(),
                serde_json::to_value(&empty_mode_tab).unwrap()
            ]),
        );
        fields.insert("selectedKeyType".to_string(), json!("alpha-tab"));
        fields.insert(
            "keys".to_string(),
            json!({
                "4key": 42,
                "alpha-tab": [42, "A", null, "C", {}],
                "beta-tab": ["D"],
                "empty-mode": 42,
            }),
        );
        fields.insert(
            "keyPositions".to_string(),
            json!({
                "alpha-tab": serde_json::to_value(&positions).unwrap(),
                "beta-tab": [serde_json::to_value(&positions[0]).unwrap()],
                "empty-mode": [],
            }),
        );
        std::fs::write(&path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        let _ = std::fs::remove_file(path);

        assert!(loaded.repaired);
        assert!(loaded.needs_persist);
        assert_eq!(
            loaded.data.custom_tabs,
            vec![alpha_tab, beta_tab, empty_mode_tab]
        );
        assert_eq!(loaded.data.selected_key_type, "alpha-tab");
        assert_eq!(
            loaded.data.keys["alpha-tab"],
            vec![
                KeySlot::default(),
                KeySlot::from("A"),
                KeySlot::default(),
                KeySlot::from("C"),
                KeySlot::default(),
            ]
        );
        assert_eq!(loaded.data.keys["beta-tab"], vec![KeySlot::from("D")]);
        assert!(loaded.data.keys["empty-mode"].is_empty());
        assert_eq!(loaded.data.keys["4key"], default_keys()["4key"]);
        assert_eq!(
            loaded.data.key_positions["alpha-tab"]
                .iter()
                .map(|position| position.dx)
                .collect::<Vec<_>>(),
            vec![101.0, 202.0, 303.0, 404.0, 505.0]
        );
    }

    #[test]
    fn custom_css_history_normalizes_at_the_store_load_boundary() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-css-history-normalize-test-{}.json",
            uuid::Uuid::new_v4()
        ));
        let duplicate = absolute_fixture_path("history-duplicate.css");
        let mut history = vec![
            CustomCssHistoryEntry {
                path: "relative.css".to_string(),
                loaded_at: 999,
                last_used_at: 999,
            },
            CustomCssHistoryEntry {
                path: duplicate.clone(),
                loaded_at: 1,
                last_used_at: 1,
            },
            CustomCssHistoryEntry {
                path: duplicate.clone(),
                loaded_at: 100,
                last_used_at: 100,
            },
        ];
        for index in 0..12 {
            history.push(CustomCssHistoryEntry {
                path: absolute_fixture_path(&format!("history-{index}.css")),
                loaded_at: index,
                last_used_at: index,
            });
        }
        let mut fixture = serde_json::to_value(AppStoreData::default()).unwrap();
        fixture["customCssHistory"] = serde_json::to_value(history).unwrap();
        std::fs::write(&path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        let _ = std::fs::remove_file(path);

        assert!(loaded.needs_persist);
        assert_eq!(loaded.data.custom_css_history.len(), 10);
        assert!(loaded
            .data
            .custom_css_history
            .windows(2)
            .all(|pair| pair[0].last_used_at >= pair[1].last_used_at));
        assert_eq!(
            loaded
                .data
                .custom_css_history
                .iter()
                .filter(|entry| entry.path == duplicate)
                .count(),
            1
        );
        assert!(loaded
            .data
            .custom_css_history
            .iter()
            .all(|entry| std::path::Path::new(&entry.path).is_absolute()));
    }

    #[test]
    fn custom_css_history_recovers_valid_entries_individually() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-css-history-recovery-test-{}.json",
            uuid::Uuid::new_v4()
        ));
        let first = CustomCssHistoryEntry {
            path: absolute_fixture_path("history-first.css"),
            loaded_at: 10,
            last_used_at: 10,
        };
        let second = CustomCssHistoryEntry {
            path: absolute_fixture_path("history-second.css"),
            loaded_at: 20,
            last_used_at: 20,
        };
        let mut fixture = serde_json::to_value(AppStoreData::default()).unwrap();
        fixture["customCssHistory"] = json!([
            serde_json::to_value(&first).unwrap(),
            { "path": 42, "lastUsedAt": "invalid" },
            serde_json::to_value(&second).unwrap()
        ]);
        std::fs::write(&path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        let _ = std::fs::remove_file(path);

        assert!(loaded.repaired);
        assert!(loaded.needs_persist);
        assert_eq!(loaded.data.custom_css_history, vec![second, first]);
    }

    #[test]
    fn custom_css_history_migrates_loaded_at_without_reseeding_active_path() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-css-history-seed-test-{}.json",
            uuid::Uuid::new_v4()
        ));
        let existing_path = absolute_fixture_path("history-existing.css");
        let active_path = absolute_fixture_path("history-active.css");
        let mut fixture = serde_json::to_value(AppStoreData::default()).unwrap();
        fixture["customCss"] = json!({
            "path": active_path,
            "content": "body {}"
        });
        fixture["customCssHistory"] = json!([{
            "path": existing_path,
            "lastUsedAt": 42
        }]);
        std::fs::write(&path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        let _ = std::fs::remove_file(path);

        assert!(loaded.needs_persist);
        assert_eq!(loaded.data.custom_css_history.len(), 1);
        let existing = loaded
            .data
            .custom_css_history
            .iter()
            .find(|entry| entry.path == existing_path)
            .unwrap();
        assert_eq!(existing.loaded_at, 42);
        assert!(!loaded
            .data
            .custom_css_history
            .iter()
            .any(|entry| entry.path == active_path));
    }

    #[test]
    fn custom_css_history_keeps_latest_legacy_duplicate_before_timestamp_migration() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-css-history-legacy-duplicate-test-{}.json",
            uuid::Uuid::new_v4()
        ));
        let duplicate_path = absolute_fixture_path("history-duplicate.css");
        let mut fixture = serde_json::to_value(AppStoreData::default()).unwrap();
        fixture["customCssHistory"] = json!([
            {
                "path": duplicate_path,
                "lastUsedAt": 1
            },
            {
                "path": duplicate_path,
                "lastUsedAt": 100
            }
        ]);
        std::fs::write(&path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        let _ = std::fs::remove_file(path);

        assert_eq!(loaded.data.custom_css_history.len(), 1);
        assert_eq!(loaded.data.custom_css_history[0].loaded_at, 100);
        assert_eq!(loaded.data.custom_css_history[0].last_used_at, 100);
    }

    #[test]
    fn custom_css_history_seeds_active_path_only_when_legacy_field_is_missing() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-css-history-legacy-seed-test-{}.json",
            uuid::Uuid::new_v4()
        ));
        let active_path = absolute_fixture_path("history-active.css");
        let mut fixture = serde_json::to_value(AppStoreData::default()).unwrap();
        fixture.as_object_mut().unwrap().remove("customCssHistory");
        fixture["customCss"] = json!({
            "path": active_path,
            "content": "body {}"
        });
        std::fs::write(&path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        let _ = std::fs::remove_file(path);

        assert!(loaded.needs_persist);
        assert_eq!(loaded.data.custom_css_history.len(), 1);
        assert_eq!(loaded.data.custom_css_history[0].path, active_path);
    }

    #[test]
    fn explicit_empty_custom_css_history_survives_repeated_loads() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-css-history-empty-test-{}.json",
            uuid::Uuid::new_v4()
        ));
        let active_path = absolute_fixture_path("history-active.css");
        let mut fixture = serde_json::to_value(AppStoreData::default()).unwrap();
        fixture["customCss"] = json!({
            "path": active_path,
            "content": "body {}"
        });
        fixture["customCssHistory"] = json!([]);
        std::fs::write(&path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();

        let first = load_store_from_path(&path).unwrap();
        let second = load_store_from_path(&path).unwrap();
        let _ = std::fs::remove_file(path);

        assert!(first.data.custom_css_history.is_empty());
        assert!(second.data.custom_css_history.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn legacy_symlink_active_css_is_seeded_with_its_canonical_path() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "dmnote-css-history-symlink-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let target = root.join("target.css");
        let alias = root.join("alias.css");
        let store_path = root.join("store.json");
        std::fs::write(&target, "body {}").unwrap();
        symlink(&target, &alias).unwrap();

        let mut fixture = serde_json::to_value(AppStoreData::default()).unwrap();
        fixture.as_object_mut().unwrap().remove("customCssHistory");
        fixture["customCss"] = json!({
            "path": alias.to_string_lossy(),
            "content": "body {}"
        });
        std::fs::write(&store_path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();

        let loaded = load_store_from_path(&store_path).unwrap();
        let canonical = std::fs::canonicalize(&target)
            .unwrap()
            .to_string_lossy()
            .to_string();
        let _ = std::fs::remove_dir_all(root);

        assert_eq!(
            loaded.data.custom_css.path.as_deref(),
            Some(canonical.as_str())
        );
        assert_eq!(loaded.data.custom_css_history.len(), 1);
        assert_eq!(loaded.data.custom_css_history[0].path, canonical);
    }

    #[test]
    fn custom_tab_whole_mode_damage_recovers_parallel_shape_only() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-tab-mode-recovery-test-{}.json",
            uuid::Uuid::new_v4()
        ));
        let mut first_position = default_positions()["4key"][0].clone();
        first_position.dx = 111.0;
        let mut second_position = default_positions()["4key"][1].clone();
        second_position.dx = 222.0;

        let mut fixture = serde_json::to_value(AppStoreData::default()).unwrap();
        let fields = fixture.as_object_mut().unwrap();
        fields.insert(
            "customTabs".to_string(),
            json!([
                { "id": "keys-damaged", "name": "Keys damaged" },
                { "id": "positions-damaged", "name": "Positions damaged" },
                { "id": "valid-mismatch", "name": "Valid mismatch" },
                { "id": "missing-both", "name": "Missing both" }
            ]),
        );
        fields.insert("selectedKeyType".to_string(), json!("positions-damaged"));
        fields.insert(
            "keys".to_string(),
            json!({
                "keys-damaged": 42,
                "positions-damaged": ["A", "B", "C"],
                "valid-mismatch": ["Q"]
            }),
        );
        fields.insert(
            "keyPositions".to_string(),
            json!({
                "keys-damaged": [
                    serde_json::to_value(&first_position).unwrap(),
                    serde_json::to_value(&second_position).unwrap()
                ],
                "positions-damaged": 42,
                "valid-mismatch": [
                    serde_json::to_value(&first_position).unwrap(),
                    serde_json::to_value(&second_position).unwrap()
                ]
            }),
        );
        std::fs::write(&path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        let _ = std::fs::remove_file(path);

        assert!(loaded.repaired);
        assert!(loaded.needs_persist);
        assert_eq!(loaded.data.selected_key_type, "positions-damaged");
        assert_eq!(
            loaded.data.keys["keys-damaged"],
            vec![KeySlot::default(), KeySlot::default()]
        );
        assert_eq!(
            loaded.data.key_positions["keys-damaged"]
                .iter()
                .map(|position| position.dx)
                .collect::<Vec<_>>(),
            vec![111.0, 222.0]
        );
        assert_eq!(
            loaded.data.keys["positions-damaged"],
            vec![KeySlot::from("A"), KeySlot::from("B"), KeySlot::from("C")]
        );
        assert!(loaded.data.key_positions["positions-damaged"]
            .iter()
            .all(|position| {
                let mut position = position.clone();
                position.id.clear();
                position == KeyPosition::default()
            }));
        assert_eq!(
            loaded.data.keys["valid-mismatch"],
            vec![KeySlot::from("Q"), KeySlot::default()]
        );
        assert_eq!(loaded.data.key_positions["valid-mismatch"].len(), 2);
        assert!(loaded.data.keys["missing-both"].is_empty());
        assert!(loaded.data.key_positions["missing-both"].is_empty());
    }

    #[test]
    fn custom_tab_missing_modes_are_repaired_on_an_otherwise_valid_store() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-tab-missing-modes-test-{}.json",
            uuid::Uuid::new_v4()
        ));
        let mut fixture = AppStoreData::default();
        fixture.custom_tabs.push(CustomTab {
            id: "missing-modes".to_string(),
            name: "Missing modes".to_string(),
        });
        fixture.selected_key_type = "missing-modes".to_string();
        std::fs::write(&path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        let _ = std::fs::remove_file(path);

        assert!(loaded.repaired);
        assert!(loaded.needs_persist);
        assert_eq!(loaded.data.selected_key_type, "missing-modes");
        assert!(loaded.data.keys["missing-modes"].is_empty());
        assert!(loaded.data.key_positions["missing-modes"].is_empty());
    }

    #[test]
    fn normal_load_rejects_selected_mode_without_a_matching_tab() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-ghost-selection-test-{}.json",
            uuid::Uuid::new_v4()
        ));
        let mut fixture = AppStoreData {
            selected_key_type: "ghost-tab".to_string(),
            ..AppStoreData::default()
        };
        fixture
            .keys
            .insert("ghost-tab".to_string(), vec!["G".into()]);
        std::fs::write(&path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        let _ = std::fs::remove_file(path);

        assert!(!loaded.repaired);
        assert!(loaded.needs_persist);
        assert_eq!(loaded.data.selected_key_type, "4key");
        assert_eq!(loaded.data.keys["ghost-tab"], vec![KeySlot::from("G")]);
    }

    #[test]
    fn asset_entries_recover_only_from_valid_identity_fields() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-asset-identity-recovery-test-{}.json",
            uuid::Uuid::new_v4()
        ));
        let font_path = std::env::temp_dir().join(format!(
            "dmnote-recovered-font-{}.ttf",
            uuid::Uuid::new_v4()
        ));
        let sound_path = std::env::temp_dir().join(format!(
            "dmnote-recovered-sound-{}.wav",
            uuid::Uuid::new_v4()
        ));
        let valid_font = CustomFont {
            id: "recoverable-font".to_string(),
            font_type: FontType::Local,
            name: "Recoverable Font".to_string(),
            display_name: "Recoverable Font".to_string(),
            enabled: true,
            local_path: Some(font_path.to_string_lossy().to_string()),
            css_content: None,
        };
        let mut recoverable_font = serde_json::to_value(&valid_font).unwrap();
        recoverable_font
            .as_object_mut()
            .unwrap()
            .insert("enabled".to_string(), json!("invalid"));
        let mut invalid_identity_font = recoverable_font.clone();
        invalid_identity_font
            .as_object_mut()
            .unwrap()
            .insert("id".to_string(), json!(""));

        let mut fixture = serde_json::to_value(AppStoreData::default()).unwrap();
        let fields = fixture.as_object_mut().unwrap();
        fields.insert(
            "fontSettings".to_string(),
            json!({ "customFonts": [recoverable_font, invalid_identity_font] }),
        );
        fields.insert(
            "soundLibrary".to_string(),
            json!({
                sound_path.to_string_lossy().to_string(): 42,
                "relative.wav": 42
            }),
        );
        std::fs::write(&path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        let _ = std::fs::remove_file(path);

        assert!(loaded.repaired);
        assert_eq!(loaded.data.font_settings.custom_fonts.len(), 1);
        let recovered_font = &loaded.data.font_settings.custom_fonts[0];
        assert_eq!(recovered_font.id, "recoverable-font");
        assert!(!recovered_font.enabled);
        assert_eq!(recovered_font.local_path, valid_font.local_path);
        let sound_key = sound_path.to_string_lossy().to_string();
        assert_eq!(
            loaded.data.sound_library[&sound_key],
            SoundLibraryEntry::default()
        );
        assert!(!loaded.data.sound_library.contains_key("relative.wav"));
    }

    #[test]
    fn position_widgets_recover_layout_only_with_valid_identity() {
        fn corrupt_height(mut value: Value) -> Value {
            value
                .as_object_mut()
                .unwrap()
                .insert("height".to_string(), json!("invalid"));
            value
        }

        let path = std::env::temp_dir().join(format!(
            "dmnote-widget-layout-recovery-test-{}.json",
            uuid::Uuid::new_v4()
        ));
        let mut stat_position = default_positions()["4key"][0].clone();
        stat_position.sound_path = Some("/tmp/recovered-stat.wav".to_string());
        let mut graph_position = default_positions()["4key"][1].clone();
        graph_position.sound_path = Some("/tmp/recovered-graph.wav".to_string());
        let mut knob_position = default_positions()["4key"][2].clone();
        knob_position.sound_path = Some("/tmp/recovered-knob.wav".to_string());

        let recoverable_stat = corrupt_height(
            serde_json::to_value(StatPosition {
                stat_type: StatType::Kps,
                position: stat_position.clone(),
            })
            .unwrap(),
        );
        let mut invalid_stat = recoverable_stat.clone();
        invalid_stat
            .as_object_mut()
            .unwrap()
            .insert("statType".to_string(), json!("invalid"));

        let recoverable_graph = corrupt_height(
            serde_json::to_value(GraphPosition {
                stat_type: GraphStatType::Kps,
                graph_type: GraphType::Line,
                graph_speed: 1,
                graph_color: "#FFFFFF".to_string(),
                show_avg_line: true,
                position: graph_position.clone(),
            })
            .unwrap(),
        );
        let mut invalid_graph = recoverable_graph.clone();
        invalid_graph
            .as_object_mut()
            .unwrap()
            .insert("graphType".to_string(), json!("invalid"));
        let mut invalid_graph_setting = recoverable_graph.clone();
        invalid_graph_setting
            .as_object_mut()
            .unwrap()
            .insert("graphSpeed".to_string(), json!("invalid"));

        let recoverable_knob = corrupt_height(
            serde_json::to_value(KnobPosition {
                axis_id: "axis-recoverable".to_string(),
                sensitivity: 1.0,
                reverse: false,
                position: knob_position.clone(),
            })
            .unwrap(),
        );
        let mut unbound_knob = recoverable_knob.clone();
        unbound_knob
            .as_object_mut()
            .unwrap()
            .insert("axisId".to_string(), json!(""));
        let mut invalid_knob_setting = recoverable_knob.clone();
        invalid_knob_setting
            .as_object_mut()
            .unwrap()
            .insert("sensitivity".to_string(), json!("invalid"));

        let mut fixture = serde_json::to_value(AppStoreData::default()).unwrap();
        let fields = fixture.as_object_mut().unwrap();
        fields.insert(
            "statPositions".to_string(),
            json!({ "recovery-mode": [recoverable_stat, invalid_stat] }),
        );
        fields.insert(
            "graphPositions".to_string(),
            json!({
                "recovery-mode": [recoverable_graph, invalid_graph, invalid_graph_setting]
            }),
        );
        fields.insert(
            "knobPositions".to_string(),
            json!({
                "recovery-mode": [recoverable_knob, unbound_knob, invalid_knob_setting]
            }),
        );
        std::fs::write(&path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        let _ = std::fs::remove_file(path);

        assert_eq!(loaded.data.stat_positions["recovery-mode"].len(), 1);
        assert_eq!(loaded.data.graph_positions["recovery-mode"].len(), 1);
        assert_eq!(loaded.data.knob_positions["recovery-mode"].len(), 2);
        let stat = &loaded.data.stat_positions["recovery-mode"][0];
        let graph = &loaded.data.graph_positions["recovery-mode"][0];
        let knob = &loaded.data.knob_positions["recovery-mode"][0];
        let unbound_knob = &loaded.data.knob_positions["recovery-mode"][1];
        assert_eq!(stat.stat_type, StatType::Kps);
        assert_eq!(graph.graph_type, GraphType::Line);
        assert_eq!(knob.axis_id, "axis-recoverable");
        assert!(unbound_knob.axis_id.is_empty());
        assert_eq!(stat.position.height, KeyPosition::default().height);
        assert_eq!(graph.position.height, KeyPosition::default().height);
        assert_eq!(knob.position.height, KeyPosition::default().height);
        assert_eq!(stat.position.sound_path, stat_position.sound_path);
        assert_eq!(graph.position.sound_path, graph_position.sound_path);
        assert_eq!(knob.position.sound_path, knob_position.sound_path);
        assert_eq!(unbound_knob.position.sound_path, knob_position.sound_path);
    }

    #[test]
    fn repaired_selection_falls_back_without_deleting_orphaned_mode_data() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-selected-tab-recovery-test-{}.json",
            uuid::Uuid::new_v4()
        ));
        let mut fixture = serde_json::to_value(AppStoreData::default()).unwrap();
        let fields = fixture.as_object_mut().unwrap();
        fields.insert(
            "customTabs".to_string(),
            json!([{ "id": "ghost-tab", "name": 42 }]),
        );
        fields.insert("selectedKeyType".to_string(), json!("ghost-tab"));
        fields.insert("keys".to_string(), json!({ "ghost-tab": ["G"] }));
        std::fs::write(&path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        let _ = std::fs::remove_file(path);

        assert!(loaded.repaired);
        assert!(loaded.data.custom_tabs.is_empty());
        assert_eq!(loaded.data.selected_key_type, "4key");
        assert_eq!(loaded.data.keys["ghost-tab"], vec![KeySlot::from("G")]);
    }

    #[test]
    fn nested_user_settings_recover_valid_siblings_only() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-nested-settings-recovery-test-{}.json",
            uuid::Uuid::new_v4()
        ));
        let mut fixture = serde_json::to_value(AppStoreData::default()).unwrap();
        let fields = fixture.as_object_mut().unwrap();

        let note_settings = fields["noteSettings"].as_object_mut().unwrap();
        note_settings.insert("speed".to_string(), json!(987));
        note_settings.insert("trackHeight".to_string(), json!("invalid"));

        fields.insert(
            "customTabs".to_string(),
            json!([{ "id": "alpha-tab", "name": "Alpha" }]),
        );
        fields.insert("keys".to_string(), json!({ "alpha-tab": ["A", "B", "C"] }));
        fields.insert(
            "layerGroups".to_string(),
            json!({
                "alpha-tab": [
                    { "id": "group-a", "name": "Group A" },
                    42,
                    { "id": "group-c", "name": "Group C" }
                ],
                "invalid-mode": 42
            }),
        );
        fields.insert(
            "keyCounters".to_string(),
            json!({
                "alpha-tab": { "A": 7, "B": "invalid", "C": 9 },
                "invalid-mode": 42
            }),
        );
        fields.insert(
            "customCss".to_string(),
            json!({ "path": "/tmp/sentinel.css", "content": 42 }),
        );
        fields.insert(
            "counterAnimationPresets".to_string(),
            json!([
                {
                    "id": "animation-a",
                    "name": "Animation A",
                    "source": "user",
                    "bezier": [0.25, 0.46, 0.45, 0.94],
                    "scale": 1.1,
                    "durationMs": 300
                },
                42,
                {
                    "id": "animation-c",
                    "name": "Animation C",
                    "source": "user",
                    "bezier": [0.1, 0.2, 0.3, 0.4],
                    "scale": 1.2,
                    "durationMs": 400
                }
            ]),
        );
        fields.insert(
            "tabCssOverrides".to_string(),
            json!({
                "alpha-tab": { "path": null, "content": ".alpha {}", "enabled": true },
                "repaired-tab": { "path": "/tmp/repaired.css", "content": ".repaired {}", "enabled": 42 },
                "invalid-tab": 42
            }),
        );
        fields.insert(
            "tabNoteOverrides".to_string(),
            json!({
                "alpha-tab": { "speed": 654 },
                "repaired-tab": { "speed": 777, "reverse": "invalid" },
                "invalid-tab": 42
            }),
        );
        fields.insert(
            "customJs".to_string(),
            json!({
                "path": "/tmp/sentinel.js",
                "content": "globalThis.sentinel = true;",
                "plugins": [
                    { "id": "plugin-a", "name": "Plugin A", "path": null, "content": "a", "enabled": true },
                    42,
                    { "id": "plugin-c", "name": "Plugin C", "path": null, "content": "c", "enabled": false }
                ]
            }),
        );

        let grid_settings = fields["gridSettings"].as_object_mut().unwrap();
        grid_settings.insert("alignmentGuides".to_string(), json!(false));
        grid_settings.insert("gridSnapSize".to_string(), json!("invalid"));
        grid_settings.insert("overlayPadding".to_string(), json!(17));

        let shortcuts = fields["shortcuts"].as_object_mut().unwrap();
        shortcuts.insert("toggleOverlay".to_string(), json!(42));
        shortcuts.insert(
            "toggleAlwaysOnTop".to_string(),
            json!({ "key": "F12", "ctrl": true, "shift": false, "alt": false, "meta": false }),
        );

        let repaired_key = absolute_fixture_path("repaired.wav");
        let path_only_key = absolute_fixture_path("path-only.wav");
        let mut sound_library = serde_json::Map::new();
        sound_library.insert(
            repaired_key.clone(),
            json!({
                "source": 42,
                "displayName": "Recovered sound",
                "trimStartRatio": 0.2
            }),
        );
        sound_library.insert(path_only_key.clone(), json!(42));
        fields.insert(
            "soundLibrary".to_string(),
            serde_json::Value::Object(sound_library),
        );

        std::fs::write(&path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();
        let loaded = load_store_from_path(&path).unwrap();
        let _ = std::fs::remove_file(path);

        assert!(loaded.repaired);
        assert_eq!(loaded.data.note_settings.speed, 987);
        assert_eq!(
            loaded.data.note_settings.track_height,
            AppStoreData::default().note_settings.track_height
        );
        assert_eq!(
            loaded.data.layer_groups["alpha-tab"]
                .iter()
                .map(|group| group.id.as_str())
                .collect::<Vec<_>>(),
            vec!["group-a", "group-c"]
        );
        assert!(!loaded.data.layer_groups.contains_key("invalid-mode"));
        assert_eq!(loaded.data.key_counters["alpha-tab"]["A"], 7);
        assert_eq!(loaded.data.key_counters["alpha-tab"]["B"], 0);
        assert_eq!(loaded.data.key_counters["alpha-tab"]["C"], 9);
        assert!(!loaded.data.key_counters.contains_key("invalid-mode"));
        assert_eq!(
            loaded.data.custom_css.path.as_deref(),
            Some("/tmp/sentinel.css")
        );
        assert!(loaded.data.custom_css.content.is_empty());
        assert_eq!(
            loaded
                .data
                .counter_animation_presets
                .iter()
                .map(|preset| preset.id.as_str())
                .collect::<Vec<_>>(),
            vec!["animation-a", "animation-c"]
        );
        assert_eq!(
            loaded.data.tab_css_overrides["alpha-tab"].content,
            ".alpha {}"
        );
        assert_eq!(
            loaded.data.tab_css_overrides["repaired-tab"].content,
            ".repaired {}"
        );
        assert!(loaded.data.tab_css_overrides["repaired-tab"].enabled);
        assert!(!loaded.data.tab_css_overrides.contains_key("invalid-tab"));
        assert_eq!(loaded.data.tab_note_overrides["alpha-tab"].speed, Some(654));
        assert_eq!(
            loaded.data.tab_note_overrides["repaired-tab"].speed,
            Some(777)
        );
        assert_eq!(loaded.data.tab_note_overrides["repaired-tab"].reverse, None);
        assert!(!loaded.data.tab_note_overrides.contains_key("invalid-tab"));
        assert_eq!(
            loaded.data.custom_js.path.as_deref(),
            Some("/tmp/sentinel.js")
        );
        assert_eq!(
            loaded
                .data
                .custom_js
                .plugins
                .iter()
                .map(|plugin| plugin.id.as_str())
                .collect::<Vec<_>>(),
            vec!["plugin-a", "plugin-c"]
        );
        assert!(!loaded.data.grid_settings.alignment_guides);
        assert_eq!(
            loaded.data.grid_settings.grid_snap_size,
            AppStoreData::default().grid_settings.grid_snap_size
        );
        assert_eq!(loaded.data.grid_settings.overlay_padding, 17);
        assert_eq!(loaded.data.shortcuts.toggle_always_on_top.key, "F12");
        assert_eq!(
            loaded.data.shortcuts.toggle_overlay,
            AppStoreData::default().shortcuts.toggle_overlay
        );
        assert_eq!(
            loaded.data.sound_library[repaired_key.as_str()]
                .display_name
                .as_deref(),
            Some("Recovered sound")
        );
        assert_eq!(
            loaded.data.sound_library[repaired_key.as_str()].trim_start_ratio,
            Some(0.2)
        );
        assert_eq!(
            loaded.data.sound_library[repaired_key.as_str()].source,
            crate::models::SoundSource::Local
        );
        assert_eq!(
            loaded.data.sound_library[path_only_key.as_str()],
            SoundLibraryEntry::default()
        );
    }

    #[test]
    fn asset_position_collections_recover_valid_entries_only() {
        let path = std::env::temp_dir().join(format!(
            "dmnote-position-entry-recovery-test-{}.json",
            uuid::Uuid::new_v4()
        ));
        let position = default_positions()["4key"][0].clone();
        let mut third_position = default_positions()["4key"][1].clone();
        third_position.dx += 17.0;
        let mut partial_position = default_positions()["4key"][0].clone();
        partial_position.dx = 246.0;
        partial_position.width = 88.0;
        partial_position.active_image = Some("/tmp/recovered-image.png".to_string());
        partial_position.sound_path = Some("/tmp/recovered-sound.wav".to_string());
        let mut partial_position_value = serde_json::to_value(&partial_position).unwrap();
        partial_position_value
            .as_object_mut()
            .unwrap()
            .insert("height".to_string(), json!("invalid"));
        let stat = StatPosition {
            stat_type: StatType::Kps,
            position: position.clone(),
        };
        let graph = GraphPosition {
            stat_type: GraphStatType::Kps,
            graph_type: GraphType::Line,
            graph_speed: 1,
            graph_color: "#FFFFFF".to_string(),
            show_avg_line: true,
            position: position.clone(),
        };
        let knob = KnobPosition {
            axis_id: "axis-sentinel".to_string(),
            sensitivity: 1.0,
            reverse: false,
            position: position.clone(),
        };
        let font = CustomFont {
            id: "font-sentinel".to_string(),
            font_type: FontType::Local,
            name: "Font Sentinel".to_string(),
            display_name: "Font Sentinel".to_string(),
            enabled: true,
            local_path: Some(absolute_fixture_path("font-sentinel.ttf")),
            css_content: None,
        };

        let mut fixture = serde_json::to_value(AppStoreData::default()).unwrap();
        let fields = fixture.as_object_mut().unwrap();
        fields.insert(
            "keyPositions".to_string(),
            json!({
                "partial-mode": [
                    serde_json::to_value(&position).unwrap(),
                    partial_position_value,
                    serde_json::to_value(&third_position).unwrap(),
                    42
                ],
                "invalid-mode": 42,
            }),
        );
        fields.insert(
            "statPositions".to_string(),
            json!({
                "partial-mode": [serde_json::to_value(&stat).unwrap(), 42],
                "invalid-mode": 42,
            }),
        );
        fields.insert(
            "graphPositions".to_string(),
            json!({
                "partial-mode": [serde_json::to_value(&graph).unwrap(), 42],
                "invalid-mode": 42,
            }),
        );
        fields.insert(
            "knobPositions".to_string(),
            json!({
                "partial-mode": [serde_json::to_value(&knob).unwrap(), 42],
                "invalid-mode": 42,
            }),
        );
        fields.insert(
            "fontSettings".to_string(),
            json!({
                "customFonts": [serde_json::to_value(&font).unwrap(), 42],
            }),
        );
        std::fs::write(&path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        let _ = std::fs::remove_file(path);

        assert!(loaded.repaired);
        assert!(loaded.needs_persist);
        let recovered_key_positions = &loaded.data.key_positions["partial-mode"];
        assert_eq!(recovered_key_positions.len(), 4);
        let mut recovered_first = recovered_key_positions[0].clone();
        recovered_first.id.clear();
        assert_eq!(recovered_first, position);
        assert_eq!(recovered_key_positions[1].dx, partial_position.dx);
        assert_eq!(recovered_key_positions[1].width, partial_position.width);
        assert_eq!(
            recovered_key_positions[1].height,
            KeyPosition::default().height
        );
        assert_eq!(
            recovered_key_positions[1].active_image,
            partial_position.active_image
        );
        assert_eq!(
            recovered_key_positions[1].sound_path,
            partial_position.sound_path
        );
        let mut recovered_third = recovered_key_positions[2].clone();
        recovered_third.id.clear();
        assert_eq!(recovered_third, third_position);
        let mut recovered_default = recovered_key_positions[3].clone();
        recovered_default.id.clear();
        assert_eq!(recovered_default, KeyPosition::default());
        assert_eq!(recovered_key_positions[3].width, 60.0);
        let mut recovered_stat = loaded.data.stat_positions["partial-mode"][0].clone();
        recovered_stat.position.id.clear();
        assert_eq!(recovered_stat, stat);
        let mut recovered_graph = loaded.data.graph_positions["partial-mode"][0].clone();
        recovered_graph.position.id.clear();
        assert_eq!(recovered_graph, graph);
        let mut recovered_knob = loaded.data.knob_positions["partial-mode"][0].clone();
        recovered_knob.position.id.clear();
        assert_eq!(recovered_knob, knob);
        assert!(!loaded.data.key_positions.contains_key("invalid-mode"));
        assert!(!loaded.data.stat_positions.contains_key("invalid-mode"));
        assert!(!loaded.data.graph_positions.contains_key("invalid-mode"));
        assert!(!loaded.data.knob_positions.contains_key("invalid-mode"));
        assert_eq!(loaded.data.font_settings.custom_fonts, vec![font]);
    }

    #[test]
    fn non_utf8_store_recovers_instead_of_failing_init() {
        // 잘못된 UTF-8 바이트(0xFF)는 과거 read_to_string에서 IO 에러로 초기화 실패 + .bak 미생성
        let path = std::env::temp_dir().join(format!(
            "dmnote-non-utf8-recovery-test-{}.json",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&path, [b'{', 0xFF, b'}']).unwrap();

        let loaded = load_store_from_path(&path).expect("비 UTF-8 store는 Err 대신 복구되어야 함");
        let _ = std::fs::remove_file(&path);

        // 복구 분기 합류 — repaired/needs_persist로 store.rs가 .bak 백업 후 재저장
        assert!(loaded.repaired);
        assert!(loaded.needs_persist);

        // 문법만 깨진 UTF-8 JSON과 동일한 기본값 복구 경로로 수렴
        let broken_path = std::env::temp_dir().join(format!(
            "dmnote-broken-json-baseline-{}.json",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&broken_path, b"{ not json").unwrap();
        let baseline = load_store_from_path(&broken_path).unwrap();
        let _ = std::fs::remove_file(&broken_path);
        let mut loaded_value = serde_json::to_value(&loaded.data).unwrap();
        let mut baseline_value = serde_json::to_value(&baseline.data).unwrap();
        remove_all_native_ids(&mut loaded_value);
        remove_all_native_ids(&mut baseline_value);
        assert_eq!(loaded_value, baseline_value);
    }

    #[test]
    fn missing_local_font_is_restored_from_embedded_data_uri() {
        let app_data_dir = std::env::temp_dir().join(format!(
            "dmnote-font-migration-test-{}",
            uuid::Uuid::new_v4()
        ));
        let missing_path = app_data_dir.join("missing.woff2");
        let font_bytes = b"embedded-font";
        let css_content = format!(
            "@font-face {{ src: url(data:font/woff2;base64,{}) format('woff2'); }}",
            BASE64_STANDARD.encode(font_bytes)
        );
        let mut data = AppStoreData::default();
        data.font_settings.custom_fonts.push(CustomFont {
            id: "local-font".to_string(),
            font_type: FontType::Local,
            name: "Local Font".to_string(),
            display_name: "Local Font".to_string(),
            enabled: true,
            local_path: Some(missing_path.to_string_lossy().to_string()),
            css_content: Some(css_content),
        });

        assert!(migrate_local_fonts_to_app_data(&app_data_dir, &mut data));

        let font = &data.font_settings.custom_fonts[0];
        let restored_path = std::path::PathBuf::from(font.local_path.as_ref().unwrap());
        assert!(font.enabled);
        assert!(font.css_content.is_none());
        assert_eq!(
            restored_path.parent(),
            Some(app_data_dir.join("fonts").as_path())
        );
        assert_eq!(
            restored_path.extension().and_then(|ext| ext.to_str()),
            Some("woff2")
        );
        assert_eq!(std::fs::read(&restored_path).unwrap(), font_bytes);

        let _ = std::fs::remove_dir_all(app_data_dir);
    }

    #[test]
    fn portable_asset_reference_parser_accepts_cross_platform_absolute_forms() {
        let cases = [
            r"C:\Users\me\AppData\Roaming\com.dmnote.desktop\sounds\key.wav",
            r"\\?\C:\Users\me\AppData\Roaming\com.dmnote.desktop\sounds\key.wav",
            r"\\server\share\com.dmnote.desktop\sounds\key.wav",
            r"\\?\UNC\server\share\com.dmnote.desktop\sounds\key.wav",
            "/Users/me/Library/Application Support/com.dmnote.desktop/sounds/key.wav",
            "file:///C:/Users/me/AppData/Roaming/com.dmnote.desktop/sounds/key.wav",
        ];
        for raw in cases {
            assert_eq!(
                parse_portable_asset_reference(raw),
                Some((AssetCategory::Sounds, "key.wav".to_string())),
                "failed to parse {raw}"
            );
        }
    }

    #[test]
    fn cross_platform_asset_forms_rehome_to_existing_local_files() {
        let dir = rehome_test_directory("absolute-forms");
        let sounds_dir = dir.join("sounds");
        std::fs::create_dir_all(&sounds_dir).unwrap();
        let forms = [
            r"C:\Users\me\AppData\Roaming\com.dmnote.desktop\sounds\normal.wav",
            r"\\?\C:\Users\me\AppData\Roaming\com.dmnote.desktop\sounds\verbatim.wav",
            r"\\server\share\com.dmnote.desktop\sounds\unc.wav",
            "file:///C:/Users/me/AppData/Roaming/com.dmnote.desktop/sounds/url.wav",
        ];
        for name in ["normal.wav", "verbatim.wav", "unc.wav", "url.wav"] {
            std::fs::write(sounds_dir.join(name), b"sound").unwrap();
        }

        for (raw, name) in
            forms
                .into_iter()
                .zip(["normal.wav", "verbatim.wav", "unc.wav", "url.wav"])
        {
            let mut data = data_with_one_position();
            data.key_positions.get_mut("4key").unwrap()[0].sound_path = Some(raw.to_string());
            assert!(rehome_foreign_asset_references(&dir, &mut data));
            assert_eq!(
                data.key_positions["4key"][0].sound_path.as_deref(),
                Some(sounds_dir.join(name).to_string_lossy().as_ref())
            );
        }

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn missing_external_and_traversal_asset_references_remain_unchanged() {
        let dir = rehome_test_directory("rejected");
        std::fs::create_dir_all(dir.join("sounds")).unwrap();
        std::fs::write(dir.join("sounds").join("evil.wav"), b"sound").unwrap();
        for raw in [
            r"C:\Users\me\com.dmnote.desktop\sounds\missing.wav",
            r"D:\music\evil.wav",
            r"C:\Users\me\com.dmnote.desktop\sounds\..\evil.wav",
            r"C:\Users\me\com.dmnote.desktop\sounds\..",
        ] {
            let mut data = data_with_one_position();
            data.key_positions.get_mut("4key").unwrap()[0].sound_path = Some(raw.to_string());
            assert!(!rehome_foreign_asset_references(&dir, &mut data));
            assert_eq!(
                data.key_positions["4key"][0].sound_path.as_deref(),
                Some(raw)
            );
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn normalized_unicode_file_name_rehomes_only_on_unique_match() {
        let dir = rehome_test_directory("unicode");
        let images_dir = dir.join("images");
        std::fs::create_dir_all(&images_dir).unwrap();
        let nfc_name = "키음.wav";
        let nfd_name = nfc_name.nfd().collect::<String>();
        let actual_path = images_dir.join(&nfd_name);
        std::fs::write(&actual_path, b"image").unwrap();
        let mut data = data_with_one_position();
        data.key_positions.get_mut("4key").unwrap()[0].active_image =
            Some(format!(r"C:\Users\me\com.dmnote.desktop\images\{nfc_name}"));

        assert!(rehome_foreign_asset_references(&dir, &mut data));
        let rehomed =
            std::path::PathBuf::from(data.key_positions["4key"][0].active_image.as_ref().unwrap());
        assert!(rehomed.is_file());
        assert_eq!(
            rehomed
                .file_name()
                .unwrap()
                .to_string_lossy()
                .nfc()
                .collect::<String>(),
            nfc_name
        );
        assert!(!rehome_foreign_asset_references(&dir, &mut data));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn foreign_font_reference_stays_enabled_and_heals_after_files_arrive() {
        let dir = rehome_test_directory("font-heal");
        std::fs::create_dir_all(dir.join("fonts")).unwrap();
        let foreign = r"C:\Users\me\AppData\Roaming\com.dmnote.desktop\fonts\portable.ttf";
        let mut data = AppStoreData::default();
        data.font_settings.custom_fonts.push(CustomFont {
            id: "font".to_string(),
            font_type: FontType::Local,
            name: "Font".to_string(),
            display_name: "Font".to_string(),
            enabled: true,
            local_path: Some(foreign.to_string()),
            css_content: None,
        });

        // store만 복사된 상태 — 로드 체인 순서(재귀화 → 폰트 마이그레이션) 재현
        assert!(!rehome_foreign_asset_references(&dir, &mut data));
        migrate_local_fonts_to_app_data(&dir, &mut data);
        assert!(data.font_settings.custom_fonts[0].enabled);
        assert_eq!(
            data.font_settings.custom_fonts[0].local_path.as_deref(),
            Some(foreign)
        );

        // 파일이 뒤늦게 복사되면 다음 로드에서 치유
        let local = dir.join("fonts").join("portable.ttf");
        std::fs::write(&local, b"font").unwrap();
        assert!(rehome_foreign_asset_references(&dir, &mut data));
        migrate_local_fonts_to_app_data(&dir, &mut data);
        assert!(data.font_settings.custom_fonts[0].enabled);
        assert_eq!(
            data.font_settings.custom_fonts[0].local_path.as_deref(),
            Some(local.to_string_lossy().as_ref())
        );

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn dangling_local_font_reference_is_still_disabled() {
        // 현재 appData 루트가 마커명을 포함하는 실제 구조 재현
        let root = rehome_test_directory("font-dangling");
        let dir = root.join("com.dmnote.desktop");
        std::fs::create_dir_all(dir.join("fonts")).unwrap();
        let missing_local = dir.join("fonts").join("gone.ttf");
        let mut data = AppStoreData::default();
        data.font_settings.custom_fonts.push(CustomFont {
            id: "font".to_string(),
            font_type: FontType::Local,
            name: "Font".to_string(),
            display_name: "Font".to_string(),
            enabled: true,
            local_path: Some(missing_local.to_string_lossy().into_owned()),
            css_content: None,
        });

        // 마커가 있어도 현재 루트 하위의 단순 누락 참조는 기존대로 비활성화
        assert!(!rehome_foreign_asset_references(&dir, &mut data));
        assert!(migrate_local_fonts_to_app_data(&dir, &mut data));
        assert!(!data.font_settings.custom_fonts[0].enabled);

        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_identity_variants_of_current_app_data_are_not_foreign() {
        let root = rehome_test_directory("win-identity").join("com.dmnote.desktop");
        std::fs::create_dir_all(root.join("fonts")).unwrap();
        let missing = root.join("fonts").join("gone.ttf");
        let plain = missing.to_string_lossy().into_owned();

        // 대소문자·verbatim·file URL 표기 차이는 전부 "현재 appData"로 인식되어야 함
        let lowercase = plain.to_ascii_lowercase();
        let verbatim = format!(r"\\?\{plain}");
        let url = url::Url::from_file_path(&missing).unwrap().to_string();
        for raw in [lowercase, verbatim, url] {
            assert!(
                !super::is_foreign_portable_asset_reference(&root, &raw),
                "현재 appData 표기 변형이 외래로 오판됨: {raw}"
            );
        }

        // 다른 사용자 경로는 외래 판정 유지
        let other = r"C:\Users\dmnote-other\AppData\Roaming\com.dmnote.desktop\fonts\gone.ttf";
        assert!(super::is_foreign_portable_asset_reference(&root, other));

        let _ = std::fs::remove_dir_all(root.parent().unwrap());
    }

    #[test]
    fn corrupt_entries_with_foreign_managed_paths_survive_recovery() {
        // 사운드: 외래 관리 경로 키 + 손상 값 → 삭제 대신 기본 메타데이터로 재건
        let foreign_sound = r"C:\Users\me\AppData\Roaming\com.dmnote.desktop\sounds\key.wav";
        let posix_sound = "/Users/me/Library/Application Support/com.dmnote.desktop/sounds/k2.wav";
        let mut entries = serde_json::Map::new();
        entries.insert(foreign_sound.to_string(), json!(42));
        entries.insert(posix_sound.to_string(), json!(42));
        entries.insert("not-a-path".to_string(), json!(42));

        let recovered =
            super::recover_sound_library_entries(&serde_json::Value::Object(entries)).unwrap();
        let recovered = recovered.as_object().unwrap();
        assert!(recovered.contains_key(foreign_sound));
        assert!(recovered.contains_key(posix_sound));
        assert!(!recovered.contains_key("not-a-path"));

        // 폰트: 외래 관리 경로 + enabled 손상 → 항목 삭제 대신 비활성 복구
        let mut font = serde_json::to_value(CustomFont {
            id: "font".to_string(),
            font_type: FontType::Local,
            name: "Font".to_string(),
            display_name: "Font".to_string(),
            enabled: true,
            local_path: Some(
                r"C:\Users\me\AppData\Roaming\com.dmnote.desktop\fonts\p.ttf".to_string(),
            ),
            css_content: None,
        })
        .unwrap();
        font.as_object_mut()
            .unwrap()
            .insert("enabled".to_string(), json!(42));

        let candidate = super::recover_local_font_enabled(&font).unwrap();
        assert_eq!(
            candidate.as_object().unwrap().get("enabled"),
            Some(&serde_json::Value::Bool(false))
        );
    }

    #[test]
    fn sound_library_rekey_preserves_metadata_and_conflicts() {
        let dir = rehome_test_directory("sound-library");
        let local_path = dir.join("sounds").join("library.wav");
        std::fs::create_dir_all(local_path.parent().unwrap()).unwrap();
        std::fs::write(&local_path, b"sound").unwrap();
        let foreign = r"C:\Users\me\com.dmnote.desktop\sounds\library.wav".to_string();
        let mut metadata = SoundLibraryEntry {
            display_name: Some("보존 이름".to_string()),
            trim_start_ratio: Some(0.25),
            ..SoundLibraryEntry::default()
        };
        let local_key = local_path.to_string_lossy().into_owned();

        let mut data = AppStoreData::default();
        data.sound_library.insert(foreign.clone(), metadata.clone());
        assert!(rehome_foreign_asset_references(&dir, &mut data));
        assert_eq!(data.sound_library[&local_key], metadata);
        assert!(!data.sound_library.contains_key(&foreign));

        data.sound_library.insert(foreign.clone(), metadata.clone());
        assert!(rehome_foreign_asset_references(&dir, &mut data));
        assert_eq!(data.sound_library.len(), 1);

        metadata.display_name = Some("다른 이름".to_string());
        data.sound_library.insert(foreign.clone(), metadata.clone());
        assert!(!rehome_foreign_asset_references(&dir, &mut data));
        assert_eq!(data.sound_library[&foreign], metadata);
        assert_ne!(data.sound_library[&local_key], metadata);

        let alternate_foreign = r"\\server\share\com.dmnote.desktop\sounds\library.wav".to_string();
        let mut candidates_only = AppStoreData::default();
        candidates_only
            .sound_library
            .insert(foreign.clone(), SoundLibraryEntry::default());
        candidates_only
            .sound_library
            .insert(alternate_foreign.clone(), metadata.clone());
        assert!(!rehome_foreign_asset_references(&dir, &mut candidates_only));
        assert!(candidates_only.sound_library.contains_key(&foreign));
        assert!(candidates_only
            .sound_library
            .contains_key(&alternate_foreign));
        assert!(!candidates_only.sound_library.contains_key(&local_key));

        let _ = std::fs::remove_dir_all(dir);
    }
}
