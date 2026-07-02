use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use parking_lot::RwLock;
use serde_json::Value;
use tauri::path::PathResolver;
use tauri::Runtime;

use crate::models::{
    AppStoreData, FontType, GraphPositions, KeyCounters, KeyMappings, KeyPositions, KnobPositions,
    LayerGroups, SettingsState, StatPositions,
};

use super::migration::{
    find_legacy_store_file, load_store_from_path, migrate_key_images_to_app_data,
    migrate_local_fonts_to_app_data, normalize_state,
};

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
        let (path, mut state, mut needs_persist) = if default_path.exists() {
            let (state, migrated) = load_store_from_path(&default_path)?;
            (default_path.clone(), state, migrated)
        } else if let Some(legacy_path) = find_legacy_store_file() {
            // 레거시 파일 로드 후 새 포맷으로 default_path에 저장
            let (legacy, _) = load_store_from_path(&legacy_path)?;
            (default_path.clone(), legacy, true)
        } else {
            (default_path, initialize_default_state(), true)
        };

        // 마이그레이션: 로컬 폰트 base64 cssContent → 앱 데이터 경로 기반 파일로 변환
        if migrate_local_fonts_to_app_data(&dir, &mut state) {
            needs_persist = true;
        }
        if migrate_key_images_to_app_data(&dir, &mut state) {
            needs_persist = true;
        }

        let store = Self {
            path: path.clone(),
            state: RwLock::new(state),
        };

        if needs_persist || !path.exists() {
            let snapshot = store.state.read().clone();
            store.persist_locked(&snapshot)?;
        }

        // macOS: WKWebView Metal 설정 강제 적용
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

    pub fn with_state<T>(&self, reader: impl FnOnce(&AppStoreData) -> T) -> T {
        let guard = self.state.read();
        reader(&guard)
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

    pub fn update_layer_groups(&self, groups: LayerGroups) -> Result<LayerGroups> {
        let mut guard = self.state.write();
        guard.layer_groups = groups;
        *guard = normalize_state(guard.clone());
        let result = guard.layer_groups.clone();
        drop(guard);
        let snapshot = self.state.read().clone();
        self.persist_locked(&snapshot)?;
        Ok(result)
    }

    pub fn update_stat_positions(&self, positions: StatPositions) -> Result<StatPositions> {
        let mut guard = self.state.write();
        guard.stat_positions = positions.clone();
        *guard = normalize_state(guard.clone());
        self.persist_locked(&guard)?;
        Ok(guard.stat_positions.clone())
    }

    pub fn update_graph_positions(&self, positions: GraphPositions) -> Result<GraphPositions> {
        let mut guard = self.state.write();
        guard.graph_positions = positions.clone();
        *guard = normalize_state(guard.clone());
        self.persist_locked(&guard)?;
        Ok(guard.graph_positions.clone())
    }

    pub fn update_knob_positions(&self, positions: KnobPositions) -> Result<KnobPositions> {
        let mut guard = self.state.write();
        guard.knob_positions = positions.clone();
        *guard = normalize_state(guard.clone());
        self.persist_locked(&guard)?;
        Ok(guard.knob_positions.clone())
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
        // JSON 출력 시 key 모드 순서 4,5,6,8 고정, 나머지 사전순 정렬
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
            if let Some(v) = obj.get_mut("graphPositions") {
                reorder(v);
            }
            if let Some(v) = obj.get_mut("knobPositions") {
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

    /// 앱 종료 시점에 한 번 호출하는 자원 정리.
    /// 현재 store에서 참조하지 않는 appData/fonts, appData/images, appData/sounds 파일을 삭제
    pub fn cleanup_orphan_assets_now(&self) -> Result<()> {
        let snapshot = self.state.read().clone();
        let app_data_dir = self
            .path
            .parent()
            .context("failed to resolve app data directory from store path")?;

        let fonts_dir = app_data_dir.join("fonts");
        let images_dir = app_data_dir.join("images");
        let sounds_dir = app_data_dir.join("sounds");

        let referenced_font_keys = collect_local_font_path_keys(&snapshot);
        let referenced_image_keys = collect_local_image_path_keys(&snapshot);
        let referenced_sound_keys = collect_local_sound_path_keys(&snapshot);

        sweep_unreferenced_asset_files("Fonts", &fonts_dir, &referenced_font_keys)?;
        sweep_unreferenced_asset_files("Images", &images_dir, &referenced_image_keys)?;
        sweep_unreferenced_asset_files("Sounds", &sounds_dir, &referenced_sound_keys)?;
        Ok(())
    }
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
        tray_enabled: store.tray_enabled,
        auto_update_enabled: store.auto_update_enabled,
        background_color: store.background_color.clone(),
        use_custom_css: store.use_custom_css,
        custom_css: store.custom_css.clone(),
        font_settings: store.font_settings.clone(),
        use_custom_js: store.use_custom_js,
        custom_js,
        overlay_resize_anchor: store.overlay_resize_anchor.clone(),
        key_counter_enabled: store.key_counter_enabled,
        grid_settings: store.grid_settings.clone(),
        shortcuts: store.shortcuts.clone(),
        obs_mode_enabled: store.obs_mode_enabled,
    }
}

fn initialize_default_state() -> AppStoreData {
    use crate::defaults::{default_keys, default_positions};

    let data = AppStoreData {
        keys: default_keys().clone(),
        key_positions: default_positions().clone(),
        ..Default::default()
    };
    normalize_state(data)
}

fn collect_local_font_path_keys(data: &AppStoreData) -> HashSet<String> {
    data.font_settings
        .custom_fonts
        .iter()
        .filter(|font| font.font_type == FontType::Local)
        .filter_map(|font| font.local_path.as_ref())
        .filter_map(|path| normalize_local_asset_path(path))
        .map(|path| path_lookup_key(&path))
        .collect()
}

fn collect_local_image_path_keys(data: &AppStoreData) -> HashSet<String> {
    let mut paths = HashSet::new();

    for positions in data.key_positions.values() {
        for position in positions {
            collect_image_path_from_option(&mut paths, position.active_image.as_ref());
            collect_image_path_from_option(&mut paths, position.inactive_image.as_ref());
        }
    }

    for positions in data.stat_positions.values() {
        for stat_position in positions {
            collect_image_path_from_option(
                &mut paths,
                stat_position.position.active_image.as_ref(),
            );
            collect_image_path_from_option(
                &mut paths,
                stat_position.position.inactive_image.as_ref(),
            );
        }
    }

    for positions in data.graph_positions.values() {
        for graph_position in positions {
            collect_image_path_from_option(
                &mut paths,
                graph_position.position.active_image.as_ref(),
            );
            collect_image_path_from_option(
                &mut paths,
                graph_position.position.inactive_image.as_ref(),
            );
        }
    }

    paths
}

fn collect_local_sound_path_keys(data: &AppStoreData) -> HashSet<String> {
    let mut paths = HashSet::new();

    for positions in data.key_positions.values() {
        for position in positions {
            collect_sound_path_from_option(&mut paths, position.sound_path.as_ref());
        }
    }

    // 사운드 라이브러리에 등록된 파일도 보호 (키에 할당 안 되어도 유지)
    for key in data.sound_library.keys() {
        let normalized = PathBuf::from(key);
        if normalized.is_absolute() {
            paths.insert(path_lookup_key(&normalized));
        }
    }

    paths
}

fn collect_image_path_from_option(paths: &mut HashSet<String>, value: Option<&String>) {
    let Some(path) = value else {
        return;
    };
    let Some(normalized) = normalize_local_asset_path(path) else {
        return;
    };
    paths.insert(path_lookup_key(&normalized));
}

fn collect_sound_path_from_option(paths: &mut HashSet<String>, value: Option<&String>) {
    let Some(path) = value else {
        return;
    };
    let Some(normalized) = normalize_local_asset_path(path) else {
        return;
    };
    paths.insert(path_lookup_key(&normalized));
}

fn normalize_local_asset_path(path: &str) -> Option<PathBuf> {
    let trimmed = path.trim();
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

    let normalized = if let Some(stripped) = trimmed
        .strip_prefix("file:///")
        .or_else(|| trimmed.strip_prefix("file://"))
    {
        #[cfg(target_os = "windows")]
        {
            let mut value = stripped.to_string();
            if value.starts_with('/') && value.as_bytes().get(2) == Some(&b':') {
                value = value[1..].to_string();
            }
            value = value.replace('/', "\\");
            PathBuf::from(value)
        }
        #[cfg(not(target_os = "windows"))]
        {
            PathBuf::from(stripped)
        }
    } else {
        PathBuf::from(trimmed)
    };

    if normalized.is_absolute() {
        Some(normalized)
    } else {
        None
    }
}

fn path_lookup_key(path: &Path) -> String {
    #[cfg(target_os = "windows")]
    {
        path.to_string_lossy()
            .replace('/', "\\")
            .to_ascii_lowercase()
    }
    #[cfg(not(target_os = "windows"))]
    {
        path.to_string_lossy().to_string()
    }
}

fn sweep_unreferenced_asset_files(
    log_prefix: &str,
    target_dir: &Path,
    referenced_path_keys: &HashSet<String>,
) -> Result<()> {
    if !target_dir.exists() {
        return Ok(());
    }

    let read_dir = fs::read_dir(target_dir)
        .with_context(|| format!("failed to read asset directory at {}", target_dir.display()))?;

    for entry in read_dir {
        let entry = match entry {
            Ok(entry) => entry,
            Err(err) => {
                log::warn!(
                    "[{log_prefix}] Failed to read an entry from '{}': {err}",
                    target_dir.display()
                );
                continue;
            }
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if !path.starts_with(target_dir) {
            continue;
        }
        let key = path_lookup_key(&path);
        if referenced_path_keys.contains(&key) {
            continue;
        }

        if let Err(err) = fs::remove_file(&path) {
            log::warn!(
                "[{log_prefix}] Failed to remove stale asset '{}': {err}",
                path.display()
            );
        } else {
            log::info!("[{log_prefix}] Removed stale asset '{}'", path.display());
        }
    }

    Ok(())
}
