use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use anyhow::{anyhow, Context, Result};

use super::super::super::assets::local_asset_path::path_identity_key;
use super::{
    recover_interrupted_sound_deletions, AppStore, SoundRecoveryOutcome,
    PROCESSED_WAV_TRANSACTION_LOCK,
};

impl AppStore {
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

    pub(super) fn recover_pending_processed_wav_replacement(
        &self,
        sounds_dir: &Path,
    ) -> Result<()> {
        self.recover_pending_processed_wav_replacement_with(sounds_dir, Path::try_exists)
    }

    pub(in crate::state::store) fn recover_pending_processed_wav_replacement_with<TryExists>(
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

pub(super) fn recover_interrupted_processed_wav_replacements(
    sounds_dir: &Path,
) -> Result<SoundRecoveryOutcome> {
    recover_interrupted_processed_wav_replacements_with(sounds_dir, |from, to| fs::rename(from, to))
}

pub(in crate::state::store) fn recover_interrupted_processed_wav_replacements_with<Rename>(
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
