pub mod load;
pub mod save;

use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};

use crate::models::{
    CustomCss, CustomJs, CustomTab, FontSettings, GraphPositions, KeyMappings, KeyPositions,
    KnobPositions, LayerGroups, NoteSettings, StatPositions, TabCssOverrides, TabNoteOverrides,
};
use crate::state::local_asset_path::{file_url_to_path, FileUrlPath};

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
    pub knob_positions: KnobPositions,
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
    pub knob_positions: Option<KnobPositions>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layer_groups: Option<LayerGroups>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_css_overrides: Option<TabCssOverrides>,
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

    match file_url_to_path(trimmed) {
        FileUrlPath::Path(path) => return Some(path),
        FileUrlPath::Invalid => return legacy_file_url_path(trimmed),
        FileUrlPath::NotFileUrl => {}
    }

    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        Some(path)
    } else {
        None
    }
}

fn legacy_file_url_path(value: &str) -> Option<PathBuf> {
    let scheme_end = value.find(':')?;
    if !value[..scheme_end].eq_ignore_ascii_case("file") {
        return None;
    }
    let remainder = &value[scheme_end + 1..];
    let stripped = remainder
        .strip_prefix("///")
        .or_else(|| remainder.strip_prefix("//"))?;
    let mut candidate = stripped.to_string();
    if cfg!(target_os = "windows") {
        if candidate.starts_with('/') && candidate.as_bytes().get(2) == Some(&b':') {
            candidate = candidate[1..].to_string();
        }
        candidate = candidate.replace('/', "\\");
    } else if remainder.starts_with("///") {
        candidate.insert(0, '/');
    }
    Some(PathBuf::from(candidate))
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

#[cfg(test)]
mod tests {
    use super::PresetFile;
    // file URL 경로 테스트가 유닉스 전용이라 Windows에선 미사용 경고 방지
    #[cfg(not(target_os = "windows"))]
    use super::local_source_path_from_image_ref;
    use crate::models::NoteColor;
    use serde_json::json;

    #[test]
    fn preset_round_trip_preserves_layer_groups_and_tab_css_overrides() {
        let value = json!({
            "layerGroups": { "4key": [] },
            "tabCssOverrides": {
                "4key": {
                    "path": "/tmp/tab.css",
                    "content": ".key { color: red; }",
                    "enabled": true
                }
            }
        });
        let preset: PresetFile = serde_json::from_value(value.clone()).unwrap();
        let serialized = serde_json::to_value(preset).unwrap();

        assert_eq!(serialized["layerGroups"], value["layerGroups"]);
        assert_eq!(serialized["tabCssOverrides"], value["tabCssOverrides"]);
    }

    #[test]
    fn legacy_preset_defaults_new_fields_to_none() {
        let preset: PresetFile = serde_json::from_value(json!({})).unwrap();

        assert!(preset.layer_groups.is_none());
        assert!(preset.tab_css_overrides.is_none());
    }

    #[test]
    fn tauri_era_preset_schema_transitions_remain_readable() {
        let tauri_130: PresetFile = serde_json::from_value(json!({
            "keys": { "custom-130": ["Q"] },
            "keyPositions": {
                "custom-130": [{
                    "dx": 12.5,
                    "dy": -3.0,
                    "width": 64.0,
                    "count": 7,
                    "displayText": "Tauri 1.3"
                }]
            },
            "backgroundColor": "#112233",
            "noteSettings": { "speed": 321, "trackHeight": 222 },
            "noteEffect": false,
            "laboratoryEnabled": true,
            "customTabs": [{ "id": "custom-130", "name": "Old tab" }],
            "selectedKeyType": "custom-130",
            "useCustomCSS": true,
            "customCSS": { "path": "/tmp/old.css", "content": ".old {}" }
        }))
        .expect("1.3.0 preset must deserialize");

        assert_eq!(tauri_130.keys.as_ref().unwrap()["custom-130"], ["Q"]);
        let old_position = &tauri_130.key_positions.as_ref().unwrap()["custom-130"][0];
        assert_eq!(old_position.dx, 12.5);
        assert_eq!(old_position.dy, -3.0);
        assert_eq!(old_position.width, 64.0);
        assert_eq!(old_position.count, 7);
        assert_eq!(old_position.display_text.as_deref(), Some("Tauri 1.3"));
        assert_eq!(tauri_130.background_color.as_deref(), Some("#112233"));
        assert_eq!(tauri_130.note_settings.as_ref().unwrap().speed, 321);
        assert_eq!(tauri_130.note_settings.as_ref().unwrap().track_height, 222);
        assert_eq!(tauri_130.note_effect, Some(false));
        assert_eq!(tauri_130.laboratory_enabled, Some(true));
        assert_eq!(tauri_130.custom_tabs.as_ref().unwrap()[0].id, "custom-130");
        assert_eq!(tauri_130.selected_key_type.as_deref(), Some("custom-130"));
        assert_eq!(tauri_130.use_custom_css, Some(true));
        assert_eq!(tauri_130.custom_css.as_ref().unwrap().content, ".old {}");

        let transition_fixtures = [
            (
                "1.4.0",
                json!({
                    "keys": { "4key": ["Q"] },
                    "keyPositions": {},
                    "useCustomJS": true,
                    "customJS": { "path": null, "content": "void 0", "plugins": [] }
                }),
            ),
            (
                "1.5.1",
                json!({
                    "keys": { "4key": ["Q"] },
                    "keyPositions": {},
                    "statPositions": {},
                    "fontSettings": { "customFonts": [] },
                    "embeddedLocalFonts": [],
                    "embeddedLocalImages": []
                }),
            ),
            (
                "1.6.0",
                json!({
                    "keys": { "4key": ["Q"] },
                    "keyPositions": {},
                    "statPositions": {},
                    "graphPositions": {},
                    "tabNoteOverrides": {},
                    "embeddedLocalSounds": []
                }),
            ),
        ];

        for (version, fixture) in transition_fixtures {
            let preset: PresetFile = serde_json::from_value(fixture)
                .unwrap_or_else(|error| panic!("{version} preset must deserialize: {error}"));
            assert_eq!(preset.keys.as_ref().unwrap()["4key"], vec!["Q"]);
        }

        let tauri_161: PresetFile = serde_json::from_value(json!({
            "keys": { "custom-161": ["W"] },
            "keyPositions": {
                "custom-161": [{
                    "dx": 10.0,
                    "dy": 20.0,
                    "width": 70.0,
                    "height": 80.0,
                    "count": 9,
                    "groupId": "historic-group",
                    "activeImage": "dmnote-local-image://image-1",
                    "soundPath": "dmnote-local-sound://sound-1"
                }]
            },
            "statPositions": {
                "custom-161": [{
                    "statType": "total",
                    "dx": 1.0,
                    "dy": 2.0,
                    "width": 100.0,
                    "count": 0
                }]
            },
            "graphPositions": {
                "custom-161": [{
                    "statType": "kpsAvg",
                    "graphType": "line",
                    "graphSpeed": 4,
                    "graphColor": "#abcdef",
                    "dx": 3.0,
                    "dy": 4.0,
                    "width": 120.0,
                    "count": 0
                }]
            },
            "knobPositions": {
                "custom-161": [{
                    "axisId": "HIDA:1:2:3:4",
                    "sensitivity": 1.5,
                    "reverse": true,
                    "dx": 5.0,
                    "dy": 6.0,
                    "width": 90.0,
                    "count": 0
                }]
            },
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
            },
            "fontSettings": {
                "customFonts": [{
                    "id": "font-1",
                    "type": "local",
                    "name": "LegacyFont",
                    "displayName": "Legacy Font",
                    "enabled": true,
                    "localPath": null,
                    "cssContent": null
                }]
            },
            "tabNoteOverrides": {
                "custom-161": { "speed": 444, "reverse": true }
            },
            "embeddedLocalFonts": [{
                "fontId": "font-1",
                "extension": "ttf",
                "dataBase64": "AA=="
            }],
            "embeddedLocalImages": [{
                "imageId": "image-1",
                "extension": "png",
                "dataBase64": "AA=="
            }],
            "embeddedLocalSounds": [{
                "soundId": "sound-1",
                "extension": "wav",
                "dataBase64": "AA=="
            }]
        }))
        .expect("1.6.1 preset must deserialize");

        assert_eq!(tauri_161.keys.as_ref().unwrap()["custom-161"], ["W"]);
        let position_161 = &tauri_161.key_positions.as_ref().unwrap()["custom-161"][0];
        assert_eq!(position_161.group_id.as_deref(), Some("historic-group"));
        assert_eq!(
            position_161.active_image.as_deref(),
            Some("dmnote-local-image://image-1")
        );
        assert_eq!(
            position_161.sound_path.as_deref(),
            Some("dmnote-local-sound://sound-1")
        );
        assert_eq!(
            tauri_161.stat_positions.as_ref().unwrap()["custom-161"].len(),
            1
        );
        assert_eq!(
            tauri_161.graph_positions.as_ref().unwrap()["custom-161"][0].graph_speed,
            4
        );
        assert_eq!(
            tauri_161.knob_positions.as_ref().unwrap()["custom-161"][0].axis_id,
            "HIDA:1:2:3:4"
        );
        assert_eq!(
            tauri_161.custom_js.as_ref().unwrap().plugins[0].id,
            "plugin-161"
        );
        assert_eq!(
            tauri_161.font_settings.as_ref().unwrap().custom_fonts[0].id,
            "font-1"
        );
        assert_eq!(
            tauri_161.tab_note_overrides.as_ref().unwrap()["custom-161"].speed,
            Some(444)
        );
        assert_eq!(
            tauri_161.embedded_local_fonts.as_ref().unwrap()[0].font_id,
            "font-1"
        );
        assert_eq!(
            tauri_161.embedded_local_images.as_ref().unwrap()[0].image_id,
            "image-1"
        );
        assert_eq!(
            tauri_161.embedded_local_sounds.as_ref().unwrap()[0].sound_id,
            "sound-1"
        );
    }

    #[test]
    fn internal_editor_revision_never_becomes_part_of_a_preset() {
        let preset: PresetFile = serde_json::from_value(json!({
            "keys": { "4key": ["Q"] },
            "editorRevision": 42
        }))
        .unwrap();
        let serialized = serde_json::to_value(preset).unwrap();

        assert!(serialized.get("editorRevision").is_none());
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn file_url_image_source_preserves_its_absolute_path() {
        assert_eq!(
            local_source_path_from_image_ref("file:///tmp/dmnote-image.png"),
            Some(std::path::PathBuf::from("/tmp/dmnote-image.png"))
        );
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn file_url_image_source_decodes_percent_sequences_only() {
        assert_eq!(
            local_source_path_from_image_ref(
                "file:///tmp/Application%20Support/%ED%95%9C%EA%B8%80%25+a.png"
            ),
            Some(std::path::PathBuf::from(
                "/tmp/Application Support/한글%+a.png"
            ))
        );
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn invalid_file_url_uses_legacy_literal_path_for_preset_compatibility() {
        assert_eq!(
            local_source_path_from_image_ref("file://[invalid/path.png"),
            Some(std::path::PathBuf::from("[invalid/path.png"))
        );
        assert_eq!(
            local_source_path_from_image_ref("file:///tmp/broken%ZZ.png"),
            Some(std::path::PathBuf::from("/tmp/broken%ZZ.png"))
        );
    }

    #[test]
    fn preset_1_0_fixture_preserves_values_and_fills_visual_defaults() {
        // 1.0.0이 실제 저장하던 프리셋 형식 — height/noteColor/noteOpacity 없음
        let fixture = r#"{
            "keys": {
                "4key": ["Q"],
                "5key": [],
                "6key": [],
                "8key": []
            },
            "keyPositions": {
                "4key": [
                    {
                        "dx": 777,
                        "dy": 130,
                        "width": 60,
                        "activeImage": "",
                        "inactiveImage": "",
                        "count": 42
                    }
                ],
                "5key": [],
                "6key": [],
                "8key": []
            },
            "backgroundColor": "transparent"
        }"#;
        let preset: PresetFile = serde_json::from_str(fixture).unwrap();
        let positions = preset.key_positions.unwrap();
        let position = &positions["4key"][0];

        assert_eq!(position.dx, 777.0);
        assert_eq!(position.count, 42);
        assert_eq!(position.height, 60.0);
        assert_eq!(position.note_color, NoteColor::Solid("#FFFFFF".to_string()));
        assert_eq!(position.note_opacity, 80);
    }
}
