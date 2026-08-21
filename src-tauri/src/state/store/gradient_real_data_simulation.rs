use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use super::AppStore;
use crate::models::KeySlot;
use crate::{
    commands::preset::{
        load::read_preset_file_for_simulation, save::write_preset_file_for_simulation, PresetFile,
    },
    defaults::{default_keys, default_positions},
    models::{AppStoreData, EditorCommitOrigin, EditorField, GradientSpec, KeyPosition},
    state::migration::{canonicalize_gradient_pairs, load_store_from_path, normalize_state},
};

const GRADIENT_FIELDS: [&str; 6] = [
    "backgroundGradient",
    "activeBackgroundGradient",
    "borderGradient",
    "activeBorderGradient",
    "fillIdleGradient",
    "fillActiveGradient",
];

struct RealFixture {
    source_path: PathBuf,
    bytes: Vec<u8>,
    digest: Vec<u8>,
}

impl RealFixture {
    fn from_env(simulation: u8) -> Self {
        let source_path = std::env::var_os("DMNOTE_SIM_STORE_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                panic!("DMNOTE_SIM_STORE_PATH must be set to run ignored simulation {simulation}")
            });
        let bytes = fs::read(&source_path).unwrap_or_else(|error| {
            panic!("failed to read DMNOTE_SIM_STORE_PATH for simulation {simulation}: {error}")
        });
        assert!(
            !bytes.is_empty(),
            "DMNOTE_SIM_STORE_PATH must point to a non-empty store"
        );
        let digest = Sha256::digest(&bytes).to_vec();
        Self {
            source_path,
            bytes,
            digest,
        }
    }

    fn verify_unchanged(&self) {
        let current = fs::read(&self.source_path)
            .expect("the source fixture must remain readable after the simulation");
        assert_eq!(
            Sha256::digest(&current).to_vec(),
            self.digest,
            "the source fixture changed during the simulation"
        );
    }
}

struct SimulationDir {
    path: PathBuf,
}

impl SimulationDir {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "dmnote-gradient-real-data-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&path).expect("simulation temp directory must be creatable");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for SimulationDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[derive(Clone)]
struct PositionLocation {
    mode: String,
    index: usize,
}

fn write_store_copy(directory: &SimulationDir, name: &str, bytes: &[u8]) -> PathBuf {
    let path = directory.path().join(name);
    fs::write(&path, bytes).expect("simulation store copy must be writable");
    path
}

fn first_position_location(value: &Value) -> PositionLocation {
    let modes = value
        .get("keyPositions")
        .and_then(Value::as_object)
        .expect("real store must contain a keyPositions object");
    for (mode, positions) in modes {
        if positions
            .as_array()
            .is_some_and(|positions| !positions.is_empty())
        {
            return PositionLocation {
                mode: mode.clone(),
                index: 0,
            };
        }
    }
    panic!("real store must contain at least one key position");
}

fn position_object_mut<'a>(
    value: &'a mut Value,
    location: &PositionLocation,
) -> &'a mut Map<String, Value> {
    value
        .get_mut("keyPositions")
        .and_then(Value::as_object_mut)
        .and_then(|modes| modes.get_mut(&location.mode))
        .and_then(Value::as_array_mut)
        .and_then(|positions| positions.get_mut(location.index))
        .and_then(Value::as_object_mut)
        .expect("selected key position must remain an object")
}

fn position_from_store<'a>(data: &'a AppStoreData, location: &PositionLocation) -> &'a KeyPosition {
    data.key_positions
        .get(&location.mode)
        .and_then(|positions| positions.get(location.index))
        .expect("selected key position must survive the simulation")
}

fn serialized_position(data: &AppStoreData, location: &PositionLocation) -> Value {
    serde_json::to_value(position_from_store(data, location))
        .expect("key position must remain serializable")
}

fn contains_gradient_fields(value: &Value) -> bool {
    match value {
        Value::Array(values) => values.iter().any(contains_gradient_fields),
        Value::Object(fields) => fields.iter().any(|(name, value)| {
            GRADIENT_FIELDS.contains(&name.as_str()) || contains_gradient_fields(value)
        }),
        _ => false,
    }
}

fn collect_counter_colors(value: &Value, colors: &mut Vec<Value>) {
    match value {
        Value::Array(values) => {
            for value in values {
                collect_counter_colors(value, colors);
            }
        }
        Value::Object(fields) => {
            if let Some(counter) = fields.get("counter").and_then(Value::as_object) {
                if let Some(fill) = counter.get("fill") {
                    colors.push(fill.clone());
                }
                if let Some(stroke) = counter.get("stroke") {
                    colors.push(stroke.clone());
                }
            }
            for value in fields.values() {
                collect_counter_colors(value, colors);
            }
        }
        _ => {}
    }
}

fn counter_colors(value: &Value) -> Vec<Value> {
    let mut colors = Vec::new();
    for field in [
        "keyPositions",
        "statPositions",
        "graphPositions",
        "knobPositions",
    ] {
        if let Some(collection) = value.get(field) {
            collect_counter_colors(collection, &mut colors);
        }
    }
    colors
}

fn collect_changed_paths(left: &Value, right: &Value, path: &str, changed: &mut BTreeSet<String>) {
    match (left, right) {
        (Value::Object(left), Value::Object(right)) => {
            for field in left.keys().chain(right.keys()) {
                let next_path = if path.is_empty() {
                    field.clone()
                } else {
                    format!("{path}.{field}")
                };
                match (left.get(field), right.get(field)) {
                    (Some(left), Some(right)) => {
                        collect_changed_paths(left, right, &next_path, changed);
                    }
                    _ => {
                        changed.insert(next_path);
                    }
                }
            }
        }
        (Value::Array(left), Value::Array(right)) => {
            if left.len() != right.len() {
                changed.insert(format!("{path}.<length>"));
            }
            for (left, right) in left.iter().zip(right) {
                collect_changed_paths(left, right, path, changed);
            }
        }
        _ if left != right => {
            changed.insert(path.to_string());
        }
        _ => {}
    }
}

fn changed_key_position_fields(left: &Value, right: &Value) -> BTreeSet<String> {
    let mut changed = BTreeSet::new();
    let Some(left_modes) = left.as_object() else {
        changed.insert("<invalid-source>".to_string());
        return changed;
    };
    let Some(right_modes) = right.as_object() else {
        changed.insert("<invalid-round-trip>".to_string());
        return changed;
    };
    for mode in left_modes.keys().chain(right_modes.keys()) {
        match (left_modes.get(mode), right_modes.get(mode)) {
            (Some(Value::Array(left)), Some(Value::Array(right))) => {
                if left.len() != right.len() {
                    changed.insert("<position-count>".to_string());
                }
                for (left, right) in left.iter().zip(right) {
                    collect_changed_paths(left, right, "", &mut changed);
                }
            }
            _ => {
                changed.insert("<mode-shape>".to_string());
            }
        }
    }
    changed
}

fn collection_counts(value: &Value, field: &str) -> BTreeMap<String, usize> {
    value
        .get(field)
        .and_then(Value::as_object)
        .expect("editor collection must be an object")
        .iter()
        .map(|(mode, entries)| {
            (
                mode.clone(),
                entries
                    .as_array()
                    .expect("editor collection mode must be an array")
                    .len(),
            )
        })
        .collect()
}

fn editor_position_semantics_without_ids(data: &AppStoreData) -> Value {
    let mut value = json!({
        "keyPositions": data.key_positions,
        "statPositions": data.stat_positions,
        "graphPositions": data.graph_positions,
        "knobPositions": data.knob_positions,
    });
    for field in [
        "keyPositions",
        "statPositions",
        "graphPositions",
        "knobPositions",
    ] {
        for entries in value
            .get_mut(field)
            .and_then(Value::as_object_mut)
            .expect("editor collection must remain an object")
            .values_mut()
        {
            for entry in entries
                .as_array_mut()
                .expect("editor collection mode must remain an array")
            {
                entry
                    .as_object_mut()
                    .expect("editor element must remain an object")
                    .remove("id");
            }
        }
    }
    value
}

fn editor_element_ids(data: &AppStoreData) -> BTreeSet<String> {
    data.key_positions
        .values()
        .flatten()
        .map(|position| position.id.clone())
        .chain(
            data.stat_positions
                .values()
                .flatten()
                .map(|position| position.position.id.clone()),
        )
        .chain(
            data.graph_positions
                .values()
                .flatten()
                .map(|position| position.position.id.clone()),
        )
        .chain(
            data.knob_positions
                .values()
                .flatten()
                .map(|position| position.position.id.clone()),
        )
        .collect()
}

fn editor_preset_from_store(data: &AppStoreData) -> PresetFile {
    PresetFile {
        keys: Some(data.keys.clone()),
        key_positions: Some(data.key_positions.clone()),
        stat_positions: Some(data.stat_positions.clone()),
        graph_positions: Some(data.graph_positions.clone()),
        knob_positions: Some(data.knob_positions.clone()),
        custom_tabs: Some(data.custom_tabs.clone()),
        selected_key_type: Some(data.selected_key_type.clone()),
        layer_groups: Some(data.layer_groups.clone()),
        ..PresetFile::default()
    }
}

fn import_editor_preset(directory: &Path, preset: PresetFile) -> AppStoreData {
    fs::create_dir_all(directory).expect("preset import directory must be creatable");
    let seed = normalize_state(AppStoreData {
        keys: default_keys().clone(),
        key_positions: default_positions().clone(),
        ..AppStoreData::default()
    });
    fs::write(
        directory.join("store.json"),
        serde_json::to_vec_pretty(&seed).expect("seed store must be serializable"),
    )
    .expect("seed store must be writable");

    let store =
        AppStore::initialize_in_dir(directory).expect("preset import store must initialize");
    let current = store.snapshot();
    let keys = preset.keys.unwrap_or_else(|| current.keys.clone());
    let key_positions = preset
        .key_positions
        .unwrap_or_else(|| current.key_positions.clone());
    let stat_positions = preset
        .stat_positions
        .unwrap_or_else(|| current.stat_positions.clone());
    let graph_positions = preset
        .graph_positions
        .unwrap_or_else(|| current.graph_positions.clone());
    let knob_positions = preset
        .knob_positions
        .unwrap_or_else(|| current.knob_positions.clone());
    let layer_groups = preset
        .layer_groups
        .unwrap_or_else(|| current.layer_groups.clone());
    let custom_tabs = preset
        .custom_tabs
        .unwrap_or_else(|| current.custom_tabs.clone());
    let selected_key_type = preset
        .selected_key_type
        .unwrap_or_else(|| current.selected_key_type.clone());

    store
        .commit_legacy_editor_transaction(
            EditorCommitOrigin::LegacyAdapter("gradient_simulation_preset_import".to_string()),
            &[
                EditorField::Keys,
                EditorField::KeyPositions,
                EditorField::StatPositions,
                EditorField::GraphPositions,
                EditorField::KnobPositions,
                EditorField::LayerGroups,
            ],
            move |data| {
                data.keys = keys;
                data.key_positions = key_positions;
                data.stat_positions = stat_positions;
                data.graph_positions = graph_positions;
                data.knob_positions = knob_positions;
                data.layer_groups = layer_groups;
                data.custom_tabs = custom_tabs;
                data.selected_key_type = selected_key_type;
                crate::state::native_element_id::rekey_store_element_ids(data);
                Ok(())
            },
        )
        .expect("preset editor collections must import atomically");

    let committed = store.snapshot();
    store
        .flush_and_shutdown()
        .expect("imported preset must flush");
    drop(store);

    let reloaded = load_store_from_path(&directory.join("store.json"))
        .expect("imported preset store must reload");
    assert!(!reloaded.repaired);
    assert_eq!(reloaded.data.editor_revision, committed.editor_revision);
    reloaded.data
}

fn set_damage_control_values(position: &mut Map<String, Value>) {
    position.insert("backgroundColor".to_string(), json!("#101010"));
    position.insert("activeBackgroundColor".to_string(), json!("#202020"));
    position.insert("borderColor".to_string(), json!("#303030"));
    position.insert("activeBorderColor".to_string(), json!("#404040"));

    let counter = position
        .get_mut("counter")
        .and_then(Value::as_object_mut)
        .expect("serialized key position must contain a counter object");
    let fill = counter
        .get_mut("fill")
        .and_then(Value::as_object_mut)
        .expect("serialized counter must contain fill colors");
    fill.insert("idle".to_string(), json!("#505050"));
    fill.insert("active".to_string(), json!("#606060"));
    let stroke = counter
        .get_mut("stroke")
        .and_then(Value::as_object_mut)
        .expect("serialized counter must contain stroke colors");
    stroke.insert("idle".to_string(), json!("#707070"));
    stroke.insert("active".to_string(), json!("#808080"));
}

// 실행: DMNOTE_SIM_STORE_PATH=/path/to/store.json cargo test -- --ignored
#[test]
#[ignore]
fn simulation_1_real_legacy_store_load_is_gradient_neutral() {
    let fixture = RealFixture::from_env(1);
    let directory = SimulationDir::new("legacy-load");
    let path = write_store_copy(&directory, "store.json", &fixture.bytes);

    let directly_parsed: AppStoreData = serde_json::from_slice(&fixture.bytes)
        .expect("real store must deserialize without collection recovery");
    let mut gradient_probe = directly_parsed.clone();
    let (gradient_changed, gradient_pair_repaired) =
        canonicalize_gradient_pairs(&mut gradient_probe);
    assert!(!gradient_changed);
    assert!(!gradient_pair_repaired);

    let loaded = load_store_from_path(&path).expect("real store must load through migration path");
    assert!(!loaded.repaired);
    fixture.verify_unchanged();

    println!(
        "SIMULATION 1 PASS: directParse=true recover=false gradientNeedsPersist=false gradientRepaired=false aggregateNeedsPersist={} aggregateRepaired=false",
        loaded.needs_persist
    );
}

// 실행: DMNOTE_SIM_STORE_PATH=/path/to/store.json cargo test -- --ignored
#[test]
#[ignore]
fn simulation_2_real_solid_store_migration_is_gradient_neutral_and_idempotent() {
    let fixture = RealFixture::from_env(2);
    let directory = SimulationDir::new("solid-round-trip");
    let path = write_store_copy(&directory, "store.json", &fixture.bytes);
    let source: Value =
        serde_json::from_slice(&fixture.bytes).expect("real store JSON must be readable");
    assert!(!contains_gradient_fields(&source));

    let loaded = load_store_from_path(&path).expect("solid real store must load");
    let round_trip =
        serde_json::to_value(&loaded.data).expect("loaded real store must reserialize");
    let keys_equal = source.get("keys") == round_trip.get("keys");
    let positions_equal = source.get("keyPositions") == round_trip.get("keyPositions");
    let counter_colors_equal = counter_colors(&source) == counter_colors(&round_trip);
    let gradients_absent = !contains_gradient_fields(&round_trip);
    let changed_fields = changed_key_position_fields(
        source.get("keyPositions").unwrap(),
        round_trip.get("keyPositions").unwrap(),
    );

    let key_position_counts_equal = collection_counts(&source, "keyPositions")
        == collection_counts(&round_trip, "keyPositions");
    let round_trip_path = write_store_copy(
        &directory,
        "store-round-trip.json",
        &serde_json::to_vec_pretty(&loaded.data).expect("loaded store must serialize"),
    );
    let reloaded = load_store_from_path(&round_trip_path)
        .expect("migrated solid store must reload idempotently");
    fixture.verify_unchanged();

    println!(
        "SIMULATION 2 RESULT: keysEqual={keys_equal} keyPositionsRawEqual={positions_equal} counterColorsRawEqual={counter_colors_equal} keyPositionCountsEqual={key_position_counts_equal} gradientsAbsent={gradients_absent} changedFields={changed_fields:?}"
    );
    assert!(keys_equal, "keys changed during solid round trip");
    assert!(
        key_position_counts_equal,
        "key position counts changed during solid migration"
    );
    assert!(
        changed_fields
            .iter()
            .all(|field| !GRADIENT_FIELDS.iter().any(|name| field.contains(name))),
        "solid migration changed gradient fields: {changed_fields:?}"
    );
    assert!(gradients_absent, "gradient siblings were generated");
    assert!(!reloaded.needs_persist);
    assert!(!reloaded.repaired);
    assert_eq!(reloaded.data, loaded.data);
}

// 실행: DMNOTE_SIM_STORE_PATH=/path/to/store.json cargo test -- --ignored
#[test]
#[ignore]
fn simulation_3_gradient_store_and_preset_chain_stays_canonical() {
    let fixture = RealFixture::from_env(3);
    let directory = SimulationDir::new("gradient-chain");
    let mut raw: Value =
        serde_json::from_slice(&fixture.bytes).expect("real store JSON must be readable");
    let location = first_position_location(&raw);
    let position = position_object_mut(&mut raw, &location);
    position.insert("backgroundColor".to_string(), json!("#BADBAD"));
    position.insert(
        "backgroundGradient".to_string(),
        json!({
            "type": "linear",
            "angle": 450,
            "stops": [
                { "color": "rgba(90, 162, 247, 1)", "pos": 1.4 },
                { "color": "rgba(139, 92, 246, 1)", "pos": -0.2 }
            ]
        }),
    );
    let counter = position
        .get_mut("counter")
        .and_then(Value::as_object_mut)
        .expect("real key position must contain counter settings");
    counter
        .get_mut("fill")
        .and_then(Value::as_object_mut)
        .expect("real counter must contain fill colors")
        .insert("idle".to_string(), json!("#BADBAD"));
    counter.insert(
        "fillIdleGradient".to_string(),
        json!({
            "angle": -90,
            "stops": [
                { "color": "#000000", "pos": 1.5 },
                { "color": "#FFFFFF80", "pos": -0.5 }
            ]
        }),
    );

    let injected_path = write_store_copy(
        &directory,
        "store-injected.json",
        &serde_json::to_vec_pretty(&raw).unwrap(),
    );
    let loaded = load_store_from_path(&injected_path)
        .expect("noncanonical gradient store must load and repair");
    assert!(loaded.needs_persist);
    assert!(loaded.repaired);
    let canonical_position = position_from_store(&loaded.data, &location);
    let background = canonical_position
        .background_gradient
        .as_ref()
        .expect("background gradient must survive");
    assert_eq!(background.angle, 90.0);
    assert_eq!(background.stops[0].pos, 0.0);
    assert_eq!(background.stops[1].pos, 1.0);
    assert_eq!(background.stops[0].color, "rgba(139, 92, 246, 1)");
    assert_eq!(
        canonical_position.background_color.as_deref(),
        Some("rgba(139, 92, 246, 1)")
    );
    let counter_gradient = canonical_position
        .counter
        .fill_idle_gradient
        .as_ref()
        .expect("counter gradient must survive");
    assert_eq!(counter_gradient.angle, 270.0);
    assert_eq!(counter_gradient.stops[0].pos, 0.0);
    assert_eq!(counter_gradient.stops[1].pos, 1.0);
    assert_eq!(
        canonical_position.counter.fill.idle,
        "rgba(255,255,255,0.502)"
    );

    let canonical_path = write_store_copy(
        &directory,
        "store-canonical.json",
        &serde_json::to_vec_pretty(&loaded.data).unwrap(),
    );
    let reloaded = load_store_from_path(&canonical_path)
        .expect("canonical gradient store must reload idempotently");
    assert!(!reloaded.needs_persist);
    assert!(!reloaded.repaired);
    assert!(reloaded.data == loaded.data);

    let preset_path = directory.path().join("preset.json");
    let preset = editor_preset_from_store(&reloaded.data);
    write_preset_file_for_simulation(&preset_path, &preset)
        .expect("canonical store must export as a preset");
    let imported_preset = read_preset_file_for_simulation(&preset_path)
        .expect("exported preset must pass the import parser");
    let imported_store = import_editor_preset(&directory.path().join("imported"), imported_preset);
    assert!(imported_store.keys == reloaded.data.keys);
    assert_eq!(
        editor_position_semantics_without_ids(&imported_store),
        editor_position_semantics_without_ids(&reloaded.data)
    );
    let source_ids = editor_element_ids(&reloaded.data);
    let imported_ids = editor_element_ids(&imported_store);
    assert_eq!(
        imported_ids.len(),
        imported_store.key_positions.values().flatten().count()
            + imported_store.stat_positions.values().flatten().count()
            + imported_store.graph_positions.values().flatten().count()
            + imported_store.knob_positions.values().flatten().count(),
        "imported element IDs must remain unique"
    );
    assert!(
        imported_ids
            .iter()
            .all(|id| uuid::Uuid::parse_str(id).is_ok()),
        "imported element IDs must be valid UUIDs"
    );
    assert!(
        source_ids.is_disjoint(&imported_ids),
        "preset import must rekey every native element"
    );
    fixture.verify_unchanged();

    println!(
        "SIMULATION 3 PASS: loadRepair=true reloadIdempotent=true presetExportImport=true angleAndStopsCanonical=true"
    );
}

// 실행: DMNOTE_SIM_STORE_PATH=/path/to/store.json cargo test -- --ignored
#[test]
#[ignore]
fn simulation_4_damaged_gradient_fields_are_isolated() {
    let fixture = RealFixture::from_env(4);
    let directory = SimulationDir::new("damaged-fields");
    let source_path = write_store_copy(&directory, "source.json", &fixture.bytes);
    let source = load_store_from_path(&source_path).expect("real store baseline must load");
    assert!(!source.repaired);
    let baseline_path = write_store_copy(
        &directory,
        "baseline.json",
        &serde_json::to_vec_pretty(&source.data).unwrap(),
    );
    let baseline = load_store_from_path(&baseline_path)
        .expect("persisted real store baseline must reload idempotently");
    assert!(!baseline.needs_persist);
    assert!(!baseline.repaired);
    let baseline_value = serde_json::to_value(&baseline.data).unwrap();
    let location = first_position_location(&baseline_value);

    for (label, target_field, damage) in [
        (
            "wrong-type",
            "backgroundGradient",
            json!(["not", "an", "object"]),
        ),
        (
            "one-stop",
            "fillIdleGradient",
            json!({
                "angle": 90,
                "stops": [{ "color": "#FFFFFF", "pos": 0 }]
            }),
        ),
        (
            "string-angle",
            "borderGradient",
            json!({
                "angle": "90",
                "stops": [
                    { "color": "#111111", "pos": 0 },
                    { "color": "#222222", "pos": 1 }
                ]
            }),
        ),
    ] {
        let mut damaged = baseline_value.clone();
        let position = position_object_mut(&mut damaged, &location);
        set_damage_control_values(position);
        let expected = Value::Object(position.clone());
        if target_field == "fillIdleGradient" {
            position
                .get_mut("counter")
                .and_then(Value::as_object_mut)
                .unwrap()
                .insert(target_field.to_string(), damage);
        } else {
            position.insert(target_field.to_string(), damage);
        }

        let damaged_path = write_store_copy(
            &directory,
            &format!("damaged-{label}.json"),
            &serde_json::to_vec_pretty(&damaged).unwrap(),
        );
        let loaded = load_store_from_path(&damaged_path)
            .unwrap_or_else(|error| panic!("{label} gradient damage must recover: {error}"));
        assert!(loaded.needs_persist);
        assert!(loaded.repaired);
        assert!(
            serialized_position(&loaded.data, &location) == expected,
            "{label} damage changed fields outside its target"
        );

        let canonical_path = write_store_copy(
            &directory,
            &format!("canonical-{label}.json"),
            &serde_json::to_vec_pretty(&loaded.data).unwrap(),
        );
        let reloaded = load_store_from_path(&canonical_path).unwrap();
        assert!(!reloaded.needs_persist);
        assert!(!reloaded.repaired);
        println!("SIMULATION 4 CASE {label} PASS: action=drop siblingsPreserved=true");
    }

    let mut damaged = baseline_value;
    let position = position_object_mut(&mut damaged, &location);
    set_damage_control_values(position);
    position.insert("activeBorderColor".to_string(), json!("#111111"));
    let input_gradient = json!({
        "angle": 90,
        "stops": [
            { "color": "#222222", "pos": 1.4 },
            { "color": "#111111", "pos": -0.4 }
        ]
    });
    position.insert("activeBorderGradient".to_string(), input_gradient.clone());
    let mut expected = Value::Object(position.clone());
    let canonical_gradient: GradientSpec = serde_json::from_value(input_gradient).unwrap();
    expected.as_object_mut().unwrap().insert(
        "activeBorderGradient".to_string(),
        serde_json::to_value(canonical_gradient).unwrap(),
    );

    let damaged_path = write_store_copy(
        &directory,
        "damaged-out-of-range.json",
        &serde_json::to_vec_pretty(&damaged).unwrap(),
    );
    let loaded = load_store_from_path(&damaged_path).expect("out-of-range stops must canonicalize");
    assert!(loaded.needs_persist);
    assert!(!loaded.repaired);
    assert!(
        serialized_position(&loaded.data, &location) == expected,
        "out-of-range repair changed fields outside its pair"
    );
    let gradient = position_from_store(&loaded.data, &location)
        .active_border_gradient
        .as_ref()
        .unwrap();
    assert_eq!(gradient.stops[0].pos, 0.0);
    assert_eq!(gradient.stops[1].pos, 1.0);

    let canonical_path = write_store_copy(
        &directory,
        "canonical-out-of-range.json",
        &serde_json::to_vec_pretty(&loaded.data).unwrap(),
    );
    let reloaded = load_store_from_path(&canonical_path).unwrap();
    assert!(!reloaded.needs_persist);
    assert!(!reloaded.repaired);
    fixture.verify_unchanged();

    println!("SIMULATION 4 CASE out-of-range PASS: action=canonicalize siblingsPreserved=true");
    println!("SIMULATION 4 PASS: damageCases=4 isolated=true reloadIdempotent=true");
}

#[test]
fn simulation_5_inline_legacy_preset_imports_without_gradients() {
    const LEGACY_PRESET: &str = r##"{
        "keys": {
            "4key": ["KeyQ"],
            "5key": ["KeyW"],
            "6key": ["KeyE"],
            "8key": ["KeyR"]
        },
        "keyPositions": {
            "4key": [{
                "dx": 12,
                "dy": 34,
                "width": 58,
                "count": 7,
                "backgroundColor": "#123456",
                "activeBackgroundColor": "#234567",
                "borderColor": "#345678",
                "activeBorderColor": "#456789",
                "counter": {
                    "fill": { "idle": "#ABCDEF", "active": "#FEDCBA" },
                    "stroke": { "idle": "#111111", "active": "#222222" }
                }
            }],
            "5key": [{ "dx": 0, "dy": 0, "width": 60, "count": 0 }],
            "6key": [{ "dx": 0, "dy": 0, "width": 60, "count": 0 }],
            "8key": [{ "dx": 0, "dy": 0, "width": 60, "count": 0 }]
        },
        "selectedKeyType": "4key"
    }"##;
    let legacy_value: Value = serde_json::from_str(LEGACY_PRESET).unwrap();
    assert!(!contains_gradient_fields(&legacy_value));

    let directory = SimulationDir::new("legacy-preset");
    let preset_path = directory.path().join("legacy-preset.json");
    fs::write(&preset_path, LEGACY_PRESET).unwrap();
    let preset = read_preset_file_for_simulation(&preset_path)
        .expect("gradient-free legacy preset must pass the import parser");
    let imported = import_editor_preset(&directory.path().join("imported"), preset);
    let position = &imported.key_positions["4key"][0];
    assert_eq!(imported.keys["4key"], vec![KeySlot::from("KeyQ")]);
    assert_eq!(position.background_color.as_deref(), Some("#123456"));
    assert_eq!(position.active_background_color.as_deref(), Some("#234567"));
    assert_eq!(position.border_color.as_deref(), Some("#345678"));
    assert_eq!(position.active_border_color.as_deref(), Some("#456789"));
    assert_eq!(position.counter.fill.idle, "#ABCDEF");
    assert_eq!(position.counter.fill.active, "#FEDCBA");
    assert!(position.background_gradient.is_none());
    assert!(position.active_background_gradient.is_none());
    assert!(position.border_gradient.is_none());
    assert!(position.active_border_gradient.is_none());
    assert!(position.counter.fill_idle_gradient.is_none());
    assert!(position.counter.fill_active_gradient.is_none());
    let imported_value = serde_json::to_value(&imported).unwrap();
    assert!(!contains_gradient_fields(&imported_value));

    println!(
        "SIMULATION 5 PASS: legacyPresetParsed=true imported=true baseAndCounterColorsPreserved=true gradientsAbsent=true"
    );
}
