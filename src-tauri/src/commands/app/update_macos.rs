//! macOS 자동 업데이트 — 릴리즈 DMG 다운로드 → 서명 검증 → 번들 교체
//!
//! 순수 함수(자산 후보·출력 파싱·경로 판정)는 어느 OS에서든 테스트되도록
//! `cfg(any(target_os = "macos", test))`, 실제 설치 경로만 macOS 전용.

use std::path::{Path, PathBuf};

use crate::errors::{CmdResult, CommandError};

/// 릴리즈 서명 인증서의 Team ID — 인증서 갱신/팀 이전 시 함께 변경
pub const EXPECTED_TEAM_ID: &str = "R8T46CXVXU";
pub const EXPECTED_BUNDLE_ID: &str = "com.dmnote.desktop";
const STAGED_SUFFIX: &str = ".new";
const BACKUP_SUFFIX: &str = ".old";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MacArch {
    Aarch64,
    X64,
}

impl MacArch {
    pub fn current() -> Self {
        if cfg!(target_arch = "aarch64") {
            MacArch::Aarch64
        } else {
            MacArch::X64
        }
    }

    fn asset_suffix(self) -> &'static str {
        match self {
            MacArch::Aarch64 => "aarch64",
            MacArch::X64 => "x64",
        }
    }
}

/// 다운로드 후보 — 아키텍처 전용 DMG가 있으면 우선, 없으면 유니버설 (릴리즈 워크플로 자산 이름 계약)
pub fn asset_candidates(tag: &str, arch: MacArch) -> Vec<String> {
    vec![
        format!("DM.NOTE_{tag}_{}.dmg", arch.asset_suffix()),
        format!("DM.NOTE_{tag}_universal.dmg"),
    ]
}

/// `codesign -dv --verbose=4` 출력에서 `Key=Value` 추출 — `not set`은 미설정으로 취급
pub fn parse_codesign_field(output: &str, key: &str) -> Option<String> {
    output
        .lines()
        .filter_map(|line| line.trim().strip_prefix(key)?.strip_prefix('='))
        .map(str::trim)
        .find(|value| !value.is_empty() && *value != "not set")
        .map(str::to_string)
}

/// `hdiutil attach -plist` 출력에서 마운트 지점 추출
pub fn parse_hdiutil_mount_point(plist_bytes: &[u8]) -> Option<PathBuf> {
    let value: plist::Value = plist::from_bytes(plist_bytes).ok()?;
    let entities = value.as_dictionary()?.get("system-entities")?.as_array()?;
    entities
        .iter()
        .filter_map(|entity| entity.as_dictionary()?.get("mount-point")?.as_string())
        .map(PathBuf::from)
        .next()
}

/// Info.plist 버전과 릴리즈 태그 비교 (양쪽 `v` 접두 허용)
pub fn bundle_version_matches(plist_version: &str, tag: &str) -> bool {
    let normalize = |raw: &str| raw.trim().trim_start_matches(['v', 'V']).to_string();
    match (
        semver::Version::parse(&normalize(plist_version)),
        semver::Version::parse(&normalize(tag)),
    ) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// Gatekeeper App Translocation 경로(읽기 전용 임시 마운트)에서 실행 중인지
pub fn is_app_translocated(bundle: &Path) -> bool {
    bundle
        .components()
        .any(|component| component.as_os_str() == "AppTranslocation")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallPaths {
    pub current: PathBuf,
    pub parent: PathBuf,
    pub staged: PathBuf,
    pub backup: PathBuf,
}

/// 교체 대상 경로 세트 — `X.app` 옆에 `X.app.new`(스테이징) / `X.app.old`(백업)
pub fn install_paths_for(bundle: &Path) -> CmdResult<InstallPaths> {
    let parent = bundle
        .parent()
        .ok_or_else(|| CommandError::msg("app bundle has no parent directory"))?
        .to_path_buf();
    let name = bundle
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| CommandError::msg("app bundle name is not valid UTF-8"))?;
    Ok(InstallPaths {
        current: bundle.to_path_buf(),
        staged: parent.join(format!("{name}{STAGED_SUFFIX}")),
        backup: parent.join(format!("{name}{BACKUP_SUFFIX}")),
        parent,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleInfo {
    pub identifier: String,
    pub version: String,
}

/// 번들 Info.plist에서 식별자·버전 읽기
pub fn read_bundle_info(bundle: &Path) -> CmdResult<BundleInfo> {
    let info_path = bundle.join("Contents").join("Info.plist");
    let value: plist::Value = plist::from_file(&info_path).map_err(|error| {
        CommandError::msg(format!("failed to read {}: {error}", info_path.display()))
    })?;
    let dict = value
        .as_dictionary()
        .ok_or_else(|| CommandError::msg("Info.plist root is not a dictionary"))?;
    let field = |key: &str| -> CmdResult<String> {
        dict.get(key)
            .and_then(|value| value.as_string())
            .map(str::to_string)
            .ok_or_else(|| CommandError::msg(format!("Info.plist is missing {key}")))
    };
    Ok(BundleInfo {
        identifier: field("CFBundleIdentifier")?,
        version: field("CFBundleShortVersionString")?,
    })
}

/// 디렉토리 바로 아래의 첫 `.app` 번들
pub fn find_app_bundle_in(dir: &Path) -> Option<PathBuf> {
    let mut apps: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_dir() && path.extension().is_some_and(|ext| ext == "app"))
        .collect();
    apps.sort();
    apps.into_iter().next()
}

/// 이전 업데이트가 남긴 `.app.old` / `.app.new` 인지 — 우리 번들 식별자일 때만 true (오삭제 방지)
pub fn is_stale_update_leftover(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let is_leftover_name = name.ends_with(&format!(".app{STAGED_SUFFIX}"))
        || name.ends_with(&format!(".app{BACKUP_SUFFIX}"));
    if !is_leftover_name || !path.is_dir() {
        return false;
    }
    read_bundle_info(path).is_ok_and(|info| info.identifier == EXPECTED_BUNDLE_ID)
}

#[cfg(target_os = "macos")]
pub use install::{cleanup_stale_leftovers, run};

#[cfg(target_os = "macos")]
mod install {
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::time::Duration;

    use tauri::AppHandle;

    use super::super::update::{
        asset_download_url, build_download_client, download_asset_to_file, emit_update_progress,
        validate_update_target, AutoUpdateResult, DownloadError, UpdatePhase,
    };
    use super::*;
    use crate::services::macos_bundle::resolve_current_bundle_path;

    const HDIUTIL: &str = "/usr/bin/hdiutil";
    const CODESIGN: &str = "/usr/bin/codesign";
    const SPCTL: &str = "/usr/sbin/spctl";
    const DITTO: &str = "/usr/bin/ditto";
    const HELPER_RELATIVE_PATH: &str = "Contents/Resources/DM NOTE.app";
    const DETACH_ATTEMPTS: u32 = 3;

    pub fn run(app: AppHandle, tag: &str) -> CmdResult<AutoUpdateResult> {
        let target = validate_update_target(&app, tag)?;
        let bundle = resolve_current_bundle_path().ok_or_else(|| {
            CommandError::msg("auto update requires the app to run from an .app bundle")
        })?;
        let paths = install_paths_for(&bundle)?;
        ensure_writable_install_location(&paths)?;
        remove_stale_staged(&paths.staged);

        let temp_dir = tempfile::Builder::new()
            .prefix("dmnote-update-")
            .tempdir()?;

        emit_update_progress(&app, UpdatePhase::Downloading, None);
        let (dmg_path, download_url) =
            download_first_available(&app, &target.tag, temp_dir.path())?;

        emit_update_progress(&app, UpdatePhase::Verifying, None);
        let mount_point = temp_dir.path().join("mnt");
        let mut mount = attach_dmg(&dmg_path, &mount_point)?;
        let mounted_app = find_app_bundle_in(mount.path())
            .ok_or_else(|| CommandError::msg("downloaded DMG does not contain an app bundle"))?;
        // 복사 전에 식별자·버전부터 확인 — 잘못된 자산이면 조기 중단
        let info = read_bundle_info(&mounted_app)?;
        if info.identifier != EXPECTED_BUNDLE_ID {
            return Err(CommandError::msg(format!(
                "downloaded app has unexpected bundle identifier: {}",
                info.identifier
            )));
        }
        if !bundle_version_matches(&info.version, &target.tag) {
            return Err(CommandError::msg(format!(
                "downloaded app version ({}) does not match the release tag ({})",
                info.version, target.tag
            )));
        }

        emit_update_progress(&app, UpdatePhase::Installing, None);
        stage_bundle(&mounted_app, &paths.staged)?;
        if let Err(error) = verify_staged_bundle(&paths.staged) {
            let _ = std::fs::remove_dir_all(&paths.staged);
            return Err(error);
        }
        swap_bundles(&paths)?;
        mount.detach();

        log::info!(
            "[Updater] installed {} over {} ({} -> {})",
            paths.staged.display(),
            paths.current.display(),
            target.previous_version,
            target.target_version
        );
        Ok(AutoUpdateResult {
            previous_version: target.previous_version,
            updated_to: target.target_version.to_string(),
            download_url,
        })
    }

    /// 앱 시작 시 이전 업데이트의 `.app.old` / `.app.new` 정리 (실패는 경고만)
    pub fn cleanup_stale_leftovers() {
        let Some(bundle) = resolve_current_bundle_path() else {
            return;
        };
        let Ok(paths) = install_paths_for(&bundle) else {
            return;
        };
        for leftover in [paths.backup, paths.staged] {
            if !is_stale_update_leftover(&leftover) {
                continue;
            }
            match std::fs::remove_dir_all(&leftover) {
                Ok(()) => log::info!("[Updater] removed leftover {}", leftover.display()),
                Err(error) => log::warn!(
                    "[Updater] failed to remove leftover {}: {error}",
                    leftover.display()
                ),
            }
        }
    }

    fn ensure_writable_install_location(paths: &InstallPaths) -> CmdResult<()> {
        if is_app_translocated(&paths.current) {
            return Err(CommandError::msg(
                "the app is running from a quarantined temporary location — move it to the Applications folder and try again",
            ));
        }
        if is_read_only_volume(&paths.parent) {
            return Err(CommandError::msg(
                "the app is running from a read-only volume (disk image?) — install it to the Applications folder first",
            ));
        }
        // 실제 쓰기 프로브 — 권한 부족(EACCES)을 syscall로 확인
        tempfile::Builder::new()
            .prefix(".dmnote-update-probe")
            .tempdir_in(&paths.parent)
            .map_err(|error| {
                CommandError::msg(format!(
                    "no write permission for {}: {error}",
                    paths.parent.display()
                ))
            })?;
        Ok(())
    }

    fn is_read_only_volume(path: &Path) -> bool {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;

        let Ok(c_path) = CString::new(path.as_os_str().as_bytes()) else {
            return false;
        };
        let mut stat: libc::statfs = unsafe { std::mem::zeroed() };
        // SAFETY: c_path는 NUL 종료 문자열, stat은 statfs 크기의 유효한 출력 버퍼
        let rc = unsafe { libc::statfs(c_path.as_ptr(), &mut stat) };
        rc == 0 && (stat.f_flags & libc::MNT_RDONLY as u32) != 0
    }

    fn remove_stale_staged(staged: &Path) {
        if is_stale_update_leftover(staged) {
            if let Err(error) = std::fs::remove_dir_all(staged) {
                log::warn!(
                    "[Updater] failed to remove stale staged bundle {}: {error}",
                    staged.display()
                );
            }
        }
    }

    // 디버그 빌드 한정: 로컬 서버로 업데이트 흐름 E2E 테스트 (릴리즈 바이너리에는 컴파일되지 않음)
    #[cfg(debug_assertions)]
    fn asset_base_url_override() -> Option<String> {
        std::env::var("DMNOTE_UPDATE_BASE_URL")
            .ok()
            .map(|base| base.trim_end_matches('/').to_string())
    }

    #[cfg(not(debug_assertions))]
    fn asset_base_url_override() -> Option<String> {
        None
    }

    /// 후보 자산을 순서대로 시도 — 404만 다음 후보로, 다른 오류는 즉시 중단
    fn download_first_available(
        app: &AppHandle,
        tag: &str,
        dir: &Path,
    ) -> CmdResult<(PathBuf, String)> {
        let client = build_download_client()?;
        let override_base = asset_base_url_override();
        let candidates = asset_candidates(tag, MacArch::current());

        for asset_name in &candidates {
            let url = match &override_base {
                Some(base) => format!("{base}/{asset_name}"),
                None => asset_download_url(tag, asset_name),
            };
            let dest = dir.join(asset_name);
            match download_asset_to_file(&client, &url, &dest, "update", |percent| {
                emit_update_progress(app, UpdatePhase::Downloading, percent)
            }) {
                Ok(()) => {
                    log::info!("[Updater] downloaded {asset_name}");
                    return Ok((dest, url));
                }
                Err(DownloadError::NotFound) => {
                    log::info!("[Updater] asset not found, trying next candidate: {asset_name}");
                }
                Err(DownloadError::Other(error)) => return Err(error),
            }
        }

        Err(CommandError::msg(format!(
            "no macOS update asset found for {tag} (tried: {})",
            candidates.join(", ")
        )))
    }

    /// 마운트 해제를 보장하는 가드 — 어떤 실패 경로에서도 detach
    struct MountGuard {
        mount_point: Option<PathBuf>,
    }

    impl MountGuard {
        fn path(&self) -> &Path {
            self.mount_point.as_deref().unwrap_or(Path::new(""))
        }

        fn detach(&mut self) {
            let Some(mount_point) = self.mount_point.take() else {
                return;
            };
            for attempt in 1..=DETACH_ATTEMPTS {
                let status = Command::new(HDIUTIL)
                    .arg("detach")
                    .arg(&mount_point)
                    .arg("-quiet")
                    .status();
                if status.is_ok_and(|status| status.success()) {
                    return;
                }
                std::thread::sleep(Duration::from_secs(u64::from(attempt)));
            }
            let forced = Command::new(HDIUTIL)
                .arg("detach")
                .arg(&mount_point)
                .args(["-force", "-quiet"])
                .status();
            if !forced.is_ok_and(|status| status.success()) {
                log::warn!(
                    "[Updater] failed to detach {} — leaving it mounted",
                    mount_point.display()
                );
            }
        }
    }

    impl Drop for MountGuard {
        fn drop(&mut self) {
            self.detach();
        }
    }

    fn attach_dmg(dmg: &Path, mount_point: &Path) -> CmdResult<MountGuard> {
        std::fs::create_dir_all(mount_point)?;
        let output = Command::new(HDIUTIL)
            .arg("attach")
            .arg(dmg)
            .args([
                "-nobrowse",
                "-readonly",
                "-noautoopen",
                "-plist",
                "-mountpoint",
            ])
            .arg(mount_point)
            .output()
            .map_err(|error| CommandError::msg(format!("failed to run hdiutil: {error}")))?;
        if !output.status.success() {
            return Err(CommandError::msg(format!(
                "failed to mount downloaded DMG: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
        let mounted = parse_hdiutil_mount_point(&output.stdout)
            .ok_or_else(|| CommandError::msg("hdiutil did not report a mount point"))?;
        Ok(MountGuard {
            mount_point: Some(mounted),
        })
    }

    fn stage_bundle(source: &Path, staged: &Path) -> CmdResult<()> {
        if staged.exists() {
            std::fs::remove_dir_all(staged)?;
        }
        // ditto: 확장 속성·서명 포함 복사
        run_checked(
            Command::new(DITTO).arg(source).arg(staged),
            "failed to copy the new app bundle",
        )
    }

    /// 실행될 실체(스테이징 사본)에 서명·Team ID·공증 검증
    fn verify_staged_bundle(staged: &Path) -> CmdResult<()> {
        run_checked(
            Command::new(CODESIGN)
                .args(["--verify", "--deep", "--strict", "--verbose=2"])
                .arg(staged),
            "code signature verification failed",
        )?;
        verify_signing_identity(staged, EXPECTED_BUNDLE_ID)?;

        // --deep은 Resources 안 nested 헬퍼를 리소스로만 봉인하므로 별도 검증
        let helper = staged.join(HELPER_RELATIVE_PATH);
        if helper.is_dir() {
            run_checked(
                Command::new(CODESIGN)
                    .args(["--verify", "--strict", "--verbose=2"])
                    .arg(&helper),
                "helper app signature verification failed",
            )?;
            verify_signing_identity(&helper, &format!("{EXPECTED_BUNDLE_ID}.helper.dock"))?;
        }

        run_checked(
            Command::new(SPCTL)
                .args(["-a", "-t", "exec", "-vv"])
                .arg(staged),
            "Gatekeeper assessment failed",
        )
    }

    fn verify_signing_identity(bundle: &Path, expected_identifier: &str) -> CmdResult<()> {
        let output = Command::new(CODESIGN)
            .args(["-dv", "--verbose=4"])
            .arg(bundle)
            .output()
            .map_err(|error| CommandError::msg(format!("failed to run codesign: {error}")))?;
        // codesign -dv는 stderr로 출력
        let text = String::from_utf8_lossy(&output.stderr);
        let team = parse_codesign_field(&text, "TeamIdentifier");
        if team.as_deref() != Some(EXPECTED_TEAM_ID) {
            return Err(CommandError::msg(format!(
                "signing team mismatch for {}: expected {EXPECTED_TEAM_ID}, found {}",
                bundle.display(),
                team.unwrap_or_else(|| "none".to_string())
            )));
        }
        let identifier = parse_codesign_field(&text, "Identifier");
        if identifier.as_deref() != Some(expected_identifier) {
            return Err(CommandError::msg(format!(
                "signing identifier mismatch for {}: expected {expected_identifier}, found {}",
                bundle.display(),
                identifier.unwrap_or_else(|| "none".to_string())
            )));
        }
        Ok(())
    }

    /// current → backup, staged → current. 두 번째 rename 실패 시 원상 복구
    fn swap_bundles(paths: &InstallPaths) -> CmdResult<()> {
        if paths.backup.exists() {
            if !is_stale_update_leftover(&paths.backup) {
                return Err(CommandError::msg(format!(
                    "unexpected item at {} — remove it and try again",
                    paths.backup.display()
                )));
            }
            std::fs::remove_dir_all(&paths.backup)?;
        }

        std::fs::rename(&paths.current, &paths.backup).map_err(|error| {
            CommandError::msg(format!(
                "failed to move the current app aside ({}): {error}",
                paths.current.display()
            ))
        })?;
        if let Err(error) = std::fs::rename(&paths.staged, &paths.current) {
            let rollback = std::fs::rename(&paths.backup, &paths.current);
            return Err(CommandError::msg(format!(
                "failed to install the new app bundle: {error}{}",
                match rollback {
                    Ok(()) => String::new(),
                    Err(rollback_error) => format!(
                        " (rollback also failed: {rollback_error}; previous app is at {})",
                        paths.backup.display()
                    ),
                }
            )));
        }
        Ok(())
    }

    fn run_checked(command: &mut Command, failure_label: &str) -> CmdResult<()> {
        let output = command
            .output()
            .map_err(|error| CommandError::msg(format!("{failure_label}: {error}")))?;
        if output.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = if stderr.trim().is_empty() {
            stdout
        } else {
            stderr
        };
        Err(CommandError::msg(format!(
            "{failure_label}: {}",
            detail.trim()
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_bundle(root: &Path, name: &str, identifier: &str, version: &str) -> PathBuf {
        let bundle = root.join(name);
        let contents = bundle.join("Contents");
        std::fs::create_dir_all(contents.join("MacOS")).unwrap();
        let mut dict = plist::Dictionary::new();
        dict.insert("CFBundleIdentifier".into(), identifier.into());
        dict.insert("CFBundleShortVersionString".into(), version.into());
        plist::to_file_xml(contents.join("Info.plist"), &plist::Value::Dictionary(dict)).unwrap();
        bundle
    }

    #[test]
    fn asset_candidates_prefer_arch_then_universal() {
        assert_eq!(
            asset_candidates("1.6.2", MacArch::Aarch64),
            vec![
                "DM.NOTE_1.6.2_aarch64.dmg".to_string(),
                "DM.NOTE_1.6.2_universal.dmg".to_string()
            ]
        );
        assert_eq!(
            asset_candidates("1.6.2", MacArch::X64)[0],
            "DM.NOTE_1.6.2_x64.dmg"
        );
    }

    #[test]
    fn codesign_field_parses_team_and_treats_not_set_as_missing() {
        let output = "Executable=/Applications/DM NOTE.app/Contents/MacOS/dm-note\n\
                      Identifier=com.dmnote.desktop\n\
                      TeamIdentifier=R8T46CXVXU\n";
        assert_eq!(
            parse_codesign_field(output, "TeamIdentifier").as_deref(),
            Some("R8T46CXVXU")
        );
        assert_eq!(
            parse_codesign_field(output, "Identifier").as_deref(),
            Some("com.dmnote.desktop")
        );
        assert_eq!(
            parse_codesign_field("TeamIdentifier=not set\n", "TeamIdentifier"),
            None
        );
        assert_eq!(parse_codesign_field(output, "Timestamp"), None);
    }

    #[test]
    fn hdiutil_plist_yields_first_mount_point() {
        let plist = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>system-entities</key>
  <array>
    <dict><key>content-hint</key><string>GUID_partition_scheme</string><key>dev-entry</key><string>/dev/disk4</string></dict>
    <dict><key>content-hint</key><string>Apple_HFS</string><key>dev-entry</key><string>/dev/disk4s2</string>
      <key>mount-point</key><string>/private/tmp/dmnote-update/mnt</string></dict>
  </array>
</dict></plist>"#;
        assert_eq!(
            parse_hdiutil_mount_point(plist.as_bytes()),
            Some(PathBuf::from("/private/tmp/dmnote-update/mnt"))
        );
        assert_eq!(parse_hdiutil_mount_point(b"not a plist"), None);
    }

    #[test]
    fn bundle_version_comparison_normalizes_prefix_and_rejects_mismatch() {
        assert!(bundle_version_matches("1.6.2", "1.6.2"));
        assert!(bundle_version_matches("1.6.2", "v1.6.2"));
        assert!(!bundle_version_matches("1.6.1", "1.6.2"));
        assert!(!bundle_version_matches("garbage", "1.6.2"));
    }

    #[test]
    fn translocation_detected_by_path_component() {
        assert!(is_app_translocated(Path::new(
            "/private/var/folders/ab/T/AppTranslocation/1234-ABCD/d/DM NOTE.app"
        )));
        assert!(!is_app_translocated(Path::new("/Applications/DM NOTE.app")));
    }

    #[test]
    fn install_paths_sit_next_to_current_bundle() {
        let paths = install_paths_for(Path::new("/Applications/DM NOTE.app")).unwrap();
        assert_eq!(paths.parent, PathBuf::from("/Applications"));
        assert_eq!(paths.staged, PathBuf::from("/Applications/DM NOTE.app.new"));
        assert_eq!(paths.backup, PathBuf::from("/Applications/DM NOTE.app.old"));
        assert!(install_paths_for(Path::new("/")).is_err());
    }

    #[test]
    fn bundle_info_reads_identifier_and_version() {
        let dir = tempfile::tempdir().unwrap();
        let bundle = write_bundle(dir.path(), "DM NOTE.app", EXPECTED_BUNDLE_ID, "1.6.2");
        assert_eq!(
            read_bundle_info(&bundle).unwrap(),
            BundleInfo {
                identifier: EXPECTED_BUNDLE_ID.to_string(),
                version: "1.6.2".to_string()
            }
        );
        assert!(read_bundle_info(&dir.path().join("missing.app")).is_err());
    }

    #[test]
    fn finds_first_app_bundle_in_mount_dir() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("Applications")).unwrap();
        std::fs::write(dir.path().join(".VolumeIcon.icns"), b"x").unwrap();
        assert_eq!(find_app_bundle_in(dir.path()), None);
        let bundle = write_bundle(dir.path(), "DM NOTE.app", EXPECTED_BUNDLE_ID, "1.6.2");
        assert_eq!(find_app_bundle_in(dir.path()), Some(bundle));
    }

    #[test]
    fn stale_leftover_requires_suffix_and_our_bundle_id() {
        let dir = tempfile::tempdir().unwrap();
        let ours = write_bundle(dir.path(), "DM NOTE.app.old", EXPECTED_BUNDLE_ID, "1.6.1");
        let staged = write_bundle(dir.path(), "DM NOTE.app.new", EXPECTED_BUNDLE_ID, "1.6.2");
        let foreign = write_bundle(dir.path(), "Other.app.old", "com.example.other", "1.0");
        let live = write_bundle(dir.path(), "DM NOTE.app", EXPECTED_BUNDLE_ID, "1.6.1");
        assert!(is_stale_update_leftover(&ours));
        assert!(is_stale_update_leftover(&staged));
        assert!(!is_stale_update_leftover(&foreign));
        assert!(!is_stale_update_leftover(&live));
        assert!(!is_stale_update_leftover(
            &dir.path().join("DM NOTE.app.old.txt")
        ));
    }
}
