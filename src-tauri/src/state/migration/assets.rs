use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use anyhow::Result;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

use super::super::{
    assets::image_asset::{import_image_bytes, import_image_file, probe_local_raster_size},
    assets::local_asset_path::{file_url_to_path, path_identity_key, FileUrlPath},
};
use crate::{
    models::{
        is_renderable_image_ref, rewrite_coupled_sprite_image_reference, AppStoreData, FontType,
        FontWeightRange, KeyPosition, SoundLibraryEntry, SpriteImageMetrics, SpritePositions,
        SpriteReferenceNaturalSize,
    },
    services::font_metadata::parse_font_metadata,
};

const APP_DATA_MARKER: &str = "com.dmnote.desktop";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum AssetCategory {
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
    }) || data.sprite_positions.values().any(|sprites| {
        sprites.iter().any(|sprite| {
            option_has_non_empty_text(&sprite.base_image)
                || sprite
                    .poses
                    .iter()
                    .any(|pose| option_has_non_empty_text(&pose.image_override))
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

    for sprites in data.sprite_positions.values_mut() {
        for sprite in sprites {
            changed |= rewrite_coupled_sprite_image_reference(sprite, |image_ref| {
                migrate_image_reference_to_app_data(&images_dir, image_ref)
            });
            for pose in &mut sprite.poses {
                changed |= rewrite_coupled_sprite_image_reference(pose, |image_ref| {
                    migrate_image_reference_to_app_data(&images_dir, image_ref)
                });
            }
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
    for sprites in data.sprite_positions.values_mut() {
        for sprite in sprites {
            changed |= rewrite_coupled_sprite_image_reference(sprite, |image_ref| {
                rehome_optional_asset_reference(app_data_dir, image_ref)
            });
            for pose in &mut sprite.poses {
                changed |= rewrite_coupled_sprite_image_reference(pose, |image_ref| {
                    rehome_optional_asset_reference(app_data_dir, image_ref)
                });
            }
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

pub(crate) fn fill_missing_sprite_image_metrics(sprite_positions: &mut SpritePositions) -> bool {
    let mut changed = false;
    for sprite in sprite_positions.values_mut().flatten() {
        let sprite_id = if sprite.id.is_empty() {
            "<missing>".to_string()
        } else {
            sprite.id.clone()
        };
        if sprite.reference_natural_size.is_none() {
            if let Some((source, (width, height))) = sprite
                .base_image
                .as_deref()
                .filter(|source| is_renderable_image_ref(Some(source)))
                .and_then(|source| {
                    probe_sprite_image_metrics(&sprite_id, source).map(|size| (source, size))
                })
            {
                sprite.reference_natural_size = Some(SpriteReferenceNaturalSize {
                    source: Some(source.to_string()),
                    width,
                    height,
                });
                changed = true;
            }
        }
        for pose in &mut sprite.poses {
            if pose.image_override_metrics.is_some() {
                continue;
            }
            if let Some((source, (width, height))) = pose
                .image_override
                .as_deref()
                .filter(|source| is_renderable_image_ref(Some(source)))
                .and_then(|source| {
                    probe_sprite_image_metrics(&sprite_id, source).map(|size| (source, size))
                })
            {
                pose.image_override_metrics = Some(SpriteImageMetrics {
                    source: source.to_string(),
                    width,
                    height,
                });
                changed = true;
            }
        }
    }
    changed
}

fn probe_sprite_image_metrics(sprite_id: &str, source: &str) -> Option<(u32, u32)> {
    match probe_local_raster_size(source) {
        Ok(size) => size,
        Err(error) => {
            log::warn!(
                "[SpriteMigration] 로컬 래스터 크기 읽기 실패: sprite_id={sprite_id}, path={source}, error={error:#}"
            );
            None
        }
    }
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

pub(super) fn parse_portable_asset_reference(raw: &str) -> Option<(AssetCategory, String)> {
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

fn option_has_non_empty_text(value: &Option<String>) -> bool {
    value
        .as_ref()
        .map(|text| !text.trim().is_empty())
        .unwrap_or(false)
}

pub(super) fn decode_font_data_url(
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

pub(super) fn normalize_font_extension(extension: Option<&str>) -> &'static str {
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

pub(super) fn decode_image_data_url(value: &str) -> Option<(Vec<u8>, String)> {
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

pub(super) fn normalize_image_extension(extension: Option<&str>) -> String {
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
