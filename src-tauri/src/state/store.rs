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

use crate::errors::{EditorCommitError, EditorCommitErrorCode};
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

use super::atomic_file::atomic_replace;
use super::builtin_sounds::seed_builtin_sounds;
use super::editor::{
    canonical_request_fingerprint, next_revision, repair_selected_mode, request_fingerprint,
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
    find_legacy_store_file, load_store_from_path, migrate_key_images_to_app_data,
    migrate_local_fonts_to_app_data, normalize_state, rehome_foreign_asset_references,
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
mod persistence;
mod sound_assets;

use asset_references::{
    collect_local_font_paths, collect_local_image_paths, collect_local_sound_paths,
    warn_unresolved_asset_references,
};
#[cfg(test)]
use asset_references::{
    collect_local_image_path_keys, collect_local_sound_path_keys, iter_all_positions,
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

    pub(crate) fn apply_history_operation(
        &self,
        direction: HistoryDirection,
        operation_id: &str,
        current_key_counters: &KeyCounters,
        cancel_previews: impl FnOnce(),
    ) -> Result<HistoryOperationResult, String> {
        if operation_id.len() > 64 || uuid::Uuid::parse_str(operation_id).is_err() {
            return Err(INVALID_HISTORY_OPERATION_ID.to_string());
        }

        let mut guard = self.lock_for_update().map_err(|error| error.to_string())?;
        if guard.history.operation_replayed(operation_id, direction)? {
            return Ok(HistoryOperationResult {
                status: guard.history.status(false),
                change: None,
                aux_change: None,
                replayed: true,
                runtime_publication_generation: guard.revision,
            });
        }
        guard.history.begin_barrier();
        cancel_previews();
        let result = (|| {
            let target = guard
                .history
                .target(direction)
                .cloned()
                .ok_or_else(|| direction.empty_error().to_string())?;
            if target.scope != target.before.scope() {
                return Err(HISTORY_SCOPE_MISMATCH.to_string());
            }
            let target_gesture_id = target.gesture_id.clone();
            let target_gesture_ids = target.gesture_ids.clone();

            let current_store = guard.data.clone();
            let origin = match direction {
                HistoryDirection::Undo => EditorCommitOrigin::HistoryUndo,
                HistoryDirection::Redo => EditorCommitOrigin::HistoryRedo,
            };
            let (opposite, change, aux_change) = match target.before {
                HistorySnapshot::Editor {
                    changed_fields,
                    before,
                    key_counters,
                } => {
                    let restores_keys = changed_fields.contains(&EditorField::Keys);
                    let current = EditorDocumentV1::from_store(&current_store);
                    let opposite =
                        require_history_entry(guard.history.prepare_opposite_editor_entry(
                            changed_fields.clone(),
                            current.patch_for_fields(&changed_fields),
                            restores_keys.then(|| current_key_counters.clone()),
                            target_gesture_id,
                        )?)?;
                    let projected_counters = if restores_keys {
                        let target_keys = before.keys.as_ref().ok_or_else(|| {
                            "history key snapshot is missing target mappings".to_string()
                        })?;
                        Some(project_editor_history_key_counters(
                            current_key_counters,
                            key_counters.as_ref(),
                            target_keys,
                        ))
                    } else {
                        None
                    };
                    let change = self
                        .commit_editor_patch_locked(
                            &mut guard,
                            &before,
                            &changed_fields,
                            projected_counters.as_ref(),
                            EditorPatchCommitOptions {
                                mutation_id: operation_id.to_string(),
                                gesture_id: None,
                                gesture_ids: Vec::new(),
                                origin,
                                record_history: false,
                                apply_key_side_effects: restores_keys,
                                enforce_touched_fields: true,
                            },
                        )
                        .map_err(editor_history_error)?;
                    if change.result.changed_fields.is_empty() {
                        return Err(HISTORY_TARGET_ALREADY_APPLIED.to_string());
                    }
                    (opposite, Some(change), None)
                }
                HistorySnapshot::CustomTabs(before) => {
                    let mut current_snapshot =
                        CustomTabsHistorySnapshot::from_store_for_target(&current_store, &before);
                    current_snapshot.key_counters = current_key_counters.clone();
                    let mut changed_tab_css_ids =
                        before.tab_css_patch.keys().cloned().collect::<Vec<_>>();
                    changed_tab_css_ids.sort();
                    let opposite = require_history_entry(
                        guard.history.prepare_custom_tabs_entry(current_snapshot)?,
                    )?;
                    let (change, plugin_ids, revision) = self
                        .commit_custom_tabs_history_locked(
                            &mut guard,
                            &before,
                            operation_id,
                            origin,
                            current_key_counters,
                        )
                        .map_err(editor_history_error)?;
                    (
                        opposite,
                        change,
                        Some(HistoryAuxChange::CustomTabs {
                            snapshot: before,
                            changed_tab_css_ids,
                            plugin_ids,
                            revision,
                        }),
                    )
                }
                HistorySnapshot::PresetFull(before) => {
                    if before.matches_store(&current_store) {
                        return Err(HISTORY_TARGET_ALREADY_APPLIED.to_string());
                    }
                    let mut current_snapshot =
                        PresetFullHistorySnapshot::from_store(&current_store);
                    current_snapshot.key_counters = current_key_counters.clone();
                    let changed_tab_css_ids = changed_map_ids(
                        &current_store.tab_css_overrides,
                        &before.tab_css_overrides,
                    );
                    let opposite = require_history_entry(
                        guard.history.prepare_preset_full_entry(current_snapshot)?,
                    )?;
                    let (change, settings_diff) = self
                        .commit_preset_full_history_locked(
                            &mut guard,
                            &before,
                            operation_id,
                            origin,
                            current_key_counters,
                        )
                        .map_err(editor_history_error)?;
                    (
                        opposite,
                        change,
                        Some(HistoryAuxChange::PresetFull {
                            snapshot: before,
                            settings_diff: Box::new(settings_diff),
                            changed_tab_css_ids,
                        }),
                    )
                }
                HistorySnapshot::Mode(before) => {
                    let opposite = require_history_entry(
                        guard
                            .history
                            .prepare_mode_entry(current_store.selected_key_type.clone())?,
                    )?;
                    if current_store.selected_key_type == before {
                        return Err(HISTORY_TARGET_ALREADY_APPLIED.to_string());
                    }
                    let mut scratch = current_store;
                    scratch.selected_key_type = before.clone();
                    self.commit_locked(&mut guard, scratch, ())
                        .map_err(|error| error.to_string())?;
                    (opposite, None, Some(HistoryAuxChange::Mode(before)))
                }
                HistorySnapshot::Counters(before) => {
                    let opposite = require_history_entry(
                        guard
                            .history
                            .prepare_counters_entry(current_key_counters.clone())?,
                    )?;
                    if current_store.key_counters == before {
                        return Err(HISTORY_TARGET_ALREADY_APPLIED.to_string());
                    }
                    let mut scratch = current_store;
                    scratch.key_counters = before.clone();
                    self.commit_locked(&mut guard, scratch, ())
                        .map_err(|error| error.to_string())?;
                    (opposite, None, Some(HistoryAuxChange::Counters(before)))
                }
                HistorySnapshot::PluginElements(before) => {
                    let current_snapshot =
                        plugin_elements_snapshot(&current_store, &before.plugin_id)?;
                    if current_snapshot == before {
                        return Err(HISTORY_TARGET_ALREADY_APPLIED.to_string());
                    }
                    let opposite = require_history_entry(
                        guard
                            .history
                            .prepare_opposite_plugin_elements_entry(current_snapshot)?,
                    )?;
                    let mut scratch = current_store;
                    apply_plugin_elements_snapshot(&mut scratch, &before)?;
                    let plugin_model_revision =
                        next_plugin_model_revision(guard.plugin_model_revision)?;
                    self.commit_locked(&mut guard, scratch, ())
                        .map_err(|error| error.to_string())?;
                    guard.plugin_model_revision = plugin_model_revision;
                    (
                        opposite,
                        None,
                        Some(HistoryAuxChange::PluginElements {
                            plugin_id: before.plugin_id,
                            revision: plugin_model_revision,
                        }),
                    )
                }
                HistorySnapshot::Compound { snapshots } => {
                    let current = EditorDocumentV1::from_store(&current_store);
                    let mut opposite_snapshots = Vec::with_capacity(snapshots.len());
                    for snapshot in &snapshots {
                        match snapshot {
                            HistorySnapshot::Editor { changed_fields, .. } => {
                                opposite_snapshots.push(HistorySnapshot::Editor {
                                    changed_fields: changed_fields.clone(),
                                    before: Box::new(current.patch_for_fields(changed_fields)),
                                    key_counters: changed_fields
                                        .contains(&EditorField::Keys)
                                        .then(|| current_key_counters.clone()),
                                });
                            }
                            HistorySnapshot::PluginElements(before) => {
                                opposite_snapshots.push(HistorySnapshot::PluginElements(
                                    plugin_elements_snapshot(&current_store, &before.plugin_id)?,
                                ));
                            }
                            _ => {
                                return Err(
                                    "compound history contains an unsupported snapshot".to_string()
                                )
                            }
                        }
                    }
                    let opposite =
                        require_history_entry(guard.history.prepare_opposite_compound_entry(
                            opposite_snapshots,
                            target_gesture_ids,
                        )?)?;
                    let (change, plugin_ids, plugin_model_revision) = self
                        .commit_compound_history_locked(
                            &mut guard,
                            &snapshots,
                            operation_id,
                            origin,
                            current_key_counters,
                        )
                        .map_err(editor_history_error)?;
                    (
                        opposite,
                        change,
                        Some(HistoryAuxChange::PluginElementsBatch {
                            plugin_ids,
                            revision: plugin_model_revision,
                        }),
                    )
                }
            };

            guard
                .history
                .commit_operation(direction, operation_id.to_string(), opposite);
            Ok(HistoryOperationResult {
                status: guard.history.status(false),
                change,
                aux_change,
                replayed: false,
                runtime_publication_generation: guard.revision,
            })
        })();
        guard.history.finish_barrier();
        result.map(|mut outcome| {
            outcome.status = guard.history.status(false);
            outcome
        })
    }

    #[cfg(test)]
    pub fn commit_editor_document(
        &self,
        request: EditorCommitRequest,
    ) -> std::result::Result<CommittedEditorChange, EditorCommitError> {
        let admission = self.admit_editor_mutation()?;
        if request.may_change_keys() {
            let counters = self.snapshot().key_counters;
            self.commit_editor_document_with_runtime_counters_admitted(
                request, &admission, &counters,
            )
        } else {
            self.commit_editor_document_admitted(request, &admission)
        }
    }

    pub(crate) fn admit_editor_mutation(
        &self,
    ) -> std::result::Result<HistoryAdmissionLease, EditorCommitError> {
        self.history_gate
            .admit_mutation()
            .map_err(|error| match error.as_str() {
                HISTORY_IN_PROGRESS => EditorCommitError::history_in_progress(),
                _ => EditorCommitError::io(error),
            })
    }

    pub(crate) fn commit_editor_document_admitted(
        &self,
        request: EditorCommitRequest,
        admission: &HistoryAdmissionLease,
    ) -> std::result::Result<CommittedEditorChange, EditorCommitError> {
        if request.may_change_keys() {
            return Err(key_counter_baseline_required());
        }
        self.commit_editor_document_admitted_with_runtime_counters(request, admission, None)
    }

    pub(crate) fn commit_editor_document_with_runtime_counters_admitted(
        &self,
        request: EditorCommitRequest,
        admission: &HistoryAdmissionLease,
        runtime_counters: &KeyCounters,
    ) -> std::result::Result<CommittedEditorChange, EditorCommitError> {
        self.commit_editor_document_admitted_with_runtime_counters(
            request,
            admission,
            Some(runtime_counters),
        )
    }

    fn commit_editor_document_admitted_with_runtime_counters(
        &self,
        request: EditorCommitRequest,
        admission: &HistoryAdmissionLease,
        runtime_counters: Option<&KeyCounters>,
    ) -> std::result::Result<CommittedEditorChange, EditorCommitError> {
        let started = Instant::now();
        let base_revision = request.base_revision;
        let mutation_id = uuid::Uuid::parse_str(&request.mutation_id)
            .map(|id| id.hyphenated().to_string())
            .unwrap_or_else(|_| "<invalid>".to_string());
        let mutation_kind = if request.ops.is_some() {
            "ops"
        } else {
            "patch"
        };
        let ops_version = request
            .ops_version
            .map_or_else(|| "none".to_string(), |version| version.to_string());
        let op_count = request.ops.as_ref().map_or(0, Vec::len);
        let payload_size = request_payload_size(&request);
        let payload_bytes = payload_size.as_ref().copied().unwrap_or(0);
        let result = match payload_size {
            Ok(_) => self.commit_editor_document_inner(request, admission, runtime_counters),
            Err(error) => Err(error),
        };
        let current_revision = result
            .as_ref()
            .err()
            .and_then(|error| error.details.as_ref())
            .and_then(|details| details.current_revision)
            .unwrap_or_else(|| self.state.read().data.editor_revision);
        let (outcome, changed_fields) = match &result {
            Ok(change) if change.event.is_some() => {
                ("committed", change.result.changed_fields.as_slice())
            }
            Ok(change) if change.result.changed_fields.is_empty() => {
                ("no_op", change.result.changed_fields.as_slice())
            }
            Ok(change) => ("replay", change.result.changed_fields.as_slice()),
            Err(error) => (editor_error_outcome(error.error_code), &[][..]),
        };
        let (applied_count, no_change_count, target_missing_count) = result
            .as_ref()
            .ok()
            .and_then(|change| change.result.op_results.as_ref())
            .map(|results| {
                results
                    .iter()
                    .fold((0, 0, 0), |counts, result| match result.status {
                        EditorOpResultStatusV1::Applied => (counts.0 + 1, counts.1, counts.2),
                        EditorOpResultStatusV1::NoChange => (counts.0, counts.1 + 1, counts.2),
                        EditorOpResultStatusV1::TargetMissing => (counts.0, counts.1, counts.2 + 1),
                    })
            })
            .unwrap_or_default();
        let ack_replay = result.as_ref().is_ok_and(|change| change.replayed);
        let validation_code = result
            .as_ref()
            .err()
            .and_then(|error| error.details.as_ref())
            .and_then(|details| details.validation_code.as_deref())
            .unwrap_or("none");
        // 문서·patch 원문 없이 경계 메타데이터만 기록
        log::info!(
            target: "editor_commit",
            "command=editor_commit mutationId={mutation_id} mutationKind={mutation_kind} opsVersion={ops_version} opCount={op_count} baseRevision={base_revision} currentRevision={current_revision} outcome={outcome} validationCode={validation_code} ackReplay={ack_replay} opApplied={applied_count} opNoChange={no_change_count} opTargetMissing={target_missing_count} changedFields={changed_fields:?} durationMs={} payloadBytes={payload_bytes}",
            started.elapsed().as_millis()
        );
        result
    }

    fn commit_editor_document_inner(
        &self,
        mut request: EditorCommitRequest,
        admission: &HistoryAdmissionLease,
        runtime_counters: Option<&KeyCounters>,
    ) -> std::result::Result<CommittedEditorChange, EditorCommitError> {
        if let Some(changes) = request.changes.as_mut() {
            if let Some(keys) = changes.keys.as_mut() {
                normalize_key_mappings(keys);
            }
        }
        validate_request_envelope(&request)?;
        let fingerprint = request_fingerprint(&request)?;
        let mut guard = self
            .lock_for_update()
            .map_err(|error| EditorCommitError::io(error.to_string()))?;
        admission
            .revalidate_for(&self.history_gate)
            .map_err(|_| EditorCommitError::history_in_progress())?;

        if let Some(ack) = guard
            .mutation_acks
            .iter()
            .find(|ack| ack.id == request.mutation_id)
        {
            if ack.fingerprint != fingerprint {
                return Err(EditorCommitError::mutation_id_reused());
            }
            return Ok(CommittedEditorChange {
                result: ack.result.clone(),
                event: None,
                replayed: true,
                document: EditorDocumentV1::from_store(&guard.data),
                selected_key_type: guard.data.selected_key_type.clone(),
                key_counters: guard.data.key_counters.clone(),
                history_status: None,
                plugin_instances_changes: Vec::new(),
                runtime_publication_generation: guard.revision,
            });
        }

        if request.base_revision != guard.data.editor_revision {
            return Err(EditorCommitError::revision_conflict(
                guard.data.editor_revision,
            ));
        }

        if request
            .changes
            .as_ref()
            .is_some_and(|changes| changes.keys.is_some())
            && key_mappings_contain_multi(&guard.data.keys)
            && !request.multi_key
        {
            return Err(EditorCommitError::multi_key_unsupported());
        }

        let gesture_id = request.history_gesture_id();
        let gesture_ids = request.echoed_gesture_ids();
        let options = EditorPatchCommitOptions {
            mutation_id: request.mutation_id.clone(),
            gesture_id,
            gesture_ids,
            origin: EditorCommitOrigin::StrictEditorCommit,
            record_history: true,
            apply_key_side_effects: true,
            enforce_touched_fields: false,
        };
        let change = if let Some(changes) = request.changes.as_mut() {
            super::native_element_id::prepare_commit_patch_element_ids(&guard.data, changes)?;
            let touched_fields = changes.included_fields();
            self.commit_editor_patch_locked(
                &mut guard,
                changes,
                &touched_fields,
                runtime_counters,
                options,
            )?
        } else if let Some(ops) = request.ops.as_ref() {
            self.commit_editor_ops_locked(&mut guard, ops, runtime_counters, options)?
        } else {
            return Err(EditorCommitError::validation(
                "EDITOR_MUTATION_REQUIRED",
                "editor commit must contain exactly one mutation payload",
            ));
        };
        insert_mutation_ack(
            &mut guard.mutation_acks,
            request.mutation_id,
            fingerprint,
            change.result.clone(),
        );
        Ok(change)
    }

    fn commit_editor_patch_locked(
        &self,
        guard: &mut VersionedStoreState,
        changes: &crate::models::EditorPatchV1,
        touched_fields: &[EditorField],
        runtime_counters: Option<&KeyCounters>,
        options: EditorPatchCommitOptions,
    ) -> std::result::Result<CommittedEditorChange, EditorCommitError> {
        let mut current_store = guard.data.clone();
        if let Some(counters) = runtime_counters {
            current_store.key_counters = counters.clone();
        }
        let (current, candidate, scratch, changed_fields) =
            prepare_editor_patch_transition(&current_store, changes, touched_fields)?;
        if options.enforce_touched_fields
            && changed_fields
                .iter()
                .any(|field| !touched_fields.contains(field))
        {
            return Err(EditorCommitError::validation(
                "HISTORY_RESTORE_CHANGED_UNDECLARED_FIELD",
                "history restore changed an editor field outside its entry",
            ));
        }
        self.commit_editor_transition_locked(
            guard,
            current_store,
            current,
            candidate,
            scratch,
            changed_fields,
            None,
            options,
        )
    }

    fn commit_editor_ops_locked(
        &self,
        guard: &mut VersionedStoreState,
        ops: &[crate::models::EditorOpV1],
        runtime_counters: Option<&KeyCounters>,
        options: EditorPatchCommitOptions,
    ) -> std::result::Result<CommittedEditorChange, EditorCommitError> {
        let mut current_store = guard.data.clone();
        if let Some(counters) = runtime_counters {
            current_store.key_counters = counters.clone();
        }
        let transition = prepare_editor_ops_transition(&current_store, ops)?;
        self.commit_editor_transition_locked(
            guard,
            current_store,
            transition.current,
            transition.candidate,
            transition.scratch,
            transition.changed_fields,
            Some(transition.op_results),
            options,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn commit_editor_transition_locked(
        &self,
        guard: &mut VersionedStoreState,
        current_store: AppStoreData,
        current: EditorDocumentV1,
        candidate: EditorDocumentV1,
        mut scratch: AppStoreData,
        changed_fields: Vec<EditorField>,
        op_results: Option<Vec<EditorOpResultV1>>,
        options: EditorPatchCommitOptions,
    ) -> std::result::Result<CommittedEditorChange, EditorCommitError> {
        if changed_fields.is_empty() {
            return Ok(CommittedEditorChange {
                result: EditorCommitResult {
                    revision: current_store.editor_revision,
                    changed_fields,
                    op_results,
                },
                event: None,
                replayed: false,
                document: current,
                selected_key_type: current_store.selected_key_type,
                key_counters: current_store.key_counters,
                history_status: None,
                plugin_instances_changes: Vec::new(),
                runtime_publication_generation: guard.revision,
            });
        }

        let history_plan = options
            .record_history
            .then(|| {
                guard.history.prepare_entry_with_gesture_ids(
                    changed_fields.clone(),
                    current.patch_for_fields(&changed_fields),
                    changed_fields
                        .contains(&EditorField::Keys)
                        .then(|| current_store.key_counters.clone()),
                    options.gesture_ids.clone(),
                )
            })
            .transpose()
            .map_err(|error| {
                EditorCommitError::validation("HISTORY_SERIALIZATION_FAILED", error)
            })?;

        let revision = next_revision(current_store.editor_revision)?;
        if options.apply_key_side_effects && changed_fields.contains(&EditorField::Keys) {
            sync_key_counters(&mut scratch.key_counters, &candidate.keys);
            repair_selected_mode(&mut scratch);
        }
        scratch.editor_revision = revision;
        let selected_key_type = scratch.selected_key_type.clone();
        let key_counters = scratch.key_counters.clone();

        self.commit_locked(guard, scratch, ())
            .map_err(|error| EditorCommitError::io(error.to_string()))?;

        let history_status = history_plan.map(|plan| {
            guard.history.apply_editor_record_plan(plan, &candidate);
            guard.history.issue_status(self.history_gate.is_closed())
        });
        let event = options.origin.event_name().map(|origin| EditorCommittedV1 {
            schema_version: EDITOR_SCHEMA_VERSION,
            revision,
            mutation_id: options.mutation_id,
            gesture_id: options.gesture_id,
            gesture_ids: options.gesture_ids,
            origin,
            changed_fields: changed_fields.clone(),
            patch: candidate.patch_for_fields(&changed_fields),
        });

        Ok(CommittedEditorChange {
            result: EditorCommitResult {
                revision,
                changed_fields,
                op_results,
            },
            event,
            replayed: false,
            document: candidate,
            selected_key_type,
            key_counters,
            history_status,
            plugin_instances_changes: Vec::new(),
            runtime_publication_generation: guard.revision,
        })
    }

    #[cfg(test)]
    pub(crate) fn commit_gesture(
        &self,
        request: GestureCommitRequest,
    ) -> std::result::Result<AdmittedGestureCommit, EditorCommitError> {
        let admission = self.admit_editor_mutation()?;
        if request.may_change_keys() {
            let counters = self.snapshot().key_counters;
            self.commit_gesture_with_runtime_counters_admission(request, admission, &counters)
        } else {
            self.commit_gesture_with_admission(request, admission)
        }
    }

    pub(crate) fn commit_gesture_with_admission(
        &self,
        request: GestureCommitRequest,
        admission: HistoryAdmissionLease,
    ) -> std::result::Result<AdmittedGestureCommit, EditorCommitError> {
        if request.may_change_keys() {
            return Err(key_counter_baseline_required());
        }
        self.commit_gesture_with_runtime_counters_and_admission(request, admission, None)
    }

    pub(crate) fn commit_gesture_with_runtime_counters_admission(
        &self,
        request: GestureCommitRequest,
        admission: HistoryAdmissionLease,
        runtime_counters: &KeyCounters,
    ) -> std::result::Result<AdmittedGestureCommit, EditorCommitError> {
        self.commit_gesture_with_runtime_counters_and_admission(
            request,
            admission,
            Some(runtime_counters),
        )
    }

    fn commit_gesture_with_runtime_counters_and_admission(
        &self,
        request: GestureCommitRequest,
        admission: HistoryAdmissionLease,
        runtime_counters: Option<&KeyCounters>,
    ) -> std::result::Result<AdmittedGestureCommit, EditorCommitError> {
        validate_gesture_commit_request(&request)?;
        let outcome = self.commit_gesture_admitted(request, &admission, runtime_counters)?;
        Ok(AdmittedGestureCommit {
            outcome,
            _admission: admission,
        })
    }

    fn commit_gesture_admitted(
        &self,
        mut request: GestureCommitRequest,
        admission: &HistoryAdmissionLease,
        runtime_counters: Option<&KeyCounters>,
    ) -> std::result::Result<GestureCommitOutcome, EditorCommitError> {
        let fingerprint = canonical_request_fingerprint(&request)?;
        let mut guard = self
            .lock_for_update()
            .map_err(|error| EditorCommitError::io(error.to_string()))?;
        admission
            .revalidate_for(&self.history_gate)
            .map_err(|_| EditorCommitError::history_in_progress())?;

        if let Some(ack) = guard
            .gesture_mutation_acks
            .iter()
            .find(|ack| ack.id == request.mutation_id)
        {
            if ack.fingerprint != fingerprint {
                return Err(EditorCommitError::mutation_id_reused());
            }
            return Ok(GestureCommitOutcome {
                result: ack.result.clone(),
                change: None,
                changed_plugin_ids: Vec::new(),
                history_status: None,
                replayed: true,
            });
        }

        validate_observed_history_epoch(&guard.history, request.observed_history_epoch)?;
        if request.editor_base_revision != guard.data.editor_revision {
            return Err(EditorCommitError::revision_conflict(
                guard.data.editor_revision,
            ));
        }
        if request.plugin_base_revision != guard.plugin_model_revision {
            return Err(EditorCommitError::plugin_revision_conflict(
                guard.plugin_model_revision,
            ));
        }

        if let Some(changes) = request.editor_changes.as_mut() {
            super::native_element_id::prepare_commit_patch_element_ids(&guard.data, changes)?;
        }

        let mut current_store = guard.data.clone();
        if let Some(counters) = runtime_counters {
            current_store.key_counters = counters.clone();
        }
        let (current_editor, candidate_editor, mut scratch, changed_fields, editor_op_results) =
            if let Some(changes) = request.editor_changes.as_ref() {
                let touched_fields = changes.included_fields();
                let (current, candidate, scratch, changed_fields) =
                    prepare_editor_patch_transition(&current_store, changes, &touched_fields)?;
                (current, candidate, scratch, changed_fields, None)
            } else if let Some(ops) = request.editor_ops.as_ref() {
                // editor op 적용이 pluginChanges보다 먼저다 - 그룹 생존 판정은
                // 요청 동봉 plugin_changes(커밋 후 상태)를 우선, 미동봉 플러그인만 store
                let request_plugin_ids = request
                    .plugin_changes
                    .iter()
                    .map(|change| change.plugin_id.as_str())
                    .collect::<HashSet<_>>();
                let mut plugin_group_refs =
                    plugin_group_refs_from_store(&current_store, &request_plugin_ids);
                for change in &request.plugin_changes {
                    add_plugin_group_refs(&mut plugin_group_refs, &change.instances);
                }
                let transition = prepare_editor_ops_transition_with_plugin_refs(
                    &current_store,
                    ops,
                    &plugin_group_refs,
                )?;
                (
                    transition.current,
                    transition.candidate,
                    transition.scratch,
                    transition.changed_fields,
                    Some(transition.op_results),
                )
            } else {
                let current = EditorDocumentV1::from_store(&current_store);
                (
                    current.clone(),
                    current,
                    current_store.clone(),
                    Vec::new(),
                    None,
                )
            };

        let mut history_snapshots = Vec::with_capacity(request.plugin_changes.len() + 1);
        if !changed_fields.is_empty() {
            history_snapshots.push(HistorySnapshot::Editor {
                changed_fields: changed_fields.clone(),
                before: Box::new(current_editor.patch_for_fields(&changed_fields)),
                key_counters: changed_fields
                    .contains(&EditorField::Keys)
                    .then(|| current_store.key_counters.clone()),
            });
        }

        let mut changed_plugin_ids = Vec::new();
        for plugin_change in &request.plugin_changes {
            let current_snapshot =
                plugin_elements_snapshot(&current_store, &plugin_change.plugin_id).map_err(
                    |error| EditorCommitError::validation("INVALID_GESTURE_PLUGIN", error),
                )?;
            validate_plugin_instances_transition(
                current_snapshot.instances.as_deref().unwrap_or_default(),
                &plugin_change.instances,
            )
            .map_err(|error| {
                EditorCommitError::validation(
                    error.clone(),
                    format!(
                        "invalid plugin gesture transition '{}': {error}",
                        plugin_change.plugin_id
                    ),
                )
            })?;
            let canonical = PluginElementsHistorySnapshot {
                plugin_id: plugin_change.plugin_id.clone(),
                instances: (!plugin_change.instances.is_empty())
                    .then_some(plugin_change.instances.clone()),
            };
            if current_snapshot == canonical {
                continue;
            }
            apply_plugin_elements_snapshot(&mut scratch, &canonical)
                .map_err(|error| EditorCommitError::validation("INVALID_GESTURE_PLUGIN", error))?;
            history_snapshots.push(HistorySnapshot::PluginElements(current_snapshot));
            changed_plugin_ids.push(plugin_change.plugin_id.clone());
        }

        let editor_revision = if changed_fields.is_empty() {
            current_store.editor_revision
        } else {
            let revision = next_revision(current_store.editor_revision)?;
            if changed_fields.contains(&EditorField::Keys) {
                sync_key_counters(&mut scratch.key_counters, &candidate_editor.keys);
                repair_selected_mode(&mut scratch);
            }
            scratch.editor_revision = revision;
            revision
        };
        let plugin_model_revision = if changed_plugin_ids.is_empty() {
            guard.plugin_model_revision
        } else {
            next_plugin_model_revision(guard.plugin_model_revision).map_err(|error| {
                EditorCommitError::validation("PLUGIN_MODEL_REVISION_OUT_OF_RANGE", error)
            })?
        };
        let result = GestureCommitResult {
            editor_revision,
            changed_fields: changed_fields.clone(),
            editor_op_results: editor_op_results.clone(),
            plugin_model_revision,
            changed_plugin_ids: changed_plugin_ids.clone(),
            authority_generation: request.authority_generation,
        };

        if history_snapshots.is_empty() {
            insert_gesture_mutation_ack(
                &mut guard.gesture_mutation_acks,
                request.mutation_id,
                fingerprint,
                result.clone(),
            );
            return Ok(GestureCommitOutcome {
                result,
                change: None,
                changed_plugin_ids: Vec::new(),
                history_status: None,
                replayed: false,
            });
        }

        let history_plan = guard
            .history
            .prepare_gesture_entry(history_snapshots, request.gesture_id.clone())
            .map_err(|error| {
                EditorCommitError::validation("HISTORY_SERIALIZATION_FAILED", error)
            })?;
        if matches!(history_plan, HistoryRecordPlan::Truncate) {
            return Err(EditorCommitError::validation(
                HISTORY_ENTRY_TOO_LARGE,
                "gesture history entry exceeds the size limit",
            ));
        }

        let selected_key_type = scratch.selected_key_type.clone();
        let key_counters = scratch.key_counters.clone();
        self.commit_locked(&mut guard, scratch, ())
            .map_err(|error| EditorCommitError::io(error.to_string()))?;
        guard.plugin_model_revision = plugin_model_revision;
        guard.history.apply_record_plan(history_plan);
        let history_status = Some(guard.history.issue_status(self.history_gate.is_closed()));

        let change = (!changed_fields.is_empty()).then(|| CommittedEditorChange {
            result: EditorCommitResult {
                revision: editor_revision,
                changed_fields: changed_fields.clone(),
                op_results: editor_op_results,
            },
            event: Some(EditorCommittedV1 {
                schema_version: EDITOR_SCHEMA_VERSION,
                revision: editor_revision,
                mutation_id: request.mutation_id.clone(),
                gesture_id: Some(request.gesture_id.clone()),
                gesture_ids: vec![request.gesture_id],
                origin: EditorCommitOrigin::GestureCommit
                    .event_name()
                    .expect("gesture commits publish editor events"),
                changed_fields: changed_fields.clone(),
                patch: candidate_editor.patch_for_fields(&changed_fields),
            }),
            replayed: false,
            document: candidate_editor,
            selected_key_type,
            key_counters,
            history_status: None,
            plugin_instances_changes: Vec::new(),
            runtime_publication_generation: guard.revision,
        });

        insert_gesture_mutation_ack(
            &mut guard.gesture_mutation_acks,
            request.mutation_id,
            fingerprint,
            result.clone(),
        );
        Ok(GestureCommitOutcome {
            result,
            change,
            changed_plugin_ids,
            history_status,
            replayed: false,
        })
    }

    fn commit_compound_history_locked(
        &self,
        guard: &mut VersionedStoreState,
        snapshots: &[HistorySnapshot],
        operation_id: &str,
        origin: EditorCommitOrigin,
        current_key_counters: &KeyCounters,
    ) -> std::result::Result<(Option<CommittedEditorChange>, Vec<String>, u64), EditorCommitError>
    {
        let mut current_store = guard.data.clone();
        let mut editor_target = None;
        let mut plugin_targets = Vec::new();
        let mut seen_plugin_ids = HashSet::new();
        let mut restores_keys = false;

        for snapshot in snapshots {
            match snapshot {
                HistorySnapshot::Editor {
                    changed_fields,
                    before,
                    key_counters,
                } => {
                    if editor_target.is_some() {
                        return Err(EditorCommitError::validation(
                            "HISTORY_COMPOUND_INVALID",
                            "compound history contains duplicate editor snapshots",
                        ));
                    }
                    restores_keys = changed_fields.contains(&EditorField::Keys);
                    editor_target = Some((changed_fields, before, key_counters));
                }
                HistorySnapshot::PluginElements(target) => {
                    if !seen_plugin_ids.insert(target.plugin_id.as_str()) {
                        return Err(EditorCommitError::validation(
                            "HISTORY_COMPOUND_INVALID",
                            "compound history contains duplicate plugin snapshots",
                        ));
                    }
                    plugin_targets.push(target);
                }
                _ => {
                    return Err(EditorCommitError::validation(
                        "HISTORY_COMPOUND_INVALID",
                        "compound history contains an unsupported snapshot",
                    ))
                }
            }
        }

        if restores_keys {
            current_store.key_counters = current_key_counters.clone();
        }

        let (mut scratch, editor_restore) =
            if let Some((changed_fields, before, key_counters)) = editor_target {
                let (_, candidate, next_store, actual_fields) =
                    prepare_editor_patch_transition(&current_store, before, changed_fields)?;
                if actual_fields
                    .iter()
                    .any(|field| !changed_fields.contains(field))
                {
                    return Err(EditorCommitError::validation(
                        "HISTORY_RESTORE_CHANGED_UNDECLARED_FIELD",
                        "history restore changed an editor field outside its entry",
                    ));
                }
                (
                    next_store,
                    Some((candidate, actual_fields, key_counters.as_ref())),
                )
            } else {
                (current_store.clone(), None)
            };
        let mut plugin_ids = Vec::new();
        for target in plugin_targets {
            let current =
                plugin_elements_snapshot(&current_store, &target.plugin_id).map_err(|error| {
                    EditorCommitError::validation("HISTORY_COMPOUND_INVALID", error)
                })?;
            if current == *target {
                continue;
            }
            apply_plugin_elements_snapshot(&mut scratch, target).map_err(|error| {
                EditorCommitError::validation("HISTORY_COMPOUND_INVALID", error)
            })?;
            plugin_ids.push(target.plugin_id.clone());
        }

        let editor_changed = editor_restore
            .as_ref()
            .is_some_and(|(_, changed_fields, _)| !changed_fields.is_empty());
        if !editor_changed && plugin_ids.is_empty() {
            return Err(EditorCommitError::validation(
                "HISTORY_TARGET_ALREADY_APPLIED",
                "history target is already applied",
            ));
        }

        if let Some((candidate, changed_fields, historical_counters)) = editor_restore.as_ref() {
            if changed_fields.contains(&EditorField::Keys) {
                scratch.key_counters = project_editor_history_key_counters(
                    current_key_counters,
                    *historical_counters,
                    &candidate.keys,
                );
                repair_selected_mode(&mut scratch);
            }
        }

        let editor_revision = if editor_changed {
            let revision = next_revision(current_store.editor_revision)?;
            scratch.editor_revision = revision;
            revision
        } else {
            current_store.editor_revision
        };
        let plugin_model_revision = if plugin_ids.is_empty() {
            guard.plugin_model_revision
        } else {
            next_plugin_model_revision(guard.plugin_model_revision).map_err(|error| {
                EditorCommitError::validation("PLUGIN_MODEL_REVISION_OUT_OF_RANGE", error)
            })?
        };
        let selected_key_type = scratch.selected_key_type.clone();
        let key_counters = scratch.key_counters.clone();

        self.commit_locked(guard, scratch, ())
            .map_err(|error| EditorCommitError::io(error.to_string()))?;
        guard.plugin_model_revision = plugin_model_revision;

        let change = editor_restore.and_then(|(candidate, changed_fields, _)| {
            if changed_fields.is_empty() {
                return None;
            }
            let event = origin.event_name().map(|origin| EditorCommittedV1 {
                schema_version: EDITOR_SCHEMA_VERSION,
                revision: editor_revision,
                mutation_id: operation_id.to_string(),
                gesture_id: None,
                gesture_ids: Vec::new(),
                origin,
                changed_fields: changed_fields.clone(),
                patch: candidate.patch_for_fields(&changed_fields),
            });
            Some(CommittedEditorChange {
                result: EditorCommitResult {
                    revision: editor_revision,
                    changed_fields,
                    op_results: None,
                },
                event,
                replayed: false,
                document: candidate,
                selected_key_type,
                key_counters,
                history_status: None,
                plugin_instances_changes: Vec::new(),
                runtime_publication_generation: guard.revision,
            })
        });

        Ok((change, plugin_ids, plugin_model_revision))
    }

    fn commit_custom_tabs_history_locked(
        &self,
        guard: &mut VersionedStoreState,
        target: &CustomTabsHistorySnapshot,
        operation_id: &str,
        origin: EditorCommitOrigin,
        current_key_counters: &KeyCounters,
    ) -> std::result::Result<(Option<CommittedEditorChange>, Vec<String>, u64), EditorCommitError>
    {
        let current_store = guard.data.clone();
        if target.matches_store(&current_store) {
            return Err(EditorCommitError::validation(
                "HISTORY_TARGET_ALREADY_APPLIED",
                "history target is already applied",
            ));
        }

        validate_history_restore_metadata(
            &target.document,
            &target.custom_tabs,
            &target.selected_key_type,
        )?;
        let current = EditorDocumentV1::from_store(&current_store);
        let mut scratch = current_store.clone();
        target.document.apply_to_store(&mut scratch);
        scratch.custom_tabs = target.custom_tabs.clone();
        scratch.selected_key_type = target.selected_key_type.clone();
        scratch.key_counters = project_history_key_counters(
            current_key_counters,
            &target.key_counters,
            &target.document.keys,
        );
        target.apply_override_patches(&mut scratch);
        crate::state::migration::canonicalize_gradient_pairs(&mut scratch);
        crate::state::migration::canonicalize_image_modes(&mut scratch);
        let candidate = EditorDocumentV1::from_store(&scratch);
        validate_paired_update(&current, &candidate, true, true)?;
        scratch.editor_revision = current_store.editor_revision;
        validate_document_transition(&current, &candidate, &current_store, &scratch)?;

        let changed_fields = current.changed_fields(&candidate);
        let revision = if changed_fields.is_empty() {
            current_store.editor_revision
        } else {
            let revision = next_revision(current_store.editor_revision)?;
            scratch.editor_revision = revision;
            revision
        };
        let selected_key_type = scratch.selected_key_type.clone();
        let key_counters = scratch.key_counters.clone();
        let plugin_ids = target
            .changed_plugin_ids()
            .into_iter()
            .filter(|plugin_id| {
                let key = plugin_instances_storage_key(plugin_id);
                current_store.plugin_data.get(&key) != scratch.plugin_data.get(&key)
            })
            .collect::<Vec<_>>();
        let plugin_model_revision = if plugin_ids.is_empty() {
            guard.plugin_model_revision
        } else {
            next_plugin_model_revision(guard.plugin_model_revision).map_err(|error| {
                EditorCommitError::validation("PLUGIN_MODEL_REVISION_OUT_OF_RANGE", error)
            })?
        };
        self.commit_locked(guard, scratch, ())
            .map_err(|error| EditorCommitError::io(error.to_string()))?;
        guard.plugin_model_revision = plugin_model_revision;

        if changed_fields.is_empty() {
            return Ok((None, plugin_ids, plugin_model_revision));
        }
        let event = origin.event_name().map(|origin| EditorCommittedV1 {
            schema_version: EDITOR_SCHEMA_VERSION,
            revision,
            mutation_id: operation_id.to_string(),
            gesture_id: None,
            gesture_ids: Vec::new(),
            origin,
            changed_fields: changed_fields.clone(),
            patch: candidate.patch_for_fields(&changed_fields),
        });
        Ok((
            Some(CommittedEditorChange {
                result: EditorCommitResult {
                    revision,
                    changed_fields,
                    op_results: None,
                },
                event,
                replayed: false,
                document: candidate,
                selected_key_type,
                key_counters,
                history_status: None,
                plugin_instances_changes: Vec::new(),
                runtime_publication_generation: guard.revision,
            }),
            plugin_ids,
            plugin_model_revision,
        ))
    }

    fn commit_preset_full_history_locked(
        &self,
        guard: &mut VersionedStoreState,
        target: &PresetFullHistorySnapshot,
        operation_id: &str,
        origin: EditorCommitOrigin,
        current_key_counters: &KeyCounters,
    ) -> std::result::Result<(Option<CommittedEditorChange>, SettingsDiff), EditorCommitError> {
        let current_store = guard.data.clone();
        validate_history_restore_metadata(
            &target.document,
            &target.custom_tabs,
            &target.selected_key_type,
        )?;
        let current = EditorDocumentV1::from_store(&current_store);
        let mut scratch = current_store.clone();
        target.document.apply_to_store(&mut scratch);
        scratch.custom_tabs = target.custom_tabs.clone();
        scratch.selected_key_type = target.selected_key_type.clone();
        scratch.key_counters = project_history_key_counters(
            current_key_counters,
            &target.key_counters,
            &target.document.keys,
        );
        scratch.tab_note_overrides = target.settings.tab_note_overrides.clone();
        scratch.tab_css_overrides = target.tab_css_overrides.clone();
        let settings_diff = crate::services::settings::apply_patch_to_store(
            &mut scratch,
            &preset_history_settings_patch(&target.settings),
        );
        crate::state::migration::canonicalize_gradient_pairs(&mut scratch);
        crate::state::migration::canonicalize_image_modes(&mut scratch);
        let candidate = EditorDocumentV1::from_store(&scratch);
        validate_paired_update(&current, &candidate, true, true)?;
        scratch.editor_revision = current_store.editor_revision;
        // 프리셋 스냅샷은 현재 store와 id 세대가 달라 ID 짝짓기가 성립하지 않는다
        validate_document_transition_with_keying(
            &current,
            &candidate,
            &current_store,
            &scratch,
            GrandfatherKeying::LegacyPresetModeIndex,
        )?;

        let changed_fields = current.changed_fields(&candidate);
        let revision = if changed_fields.is_empty() {
            current_store.editor_revision
        } else {
            let revision = next_revision(current_store.editor_revision)?;
            scratch.editor_revision = revision;
            revision
        };
        let selected_key_type = scratch.selected_key_type.clone();
        let key_counters = scratch.key_counters.clone();
        self.commit_locked(guard, scratch, ())
            .map_err(|error| EditorCommitError::io(error.to_string()))?;

        if changed_fields.is_empty() {
            return Ok((None, settings_diff));
        }
        let event = origin.event_name().map(|origin| EditorCommittedV1 {
            schema_version: EDITOR_SCHEMA_VERSION,
            revision,
            mutation_id: operation_id.to_string(),
            gesture_id: None,
            gesture_ids: Vec::new(),
            origin,
            changed_fields: changed_fields.clone(),
            patch: candidate.patch_for_fields(&changed_fields),
        });
        Ok((
            Some(CommittedEditorChange {
                result: EditorCommitResult {
                    revision,
                    changed_fields,
                    op_results: None,
                },
                event,
                replayed: false,
                document: candidate,
                selected_key_type,
                key_counters,
                history_status: None,
                plugin_instances_changes: Vec::new(),
                runtime_publication_generation: guard.revision,
            }),
            settings_diff,
        ))
    }

    #[cfg(test)]
    pub(crate) fn commit_legacy_editor_transaction<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        let key_counters = touched_fields
            .contains(&EditorField::Keys)
            .then(|| self.snapshot().key_counters);
        self.commit_editor_transaction_with_history(
            origin,
            touched_fields,
            EditorTransactionHistoryOptions {
                key_counters,
                ..EditorTransactionHistoryOptions::default()
            },
            updater,
        )
    }

    pub(crate) fn commit_legacy_editor_transaction_with_admission<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        admission: HistoryAdmissionLease,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        self.commit_editor_transaction_with_history_admission(
            origin,
            touched_fields,
            EditorTransactionHistoryOptions::default(),
            admission,
            updater,
        )
    }

    #[cfg(test)]
    pub(crate) fn commit_legacy_editor_reset_transaction_with_admission<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        plugin_instances_reset: PluginInstancesResetScope,
        admission: HistoryAdmissionLease,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        let counters = self.snapshot().key_counters;
        self.commit_legacy_editor_reset_transaction_with_runtime_counters_and_admission(
            origin,
            touched_fields,
            plugin_instances_reset,
            admission,
            Some(&counters),
            updater,
        )
    }

    pub(super) fn commit_legacy_editor_reset_transaction_with_runtime_counters_admission<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        plugin_instances_reset: PluginInstancesResetScope,
        admission: HistoryAdmissionLease,
        runtime_counters: &KeyCounters,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        self.commit_legacy_editor_reset_transaction_with_runtime_counters_and_admission(
            origin,
            touched_fields,
            plugin_instances_reset,
            admission,
            Some(runtime_counters),
            updater,
        )
    }

    fn commit_legacy_editor_reset_transaction_with_runtime_counters_and_admission<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        plugin_instances_reset: PluginInstancesResetScope,
        admission: HistoryAdmissionLease,
        runtime_counters: Option<&KeyCounters>,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        self.commit_editor_transaction_with_history_admission(
            origin,
            touched_fields,
            EditorTransactionHistoryOptions {
                plugin_instances_reset: Some(plugin_instances_reset),
                key_counters: runtime_counters.cloned(),
                ..EditorTransactionHistoryOptions::default()
            },
            admission,
            updater,
        )
    }

    pub(crate) fn commit_legacy_resource_deletion_with_admission<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        admission: HistoryAdmissionLease,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        self.commit_editor_transaction_with_history_admission(
            origin,
            touched_fields,
            EditorTransactionHistoryOptions {
                invalidate_history_on_store_only_change: true,
                ..EditorTransactionHistoryOptions::default()
            },
            admission,
            updater,
        )
    }

    #[cfg(test)]
    pub(crate) fn commit_legacy_resource_deletion<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        self.commit_editor_transaction_with_history(
            origin,
            touched_fields,
            EditorTransactionHistoryOptions {
                invalidate_history_on_store_only_change: true,
                ..EditorTransactionHistoryOptions::default()
            },
            updater,
        )
    }

    #[cfg(test)]
    pub(crate) fn commit_history_overlap_mutation<T>(
        &self,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedHistoryOverlapMutation<T>, EditorCommitError> {
        let admission = self.admit_editor_mutation()?;
        self.commit_history_overlap_mutation_with_admission(admission, updater)
    }

    pub(crate) fn commit_history_overlap_mutation_with_admission<T>(
        &self,
        admission: HistoryAdmissionLease,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedHistoryOverlapMutation<T>, EditorCommitError> {
        let mut guard = self
            .lock_for_update()
            .map_err(|error| EditorCommitError::io(error.to_string()))?;
        admission
            .revalidate_for(&self.history_gate)
            .map_err(|_| EditorCommitError::history_in_progress())?;

        let current_store = guard.data.clone();
        let current_overlap = PresetFullHistorySnapshot::from_store(&current_store);
        let mut scratch = current_store.clone();
        let value = updater(&mut scratch)?;
        if scratch.editor_revision != current_store.editor_revision
            || EditorDocumentV1::from_store(&scratch)
                != EditorDocumentV1::from_store(&current_store)
        {
            return Err(EditorCommitError::validation(
                "UNDECLARED_EDITOR_FIELD",
                "history overlap mutation changed an editor field",
            ));
        }
        let overlap_changed = !current_overlap.matches_store(&scratch);
        if scratch != current_store {
            self.commit_locked(&mut guard, scratch, ())
                .map_err(|error| EditorCommitError::io(error.to_string()))?;
        }
        let history_status = (overlap_changed && guard.history.invalidate_future())
            .then(|| guard.history.issue_status(self.history_gate.is_closed()));
        Ok(AdmittedHistoryOverlapMutation {
            value,
            history_status,
            _admission: admission,
        })
    }

    #[cfg(test)]
    pub(crate) fn commit_preset_editor_transaction<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        current_key_counters: KeyCounters,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        self.commit_editor_transaction_with_history(
            origin,
            touched_fields,
            EditorTransactionHistoryOptions {
                scope: Some(HistoryScope::PresetFull),
                observed_epoch: None,
                key_counters: Some(current_key_counters),
                ..EditorTransactionHistoryOptions::default()
            },
            updater,
        )
    }

    pub(super) fn commit_preset_editor_transaction_with_admission<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        current_key_counters: KeyCounters,
        admission: HistoryAdmissionLease,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        self.commit_editor_transaction_with_history_admission(
            origin,
            touched_fields,
            EditorTransactionHistoryOptions {
                scope: Some(HistoryScope::PresetFull),
                observed_epoch: None,
                key_counters: Some(current_key_counters),
                ..EditorTransactionHistoryOptions::default()
            },
            admission,
            updater,
        )
    }

    #[cfg(test)]
    pub(crate) fn commit_aux_editor_transaction<T>(
        &self,
        scope: HistoryScope,
        observed_history_epoch: Option<u64>,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        if !matches!(scope, HistoryScope::CustomTabs | HistoryScope::Mode) {
            return Err(EditorCommitError::validation(
                "INVALID_AUX_HISTORY_SCOPE",
                "aux editor transaction requires a custom tabs or mode scope",
            ));
        }
        let key_counters = touched_fields
            .contains(&EditorField::Keys)
            .then(|| self.snapshot().key_counters);
        self.commit_editor_transaction_with_history(
            origin,
            touched_fields,
            EditorTransactionHistoryOptions {
                scope: Some(scope),
                observed_epoch: observed_history_epoch,
                key_counters,
                ..EditorTransactionHistoryOptions::default()
            },
            updater,
        )
    }

    pub(crate) fn commit_aux_editor_transaction_with_admission<T>(
        &self,
        options: AuxEditorTransactionOptions<'_>,
        admission: HistoryAdmissionLease,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        self.commit_aux_editor_transaction_with_runtime_counters_and_admission(
            options, admission, None, updater,
        )
    }

    pub(crate) fn commit_aux_editor_transaction_with_runtime_counters_admission<T>(
        &self,
        options: AuxEditorTransactionOptions<'_>,
        admission: HistoryAdmissionLease,
        runtime_counters: &KeyCounters,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        self.commit_aux_editor_transaction_with_runtime_counters_and_admission(
            options,
            admission,
            Some(runtime_counters),
            updater,
        )
    }

    fn commit_aux_editor_transaction_with_runtime_counters_and_admission<T>(
        &self,
        options: AuxEditorTransactionOptions<'_>,
        admission: HistoryAdmissionLease,
        runtime_counters: Option<&KeyCounters>,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        if !matches!(options.scope, HistoryScope::CustomTabs | HistoryScope::Mode) {
            return Err(EditorCommitError::validation(
                "INVALID_AUX_HISTORY_SCOPE",
                "aux editor transaction requires a custom tabs or mode scope",
            ));
        }
        self.commit_editor_transaction_with_history_admission(
            options.origin,
            options.touched_fields,
            EditorTransactionHistoryOptions {
                scope: Some(options.scope),
                observed_epoch: options.observed_history_epoch,
                key_counters: runtime_counters.cloned(),
                ..EditorTransactionHistoryOptions::default()
            },
            admission,
            updater,
        )
    }

    #[cfg(test)]
    pub(crate) fn commit_aux_editor_reset_transaction_with_admission<T>(
        &self,
        options: AuxEditorResetTransactionOptions<'_>,
        admission: HistoryAdmissionLease,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        let counters = self.snapshot().key_counters;
        self.commit_aux_editor_reset_transaction_with_runtime_counters_and_admission(
            options,
            admission,
            Some(&counters),
            updater,
        )
    }

    pub(crate) fn commit_aux_editor_reset_transaction_with_runtime_counters_admission<T>(
        &self,
        options: AuxEditorResetTransactionOptions<'_>,
        admission: HistoryAdmissionLease,
        runtime_counters: &KeyCounters,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        self.commit_aux_editor_reset_transaction_with_runtime_counters_and_admission(
            options,
            admission,
            Some(runtime_counters),
            updater,
        )
    }

    fn commit_aux_editor_reset_transaction_with_runtime_counters_and_admission<T>(
        &self,
        options: AuxEditorResetTransactionOptions<'_>,
        admission: HistoryAdmissionLease,
        runtime_counters: Option<&KeyCounters>,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        if !matches!(options.scope, HistoryScope::CustomTabs | HistoryScope::Mode) {
            return Err(EditorCommitError::validation(
                "INVALID_AUX_HISTORY_SCOPE",
                "aux editor transaction requires a custom tabs or mode scope",
            ));
        }
        self.commit_editor_transaction_with_history_admission(
            options.origin,
            options.touched_fields,
            EditorTransactionHistoryOptions {
                scope: Some(options.scope),
                observed_epoch: options.observed_history_epoch,
                key_counters: runtime_counters.cloned(),
                plugin_instances_reset: Some(options.plugin_instances_reset),
                ..EditorTransactionHistoryOptions::default()
            },
            admission,
            updater,
        )
    }

    #[cfg(test)]
    fn commit_editor_transaction_with_history<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        history_options: EditorTransactionHistoryOptions,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        let admission = self.admit_editor_mutation()?;
        self.commit_editor_transaction_with_history_admission(
            origin,
            touched_fields,
            history_options,
            admission,
            updater,
        )
    }

    fn commit_editor_transaction_with_history_admission<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        history_options: EditorTransactionHistoryOptions,
        admission: HistoryAdmissionLease,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        let started = Instant::now();
        if touched_fields.contains(&EditorField::Keys) && history_options.key_counters.is_none() {
            return Err(key_counter_baseline_required());
        }
        let origin_name = origin
            .event_name()
            .unwrap_or_else(|| "loadRecovery".to_string());
        let result = self.commit_legacy_editor_transaction_inner(
            origin,
            touched_fields,
            &admission,
            history_options,
            updater,
        );
        let (outcome, changed_fields) = match &result {
            Ok(transaction) if transaction.change.result.changed_fields.is_empty() => (
                "no_editor_change",
                transaction.change.result.changed_fields.as_slice(),
            ),
            Ok(transaction) => (
                "committed",
                transaction.change.result.changed_fields.as_slice(),
            ),
            Err(error) => (editor_error_outcome(error.error_code), &[][..]),
        };
        // adapter 입력 원문 없이 origin과 결과만 기록
        log::info!(
            target: "editor_commit",
            "origin={origin_name} outcome={outcome} changedFields={changed_fields:?} durationMs={}",
            started.elapsed().as_millis()
        );
        result.map(|transaction| AdmittedEditorTransaction {
            value: transaction.value,
            change: transaction.change,
            _admission: admission,
        })
    }

    fn commit_legacy_editor_transaction_inner<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        admission: &HistoryAdmissionLease,
        history_options: EditorTransactionHistoryOptions,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<EditorTransactionResult<T>, EditorCommitError> {
        let mut guard = self
            .lock_for_update()
            .map_err(|error| EditorCommitError::io(error.to_string()))?;
        admission
            .revalidate_for(&self.history_gate)
            .map_err(|_| EditorCommitError::history_in_progress())?;
        validate_observed_history_epoch(&guard.history, history_options.observed_epoch)?;
        let current_store = guard.data.clone();
        let current = EditorDocumentV1::from_store(&current_store);
        let mut scratch = current_store.clone();
        if let Some(counters) = history_options.key_counters.as_ref() {
            scratch.key_counters = counters.clone();
        }
        let value = updater(&mut scratch)?;
        let plugin_reset_applied =
            history_options
                .plugin_instances_reset
                .as_ref()
                .is_some_and(|scope| match scope {
                    PluginInstancesResetScope::All => true,
                    PluginInstancesResetScope::Mode(mode) => {
                        crate::defaults::default_keys().contains_key(mode)
                            || current_store.custom_tabs.iter().any(|tab| tab.id == *mode)
                    }
                });
        let affected_plugin_ids = history_options
            .plugin_instances_reset
            .as_ref()
            .filter(|_| plugin_reset_applied)
            .map(|scope| reset_plugin_instances_for_scope(&mut scratch, scope))
            .transpose()?
            .unwrap_or_default();
        crate::state::migration::canonicalize_gradient_pairs(&mut scratch);
        crate::state::migration::canonicalize_image_modes(&mut scratch);

        // editorRevision은 이 트랜잭션만 관리
        scratch.editor_revision = current_store.editor_revision;
        let candidate = EditorDocumentV1::from_store(&scratch);
        let changed_fields = current.changed_fields(&candidate);
        if let Some(field) = changed_fields
            .iter()
            .find(|field| !touched_fields.contains(field))
        {
            return Err(EditorCommitError::validation(
                "UNDECLARED_EDITOR_FIELD",
                format!("editor field {field:?} changed outside the declared transaction scope"),
            ));
        }
        crate::state::native_element_id::validate_document_element_ids(&candidate)?;
        if changed_fields.contains(&EditorField::Keys) {
            repair_selected_mode(&mut scratch);
        }

        let (keys_touched, key_positions_touched) = touched_pair(touched_fields);
        validate_paired_update(&current, &candidate, keys_touched, key_positions_touched)?;
        // 프리셋 로드는 커밋 직전 모든 요소의 id를 재발급하므로 ID로는 관용
        // 상대를 찾을 수 없다 - 그 트랜잭션만 (모드, index) 짝짓기를 쓴다
        let keying = if history_options.scope == Some(HistoryScope::PresetFull) {
            GrandfatherKeying::LegacyPresetModeIndex
        } else {
            GrandfatherKeying::StableId
        };
        validate_document_transition_with_keying(
            &current,
            &candidate,
            &current_store,
            &scratch,
            keying,
        )?;

        if changed_fields.contains(&EditorField::Keys) {
            sync_key_counters(&mut scratch.key_counters, &candidate.keys);
        }

        let runtime_counters_changed = history_options
            .key_counters
            .as_ref()
            .is_some_and(|baseline| baseline != &scratch.key_counters);

        let history_plan = match history_options.scope {
            Some(HistoryScope::CustomTabs) => {
                let mut before =
                    CustomTabsHistorySnapshot::from_transition(&current_store, &scratch);
                if let Some(counters) = history_options.key_counters.as_ref() {
                    before.key_counters = counters.clone();
                }
                (!before.matches_store(&scratch))
                    .then(|| guard.history.prepare_custom_tabs_entry(before))
                    .transpose()
            }
            Some(HistoryScope::Mode) => (current_store.selected_key_type
                != scratch.selected_key_type)
                .then(|| {
                    guard
                        .history
                        .prepare_mode_entry(current_store.selected_key_type.clone())
                })
                .transpose(),
            Some(HistoryScope::PresetFull) => {
                let mut before = PresetFullHistorySnapshot::from_store(&current_store);
                if let Some(counters) = history_options.key_counters {
                    before.key_counters = counters;
                }
                (!before.matches_store(&scratch))
                    .then(|| guard.history.prepare_preset_full_entry(before))
                    .transpose()
            }
            Some(_) => {
                return Err(EditorCommitError::validation(
                    "INVALID_AUX_HISTORY_SCOPE",
                    "unsupported aux history scope",
                ));
            }
            None => Ok(None),
        }
        .map_err(|error| EditorCommitError::validation("HISTORY_SERIALIZATION_FAILED", error))?;

        let revision = if changed_fields.is_empty() {
            current_store.editor_revision
        } else {
            let revision = next_revision(current_store.editor_revision)?;
            scratch.editor_revision = revision;
            revision
        };

        let has_store_changes = scratch != current_store;
        let plugin_model_revision = if affected_plugin_ids.is_empty() {
            guard.plugin_model_revision
        } else {
            next_plugin_model_revision(guard.plugin_model_revision).map_err(|error| {
                EditorCommitError::validation("PLUGIN_MODEL_REVISION_OUT_OF_RANGE", error)
            })?
        };
        let selected_key_type = scratch.selected_key_type.clone();
        let key_counters = scratch.key_counters.clone();
        if has_store_changes || runtime_counters_changed {
            self.commit_locked(&mut guard, scratch, ())
                .map_err(|error| EditorCommitError::io(error.to_string()))?;
        }
        guard.plugin_model_revision = plugin_model_revision;
        let history_status = if let Some(plan) = history_plan {
            guard.history.apply_record_plan(plan);
            if plugin_reset_applied {
                guard.history.advance_epoch();
            }
            Some(guard.history.issue_status(self.history_gate.is_closed()))
        } else if plugin_reset_applied {
            // reset 전에 만들어져 이미 비행 중인 인스턴스 저장이 삭제 결과를
            // 되살리지 못하게 epoch를 성공 reset마다 전진
            if has_store_changes {
                guard.history.invalidate_all();
            }
            guard.history.advance_epoch();
            Some(guard.history.issue_status(self.history_gate.is_closed()))
        } else if history_options.scope.is_none() {
            let should_invalidate_history = !changed_fields.is_empty()
                || !affected_plugin_ids.is_empty()
                || (history_options.invalidate_history_on_store_only_change && has_store_changes);
            let history_changed = should_invalidate_history && guard.history.invalidate_all();
            history_changed.then(|| guard.history.issue_status(self.history_gate.is_closed()))
        } else {
            None
        };

        let event = if changed_fields.is_empty() {
            None
        } else {
            origin.event_name().map(|origin| EditorCommittedV1 {
                schema_version: EDITOR_SCHEMA_VERSION,
                revision,
                mutation_id: uuid::Uuid::new_v4().to_string(),
                gesture_id: None,
                gesture_ids: Vec::new(),
                origin,
                changed_fields: changed_fields.clone(),
                patch: candidate.patch_for_fields(&changed_fields),
            })
        };
        let change = CommittedEditorChange {
            result: EditorCommitResult {
                revision,
                changed_fields,
                op_results: None,
            },
            event,
            replayed: false,
            document: candidate,
            selected_key_type,
            key_counters,
            history_status,
            plugin_instances_changes: affected_plugin_ids
                .into_iter()
                .map(|plugin_id| PluginInstancesChangedPayload {
                    plugin_id,
                    revision: plugin_model_revision,
                    origin_mutation_id: None,
                })
                .collect(),
            runtime_publication_generation: guard.revision,
        };

        Ok(EditorTransactionResult { value, change })
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

    pub(crate) fn plugin_instances_get(
        &self,
        plugin_id: &str,
    ) -> std::result::Result<(Vec<SavedPluginInstance>, u64), String> {
        validate_plugin_id(plugin_id)?;
        let guard = self.state.read();
        let key = plugin_instances_storage_key(plugin_id);
        let instances = decode_plugin_instances_lenient(guard.data.plugin_data.get(&key), &key)
            .unwrap_or_default();
        Ok((instances, guard.plugin_model_revision))
    }

    // 전 플러그인 저장 인스턴스의 그룹 참조를 pluginId 구분 유지로 수집 - 미로드
    // 플러그인 포함. 순회·관대 decode 규칙은 for_each_stored_plugin_instances가
    // 단일 소스 (병합 소비가 플러그인 단위라 수집 형태만 다름)
    pub(crate) fn plugin_group_refs_by_plugin(&self) -> (HashMap<String, PluginGroupRefs>, u64) {
        let guard = self.state.read();
        let mut refs_by_plugin: HashMap<String, PluginGroupRefs> = HashMap::new();
        for_each_stored_plugin_instances(&guard.data, |plugin_id, instances| {
            let mut refs = PluginGroupRefs::new();
            add_plugin_group_refs(&mut refs, &instances);
            if !refs.is_empty() {
                refs_by_plugin.insert(plugin_id.to_string(), refs);
            }
        });
        (refs_by_plugin, guard.plugin_model_revision)
    }

    #[cfg(test)]
    pub(crate) fn commit_plugin_instances(
        &self,
        request: PluginInstancesCommitRequest,
    ) -> std::result::Result<AdmittedPluginInstancesCommit, String> {
        let admission = self.history_gate.admit_mutation()?;
        self.commit_plugin_instances_with_admission(request, admission)
    }

    pub(crate) fn commit_plugin_instances_with_admission(
        &self,
        request: PluginInstancesCommitRequest,
        admission: HistoryAdmissionLease,
    ) -> std::result::Result<AdmittedPluginInstancesCommit, String> {
        validate_plugin_instances_request(&request)?;
        let outcome = self.commit_plugin_instances_admitted(request, &admission)?;
        Ok(AdmittedPluginInstancesCommit {
            outcome,
            _admission: admission,
        })
    }

    fn commit_plugin_instances_admitted(
        &self,
        request: PluginInstancesCommitRequest,
        admission: &HistoryAdmissionLease,
    ) -> std::result::Result<PluginInstancesCommitOutcome, String> {
        let mut guard = self.lock_for_update().map_err(|error| error.to_string())?;
        admission.revalidate_for(&self.history_gate)?;

        if request
            .observed_history_epoch
            .is_some_and(|epoch| epoch != guard.history.history_epoch())
        {
            return Err("HISTORY_EPOCH_CONFLICT".to_string());
        }
        if request
            .expected_model_revision
            .is_some_and(|revision| revision != guard.plugin_model_revision)
        {
            return Err("PLUGIN_MODEL_REVISION_CONFLICT".to_string());
        }

        let current_snapshot = plugin_elements_snapshot(&guard.data, &request.plugin_id)?;
        self.apply_plugin_instances_mutation_locked(
            &mut guard,
            current_snapshot,
            PluginInstancesMutationInput {
                plugin_id: request.plugin_id,
                instances: request.instances,
                gesture_id: request.gesture_id,
            },
        )
    }

    #[cfg(test)]
    pub(crate) fn reconcile_plugin_instances(
        &self,
        request: PluginInstancesReconcileRequest,
    ) -> std::result::Result<AdmittedPluginInstancesCommit, String> {
        let admission = self.history_gate.admit_mutation()?;
        self.reconcile_plugin_instances_with_admission(request, admission)
    }

    pub(crate) fn reconcile_plugin_instances_with_admission(
        &self,
        request: PluginInstancesReconcileRequest,
        admission: HistoryAdmissionLease,
    ) -> std::result::Result<AdmittedPluginInstancesCommit, String> {
        validate_plugin_instances_reconcile_request(&request)?;
        let outcome = self.reconcile_plugin_instances_admitted(request, &admission)?;
        Ok(AdmittedPluginInstancesCommit {
            outcome,
            _admission: admission,
        })
    }

    fn reconcile_plugin_instances_admitted(
        &self,
        request: PluginInstancesReconcileRequest,
        admission: &HistoryAdmissionLease,
    ) -> std::result::Result<PluginInstancesCommitOutcome, String> {
        let mut guard = self.lock_for_update().map_err(|error| error.to_string())?;
        admission.revalidate_for(&self.history_gate)?;

        if request
            .observed_history_epoch
            .is_some_and(|epoch| epoch != guard.history.history_epoch())
        {
            return Err("HISTORY_EPOCH_CONFLICT".to_string());
        }

        let current_snapshot = plugin_elements_snapshot(&guard.data, &request.plugin_id)?;
        let valid_tab_ids = request.valid_tab_ids.into_iter().collect::<HashSet<_>>();
        let mut reconciled = current_snapshot.instances.clone().unwrap_or_default();
        reconciled.retain_mut(|instance| {
            let tab_id = normalize_plugin_instance_tab_id(instance.tab_id.as_deref()).to_string();
            if !valid_tab_ids.contains(&tab_id) {
                return false;
            }
            instance.tab_id = Some(tab_id);
            true
        });

        self.apply_plugin_instances_mutation_locked(
            &mut guard,
            current_snapshot,
            PluginInstancesMutationInput {
                plugin_id: request.plugin_id,
                instances: reconciled,
                gesture_id: None,
            },
        )
    }

    fn apply_plugin_instances_mutation_locked(
        &self,
        guard: &mut VersionedStoreState,
        current_snapshot: PluginElementsHistorySnapshot,
        mutation: PluginInstancesMutationInput,
    ) -> std::result::Result<PluginInstancesCommitOutcome, String> {
        let current_instances = current_snapshot.instances.clone().unwrap_or_default();
        validate_plugin_instances_transition(&current_instances, &mutation.instances)?;
        if current_instances == mutation.instances {
            return Ok(PluginInstancesCommitOutcome {
                plugin_id: mutation.plugin_id,
                model_revision: guard.plugin_model_revision,
                changed: false,
                history_status: None,
            });
        }

        let history_plan = guard
            .history
            .prepare_plugin_elements_entry(current_snapshot, mutation.gesture_id)?;
        let mut scratch = guard.data.clone();
        let canonical = PluginElementsHistorySnapshot {
            plugin_id: mutation.plugin_id.clone(),
            instances: (!mutation.instances.is_empty()).then_some(mutation.instances),
        };
        apply_plugin_elements_snapshot(&mut scratch, &canonical)?;
        let plugin_model_revision = next_plugin_model_revision(guard.plugin_model_revision)?;
        self.commit_locked(guard, scratch, ())
            .map_err(|error| error.to_string())?;
        guard.plugin_model_revision = plugin_model_revision;
        guard
            .history
            .apply_plugin_elements_record_plan(history_plan, &canonical);
        let history_status = Some(guard.history.issue_status(self.history_gate.is_closed()));

        Ok(PluginInstancesCommitOutcome {
            plugin_id: mutation.plugin_id,
            model_revision: plugin_model_revision,
            changed: true,
            history_status,
        })
    }

    // 플러그인 데이터 관련 메서드
    pub fn get_plugin_data(&self, key: &str) -> Result<Option<Value>> {
        let guard = self.state.read();
        Ok(guard.data.plugin_data.get(key).cloned())
    }

    #[cfg(test)]
    pub(crate) fn set_plugin_data(
        &self,
        key: &str,
        value: Value,
    ) -> Result<AdmittedPluginStorageMutation<()>> {
        let admission = self
            .history_gate
            .admit_mutation()
            .map_err(anyhow::Error::msg)?;
        self.set_plugin_data_with_admission(key, value, admission)
    }

    pub(crate) fn set_plugin_data_with_admission(
        &self,
        key: &str,
        value: Value,
        admission: HistoryAdmissionLease,
    ) -> Result<AdmittedPluginStorageMutation<()>> {
        // canonical 배치 버킷은 revision·history·이벤트를 우회하는 일반 storage 경로로
        // 쓰거나 지울 수 없다 (namespace 전체 clear만 배치를 함께 지운다)
        if is_plugin_instances_storage_key(key) {
            return Err(anyhow!("PLUGIN_INSTANCES_KEY_RESERVED"));
        }
        let mut guard = self.lock_for_update()?;
        admission
            .revalidate_for(&self.history_gate)
            .map_err(anyhow::Error::msg)?;
        if guard.data.plugin_data.get(key) == Some(&value) {
            return Ok(AdmittedPluginStorageMutation {
                value: (),
                history_status: None,
                plugin_instances_changes: Vec::new(),
                _admission: admission,
            });
        }
        let mut scratch = guard.data.clone();
        scratch.plugin_data.insert(key.to_string(), value);
        self.commit_locked(&mut guard, scratch, ())?;
        Ok(AdmittedPluginStorageMutation {
            value: (),
            history_status: None,
            plugin_instances_changes: Vec::new(),
            _admission: admission,
        })
    }

    #[cfg(test)]
    pub(crate) fn remove_plugin_data(
        &self,
        key: &str,
    ) -> Result<AdmittedPluginStorageMutation<()>> {
        let admission = self
            .history_gate
            .admit_mutation()
            .map_err(anyhow::Error::msg)?;
        self.remove_plugin_data_with_admission(key, admission)
    }

    pub(crate) fn remove_plugin_data_with_admission(
        &self,
        key: &str,
        admission: HistoryAdmissionLease,
    ) -> Result<AdmittedPluginStorageMutation<()>> {
        if is_plugin_instances_storage_key(key) {
            return Err(anyhow!("PLUGIN_INSTANCES_KEY_RESERVED"));
        }
        let mut guard = self.lock_for_update()?;
        admission
            .revalidate_for(&self.history_gate)
            .map_err(anyhow::Error::msg)?;
        if !guard.data.plugin_data.contains_key(key) {
            return Ok(AdmittedPluginStorageMutation {
                value: (),
                history_status: None,
                plugin_instances_changes: Vec::new(),
                _admission: admission,
            });
        }
        let mut scratch = guard.data.clone();
        scratch.plugin_data.remove(key);
        self.commit_locked(&mut guard, scratch, ())?;
        Ok(AdmittedPluginStorageMutation {
            value: (),
            history_status: None,
            plugin_instances_changes: Vec::new(),
            _admission: admission,
        })
    }

    #[cfg(test)]
    pub(crate) fn clear_all_plugin_data(&self) -> Result<AdmittedPluginStorageMutation<()>> {
        let admission = self
            .history_gate
            .admit_mutation()
            .map_err(anyhow::Error::msg)?;
        self.clear_all_plugin_data_with_admission(admission)
    }

    pub(crate) fn clear_all_plugin_data_with_admission(
        &self,
        admission: HistoryAdmissionLease,
    ) -> Result<AdmittedPluginStorageMutation<()>> {
        let mut guard = self.lock_for_update()?;
        admission
            .revalidate_for(&self.history_gate)
            .map_err(anyhow::Error::msg)?;
        let plugin_history_exists = guard.history.contains_plugin_elements_for(None);
        if guard.data.plugin_data.is_empty() {
            let history_status = (plugin_history_exists && guard.history.invalidate_all())
                .then(|| guard.history.issue_status(self.history_gate.is_closed()));
            return Ok(AdmittedPluginStorageMutation {
                value: (),
                history_status,
                plugin_instances_changes: Vec::new(),
                _admission: admission,
            });
        }
        let mut scratch = guard.data.clone();
        let affected_plugin_ids =
            collect_plugin_instance_ids(scratch.plugin_data.keys().map(String::as_str));
        let instance_data_changed = !affected_plugin_ids.is_empty();
        let next_model_revision = instance_data_changed
            .then(|| next_plugin_model_revision(guard.plugin_model_revision))
            .transpose()
            .map_err(anyhow::Error::msg)?;
        scratch.plugin_data.clear();
        self.commit_locked(&mut guard, scratch, ())?;
        if let Some(revision) = next_model_revision {
            guard.plugin_model_revision = revision;
        }
        let history_status = ((instance_data_changed || plugin_history_exists)
            && guard.history.invalidate_all())
        .then(|| guard.history.issue_status(self.history_gate.is_closed()));
        let plugin_instances_changes = next_model_revision
            .map(|revision| {
                affected_plugin_ids
                    .into_iter()
                    .map(|plugin_id| PluginInstancesStorageChange {
                        plugin_id,
                        revision,
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok(AdmittedPluginStorageMutation {
            value: (),
            history_status,
            plugin_instances_changes,
            _admission: admission,
        })
    }

    pub fn get_all_plugin_keys(&self) -> Result<Vec<String>> {
        let guard = self.state.read();
        Ok(guard.data.plugin_data.keys().cloned().collect())
    }

    #[cfg(test)]
    pub(crate) fn remove_plugin_data_by_prefix(
        &self,
        prefix: &str,
    ) -> Result<AdmittedPluginStorageMutation<usize>> {
        let admission = self
            .history_gate
            .admit_mutation()
            .map_err(anyhow::Error::msg)?;
        self.remove_plugin_data_by_prefix_with_admission(prefix, admission)
    }

    pub(crate) fn remove_plugin_data_by_prefix_with_admission(
        &self,
        prefix: &str,
        admission: HistoryAdmissionLease,
    ) -> Result<AdmittedPluginStorageMutation<usize>> {
        let mut guard = self.lock_for_update()?;
        admission
            .revalidate_for(&self.history_gate)
            .map_err(anyhow::Error::msg)?;
        let namespace_plugin_id = plugin_id_from_storage_namespace_prefix(prefix);
        let plugin_history_exists = namespace_plugin_id
            .is_some_and(|plugin_id| guard.history.contains_plugin_elements_for(Some(plugin_id)));
        // 공개 storage의 개별 키는 canonical 배치와 독립이다. 다만 플러그인
        // 전체 namespace clear는 1.6.1의 "모든 데이터 삭제" 계약대로 내부
        // 배치도 함께 지운다. cache/ 같은 하위 prefix에는 적용하지 않음
        let canonical_instances_key = namespace_plugin_id.map(plugin_instances_storage_key);
        let keys = guard
            .data
            .plugin_data
            .keys()
            .filter(|key| {
                key.starts_with(prefix)
                    || canonical_instances_key
                        .as_ref()
                        .is_some_and(|canonical| *key == canonical)
            })
            .cloned()
            .collect::<Vec<_>>();
        if keys.is_empty() {
            let history_status = (plugin_history_exists && guard.history.invalidate_all())
                .then(|| guard.history.issue_status(self.history_gate.is_closed()));
            return Ok(AdmittedPluginStorageMutation {
                value: 0,
                history_status,
                plugin_instances_changes: Vec::new(),
                _admission: admission,
            });
        }
        let affected_plugin_ids = collect_plugin_instance_ids(keys.iter().map(String::as_str));
        let instance_data_changed = !affected_plugin_ids.is_empty();
        let next_model_revision = instance_data_changed
            .then(|| next_plugin_model_revision(guard.plugin_model_revision))
            .transpose()
            .map_err(anyhow::Error::msg)?;
        let mut scratch = guard.data.clone();
        for key in &keys {
            scratch.plugin_data.remove(key);
        }
        self.commit_locked(&mut guard, scratch, ())?;
        if let Some(revision) = next_model_revision {
            guard.plugin_model_revision = revision;
        }
        let history_status = ((instance_data_changed || plugin_history_exists)
            && guard.history.invalidate_all())
        .then(|| guard.history.issue_status(self.history_gate.is_closed()));
        let plugin_instances_changes = next_model_revision
            .map(|revision| {
                affected_plugin_ids
                    .into_iter()
                    .map(|plugin_id| PluginInstancesStorageChange {
                        plugin_id,
                        revision,
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok(AdmittedPluginStorageMutation {
            value: keys.len(),
            history_status,
            plugin_instances_changes,
            _admission: admission,
        })
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

fn ensure_generic_editor_unchanged(before: &AppStoreData, after: &AppStoreData) -> Result<()> {
    if before.editor_revision != after.editor_revision
        || EditorDocumentV1::from_store(before) != EditorDocumentV1::from_store(after)
    {
        return Err(anyhow!(
            "editor fields must be changed through an editor transaction"
        ));
    }
    Ok(())
}

fn editor_error_outcome(code: EditorCommitErrorCode) -> &'static str {
    match code {
        EditorCommitErrorCode::RevisionConflict => "revision_conflict",
        EditorCommitErrorCode::PluginRevisionConflict => "plugin_revision_conflict",
        EditorCommitErrorCode::ValidationFailed => "validation_failed",
        EditorCommitErrorCode::TooManyGestureIds => "too_many_gesture_ids",
        EditorCommitErrorCode::InvalidGestureId => "invalid_gesture_id",
        EditorCommitErrorCode::PairedUpdateRequired => "paired_update_required",
        EditorCommitErrorCode::MultiKeyUnsupported => "multi_key_unsupported",
        EditorCommitErrorCode::MutationIdReused => "mutation_id_reused",
        EditorCommitErrorCode::HistoryInProgress => "history_in_progress",
        EditorCommitErrorCode::HistoryEpochConflict => "history_epoch_conflict",
        EditorCommitErrorCode::IoError => "io_error",
    }
}

fn prepare_editor_patch_transition(
    current_store: &AppStoreData,
    changes: &crate::models::EditorPatchV1,
    touched_fields: &[EditorField],
) -> std::result::Result<
    (
        EditorDocumentV1,
        EditorDocumentV1,
        AppStoreData,
        Vec<EditorField>,
    ),
    EditorCommitError,
> {
    let current = EditorDocumentV1::from_store(current_store);
    let mut candidate = current.clone();
    candidate.apply_patch(changes);

    let mut scratch = current_store.clone();
    candidate.apply_to_store(&mut scratch);
    crate::state::migration::canonicalize_gradient_pairs(&mut scratch);
    crate::state::migration::canonicalize_image_modes(&mut scratch);
    candidate = EditorDocumentV1::from_store(&scratch);

    validate_paired_update(
        &current,
        &candidate,
        touched_fields.contains(&EditorField::Keys),
        touched_fields.contains(&EditorField::KeyPositions),
    )?;
    scratch.editor_revision = current_store.editor_revision;
    validate_document_transition(&current, &candidate, current_store, &scratch)?;
    let changed_fields = current.changed_fields(&candidate);

    Ok((current, candidate, scratch, changed_fields))
}

fn require_history_entry(plan: HistoryRecordPlan) -> Result<HistoryEntry, String> {
    match plan {
        HistoryRecordPlan::Entry(entry) => Ok(*entry),
        HistoryRecordPlan::Merge { .. } => Err(HISTORY_INVALID_OPPOSITE_ENTRY.to_string()),
        HistoryRecordPlan::Truncate => Err(HISTORY_ENTRY_TOO_LARGE.to_string()),
    }
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

fn editor_history_error(error: EditorCommitError) -> String {
    format!("{:?}: {}", error.error_code, error.message)
}

fn validate_observed_history_epoch(
    history: &HistoryService,
    observed_history_epoch: Option<u64>,
) -> std::result::Result<(), EditorCommitError> {
    if observed_history_epoch.is_some_and(|observed| observed != history.history_epoch()) {
        return Err(EditorCommitError::history_epoch_conflict(
            history.history_epoch(),
        ));
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

fn project_history_key_counters(
    current: &KeyCounters,
    historical: &KeyCounters,
    target_keys: &KeyMappings,
) -> KeyCounters {
    let mut projected = historical.clone();
    sync_key_counters(&mut projected, target_keys);
    for (mode, counters) in &mut projected {
        let Some(current_mode) = current.get(mode) else {
            continue;
        };
        for (key, count) in counters {
            if let Some(current_count) = current_mode.get(key) {
                *count = *current_count;
            }
        }
    }
    projected
}

fn project_editor_history_key_counters(
    current: &KeyCounters,
    historical: Option<&KeyCounters>,
    target_keys: &KeyMappings,
) -> KeyCounters {
    let Some(historical) = historical else {
        let mut projected = current.clone();
        sync_key_counters(&mut projected, target_keys);
        return projected;
    };
    project_history_key_counters(current, historical, target_keys)
}

fn insert_mutation_ack(
    acks: &mut VecDeque<MutationAck>,
    id: String,
    fingerprint: RequestFingerprint,
    result: EditorCommitResult,
) {
    if acks.len() == MUTATION_ACK_CAPACITY {
        acks.pop_front();
    }
    acks.push_back(MutationAck {
        id,
        fingerprint,
        result,
    });
}

fn insert_gesture_mutation_ack(
    acks: &mut VecDeque<GestureMutationAck>,
    id: String,
    fingerprint: RequestFingerprint,
    result: GestureCommitResult,
) {
    if acks.len() == MUTATION_ACK_CAPACITY {
        acks.pop_front();
    }
    acks.push_back(GestureMutationAck {
        id,
        fingerprint,
        result,
    });
}

#[cfg(test)]
mod gradient_real_data_simulation;

#[cfg(test)]
mod tests;
