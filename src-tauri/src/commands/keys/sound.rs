use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};
use tauri::{Manager, State, WebviewWindow};
use uuid::Uuid;

use crate::commands::{dialog::parented_file_dialog, editor::state::publish_legacy_editor_change};
use crate::errors::{CmdResult, CommandError};
use crate::models::{
    AppStoreData, EditorCommitOrigin, EditorField, PendingProcessedWavReplacement,
    SoundLibraryEntry, SoundSource,
};
use crate::services::event_publisher::publish_event;
use crate::state::{
    atomic_file::{prepare_atomic_replace, PreparedAtomicReplace},
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
    tauri::async_runtime::spawn_blocking(move || sound_load_from_path(app, path))
        .await
        .map_err(|error| CommandError::msg(format!("sound load task failed: {error}")))?
}

fn sound_load_from_path(app: tauri::AppHandle, path: PathBuf) -> CmdResult<SoundLoadResponse> {
    let state = app.state::<AppState>();

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("wav")
        .to_lowercase();

    let sounds_dir = ensure_sounds_dir(&app)?;
    let dest_path = sounds_dir.join(format!("{}.{}", Uuid::new_v4(), ext));
    fs::copy(&path, &dest_path)
        .map_err(|e| CommandError::msg(format!("사운드 파일 복사 실패: {e}")))?;

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
}

#[tauri::command]
pub fn sound_list(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<Vec<SoundListItem>> {
    let sounds_dir = ensure_sounds_dir(&app)?;
    let _transaction_guard = PROCESSED_WAV_TRANSACTION_LOCK.lock();
    let recovery_complete = state.store.prepare_sound_listing_while_locked()?;
    let mut items = Vec::new();
    let mut library = state.store.with_state(|s| s.sound_library.clone());
    let mut seen_paths = HashSet::new();
    let mut library_mutated = false;
    let mut scan_complete = recovery_complete;

    let entries = fs::read_dir(&sounds_dir)
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

        let entry_meta = library
            .entry(path_key.clone())
            .or_insert_with(|| {
                library_mutated = true;
                SoundLibraryEntry::default()
            })
            .clone();

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

    let stale_keys = stale_sound_library_keys(&library, &seen_paths, scan_complete);
    if !stale_keys.is_empty() {
        for key in stale_keys {
            library.remove(&key);
        }
        library_mutated = true;
    }

    if library_mutated {
        state.store.update(|s| {
            s.sound_library = library.clone();
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
pub fn sound_set_hidden(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    sound_path: String,
    hidden: bool,
) -> CmdResult<SoundSetHiddenResponse> {
    let path_key = set_sound_hidden(&app, state.inner(), &sound_path, hidden)?;
    Ok(SoundSetHiddenResponse {
        success: true,
        sound_path: path_key,
        hidden,
    })
}

#[tauri::command]
pub fn sound_set_enabled(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    sound_path: String,
    enabled: bool,
) -> CmdResult<SoundSetEnabledResponse> {
    let path_key = set_sound_hidden(&app, state.inner(), &sound_path, !enabled)?;
    Ok(SoundSetEnabledResponse {
        success: true,
        sound_path: path_key,
        enabled,
    })
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
pub fn sound_rename(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    sound_path: String,
    display_name: String,
) -> CmdResult<SoundRenameResponse> {
    let sounds_dir = ensure_sounds_dir(&app)?;
    let validated_path = validate_sound_path(&sounds_dir, &sound_path)?;
    if !validated_path.exists() {
        return Err(CommandError::msg("대상 사운드 파일이 존재하지 않습니다."));
    }
    let path_key = resolve_stored_sound_path_key(state.inner(), &validated_path);

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
pub fn sound_delete(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    window: WebviewWindow,
    sound_path: String,
) -> CmdResult<SoundDeleteResponse> {
    let sounds_dir = ensure_sounds_dir(&app)?;
    let trash_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| CommandError::msg(format!("앱 데이터 경로 확인 실패: {error}")))?
        .join("trash");
    let validated_path = validate_sound_path(&sounds_dir, &sound_path)?;
    let path_key = resolve_stored_sound_path_key(state.inner(), &validated_path);
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
        let admission = state.admit_frontend_history_mutation(window.label())?;
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

    publish_legacy_editor_change(state.inner(), &app, &transaction.change);
    if transaction.value {
        emit_sound_reference_changes_with(&transaction.change.result.changed_fields, |event| {
            match event {
                SoundReferenceChangeEvent::Key => {
                    publish_event(
                        &app,
                        event.name(),
                        &transaction.change.document.key_positions,
                    );
                }
                SoundReferenceChangeEvent::Stat => {
                    publish_event(
                        &app,
                        event.name(),
                        &transaction.change.document.stat_positions,
                    );
                }
                SoundReferenceChangeEvent::Graph => {
                    publish_event(
                        &app,
                        event.name(),
                        &transaction.change.document.graph_positions,
                    );
                }
                SoundReferenceChangeEvent::Knob => {
                    publish_event(
                        &app,
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
pub fn sound_save_processed_wav(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
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

    let sounds_dir = ensure_sounds_dir(&app)?;

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
            let originals_dir = ensure_originals_dir(&app)?;
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
pub fn sound_load_original(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    sound_path: String,
) -> CmdResult<SoundLoadOriginalResponse> {
    let sounds_dir = ensure_sounds_dir(&app)?;
    let validated_path = validate_sound_path(&sounds_dir, &sound_path)?;
    let path_key = resolve_stored_sound_path_key(state.inner(), &validated_path);

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
pub fn sound_update_processed_wav(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: SoundUpdateProcessedWavRequest,
) -> CmdResult<SoundUpdateProcessedWavResponse> {
    let sounds_dir = ensure_sounds_dir(&app)?;
    let validated_path = validate_sound_path(&sounds_dir, &request.sound_path)?;
    let path_key = resolve_stored_sound_path_key(state.inner(), &validated_path);

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
mod tests {
    use super::{
        backup_path_for, commit_staged_sound_deletion, contains_duplicate_path_separator,
        emit_sound_reference_changes_with, ensure_existing_sound_edit_target,
        remove_sound_entry_and_references, replace_processed_wav_with,
        resolve_sound_path_key_from_keys, restore_interrupted_processed_wav_backup_with,
        stale_sound_library_keys, validate_sound_path, PreparedAtomicReplace,
        SoundReferenceChangeEvent,
    };
    use crate::{
        defaults::default_positions,
        errors::{CmdResult, CommandError},
        models::{
            AppStoreData, EditorDocumentV1, EditorField, GraphPosition, GraphStatType, GraphType,
            KeyPosition, KnobPosition, StatPosition, StatType,
        },
        state::{
            atomic_file::prepare_atomic_replace,
            store::{
                move_staged_sound_deletions_to_trash, stage_sound_files_for_deletion,
                PROCESSED_WAV_TRANSACTION_LOCK,
            },
        },
    };
    use std::{
        cell::{Cell, RefCell},
        path::Path,
        sync::mpsc,
        thread,
    };

    fn wav_test_path(label: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "dmnote-processed-wav-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("sound.wav");
        std::fs::write(&path, b"old-wav").unwrap();
        (root, path)
    }

    fn assert_wav_rollback(path: &Path, metadata: &RefCell<&'static str>) {
        assert_eq!(std::fs::read(path).unwrap(), b"old-wav");
        assert_eq!(*metadata.borrow(), "old-metadata");
        assert!(!backup_path_for(path).unwrap().exists());
        assert!(!std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .any(|entry| {
                entry
                    .ok()
                    .and_then(|entry| entry.file_name().into_string().ok())
                    .is_some_and(|name| name.ends_with(".tmp") || name.contains(".rollback-"))
            }));
    }

    fn sound_delete_data(path_key: &str) -> AppStoreData {
        let mut data = AppStoreData {
            key_positions: default_positions().clone(),
            ..Default::default()
        };
        data.sound_library
            .insert(path_key.to_string(), Default::default());
        let position = data
            .key_positions
            .get_mut("4key")
            .unwrap()
            .first_mut()
            .unwrap();
        position.sound_path = Some(path_key.to_string());
        position.sound_enabled = Some(true);
        data
    }

    fn position_with_sound(path_key: &str) -> KeyPosition {
        KeyPosition {
            sound_path: Some(path_key.to_string()),
            sound_enabled: Some(true),
            ..Default::default()
        }
    }

    fn sound_delete_all_position_data(path_key: &str) -> AppStoreData {
        let mut data = AppStoreData::default();
        data.sound_library
            .insert(path_key.to_string(), Default::default());
        data.keys.insert("4key".to_string(), vec!["KeyA".into()]);
        data.key_positions
            .insert("4key".to_string(), vec![position_with_sound(path_key)]);
        data.stat_positions.insert(
            "4key".to_string(),
            vec![StatPosition {
                stat_type: StatType::Kps,
                position: position_with_sound(path_key),
            }],
        );
        data.graph_positions.insert(
            "4key".to_string(),
            vec![GraphPosition {
                stat_type: GraphStatType::Kps,
                graph_type: GraphType::Line,
                graph_speed: 1,
                graph_color: "#ffffff".to_string(),
                show_avg_line: true,
                position: position_with_sound(path_key),
            }],
        );
        data.knob_positions.insert(
            "4key".to_string(),
            vec![KnobPosition {
                axis_id: "axis".to_string(),
                sensitivity: 1.0,
                reverse: false,
                position: position_with_sound(path_key),
            }],
        );
        data
    }

    #[test]
    fn sound_delete_clears_all_position_references_and_reports_actual_fields() {
        let path_key = "/sounds/deleted.wav";
        let mut data = sound_delete_all_position_data(path_key);
        let before = EditorDocumentV1::from_store(&data);

        assert!(remove_sound_entry_and_references(&mut data, path_key));

        let after = EditorDocumentV1::from_store(&data);
        assert!(!data.sound_library.contains_key(path_key));
        assert_eq!(
            before.changed_fields(&after),
            vec![
                EditorField::KeyPositions,
                EditorField::StatPositions,
                EditorField::GraphPositions,
                EditorField::KnobPositions,
            ]
        );
        for position in [
            &data.key_positions["4key"][0],
            &data.stat_positions["4key"][0].position,
            &data.graph_positions["4key"][0].position,
            &data.knob_positions["4key"][0].position,
        ] {
            assert_eq!(position.sound_path, None);
            assert_eq!(position.sound_enabled, Some(false));
        }
    }

    #[test]
    fn incomplete_sound_scan_never_prunes_library_metadata() {
        let library = std::collections::HashMap::from([
            ("/sounds/seen.wav".to_string(), Default::default()),
            ("/sounds/unreadable.wav".to_string(), Default::default()),
        ]);
        let seen = std::collections::HashSet::from(["/sounds/seen.wav".to_string()]);

        assert!(stale_sound_library_keys(&library, &seen, false).is_empty());
        assert_eq!(
            stale_sound_library_keys(&library, &seen, true),
            vec!["/sounds/unreadable.wav".to_string()]
        );
    }

    #[test]
    fn sound_path_validation_resolves_existing_and_missing_paths() {
        let root =
            std::env::temp_dir().join(format!("dmnote-sound-path-test-{}", uuid::Uuid::new_v4()));
        let sounds_dir = root.join("sounds");
        std::fs::create_dir_all(&sounds_dir).unwrap();
        let existing = sounds_dir.join("existing.wav");
        std::fs::write(&existing, b"sound").unwrap();

        // macOS temp_dir는 /var → /private/var 심링크 — 경계 검사는 canonical로 통과하되
        // 반환은 원 경로여야 함 (store 키 일관성)
        assert_eq!(
            validate_sound_path(&sounds_dir, &existing.to_string_lossy()).unwrap(),
            existing
        );

        #[cfg(windows)]
        {
            let verbatim_existing = format!("\\\\?\\{}", existing.display());
            assert_eq!(
                validate_sound_path(&sounds_dir, &verbatim_existing).unwrap(),
                std::path::PathBuf::from(verbatim_existing)
            );
        }

        let missing = sounds_dir.join("missing.wav");
        assert_eq!(
            validate_sound_path(&sounds_dir, &missing.to_string_lossy()).unwrap(),
            missing
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn sound_path_validation_rejects_parent_directory_escape() {
        let root = std::env::temp_dir().join(format!(
            "dmnote-sound-path-escape-test-{}",
            uuid::Uuid::new_v4()
        ));
        let sounds_dir = root.join("sounds");
        std::fs::create_dir_all(&sounds_dir).unwrap();
        let outside = root.join("outside.wav");
        std::fs::write(&outside, b"outside").unwrap();

        let escaped_existing = sounds_dir.join("..").join("outside.wav");
        assert!(validate_sound_path(&sounds_dir, &escaped_existing.to_string_lossy()).is_err());

        let escaped_missing = sounds_dir.join("..").join("missing.wav");
        assert!(validate_sound_path(&sounds_dir, &escaped_missing.to_string_lossy()).is_err());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn sound_path_validation_rejects_relative_alias_components() {
        let root = std::env::temp_dir().join(format!(
            "dmnote-sound-path-alias-test-{}",
            uuid::Uuid::new_v4()
        ));
        let sounds_dir = root.join("sounds");
        std::fs::create_dir_all(sounds_dir.join("nested")).unwrap();
        let existing = sounds_dir.join("existing.wav");
        std::fs::write(&existing, b"sound").unwrap();

        let current_dir_alias = format!("{}/./existing.wav", sounds_dir.display());
        let parent_dir_alias = format!("{}/nested/../existing.wav", sounds_dir.display());

        for alias in [current_dir_alias, parent_dir_alias] {
            let error = validate_sound_path(&sounds_dir, &alias)
                .unwrap_err()
                .to_string();
            assert_eq!(
                error,
                "'.', '..' 또는 중복 경로 구분자는 허용되지 않습니다."
            );
        }

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn sound_path_validation_rejects_duplicate_separators() {
        let root = std::env::temp_dir().join(format!(
            "dmnote-sound-path-duplicate-separator-test-{}",
            uuid::Uuid::new_v4()
        ));
        let sounds_dir = root.join("sounds");
        std::fs::create_dir_all(&sounds_dir).unwrap();
        let existing = sounds_dir.join("existing.wav");
        std::fs::write(&existing, b"sound").unwrap();

        let separator = std::path::MAIN_SEPARATOR;
        let duplicate_separator_alias =
            format!("{}{separator}{separator}existing.wav", sounds_dir.display());
        #[cfg(windows)]
        let aliases = [duplicate_separator_alias];
        #[cfg(not(windows))]
        let aliases = [
            duplicate_separator_alias,
            format!("/{}", existing.display()),
        ];

        assert!(aliases
            .iter()
            .all(|alias| contains_duplicate_path_separator(alias)));

        for alias in aliases {
            let error = validate_sound_path(&sounds_dir, &alias)
                .unwrap_err()
                .to_string();
            assert_eq!(
                error,
                "'.', '..' 또는 중복 경로 구분자는 허용되지 않습니다."
            );
        }

        assert_eq!(
            validate_sound_path(&sounds_dir, &existing.to_string_lossy()).unwrap(),
            existing
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn sound_path_key_resolver_uses_canonical_match_for_reference_removal() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "dmnote-sound-path-canonical-match-test-{}",
            uuid::Uuid::new_v4()
        ));
        let sounds_dir = root.join("sounds");
        std::fs::create_dir_all(&sounds_dir).unwrap();
        let stored_path = sounds_dir.join("stored.wav");
        let alias_path = sounds_dir.join("alias.wav");
        std::fs::write(&stored_path, b"sound").unwrap();
        symlink(&stored_path, &alias_path).unwrap();

        let stored_key = stored_path.to_string_lossy().to_string();
        let validated_alias =
            validate_sound_path(&sounds_dir, &alias_path.to_string_lossy()).unwrap();
        let resolved_key =
            resolve_sound_path_key_from_keys(&validated_alias, std::slice::from_ref(&stored_key));
        let mut data = sound_delete_data(&stored_key);

        assert_eq!(resolved_key, stored_key);
        assert!(remove_sound_entry_and_references(&mut data, &resolved_key));
        assert!(!data.sound_library.contains_key(&stored_key));
        assert_eq!(data.key_positions["4key"][0].sound_path, None);
        assert_eq!(data.key_positions["4key"][0].sound_enabled, Some(false));

        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn sound_path_key_resolver_matches_missing_file_via_canonical_parent() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "dmnote-sound-path-missing-canonical-match-test-{}",
            uuid::Uuid::new_v4()
        ));
        let sounds_dir = root.join("sounds");
        let stored_parent = sounds_dir.join("stored-parent");
        let alias_parent = sounds_dir.join("alias-parent");
        std::fs::create_dir_all(&stored_parent).unwrap();
        symlink(&stored_parent, &alias_parent).unwrap();
        let stored_path = stored_parent.join("missing.wav");
        let alias_path = alias_parent.join("missing.wav");

        let stored_key = stored_path.to_string_lossy().to_string();
        let validated_alias =
            validate_sound_path(&sounds_dir, &alias_path.to_string_lossy()).unwrap();
        let resolved_key =
            resolve_sound_path_key_from_keys(&validated_alias, std::slice::from_ref(&stored_key));

        assert_eq!(resolved_key, stored_key);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn sound_path_key_resolver_preserves_unmatched_input_behavior() {
        let root = std::env::temp_dir().join(format!(
            "dmnote-sound-path-no-canonical-match-test-{}",
            uuid::Uuid::new_v4()
        ));
        let sounds_dir = root.join("sounds");
        std::fs::create_dir_all(&sounds_dir).unwrap();
        let stored_path = sounds_dir.join("stored.wav");
        let unmatched_path = sounds_dir.join("unmatched.wav");
        std::fs::write(&stored_path, b"stored").unwrap();
        std::fs::write(&unmatched_path, b"unmatched").unwrap();

        let stored_key = stored_path.to_string_lossy().to_string();
        let unmatched_key = unmatched_path.to_string_lossy().to_string();
        let validated_unmatched =
            validate_sound_path(&sounds_dir, &unmatched_path.to_string_lossy()).unwrap();
        let resolved_key = resolve_sound_path_key_from_keys(
            &validated_unmatched,
            std::slice::from_ref(&stored_key),
        );
        let mut data = sound_delete_data(&stored_key);

        assert_eq!(resolved_key, unmatched_key);
        assert!(!remove_sound_entry_and_references(&mut data, &resolved_key));
        assert!(data.sound_library.contains_key(&stored_key));
        assert_eq!(
            data.key_positions["4key"][0].sound_path.as_deref(),
            Some(stored_key.as_str())
        );
        assert_eq!(data.key_positions["4key"][0].sound_enabled, Some(true));

        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn sound_path_key_resolver_matches_case_and_separator_aliases() {
        let root = std::env::temp_dir().join(format!(
            "dmnote-sound-path-windows-alias-test-{}",
            uuid::Uuid::new_v4()
        ));
        let sounds_dir = root.join("sounds");
        std::fs::create_dir_all(&sounds_dir).unwrap();
        let stored_path = sounds_dir.join("stored.wav");
        std::fs::write(&stored_path, b"sound").unwrap();

        let stored_key = stored_path.to_string_lossy().to_string();
        let alias = stored_key.replace('\\', "/").to_ascii_uppercase();
        let validated_alias = validate_sound_path(&sounds_dir, &alias).unwrap();
        let resolved_key =
            resolve_sound_path_key_from_keys(&validated_alias, std::slice::from_ref(&stored_key));

        assert_eq!(resolved_key, stored_key);

        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn duplicate_separator_check_preserves_windows_prefixes() {
        assert!(!contains_duplicate_path_separator(r"\\server\share\x.wav"));
        assert!(!contains_duplicate_path_separator(r"\\?\C:\sounds\x.wav"));
        assert!(contains_duplicate_path_separator(r"C:\sounds\\x.wav"));
        assert!(contains_duplicate_path_separator(r"C:\sounds/\x.wav"));
        assert!(contains_duplicate_path_separator(r"\\server\share\\x.wav"));
        assert!(contains_duplicate_path_separator(r"\\?\C:\sounds\\x.wav"));
        assert!(contains_duplicate_path_separator(r"\\\server\share\x.wav"));
        assert!(contains_duplicate_path_separator(r"///server/share/x.wav"));
    }

    #[test]
    fn sound_delete_store_failure_keeps_files_and_references() {
        let root = std::env::temp_dir().join(format!(
            "dmnote-sound-delete-store-failure-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let processed_path = root.join("sound.wav");
        let original_path = root.join("original.wav");
        std::fs::write(&processed_path, b"processed").unwrap();
        std::fs::write(&original_path, b"original").unwrap();
        let path_key = processed_path.to_string_lossy().to_string();
        let data = RefCell::new(sound_delete_data(&path_key));
        let cache_invalidated = Cell::new(false);

        let staged =
            stage_sound_files_for_deletion(&[processed_path.clone(), original_path.clone()])
                .unwrap();
        let result: CmdResult<()> = commit_staged_sound_deletion(&staged, || {
            let mut scratch = data.borrow().clone();
            remove_sound_entry_and_references(&mut scratch, &path_key);
            Err(CommandError::msg("injected store failure"))
        });

        assert!(result.is_err());
        assert!(processed_path.exists());
        assert!(original_path.exists());
        assert!(!cache_invalidated.get());
        assert!(data.borrow().sound_library.contains_key(&path_key));
        let position = &data.borrow().key_positions["4key"][0];
        assert_eq!(position.sound_path.as_deref(), Some(path_key.as_str()));
        assert_eq!(position.sound_enabled, Some(true));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn sound_delete_stages_files_before_store_and_moves_them_to_trash_after_commit() {
        let root = std::env::temp_dir().join(format!(
            "dmnote-sound-delete-success-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let processed_path = root.join("sound.wav");
        let original_path = root.join("original.wav");
        std::fs::write(&processed_path, b"processed").unwrap();
        std::fs::write(&original_path, b"original").unwrap();
        let path_key = processed_path.to_string_lossy().to_string();
        let data = RefCell::new(sound_delete_data(&path_key));
        let events = RefCell::new(Vec::new());
        let trash_dir = root.join("trash");
        let staged =
            stage_sound_files_for_deletion(&[processed_path.clone(), original_path.clone()])
                .unwrap();
        assert!(!processed_path.exists());
        assert!(!original_path.exists());

        commit_staged_sound_deletion(&staged, || {
            let mut scratch = data.borrow().clone();
            remove_sound_entry_and_references(&mut scratch, &path_key);
            *data.borrow_mut() = scratch;
            events.borrow_mut().push("store");
            Ok(())
        })
        .unwrap();
        events.borrow_mut().push("cache");
        move_staged_sound_deletions_to_trash(&staged, &trash_dir).unwrap();
        events.borrow_mut().push("trash");

        assert_eq!(*events.borrow(), ["store", "cache", "trash"]);
        assert!(!processed_path.exists());
        assert!(!original_path.exists());
        let quarantined: Vec<_> = std::fs::read_dir(&trash_dir)
            .unwrap()
            .flat_map(|session| std::fs::read_dir(session.unwrap().path()).unwrap())
            .flat_map(|category| std::fs::read_dir(category.unwrap().path()).unwrap())
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert!(quarantined.contains(&"sound.wav".into()));
        assert!(quarantined.contains(&"original.wav".into()));
        let position = &data.borrow().key_positions["4key"][0];
        assert_eq!(position.sound_path, None);
        assert_eq!(position.sound_enabled, Some(false));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn sound_delete_event_failure_does_not_stop_remaining_notifications() {
        let attempted = RefCell::new(Vec::new());

        emit_sound_reference_changes_with(
            &[
                EditorField::KeyPositions,
                EditorField::GraphPositions,
                EditorField::KnobPositions,
            ],
            |event| {
                attempted.borrow_mut().push(event.name());
                if event == SoundReferenceChangeEvent::Key {
                    Err("injected emit failure")
                } else {
                    Ok(())
                }
            },
        );

        assert_eq!(
            *attempted.borrow(),
            [
                "positions:changed",
                "graphPositions:changed",
                "knobPositions:changed",
            ]
        );
    }

    #[test]
    fn processed_wav_temp_failure_keeps_file_and_metadata() {
        let (root, path) = wav_test_path("temp-failure");
        let metadata = RefCell::new("old-metadata");

        let result = replace_processed_wav_with(
            &path,
            b"new-wav",
            || {
                *metadata.borrow_mut() = "new-metadata";
                Ok(())
            },
            |_, _| Err(anyhow::anyhow!("injected temp failure")),
            PreparedAtomicReplace::commit,
            |path| std::fs::remove_file(path),
        );

        assert!(result.is_err());
        assert_wav_rollback(&path, &metadata);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn deleted_sound_cannot_be_recreated_by_a_waiting_edit() {
        let root = std::env::temp_dir().join(format!(
            "dmnote-processed-wav-deleted-before-edit-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("deleted.wav");
        std::fs::write(&path, b"old-wav").unwrap();
        let delete_guard = PROCESSED_WAV_TRANSACTION_LOCK.lock();
        let edit_path = path.clone();
        let (waiting_tx, waiting_rx) = mpsc::channel();
        let edit = thread::spawn(move || {
            waiting_tx.send(()).unwrap();
            let _edit_guard = PROCESSED_WAV_TRANSACTION_LOCK.lock();
            ensure_existing_sound_edit_target(&edit_path)
        });
        waiting_rx.recv().unwrap();

        std::fs::remove_file(&path).unwrap();
        drop(delete_guard);

        let error = edit.join().unwrap().unwrap_err().to_string();

        assert!(error.contains("찾을 수 없습니다"));
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn processed_wav_rename_failure_keeps_file_and_metadata() {
        let (root, path) = wav_test_path("rename-failure");
        let metadata = RefCell::new("old-metadata");

        let result = replace_processed_wav_with(
            &path,
            b"new-wav",
            || {
                *metadata.borrow_mut() = "new-metadata";
                Ok(())
            },
            |path, bytes| prepare_atomic_replace(path, bytes, "rename-failure"),
            |_| Err(anyhow::anyhow!("injected rename failure")),
            |path| std::fs::remove_file(path),
        );

        assert!(result.is_err());
        assert_wav_rollback(&path, &metadata);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn processed_wav_store_failure_restores_file_and_metadata() {
        let (root, path) = wav_test_path("store-failure");
        let metadata = RefCell::new("old-metadata");

        let result = replace_processed_wav_with(
            &path,
            b"new-wav",
            || -> CmdResult<()> { Err(CommandError::msg("injected store failure")) },
            |path, bytes| prepare_atomic_replace(path, bytes, "store-failure"),
            PreparedAtomicReplace::commit,
            |path| std::fs::remove_file(path),
        );

        assert!(result.is_err());
        assert_wav_rollback(&path, &metadata);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn processed_wav_success_commits_and_removes_backup() {
        let (root, path) = wav_test_path("success");
        let metadata = RefCell::new("old-metadata");

        replace_processed_wav_with(
            &path,
            b"new-wav",
            || {
                *metadata.borrow_mut() = "new-metadata";
                Ok(())
            },
            |path, bytes| prepare_atomic_replace(path, bytes, "success"),
            PreparedAtomicReplace::commit,
            |path| std::fs::remove_file(path),
        )
        .unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"new-wav");
        assert_eq!(*metadata.borrow(), "new-metadata");
        assert!(!backup_path_for(&path).unwrap().exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn processed_wav_backup_cleanup_failure_keeps_committed_file_and_metadata() {
        let (root, path) = wav_test_path("cleanup-failure");
        let metadata = RefCell::new("old-metadata");

        replace_processed_wav_with(
            &path,
            b"new-wav",
            || {
                *metadata.borrow_mut() = "new-metadata";
                Ok(())
            },
            |path, bytes| prepare_atomic_replace(path, bytes, "cleanup-failure"),
            PreparedAtomicReplace::commit,
            |_| {
                Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "injected cleanup failure",
                ))
            },
        )
        .unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"new-wav");
        assert_eq!(*metadata.borrow(), "new-metadata");
        assert_eq!(
            std::fs::read(backup_path_for(&path).unwrap()).unwrap(),
            b"old-wav"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn processed_wav_replacement_recovers_backup_before_retrying() {
        let root = std::env::temp_dir().join(format!(
            "dmnote-processed-wav-crash-retry-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("sound.wav");
        let backup_path = backup_path_for(&path).unwrap();
        let crashed_temp_path = root.join(format!(
            ".sound.wav.processed-wav-{}.tmp",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&backup_path, b"old-wav").unwrap();
        std::fs::write(&crashed_temp_path, b"crashed-new-wav").unwrap();
        let metadata = RefCell::new("old-metadata");

        replace_processed_wav_with(
            &path,
            b"retried-new-wav",
            || {
                *metadata.borrow_mut() = "new-metadata";
                Ok(())
            },
            |target_path, bytes| {
                assert_eq!(std::fs::read(target_path).unwrap(), b"old-wav");
                prepare_atomic_replace(target_path, bytes, "crash-retry")
            },
            PreparedAtomicReplace::commit,
            |path| std::fs::remove_file(path),
        )
        .unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"retried-new-wav");
        assert_eq!(*metadata.borrow(), "new-metadata");
        assert!(!backup_path.exists());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn processed_wav_backup_recovery_error_includes_operation_and_paths() {
        let root = std::env::temp_dir().join(format!(
            "dmnote-processed-wav-recovery-error-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let target_path = root.join("sound.wav");
        let backup_path = backup_path_for(&target_path).unwrap();
        std::fs::write(&backup_path, b"old-wav").unwrap();

        let error =
            restore_interrupted_processed_wav_backup_with(&target_path, &backup_path, |_, _| {
                Err(std::io::Error::other("injected recovery failure"))
            })
            .unwrap_err()
            .to_string();

        assert!(error.contains("중단된 WAV 백업 복구 실패"));
        assert!(error.contains(&backup_path.display().to_string()));
        assert!(error.contains(&target_path.display().to_string()));
        assert!(error.contains("injected recovery failure"));

        let _ = std::fs::remove_dir_all(root);
    }

    // 단독 실행: cargo test --lib commands::keys::sound::tests::processed_wav_atomic_write_survives_file_size_limit -- --ignored --exact
    #[cfg(unix)]
    #[test]
    #[ignore = "RLIMIT_FSIZE는 프로세스 전역이므로 단독 실행"]
    fn processed_wav_atomic_write_survives_file_size_limit() {
        use crate::state::atomic_file::test_support::FileSizeLimit;

        let (root, path) = wav_test_path("rlimit");
        let metadata = RefCell::new("old-metadata");

        {
            let _limit = FileSizeLimit::set(1_024);
            let oversized = vec![b'w'; 4_096];
            let result = replace_processed_wav_with(
                &path,
                &oversized,
                || {
                    *metadata.borrow_mut() = "new-metadata";
                    Ok(())
                },
                |path, bytes| prepare_atomic_replace(path, bytes, "rlimit"),
                PreparedAtomicReplace::commit,
                |path| std::fs::remove_file(path),
            );
            assert!(result.is_err());
            assert_wav_rollback(&path, &metadata);
        }

        let _ = std::fs::remove_dir_all(root);
    }
}
