use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use dirs_next::config_dir;
use parking_lot::RwLock;
use serde::Deserialize;
use serde_json::Value;
use tauri::path::PathResolver;
use tauri::Runtime;

use crate::{
    defaults::{default_keys, default_positions},
    models::{
        AppStoreData, KeyCounters, KeyMappings, KeyPositions, NoteSettings, OverlayBounds,
        StatPositions,
        SettingsState,
    },
};

const LEGACY_OVERLAY_WIDTH: f64 = 860.0;
const LEGACY_OVERLAY_HEIGHT: f64 = 320.0;

pub struct AppStore {
    path: PathBuf,
    state: RwLock<AppStoreData>,
}

impl AppStore {
    pub fn initialize<R: Runtime>(resolver: &PathResolver<R>) -> Result<Self> {
        let dir = resolver
            .app_data_dir()
            .context("failed to resolve app data directory")?;
        fs::create_dir_all(&dir)
            .with_context(|| format!("failed to create data directory at {}", dir.display()))?;

        let default_path = dir.join("store.json");
        let (path, state, needs_persist) = if default_path.exists() {
            (
                default_path.clone(),
                load_store_from_path(&default_path)?,
                false,
            )
        } else if let Some(legacy_path) = find_legacy_store_file() {
            // 레거시 파일은 읽어와서 새 포맷으로 현재 앱 데이터 경로(default_path)에 저장
            let legacy = load_store_from_path(&legacy_path)?;
            (default_path.clone(), legacy, true)
        } else {
            (default_path, initialize_default_state(), true)
        };

        let store = Self {
            path: path.clone(),
            state: RwLock::new(state),
        };

        if needs_persist || !path.exists() {
            let snapshot = store.state.read().clone();
            store.persist_locked(&snapshot)?;
        }

        // macOS: WKWebView uses Metal; keep the setting explicit in store.json.
        #[cfg(target_os = "macos")]
        {
            let should_force = store.state.read().angle_mode != "metal";
            if should_force {
                store.update(|state| {
                    state.angle_mode = "metal".to_string();
                })?;
            }
        }

        Ok(store)
    }

    pub fn snapshot(&self) -> AppStoreData {
        self.state.read().clone()
    }

    pub fn settings_snapshot(&self) -> SettingsState {
        settings_from_store(&self.state.read())
    }
    pub fn update<F>(&self, mut updater: F) -> Result<AppStoreData>
    where
        F: FnMut(&mut AppStoreData),
    {
        let mut guard = self.state.write();
        updater(&mut guard);
        *guard = normalize_state(guard.clone());
        self.persist_locked(&guard)?;
        Ok(guard.clone())
    }

    pub fn update_keys(&self, mappings: KeyMappings) -> Result<KeyMappings> {
        let mut guard = self.state.write();
        guard.keys = mappings.clone();
        *guard = normalize_state(guard.clone());
        self.persist_locked(&guard)?;
        Ok(guard.keys.clone())
    }

    pub fn update_positions(&self, positions: KeyPositions) -> Result<KeyPositions> {
        let mut guard = self.state.write();
        guard.key_positions = positions.clone();
        *guard = normalize_state(guard.clone());
        self.persist_locked(&guard)?;
        Ok(guard.key_positions.clone())
    }

    pub fn update_stat_positions(&self, positions: StatPositions) -> Result<StatPositions> {
        let mut guard = self.state.write();
        guard.stat_positions = positions.clone();
        *guard = normalize_state(guard.clone());
        self.persist_locked(&guard)?;
        Ok(guard.stat_positions.clone())
    }

    pub fn set_key_counters(&self, counters: KeyCounters) -> Result<KeyCounters> {
        let mut guard = self.state.write();
        guard.key_counters = counters.clone();
        *guard = normalize_state(guard.clone());
        self.persist_locked(&guard)?;
        Ok(guard.key_counters.clone())
    }

    pub fn set_selected_key_type(&self, key: impl Into<String>) -> Result<String> {
        let key = key.into();
        let mut guard = self.state.write();
        guard.selected_key_type = key.clone();
        *guard = normalize_state(guard.clone());
        self.persist_locked(&guard)?;
        Ok(guard.selected_key_type.clone())
    }

    // 플러그인 데이터 관련 메서드
    pub fn get_plugin_data(&self, key: &str) -> Result<Option<Value>> {
        let guard = self.state.read();
        Ok(guard.plugin_data.get(key).cloned())
    }

    pub fn set_plugin_data(&self, key: &str, value: Value) -> Result<()> {
        let mut guard = self.state.write();
        guard.plugin_data.insert(key.to_string(), value);
        self.persist_locked(&guard)?;
        Ok(())
    }

    pub fn remove_plugin_data(&self, key: &str) -> Result<()> {
        let mut guard = self.state.write();
        guard.plugin_data.remove(key);
        self.persist_locked(&guard)?;
        Ok(())
    }

    pub fn clear_all_plugin_data(&self) -> Result<()> {
        let mut guard = self.state.write();
        guard.plugin_data.clear();
        self.persist_locked(&guard)?;
        Ok(())
    }

    pub fn get_all_plugin_keys(&self) -> Result<Vec<String>> {
        let guard = self.state.read();
        Ok(guard.plugin_data.keys().cloned().collect())
    }

    fn persist_locked(&self, state: &AppStoreData) -> Result<()> {
        // JSON 출력 시 key 모드 순서를 4,5,6,8 순으로 고정하고 나머지는 사전순으로 정렬합니다.
        use serde_json::{to_value, Map, Value};

        let mut root = to_value(state)?;
        if let Value::Object(ref mut obj) = root {
            // 정렬 도우미
            let reorder = |value: &mut Value| {
                if let Value::Object(current) = value {
                    let desired = ["4key", "5key", "6key", "8key"];
                    let mut next = Map::new();
                    // 우선순위 키들 먼저
                    for k in desired.iter() {
                        if let Some(v) = current.get(*k) {
                            next.insert((*k).to_string(), v.clone());
                        }
                    }
                    // 나머지 키들 알파벳 순
                    let mut rest: Vec<(String, Value)> = current
                        .iter()
                        .filter(|(k, _)| !desired.contains(&k.as_str()))
                        .map(|(k, v)| (k.clone(), v.clone()))
                        .collect();
                    rest.sort_by(|a, b| a.0.cmp(&b.0));
                    for (k, v) in rest.into_iter() {
                        next.insert(k, v);
                    }
                    *value = Value::Object(next);
                }
            };

            if let Some(v) = obj.get_mut("keys") {
                reorder(v);
            }
            if let Some(v) = obj.get_mut("keyPositions") {
                reorder(v);
            }
            if let Some(v) = obj.get_mut("statPositions") {
                reorder(v);
            }
            if let Some(v) = obj.get_mut("keyCounters") {
                reorder(v);
            }
        }

        let json = serde_json::to_string_pretty(&root)?;
        fs::write(&self.path, json)
            .with_context(|| format!("failed to write store file at {}", self.path.display()))
    }
}

fn load_store_from_path(path: &Path) -> Result<AppStoreData> {
    let content = fs::read_to_string(path)
        .with_context(|| format!("failed to read store file at {}", path.display()))?;
    let state = match serde_json::from_str::<AppStoreData>(&content) {
        Ok(data) => normalize_state(data),
        Err(_) => repair_legacy_state(&content),
    };
    Ok(state)
}

fn find_legacy_store_file() -> Option<PathBuf> {
    // 고정된 레거시 경로: %APPDATA%/dm-note/config.json
    let base = config_dir()?;
    let candidate = base.join("dm-note").join("config.json");
    if candidate.exists() {
        Some(candidate)
    } else {
        None
    }
}

fn initialize_default_state() -> AppStoreData {
    let mut data = AppStoreData::default();
    data.keys = default_keys().clone();
    data.key_positions = default_positions().clone();
    normalize_state(data)
}

fn normalize_state(mut data: AppStoreData) -> AppStoreData {
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

    // Legacy migration: global noteSettings.borderRadius -> per-key noteBorderRadius
    if let Some(legacy_border_radius) = data.note_settings.border_radius.take() {
        for positions in data.key_positions.values_mut() {
            for pos in positions.iter_mut() {
                pos.note_border_radius = Some(legacy_border_radius);
            }
        }
    }

    merge_default_counters(&mut data.key_counters, &data.keys);

    if !data.keys.contains_key(&data.selected_key_type) {
        data.selected_key_type = "4key".to_string();
    }

    let _ = data.custom_js.normalize();

    data
}

fn merge_default_modes(target: &mut KeyMappings, defaults: &KeyMappings) {
    // Only seed missing modes; keep intentionally empty modes as-is.
    for (mode, value) in defaults.iter() {
        target.entry(mode.clone()).or_insert_with(|| value.clone());
    }
}

fn merge_default_positions(target: &mut KeyPositions, defaults: &KeyPositions) {
    // Only seed missing modes; keep intentionally empty modes as-is.
    for (mode, positions) in defaults.iter() {
        target.entry(mode.clone()).or_insert_with(|| positions.clone());
    }
}

fn merge_default_counters(target: &mut KeyCounters, keys: &KeyMappings) {
    for (mode, key_list) in keys.iter() {
        let entry = target.entry(mode.clone()).or_default();
        entry.retain(|key, _| key_list.contains(key));
        for key in key_list.iter() {
            entry.entry(key.clone()).or_insert(0);
        }
    }

    let available_modes: HashSet<_> = keys.keys().cloned().collect();
    target.retain(|mode, _| available_modes.contains(mode));
}

fn settings_from_store(store: &AppStoreData) -> SettingsState {
    let mut custom_js = store.custom_js.clone();
    let _ = custom_js.normalize();

    SettingsState {
        hardware_acceleration: store.hardware_acceleration,
        always_on_top: store.always_on_top,
        overlay_locked: store.overlay_locked,
        note_effect: store.note_effect,
        note_settings: store.note_settings.clone(),
        angle_mode: store.angle_mode.clone(),
        language: store.language.clone(),
        laboratory_enabled: store.laboratory_enabled,
        developer_mode_enabled: store.developer_mode_enabled,
        background_color: store.background_color.clone(),
        use_custom_css: store.use_custom_css,
        custom_css: store.custom_css.clone(),
        use_custom_js: store.use_custom_js,
        custom_js,
        overlay_resize_anchor: store.overlay_resize_anchor.clone(),
        key_counter_enabled: store.key_counter_enabled,
        grid_settings: store.grid_settings.clone(),
        shortcuts: store.shortcuts.clone(),
    }
}

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
