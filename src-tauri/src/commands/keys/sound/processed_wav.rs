use super::*;

pub(super) fn sound_save_processed_wav_inner(
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

pub(super) fn sound_update_processed_wav_inner(
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

pub(super) fn ensure_existing_sound_edit_target(path: &Path) -> CmdResult<()> {
    match path.try_exists() {
        Ok(true) if path.is_file() => Ok(()),
        Ok(true) => Err(CommandError::msg("대상 사운드 경로가 파일이 아닙니다.")),
        Ok(false) => Err(CommandError::msg("편집할 사운드 파일을 찾을 수 없습니다.")),
        Err(error) => Err(CommandError::msg(format!(
            "편집할 사운드 파일 확인 실패: {error}"
        ))),
    }
}

pub(super) fn replace_processed_wav_with<Save, Prepare, Commit, Cleanup>(
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

pub(super) fn restore_interrupted_processed_wav_backup_with<Rename>(
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

pub(super) fn backup_path_for(path: &Path) -> CmdResult<PathBuf> {
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
