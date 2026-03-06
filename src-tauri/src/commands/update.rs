use tauri::AppHandle;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoUpdateResult {
    pub previous_version: String,
    pub updated_to: String,
    pub download_url: String,
}

#[tauri::command]
pub fn app_auto_update(app: AppHandle, tag: String) -> Result<AutoUpdateResult, String> {
    #[cfg(target_os = "windows")]
    {
        return app_auto_update_windows(app, &tag);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let _ = tag;
        Err("auto update is only supported on Windows".to_string())
    }
}

#[cfg(target_os = "windows")]
fn app_auto_update_windows(app: AppHandle, tag: &str) -> Result<AutoUpdateResult, String> {
    use std::time::Duration;

    const REPO_OWNER: &str = "lee-sihun";
    const REPO_NAME: &str = "DmNote";
    const ASSET_NAME: &str = "DM.NOTE.exe";

    let trimmed_tag = tag.trim();
    if trimmed_tag.is_empty() {
        return Err("update tag is empty".to_string());
    }
    if !is_safe_tag(trimmed_tag) {
        return Err("update tag contains unsupported characters".to_string());
    }

    let previous_version = app.package_info().version.to_string();
    let current_version = parse_semver_version(&previous_version)?;
    let target_version = parse_semver_version(trimmed_tag)?;
    if target_version <= current_version {
        return Err(format!(
            "target version ({target_version}) must be newer than current version ({current_version})"
        ));
    }

    let download_url = format!(
        "https://github.com/{REPO_OWNER}/{REPO_NAME}/releases/download/{trimmed_tag}/{ASSET_NAME}"
    );

    let client = reqwest::blocking::Client::builder()
        .user_agent("dm-note-auto-updater")
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|err| format!("failed to initialize downloader: {err}"))?;

    let response = client
        .get(&download_url)
        .send()
        .map_err(|err| format!("failed to download update asset: {err}"))?;
    let response = response
        .error_for_status()
        .map_err(|err| format!("failed to download update asset: {err}"))?;
    let bytes = response
        .bytes()
        .map_err(|err| format!("failed to read downloaded update: {err}"))?;
    if bytes.is_empty() {
        return Err("downloaded update file is empty".to_string());
    }

    let temp_dir = tempfile::Builder::new()
        .prefix("dmnote-update-")
        .tempdir()
        .map_err(|err| format!("failed to create temporary directory: {err}"))?;
    let temp_exe = temp_dir.path().join(ASSET_NAME);
    std::fs::write(&temp_exe, &bytes)
        .map_err(|err| format!("failed to write update file: {err}"))?;

    self_replace::self_replace(&temp_exe)
        .map_err(|err| format!("failed to replace executable: {err}"))?;

    app.request_restart();

    Ok(AutoUpdateResult {
        previous_version,
        updated_to: target_version.to_string(),
        download_url,
    })
}

#[cfg(target_os = "windows")]
fn parse_semver_version(raw: &str) -> Result<semver::Version, String> {
    let normalized = raw.trim().trim_start_matches(['v', 'V']);
    semver::Version::parse(normalized)
        .map_err(|err| format!("invalid version string '{raw}': {err}"))
}

#[cfg(target_os = "windows")]
fn is_safe_tag(tag: &str) -> bool {
    tag.chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | '+'))
}
