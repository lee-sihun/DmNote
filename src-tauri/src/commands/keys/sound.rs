use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};
use tauri::{AppHandle, Manager, WebviewWindow};
use uuid::Uuid;

use crate::commands::{
    dialog::parented_file_dialog, editor::state::publish_legacy_editor_change,
    issue_mutation_ticket, run_blocking, run_history_mutation, run_mutation,
};
use crate::errors::{CmdResult, CommandError};
use crate::models::{
    AppStoreData, EditorCommitOrigin, EditorField, PendingProcessedWavReplacement,
    SoundLibraryEntry, SoundSource,
};
use crate::services::event_publisher::publish_event;
use crate::state::{
    atomic_file::{prepare_atomic_replace, PreparedAtomicReplace},
    history::HistoryAdmissionLease,
    local_asset_path::paths_have_same_identity,
    store::{
        move_staged_sound_deletions_to_trash, restore_staged_sound_deletions,
        stage_sound_files_for_deletion, PROCESSED_WAV_TRANSACTION_LOCK,
    },
    AppState,
};

const SUPPORTED_SOUND_EXTENSIONS: [&str; 8] =
    ["wav", "mp3", "ogg", "flac", "m4a", "aac", "aif", "aiff"];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SoundReferenceChangeEvent {
    Key,
    Stat,
    Graph,
    Knob,
}

impl SoundReferenceChangeEvent {
    fn name(self) -> &'static str {
        match self {
            Self::Key => "positions:changed",
            Self::Stat => "statPositions:changed",
            Self::Graph => "graphPositions:changed",
            Self::Knob => "knobPositions:changed",
        }
    }

    fn from_editor_field(field: EditorField) -> Option<Self> {
        match field {
            EditorField::KeyPositions => Some(Self::Key),
            EditorField::StatPositions => Some(Self::Stat),
            EditorField::GraphPositions => Some(Self::Graph),
            EditorField::KnobPositions => Some(Self::Knob),
            _ => None,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundLoadResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sound_path: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SoundListItem {
    pub sound_path: String,
    pub file_name: String,
    pub size_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at_ms: Option<u64>,
    pub hidden: bool,
    // deprecated — 1.6.1 플러그인 계약 호환용 역논리 별칭 (enabled = !hidden)
    pub enabled: bool,
    pub source: SoundSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trim_start_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trim_end_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundSaveProcessedWavRequest {
    pub wav_base64: String,
    pub file_name: Option<String>,
    pub original_base64: Option<String>,
    pub original_extension: Option<String>,
    pub trim_start_ratio: Option<f64>,
    pub trim_end_ratio: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundSaveProcessedWavResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sound_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundDeleteResponse {
    pub success: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundRenameResponse {
    pub success: bool,
    pub display_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundSetHiddenResponse {
    pub success: bool,
    pub sound_path: String,
    pub hidden: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundSetEnabledResponse {
    pub success: bool,
    pub sound_path: String,
    pub enabled: bool,
}

/// 로컬 사운드 파일을 선택하고 appData/sounds 디렉토리로 복사한 뒤 경로 반환
#[tauri::command]
pub async fn sound_load(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> CmdResult<SoundLoadResponse> {
    let picked = parented_file_dialog(&window, "Audio", &SUPPORTED_SOUND_EXTENSIONS)
        .pick_file()
        .await;

    let Some(file) = picked else {
        return Ok(SoundLoadResponse {
            success: false,
            error: None,
            sound_path: None,
        });
    };
    let path = file.path().to_path_buf();
    run_blocking(app, move |app, state| {
        state.ensure_mutation_allowed().map_err(CommandError::msg)?;
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("wav")
            .to_lowercase();
        let sounds_dir = ensure_sounds_dir(app)?;
        let dest_path = sounds_dir.join(format!("{}.{}", Uuid::new_v4(), ext));
        fs::copy(&path, &dest_path)
            .map_err(|e| CommandError::msg(format!("사운드 파일 복사 실패: {e}")))?;
        let ticket = issue_mutation_ticket(app)?;
        ticket.run(|| {
            let dest_path_str = normalize_path_string(&dest_path);
            state.store.update(|s| {
                s.sound_library.insert(
                    dest_path_str.clone(),
                    SoundLibraryEntry {
                        source: SoundSource::Local,
                        ..Default::default()
                    },
                );
            })?;

            Ok(SoundLoadResponse {
                success: true,
                error: None,
                sound_path: Some(dest_path_str),
            })
        })
    })
    .await
}

#[tauri::command]
pub async fn sound_list(app: tauri::AppHandle) -> CmdResult<Vec<SoundListItem>> {
    // 디렉터리 스캔은 번호표 밖 - OBS 클라이언트도 부르는 읽기 경로가 저장 큐를 막지 않게.
    // 라이브러리에 변화가 있을 때만 번호표를 받아 persist한다 (sound_load와 같은 순서)
    run_blocking(app, sound_list_inner).await
}

struct SoundScan {
    items: Vec<SoundListItem>,
    library_at_scan: std::collections::HashMap<String, SoundLibraryEntry>,
    seen_paths: HashSet<String>,
    scan_complete: bool,
}

fn sound_list_inner(app: &tauri::AppHandle, state: &AppState) -> CmdResult<Vec<SoundListItem>> {
    let sounds_dir = ensure_sounds_dir(app)?;
    let scan = {
        let _transaction_guard = PROCESSED_WAV_TRANSACTION_LOCK.lock();
        let recovery_complete = state.store.prepare_sound_listing_while_locked()?;
        let library = state.store.with_state(|s| s.sound_library.clone());
        scan_sounds_dir(&sounds_dir, library, recovery_complete)?
    };
    let SoundScan {
        mut items,
        library_at_scan,
        seen_paths,
        scan_complete,
    } = scan;

    if sound_library_needs_reconcile(&library_at_scan, &seen_paths, scan_complete) {
        let ticket = issue_mutation_ticket(app)?;
        ticket.run(|| -> CmdResult<()> {
            // 잠금 순서: 번호표 turn → PROCESSED_WAV 잠금 (sound_delete와 동일)
            let _transaction_guard = PROCESSED_WAV_TRANSACTION_LOCK.lock();
            state.store.update(|s| {
                apply_sound_scan_to_library(
                    &mut s.sound_library,
                    &library_at_scan,
                    &seen_paths,
                    scan_complete,
                    &|key| Path::new(key).exists(),
                );
            })?;
            Ok(())
        })?;
    }

    // 내장 사운드 우선, 이후 최신순
    items.sort_by(|a, b| {
        let a_builtin = a.source == SoundSource::Builtin;
        let b_builtin = b.source == SoundSource::Builtin;
        b_builtin
            .cmp(&a_builtin)
            .then_with(|| {
                b.modified_at_ms
                    .unwrap_or_default()
                    .cmp(&a.modified_at_ms.unwrap_or_default())
            })
            .then_with(|| a.file_name.cmp(&b.file_name))
    });

    Ok(items)
}

fn scan_sounds_dir(
    sounds_dir: &Path,
    library: std::collections::HashMap<String, SoundLibraryEntry>,
    recovery_complete: bool,
) -> CmdResult<SoundScan> {
    let mut items = Vec::new();
    let mut seen_paths = HashSet::new();
    let mut scan_complete = recovery_complete;

    let entries = fs::read_dir(sounds_dir)
        .map_err(|e| CommandError::msg(format!("사운드 디렉토리 읽기 실패: {e}")))?;

    for entry_result in entries {
        let entry = match entry_result {
            Ok(entry) => entry,
            Err(error) => {
                scan_complete = false;
                log::warn!("[Sounds] 사운드 항목 열거 실패: {error}");
                continue;
            }
        };

        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) => {
                scan_complete = false;
                log::warn!(
                    "[Sounds] 사운드 항목 형식 확인 실패 ('{}'): {error}",
                    path.display()
                );
                continue;
            }
        };
        if file_type.is_dir() || !is_supported_sound_file(&path) {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(error) => {
                scan_complete = false;
                log::warn!(
                    "[Sounds] 사운드 메타데이터 확인 실패 ('{}'): {error}",
                    path.display()
                );
                continue;
            }
        };
        if !metadata.is_file() {
            continue;
        }

        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string();
        if file_name.is_empty() {
            continue;
        }

        let path_key = normalize_path_string(&path);
        seen_paths.insert(path_key.clone());

        let entry_meta = library.get(&path_key).cloned().unwrap_or_default();

        let modified_at_ms = metadata.modified().ok().and_then(|modified| {
            modified
                .duration_since(SystemTime::UNIX_EPOCH)
                .ok()
                .map(|duration| duration.as_millis() as u64)
        });

        items.push(SoundListItem {
            sound_path: path_key,
            file_name,
            size_bytes: metadata.len(),
            modified_at_ms,
            hidden: entry_meta.hidden,
            enabled: !entry_meta.hidden,
            source: entry_meta.source,
            original_path: entry_meta.original_path,
            trim_start_ratio: entry_meta.trim_start_ratio,
            trim_end_ratio: entry_meta.trim_end_ratio,
            display_name: entry_meta.display_name,
        });
    }

    Ok(SoundScan {
        items,
        library_at_scan: library,
        seen_paths,
        scan_complete,
    })
}

// 스캔 결과가 라이브러리와 다른가 - 같으면 번호표를 받지 않는다.
// 실제 적용은 turn 안의 apply_sound_scan_to_library (디스크 재확인 포함)
fn sound_library_needs_reconcile(
    library: &std::collections::HashMap<String, SoundLibraryEntry>,
    seen_paths: &HashSet<String>,
    scan_complete: bool,
) -> bool {
    seen_paths.iter().any(|key| !library.contains_key(key))
        || !stale_sound_library_keys(library, seen_paths, scan_complete).is_empty()
}

// 라이브러리를 스캔 결과에 맞춘다. 스캔~turn 사이의 sound_delete·sound_load·
// sound_update_processed_wav를 존중해 삽입·삭제 양쪽 모두 디스크 실재를 다시 확인하고,
// 삭제 후보는 스캔 시점에 있던 키로 한정한다
fn apply_sound_scan_to_library(
    library: &mut std::collections::HashMap<String, SoundLibraryEntry>,
    library_at_scan: &std::collections::HashMap<String, SoundLibraryEntry>,
    seen_paths: &HashSet<String>,
    scan_complete: bool,
    exists: &dyn Fn(&str) -> bool,
) {
    for key in seen_paths {
        if !library.contains_key(key) && exists(key) {
            library.insert(key.clone(), SoundLibraryEntry::default());
        }
    }
    if !scan_complete {
        return;
    }
    let stale: Vec<String> = library
        .keys()
        .filter(|key| {
            library_at_scan.contains_key(*key) && !seen_paths.contains(*key) && !exists(key)
        })
        .cloned()
        .collect();
    for key in stale {
        library.remove(&key);
    }
}

fn stale_sound_library_keys(
    library: &std::collections::HashMap<String, SoundLibraryEntry>,
    seen_paths: &HashSet<String>,
    scan_complete: bool,
) -> Vec<String> {
    if !scan_complete {
        return Vec::new();
    }
    library
        .keys()
        .filter(|key| !seen_paths.contains(*key))
        .cloned()
        .collect()
}

#[tauri::command]
pub async fn sound_set_hidden(
    app: tauri::AppHandle,
    sound_path: String,
    hidden: bool,
) -> CmdResult<SoundSetHiddenResponse> {
    run_mutation(app, move |app, state| {
        let path_key = set_sound_hidden(app, state, &sound_path, hidden)?;
        Ok(SoundSetHiddenResponse {
            success: true,
            sound_path: path_key,
            hidden,
        })
    })
    .await
}

#[tauri::command]
pub async fn sound_set_enabled(
    app: tauri::AppHandle,
    sound_path: String,
    enabled: bool,
) -> CmdResult<SoundSetEnabledResponse> {
    run_mutation(app, move |app, state| {
        let path_key = set_sound_hidden(app, state, &sound_path, !enabled)?;
        Ok(SoundSetEnabledResponse {
            success: true,
            sound_path: path_key,
            enabled,
        })
    })
    .await
}

fn set_sound_hidden(
    app: &tauri::AppHandle,
    state: &AppState,
    sound_path: &str,
    hidden: bool,
) -> CmdResult<String> {
    let sounds_dir = ensure_sounds_dir(app)?;
    let validated_path = validate_sound_path(&sounds_dir, sound_path)?;
    if !validated_path.exists() {
        return Err(CommandError::msg("대상 사운드 파일이 존재하지 않습니다."));
    }

    let path_key = resolve_stored_sound_path_key(state, &validated_path);
    state.store.update(|store| {
        store
            .sound_library
            .entry(path_key.clone())
            .or_default()
            .hidden = hidden;
    })?;
    Ok(path_key)
}

#[tauri::command]
pub async fn sound_rename(
    app: tauri::AppHandle,
    sound_path: String,
    display_name: String,
) -> CmdResult<SoundRenameResponse> {
    run_mutation(app, move |app, state| {
        sound_rename_inner(app, state, sound_path, display_name)
    })
    .await
}

fn sound_rename_inner(
    app: &tauri::AppHandle,
    state: &AppState,
    sound_path: String,
    display_name: String,
) -> CmdResult<SoundRenameResponse> {
    let sounds_dir = ensure_sounds_dir(app)?;
    let validated_path = validate_sound_path(&sounds_dir, &sound_path)?;
    if !validated_path.exists() {
        return Err(CommandError::msg("대상 사운드 파일이 존재하지 않습니다."));
    }
    let path_key = resolve_stored_sound_path_key(state, &validated_path);

    let trimmed = display_name.trim();
    if trimmed.is_empty() {
        return Err(CommandError::msg("사운드 이름이 비어 있습니다."));
    }

    // 내장 사운드 이름 변경 차단 (재시딩 시 원복됨)
    let is_builtin = state.store.with_state(|s| {
        s.sound_library
            .get(&path_key)
            .map(|entry| entry.source == SoundSource::Builtin)
    });
    let Some(is_builtin) = is_builtin else {
        return Err(CommandError::msg("대상 사운드가 존재하지 않습니다."));
    };
    if is_builtin {
        return Err(CommandError::msg(
            "내장 사운드는 이름을 변경할 수 없습니다.",
        ));
    }

    let next_name = trimmed.to_string();
    state.store.update(|s| {
        if let Some(entry) = s.sound_library.get_mut(&path_key) {
            entry.display_name = Some(next_name.clone());
        }
    })?;

    Ok(SoundRenameResponse {
        success: true,
        display_name: next_name,
    })
}

#[tauri::command]
pub async fn sound_delete(
    app: tauri::AppHandle,
    window: WebviewWindow,
    sound_path: String,
) -> CmdResult<SoundDeleteResponse> {
    run_history_mutation(
        app,
        window.label().to_string(),
        move |app, state, admission| sound_delete_inner(app, state, sound_path, admission),
    )
    .await
}

fn sound_delete_inner(
    app: &tauri::AppHandle,
    state: &AppState,
    sound_path: String,
    admission: HistoryAdmissionLease,
) -> CmdResult<SoundDeleteResponse> {
    let sounds_dir = ensure_sounds_dir(app)?;
    let trash_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| CommandError::msg(format!("앱 데이터 경로 확인 실패: {error}")))?
        .join("trash");
    let validated_path = validate_sound_path(&sounds_dir, &sound_path)?;
    let path_key = resolve_stored_sound_path_key(state, &validated_path);
    let stored_path = validate_sound_path(&sounds_dir, &path_key)?;

    // 내장 사운드 삭제 차단 (OBS/플러그인 경유 호출 포함)
    let is_builtin = state.store.with_state(|s| {
        s.sound_library
            .get(&path_key)
            .is_some_and(|entry| entry.source == SoundSource::Builtin)
    });
    if is_builtin {
        return Err(CommandError::msg("내장 사운드는 삭제할 수 없습니다."));
    }

    // 라이브러리에서 원본 경로 선조회
    let original_rel_path = state.store.with_state(|s| {
        s.sound_library
            .get(&path_key)
            .and_then(|entry| entry.original_path.clone())
    });
    let original_path = original_rel_path.as_ref().and_then(|orig_rel| {
        let original_path = sounds_dir.join(orig_rel);
        match validate_sound_path(&sounds_dir, &original_path.to_string_lossy()) {
            Ok(original_path) => Some(original_path),
            Err(error) => {
                log::warn!("[Sound] 잘못된 원본 사운드 경로 무시: {error}");
                None
            }
        }
    });

    let _transaction_guard = PROCESSED_WAV_TRANSACTION_LOCK.lock();
    let source_paths: Vec<PathBuf> = std::iter::once(stored_path)
        .chain(original_path.clone())
        .collect();
    let staged = stage_sound_files_for_deletion(&source_paths)
        .map_err(|error| CommandError::msg(format!("사운드 파일 삭제 준비 실패: {error:#}")))?;

    let transaction = commit_staged_sound_deletion(&staged, || {
        Ok(state.store.commit_legacy_resource_deletion_with_admission(
            EditorCommitOrigin::LegacyAdapter("sound_delete".to_string()),
            &[
                EditorField::KeyPositions,
                EditorField::StatPositions,
                EditorField::GraphPositions,
                EditorField::KnobPositions,
            ],
            admission,
            |store| Ok(remove_sound_entry_and_references(store, &path_key)),
        )?)
    })?;

    state.key_sound_invalidate_file_cache(&path_key);
    if let Err(error) = move_staged_sound_deletions_to_trash(&staged, &trash_dir) {
        // store 커밋은 끝났고 숨은 삭제 백업은 다음 시작 시 다시 trash로 이동
        log::warn!("[Sound] 삭제 파일 trash 이동 지연: {error:#}");
    }

    publish_legacy_editor_change(state, app, &transaction.change);
    if transaction.value {
        emit_sound_reference_changes_with(&transaction.change.result.changed_fields, |event| {
            match event {
                SoundReferenceChangeEvent::Key => {
                    publish_event(
                        app,
                        event.name(),
                        &transaction.change.document.key_positions,
                    );
                }
                SoundReferenceChangeEvent::Stat => {
                    publish_event(
                        app,
                        event.name(),
                        &transaction.change.document.stat_positions,
                    );
                }
                SoundReferenceChangeEvent::Graph => {
                    publish_event(
                        app,
                        event.name(),
                        &transaction.change.document.graph_positions,
                    );
                }
                SoundReferenceChangeEvent::Knob => {
                    publish_event(
                        app,
                        event.name(),
                        &transaction.change.document.knob_positions,
                    );
                }
            }
            Ok::<(), std::convert::Infallible>(())
        });
    }

    Ok(SoundDeleteResponse { success: true })
}

fn remove_sound_entry_and_references(store: &mut AppStoreData, path_key: &str) -> bool {
    store.sound_library.remove(path_key);
    let mut references_changed = false;

    for positions in store.key_positions.values_mut() {
        for position in positions.iter_mut() {
            if position.sound_path.as_deref() == Some(path_key) {
                position.sound_path = None;
                position.sound_enabled = Some(false);
                references_changed = true;
            }
        }
    }

    for positions in store.stat_positions.values_mut() {
        for stat_position in positions.iter_mut() {
            if stat_position.position.sound_path.as_deref() == Some(path_key) {
                stat_position.position.sound_path = None;
                stat_position.position.sound_enabled = Some(false);
                references_changed = true;
            }
        }
    }

    for positions in store.graph_positions.values_mut() {
        for graph_position in positions.iter_mut() {
            if graph_position.position.sound_path.as_deref() == Some(path_key) {
                graph_position.position.sound_path = None;
                graph_position.position.sound_enabled = Some(false);
                references_changed = true;
            }
        }
    }

    for positions in store.knob_positions.values_mut() {
        for knob_position in positions.iter_mut() {
            if knob_position.position.sound_path.as_deref() == Some(path_key) {
                knob_position.position.sound_path = None;
                knob_position.position.sound_enabled = Some(false);
                references_changed = true;
            }
        }
    }

    references_changed
}

fn sound_delete_rollback_error(
    primary: CommandError,
    rollback: anyhow::Result<()>,
) -> CommandError {
    match rollback {
        Ok(()) => primary,
        Err(rollback) => {
            CommandError::msg(format!("{primary}; 삭제 준비 파일 원복 실패: {rollback:#}"))
        }
    }
}

fn commit_staged_sound_deletion<T, Commit>(
    staged: &[crate::state::store::StagedSoundDeletionFile],
    commit: Commit,
) -> CmdResult<T>
where
    Commit: FnOnce() -> CmdResult<T>,
{
    match commit() {
        Ok(value) => Ok(value),
        Err(error) => Err(sound_delete_rollback_error(
            error,
            restore_staged_sound_deletions(staged),
        )),
    }
}

fn emit_sound_reference_changes_with<Emit, Error>(changed_fields: &[EditorField], mut emit: Emit)
where
    Emit: FnMut(SoundReferenceChangeEvent) -> Result<(), Error>,
    Error: std::fmt::Display,
{
    for event in changed_fields
        .iter()
        .filter_map(|field| SoundReferenceChangeEvent::from_editor_field(*field))
    {
        if let Err(error) = emit(event) {
            log::warn!(
                "[Sound] 삭제 후 '{}' 이벤트 전송 실패: {error}",
                event.name()
            );
        }
    }
}

#[tauri::command]
pub async fn sound_save_processed_wav(
    app: tauri::AppHandle,
    request: SoundSaveProcessedWavRequest,
) -> CmdResult<SoundSaveProcessedWavResponse> {
    run_mutation(app, move |app, state| {
        sound_save_processed_wav_inner(app, state, request)
    })
    .await
}

fn sound_save_processed_wav_inner(
    app: &tauri::AppHandle,
    state: &AppState,
    request: SoundSaveProcessedWavRequest,
) -> CmdResult<SoundSaveProcessedWavResponse> {
    let encoded = request.wav_base64.trim();
    if encoded.is_empty() {
        return Ok(SoundSaveProcessedWavResponse {
            success: false,
            error: Some("사운드 데이터가 비어 있습니다.".to_string()),
            sound_path: None,
        });
    }

    let wav_bytes = BASE64_STANDARD
        .decode(encoded)
        .map_err(|e| CommandError::msg(format!("사운드 데이터 디코딩 실패: {e}")))?;

    let is_valid_wav = wav_bytes.len() >= 12
        && wav_bytes.get(0..4) == Some(b"RIFF")
        && wav_bytes.get(8..12) == Some(b"WAVE");
    if !is_valid_wav {
        return Ok(SoundSaveProcessedWavResponse {
            success: false,
            error: Some("유효한 WAV 데이터가 아닙니다.".to_string()),
            sound_path: None,
        });
    }

    let sounds_dir = ensure_sounds_dir(app)?;

    let base_name = request
        .file_name
        .as_deref()
        .map(|n| n.trim())
        .filter(|n| !n.is_empty())
        .map(|n| {
            let sanitized: String = n
                .chars()
                .map(|c| {
                    if c == '/'
                        || c == '\\'
                        || c == ':'
                        || c == '*'
                        || c == '?'
                        || c == '"'
                        || c == '<'
                        || c == '>'
                        || c == '|'
                    {
                        '_'
                    } else {
                        c
                    }
                })
                .collect();
            sanitized
        })
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let mut dest_path = sounds_dir.join(format!("{}.wav", base_name));
    if dest_path.exists() {
        dest_path = sounds_dir.join(format!("{}_{}.wav", base_name, Uuid::new_v4()));
    }
    fs::write(&dest_path, wav_bytes)
        .map_err(|e| CommandError::msg(format!("편집된 사운드 저장 실패: {e}")))?;

    // 원본 파일 저장
    let mut original_rel_path: Option<String> = None;
    if let Some(ref orig_b64) = request.original_base64 {
        let trimmed_orig = orig_b64.trim();
        if !trimmed_orig.is_empty() {
            let orig_bytes = BASE64_STANDARD
                .decode(trimmed_orig)
                .map_err(|e| CommandError::msg(format!("원본 사운드 데이터 디코딩 실패: {e}")))?;
            let orig_ext = request
                .original_extension
                .as_deref()
                .unwrap_or("wav")
                .to_lowercase();
            let originals_dir = ensure_originals_dir(app)?;
            let orig_filename = format!("{}.{}", Uuid::new_v4(), orig_ext);
            let orig_path = originals_dir.join(&orig_filename);
            fs::write(&orig_path, orig_bytes)
                .map_err(|e| CommandError::msg(format!("원본 사운드 저장 실패: {e}")))?;
            original_rel_path = Some(format!("originals/{}", orig_filename));
        }
    }

    let dest_path_str = normalize_path_string(&dest_path);
    state.store.update(|s| {
        s.sound_library.insert(
            dest_path_str.clone(),
            SoundLibraryEntry {
                hidden: false,
                source: SoundSource::Local,
                original_path: original_rel_path.clone(),
                trim_start_ratio: request.trim_start_ratio,
                trim_end_ratio: request.trim_end_ratio,
                display_name: request.file_name.clone(),
            },
        );
    })?;

    Ok(SoundSaveProcessedWavResponse {
        success: true,
        error: None,
        sound_path: Some(dest_path_str),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundLoadOriginalResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_extension: Option<String>,
}

/// 편집을 위해 원본 사운드 파일을 base64로 반환
#[tauri::command]
pub async fn sound_load_original(
    app: AppHandle,
    sound_path: String,
) -> CmdResult<SoundLoadOriginalResponse> {
    run_blocking(app, move |app, state| {
        let sounds_dir = ensure_sounds_dir(app)?;
        let validated_path = validate_sound_path(&sounds_dir, &sound_path)?;
        let path_key = resolve_stored_sound_path_key(state, &validated_path);

        let original_rel = state
            .store
            .with_state(|s| {
                s.sound_library
                    .get(&path_key)
                    .and_then(|e| e.original_path.clone())
            })
            .ok_or_else(|| CommandError::msg("원본 파일 정보가 없습니다."))?;

        let original_path = sounds_dir.join(&original_rel);
        let original_abs = validate_sound_path(&sounds_dir, &original_path.to_string_lossy())?;
        if !original_abs.exists() {
            return Err(CommandError::msg("원본 파일이 존재하지 않습니다."));
        }

        let bytes = fs::read(&original_abs)
            .map_err(|e| CommandError::msg(format!("원본 사운드 파일 읽기 실패: {e}")))?;
        let encoded = BASE64_STANDARD.encode(&bytes);

        let ext = original_abs
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_lowercase());

        Ok(SoundLoadOriginalResponse {
            success: true,
            error: None,
            audio_base64: Some(encoded),
            original_extension: ext,
        })
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundUpdateProcessedWavRequest {
    pub sound_path: String,
    pub wav_base64: String,
    pub trim_start_ratio: Option<f64>,
    pub trim_end_ratio: Option<f64>,
    pub display_name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundUpdateProcessedWavResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 기존 트리밍 파일을 새 WAV로 덮어쓰고 메타데이터 갱신
#[tauri::command]
pub async fn sound_update_processed_wav(
    app: tauri::AppHandle,
    request: SoundUpdateProcessedWavRequest,
) -> CmdResult<SoundUpdateProcessedWavResponse> {
    run_mutation(app, move |app, state| {
        sound_update_processed_wav_inner(app, state, request)
    })
    .await
}

fn sound_update_processed_wav_inner(
    app: &tauri::AppHandle,
    state: &AppState,
    request: SoundUpdateProcessedWavRequest,
) -> CmdResult<SoundUpdateProcessedWavResponse> {
    let sounds_dir = ensure_sounds_dir(app)?;
    let validated_path = validate_sound_path(&sounds_dir, &request.sound_path)?;
    let path_key = resolve_stored_sound_path_key(state, &validated_path);

    // 내장 사운드 덮어쓰기 차단 (OBS/플러그인 경유 호출 포함)
    let is_builtin = state.store.with_state(|s| {
        s.sound_library
            .get(&path_key)
            .is_some_and(|entry| entry.source == SoundSource::Builtin)
    });
    if is_builtin {
        return Err(CommandError::msg("내장 사운드는 편집할 수 없습니다."));
    }

    let wav_bytes = BASE64_STANDARD
        .decode(request.wav_base64.trim())
        .map_err(|e| CommandError::msg(format!("사운드 데이터 디코딩 실패: {e}")))?;

    let is_valid_wav = wav_bytes.len() >= 12
        && wav_bytes.get(0..4) == Some(b"RIFF")
        && wav_bytes.get(8..12) == Some(b"WAVE");
    if !is_valid_wav {
        return Ok(SoundUpdateProcessedWavResponse {
            success: false,
            error: Some("유효한 WAV 데이터가 아닙니다.".to_string()),
        });
    }

    let _transaction_guard = PROCESSED_WAV_TRANSACTION_LOCK.lock();
    state
        .store
        .recover_interrupted_processed_wav_replacements_while_locked()?;
    ensure_existing_sound_edit_target(&validated_path)?;
    let pending = PendingProcessedWavReplacement {
        sound_path: normalize_path_string(&validated_path),
        had_original: validated_path.exists(),
    };
    state.store.update(|store| {
        store.pending_processed_wav_replacement = Some(pending.clone());
    })?;

    let replacement_result = replace_processed_wav_with(
        &validated_path,
        &wav_bytes,
        || {
            state.store.update(|store| {
                if let Some(entry) = store.sound_library.get_mut(&path_key) {
                    entry.trim_start_ratio = request.trim_start_ratio;
                    entry.trim_end_ratio = request.trim_end_ratio;
                    if let Some(ref name) = request.display_name {
                        entry.display_name = Some(name.clone());
                    }
                }
                store.pending_processed_wav_replacement = None;
            })?;
            Ok(())
        },
        |path, bytes| prepare_atomic_replace(path, bytes, "processed-wav"),
        PreparedAtomicReplace::commit,
        |path| fs::remove_file(path),
    );
    if let Err(error) = replacement_result {
        // 파일 롤백 자체가 실패했을 수 있으므로 복구 표식은 다음 재시도까지 보존
        return Err(CommandError::msg(format!(
            "편집된 사운드 저장 실패: {error}"
        )));
    }

    // 키음 엔진 캐시에서 이전 디코딩 결과 무효화
    state.key_sound_invalidate_file_cache(&path_key);

    Ok(SoundUpdateProcessedWavResponse {
        success: true,
        error: None,
    })
}

fn ensure_existing_sound_edit_target(path: &Path) -> CmdResult<()> {
    match path.try_exists() {
        Ok(true) if path.is_file() => Ok(()),
        Ok(true) => Err(CommandError::msg("대상 사운드 경로가 파일이 아닙니다.")),
        Ok(false) => Err(CommandError::msg("편집할 사운드 파일을 찾을 수 없습니다.")),
        Err(error) => Err(CommandError::msg(format!(
            "편집할 사운드 파일 확인 실패: {error}"
        ))),
    }
}

fn replace_processed_wav_with<Save, Prepare, Commit, Cleanup>(
    target_path: &Path,
    wav_bytes: &[u8],
    save_metadata: Save,
    prepare: Prepare,
    commit: Commit,
    cleanup_backup: Cleanup,
) -> CmdResult<()>
where
    Save: FnOnce() -> CmdResult<()>,
    Prepare: FnOnce(&Path, &[u8]) -> anyhow::Result<PreparedAtomicReplace>,
    Commit: FnOnce(PreparedAtomicReplace) -> anyhow::Result<()>,
    Cleanup: FnOnce(&Path) -> std::io::Result<()>,
{
    let backup_path = backup_path_for(target_path)?;
    restore_interrupted_processed_wav_backup(target_path, &backup_path)?;

    if target_path.exists() && !target_path.is_file() {
        return Err(CommandError::msg("대상 사운드 경로가 파일이 아닙니다."));
    }

    if backup_path.exists() {
        fs::remove_file(&backup_path)?;
    }

    let prepared = prepare(target_path, wav_bytes)?;
    let had_original = target_path.exists();
    if had_original {
        fs::rename(target_path, &backup_path)?;
    }

    if let Err(error) = commit(prepared) {
        let rollback_result =
            restore_processed_wav(target_path, had_original.then_some(&backup_path));
        return Err(with_rollback_error(error.into(), rollback_result, None));
    }

    if let Err(error) = save_metadata() {
        let file_result = restore_processed_wav(target_path, had_original.then_some(&backup_path));
        return Err(with_rollback_error(error, file_result, None));
    }

    if had_original {
        if let Err(error) = cleanup_backup(&backup_path) {
            // 새 파일과 메타데이터는 이미 함께 커밋됨. 백업은 종료 시 격리 청소 대상
            log::warn!(
                "편집된 WAV 백업 정리 지연 ({}): {}",
                backup_path.display(),
                error
            );
        }
    }

    Ok(())
}

fn restore_interrupted_processed_wav_backup(
    target_path: &Path,
    backup_path: &Path,
) -> CmdResult<()> {
    restore_interrupted_processed_wav_backup_with(target_path, backup_path, |from, to| {
        fs::rename(from, to)
    })
}

fn restore_interrupted_processed_wav_backup_with<Rename>(
    target_path: &Path,
    backup_path: &Path,
    rename: Rename,
) -> CmdResult<()>
where
    Rename: FnOnce(&Path, &Path) -> std::io::Result<()>,
{
    if !target_path.exists() && backup_path.exists() {
        rename(backup_path, target_path).map_err(|error| {
            CommandError::msg(format!(
                "중단된 WAV 백업 복구 실패 ('{}' → '{}'): {error}",
                backup_path.display(),
                target_path.display()
            ))
        })?;
    }

    Ok(())
}

fn backup_path_for(path: &Path) -> CmdResult<PathBuf> {
    let mut file_name = path
        .file_name()
        .ok_or_else(|| CommandError::msg("사운드 파일명이 없습니다."))?
        .to_os_string();
    file_name.push(".bak");
    Ok(path.with_file_name(file_name))
}

fn restore_processed_wav(target_path: &Path, backup_path: Option<&Path>) -> std::io::Result<()> {
    match backup_path {
        Some(backup_path) => {
            if !target_path.exists() {
                return fs::rename(backup_path, target_path);
            }

            let rollback_path = rollback_path_for(target_path);
            fs::rename(target_path, &rollback_path)?;
            if let Err(error) = fs::rename(backup_path, target_path) {
                return match fs::rename(&rollback_path, target_path) {
                    Ok(()) => Err(error),
                    Err(recovery_error) => Err(std::io::Error::other(format!(
                        "{error}; 새 WAV 재배치 실패: {recovery_error}"
                    ))),
                };
            }
            fs::remove_file(rollback_path)
        }
        None if target_path.exists() => {
            let rollback_path = rollback_path_for(target_path);
            fs::rename(target_path, &rollback_path)?;
            fs::remove_file(rollback_path)
        }
        None => Ok(()),
    }
}

fn rollback_path_for(path: &Path) -> PathBuf {
    let mut file_name = path.file_name().unwrap_or_default().to_os_string();
    file_name.push(format!(".rollback-{}", Uuid::new_v4()));
    path.with_file_name(file_name)
}

fn with_rollback_error(
    primary: CommandError,
    file_result: std::io::Result<()>,
    metadata_result: Option<CmdResult<()>>,
) -> CommandError {
    let mut failures = Vec::new();
    if let Err(error) = file_result {
        failures.push(format!("WAV 원복 실패: {error}"));
    }
    if let Some(Err(error)) = metadata_result {
        failures.push(format!("메타데이터 원복 실패: {error}"));
    }

    if failures.is_empty() {
        primary
    } else {
        CommandError::msg(format!("{primary}; {}", failures.join("; ")))
    }
}

fn resolve_stored_sound_path_key(state: &AppState, validated_path: &Path) -> String {
    let mut stored_keys = state
        .store
        .with_state(|store| store.sound_library.keys().cloned().collect::<Vec<_>>());
    stored_keys.sort_unstable();
    resolve_sound_path_key_from_keys(validated_path, &stored_keys)
}

fn resolve_sound_path_key_from_keys(validated_path: &Path, stored_keys: &[String]) -> String {
    let input_key = normalize_path_string(validated_path);
    if stored_keys
        .iter()
        .any(|stored_key| stored_key == &input_key)
    {
        return input_key;
    }

    let Ok(canonical_input) = canonicalize_sound_path(validated_path) else {
        return input_key;
    };

    stored_keys
        .iter()
        .find(|stored_key| {
            canonicalize_sound_path(Path::new(stored_key)).is_ok_and(|canonical_stored| {
                canonical_paths_equivalent(&canonical_input, &canonical_stored)
            })
        })
        .cloned()
        .unwrap_or(input_key)
}

fn canonical_paths_equivalent(left: &Path, right: &Path) -> bool {
    paths_have_same_identity(left, right)
}

fn canonicalize_sound_path(path: &Path) -> CmdResult<PathBuf> {
    match fs::canonicalize(path) {
        Ok(path) => Ok(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            match fs::symlink_metadata(path) {
                Ok(_) => {
                    return Err(CommandError::msg(format!("사운드 경로 확인 실패: {error}")));
                }
                Err(metadata_error) if metadata_error.kind() != std::io::ErrorKind::NotFound => {
                    return Err(CommandError::msg(format!(
                        "사운드 경로 확인 실패: {metadata_error}"
                    )));
                }
                Err(_) => {}
            }

            let parent = path
                .parent()
                .ok_or_else(|| CommandError::msg("사운드 파일의 부모 경로가 없습니다."))?;
            let file_name = path
                .file_name()
                .ok_or_else(|| CommandError::msg("사운드 파일명이 없습니다."))?;
            let canonical_parent = fs::canonicalize(parent).map_err(|parent_error| {
                CommandError::msg(format!("사운드 파일의 부모 경로 확인 실패: {parent_error}"))
            })?;
            Ok(canonical_parent.join(file_name))
        }
        Err(error) => Err(CommandError::msg(format!("사운드 경로 확인 실패: {error}"))),
    }
}

fn validate_sound_path(sounds_dir: &Path, sound_path: &str) -> CmdResult<PathBuf> {
    let path = PathBuf::from(sound_path);
    if !path.is_absolute() {
        return Err(CommandError::msg("절대 경로만 허용됩니다."));
    }
    if contains_relative_path_component(sound_path) || contains_duplicate_path_separator(sound_path)
    {
        return Err(CommandError::msg(
            "'.', '..' 또는 중복 경로 구분자는 허용되지 않습니다.",
        ));
    }

    let canonical_sounds_dir = fs::canonicalize(sounds_dir)
        .map_err(|error| CommandError::msg(format!("사운드 디렉토리 확인 실패: {error}")))?;
    let canonical_path = canonicalize_sound_path(&path)?;

    if !canonical_path.starts_with(&canonical_sounds_dir) {
        return Err(CommandError::msg(
            "appData/sounds 외부 경로에는 접근할 수 없습니다.",
        ));
    }
    // canonical은 경계 검사 전용 — 반환은 store 키와 일치하는 원 경로
    // (Windows에서 canonicalize가 \\?\ verbatim 경로를 반환해 조회 키를 오염시키는 것 방지)
    Ok(path)
}

fn contains_relative_path_component(path: &str) -> bool {
    path.split(std::path::is_separator)
        .any(|component| component == "." || component == "..")
}

fn contains_duplicate_path_separator(path: &str) -> bool {
    #[cfg(windows)]
    let prefix_body = path
        .strip_prefix("\\\\?\\")
        .or_else(|| path.strip_prefix("\\\\"))
        .or_else(|| path.strip_prefix("//"));
    #[cfg(windows)]
    let path = match prefix_body {
        Some(body) if body.chars().next().is_some_and(std::path::is_separator) => return true,
        Some(body) => body,
        None => path,
    };

    let mut previous_was_separator = false;
    for character in path.chars() {
        let is_separator = std::path::is_separator(character);
        if is_separator && previous_was_separator {
            return true;
        }
        previous_was_separator = is_separator;
    }
    false
}

fn normalize_path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn ensure_sounds_dir(app: &tauri::AppHandle) -> CmdResult<PathBuf> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| CommandError::msg(format!("앱 데이터 디렉토리 확인 실패: {e}")))?;
    let sounds_dir = data_dir.join("sounds");
    fs::create_dir_all(&sounds_dir)
        .map_err(|e| CommandError::msg(format!("사운드 디렉토리 생성 실패: {e}")))?;
    Ok(sounds_dir)
}

fn ensure_originals_dir(app: &tauri::AppHandle) -> CmdResult<PathBuf> {
    let sounds_dir = ensure_sounds_dir(app)?;
    let originals_dir = sounds_dir.join("originals");
    fs::create_dir_all(&originals_dir)
        .map_err(|e| CommandError::msg(format!("원본 사운드 디렉토리 생성 실패: {e}")))?;
    Ok(originals_dir)
}

fn is_supported_sound_file(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|ext| ext.to_str()) else {
        return false;
    };
    SUPPORTED_SOUND_EXTENSIONS
        .iter()
        .any(|allowed| ext.eq_ignore_ascii_case(allowed))
}

#[cfg(test)]
mod tests;
