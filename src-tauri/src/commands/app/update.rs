//! 자동 업데이트 진입점 — 플랫폼 공통 검증·다운로드·진행 이벤트
//! 플랫폼별 설치 로직: update_windows.rs(exe 교체), update_macos.rs(DMG 번들 교체)

use std::io::{Read, Write};
use std::path::Path;
use std::time::Duration;

use tauri::{AppHandle, Emitter, WebviewWindow};

use crate::errors::{CmdResult, CommandError};

pub const REPO_OWNER: &str = "DmNote-App";
pub const REPO_NAME: &str = "DmNote";
pub const UPDATE_PROGRESS_EVENT: &str = "update:progress";

const DOWNLOAD_CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const DOWNLOAD_TOTAL_TIMEOUT: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoUpdateResult {
    pub previous_version: String,
    pub updated_to: String,
    pub download_url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdatePhase {
    Downloading,
    Verifying,
    Installing,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgressEvent {
    pub phase: UpdatePhase,
    pub percent: Option<u8>,
}

/// 태그 검증 결과 — 현재 버전보다 새로운 semver만 통과
pub struct UpdateTarget {
    pub tag: String,
    pub previous_version: String,
    pub target_version: semver::Version,
}

#[tauri::command]
pub async fn app_auto_update(
    app: AppHandle,
    window: WebviewWindow,
    tag: String,
) -> CmdResult<AutoUpdateResult> {
    if window.label() != "main" {
        return Err(CommandError::msg(
            "automatic update is only available in the main window",
        ));
    }

    // 다운로드·파일 교체는 블로킹 I/O — IPC 스레드를 막지 않도록 blocking 풀에서 실행
    tauri::async_runtime::spawn_blocking(move || run_auto_update(app, &tag))
        .await
        .map_err(|error| CommandError::msg(format!("auto update task failed: {error}")))?
}

fn run_auto_update(app: AppHandle, tag: &str) -> CmdResult<AutoUpdateResult> {
    #[cfg(target_os = "windows")]
    {
        super::update_windows::run(app, tag)
    }

    #[cfg(target_os = "macos")]
    {
        super::update_macos::run(app, tag)
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (app, tag);
        Err(CommandError::msg(
            "auto update is not supported on this platform",
        ))
    }
}

pub fn emit_update_progress(app: &AppHandle, phase: UpdatePhase, percent: Option<u8>) {
    if let Err(error) = app.emit(
        UPDATE_PROGRESS_EVENT,
        UpdateProgressEvent { phase, percent },
    ) {
        log::warn!("[Updater] failed to emit progress event: {error}");
    }
}

pub fn validate_update_target(app: &AppHandle, tag: &str) -> CmdResult<UpdateTarget> {
    let trimmed_tag = tag.trim();
    if trimmed_tag.is_empty() {
        return Err(CommandError::msg("update tag is empty"));
    }
    if !is_safe_tag(trimmed_tag) {
        return Err(CommandError::msg(
            "update tag contains unsupported characters",
        ));
    }

    let previous_version = app.package_info().version.to_string();
    let current_version = parse_semver_version(&previous_version)?;
    let target_version = parse_semver_version(trimmed_tag)?;
    if target_version <= current_version {
        return Err(CommandError::msg(format!(
            "target version ({target_version}) must be newer than current version ({current_version})"
        )));
    }

    Ok(UpdateTarget {
        tag: trimmed_tag.to_string(),
        previous_version,
        target_version,
    })
}

pub fn asset_download_url(tag: &str, asset_name: &str) -> String {
    format!("https://github.com/{REPO_OWNER}/{REPO_NAME}/releases/download/{tag}/{asset_name}")
}

pub fn build_download_client() -> CmdResult<reqwest::blocking::Client> {
    // 유니버설 DMG(13MB+)를 느린 회선에서도 받을 수 있게 전체 타임아웃은 넉넉히
    reqwest::blocking::Client::builder()
        .user_agent("dm-note-auto-updater")
        .connect_timeout(DOWNLOAD_CONNECT_TIMEOUT)
        .timeout(DOWNLOAD_TOTAL_TIMEOUT)
        .build()
        .map_err(|err| CommandError::msg(format!("failed to initialize downloader: {err}")))
}

pub enum DownloadError {
    /// 자산이 없음 — 다음 후보로 폴백 가능
    NotFound,
    Other(CommandError),
}

impl From<DownloadError> for CommandError {
    fn from(error: DownloadError) -> Self {
        match error {
            DownloadError::NotFound => CommandError::msg("update asset not found"),
            DownloadError::Other(inner) => inner,
        }
    }
}

fn send_download_request(
    client: &reqwest::blocking::Client,
    url: &str,
    asset_label: &str,
) -> Result<reqwest::blocking::Response, DownloadError> {
    let response = client.get(url).send().map_err(|error| {
        DownloadError::Other(CommandError::msg(format!(
            "failed to download {asset_label}: {error}"
        )))
    })?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(DownloadError::NotFound);
    }
    response.error_for_status().map_err(|error| {
        DownloadError::Other(CommandError::msg(format!(
            "failed to download {asset_label}: {error}"
        )))
    })
}

fn stream_download(
    reader: &mut impl Read,
    writer: &mut impl Write,
    total: Option<u64>,
    asset_label: &str,
    mut on_progress: impl FnMut(Option<u8>),
) -> Result<u64, DownloadError> {
    let mut buffer = [0u8; 64 * 1024];
    let mut received: u64 = 0;
    let initial_percent = total.map(|_| 0);
    let mut last_percent = initial_percent;
    on_progress(initial_percent);

    loop {
        let read = reader.read(&mut buffer).map_err(|error| {
            DownloadError::Other(CommandError::msg(format!(
                "failed to read downloaded {asset_label}: {error}"
            )))
        })?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read]).map_err(|error| {
            DownloadError::Other(CommandError::msg(format!(
                "failed to write downloaded {asset_label}: {error}"
            )))
        })?;
        received += read as u64;
        let percent = download_percent(received, total);
        if percent.is_some() && percent != last_percent {
            last_percent = percent;
            on_progress(percent);
        }
    }

    if received == 0 {
        return Err(DownloadError::Other(CommandError::msg(format!(
            "downloaded {asset_label} file is empty"
        ))));
    }
    if let Some(expected) = total {
        if received != expected {
            return Err(DownloadError::Other(CommandError::msg(format!(
                "downloaded {asset_label} length mismatch: expected {expected} bytes, received {received}"
            ))));
        }
    }

    Ok(received)
}

/// 자산을 메모리로 다운로드 (소형 자산용 - 서명)
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn download_asset(
    client: &reqwest::blocking::Client,
    url: &str,
    asset_label: &str,
) -> CmdResult<Vec<u8>> {
    download_asset_with_progress(client, url, asset_label, |_| {})
}

/// 자산을 메모리로 스트리밍 다운로드 - 진행률(%)을 콜백으로 전달
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn download_asset_with_progress(
    client: &reqwest::blocking::Client,
    url: &str,
    asset_label: &str,
    on_progress: impl FnMut(Option<u8>),
) -> CmdResult<Vec<u8>> {
    let mut response = send_download_request(client, url, asset_label)?;
    let total = response.content_length();
    let mut bytes = Vec::new();
    stream_download(&mut response, &mut bytes, total, asset_label, on_progress)?;
    Ok(bytes)
}

/// 자산을 파일로 스트리밍 다운로드 - 진행률(%)을 콜백으로 전달, 404는 NotFound로 구분 (macOS DMG)
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn download_asset_to_file(
    client: &reqwest::blocking::Client,
    url: &str,
    dest: &Path,
    asset_label: &str,
    on_progress: impl FnMut(Option<u8>),
) -> Result<(), DownloadError> {
    let mut response = send_download_request(client, url, asset_label)?;
    let total = response.content_length();
    let mut file = std::fs::File::create(dest).map_err(|error| {
        DownloadError::Other(CommandError::msg(format!(
            "failed to create download file: {error}"
        )))
    })?;
    stream_download(&mut response, &mut file, total, asset_label, on_progress)?;
    Ok(())
}

pub fn download_percent(received: u64, total: Option<u64>) -> Option<u8> {
    let total = total.filter(|total| *total > 0)?;
    Some((received.saturating_mul(100) / total).min(100) as u8)
}

pub fn parse_semver_version(raw: &str) -> CmdResult<semver::Version> {
    let normalized = raw.trim().trim_start_matches(['v', 'V']);
    semver::Version::parse(normalized)
        .map_err(|err| CommandError::msg(format!("invalid version string '{raw}': {err}")))
}

pub fn is_safe_tag(tag: &str) -> bool {
    tag.chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | '+'))
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::{
        asset_download_url, download_percent, is_safe_tag, parse_semver_version, stream_download,
        DownloadError,
    };

    #[test]
    fn safe_tag_accepts_release_tags_and_rejects_path_tricks() {
        assert!(is_safe_tag("1.6.2"));
        assert!(is_safe_tag("v1.6.2-beta.1+build"));
        assert!(!is_safe_tag("1.6.2/../x"));
        assert!(!is_safe_tag("1.6.2 "));
    }

    #[test]
    fn semver_parse_strips_v_prefix() {
        assert_eq!(parse_semver_version("v1.6.2").unwrap().to_string(), "1.6.2");
        assert!(parse_semver_version("latest").is_err());
    }

    #[test]
    fn download_url_points_at_release_asset() {
        assert_eq!(
            asset_download_url("1.6.2", "DM.NOTE_1.6.2_universal.dmg"),
            "https://github.com/DmNote-App/DmNote/releases/download/1.6.2/DM.NOTE_1.6.2_universal.dmg"
        );
    }

    #[test]
    fn download_percent_handles_unknown_and_zero_totals() {
        assert_eq!(download_percent(0, Some(200)), Some(0));
        assert_eq!(download_percent(50, Some(200)), Some(25));
        assert_eq!(download_percent(199, Some(200)), Some(99));
        assert_eq!(download_percent(300, Some(200)), Some(100));
        assert_eq!(download_percent(10, Some(0)), None);
        assert_eq!(download_percent(10, None), None);
    }

    #[test]
    fn stream_download_reports_unique_monotonic_progress() {
        let payload = vec![7; 10 * 1024 * 1024];
        let mut reader = Cursor::new(&payload);
        let mut output = Vec::new();
        let mut progress = Vec::new();

        let result = stream_download(
            &mut reader,
            &mut output,
            Some(payload.len() as u64),
            "update",
            |percent| progress.push(percent),
        );

        assert_eq!(result.ok(), Some(payload.len() as u64));
        assert_eq!(output, payload);
        assert_eq!(progress.first(), Some(&Some(0)));
        assert_eq!(progress.last(), Some(&Some(100)));
        assert!(progress.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[test]
    fn stream_download_reports_unknown_total_once() {
        let mut reader = Cursor::new(b"update payload");
        let mut output = Vec::new();
        let mut progress = Vec::new();

        let result = stream_download(&mut reader, &mut output, None, "update", |percent| {
            progress.push(percent)
        });

        assert_eq!(result.ok(), Some(14));
        assert_eq!(progress, vec![None]);
    }

    #[test]
    fn stream_download_rejects_short_body() {
        let mut reader = Cursor::new(b"short");
        let mut output = Vec::new();
        let error = stream_download(&mut reader, &mut output, Some(10), "update", |_| {});

        match error {
            Err(DownloadError::Other(error)) => assert_eq!(
                error.to_string(),
                "downloaded update length mismatch: expected 10 bytes, received 5"
            ),
            _ => panic!("expected a download length mismatch"),
        }
    }

    #[test]
    fn stream_download_rejects_empty_body() {
        let mut reader = Cursor::new([]);
        let mut output = Vec::new();
        let error = stream_download(&mut reader, &mut output, None, "update", |_| {});

        match error {
            Err(DownloadError::Other(error)) => {
                assert_eq!(error.to_string(), "downloaded update file is empty")
            }
            _ => panic!("expected an empty download error"),
        }
    }
}
