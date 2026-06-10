pub mod load;
pub mod save;

use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};

use crate::models::{
    CustomCss, CustomJs, CustomTab, DialPositions, FontSettings, GraphPositions, KeyMappings,
    KeyPositions, NoteSettings, StatPositions, TabNoteOverrides,
};

#[derive(Serialize)]
pub struct PresetOperationResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 프리셋 로드 시 프론트엔드에 원자적으로 전달되는 스냅샷
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetSnapshot {
    pub keys: KeyMappings,
    pub positions: KeyPositions,
    pub stat_positions: StatPositions,
    pub graph_positions: GraphPositions,
    pub dial_positions: DialPositions,
    pub custom_tabs: Vec<CustomTab>,
    pub selected_key_type: String,
    pub tab_note_overrides: TabNoteOverrides,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PresetFile {
    pub keys: Option<KeyMappings>,
    pub key_positions: Option<KeyPositions>,
    pub stat_positions: Option<StatPositions>,
    pub graph_positions: Option<GraphPositions>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dial_positions: Option<DialPositions>,
    pub background_color: Option<String>,
    pub note_settings: Option<NoteSettings>,
    pub note_effect: Option<bool>,
    pub laboratory_enabled: Option<bool>,
    pub custom_tabs: Option<Vec<CustomTab>>,
    pub selected_key_type: Option<String>,
    #[serde(rename = "useCustomCSS")]
    pub use_custom_css: Option<bool>,
    #[serde(rename = "customCSS")]
    pub custom_css: Option<CustomCss>,
    #[serde(rename = "useCustomJS")]
    pub use_custom_js: Option<bool>,
    #[serde(rename = "customJS")]
    pub custom_js: Option<CustomJs>,
    pub font_settings: Option<FontSettings>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_note_overrides: Option<TabNoteOverrides>,
    pub embedded_local_fonts: Option<Vec<EmbeddedLocalFont>>,
    pub embedded_local_images: Option<Vec<EmbeddedLocalImage>>,
    pub embedded_local_sounds: Option<Vec<EmbeddedLocalSound>>,
}

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EmbeddedLocalFont {
    pub font_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extension: Option<String>,
    pub data_base64: String,
}

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EmbeddedLocalImage {
    pub image_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extension: Option<String>,
    pub data_base64: String,
}

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EmbeddedLocalSound {
    pub sound_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extension: Option<String>,
    pub data_base64: String,
}

pub(crate) const PRESET_LOCAL_IMAGE_PREFIX: &str = "dmnote-local-image://";
pub(crate) const PRESET_LOCAL_SOUND_PREFIX: &str = "dmnote-local-sound://";
pub(crate) const BUILTIN_TAB_IDS: &[&str] = &["4key", "5key", "6key", "8key"];

pub(crate) fn decode_image_data_url(value: &str) -> Option<(Vec<u8>, String)> {
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

pub(crate) fn normalize_image_extension(extension: Option<&str>) -> String {
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

pub(crate) fn normalize_sound_extension(extension: Option<&str>) -> String {
    match extension
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "wav" => "wav".to_string(),
        "mp3" => "mp3".to_string(),
        "ogg" => "ogg".to_string(),
        "flac" => "flac".to_string(),
        "aac" => "aac".to_string(),
        _ => "wav".to_string(),
    }
}

pub(crate) fn normalize_font_extension(extension: Option<&str>) -> String {
    match extension
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "otf" => "otf".to_string(),
        "woff" => "woff".to_string(),
        "woff2" => "woff2".to_string(),
        "ttf" => "ttf".to_string(),
        _ => "ttf".to_string(),
    }
}

pub(crate) fn local_source_path_from_image_ref(value: &str) -> Option<PathBuf> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some(stripped) = trimmed
        .strip_prefix("file:///")
        .or_else(|| trimmed.strip_prefix("file://"))
    {
        let mut candidate = stripped.to_string();
        if cfg!(target_os = "windows") {
            if candidate.starts_with('/') && candidate.as_bytes().get(2) == Some(&b':') {
                candidate = candidate[1..].to_string();
            }
            candidate = candidate.replace('/', "\\");
        }
        return Some(PathBuf::from(candidate));
    }

    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        Some(path)
    } else {
        None
    }
}

pub(crate) fn is_remote_or_virtual_image_ref(value: &str) -> bool {
    let lower = value.trim().to_ascii_lowercase();
    lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("blob:")
        || lower.starts_with("asset:")
        || lower.starts_with("tauri:")
}

pub(crate) fn option_has_non_empty_text(value: &Option<String>) -> bool {
    value
        .as_ref()
        .map(|text| !text.trim().is_empty())
        .unwrap_or(false)
}
