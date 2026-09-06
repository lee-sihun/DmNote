use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Instant,
};

use crate::errors::EditorCommitError;
use crate::models::{
    key_mappings_contain_multi, normalize_key_mappings, AppStoreData, CommittedEditorChange,
    CustomCssPatch, CustomJsPatch, EditorCommitOrigin, EditorCommitRequest, EditorCommitResult,
    EditorCommittedV1, EditorDocumentV1, EditorField, EditorGetResult, EditorOpResultStatusV1,
    EditorOpResultV1, EditorTransactionResult, GestureCommitRequest, GestureCommitResult,
    HistoryStatus, KeyCounters, KeyMappings, NoteSettingsPatch, PluginInstancesChangedPayload,
    PluginInstancesCommitRequest, PluginInstancesReconcileRequest, SavedPluginInstance,
    SettingsDiff, SettingsPatchInput, SettingsState, EDITOR_SCHEMA_VERSION,
};
use anyhow::{anyhow, Context, Result};
use parking_lot::{RwLock, RwLockWriteGuard};
use serde_json::Value;
use tauri::path::PathResolver;
use tauri::Runtime;

use super::assets::builtin_sounds::seed_builtin_sounds;
use super::atomic_file::atomic_replace;
use super::editor::{
    gesture_request_fingerprint, next_revision, repair_selected_mode, request_fingerprint,
    request_payload_size, sync_key_counters, touched_pair, validate_document_transition,
    validate_document_transition_with_keying, validate_history_restore_metadata,
    validate_paired_update, validate_request_envelope, GrandfatherKeying, RequestFingerprint,
    MUTATION_ACK_CAPACITY,
};
use super::editor_ops::{
    prepare_editor_ops_transition, prepare_editor_ops_transition_with_plugin_refs,
};
use super::gesture::validate_gesture_commit_request;
use super::history::{
    CustomTabsHistorySnapshot, HistoryAdmissionGate, HistoryAdmissionLease, HistoryDirection,
    HistoryEntry, HistoryRecordPlan, HistoryScope, HistoryService, HistorySnapshot,
    PluginElementsHistorySnapshot, PresetFullHistorySnapshot, PresetHistorySettingsSnapshot,
    HISTORY_ENTRY_TOO_LARGE, HISTORY_INVALID_OPPOSITE_ENTRY, HISTORY_IN_PROGRESS,
    HISTORY_SCOPE_MISMATCH, HISTORY_TARGET_ALREADY_APPLIED, INVALID_HISTORY_OPERATION_ID,
};
use super::migration::{
    fill_missing_sprite_image_metrics, find_legacy_store_file, load_store_from_path,
    migrate_key_images_to_app_data, migrate_local_fonts_to_app_data, normalize_state,
    rehome_foreign_asset_references,
};
use super::plugin::{
    add_plugin_group_refs, decode_plugin_instance_entries, decode_plugin_instances_lenient,
    encode_plugin_instance_entries, encode_plugin_instances, for_each_stored_plugin_instances,
    is_plugin_instances_storage_key, normalize_plugin_instance_tab_id,
    plugin_group_refs_from_store, plugin_id_from_instances_storage_key,
    plugin_instances_storage_key, validate_plugin_id, validate_plugin_instances_reconcile_request,
    validate_plugin_instances_request, validate_plugin_instances_transition, PluginGroupRefs,
    StoredPluginInstanceEntry, PLUGIN_DATA_KEY_PREFIX,
};

mod asset_references;
mod editor_commit;
mod editor_transactions;
mod gesture_commit;
mod history_restore;
mod legacy_transactions;
mod persistence;
mod plugin_storage;
mod sound_assets;

use asset_references::{
    collect_local_font_paths, collect_local_image_paths, collect_local_sound_paths,
    warn_unresolved_asset_references,
};
#[cfg(test)]
use asset_references::{
    collect_local_image_path_keys, collect_local_sound_path_keys, iter_all_positions,
};
use editor_transactions::{
    editor_error_outcome, editor_history_error, ensure_generic_editor_unchanged,
    insert_gesture_mutation_ack, insert_mutation_ack, prepare_editor_patch_transition,
    project_editor_history_key_counters, project_history_key_counters, require_history_entry,
    validate_observed_history_epoch,
};
use persistence::StoreWriter;
pub(crate) use sound_assets::{
    move_staged_sound_deletions_to_trash, restore_staged_sound_deletions,
    stage_sound_files_for_deletion, StagedSoundDeletionFile, PROCESSED_WAV_TRANSACTION_LOCK,
};
#[cfg(test)]
use sound_assets::{
    purge_expired_trash_sessions_at, recover_interrupted_processed_wav_replacements_with,
    recover_interrupted_sound_deletions_with, sweep_unreferenced_asset_files, system_time_millis,
    TrashSession, TRASH_RETENTION,
};

const KEY_COUNTER_BASELINE_REQUIRED: &str = "KEY_COUNTER_BASELINE_REQUIRED";

fn key_counter_baseline_required() -> EditorCommitError {
    EditorCommitError::validation(
        KEY_COUNTER_BASELINE_REQUIRED,
        "key-changing editor mutations require live key counters",
    )
}

pub struct AppStore {
    path: PathBuf,
    state: RwLock<VersionedStoreState>,
    runtime_publication_generation: AtomicU64,
    writer: StoreWriter,
    skip_asset_sweep: bool,
    history_gate: Arc<HistoryAdmissionGate>,
}

struct VersionedStoreState {
    data: AppStoreData,
    revision: u64,
    dirty: bool,
    accepting_writes: bool,
    mutation_acks: VecDeque<MutationAck>,
    gesture_mutation_acks: VecDeque<GestureMutationAck>,
    plugin_model_revision: u64,
    history: HistoryService,
}

#[derive(Debug)]
pub(crate) struct HistoryOperationResult {
    pub(crate) status: HistoryStatus,
    pub(crate) change: Option<CommittedEditorChange>,
    pub(crate) aux_change: Option<HistoryAuxChange>,
    pub(crate) replayed: bool,
    pub(crate) runtime_publication_generation: u64,
}

#[derive(Debug)]
pub(crate) enum HistoryAuxChange {
    CustomTabs {
        snapshot: Box<CustomTabsHistorySnapshot>,
        changed_tab_css_ids: Vec<String>,
        plugin_ids: Vec<String>,
        revision: u64,
    },
    PresetFull {
        snapshot: Box<PresetFullHistorySnapshot>,
        settings_diff: Box<SettingsDiff>,
        changed_tab_css_ids: Vec<String>,
    },
    Mode(String),
    Counters(KeyCounters),
    PluginElements {
        plugin_id: String,
        revision: u64,
    },
    PluginElementsBatch {
        plugin_ids: Vec<String>,
        revision: u64,
    },
}

#[derive(Debug)]
pub(crate) struct PluginInstancesCommitOutcome {
    pub(crate) plugin_id: String,
    pub(crate) model_revision: u64,
    pub(crate) changed: bool,
    pub(crate) history_status: Option<HistoryStatus>,
}

#[derive(Debug)]
pub(crate) struct AdmittedPluginInstancesCommit {
    pub(crate) outcome: PluginInstancesCommitOutcome,
    _admission: HistoryAdmissionLease,
}

#[derive(Debug)]
pub(crate) struct GestureCommitOutcome {
    pub(crate) result: GestureCommitResult,
    pub(crate) change: Option<CommittedEditorChange>,
    pub(crate) changed_plugin_ids: Vec<String>,
    pub(crate) history_status: Option<HistoryStatus>,
    pub(crate) replayed: bool,
}

#[derive(Debug)]
pub(crate) struct AdmittedGestureCommit {
    pub(crate) outcome: GestureCommitOutcome,
    _admission: HistoryAdmissionLease,
}

#[derive(Debug)]
pub(crate) struct AdmittedPluginStorageMutation<T> {
    pub(crate) value: T,
    pub(crate) history_status: Option<HistoryStatus>,
    pub(crate) plugin_instances_changes: Vec<PluginInstancesStorageChange>,
    _admission: HistoryAdmissionLease,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PluginInstancesStorageChange {
    pub(crate) plugin_id: String,
    pub(crate) revision: u64,
}

#[derive(Debug)]
pub(crate) struct AdmittedEditorTransaction<T> {
    pub(crate) value: T,
    pub(crate) change: CommittedEditorChange,
    _admission: HistoryAdmissionLease,
}

#[derive(Debug)]
pub(crate) struct AdmittedHistoryOverlapMutation<T> {
    pub(crate) value: T,
    pub(crate) history_status: Option<HistoryStatus>,
    _admission: HistoryAdmissionLease,
}

#[derive(Clone)]
struct MutationAck {
    id: String,
    fingerprint: RequestFingerprint,
    result: EditorCommitResult,
}

#[derive(Clone)]
struct GestureMutationAck {
    id: String,
    fingerprint: RequestFingerprint,
    result: GestureCommitResult,
}

struct PluginInstancesMutationInput {
    plugin_id: String,
    instances: Vec<SavedPluginInstance>,
    gesture_id: Option<String>,
}

struct EditorPatchCommitOptions {
    mutation_id: String,
    gesture_id: Option<String>,
    gesture_ids: Vec<String>,
    origin: EditorCommitOrigin,
    record_history: bool,
    apply_key_side_effects: bool,
    enforce_touched_fields: bool,
}

#[derive(Default)]
struct EditorTransactionHistoryOptions {
    scope: Option<HistoryScope>,
    observed_epoch: Option<u64>,
    key_counters: Option<KeyCounters>,
    invalidate_history_on_store_only_change: bool,
    plugin_instances_reset: Option<PluginInstancesResetScope>,
}

#[derive(Clone)]
pub(crate) enum PluginInstancesResetScope {
    All,
    Mode(String),
}

pub(crate) struct AuxEditorTransactionOptions<'a> {
    pub(crate) scope: HistoryScope,
    pub(crate) observed_history_epoch: Option<u64>,
    pub(crate) origin: EditorCommitOrigin,
    pub(crate) touched_fields: &'a [EditorField],
}

pub(crate) struct AuxEditorResetTransactionOptions<'a> {
    pub(crate) scope: HistoryScope,
    pub(crate) observed_history_epoch: Option<u64>,
    pub(crate) origin: EditorCommitOrigin,
    pub(crate) touched_fields: &'a [EditorField],
    pub(crate) plugin_instances_reset: PluginInstancesResetScope,
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
        let had_existing_default_store = default_path.exists();
        let (path, mut state, mut needs_persist, skip_asset_sweep) = if default_path.exists() {
            let loaded = load_store_from_path(&default_path)?;
            if loaded.repaired {
                backup_store_file(&default_path)?;
            }
            (
                default_path.clone(),
                loaded.data,
                loaded.needs_persist,
                loaded.repaired,
            )
        } else if let Some(legacy_path) = find_legacy_store_file() {
            // 레거시 파일 로드 후 새 포맷으로 default_path에 저장
            let loaded = load_store_from_path(&legacy_path)?;
            (default_path.clone(), loaded.data, true, true)
        } else {
            (default_path, initialize_default_state(), true, false)
        };

        // 외래 기기 자산 참조를 먼저 재연결 — 이후 마이그레이션이 실존 파일 기준으로 판단
        if rehome_foreign_asset_references(dir, &mut state) {
            needs_persist = true;
        }
        // 마이그레이션: 로컬 폰트 base64 cssContent → 앱 데이터 경로 기반 파일로 변환
        if migrate_local_fonts_to_app_data(dir, &mut state) {
            needs_persist = true;
        }
        if migrate_key_images_to_app_data(dir, &mut state) {
            needs_persist = true;
        }
        if fill_missing_sprite_image_metrics(&mut state.sprite_positions) {
            needs_persist = true;
        }
        // 내장 키음 시딩
        if seed_builtin_sounds(dir, &mut state) {
            needs_persist = true;
        }

        warn_unresolved_asset_references(dir, &state);

        if needs_persist && had_existing_default_store && !skip_asset_sweep {
            if let Some(backup_path) = preserve_pre_migration_store(&path).with_context(|| {
                format!(
                    "failed to preserve store before migration at {}",
                    path.display()
                )
            })? {
                log::info!(
                    "[Store] Preserved pre-migration store at {}",
                    backup_path.display()
                );
            }
        }

        let store = Self::new(path.clone(), state, skip_asset_sweep)?;

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

    #[cfg(test)]
    pub(crate) fn initialize_for_test(dir: &Path) -> Result<Self> {
        Self::initialize_in_dir(dir)
    }

    fn new(path: PathBuf, state: AppStoreData, skip_asset_sweep: bool) -> Result<Self> {
        Ok(Self {
            writer: StoreWriter::start(path.clone())?,
            path,
            skip_asset_sweep,
            history_gate: Arc::new(HistoryAdmissionGate::default()),
            runtime_publication_generation: AtomicU64::new(0),
            state: RwLock::new(VersionedStoreState {
                data: state,
                revision: 0,
                dirty: false,
                accepting_writes: true,
                mutation_acks: VecDeque::with_capacity(MUTATION_ACK_CAPACITY),
                gesture_mutation_acks: VecDeque::with_capacity(MUTATION_ACK_CAPACITY),
                plugin_model_revision: 0,
                history: HistoryService::default(),
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

    fn commit_locked<T>(
        &self,
        state: &mut VersionedStoreState,
        scratch: AppStoreData,
        result: T,
    ) -> Result<T> {
        let revision = state
            .revision
            .checked_add(1)
            .context("store revision overflow")?;
        let ticket = self.writer.enqueue(revision, scratch.clone())?;
        ticket.wait()?;
        state.data = scratch;
        state.revision = revision;
        self.runtime_publication_generation
            .store(revision, Ordering::Release);
        state.dirty = false;
        Ok(result)
    }

    fn update_committed<T>(
        &self,
        updater: impl FnOnce(&mut AppStoreData),
        reader: impl FnOnce(&AppStoreData) -> T,
    ) -> Result<T> {
        let mut guard = self.lock_for_update()?;
        let before = guard.data.clone();
        let mut scratch = guard.data.clone();
        updater(&mut scratch);
        ensure_generic_editor_unchanged(&before, &scratch)?;
        let result = reader(&scratch);
        self.commit_locked(&mut guard, scratch, result)
    }

    fn persist_current(&self) -> Result<()> {
        let mut guard = self.lock_for_update()?;
        let scratch = guard.data.clone();
        self.commit_locked(&mut guard, scratch, ())
    }

    /// overlay·panel 창 상태 전용 - 드래그와 리사이즈로 쏟아지는 갱신을 합치는 경로다.
    /// 저장 보증이 필요한 갱신은 호출자가 락을 놓은 뒤 flush로 이어 붙인다(분리 플래그가 그 경우).
    /// 다른 데이터에는 일반 update를 사용해 성공한 저장만 committed로 공개해야 함
    pub(crate) fn update_deferred(&self, updater: impl FnOnce(&mut AppStoreData)) -> Result<()> {
        let mut guard = self.lock_for_update()?;
        let mut scratch = guard.data.clone();
        updater(&mut scratch);
        ensure_generic_editor_unchanged(&guard.data, &scratch)?;
        guard.data = scratch;
        guard.dirty = true;
        Ok(())
    }

    pub(crate) fn flush(&self) -> Result<()> {
        let mut guard = self.state.write();
        self.flush_locked(&mut guard)
    }

    fn flush_locked(&self, guard: &mut VersionedStoreState) -> Result<()> {
        if !guard.dirty {
            return Ok(());
        }
        if !guard.accepting_writes {
            return Err(anyhow!("store writer is shut down"));
        }

        let scratch = guard.data.clone();
        let result = self.commit_locked(guard, scratch, ());
        if let Err(err) = &result {
            log::warn!("failed to flush deferred store state: {err:#}");
        }
        result
    }

    pub(crate) fn flush_and_shutdown(&self) -> Result<()> {
        let mut guard = self.state.write();
        self.flush_locked(&mut guard)?;
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
        crate::services::settings::settings_from_store(&self.state.read().data)
    }

    pub fn update<F>(&self, updater: F) -> Result<AppStoreData>
    where
        F: FnOnce(&mut AppStoreData),
    {
        self.update_committed(updater, AppStoreData::clone)
    }

    pub fn editor_get(&self) -> EditorGetResult {
        let guard = self.state.read();
        EditorGetResult {
            revision: guard.data.editor_revision,
            document: EditorDocumentV1::from_store(&guard.data),
        }
    }

    pub(crate) fn history_gate(&self) -> Arc<HistoryAdmissionGate> {
        Arc::clone(&self.history_gate)
    }

    pub(crate) fn history_status(&self) -> HistoryStatus {
        self.state
            .write()
            .history
            .issue_status(self.history_gate.is_closed())
    }

    pub(crate) fn runtime_publication_generation(&self) -> u64 {
        self.runtime_publication_generation.load(Ordering::Acquire)
    }

    pub(crate) fn plugin_model_revision(&self) -> u64 {
        self.state.read().plugin_model_revision
    }

    pub fn set_key_counters(&self, counters: KeyCounters) -> Result<KeyCounters> {
        self.update_committed(
            move |state| state.key_counters = counters,
            |state| state.key_counters.clone(),
        )
    }

    pub(crate) fn commit_key_counters_admitted(
        &self,
        before: KeyCounters,
        mut counters: KeyCounters,
        observed_history_epoch: Option<u64>,
        admission: &HistoryAdmissionLease,
    ) -> std::result::Result<(KeyCounters, Option<HistoryStatus>, u64), EditorCommitError> {
        let mut guard = self
            .lock_for_update()
            .map_err(|error| EditorCommitError::io(error.to_string()))?;
        admission
            .revalidate_for(&self.history_gate)
            .map_err(|_| EditorCommitError::history_in_progress())?;
        validate_observed_history_epoch(&guard.history, observed_history_epoch)?;
        sync_key_counters(&mut counters, &guard.data.keys);
        let runtime_changed = before != counters;
        let plan = runtime_changed
            .then(|| guard.history.prepare_counters_entry(before))
            .transpose()
            .map_err(|error| {
                EditorCommitError::validation("HISTORY_SERIALIZATION_FAILED", error)
            })?;
        if runtime_changed || guard.data.key_counters != counters {
            let mut scratch = guard.data.clone();
            scratch.key_counters = counters.clone();
            self.commit_locked(&mut guard, scratch, ())
                .map_err(|error| EditorCommitError::io(error.to_string()))?;
        }
        let status = plan.map(|plan| {
            guard.history.apply_record_plan(plan);
            guard.history.issue_status(self.history_gate.is_closed())
        });
        Ok((counters, status, guard.revision))
    }
}

impl Drop for AppStore {
    fn drop(&mut self) {
        if let Err(err) = self.flush_and_shutdown() {
            log::warn!("failed to stop store writer during drop: {err}");
        }
    }
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

fn pre_migration_backup_path(path: &Path) -> Result<PathBuf> {
    let mut file_name = path
        .file_name()
        .context("failed to resolve store file name")?
        .to_os_string();
    file_name.push(".pre-migration.bak");
    Ok(path.with_file_name(file_name))
}

fn preserve_pre_migration_store(path: &Path) -> Result<Option<PathBuf>> {
    let backup_path = pre_migration_backup_path(path)?;
    match fs::hard_link(path, &backup_path) {
        Ok(()) => Ok(Some(backup_path)),
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
            let metadata = fs::symlink_metadata(&backup_path).with_context(|| {
                format!(
                    "failed to inspect existing pre-migration backup at {}",
                    backup_path.display()
                )
            })?;
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(anyhow!(
                    "pre-migration backup path is not a regular file: {}",
                    backup_path.display()
                ));
            }
            let backup = fs::read(&backup_path).with_context(|| {
                format!(
                    "failed to read existing pre-migration backup at {}",
                    backup_path.display()
                )
            })?;
            let value: Value = serde_json::from_slice(&backup).with_context(|| {
                format!(
                    "existing pre-migration backup is not valid JSON at {}",
                    backup_path.display()
                )
            })?;
            if !value.is_object() {
                return Err(anyhow!(
                    "existing pre-migration backup is not a JSON object: {}",
                    backup_path.display()
                ));
            }
            Ok(None)
        }
        Err(err) => Err(err).with_context(|| {
            format!(
                "failed to create pre-migration backup at {}",
                backup_path.display()
            )
        }),
    }
}

fn initialize_default_state() -> AppStoreData {
    use crate::defaults::{default_keys, default_positions, default_stat_positions};

    let mut data = normalize_state(AppStoreData {
        keys: default_keys().clone(),
        key_positions: default_positions().clone(),
        stat_positions: default_stat_positions().clone(),
        ..Default::default()
    });
    crate::state::native_element_id::backfill_store_element_ids(&mut data);
    data
}

fn plugin_elements_snapshot(
    store: &AppStoreData,
    plugin_id: &str,
) -> Result<PluginElementsHistorySnapshot, String> {
    validate_plugin_id(plugin_id)?;
    let key = plugin_instances_storage_key(plugin_id);
    Ok(PluginElementsHistorySnapshot {
        plugin_id: plugin_id.to_string(),
        instances: decode_plugin_instances_lenient(store.plugin_data.get(&key), &key),
    })
}

fn next_plugin_model_revision(current: u64) -> Result<u64, String> {
    current
        .checked_add(1)
        .filter(|revision| *revision <= crate::state::editor::MAX_SAFE_WIRE_REVISION)
        .ok_or_else(|| "PLUGIN_MODEL_REVISION_OUT_OF_RANGE".to_string())
}

fn collect_plugin_instance_ids<'a>(keys: impl Iterator<Item = &'a str>) -> Vec<String> {
    let mut plugin_ids = keys
        .filter_map(plugin_id_from_instances_storage_key)
        .map(str::to_string)
        .collect::<Vec<_>>();
    plugin_ids.sort_unstable();
    plugin_ids.dedup();
    plugin_ids
}

fn reset_plugin_instances_for_scope(
    store: &mut AppStoreData,
    scope: &PluginInstancesResetScope,
) -> std::result::Result<Vec<String>, EditorCommitError> {
    let mut keys = store
        .plugin_data
        .keys()
        .filter(|key| is_plugin_instances_storage_key(key))
        .cloned()
        .collect::<Vec<_>>();
    keys.sort_unstable();
    let mut affected_plugin_ids = Vec::new();

    for key in keys {
        let Some(plugin_id) = plugin_id_from_instances_storage_key(&key).map(str::to_string) else {
            continue;
        };
        match scope {
            PluginInstancesResetScope::All => {
                store.plugin_data.remove(&key);
                affected_plugin_ids.push(plugin_id);
            }
            PluginInstancesResetScope::Mode(mode) => {
                let Some(value) = store.plugin_data.get(&key) else {
                    continue;
                };
                let Some(mut entries) = decode_plugin_instance_entries(value, &key) else {
                    continue;
                };
                let mut removed = false;
                entries.retain(|entry| {
                    let StoredPluginInstanceEntry::Parsed { instance, .. } = entry else {
                        return true;
                    };
                    let retain =
                        normalize_plugin_instance_tab_id(instance.tab_id.as_deref()) != mode;
                    removed |= !retain;
                    retain
                });
                if !removed {
                    continue;
                }
                if entries.is_empty() {
                    store.plugin_data.remove(&key);
                } else {
                    let value = encode_plugin_instance_entries(entries, &key);
                    store.plugin_data.insert(key, value);
                }
                affected_plugin_ids.push(plugin_id);
            }
        }
    }

    affected_plugin_ids.sort_unstable();
    affected_plugin_ids.dedup();
    Ok(affected_plugin_ids)
}

fn plugin_id_from_storage_namespace_prefix(prefix: &str) -> Option<&str> {
    let plugin_id = prefix
        .strip_prefix(PLUGIN_DATA_KEY_PREFIX)?
        .strip_suffix('/')?;
    validate_plugin_id(plugin_id).ok()?;
    Some(plugin_id)
}

fn apply_plugin_elements_snapshot(
    store: &mut AppStoreData,
    snapshot: &PluginElementsHistorySnapshot,
) -> Result<(), String> {
    validate_plugin_id(&snapshot.plugin_id)?;
    let key = plugin_instances_storage_key(&snapshot.plugin_id);
    match snapshot
        .instances
        .as_deref()
        .map(encode_plugin_instances)
        .transpose()?
    {
        Some(Some(value)) => {
            store.plugin_data.insert(key, value);
        }
        Some(None) | None => {
            store.plugin_data.remove(&key);
        }
    }
    Ok(())
}

fn preset_history_settings_patch(settings: &PresetHistorySettingsSnapshot) -> SettingsPatchInput {
    let note = &settings.note_settings;
    SettingsPatchInput {
        note_effect: Some(settings.note_effect),
        laboratory_enabled: Some(settings.laboratory_enabled),
        note_settings: Some(NoteSettingsPatch {
            frame_limit: Some(note.frame_limit),
            speed: Some(note.speed),
            track_height: Some(note.track_height),
            reverse: Some(note.reverse),
            fade_position: Some(note.fade_position.clone()),
            fade_top_px: Some(note.fade_top_px),
            fade_bottom_px: Some(note.fade_bottom_px),
            reverse_fade_top_px: Some(note.reverse_fade_top_px),
            reverse_fade_bottom_px: Some(note.reverse_fade_bottom_px),
            delayed_note_enabled: Some(note.delayed_note_enabled),
            short_note_threshold_ms: Some(note.short_note_threshold_ms),
            short_note_min_length_px: Some(note.short_note_min_length_px),
            key_display_delay_ms: Some(note.key_display_delay_ms),
        }),
        background_color: Some(settings.background_color.clone()),
        use_custom_css: Some(settings.use_custom_css),
        custom_css: Some(CustomCssPatch {
            path: Some(settings.custom_css.path.clone()),
            content: Some(settings.custom_css.content.clone()),
        }),
        font_settings: Some(settings.font_settings.clone()),
        use_custom_js: Some(settings.use_custom_js),
        custom_js: Some(CustomJsPatch {
            path: Some(settings.custom_js.path.clone()),
            content: Some(settings.custom_js.content.clone()),
            plugins: Some(settings.custom_js.plugins.clone()),
        }),
        ..SettingsPatchInput::default()
    }
}

fn changed_map_ids<T: PartialEq>(
    current: &std::collections::HashMap<String, T>,
    target: &std::collections::HashMap<String, T>,
) -> Vec<String> {
    let mut ids = current
        .keys()
        .chain(target.keys())
        .filter(|id| current.get(*id) != target.get(*id))
        .cloned()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    ids.sort();
    ids
}

#[cfg(test)]
mod gradient_real_data_simulation;

#[cfg(test)]
mod tests;
