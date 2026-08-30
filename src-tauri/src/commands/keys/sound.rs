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

mod library;
mod processed_wav;

use library::sound_list_inner;
#[cfg(test)]
use library::{
    apply_sound_scan_to_library, sound_library_needs_reconcile, stale_sound_library_keys,
};
#[cfg(test)]
use processed_wav::{
    backup_path_for, ensure_existing_sound_edit_target, replace_processed_wav_with,
    restore_interrupted_processed_wav_backup_with,
};
use processed_wav::{sound_save_processed_wav_inner, sound_update_processed_wav_inner};

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
