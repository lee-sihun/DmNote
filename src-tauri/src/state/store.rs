use std::{
    collections::{HashSet, VecDeque},
    fs,
    path::{Component, Path, PathBuf},
    sync::mpsc,
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use crate::errors::{EditorCommitError, EditorCommitErrorCode};
use crate::models::{
    AppStoreData, CommittedEditorChange, EditorCommitOrigin, EditorCommitRequest,
    EditorCommitResult, EditorCommittedV1, EditorDocumentV1, EditorField, EditorGetResult,
    EditorHistoryRestoreRequest, EditorTransactionResult, FontType, KeyCounters, KeyPosition,
    SettingsDiff, SettingsState, EDITOR_SCHEMA_VERSION,
};
use anyhow::{anyhow, Context, Result};
use parking_lot::{Mutex, RwLock, RwLockWriteGuard};
use serde_json::Value;
use tauri::path::PathResolver;
use tauri::Runtime;

use super::atomic_file::atomic_replace;
use super::builtin_sounds::seed_builtin_sounds;
use super::editor::{
    next_revision, repair_selected_mode, request_fingerprint, request_payload_size,
    sync_key_counters, touched_pair, validate_document_transition,
    validate_history_restore_envelope, validate_history_restore_metadata, validate_paired_update,
    validate_request_envelope, RequestFingerprint, MUTATION_ACK_CAPACITY,
};
use super::local_asset_path::{file_url_to_path, path_identity_key, FileUrlPath};
use super::migration::{
    find_legacy_store_file, load_store_from_path, migrate_key_images_to_app_data,
    migrate_local_fonts_to_app_data, normalize_state,
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
}

struct VersionedStoreState {
    data: AppStoreData,
    revision: u64,
    dirty: bool,
    accepting_writes: bool,
    mutation_acks: VecDeque<MutationAck>,
}

#[derive(Clone)]
struct MutationAck {
    id: String,
    fingerprint: RequestFingerprint,
    result: EditorCommitResult,
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

        warn_unresolved_asset_references(&state);

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
            state: RwLock::new(VersionedStoreState {
                data: state,
                revision: 0,
                dirty: false,
                accepting_writes: true,
                mutation_acks: VecDeque::with_capacity(MUTATION_ACK_CAPACITY),
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

    /// `overlay_bounds`, `overlay_bounds_are_logical`, `overlay_last_content_top_offset` 전용
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

    pub(crate) fn restore_editor_history(
        &self,
        request: EditorHistoryRestoreRequest,
    ) -> std::result::Result<EditorTransactionResult<Option<SettingsDiff>>, EditorCommitError> {
        validate_history_restore_envelope(&request)?;
        let EditorHistoryRestoreRequest {
            base_revision,
            document,
            custom_tabs,
            selected_key_type,
            key_counters,
            settings_patch,
            tab_note_overrides,
        } = request;

        self.commit_legacy_editor_transaction(
            EditorCommitOrigin::LegacyAdapter("editor_history_restore".to_string()),
            &[
                EditorField::Keys,
                EditorField::KeyPositions,
                EditorField::StatPositions,
                EditorField::GraphPositions,
                EditorField::KnobPositions,
                EditorField::LayerGroups,
            ],
            move |store| {
                if store.editor_revision != base_revision {
                    return Err(EditorCommitError::revision_conflict(store.editor_revision));
                }
                validate_history_restore_metadata(&document, &custom_tabs, &selected_key_type)?;

                store.custom_tabs = custom_tabs;
                store.selected_key_type = selected_key_type;
                document.apply_to_store(store);
                if let Some(counters) = key_counters {
                    store.key_counters = counters;
                }
                if let Some(overrides) = tab_note_overrides {
                    store.tab_note_overrides = overrides;
                }
                let settings_diff = settings_patch
                    .as_ref()
                    .map(|patch| crate::services::settings::apply_patch_to_store(store, patch));
                Ok(settings_diff)
            },
        )
    }

    pub fn commit_editor_document(
        &self,
        request: EditorCommitRequest,
    ) -> std::result::Result<CommittedEditorChange, EditorCommitError> {
        let started = Instant::now();
        let base_revision = request.base_revision;
        let mutation_id = uuid::Uuid::parse_str(&request.mutation_id)
            .map(|id| id.hyphenated().to_string())
            .unwrap_or_else(|_| "<invalid>".to_string());
        let payload_size = request_payload_size(&request);
        let payload_bytes = payload_size.as_ref().copied().unwrap_or(0);
        let result = match payload_size {
            Ok(_) => self.commit_editor_document_inner(request),
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
        request: EditorCommitRequest,
    ) -> std::result::Result<CommittedEditorChange, EditorCommitError> {
        validate_request_envelope(&request)?;
        let fingerprint = request_fingerprint(&request)?;
        let mut guard = self
            .lock_for_update()
            .map_err(|error| EditorCommitError::io(error.to_string()))?;

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
            });
        }

        if request.base_revision != guard.data.editor_revision {
            return Err(EditorCommitError::revision_conflict(
                guard.data.editor_revision,
            ));
        }

        let current_store = guard.data.clone();
        let current = EditorDocumentV1::from_store(&current_store);
        let mut candidate = current.clone();
        candidate.apply_patch(&request.changes);

        validate_paired_update(
            &current,
            &candidate,
            request.changes.includes(EditorField::Keys),
            request.changes.includes(EditorField::KeyPositions),
        )?;

        let mut scratch = current_store.clone();
        candidate.apply_to_store(&mut scratch);
        scratch.editor_revision = current_store.editor_revision;
        validate_document_transition(&current, &candidate, &current_store, &scratch)?;

        let changed_fields = current.changed_fields(&candidate);
        if changed_fields.is_empty() {
            let result = EditorCommitResult {
                revision: current_store.editor_revision,
                changed_fields,
            };
            insert_mutation_ack(
                &mut guard.mutation_acks,
                request.mutation_id,
                fingerprint,
                result.clone(),
            );
            return Ok(CommittedEditorChange {
                result,
                event: None,
                replayed: false,
                document: current,
                selected_key_type: current_store.selected_key_type,
                key_counters: current_store.key_counters,
            });
        }

        let revision = next_revision(current_store.editor_revision)?;
        if changed_fields.contains(&EditorField::Keys) {
            sync_key_counters(&mut scratch.key_counters, &candidate.keys);
            repair_selected_mode(&mut scratch);
        }
        scratch.editor_revision = revision;
        let selected_key_type = scratch.selected_key_type.clone();
        let key_counters = scratch.key_counters.clone();

        self.commit_locked(&mut guard, scratch, ())
            .map_err(|error| EditorCommitError::io(error.to_string()))?;

        let result = EditorCommitResult {
            revision,
            changed_fields: changed_fields.clone(),
        };
        insert_mutation_ack(
            &mut guard.mutation_acks,
            request.mutation_id.clone(),
            fingerprint,
            result.clone(),
        );
        let event = EditorCommittedV1 {
            schema_version: EDITOR_SCHEMA_VERSION,
            revision,
            mutation_id: request.mutation_id,
            origin: EditorCommitOrigin::StrictEditorCommit
                .event_name()
                .expect("strict editor commit always has an event origin"),
            changed_fields: changed_fields.clone(),
            patch: candidate.patch_for_fields(&changed_fields),
        };

        Ok(CommittedEditorChange {
            result,
            event: Some(event),
            replayed: false,
            document: candidate,
            selected_key_type,
            key_counters,
        })
    }

    pub(crate) fn commit_legacy_editor_transaction<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<EditorTransactionResult<T>, EditorCommitError> {
        let started = Instant::now();
        let origin_name = origin
            .event_name()
            .unwrap_or_else(|| "loadRecovery".to_string());
        let result = self.commit_legacy_editor_transaction_inner(origin, touched_fields, updater);
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
        result
    }

    fn commit_legacy_editor_transaction_inner<T>(
        &self,
        origin: EditorCommitOrigin,
        touched_fields: &[EditorField],
        updater: impl FnOnce(&mut AppStoreData) -> std::result::Result<T, EditorCommitError>,
    ) -> std::result::Result<EditorTransactionResult<T>, EditorCommitError> {
        let mut guard = self
            .lock_for_update()
            .map_err(|error| EditorCommitError::io(error.to_string()))?;
        let current_store = guard.data.clone();
        let current = EditorDocumentV1::from_store(&current_store);
        let mut scratch = current_store.clone();
        let value = updater(&mut scratch)?;

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

        let event = if changed_fields.is_empty() {
            None
        } else {
            origin.event_name().map(|origin| EditorCommittedV1 {
                schema_version: EDITOR_SCHEMA_VERSION,
                revision,
                mutation_id: uuid::Uuid::new_v4().to_string(),
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
        };

        Ok(EditorTransactionResult { value, change })
    }

    pub fn set_key_counters(&self, counters: KeyCounters) -> Result<KeyCounters> {
        self.update_committed(
            move |state| state.key_counters = counters,
            |state| state.key_counters.clone(),
        )
    }

    pub fn set_selected_key_type(&self, key: impl Into<String>) -> Result<String> {
        let key = key.into();
        self.update_committed(
            move |state| state.selected_key_type = key,
            |state| state.selected_key_type.clone(),
        )
    }

    // 플러그인 데이터 관련 메서드
    pub fn get_plugin_data(&self, key: &str) -> Result<Option<Value>> {
        let guard = self.state.read();
        Ok(guard.data.plugin_data.get(key).cloned())
    }

    pub fn set_plugin_data(&self, key: &str, value: Value) -> Result<()> {
        let mut guard = self.lock_for_update()?;
        let mut scratch = guard.data.clone();
        scratch.plugin_data.insert(key.to_string(), value);
        self.commit_locked(&mut guard, scratch, ())
    }

    pub fn remove_plugin_data(&self, key: &str) -> Result<()> {
        let mut guard = self.lock_for_update()?;
        let mut scratch = guard.data.clone();
        scratch.plugin_data.remove(key);
        self.commit_locked(&mut guard, scratch, ())
    }

    pub fn clear_all_plugin_data(&self) -> Result<()> {
        let mut guard = self.lock_for_update()?;
        let mut scratch = guard.data.clone();
        scratch.plugin_data.clear();
        self.commit_locked(&mut guard, scratch, ())
    }

    pub fn get_all_plugin_keys(&self) -> Result<Vec<String>> {
        let guard = self.state.read();
        Ok(guard.data.plugin_data.keys().cloned().collect())
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
        let referenced_fonts = collect_local_font_paths(&snapshot);
        let referenced_images = collect_local_image_paths(&snapshot);
        let mut referenced_sounds = collect_local_sound_paths(&snapshot);
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
        EditorCommitErrorCode::ValidationFailed => "validation_failed",
        EditorCommitErrorCode::PairedUpdateRequired => "paired_update_required",
        EditorCommitErrorCode::MutationIdReused => "mutation_id_reused",
        EditorCommitErrorCode::IoError => "io_error",
    }
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

    fn collect(&mut self, value: Option<&String>) {
        let Some(path) = value else {
            return;
        };
        match resolve_local_asset_path(path) {
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

fn warn_unresolved_asset_references(data: &AppStoreData) {
    for (category, count) in [
        ("fonts", collect_local_font_paths(data).unresolved_count),
        ("images", collect_local_image_paths(data).unresolved_count),
        ("sounds", collect_local_sound_paths(data).unresolved_count),
    ] {
        if count > 0 {
            log::warn!("[Assets] {category} sweep 보류: 해석 불가 참조 {count}건");
        }
    }
}

fn collect_local_font_paths(data: &AppStoreData) -> AssetReferencePaths {
    let mut paths = AssetReferencePaths::new();

    for font in data
        .font_settings
        .custom_fonts
        .iter()
        .filter(|font| font.font_type == FontType::Local)
    {
        paths.collect(font.local_path.as_ref());
    }

    paths
}

fn collect_local_image_paths(data: &AppStoreData) -> AssetReferencePaths {
    let mut paths = AssetReferencePaths::new();

    for position in iter_all_positions(data) {
        paths.collect(position.active_image.as_ref());
        paths.collect(position.inactive_image.as_ref());
    }

    paths
}

#[cfg(test)]
fn collect_local_image_path_keys(data: &AppStoreData) -> HashSet<String> {
    collect_local_image_paths(data).keys
}

fn collect_local_sound_paths(data: &AppStoreData) -> AssetReferencePaths {
    let mut paths = AssetReferencePaths::new();

    for position in iter_all_positions(data) {
        paths.collect(position.sound_path.as_ref());
    }

    // 사운드 라이브러리에 등록된 파일도 보호 (키에 할당 안 되어도 유지)
    for key in data.sound_library.keys() {
        paths.collect(Some(key));
    }

    paths
}

#[cfg(test)]
fn collect_local_sound_path_keys(data: &AppStoreData) -> HashSet<String> {
    collect_local_sound_paths(data).keys
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

fn resolve_local_asset_path(path: &str) -> LocalAssetPathResolution {
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
        FileUrlPath::Path(path) => LocalAssetPathResolution::Path(path),
        FileUrlPath::Invalid => LocalAssetPathResolution::Unresolved,
        FileUrlPath::NotFileUrl => {
            let path = PathBuf::from(trimmed);
            if path.is_absolute() {
                LocalAssetPathResolution::Path(path)
            } else if looks_like_unresolved_local_path(trimmed) {
                LocalAssetPathResolution::Unresolved
            } else {
                LocalAssetPathResolution::Ignored
            }
        }
    }
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
    let mut keys = collect_local_sound_paths(data).keys;
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
mod tests {
    use super::{
        collect_local_font_paths, collect_local_image_path_keys, collect_local_image_paths,
        collect_local_sound_path_keys, collect_local_sound_paths, purge_expired_trash_sessions_at,
        recover_interrupted_processed_wav_replacements_with,
        recover_interrupted_sound_deletions_with, stage_sound_files_for_deletion,
        sweep_unreferenced_asset_files, system_time_millis, AppStore, TrashSession,
        PROCESSED_WAV_TRANSACTION_LOCK, TRASH_RETENTION,
    };
    use crate::{
        defaults::default_positions,
        errors::{EditorCommitError, EditorCommitErrorCode},
        keyboard::KeyboardManager,
        models::{
            AppStoreData, CommittedEditorChange, CustomFont, CustomTab, EditorCommitOrigin,
            EditorCommitRequest, EditorDocumentV1, EditorField, EditorHistoryRestoreRequest,
            EditorPatchV1, FontType, GraphPosition, GraphStatType, GraphType, KeyCounters,
            KeyPosition, KnobPosition, OverlayBounds, PendingProcessedWavReplacement,
            SettingsPatchInput, SoundLibraryEntry, SoundSource, StatPosition, StatType,
            TabNoteSettings,
        },
        services::settings::apply_patch_to_store,
        state::{app_state::KeyCounterEventEmitter, local_asset_path::path_identity_key, AppState},
    };
    use serde_json::{json, Value};
    use std::{
        collections::{HashMap, HashSet},
        path::Path,
        sync::{
            atomic::{AtomicBool, Ordering},
            mpsc, Arc, Barrier, Mutex,
        },
        time::{Duration, SystemTime, UNIX_EPOCH},
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
        fn emit_key_counters(&self, counters: &KeyCounters) -> anyhow::Result<()> {
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

        fn emit_key_counter(&self, _mode: &str, _key: &str, count: u32) -> anyhow::Result<()> {
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
    fn strict_editor_commit_persists_once_and_synchronizes_key_counters() {
        let dir = test_directory("strict-editor-success-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        let persist_count = store.writer.persist_count();
        let before = store.snapshot();
        let old_key = before.keys["4key"][0].clone();
        let mut keys = before.keys.clone();
        keys.get_mut("4key").unwrap()[0] = "StrictKey".to_string();
        let request = editor_request(
            0,
            uuid::Uuid::new_v4().to_string(),
            EditorPatchV1 {
                keys: Some(keys),
                ..EditorPatchV1::default()
            },
        );

        let change = store.commit_editor_document(request).unwrap();

        assert_eq!(change.result.revision, 1);
        assert_eq!(change.result.changed_fields, vec![EditorField::Keys]);
        assert_eq!(change.event.as_ref().unwrap().origin, "editorCommit");
        assert_eq!(store.writer.persist_count(), persist_count + 1);
        let snapshot = store.snapshot();
        assert_eq!(snapshot.editor_revision, 1);
        assert_eq!(snapshot.keys["4key"][0], "StrictKey");
        assert_eq!(snapshot.key_counters["4key"]["StrictKey"], 0);
        assert!(!snapshot.key_counters["4key"].contains_key(&old_key));

        store.flush_and_shutdown().unwrap();
        drop(store);
        let reloaded = crate::state::migration::load_store_from_path(&dir.join("store.json"))
            .unwrap()
            .data;
        assert_eq!(reloaded.editor_revision, 1);
        assert_eq!(reloaded.keys["4key"][0], "StrictKey");
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
        keys.get_mut("4key").unwrap().push("F5".to_string());
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
            .insert("ghost".to_string(), vec!["GhostKey".to_string()]);
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
        assert_eq!(snapshot.keys["ghost"], vec!["GhostKey".to_string()]);
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
                    data.keys
                        .insert(custom_mode.clone(), vec!["KeyA".to_string()]);
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
        mappings.get_mut("4key").unwrap().push("F5".to_string());
        mappings.get_mut("5key").unwrap().push(String::new());
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
        assert_eq!(keys["4key"].last().unwrap(), "F5");
        assert_eq!(positions["4key"].last().unwrap(), &KeyPosition::default());
        assert!(keys["5key"].last().unwrap().is_empty());
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
        mappings.get_mut("4key").unwrap().push("F5".to_string());
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
    fn history_restore_commits_all_core_state_once_and_fails_closed() {
        let dir = test_directory("history-restore-transaction-test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = AppStore::initialize_in_dir(&dir).unwrap();
        store
            .set_plugin_data("history_fixture", json!({ "kept": true }))
            .unwrap();
        let before = store.snapshot();
        let persist_count = store.writer.persist_count();
        let mut document = EditorDocumentV1::from_store(&before);
        document.key_positions.get_mut("4key").unwrap()[0].dx = 456.0;
        let mut counters = before.key_counters.clone();
        let first_key = before.keys["4key"][0].clone();
        counters
            .get_mut("4key")
            .unwrap()
            .insert(first_key.clone(), 77);
        let mut tab_note_overrides = HashMap::new();
        tab_note_overrides.insert(
            "4key".to_string(),
            TabNoteSettings {
                speed: Some(777),
                ..TabNoteSettings::default()
            },
        );

        let transaction = store
            .restore_editor_history(EditorHistoryRestoreRequest {
                base_revision: before.editor_revision,
                document,
                custom_tabs: before.custom_tabs.clone(),
                selected_key_type: before.selected_key_type.clone(),
                key_counters: Some(counters),
                settings_patch: Some(SettingsPatchInput {
                    background_color: Some("#123456".to_string()),
                    ..SettingsPatchInput::default()
                }),
                tab_note_overrides: Some(tab_note_overrides),
            })
            .unwrap();

        assert_eq!(store.writer.persist_count(), persist_count + 1);
        assert_eq!(
            transaction.change.result.revision,
            before.editor_revision + 1
        );
        assert_eq!(
            transaction.change.result.changed_fields,
            vec![EditorField::KeyPositions]
        );
        assert!(transaction.value.is_some());
        let committed = store.snapshot();
        assert_eq!(committed.key_positions["4key"][0].dx, 456.0);
        assert_eq!(committed.key_counters["4key"][&first_key], 77);
        assert_eq!(committed.background_color, "#123456");
        assert_eq!(committed.tab_note_overrides["4key"].speed, Some(777));
        assert_eq!(committed.plugin_data["history_fixture"]["kept"], true);

        let before_failure = store.snapshot();
        let disk_before_failure = std::fs::read(dir.join("store.json")).unwrap();
        let mut failed_document = EditorDocumentV1::from_store(&before_failure);
        failed_document.key_positions.get_mut("4key").unwrap()[0].dx = 999.0;
        store.writer.fail_next_persist();
        let failed = store.restore_editor_history(EditorHistoryRestoreRequest {
            base_revision: before_failure.editor_revision,
            document: failed_document.clone(),
            custom_tabs: before_failure.custom_tabs.clone(),
            selected_key_type: before_failure.selected_key_type.clone(),
            key_counters: None,
            settings_patch: Some(SettingsPatchInput {
                background_color: Some("#FFFFFF".to_string()),
                ..SettingsPatchInput::default()
            }),
            tab_note_overrides: None,
        });

        assert_eq!(
            failed.unwrap_err().error_code,
            EditorCommitErrorCode::IoError
        );
        assert_eq!(store.snapshot(), before_failure);
        assert_eq!(
            std::fs::read(dir.join("store.json")).unwrap(),
            disk_before_failure
        );

        let persist_count = store.writer.persist_count();
        let stale = store.restore_editor_history(EditorHistoryRestoreRequest {
            base_revision: before_failure.editor_revision - 1,
            document: failed_document,
            custom_tabs: before_failure.custom_tabs.clone(),
            selected_key_type: before_failure.selected_key_type.clone(),
            key_counters: None,
            settings_patch: None,
            tab_note_overrides: None,
        });
        assert_eq!(
            stale.unwrap_err().error_code,
            EditorCommitErrorCode::RevisionConflict
        );
        assert_eq!(store.writer.persist_count(), persist_count);
        assert_eq!(store.snapshot(), before_failure);

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
        keys.get_mut("4key").unwrap()[0] = "PresetKey".to_string();

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
        let key = snapshot.keys[&mode][0].clone();
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

        assert!(state.reset_key_counters(&emitter).is_err());
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
        let key = snapshot.keys[&mode][0].clone();
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
        let reset_handle =
            std::thread::spawn(move || reset_state.reset_key_counters(reset_emitter.as_ref()));
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
        assert_eq!(reset_snapshot[&mode][&key], 0);
        assert_eq!(
            increment_done_rx
                .recv_timeout(Duration::from_secs(3))
                .unwrap(),
            Some(1)
        );
        increment_handle.join().unwrap();
        assert_eq!(*events.lock().unwrap(), vec!["snapshot:0", "counter:1"]);
        assert_eq!(state.snapshot_key_counters()[&mode][&key], 1);

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

        let image_paths = collect_local_image_path_keys(&data);
        let sound_paths = collect_local_sound_path_keys(&data);
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

        assert!(collect_local_image_path_keys(&data)
            .contains(&path_identity_key(Path::new("/tmp/dmnote-file-url.png"))));
        assert!(collect_local_sound_path_keys(&data)
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

        let fonts = collect_local_font_paths(&data);
        let images = collect_local_image_paths(&data);
        let sounds = collect_local_sound_paths(&data);

        assert!(!fonts.complete);
        assert!(!images.complete);
        assert!(!sounds.complete);
        assert_eq!(fonts.unresolved_count, 1);
        assert_eq!(images.unresolved_count, 1);
        assert_eq!(sounds.unresolved_count, 2);
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
        assert_eq!(snapshot.keys[tab_id], vec!["F5"]);
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
        assert_eq!(reloaded.data.keys[tab_id], vec!["F5"]);
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
