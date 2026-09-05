use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{anyhow, Context, Result};

use crate::models::AppStoreData;

use super::super::super::local_asset_path::path_identity_key;
use super::super::collect_local_sound_paths;
use super::{
    SoundRecoveryOutcome, StagedSoundDeletionFile, SOUND_DELETE_BACKUP_MARKER, TRASH_RETENTION,
};

pub(in crate::state::store) struct TrashSession {
    trash_dir: PathBuf,
    timestamp_millis: u128,
    next_suffix: u64,
    session_dir: Option<PathBuf>,
}

impl TrashSession {
    pub(in crate::state::store) fn new(trash_dir: PathBuf, now: SystemTime) -> Result<Self> {
        Ok(Self {
            trash_dir,
            timestamp_millis: system_time_millis(now)?,
            next_suffix: 0,
            session_dir: None,
        })
    }

    pub(in crate::state::store) fn destination_path(
        &mut self,
        source_dir: &Path,
        source_path: &Path,
    ) -> Result<PathBuf> {
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

pub(in crate::state::store) fn recover_interrupted_sound_deletions(
    data: &AppStoreData,
    sounds_dir: &Path,
    trash_dir: &Path,
) -> Result<SoundRecoveryOutcome> {
    recover_interrupted_sound_deletions_with(data, sounds_dir, trash_dir, |from, to| {
        fs::rename(from, to)
    })
}

pub(in crate::state::store) fn recover_interrupted_sound_deletions_with<Rename>(
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

pub(in crate::state::store) fn system_time_millis(time: SystemTime) -> Result<u128> {
    time.duration_since(UNIX_EPOCH)
        .context("system time is before the Unix epoch")
        .map(|duration| duration.as_millis())
}

pub(in crate::state::store) fn purge_expired_trash_sessions(trash_dir: &Path) -> Result<()> {
    purge_expired_trash_sessions_at(trash_dir, SystemTime::now())
}

pub(in crate::state::store) fn purge_expired_trash_sessions_at(
    trash_dir: &Path,
    now: SystemTime,
) -> Result<()> {
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

pub(in crate::state::store) fn sweep_unreferenced_asset_files(
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
