use super::{
    apply_sound_scan_to_library, backup_path_for, commit_staged_sound_deletion,
    contains_duplicate_path_separator, emit_sound_reference_changes_with,
    ensure_existing_sound_edit_target, remove_sound_entry_and_references,
    replace_processed_wav_with, resolve_sound_path_key_from_keys,
    restore_interrupted_processed_wav_backup_with, sound_library_needs_reconcile,
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
fn sound_library_needs_reconcile_is_false_when_scan_matches_library() {
    let mut library = std::collections::HashMap::new();
    library.insert(
        "a.wav".to_string(),
        crate::models::SoundLibraryEntry::default(),
    );
    let seen: std::collections::HashSet<String> = ["a.wav".to_string()].into_iter().collect();
    assert!(!sound_library_needs_reconcile(&library, &seen, true));
}

#[test]
fn apply_sound_scan_inserts_new_files_and_drops_stale_only_when_complete() {
    let mut library = std::collections::HashMap::new();
    library.insert(
        "gone.wav".to_string(),
        crate::models::SoundLibraryEntry::default(),
    );
    let seen: std::collections::HashSet<String> = ["new.wav".to_string()].into_iter().collect();
    let at_scan = library.clone();
    let exists = |_: &str| true;

    let mut partial = library.clone();
    assert!(sound_library_needs_reconcile(&library, &seen, false));
    apply_sound_scan_to_library(&mut partial, &at_scan, &seen, false, &exists);
    assert!(partial.contains_key("new.wav"));
    assert!(partial.contains_key("gone.wav"));

    let mut complete = library.clone();
    // 삭제 후보 gone.wav는 turn 시점에 디스크에도 없어야 지운다
    apply_sound_scan_to_library(&mut complete, &at_scan, &seen, true, &|key| {
        key != "gone.wav"
    });
    assert!(complete.contains_key("new.wav"));
    assert!(!complete.contains_key("gone.wav"));
}

#[test]
fn apply_sound_scan_keeps_entries_resurrected_between_scan_and_turn() {
    // 스캔 때 없던 파일이 turn 직전에 되살아나면(update_processed_wav의 rename)
    // 메타를 지우지 않는다
    let mut library = std::collections::HashMap::new();
    library.insert(
        "back.wav".to_string(),
        crate::models::SoundLibraryEntry::default(),
    );
    let at_scan = library.clone();
    let seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    apply_sound_scan_to_library(&mut library, &at_scan, &seen, true, &|_| true);
    assert!(library.contains_key("back.wav"));
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
    let validated_alias = validate_sound_path(&sounds_dir, &alias_path.to_string_lossy()).unwrap();
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
    let validated_alias = validate_sound_path(&sounds_dir, &alias_path.to_string_lossy()).unwrap();
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
    let resolved_key =
        resolve_sound_path_key_from_keys(&validated_unmatched, std::slice::from_ref(&stored_key));
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
        stage_sound_files_for_deletion(&[processed_path.clone(), original_path.clone()]).unwrap();
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
        stage_sound_files_for_deletion(&[processed_path.clone(), original_path.clone()]).unwrap();
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
