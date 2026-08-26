//! macOS 앱 번들 경로 판정 — main.rs와 commands 양쪽에서 공유

#[cfg(any(target_os = "macos", test))]
use std::path::{Path, PathBuf};

/// 실행 파일 경로에서 `.app` 번들 루트 도출 (`X.app/Contents/MacOS/bin` 형태만 인정)
#[cfg(any(target_os = "macos", test))]
pub fn bundle_path_from_exe(exe: &Path) -> Option<PathBuf> {
    let macos_dir = exe.parent()?;
    if macos_dir.file_name()? != "MacOS" {
        return None;
    }

    let contents_dir = macos_dir.parent()?;
    if contents_dir.file_name()? != "Contents" {
        return None;
    }

    let bundle_dir = contents_dir.parent()?;
    if bundle_dir.extension()? == "app" {
        return Some(bundle_dir.to_path_buf());
    }

    None
}

/// 현재 프로세스의 `.app` 번들 경로 (번들 밖 dev 바이너리면 None)
#[cfg(target_os = "macos")]
pub fn resolve_current_bundle_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    bundle_path_from_exe(&exe)
}

#[cfg(test)]
mod tests {
    use super::bundle_path_from_exe;
    use std::path::{Path, PathBuf};

    #[test]
    fn resolves_bundle_root_from_macos_executable() {
        let exe = Path::new("/Applications/DM NOTE.app/Contents/MacOS/dm-note");
        assert_eq!(
            bundle_path_from_exe(exe),
            Some(PathBuf::from("/Applications/DM NOTE.app"))
        );
    }

    #[test]
    fn rejects_bare_dev_binary() {
        assert_eq!(
            bundle_path_from_exe(Path::new("/repo/src-tauri/target/release/dm-note")),
            None
        );
    }

    #[test]
    fn rejects_binary_outside_macos_dir() {
        assert_eq!(
            bundle_path_from_exe(Path::new("/Applications/DM NOTE.app/Contents/Resources/x")),
            None
        );
    }

    #[test]
    fn rejects_contents_without_app_extension() {
        assert_eq!(
            bundle_path_from_exe(Path::new("/tmp/Foo/Contents/MacOS/bin")),
            None
        );
    }
}
