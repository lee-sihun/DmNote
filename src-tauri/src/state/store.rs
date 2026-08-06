use std::{
    collections::{HashSet, VecDeque},
    fs,
    path::{Component, Path, PathBuf},
    sync::{mpsc, Arc},
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use crate::errors::{EditorCommitError, EditorCommitErrorCode};
use crate::models::{
    key_mappings_contain_multi, normalize_key_mappings, AppStoreData, CommittedEditorChange,
    CustomCssPatch, CustomJsPatch, EditorCommitOrigin, EditorCommitRequest, EditorCommitResult,
    EditorCommittedV1, EditorDocumentV1, EditorField, EditorGetResult, EditorTransactionResult,
    FontType, GestureCommitRequest, GestureCommitResult, HistoryStatus, KeyCounters, KeyPosition,
    NoteSettingsPatch, PluginInstancesCommitRequest, PluginInstancesReconcileRequest,
    SavedPluginInstance, SettingsDiff, SettingsPatchInput, SettingsState, EDITOR_SCHEMA_VERSION,
};
use anyhow::{anyhow, Context, Result};
use parking_lot::{Mutex, RwLock, RwLockWriteGuard};
use serde_json::Value;
use tauri::path::PathResolver;
use tauri::Runtime;

use super::atomic_file::atomic_replace;
use super::builtin_sounds::seed_builtin_sounds;
use super::editor::{
    canonical_request_fingerprint, next_revision, repair_selected_mode, request_fingerprint,
    request_payload_size, sync_key_counters, touched_pair, validate_document_transition,
    validate_history_restore_metadata, validate_paired_update, validate_request_envelope,
    RequestFingerprint, MUTATION_ACK_CAPACITY,
};
use super::gesture::validate_gesture_commit_request;
use super::history::{
    CustomTabsHistorySnapshot, HistoryAdmissionGate, HistoryAdmissionLease, HistoryDirection,
    HistoryEntry, HistoryRecordPlan, HistoryScope, HistoryService, HistorySnapshot,
    PluginElementsHistorySnapshot, PresetFullHistorySnapshot, PresetHistorySettingsSnapshot,
    HISTORY_ENTRY_TOO_LARGE, HISTORY_IN_PROGRESS,
};
use super::local_asset_path::{file_url_to_path, path_identity_key, FileUrlPath};
use super::migration::{
    find_legacy_store_file, is_foreign_portable_asset_reference, load_store_from_path,
    migrate_key_images_to_app_data, migrate_local_fonts_to_app_data, normalize_state,
    rehome_foreign_asset_references,
};
use super::plugin::{
    decode_plugin_instances, encode_plugin_instances, normalize_plugin_instance_tab_id,
    plugin_instances_storage_key, validate_plugin_id, validate_plugin_instances_reconcile_request,
    validate_plugin_instances_request,
};

const TRASH_RETENTION: Duration = Duration::from_secs(30 * 24 * 60 * 60);
const SOUND_DELETE_BACKUP_MARKER: &str = ".delete-backup-";
pub(crate) static PROCESSED_WAV_TRANSACTION_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug)]
pub(crate) struct StagedSoundDeletionFile {
    source_path: PathBuf,
    backup_path: PathBuf,
}

struct SoundRecoveryOutcome {
    protected_keys: HashSet<String>,
    complete: bool,
}

impl SoundRecoveryOutcome {
    fn complete() -> Self {
        Self {
            protected_keys: HashSet::new(),
            complete: true,
        }
    }
}

pub struct AppStore {
    path: PathBuf,
    state: RwLock<VersionedStoreState>,
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
        #[cfg(test)]
        force_failure: bool,
    },
    Shutdown {
        completion_tx: mpsc::Sender<()>,
    },
}

struct StoreWriter {
    sender: Mutex<Option<mpsc::Sender<WriterMessage>>>,
    handle: Mutex<Option<JoinHandle<()>>>,
    #[cfg(test)]
    fail_next_persist: std::sync::atomic::AtomicBool,
    #[cfg(test)]
    persist_count: std::sync::atomic::AtomicUsize,
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

    fn new(path: PathBuf, state: AppStoreData, skip_asset_sweep: bool) -> Result<Self> {
        Ok(Self {
            writer: StoreWriter::start(path.clone())?,
            path,
            skip_asset_sweep,
            history_gate: Arc::new(HistoryAdmissionGate::default()),
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

    /// overlay·panel bounds 전용
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
        self.state.read().revision
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
            return Err("INVALID_HISTORY_OPERATION_ID".to_string());
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
                return Err("HISTORY_SCOPE_MISMATCH".to_string());
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
                } => {
                    let current = EditorDocumentV1::from_store(&current_store);
                    let opposite =
                        require_history_entry(guard.history.prepare_opposite_editor_entry(
                            changed_fields.clone(),
                            current.patch_for_fields(&changed_fields),
                            target_gesture_id,
                        )?)?;
                    let change = self
                        .commit_editor_patch_locked(
                            &mut guard,
                            &before,
                            &changed_fields,
                            EditorPatchCommitOptions {
                                mutation_id: operation_id.to_string(),
                                gesture_id: None,
                                gesture_ids: Vec::new(),
                                origin,
                                record_history: false,
                                apply_key_side_effects: false,
                                enforce_touched_fields: true,
                            },
                        )
                        .map_err(editor_history_error)?;
                    if change.result.changed_fields.is_empty() {
                        return Err("HISTORY_TARGET_ALREADY_APPLIED".to_string());
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
                    let change = self
                        .commit_custom_tabs_history_locked(
                            &mut guard,
                            &before,
                            operation_id,
                            origin,
                        )
                        .map_err(editor_history_error)?;
                    (
                        opposite,
                        change,
                        Some(HistoryAuxChange::CustomTabs {
                            snapshot: Box::new(before),
                            changed_tab_css_ids,
                        }),
                    )
                }
                HistorySnapshot::PresetFull(before) => {
                    let mut current_snapshot =
                        PresetFullHistorySnapshot::from_store(&current_store);
                    current_snapshot.key_counters = current_key_counters.clone();
                    if current_snapshot == *before {
                        return Err("HISTORY_TARGET_ALREADY_APPLIED".to_string());
                    }
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
                        return Err("HISTORY_TARGET_ALREADY_APPLIED".to_string());
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
                        return Err("HISTORY_TARGET_ALREADY_APPLIED".to_string());
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
                        return Err("HISTORY_TARGET_ALREADY_APPLIED".to_string());
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
                                    before: current.patch_for_fields(changed_fields),
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
        self.commit_editor_document_admitted(request, &admission)
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
        let started = Instant::now();
        let base_revision = request.base_revision;
        let mutation_id = uuid::Uuid::parse_str(&request.mutation_id)
            .map(|id| id.hyphenated().to_string())
            .unwrap_or_else(|_| "<invalid>".to_string());
        let payload_size = request_payload_size(&request);
        let payload_bytes = payload_size.as_ref().copied().unwrap_or(0);
        let result = match payload_size {
            Ok(_) => self.commit_editor_document_inner(request, admission),
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
        // 문서·patch 원문 없이 경계 메타데이터만 기록
        log::info!(
            target: "editor_commit",
            "command=editor_commit mutationId={mutation_id} baseRevision={base_revision} currentRevision={current_revision} outcome={outcome} changedFields={changed_fields:?} durationMs={} payloadBytes={payload_bytes}",
            started.elapsed().as_millis()
        );
        result
    }

    fn commit_editor_document_inner(
        &self,
        mut request: EditorCommitRequest,
        admission: &HistoryAdmissionLease,
    ) -> std::result::Result<CommittedEditorChange, EditorCommitError> {
        if let Some(keys) = request.changes.keys.as_mut() {
            normalize_key_mappings(keys);
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
                runtime_publication_generation: guard.revision,
            });
        }

        if request.base_revision != guard.data.editor_revision {
            return Err(EditorCommitError::revision_conflict(
                guard.data.editor_revision,
            ));
        }

        if request.changes.keys.is_some()
            && key_mappings_contain_multi(&guard.data.keys)
            && !request.multi_key
        {
            return Err(EditorCommitError::multi_key_unsupported());
        }

        let gesture_id = request.history_gesture_id();
        let gesture_ids = request.echoed_gesture_ids();
        let touched_fields = request.changes.included_fields();
        let change = self.commit_editor_patch_locked(
            &mut guard,
            &request.changes,
            &touched_fields,
            EditorPatchCommitOptions {
                mutation_id: request.mutation_id.clone(),
                gesture_id,
                gesture_ids,
                origin: EditorCommitOrigin::StrictEditorCommit,
                record_history: true,
                apply_key_side_effects: true,
                enforce_touched_fields: false,
            },
        )?;
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
        options: EditorPatchCommitOptions,
    ) -> std::result::Result<CommittedEditorChange, EditorCommitError> {
        let current_store = guard.data.clone();
        let (current, candidate, mut scratch, changed_fields) =
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
        if changed_fields.is_empty() {
            return Ok(CommittedEditorChange {
                result: EditorCommitResult {
                    revision: current_store.editor_revision,
                    changed_fields,
                },
                event: None,
                replayed: false,
                document: current,
                selected_key_type: current_store.selected_key_type,
                key_counters: current_store.key_counters,
                history_status: None,
                runtime_publication_generation: guard.revision,
            });
        }

        let history_plan = options
            .record_history
            .then(|| {
                guard.history.prepare_entry_with_gesture_ids(
                    changed_fields.clone(),
                    current.patch_for_fields(&changed_fields),
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
            },
            event,
            replayed: false,
            document: candidate,
            selected_key_type,
            key_counters,
            history_status,
            runtime_publication_generation: guard.revision,
        })
    }

    #[cfg(test)]
    pub(crate) fn commit_gesture(
        &self,
        request: GestureCommitRequest,
    ) -> std::result::Result<AdmittedGestureCommit, EditorCommitError> {
        let admission = self.admit_editor_mutation()?;
        self.commit_gesture_with_admission(request, admission)
    }

    pub(crate) fn commit_gesture_with_admission(
        &self,
        request: GestureCommitRequest,
        admission: HistoryAdmissionLease,
    ) -> std::result::Result<AdmittedGestureCommit, EditorCommitError> {
        validate_gesture_commit_request(&request)?;
        let outcome = self.commit_gesture_admitted(request, &admission)?;
        Ok(AdmittedGestureCommit {
            outcome,
            _admission: admission,
        })
    }

    fn commit_gesture_admitted(
        &self,
        request: GestureCommitRequest,
        admission: &HistoryAdmissionLease,
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

        let current_store = guard.data.clone();
        let (current_editor, candidate_editor, mut scratch, changed_fields) =
            if let Some(changes) = request.editor_changes.as_ref() {
                let touched_fields = changes.included_fields();
                prepare_editor_patch_transition(&current_store, changes, &touched_fields)?
            } else {
                let current = EditorDocumentV1::from_store(&current_store);
                (current.clone(), current, current_store.clone(), Vec::new())
            };

        let mut history_snapshots = Vec::with_capacity(request.plugin_changes.len() + 1);
        if !changed_fields.is_empty() {
            history_snapshots.push(HistorySnapshot::Editor {
                changed_fields: changed_fields.clone(),
                before: current_editor.patch_for_fields(&changed_fields),
            });
        }

        let mut changed_plugin_ids = Vec::new();
        for plugin_change in &request.plugin_changes {
            let current_snapshot =
                plugin_elements_snapshot(&current_store, &plugin_change.plugin_id).map_err(
                    |error| EditorCommitError::validation("INVALID_GESTURE_PLUGIN", error),
                )?;
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
    ) -> std::result::Result<(Option<CommittedEditorChange>, Vec<String>, u64), EditorCommitError>
    {
        let current_store = guard.data.clone();
        let mut editor_target = None;
        let mut plugin_targets = Vec::new();
        let mut seen_plugin_ids = HashSet::new();

        for snapshot in snapshots {
            match snapshot {
                HistorySnapshot::Editor {
                    changed_fields,
                    before,
                } => {
                    if editor_target.is_some() {
                        return Err(EditorCommitError::validation(
                            "HISTORY_COMPOUND_INVALID",
                            "compound history contains duplicate editor snapshots",
                        ));
                    }
                    editor_target = Some((changed_fields, before));
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

        let (mut scratch, editor_restore) = if let Some((changed_fields, before)) = editor_target {
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
            (next_store, Some((candidate, actual_fields)))
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
            .is_some_and(|(_, changed_fields)| !changed_fields.is_empty());
        if !editor_changed && plugin_ids.is_empty() {
            return Err(EditorCommitError::validation(
                "HISTORY_TARGET_ALREADY_APPLIED",
                "history target is already applied",
            ));
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

        let change = editor_restore.and_then(|(candidate, changed_fields)| {
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
                },
                event,
                replayed: false,
                document: candidate,
                selected_key_type,
                key_counters,
                history_status: None,
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
    ) -> std::result::Result<Option<CommittedEditorChange>, EditorCommitError> {
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
        scratch.key_counters = target.key_counters.clone();
        target.apply_override_patches(&mut scratch);
        crate::state::migration::canonicalize_gradient_pairs(&mut scratch);
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
        self.commit_locked(guard, scratch, ())
            .map_err(|error| EditorCommitError::io(error.to_string()))?;

        if changed_fields.is_empty() {
            return Ok(None);
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
        Ok(Some(CommittedEditorChange {
            result: EditorCommitResult {
                revision,
                changed_fields,
            },
            event,
            replayed: false,
            document: candidate,
            selected_key_type,
            key_counters,
            history_status: None,
            runtime_publication_generation: guard.revision,
        }))
    }

    fn commit_preset_full_history_locked(
        &self,
        guard: &mut VersionedStoreState,
        target: &PresetFullHistorySnapshot,
        operation_id: &str,
        origin: EditorCommitOrigin,
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
        scratch.key_counters = target.key_counters.clone();
        scratch.tab_note_overrides = target.settings.tab_note_overrides.clone();
        scratch.tab_css_overrides = target.tab_css_overrides.clone();
        let settings_diff = crate::services::settings::apply_patch_to_store(
            &mut scratch,
            &preset_history_settings_patch(&target.settings),
        );
        crate::state::migration::canonicalize_gradient_pairs(&mut scratch);
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
                },
                event,
                replayed: false,
                document: candidate,
                selected_key_type,
                key_counters,
                history_status: None,
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
        self.commit_editor_transaction_with_history(
            origin,
            touched_fields,
            EditorTransactionHistoryOptions::default(),
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
            },
            updater,
        )
    }

    pub(crate) fn commit_preset_editor_transaction_with_admission<T>(
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
        self.commit_editor_transaction_with_history(
            origin,
            touched_fields,
            EditorTransactionHistoryOptions {
                scope: Some(scope),
                observed_epoch: observed_history_epoch,
                key_counters: None,
            },
            updater,
        )
    }

    pub(crate) fn commit_aux_editor_transaction_with_admission<T>(
        &self,
        scope: HistoryScope,
        observed_history_epoch: Option<u64>,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        admission: HistoryAdmissionLease,
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<AdmittedEditorTransaction<T>, EditorCommitError> {
        if !matches!(scope, HistoryScope::CustomTabs | HistoryScope::Mode) {
            return Err(EditorCommitError::validation(
                "INVALID_AUX_HISTORY_SCOPE",
                "aux editor transaction requires a custom tabs or mode scope",
            ));
        }
        self.commit_editor_transaction_with_history_admission(
            origin,
            touched_fields,
            EditorTransactionHistoryOptions {
                scope: Some(scope),
                observed_epoch: observed_history_epoch,
                key_counters: None,
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
        crate::state::migration::canonicalize_gradient_pairs(&mut scratch);

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
        if changed_fields.contains(&EditorField::Keys) {
            repair_selected_mode(&mut scratch);
        }

        let (keys_touched, key_positions_touched) = touched_pair(touched_fields);
        validate_paired_update(&current, &candidate, keys_touched, key_positions_touched)?;
        validate_document_transition(&current, &candidate, &current_store, &scratch)?;

        if changed_fields.contains(&EditorField::Keys) {
            sync_key_counters(&mut scratch.key_counters, &candidate.keys);
        }

        let history_plan = match history_options.scope {
            Some(HistoryScope::CustomTabs) => {
                let before = CustomTabsHistorySnapshot::from_transition(&current_store, &scratch);
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
        let selected_key_type = scratch.selected_key_type.clone();
        let key_counters = scratch.key_counters.clone();
        if has_store_changes {
            self.commit_locked(&mut guard, scratch, ())
                .map_err(|error| EditorCommitError::io(error.to_string()))?;
        }
        let history_status = history_plan.map(|plan| {
            guard.history.apply_record_plan(plan);
            guard.history.issue_status(self.history_gate.is_closed())
        });

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
            },
            event,
            replayed: false,
            document: candidate,
            selected_key_type,
            key_counters,
            history_status,
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
        let instances =
            decode_plugin_instances(guard.data.plugin_data.get(&key))?.unwrap_or_default();
        Ok((instances, guard.plugin_model_revision))
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
        if guard.data.plugin_data.is_empty() {
            return Ok(AdmittedPluginStorageMutation {
                value: (),
                history_status: None,
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
        let history_status = (instance_data_changed && guard.history.invalidate_future())
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
        let keys = guard
            .data
            .plugin_data
            .keys()
            .filter(|key| key.starts_with(prefix))
            .cloned()
            .collect::<Vec<_>>();
        if keys.is_empty() {
            return Ok(AdmittedPluginStorageMutation {
                value: 0,
                history_status: None,
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
        let history_status = (instance_data_changed && guard.history.invalidate_future())
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

    /// 앱 종료 시점에 한 번 호출하는 자원 정리.
    /// 현재 store에서 참조하지 않는 자산은 30일 보관되는 trash 세션으로 격리
    #[cfg(test)]
    pub fn cleanup_orphan_assets_now(&self) -> Result<()> {
        let _transaction_guard = PROCESSED_WAV_TRANSACTION_LOCK.lock();
        self.cleanup_orphan_assets_while_locked()
    }

    fn cleanup_orphan_assets_while_locked(&self) -> Result<()> {
        let app_data_dir = self
            .path
            .parent()
            .context("failed to resolve app data directory from store path")?;

        let fonts_dir = app_data_dir.join("fonts");
        let images_dir = app_data_dir.join("images");
        let sounds_dir = app_data_dir.join("sounds");
        let trash_dir = app_data_dir.join("trash");

        self.recover_pending_processed_wav_replacement(&sounds_dir)?;
        let processed_recovery = recover_interrupted_processed_wav_replacements(&sounds_dir)?;
        let deletion_recovery =
            recover_interrupted_sound_deletions(&self.state.read().data, &sounds_dir, &trash_dir)?;
        let sound_recovery_complete = processed_recovery.complete && deletion_recovery.complete;
        let mut recovered_sound_keys = processed_recovery.protected_keys;
        recovered_sound_keys.extend(deletion_recovery.protected_keys);
        purge_expired_trash_sessions(&trash_dir)?;

        if self.skip_asset_sweep {
            log::warn!(
                "[Assets] Skipping orphan asset sweep for a recovered or legacy-migrated store session"
            );
            return Ok(());
        }

        let snapshot = self.state.read().data.clone();
        let referenced_fonts = collect_local_font_paths(app_data_dir, &snapshot);
        let referenced_images = collect_local_image_paths(app_data_dir, &snapshot);
        let mut referenced_sounds = collect_local_sound_paths(app_data_dir, &snapshot);
        referenced_sounds.keys.extend(recovered_sound_keys);
        referenced_sounds.complete &= sound_recovery_complete;
        let mut trash_session = TrashSession::new(trash_dir, SystemTime::now())?;

        if referenced_fonts.complete {
            sweep_unreferenced_asset_files(
                "Fonts",
                &fonts_dir,
                &referenced_fonts.keys,
                &mut trash_session,
            )?;
        } else {
            log::warn!("[Fonts] Skipping asset sweep because a local path could not be resolved");
        }
        if referenced_images.complete {
            sweep_unreferenced_asset_files(
                "Images",
                &images_dir,
                &referenced_images.keys,
                &mut trash_session,
            )?;
        } else {
            log::warn!("[Images] Skipping asset sweep because a local path could not be resolved");
        }
        if referenced_sounds.complete {
            sweep_unreferenced_asset_files(
                "Sounds",
                &sounds_dir,
                &referenced_sounds.keys,
                &mut trash_session,
            )?;
        } else {
            log::warn!("[Sounds] Skipping asset sweep because a local path could not be resolved");
        }
        Ok(())
    }

    pub(crate) fn flush_cleanup_and_shutdown(&self) -> Result<()> {
        let _transaction_guard = PROCESSED_WAV_TRANSACTION_LOCK.lock();

        let flush_result = self.flush();
        let cleanup_result = if flush_result.is_ok() {
            self.cleanup_orphan_assets_while_locked()
        } else {
            Ok(())
        };
        let shutdown_result = self.flush_and_shutdown();

        match (flush_result, cleanup_result, shutdown_result) {
            (Ok(()), Ok(()), Ok(())) => Ok(()),
            (Err(flush), _, Err(shutdown)) => Err(anyhow!(
                "failed to flush store before cleanup: {flush:#}; failed to shut down store writer: {shutdown:#}"
            )),
            (Err(flush), _, Ok(())) => {
                Err(anyhow!("failed to flush store before asset cleanup: {flush:#}"))
            }
            (Ok(()), Err(cleanup), Err(shutdown)) => Err(anyhow!(
                "failed to clean up assets: {cleanup:#}; failed to shut down store writer: {shutdown:#}"
            )),
            (Ok(()), Err(cleanup), Ok(())) => Err(cleanup),
            (Ok(()), Ok(()), Err(shutdown)) => Err(shutdown),
        }
    }

    pub fn recover_interrupted_processed_wav_replacements_now(&self) -> Result<()> {
        let _transaction_guard = PROCESSED_WAV_TRANSACTION_LOCK.lock();
        self.recover_interrupted_processed_wav_replacements_while_locked()
    }

    /// `PROCESSED_WAV_TRANSACTION_LOCK`을 이미 보유한 편집 명령 전용
    pub(crate) fn recover_interrupted_processed_wav_replacements_while_locked(&self) -> Result<()> {
        self.recover_interrupted_sound_assets_while_locked()
            .map(|_| ())
    }

    /// `PROCESSED_WAV_TRANSACTION_LOCK`을 이미 보유한 목록 명령 전용
    pub(crate) fn prepare_sound_listing_while_locked(&self) -> Result<bool> {
        self.recover_interrupted_sound_assets_while_locked()
    }

    fn recover_interrupted_sound_assets_while_locked(&self) -> Result<bool> {
        let app_data_dir = self
            .path
            .parent()
            .context("failed to resolve app data directory from store path")?;
        let sounds_dir = app_data_dir.join("sounds");
        let trash_dir = app_data_dir.join("trash");
        self.recover_pending_processed_wav_replacement(&sounds_dir)?;
        let processed_recovery = recover_interrupted_processed_wav_replacements(&sounds_dir)?;
        let deletion_recovery =
            recover_interrupted_sound_deletions(&self.state.read().data, &sounds_dir, &trash_dir)?;
        Ok(processed_recovery.complete && deletion_recovery.complete)
    }

    fn recover_pending_processed_wav_replacement(&self, sounds_dir: &Path) -> Result<()> {
        self.recover_pending_processed_wav_replacement_with(sounds_dir, Path::try_exists)
    }

    fn recover_pending_processed_wav_replacement_with<TryExists>(
        &self,
        sounds_dir: &Path,
        mut try_exists: TryExists,
    ) -> Result<()>
    where
        TryExists: FnMut(&Path) -> std::io::Result<bool>,
    {
        let Some(pending) = self
            .state
            .read()
            .data
            .pending_processed_wav_replacement
            .clone()
        else {
            return Ok(());
        };

        let target_path = validate_pending_processed_wav_target(sounds_dir, &pending.sound_path)?;
        let backup_path = processed_wav_backup_path(&target_path)?;
        let target_exists = try_exists(&target_path).with_context(|| {
            format!(
                "failed to check pending WAV target at {}",
                target_path.display()
            )
        })?;
        let backup_exists = try_exists(&backup_path).with_context(|| {
            format!(
                "failed to check pending WAV backup at {}",
                backup_path.display()
            )
        })?;
        let files_missing = !target_exists && !backup_exists;

        if files_missing {
            log::warn!(
                "[Sounds] Clearing unrecoverable WAV transaction because target '{}' and backup '{}' are both missing",
                target_path.display(),
                backup_path.display()
            );
        } else {
            rollback_pending_processed_wav(
                &target_path,
                pending.had_original,
                target_exists,
                backup_exists,
            )?;
        }
        self.update(|data| {
            if data.pending_processed_wav_replacement.as_ref() == Some(&pending) {
                data.pending_processed_wav_replacement = None;
            }
        })?;
        if !files_missing {
            log::info!(
                "[Sounds] Recovered interrupted WAV transaction for '{}'",
                target_path.display()
            );
        }
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
            #[cfg(test)]
            fail_next_persist: std::sync::atomic::AtomicBool::new(false),
            #[cfg(test)]
            persist_count: std::sync::atomic::AtomicUsize::new(0),
        })
    }

    fn enqueue(&self, revision: u64, snapshot: AppStoreData) -> Result<PersistTicket> {
        let (completion_tx, completion_rx) = mpsc::channel();
        let guard = self.sender.lock();
        let sender = guard.as_ref().context("store writer is shut down")?;
        #[cfg(test)]
        let force_failure = self
            .fail_next_persist
            .swap(false, std::sync::atomic::Ordering::SeqCst);
        sender
            .send(WriterMessage::Persist {
                revision,
                snapshot: Box::new(snapshot),
                completion_tx,
                #[cfg(test)]
                force_failure,
            })
            .with_context(|| format!("failed to enqueue store revision {revision}"))?;
        #[cfg(test)]
        self.persist_count
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(PersistTicket {
            revision,
            completion_rx,
        })
    }

    #[cfg(test)]
    fn fail_next_persist(&self) {
        self.fail_next_persist
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }

    #[cfg(test)]
    fn persist_count(&self) -> usize {
        self.persist_count.load(std::sync::atomic::Ordering::SeqCst)
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
                #[cfg(test)]
                force_failure,
            } => {
                #[cfg(test)]
                let result = if force_failure {
                    Err("injected store writer failure".to_string())
                } else {
                    write_store_snapshot(path, revision, snapshot.as_ref())
                        .map_err(|err| format!("{err:#}"))
                };
                #[cfg(not(test))]
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
    use crate::defaults::{default_keys, default_positions};

    let data = AppStoreData {
        keys: default_keys().clone(),
        key_positions: default_positions().clone(),
        ..Default::default()
    };
    normalize_state(data)
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
        HistoryRecordPlan::Merge { .. } => Err("HISTORY_INVALID_OPPOSITE_ENTRY".to_string()),
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
        instances: decode_plugin_instances(store.plugin_data.get(&key))?,
    })
}

fn next_plugin_model_revision(current: u64) -> Result<u64, String> {
    current
        .checked_add(1)
        .filter(|revision| *revision <= crate::state::editor::MAX_SAFE_EDITOR_REVISION)
        .ok_or_else(|| "PLUGIN_MODEL_REVISION_OUT_OF_RANGE".to_string())
}

fn plugin_id_from_instances_storage_key(key: &str) -> Option<&str> {
    key.strip_prefix("plugin_data_")
        .and_then(|key| key.strip_suffix("/instances"))
        .filter(|plugin_id| !plugin_id.is_empty())
}

fn is_plugin_instances_storage_key(key: &str) -> bool {
    plugin_id_from_instances_storage_key(key).is_some()
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

struct AssetReferencePaths {
    keys: HashSet<String>,
    complete: bool,
    unresolved_count: usize,
}

impl AssetReferencePaths {
    fn new() -> Self {
        Self {
            keys: HashSet::new(),
            complete: true,
            unresolved_count: 0,
        }
    }

    fn collect(&mut self, app_data_dir: &Path, value: Option<&String>) {
        let Some(path) = value else {
            return;
        };
        match resolve_local_asset_path(app_data_dir, path) {
            LocalAssetPathResolution::Path(path) => {
                self.keys.insert(path_identity_key(&path));
            }
            LocalAssetPathResolution::Unresolved => {
                self.complete = false;
                self.unresolved_count += 1;
            }
            LocalAssetPathResolution::Ignored => {}
        }
    }
}

fn warn_unresolved_asset_references(app_data_dir: &Path, data: &AppStoreData) {
    for (category, count) in [
        (
            "fonts",
            collect_local_font_paths(app_data_dir, data).unresolved_count,
        ),
        (
            "images",
            collect_local_image_paths(app_data_dir, data).unresolved_count,
        ),
        (
            "sounds",
            collect_local_sound_paths(app_data_dir, data).unresolved_count,
        ),
    ] {
        if count > 0 {
            log::warn!("[Assets] {category} sweep 보류: 해석 불가 참조 {count}건");
        }
    }
}

fn collect_local_font_paths(app_data_dir: &Path, data: &AppStoreData) -> AssetReferencePaths {
    let mut paths = AssetReferencePaths::new();

    for font in data
        .font_settings
        .custom_fonts
        .iter()
        .filter(|font| font.font_type == FontType::Local)
    {
        paths.collect(app_data_dir, font.local_path.as_ref());
    }

    paths
}

fn collect_local_image_paths(app_data_dir: &Path, data: &AppStoreData) -> AssetReferencePaths {
    let mut paths = AssetReferencePaths::new();

    for position in iter_all_positions(data) {
        paths.collect(app_data_dir, position.active_image.as_ref());
        paths.collect(app_data_dir, position.inactive_image.as_ref());
    }

    paths
}

#[cfg(test)]
fn collect_local_image_path_keys(app_data_dir: &Path, data: &AppStoreData) -> HashSet<String> {
    collect_local_image_paths(app_data_dir, data).keys
}

fn collect_local_sound_paths(app_data_dir: &Path, data: &AppStoreData) -> AssetReferencePaths {
    let mut paths = AssetReferencePaths::new();

    for position in iter_all_positions(data) {
        paths.collect(app_data_dir, position.sound_path.as_ref());
    }

    // 사운드 라이브러리에 등록된 파일도 보호 (키에 할당 안 되어도 유지)
    for key in data.sound_library.keys() {
        paths.collect(app_data_dir, Some(key));
    }

    paths
}

#[cfg(test)]
fn collect_local_sound_path_keys(app_data_dir: &Path, data: &AppStoreData) -> HashSet<String> {
    collect_local_sound_paths(app_data_dir, data).keys
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

enum LocalAssetPathResolution {
    Path(PathBuf),
    Unresolved,
    Ignored,
}

fn resolve_local_asset_path(app_data_dir: &Path, path: &str) -> LocalAssetPathResolution {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return LocalAssetPathResolution::Ignored;
    }

    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("data:")
        || lower.starts_with("blob:")
        || lower.starts_with("asset:")
        || lower.starts_with("tauri:")
    {
        return LocalAssetPathResolution::Ignored;
    }

    match file_url_to_path(trimmed) {
        FileUrlPath::Path(path) => classify_absolute_asset_path(app_data_dir, trimmed, path),
        FileUrlPath::Invalid => LocalAssetPathResolution::Unresolved,
        FileUrlPath::NotFileUrl => {
            let path = PathBuf::from(trimmed);
            if path.is_absolute() {
                classify_absolute_asset_path(app_data_dir, trimmed, path)
            } else if looks_like_unresolved_local_path(trimmed) {
                LocalAssetPathResolution::Unresolved
            } else {
                LocalAssetPathResolution::Ignored
            }
        }
    }
}

// 실존하지 않는 외래 참조는 해석 실패로 취급, sweep 보류 fail-safe 유도
fn classify_absolute_asset_path(
    app_data_dir: &Path,
    raw: &str,
    path: PathBuf,
) -> LocalAssetPathResolution {
    if !path.exists() && is_foreign_portable_asset_reference(app_data_dir, raw) {
        return LocalAssetPathResolution::Unresolved;
    }
    LocalAssetPathResolution::Path(path)
}

fn looks_like_unresolved_local_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    let has_windows_drive = bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    has_windows_drive
        || value.starts_with('\\')
        || value.contains('/')
        || value.contains('\\')
        || Path::new(value).extension().is_some()
}

fn validate_pending_processed_wav_target(sounds_dir: &Path, value: &str) -> Result<PathBuf> {
    let target = PathBuf::from(value);
    if !target.is_absolute()
        || target
            .components()
            .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
    {
        return Err(anyhow!("invalid pending WAV path"));
    }

    let canonical_sounds_dir = fs::canonicalize(sounds_dir).with_context(|| {
        format!(
            "failed to resolve sound directory during WAV recovery at {}",
            sounds_dir.display()
        )
    })?;
    let boundary_path = (if target.exists() {
        fs::canonicalize(&target).map_err(anyhow::Error::from)
    } else {
        target
            .parent()
            .context("pending WAV path has no parent")
            .and_then(|parent| fs::canonicalize(parent).map_err(anyhow::Error::from))
    })
    .with_context(|| {
        format!(
            "failed to resolve pending WAV boundary at {}",
            target.display()
        )
    })?;

    if !boundary_path.starts_with(&canonical_sounds_dir) {
        return Err(anyhow!("pending WAV path escapes the sound directory"));
    }
    Ok(target)
}

fn processed_wav_backup_path(path: &Path) -> Result<PathBuf> {
    let mut file_name = path
        .file_name()
        .context("pending WAV path has no file name")?
        .to_os_string();
    file_name.push(".bak");
    Ok(path.with_file_name(file_name))
}

fn interrupted_wav_path(path: &Path) -> PathBuf {
    let mut file_name = path.file_name().unwrap_or_default().to_os_string();
    file_name.push(format!(".interrupted-{}", uuid::Uuid::new_v4()));
    path.with_file_name(file_name)
}

fn rollback_pending_processed_wav(
    target_path: &Path,
    had_original: bool,
    target_exists: bool,
    backup_exists: bool,
) -> Result<()> {
    let backup_path = processed_wav_backup_path(target_path)?;
    if !had_original {
        if target_exists {
            let interrupted_path = interrupted_wav_path(target_path);
            fs::rename(target_path, &interrupted_path).with_context(|| {
                format!(
                    "failed to quarantine uncommitted WAV '{}' at '{}'",
                    target_path.display(),
                    interrupted_path.display()
                )
            })?;
        }
        return Ok(());
    }

    if !backup_exists {
        if target_exists {
            return Ok(());
        }
        return Err(anyhow!(
            "both the original WAV and its backup are missing during recovery"
        ));
    }

    if !target_exists {
        fs::rename(&backup_path, target_path).with_context(|| {
            format!(
                "failed to restore WAV backup '{}' to '{}'",
                backup_path.display(),
                target_path.display()
            )
        })?;
        return Ok(());
    }

    let interrupted_path = interrupted_wav_path(target_path);
    fs::rename(target_path, &interrupted_path).with_context(|| {
        format!(
            "failed to move uncommitted WAV '{}' to '{}'",
            target_path.display(),
            interrupted_path.display()
        )
    })?;
    if let Err(error) = fs::rename(&backup_path, target_path) {
        return match fs::rename(&interrupted_path, target_path) {
            Ok(()) => Err(error).with_context(|| {
                format!(
                    "failed to restore WAV backup '{}' to '{}'",
                    backup_path.display(),
                    target_path.display()
                )
            }),
            Err(recovery_error) => Err(anyhow!(
                "failed to restore WAV backup: {error}; failed to put uncommitted WAV back: {recovery_error}"
            )),
        };
    }
    Ok(())
}

fn recover_interrupted_processed_wav_replacements(
    sounds_dir: &Path,
) -> Result<SoundRecoveryOutcome> {
    recover_interrupted_processed_wav_replacements_with(sounds_dir, |from, to| fs::rename(from, to))
}

fn recover_interrupted_processed_wav_replacements_with<Rename>(
    sounds_dir: &Path,
    mut rename: Rename,
) -> Result<SoundRecoveryOutcome>
where
    Rename: FnMut(&Path, &Path) -> std::io::Result<()>,
{
    let mut outcome = SoundRecoveryOutcome::complete();
    if !sounds_dir.exists() {
        return Ok(outcome);
    }

    let read_dir = fs::read_dir(sounds_dir).with_context(|| {
        format!(
            "failed to read sound directory for recovery at {}",
            sounds_dir.display()
        )
    })?;

    for entry in read_dir {
        let entry = match entry {
            Ok(entry) => entry,
            Err(err) => {
                outcome.complete = false;
                log::warn!(
                    "[Sounds] Failed to read an entry from '{}' during recovery: {err}",
                    sounds_dir.display()
                );
                continue;
            }
        };
        let backup_path = entry.path();
        let is_file = match entry.file_type() {
            Ok(file_type) => file_type.is_file(),
            Err(err) => {
                outcome.complete = false;
                log::warn!(
                    "[Sounds] Failed to inspect '{}' during recovery: {err}",
                    backup_path.display()
                );
                continue;
            }
        };
        if !is_file || !backup_path.starts_with(sounds_dir) {
            continue;
        }

        let Some(file_name) = backup_path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let Some(target_name) = file_name.strip_suffix(".bak") else {
            continue;
        };
        let target_path = backup_path.with_file_name(target_name);
        if !target_path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("wav"))
        {
            continue;
        }

        match target_path.try_exists() {
            Ok(true) => continue,
            Ok(false) => {}
            Err(err) => {
                outcome.complete = false;
                outcome
                    .protected_keys
                    .insert(path_identity_key(&backup_path));
                log::warn!(
                    "[Sounds] Failed to inspect processed WAV target '{}': {err}",
                    target_path.display()
                );
                continue;
            }
        }

        if let Err(err) = rename(&backup_path, &target_path) {
            outcome.complete = false;
            outcome
                .protected_keys
                .insert(path_identity_key(&backup_path));
            log::warn!(
                "[Sounds] Failed to recover processed WAV '{}' from '{}': {err}",
                target_path.display(),
                backup_path.display()
            );
            continue;
        }
        log::info!(
            "[Sounds] Recovered processed WAV '{}'",
            target_path.display()
        );
    }

    Ok(outcome)
}

struct TrashSession {
    trash_dir: PathBuf,
    timestamp_millis: u128,
    next_suffix: u64,
    session_dir: Option<PathBuf>,
}

impl TrashSession {
    fn new(trash_dir: PathBuf, now: SystemTime) -> Result<Self> {
        Ok(Self {
            trash_dir,
            timestamp_millis: system_time_millis(now)?,
            next_suffix: 0,
            session_dir: None,
        })
    }

    fn destination_path(&mut self, source_dir: &Path, source_path: &Path) -> Result<PathBuf> {
        let category = source_dir.file_name().with_context(|| {
            format!(
                "failed to resolve asset category from {}",
                source_dir.display()
            )
        })?;
        let file_name = source_path.file_name().with_context(|| {
            format!(
                "failed to resolve asset file name from {}",
                source_path.display()
            )
        })?;

        loop {
            let session_dir = self.ensure_session_dir()?;
            let category_dir = session_dir.join(category);
            fs::create_dir_all(&category_dir).with_context(|| {
                format!(
                    "failed to create trash category directory at {}",
                    category_dir.display()
                )
            })?;
            let destination = category_dir.join(file_name);
            if !destination.exists() {
                return Ok(destination);
            }

            self.session_dir = None;
        }
    }

    fn ensure_session_dir(&mut self) -> Result<PathBuf> {
        if let Some(path) = self.session_dir.as_ref() {
            return Ok(path.clone());
        }

        fs::create_dir_all(&self.trash_dir).with_context(|| {
            format!(
                "failed to create asset trash directory at {}",
                self.trash_dir.display()
            )
        })?;

        loop {
            let suffix = self.next_suffix;
            self.next_suffix = self
                .next_suffix
                .checked_add(1)
                .context("asset trash session suffix overflow")?;
            let name = if suffix == 0 {
                self.timestamp_millis.to_string()
            } else {
                format!("{}-{suffix}", self.timestamp_millis)
            };
            let candidate = self.trash_dir.join(name);
            match fs::create_dir(&candidate) {
                Ok(()) => {
                    self.session_dir = Some(candidate.clone());
                    return Ok(candidate);
                }
                Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(err) => {
                    return Err(err).with_context(|| {
                        format!(
                            "failed to create asset trash session at {}",
                            candidate.display()
                        )
                    });
                }
            }
        }
    }
}

pub(crate) fn stage_sound_files_for_deletion(
    source_paths: &[PathBuf],
) -> Result<Vec<StagedSoundDeletionFile>> {
    let mut staged = Vec::new();
    let mut seen = HashSet::new();

    for source_path in source_paths {
        let key = path_identity_key(source_path);
        if !seen.insert(key) {
            continue;
        }
        match source_path.try_exists() {
            Ok(false) => continue,
            Ok(true) if !source_path.is_file() => {
                let error = anyhow!(
                    "sound deletion target is not a file at {}",
                    source_path.display()
                );
                return rollback_staged_after_error(staged, error);
            }
            Ok(true) => {}
            Err(error) => {
                return rollback_staged_after_error(
                    staged,
                    anyhow!(
                        "failed to inspect sound deletion target at {}: {error}",
                        source_path.display()
                    ),
                );
            }
        }

        let backup_path = match sound_delete_backup_path(source_path) {
            Ok(path) => path,
            Err(error) => return rollback_staged_after_error(staged, error),
        };
        if let Err(error) = fs::rename(source_path, &backup_path) {
            return rollback_staged_after_error(
                staged,
                anyhow!(
                    "failed to stage sound deletion '{}' -> '{}': {error}",
                    source_path.display(),
                    backup_path.display()
                ),
            );
        }
        staged.push(StagedSoundDeletionFile {
            source_path: source_path.clone(),
            backup_path,
        });
    }

    Ok(staged)
}

pub(crate) fn restore_staged_sound_deletions(staged: &[StagedSoundDeletionFile]) -> Result<()> {
    let mut failures = Vec::new();
    for file in staged.iter().rev() {
        match file.backup_path.try_exists() {
            Ok(false) => continue,
            Ok(true) => {}
            Err(error) => {
                failures.push(format!(
                    "failed to inspect staged backup '{}': {error}",
                    file.backup_path.display()
                ));
                continue;
            }
        }
        match file.source_path.try_exists() {
            Ok(true) => {
                failures.push(format!(
                    "source path already exists at {}",
                    file.source_path.display()
                ));
                continue;
            }
            Ok(false) => {}
            Err(error) => {
                failures.push(format!(
                    "failed to inspect source path '{}': {error}",
                    file.source_path.display()
                ));
                continue;
            }
        }
        if let Err(error) = fs::rename(&file.backup_path, &file.source_path) {
            failures.push(format!(
                "'{}' -> '{}': {error}",
                file.backup_path.display(),
                file.source_path.display()
            ));
        }
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(anyhow!(
            "failed to restore staged sound deletion: {}",
            failures.join("; ")
        ))
    }
}

pub(crate) fn move_staged_sound_deletions_to_trash(
    staged: &[StagedSoundDeletionFile],
    trash_dir: &Path,
) -> Result<()> {
    let mut trash_session = TrashSession::new(trash_dir.to_path_buf(), SystemTime::now())?;
    let mut failures = Vec::new();

    for file in staged {
        match file.backup_path.try_exists() {
            Ok(false) => continue,
            Ok(true) => {}
            Err(error) => {
                failures.push(format!(
                    "failed to inspect staged backup '{}': {error}",
                    file.backup_path.display()
                ));
                continue;
            }
        }
        let Some(source_dir) = file.source_path.parent() else {
            failures.push(format!(
                "missing source directory for {}",
                file.source_path.display()
            ));
            continue;
        };
        let destination = match trash_session.destination_path(source_dir, &file.source_path) {
            Ok(destination) => destination,
            Err(error) => {
                failures.push(format!("{}: {error:#}", file.backup_path.display()));
                continue;
            }
        };
        if let Err(error) = fs::rename(&file.backup_path, &destination) {
            failures.push(format!(
                "'{}' -> '{}': {error}",
                file.backup_path.display(),
                destination.display()
            ));
        }
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(anyhow!(
            "failed to move staged sound deletion to trash: {}",
            failures.join("; ")
        ))
    }
}

fn rollback_staged_after_error<T>(
    staged: Vec<StagedSoundDeletionFile>,
    primary: anyhow::Error,
) -> Result<T> {
    match restore_staged_sound_deletions(&staged) {
        Ok(()) => Err(primary),
        Err(rollback) => Err(anyhow!("{primary:#}; {rollback:#}")),
    }
}

fn sound_delete_backup_path(source_path: &Path) -> Result<PathBuf> {
    let file_name = source_path.file_name().with_context(|| {
        format!(
            "failed to resolve sound deletion file name from {}",
            source_path.display()
        )
    })?;
    let mut backup_name = file_name.to_os_string();
    backup_name.push(SOUND_DELETE_BACKUP_MARKER);
    backup_name.push(uuid::Uuid::new_v4().to_string());
    Ok(source_path.with_file_name(backup_name))
}

fn sound_delete_source_path(backup_path: &Path) -> Option<PathBuf> {
    let file_name = backup_path.file_name()?.to_str()?;
    let (source_name, suffix) = file_name.rsplit_once(SOUND_DELETE_BACKUP_MARKER)?;
    uuid::Uuid::parse_str(suffix).ok()?;
    (!source_name.is_empty()).then(|| backup_path.with_file_name(source_name))
}

fn recover_interrupted_sound_deletions(
    data: &AppStoreData,
    sounds_dir: &Path,
    trash_dir: &Path,
) -> Result<SoundRecoveryOutcome> {
    recover_interrupted_sound_deletions_with(data, sounds_dir, trash_dir, |from, to| {
        fs::rename(from, to)
    })
}

fn recover_interrupted_sound_deletions_with<Rename>(
    data: &AppStoreData,
    sounds_dir: &Path,
    trash_dir: &Path,
    mut rename: Rename,
) -> Result<SoundRecoveryOutcome>
where
    Rename: FnMut(&Path, &Path) -> std::io::Result<()>,
{
    let mut backups = Vec::new();
    collect_sound_delete_backups(sounds_dir, &mut backups)?;
    let mut outcome = SoundRecoveryOutcome::complete();
    if backups.is_empty() {
        return Ok(outcome);
    }

    let referenced_keys = collect_sound_deletion_reference_keys(data, sounds_dir);
    let mut trash_session = TrashSession::new(trash_dir.to_path_buf(), SystemTime::now())?;

    for backup_path in backups {
        let Some(source_path) = sound_delete_source_path(&backup_path) else {
            continue;
        };
        let referenced = referenced_keys.contains(&path_identity_key(&source_path));
        let source_exists = match source_path.try_exists() {
            Ok(exists) => exists,
            Err(error) => {
                outcome.complete = false;
                outcome
                    .protected_keys
                    .insert(path_identity_key(&backup_path));
                log::warn!(
                    "[Sounds] Failed to inspect interrupted deletion source '{}': {error}",
                    source_path.display()
                );
                continue;
            }
        };
        if referenced && !source_exists {
            if let Err(error) = rename(&backup_path, &source_path) {
                outcome.complete = false;
                outcome
                    .protected_keys
                    .insert(path_identity_key(&backup_path));
                log::warn!(
                    "[Sounds] Failed to restore interrupted deletion '{}' -> '{}': {error}",
                    backup_path.display(),
                    source_path.display()
                );
            } else {
                log::info!(
                    "[Sounds] Restored interrupted deletion '{}'",
                    source_path.display()
                );
            }
            continue;
        }

        let Some(source_dir) = source_path.parent() else {
            continue;
        };
        let destination = match trash_session.destination_path(source_dir, &source_path) {
            Ok(destination) => destination,
            Err(error) => {
                log::warn!(
                    "[Sounds] Failed to prepare interrupted deletion trash for '{}': {error:#}",
                    backup_path.display()
                );
                continue;
            }
        };
        if let Err(error) = rename(&backup_path, &destination) {
            log::warn!(
                "[Sounds] Failed to finish interrupted deletion '{}' -> '{}': {error}",
                backup_path.display(),
                destination.display()
            );
        }
    }

    Ok(outcome)
}

fn collect_sound_delete_backups(directory: &Path, backups: &mut Vec<PathBuf>) -> Result<()> {
    if !directory.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(directory)
        .with_context(|| format!("failed to scan sound directory at {}", directory.display()))?
    {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            collect_sound_delete_backups(&entry.path(), backups)?;
        } else if file_type.is_file() && sound_delete_source_path(&entry.path()).is_some() {
            backups.push(entry.path());
        }
    }
    Ok(())
}

fn collect_sound_deletion_reference_keys(
    data: &AppStoreData,
    sounds_dir: &Path,
) -> HashSet<String> {
    // sounds_dir는 항상 <appData>/sounds, 분류 루트는 부모로 유도
    let app_data_dir = sounds_dir.parent().unwrap_or(sounds_dir);
    let mut keys = collect_local_sound_paths(app_data_dir, data).keys;
    for entry in data.sound_library.values() {
        let Some(original_path) = entry.original_path.as_deref() else {
            continue;
        };
        let relative = Path::new(original_path);
        if relative.is_absolute()
            || relative
                .components()
                .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
        {
            continue;
        }
        keys.insert(path_identity_key(&sounds_dir.join(relative)));
    }
    keys
}

fn system_time_millis(time: SystemTime) -> Result<u128> {
    time.duration_since(UNIX_EPOCH)
        .context("system time is before the Unix epoch")
        .map(|duration| duration.as_millis())
}

fn purge_expired_trash_sessions(trash_dir: &Path) -> Result<()> {
    purge_expired_trash_sessions_at(trash_dir, SystemTime::now())
}

fn purge_expired_trash_sessions_at(trash_dir: &Path, now: SystemTime) -> Result<()> {
    if !trash_dir.exists() {
        return Ok(());
    }

    let now_millis = system_time_millis(now)?;
    let retention_millis = TRASH_RETENTION.as_millis();
    let read_dir = fs::read_dir(trash_dir).with_context(|| {
        format!(
            "failed to read asset trash directory at {}",
            trash_dir.display()
        )
    })?;

    for entry in read_dir {
        let entry = match entry {
            Ok(entry) => entry,
            Err(err) => {
                log::warn!(
                    "[Assets] Failed to read an entry from trash '{}': {err}",
                    trash_dir.display()
                );
                continue;
            }
        };
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(err) => {
                log::warn!(
                    "[Assets] Failed to inspect trash entry '{}': {err}",
                    entry.path().display()
                );
                continue;
            }
        };
        if !file_type.is_dir() {
            continue;
        }

        let Some(timestamp_millis) = entry
            .file_name()
            .to_str()
            .and_then(parse_trash_session_timestamp)
        else {
            continue;
        };
        if now_millis.saturating_sub(timestamp_millis) <= retention_millis {
            continue;
        }

        let path = entry.path();
        if let Err(err) = fs::remove_dir_all(&path) {
            log::warn!(
                "[Assets] Failed to purge expired trash session '{}': {err}",
                path.display()
            );
        } else {
            log::info!("[Assets] Purged expired trash session '{}'", path.display());
        }
    }

    Ok(())
}

fn parse_trash_session_timestamp(name: &str) -> Option<u128> {
    let mut parts = name.split('-');
    let timestamp = parts.next()?.parse().ok()?;
    match (parts.next(), parts.next()) {
        (None, None) => {}
        (Some(suffix), None) if suffix.parse::<u64>().is_ok() => {}
        _ => return None,
    }
    Some(timestamp)
}

fn is_temporary_asset_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("tmp"))
}

fn sweep_unreferenced_asset_files(
    log_prefix: &str,
    target_dir: &Path,
    referenced_path_keys: &HashSet<String>,
    trash_session: &mut TrashSession,
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
        let key = path_identity_key(&path);
        if referenced_path_keys.contains(&key) {
            continue;
        }

        if is_temporary_asset_file(&path) {
            if let Err(err) = fs::remove_file(&path) {
                log::warn!(
                    "[{log_prefix}] Failed to remove temporary asset '{}': {err}",
                    path.display()
                );
            } else {
                log::info!(
                    "[{log_prefix}] Removed temporary asset '{}'",
                    path.display()
                );
            }
            continue;
        }

        let destination = match trash_session.destination_path(target_dir, &path) {
            Ok(destination) => destination,
            Err(err) => {
                log::warn!(
                    "[{log_prefix}] Failed to prepare trash destination for '{}': {err:#}",
                    path.display()
                );
                continue;
            }
        };
        if let Err(err) = fs::rename(&path, &destination) {
            log::warn!(
                "[{log_prefix}] Failed to move stale asset '{}' to '{}': {err}",
                path.display(),
                destination.display()
            );
        } else {
            log::info!(
                "[{log_prefix}] Moved stale asset '{}' to trash at '{}'",
                path.display(),
                destination.display()
            );
        }
    }

    Ok(())
}

#[cfg(test)]
mod gradient_real_data_simulation;

#[cfg(test)]
mod tests {
    use super::{
        collect_local_font_paths, collect_local_image_path_keys, collect_local_image_paths,
        collect_local_sound_path_keys, collect_local_sound_paths, purge_expired_trash_sessions_at,
        recover_interrupted_processed_wav_replacements_with,
        recover_interrupted_sound_deletions_with, stage_sound_files_for_deletion,
        sweep_unreferenced_asset_files, system_time_millis, AppStore, HistoryAuxChange,
        TrashSession, PROCESSED_WAV_TRANSACTION_LOCK, TRASH_RETENTION,
    };
    use crate::{
        custom_css::ValidatedCssFile,
        defaults::default_positions,
        errors::{EditorCommitError, EditorCommitErrorCode},
        keyboard::KeyboardManager,
        models::{
            AppStoreData, CommittedEditorChange, CustomCss, CustomFont, CustomTab,
            EditorCommitOrigin, EditorCommitRequest, EditorDocumentV1, EditorField, EditorPatchV1,
            FontSettings, FontType, GestureCommitRequest, GesturePluginInstancesChange,
            GraphPosition, GraphStatType, GraphType, JsPlugin, KeyCounters, KeyPosition, KeySlot,
            KnobPosition, OverlayBounds, PanelBounds, PendingProcessedWavReplacement,
            PluginInstancesCommitRequest, PluginInstancesReconcileRequest, PluginPoint,
            SavedPluginInstance, SettingsPatchInput, SlotMatch, SoundLibraryEntry, SoundSource,
            StatPosition, StatType, TabCss, TabNoteSettings,
        },
        services::{css_watcher::commit_css_reload, settings::apply_patch_to_store},
        state::{
            app_state::KeyCounterEventEmitter,
            history::{
                HistoryDirection, HistoryScope, PresetFullHistorySnapshot, HISTORY_ENTRY_TOO_LARGE,
                HISTORY_IN_PROGRESS,
            },
            local_asset_path::path_identity_key,
            AppState,
        },
    };
    use serde_json::{json, Value};
    use std::{
        collections::{HashMap, HashSet},
        path::Path,
        sync::{
            atomic::{AtomicBool, Ordering},
            mpsc, Arc, Barrier, Mutex,
        },
        thread,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };

    fn test_directory(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("dmnote-{label}-{}", uuid::Uuid::new_v4()))
    }

    struct TestCounterEmitter {
        events: Arc<Mutex<Vec<String>>>,
        mode: String,
        key: String,
        snapshot_emitted: Option<mpsc::Sender<()>>,
        release_snapshot: Option<Mutex<mpsc::Receiver<()>>>,
    }

    impl TestCounterEmitter {
        fn new(events: Arc<Mutex<Vec<String>>>, mode: String, key: String) -> Self {
            Self {
                events,
                mode,
                key,
                snapshot_emitted: None,
                release_snapshot: None,
            }
        }

        fn blocking_snapshot(
            events: Arc<Mutex<Vec<String>>>,
            mode: String,
            key: String,
            snapshot_emitted: mpsc::Sender<()>,
            release_snapshot: mpsc::Receiver<()>,
        ) -> Self {
            Self {
                events,
                mode,
                key,
                snapshot_emitted: Some(snapshot_emitted),
                release_snapshot: Some(Mutex::new(release_snapshot)),
            }
        }
    }

    impl KeyCounterEventEmitter for TestCounterEmitter {
        fn emit_key_counters(
            &self,
            counters: &KeyCounters,
            _session_id: &str,
            _revision: u64,
        ) -> anyhow::Result<()> {
            let count = counters[&self.mode][&self.key];
            self.events
                .lock()
                .unwrap()
                .push(format!("snapshot:{count}"));
            if let Some(snapshot_emitted) = &self.snapshot_emitted {
                snapshot_emitted.send(()).unwrap();
            }
            if let Some(release_snapshot) = &self.release_snapshot {
                release_snapshot.lock().unwrap().recv().unwrap();
            }
            Ok(())
        }

        fn emit_key_counter(
            &self,
            _mode: &str,
            _key: &str,
            count: u32,
            _session_id: &str,
            _revision: u64,
        ) -> anyhow::Result<()> {
            self.events.lock().unwrap().push(format!("counter:{count}"));
            Ok(())
        }
    }

    fn editor_request(
        base_revision: u64,
        mutation_id: impl Into<String>,
        changes: EditorPatchV1,
    ) -> EditorCommitRequest {
        EditorCommitRequest {
            base_revision,
            mutation_id: mutation_id.into(),
            multi_key: false,
            gesture_id: None,
            gesture_ids: Vec::new(),
            changes,
        }
    }

    fn position_patch(store: &AppStore, dx: f64) -> EditorPatchV1 {
        let mut positions = store.editor_get().document.key_positions;
        positions.get_mut("4key").unwrap()[0].dx = dx;
        EditorPatchV1 {
            key_positions: Some(positions),
            ..EditorPatchV1::default()
        }
    }

    fn saved_plugin_instance(x: f64) -> SavedPluginInstance {
        SavedPluginInstance {
            position: PluginPoint { x, y: 20.0 },
            settings: None,
            measured_size: None,
            tab_id: Some("4key".to_string()),
            hidden: false,
            z_index: None,
        }
    }

    fn plugin_instances_request(
        plugin_id: &str,
        instances: Vec<SavedPluginInstance>,
        mutation_id: String,
        gesture_id: Option<String>,
        expected_model_revision: Option<u64>,
    ) -> PluginInstancesCommitRequest {
        PluginInstancesCommitRequest {
            plugin_id: plugin_id.to_string(),
            instances,
            mutation_id,
            gesture_id,
            observed_history_epoch: None,
            expected_model_revision,
            authority_generation: 1,
        }
    }

    fn plugin_instances_reconcile_request(
        plugin_id: &str,
        valid_tab_ids: &[&str],
        mutation_id: String,
    ) -> PluginInstancesReconcileRequest {
        PluginInstancesReconcileRequest {
            plugin_id: plugin_id.to_string(),
            valid_tab_ids: valid_tab_ids
                .iter()
                .map(|tab_id| (*tab_id).to_string())
                .collect(),
            mutation_id,
            observed_history_epoch: None,
            authority_generation: 1,
        }
    }

    fn gesture_request(
        store: &AppStore,
        gesture_id: String,
        editor_changes: EditorPatchV1,
        plugin_id: &str,
        instances: Vec<SavedPluginInstance>,
    ) -> GestureCommitRequest {
        GestureCommitRequest {
            gesture_id,
            mutation_id: uuid::Uuid::new_v4().to_string(),
            editor_base_revision: store.editor_get().revision,
            plugin_base_revision: store.plugin_model_revision(),
            observed_history_epoch: Some(store.state.read().history.history_epoch()),
            authority_generation: 1,
            editor_changes: Some(editor_changes),
            plugin_changes: vec![GesturePluginInstancesChange {
                plugin_id: plugin_id.to_string(),
                instances,
            }],
        }
    }

    fn legacy_editor_commit(
        store: &AppStore,
        fields: &[EditorField],
        updater: impl FnOnce(&mut AppStoreData),
    ) -> std::result::Result<CommittedEditorChange, EditorCommitError> {
        store
            .commit_legacy_editor_transaction(
                EditorCommitOrigin::LegacyAdapter("test_adapter".to_string()),
                fields,
                |data| {
                    updater(data);
                    Ok(())
                },
            )
            .map(|transaction| transaction.change)
    }

    #[test]
    fn plugin_instances_commit_records_merges_and_skips_noop() {
        let dir = test_directory("plugin-instances-commit-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial_revision = store.plugin_model_revision();
        let gesture_id = uuid::Uuid::new_v4().to_string();

        let first_request = plugin_instances_request(
            "demo-plugin",
            vec![saved_plugin_instance(10.0)],
            uuid::Uuid::new_v4().to_string(),
            Some(gesture_id.clone()),
            Some(initial_revision),
        );
        let first = store.commit_plugin_instances(first_request).unwrap();
        let first_revision = first.outcome.model_revision;
        assert!(first.outcome.changed);
        assert_eq!(
            first
                .outcome
                .history_status
                .as_ref()
                .unwrap()
                .history_revision,
            1
        );
        drop(first);

        let second_request = plugin_instances_request(
            "demo-plugin",
            vec![saved_plugin_instance(30.0)],
            uuid::Uuid::new_v4().to_string(),
            Some(gesture_id),
            Some(first_revision),
        );
        let second = store.commit_plugin_instances(second_request).unwrap();
        let second_revision = second.outcome.model_revision;
        assert_eq!(
            second
                .outcome
                .history_status
                .as_ref()
                .unwrap()
                .history_revision,
            1
        );
        drop(second);

        let noop = store
            .commit_plugin_instances(plugin_instances_request(
                "demo-plugin",
                vec![saved_plugin_instance(30.0)],
                uuid::Uuid::new_v4().to_string(),
                None,
                Some(second_revision),
            ))
            .unwrap();
        assert!(!noop.outcome.changed);
        assert!(noop.outcome.history_status.is_none());
        drop(noop);

        let (instances, revision) = store.plugin_instances_get("demo-plugin").unwrap();
        assert_eq!(instances, vec![saved_plugin_instance(30.0)]);
        assert_eq!(revision, second_revision);
        assert_eq!(store.history_status().history_revision, 1);

        let gate = store.history_gate();
        let counters = store.snapshot().key_counters;
        let undo_id = uuid::Uuid::new_v4().to_string();
        let undo_barrier = gate.close(&undo_id).unwrap();
        let undo = store
            .apply_history_operation(HistoryDirection::Undo, &undo_id, &counters, || {})
            .unwrap();
        assert!(store
            .plugin_instances_get("demo-plugin")
            .unwrap()
            .0
            .is_empty());
        assert!(undo.status.can_redo);
        drop(undo_barrier);

        let redo_id = uuid::Uuid::new_v4().to_string();
        let redo_barrier = gate.close(&redo_id).unwrap();
        let redo = store
            .apply_history_operation(HistoryDirection::Redo, &redo_id, &counters, || {})
            .unwrap();
        assert_eq!(
            store.plugin_instances_get("demo-plugin").unwrap().0,
            vec![saved_plugin_instance(30.0)]
        );
        assert!(redo.status.can_undo);
        drop(redo_barrier);

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn plugin_instance_visibility_and_z_index_survive_restart() {
        let dir = test_directory("plugin-instance-layout-restart-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let mut expected = saved_plugin_instance(15.0);
        expected.hidden = true;
        expected.z_index = Some(-12.0);
        let committed = store
            .commit_plugin_instances(plugin_instances_request(
                "demo-plugin",
                vec![expected.clone()],
                uuid::Uuid::new_v4().to_string(),
                None,
                Some(store.plugin_model_revision()),
            ))
            .unwrap();
        drop(committed);
        store.flush_and_shutdown().unwrap();
        drop(store);

        let restored = AppStore::initialize_in_dir(&dir).unwrap();
        assert_eq!(
            restored.plugin_instances_get("demo-plugin").unwrap().0,
            vec![expected]
        );

        restored.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn plugin_instances_history_budget_truncates_after_successful_commit() {
        let dir = test_directory("plugin-instances-budget-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        store
            .state
            .write()
            .history
            .set_limits_for_test(1, 32 * 1024 * 1024, 50);
        let expected_revision = store.plugin_model_revision();

        let committed = store
            .commit_plugin_instances(plugin_instances_request(
                "demo-plugin",
                vec![saved_plugin_instance(10.0)],
                uuid::Uuid::new_v4().to_string(),
                None,
                Some(expected_revision),
            ))
            .unwrap();
        let status = committed.outcome.history_status.as_ref().unwrap();
        assert!(committed.outcome.changed);
        assert!(!status.can_undo);
        assert!(!status.can_redo);
        assert_eq!(
            status.truncated.as_ref().unwrap().reason,
            HISTORY_ENTRY_TOO_LARGE
        );
        drop(committed);
        assert_eq!(
            store.plugin_instances_get("demo-plugin").unwrap().0,
            vec![saved_plugin_instance(10.0)]
        );

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn plugin_instances_undo_redo_restore_backend_without_runtime_projection() {
        let dir = test_directory("plugin-instances-history-restore-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let expected_revision = store.plugin_model_revision();
        let committed = store
            .commit_plugin_instances(plugin_instances_request(
                "demo-plugin",
                vec![saved_plugin_instance(42.0)],
                uuid::Uuid::new_v4().to_string(),
                None,
                Some(expected_revision),
            ))
            .unwrap();
        drop(committed);

        let gate = store.history_gate();
        let undo_id = uuid::Uuid::new_v4().to_string();
        let undo_barrier = gate.close(&undo_id).unwrap();
        let counters = store.snapshot().key_counters;
        let undo = store
            .apply_history_operation(HistoryDirection::Undo, &undo_id, &counters, || {})
            .unwrap();
        let Some(HistoryAuxChange::PluginElements {
            plugin_id,
            revision: undo_revision,
        }) = undo.aux_change
        else {
            panic!("plugin undo must expose its projection payload");
        };
        assert_eq!(plugin_id, "demo-plugin");
        assert_eq!(undo_revision, store.plugin_model_revision());
        assert!(store
            .plugin_instances_get("demo-plugin")
            .unwrap()
            .0
            .is_empty());
        assert!(undo.status.can_redo);
        drop(undo_barrier);

        let redo_id = uuid::Uuid::new_v4().to_string();
        let redo_barrier = gate.close(&redo_id).unwrap();
        let redo = store
            .apply_history_operation(HistoryDirection::Redo, &redo_id, &counters, || {})
            .unwrap();
        assert_eq!(
            store.plugin_instances_get("demo-plugin").unwrap().0,
            vec![saved_plugin_instance(42.0)]
        );
        assert!(redo.status.can_undo);
        drop(redo_barrier);

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn mixed_editor_plugin_gesture_undoes_and_redoes_atomically() {
        let dir = test_directory("compound-editor-plugin-history-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial_x = store.editor_get().document.key_positions["4key"][0].dx;
        let gesture_id = uuid::Uuid::new_v4().to_string();

        let mut editor = editor_request(
            store.editor_get().revision,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, initial_x + 40.0),
        );
        editor.gesture_id = Some(gesture_id.clone());
        store.commit_editor_document(editor).unwrap();
        let plugin = store
            .commit_plugin_instances(plugin_instances_request(
                "demo-plugin",
                vec![saved_plugin_instance(42.0)],
                uuid::Uuid::new_v4().to_string(),
                Some(gesture_id.clone()),
                Some(store.plugin_model_revision()),
            ))
            .unwrap();
        let first_plugin_revision = plugin.outcome.model_revision;
        assert_eq!(
            plugin
                .outcome
                .history_status
                .as_ref()
                .unwrap()
                .history_revision,
            1
        );
        drop(plugin);
        let second_plugin = store
            .commit_plugin_instances(plugin_instances_request(
                "second-plugin",
                vec![saved_plugin_instance(84.0)],
                uuid::Uuid::new_v4().to_string(),
                Some(gesture_id),
                Some(first_plugin_revision),
            ))
            .unwrap();
        assert_eq!(
            second_plugin
                .outcome
                .history_status
                .as_ref()
                .unwrap()
                .history_revision,
            1
        );
        drop(second_plugin);

        let gate = store.history_gate();
        let counters = store.snapshot().key_counters;
        let undo_id = uuid::Uuid::new_v4().to_string();
        let undo_barrier = gate.close(&undo_id).unwrap();
        let undo = store
            .apply_history_operation(HistoryDirection::Undo, &undo_id, &counters, || {})
            .unwrap();
        assert_eq!(
            store.editor_get().document.key_positions["4key"][0].dx,
            initial_x
        );
        assert!(store
            .plugin_instances_get("demo-plugin")
            .unwrap()
            .0
            .is_empty());
        assert!(store
            .plugin_instances_get("second-plugin")
            .unwrap()
            .0
            .is_empty());
        assert!(!undo.status.can_undo);
        assert!(undo.status.can_redo);
        assert!(undo.change.is_some());
        assert!(matches!(
            undo.aux_change,
            Some(HistoryAuxChange::PluginElementsBatch { ref plugin_ids, .. })
                if plugin_ids == &["demo-plugin".to_string(), "second-plugin".to_string()]
        ));
        drop(undo_barrier);

        let redo_id = uuid::Uuid::new_v4().to_string();
        let redo_barrier = gate.close(&redo_id).unwrap();
        let redo = store
            .apply_history_operation(HistoryDirection::Redo, &redo_id, &counters, || {})
            .unwrap();
        assert_eq!(
            store.editor_get().document.key_positions["4key"][0].dx,
            initial_x + 40.0
        );
        assert_eq!(
            store.plugin_instances_get("demo-plugin").unwrap().0,
            vec![saved_plugin_instance(42.0)]
        );
        assert_eq!(
            store.plugin_instances_get("second-plugin").unwrap().0,
            vec![saved_plugin_instance(84.0)]
        );
        assert!(redo.status.can_undo);
        drop(redo_barrier);

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn gesture_transactions_keep_rejoined_actions_atomic_and_ordered() {
        let dir = test_directory("gesture-transaction-rejoined-actions-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial_x = store.editor_get().document.key_positions["4key"][0].dx;
        let persist_count = store.writer.persist_count();

        let first = store
            .commit_gesture(gesture_request(
                &store,
                uuid::Uuid::new_v4().to_string(),
                position_patch(&store, initial_x + 10.0),
                "demo-plugin",
                vec![saved_plugin_instance(10.0)],
            ))
            .unwrap();
        assert_eq!(first.outcome.result.editor_revision, 1);
        assert_eq!(first.outcome.result.plugin_model_revision, 1);
        drop(first);

        let second = store
            .commit_gesture(gesture_request(
                &store,
                uuid::Uuid::new_v4().to_string(),
                position_patch(&store, initial_x + 20.0),
                "demo-plugin",
                vec![saved_plugin_instance(20.0)],
            ))
            .unwrap();
        assert_eq!(second.outcome.result.editor_revision, 2);
        assert_eq!(second.outcome.result.plugin_model_revision, 2);
        assert_eq!(store.writer.persist_count(), persist_count + 2);
        assert_eq!(store.history_status().history_revision, 2);
        drop(second);

        let gate = store.history_gate();
        let counters = store.snapshot().key_counters;
        for (expected_editor_x, expected_plugin_x) in
            [(initial_x + 10.0, Some(10.0)), (initial_x, None)]
        {
            let operation_id = uuid::Uuid::new_v4().to_string();
            let barrier = gate.close(&operation_id).unwrap();
            store
                .apply_history_operation(HistoryDirection::Undo, &operation_id, &counters, || {})
                .unwrap();
            drop(barrier);
            assert_eq!(
                store.editor_get().document.key_positions["4key"][0].dx,
                expected_editor_x
            );
            let plugin = store.plugin_instances_get("demo-plugin").unwrap().0;
            assert_eq!(
                plugin.first().map(|instance| instance.position.x),
                expected_plugin_x
            );
        }

        for (expected_editor_x, expected_plugin_x) in
            [(initial_x + 10.0, 10.0), (initial_x + 20.0, 20.0)]
        {
            let operation_id = uuid::Uuid::new_v4().to_string();
            let barrier = gate.close(&operation_id).unwrap();
            store
                .apply_history_operation(HistoryDirection::Redo, &operation_id, &counters, || {})
                .unwrap();
            drop(barrier);
            assert_eq!(
                store.editor_get().document.key_positions["4key"][0].dx,
                expected_editor_x
            );
            assert_eq!(
                store.plugin_instances_get("demo-plugin").unwrap().0[0]
                    .position
                    .x,
                expected_plugin_x
            );
        }

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn gesture_plugin_validation_failure_leaves_editor_and_store_unchanged() {
        let dir = test_directory("gesture-transaction-validation-failure-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let before = store.snapshot();
        let before_plugin_revision = store.plugin_model_revision();
        let before_history_revision = store.history_status().history_revision;
        let persist_count = store.writer.persist_count();
        let mut invalid = saved_plugin_instance(10.0);
        invalid.position.x = f64::NAN;

        let error = store
            .commit_gesture(gesture_request(
                &store,
                uuid::Uuid::new_v4().to_string(),
                position_patch(&store, before.key_positions["4key"][0].dx + 25.0),
                "demo-plugin",
                vec![invalid],
            ))
            .unwrap_err();

        assert_eq!(error.error_code, EditorCommitErrorCode::ValidationFailed);
        assert_eq!(store.snapshot(), before);
        assert_eq!(store.plugin_model_revision(), before_plugin_revision);
        assert_eq!(
            store.history_status().history_revision,
            before_history_revision
        );
        assert_eq!(store.writer.persist_count(), persist_count);

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn gesture_persist_failure_does_not_publish_partial_state() {
        let dir = test_directory("gesture-transaction-persist-failure-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let before = store.snapshot();
        let before_plugin_revision = store.plugin_model_revision();
        let before_history_revision = store.history_status().history_revision;
        store.writer.fail_next_persist();

        let error = store
            .commit_gesture(gesture_request(
                &store,
                uuid::Uuid::new_v4().to_string(),
                position_patch(&store, before.key_positions["4key"][0].dx + 25.0),
                "demo-plugin",
                vec![saved_plugin_instance(25.0)],
            ))
            .unwrap_err();

        assert_eq!(error.error_code, EditorCommitErrorCode::IoError);
        assert_eq!(store.snapshot(), before);
        assert_eq!(store.plugin_model_revision(), before_plugin_revision);
        assert_eq!(
            store.history_status().history_revision,
            before_history_revision
        );

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn gesture_oversized_history_rejects_the_whole_transaction() {
        let dir = test_directory("gesture-transaction-history-size-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        store
            .state
            .write()
            .history
            .set_limits_for_test(1, 32 * 1024 * 1024, 50);
        let before = store.snapshot();
        let before_plugin_revision = store.plugin_model_revision();
        let before_history_revision = store.history_status().history_revision;
        let persist_count = store.writer.persist_count();

        let error = store
            .commit_gesture(gesture_request(
                &store,
                uuid::Uuid::new_v4().to_string(),
                position_patch(&store, before.key_positions["4key"][0].dx + 25.0),
                "demo-plugin",
                vec![saved_plugin_instance(25.0)],
            ))
            .unwrap_err();

        assert_eq!(error.error_code, EditorCommitErrorCode::ValidationFailed);
        assert_eq!(
            error.details.unwrap().validation_code.as_deref(),
            Some(HISTORY_ENTRY_TOO_LARGE)
        );
        assert_eq!(store.snapshot(), before);
        assert_eq!(store.plugin_model_revision(), before_plugin_revision);
        assert_eq!(
            store.history_status().history_revision,
            before_history_revision
        );
        assert_eq!(store.writer.persist_count(), persist_count);

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn merged_editor_gesture_aliases_only_join_the_top_plugin_entry() {
        let dir = test_directory("merged-editor-gesture-alias-history-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial_x = store.editor_get().document.key_positions["4key"][0].dx;
        let first_gesture = uuid::Uuid::new_v4().to_string();
        let second_gesture = uuid::Uuid::new_v4().to_string();

        for (plugin_id, x, gesture_id) in [
            ("plugin-a", 41.0, first_gesture.clone()),
            ("plugin-b", 82.0, second_gesture.clone()),
        ] {
            let plugin = store
                .commit_plugin_instances(plugin_instances_request(
                    plugin_id,
                    vec![saved_plugin_instance(x)],
                    uuid::Uuid::new_v4().to_string(),
                    Some(gesture_id),
                    Some(store.plugin_model_revision()),
                ))
                .unwrap();
            drop(plugin);
        }

        let mut editor = editor_request(
            store.editor_get().revision,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, initial_x + 60.0),
        );
        editor.gesture_id = Some(second_gesture.clone());
        editor.gesture_ids = vec![first_gesture, second_gesture];
        store.commit_editor_document(editor).unwrap();

        let gate = store.history_gate();
        let counters = store.snapshot().key_counters;
        let first_undo_id = uuid::Uuid::new_v4().to_string();
        let first_barrier = gate.close(&first_undo_id).unwrap();
        let first_undo = store
            .apply_history_operation(HistoryDirection::Undo, &first_undo_id, &counters, || {})
            .unwrap();
        assert_eq!(
            store.editor_get().document.key_positions["4key"][0].dx,
            initial_x
        );
        assert_eq!(
            store.plugin_instances_get("plugin-a").unwrap().0,
            vec![saved_plugin_instance(41.0)]
        );
        assert!(store.plugin_instances_get("plugin-b").unwrap().0.is_empty());
        assert!(first_undo.status.can_undo);
        assert!(first_undo.status.can_redo);
        drop(first_barrier);

        let second_undo_id = uuid::Uuid::new_v4().to_string();
        let second_barrier = gate.close(&second_undo_id).unwrap();
        let second_undo = store
            .apply_history_operation(HistoryDirection::Undo, &second_undo_id, &counters, || {})
            .unwrap();
        assert!(store.plugin_instances_get("plugin-a").unwrap().0.is_empty());
        assert!(store.plugin_instances_get("plugin-b").unwrap().0.is_empty());
        assert!(!second_undo.status.can_undo);
        assert!(second_undo.status.can_redo);
        drop(second_barrier);

        let first_redo_id = uuid::Uuid::new_v4().to_string();
        let first_redo_barrier = gate.close(&first_redo_id).unwrap();
        store
            .apply_history_operation(HistoryDirection::Redo, &first_redo_id, &counters, || {})
            .unwrap();
        assert_eq!(
            store.plugin_instances_get("plugin-a").unwrap().0,
            vec![saved_plugin_instance(41.0)]
        );
        assert!(store.plugin_instances_get("plugin-b").unwrap().0.is_empty());
        assert_eq!(
            store.editor_get().document.key_positions["4key"][0].dx,
            initial_x
        );
        drop(first_redo_barrier);

        let second_redo_id = uuid::Uuid::new_v4().to_string();
        let second_redo_barrier = gate.close(&second_redo_id).unwrap();
        let second_redo = store
            .apply_history_operation(HistoryDirection::Redo, &second_redo_id, &counters, || {})
            .unwrap();
        assert_eq!(
            store.plugin_instances_get("plugin-a").unwrap().0,
            vec![saved_plugin_instance(41.0)]
        );
        assert_eq!(
            store.plugin_instances_get("plugin-b").unwrap().0,
            vec![saved_plugin_instance(82.0)]
        );
        assert_eq!(
            store.editor_get().document.key_positions["4key"][0].dx,
            initial_x + 60.0
        );
        assert!(second_redo.status.can_undo);
        assert!(!second_redo.status.can_redo);
        drop(second_redo_barrier);

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn multi_alias_editor_commit_stays_above_a_later_editor_commit() {
        let dir = test_directory("multi-alias-editor-order-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial_x = store.editor_get().document.key_positions["4key"][0].dx;
        let first_gesture = uuid::Uuid::new_v4().to_string();
        let second_gesture = uuid::Uuid::new_v4().to_string();

        for (plugin_id, x, gesture_id) in [
            ("plugin-a", 41.0, first_gesture.clone()),
            ("plugin-b", 82.0, second_gesture.clone()),
        ] {
            let plugin = store
                .commit_plugin_instances(plugin_instances_request(
                    plugin_id,
                    vec![saved_plugin_instance(x)],
                    uuid::Uuid::new_v4().to_string(),
                    Some(gesture_id),
                    Some(store.plugin_model_revision()),
                ))
                .unwrap();
            drop(plugin);
        }

        let mut intervening_editor = editor_request(
            store.editor_get().revision,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, initial_x + 20.0),
        );
        intervening_editor.gesture_id = Some(uuid::Uuid::new_v4().to_string());
        store.commit_editor_document(intervening_editor).unwrap();

        let mut latest_editor = editor_request(
            store.editor_get().revision,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, initial_x + 40.0),
        );
        latest_editor.gesture_id = Some(second_gesture.clone());
        latest_editor.gesture_ids = vec![first_gesture, second_gesture];
        store.commit_editor_document(latest_editor).unwrap();

        let gate = store.history_gate();
        let counters = store.snapshot().key_counters;
        for (expected_x, expected_a, expected_b) in [
            (initial_x + 20.0, Some(41.0), Some(82.0)),
            (initial_x, Some(41.0), Some(82.0)),
            (initial_x, Some(41.0), None),
            (initial_x, None, None),
        ] {
            let undo_id = uuid::Uuid::new_v4().to_string();
            let barrier = gate.close(&undo_id).unwrap();
            store
                .apply_history_operation(HistoryDirection::Undo, &undo_id, &counters, || {})
                .unwrap();
            assert_eq!(
                store.editor_get().document.key_positions["4key"][0].dx,
                expected_x
            );
            assert_eq!(
                store.plugin_instances_get("plugin-a").unwrap().0,
                expected_a
                    .map(|x| vec![saved_plugin_instance(x)])
                    .unwrap_or_default()
            );
            assert_eq!(
                store.plugin_instances_get("plugin-b").unwrap().0,
                expected_b
                    .map(|x| vec![saved_plugin_instance(x)])
                    .unwrap_or_default()
            );
            drop(barrier);
        }
        assert!(!store.history_status().can_undo);

        for (expected_x, expected_a, expected_b) in [
            (initial_x, Some(41.0), None),
            (initial_x, Some(41.0), Some(82.0)),
            (initial_x + 20.0, Some(41.0), Some(82.0)),
            (initial_x + 40.0, Some(41.0), Some(82.0)),
        ] {
            let redo_id = uuid::Uuid::new_v4().to_string();
            let barrier = gate.close(&redo_id).unwrap();
            store
                .apply_history_operation(HistoryDirection::Redo, &redo_id, &counters, || {})
                .unwrap();
            assert_eq!(
                store.editor_get().document.key_positions["4key"][0].dx,
                expected_x
            );
            assert_eq!(
                store.plugin_instances_get("plugin-a").unwrap().0,
                expected_a
                    .map(|x| vec![saved_plugin_instance(x)])
                    .unwrap_or_default()
            );
            assert_eq!(
                store.plugin_instances_get("plugin-b").unwrap().0,
                expected_b
                    .map(|x| vec![saved_plugin_instance(x)])
                    .unwrap_or_default()
            );
            drop(barrier);
        }
        assert!(!store.history_status().can_redo);

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn merged_aliases_do_not_cross_an_intervening_same_plugin_edit() {
        let dir = test_directory("intervening-same-plugin-alias-history-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial_x = store.editor_get().document.key_positions["4key"][0].dx;
        let first_gesture = uuid::Uuid::new_v4().to_string();
        let intervening_gesture = uuid::Uuid::new_v4().to_string();
        let last_gesture = uuid::Uuid::new_v4().to_string();

        for (x, gesture_id) in [
            (10.0, first_gesture.clone()),
            (20.0, intervening_gesture),
            (30.0, last_gesture.clone()),
        ] {
            let plugin = store
                .commit_plugin_instances(plugin_instances_request(
                    "demo-plugin",
                    vec![saved_plugin_instance(x)],
                    uuid::Uuid::new_v4().to_string(),
                    Some(gesture_id),
                    Some(store.plugin_model_revision()),
                ))
                .unwrap();
            drop(plugin);
        }

        let mut editor = editor_request(
            store.editor_get().revision,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, initial_x + 60.0),
        );
        editor.gesture_id = Some(last_gesture.clone());
        editor.gesture_ids = vec![first_gesture, last_gesture];
        store.commit_editor_document(editor).unwrap();

        let gate = store.history_gate();
        let counters = store.snapshot().key_counters;
        for expected_plugin_x in [Some(20.0), Some(10.0), None] {
            let undo_id = uuid::Uuid::new_v4().to_string();
            let barrier = gate.close(&undo_id).unwrap();
            store
                .apply_history_operation(HistoryDirection::Undo, &undo_id, &counters, || {})
                .unwrap();
            let expected = expected_plugin_x
                .map(|x| vec![saved_plugin_instance(x)])
                .unwrap_or_default();
            assert_eq!(
                store.plugin_instances_get("demo-plugin").unwrap().0,
                expected
            );
            drop(barrier);
        }
        assert_eq!(
            store.editor_get().document.key_positions["4key"][0].dx,
            initial_x
        );
        assert!(!store.history_status().can_undo);

        for expected_plugin_x in [10.0, 20.0, 30.0] {
            let redo_id = uuid::Uuid::new_v4().to_string();
            let barrier = gate.close(&redo_id).unwrap();
            store
                .apply_history_operation(HistoryDirection::Redo, &redo_id, &counters, || {})
                .unwrap();
            assert_eq!(
                store.plugin_instances_get("demo-plugin").unwrap().0,
                vec![saved_plugin_instance(expected_plugin_x)]
            );
            drop(barrier);
        }
        assert_eq!(
            store.editor_get().document.key_positions["4key"][0].dx,
            initial_x + 60.0
        );
        assert!(!store.history_status().can_redo);

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn delayed_plugin_commit_preserves_later_editor_undo_order() {
        let dir = test_directory("delayed-compound-history-order-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial_x = store.editor_get().document.key_positions["4key"][0].dx;
        let gesture_id = uuid::Uuid::new_v4().to_string();

        let mut mixed_editor = editor_request(
            store.editor_get().revision,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, initial_x + 40.0),
        );
        mixed_editor.gesture_id = Some(gesture_id.clone());
        store.commit_editor_document(mixed_editor).unwrap();

        let later_editor = editor_request(
            store.editor_get().revision,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, initial_x + 80.0),
        );
        store.commit_editor_document(later_editor).unwrap();

        let plugin = store
            .commit_plugin_instances(plugin_instances_request(
                "demo-plugin",
                vec![saved_plugin_instance(42.0)],
                uuid::Uuid::new_v4().to_string(),
                Some(gesture_id),
                Some(store.plugin_model_revision()),
            ))
            .unwrap();
        drop(plugin);

        let gate = store.history_gate();
        let counters = store.snapshot().key_counters;
        let first_undo_id = uuid::Uuid::new_v4().to_string();
        let first_barrier = gate.close(&first_undo_id).unwrap();
        store
            .apply_history_operation(HistoryDirection::Undo, &first_undo_id, &counters, || {})
            .unwrap();
        assert_eq!(
            store.editor_get().document.key_positions["4key"][0].dx,
            initial_x + 40.0
        );
        assert_eq!(
            store.plugin_instances_get("demo-plugin").unwrap().0,
            vec![saved_plugin_instance(42.0)]
        );
        drop(first_barrier);

        let second_undo_id = uuid::Uuid::new_v4().to_string();
        let second_barrier = gate.close(&second_undo_id).unwrap();
        store
            .apply_history_operation(HistoryDirection::Undo, &second_undo_id, &counters, || {})
            .unwrap();
        assert_eq!(
            store.editor_get().document.key_positions["4key"][0].dx,
            initial_x
        );
        assert!(store
            .plugin_instances_get("demo-plugin")
            .unwrap()
            .0
            .is_empty());
        drop(second_barrier);

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn repeated_editor_gesture_keeps_an_intervening_plugin_undo_in_order() {
        let dir = test_directory("repeated-editor-gesture-order-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial_x = store.editor_get().document.key_positions["4key"][0].dx;
        let gesture_id = uuid::Uuid::new_v4().to_string();

        let mut first_editor = editor_request(
            store.editor_get().revision,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, initial_x + 40.0),
        );
        first_editor.gesture_id = Some(gesture_id.clone());
        store.commit_editor_document(first_editor).unwrap();
        let plugin = store
            .commit_plugin_instances(plugin_instances_request(
                "demo-plugin",
                vec![saved_plugin_instance(42.0)],
                uuid::Uuid::new_v4().to_string(),
                None,
                Some(store.plugin_model_revision()),
            ))
            .unwrap();
        drop(plugin);
        let mut repeated_editor = editor_request(
            store.editor_get().revision,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, initial_x + 80.0),
        );
        repeated_editor.gesture_id = Some(gesture_id);
        store.commit_editor_document(repeated_editor).unwrap();

        let gate = store.history_gate();
        let counters = store.snapshot().key_counters;
        let first_undo_id = uuid::Uuid::new_v4().to_string();
        let first_barrier = gate.close(&first_undo_id).unwrap();
        store
            .apply_history_operation(HistoryDirection::Undo, &first_undo_id, &counters, || {})
            .unwrap();
        assert_eq!(
            store.editor_get().document.key_positions["4key"][0].dx,
            initial_x + 40.0
        );
        assert_eq!(
            store.plugin_instances_get("demo-plugin").unwrap().0,
            vec![saved_plugin_instance(42.0)]
        );
        drop(first_barrier);

        let second_undo_id = uuid::Uuid::new_v4().to_string();
        let second_barrier = gate.close(&second_undo_id).unwrap();
        store
            .apply_history_operation(HistoryDirection::Undo, &second_undo_id, &counters, || {})
            .unwrap();
        assert_eq!(
            store.editor_get().document.key_positions["4key"][0].dx,
            initial_x + 40.0
        );
        assert!(store
            .plugin_instances_get("demo-plugin")
            .unwrap()
            .0
            .is_empty());
        drop(second_barrier);

        let third_undo_id = uuid::Uuid::new_v4().to_string();
        let third_barrier = gate.close(&third_undo_id).unwrap();
        store
            .apply_history_operation(HistoryDirection::Undo, &third_undo_id, &counters, || {})
            .unwrap();
        assert_eq!(
            store.editor_get().document.key_positions["4key"][0].dx,
            initial_x
        );
        drop(third_barrier);

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn plugin_first_compound_undo_restores_both_scopes() {
        let dir = test_directory("plugin-first-compound-history-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial_x = store.editor_get().document.key_positions["4key"][0].dx;
        let gesture_id = uuid::Uuid::new_v4().to_string();

        let plugin = store
            .commit_plugin_instances(plugin_instances_request(
                "demo-plugin",
                vec![saved_plugin_instance(91.0)],
                uuid::Uuid::new_v4().to_string(),
                Some(gesture_id.clone()),
                Some(store.plugin_model_revision()),
            ))
            .unwrap();
        drop(plugin);
        let mut editor = editor_request(
            store.editor_get().revision,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, initial_x + 35.0),
        );
        editor.gesture_id = Some(gesture_id);
        store.commit_editor_document(editor).unwrap();

        let gate = store.history_gate();
        let counters = store.snapshot().key_counters;
        let undo_id = uuid::Uuid::new_v4().to_string();
        let undo_barrier = gate.close(&undo_id).unwrap();
        store
            .apply_history_operation(HistoryDirection::Undo, &undo_id, &counters, || {})
            .unwrap();
        assert_eq!(
            store.editor_get().document.key_positions["4key"][0].dx,
            initial_x
        );
        assert!(store
            .plugin_instances_get("demo-plugin")
            .unwrap()
            .0
            .is_empty());
        drop(undo_barrier);

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn compound_history_persist_failure_changes_neither_scope() {
        let dir = test_directory("compound-history-persist-failure-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial_x = store.editor_get().document.key_positions["4key"][0].dx;
        let changed_x = initial_x + 55.0;
        let gesture_id = uuid::Uuid::new_v4().to_string();

        let mut editor = editor_request(
            store.editor_get().revision,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, changed_x),
        );
        editor.gesture_id = Some(gesture_id.clone());
        store.commit_editor_document(editor).unwrap();
        let plugin = store
            .commit_plugin_instances(plugin_instances_request(
                "demo-plugin",
                vec![saved_plugin_instance(66.0)],
                uuid::Uuid::new_v4().to_string(),
                Some(gesture_id),
                Some(store.plugin_model_revision()),
            ))
            .unwrap();
        drop(plugin);

        let gate = store.history_gate();
        let counters = store.snapshot().key_counters;
        let undo_id = uuid::Uuid::new_v4().to_string();
        let undo_barrier = gate.close(&undo_id).unwrap();
        store.writer.fail_next_persist();
        assert!(store
            .apply_history_operation(HistoryDirection::Undo, &undo_id, &counters, || {})
            .is_err());
        assert_eq!(
            store.editor_get().document.key_positions["4key"][0].dx,
            changed_x
        );
        assert_eq!(
            store.plugin_instances_get("demo-plugin").unwrap().0,
            vec![saved_plugin_instance(66.0)]
        );
        assert!(store.history_status().can_undo);
        drop(undo_barrier);

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn plugin_instances_commit_revalidates_admission_after_store_lock_wait() {
        let dir = test_directory("plugin-instances-admission-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = Arc::new(AppStore::initialize_in_dir(&dir).unwrap());
        let expected_revision = store.plugin_model_revision();
        let request = plugin_instances_request(
            "demo-plugin",
            vec![saved_plugin_instance(10.0)],
            uuid::Uuid::new_v4().to_string(),
            None,
            Some(expected_revision),
        );
        let store_guard = store.state.write();
        let commit_store = Arc::clone(&store);
        let commit = thread::spawn(move || commit_store.commit_plugin_instances(request));
        let gate = store.history_gate();
        let deadline = Instant::now() + Duration::from_secs(2);
        while gate.active_mutations() == 0 {
            assert!(
                Instant::now() < deadline,
                "plugin mutation was not admitted"
            );
            thread::yield_now();
        }

        let barrier_gate = Arc::clone(&gate);
        let operation_id = uuid::Uuid::new_v4().to_string();
        let (barrier_ready_tx, barrier_ready_rx) = mpsc::channel();
        let (release_barrier_tx, release_barrier_rx) = mpsc::channel();
        let barrier = thread::spawn(move || {
            let lease = barrier_gate.close(&operation_id).unwrap();
            barrier_ready_tx.send(()).unwrap();
            release_barrier_rx.recv().unwrap();
            drop(lease);
        });
        let deadline = Instant::now() + Duration::from_secs(2);
        while !gate.is_closed() {
            assert!(Instant::now() < deadline, "history gate did not close");
            thread::yield_now();
        }

        drop(store_guard);
        assert_eq!(commit.join().unwrap().unwrap_err(), HISTORY_IN_PROGRESS);
        barrier_ready_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
        release_barrier_tx.send(()).unwrap();
        barrier.join().unwrap();
        assert!(store
            .plugin_instances_get("demo-plugin")
            .unwrap()
            .0
            .is_empty());

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn plugin_instances_net_zero_gesture_removes_merged_entry() {
        let dir = test_directory("plugin-instances-net-zero-gesture-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let gesture_id = uuid::Uuid::new_v4().to_string();
        let expected_revision = store.plugin_model_revision();
        let first = store
            .commit_plugin_instances(plugin_instances_request(
                "demo-plugin",
                vec![saved_plugin_instance(10.0)],
                uuid::Uuid::new_v4().to_string(),
                Some(gesture_id.clone()),
                Some(expected_revision),
            ))
            .unwrap();
        let next_revision = first.outcome.model_revision;
        drop(first);

        let second = store
            .commit_plugin_instances(plugin_instances_request(
                "demo-plugin",
                Vec::new(),
                uuid::Uuid::new_v4().to_string(),
                Some(gesture_id),
                Some(next_revision),
            ))
            .unwrap();
        assert!(!second.outcome.history_status.as_ref().unwrap().can_undo);
        drop(second);
        assert!(store
            .plugin_instances_get("demo-plugin")
            .unwrap()
            .0
            .is_empty());

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn mixed_net_zero_gesture_removes_compound_entry() {
        let dir = test_directory("compound-net-zero-gesture-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial_x = store.editor_get().document.key_positions["4key"][0].dx;
        let gesture_id = uuid::Uuid::new_v4().to_string();

        let mut editor_out = editor_request(
            store.editor_get().revision,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, initial_x + 25.0),
        );
        editor_out.gesture_id = Some(gesture_id.clone());
        store.commit_editor_document(editor_out).unwrap();
        let plugin_out = store
            .commit_plugin_instances(plugin_instances_request(
                "demo-plugin",
                vec![saved_plugin_instance(25.0)],
                uuid::Uuid::new_v4().to_string(),
                Some(gesture_id.clone()),
                Some(store.plugin_model_revision()),
            ))
            .unwrap();
        drop(plugin_out);

        let mut editor_back = editor_request(
            store.editor_get().revision,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, initial_x),
        );
        editor_back.gesture_id = Some(gesture_id.clone());
        store.commit_editor_document(editor_back).unwrap();
        let plugin_back = store
            .commit_plugin_instances(plugin_instances_request(
                "demo-plugin",
                Vec::new(),
                uuid::Uuid::new_v4().to_string(),
                Some(gesture_id),
                Some(store.plugin_model_revision()),
            ))
            .unwrap();
        assert!(
            !plugin_back
                .outcome
                .history_status
                .as_ref()
                .unwrap()
                .can_undo
        );
        drop(plugin_back);

        assert_eq!(
            store.editor_get().document.key_positions["4key"][0].dx,
            initial_x
        );
        assert!(store
            .plugin_instances_get("demo-plugin")
            .unwrap()
            .0
            .is_empty());

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn plugin_instances_reconcile_is_noop_when_canonical_tabs_are_valid() {
        let dir = test_directory("plugin-instances-reconcile-noop-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let committed = store
            .commit_plugin_instances(plugin_instances_request(
                "demo-plugin",
                vec![saved_plugin_instance(10.0)],
                uuid::Uuid::new_v4().to_string(),
                None,
                Some(store.plugin_model_revision()),
            ))
            .unwrap();
        drop(committed);
        let revision = store.plugin_model_revision();
        let history_revision = store.history_status().history_revision;

        let reconciled = store
            .reconcile_plugin_instances(plugin_instances_reconcile_request(
                "demo-plugin",
                &["4key", "5key"],
                uuid::Uuid::new_v4().to_string(),
            ))
            .unwrap();

        assert!(!reconciled.outcome.changed);
        assert!(reconciled.outcome.history_status.is_none());
        assert_eq!(reconciled.outcome.model_revision, revision);
        drop(reconciled);
        assert_eq!(store.history_status().history_revision, history_revision);

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn plugin_instances_reconcile_records_and_round_trips_history() {
        let dir = test_directory("plugin-instances-reconcile-history-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let mut default_tab = saved_plugin_instance(10.0);
        default_tab.tab_id = None;
        default_tab.hidden = true;
        default_tab.z_index = Some(17.0);
        let mut stale_tab = saved_plugin_instance(30.0);
        stale_tab.tab_id = Some("deleted-tab".to_string());
        let before = vec![default_tab, stale_tab];
        let committed = store
            .commit_plugin_instances(plugin_instances_request(
                "demo-plugin",
                before.clone(),
                uuid::Uuid::new_v4().to_string(),
                None,
                Some(store.plugin_model_revision()),
            ))
            .unwrap();
        drop(committed);

        let request = plugin_instances_reconcile_request(
            "demo-plugin",
            &["4key"],
            uuid::Uuid::new_v4().to_string(),
        );
        let reconciled = store.reconcile_plugin_instances(request).unwrap();
        assert!(reconciled.outcome.changed);
        assert!(reconciled.outcome.history_status.is_some());
        drop(reconciled);
        let mut normalized = saved_plugin_instance(10.0);
        normalized.tab_id = Some("4key".to_string());
        normalized.hidden = true;
        normalized.z_index = Some(17.0);
        assert_eq!(
            store.plugin_instances_get("demo-plugin").unwrap().0,
            vec![normalized.clone()]
        );

        let gate = store.history_gate();
        let counters = store.snapshot().key_counters;
        let undo_id = uuid::Uuid::new_v4().to_string();
        let undo_barrier = gate.close(&undo_id).unwrap();
        store
            .apply_history_operation(HistoryDirection::Undo, &undo_id, &counters, || {})
            .unwrap();
        drop(undo_barrier);
        assert_eq!(store.plugin_instances_get("demo-plugin").unwrap().0, before);

        let redo_id = uuid::Uuid::new_v4().to_string();
        let redo_barrier = gate.close(&redo_id).unwrap();
        store
            .apply_history_operation(HistoryDirection::Redo, &redo_id, &counters, || {})
            .unwrap();
        drop(redo_barrier);
        assert_eq!(
            store.plugin_instances_get("demo-plugin").unwrap().0,
            vec![normalized]
        );

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn plugin_instances_reconcile_rejects_stale_history_epoch_after_undo() {
        let dir = test_directory("plugin-instances-reconcile-history-epoch-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let restored_instances = vec![saved_plugin_instance(10.0)];
        let first = store
            .commit_plugin_instances(plugin_instances_request(
                "demo-plugin",
                restored_instances.clone(),
                uuid::Uuid::new_v4().to_string(),
                None,
                Some(store.plugin_model_revision()),
            ))
            .unwrap();
        drop(first);

        let mut replacement = saved_plugin_instance(30.0);
        replacement.tab_id = Some("5key".to_string());
        let second = store
            .commit_plugin_instances(plugin_instances_request(
                "demo-plugin",
                vec![replacement],
                uuid::Uuid::new_v4().to_string(),
                None,
                Some(store.plugin_model_revision()),
            ))
            .unwrap();
        drop(second);
        let stale_epoch = store.history_status().history_epoch;

        let operation_id = uuid::Uuid::new_v4().to_string();
        let gate = store.history_gate();
        let barrier = gate.close(&operation_id).unwrap();
        let counters = store.snapshot().key_counters;
        let undo = store
            .apply_history_operation(HistoryDirection::Undo, &operation_id, &counters, || {})
            .unwrap();
        drop(barrier);
        assert_ne!(undo.status.history_epoch, stale_epoch);
        assert_eq!(
            store.plugin_instances_get("demo-plugin").unwrap().0,
            restored_instances
        );

        let before_revision = store.plugin_model_revision();
        let before_status = store.history_status();
        let mutation_id = uuid::Uuid::new_v4().to_string();
        let mut request = plugin_instances_reconcile_request("demo-plugin", &["5key"], mutation_id);
        request.observed_history_epoch = Some(stale_epoch);
        assert_eq!(
            store.reconcile_plugin_instances(request).unwrap_err(),
            "HISTORY_EPOCH_CONFLICT"
        );
        assert_eq!(store.plugin_model_revision(), before_revision);
        let after_status = store.history_status();
        assert_eq!(
            after_status.history_revision,
            before_status.history_revision
        );
        assert_eq!(after_status.history_epoch, before_status.history_epoch);
        assert_eq!(after_status.can_undo, before_status.can_undo);
        assert_eq!(after_status.can_redo, before_status.can_redo);
        assert_eq!(after_status.busy, before_status.busy);
        assert_eq!(after_status.truncated, before_status.truncated);
        assert!(after_status.status_seq > before_status.status_seq);
        assert_eq!(
            store.plugin_instances_get("demo-plugin").unwrap().0,
            restored_instances
        );

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn plugin_instances_reconcile_cannot_resurrect_after_bulk_clear() {
        let dir = test_directory("plugin-instances-reconcile-clear-race-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = Arc::new(AppStore::initialize_in_dir(&dir).unwrap());
        let committed = store
            .commit_plugin_instances(plugin_instances_request(
                "demo-plugin",
                vec![saved_plugin_instance(10.0)],
                uuid::Uuid::new_v4().to_string(),
                None,
                Some(store.plugin_model_revision()),
            ))
            .unwrap();
        drop(committed);
        let stale_snapshot = store.plugin_instances_get("demo-plugin").unwrap().0;
        assert!(!stale_snapshot.is_empty());

        let store_guard = store.state.write();
        let reconcile_store = Arc::clone(&store);
        let reconcile = thread::spawn(move || {
            let result =
                reconcile_store.reconcile_plugin_instances(plugin_instances_reconcile_request(
                    "demo-plugin",
                    &["4key"],
                    uuid::Uuid::new_v4().to_string(),
                ));
            result.map(|outcome| outcome.outcome.changed)
        });
        let clear_store = Arc::clone(&store);
        let clear = thread::spawn(move || {
            let result = clear_store.remove_plugin_data_by_prefix("plugin_data_demo-plugin/");
            result.map(|outcome| outcome.value)
        });

        let gate = store.history_gate();
        let deadline = Instant::now() + Duration::from_secs(2);
        while gate.active_mutations() < 2 {
            assert!(
                Instant::now() < deadline,
                "plugin mutations were not admitted"
            );
            thread::yield_now();
        }
        drop(store_guard);

        reconcile.join().unwrap().unwrap();
        assert_eq!(clear.join().unwrap().unwrap(), 1);
        assert!(store
            .plugin_instances_get("demo-plugin")
            .unwrap()
            .0
            .is_empty());

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn generic_instance_storage_set_and_remove_are_reserved() {
        let dir = test_directory("plugin-instances-reserved-key-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let committed = store
            .commit_plugin_instances(plugin_instances_request(
                "demo-plugin",
                vec![saved_plugin_instance(10.0)],
                uuid::Uuid::new_v4().to_string(),
                None,
                Some(store.plugin_model_revision()),
            ))
            .unwrap();
        drop(committed);

        let gate = store.history_gate();
        let undo_id = uuid::Uuid::new_v4().to_string();
        let barrier = gate.close(&undo_id).unwrap();
        let counters = store.snapshot().key_counters;
        store
            .apply_history_operation(HistoryDirection::Undo, &undo_id, &counters, || {})
            .unwrap();
        drop(barrier);
        assert!(store.history_status().can_redo);
        let revision = store.plugin_model_revision();

        let set_error = store
            .set_plugin_data(
                "plugin_data_demo-plugin/instances",
                serde_json::to_value(vec![saved_plugin_instance(90.0)]).unwrap(),
            )
            .unwrap_err();
        let remove_error = store
            .remove_plugin_data("plugin_data_demo-plugin/instances")
            .unwrap_err();

        assert_eq!(set_error.to_string(), "PLUGIN_INSTANCES_KEY_RESERVED");
        assert_eq!(remove_error.to_string(), "PLUGIN_INSTANCES_KEY_RESERVED");
        assert_eq!(store.plugin_model_revision(), revision);
        assert!(store.history_status().can_redo);
        assert!(store
            .plugin_instances_get("demo-plugin")
            .unwrap()
            .0
            .is_empty());

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn bulk_plugin_storage_deletion_reports_each_instance_revision() {
        let dir = test_directory("plugin-instances-bulk-delete-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();

        for plugin_id in ["alpha", "beta"] {
            let committed = store
                .commit_plugin_instances(plugin_instances_request(
                    plugin_id,
                    vec![saved_plugin_instance(10.0)],
                    uuid::Uuid::new_v4().to_string(),
                    None,
                    Some(store.plugin_model_revision()),
                ))
                .unwrap();
            drop(committed);
        }
        drop(
            store
                .set_plugin_data("plugin_data_alpha/preferences", json!({ "enabled": true }))
                .unwrap(),
        );

        let gate = store.history_gate();
        let undo_id = uuid::Uuid::new_v4().to_string();
        let barrier = gate.close(&undo_id).unwrap();
        let counters = store.snapshot().key_counters;
        store
            .apply_history_operation(HistoryDirection::Undo, &undo_id, &counters, || {})
            .unwrap();
        drop(barrier);
        assert!(store.history_status().can_redo);

        let prefix_revision = store.plugin_model_revision() + 1;
        let prefix_delete = store
            .remove_plugin_data_by_prefix("plugin_data_alpha/")
            .unwrap();
        assert_eq!(prefix_delete.value, 2);
        assert!(!prefix_delete.history_status.as_ref().unwrap().can_redo);
        assert_eq!(
            prefix_delete.plugin_instances_changes,
            vec![super::PluginInstancesStorageChange {
                plugin_id: "alpha".to_string(),
                revision: prefix_revision,
            }]
        );
        drop(prefix_delete);
        assert!(store.plugin_instances_get("alpha").unwrap().0.is_empty());
        assert!(store.plugin_instances_get("beta").unwrap().0.is_empty());

        for plugin_id in ["beta", "gamma"] {
            let committed = store
                .commit_plugin_instances(plugin_instances_request(
                    plugin_id,
                    vec![saved_plugin_instance(20.0)],
                    uuid::Uuid::new_v4().to_string(),
                    None,
                    Some(store.plugin_model_revision()),
                ))
                .unwrap();
            drop(committed);
        }

        let clear_revision = store.plugin_model_revision() + 1;
        let clear = store.clear_all_plugin_data().unwrap();
        assert_eq!(
            clear.plugin_instances_changes,
            vec![
                super::PluginInstancesStorageChange {
                    plugin_id: "beta".to_string(),
                    revision: clear_revision,
                },
                super::PluginInstancesStorageChange {
                    plugin_id: "gamma".to_string(),
                    revision: clear_revision,
                },
            ]
        );
        drop(clear);
        assert_eq!(store.plugin_model_revision(), clear_revision);
        assert!(store.plugin_instances_get("beta").unwrap().0.is_empty());
        assert!(store.plugin_instances_get("gamma").unwrap().0.is_empty());

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn strict_editor_commit_persists_once_and_synchronizes_key_counters() {
        let dir = test_directory("strict-editor-success-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let persist_count = store.writer.persist_count();
        let before = store.snapshot();
        let old_key = before.keys["4key"][0].canonical();
        let mut keys = before.keys.clone();
        keys.get_mut("4key").unwrap()[0] = "StrictKey".into();
        let first_gesture_id = uuid::Uuid::new_v4().to_string();
        let gesture_id = uuid::Uuid::new_v4().to_string();
        let mut request = editor_request(
            0,
            uuid::Uuid::new_v4().to_string(),
            EditorPatchV1 {
                keys: Some(keys),
                ..EditorPatchV1::default()
            },
        );
        request.gesture_id = Some(gesture_id.clone());
        request.gesture_ids = vec![
            first_gesture_id.clone(),
            first_gesture_id.clone(),
            gesture_id.clone(),
        ];

        let change = store.commit_editor_document(request).unwrap();

        assert_eq!(change.result.revision, 1);
        assert_eq!(change.result.changed_fields, vec![EditorField::Keys]);
        assert_eq!(change.event.as_ref().unwrap().origin, "editorCommit");
        assert_eq!(
            change.event.as_ref().unwrap().gesture_id.as_deref(),
            Some(gesture_id.as_str())
        );
        assert_eq!(
            change.event.as_ref().unwrap().gesture_ids,
            vec![first_gesture_id, gesture_id]
        );
        assert_eq!(store.writer.persist_count(), persist_count + 1);
        let snapshot = store.snapshot();
        assert_eq!(snapshot.editor_revision, 1);
        assert_eq!(snapshot.keys["4key"][0], KeySlot::from("StrictKey"));
        assert_eq!(snapshot.key_counters["4key"]["StrictKey"], 0);
        assert!(!snapshot.key_counters["4key"].contains_key(&old_key));
        assert_eq!(change.history_status.unwrap().history_revision, 1);
        assert!(store.history_status().can_undo);

        store.flush_and_shutdown().unwrap();
        drop(store);
        let reloaded = crate::state::migration::load_store_from_path(&dir.join("store.json"))
            .unwrap()
            .data;
        assert_eq!(reloaded.editor_revision, 1);
        assert_eq!(reloaded.keys["4key"][0], KeySlot::from("StrictKey"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn strict_editor_commit_rechecks_multi_key_capability_under_store_lock() {
        let dir = test_directory("multi-key-capability-gate-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial = store.editor_get().document;

        let mut legacy_keys = initial.keys.clone();
        legacy_keys.get_mut("4key").unwrap()[0] = KeySlot::Single("Legacy".to_string());
        let legacy_request = editor_request(
            1,
            uuid::Uuid::new_v4().to_string(),
            EditorPatchV1 {
                keys: Some(legacy_keys),
                ..EditorPatchV1::default()
            },
        );

        let mut multi_keys = initial.keys;
        multi_keys.get_mut("4key").unwrap()[0] = KeySlot::Multi {
            keys: vec!["A".to_string(), "B".to_string()],
            match_mode: SlotMatch::Any,
        };
        let mut capable_request = editor_request(
            0,
            uuid::Uuid::new_v4().to_string(),
            EditorPatchV1 {
                keys: Some(multi_keys),
                ..EditorPatchV1::default()
            },
        );
        capable_request.multi_key = true;
        store.commit_editor_document(capable_request).unwrap();
        let committed_keys = serde_json::to_vec(&store.snapshot().keys).unwrap();
        let committed_disk = std::fs::read(dir.join("store.json")).unwrap();
        let persist_count = store.writer.persist_count();

        let error = store.commit_editor_document(legacy_request).unwrap_err();

        assert_eq!(error.error_code, EditorCommitErrorCode::MultiKeyUnsupported);
        assert_eq!(
            serde_json::to_value(&error).unwrap()["errorCode"],
            "MULTI_KEY_UNSUPPORTED"
        );
        assert!(!error.retryable);
        assert_eq!(store.snapshot().editor_revision, 1);
        assert_eq!(
            serde_json::to_vec(&store.snapshot().keys).unwrap(),
            committed_keys
        );
        assert_eq!(store.writer.persist_count(), persist_count);
        assert_eq!(
            std::fs::read(dir.join("store.json")).unwrap(),
            committed_disk
        );

        let position_change = store
            .commit_editor_document(editor_request(
                1,
                uuid::Uuid::new_v4().to_string(),
                position_patch(&store, 321.0),
            ))
            .unwrap();
        assert_eq!(position_change.result.revision, 2);
        assert_eq!(
            serde_json::to_vec(&store.snapshot().keys).unwrap(),
            committed_keys
        );

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn editor_commit_history_skips_no_op_and_deduplicates_mutation() {
        let dir = test_directory("editor-history-recording-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial_dx = store.editor_get().document.key_positions["4key"][0].dx;

        let no_op = editor_request(
            0,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, initial_dx),
        );
        let no_op_change = store.commit_editor_document(no_op).unwrap();
        assert!(no_op_change.result.changed_fields.is_empty());
        assert_eq!(store.history_status().history_revision, 0);

        let mutation_id = uuid::Uuid::new_v4().to_string();
        let request = editor_request(0, mutation_id, position_patch(&store, initial_dx + 12.0));
        let committed = store.commit_editor_document(request.clone()).unwrap();
        assert_eq!(committed.history_status.unwrap().history_revision, 1);

        let replayed = store.commit_editor_document(request).unwrap();
        assert!(replayed.replayed);
        assert!(replayed.history_status.is_none());
        assert_eq!(store.history_status().history_revision, 1);

        let repeated_value = editor_request(
            1,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, initial_dx + 12.0),
        );
        let repeated_value = store.commit_editor_document(repeated_value).unwrap();
        assert!(repeated_value.result.changed_fields.is_empty());
        assert_eq!(store.history_status().history_revision, 1);

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn editor_commits_with_the_same_gesture_merge_into_one_history_entry() {
        let dir = test_directory("editor-history-gesture-merge-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial_dx = store.editor_get().document.key_positions["4key"][0].dx;
        let gesture_id = uuid::Uuid::new_v4().to_string();

        let mut first = editor_request(
            0,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, initial_dx + 4.0),
        );
        first.gesture_id = Some(gesture_id.clone());
        let first = store.commit_editor_document(first).unwrap();
        assert_eq!(first.history_status.unwrap().history_revision, 1);

        let mut second = editor_request(
            1,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, initial_dx + 8.0),
        );
        second.gesture_id = Some(gesture_id);
        let second = store.commit_editor_document(second).unwrap();
        assert_eq!(second.history_status.unwrap().history_revision, 1);

        let operation_id = uuid::Uuid::new_v4().to_string();
        let gate = store.history_gate();
        let barrier = gate.close(&operation_id).unwrap();
        let current_counters = store.snapshot().key_counters;
        store
            .apply_history_operation(
                HistoryDirection::Undo,
                &operation_id,
                &current_counters,
                || {},
            )
            .unwrap();
        drop(barrier);

        assert_eq!(
            store.editor_get().document.key_positions["4key"][0].dx,
            initial_dx
        );
        assert!(!store.state.read().history.status(false).can_undo);

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn net_zero_gesture_removes_its_entry_and_exposes_the_lower_history() {
        let dir = test_directory("editor-history-net-zero-gesture-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial_dx = store.editor_get().document.key_positions["4key"][0].dx;
        let gesture_base_dx = initial_dx + 10.0;

        store
            .commit_editor_document(editor_request(
                0,
                uuid::Uuid::new_v4().to_string(),
                position_patch(&store, gesture_base_dx),
            ))
            .unwrap();

        let gesture_id = uuid::Uuid::new_v4().to_string();
        let mut outward = editor_request(
            1,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, gesture_base_dx + 5.0),
        );
        outward.gesture_id = Some(gesture_id.clone());
        store.commit_editor_document(outward).unwrap();

        let mut returned = editor_request(
            2,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, gesture_base_dx),
        );
        returned.gesture_id = Some(gesture_id);
        let returned = store.commit_editor_document(returned).unwrap();
        let status = returned.history_status.as_ref().unwrap();
        assert!(status.can_undo);
        assert_eq!(status.history_revision, 3);
        assert_eq!(
            store.editor_get().document.key_positions["4key"][0].dx,
            gesture_base_dx
        );

        let operation_id = uuid::Uuid::new_v4().to_string();
        let gate = store.history_gate();
        let barrier = gate.close(&operation_id).unwrap();
        let current_counters = store.snapshot().key_counters;
        store
            .apply_history_operation(
                HistoryDirection::Undo,
                &operation_id,
                &current_counters,
                || {},
            )
            .unwrap();
        drop(barrier);

        assert_eq!(
            store.editor_get().document.key_positions["4key"][0].dx,
            initial_dx
        );
        assert!(!store.state.read().history.status(false).can_undo);

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn unrecorded_preset_overlap_mutations_clear_redo_only_when_overlap_changes() {
        let dir = test_directory("history-overlap-redo-invalidation-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial_dx = store.editor_get().document.key_positions["4key"][0].dx;

        for (index, mutate_css) in [false, true].into_iter().enumerate() {
            let base_revision = store.editor_get().revision;
            store
                .commit_editor_document(editor_request(
                    base_revision,
                    uuid::Uuid::new_v4().to_string(),
                    position_patch(&store, initial_dx + index as f64 + 1.0),
                ))
                .unwrap();
            let operation_id = uuid::Uuid::new_v4().to_string();
            let gate = store.history_gate();
            let barrier = gate.close(&operation_id).unwrap();
            let current_counters = store.snapshot().key_counters;
            store
                .apply_history_operation(
                    HistoryDirection::Undo,
                    &operation_id,
                    &current_counters,
                    || {},
                )
                .unwrap();
            drop(barrier);
            let before_mutation = store.state.read().history.status(false);
            assert!(before_mutation.can_redo);

            let transaction = store
                .commit_history_overlap_mutation(|data| {
                    if mutate_css {
                        data.custom_css.content = format!("body {{ opacity: {}; }}", index + 1);
                    } else {
                        apply_patch_to_store(
                            data,
                            &SettingsPatchInput {
                                background_color: Some(format!("#{:06x}", index + 1)),
                                ..SettingsPatchInput::default()
                            },
                        );
                    }
                    Ok(())
                })
                .unwrap();
            let status = transaction.history_status.as_ref().unwrap();
            assert!(!status.can_redo);
            assert_eq!(
                status.history_revision,
                before_mutation.history_revision + 1
            );
            drop(transaction);
        }

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn css_watcher_reload_after_undo_preserves_latest_canonical_and_invalidates_redo() {
        let dir = test_directory("css-watcher-history-interleaving-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let watched_path = "/tmp/dmnote-history-watched.css";
        store
            .update(|data| {
                data.use_custom_css = true;
                data.custom_css = CustomCss {
                    path: Some(watched_path.to_string()),
                    content: "before".to_string(),
                };
            })
            .unwrap();

        let current_counters = store.snapshot().key_counters;
        let preset = store
            .commit_preset_editor_transaction(
                EditorCommitOrigin::LegacyAdapter("css_watcher_preset_test".to_string()),
                &[],
                current_counters,
                |data| {
                    data.custom_css.content = "preset".to_string();
                    Ok(())
                },
            )
            .unwrap();
        assert_eq!(
            preset
                .change
                .history_status
                .as_ref()
                .unwrap()
                .history_revision,
            1
        );
        drop(preset);
        let undo_id = uuid::Uuid::new_v4().to_string();
        let gate = store.history_gate();
        let barrier = gate.close(&undo_id).unwrap();
        let current_counters = store.snapshot().key_counters;
        store
            .apply_history_operation(HistoryDirection::Undo, &undo_id, &current_counters, || {})
            .unwrap();
        drop(barrier);
        assert_eq!(store.snapshot().custom_css.content, "before");
        assert!(store.state.read().history.status(false).can_redo);

        let loaded = ValidatedCssFile {
            canonical_path: watched_path.to_string(),
            content: "after-hot-reload".to_string(),
        };
        let transaction = commit_css_reload(&store, watched_path, &loaded).unwrap();
        assert_eq!(
            transaction.value.0.as_ref().unwrap().content,
            "after-hot-reload"
        );
        let status = transaction.history_status.as_ref().unwrap();
        assert!(!status.can_redo);
        drop(transaction);

        let redo_id = uuid::Uuid::new_v4().to_string();
        let barrier = gate.close(&redo_id).unwrap();
        let current_counters = store.snapshot().key_counters;
        let redo = store.apply_history_operation(
            HistoryDirection::Redo,
            &redo_id,
            &current_counters,
            || {},
        );
        drop(barrier);
        assert_eq!(redo.unwrap_err(), "HISTORY_NOTHING_TO_REDO");
        assert_eq!(store.snapshot().custom_css.content, "after-hot-reload");

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn mode_history_records_restores_and_rejects_stale_epoch() {
        let dir = test_directory("mode-history-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial_mode = store.snapshot().selected_key_type;
        let next_mode = if initial_mode == "8key" {
            "4key".to_string()
        } else {
            "8key".to_string()
        };

        let no_op = store
            .commit_aux_editor_transaction(
                HistoryScope::Mode,
                Some(0),
                EditorCommitOrigin::LegacyAdapter("mode_noop_test".to_string()),
                &[],
                |data| Ok(data.selected_key_type.clone()),
            )
            .unwrap();
        assert!(no_op.change.history_status.is_none());
        drop(no_op);
        assert_eq!(store.history_status().history_revision, 0);

        let transaction = store
            .commit_aux_editor_transaction(
                HistoryScope::Mode,
                Some(0),
                EditorCommitOrigin::LegacyAdapter("mode_history_test".to_string()),
                &[],
                |data| {
                    data.selected_key_type = next_mode.clone();
                    Ok(())
                },
            )
            .unwrap();
        let recorded = transaction.change.history_status.as_ref().unwrap();
        assert_eq!(recorded.history_revision, 1);
        assert_eq!(recorded.history_epoch, 0);
        assert!(recorded.can_undo);
        drop(transaction);

        let operation_id = uuid::Uuid::new_v4().to_string();
        let gate = store.history_gate();
        let barrier = gate.close(&operation_id).unwrap();
        let current_counters = store.snapshot().key_counters;
        let undo = store
            .apply_history_operation(
                HistoryDirection::Undo,
                &operation_id,
                &current_counters,
                || {},
            )
            .unwrap();
        drop(barrier);
        assert!(matches!(
            undo.aux_change,
            Some(HistoryAuxChange::Mode(ref mode)) if mode == &initial_mode
        ));
        assert_eq!(store.snapshot().selected_key_type, initial_mode);
        assert_eq!(undo.status.history_epoch, 1);
        assert!(undo.status.can_redo);

        let before_stale = store.snapshot();
        let before_stale_status = store.history_status();
        let stale = store
            .commit_aux_editor_transaction(
                HistoryScope::Mode,
                Some(0),
                EditorCommitOrigin::LegacyAdapter("mode_stale_test".to_string()),
                &[],
                |data| {
                    data.selected_key_type = next_mode;
                    Ok(())
                },
            )
            .unwrap_err();
        assert_eq!(
            stale.error_code,
            EditorCommitErrorCode::HistoryEpochConflict
        );
        assert!(stale.retryable);
        assert_eq!(
            stale
                .details
                .as_ref()
                .and_then(|details| details.current_history_epoch),
            Some(1)
        );
        assert_eq!(store.snapshot(), before_stale);
        let after_stale_status = store.history_status();
        assert_eq!(
            after_stale_status.history_revision,
            before_stale_status.history_revision
        );
        assert_eq!(
            after_stale_status.history_epoch,
            before_stale_status.history_epoch
        );
        assert_eq!(after_stale_status.can_undo, before_stale_status.can_undo);
        assert_eq!(after_stale_status.can_redo, before_stale_status.can_redo);
        assert_eq!(after_stale_status.busy, before_stale_status.busy);
        assert_eq!(after_stale_status.truncated, before_stale_status.truncated);
        assert!(after_stale_status.status_seq > before_stale_status.status_seq);

        let busy_id = uuid::Uuid::new_v4().to_string();
        let busy_barrier = gate.close(&busy_id).unwrap();
        let busy = store
            .commit_aux_editor_transaction(
                HistoryScope::Mode,
                None,
                EditorCommitOrigin::LegacyAdapter("mode_busy_test".to_string()),
                &[],
                |data| Ok(data.selected_key_type.clone()),
            )
            .unwrap_err();
        assert_eq!(busy.error_code, EditorCommitErrorCode::HistoryInProgress);
        assert!(busy.retryable);
        drop(busy_barrier);

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn custom_tabs_history_restores_typed_state_and_editor_revision() {
        let dir = test_directory("custom-tabs-history-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial = store.snapshot();
        let tab = CustomTab {
            id: "history-custom-tab".to_string(),
            name: "History Custom Tab".to_string(),
        };
        let tab_id = tab.id.clone();

        let transaction = store
            .commit_aux_editor_transaction(
                HistoryScope::CustomTabs,
                None,
                EditorCommitOrigin::LegacyAdapter("custom_tabs_history_test".to_string()),
                &[EditorField::Keys, EditorField::KeyPositions],
                |data| {
                    data.custom_tabs.push(tab);
                    data.keys.insert(tab_id.clone(), Vec::new());
                    data.key_positions.insert(tab_id.clone(), Vec::new());
                    data.selected_key_type = tab_id;
                    Ok(())
                },
            )
            .unwrap();
        assert_eq!(transaction.change.result.revision, 1);
        assert_eq!(
            transaction.change.result.changed_fields,
            vec![EditorField::Keys, EditorField::KeyPositions]
        );
        assert_eq!(
            transaction
                .change
                .history_status
                .as_ref()
                .unwrap()
                .history_revision,
            1
        );
        let changed = store.snapshot();
        drop(transaction);

        let undo_id = uuid::Uuid::new_v4().to_string();
        let gate = store.history_gate();
        let barrier = gate.close(&undo_id).unwrap();
        let current_counters = changed.key_counters.clone();
        let undo = store
            .apply_history_operation(HistoryDirection::Undo, &undo_id, &current_counters, || {})
            .unwrap();
        drop(barrier);
        let Some(HistoryAuxChange::CustomTabs {
            snapshot: restored, ..
        }) = undo.aux_change.as_ref()
        else {
            panic!("custom tabs history change expected");
        };
        assert_eq!(restored.custom_tabs, initial.custom_tabs);
        assert_eq!(restored.selected_key_type, initial.selected_key_type);
        assert_eq!(restored.document, EditorDocumentV1::from_store(&initial));
        assert_eq!(restored.key_counters, initial.key_counters);
        assert_eq!(store.snapshot().editor_revision, 2);
        assert_eq!(
            undo.change.as_ref().unwrap().event.as_ref().unwrap().origin,
            "historyUndo"
        );

        let redo_id = uuid::Uuid::new_v4().to_string();
        let redo_barrier = gate.close(&redo_id).unwrap();
        let current_counters = store.snapshot().key_counters;
        let redo = store
            .apply_history_operation(HistoryDirection::Redo, &redo_id, &current_counters, || {})
            .unwrap();
        drop(redo_barrier);
        assert!(matches!(
            redo.aux_change,
            Some(HistoryAuxChange::CustomTabs { .. })
        ));
        assert_eq!(
            EditorDocumentV1::from_store(&store.snapshot()),
            EditorDocumentV1::from_store(&changed)
        );
        assert_eq!(store.snapshot().custom_tabs, changed.custom_tabs);
        assert_eq!(
            store.snapshot().selected_key_type,
            changed.selected_key_type
        );
        assert_eq!(store.snapshot().editor_revision, 3);

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn custom_tab_delete_history_restores_note_css_and_change_projection() {
        let dir = test_directory("custom-tab-override-history-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let tab_id = "history-override-tab".to_string();
        let created_tab_id = tab_id.clone();
        let create = store
            .commit_aux_editor_transaction(
                HistoryScope::CustomTabs,
                None,
                EditorCommitOrigin::LegacyAdapter("custom_tab_override_create".to_string()),
                &[EditorField::Keys, EditorField::KeyPositions],
                |data| {
                    data.custom_tabs.push(CustomTab {
                        id: created_tab_id.clone(),
                        name: "Override History".to_string(),
                    });
                    data.keys.insert(created_tab_id.clone(), Vec::new());
                    data.key_positions
                        .insert(created_tab_id.clone(), Vec::new());
                    data.selected_key_type = created_tab_id;
                    Ok(())
                },
            )
            .unwrap();
        drop(create);

        let css = TabCss {
            path: Some(dir.join("restored.css").to_string_lossy().to_string()),
            content: ".restored {}".to_string(),
            enabled: true,
        };
        let note = TabNoteSettings::default();
        store
            .update(|data| {
                data.tab_css_overrides.insert(tab_id.clone(), css.clone());
                data.tab_note_overrides.insert(tab_id.clone(), note.clone());
            })
            .unwrap();

        let deleted_tab_id = tab_id.clone();
        let delete = store
            .commit_aux_editor_transaction(
                HistoryScope::CustomTabs,
                None,
                EditorCommitOrigin::LegacyAdapter("custom_tab_override_delete".to_string()),
                &[
                    EditorField::Keys,
                    EditorField::KeyPositions,
                    EditorField::StatPositions,
                    EditorField::GraphPositions,
                    EditorField::KnobPositions,
                    EditorField::LayerGroups,
                ],
                |data| {
                    data.custom_tabs.retain(|tab| tab.id != deleted_tab_id);
                    data.keys.remove(&deleted_tab_id);
                    data.key_positions.remove(&deleted_tab_id);
                    data.stat_positions.remove(&deleted_tab_id);
                    data.graph_positions.remove(&deleted_tab_id);
                    data.knob_positions.remove(&deleted_tab_id);
                    data.layer_groups.remove(&deleted_tab_id);
                    data.key_counters.remove(&deleted_tab_id);
                    data.tab_css_overrides.remove(&deleted_tab_id);
                    data.tab_note_overrides.remove(&deleted_tab_id);
                    data.selected_key_type = "4key".to_string();
                    Ok(())
                },
            )
            .unwrap();
        drop(delete);
        assert!(!store.snapshot().tab_css_overrides.contains_key(&tab_id));
        assert!(!store.snapshot().tab_note_overrides.contains_key(&tab_id));

        let other_tab_id = "4key".to_string();
        let other_css = TabCss {
            path: Some(dir.join("other.css").to_string_lossy().to_string()),
            content: ".other {}".to_string(),
            enabled: false,
        };
        let other_note = TabNoteSettings {
            speed: Some(777),
            ..TabNoteSettings::default()
        };
        store
            .update(|data| {
                data.tab_css_overrides
                    .insert(other_tab_id.clone(), other_css.clone());
                data.tab_note_overrides
                    .insert(other_tab_id.clone(), other_note.clone());
            })
            .unwrap();

        let gate = store.history_gate();
        let undo_id = uuid::Uuid::new_v4().to_string();
        let undo_barrier = gate.close(&undo_id).unwrap();
        let current_counters = store.snapshot().key_counters;
        let undo = store
            .apply_history_operation(HistoryDirection::Undo, &undo_id, &current_counters, || {})
            .unwrap();
        drop(undo_barrier);
        let Some(HistoryAuxChange::CustomTabs {
            snapshot,
            changed_tab_css_ids,
        }) = undo.aux_change.as_ref()
        else {
            panic!("custom tabs history change expected");
        };
        assert_eq!(snapshot.tab_css_patch[&tab_id], Some(css.clone()));
        assert_eq!(snapshot.tab_note_patch[&tab_id], Some(note.clone()));
        assert_eq!(changed_tab_css_ids, std::slice::from_ref(&tab_id));
        assert_eq!(store.snapshot().tab_css_overrides[&tab_id], css);
        assert_eq!(store.snapshot().tab_note_overrides[&tab_id], note);
        assert_eq!(store.snapshot().tab_css_overrides[&other_tab_id], other_css);
        assert_eq!(
            store.snapshot().tab_note_overrides[&other_tab_id],
            other_note
        );

        let redo_id = uuid::Uuid::new_v4().to_string();
        let redo_barrier = gate.close(&redo_id).unwrap();
        let current_counters = store.snapshot().key_counters;
        let redo = store
            .apply_history_operation(HistoryDirection::Redo, &redo_id, &current_counters, || {})
            .unwrap();
        drop(redo_barrier);
        let Some(HistoryAuxChange::CustomTabs {
            snapshot,
            changed_tab_css_ids,
        }) = redo.aux_change.as_ref()
        else {
            panic!("custom tabs history change expected");
        };
        assert_eq!(snapshot.tab_css_patch[&tab_id], None);
        assert_eq!(snapshot.tab_note_patch[&tab_id], None);
        assert_eq!(changed_tab_css_ids, std::slice::from_ref(&tab_id));
        assert!(!store.snapshot().tab_css_overrides.contains_key(&tab_id));
        assert!(!store.snapshot().tab_note_overrides.contains_key(&tab_id));
        assert_eq!(store.snapshot().tab_css_overrides[&other_tab_id], other_css);
        assert_eq!(
            store.snapshot().tab_note_overrides[&other_tab_id],
            other_note
        );

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn preset_full_history_restores_settings_and_preserves_redo_snapshot() {
        let dir = test_directory("preset-full-history-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let mode = store.snapshot().selected_key_type;
        let original_key = store.snapshot().keys[&mode][0].canonical();
        let initial_plugin = JsPlugin {
            id: "initial-plugin".to_string(),
            name: "Initial Plugin".to_string(),
            path: None,
            content: "initial".to_string(),
            enabled: true,
        };
        let initial_font = CustomFont {
            id: "initial-font".to_string(),
            font_type: FontType::Web,
            name: "InitialFont".to_string(),
            display_name: "Initial Font".to_string(),
            enabled: true,
            local_path: None,
            css_content: Some("initial-font-css".to_string()),
        };
        store
            .update(|data| {
                data.key_counters
                    .entry(mode.clone())
                    .or_default()
                    .insert(original_key.clone(), 3);
                data.use_custom_css = false;
                data.custom_css = CustomCss {
                    path: Some(dir.join("initial.css").to_string_lossy().to_string()),
                    content: ".initial {}".to_string(),
                };
                data.use_custom_js = false;
                data.custom_js.path = Some(dir.join("initial.js").to_string_lossy().to_string());
                data.custom_js.content = "initial();".to_string();
                data.custom_js.plugins = vec![initial_plugin.clone()];
                data.font_settings = FontSettings {
                    custom_fonts: vec![initial_font.clone()],
                };
                data.background_color = "#111111".to_string();
                data.note_settings.speed = 321;
                data.note_effect = false;
                data.laboratory_enabled = false;
                data.tab_note_overrides.insert(
                    mode.clone(),
                    TabNoteSettings {
                        speed: Some(333),
                        ..TabNoteSettings::default()
                    },
                );
                data.tab_css_overrides.insert(
                    mode.clone(),
                    TabCss {
                        path: Some(dir.join("initial-tab.css").to_string_lossy().to_string()),
                        content: ".initial-tab {}".to_string(),
                        enabled: true,
                    },
                );
            })
            .unwrap();
        let mut runtime_counters = store.snapshot().key_counters;
        runtime_counters
            .entry(mode.clone())
            .or_default()
            .insert(original_key.clone(), 11);
        let mut initial = PresetFullHistorySnapshot::from_store(&store.snapshot());
        initial.key_counters = runtime_counters.clone();

        let preset_key = "PresetHistoryKey".to_string();
        let preset_plugin = JsPlugin {
            id: "preset-plugin".to_string(),
            name: "Preset Plugin".to_string(),
            path: None,
            content: "preset".to_string(),
            enabled: false,
        };
        let preset_font = CustomFont {
            id: "preset-font".to_string(),
            font_type: FontType::Web,
            name: "PresetFont".to_string(),
            display_name: "Preset Font".to_string(),
            enabled: true,
            local_path: None,
            css_content: Some("preset-font-css".to_string()),
        };
        let transaction = store
            .commit_preset_editor_transaction(
                EditorCommitOrigin::LegacyAdapter("preset_full_history_test".to_string()),
                &[EditorField::Keys],
                runtime_counters,
                |data| {
                    data.keys.get_mut(&mode).unwrap()[0] = preset_key.clone().into();
                    data.use_custom_css = true;
                    data.custom_css = CustomCss {
                        path: Some(dir.join("preset.css").to_string_lossy().to_string()),
                        content: ".preset {}".to_string(),
                    };
                    data.use_custom_js = true;
                    data.custom_js.path = Some(dir.join("preset.js").to_string_lossy().to_string());
                    data.custom_js.content = "preset();".to_string();
                    data.custom_js.plugins = vec![preset_plugin.clone()];
                    data.font_settings = FontSettings {
                        custom_fonts: vec![preset_font.clone()],
                    };
                    data.background_color = "#abcdef".to_string();
                    data.note_settings.speed = 654;
                    data.note_effect = true;
                    data.laboratory_enabled = true;
                    data.tab_note_overrides.insert(
                        mode.clone(),
                        TabNoteSettings {
                            speed: Some(777),
                            ..TabNoteSettings::default()
                        },
                    );
                    data.tab_css_overrides.insert(
                        mode.clone(),
                        TabCss {
                            path: Some(dir.join("preset-tab.css").to_string_lossy().to_string()),
                            content: ".preset-tab {}".to_string(),
                            enabled: false,
                        },
                    );
                    Ok(())
                },
            )
            .unwrap();
        assert_eq!(
            transaction
                .change
                .history_status
                .as_ref()
                .unwrap()
                .history_revision,
            1
        );
        assert_eq!(transaction.change.result.revision, 1);
        drop(transaction);
        let preset = PresetFullHistorySnapshot::from_store(&store.snapshot());

        let gate = store.history_gate();
        let undo_id = uuid::Uuid::new_v4().to_string();
        let undo_barrier = gate.close(&undo_id).unwrap();
        let current_counters = store.snapshot().key_counters;
        let undo = store
            .apply_history_operation(HistoryDirection::Undo, &undo_id, &current_counters, || {})
            .unwrap();
        drop(undo_barrier);
        let Some(HistoryAuxChange::PresetFull {
            snapshot,
            settings_diff,
            changed_tab_css_ids,
        }) = undo.aux_change.as_ref()
        else {
            panic!("preset full history change expected");
        };
        assert_eq!(snapshot.as_ref(), &initial);
        assert!(settings_diff.changed.use_custom_css.is_some());
        assert!(settings_diff.changed.custom_css.is_some());
        assert!(settings_diff.changed.use_custom_js.is_some());
        assert!(settings_diff.changed.custom_js.is_some());
        assert!(settings_diff.changed.font_settings.is_some());
        assert!(settings_diff.changed.background_color.is_some());
        assert!(settings_diff.changed.note_settings.is_some());
        assert!(settings_diff.changed.note_effect.is_some());
        assert!(settings_diff.changed.laboratory_enabled.is_some());
        assert_eq!(changed_tab_css_ids, std::slice::from_ref(&mode));
        assert_eq!(
            PresetFullHistorySnapshot::from_store(&store.snapshot()),
            initial
        );
        assert_eq!(store.snapshot().editor_revision, 2);

        let redo_id = uuid::Uuid::new_v4().to_string();
        let redo_barrier = gate.close(&redo_id).unwrap();
        let current_counters = store.snapshot().key_counters;
        let redo = store
            .apply_history_operation(HistoryDirection::Redo, &redo_id, &current_counters, || {})
            .unwrap();
        drop(redo_barrier);
        let Some(HistoryAuxChange::PresetFull {
            snapshot,
            settings_diff,
            changed_tab_css_ids,
        }) = redo.aux_change.as_ref()
        else {
            panic!("preset full redo change expected");
        };
        assert_eq!(snapshot.as_ref(), &preset);
        assert_eq!(
            settings_diff.changed.background_color.as_deref(),
            Some("#abcdef")
        );
        assert_eq!(changed_tab_css_ids, std::slice::from_ref(&mode));
        assert_eq!(
            PresetFullHistorySnapshot::from_store(&store.snapshot()),
            preset
        );
        assert_eq!(store.snapshot().editor_revision, 3);

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn oversized_aux_record_truncates_history_after_persisting_mutation() {
        let dir = test_directory("aux-history-truncation-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial_mode = store.snapshot().selected_key_type;
        let next_mode = if initial_mode == "8key" {
            "4key".to_string()
        } else {
            "8key".to_string()
        };
        store
            .state
            .write()
            .history
            .set_limits_for_test(1, 32 * 1024 * 1024, 50);

        let transaction = store
            .commit_aux_editor_transaction(
                HistoryScope::Mode,
                None,
                EditorCommitOrigin::LegacyAdapter("mode_truncation_test".to_string()),
                &[],
                |data| {
                    data.selected_key_type = next_mode.clone();
                    Ok(())
                },
            )
            .unwrap();
        let status = transaction.change.history_status.unwrap();

        assert_eq!(store.snapshot().selected_key_type, next_mode);
        assert_eq!(status.history_revision, 1);
        assert!(!status.can_undo);
        assert!(!status.can_redo);
        assert_eq!(status.truncated.unwrap().reason, HISTORY_ENTRY_TOO_LARGE);

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn history_undo_redo_restore_revision_event_and_reject_stale_commit() {
        let dir = test_directory("editor-history-undo-redo-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial_dx = store.editor_get().document.key_positions["4key"][0].dx;
        let committed_dx = initial_dx + 18.0;
        let commit = editor_request(
            0,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, committed_dx),
        );
        store.commit_editor_document(commit).unwrap();

        let undo_id = uuid::Uuid::new_v4().to_string();
        let gate = store.history_gate();
        let barrier = gate.close(&undo_id).unwrap();
        let cancel_count = std::cell::Cell::new(0);
        let current_counters = store.snapshot().key_counters;
        let undo = store
            .apply_history_operation(HistoryDirection::Undo, &undo_id, &current_counters, || {
                cancel_count.set(cancel_count.get() + 1);
            })
            .unwrap();
        drop(barrier);

        assert_eq!(cancel_count.get(), 1);
        assert!(!undo.status.busy);
        assert_eq!(undo.change.as_ref().unwrap().result.revision, 2);
        assert_eq!(
            undo.change.as_ref().unwrap().event.as_ref().unwrap().origin,
            "historyUndo"
        );
        assert_eq!(
            store.editor_get().document.key_positions["4key"][0].dx,
            initial_dx
        );
        assert!(!undo.status.can_undo);
        assert!(undo.status.can_redo);

        let replay_barrier = gate.close(&undo_id).unwrap();
        let current_counters = store.snapshot().key_counters;
        let replay = store
            .apply_history_operation(HistoryDirection::Undo, &undo_id, &current_counters, || {
                cancel_count.set(cancel_count.get() + 1);
            })
            .unwrap();
        drop(replay_barrier);
        assert!(replay.replayed);
        assert_eq!(cancel_count.get(), 1);
        assert_eq!(store.editor_get().revision, 2);

        let stale = editor_request(
            1,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, committed_dx + 5.0),
        );
        let stale_error = store.commit_editor_document(stale).unwrap_err();
        assert_eq!(
            stale_error.error_code,
            EditorCommitErrorCode::RevisionConflict
        );

        let redo_id = uuid::Uuid::new_v4().to_string();
        let redo_barrier = gate.close(&redo_id).unwrap();
        let current_counters = store.snapshot().key_counters;
        let redo = store
            .apply_history_operation(HistoryDirection::Redo, &redo_id, &current_counters, || {})
            .unwrap();
        drop(redo_barrier);
        assert_eq!(redo.change.as_ref().unwrap().result.revision, 3);
        assert_eq!(
            redo.change.as_ref().unwrap().event.as_ref().unwrap().origin,
            "historyRedo"
        );
        assert_eq!(
            store.editor_get().document.key_positions["4key"][0].dx,
            committed_dx
        );
        assert!(redo.status.can_undo);
        assert!(!redo.status.can_redo);

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn oversized_recorded_commit_clears_history_after_persisting_mutation() {
        let dir = test_directory("editor-history-truncation-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial_dx = store.editor_get().document.key_positions["4key"][0].dx;
        let first = editor_request(
            0,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, initial_dx + 1.0),
        );
        store.commit_editor_document(first).unwrap();
        store
            .state
            .write()
            .history
            .set_limits_for_test(1, 32 * 1024 * 1024, 50);

        let second = editor_request(
            1,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, initial_dx + 2.0),
        );
        let change = store.commit_editor_document(second).unwrap();
        let status = change.history_status.unwrap();

        assert_eq!(change.result.revision, 2);
        assert_eq!(
            store.editor_get().document.key_positions["4key"][0].dx,
            initial_dx + 2.0
        );
        assert_eq!(status.history_revision, 2);
        assert!(!status.can_undo);
        assert!(!status.can_redo);
        assert_eq!(status.truncated.unwrap().reason, "HISTORY_ENTRY_TOO_LARGE");

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn editor_history_undo_does_not_restore_key_counters() {
        let dir = test_directory("editor-history-counter-scope-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let before = store.snapshot();
        let old_key = before.keys["4key"][0].canonical();
        let new_key = "HistoryCounterScopeKey".to_string();
        let mut keys = before.keys;
        keys.get_mut("4key").unwrap()[0] = new_key.clone().into();
        let commit = editor_request(
            0,
            uuid::Uuid::new_v4().to_string(),
            EditorPatchV1 {
                keys: Some(keys),
                ..EditorPatchV1::default()
            },
        );
        store.commit_editor_document(commit).unwrap();
        let counters_after_commit = store.snapshot().key_counters;
        assert!(counters_after_commit["4key"].contains_key(&new_key));
        assert!(!counters_after_commit["4key"].contains_key(&old_key));

        let operation_id = uuid::Uuid::new_v4().to_string();
        let gate = store.history_gate();
        let barrier = gate.close(&operation_id).unwrap();
        let current_counters = store.snapshot().key_counters;
        store
            .apply_history_operation(
                HistoryDirection::Undo,
                &operation_id,
                &current_counters,
                || {},
            )
            .unwrap();
        drop(barrier);

        let restored = store.snapshot();
        assert_eq!(restored.keys["4key"][0].canonical(), old_key);
        assert_eq!(restored.key_counters, counters_after_commit);

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn history_undo_rejects_oversized_opposite_without_state_change() {
        let dir = test_directory("editor-history-undo-budget-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial_dx = store.editor_get().document.key_positions["4key"][0].dx;
        let commit = editor_request(
            0,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, initial_dx + 9.0),
        );
        store.commit_editor_document(commit).unwrap();
        store
            .state
            .write()
            .history
            .set_limits_for_test(1, 32 * 1024 * 1024, 50);
        let before_store = store.snapshot();
        let before_status = store.history_status();

        let operation_id = uuid::Uuid::new_v4().to_string();
        let gate = store.history_gate();
        let barrier = gate.close(&operation_id).unwrap();
        assert!(store.history_status().busy);
        let current_counters = store.snapshot().key_counters;
        let error = store
            .apply_history_operation(
                HistoryDirection::Undo,
                &operation_id,
                &current_counters,
                || {},
            )
            .unwrap_err();
        drop(barrier);
        assert!(!store.history_status().busy);

        assert_eq!(error, "HISTORY_ENTRY_TOO_LARGE");
        assert_eq!(store.snapshot(), before_store);
        let after_status = store.history_status();
        assert_eq!(
            after_status.history_revision,
            before_status.history_revision
        );
        assert_eq!(after_status.history_epoch, before_status.history_epoch + 1);
        assert_eq!(after_status.can_undo, before_status.can_undo);
        assert_eq!(after_status.can_redo, before_status.can_redo);
        assert_eq!(after_status.truncated, before_status.truncated);

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn editor_mutation_is_rejected_while_history_gate_is_closed() {
        let dir = test_directory("editor-history-admission-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let operation_id = uuid::Uuid::new_v4().to_string();
        let gate = store.history_gate();
        let barrier = gate.close(&operation_id).unwrap();
        let request = editor_request(
            0,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, 42.0),
        );

        let error = store.commit_editor_document(request).unwrap_err();
        assert!(error.retryable);
        assert_eq!(error.error_code, EditorCommitErrorCode::HistoryInProgress);
        assert_eq!(
            serde_json::to_value(&error).unwrap()["errorCode"],
            "HISTORY_IN_PROGRESS"
        );
        drop(barrier);

        store.flush_and_shutdown().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn strict_commit_revalidates_admission_after_waiting_for_store_lock() {
        let dir = test_directory("editor-history-admission-revalidation-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = Arc::new(AppStore::initialize_in_dir(&dir).unwrap());
        let initial_dx = store.editor_get().document.key_positions["4key"][0].dx;
        let request = editor_request(
            0,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, initial_dx + 7.0),
        );
        let admission = store.admit_editor_mutation().unwrap();
        let store_guard = store.state.write();
        let commit_store = Arc::clone(&store);
        let (commit_started_tx, commit_started_rx) = mpsc::channel();
        let commit = thread::spawn(move || {
            commit_started_tx.send(()).unwrap();
            commit_store.commit_editor_document_admitted(request, &admission)
        });
        commit_started_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();

        let gate = store.history_gate();
        let barrier_gate = Arc::clone(&gate);
        let operation_id = uuid::Uuid::new_v4().to_string();
        let (barrier_ready_tx, barrier_ready_rx) = mpsc::channel();
        let (release_barrier_tx, release_barrier_rx) = mpsc::channel();
        let barrier = thread::spawn(move || {
            let lease = barrier_gate.close(&operation_id).unwrap();
            barrier_ready_tx.send(()).unwrap();
            release_barrier_rx.recv().unwrap();
            drop(lease);
        });

        let deadline = Instant::now() + Duration::from_secs(2);
        while !gate.is_closed() {
            assert!(Instant::now() < deadline, "history gate did not close");
            thread::yield_now();
        }
        assert!(matches!(
            barrier_ready_rx.try_recv(),
            Err(mpsc::TryRecvError::Empty)
        ));

        drop(store_guard);
        let error = commit.join().unwrap().unwrap_err();
        assert_eq!(error.error_code, EditorCommitErrorCode::HistoryInProgress);
        assert!(error.retryable);
        barrier_ready_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
        release_barrier_tx.send(()).unwrap();
        barrier.join().unwrap();

        assert_eq!(store.editor_get().revision, 0);
        assert_eq!(store.history_status().history_revision, 0);
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn aux_mutation_revalidates_admission_after_waiting_for_store_lock() {
        let dir = test_directory("aux-history-admission-revalidation-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = Arc::new(AppStore::initialize_in_dir(&dir).unwrap());
        let initial_mode = store.snapshot().selected_key_type;
        let next_mode = if initial_mode == "8key" {
            "4key".to_string()
        } else {
            "8key".to_string()
        };
        let store_guard = store.state.write();
        let mutation_store = Arc::clone(&store);
        let (mutation_started_tx, mutation_started_rx) = mpsc::channel();
        let mutation = thread::spawn(move || {
            mutation_started_tx.send(()).unwrap();
            mutation_store.commit_aux_editor_transaction(
                HistoryScope::Mode,
                None,
                EditorCommitOrigin::LegacyAdapter("aux_revalidation_test".to_string()),
                &[],
                |data| {
                    data.selected_key_type = next_mode;
                    Ok(())
                },
            )
        });
        mutation_started_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();

        let gate = store.history_gate();
        let admission_deadline = Instant::now() + Duration::from_secs(2);
        while gate.active_mutations() == 0 {
            assert!(
                Instant::now() < admission_deadline,
                "aux mutation was not admitted"
            );
            thread::yield_now();
        }
        let barrier_gate = Arc::clone(&gate);
        let operation_id = uuid::Uuid::new_v4().to_string();
        let (barrier_ready_tx, barrier_ready_rx) = mpsc::channel();
        let (release_barrier_tx, release_barrier_rx) = mpsc::channel();
        let barrier = thread::spawn(move || {
            let lease = barrier_gate.close(&operation_id).unwrap();
            barrier_ready_tx.send(()).unwrap();
            release_barrier_rx.recv().unwrap();
            drop(lease);
        });

        let deadline = Instant::now() + Duration::from_secs(2);
        while !gate.is_closed() {
            assert!(Instant::now() < deadline, "history gate did not close");
            thread::yield_now();
        }
        assert!(matches!(
            barrier_ready_rx.try_recv(),
            Err(mpsc::TryRecvError::Empty)
        ));

        drop(store_guard);
        let error = mutation.join().unwrap().unwrap_err();
        assert_eq!(error.error_code, EditorCommitErrorCode::HistoryInProgress);
        assert!(error.retryable);
        barrier_ready_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
        release_barrier_tx.send(()).unwrap();
        barrier.join().unwrap();

        assert_eq!(store.snapshot().selected_key_type, initial_mode);
        assert_eq!(store.history_status().history_revision, 0);
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn css_watcher_reload_revalidates_after_waiting_for_store_lock() {
        let dir = test_directory("css-watcher-admission-revalidation-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = Arc::new(AppStore::initialize_in_dir(&dir).unwrap());
        let watched_path = "/tmp/dmnote-watcher-revalidation.css";
        store
            .update(|data| {
                data.use_custom_css = true;
                data.custom_css = CustomCss {
                    path: Some(watched_path.to_string()),
                    content: "before".to_string(),
                };
            })
            .unwrap();
        let store_guard = store.state.write();
        let mutation_store = Arc::clone(&store);
        let loaded = ValidatedCssFile {
            canonical_path: watched_path.to_string(),
            content: "blocked-reload".to_string(),
        };
        let mutation =
            thread::spawn(move || commit_css_reload(&mutation_store, watched_path, &loaded));

        let gate = store.history_gate();
        let admission_deadline = Instant::now() + Duration::from_secs(2);
        while gate.active_mutations() == 0 {
            assert!(
                Instant::now() < admission_deadline,
                "CSS watcher reload was not admitted"
            );
            thread::yield_now();
        }
        let barrier_gate = Arc::clone(&gate);
        let operation_id = uuid::Uuid::new_v4().to_string();
        let (barrier_ready_tx, barrier_ready_rx) = mpsc::channel();
        let (release_barrier_tx, release_barrier_rx) = mpsc::channel();
        let barrier = thread::spawn(move || {
            let lease = barrier_gate.close(&operation_id).unwrap();
            barrier_ready_tx.send(()).unwrap();
            release_barrier_rx.recv().unwrap();
            drop(lease);
        });

        let deadline = Instant::now() + Duration::from_secs(2);
        while !gate.is_closed() {
            assert!(Instant::now() < deadline, "history gate did not close");
            thread::yield_now();
        }
        assert!(matches!(
            barrier_ready_rx.try_recv(),
            Err(mpsc::TryRecvError::Empty)
        ));

        drop(store_guard);
        let error = mutation.join().unwrap().unwrap_err();
        assert_eq!(error.error_code, EditorCommitErrorCode::HistoryInProgress);
        assert!(error.retryable);
        barrier_ready_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
        release_barrier_tx.send(()).unwrap();
        barrier.join().unwrap();

        assert_eq!(store.snapshot().custom_css.content, "before");
        assert_eq!(store.state.read().history.history_revision(), 0);
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn legacy_keys_publication_drains_before_history_restore() {
        let dir = test_directory("legacy-editor-publication-drain-test");
        std::fs::create_dir_all(&dir).unwrap();
        let state =
            Arc::new(AppState::initialize(AppStore::initialize_in_dir(&dir).unwrap()).unwrap());
        let initial = state.store.snapshot();
        let mode = initial.selected_key_type.clone();
        let original_key = initial.keys[&mode][0].canonical();

        let mut strict_keys = initial.keys.clone();
        strict_keys.get_mut(&mode).unwrap()[0] = "StrictHistoryKey".into();
        state
            .store
            .commit_editor_document(editor_request(
                0,
                uuid::Uuid::new_v4().to_string(),
                EditorPatchV1 {
                    keys: Some(strict_keys),
                    ..EditorPatchV1::default()
                },
            ))
            .unwrap();

        let legacy_key = "LegacyPublishedKey".to_string();
        let mut legacy_keys = state.store.snapshot().keys;
        legacy_keys.get_mut(&mode).unwrap()[0] = legacy_key.clone().into();
        let transaction = state
            .store
            .commit_legacy_editor_transaction(
                EditorCommitOrigin::LegacyAdapter("legacy_publish_test".to_string()),
                &[EditorField::Keys],
                move |data| {
                    data.keys = legacy_keys;
                    Ok(())
                },
            )
            .unwrap();
        let expected_counters = transaction.change.key_counters.clone();

        let events = Arc::new(Mutex::new(Vec::new()));
        let (runtime_started_tx, runtime_started_rx) = mpsc::channel();
        let (release_runtime_tx, release_runtime_rx) = mpsc::channel();
        let emitter = TestCounterEmitter::blocking_snapshot(
            Arc::clone(&events),
            mode.clone(),
            legacy_key.clone(),
            runtime_started_tx,
            release_runtime_rx,
        );
        let publisher_state = Arc::clone(&state);
        let publisher_events = Arc::clone(&events);
        let publisher = thread::spawn(move || {
            publisher_state
                .apply_committed_editor_key_runtime(
                    &emitter,
                    transaction.change.runtime_publication_generation,
                    &transaction.change.document.keys,
                    &transaction.change.selected_key_type,
                    &transaction.change.key_counters,
                )
                .unwrap();
            publisher_events
                .lock()
                .unwrap()
                .push("legacy:published".to_string());
            drop(transaction);
        });
        runtime_started_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();

        let gate = state.store.history_gate();
        let undo_gate = Arc::clone(&gate);
        let undo_state = Arc::clone(&state);
        let undo_events = Arc::clone(&events);
        let operation_id = uuid::Uuid::new_v4().to_string();
        let (undo_done_tx, undo_done_rx) = mpsc::channel();
        let undo = thread::spawn(move || {
            let barrier = undo_gate.close(&operation_id).unwrap();
            let counter_guard = undo_state.lock_key_counters_for_history();
            let current_counters = counter_guard.clone();
            let outcome = undo_state
                .store
                .apply_history_operation(
                    HistoryDirection::Undo,
                    &operation_id,
                    &current_counters,
                    || {},
                )
                .unwrap();
            let change = outcome.change.as_ref().unwrap();
            undo_state.apply_committed_editor_keys_without_counters(
                outcome.runtime_publication_generation,
                &change.document.keys,
                &change.selected_key_type,
            );
            undo_events
                .lock()
                .unwrap()
                .push("undo:restored".to_string());
            drop(counter_guard);
            drop(barrier);
            undo_done_tx.send(()).unwrap();
            outcome
        });

        let deadline = Instant::now() + Duration::from_secs(2);
        while !gate.is_closed() {
            assert!(Instant::now() < deadline, "history gate did not close");
            thread::yield_now();
        }
        assert!(matches!(
            undo_done_rx.try_recv(),
            Err(mpsc::TryRecvError::Empty)
        ));

        release_runtime_tx.send(()).unwrap();
        publisher.join().unwrap();
        undo_done_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let outcome = undo.join().unwrap();

        assert_eq!(outcome.change.unwrap().result.revision, 3);
        assert_eq!(
            state.store.snapshot().keys[&mode][0].canonical(),
            original_key
        );
        assert_eq!(state.snapshot_key_counters(), expected_counters);
        assert!(state.keyboard.register_key_down(&mode, &original_key));
        assert!(!state.keyboard.register_key_down(&mode, &legacy_key));
        assert_eq!(
            *events.lock().unwrap(),
            vec![
                "snapshot:0".to_string(),
                "legacy:published".to_string(),
                "undo:restored".to_string(),
            ]
        );

        state.shutdown();
        drop(state);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn stale_key_publisher_cannot_overwrite_newer_counter_runtime() {
        let dir = test_directory("stale-key-counter-publication-test");
        std::fs::create_dir_all(&dir).unwrap();
        let state = AppState::initialize(AppStore::initialize_in_dir(&dir).unwrap()).unwrap();
        let initial = state.store.snapshot();
        let mode = initial.selected_key_type.clone();
        let old_key = initial.keys[&mode][0].canonical();
        let new_key = "PublicationOrderedKey".to_string();
        let mut changed_keys = initial.keys;
        changed_keys.get_mut(&mode).unwrap()[0] = new_key.clone().into();

        let stale_transaction = state
            .store
            .commit_legacy_editor_transaction(
                EditorCommitOrigin::LegacyAdapter("stale_key_publisher_test".to_string()),
                &[EditorField::Keys],
                move |data| {
                    data.keys = changed_keys;
                    Ok(())
                },
            )
            .unwrap();
        assert!(state.keyboard.register_key_down(&mode, &old_key));
        assert!(!state.keyboard.register_key_down(&mode, &new_key));

        let events = Arc::new(Mutex::new(Vec::new()));
        let counter_emitter =
            TestCounterEmitter::new(Arc::clone(&events), mode.clone(), new_key.clone());
        let mut newer_counters = state.snapshot_key_counters();
        newer_counters.remove(&mode);
        newer_counters.insert(mode.clone(), [(new_key.clone(), 9)].into_iter().collect());
        let counter_mutation = state
            .replace_key_counters(&counter_emitter, newer_counters, None)
            .unwrap();
        assert_eq!(counter_mutation.counters[&mode][&new_key], 9);
        drop(counter_mutation);
        events.lock().unwrap().clear();

        let stale_emitter =
            TestCounterEmitter::new(Arc::clone(&events), mode.clone(), new_key.clone());
        state
            .apply_committed_editor_key_runtime(
                &stale_emitter,
                stale_transaction.change.runtime_publication_generation,
                &stale_transaction.change.document.keys,
                &stale_transaction.change.selected_key_type,
                &stale_transaction.change.key_counters,
            )
            .unwrap();
        drop(stale_transaction);

        assert_eq!(state.snapshot_key_counters()[&mode][&new_key], 9);
        assert_eq!(state.store.snapshot().key_counters[&mode][&new_key], 9);
        assert_eq!(state.keyboard.pressed_keys(), vec![new_key.clone()]);
        assert!(state.keyboard.register_key_up(&mode, &new_key));
        assert!(state.keyboard.register_key_down(&mode, &new_key));
        assert!(!state.keyboard.register_key_down(&mode, &old_key));
        assert!(events.lock().unwrap().is_empty());

        state.shutdown();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn editor_commit_gradient_repair_keeps_disk_document_and_event_identical() {
        let dir = test_directory("editor-gradient-canonicalization-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let mut positions = store.editor_get().document.key_positions;
        let position = &mut positions.get_mut("4key").unwrap()[0];
        position.background_color = Some("#BADBAD".to_string());
        position.background_gradient = Some(
            serde_json::from_value(json!({
                "type": "linear",
                "stops": [
                    { "color": "rgba(90, 162, 247, 1)", "pos": 1.2 },
                    { "color": "rgba(139, 92, 246, 1)", "pos": -0.1 }
                ]
            }))
            .unwrap(),
        );
        position.counter.fill.idle = "#FFFFFF".to_string();
        position.counter.fill_idle_gradient = Some(
            serde_json::from_value(json!({
                "angle": 450,
                "stops": [
                    { "color": "#FFFFFF80", "pos": 0 },
                    { "color": "rgba(0, 0, 0, 0)", "pos": 1 }
                ]
            }))
            .unwrap(),
        );
        let request = editor_request(
            0,
            uuid::Uuid::new_v4().to_string(),
            EditorPatchV1 {
                key_positions: Some(positions),
                ..EditorPatchV1::default()
            },
        );

        let change = store.commit_editor_document(request).unwrap();
        let committed_position = &change.document.key_positions["4key"][0];
        assert_eq!(
            change.result.changed_fields,
            vec![EditorField::KeyPositions]
        );
        assert_eq!(
            committed_position
                .background_gradient
                .as_ref()
                .unwrap()
                .angle,
            90.0
        );
        assert_eq!(
            committed_position
                .background_gradient
                .as_ref()
                .unwrap()
                .stops[0]
                .pos,
            0.0
        );
        assert_eq!(
            committed_position.background_color.as_deref(),
            Some("rgba(139, 92, 246, 1)")
        );
        assert_eq!(
            committed_position.counter.fill.idle,
            "rgba(255,255,255,0.502)"
        );

        let event_positions = change
            .event
            .as_ref()
            .unwrap()
            .patch
            .key_positions
            .as_ref()
            .unwrap();
        assert_eq!(event_positions, &change.document.key_positions);
        assert_eq!(
            EditorDocumentV1::from_store(&store.snapshot()),
            change.document
        );

        let committed_document = change.document;
        store.flush_and_shutdown().unwrap();
        drop(store);
        let reloaded =
            crate::state::migration::load_store_from_path(&dir.join("store.json")).unwrap();
        assert!(!reloaded.needs_persist);
        assert_eq!(
            EditorDocumentV1::from_store(&reloaded.data),
            committed_document
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn invalid_gradient_preset_parse_failure_leaves_store_unchanged() {
        let dir = test_directory("invalid-gradient-preset-atomicity-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let before = store.snapshot();
        let persist_count = store.writer.persist_count();

        let parsed = serde_json::from_value::<crate::commands::preset::PresetFile>(json!({
            "keys": { "4key": ["Q"] },
            "keyPositions": {
                "4key": [{
                    "dx": 0,
                    "dy": 0,
                    "width": 60,
                    "count": 0,
                    "backgroundGradient": {
                        "angle": 90,
                        "stops": [{ "color": "#FFFFFF", "pos": 0 }]
                    }
                }]
            }
        }));

        assert!(parsed.is_err());
        assert_eq!(store.snapshot(), before);
        assert_eq!(store.writer.persist_count(), persist_count);
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn invalid_shadow_preset_read_failure_leaves_store_unchanged() {
        let dir = test_directory("invalid-shadow-preset-atomicity-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let before = store.snapshot();
        let persist_count = store.writer.persist_count();
        let source_path = dir.join("invalid-preset.json");

        for (source, expected_error) in [
            (
                r##"{
                    "keyPositions": {
                        "4key": [{
                            "dx": 0,
                            "dy": 0,
                            "width": 60,
                            "count": 0,
                            "shadow": {
                                "enabled": true,
                                "color": "#123456",
                                "offsetX": 0,
                                "offsetY": 0,
                                "blur": 100.1
                            }
                        }]
                    }
                }"##,
                "invalid-preset: keyPositions[\"4key\"][0].shadow.blur: must be a finite number between 0 and 100",
            ),
            (
                r##"{
                    "statPositions": {
                        "4key": [{
                            "statType": "kps",
                            "dx": 0,
                            "dy": 0,
                            "width": 60,
                            "count": 0,
                            "activeShadow": {
                                "enabled": true,
                                "color": "#123456",
                                "offsetX": -100.1,
                                "offsetY": 0,
                                "blur": 12
                            }
                        }]
                    }
                }"##,
                "invalid-preset: statPositions[\"4key\"][0].activeShadow.offsetX: must be a finite number between -100 and 100",
            ),
        ] {
            std::fs::write(&source_path, source).unwrap();
            let error = crate::commands::preset::load::read_preset_file_for_simulation(
                &source_path,
            )
            .err()
            .expect("invalid visual effect preset must be rejected")
            .to_string();

            assert_eq!(error, expected_error);
            assert_eq!(store.snapshot(), before);
            assert_eq!(store.writer.persist_count(), persist_count);
        }

        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn strict_editor_noop_is_acknowledged_without_persist_or_event() {
        let dir = test_directory("strict-editor-noop-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let persist_count = store.writer.persist_count();
        let request = editor_request(
            0,
            uuid::Uuid::new_v4().to_string(),
            EditorPatchV1::default(),
        );

        let change = store.commit_editor_document(request).unwrap();

        assert_eq!(change.result.revision, 0);
        assert!(change.result.changed_fields.is_empty());
        assert!(change.event.is_none());
        assert!(!change.replayed);
        assert_eq!(store.writer.persist_count(), persist_count);
        assert_eq!(store.snapshot().editor_revision, 0);
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn strict_editor_conflict_does_not_persist() {
        let dir = test_directory("strict-editor-conflict-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let persist_count = store.writer.persist_count();
        let error = store
            .commit_editor_document(editor_request(
                1,
                uuid::Uuid::new_v4().to_string(),
                position_patch(&store, 123.0),
            ))
            .unwrap_err();

        assert_eq!(error.error_code, EditorCommitErrorCode::RevisionConflict);
        assert_eq!(error.details.unwrap().current_revision, Some(0));
        assert_eq!(store.writer.persist_count(), persist_count);
        assert_eq!(store.snapshot().editor_revision, 0);
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn strict_editor_io_failure_is_not_committed_or_acknowledged() {
        let dir = test_directory("strict-editor-io-failure-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let before = store.snapshot();
        let disk_before = std::fs::read(dir.join("store.json")).unwrap();
        let request = editor_request(
            0,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, 456.0),
        );

        store.writer.fail_next_persist();
        let error = store.commit_editor_document(request.clone()).unwrap_err();
        assert_eq!(error.error_code, EditorCommitErrorCode::IoError);
        assert_eq!(store.snapshot(), before);
        assert_eq!(std::fs::read(dir.join("store.json")).unwrap(), disk_before);

        let retried = store.commit_editor_document(request).unwrap();
        assert_eq!(retried.result.revision, 1);
        assert_eq!(store.snapshot().key_positions["4key"][0].dx, 456.0);
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn strict_editor_structural_single_field_update_requires_pair() {
        let dir = test_directory("strict-editor-paired-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let before = store.snapshot();
        let mut keys = before.keys.clone();
        keys.get_mut("4key").unwrap().push("F5".into());
        let error = store
            .commit_editor_document(editor_request(
                0,
                uuid::Uuid::new_v4().to_string(),
                EditorPatchV1 {
                    keys: Some(keys),
                    ..EditorPatchV1::default()
                },
            ))
            .unwrap_err();

        assert_eq!(
            error.error_code,
            EditorCommitErrorCode::PairedUpdateRequired
        );
        assert_eq!(store.snapshot(), before);
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn strict_editor_retry_returns_original_ack_before_base_check() {
        let dir = test_directory("strict-editor-idempotency-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let request = editor_request(
            0,
            uuid::Uuid::new_v4().to_string(),
            position_patch(&store, 789.0),
        );
        let first = store.commit_editor_document(request.clone()).unwrap();
        let persist_count = store.writer.persist_count();

        let retry = store.commit_editor_document(request).unwrap();

        assert_eq!(retry.result, first.result);
        assert!(retry.event.is_none());
        assert!(retry.replayed);
        assert_eq!(store.writer.persist_count(), persist_count);
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn strict_editor_rejects_reused_mutation_id_with_different_request() {
        let dir = test_directory("strict-editor-mutation-reuse-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let mutation_id = uuid::Uuid::new_v4().to_string();
        store
            .commit_editor_document(editor_request(
                0,
                mutation_id.clone(),
                EditorPatchV1::default(),
            ))
            .unwrap();

        let error = store
            .commit_editor_document(editor_request(
                0,
                mutation_id,
                position_patch(&store, 321.0),
            ))
            .unwrap_err();
        assert_eq!(error.error_code, EditorCommitErrorCode::MutationIdReused);
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn mutation_ack_ring_retains_only_the_latest_32_results() {
        let dir = test_directory("strict-editor-ring-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let ids = (0..33)
            .map(|_| uuid::Uuid::new_v4().to_string())
            .collect::<Vec<_>>();
        for id in &ids {
            store
                .commit_editor_document(editor_request(0, id.clone(), EditorPatchV1::default()))
                .unwrap();
        }
        store
            .commit_editor_document(editor_request(
                0,
                uuid::Uuid::new_v4().to_string(),
                position_patch(&store, 654.0),
            ))
            .unwrap();

        let evicted = store
            .commit_editor_document(editor_request(0, ids[0].clone(), EditorPatchV1::default()))
            .unwrap_err();
        assert_eq!(evicted.error_code, EditorCommitErrorCode::RevisionConflict);

        let retained = store
            .commit_editor_document(editor_request(0, ids[32].clone(), EditorPatchV1::default()))
            .unwrap();
        assert_eq!(retained.result.revision, 0);
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn canonical_request_hash_makes_map_order_idempotent() {
        let dir = test_directory("strict-editor-canonical-hash-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let mutation_id = uuid::Uuid::new_v4().to_string();
        let current = store.snapshot().keys;
        let mut entries = current.into_iter().collect::<Vec<_>>();
        entries.sort_by(|left, right| left.0.cmp(&right.0));
        let forward = entries.iter().cloned().collect::<HashMap<_, _>>();
        let reverse = entries.into_iter().rev().collect::<HashMap<_, _>>();

        let first = store
            .commit_editor_document(editor_request(
                0,
                mutation_id.clone(),
                EditorPatchV1 {
                    keys: Some(forward),
                    ..EditorPatchV1::default()
                },
            ))
            .unwrap();
        let retry = store
            .commit_editor_document(editor_request(
                0,
                mutation_id,
                EditorPatchV1 {
                    keys: Some(reverse),
                    ..EditorPatchV1::default()
                },
            ))
            .unwrap();

        assert_eq!(retry.result, first.result);
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn editor_get_never_observes_a_revision_document_mismatch() {
        let dir = test_directory("editor-get-atomic-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = Arc::new(AppStore::initialize_in_dir(&dir).unwrap());
        let done = Arc::new(AtomicBool::new(false));
        let reader_store = Arc::clone(&store);
        let reader_done = Arc::clone(&done);
        let reader = std::thread::spawn(move || {
            while !reader_done.load(Ordering::Acquire) {
                let snapshot = reader_store.editor_get();
                if snapshot.revision > 0 {
                    assert_eq!(
                        snapshot.document.key_positions["4key"][0].dx,
                        10_000.0 + snapshot.revision as f64
                    );
                }
            }
        });

        for expected_revision in 1..=20 {
            let base = store.editor_get().revision;
            store
                .commit_editor_document(editor_request(
                    base,
                    uuid::Uuid::new_v4().to_string(),
                    position_patch(&store, 10_000.0 + expected_revision as f64),
                ))
                .unwrap();
        }
        done.store(true, Ordering::Release);
        reader.join().unwrap();
        let final_snapshot = store.editor_get();
        assert_eq!(final_snapshot.revision, 20);
        assert_eq!(
            final_snapshot.document.key_positions["4key"][0].dx,
            10_020.0
        );
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn metadata_only_legacy_transaction_persists_without_editor_revision_or_event() {
        let dir = test_directory("editor-metadata-only-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let persist_count = store.writer.persist_count();

        let transaction = store
            .commit_legacy_editor_transaction(
                EditorCommitOrigin::LegacyAdapter("metadata_test".to_string()),
                &[],
                |data| {
                    data.language = "en".to_string();
                    Ok(())
                },
            )
            .unwrap();

        assert_eq!(store.writer.persist_count(), persist_count + 1);
        assert_eq!(transaction.change.result.revision, 0);
        assert!(transaction.change.result.changed_fields.is_empty());
        assert!(transaction.change.event.is_none());
        assert_eq!(store.snapshot().language, "en");
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn strict_editor_commit_preserves_existing_ghost_modes_losslessly() {
        let dir = test_directory("editor-grandfather-test");
        std::fs::create_dir_all(&dir).unwrap();
        let mut data = super::initialize_default_state();
        data.keys
            .insert("ghost".to_string(), vec!["GhostKey".into()]);
        data.key_positions
            .insert("ghost".to_string(), vec![KeyPosition::default()]);
        let store = AppStore::new(dir.join("store.json"), data, false).unwrap();

        store
            .commit_editor_document(editor_request(
                0,
                uuid::Uuid::new_v4().to_string(),
                position_patch(&store, 222.0),
            ))
            .unwrap();

        let snapshot = store.snapshot();
        assert_eq!(snapshot.keys["ghost"], vec![KeySlot::from("GhostKey")]);
        assert_eq!(
            snapshot.key_positions["ghost"],
            vec![KeyPosition::default()]
        );
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn editor_get_exposes_recovered_safe_revision_after_loading_unsafe_wire_value() {
        let dir = test_directory("editor-revision-load-recovery-test");
        std::fs::create_dir_all(&dir).unwrap();
        let mut data = super::initialize_default_state();
        data.editor_revision = crate::state::editor::MAX_SAFE_EDITOR_REVISION + 1;
        data.key_positions.get_mut("4key").unwrap()[0].dx = 12_345.0;
        std::fs::write(
            dir.join("store.json"),
            serde_json::to_vec_pretty(&data).unwrap(),
        )
        .unwrap();

        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let editor = store.editor_get();

        assert_eq!(editor.revision, 0);
        assert_eq!(editor.document.key_positions["4key"][0].dx, 12_345.0);
        let on_disk: AppStoreData =
            serde_json::from_slice(&std::fs::read(dir.join("store.json")).unwrap()).unwrap();
        assert_eq!(on_disk.editor_revision, 0);
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn generic_update_cannot_mutate_editor_fields_or_revision() {
        let dir = test_directory("editor-generic-escape-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let before = store.snapshot();

        assert!(store
            .update(|data| data.key_positions.get_mut("4key").unwrap()[0].dx = 999.0)
            .is_err());
        assert!(store.update(|data| data.editor_revision += 1).is_err());
        assert_eq!(store.snapshot(), before);
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn paired_keys_update_returns_the_normalized_mode_for_runtime_sync() {
        let dir = test_directory("keys-update-mode-sync-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let custom_mode = "custom-mode".to_string();
        store
            .commit_legacy_editor_transaction(
                EditorCommitOrigin::LegacyAdapter("test_setup".to_string()),
                &[EditorField::Keys, EditorField::KeyPositions],
                |data| {
                    data.custom_tabs.push(CustomTab {
                        id: custom_mode.clone(),
                        name: "Custom".to_string(),
                    });
                    data.keys.insert(custom_mode.clone(), vec!["KeyA".into()]);
                    data.key_positions
                        .insert(custom_mode.clone(), vec![KeyPosition::default()]);
                    data.selected_key_type = custom_mode.clone();
                    Ok(())
                },
            )
            .unwrap();
        let initialized = store.snapshot();
        let keyboard = KeyboardManager::new(
            initialized.keys.clone(),
            initialized.selected_key_type.clone(),
        );

        let mut mappings = initialized.keys;
        mappings.remove(&custom_mode);
        let mut positions = initialized.key_positions;
        positions.remove(&custom_mode);
        let change = legacy_editor_commit(
            &store,
            &[EditorField::Keys, EditorField::KeyPositions],
            move |data| {
                data.keys = mappings;
                data.key_positions = positions;
            },
        )
        .unwrap();
        let updated = change.document.keys;
        let selected_key_type = change.selected_key_type;
        keyboard.update_mappings_and_set_mode(updated, selected_key_type.clone());

        assert_eq!(selected_key_type, "4key");
        assert_eq!(store.snapshot().selected_key_type, "4key");
        assert_eq!(keyboard.current_mode(), "4key");

        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn keys_with_positions_commit_is_atomic_without_implicit_padding() {
        let dir = test_directory("keys-positions-atomic-commit-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let before = store.snapshot();
        let disk_before = std::fs::read(dir.join("store.json")).unwrap();
        let mut mappings = before.keys.clone();
        mappings.get_mut("4key").unwrap().push("F5".into());
        mappings.get_mut("5key").unwrap().push(KeySlot::default());
        let mut positions = before.key_positions.clone();
        positions
            .get_mut("4key")
            .unwrap()
            .push(KeyPosition::default());
        positions
            .get_mut("5key")
            .unwrap()
            .push(KeyPosition::default());

        store.writer.fail_next_persist();
        let failed_mappings = mappings.clone();
        let failed_positions = positions.clone();
        assert!(legacy_editor_commit(
            &store,
            &[EditorField::Keys, EditorField::KeyPositions],
            move |data| {
                data.keys = failed_mappings;
                data.key_positions = failed_positions;
            },
        )
        .is_err());
        assert_eq!(store.snapshot(), before);
        assert_eq!(std::fs::read(dir.join("store.json")).unwrap(), disk_before);

        let persist_count = store.writer.persist_count();
        let change = legacy_editor_commit(
            &store,
            &[EditorField::Keys, EditorField::KeyPositions],
            move |data| {
                data.keys = mappings;
                data.key_positions = positions;
            },
        )
        .unwrap();
        let keys = change.document.keys;
        let positions = change.document.key_positions;
        assert_eq!(store.writer.persist_count(), persist_count + 1);
        assert_eq!(keys["4key"].last().unwrap(), &KeySlot::from("F5"));
        assert_eq!(positions["4key"].last().unwrap(), &KeyPosition::default());
        assert!(keys["5key"].last().unwrap().is_unassigned());
        assert_eq!(keys["4key"].len(), positions["4key"].len());
        assert_eq!(keys["5key"].len(), positions["5key"].len());

        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn legacy_structural_single_collection_commits_are_rejected() {
        let dir = test_directory("legacy-key-position-commit-length-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();

        let before = store.snapshot();
        let mut mappings = before.keys.clone();
        mappings.get_mut("4key").unwrap().push("F5".into());
        assert!(
            legacy_editor_commit(&store, &[EditorField::Keys], move |data| {
                data.keys = mappings;
            })
            .is_err()
        );
        assert_eq!(store.snapshot(), before);

        let mut positions = before.key_positions.clone();
        positions
            .get_mut("5key")
            .unwrap()
            .push(KeyPosition::default());
        assert!(
            legacy_editor_commit(&store, &[EditorField::KeyPositions], move |data| {
                data.key_positions = positions;
            },)
            .is_err()
        );
        assert_eq!(store.snapshot(), before);

        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn asset_cleanup_waits_for_an_active_processed_wav_transaction() {
        let dir = test_directory("processed-wav-cleanup-lock-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = Arc::new(AppStore::initialize_in_dir(&dir).unwrap());
        let transaction_guard = PROCESSED_WAV_TRANSACTION_LOCK.lock();
        let (started_tx, started_rx) = mpsc::channel();
        let (done_tx, done_rx) = mpsc::channel();
        let cleanup_store = store.clone();
        let cleanup_thread = std::thread::spawn(move || {
            started_tx.send(()).unwrap();
            let result = cleanup_store.cleanup_orphan_assets_now();
            done_tx.send(result).unwrap();
        });

        started_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(done_rx.recv_timeout(Duration::from_millis(50)).is_err());
        drop(transaction_guard);
        done_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .unwrap();
        cleanup_thread.join().unwrap();

        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn shutdown_clears_a_pending_wav_journal_before_stopping_the_writer() {
        let dir = test_directory("processed-wav-shutdown-order-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let target_path = dir.join("sounds").join("sound.wav");
        std::fs::write(&target_path, b"old-wav").unwrap();
        store
            .update(|data| {
                data.sound_library.insert(
                    target_path.to_string_lossy().to_string(),
                    Default::default(),
                );
                data.pending_processed_wav_replacement = Some(PendingProcessedWavReplacement {
                    sound_path: target_path.to_string_lossy().to_string(),
                    had_original: true,
                });
            })
            .unwrap();

        store.flush_cleanup_and_shutdown().unwrap();

        assert_eq!(store.snapshot().pending_processed_wav_replacement, None);
        assert_eq!(std::fs::read(&target_path).unwrap(), b"old-wav");
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn preset_style_layout_and_settings_commit_in_one_writer_revision() {
        let dir = test_directory("preset-single-transaction-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        store
            .set_plugin_data("plugin_data_fixture", json!({ "kept": true }))
            .unwrap();
        let initial_persist_count = store.writer.persist_count();

        store
            .commit_legacy_editor_transaction(
                EditorCommitOrigin::LegacyAdapter("preset_test".to_string()),
                &[EditorField::KeyPositions],
                |data| {
                    data.key_positions.get_mut("4key").unwrap()[0].dx = 321.0;
                    apply_patch_to_store(
                        data,
                        &SettingsPatchInput {
                            background_color: Some("#123456".to_string()),
                            ..SettingsPatchInput::default()
                        },
                    );
                    Ok(())
                },
            )
            .unwrap();
        let updated = store.snapshot();

        assert_eq!(store.writer.persist_count(), initial_persist_count + 1);
        assert_eq!(updated.key_positions["4key"][0].dx, 321.0);
        assert_eq!(updated.background_color, "#123456");
        assert_eq!(updated.plugin_data["plugin_data_fixture"]["kept"], true);

        let before_failure = store.snapshot();
        let disk_before_failure = std::fs::read(dir.join("store.json")).unwrap();
        store.writer.fail_next_persist();
        let result = store.commit_legacy_editor_transaction(
            EditorCommitOrigin::LegacyAdapter("preset_test".to_string()),
            &[EditorField::KeyPositions],
            |data| {
                data.key_positions.get_mut("4key").unwrap()[0].dx = 999.0;
                apply_patch_to_store(
                    data,
                    &SettingsPatchInput {
                        background_color: Some("#FFFFFF".to_string()),
                        ..SettingsPatchInput::default()
                    },
                );
                Ok(())
            },
        );

        assert!(result.is_err());
        assert_eq!(store.snapshot(), before_failure);
        assert_eq!(
            store.snapshot().plugin_data["plugin_data_fixture"]["kept"],
            true
        );
        assert_eq!(
            std::fs::read(dir.join("store.json")).unwrap(),
            disk_before_failure
        );

        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn failed_preset_style_commit_keeps_revision_and_key_runtime_unchanged() {
        let dir = test_directory("preset-runtime-failure-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let state = AppState::initialize(store).unwrap();
        let before_store = state.store.snapshot();
        let before_disk = std::fs::read(dir.join("store.json")).unwrap();
        let before_mode = state.keyboard.current_mode();
        let before_counters = state.snapshot_key_counters();
        let mut keys = before_store.keys.clone();
        keys.get_mut("4key").unwrap()[0] = "PresetKey".into();

        state.store.writer.fail_next_persist();
        let result = state.store.commit_legacy_editor_transaction(
            EditorCommitOrigin::LegacyAdapter("preset_failure_test".to_string()),
            &[EditorField::Keys],
            move |data| {
                data.keys = keys;
                data.selected_key_type = "5key".to_string();
                data.background_color = "#123456".to_string();
                Ok(())
            },
        );

        assert!(result.is_err());
        assert_eq!(state.store.snapshot(), before_store);
        assert_eq!(std::fs::read(dir.join("store.json")).unwrap(), before_disk);
        assert_eq!(state.keyboard.current_mode(), before_mode);
        assert_eq!(state.snapshot_key_counters(), before_counters);

        state.shutdown();
        drop(state);
        let _ = std::fs::remove_dir_all(dir);
    }

    // 그룹 정의와 참조는 같은 editor 트랜잭션에서 함께 저장
    #[test]
    fn group_ids_and_definitions_commit_atomically() {
        let dir = test_directory("group-order-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();

        let mut positions = store.snapshot().key_positions;
        if let Some(list) = positions.get_mut("4key") {
            list[0].group_id = Some("new-group".to_string());
            list[1].group_id = Some("new-group".to_string());
        }
        let mut groups = crate::models::LayerGroups::new();
        groups.insert(
            "4key".to_string(),
            vec![crate::models::LayerGroupDef {
                id: "new-group".to_string(),
                name: "New Group".to_string(),
            }],
        );
        let rejected_positions = positions.clone();
        assert!(
            legacy_editor_commit(&store, &[EditorField::KeyPositions], move |data| {
                data.key_positions = rejected_positions;
            },)
            .is_err()
        );
        store
            .commit_legacy_editor_transaction(
                EditorCommitOrigin::LegacyAdapter("group_test".to_string()),
                &[EditorField::KeyPositions, EditorField::LayerGroups],
                move |data| {
                    data.key_positions = positions;
                    data.layer_groups = groups;
                    Ok(())
                },
            )
            .unwrap();

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
        assert!(!dir.join("store.json.pre-migration.bak").exists());
        assert!(serde_json::from_slice::<AppStoreData>(&std::fs::read(path).unwrap()).is_ok());

        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn note_settings_1_2_four_field_store_preserves_speed_on_boot() {
        let dir = test_directory("note-settings-1-2-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("store.json");
        let mut fixture = serde_json::to_value(AppStoreData::default()).unwrap();
        // 1.2.0 시절 noteSettings 실형식 — 4필드뿐
        let legacy_note_settings = r#"{
            "borderRadius": 2,
            "speed": 321,
            "trackHeight": 150,
            "reverse": false
        }"#;
        fixture.as_object_mut().unwrap().insert(
            "noteSettings".to_string(),
            serde_json::from_str(legacy_note_settings).unwrap(),
        );
        std::fs::write(&path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();

        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let settings = store.snapshot().note_settings;
        assert_eq!(settings.speed, 321);
        assert_eq!(settings.track_height, 150);
        assert_eq!(settings.fade_top_px, 50);
        assert_eq!(settings.short_note_threshold_ms, 50);

        store.flush_and_shutdown().unwrap();
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

    fn defer_test_bounds(store: &AppStore, x: f64) {
        store
            .update_deferred(|state| {
                state.overlay_bounds = Some(OverlayBounds {
                    x,
                    y: 20.0,
                    width: 800.0,
                    height: 300.0,
                });
                state.overlay_bounds_are_logical = true;
            })
            .unwrap();
    }

    #[test]
    fn deferred_updates_coalesce_into_one_writer_persist() {
        const UPDATE_COUNT: usize = 20;

        let dir = test_directory("store-deferred-coalesce-test");
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial_persist_count = store.writer.persist_count();
        let initial_revision = store.state.read().revision;
        let initial_disk = std::fs::read(dir.join("store.json")).unwrap();

        for index in 0..UPDATE_COUNT {
            defer_test_bounds(&store, index as f64);
        }

        assert_eq!(store.writer.persist_count(), initial_persist_count);
        assert_eq!(store.state.read().revision, initial_revision);
        assert!(store.state.read().dirty);
        assert_eq!(std::fs::read(dir.join("store.json")).unwrap(), initial_disk);
        assert_eq!(
            store.snapshot().overlay_bounds.unwrap().x,
            (UPDATE_COUNT - 1) as f64
        );

        store.flush().unwrap();
        assert_eq!(store.writer.persist_count(), initial_persist_count + 1);
        assert_eq!(store.state.read().revision, initial_revision + 1);
        assert!(!store.state.read().dirty);
        let persisted: AppStoreData =
            serde_json::from_slice(&std::fs::read(dir.join("store.json")).unwrap()).unwrap();
        assert_eq!(
            persisted.overlay_bounds.unwrap().x,
            (UPDATE_COUNT - 1) as f64
        );

        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn panel_bounds_persist_and_restore_across_store_reopen() {
        let dir = test_directory("panel-bounds-persist-test");
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let bounds = PanelBounds {
            x: 31.0,
            y: 47.0,
            height: 512.0,
        };

        store
            .update_deferred(|state| state.panel_bounds = Some(bounds))
            .unwrap();
        store.flush_and_shutdown().unwrap();
        drop(store);

        let reopened = AppStore::initialize_in_dir(&dir).unwrap();
        assert_eq!(reopened.snapshot().panel_bounds, Some(bounds));
        reopened.flush_and_shutdown().unwrap();
        drop(reopened);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn regular_update_commits_pending_deferred_state() {
        let dir = test_directory("store-deferred-regular-update-test");
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial_persist_count = store.writer.persist_count();
        defer_test_bounds(&store, 321.0);

        store
            .update(|state| {
                state
                    .plugin_data
                    .insert("unrelated".to_string(), json!(true));
            })
            .unwrap();

        assert!(!store.state.read().dirty);
        assert_eq!(store.writer.persist_count(), initial_persist_count + 1);
        let persisted: AppStoreData =
            serde_json::from_slice(&std::fs::read(dir.join("store.json")).unwrap()).unwrap();
        assert_eq!(persisted.overlay_bounds.unwrap().x, 321.0);
        assert_eq!(persisted.plugin_data["unrelated"], json!(true));

        store.flush().unwrap();
        assert_eq!(store.writer.persist_count(), initial_persist_count + 1);
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn failed_flush_keeps_deferred_state_dirty_and_committed_in_memory() {
        let dir = test_directory("store-deferred-failure-test");
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial_persist_count = store.writer.persist_count();
        let initial_revision = store.state.read().revision;
        let initial_disk = std::fs::read(dir.join("store.json")).unwrap();
        defer_test_bounds(&store, 654.0);
        store.writer.fail_next_persist();

        assert!(store.flush().is_err());
        assert!(store.state.read().dirty);
        assert_eq!(store.state.read().revision, initial_revision);
        assert_eq!(store.snapshot().overlay_bounds.unwrap().x, 654.0);
        assert_eq!(std::fs::read(dir.join("store.json")).unwrap(), initial_disk);
        assert_eq!(store.writer.persist_count(), initial_persist_count + 1);

        store.flush().unwrap();
        assert!(!store.state.read().dirty);
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn flush_without_dirty_state_is_idempotent() {
        let dir = test_directory("store-deferred-idempotent-test");
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let initial_persist_count = store.writer.persist_count();
        let initial_revision = store.state.read().revision;
        let initial_disk = std::fs::read(dir.join("store.json")).unwrap();

        store.flush().unwrap();
        store.flush().unwrap();

        assert_eq!(store.writer.persist_count(), initial_persist_count);
        assert_eq!(store.state.read().revision, initial_revision);
        assert_eq!(std::fs::read(dir.join("store.json")).unwrap(), initial_disk);
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn concurrent_updates_persist_all_revisions_without_replace_races() {
        const UPDATE_COUNT: usize = 60;

        let dir = test_directory("store-concurrency-test");
        let store = Arc::new(AppStore::initialize_in_dir(&dir).unwrap());
        let initial_revision = store.state.read().revision;
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
        assert_eq!(
            store.state.read().revision,
            initial_revision + UPDATE_COUNT as u64
        );

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
    fn writer_failure_keeps_snapshot_and_disk_unchanged_and_does_not_leak() {
        let dir = test_directory("store-transaction-failure-test");
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let path = dir.join("store.json");
        let before_snapshot = store.snapshot();
        let before_disk = std::fs::read(&path).unwrap();
        let before_revision = store.state.read().revision;

        store.writer.fail_next_persist();
        let result = store.update(|state| {
            state.always_on_top = !before_snapshot.always_on_top;
        });

        assert!(result.is_err());
        assert_eq!(store.snapshot(), before_snapshot);
        assert_eq!(
            store.with_state(|state| state.always_on_top),
            before_snapshot.always_on_top
        );
        assert_eq!(std::fs::read(&path).unwrap(), before_disk);
        assert_eq!(store.state.read().revision, before_revision);

        store
            .update(|state| {
                state
                    .plugin_data
                    .insert("unrelated".to_string(), json!(true));
            })
            .unwrap();
        let after_snapshot = store.snapshot();
        let after_disk: AppStoreData =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(after_snapshot.always_on_top, before_snapshot.always_on_top);
        assert_eq!(after_disk.always_on_top, before_snapshot.always_on_top);
        assert_eq!(after_snapshot.plugin_data["unrelated"], json!(true));
        assert_eq!(after_disk, after_snapshot);
        assert_eq!(store.state.read().revision, before_revision + 1);

        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn counter_persist_failure_keeps_runtime_mirror_unchanged() {
        let dir = test_directory("counter-transaction-failure-test");
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let snapshot = store.snapshot();
        let mode = snapshot.selected_key_type.clone();
        let key = snapshot.keys[&mode][0].canonical();
        let mut counters = snapshot.key_counters;
        counters
            .entry(mode.clone())
            .or_default()
            .insert(key.clone(), 42);
        store.set_key_counters(counters).unwrap();

        let state = AppState::initialize(store).unwrap();
        let before_runtime = state.snapshot_key_counters();
        let before_store = state.store.snapshot();
        let before_disk = std::fs::read(dir.join("store.json")).unwrap();
        state.store.writer.fail_next_persist();
        let emitter = TestCounterEmitter::new(Arc::new(Mutex::new(Vec::new())), mode, key);

        assert!(state.reset_key_counters(&emitter, None).is_err());
        assert_eq!(state.snapshot_key_counters(), before_runtime);
        assert_eq!(state.store.snapshot(), before_store);
        assert_eq!(std::fs::read(dir.join("store.json")).unwrap(), before_disk);

        state.shutdown();
        drop(state);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn reset_snapshot_emit_precedes_waiting_increment_emit() {
        let dir = test_directory("counter-mirror-race-test");
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let snapshot = store.snapshot();
        let mode = snapshot.selected_key_type.clone();
        let key = snapshot.keys[&mode][0].canonical();
        store
            .update(|data| {
                data.key_counter_enabled = true;
                data.key_counters
                    .entry(mode.clone())
                    .or_default()
                    .insert(key.clone(), 7);
            })
            .unwrap();
        let state = Arc::new(AppState::initialize(store).unwrap());
        let events = Arc::new(Mutex::new(Vec::new()));
        let (snapshot_emitted_tx, snapshot_emitted_rx) = mpsc::channel();
        let (release_snapshot_tx, release_snapshot_rx) = mpsc::channel();
        let reset_emitter = Arc::new(TestCounterEmitter::blocking_snapshot(
            Arc::clone(&events),
            mode.clone(),
            key.clone(),
            snapshot_emitted_tx,
            release_snapshot_rx,
        ));
        let reset_state = Arc::clone(&state);
        let reset_handle = std::thread::spawn(move || {
            reset_state.reset_key_counters(reset_emitter.as_ref(), None)
        });
        snapshot_emitted_rx
            .recv_timeout(Duration::from_secs(3))
            .unwrap();

        let (increment_started_tx, increment_started_rx) = mpsc::channel();
        let (increment_done_tx, increment_done_rx) = mpsc::channel();
        let increment_state = Arc::clone(&state);
        let increment_mode = mode.clone();
        let increment_key = key.clone();
        let increment_emitter = TestCounterEmitter::new(
            Arc::clone(&events),
            increment_mode.clone(),
            increment_key.clone(),
        );
        let increment_handle = std::thread::spawn(move || {
            increment_started_tx.send(()).unwrap();
            let count = increment_state.increment_key_counter_and_emit(
                &increment_emitter,
                &increment_mode,
                &increment_key,
            );
            increment_done_tx.send(count).unwrap();
        });
        increment_started_rx.recv().unwrap();
        assert!(increment_done_rx
            .recv_timeout(Duration::from_millis(50))
            .is_err());
        assert_eq!(*events.lock().unwrap(), vec!["snapshot:0"]);

        release_snapshot_tx.send(()).unwrap();
        let reset_snapshot = reset_handle.join().unwrap().unwrap();
        assert_eq!(reset_snapshot.counters[&mode][&key], 0);
        assert_eq!(
            increment_done_rx
                .recv_timeout(Duration::from_secs(3))
                .unwrap(),
            Some(1)
        );
        increment_handle.join().unwrap();
        assert_eq!(*events.lock().unwrap(), vec!["snapshot:0", "counter:1"]);
        assert_eq!(state.snapshot_key_counters()[&mode][&key], 1);
        let bootstrap = state.bootstrap_payload();
        assert_eq!(bootstrap.key_counters[&mode][&key], 1);
        assert!(!bootstrap.key_counters_session_id.is_empty());
        assert_eq!(bootstrap.key_counters_revision, 2);

        state.shutdown();
        drop(state);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn queued_increment_survives_same_generation_noop_key_publication() {
        let dir = test_directory("counter-history-queue-test");
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let snapshot = store.snapshot();
        let mode = snapshot.selected_key_type.clone();
        let key = snapshot.keys[&mode][0].canonical();
        store
            .update(|data| {
                data.key_counter_enabled = true;
            })
            .unwrap();
        let state = Arc::new(AppState::initialize(store).unwrap());
        let events = Arc::new(Mutex::new(Vec::new()));
        let mutation_emitter =
            TestCounterEmitter::new(Arc::clone(&events), mode.clone(), key.clone());
        let mut changed_counters = state.snapshot_key_counters();
        changed_counters
            .entry(mode.clone())
            .or_default()
            .insert(key.clone(), 7);
        let mutation = state
            .replace_key_counters(&mutation_emitter, changed_counters, Some(0))
            .unwrap();
        assert_eq!(mutation.counters[&mode][&key], 7);
        assert_eq!(
            mutation.history_status.as_ref().unwrap().history_revision,
            1
        );
        drop(mutation);
        events.lock().unwrap().clear();

        let operation_id = uuid::Uuid::new_v4().to_string();
        let gate = state.store.history_gate();
        let barrier = gate.close(&operation_id).unwrap();
        state.begin_counter_history_barrier();
        let mut counter_guard = state.lock_key_counters_for_history();
        let current_counters = counter_guard.clone();
        let undo = state
            .store
            .apply_history_operation(
                HistoryDirection::Undo,
                &operation_id,
                &current_counters,
                || {},
            )
            .unwrap();
        let Some(HistoryAuxChange::Counters(restored)) = undo.aux_change.as_ref() else {
            panic!("counter history change expected");
        };
        state.replace_history_counters_locked(
            &mut counter_guard,
            undo.runtime_publication_generation,
            restored,
        );
        assert_eq!(counter_guard[&mode][&key], 0);

        let increment_state = Arc::clone(&state);
        let increment_mode = mode.clone();
        let increment_key = key.clone();
        let increment_events = Arc::clone(&events);
        let (increment_done_tx, increment_done_rx) = mpsc::channel();
        let increment = thread::spawn(move || {
            let emitter = TestCounterEmitter::new(
                increment_events,
                increment_mode.clone(),
                increment_key.clone(),
            );
            let count = increment_state.increment_key_counter_and_emit(
                &emitter,
                &increment_mode,
                &increment_key,
            );
            increment_done_tx.send(count).unwrap();
        });
        assert_eq!(
            increment_done_rx
                .recv_timeout(Duration::from_secs(2))
                .unwrap(),
            None
        );
        increment.join().unwrap();
        assert!(events.lock().unwrap().is_empty());

        let history_emitter =
            TestCounterEmitter::new(Arc::clone(&events), mode.clone(), key.clone());
        state.finish_counter_history_barrier(
            &history_emitter,
            counter_guard,
            true,
            undo.runtime_publication_generation,
        );
        drop(barrier);

        assert_eq!(state.snapshot_key_counters()[&mode][&key], 1);
        assert_eq!(state.store.snapshot().key_counters[&mode][&key], 0);
        assert_eq!(*events.lock().unwrap(), vec!["snapshot:1"]);
        assert_eq!(undo.status.history_epoch, 1);
        assert!(undo.status.can_redo);

        let noop = state
            .store
            .commit_legacy_editor_transaction(
                EditorCommitOrigin::LegacyAdapter(
                    "same_generation_noop_key_publication".to_string(),
                ),
                &[EditorField::Keys],
                |_| Ok(()),
            )
            .unwrap();
        assert!(noop.change.result.changed_fields.is_empty());
        assert_eq!(
            noop.change.runtime_publication_generation,
            undo.runtime_publication_generation
        );
        assert_eq!(noop.change.key_counters[&mode][&key], 0);
        state
            .apply_committed_editor_key_runtime(
                &history_emitter,
                noop.change.runtime_publication_generation,
                &noop.change.document.keys,
                &noop.change.selected_key_type,
                &noop.change.key_counters,
            )
            .unwrap();
        state.apply_committed_editor_keys_without_counters(
            noop.change.runtime_publication_generation,
            &noop.change.document.keys,
            &noop.change.selected_key_type,
        );
        drop(noop);

        assert_eq!(state.snapshot_key_counters()[&mode][&key], 1);
        assert_eq!(*events.lock().unwrap(), vec!["snapshot:1"]);

        state.shutdown();
        drop(state);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn existing_obs_token_is_reused_without_persist() {
        let dir = test_directory("obs-token-reuse-test");
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let token = "persisted-obs-token".to_string();
        store
            .update(|state| {
                state.obs_token = Some(token.clone());
            })
            .unwrap();
        let state = AppState::initialize(store).unwrap();
        let persist_count_before = state.store.writer.persist_count();
        let disk_before = std::fs::read(dir.join("store.json")).unwrap();

        assert_eq!(state.resolve_and_save_obs_token().unwrap(), token);
        assert_eq!(state.store.writer.persist_count(), persist_count_before);
        assert_eq!(std::fs::read(dir.join("store.json")).unwrap(), disk_before);

        state.shutdown();
        drop(state);
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

        let image_paths = collect_local_image_path_keys(&root, &data);
        let sound_paths = collect_local_sound_path_keys(&root, &data);
        for kind in ["key", "stat", "graph", "knob"] {
            assert!(image_paths.contains(&path_identity_key(&root.join(format!("{kind}.png")))));
            assert!(sound_paths.contains(&path_identity_key(&root.join(format!("{kind}.wav")))));
        }
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn asset_references_preserve_the_leading_slash_in_file_urls() {
        let mut data = AppStoreData::default();
        let mut position = default_positions()["4key"][0].clone();
        position.active_image = Some("file:///tmp/dmnote-file-url.png".to_string());
        position.sound_path = Some("file:///tmp/dmnote-file-url.wav".to_string());
        data.key_positions
            .insert("4key".to_string(), vec![position]);

        let classify_root = Path::new("/nonexistent-app-data");
        assert!(collect_local_image_path_keys(classify_root, &data)
            .contains(&path_identity_key(Path::new("/tmp/dmnote-file-url.png"))));
        assert!(collect_local_sound_path_keys(classify_root, &data)
            .contains(&path_identity_key(Path::new("/tmp/dmnote-file-url.wav"))));
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn percent_encoded_file_url_keeps_referenced_image_out_of_trash() {
        let dir = test_directory("percent-encoded-image-sweep-test");
        let image_path = dir.join("images").join("referenced image.png");
        std::fs::create_dir_all(image_path.parent().unwrap()).unwrap();
        std::fs::write(&image_path, b"image").unwrap();
        let image_url = url::Url::from_file_path(&image_path).unwrap().to_string();
        assert!(image_url.contains("%20"));

        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let mut positions = store.snapshot().key_positions;
        positions.get_mut("4key").unwrap()[0].active_image = Some(image_url);
        legacy_editor_commit(&store, &[EditorField::KeyPositions], move |data| {
            data.key_positions = positions;
        })
        .unwrap();

        store.cleanup_orphan_assets_now().unwrap();

        assert!(image_path.exists());
        assert!(!dir.join("trash").exists());
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn invalid_file_url_skips_destructive_image_sweep() {
        let dir = test_directory("invalid-file-url-sweep-test");
        let image_path = dir.join("images").join("unreferenced.png");
        std::fs::create_dir_all(image_path.parent().unwrap()).unwrap();
        std::fs::write(&image_path, b"image").unwrap();

        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let mut positions = store.snapshot().key_positions;
        positions.get_mut("4key").unwrap()[0].active_image =
            Some("file:///tmp/broken%ZZ.png".to_string());
        legacy_editor_commit(&store, &[EditorField::KeyPositions], move |data| {
            data.key_positions = positions;
        })
        .unwrap();

        store.cleanup_orphan_assets_now().unwrap();

        assert!(image_path.exists());
        assert!(!dir.join("trash").exists());
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn invalid_file_url_skips_destructive_font_sweep() {
        let dir = test_directory("invalid-font-file-url-sweep-test");
        let font_path = dir.join("fonts").join("unreferenced.ttf");
        std::fs::create_dir_all(font_path.parent().unwrap()).unwrap();
        std::fs::write(&font_path, b"font").unwrap();

        let store = AppStore::initialize_in_dir(&dir).unwrap();
        store
            .update(|data| {
                data.font_settings.custom_fonts.push(CustomFont {
                    id: "invalid-url-font".to_string(),
                    font_type: FontType::Local,
                    name: "Invalid URL Font".to_string(),
                    display_name: "Invalid URL Font".to_string(),
                    enabled: true,
                    local_path: Some("file:///tmp/broken%ZZ.ttf".to_string()),
                    css_content: None,
                });
            })
            .unwrap();

        store.cleanup_orphan_assets_now().unwrap();

        assert!(font_path.exists());
        assert!(!dir.join("trash").exists());
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn unresolved_path_like_values_skip_destructive_asset_sweeps() {
        let dir = test_directory("unresolved-local-path-sweep-test");
        let image_path = dir.join("images").join("unreferenced.png");
        let sound_path = dir.join("sounds").join("unreferenced.wav");
        for path in [&image_path, &sound_path] {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, b"asset").unwrap();
        }

        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let mut positions = store.snapshot().key_positions;
        let position = &mut positions.get_mut("4key").unwrap()[0];
        position.active_image = Some(r"\unresolved-image.png".to_string());
        position.sound_path = Some("C:unresolved-sound.wav".to_string());
        legacy_editor_commit(&store, &[EditorField::KeyPositions], move |data| {
            data.key_positions = positions;
        })
        .unwrap();

        store.cleanup_orphan_assets_now().unwrap();

        assert!(image_path.exists());
        assert!(sound_path.exists());
        assert!(!dir.join("trash").exists());
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn unresolved_asset_reference_counts_are_grouped_by_category() {
        let mut data = AppStoreData::default();
        data.font_settings.custom_fonts.push(CustomFont {
            id: "unresolved-font".to_string(),
            font_type: FontType::Local,
            name: "Unresolved Font".to_string(),
            display_name: "Unresolved Font".to_string(),
            enabled: true,
            local_path: Some("C:unresolved-font.ttf".to_string()),
            css_content: None,
        });
        data.key_positions.insert(
            "unresolved-mode".to_string(),
            vec![KeyPosition {
                active_image: Some(r"\unresolved-image.png".to_string()),
                sound_path: Some("C:unresolved-sound.wav".to_string()),
                ..KeyPosition::default()
            }],
        );
        data.sound_library.insert(
            r"\unresolved-library-sound.wav".to_string(),
            SoundLibraryEntry::default(),
        );

        let classify_root = Path::new("/nonexistent-app-data");
        let fonts = collect_local_font_paths(classify_root, &data);
        let images = collect_local_image_paths(classify_root, &data);
        let sounds = collect_local_sound_paths(classify_root, &data);

        assert!(!fonts.complete);
        assert!(!images.complete);
        assert!(!sounds.complete);
        assert_eq!(fonts.unresolved_count, 1);
        assert_eq!(images.unresolved_count, 1);
        assert_eq!(sounds.unresolved_count, 2);
    }

    #[test]
    fn missing_foreign_file_url_reference_marks_sweep_unresolved() {
        let dir = test_directory("foreign-file-url-unresolved-test");
        std::fs::create_dir_all(dir.join("images")).unwrap();
        let mut data = AppStoreData {
            key_positions: default_positions().clone(),
            ..AppStoreData::default()
        };
        data.key_positions.get_mut("4key").unwrap()[0].active_image = Some(
            "file:///C:/Users/me/AppData/Roaming/com.dmnote.desktop/images/missing.png".to_string(),
        );

        // 외래 file URL이 이 기기에서 실존하지 않으면 sweep을 보류시켜야 함
        assert_eq!(collect_local_image_paths(&dir, &data).unresolved_count, 1);

        // 현재 기기 appData의 단순 누락 참조는 기존대로 보류 대상이 아님
        data.key_positions.get_mut("4key").unwrap()[0].inactive_image = Some(
            dir.join("images")
                .join("gone.png")
                .to_string_lossy()
                .into_owned(),
        );
        assert_eq!(collect_local_image_paths(&dir, &data).unresolved_count, 1);

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn missing_foreign_file_url_holds_sweep_and_keeps_unreferenced_image() {
        let dir = test_directory("foreign-file-url-sweep-hold-test");
        let kept_image = dir.join("images").join("kept.png");
        std::fs::create_dir_all(kept_image.parent().unwrap()).unwrap();
        std::fs::write(&kept_image, b"image").unwrap();

        let mut data = AppStoreData {
            keys: crate::defaults::default_keys().clone(),
            key_positions: default_positions().clone(),
            ..AppStoreData::default()
        };
        data.key_positions.get_mut("4key").unwrap()[0].active_image = Some(
            "file:///C:/Users/me/AppData/Roaming/com.dmnote.desktop/images/missing.png".to_string(),
        );
        std::fs::write(
            dir.join("store.json"),
            serde_json::to_vec_pretty(&data).unwrap(),
        )
        .unwrap();

        let store = AppStore::initialize_in_dir(&dir).unwrap();
        store.cleanup_orphan_assets_now().unwrap();

        // 미해석 외래 참조가 있으면 sweep 보류 — 미참조 로컬 이미지도 격리 금지
        assert!(kept_image.exists());
        assert!(!dir.join("trash").exists());

        store.flush_cleanup_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn foreign_asset_references_rehome_before_persist_and_sweep() {
        let dir = test_directory("foreign-asset-rehome-integration-test");
        let font_path = dir.join("fonts").join("portable.ttf");
        let image_path = dir.join("images").join("portable.png");
        let sound_path = dir.join("sounds").join("portable.wav");
        for path in [&font_path, &image_path, &sound_path] {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, b"portable-asset").unwrap();
        }

        let foreign_root = r"C:\Users\Exporter\AppData\Roaming\com.dmnote.desktop";
        let foreign_font = format!(r"{foreign_root}\fonts\portable.ttf");
        let foreign_image = format!(r"{foreign_root}\images\portable.png");
        let foreign_sound = format!(r"{foreign_root}\sounds\portable.wav");
        let mut data = AppStoreData {
            keys: crate::defaults::default_keys().clone(),
            key_positions: default_positions().clone(),
            ..AppStoreData::default()
        };
        let position = &mut data.key_positions.get_mut("4key").unwrap()[0];
        position.active_image = Some(foreign_image.clone());
        position.sound_path = Some(foreign_sound.clone());
        data.font_settings.custom_fonts.push(CustomFont {
            id: "portable-font".to_string(),
            font_type: FontType::Local,
            name: "Portable Font".to_string(),
            display_name: "Portable Font".to_string(),
            enabled: true,
            local_path: Some(foreign_font.clone()),
            css_content: None,
        });
        data.sound_library.insert(
            foreign_sound.clone(),
            SoundLibraryEntry {
                display_name: Some("Portable sound".to_string()),
                ..SoundLibraryEntry::default()
            },
        );

        let original = serde_json::to_vec_pretty(&data).unwrap();
        let store_path = dir.join("store.json");
        std::fs::write(&store_path, &original).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let snapshot = store.snapshot();
        let local_font = font_path.to_string_lossy().into_owned();
        let local_image = image_path.to_string_lossy().into_owned();
        let local_sound = sound_path.to_string_lossy().into_owned();

        assert_eq!(
            snapshot.font_settings.custom_fonts[0].local_path.as_deref(),
            Some(local_font.as_str())
        );
        // 이전된 폰트는 경로 재귀화와 함께 활성 상태도 유지되어야 함
        assert!(snapshot.font_settings.custom_fonts[0].enabled);
        assert_eq!(
            snapshot.key_positions["4key"][0].active_image.as_deref(),
            Some(local_image.as_str())
        );
        assert_eq!(
            snapshot.key_positions["4key"][0].sound_path.as_deref(),
            Some(local_sound.as_str())
        );
        assert!(snapshot.sound_library.contains_key(&local_sound));
        assert!(!snapshot.sound_library.contains_key(&foreign_sound));
        assert_eq!(
            collect_local_font_paths(&dir, &snapshot).unresolved_count,
            0
        );
        assert_eq!(
            collect_local_image_paths(&dir, &snapshot).unresolved_count,
            0
        );
        assert_eq!(
            collect_local_sound_paths(&dir, &snapshot).unresolved_count,
            0
        );
        assert_eq!(
            std::fs::read(dir.join("store.json.pre-migration.bak")).unwrap(),
            original
        );

        store.cleanup_orphan_assets_now().unwrap();
        assert!(font_path.exists());
        assert!(image_path.exists());
        assert!(sound_path.exists());
        store.flush_cleanup_and_shutdown().unwrap();
        drop(store);

        let reloaded = crate::state::migration::load_store_from_path(&store_path).unwrap();
        assert!(!reloaded.needs_persist);
        assert_eq!(
            collect_local_font_paths(&dir, &reloaded.data).unresolved_count,
            0
        );
        assert_eq!(
            collect_local_image_paths(&dir, &reloaded.data).unresolved_count,
            0
        );
        assert_eq!(
            collect_local_sound_paths(&dir, &reloaded.data).unresolved_count,
            0
        );

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn tauri_1_6_1_literal_fixture_preserves_collections_and_assets_through_shutdown() {
        let dir = test_directory("tauri-1-6-1-store-fixture-test");
        let image_path = dir.join("images").join("unbound-knob.png");
        let sound_path = dir.join("sounds").join("legacy-sound.wav");
        for path in [&image_path, &sound_path] {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, b"asset-fixture").unwrap();
        }

        #[cfg(target_os = "windows")]
        let stored_sound_path = {
            let raw = sound_path.to_string_lossy();
            if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
                format!(r"\\{rest}")
            } else {
                raw.strip_prefix(r"\\?\").unwrap_or(&raw).to_string()
            }
        };
        #[cfg(not(target_os = "windows"))]
        let stored_sound_path =
            r"C:\Users\DmNote\AppData\Roaming\com.dmnote\sounds\legacy-sound.wav".to_string();

        let tab_id = "legacy-custom-tab";
        let fixture = r##"{
  "hardwareAcceleration": true,
  "alwaysOnTop": true,
  "overlayLocked": false,
  "overlayVisible": false,
  "noteEffect": true,
  "noteSettings": {
    "frameLimit": 0,
    "speed": 180,
    "trackHeight": 150,
    "reverse": false,
    "fadePosition": "auto",
    "fadeTopPx": 50,
    "fadeBottomPx": 0,
    "reverseFadeTopPx": 0,
    "reverseFadeBottomPx": 50,
    "delayedNoteEnabled": false,
    "shortNoteThresholdMs": 50,
    "shortNoteMinLengthPx": 30,
    "keyDisplayDelayMs": 0
  },
  "selectedKeyType": "legacy-custom-tab",
  "customTabs": [{ "id": "legacy-custom-tab", "name": "Legacy custom tab" }],
  "angleMode": "d3d11",
  "language": "ko",
  "laboratoryEnabled": false,
  "developerModeEnabled": false,
  "trayEnabled": false,
  "autoUpdateEnabled": true,
  "mainWindowHidden": false,
  "keys": { "legacy-custom-tab": ["F5"] },
  "keyPositions": {
    "legacy-custom-tab": [{
      "dx": 10.0,
      "dy": 20.0,
      "width": 60.0,
      "height": 60.0,
      "activeImage": "",
      "inactiveImage": "",
      "count": 0,
      "noteColor": "#FFFFFF",
      "noteOpacity": 80
    }]
  },
  "statPositions": {
    "legacy-custom-tab": [{
      "statType": "kps",
      "dx": 80.0,
      "dy": 20.0,
      "width": 80.0,
      "height": 40.0,
      "activeImage": "",
      "inactiveImage": "",
      "count": 0,
      "noteColor": "#FFFFFF",
      "noteOpacity": 80
    }]
  },
  "graphPositions": {
    "legacy-custom-tab": [{
      "statType": "kpsAvg",
      "graphType": "line",
      "graphSpeed": 1000,
      "graphColor": "#24BBB4",
      "showAvgLine": true,
      "dx": 170.0,
      "dy": 20.0,
      "width": 160.0,
      "height": 80.0,
      "activeImage": "",
      "inactiveImage": "",
      "count": 0,
      "noteColor": "#FFFFFF",
      "noteOpacity": 80
    }]
  },
  "knobPositions": {
    "legacy-custom-tab": [{
      "axisId": "",
      "sensitivity": 1.40625,
      "reverse": false,
      "dx": 340.0,
      "dy": 20.0,
      "width": 80.0,
      "height": 80.0,
      "activeImage": __IMAGE_PATH_JSON__,
      "inactiveImage": "",
      "count": 0,
      "noteColor": "#FFFFFF",
      "noteOpacity": 80
    }]
  },
  "layerGroups": {
    "legacy-custom-tab": [{ "id": "legacy-group", "name": "Legacy group" }]
  },
  "keyCounters": { "legacy-custom-tab": { "F5": 3 } },
  "backgroundColor": "transparent",
  "useCustomCss": false,
  "customCss": { "path": null, "content": "" },
  "fontSettings": { "customFonts": [] },
  "counterAnimationPresets": [],
  "tabCssOverrides": {
    "legacy-custom-tab": { "path": null, "content": "", "enabled": true }
  },
  "tabNoteOverrides": {
    "legacy-custom-tab": { "speed": 200 }
  },
  "useCustomJs": false,
  "customJs": { "path": null, "content": "", "plugins": [] },
  "overlayResizeAnchor": "top-left",
  "overlayBounds": null,
  "overlayLastContentTopOffset": null,
  "overlayBoundsAreLogical": false,
  "keyCounterEnabled": true,
  "gridSettings": {
    "alignmentGuides": true,
    "spacingGuides": true,
    "sizeMatchGuides": true,
    "minimapEnabled": true,
    "gridSnapSize": 5,
    "overlayPadding": 30
  },
  "shortcuts": {
    "toggleOverlay": { "key": "KeyO", "ctrl": true, "shift": true, "alt": false, "meta": false },
    "toggleOverlayLock": { "key": "", "ctrl": false, "shift": false, "alt": false, "meta": false },
    "toggleAlwaysOnTop": { "key": "", "ctrl": false, "shift": false, "alt": false, "meta": false },
    "switchKeyMode": { "key": "Tab", "ctrl": false, "shift": false, "alt": false, "meta": false },
    "toggleSettingsPanel": { "key": "KeyB", "ctrl": true, "shift": false, "alt": false, "meta": false },
    "zoomIn": { "key": "Equal", "ctrl": true, "shift": false, "alt": false, "meta": false },
    "zoomOut": { "key": "Minus", "ctrl": true, "shift": false, "alt": false, "meta": false },
    "resetZoom": { "key": "Digit0", "ctrl": true, "shift": false, "alt": false, "meta": false }
  },
  "soundLibrary": {
    __SOUND_PATH_JSON__: {
      "enabled": true,
      "source": "local",
      "originalPath": null,
      "trimStartRatio": null,
      "trimEndRatio": null,
      "displayName": "Legacy sound"
    }
  },
  "keySoundOutputBackend": null,
  "obsModeEnabled": false,
  "obsPort": 34891,
  "obsToken": null
}"##
            .replace(
                "__IMAGE_PATH_JSON__",
                &serde_json::to_string(&image_path.to_string_lossy()).unwrap(),
            )
            .replace(
                "__SOUND_PATH_JSON__",
                &serde_json::to_string(&stored_sound_path).unwrap(),
            );
        let store_path = dir.join("store.json");
        std::fs::write(&store_path, fixture.as_bytes()).unwrap();

        let store = AppStore::initialize_in_dir(&dir).unwrap();
        assert!(!store.skip_asset_sweep);
        let snapshot = store.snapshot();
        assert_eq!(snapshot.custom_tabs.len(), 1);
        assert_eq!(snapshot.keys[tab_id], vec![KeySlot::from("F5")]);
        assert_eq!(snapshot.key_positions[tab_id].len(), 1);
        assert_eq!(snapshot.stat_positions[tab_id].len(), 1);
        assert_eq!(snapshot.graph_positions[tab_id].len(), 1);
        assert_eq!(snapshot.knob_positions[tab_id].len(), 1);
        assert!(snapshot.knob_positions[tab_id][0].axis_id.is_empty());
        assert_eq!(snapshot.knob_positions[tab_id][0].sensitivity, 1.0);
        assert_eq!(snapshot.layer_groups[tab_id].len(), 1);
        assert_eq!(snapshot.key_counters[tab_id]["F5"], 3);
        assert!(snapshot.tab_css_overrides.contains_key(tab_id));
        assert!(snapshot.tab_note_overrides.contains_key(tab_id));
        assert!(snapshot.sound_library.contains_key(&stored_sound_path));
        assert!(!snapshot.sound_library[&stored_sound_path].hidden);
        assert!(!dir.join("store.json.bak").exists());
        assert_eq!(
            std::fs::read(dir.join("store.json.pre-migration.bak")).unwrap(),
            fixture.as_bytes()
        );

        store.flush_cleanup_and_shutdown().unwrap();
        drop(store);

        assert!(image_path.exists());
        assert!(sound_path.exists());
        assert!(!dir.join("store.json.bak").exists());
        let reloaded = crate::state::migration::load_store_from_path(&store_path).unwrap();
        assert!(!reloaded.repaired);
        assert_eq!(reloaded.data.custom_tabs.len(), 1);
        assert_eq!(reloaded.data.keys[tab_id], vec![KeySlot::from("F5")]);
        assert_eq!(reloaded.data.key_positions[tab_id].len(), 1);
        assert_eq!(reloaded.data.stat_positions[tab_id].len(), 1);
        assert_eq!(reloaded.data.graph_positions[tab_id].len(), 1);
        assert_eq!(reloaded.data.knob_positions[tab_id].len(), 1);
        assert!(reloaded.data.knob_positions[tab_id][0].axis_id.is_empty());
        assert_eq!(reloaded.data.layer_groups[tab_id].len(), 1);
        assert!(reloaded.data.sound_library.contains_key(&stored_sound_path));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn pre_migration_backup_preserves_first_original_across_rewrites() {
        let dir = test_directory("pre-migration-backup-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store_path = dir.join("store.json");
        let backup_path = dir.join("store.json.pre-migration.bak");
        let first_original = br##"{
  "hardwareAcceleration": true,
  "alwaysOnTop": true,
  "overlayLocked": false,
  "noteEffect": false,
  "selectedKeyType": "4key",
  "angleMode": "d3d11",
  "language": "ko",
  "laboratoryEnabled": false,
  "backgroundColor": "transparent",
  "useCustomCss": false,
  "overlayResizeAnchor": "top-left",
  "overlayBounds": null,
  "overlayLastContentTopOffset": null,
  "soundLibrary": {
    "C:\\legacy\\first.wav": { "enabled": true, "source": "local" }
  }
}"##;
        std::fs::write(&store_path, first_original).unwrap();

        let first = AppStore::initialize_in_dir(&dir).unwrap();
        assert_eq!(std::fs::read(&backup_path).unwrap(), first_original);
        assert!(!dir.join("store.json.bak").exists());
        first.flush_cleanup_and_shutdown().unwrap();
        drop(first);
        assert_eq!(std::fs::read(&backup_path).unwrap(), first_original);

        let mut second_input: Value =
            serde_json::from_slice(&std::fs::read(&store_path).unwrap()).unwrap();
        second_input["soundLibrary"]
            .as_object_mut()
            .unwrap()
            .insert(
                r"C:\legacy\second.wav".to_string(),
                json!({ "enabled": true, "source": "local" }),
            );
        std::fs::write(
            &store_path,
            serde_json::to_vec_pretty(&second_input).unwrap(),
        )
        .unwrap();

        let second = AppStore::initialize_in_dir(&dir).unwrap();
        assert_eq!(std::fs::read(&backup_path).unwrap(), first_original);
        assert!(!dir.join("store.json.bak").exists());
        second.flush_cleanup_and_shutdown().unwrap();
        drop(second);
        assert_eq!(std::fs::read(&backup_path).unwrap(), first_original);

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn invalid_pre_migration_backup_path_aborts_before_store_rewrite() {
        let dir = test_directory("pre-migration-backup-path-failure-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store_path = dir.join("store.json");
        let original = br#"{
  "hardwareAcceleration": true,
  "alwaysOnTop": true,
  "overlayLocked": false,
  "noteEffect": false,
  "selectedKeyType": "4key",
  "angleMode": "d3d11",
  "language": "ko",
  "laboratoryEnabled": false,
  "backgroundColor": "transparent",
  "useCustomCss": false,
  "overlayResizeAnchor": "top-left",
  "overlayBounds": null,
  "overlayLastContentTopOffset": null,
  "soundLibrary": {
    "C:\\legacy\\first.wav": { "enabled": true, "source": "local" }
  }
}"#;
        std::fs::write(&store_path, original).unwrap();
        std::fs::create_dir(dir.join("store.json.pre-migration.bak")).unwrap();

        let result = AppStore::initialize_in_dir(&dir);

        if let Ok(store) = result {
            let _ = store.flush_and_shutdown();
            panic!("store initialization unexpectedly rewrote data without a valid backup");
        }
        assert_eq!(std::fs::read(&store_path).unwrap(), original);

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn malformed_existing_pre_migration_backup_aborts_before_store_rewrite() {
        let dir = test_directory("pre-migration-backup-content-failure-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store_path = dir.join("store.json");
        let original = br#"{
  "hardwareAcceleration": true,
  "alwaysOnTop": true,
  "overlayLocked": false,
  "noteEffect": false,
  "selectedKeyType": "4key",
  "angleMode": "d3d11",
  "language": "ko",
  "laboratoryEnabled": false,
  "backgroundColor": "transparent",
  "useCustomCss": false,
  "overlayResizeAnchor": "top-left",
  "overlayBounds": null,
  "overlayLastContentTopOffset": null,
  "soundLibrary": {
    "C:\\legacy\\first.wav": { "enabled": true, "source": "local" }
  }
}"#;
        std::fs::write(&store_path, original).unwrap();
        std::fs::write(dir.join("store.json.pre-migration.bak"), b"not-json").unwrap();

        let result = AppStore::initialize_in_dir(&dir);

        if let Ok(store) = result {
            let _ = store.flush_and_shutdown();
            panic!("store initialization unexpectedly rewrote data without a valid backup");
        }
        assert_eq!(std::fs::read(&store_path).unwrap(), original);

        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn symlink_pre_migration_backup_aborts_before_store_rewrite() {
        use std::os::unix::fs::symlink;

        let dir = test_directory("pre-migration-backup-symlink-failure-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store_path = dir.join("store.json");
        let original = br#"{
  "hardwareAcceleration": true,
  "alwaysOnTop": true,
  "overlayLocked": false,
  "noteEffect": false,
  "selectedKeyType": "4key",
  "angleMode": "d3d11",
  "language": "ko",
  "laboratoryEnabled": false,
  "backgroundColor": "transparent",
  "useCustomCss": false,
  "overlayResizeAnchor": "top-left",
  "overlayBounds": null,
  "overlayLastContentTopOffset": null,
  "soundLibrary": {
    "C:\\legacy\\first.wav": { "enabled": true, "source": "local" }
  }
}"#;
        std::fs::write(&store_path, original).unwrap();
        let target = dir.join("unrelated.json");
        std::fs::write(&target, b"{}").unwrap();
        symlink(&target, dir.join("store.json.pre-migration.bak")).unwrap();

        let result = AppStore::initialize_in_dir(&dir);

        if let Ok(store) = result {
            let _ = store.flush_and_shutdown();
            panic!("store initialization unexpectedly followed a backup symlink");
        }
        assert_eq!(std::fs::read(&store_path).unwrap(), original);
        assert_eq!(std::fs::read(&target).unwrap(), b"{}");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn interrupted_sound_deletion_restores_files_still_referenced_by_store() {
        let dir = test_directory("sound-delete-startup-restore-test");
        let sounds_dir = dir.join("sounds");
        let originals_dir = sounds_dir.join("originals");
        std::fs::create_dir_all(&originals_dir).unwrap();
        let sound_path = sounds_dir.join("sound.wav");
        let original_path = originals_dir.join("original.wav");
        std::fs::write(&sound_path, b"sound").unwrap();
        std::fs::write(&original_path, b"original").unwrap();

        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let sound_key = sound_path.to_string_lossy().to_string();
        store
            .update(|data| {
                data.sound_library.insert(
                    sound_key.clone(),
                    SoundLibraryEntry {
                        original_path: Some("originals/original.wav".to_string()),
                        ..Default::default()
                    },
                );
            })
            .unwrap();
        let staged =
            stage_sound_files_for_deletion(&[sound_path.clone(), original_path.clone()]).unwrap();
        assert_eq!(staged.len(), 2);
        assert!(!sound_path.exists());
        assert!(!original_path.exists());

        store
            .recover_interrupted_processed_wav_replacements_now()
            .unwrap();

        assert_eq!(std::fs::read(&sound_path).unwrap(), b"sound");
        assert_eq!(std::fs::read(&original_path).unwrap(), b"original");
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn interrupted_sound_deletion_restore_failure_is_reported_incomplete() {
        let dir = test_directory("sound-delete-incomplete-recovery-test");
        let sounds_dir = dir.join("sounds");
        std::fs::create_dir_all(&sounds_dir).unwrap();
        let sound_path = sounds_dir.join("sound.wav");
        std::fs::write(&sound_path, b"sound").unwrap();

        let mut data = AppStoreData::default();
        data.sound_library.insert(
            sound_path.to_string_lossy().to_string(),
            SoundLibraryEntry::default(),
        );
        let staged = stage_sound_files_for_deletion(std::slice::from_ref(&sound_path)).unwrap();
        let backup_path = staged[0].backup_path.clone();

        let recovery = recover_interrupted_sound_deletions_with(
            &data,
            &sounds_dir,
            &dir.join("trash"),
            |_from, _to| Err(std::io::Error::other("injected recovery failure")),
        )
        .unwrap();

        assert!(!recovery.complete);
        assert!(recovery
            .protected_keys
            .contains(&path_identity_key(&backup_path)));
        assert!(!sound_path.exists());
        assert!(backup_path.exists());

        std::fs::rename(backup_path, sound_path).unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn interrupted_committed_sound_deletion_finishes_in_trash() {
        let dir = test_directory("sound-delete-startup-finish-test");
        let sounds_dir = dir.join("sounds");
        std::fs::create_dir_all(&sounds_dir).unwrap();
        let sound_path = sounds_dir.join("sound.wav");
        std::fs::write(&sound_path, b"sound").unwrap();

        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let sound_key = sound_path.to_string_lossy().to_string();
        store
            .update(|data| {
                data.sound_library
                    .insert(sound_key.clone(), SoundLibraryEntry::default());
            })
            .unwrap();
        stage_sound_files_for_deletion(std::slice::from_ref(&sound_path)).unwrap();
        store
            .update(|data| {
                data.sound_library.remove(&sound_key);
            })
            .unwrap();

        store
            .recover_interrupted_processed_wav_replacements_now()
            .unwrap();

        assert!(!sound_path.exists());
        let quarantined = std::fs::read_dir(dir.join("trash"))
            .unwrap()
            .flat_map(|session| std::fs::read_dir(session.unwrap().path()).unwrap())
            .flat_map(|category| std::fs::read_dir(category.unwrap().path()).unwrap())
            .any(|entry| entry.unwrap().file_name() == "sound.wav");
        assert!(quarantined);
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn sound_deletion_staging_failure_restores_already_staged_files() {
        let dir = test_directory("sound-delete-staging-rollback-test");
        std::fs::create_dir_all(&dir).unwrap();
        let sound_path = dir.join("sound.wav");
        let invalid_path = dir.join("not-a-file.wav");
        std::fs::write(&sound_path, b"sound").unwrap();
        std::fs::create_dir(&invalid_path).unwrap();

        let error = stage_sound_files_for_deletion(&[sound_path.clone(), invalid_path])
            .unwrap_err()
            .to_string();

        assert!(error.contains("not a file"));
        assert_eq!(std::fs::read(&sound_path).unwrap(), b"sound");
        assert!(!std::fs::read_dir(&dir).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".delete-backup-")
        }));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn repaired_non_utf8_store_skips_every_asset_sweep() {
        let dir = test_directory("non-utf8-asset-sweep-health-gate-test");
        let sound_path = dir.join("sounds").join("unreferenced.wav");
        let font_path = dir.join("fonts").join("unreferenced.ttf");
        let image_path = dir.join("images").join("unreferenced.png");
        for path in [&sound_path, &font_path, &image_path] {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, b"asset-fixture").unwrap();
        }
        std::fs::write(dir.join("store.json"), [b'{', 0xFF, b'}']).unwrap();

        let store = AppStore::initialize_in_dir(&dir).unwrap();
        assert!(store.skip_asset_sweep);

        store.cleanup_orphan_assets_now().unwrap();

        assert!(sound_path.exists());
        assert!(font_path.exists());
        assert!(image_path.exists());
        assert!(!dir.join("trash").exists());

        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn repaired_sound_library_keeps_valid_local_asset_through_cleanup() {
        let dir = test_directory("sound-library-entry-recovery-test");
        let sounds_dir = dir.join("sounds");
        std::fs::create_dir_all(&sounds_dir).unwrap();

        let builtin_hait = sounds_dir.join("builtin-hait.wav");
        let builtin_click = sounds_dir.join("builtin-click.wav");
        let valid_local = sounds_dir.join("valid-local.wav");
        let invalid_local = sounds_dir.join("invalid-local.wav");
        let wav_fixture = include_bytes!("../../assets/sounds/builtin-click.wav");
        for path in [&builtin_hait, &builtin_click, &valid_local, &invalid_local] {
            std::fs::write(path, wav_fixture).unwrap();
        }

        let mut fixture = serde_json::to_value(AppStoreData::default()).unwrap();
        let sound_library = fixture["soundLibrary"].as_object_mut().unwrap();
        sound_library.insert(
            builtin_hait.to_string_lossy().to_string(),
            json!({ "source": "builtin" }),
        );
        sound_library.insert(
            builtin_click.to_string_lossy().to_string(),
            json!({ "source": "builtin" }),
        );
        sound_library.insert(
            valid_local.to_string_lossy().to_string(),
            json!({ "source": "local", "displayName": "Valid local" }),
        );
        sound_library.insert(
            invalid_local.to_string_lossy().to_string(),
            json!({ "source": 42, "displayName": "Invalid local" }),
        );
        std::fs::write(
            dir.join("store.json"),
            serde_json::to_vec_pretty(&fixture).unwrap(),
        )
        .unwrap();

        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let snapshot = store.snapshot();
        let valid_local_key = valid_local.to_string_lossy().to_string();
        let invalid_local_key = invalid_local.to_string_lossy().to_string();

        assert_eq!(snapshot.sound_library.len(), 4);
        assert_eq!(
            snapshot.sound_library[&valid_local_key].source,
            SoundSource::Local
        );
        assert_eq!(
            snapshot.sound_library[&invalid_local_key].source,
            SoundSource::Local
        );
        assert_eq!(
            snapshot.sound_library[&invalid_local_key]
                .display_name
                .as_deref(),
            Some("Invalid local")
        );
        assert!(store.skip_asset_sweep);

        store.cleanup_orphan_assets_now().unwrap();

        assert!(valid_local.exists());
        assert!(invalid_local.exists());
        assert!(!dir.join("trash").exists());

        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn repaired_asset_references_survive_the_next_normal_session_sweep() {
        fn corrupt_height(mut value: Value) -> Value {
            value
                .as_object_mut()
                .unwrap()
                .insert("height".to_string(), json!("invalid"));
            value
        }

        let dir = test_directory("repaired-asset-reference-next-session-test");
        let font_path = dir.join("fonts").join("recoverable.ttf");
        let library_sound = dir.join("sounds").join("library.wav");
        let stat_sound = dir.join("sounds").join("stat.wav");
        let graph_sound = dir.join("sounds").join("graph.wav");
        let knob_sound = dir.join("sounds").join("knob.wav");
        for path in [
            &font_path,
            &library_sound,
            &stat_sound,
            &graph_sound,
            &knob_sound,
        ] {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, b"asset-fixture").unwrap();
        }

        let mut font = serde_json::to_value(CustomFont {
            id: "recoverable-font".to_string(),
            font_type: FontType::Local,
            name: "Recoverable Font".to_string(),
            display_name: "Recoverable Font".to_string(),
            enabled: true,
            local_path: Some(font_path.to_string_lossy().to_string()),
            css_content: None,
        })
        .unwrap();
        font.as_object_mut()
            .unwrap()
            .insert("enabled".to_string(), json!("invalid"));

        let mut stat_position = default_positions()["4key"][0].clone();
        stat_position.sound_path = Some(stat_sound.to_string_lossy().to_string());
        let stat = corrupt_height(
            serde_json::to_value(StatPosition {
                stat_type: StatType::Kps,
                position: stat_position,
            })
            .unwrap(),
        );
        let mut graph_position = default_positions()["4key"][1].clone();
        graph_position.sound_path = Some(graph_sound.to_string_lossy().to_string());
        let graph = corrupt_height(
            serde_json::to_value(GraphPosition {
                stat_type: GraphStatType::Kps,
                graph_type: GraphType::Line,
                graph_speed: 1,
                graph_color: "#FFFFFF".to_string(),
                show_avg_line: true,
                position: graph_position,
            })
            .unwrap(),
        );
        let mut knob_position = default_positions()["4key"][2].clone();
        knob_position.sound_path = Some(knob_sound.to_string_lossy().to_string());
        let knob = corrupt_height(
            serde_json::to_value(KnobPosition {
                axis_id: "axis-recoverable".to_string(),
                sensitivity: 1.0,
                reverse: false,
                position: knob_position,
            })
            .unwrap(),
        );

        let mut fixture = serde_json::to_value(AppStoreData::default()).unwrap();
        let fields = fixture.as_object_mut().unwrap();
        fields.insert("fontSettings".to_string(), json!({ "customFonts": [font] }));
        fields.insert(
            "soundLibrary".to_string(),
            json!({ library_sound.to_string_lossy().to_string(): 42 }),
        );
        fields.insert("statPositions".to_string(), json!({ "asset-mode": [stat] }));
        fields.insert(
            "graphPositions".to_string(),
            json!({ "asset-mode": [graph] }),
        );
        fields.insert("knobPositions".to_string(), json!({ "asset-mode": [knob] }));
        std::fs::write(
            dir.join("store.json"),
            serde_json::to_vec_pretty(&fixture).unwrap(),
        )
        .unwrap();

        let recovered = AppStore::initialize_in_dir(&dir).unwrap();
        assert!(recovered.skip_asset_sweep);
        let snapshot = recovered.snapshot();
        assert!(!snapshot.font_settings.custom_fonts[0].enabled);
        assert!(snapshot
            .sound_library
            .contains_key(&library_sound.to_string_lossy().to_string()));
        assert_eq!(snapshot.stat_positions["asset-mode"].len(), 1);
        assert_eq!(snapshot.graph_positions["asset-mode"].len(), 1);
        assert_eq!(snapshot.knob_positions["asset-mode"].len(), 1);
        recovered.cleanup_orphan_assets_now().unwrap();
        recovered.flush_and_shutdown().unwrap();
        drop(recovered);

        let normal = AppStore::initialize_in_dir(&dir).unwrap();
        assert!(!normal.skip_asset_sweep);
        normal.cleanup_orphan_assets_now().unwrap();
        for path in [
            &font_path,
            &library_sound,
            &stat_sound,
            &graph_sound,
            &knob_sound,
        ] {
            assert!(path.exists(), "recovered asset was quarantined: {path:?}");
        }

        normal.flush_and_shutdown().unwrap();
        drop(normal);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn normal_session_moves_unreferenced_asset_to_trash() {
        let dir = test_directory("asset-trash-quarantine-test");
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        assert!(!store.skip_asset_sweep);

        let orphan_path = dir.join("sounds").join("orphan.wav");
        std::fs::write(&orphan_path, b"orphan-wav").unwrap();

        store.cleanup_orphan_assets_now().unwrap();

        assert!(!orphan_path.exists());
        let trash_dir = dir.join("trash");
        let sessions: Vec<_> = std::fs::read_dir(&trash_dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        assert_eq!(sessions.len(), 1);
        let quarantined_path = sessions[0].join("sounds").join("orphan.wav");
        assert_eq!(std::fs::read(quarantined_path).unwrap(), b"orphan-wav");

        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn trash_collision_uses_another_session_and_preserves_file_name() {
        let dir = test_directory("asset-trash-collision-test");
        let sounds_dir = dir.join("sounds");
        let trash_dir = dir.join("trash");
        let now = UNIX_EPOCH + Duration::from_secs(2_000_000_000);
        let timestamp = system_time_millis(now).unwrap();
        let collision_path = trash_dir
            .join(timestamp.to_string())
            .join("sounds")
            .join("same.wav");
        let source_path = sounds_dir.join("same.wav");
        std::fs::create_dir_all(collision_path.parent().unwrap()).unwrap();
        std::fs::create_dir_all(&sounds_dir).unwrap();
        std::fs::write(&collision_path, b"existing").unwrap();
        std::fs::write(&source_path, b"incoming").unwrap();

        let mut trash_session = TrashSession::new(trash_dir.clone(), now).unwrap();
        sweep_unreferenced_asset_files("Sounds", &sounds_dir, &HashSet::new(), &mut trash_session)
            .unwrap();

        let moved_path = trash_dir
            .join(format!("{timestamp}-1"))
            .join("sounds")
            .join("same.wav");
        assert!(!source_path.exists());
        assert_eq!(std::fs::read(collision_path).unwrap(), b"existing");
        assert_eq!(std::fs::read(moved_path).unwrap(), b"incoming");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn trash_purge_removes_only_sessions_older_than_thirty_days() {
        let dir = test_directory("asset-trash-retention-test");
        let trash_dir = dir.join("trash");
        let now = UNIX_EPOCH + Duration::from_secs(2_000_000_000);
        let expired_time = now
            .checked_sub(TRASH_RETENTION + Duration::from_secs(1))
            .unwrap();
        let retained_time = now
            .checked_sub(Duration::from_secs(29 * 24 * 60 * 60))
            .unwrap();
        let expired_dir =
            trash_dir.join(format!("{}-1", system_time_millis(expired_time).unwrap()));
        let retained_dir = trash_dir.join(system_time_millis(retained_time).unwrap().to_string());
        std::fs::create_dir_all(expired_dir.join("sounds")).unwrap();
        std::fs::create_dir_all(retained_dir.join("sounds")).unwrap();
        std::fs::write(expired_dir.join("sounds").join("old.wav"), b"old").unwrap();
        std::fs::write(retained_dir.join("sounds").join("recent.wav"), b"recent").unwrap();

        purge_expired_trash_sessions_at(&trash_dir, now).unwrap();

        assert!(!expired_dir.exists());
        assert!(retained_dir.exists());

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn orphan_sweep_recovers_processed_wav_backup_before_removing_temp() {
        let dir = test_directory("processed-wav-orphan-recovery-test");
        let sounds_dir = dir.join("sounds");
        std::fs::create_dir_all(&sounds_dir).unwrap();

        let target_path = sounds_dir.join("sound.wav");
        let backup_path = sounds_dir.join("sound.wav.bak");
        let temp_path = sounds_dir.join(format!(
            ".sound.wav.processed-wav-{}.tmp",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&backup_path, b"old-wav").unwrap();
        std::fs::write(&temp_path, b"new-wav").unwrap();

        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let target_key = target_path.to_string_lossy().to_string();
        store
            .update(|data| {
                data.sound_library
                    .insert(target_key.clone(), Default::default());
            })
            .unwrap();

        store.cleanup_orphan_assets_now().unwrap();

        assert_eq!(std::fs::read(&target_path).unwrap(), b"old-wav");
        assert!(!backup_path.exists());
        assert!(!temp_path.exists());

        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn app_state_initialization_recovers_processed_wav_without_sweeping_temp() {
        let dir = test_directory("processed-wav-startup-recovery-test");
        let sounds_dir = dir.join("sounds");
        std::fs::create_dir_all(&sounds_dir).unwrap();

        let target_path = sounds_dir.join("sound.wav");
        let backup_path = sounds_dir.join("sound.wav.bak");
        let temp_path = sounds_dir.join(format!(
            ".sound.wav.processed-wav-{}.tmp",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&backup_path, b"old-wav").unwrap();
        std::fs::write(&temp_path, b"interrupted-new-wav").unwrap();

        let store = AppStore::initialize_in_dir(&dir).unwrap();
        assert!(!target_path.exists());

        let state = AppState::initialize(store).unwrap();

        assert_eq!(std::fs::read(&target_path).unwrap(), b"old-wav");
        assert!(!backup_path.exists());
        assert!(temp_path.exists());

        state.shutdown();
        drop(state);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn pending_wav_journal_rolls_back_file_before_metadata_is_committed() {
        let dir = test_directory("processed-wav-journal-recovery-test");
        let sounds_dir = dir.join("sounds");
        std::fs::create_dir_all(&sounds_dir).unwrap();
        let target_path = sounds_dir.join("sound.wav");
        let backup_path = sounds_dir.join("sound.wav.bak");
        std::fs::write(&target_path, b"old-wav").unwrap();

        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let target_key = target_path.to_string_lossy().to_string();
        store
            .update(|data| {
                data.sound_library.insert(
                    target_key.clone(),
                    crate::models::SoundLibraryEntry {
                        display_name: Some("old-metadata".to_string()),
                        ..Default::default()
                    },
                );
                data.pending_processed_wav_replacement = Some(PendingProcessedWavReplacement {
                    sound_path: target_key.clone(),
                    had_original: true,
                });
            })
            .unwrap();

        std::fs::rename(&target_path, &backup_path).unwrap();
        std::fs::write(&target_path, b"uncommitted-new-wav").unwrap();
        store
            .recover_interrupted_processed_wav_replacements_now()
            .unwrap();

        let snapshot = store.snapshot();
        assert_eq!(std::fs::read(&target_path).unwrap(), b"old-wav");
        assert_eq!(
            snapshot.sound_library[&target_key].display_name.as_deref(),
            Some("old-metadata")
        );
        assert_eq!(snapshot.pending_processed_wav_replacement, None);
        assert!(!backup_path.exists());
        assert!(std::fs::read_dir(&sounds_dir).unwrap().any(|entry| {
            let entry = entry.unwrap();
            entry
                .file_name()
                .to_string_lossy()
                .contains(".interrupted-")
                && std::fs::read(entry.path()).unwrap() == b"uncommitted-new-wav"
        }));

        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn missing_pending_wav_files_clear_journal_and_allow_repeated_cleanup() {
        let dir = test_directory("processed-wav-missing-journal-test");
        let sounds_dir = dir.join("sounds");
        std::fs::create_dir_all(&sounds_dir).unwrap();
        let target_path = sounds_dir.join("missing.wav");
        let orphan_path = sounds_dir.join("orphan.wav");
        std::fs::write(&orphan_path, b"orphan-wav").unwrap();

        let store = AppStore::initialize_in_dir(&dir).unwrap();
        store
            .update(|data| {
                data.pending_processed_wav_replacement = Some(PendingProcessedWavReplacement {
                    sound_path: target_path.to_string_lossy().to_string(),
                    had_original: true,
                });
            })
            .unwrap();

        store.cleanup_orphan_assets_now().unwrap();

        assert_eq!(store.snapshot().pending_processed_wav_replacement, None);
        assert!(!orphan_path.exists());
        let trash_sessions: Vec<_> = std::fs::read_dir(dir.join("trash"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        assert!(trash_sessions
            .iter()
            .any(|session| session.join("sounds").join("orphan.wav").exists()));

        store.cleanup_orphan_assets_now().unwrap();
        assert_eq!(store.snapshot().pending_processed_wav_replacement, None);

        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn unknown_pending_wav_presence_keeps_journal() {
        let dir = test_directory("processed-wav-unknown-presence-test");
        let sounds_dir = dir.join("sounds");
        std::fs::create_dir_all(&sounds_dir).unwrap();
        let target_path = sounds_dir.join("unknown.wav");

        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let pending = PendingProcessedWavReplacement {
            sound_path: target_path.to_string_lossy().to_string(),
            had_original: true,
        };
        store
            .update(|data| {
                data.pending_processed_wav_replacement = Some(pending.clone());
            })
            .unwrap();
        let checks = std::cell::Cell::new(0);

        let result =
            store.recover_pending_processed_wav_replacement_with(&sounds_dir, |_path| match checks
                .get()
            {
                0 => {
                    checks.set(1);
                    Ok(false)
                }
                _ => {
                    checks.set(2);
                    Err(std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        "injected permission failure",
                    ))
                }
            });

        assert!(result.is_err());
        assert_eq!(checks.get(), 2);
        assert_eq!(
            store.snapshot().pending_processed_wav_replacement,
            Some(pending)
        );

        store
            .update(|data| data.pending_processed_wav_replacement = None)
            .unwrap();
        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn completed_wav_transaction_keeps_new_file_when_only_backup_cleanup_was_interrupted() {
        let dir = test_directory("processed-wav-post-commit-recovery-test");
        let sounds_dir = dir.join("sounds");
        std::fs::create_dir_all(&sounds_dir).unwrap();
        let target_path = sounds_dir.join("sound.wav");
        let backup_path = sounds_dir.join("sound.wav.bak");
        std::fs::write(&target_path, b"new-wav").unwrap();
        std::fs::write(&backup_path, b"old-wav").unwrap();

        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let target_key = target_path.to_string_lossy().to_string();
        store
            .update(|data| {
                data.sound_library.insert(
                    target_key.clone(),
                    crate::models::SoundLibraryEntry {
                        display_name: Some("new-metadata".to_string()),
                        ..Default::default()
                    },
                );
                data.pending_processed_wav_replacement = None;
            })
            .unwrap();

        store
            .recover_interrupted_processed_wav_replacements_now()
            .unwrap();

        assert_eq!(std::fs::read(&target_path).unwrap(), b"new-wav");
        assert_eq!(std::fs::read(&backup_path).unwrap(), b"old-wav");
        assert_eq!(
            store.snapshot().sound_library[&target_key]
                .display_name
                .as_deref(),
            Some("new-metadata")
        );

        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn pending_wav_without_an_original_quarantines_the_uncommitted_file() {
        let dir = test_directory("processed-wav-new-file-journal-test");
        let sounds_dir = dir.join("sounds");
        std::fs::create_dir_all(&sounds_dir).unwrap();
        let target_path = sounds_dir.join("new.wav");
        std::fs::write(&target_path, b"uncommitted-new-wav").unwrap();

        let store = AppStore::initialize_in_dir(&dir).unwrap();
        store
            .update(|data| {
                data.pending_processed_wav_replacement = Some(PendingProcessedWavReplacement {
                    sound_path: target_path.to_string_lossy().to_string(),
                    had_original: false,
                });
            })
            .unwrap();

        store
            .recover_interrupted_processed_wav_replacements_now()
            .unwrap();

        assert!(!target_path.exists());
        assert_eq!(store.snapshot().pending_processed_wav_replacement, None);
        assert!(std::fs::read_dir(&sounds_dir).unwrap().any(|entry| {
            let entry = entry.unwrap();
            entry
                .file_name()
                .to_string_lossy()
                .contains(".interrupted-")
                && std::fs::read(entry.path()).unwrap() == b"uncommitted-new-wav"
        }));

        store.flush_and_shutdown().unwrap();
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn orphan_sweep_continues_recovery_and_protects_failed_backup() {
        let dir = test_directory("processed-wav-partial-recovery-test");
        let sounds_dir = dir.join("sounds");
        std::fs::create_dir_all(&sounds_dir).unwrap();

        let first_target = sounds_dir.join("first.wav");
        let first_backup = sounds_dir.join("first.wav.bak");
        let second_target = sounds_dir.join("second.wav");
        let second_backup = sounds_dir.join("second.wav.bak");
        let temp_path = sounds_dir.join(format!(
            ".first.wav.processed-wav-{}.tmp",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&first_backup, b"first-old-wav").unwrap();
        std::fs::write(&second_backup, b"second-old-wav").unwrap();
        std::fs::write(&temp_path, b"interrupted-new-wav").unwrap();

        let mut retained_keys = HashSet::from([
            path_identity_key(&first_target),
            path_identity_key(&second_target),
        ]);
        let rename_attempts = std::cell::Cell::new(0);
        let failed_backup = std::cell::RefCell::new(None);
        let recovered_target = std::cell::RefCell::new(None);
        let recovery =
            recover_interrupted_processed_wav_replacements_with(&sounds_dir, |from, to| {
                let attempt = rename_attempts.get();
                rename_attempts.set(attempt + 1);
                if attempt == 0 {
                    failed_backup.replace(Some(from.to_path_buf()));
                    Err(std::io::Error::other("injected recovery failure"))
                } else {
                    recovered_target.replace(Some(to.to_path_buf()));
                    std::fs::rename(from, to)
                }
            })
            .unwrap();
        assert!(!recovery.complete);
        retained_keys.extend(recovery.protected_keys);
        let mut trash_session = TrashSession::new(dir.join("trash"), SystemTime::now()).unwrap();
        sweep_unreferenced_asset_files("Sounds", &sounds_dir, &retained_keys, &mut trash_session)
            .unwrap();

        assert_eq!(rename_attempts.get(), 2);
        let failed_backup = failed_backup.into_inner().unwrap();
        let failed_target_name = failed_backup
            .file_name()
            .unwrap()
            .to_string_lossy()
            .strip_suffix(".bak")
            .unwrap()
            .to_string();
        let failed_target = failed_backup.with_file_name(failed_target_name);
        let recovered_target = recovered_target.into_inner().unwrap();
        assert!(!failed_target.exists());
        assert!(failed_backup.exists());
        assert!(recovered_target.exists());
        assert!(!recovered_target.with_extension("wav.bak").exists());
        assert!(!temp_path.exists());

        let _ = std::fs::remove_dir_all(dir);
    }
}
