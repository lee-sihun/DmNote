use std::{
    fs::{self, OpenOptions},
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
    pub(crate) fn commit(mut self) -> Result<()> {
        fs::rename(&self.temp_path, &self.target_path)
            .with_context(|| format!("failed to replace file at {}", self.target_path.display()))?;
        self.committed = true;
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
        temp.sync_all()
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
