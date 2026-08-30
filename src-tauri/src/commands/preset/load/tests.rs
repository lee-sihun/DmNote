use super::*;
use crate::{
    defaults::{default_keys, default_positions},
    models::{
        CustomCssHistoryEntry, CustomFont, FontWeightRange, GraphPosition, GraphStatType,
        GraphType, JsPlugin, KnobPosition, StatPosition, StatType,
    },
};

#[test]
fn full_preset_settings_patch_preserves_custom_css_history() {
    let history = vec![CustomCssHistoryEntry {
        path: "/tmp/preserved.css".to_string(),
        loaded_at: 123,
        last_used_at: 123,
    }];
    let mut store = AppStoreData {
        custom_css_history: history.clone(),
        ..AppStoreData::default()
    };
    let mut preset = PresetFile {
        use_custom_css: Some(true),
        custom_css: Some(CustomCss {
            path: Some("/tmp/preset.css".to_string()),
            content: "body {}".to_string(),
        }),
        ..PresetFile::default()
    };
    let resolved = resolve_full_preset_settings(&mut preset, &store);
    let patch = SettingsPatchInput {
        use_custom_css: Some(resolved.use_custom_css),
        custom_css: Some(CustomCssPatch {
            path: Some(resolved.custom_css.path),
            content: Some(resolved.custom_css.content),
        }),
        ..SettingsPatchInput::default()
    };

    apply_patch_to_store(&mut store, &patch);

    assert_eq!(store.custom_css_history, history);
}

#[test]
fn committed_preset_css_paths_exclude_unrelated_store_paths() {
    let mut committed = AppStoreData {
        custom_css: CustomCss {
            path: Some("/tmp/unrelated-global.css".to_string()),
            content: String::new(),
        },
        ..AppStoreData::default()
    };
    committed.tab_css_overrides.insert(
        "4key".to_string(),
        TabCss {
            path: Some("/tmp/imported-tab.css".to_string()),
            content: String::new(),
            enabled: true,
        },
    );
    committed.tab_css_overrides.insert(
        "7key".to_string(),
        TabCss {
            path: Some("/tmp/unrelated.css".to_string()),
            content: String::new(),
            enabled: true,
        },
    );
    let imported = ImportedCssPaths {
        global: None,
        tabs: vec![
            "/tmp/imported-tab.css".to_string(),
            "/tmp/not-committed.css".to_string(),
        ],
    };

    assert_eq!(
        committed_preset_css_paths(&committed, &imported),
        vec!["/tmp/imported-tab.css".to_string()]
    );

    let imported_with_global = ImportedCssPaths {
        global: Some("/tmp/unrelated-global.css".to_string()),
        tabs: imported.tabs,
    };
    assert_eq!(
        committed_preset_css_paths(&committed, &imported_with_global),
        vec![
            "/tmp/imported-tab.css".to_string(),
            "/tmp/unrelated-global.css".to_string(),
        ]
    );
}

#[test]
fn preset_source_bytes_remain_unchanged_on_success_and_parse_failure() {
    let temp_dir = std::env::temp_dir().join(format!(
        "dmnote-preset-read-only-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let source_path = temp_dir.join("source.json");

    let valid_source = br#"{
  "keys": { "custom": ["Q"] },
  "keyPositions": {
    "custom": [{ "dx": 12.5, "dy": -4.0, "width": 61.0, "count": 3 }]
  },
  "customJS": {
    "path": null,
    "content": "globalThis.oldPreset = true",
    "plugins": [{
      "id": "plugin-source",
      "name": "Source plugin",
      "path": null,
      "content": "void 0",
      "enabled": true
    }]
  },
  "embeddedLocalImages": [{
    "imageId": "image-source",
    "extension": "png",
    "dataBase64": "AA=="
  }]
}"#;
    std::fs::write(&source_path, valid_source).unwrap();
    let parsed = read_preset_file(&source_path).unwrap();
    assert_eq!(
        parsed.keys.as_ref().unwrap()["custom"],
        [KeySlot::from("Q")]
    );
    assert_eq!(parsed.key_positions.as_ref().unwrap()["custom"][0].dx, 12.5);
    assert_eq!(
        parsed.custom_js.as_ref().unwrap().plugins[0].id,
        "plugin-source"
    );
    assert_eq!(
        parsed.embedded_local_images.as_ref().unwrap()[0].image_id,
        "image-source"
    );
    assert_eq!(std::fs::read(&source_path).unwrap(), valid_source);

    let invalid_source = b"{ invalid preset";
    std::fs::write(&source_path, invalid_source).unwrap();
    assert!(read_preset_file(&source_path).is_err());
    assert_eq!(std::fs::read(&source_path).unwrap(), invalid_source);

    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
fn preset_missing_note_gradient_multipliers_default_to_one_hundred() {
    let temp_dir = std::env::temp_dir().join(format!(
        "dmnote-preset-note-gradient-default-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let source_path = temp_dir.join("source.json");
    let source = serde_json::json!({
        "keyPositions": {
            "custom": [{
                "dx": 0,
                "dy": 0,
                "width": 60,
                "count": 0,
                "noteGradient": {
                    "angle": 45,
                    "stops": [
                        { "color": "#112233", "pos": 0 },
                        { "color": "#445566", "pos": 1 }
                    ]
                },
                "noteGlowGradient": {
                    "angle": 135,
                    "stops": [
                        { "color": "#778899", "pos": 0 },
                        { "color": "#AABBCC", "pos": 1 }
                    ]
                }
            }]
        }
    });
    std::fs::write(&source_path, serde_json::to_vec_pretty(&source).unwrap()).unwrap();

    let parsed = read_preset_file(&source_path).unwrap();
    let positions = parsed.key_positions.unwrap();
    let position = &positions["custom"][0];
    assert_eq!(position.note_opacity, 100);
    assert_eq!(position.note_glow_opacity, 100);

    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
fn preset_removed_outline_fields_scrub_and_block_legacy_default_collision() {
    let temp_dir = std::env::temp_dir().join(format!(
        "dmnote-preset-removed-outline-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let source_path = temp_dir.join("source.json");
    let source = serde_json::json!({
        "keyPositions": {
            "custom": [{
                "dx": 0,
                "dy": 0,
                "width": 60,
                "count": 0,
                "fontStrokeColor": "#112233",
                "activeFontStrokeColor": "#445566",
                "counter": {
                    "enabled": true,
                    "placement": "inside",
                    "align": "top",
                    "alignMode": "center",
                    "fill": { "idle": "#FFFFFF", "active": "#000000" },
                    "stroke": { "idle": "#000000", "active": "#FFFFFF" },
                    "strokeIdleGradient": {
                        "angle": 90,
                        "stops": [
                            { "color": "#000000", "pos": 0 },
                            { "color": "#FFFFFF", "pos": 1 }
                        ]
                    },
                    "gap": 6,
                    "fontSize": 16,
                    "fontWeight": 400,
                    "fontItalic": false,
                    "fontUnderline": false,
                    "fontStrikethrough": false
                }
            }]
        }
    });
    std::fs::write(&source_path, serde_json::to_vec_pretty(&source).unwrap()).unwrap();

    let parsed = read_preset_file(&source_path).unwrap();
    let position = &parsed.key_positions.unwrap()["custom"][0];
    let mut counter = position.counter.clone();
    assert_eq!(counter.fill.idle, "rgba(255,255,255,1)");
    assert_eq!(counter.align, crate::models::KeyCounterAlign::Top);

    let serialized = serde_json::to_value(&counter).unwrap();
    assert!(serialized.get("stroke").is_none());
    assert!(serialized.get("strokeIdleGradient").is_none());
    assert!(!counter.migrate_legacy_defaults());
    assert_eq!(counter.align, crate::models::KeyCounterAlign::Top);

    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
fn damaged_gradient_preset_reports_element_and_field_with_existing_error_code() {
    let temp_dir = std::env::temp_dir().join(format!(
        "dmnote-preset-gradient-error-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let source_path = temp_dir.join("source.json");
    let damaged_gradient = serde_json::json!({
        "angle": 90,
        "stops": [{ "color": "#FFFFFF", "pos": 0 }]
    });

    for (collection, field, counter_field) in [
        ("keyPositions", "backgroundGradient", false),
        ("statPositions", "activeBackgroundGradient", false),
        ("graphPositions", "borderGradient", false),
        ("knobPositions", "activeBorderGradient", false),
        ("keyPositions", "fontGradient", false),
        ("statPositions", "activeFontGradient", false),
        ("keyPositions", "noteBorderGradient", false),
        ("keyPositions", "fillIdleGradient", true),
        ("statPositions", "fillActiveGradient", true),
    ] {
        let mut gradient_fields = serde_json::Map::new();
        gradient_fields.insert(field.to_string(), damaged_gradient.clone());
        let damaged_entry = if counter_field {
            let mut entry = serde_json::Map::new();
            entry.insert(
                "counter".to_string(),
                serde_json::Value::Object(gradient_fields),
            );
            serde_json::Value::Object(entry)
        } else {
            serde_json::Value::Object(gradient_fields)
        };
        let mut modes = serde_json::Map::new();
        modes.insert(
            "custom mode".to_string(),
            serde_json::json!([{}, damaged_entry]),
        );
        let mut preset = serde_json::Map::new();
        preset.insert(collection.to_string(), serde_json::Value::Object(modes));
        std::fs::write(
            &source_path,
            serde_json::to_vec(&serde_json::Value::Object(preset)).unwrap(),
        )
        .unwrap();

        let error = read_preset_file(&source_path)
            .err()
            .expect("damaged gradient preset must be rejected")
            .to_string();
        let field_path = if counter_field {
            format!("counter.{field}")
        } else {
            field.to_string()
        };
        let expected_prefix =
            format!("invalid-preset: {collection}[\"custom mode\"][1].{field_path}: ");
        assert!(
            error.starts_with(&expected_prefix),
            "unexpected gradient error: {error}"
        );
        assert!(error.contains("gradient must contain at least two stops"));
    }

    std::fs::write(&source_path, b"{ invalid preset").unwrap();
    assert_eq!(
        read_preset_file(&source_path)
            .err()
            .expect("invalid JSON preset must be rejected")
            .to_string(),
        "invalid-preset"
    );

    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
fn preset_rejects_out_of_range_image_transform_with_path() {
    let preset = serde_json::json!({
        "keyPositions": {
            "custom mode": [{
                "idleImageTransform": {
                    "offsetX": 0, "offsetY": 0, "rotation": 0, "scale": 0.05
                }
            }]
        }
    });
    assert_eq!(
            invalid_position_style_detail(&preset).as_deref(),
            Some(
                "keyPositions[\"custom mode\"][0].idleImageTransform.scale: must be a finite number between 0.1 and 10"
            )
        );

    let valid = serde_json::json!({
        "keyPositions": {
            "custom mode": [{
                "idleImageTransform": null,
                "activeImageTransform": {
                    "offsetX": -500, "offsetY": 500, "rotation": 180, "scale": 10
                }
            }]
        }
    });
    assert_eq!(invalid_position_style_detail(&valid), None);
}

#[test]
fn general_gradient_preset_rejects_blank_stop_color_with_index() {
    // 공백 stop은 로드 복구가 수렴하지 않는 손상 값 - 문에서 거부
    for field in ["fontGradient", "backgroundGradient", "borderGradient"] {
        let preset = serde_json::json!({
            "keyPositions": {
                "custom mode": [{
                    (field): {
                        "angle": 45,
                        "stops": [
                            { "color": "   ", "pos": 0 },
                            { "color": "#445566", "pos": 1 }
                        ]
                    }
                }]
            }
        });

        assert_eq!(
            invalid_position_style_detail(&preset).as_deref(),
            Some(
                format!(
                    "keyPositions[\"custom mode\"][0].{field}: stops[0].color must not be blank"
                )
                .as_str()
            )
        );
    }

    let valid = serde_json::json!({
        "keyPositions": {
            "custom mode": [{
                "fontGradient": {
                    "angle": 45,
                    "stops": [
                        { "color": "#112233", "pos": 0 },
                        { "color": "#445566", "pos": 1 }
                    ]
                }
            }]
        }
    });
    assert_eq!(invalid_position_style_detail(&valid), None);
}

#[test]
fn note_border_gradient_preset_rejects_invalid_stop_color_with_index() {
    for collection in POSITION_COLLECTION_FIELDS {
        let preset = serde_json::json!({
            (collection): {
                "custom mode": [{
                    "noteBorderGradient": {
                        "angle": 90,
                        "stops": [
                            { "color": "#112233", "pos": 0 },
                            { "color": "transparent", "pos": 1 }
                        ]
                    }
                }]
            }
        });

        let error = invalid_position_style_detail(&preset)
            .expect("unsupported note border stop color must be rejected");
        assert_eq!(
                error,
                format!(
                    "{collection}[\"custom mode\"][0].noteBorderGradient: stops[1].color contains an unsupported note border color"
                )
            );
    }

    for collection in POSITION_COLLECTION_FIELDS {
        for field in ["noteGradient", "noteGlowGradient"] {
            let preset = serde_json::json!({
                (collection): {
                    "custom mode": [{
                        (field): {
                            "angle": 90,
                            "stops": [
                                { "color": "#112233", "pos": 0 },
                                { "color": "transparent", "pos": 1 }
                            ]
                        }
                    }]
                }
            });

            assert_eq!(
                    invalid_position_style_detail(&preset).as_deref(),
                    Some(
                        format!(
                            "{collection}[\"custom mode\"][0].{field}: stops[1].color contains an unsupported note gradient color"
                        )
                        .as_str()
                    )
                );
        }
    }

    let valid = serde_json::json!({
        "keyPositions": {
            "custom mode": [{
                "noteGradient": {
                    "angle": 45,
                    "stops": [
                        { "color": "#1238", "pos": 0 },
                        { "color": "rgb(4, 5, 6)", "pos": 1 }
                    ]
                },
                "noteGlowGradient": {
                    "angle": 135,
                    "stops": [
                        { "color": "rgba(7, 8, 9, .25)", "pos": 0 },
                        { "color": "#ABC", "pos": 1 }
                    ]
                },
                "noteBorderGradient": {
                    "angle": 90,
                    "stops": [
                        { "color": "rgba(17, 34, 51, .5)", "pos": 0 },
                        { "color": "#ABC8", "pos": 1 }
                    ]
                }
            }]
        }
    });
    assert_eq!(invalid_position_style_detail(&valid), None);

    let invalid_discarded_stop = serde_json::json!({
        "keyPositions": {
            "custom mode": [{
                "noteBorderGradient": {
                    "angle": 90,
                    "stops": [
                        { "color": "#000000", "pos": 0.0 },
                        { "color": "#111111", "pos": 0.1 },
                        { "color": "#222222", "pos": 0.2 },
                        { "color": "#333333", "pos": 0.3 },
                        { "color": "#444444", "pos": 0.4 },
                        { "color": "#555555", "pos": 0.5 },
                        { "color": "#666666", "pos": 0.6 },
                        { "color": "#777777", "pos": 0.7 },
                        { "color": "invalid-discarded-stop", "pos": 1.0 }
                    ]
                }
            }]
        }
    });
    assert_eq!(
            invalid_position_style_detail(&invalid_discarded_stop).as_deref(),
            Some(
                "keyPositions[\"custom mode\"][0].noteBorderGradient: stops[8].color contains an unsupported note border color"
            )
        );
}

#[test]
fn invalid_shadow_preset_reports_exact_element_paths() {
    let temp_dir = std::env::temp_dir().join(format!(
        "dmnote-preset-shadow-error-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let source_path = temp_dir.join("source.json");
    for (collection, entry, expected_path, expected_reason) in [
        (
            "keyPositions",
            serde_json::json!({
                "shadow": {
                    "enabled": true,
                    "color": "#123456",
                    "offsetX": 0,
                    "offsetY": 0,
                    "blur": 100.1
                }
            }),
            "shadow.blur",
            "must be a finite number between 0 and 100",
        ),
        (
            "statPositions",
            serde_json::json!({
                "activeShadow": {
                    "enabled": true,
                    "color": "#123456",
                    "offsetX": -100.1,
                    "offsetY": 0,
                    "blur": 12
                }
            }),
            "activeShadow.offsetX",
            "must be a finite number between -100 and 100",
        ),
        (
            "graphPositions",
            serde_json::json!({
                "shadow": {
                    "enabled": true,
                    "color": "#123456",
                    "offsetX": 0,
                    "offsetY": 100.1,
                    "blur": 12
                }
            }),
            "shadow.offsetY",
            "must be a finite number between -100 and 100",
        ),
        (
            "knobPositions",
            serde_json::json!({ "activeShadow": [] }),
            "activeShadow",
            "must be an object",
        ),
        (
            "keyPositions",
            serde_json::json!({
                "shadow": {
                    "enabled": true,
                    "color": "",
                    "offsetX": 0,
                    "offsetY": 0,
                    "blur": 12
                }
            }),
            "shadow.color",
            "must be a non-empty string",
        ),
    ] {
        let preset = serde_json::json!({
            (collection): {
                "custom mode": [{}, entry]
            }
        });
        std::fs::write(&source_path, serde_json::to_vec(&preset).unwrap()).unwrap();

        let error = read_preset_file(&source_path)
            .err()
            .expect("invalid shadow preset must be rejected")
            .to_string();
        assert_eq!(
                error,
                format!(
                    "invalid-preset: {collection}[\"custom mode\"][1].{expected_path}: {expected_reason}"
                )
            );
    }

    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
fn null_shadow_fields_are_treated_as_absent() {
    let temp_dir = std::env::temp_dir().join(format!(
        "dmnote-preset-shadow-null-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let source_path = temp_dir.join("source.json");

    // 외부 생성·수동 편집 프리셋의 명시적 null은 Option 역직렬화처럼 값 없음
    let preset = serde_json::json!({
        "keyPositions": {
            "4key": [{
                "dx": 0,
                "dy": 0,
                "width": 60,
                "count": 0,
                "shadow": null,
                "activeShadow": null
            }]
        }
    });
    std::fs::write(&source_path, serde_json::to_vec(&preset).unwrap()).unwrap();

    let parsed = read_preset_file(&source_path).expect("null fields must parse as absent");
    let position = &parsed.key_positions.as_ref().unwrap()["4key"][0];
    assert!(position.shadow.is_none());
    assert!(position.active_shadow.is_none());

    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
fn legacy_and_bounded_shadow_presets_still_parse() {
    let temp_dir = std::env::temp_dir().join(format!(
        "dmnote-preset-shadow-compatibility-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let source_path = temp_dir.join("source.json");

    let legacy = serde_json::json!({
        "keyPositions": {
            "4key": [{ "dx": 0, "dy": 0, "width": 60, "count": 0 }]
        }
    });
    std::fs::write(&source_path, serde_json::to_vec(&legacy).unwrap()).unwrap();
    let parsed_legacy = read_preset_file(&source_path).unwrap();
    let legacy_position = &parsed_legacy.key_positions.unwrap()["4key"][0];
    assert!(legacy_position.shadow.is_none());
    assert!(legacy_position.active_shadow.is_none());

    let position = serde_json::json!({
        "dx": 0,
        "dy": 0,
        "width": 60,
        "count": 0,
        "shadow": {
            "enabled": true,
            "color": "#123456",
            "offsetX": -100,
            "offsetY": 100,
            "blur": 100
        },
        "activeShadow": {
            "enabled": false,
            "color": "rgba(0, 0, 0, 0)",
            "offsetX": 100,
            "offsetY": -100,
            "blur": 0
        }
    });
    let mut stat = position.clone();
    stat.as_object_mut()
        .unwrap()
        .insert("statType".to_string(), serde_json::json!("kps"));
    let mut graph = position.clone();
    graph
        .as_object_mut()
        .unwrap()
        .extend(serde_json::Map::from_iter([
            ("statType".to_string(), serde_json::json!("kps")),
            ("graphType".to_string(), serde_json::json!("line")),
            ("graphSpeed".to_string(), serde_json::json!(100)),
            ("graphColor".to_string(), serde_json::json!("#123456")),
        ]));
    let bounded = serde_json::json!({
        "keyPositions": { "4key": [position.clone()] },
        "statPositions": { "4key": [stat] },
        "graphPositions": { "4key": [graph] },
        "knobPositions": { "4key": [position] }
    });
    std::fs::write(&source_path, serde_json::to_vec(&bounded).unwrap()).unwrap();
    let parsed = read_preset_file(&source_path).unwrap();
    assert_eq!(
        parsed.key_positions.as_ref().unwrap()["4key"][0]
            .shadow
            .as_ref()
            .unwrap()
            .blur,
        100.0
    );
    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
fn missing_legacy_global_fields_preserve_current_plugin_and_style_settings() {
    let current = AppStoreData {
        background_color: "#123456".to_string(),
        note_settings: NoteSettings {
            speed: 777,
            ..NoteSettings::default()
        },
        note_effect: true,
        laboratory_enabled: true,
        use_custom_css: true,
        custom_css: CustomCss {
            path: Some("/current/style.css".to_string()),
            content: ".current {}".to_string(),
        },
        use_custom_js: true,
        custom_js: CustomJs {
            path: None,
            content: "globalThis.current = true".to_string(),
            plugins: vec![JsPlugin {
                id: "current-plugin".to_string(),
                name: "Current plugin".to_string(),
                path: None,
                content: "void 0".to_string(),
                enabled: true,
            }],
        },
        ..AppStoreData::default()
    };
    let mut legacy = PresetFile::default();

    let resolved = resolve_full_preset_settings(&mut legacy, &current);

    assert_eq!(resolved.background_color, current.background_color);
    assert_eq!(resolved.note_settings, current.note_settings);
    assert_eq!(resolved.note_effect, current.note_effect);
    assert_eq!(resolved.laboratory_enabled, current.laboratory_enabled);
    assert_eq!(resolved.use_custom_css, current.use_custom_css);
    assert_eq!(resolved.custom_css, current.custom_css);
    assert_eq!(resolved.use_custom_js, current.use_custom_js);
    assert_eq!(resolved.custom_js, current.custom_js);
}

#[test]
fn tauri_130_literal_without_js_fields_preserves_installed_plugins() {
    let current = AppStoreData {
        use_custom_js: true,
        custom_js: CustomJs {
            path: None,
            content: "globalThis.current = true".to_string(),
            plugins: vec![JsPlugin {
                id: "installed-plugin".to_string(),
                name: "Installed plugin".to_string(),
                path: None,
                content: "globalThis.installed = true".to_string(),
                enabled: true,
            }],
        },
        ..AppStoreData::default()
    };
    let mut preset: PresetFile = serde_json::from_value(serde_json::json!({
        "keys": { "4key": ["Q"] },
        "keyPositions": { "4key": [{ "dx": 1, "dy": 2, "width": 60, "count": 0 }] },
        "backgroundColor": "transparent"
    }))
    .unwrap();

    let resolved = resolve_full_preset_settings(&mut preset, &current);

    assert!(resolved.use_custom_js);
    assert_eq!(resolved.custom_js, current.custom_js);
}

#[test]
fn legacy_and_multi_key_preset_slots_share_the_normalization_path() {
    let preset: PresetFile = serde_json::from_value(serde_json::json!({
        "keys": {
            "4key": [
                "Q",
                { "keys": ["A", "B"], "match": "any" },
                { "keys": ["Z"], "match": "all" }
            ]
        }
    }))
    .unwrap();
    let keys = preset.keys.unwrap();

    assert_eq!(keys["4key"][0], KeySlot::Single("Q".to_string()));
    assert_eq!(
        keys["4key"][1],
        KeySlot::Multi {
            keys: vec!["A".to_string(), "B".to_string()],
            match_mode: crate::models::SlotMatch::Any,
        }
    );
    assert_eq!(keys["4key"][2], KeySlot::Single("Z".to_string()));
    assert_eq!(
        serde_json::to_value(keys).unwrap()["4key"],
        serde_json::json!([
            "Q",
            { "keys": ["A", "B"], "match": "any" },
            "Z"
        ])
    );
}

#[test]
fn tauri_161_literal_imports_its_plugin_list_exactly() {
    let mut current = AppStoreData::default();
    current.custom_js.plugins.push(JsPlugin {
        id: "current-plugin".to_string(),
        name: "Current plugin".to_string(),
        path: None,
        content: "void 0".to_string(),
        enabled: true,
    });
    let mut preset: PresetFile = serde_json::from_value(serde_json::json!({
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
        }
    }))
    .unwrap();

    let resolved = resolve_full_preset_settings(&mut preset, &current);

    assert!(resolved.use_custom_js);
    assert_eq!(resolved.custom_js.plugins.len(), 1);
    assert_eq!(resolved.custom_js.plugins[0].id, "plugin-161");
    assert!(!resolved
        .custom_js
        .plugins
        .iter()
        .any(|plugin| plugin.id == "current-plugin"));
}

#[test]
fn explicit_empty_plugin_settings_still_clear_current_plugins() {
    let current = AppStoreData {
        use_custom_js: true,
        custom_js: CustomJs {
            plugins: vec![JsPlugin {
                id: "current-plugin".to_string(),
                name: "Current plugin".to_string(),
                path: None,
                content: "void 0".to_string(),
                enabled: true,
            }],
            ..CustomJs::default()
        },
        ..AppStoreData::default()
    };
    let mut preset = PresetFile {
        use_custom_js: Some(false),
        custom_js: Some(CustomJs::default()),
        ..PresetFile::default()
    };

    let resolved = resolve_full_preset_settings(&mut preset, &current);

    assert!(!resolved.use_custom_js);
    assert_eq!(resolved.custom_js, CustomJs::default());
}

#[test]
fn legacy_tab_preset_without_note_override_preserves_current_override() {
    let mut store = AppStoreData::default();
    let current = TabNoteSettings {
        speed: Some(654),
        ..TabNoteSettings::default()
    };
    store
        .tab_note_overrides
        .insert("4key".to_string(), current.clone());

    apply_tab_note_override(&mut store, "4key", false, None);

    assert_eq!(store.tab_note_overrides["4key"], current);
}

#[test]
fn explicit_empty_tab_note_override_removes_current_override() {
    let mut store = AppStoreData::default();
    store.tab_note_overrides.insert(
        "4key".to_string(),
        TabNoteSettings {
            speed: Some(654),
            ..TabNoteSettings::default()
        },
    );

    apply_tab_note_override(&mut store, "4key", true, None);

    assert!(!store.tab_note_overrides.contains_key("4key"));
}

#[test]
fn historical_full_preset_without_groups_starts_each_imported_mode_ungrouped() {
    let keys = KeyMappings::from([
        ("4key".to_string(), vec![KeySlot::from("A")]),
        ("custom-old".to_string(), vec![KeySlot::from("B")]),
    ]);

    let groups = resolve_full_preset_layer_groups(None, &keys);

    assert_eq!(groups.len(), 2);
    assert!(groups["4key"].is_empty());
    assert!(groups["custom-old"].is_empty());
}

#[test]
fn tab_preset_duplicate_font_does_not_create_embedded_file() {
    let temp_dir = std::env::temp_dir().join(format!(
        "dmnote-tab-preset-font-load-test-{}",
        uuid::Uuid::new_v4()
    ));
    let fonts_dir = temp_dir.join("fonts");
    std::fs::create_dir_all(&fonts_dir).unwrap();
    let existing_path = fonts_dir.join("existing.ttf");
    std::fs::write(&existing_path, b"existing-font").unwrap();

    let existing_fonts = FontSettings {
        custom_fonts: vec![CustomFont {
            id: "existing-id".to_string(),
            font_type: FontType::Local,
            name: "SharedFont".to_string(),
            display_name: "Existing Font".to_string(),
            enabled: true,
            local_path: Some(existing_path.to_string_lossy().to_string()),
            css_content: None,
            weight_ranges: Vec::new(),
        }],
    };
    let imported_font_id = "imported-id".to_string();
    let imported_fonts = FontSettings {
        custom_fonts: vec![CustomFont {
            id: imported_font_id.clone(),
            font_type: FontType::Local,
            name: "SharedFont".to_string(),
            display_name: "Imported Font".to_string(),
            enabled: true,
            local_path: None,
            css_content: None,
            weight_ranges: Vec::new(),
        }],
    };
    let embedded_fonts = vec![EmbeddedLocalFont {
        font_id: imported_font_id,
        extension: Some("ttf".to_string()),
        data_base64: BASE64_STANDARD.encode(b"imported-font"),
    }];
    let file_count_before = std::fs::read_dir(&fonts_dir).unwrap().count();

    let merged = merge_tab_preset_fonts(&existing_fonts, imported_fonts, |filtered_fonts| {
        restore_preset_local_fonts_in_dir(&fonts_dir, filtered_fonts, Some(&embedded_fonts))
    })
    .unwrap();

    assert!(merged.is_none());
    assert_eq!(
        std::fs::read_dir(&fonts_dir).unwrap().count(),
        file_count_before
    );
    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
fn tab_preset_keeps_all_local_faces_for_a_new_family() {
    let face = |id: &str, weight: u16| CustomFont {
        id: id.to_string(),
        font_type: FontType::Local,
        name: "Family".to_string(),
        display_name: "Family".to_string(),
        enabled: true,
        local_path: Some(format!("/{id}.ttf")),
        css_content: None,
        weight_ranges: vec![FontWeightRange {
            min: weight,
            max: weight,
        }],
    };
    let imported = FontSettings {
        custom_fonts: vec![
            face("regular", 400),
            face("bold", 700),
            // 프리셋 내부 중복(id 동일)은 한 번만 수용
            face("bold", 700),
        ],
    };

    // 실제 탭 로드 경로(prepare → restore → merge) 전체를 통과시킨다
    let merged = merge_tab_preset_fonts(&FontSettings::default(), imported, |_| Ok(()))
        .unwrap()
        .unwrap();

    assert_eq!(merged.custom_fonts.len(), 2);
    assert_eq!(merged.custom_fonts[0].weight_ranges[0].min, 400);
    assert_eq!(merged.custom_fonts[1].weight_ranges[0].min, 700);

    // 기존에 같은 이름이 있으면 그 family 전체를 기존 정의로 유지
    let existing = FontSettings {
        custom_fonts: vec![face("existing", 400)],
    };
    let imported = FontSettings {
        custom_fonts: vec![face("regular", 400), face("bold", 700)],
    };
    assert!(merge_tab_preset_fonts(&existing, imported, |_| Ok(()))
        .unwrap()
        .is_none());
}

#[test]
fn tab_preset_key_pair_merge_preserves_other_modes_and_latest_target_positions() {
    let mut store = AppStoreData {
        keys: default_keys().clone(),
        key_positions: default_positions().clone(),
        ..AppStoreData::default()
    };
    store.key_positions.get_mut("4key").unwrap()[0].dx = 777.0;
    let untouched_keys = store.keys["5key"].clone();
    let untouched_positions = store.key_positions["5key"].clone();

    merge_tab_preset_key_pair(&mut store, "4key", vec![KeySlot::from("Imported")], None);

    assert_eq!(store.keys["5key"], untouched_keys);
    assert_eq!(store.key_positions["5key"], untouched_positions);
    assert_eq!(store.key_positions["4key"][0].dx, 777.0);
    assert_eq!(store.keys["4key"][0], KeySlot::from("Imported"));
    assert_eq!(store.keys["4key"].len(), store.key_positions["4key"].len());
}

fn old_preset_store() -> AppStoreData {
    AppStoreData {
        key_positions: KeyPositions::from([
            ("target".to_string(), vec![KeyPosition::default()]),
            ("untouched".to_string(), vec![KeyPosition::default()]),
        ]),
        stat_positions: StatPositions::from([(
            "target".to_string(),
            vec![StatPosition {
                stat_type: StatType::Kps,
                position: KeyPosition::default(),
            }],
        )]),
        graph_positions: GraphPositions::from([(
            "target".to_string(),
            vec![GraphPosition {
                stat_type: GraphStatType::Kps,
                graph_type: GraphType::Line,
                graph_speed: 100,
                graph_color: "#123456".to_string(),
                show_avg_line: true,
                position: KeyPosition::default(),
            }],
        )]),
        knob_positions: KnobPositions::from([(
            "target".to_string(),
            vec![KnobPosition {
                axis_id: "axis".to_string(),
                sensitivity: 1.0,
                reverse: false,
                position: KeyPosition::default(),
            }],
        )]),
        ..AppStoreData::default()
    }
}

fn target_preset_ids(store: &AppStoreData) -> Vec<String> {
    vec![
        store.key_positions["target"][0].id.clone(),
        store.stat_positions["target"][0].position.id.clone(),
        store.graph_positions["target"][0].position.id.clone(),
        store.knob_positions["target"][0].position.id.clone(),
    ]
}

#[test]
fn old_full_preset_rekeys_every_application() {
    let mut first = old_preset_store();
    rekey_full_preset_elements(&mut first);
    let first_ids = target_preset_ids(&first);
    let mut second = old_preset_store();
    rekey_full_preset_elements(&mut second);
    let second_ids = target_preset_ids(&second);

    assert!(first_ids
        .iter()
        .all(|id| crate::state::native_element_id::is_valid_element_id(id)));
    assert!(first_ids.iter().all(|id| !second_ids.contains(id)));
}

#[test]
fn old_tab_preset_rekeys_only_written_collections_on_every_application() {
    let mut store = old_preset_store();
    crate::state::native_element_id::backfill_store_element_ids(&mut store);
    let untouched_id = store.key_positions["untouched"][0].id.clone();
    let original_ids = target_preset_ids(&store);

    rekey_tab_preset_elements(&mut store, "target", true, true, true, false);
    let first_ids = target_preset_ids(&store);
    rekey_tab_preset_elements(&mut store, "target", true, true, true, false);
    let second_ids = target_preset_ids(&store);

    assert!(original_ids[..3]
        .iter()
        .zip(&first_ids[..3])
        .all(|(before, after)| before != after));
    assert!(first_ids[..3]
        .iter()
        .zip(&second_ids[..3])
        .all(|(before, after)| before != after));
    assert_eq!(first_ids[3], original_ids[3]);
    assert_eq!(second_ids[3], original_ids[3]);
    assert_eq!(store.key_positions["untouched"][0].id, untouched_id);
    crate::state::native_element_id::validate_document_element_ids(
        &crate::models::EditorDocumentV1::from_store(&store),
    )
    .unwrap();
}

#[test]
fn tab_preset_without_key_positions_keeps_existing_key_ids() {
    let mut store = old_preset_store();
    crate::state::native_element_id::backfill_store_element_ids(&mut store);
    let original_ids = target_preset_ids(&store);
    // keys만 담긴 탭 프리셋: merge가 기존 위치를 값 그대로 되삽입하고
    // 슬롯 정렬이 빈 위치 하나를 덧붙인 상태
    store
        .key_positions
        .get_mut("target")
        .unwrap()
        .push(KeyPosition::default());

    rekey_tab_preset_elements(&mut store, "target", false, false, false, false);

    // 값이 그대로인 기존 키는 신원을 지키고, 덧붙은 슬롯만 새 id를 받는다
    assert_eq!(store.key_positions["target"][0].id, original_ids[0]);
    let appended = &store.key_positions["target"][1].id;
    assert!(crate::state::native_element_id::is_valid_element_id(
        appended
    ));
    assert_ne!(appended, &original_ids[0]);
    assert_eq!(target_preset_ids(&store)[1..], original_ids[1..]);
    crate::state::native_element_id::validate_document_element_ids(
        &crate::models::EditorDocumentV1::from_store(&store),
    )
    .unwrap();
}

#[test]
fn preset_import_alignment_repairs_each_mode_without_dropping_values() {
    let mut keys = KeyMappings::from([
        ("keys-only".to_string(), vec![KeySlot::from("A")]),
        ("positions-long".to_string(), vec![KeySlot::from("B")]),
    ]);
    let mut positions = KeyPositions::from([
        (
            "positions-only".to_string(),
            vec![KeyPosition {
                dx: 123.0,
                ..KeyPosition::default()
            }],
        ),
        (
            "positions-long".to_string(),
            vec![KeyPosition::default(), KeyPosition::default()],
        ),
    ]);

    align_imported_key_collections(&mut keys, &mut positions);

    assert_eq!(keys["keys-only"], vec![KeySlot::from("A")]);
    assert_eq!(positions["keys-only"], vec![KeyPosition::default()]);
    assert_eq!(keys["positions-only"], vec![KeySlot::default()]);
    assert_eq!(positions["positions-only"][0].dx, 123.0);
    assert_eq!(
        keys["positions-long"],
        vec![KeySlot::from("B"), KeySlot::default()]
    );
    assert_eq!(
        keys["positions-long"].len(),
        positions["positions-long"].len()
    );
}

#[test]
fn tab_preset_font_restore_failure_keeps_existing_settings_unchanged() {
    let existing = FontSettings {
        custom_fonts: vec![CustomFont {
            id: "existing-id".to_string(),
            font_type: FontType::Local,
            name: "ExistingFont".to_string(),
            display_name: "Existing Font".to_string(),
            enabled: true,
            local_path: Some("/existing/font.ttf".to_string()),
            css_content: None,
            weight_ranges: Vec::new(),
        }],
    };
    let before = existing.clone();
    let imported = FontSettings {
        custom_fonts: vec![CustomFont {
            id: "imported-id".to_string(),
            font_type: FontType::Local,
            name: "ImportedFont".to_string(),
            display_name: "Imported Font".to_string(),
            enabled: true,
            local_path: None,
            css_content: None,
            weight_ranges: Vec::new(),
        }],
    };

    let result = prepare_tab_preset_fonts(&existing, imported, |fonts| {
        fonts.custom_fonts[0].local_path = Some("/staged/font.ttf".to_string());
        Err(CommandError::msg("restore-failed"))
    });

    assert!(result.is_err());
    assert_eq!(existing, before);
}

#[test]
fn legacy_percent_encoded_file_url_is_copied_on_import() {
    let temp_dir = std::env::temp_dir().join(format!(
        "dmnote-preset-image-url-load-test-{}",
        uuid::Uuid::new_v4()
    ));
    let source_dir = temp_dir.join("source folder");
    let images_dir = temp_dir.join("restored-images");
    std::fs::create_dir_all(&source_dir).unwrap();
    std::fs::create_dir_all(&images_dir).unwrap();
    let source_path = source_dir.join("image with space.png");
    std::fs::write(&source_path, b"legacy-image").unwrap();
    let mut image_ref = Some(url::Url::from_file_path(&source_path).unwrap().to_string());

    restore_position_image_reference(
        &images_dir,
        &HashMap::new(),
        &mut HashMap::new(),
        &mut image_ref,
    )
    .unwrap();

    let restored_path = Path::new(image_ref.as_deref().unwrap());
    assert!(restored_path.starts_with(&images_dir));
    assert_eq!(std::fs::read(restored_path).unwrap(), b"legacy-image");
    assert_eq!(std::fs::read(&source_path).unwrap(), b"legacy-image");
    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
fn sound_restore_restores_knob_sound() {
    let temp_dir = std::env::temp_dir().join(format!(
        "dmnote-preset-knob-load-test-{}",
        uuid::Uuid::new_v4()
    ));
    let sounds_dir = temp_dir.join("sounds");
    let sound_id = "knob-sound";
    let embedded = vec![EmbeddedLocalSound {
        sound_id: sound_id.to_string(),
        extension: Some("wav".to_string()),
        data_base64: BASE64_STANDARD.encode(b"restored-knob-sound"),
    }];

    let mut position = default_positions()["4key"][0].clone();
    position.sound_path = Some(format!("{PRESET_LOCAL_SOUND_PREFIX}{sound_id}"));
    let mut knob_positions = KnobPositions::new();
    knob_positions.insert(
        "4key".to_string(),
        vec![KnobPosition {
            axis_id: "axis".to_string(),
            sensitivity: 1.0,
            reverse: false,
            position,
        }],
    );

    restore_preset_local_sounds_in_dir(
        &sounds_dir,
        &mut KeyPositions::new(),
        &mut StatPositions::new(),
        &mut GraphPositions::new(),
        &mut knob_positions,
        Some(&embedded),
    )
    .unwrap();

    let restored_path = Path::new(
        knob_positions["4key"][0]
            .position
            .sound_path
            .as_deref()
            .unwrap(),
    );
    assert!(restored_path.starts_with(&sounds_dir));
    assert_eq!(
        std::fs::read(restored_path).unwrap(),
        b"restored-knob-sound"
    );
    let _ = std::fs::remove_dir_all(temp_dir);
}
