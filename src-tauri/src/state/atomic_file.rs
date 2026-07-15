use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use uuid::Uuid;

pub(crate) struct PreparedAtomicReplace {
    target_path: PathBuf,
    temp_path: PathBuf,
    committed: bool,
}

impl PreparedAtomicReplace {
    pub(crate) fn commit(self) -> Result<()> {
        self.commit_with(replace_file, sync_parent_directory)
    }

    fn commit_with<Replace, SyncParent>(
        mut self,
        replace: Replace,
        sync_parent: SyncParent,
    ) -> Result<()>
    where
        Replace: FnOnce(&Path, &Path) -> Result<()>,
        SyncParent: FnOnce(&Path) -> Result<()>,
    {
        replace(&self.temp_path, &self.target_path)
            .with_context(|| format!("failed to replace file at {}", self.target_path.display()))?;
        self.committed = true;

        // rename 이후 실패를 API 실패로 돌리면 디스크와 메모리의 성공 판정이 갈림
        if let Err(error) = sync_parent(&self.target_path) {
            log::warn!(
                "failed to sync parent directory after replacing '{}': {error:#}",
                self.target_path.display()
            );
        }
        Ok(())
    }
}

impl Drop for PreparedAtomicReplace {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_file(&self.temp_path);
        }
    }
}

pub(crate) fn prepare_atomic_replace(
    path: &Path,
    content: &[u8],
    label: &str,
) -> Result<PreparedAtomicReplace> {
    let parent = path
        .parent()
        .context("failed to resolve file parent directory")?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .context("failed to resolve file name")?;
    let temp_path = parent.join(format!(".{file_name}.{label}-{}.tmp", Uuid::new_v4()));

    let result = (|| {
        let mut temp = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .with_context(|| format!("failed to create temp file at {}", temp_path.display()))?;
        temp.write_all(content)
            .with_context(|| format!("failed to write temp file at {}", temp_path.display()))?;
        sync_file_contents(&temp)
            .with_context(|| format!("failed to sync temp file at {}", temp_path.display()))?;
        drop(temp);

        Ok(PreparedAtomicReplace {
            target_path: path.to_path_buf(),
            temp_path: temp_path.clone(),
            committed: false,
        })
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

pub(crate) fn atomic_replace(path: &Path, content: &[u8], label: &str) -> Result<()> {
    prepare_atomic_replace(path, content, label)?.commit()
}

#[cfg(not(target_os = "windows"))]
fn replace_file(source: &Path, target: &Path) -> Result<()> {
    fs::rename(source, target).map_err(Into::into)
}

#[cfg(target_os = "windows")]
fn replace_file(source: &Path, target: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        },
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let target = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();

    unsafe {
        MoveFileExW(
            PCWSTR(source.as_ptr()),
            PCWSTR(target.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(Into::into)
}

#[cfg(target_os = "macos")]
fn sync_file_contents(file: &File) -> Result<()> {
    use std::os::fd::AsRawFd;

    let result = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_FULLFSYNC) };
    if result == -1 {
        let error = std::io::Error::last_os_error();
        if error
            .raw_os_error()
            .is_some_and(|code| code == libc::EINVAL || code == libc::ENOTSUP)
        {
            return file
                .sync_all()
                .context("F_FULLFSYNC is unsupported and fsync fallback failed");
        }
        return Err(error).context("F_FULLFSYNC failed");
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn sync_file_contents(file: &File) -> Result<()> {
    file.sync_all().map_err(Into::into)
}

#[cfg(unix)]
fn sync_parent_directory(target: &Path) -> Result<()> {
    let parent = target
        .parent()
        .context("failed to resolve target parent directory")?;
    File::open(parent)
        .with_context(|| format!("failed to open parent directory at {}", parent.display()))?
        .sync_all()
        .with_context(|| format!("failed to sync parent directory at {}", parent.display()))
}

#[cfg(not(unix))]
fn sync_parent_directory(_target: &Path) -> Result<()> {
    // Windows 교체는 MOVEFILE_WRITE_THROUGH에서 메타데이터 flush까지 대기
    Ok(())
}

#[cfg(test)]
mod commit_tests {
    use super::prepare_atomic_replace;

    fn test_directory(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("dmnote-{label}-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn replace_failure_keeps_old_target_and_removes_temp() {
        let directory = test_directory("atomic-replace-failure");
        std::fs::create_dir_all(&directory).unwrap();
        let target = directory.join("store.json");
        std::fs::write(&target, b"old").unwrap();
        let prepared = prepare_atomic_replace(&target, b"new", "failure").unwrap();

        let result = prepared.commit_with(
            |_source, _target| anyhow::bail!("injected replace failure"),
            |_target| panic!("parent sync must not run after replace failure"),
        );

        assert!(result.is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"old");
        assert!(!std::fs::read_dir(&directory).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")));
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn parent_sync_failure_keeps_committed_result_successful() {
        let directory = test_directory("atomic-parent-sync-failure");
        std::fs::create_dir_all(&directory).unwrap();
        let target = directory.join("store.json");
        std::fs::write(&target, b"old").unwrap();
        let prepared = prepare_atomic_replace(&target, b"new", "sync-failure").unwrap();

        let result = prepared.commit_with(
            |source, target| std::fs::rename(source, target).map_err(Into::into),
            |_target| anyhow::bail!("injected parent sync failure"),
        );

        assert!(result.is_ok());
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
        assert!(!std::fs::read_dir(&directory).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")));
        std::fs::remove_dir_all(directory).unwrap();
    }
}

#[cfg(all(test, unix))]
pub(crate) mod test_support {
    pub(crate) struct FileSizeLimit {
        previous_limit: libc::rlimit,
        previous_handler: libc::sighandler_t,
    }

    impl FileSizeLimit {
        pub(crate) fn set(bytes: libc::rlim_t) -> Self {
            let mut previous_limit = libc::rlimit {
                rlim_cur: 0,
                rlim_max: 0,
            };
            let get_result = unsafe { libc::getrlimit(libc::RLIMIT_FSIZE, &mut previous_limit) };
            assert_eq!(get_result, 0, "getrlimit(RLIMIT_FSIZE) failed");
            assert!(
                bytes <= previous_limit.rlim_max,
                "requested file limit exceeds hard limit"
            );

            let previous_handler = unsafe { libc::signal(libc::SIGXFSZ, libc::SIG_IGN) };
            let limited = libc::rlimit {
                rlim_cur: bytes,
                rlim_max: previous_limit.rlim_max,
            };
            let set_result = unsafe { libc::setrlimit(libc::RLIMIT_FSIZE, &limited) };
            assert_eq!(set_result, 0, "setrlimit(RLIMIT_FSIZE) failed");

            Self {
                previous_limit,
                previous_handler,
            }
        }
    }

    impl Drop for FileSizeLimit {
        fn drop(&mut self) {
            let _ = unsafe { libc::setrlimit(libc::RLIMIT_FSIZE, &self.previous_limit) };
            let _ = unsafe { libc::signal(libc::SIGXFSZ, self.previous_handler) };
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use std::{
        path::Path,
        process::{Child, Command},
        thread,
        time::Duration,
    };

    use super::prepare_atomic_replace;

    const CHILD_BOUNDARY_ENV: &str = "DMNOTE_ATOMIC_KILL_BOUNDARY";
    const CHILD_DIRECTORY_ENV: &str = "DMNOTE_ATOMIC_KILL_DIRECTORY";
    const CHILD_TEST_NAME: &str = "state::atomic_file::tests::atomic_replace_process_kill_child";

    fn wait_until_ready(child: &mut Child, marker: &Path) {
        for _ in 0..500 {
            if marker.exists() {
                return;
            }
            if let Some(status) = child.try_wait().unwrap() {
                panic!("atomic replace child exited before boundary: {status}");
            }
            thread::sleep(Duration::from_millis(10));
        }
        let _ = child.kill();
        let _ = child.wait();
        panic!("timed out waiting for atomic replace child boundary");
    }

    fn run_kill_boundary(boundary: &str, expected_revision: u64, expected_key: &str) {
        let directory = std::env::temp_dir().join(format!(
            "dmnote-atomic-process-kill-{boundary}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let target = directory.join("store.json");
        let marker = directory.join("ready");
        std::fs::write(&target, br#"{"editorRevision":4,"keys":{"4key":["old"]}}"#).unwrap();

        let mut child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", CHILD_TEST_NAME, "--nocapture"])
            .env(CHILD_BOUNDARY_ENV, boundary)
            .env(CHILD_DIRECTORY_ENV, &directory)
            .spawn()
            .unwrap();
        wait_until_ready(&mut child, &marker);
        child.kill().unwrap();
        child.wait().unwrap();

        let target_value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&target).unwrap()).unwrap();
        assert_eq!(target_value["editorRevision"], expected_revision);
        assert_eq!(target_value["keys"]["4key"][0], expected_key);

        if boundary == "before" {
            let orphan_temps = std::fs::read_dir(&directory)
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
                .count();
            assert_eq!(orphan_temps, 1);
        }

        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn process_kill_leaves_complete_old_or_new_target_at_replace_boundary() {
        run_kill_boundary("before", 4, "old");
        run_kill_boundary("after", 5, "new");
    }

    #[test]
    fn atomic_replace_process_kill_child() {
        let Ok(boundary) = std::env::var(CHILD_BOUNDARY_ENV) else {
            return;
        };
        let directory = std::path::PathBuf::from(
            std::env::var_os(CHILD_DIRECTORY_ENV).expect("child directory"),
        );
        let target = directory.join("store.json");
        let marker = directory.join("ready");
        let next = br#"{"editorRevision":5,"keys":{"4key":["new"]}}"#;
        let prepared = prepare_atomic_replace(&target, next, boundary.as_str()).unwrap();

        match boundary.as_str() {
            "before" => {
                std::fs::write(marker, b"prepared").unwrap();
                loop {
                    thread::sleep(Duration::from_secs(1));
                }
            }
            "after" => {
                prepared.commit().unwrap();
                std::fs::write(marker, b"committed").unwrap();
                loop {
                    thread::sleep(Duration::from_secs(1));
                }
            }
            other => panic!("unknown child boundary {other}"),
        }
    }
}
