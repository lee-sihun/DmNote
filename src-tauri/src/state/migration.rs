use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use dirs_next::config_dir;
use serde::Deserialize;
use serde_json::{Map, Value};
use uuid::Uuid;

use crate::{
    defaults::{default_keys, default_positions},
    models::{
        AppStoreData, FontType, GraphPositions, KeyCounters, KeyMappings, KeyPositions,
        KnobPositions, LayerGroups, OverlayBounds, StatPositions,
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
                    (normalize_state(data), needs_persist, false)
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

    if !data.keys.contains_key(&data.selected_key_type) {
        data.selected_key_type = "4key".to_string();
    }

    let _ = data.custom_js.normalize();

    data
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

    let Value::Object(mut recovered) =
        serde_json::to_value(AppStoreData::default()).unwrap_or_else(|_| Value::Object(Map::new()))
    else {
        return normalize_state(AppStoreData::default());
    };

    for (field, value) in source {
        let previous = recovered.insert(field.clone(), value);
        if serde_json::from_value::<AppStoreData>(Value::Object(recovered.clone())).is_err() {
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
    normalize_state(data)
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
        normalize_state, rgba_to_hex,
    };
    use crate::{
        defaults::default_positions,
        models::{
            AppStoreData, CustomFont, FontType, KnobPosition, LayerGroupDef, OverlayBounds,
            SoundLibraryEntry, TabCss, TabNoteSettings,
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
