use super::*;

struct SoundScan {
    items: Vec<SoundListItem>,
    library_at_scan: std::collections::HashMap<String, SoundLibraryEntry>,
    seen_paths: HashSet<String>,
    scan_complete: bool,
}

pub(super) fn sound_list_inner(
    app: &tauri::AppHandle,
    state: &AppState,
) -> CmdResult<Vec<SoundListItem>> {
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
pub(super) fn sound_library_needs_reconcile(
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
pub(super) fn apply_sound_scan_to_library(
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

pub(super) fn stale_sound_library_keys(
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
