use super::{
    load_store_from_path, migrate_local_fonts_to_app_data, migrate_sound_library_enabled,
    normalize_state, parse_portable_asset_reference, recover_key_mapping_entries,
    rehome_foreign_asset_references, repair_image_transforms, rgba_to_hex, AssetCategory,
    LEGACY_OVERLAY_HEIGHT, LEGACY_OVERLAY_WIDTH, LEGACY_PANEL_DETACH_ENABLED_KEY,
};
use crate::{
    defaults::{default_keys, default_positions},
    models::{
        AppStoreData, CustomCssHistoryEntry, CustomFont, CustomTab, FontType, GraphPosition,
        GraphStatType, GraphType, ImageTransform, KeyCounterAlign, KeyCounterAlignMode,
        KeyCounterColor, KeyCounterPlacement, KeyMappings, KeyPosition, KeySlot, KnobPosition,
        LayerGroupDef, NoteColor, OverlayBounds, SlotMatch, SoundLibraryEntry, StatPosition,
        StatType, TabCss, TabNoteSettings, POSITION_COLLECTION_FIELDS,
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

#[test]
fn missing_note_gradient_multipliers_default_to_one_hundred_on_all_collections() {
    let gradient = serde_json::json!({
        "angle": 90,
        "stops": [
            { "color": "#112233", "pos": 0 },
            { "color": "#445566", "pos": 1 }
        ]
    });
    let mut value = serde_json::json!({
        "keyPositions": { "mode": [{ "noteGradient": gradient.clone() }] },
        "statPositions": { "mode": [{ "noteGlowGradient": gradient.clone() }] },
        "graphPositions": { "mode": [{ "noteGradient": gradient.clone() }] },
        "knobPositions": { "mode": [{
            "noteGradient": gradient,
            "noteGlowGradient": null
        }] }
    });

    // 보정 발생 시 true 반환 - needs_persist로 전파되어 디스크에도 영속
    assert!(super::default_store_note_gradient_multipliers(&mut value));

    assert_eq!(value["keyPositions"]["mode"][0]["noteOpacity"], 100);
    assert_eq!(value["statPositions"]["mode"][0]["noteGlowOpacity"], 100);
    assert_eq!(value["graphPositions"]["mode"][0]["noteOpacity"], 100);
    assert_eq!(value["knobPositions"]["mode"][0]["noteOpacity"], 100);
    assert!(value["knobPositions"]["mode"][0]
        .get("noteGlowOpacity")
        .is_none());

    // 이미 보정된 store 재로드는 무변경 - 반복 영속 방지
    assert!(!super::default_store_note_gradient_multipliers(&mut value));
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
    for field in POSITION_COLLECTION_FIELDS {
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
fn missing_note_gradient_multiplier_persists_on_first_load_and_converges() {
    let path = std::env::temp_dir().join(format!(
        "dmnote-note-gradient-multiplier-{}.json",
        uuid::Uuid::new_v4()
    ));
    let mut raw = serde_json::to_value(store_with_each_native_collection()).unwrap();
    let position = &mut raw["keyPositions"]["4key"][0];
    position["noteGradient"] = serde_json::json!({
        "angle": 90,
        "stops": [
            { "color": "#112233", "pos": 0 },
            { "color": "#445566", "pos": 1 }
        ]
    });
    position.as_object_mut().unwrap().remove("noteOpacity");
    std::fs::write(&path, serde_json::to_vec_pretty(&raw).unwrap()).unwrap();

    // 배율 부재 보정이 유일한 변경이어도 첫 로드는 영속 대상
    let loaded = load_store_from_path(&path).unwrap();
    assert_eq!(loaded.data.key_positions["4key"][0].note_opacity, 100);
    assert!(loaded.needs_persist);

    // 저장 후 재로드는 무변경으로 수렴 - 시작마다 보정 반복 방지
    std::fs::write(&path, serde_json::to_vec_pretty(&loaded.data).unwrap()).unwrap();
    let reloaded = load_store_from_path(&path).unwrap();
    assert_eq!(reloaded.data.key_positions["4key"][0].note_opacity, 100);
    assert!(!reloaded.needs_persist);
    let _ = std::fs::remove_file(path);
}

#[test]
fn serialized_undo_history_with_removed_outline_fields_loads_as_opaque_data() {
    let path = std::env::temp_dir().join(format!(
        "dmnote-removed-outline-history-{}.json",
        uuid::Uuid::new_v4()
    ));
    let baseline = store_with_each_native_collection();
    let mut raw = serde_json::to_value(&baseline).unwrap();
    let saved_history = serde_json::json!({
        "past": [{
            "scope": "editor",
            "before": {
                "kind": "editor",
                "value": {
                    "changedFields": ["keyPositions"],
                    "before": {
                        "keyPositions": {
                            "4key": [{
                                "fontStrokeColor": "#112233",
                                "activeFontStrokeColor": "#445566",
                                "counter": {
                                    "stroke": {
                                        "idle": "#000000",
                                        "active": "#FFFFFF"
                                    },
                                    "strokeIdleGradient": {
                                        "angle": 90,
                                        "stops": []
                                    }
                                }
                            }]
                        }
                    }
                }
            }
        }],
        "future": []
    });
    raw.as_object_mut()
        .unwrap()
        .insert("history".to_string(), saved_history.clone());
    std::fs::write(&path, serde_json::to_vec_pretty(&raw).unwrap()).unwrap();

    let loaded = load_store_from_path(&path).unwrap();
    assert!(!loaded.needs_persist);
    assert!(!loaded.repaired);
    assert_eq!(loaded.data.key_positions, baseline.key_positions);
    assert_eq!(loaded.data.stat_positions, baseline.stat_positions);
    assert_eq!(loaded.data.graph_positions, baseline.graph_positions);
    assert_eq!(loaded.data.knob_positions, baseline.knob_positions);
    assert_eq!(loaded.data.plugin_data.get("history"), Some(&saved_history));
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
    data.plugin_data[&crate::state::plugin::plugin_instances_storage_key(plugin_id)]
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
fn backfill_plugin_instances_preserves_malformed_siblings_across_reload() {
    let path = plugin_backfill_fixture_path("mixed");
    let existing_id = uuid::Uuid::new_v4().to_string();
    let malformed = serde_json::json!({ "position": "broken", "keep": true });
    let mut raw = serde_json::to_value(store_with_each_native_collection()).unwrap();
    raw.as_object_mut().unwrap().insert(
        "plugin_data_alpha/instances".to_string(),
        serde_json::json!([
            saved_plugin_instance_json(1.0, Some(&existing_id)),
            saved_plugin_instance_json(2.0, None),
            malformed.clone()
        ]),
    );
    std::fs::write(&path, serde_json::to_vec_pretty(&raw).unwrap()).unwrap();

    let loaded = load_store_from_path(&path).unwrap();
    assert!(loaded.needs_persist);
    assert!(!loaded.repaired);
    let key = crate::state::plugin::plugin_instances_storage_key("alpha");
    let entries = loaded.data.plugin_data[&key].as_array().unwrap();
    assert_eq!(entries.len(), 3);
    assert_eq!(entries[0]["instanceId"], existing_id);
    assert!(crate::state::native_element_id::is_valid_element_id(
        entries[1]["instanceId"].as_str().unwrap()
    ));
    assert_eq!(entries[2], malformed);
    let persisted_bucket = loaded.data.plugin_data[&key].clone();

    std::fs::write(&path, serde_json::to_vec_pretty(&loaded.data).unwrap()).unwrap();
    let reloaded = load_store_from_path(&path).unwrap();
    assert!(!reloaded.needs_persist);
    assert!(!reloaded.repaired);
    assert_eq!(reloaded.data.plugin_data[&key], persisted_bucket);
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
    let instances = loaded.data.plugin_data
        [&crate::state::plugin::plugin_instances_storage_key("alpha")]
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
    // 교차 플러그인 중복만으로는 수리 대상이 아니다
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
    // 빈 배열은 사용자 storage로 보존
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
    position["fontColor"] = serde_json::json!("stale-font");
    position["fontGradient"] = serde_json::json!({
        "angle": -270,
        "stops": [
            { "color": "#123456", "pos": 0 },
            { "color": "#ABCDEF", "pos": 1 }
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
    assert_eq!(position.font_color.as_deref(), Some("#123456"));
    assert_eq!(position.font_gradient.as_ref().unwrap().angle, 90.0);
    assert_eq!(position.counter.fill.idle, "rgba(255,255,255,1)");

    std::fs::write(&path, serde_json::to_vec_pretty(&loaded.data).unwrap()).unwrap();
    let reloaded = load_store_from_path(&path).unwrap();
    assert!(!reloaded.needs_persist);
    assert!(!reloaded.repaired);
    assert_eq!(reloaded.data, loaded.data);
    let _ = std::fs::remove_file(path);
}

#[test]
fn blank_font_color_normalization_requests_one_canonical_persist() {
    let path = std::env::temp_dir().join(format!(
        "dmnote-blank-font-color-reload-{}.json",
        uuid::Uuid::new_v4()
    ));
    let data = normalize_state(AppStoreData {
        keys: default_keys().clone(),
        key_positions: default_positions().clone(),
        ..AppStoreData::default()
    });
    std::fs::write(&path, serde_json::to_vec_pretty(&data).unwrap()).unwrap();
    let seeded = load_store_from_path(&path).unwrap();
    std::fs::write(&path, serde_json::to_vec_pretty(&seeded.data).unwrap()).unwrap();
    let canonical = load_store_from_path(&path).unwrap();
    assert!(!canonical.needs_persist);
    assert!(!canonical.repaired);

    let mut raw = serde_json::to_value(&canonical.data).unwrap();
    raw["keyPositions"]["4key"][0]["fontColor"] = serde_json::json!(" \t ");
    raw["keyPositions"]["4key"][0]["activeFontColor"] = serde_json::json!("");
    std::fs::write(&path, serde_json::to_vec_pretty(&raw).unwrap()).unwrap();

    let normalized = load_store_from_path(&path).unwrap();
    assert!(normalized.needs_persist);
    assert!(!normalized.repaired);
    assert!(normalized.data.key_positions["4key"][0]
        .font_color
        .is_none());
    assert!(normalized.data.key_positions["4key"][0]
        .active_font_color
        .is_none());

    std::fs::write(&path, serde_json::to_vec_pretty(&normalized.data).unwrap()).unwrap();
    let reloaded = load_store_from_path(&path).unwrap();
    assert!(!reloaded.needs_persist);
    assert!(!reloaded.repaired);
    assert_eq!(reloaded.data, normalized.data);
    let _ = std::fs::remove_file(path);
}

#[test]
fn blank_font_gradient_stop_repairs_once_and_converges_on_reload() {
    let path = std::env::temp_dir().join(format!(
        "dmnote-blank-font-gradient-stop-{}.json",
        uuid::Uuid::new_v4()
    ));
    let data = normalize_state(AppStoreData {
        keys: default_keys().clone(),
        key_positions: default_positions().clone(),
        ..AppStoreData::default()
    });
    std::fs::write(&path, serde_json::to_vec_pretty(&data).unwrap()).unwrap();
    let seeded = load_store_from_path(&path).unwrap();
    std::fs::write(&path, serde_json::to_vec_pretty(&seeded.data).unwrap()).unwrap();
    let canonical = load_store_from_path(&path).unwrap();
    assert!(!canonical.needs_persist);
    assert!(!canonical.repaired);

    // 공백 첫 stop: 대표색 동기와 공백 정규화가 서로 되돌려 복구가 반복되던 입력
    let mut raw = serde_json::to_value(&canonical.data).unwrap();
    raw["keyPositions"]["4key"][0]["fontGradient"] = serde_json::json!({
        "angle": 45,
        "stops": [
            { "color": "   ", "pos": 0 },
            { "color": "#445566", "pos": 1 }
        ]
    });
    std::fs::write(&path, serde_json::to_vec_pretty(&raw).unwrap()).unwrap();

    // 첫 로드는 그라데이션을 내리고 한 번만 복구로 기록
    let repaired = load_store_from_path(&path).unwrap();
    assert!(repaired.needs_persist);
    assert!(repaired.repaired);
    assert!(repaired.data.key_positions["4key"][0]
        .font_gradient
        .is_none());

    // 저장 후 재로드는 무변경 - repaired 반복으로 자산 sweep이 계속 막히지 않게
    std::fs::write(&path, serde_json::to_vec_pretty(&repaired.data).unwrap()).unwrap();
    let reloaded = load_store_from_path(&path).unwrap();
    assert!(!reloaded.needs_persist);
    assert!(!reloaded.repaired);
    assert_eq!(reloaded.data, repaired.data);
    let _ = std::fs::remove_file(path);
}

#[test]
fn knob_note_border_gradient_and_rgba_migration_converge_in_either_order() {
    let mut knob = KnobPosition {
        axis_id: "axis".to_string(),
        sensitivity: 1.0,
        reverse: false,
        position: KeyPosition::default(),
    };
    knob.position.note_border_color = Some("rgba(17, 34, 51, 0.5)".to_string());
    knob.position.note_border_gradient = serde_json::from_value(serde_json::json!({
        "angle": 90,
        "stops": [
            { "color": "rgba(17, 34, 51, 0.5)", "pos": 0 },
            { "color": "#ABC8", "pos": 1 }
        ]
    }))
    .unwrap();
    let mut source = AppStoreData::default();
    source
        .knob_positions
        .insert("custom".to_string(), vec![knob]);

    let mut canonical_first = source.clone();
    assert_eq!(
        super::canonicalize_gradient_pairs(&mut canonical_first),
        (true, true)
    );
    let canonical_first = normalize_state(canonical_first);

    let mut migration_first = normalize_state(source);
    assert_eq!(
        super::canonicalize_gradient_pairs(&mut migration_first),
        (false, false)
    );

    assert_eq!(canonical_first, migration_first);
    assert_eq!(
        migration_first.knob_positions["custom"][0]
            .position
            .note_border_color
            .as_deref(),
        Some("#112233")
    );
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
    key_position.note_color = NoteColor::Gradient {
        top: "legacy-top".to_string(),
        bottom: "legacy-bottom".to_string(),
    };
    key_position.note_opacity_top = Some(23);
    key_position.note_opacity_bottom = Some(67);
    let expected_key_counter = key_position.counter.clone();
    let expected_key_note_color = key_position.note_color.clone();

    let mut stat_position = StatPosition {
        stat_type: StatType::Kps,
        position: key_position.clone(),
    };
    stat_position.position.counter.fill.idle = "#ABCDEF".to_string();
    stat_position.position.note_glow_color = Some(NoteColor::Gradient {
        top: "legacy-glow-top".to_string(),
        bottom: "legacy-glow-bottom".to_string(),
    });
    stat_position.position.note_glow_opacity_top = Some(34);
    stat_position.position.note_glow_opacity_bottom = Some(76);
    let expected_stat_counter = stat_position.position.counter.clone();
    let expected_stat_glow_color = stat_position.position.note_glow_color.clone();

    let mut data = normalize_state(AppStoreData {
        keys: default_keys().clone(),
        key_positions: default_positions().clone(),
        ..AppStoreData::default()
    });
    data.key_positions.get_mut("4key").unwrap()[0] = key_position;
    data.stat_positions
        .insert("4key".to_string(), vec![stat_position]);
    let mut raw = serde_json::to_value(data).unwrap();
    raw["keyPositions"]["4key"][0]["noteBorderGradient"] = serde_json::json!({
        "angle": 90,
        "stops": [{ "color": "#112233", "pos": 0 }]
    });
    raw["keyPositions"]["4key"][0]["noteGradient"] = serde_json::json!({
        "angle": 90,
        "stops": [{ "color": "#112233", "pos": 0 }]
    });
    raw["keyPositions"]["4key"][0]["counter"]["fillIdleGradient"] = serde_json::json!({
        "angle": 90,
        "stops": [{ "color": "#FFFFFF", "pos": 0 }]
    });
    raw["statPositions"]["4key"][0]["counter"]["fillActiveGradient"] = serde_json::json!({
        "angle": 90,
        "stops": [{ "color": "#000000", "pos": 1 }]
    });
    raw["statPositions"]["4key"][0]["noteGlowGradient"] = serde_json::json!({
        "angle": 90,
        "stops": [{ "color": "#AABBCC", "pos": 1 }]
    });
    std::fs::write(&path, serde_json::to_vec_pretty(&raw).unwrap()).unwrap();

    let loaded = load_store_from_path(&path).unwrap();
    let key_counter = &loaded.data.key_positions["4key"][0].counter;
    let stat_counter = &loaded.data.stat_positions["4key"][0].position.counter;

    assert!(loaded.needs_persist);
    assert!(loaded.repaired);
    assert_eq!(key_counter, &expected_key_counter);
    assert_eq!(stat_counter, &expected_stat_counter);
    assert!(loaded.data.key_positions["4key"][0].note_gradient.is_none());
    assert_eq!(
        loaded.data.key_positions["4key"][0].note_color,
        expected_key_note_color
    );
    assert_eq!(
        loaded.data.key_positions["4key"][0].note_opacity_top,
        Some(23)
    );
    assert_eq!(
        loaded.data.key_positions["4key"][0].note_opacity_bottom,
        Some(67)
    );
    assert!(loaded.data.stat_positions["4key"][0]
        .position
        .note_glow_gradient
        .is_none());
    assert_eq!(
        loaded.data.stat_positions["4key"][0]
            .position
            .note_glow_color,
        expected_stat_glow_color
    );
    assert!(loaded.data.key_positions["4key"][0]
        .note_border_gradient
        .is_none());
    assert!(key_counter.fill_idle_gradient.is_none());
    assert!(stat_counter.fill_active_gradient.is_none());
    let _ = std::fs::remove_file(path);
}

#[test]
fn invalid_font_gradient_fields_recover_in_place_on_every_position_collection() {
    let path = std::env::temp_dir().join(format!(
        "dmnote-font-gradient-field-recovery-{}.json",
        uuid::Uuid::new_v4()
    ));
    let mut data = normalize_state(AppStoreData {
        keys: default_keys().clone(),
        key_positions: default_positions().clone(),
        ..AppStoreData::default()
    });
    let mut template = data.key_positions["4key"][0].clone();
    template.font_color = Some("font-sibling".to_string());
    template.active_font_color = Some("active-font-sibling".to_string());
    let key_id = uuid::Uuid::new_v4().to_string();
    let key = &mut data.key_positions.get_mut("4key").unwrap()[0];
    key.id = key_id.clone();
    key.font_color = Some("font-sibling".to_string());

    let stat_id = uuid::Uuid::new_v4().to_string();
    let graph_id = uuid::Uuid::new_v4().to_string();
    let knob_id = uuid::Uuid::new_v4().to_string();
    data.stat_positions.insert(
        "4key".to_string(),
        vec![StatPosition {
            stat_type: StatType::Kps,
            position: KeyPosition {
                id: stat_id.clone(),
                ..template.clone()
            },
        }],
    );
    data.graph_positions.insert(
        "4key".to_string(),
        vec![GraphPosition {
            stat_type: GraphStatType::Kps,
            graph_type: GraphType::Line,
            graph_speed: 1000,
            graph_color: "graph-sibling".to_string(),
            show_avg_line: true,
            position: KeyPosition {
                id: graph_id.clone(),
                ..template.clone()
            },
        }],
    );
    data.knob_positions.insert(
        "4key".to_string(),
        vec![KnobPosition {
            axis_id: "axis-sibling".to_string(),
            sensitivity: 1.0,
            reverse: false,
            position: KeyPosition {
                id: knob_id.clone(),
                ..template
            },
        }],
    );

    let mut raw = serde_json::to_value(&data).unwrap();
    let damaged = serde_json::json!({
        "angle": 90,
        "stops": [{ "color": "#112233", "pos": 0 }]
    });
    raw["keyPositions"]["4key"][0]["fontGradient"] = damaged.clone();
    raw["statPositions"]["4key"][0]["activeFontGradient"] = damaged.clone();
    raw["graphPositions"]["4key"][0]["fontGradient"] = damaged.clone();
    raw["knobPositions"]["4key"][0]["activeFontGradient"] = damaged;

    raw["keyPositions"]["4key"][0]["fontWeight"] = serde_json::json!(400);
    raw["keyPositions"]["4key"][0]
        .as_object_mut()
        .unwrap()
        .remove("fontBold");
    raw["statPositions"]["4key"][0]
        .as_object_mut()
        .unwrap()
        .remove("fontWeight");
    raw["statPositions"]["4key"][0]
        .as_object_mut()
        .unwrap()
        .remove("fontBold");
    raw["graphPositions"]["4key"][0]["fontWeight"] = serde_json::json!(700);
    raw["graphPositions"]["4key"][0]
        .as_object_mut()
        .unwrap()
        .remove("fontBold");
    raw["knobPositions"]["4key"][0]["fontWeight"] = serde_json::json!(600);
    raw["knobPositions"]["4key"][0]
        .as_object_mut()
        .unwrap()
        .remove("fontBold");
    std::fs::write(&path, serde_json::to_vec_pretty(&raw).unwrap()).unwrap();

    let loaded = load_store_from_path(&path).unwrap();
    assert!(loaded.needs_persist);
    assert!(loaded.repaired);
    assert_eq!(
        loaded.data.key_positions["4key"].len(),
        data.key_positions["4key"].len()
    );
    assert_eq!(loaded.data.stat_positions["4key"].len(), 1);
    assert_eq!(loaded.data.graph_positions["4key"].len(), 1);
    assert_eq!(loaded.data.knob_positions["4key"].len(), 1);
    assert_eq!(loaded.data.key_positions["4key"][0].id, key_id);
    assert_eq!(loaded.data.stat_positions["4key"][0].position.id, stat_id);
    assert_eq!(loaded.data.graph_positions["4key"][0].position.id, graph_id);
    assert_eq!(loaded.data.knob_positions["4key"][0].position.id, knob_id);
    assert!(loaded.data.key_positions["4key"][0].font_gradient.is_none());
    assert!(loaded.data.stat_positions["4key"][0]
        .position
        .active_font_gradient
        .is_none());
    assert!(loaded.data.graph_positions["4key"][0]
        .position
        .font_gradient
        .is_none());
    assert!(loaded.data.knob_positions["4key"][0]
        .position
        .active_font_gradient
        .is_none());
    for position in [
        &loaded.data.key_positions["4key"][0],
        &loaded.data.stat_positions["4key"][0].position,
        &loaded.data.graph_positions["4key"][0].position,
        &loaded.data.knob_positions["4key"][0].position,
    ] {
        assert_eq!(position.font_color.as_deref(), Some("font-sibling"));
    }
    let key = &loaded.data.key_positions["4key"][0];
    assert_eq!(key.font_weight, Some(400));
    assert_eq!(key.font_bold, None);
    let stat = &loaded.data.stat_positions["4key"][0].position;
    assert_eq!(stat.font_weight, None);
    assert_eq!(stat.font_bold, None);
    let graph = &loaded.data.graph_positions["4key"][0].position;
    assert_eq!(graph.font_weight, Some(400));
    assert_eq!(graph.font_bold, Some(true));
    let knob = &loaded.data.knob_positions["4key"][0].position;
    assert_eq!(knob.font_weight, Some(600));
    assert_eq!(knob.font_bold, None);
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
fn normalize_state_drops_blank_font_colors_on_every_position_collection() {
    let blank_position = |id: &str| KeyPosition {
        id: id.to_string(),
        font_color: Some(" \t ".to_string()),
        active_font_color: Some(String::new()),
        ..KeyPosition::default()
    };
    let data = normalize_state(AppStoreData {
        key_positions: crate::models::KeyPositions::from([(
            "custom".to_string(),
            vec![blank_position("key-id")],
        )]),
        stat_positions: crate::models::StatPositions::from([(
            "custom".to_string(),
            vec![StatPosition {
                stat_type: StatType::Kps,
                position: blank_position("stat-id"),
            }],
        )]),
        graph_positions: crate::models::GraphPositions::from([(
            "custom".to_string(),
            vec![GraphPosition {
                stat_type: GraphStatType::Kps,
                graph_type: GraphType::Line,
                graph_speed: 1000,
                graph_color: "graph".to_string(),
                show_avg_line: false,
                position: blank_position("graph-id"),
            }],
        )]),
        knob_positions: crate::models::KnobPositions::from([(
            "custom".to_string(),
            vec![KnobPosition {
                axis_id: "axis".to_string(),
                sensitivity: 1.0,
                reverse: false,
                position: blank_position("knob-id"),
            }],
        )]),
        ..AppStoreData::default()
    });

    for position in [
        &data.key_positions["custom"][0],
        &data.stat_positions["custom"][0].position,
        &data.graph_positions["custom"][0].position,
        &data.knob_positions["custom"][0].position,
    ] {
        assert!(position.font_color.is_none());
        assert!(position.active_font_color.is_none());
    }
}

#[test]
fn normalize_state_folds_replace_image_mode_to_sparse_none() {
    let data = normalize_state(AppStoreData {
        key_positions: crate::models::KeyPositions::from([(
            "custom".to_string(),
            vec![
                KeyPosition {
                    id: "replace".to_string(),
                    image_mode: Some(crate::models::ImageMode::Replace),
                    ..KeyPosition::default()
                },
                KeyPosition {
                    id: "overlay".to_string(),
                    image_mode: Some(crate::models::ImageMode::Overlay),
                    ..KeyPosition::default()
                },
            ],
        )]),
        ..AppStoreData::default()
    });

    assert_eq!(data.key_positions["custom"][0].image_mode, None);
    assert_eq!(
        data.key_positions["custom"][1].image_mode,
        Some(crate::models::ImageMode::Overlay)
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
    let dir = std::env::temp_dir().join(format!("dmnote-dangling-load-{}", uuid::Uuid::new_v4()));
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
            weight_ranges: Vec::new(),
        },
        CustomFont {
            id: "local-font".to_string(),
            font_type: FontType::Local,
            name: "Local Font".to_string(),
            display_name: "Local Font".to_string(),
            enabled: true,
            local_path: Some("relative/font.ttf".to_string()),
            css_content: None,
            weight_ranges: Vec::new(),
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
        weight_ranges: Vec::new(),
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
        weight_ranges: Vec::new(),
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
fn invalid_font_weight_ranges_are_reset_without_removing_the_font() {
    let path = std::env::temp_dir().join(format!(
        "dmnote-font-weight-range-recovery-test-{}.json",
        uuid::Uuid::new_v4()
    ));
    let mut fixture = serde_json::to_value(AppStoreData::default()).unwrap();
    fixture.as_object_mut().unwrap().insert(
            "fontSettings".to_string(),
            json!({
                "customFonts": [{
                    "id": "recoverable-web-font",
                    "type": "web",
                    "name": "Recoverable Web Font",
                    "displayName": "Recoverable Web Font",
                    "enabled": true,
                    "cssContent": "@font-face { font-family: 'Recoverable Web Font'; src: url(font.woff2); }",
                    "weightRanges": [{ "min": 900, "max": 100 }]
                }]
            }),
        );
    std::fs::write(&path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();

    let loaded = load_store_from_path(&path).unwrap();
    let _ = std::fs::remove_file(path);

    assert!(loaded.repaired);
    assert_eq!(loaded.data.font_settings.custom_fonts.len(), 1);
    assert_eq!(
        loaded.data.font_settings.custom_fonts[0].id,
        "recoverable-web-font"
    );
    assert!(loaded.data.font_settings.custom_fonts[0]
        .weight_ranges
        .is_empty());
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
        weight_ranges: Vec::new(),
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
fn image_settings_recover_in_place_without_removing_positions() {
    let path = std::env::temp_dir().join(format!(
        "dmnote-image-transform-recovery-test-{}.json",
        uuid::Uuid::new_v4()
    ));
    let positions = vec![
        default_positions()["4key"][0].clone(),
        default_positions()["4key"][1].clone(),
    ];
    let mut fixture = serde_json::to_value(AppStoreData::default()).unwrap();
    fixture["keyPositions"]["recovery-mode"] = serde_json::to_value(&positions).unwrap();
    fixture["keyPositions"]["recovery-mode"][0]["imageMode"] = json!("damaged");
    fixture["keyPositions"]["recovery-mode"][0]["idleImageTransform"] = json!({
        "offsetX": 25.0,
        "offsetY": -30.0,
        "rotation": 45.0,
        "scale": 100.0
    });
    std::fs::write(&path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();

    let loaded = load_store_from_path(&path).unwrap();
    let _ = std::fs::remove_file(path);

    assert!(loaded.repaired);
    assert!(loaded.needs_persist);
    assert_eq!(loaded.data.key_positions["recovery-mode"].len(), 2);
    let recovered = &loaded.data.key_positions["recovery-mode"][0];
    assert_eq!(recovered.image_mode, None);
    assert_eq!(
        recovered.idle_image_transform,
        Some(ImageTransform {
            offset_x: 25.0,
            offset_y: -30.0,
            rotation: 45.0,
            scale: 1.0,
        })
    );

    let mut data = loaded.data;
    let transform = data.key_positions.get_mut("recovery-mode").unwrap()[0]
        .active_image_transform
        .insert(ImageTransform {
            offset_x: 10.0,
            offset_y: 20.0,
            rotation: 30.0,
            scale: f64::NAN,
        });
    assert!(transform.scale.is_nan());
    let original_len = data.key_positions["recovery-mode"].len();
    assert!(repair_image_transforms(&mut data));
    assert_eq!(data.key_positions["recovery-mode"].len(), original_len);
    assert_eq!(
        data.key_positions["recovery-mode"][0].active_image_transform,
        Some(ImageTransform {
            offset_x: 10.0,
            offset_y: 20.0,
            rotation: 30.0,
            scale: 1.0,
        })
    );
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
        weight_ranges: Vec::new(),
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

    for (raw, name) in forms
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
        weight_ranges: Vec::new(),
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
        weight_ranges: Vec::new(),
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
        local_path: Some(r"C:\Users\me\AppData\Roaming\com.dmnote.desktop\fonts\p.ttf".to_string()),
        css_content: None,
        weight_ranges: Vec::new(),
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
