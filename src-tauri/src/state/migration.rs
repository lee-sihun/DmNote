use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use dirs_next::config_dir;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{Map, Value};
use uuid::Uuid;

use crate::{
    defaults::{default_keys, default_positions},
    models::{
        AppStoreData, CounterAnimationPreset, CustomCss, CustomFont, CustomJs, CustomTab, FontType,
        GraphPosition, GraphPositions, GraphStatType, GraphType, GridSettings, JsPlugin,
        KeyCounters, KeyMappings, KeyPosition, KeyPositions, KnobPosition, KnobPositions,
        LayerGroupDef, LayerGroups, NoteSettings, OverlayBounds, ShortcutsState, SoundLibraryEntry,
        StatPosition, StatPositions, StatType, TabCss, TabNoteSettings,
    },
};

const LEGACY_OVERLAY_WIDTH: f64 = 860.0;
const LEGACY_OVERLAY_HEIGHT: f64 = 320.0;

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
    let (state, needs_persist, repaired) = match serde_json::from_slice::<Value>(&content) {
        Ok(mut value) => {
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
                    // rgba로 깨진 noteBorderColor가 있으면 정규화 후 디스크에도 영속 (이슈 #73)
                    if has_convertible_note_border_color(&data) {
                        needs_persist = true;
                    }
                    if migrate_legacy_knob_sensitivity(&mut data) {
                        needs_persist = true;
                    }
                    let semantic_repaired = repair_semantic_identities(&mut data);
                    needs_persist |= semantic_repaired;
                    let layout_repaired = repair_custom_tab_key_layout_pairs(
                        &mut data,
                        value.get("keys"),
                        value.get("keyPositions"),
                    );
                    needs_persist |= layout_repaired;
                    needs_persist |= key_position_lengths_mismatch(&data.keys, &data.key_positions);
                    needs_persist |= !has_valid_selected_key_type(&data);
                    (
                        normalize_state(data),
                        needs_persist,
                        layout_repaired || semantic_repaired,
                    )
                }
                Err(err) => {
                    log::warn!(
                        "[Store] Falling back to field-level recovery for {}: {err}",
                        path.display()
                    );
                    (repair_legacy_state(value), true, true)
                }
            }
        }
        Err(err) => {
            log::warn!(
                "[Store] Falling back to default recovery for invalid JSON at {}: {err}",
                path.display()
            );
            (repair_legacy_state(Value::Null), true, true)
        }
    };
    // 로드 시점은 정의와 참조가 함께 확정되는 경계 — dangling groupId 정리
    // 정리가 발생하면 마이그레이션과 같은 경로로 디스크에도 영속
    let mut state = state;
    let mut needs_persist = needs_persist;
    if clear_dangling_group_ids(&mut state) {
        needs_persist = true;
    }
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

        let invalid_path = font
            .local_path
            .as_ref()
            .is_some_and(|path| path.trim().is_empty() || !Path::new(path.trim()).is_absolute());
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
        let dest = images_dir.join(format!("{}.{}", Uuid::new_v4(), extension));
        match fs::write(&dest, bytes) {
            Ok(_) => {
                *image_ref = Some(dest.to_string_lossy().to_string());
                return true;
            }
            Err(err) => {
                log::warn!(
                    "[Images] Failed to migrate data URL image into {}: {err}",
                    dest.display()
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
    let dest = images_dir.join(format!("{}.{}", Uuid::new_v4(), extension));
    match fs::copy(&source, &dest) {
        Ok(_) => {
            *image_ref = Some(dest.to_string_lossy().to_string());
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

    let _ = data.custom_js.normalize();

    data
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
                .resize(position_count, String::new());
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
        entry.retain(|key, _| key_list.contains(key));
        for key in key_list.iter() {
            entry.entry(key.clone()).or_insert(0);
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
                data.keys.insert(mode, vec![String::new(); positions.len()]);
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
                .enumerate()
                .map(|(index, entry)| match entry.as_str() {
                    Some(key) => Value::String(key.to_string()),
                    None => {
                        log::warn!(
                            "[Store] Replacing invalid keys entry '{mode}[{index}]' with an unassigned key during recovery"
                        );
                        Value::String(String::new())
                    }
                })
                .collect(),
            _ => {
                log::warn!(
                    "[Store] Replacing invalid keys mode '{mode}' during recovery: expected an array"
                );
                defaults
                    .get(mode)
                    .map(|keys| keys.iter().cloned().map(Value::String).collect())
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

        if Path::new(key).is_absolute() {
            log::warn!(
                "[Store] Rebuilding invalid soundLibrary entry '{key}' from its absolute path during recovery"
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

            if !has_valid_identity(entry) {
                log::warn!(
                    "[Store] Removing invalid {field} entry '{mode}[{index}]' with a damaged identity during recovery"
                );
                continue;
            }

            let entry_name = format!("{field}.{mode}[{index}]");
            let Some(partial) = recover_object_fields::<KeyPosition>(&entry_name, entry) else {
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
                    let recovered = recover_object_fields::<KeyPosition>(&entry_name, entry)
                        .filter(|candidate| {
                            serde_json::from_value::<KeyPosition>(candidate.clone()).is_ok()
                        })
                        .unwrap_or_else(|| {
                            log::warn!(
                                "[Store] Replacing invalid {field} entry '{mode}[{index}]' with default during recovery: {err}"
                            );
                            default_position.clone()
                        });
                    recovered_entries.push(recovered);
                }
            }
        }
        recovered_modes.insert(mode.clone(), Value::Array(recovered_entries));
    }
    Some(Value::Object(recovered_modes))
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
    if local_path.trim().is_empty() || !Path::new(local_path).is_absolute() {
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
        normalize_state, rgba_to_hex, LEGACY_OVERLAY_HEIGHT, LEGACY_OVERLAY_WIDTH,
    };
    use crate::{
        defaults::{default_keys, default_positions},
        models::{
            AppStoreData, CustomFont, CustomTab, FontType, GraphPosition, GraphStatType, GraphType,
            KeyPosition, KnobPosition, LayerGroupDef, OverlayBounds, SoundLibraryEntry,
            StatPosition, StatType, TabCss, TabNoteSettings,
        },
    };
    use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};

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
        data.keys.get_mut("4key").unwrap().push("F5".to_string());
        let preserved_position = KeyPosition {
            dx: 987.0,
            ..KeyPosition::default()
        };
        data.key_positions
            .get_mut("5key")
            .unwrap()
            .push(preserved_position.clone());
        data.keys.insert(
            "keys-only".to_string(),
            vec!["A".to_string(), "B".to_string()],
        );
        data.key_positions.insert(
            "positions-only".to_string(),
            vec![preserved_position.clone()],
        );
        std::fs::write(&path, serde_json::to_vec_pretty(&data).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        assert!(!loaded.repaired);
        assert!(loaded.needs_persist);
        assert_eq!(loaded.data.keys["4key"].last().unwrap(), "F5");
        assert_eq!(
            loaded.data.key_positions["4key"].last().unwrap(),
            &KeyPosition::default()
        );
        assert_eq!(
            loaded.data.key_positions["5key"].last().unwrap(),
            &preserved_position
        );
        assert!(loaded.data.keys["5key"].last().unwrap().is_empty());
        assert_eq!(loaded.data.key_positions["keys-only"].len(), 2);
        assert_eq!(loaded.data.keys["positions-only"], vec![String::new()]);

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
        let mut value = serde_json::to_value(AppStoreData::default()).unwrap();
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
        assert_eq!(loaded.data, expected);
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
        assert_eq!(loaded.data.keys["legacy-tab"], vec!["A", "B"]);
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
        assert_eq!(loaded.data.keys["tauri-legacy-tab"], vec!["Q"]);
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
                String::new(),
                "A".to_string(),
                String::new(),
                "C".to_string(),
                String::new(),
            ]
        );
        assert_eq!(loaded.data.keys["beta-tab"], vec!["D".to_string()]);
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
            vec![String::new(), String::new()]
        );
        assert_eq!(
            loaded.data.key_positions["keys-damaged"]
                .iter()
                .map(|position| position.dx)
                .collect::<Vec<_>>(),
            vec![111.0, 222.0]
        );
        assert_eq!(loaded.data.keys["positions-damaged"], vec!["A", "B", "C"]);
        assert_eq!(
            loaded.data.key_positions["positions-damaged"],
            vec![KeyPosition::default(); 3]
        );
        assert_eq!(
            loaded.data.keys["valid-mismatch"],
            vec!["Q".to_string(), String::new()]
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
            .insert("ghost-tab".to_string(), vec!["G".to_string()]);
        std::fs::write(&path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();

        let loaded = load_store_from_path(&path).unwrap();
        let _ = std::fs::remove_file(path);

        assert!(!loaded.repaired);
        assert!(loaded.needs_persist);
        assert_eq!(loaded.data.selected_key_type, "4key");
        assert_eq!(loaded.data.keys["ghost-tab"], vec!["G"]);
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
        assert_eq!(loaded.data.keys["ghost-tab"], vec!["G".to_string()]);
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

        fields.insert(
            "soundLibrary".to_string(),
            json!({
                "/tmp/repaired.wav": {
                    "source": 42,
                    "displayName": "Recovered sound",
                    "trimStartRatio": 0.2
                },
                "/tmp/path-only.wav": 42
            }),
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
            loaded.data.sound_library["/tmp/repaired.wav"]
                .display_name
                .as_deref(),
            Some("Recovered sound")
        );
        assert_eq!(
            loaded.data.sound_library["/tmp/repaired.wav"].trim_start_ratio,
            Some(0.2)
        );
        assert_eq!(
            loaded.data.sound_library["/tmp/repaired.wav"].source,
            crate::models::SoundSource::Local
        );
        assert_eq!(
            loaded.data.sound_library["/tmp/path-only.wav"],
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
            local_path: Some("/tmp/font-sentinel.ttf".to_string()),
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
        assert_eq!(recovered_key_positions[0], position);
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
        assert_eq!(recovered_key_positions[2], third_position);
        assert_eq!(recovered_key_positions[3], KeyPosition::default());
        assert_eq!(recovered_key_positions[3].width, 60.0);
        assert_eq!(loaded.data.stat_positions["partial-mode"], vec![stat]);
        assert_eq!(loaded.data.graph_positions["partial-mode"], vec![graph]);
        assert_eq!(loaded.data.knob_positions["partial-mode"], vec![knob]);
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
        assert_eq!(loaded.data, baseline.data);
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
}
