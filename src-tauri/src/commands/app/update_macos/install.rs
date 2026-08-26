//! macOS 자동 업데이트 실행 경로 — 다운로드 → 마운트 → 검증 → 스테이징 → 원자 스왑

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
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

// 동시 실행 방지 — 두 스테이징이 같은 .app.new를 두고 경쟁하면 반쯤 복사된 번들이 설치될 수 있음
static UPDATE_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

struct InProgressGuard;

impl InProgressGuard {
    fn acquire() -> CmdResult<Self> {
        UPDATE_IN_PROGRESS
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| InProgressGuard)
            .map_err(|_| CommandError::msg("an update is already in progress"))
    }
}

impl Drop for InProgressGuard {
    fn drop(&mut self) {
        UPDATE_IN_PROGRESS.store(false, Ordering::Release);
    }
}

pub fn run(app: AppHandle, tag: &str) -> CmdResult<AutoUpdateResult> {
    let _guard = InProgressGuard::acquire()?;
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
    let (dmg_path, download_url) = download_first_available(&app, &target.tag, temp_dir.path())?;

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
    // 스테이징·검증 중 어떤 실패든 부분 사본(.app.new)을 남기지 않음
    if let Err(error) =
        stage_bundle(&mounted_app, &paths.staged).and_then(|()| verify_staged_bundle(&paths.staged))
    {
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

/// staged ↔ current 원자 교환 후 (이제 구버전인) staged → backup.
/// 교환이 원자적이라 설치 경로가 비는 순간이 없음. 미지원 파일시스템이면 2단계 rename으로 폴백
pub(super) fn swap_bundles(paths: &InstallPaths) -> CmdResult<()> {
    if paths.backup.exists() {
        if !is_stale_update_leftover(&paths.backup) {
            return Err(CommandError::msg(format!(
                "unexpected item at {} — remove it and try again",
                paths.backup.display()
            )));
        }
        std::fs::remove_dir_all(&paths.backup)?;
    }

    match atomic_swap(&paths.staged, &paths.current) {
        Ok(()) => {
            // 실패해도 설치는 완료 — .app.new 이름의 구버전은 다음 실행 시 정리
            if let Err(error) = std::fs::rename(&paths.staged, &paths.backup) {
                log::warn!(
                    "[Updater] failed to move previous app to {}: {error}",
                    paths.backup.display()
                );
            }
            return Ok(());
        }
        Err(error) if is_swap_unsupported(&error) => {
            log::warn!("[Updater] atomic swap unsupported here ({error}); falling back to rename");
        }
        Err(error) => {
            return Err(CommandError::msg(format!(
                "failed to swap the app bundle into place: {error}"
            )));
        }
    }

    swap_bundles_two_step(paths)
}

/// `renamex_np(RENAME_SWAP)` — 두 경로의 내용을 한 syscall로 교환 (macOS 10.12+, APFS/HFS+)
pub(super) fn atomic_swap(a: &Path, b: &Path) -> std::io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let a_c = CString::new(a.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::other("path contains NUL"))?;
    let b_c = CString::new(b.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::other("path contains NUL"))?;
    // SAFETY: 두 인자 모두 유효한 NUL 종료 C 문자열이며 호출 동안 살아 있음
    let rc = unsafe { libc::renamex_np(a_c.as_ptr(), b_c.as_ptr(), libc::RENAME_SWAP) };
    if rc == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

fn is_swap_unsupported(error: &std::io::Error) -> bool {
    matches!(
        error.raw_os_error(),
        Some(libc::ENOTSUP) | Some(libc::EINVAL) | Some(libc::EXDEV)
    )
}

/// 폴백: current → backup, staged → current. 두 번째 rename 실패 시 원상 복구
fn swap_bundles_two_step(paths: &InstallPaths) -> CmdResult<()> {
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
