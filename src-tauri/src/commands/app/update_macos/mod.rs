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

/// 디렉토리 바로 아래의 `.app` 번들 — 우리 번들 식별자를 우선, 없으면 첫 번째
pub fn find_app_bundle_in(dir: &Path) -> Option<PathBuf> {
    let mut apps: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_dir() && path.extension().is_some_and(|ext| ext == "app"))
        .collect();
    apps.sort();
    apps.iter()
        .find(|app| read_bundle_info(app).is_ok_and(|info| info.identifier == EXPECTED_BUNDLE_ID))
        .cloned()
        .or_else(|| apps.into_iter().next())
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
mod install;

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
    fn prefers_our_bundle_identifier_in_mount_dir() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("Applications")).unwrap();
        std::fs::write(dir.path().join(".VolumeIcon.icns"), b"x").unwrap();
        assert_eq!(find_app_bundle_in(dir.path()), None);
        let bundle = write_bundle(dir.path(), "DM NOTE.app", EXPECTED_BUNDLE_ID, "1.6.2");
        assert_eq!(find_app_bundle_in(dir.path()), Some(bundle.clone()));
        // 정렬상 앞서는 다른 앱이 있어도 우리 식별자 번들을 고른다
        write_bundle(dir.path(), "AAA Other.app", "com.example.other", "1.0");
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

    #[cfg(target_os = "macos")]
    #[test]
    fn atomic_swap_exchanges_directories_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let current = write_bundle(dir.path(), "DM NOTE.app", EXPECTED_BUNDLE_ID, "1.6.1");
        let staged = write_bundle(dir.path(), "DM NOTE.app.new", EXPECTED_BUNDLE_ID, "1.6.2");

        super::install::atomic_swap(&staged, &current).unwrap();

        assert_eq!(read_bundle_info(&current).unwrap().version, "1.6.2");
        assert_eq!(read_bundle_info(&staged).unwrap().version, "1.6.1");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn swap_bundles_leaves_previous_app_as_backup() {
        let dir = tempfile::tempdir().unwrap();
        let current = write_bundle(dir.path(), "DM NOTE.app", EXPECTED_BUNDLE_ID, "1.6.1");
        write_bundle(dir.path(), "DM NOTE.app.new", EXPECTED_BUNDLE_ID, "1.6.2");
        let paths = install_paths_for(&current).unwrap();

        super::install::swap_bundles(&paths).unwrap();

        assert_eq!(read_bundle_info(&paths.current).unwrap().version, "1.6.2");
        assert_eq!(read_bundle_info(&paths.backup).unwrap().version, "1.6.1");
        assert!(!paths.staged.exists());
    }
}
