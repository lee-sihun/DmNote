use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::mpsc,
    thread::{self, JoinHandle},
};

use anyhow::{anyhow, Context, Result};
use parking_lot::{Mutex, RwLock, RwLockWriteGuard};
use serde_json::Value;
use tauri::path::PathResolver;
use tauri::Runtime;
use uuid::Uuid;

use crate::models::{
    AppStoreData, FontType, GraphPositions, KeyCounters, KeyMappings, KeyPosition, KeyPositions,
    KnobPositions, LayerGroups, SettingsState, StatPositions,
};

use super::builtin_sounds::seed_builtin_sounds;
use super::migration::{
    find_legacy_store_file, load_store_from_path, migrate_key_images_to_app_data,
    migrate_local_fonts_to_app_data, normalize_state,
};

pub struct AppStore {
    path: PathBuf,
    state: RwLock<VersionedStoreState>,
    writer: StoreWriter,
}

struct VersionedStoreState {
    data: AppStoreData,
    revision: u64,
    accepting_writes: bool,
}

struct PersistTicket {
    revision: u64,
    completion_rx: mpsc::Receiver<PersistCompletion>,
}

struct PersistCompletion {
    revision: u64,
    result: std::result::Result<(), String>,
}

enum WriterMessage {
    Persist {
        revision: u64,
        snapshot: Box<AppStoreData>,
        completion_tx: mpsc::Sender<PersistCompletion>,
    },
    Shutdown {
        completion_tx: mpsc::Sender<()>,
    },
}

struct StoreWriter {
    sender: Mutex<Option<mpsc::Sender<WriterMessage>>>,
    handle: Mutex<Option<JoinHandle<()>>>,
}

impl AppStore {
    pub fn initialize<R: Runtime>(resolver: &PathResolver<R>) -> Result<Self> {
        let dir = resolver
            .app_data_dir()
            .context("failed to resolve app data directory")?;
        Self::initialize_in_dir(&dir)
    }

    fn initialize_in_dir(dir: &Path) -> Result<Self> {
        fs::create_dir_all(dir)
            .with_context(|| format!("failed to create data directory at {}", dir.display()))?;

        let default_path = dir.join("store.json");
        let (path, mut state, mut needs_persist) = if default_path.exists() {
            let loaded = load_store_from_path(&default_path)?;
            if loaded.repaired {
                backup_store_file(&default_path)?;
            }
            (default_path.clone(), loaded.data, loaded.needs_persist)
        } else if let Some(legacy_path) = find_legacy_store_file() {
            // 레거시 파일 로드 후 새 포맷으로 default_path에 저장
            let loaded = load_store_from_path(&legacy_path)?;
            (default_path.clone(), loaded.data, true)
        } else {
            (default_path, initialize_default_state(), true)
        };

        // 마이그레이션: 로컬 폰트 base64 cssContent → 앱 데이터 경로 기반 파일로 변환
        if migrate_local_fonts_to_app_data(dir, &mut state) {
            needs_persist = true;
        }
        if migrate_key_images_to_app_data(dir, &mut state) {
            needs_persist = true;
        }
        // 내장 키음 시딩
        if seed_builtin_sounds(dir, &mut state) {
            needs_persist = true;
        }

        let store = Self::new(path.clone(), state)?;

        if needs_persist || !path.exists() {
            store.persist_current()?;
        }

        // macOS: WKWebView Metal 설정 강제 적용
        #[cfg(target_os = "macos")]
        {
            let should_force = store.state.read().data.angle_mode != "metal";
            if should_force {
                store.update(|state| {
                    state.angle_mode = "metal".to_string();
                })?;
            }
        }

        Ok(store)
    }

    fn new(path: PathBuf, state: AppStoreData) -> Result<Self> {
        Ok(Self {
            writer: StoreWriter::start(path.clone())?,
            path,
            state: RwLock::new(VersionedStoreState {
                data: state,
                revision: 0,
                accepting_writes: true,
            }),
        })
    }

    fn lock_for_update(&self) -> Result<RwLockWriteGuard<'_, VersionedStoreState>> {
        let guard = self.state.write();
        if !guard.accepting_writes {
            return Err(anyhow!("store writer is shut down"));
        }
        Ok(guard)
    }

    fn enqueue_locked(&self, state: &mut VersionedStoreState) -> Result<PersistTicket> {
        state.revision = state
            .revision
            .checked_add(1)
            .context("store revision overflow")?;
        self.writer.enqueue(state.revision, state.data.clone())
    }

    fn persist_current(&self) -> Result<()> {
        let ticket = {
            let mut guard = self.lock_for_update()?;
            self.enqueue_locked(&mut guard)?
        };
        ticket.wait()
    }

    pub(crate) fn flush_and_shutdown(&self) -> Result<()> {
        let mut guard = self.state.write();
        guard.accepting_writes = false;
        self.writer.shutdown()
    }

    pub fn snapshot(&self) -> AppStoreData {
        self.state.read().data.clone()
    }

    pub fn with_state<T>(&self, reader: impl FnOnce(&AppStoreData) -> T) -> T {
        let guard = self.state.read();
        reader(&guard.data)
    }

    pub fn settings_snapshot(&self) -> SettingsState {
        settings_from_store(&self.state.read().data)
    }

    pub fn update<F>(&self, mut updater: F) -> Result<AppStoreData>
    where
        F: FnMut(&mut AppStoreData),
    {
        let (result, ticket) = {
            let mut guard = self.lock_for_update()?;
            updater(&mut guard.data);
            guard.data = normalize_state(guard.data.clone());
            let result = guard.data.clone();
            let ticket = self.enqueue_locked(&mut guard)?;
            (result, ticket)
        };
        ticket.wait()?;
        Ok(result)
    }

    pub fn update_keys(&self, mappings: KeyMappings) -> Result<KeyMappings> {
        let (result, ticket) = {
            let mut guard = self.lock_for_update()?;
            guard.data.keys = mappings;
            guard.data = normalize_state(guard.data.clone());
            let result = guard.data.keys.clone();
            let ticket = self.enqueue_locked(&mut guard)?;
            (result, ticket)
        };
        ticket.wait()?;
        Ok(result)
    }

    pub fn update_positions(&self, positions: KeyPositions) -> Result<KeyPositions> {
        let (result, ticket) = {
            let mut guard = self.lock_for_update()?;
            guard.data.key_positions = positions;
            guard.data = normalize_state(guard.data.clone());
            let result = guard.data.key_positions.clone();
            let ticket = self.enqueue_locked(&mut guard)?;
            (result, ticket)
        };
        ticket.wait()?;
        Ok(result)
    }

    pub fn update_layer_groups(&self, groups: LayerGroups) -> Result<LayerGroups> {
        let (result, ticket) = {
            let mut guard = self.lock_for_update()?;
            guard.data.layer_groups = groups;
            guard.data = normalize_state(guard.data.clone());
            let result = guard.data.layer_groups.clone();
            let ticket = self.enqueue_locked(&mut guard)?;
            (result, ticket)
        };
        ticket.wait()?;
        Ok(result)
    }

    pub fn update_stat_positions(&self, positions: StatPositions) -> Result<StatPositions> {
        let (result, ticket) = {
            let mut guard = self.lock_for_update()?;
            guard.data.stat_positions = positions;
            guard.data = normalize_state(guard.data.clone());
            let result = guard.data.stat_positions.clone();
            let ticket = self.enqueue_locked(&mut guard)?;
            (result, ticket)
        };
        ticket.wait()?;
        Ok(result)
    }

    pub fn update_graph_positions(&self, positions: GraphPositions) -> Result<GraphPositions> {
        let (result, ticket) = {
            let mut guard = self.lock_for_update()?;
            guard.data.graph_positions = positions;
            guard.data = normalize_state(guard.data.clone());
            let result = guard.data.graph_positions.clone();
            let ticket = self.enqueue_locked(&mut guard)?;
            (result, ticket)
        };
        ticket.wait()?;
        Ok(result)
    }

    pub fn update_knob_positions(&self, positions: KnobPositions) -> Result<KnobPositions> {
        let (result, ticket) = {
            let mut guard = self.lock_for_update()?;
            guard.data.knob_positions = positions;
            guard.data = normalize_state(guard.data.clone());
            let result = guard.data.knob_positions.clone();
            let ticket = self.enqueue_locked(&mut guard)?;
            (result, ticket)
        };
        ticket.wait()?;
        Ok(result)
    }

    pub fn set_key_counters(&self, counters: KeyCounters) -> Result<KeyCounters> {
        let (result, ticket) = {
            let mut guard = self.lock_for_update()?;
            guard.data.key_counters = counters;
            guard.data = normalize_state(guard.data.clone());
            let result = guard.data.key_counters.clone();
            let ticket = self.enqueue_locked(&mut guard)?;
            (result, ticket)
        };
        ticket.wait()?;
        Ok(result)
    }

    pub fn set_selected_key_type(&self, key: impl Into<String>) -> Result<String> {
        let key = key.into();
        let (result, ticket) = {
            let mut guard = self.lock_for_update()?;
            guard.data.selected_key_type = key;
            guard.data = normalize_state(guard.data.clone());
            let result = guard.data.selected_key_type.clone();
            let ticket = self.enqueue_locked(&mut guard)?;
            (result, ticket)
        };
        ticket.wait()?;
        Ok(result)
    }

    // 플러그인 데이터 관련 메서드
    pub fn get_plugin_data(&self, key: &str) -> Result<Option<Value>> {
        let guard = self.state.read();
        Ok(guard.data.plugin_data.get(key).cloned())
    }

    pub fn set_plugin_data(&self, key: &str, value: Value) -> Result<()> {
        let ticket = {
            let mut guard = self.lock_for_update()?;
            guard.data.plugin_data.insert(key.to_string(), value);
            self.enqueue_locked(&mut guard)?
        };
        ticket.wait()
    }

    pub fn remove_plugin_data(&self, key: &str) -> Result<()> {
        let ticket = {
            let mut guard = self.lock_for_update()?;
            guard.data.plugin_data.remove(key);
            self.enqueue_locked(&mut guard)?
        };
        ticket.wait()
    }

    pub fn clear_all_plugin_data(&self) -> Result<()> {
        let ticket = {
            let mut guard = self.lock_for_update()?;
            guard.data.plugin_data.clear();
            self.enqueue_locked(&mut guard)?
        };
        ticket.wait()
    }

    pub fn get_all_plugin_keys(&self) -> Result<Vec<String>> {
        let guard = self.state.read();
        Ok(guard.data.plugin_data.keys().cloned().collect())
    }

    /// 앱 종료 시점에 한 번 호출하는 자원 정리.
    /// 현재 store에서 참조하지 않는 appData/fonts, appData/images, appData/sounds 파일을 삭제
    pub fn cleanup_orphan_assets_now(&self) -> Result<()> {
        let snapshot = self.state.read().data.clone();
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

impl Drop for AppStore {
    fn drop(&mut self) {
        if let Err(err) = self.flush_and_shutdown() {
            log::warn!("failed to stop store writer during drop: {err}");
        }
    }
}

impl PersistTicket {
    fn wait(self) -> Result<()> {
        let completion = self
            .completion_rx
            .recv()
            .with_context(|| format!("store writer stopped before revision {}", self.revision))?;
        if completion.revision != self.revision {
            return Err(anyhow!(
                "store writer returned revision {} for requested revision {}",
                completion.revision,
                self.revision
            ));
        }
        completion.result.map_err(anyhow::Error::msg)
    }
}

impl StoreWriter {
    fn start(path: PathBuf) -> Result<Self> {
        let (sender, receiver) = mpsc::channel();
        let handle = thread::Builder::new()
            .name("dmnote-store-writer".to_string())
            .spawn(move || run_store_writer(&path, receiver))
            .context("failed to start store writer")?;
        Ok(Self {
            sender: Mutex::new(Some(sender)),
            handle: Mutex::new(Some(handle)),
        })
    }

    fn enqueue(&self, revision: u64, snapshot: AppStoreData) -> Result<PersistTicket> {
        let (completion_tx, completion_rx) = mpsc::channel();
        let guard = self.sender.lock();
        let sender = guard.as_ref().context("store writer is shut down")?;
        sender
            .send(WriterMessage::Persist {
                revision,
                snapshot: Box::new(snapshot),
                completion_tx,
            })
            .with_context(|| format!("failed to enqueue store revision {revision}"))?;
        Ok(PersistTicket {
            revision,
            completion_rx,
        })
    }

    fn shutdown(&self) -> Result<()> {
        let sender = self.sender.lock().take();
        let Some(sender) = sender else {
            return Ok(());
        };

        let (completion_tx, completion_rx) = mpsc::channel();
        if let Err(err) = sender.send(WriterMessage::Shutdown { completion_tx }) {
            drop(sender);
            let join_result = self
                .handle
                .lock()
                .take()
                .map(|handle| {
                    handle
                        .join()
                        .map_err(|_| anyhow!("store writer thread panicked"))
                })
                .transpose();
            join_result?;
            return Err(anyhow!("failed to enqueue store writer shutdown: {err}"));
        }
        drop(sender);
        let completion_result = completion_rx
            .recv()
            .context("store writer stopped before shutdown flush completed");
        let join_result = self
            .handle
            .lock()
            .take()
            .map(|handle| {
                handle
                    .join()
                    .map_err(|_| anyhow!("store writer thread panicked"))
            })
            .transpose();

        completion_result?;
        join_result?;
        Ok(())
    }
}

fn run_store_writer(path: &Path, receiver: mpsc::Receiver<WriterMessage>) {
    while let Ok(message) = receiver.recv() {
        match message {
            WriterMessage::Persist {
                revision,
                snapshot,
                completion_tx,
            } => {
                let result = write_store_snapshot(path, revision, snapshot.as_ref())
                    .map_err(|err| format!("{err:#}"));
                let _ = completion_tx.send(PersistCompletion { revision, result });
            }
            WriterMessage::Shutdown { completion_tx } => {
                let _ = completion_tx.send(());
                break;
            }
        }
    }
}

fn write_store_snapshot(path: &Path, revision: u64, state: &AppStoreData) -> Result<()> {
    let json = serialize_store(state)?;
    atomic_replace(path, json.as_bytes(), &format!("revision-{revision}"))
}

fn serialize_store(state: &AppStoreData) -> Result<String> {
    use serde_json::{to_value, Map, Value};

    let mut root = to_value(state)?;
    if let Value::Object(ref mut obj) = root {
        let reorder = |value: &mut Value| {
            if let Value::Object(current) = value {
                let desired = ["4key", "5key", "6key", "8key"];
                let mut next = Map::new();
                for key in desired.iter() {
                    if let Some(value) = current.get(*key) {
                        next.insert((*key).to_string(), value.clone());
                    }
                }
                let mut rest: Vec<(String, Value)> = current
                    .iter()
                    .filter(|(key, _)| !desired.contains(&key.as_str()))
                    .map(|(key, value)| (key.clone(), value.clone()))
                    .collect();
                rest.sort_by(|left, right| left.0.cmp(&right.0));
                for (key, value) in rest {
                    next.insert(key, value);
                }
                *value = Value::Object(next);
            }
        };

        for field in [
            "keys",
            "keyPositions",
            "statPositions",
            "graphPositions",
            "knobPositions",
            "keyCounters",
        ] {
            if let Some(value) = obj.get_mut(field) {
                reorder(value);
            }
        }
    }

    serde_json::to_string_pretty(&root).context("failed to serialize store")
}

fn backup_store_file(path: &Path) -> Result<()> {
    let content = fs::read(path)
        .with_context(|| format!("failed to read store backup source at {}", path.display()))?;
    let backup_path = path.with_extension("json.bak");
    atomic_replace(&backup_path, &content, "backup").with_context(|| {
        format!(
            "failed to back up damaged store before recovery at {}",
            backup_path.display()
        )
    })
}

fn atomic_replace(path: &Path, content: &[u8], label: &str) -> Result<()> {
    let parent = path
        .parent()
        .context("failed to resolve store file parent directory")?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .context("failed to resolve store file name")?;
    let tmp_path = parent.join(format!(".{file_name}.{label}-{}.tmp", Uuid::new_v4()));

    let result = (|| {
        let mut tmp = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp_path)
            .with_context(|| {
                format!("failed to create temp store file at {}", tmp_path.display())
            })?;
        tmp.write_all(content).with_context(|| {
            format!("failed to write temp store file at {}", tmp_path.display())
        })?;
        tmp.sync_all()
            .with_context(|| format!("failed to sync temp store file at {}", tmp_path.display()))?;
        drop(tmp);
        fs::rename(&tmp_path, path)
            .with_context(|| format!("failed to replace store file at {}", path.display()))
    })();

    if result.is_err() {
        let _ = fs::remove_file(&tmp_path);
    }
    result
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

    for position in iter_all_positions(data) {
        collect_image_path_from_option(&mut paths, position.active_image.as_ref());
        collect_image_path_from_option(&mut paths, position.inactive_image.as_ref());
    }

    paths
}

fn collect_local_sound_path_keys(data: &AppStoreData) -> HashSet<String> {
    let mut paths = HashSet::new();

    for position in iter_all_positions(data) {
        collect_sound_path_from_option(&mut paths, position.sound_path.as_ref());
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

fn iter_all_positions(data: &AppStoreData) -> impl Iterator<Item = &KeyPosition> {
    data.key_positions
        .values()
        .flatten()
        .chain(
            data.stat_positions
                .values()
                .flatten()
                .map(|position| &position.position),
        )
        .chain(
            data.graph_positions
                .values()
                .flatten()
                .map(|position| &position.position),
        )
        .chain(
            data.knob_positions
                .values()
                .flatten()
                .map(|position| &position.position),
        )
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

#[cfg(test)]
mod tests {
    use super::{
        collect_local_image_path_keys, collect_local_sound_path_keys, path_lookup_key, AppStore,
    };
    use crate::{
        defaults::default_positions,
        models::{
            AppStoreData, GraphPosition, GraphStatType, GraphType, KnobPosition, StatPosition,
            StatType,
        },
    };
    use serde_json::{json, Value};
    use std::sync::{Arc, Barrier};

    fn test_directory(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("dmnote-{label}-{}", uuid::Uuid::new_v4()))
    }

    // 프론트 저장 순서 재현: positions(groupId 포함) 먼저 → layerGroups 정의 나중
    // 부분 저장 중간 정규화가 신규 그룹 참조를 지우면 그룹 생성이 통째로 깨진다
    #[test]
    fn group_ids_survive_positions_saved_before_group_definitions() {
        let dir = test_directory("group-order-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();

        let mut positions = store.snapshot().key_positions;
        if let Some(list) = positions.get_mut("4key") {
            list[0].group_id = Some("new-group".to_string());
            list[1].group_id = Some("new-group".to_string());
        }
        store.update_positions(positions).unwrap();

        let mut groups = crate::models::LayerGroups::new();
        groups.insert(
            "4key".to_string(),
            vec![crate::models::LayerGroupDef {
                id: "new-group".to_string(),
                name: "New Group".to_string(),
            }],
        );
        store.update_layer_groups(groups).unwrap();

        let data = store.snapshot();
        assert_eq!(
            data.key_positions["4key"][0].group_id.as_deref(),
            Some("new-group")
        );
        assert_eq!(
            data.key_positions["4key"][1].group_id.as_deref(),
            Some("new-group")
        );

        // 재기동(로드 경계)에서도 정의가 존재하므로 참조가 유지되어야 함
        store.flush_and_shutdown().unwrap();
        drop(store);
        let reopened = AppStore::initialize_in_dir(&dir).unwrap();
        assert_eq!(
            reopened.snapshot().key_positions["4key"][0]
                .group_id
                .as_deref(),
            Some("new-group")
        );
        reopened.flush_and_shutdown().unwrap();
        drop(reopened);
        let _ = std::fs::remove_dir_all(dir);
    }

    // 로드 시 dangling groupId 정리는 디스크에도 영속되고, 두 번째 기동은 재저장이 필요 없어야 함
    #[test]
    fn dangling_group_ids_are_cleaned_and_persisted_on_boot() {
        let dir = test_directory("dangling-persist-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("store.json");

        let mut data = AppStoreData::default();
        let mut positions = default_positions().clone();
        if let Some(list) = positions.get_mut("4key") {
            list[0].group_id = Some("ghost-group".to_string());
        }
        data.key_positions = positions;
        std::fs::write(&path, serde_json::to_vec_pretty(&data).unwrap()).unwrap();

        let store = AppStore::initialize_in_dir(&dir).unwrap();
        store.flush_and_shutdown().unwrap();
        drop(store);

        let on_disk: AppStoreData = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(on_disk.key_positions["4key"][0].group_id, None);

        let reloaded = super::load_store_from_path(&path).unwrap();
        assert!(!reloaded.needs_persist);

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn repaired_store_is_backed_up_before_persist() {
        let dir = test_directory("store-backup-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("store.json");
        let mut fixture = serde_json::to_value(AppStoreData::default()).unwrap();
        fixture.as_object_mut().unwrap().insert(
            "alwaysOnTop".to_string(),
            Value::String("invalid".to_string()),
        );
        let original = serde_json::to_vec_pretty(&fixture).unwrap();
        std::fs::write(&path, &original).unwrap();

        let store = AppStore::initialize_in_dir(&dir).unwrap();
        store.flush_and_shutdown().unwrap();

        assert_eq!(std::fs::read(dir.join("store.json.bak")).unwrap(), original);
        assert!(serde_json::from_slice::<AppStoreData>(&std::fs::read(path).unwrap()).is_ok());

        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn backup_failure_keeps_damaged_store_untouched() {
        let dir = test_directory("store-backup-failure-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("store.json");
        let mut fixture = serde_json::to_value(AppStoreData::default()).unwrap();
        fixture.as_object_mut().unwrap().insert(
            "alwaysOnTop".to_string(),
            Value::String("invalid".to_string()),
        );
        let original = serde_json::to_vec_pretty(&fixture).unwrap();
        std::fs::write(&path, &original).unwrap();
        std::fs::create_dir(dir.join("store.json.bak")).unwrap();

        let result = AppStore::initialize_in_dir(&dir);
        if let Ok(store) = result {
            let _ = store.flush_and_shutdown();
            panic!("store initialization unexpectedly succeeded without a backup");
        }
        assert_eq!(std::fs::read(path).unwrap(), original);

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn concurrent_updates_persist_all_revisions_without_replace_races() {
        const UPDATE_COUNT: usize = 60;

        let dir = test_directory("store-concurrency-test");
        let store = Arc::new(AppStore::initialize_in_dir(&dir).unwrap());
        let barrier = Arc::new(Barrier::new(UPDATE_COUNT + 1));
        let mut handles = Vec::with_capacity(UPDATE_COUNT);

        for _ in 0..UPDATE_COUNT {
            let store = Arc::clone(&store);
            let barrier = Arc::clone(&barrier);
            handles.push(std::thread::spawn(move || {
                barrier.wait();
                store.update(|state| {
                    let count = state
                        .plugin_data
                        .get("concurrent_update_count")
                        .and_then(Value::as_u64)
                        .unwrap_or(0);
                    state
                        .plugin_data
                        .insert("concurrent_update_count".to_string(), json!(count + 1));
                })
            }));
        }

        barrier.wait();
        let mut failures = Vec::new();
        for handle in handles {
            match handle.join() {
                Ok(Ok(_)) => {}
                Ok(Err(err)) => failures.push(format!("{err:#}")),
                Err(_) => failures.push("update thread panicked".to_string()),
            }
        }
        assert!(failures.is_empty(), "persist failures: {failures:?}");

        let final_snapshot = store.snapshot();
        store.flush_and_shutdown().unwrap();
        assert!(store
            .update(|state| state.always_on_top = !state.always_on_top)
            .is_err());
        assert_eq!(store.snapshot(), final_snapshot);
        let persisted: AppStoreData =
            serde_json::from_slice(&std::fs::read(dir.join("store.json")).unwrap()).unwrap();
        assert_eq!(
            persisted.plugin_data["concurrent_update_count"].as_u64(),
            Some(UPDATE_COUNT as u64)
        );
        assert_eq!(persisted, final_snapshot);
        assert!(!std::fs::read_dir(&dir).unwrap().any(|entry| {
            entry
                .ok()
                .and_then(|entry| entry.file_name().into_string().ok())
                .is_some_and(|name| name.ends_with(".tmp"))
        }));

        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn asset_references_include_every_position_kind() {
        let mut data = AppStoreData::default();
        let base_position = default_positions()["4key"][0].clone();
        let root = std::env::temp_dir().join("dmnote-position-assets");

        let next_position = |kind: &str| {
            let mut position = base_position.clone();
            position.active_image = Some(
                root.join(format!("{kind}.png"))
                    .to_string_lossy()
                    .to_string(),
            );
            position.sound_path = Some(
                root.join(format!("{kind}.wav"))
                    .to_string_lossy()
                    .to_string(),
            );
            position
        };

        data.key_positions
            .insert("mode".to_string(), vec![next_position("key")]);
        data.stat_positions.insert(
            "mode".to_string(),
            vec![StatPosition {
                stat_type: StatType::Kps,
                position: next_position("stat"),
            }],
        );
        data.graph_positions.insert(
            "mode".to_string(),
            vec![GraphPosition {
                stat_type: GraphStatType::Kps,
                graph_type: GraphType::Line,
                graph_speed: 1,
                graph_color: "#FFFFFF".to_string(),
                show_avg_line: true,
                position: next_position("graph"),
            }],
        );
        data.knob_positions.insert(
            "mode".to_string(),
            vec![KnobPosition {
                axis_id: String::new(),
                sensitivity: 1.0,
                reverse: false,
                position: next_position("knob"),
            }],
        );

        let image_paths = collect_local_image_path_keys(&data);
        let sound_paths = collect_local_sound_path_keys(&data);
        for kind in ["key", "stat", "graph", "knob"] {
            assert!(image_paths.contains(&path_lookup_key(&root.join(format!("{kind}.png")))));
            assert!(sound_paths.contains(&path_lookup_key(&root.join(format!("{kind}.wav")))));
        }
    }
}
