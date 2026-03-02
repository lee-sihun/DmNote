use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use dirs_next::config_dir;
use parking_lot::RwLock;
use serde::Deserialize;
use serde_json::Value;
use tauri::path::PathResolver;
use tauri::Runtime;
use uuid::Uuid;

use crate::{
    defaults::{default_keys, default_positions},
    models::{
        AppStoreData, FontType, GraphPositions, KeyCounters, KeyMappings, KeyPositions,
        LayerGroups, NoteSettings, OverlayBounds, SettingsState, StatPositions,
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
        let (path, mut state, mut needs_persist) = if default_path.exists() {
            let (state, migrated) = load_store_from_path(&default_path)?;
            (default_path.clone(), state, migrated)
        } else if let Some(legacy_path) = find_legacy_store_file() {
            // 레거시 파일은 읽어와서 새 포맷으로 현재 앱 데이터 경로(default_path)에 저장
            let (legacy, _) = load_store_from_path(&legacy_path)?;
            (default_path.clone(), legacy, true)
        } else {
            (default_path, initialize_default_state(), true)
        };

        // Migration: local fonts used to store base64(data URI) cssContent in store.json. Convert them
        // to path-based fonts stored under the app data directory so settings updates stay fast.
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
            if let Some(v) = obj.get_mut("graphPositions") {
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

fn load_store_from_path(path: &Path) -> Result<(AppStoreData, bool)> {
    let content = fs::read_to_string(path)
        .with_context(|| format!("failed to read store file at {}", path.display()))?;
    let (state, needs_persist) = match serde_json::from_str::<AppStoreData>(&content) {
        Ok(data) => {
            let needs_persist = data.font_settings.custom_fonts.iter().any(|font| {
                font.font_type == FontType::Local
                    && font
                        .css_content
                        .as_ref()
                        .map(|c| !c.trim().is_empty())
                        .unwrap_or(false)
            });
            (normalize_state(data), needs_persist)
        }
        // Repair legacy/invalid store files and persist the normalized state.
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

fn migrate_local_fonts_to_app_data(app_data_dir: &Path, data: &mut AppStoreData) -> bool {
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

            // If it's already inside the app data fonts directory, keep it and just drop cssContent.
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

        // If we can't import the font file, disable it and remove any stored cssContent to avoid
        // bloating the store (and slowing down unrelated settings updates).
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

fn migrate_key_images_to_app_data(app_data_dir: &Path, data: &mut AppStoreData) -> bool {
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

    // Legacy migration: fadePosition enum -> per-direction pixel fade values
    data.note_settings.migrate_fade_position();
    for tab in data.tab_note_overrides.values_mut() {
        tab.migrate_fade_position();
    }

    merge_default_counters(&mut data.key_counters, &data.keys);

    data.counter_animation_presets =
        crate::models::normalize_user_counter_animation_presets(data.counter_animation_presets);

    // Migration: old default counter settings were persisted with inverted active colors
    // (black text / outlined). Align them with the renderer defaults if they still match
    // the legacy pattern (to avoid overwriting user customizations).
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

fn merge_default_modes(target: &mut KeyMappings, defaults: &KeyMappings) {
    // Only seed missing modes; keep intentionally empty modes as-is.
    for (mode, value) in defaults.iter() {
        target.entry(mode.clone()).or_insert_with(|| value.clone());
    }
}

fn merge_default_positions(target: &mut KeyPositions, defaults: &KeyPositions) {
    // Only seed missing modes; keep intentionally empty modes as-is.
    for (mode, positions) in defaults.iter() {
        target
            .entry(mode.clone())
            .or_insert_with(|| positions.clone());
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
        if let Some(v) = obj.get("overlayVisible").and_then(Value::as_bool) {
            data.overlay_visible = v;
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
