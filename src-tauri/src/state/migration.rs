use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use dirs_next::config_dir;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::{
    defaults::{default_keys, default_positions},
    models::{
        AppStoreData, FontType, GraphPositions, KeyCounters, KeyMappings, KeyPositions,
        NoteSettings, OverlayBounds, StatPositions,
    },
};

const LEGACY_OVERLAY_WIDTH: f64 = 860.0;
const LEGACY_OVERLAY_HEIGHT: f64 = 320.0;

/// store 파일 로드 및 마이그레이션 적용
pub(crate) fn load_store_from_path(path: &Path) -> Result<(AppStoreData, bool)> {
    let content = fs::read_to_string(path)
        .with_context(|| format!("failed to read store file at {}", path.display()))?;
    let (state, needs_persist) = match serde_json::from_str::<AppStoreData>(&content) {
        Ok(data) => {
            let needs_font_persist = data.font_settings.custom_fonts.iter().any(|font| {
                font.font_type == FontType::Local
                    && font
                        .css_content
                        .as_ref()
                        .map(|c| !c.trim().is_empty())
                        .unwrap_or(false)
            });
            // rgba로 깨진 noteBorderColor가 있으면 정규화 후 디스크에도 영속 (이슈 #73)
            let needs_border_color_fix = has_convertible_note_border_color(&data);
            (
                normalize_state(data),
                needs_font_persist || needs_border_color_fix,
            )
        }
        // 레거시/비정상 store 파일 복구 후 정규화 상태 저장
        Err(_) => (repair_legacy_state(&content), true),
    };
    if needs_persist {
        log::info!(
            "[Store] Persisting migrated store file at {}",
            path.display()
        );
    }
    Ok((state, needs_persist))
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

        if !local_path.is_empty() {
            let source = PathBuf::from(local_path);

            // 이미 앱 데이터 fonts 디렉터리 내부에 있으면 cssContent만 제거
            if source.starts_with(&fonts_dir) && source.exists() {
                if font.css_content.is_some() {
                    font.css_content = None;
                    changed = true;
                }
                continue;
            }

            if source.exists() {
                let ext = source
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("ttf")
                    .to_lowercase();
                let dest = fonts_dir.join(format!("{}.{}", Uuid::new_v4(), ext));
                match fs::copy(&source, &dest) {
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

        // 폰트 파일 임포트 실패 시 비활성화하고 cssContent 제거 (store 비대화 방지)
        if font.enabled {
            font.enabled = false;
            changed = true;
        }
        if font.css_content.is_some() {
            font.css_content = None;
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

/// noteBorderColor가 변환 가능한 rgba면 #RRGGBB로 교체. 실제 변환 여부 반환
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
                pos.note_border_radius = Some(legacy_border_radius);
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

/// 레거시/비정상 store 파일 수동 복구
fn repair_legacy_state(raw: &str) -> AppStoreData {
    let value: Value = serde_json::from_str(raw).unwrap_or(Value::Null);
    let mut data = AppStoreData::default();
    if let Value::Object(obj) = value {
        if let Some(v) = obj.get("hardwareAcceleration").and_then(Value::as_bool) {
            data.hardware_acceleration = v;
        }
        if let Some(v) = obj.get("alwaysOnTop").and_then(Value::as_bool) {
            data.always_on_top = v;
        }
        if let Some(v) = obj.get("overlayLocked").and_then(Value::as_bool) {
            data.overlay_locked = v;
        }
        if let Some(v) = obj.get("noteEffect").and_then(Value::as_bool) {
            data.note_effect = v;
        }
        if let Some(v) = obj
            .get("noteSettings")
            .and_then(|v| serde_json::from_value::<NoteSettings>(v.clone()).ok())
        {
            data.note_settings = v;
        }
        if let Some(v) = obj.get("selectedKeyType").and_then(Value::as_str) {
            data.selected_key_type = v.to_string();
        }
        if let Some(v) = obj
            .get("customTabs")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
        {
            data.custom_tabs = v;
        }
        if let Some(v) = obj
            .get("counterAnimationPresets")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
        {
            data.counter_animation_presets = v;
        }
        if let Some(v) = obj.get("angleMode").and_then(Value::as_str) {
            data.angle_mode = v.to_string();
        }
        if let Some(v) = obj.get("language").and_then(Value::as_str) {
            data.language = v.to_string();
        }
        if let Some(v) = obj.get("laboratoryEnabled").and_then(Value::as_bool) {
            data.laboratory_enabled = v;
        }
        if let Some(v) = obj.get("developerModeEnabled").and_then(Value::as_bool) {
            data.developer_mode_enabled = v;
        }
        if let Some(v) = obj.get("trayEnabled").and_then(Value::as_bool) {
            data.tray_enabled = v;
        }
        if let Some(v) = obj.get("autoUpdateEnabled").and_then(Value::as_bool) {
            data.auto_update_enabled = v;
        }
        if let Some(v) = obj.get("mainWindowHidden").and_then(Value::as_bool) {
            data.main_window_hidden = v;
        }
        if let Some(v) = obj
            .get("keys")
            .and_then(|v| serde_json::from_value::<KeyMappings>(v.clone()).ok())
        {
            data.keys = v;
        }
        if let Some(v) = obj
            .get("keyPositions")
            .and_then(|v| serde_json::from_value::<KeyPositions>(v.clone()).ok())
        {
            data.key_positions = v;
        }
        if let Some(v) = obj
            .get("statPositions")
            .and_then(|v| serde_json::from_value::<StatPositions>(v.clone()).ok())
        {
            data.stat_positions = v;
        }
        if let Some(v) = obj
            .get("graphPositions")
            .and_then(|v| serde_json::from_value::<GraphPositions>(v.clone()).ok())
        {
            data.graph_positions = v;
        }
        if let Some(v) = obj
            .get("keyCounters")
            .and_then(|v| serde_json::from_value::<KeyCounters>(v.clone()).ok())
        {
            data.key_counters = v;
        }
        if let Some(v) = obj.get("backgroundColor").and_then(Value::as_str) {
            data.background_color = v.to_string();
        }
        if let Some(v) = obj.get("useCustomCSS").and_then(Value::as_bool) {
            data.use_custom_css = v;
        } else if let Some(v) = obj.get("useCustomCss").and_then(Value::as_bool) {
            data.use_custom_css = v;
        }
        if let Some(v) = obj
            .get("customCSS")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
        {
            data.custom_css = v;
        } else if let Some(v) = obj
            .get("customCss")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
        {
            data.custom_css = v;
        }
        if let Some(v) = obj.get("useCustomJS").and_then(Value::as_bool) {
            data.use_custom_js = v;
        } else if let Some(v) = obj.get("useCustomJs").and_then(Value::as_bool) {
            data.use_custom_js = v;
        }
        if let Some(v) = obj
            .get("customJS")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
        {
            data.custom_js = v;
        } else if let Some(v) = obj
            .get("customJs")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
        {
            data.custom_js = v;
        }
        if let Some(v) = obj
            .get("overlayResizeAnchor")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
        {
            data.overlay_resize_anchor = v;
        }
        if let Some(v) = obj
            .get("overlayWindowBounds")
            .and_then(|v| serde_json::from_value::<LegacyOverlayBounds>(v.clone()).ok())
        {
            data.overlay_bounds = Some(OverlayBounds {
                x: v.x,
                y: v.y,
                width: v.width,
                height: v.height,
            });
        }
        if data.overlay_bounds.is_none() {
            if let Some(v) = obj
                .get("overlayWindowPosition")
                .and_then(|v| serde_json::from_value::<LegacyOverlayPosition>(v.clone()).ok())
            {
                data.overlay_bounds = Some(OverlayBounds {
                    x: v.x,
                    y: v.y,
                    width: LEGACY_OVERLAY_WIDTH,
                    height: LEGACY_OVERLAY_HEIGHT,
                });
            }
        }
        if let Some(v) = obj
            .get("overlayLastContentTopOffset")
            .and_then(Value::as_f64)
        {
            data.overlay_last_content_top_offset = Some(v);
        }
        if let Some(v) = obj.get("keyCounterEnabled").and_then(Value::as_bool) {
            data.key_counter_enabled = v;
        }
    }
    let _ = data.custom_js.normalize();
    normalize_state(data)
}

fn option_has_non_empty_text(value: &Option<String>) -> bool {
    value
        .as_ref()
        .map(|text| !text.trim().is_empty())
        .unwrap_or(false)
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
#[serde(rename_all = "camelCase")]
struct LegacyOverlayBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Deserialize)]
struct LegacyOverlayPosition {
    x: f64,
    y: f64,
}

#[cfg(test)]
mod tests {
    use super::rgba_to_hex;

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
}
