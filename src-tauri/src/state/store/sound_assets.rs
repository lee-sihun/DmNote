use std::{
    collections::HashSet,
    path::PathBuf,
    time::{Duration, SystemTime},
};

use anyhow::{anyhow, Context, Result};
use parking_lot::Mutex;

use super::{
    collect_local_font_paths, collect_local_image_paths, collect_local_sound_paths, AppStore,
};

mod processed_wav;
mod trash;

use processed_wav::recover_interrupted_processed_wav_replacements;
#[cfg(test)]
pub(super) use processed_wav::recover_interrupted_processed_wav_replacements_with;
pub(crate) use trash::{
    move_staged_sound_deletions_to_trash, restore_staged_sound_deletions,
    stage_sound_files_for_deletion,
};
use trash::{purge_expired_trash_sessions, recover_interrupted_sound_deletions};
#[cfg(test)]
pub(super) use trash::{
    purge_expired_trash_sessions_at, recover_interrupted_sound_deletions_with, system_time_millis,
};
pub(super) use trash::{sweep_unreferenced_asset_files, TrashSession};

pub(super) const TRASH_RETENTION: Duration = Duration::from_secs(30 * 24 * 60 * 60);
const SOUND_DELETE_BACKUP_MARKER: &str = ".delete-backup-";
pub(crate) static PROCESSED_WAV_TRANSACTION_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug)]
pub(crate) struct StagedSoundDeletionFile {
    pub(super) source_path: PathBuf,
    pub(super) backup_path: PathBuf,
}

pub(super) struct SoundRecoveryOutcome {
    pub(super) protected_keys: HashSet<String>,
    pub(super) complete: bool,
}

impl SoundRecoveryOutcome {
    fn complete() -> Self {
        Self {
            protected_keys: HashSet::new(),
            complete: true,
        }
    }
}

impl AppStore {
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
}
