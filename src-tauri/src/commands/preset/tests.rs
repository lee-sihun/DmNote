use super::PresetFile;
// file URL 경로 테스트가 유닉스 전용이라 Windows에선 미사용 경고 방지
#[cfg(not(target_os = "windows"))]
use super::local_source_path_from_image_ref;
use crate::models::{KeyCounterColor, KeySlot, NoteColor};
use serde::{Deserialize, Serialize};
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
fn legacy_preset_positions_default_new_surface_gradients_to_none() {
    let preset: PresetFile = serde_json::from_value(json!({
        "keyPositions": {
            "4key": [{
                "dx": 0,
                "dy": 0,
                "width": 60,
                "count": 0,
                "noteBorderColor": "#112233"
            }]
        }
    }))
    .unwrap();
    let position = &preset.key_positions.as_ref().unwrap()["4key"][0];

    assert!(position.note_gradient.is_none());
    assert!(position.note_glow_gradient.is_none());
    assert!(position.note_border_gradient.is_none());
    assert!(position.font_gradient.is_none());
    assert!(position.active_font_gradient.is_none());
}

#[test]
fn preset_wire_schema_excludes_internal_store_fields() {
    let serialized = serde_json::to_value(PresetFile::default()).unwrap();

    assert!(serialized.get("customCssHistory").is_none());
    assert!(serialized.get("panelBounds").is_none());
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreFeaturePresetPosition {
    dx: f64,
    dy: f64,
    width: f64,
    count: u32,
    background_color: Option<String>,
    font_color: Option<String>,
    active_font_color: Option<String>,
    note_color: NoteColor,
    note_opacity: u32,
    note_opacity_top: Option<u32>,
    note_opacity_bottom: Option<u32>,
    note_glow_color: Option<NoteColor>,
    note_glow_opacity: u32,
    note_glow_opacity_top: Option<u32>,
    note_glow_opacity_bottom: Option<u32>,
    note_border_color: Option<String>,
    counter: PreFeaturePresetCounter,
}

#[derive(Serialize, Deserialize)]
struct PreFeaturePresetCounter {
    fill: KeyCounterColor,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreFeaturePreset {
    key_positions: Option<std::collections::HashMap<String, Vec<PreFeaturePresetPosition>>>,
}

#[test]
fn gradient_preset_round_trip_and_pre_feature_shadow_preserve_representative_colors() {
    let source = json!({
        "keys": { "4key": ["Q"] },
        "keyPositions": {
            "4key": [{
                "dx": 0,
                "dy": 0,
                "width": 60,
                "count": 0,
                "backgroundColor": "rgba(16, 32, 48, 1)",
                "backgroundGradient": {
                    "angle": 90,
                    "stops": [
                        { "color": "rgba(16, 32, 48, 1)", "pos": 0 },
                        { "color": "rgba(64, 80, 96, 0.5)", "pos": 1 }
                    ]
                },
                "fontColor": "#123456",
                "fontGradient": {
                    "angle": 45,
                    "stops": [
                        { "color": "#123456", "pos": 0 },
                        { "color": "#ABCDEF", "pos": 1 }
                    ]
                },
                "activeFontColor": "#654321",
                "activeFontGradient": {
                    "angle": 135,
                    "stops": [
                        { "color": "#654321", "pos": 0 },
                        { "color": "#FEDCBA", "pos": 1 }
                    ]
                },
                "counter": {
                    "fill": {
                        "idle": "rgba(255,255,255,1)",
                        "active": "rgba(20,20,24,0.9)"
                    },
                    "fillIdleGradient": {
                        "angle": 180,
                        "stops": [
                            { "color": "#FFFFFF", "pos": 0 },
                            { "color": "#000000", "pos": 1 }
                        ]
                    }
                }
            }]
        }
    });
    let preset: PresetFile = serde_json::from_value(source).unwrap();
    let serialized = serde_json::to_value(&preset).unwrap();
    let restored: PresetFile = serde_json::from_value(serialized.clone()).unwrap();
    let reserialized = serde_json::to_value(restored).unwrap();

    assert_eq!(reserialized, serialized);
    assert_eq!(
        serialized["keyPositions"]["4key"][0]["backgroundGradient"]["angle"].as_f64(),
        Some(90.0)
    );
    assert_eq!(
        serialized["keyPositions"]["4key"][0]["fontGradient"]["angle"].as_f64(),
        Some(45.0)
    );
    assert_eq!(
        serialized["keyPositions"]["4key"][0]["counter"]["fillIdleGradient"]["angle"].as_f64(),
        Some(180.0)
    );

    let shadow: PreFeaturePreset = serde_json::from_value(serialized).unwrap();
    let shadow_positions = shadow.key_positions.unwrap();
    let shadow_position = &shadow_positions["4key"][0];
    assert_eq!(
        shadow_position.background_color.as_deref(),
        Some("rgba(16, 32, 48, 1)")
    );
    assert_eq!(shadow_position.font_color.as_deref(), Some("#123456"));
    assert_eq!(
        shadow_position.active_font_color.as_deref(),
        Some("#654321")
    );
    assert_eq!(shadow_position.counter.fill.idle, "rgba(255,255,255,1)");
}

#[test]
fn preset_1_6_1_shadow_round_trip_drops_new_gradients_but_keeps_representatives() {
    let source = json!({
        "keys": { "4key": ["Q"] },
        "keyPositions": {
            "4key": [{
                "dx": 0,
                "dy": 0,
                "width": 60,
                "count": 0,
                "noteColor": {
                    "type": "gradient",
                    "top": "#112233",
                    "bottom": "#445566"
                },
                "noteOpacity": 80,
                "noteOpacityTop": 40,
                "noteOpacityBottom": 20,
                "noteGradient": {
                    "angle": 45,
                    "stops": [
                        { "color": "rgba(17,34,51,.5)", "pos": 0 },
                        { "color": "#44556640", "pos": 1 }
                    ]
                },
                "noteGlowColor": {
                    "type": "gradient",
                    "top": "#778899",
                    "bottom": "#AABBCC"
                },
                "noteGlowOpacity": 60,
                "noteGlowOpacityTop": 30,
                "noteGlowOpacityBottom": 60,
                "noteGlowGradient": {
                    "angle": 135,
                    "stops": [
                        { "color": "#77889980", "pos": 0 },
                        { "color": "rgb(170,187,204)", "pos": 1 }
                    ]
                },
                "noteBorderColor": "#112233",
                "noteBorderGradient": {
                    "angle": 90,
                    "stops": [
                        { "color": "rgba(17, 34, 51, .5)", "pos": 0 },
                        { "color": "#ABC8", "pos": 1 }
                    ]
                },
                "fontColor": "#123456",
                "fontGradient": {
                    "angle": 90,
                    "stops": [
                        { "color": "#123456", "pos": 0 },
                        { "color": "#ABCDEF", "pos": 1 }
                    ]
                },
                "activeFontColor": "#654321",
                "activeFontGradient": {
                    "angle": 135,
                    "stops": [
                        { "color": "#654321", "pos": 0 },
                        { "color": "#FEDCBA", "pos": 1 }
                    ]
                },
                "counter": {
                    "fill": {
                        "idle": "rgba(255,255,255,1)",
                        "active": "rgba(20,20,24,0.9)"
                    }
                }
            }]
        }
    });
    let current: PresetFile = serde_json::from_value(source).unwrap();
    let current_wire = serde_json::to_value(current).unwrap();

    let old: PreFeaturePreset = serde_json::from_value(current_wire).unwrap();
    let old_wire = serde_json::to_value(old).unwrap();
    let restored: PresetFile = serde_json::from_value(old_wire.clone()).unwrap();
    let position = &restored.key_positions.as_ref().unwrap()["4key"][0];

    assert!(old_wire["keyPositions"]["4key"][0]
        .get("noteGradient")
        .is_none());
    assert!(old_wire["keyPositions"]["4key"][0]
        .get("noteGlowGradient")
        .is_none());
    assert!(old_wire["keyPositions"]["4key"][0]
        .get("noteBorderGradient")
        .is_none());
    assert!(old_wire["keyPositions"]["4key"][0]
        .get("fontGradient")
        .is_none());
    assert!(old_wire["keyPositions"]["4key"][0]
        .get("activeFontGradient")
        .is_none());
    assert!(position.note_gradient.is_none());
    assert!(position.note_glow_gradient.is_none());
    assert!(position.note_border_gradient.is_none());
    assert!(position.font_gradient.is_none());
    assert!(position.active_font_gradient.is_none());
    assert_eq!(
        position.note_color,
        NoteColor::Gradient {
            top: "#112233".to_string(),
            bottom: "#445566".to_string(),
        }
    );
    assert_eq!(position.note_opacity, 80);
    assert_eq!(position.note_opacity_top, Some(40));
    assert_eq!(position.note_opacity_bottom, Some(20));
    assert_eq!(
        position.note_glow_color,
        Some(NoteColor::Gradient {
            top: "#778899".to_string(),
            bottom: "#AABBCC".to_string(),
        })
    );
    assert_eq!(position.note_glow_opacity, 60);
    assert_eq!(position.note_glow_opacity_top, Some(30));
    assert_eq!(position.note_glow_opacity_bottom, Some(60));
    assert_eq!(position.note_border_color.as_deref(), Some("#112233"));
    assert_eq!(position.font_color.as_deref(), Some("#123456"));
    assert_eq!(position.active_font_color.as_deref(), Some("#654321"));
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

    assert_eq!(
        tauri_130.keys.as_ref().unwrap()["custom-130"],
        vec![KeySlot::from("Q")]
    );
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
        assert_eq!(
            preset.keys.as_ref().unwrap()["4key"],
            vec![KeySlot::from("Q")]
        );
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

    assert_eq!(
        tauri_161.keys.as_ref().unwrap()["custom-161"],
        [KeySlot::from("W")]
    );
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
    assert_eq!(position.note_opacity, 90);
}
