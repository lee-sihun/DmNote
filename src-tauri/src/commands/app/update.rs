use tauri::{AppHandle, State, WebviewWindow};

use crate::errors::{CmdResult, CommandError};
use crate::state::AppState;

#[cfg(any(target_os = "windows", test))]
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
#[cfg(any(target_os = "windows", test))]
use minisign_verify::{PublicKey, Signature};

#[cfg(any(target_os = "windows", test))]
const UPDATE_PUBLIC_KEY: &str = "";

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoUpdateResult {
    pub previous_version: String,
    pub updated_to: String,
    pub download_url: String,
}

#[tauri::command]
pub fn app_auto_update(
    app: AppHandle,
    state: State<'_, AppState>,
    window: WebviewWindow,
    tag: String,
) -> CmdResult<AutoUpdateResult> {
    if window.label() != "main" {
        return Err(CommandError::msg(
            "automatic update is only available in the main window",
        ));
    }

    #[cfg(target_os = "windows")]
    {
        app_auto_update_windows(app, &state, &tag)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let _ = state;
        let _ = tag;
        Err(CommandError::msg(
            "auto update is only supported on Windows",
        ))
    }
}

#[cfg(target_os = "windows")]
fn app_auto_update_windows(
    app: AppHandle,
    _state: &AppState,
    tag: &str,
) -> CmdResult<AutoUpdateResult> {
    use std::time::Duration;

    const REPO_OWNER: &str = "lee-sihun";
    const REPO_NAME: &str = "DmNote";
    const ASSET_NAME: &str = "DM.NOTE.exe";
    const SIGNATURE_ASSET_NAME: &str = "DM.NOTE.exe.sig";

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

    let download_url = format!(
        "https://github.com/{REPO_OWNER}/{REPO_NAME}/releases/download/{trimmed_tag}/{ASSET_NAME}"
    );

    let client = reqwest::blocking::Client::builder()
        .user_agent("dm-note-auto-updater")
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|err| CommandError::msg(format!("failed to initialize downloader: {err}")))?;

    let bytes = download_asset(&client, &download_url, "update")?;
    if bytes.is_empty() {
        return Err(CommandError::msg("downloaded update file is empty"));
    }

    if UPDATE_PUBLIC_KEY.trim().is_empty() {
        log::warn!(
            "[Updater] signature verification is disabled because the production public key is empty"
        );
    } else {
        let signature_url = format!(
            "https://github.com/{REPO_OWNER}/{REPO_NAME}/releases/download/{trimmed_tag}/{SIGNATURE_ASSET_NAME}"
        );
        let signature_bytes = download_asset(&client, &signature_url, "update signature")?;
        let signature_text = std::str::from_utf8(&signature_bytes).map_err(|error| {
            CommandError::msg(format!("downloaded update signature is not UTF-8: {error}"))
        })?;
        verify_update_signature(&bytes, UPDATE_PUBLIC_KEY, signature_text)?;
        log::info!("[Updater] downloaded update signature verified");
    }

    let temp_dir = tempfile::Builder::new()
        .prefix("dmnote-update-")
        .tempdir()?;
    let temp_exe = temp_dir.path().join(ASSET_NAME);
    std::fs::write(&temp_exe, &bytes)?;

    self_replace::self_replace(&temp_exe)?;

    Ok(AutoUpdateResult {
        previous_version,
        updated_to: target_version.to_string(),
        download_url,
    })
}

#[cfg(target_os = "windows")]
fn download_asset(
    client: &reqwest::blocking::Client,
    url: &str,
    asset_label: &str,
) -> CmdResult<Vec<u8>> {
    let response = client
        .get(url)
        .send()
        .map_err(|error| CommandError::msg(format!("failed to download {asset_label}: {error}")))?;
    let response = response
        .error_for_status()
        .map_err(|error| CommandError::msg(format!("failed to download {asset_label}: {error}")))?;
    let bytes = response.bytes().map_err(|error| {
        CommandError::msg(format!("failed to read downloaded {asset_label}: {error}"))
    })?;
    Ok(bytes.to_vec())
}

#[cfg(any(target_os = "windows", test))]
fn verify_update_signature(
    update_bytes: &[u8],
    wrapped_public_key: &str,
    wrapped_signature: &str,
) -> CmdResult<()> {
    let public_key_text = decode_tauri_minisign_text(wrapped_public_key, "public key")?;
    let signature_text = decode_tauri_minisign_text(wrapped_signature, "signature")?;
    let public_key = PublicKey::decode(&public_key_text)
        .map_err(|error| CommandError::msg(format!("invalid update public key: {error}")))?;
    let signature = Signature::decode(&signature_text)
        .map_err(|error| CommandError::msg(format!("invalid update signature: {error}")))?;
    public_key
        .verify(update_bytes, &signature, false)
        .map_err(|error| {
            CommandError::msg(format!("update signature verification failed: {error}"))
        })
}

#[cfg(any(target_os = "windows", test))]
fn decode_tauri_minisign_text(wrapped: &str, label: &str) -> CmdResult<String> {
    let decoded = BASE64_STANDARD
        .decode(wrapped.trim())
        .map_err(|error| CommandError::msg(format!("invalid base64-wrapped {label}: {error}")))?;
    String::from_utf8(decoded)
        .map_err(|error| CommandError::msg(format!("decoded {label} is not UTF-8: {error}")))
}

#[cfg(target_os = "windows")]
fn parse_semver_version(raw: &str) -> CmdResult<semver::Version> {
    let normalized = raw.trim().trim_start_matches(['v', 'V']);
    semver::Version::parse(normalized)
        .map_err(|err| CommandError::msg(format!("invalid version string '{raw}': {err}")))
}

#[cfg(target_os = "windows")]
fn is_safe_tag(tag: &str) -> bool {
    tag.chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | '+'))
}

#[cfg(test)]
mod tests {
    use super::{verify_update_signature, UPDATE_PUBLIC_KEY};

    // 테스트 전용 일회성 키로 생성한 픽스처 — 프로덕션 키와 무관
    const TEST_PAYLOAD: &[u8] = b"DM NOTE isolated update signature test fixture\n";
    const TEST_PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDQ0QkI0QkQ0MUVERDNDMzMKUldRelBOMGUxRXU3UlBVUWx2Z21zWmlHWnkwRUsvcy9rOTJHNXhqemRuTjAxS0I3cWduZUNITzIK";
    const TEST_MISMATCH_PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDI2MjU5MzY2NjdDOTJDMzMKUldRekxNbG5acE1sSnZBMmJPZlFFd3VydTg3TGsrUjNBdjVyRFNUSnFFeFlNQjYySzRnd1pqYjQK";
    const TEST_SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRelBOMGUxRXU3UkhkdGprNFZPVTgyQlMvTkF6ZFBmd1h1SzdKbFVIMkhOUlFKUG5tR1dlVndXaWJGR3ZvN2s2QS85NU9UZmNhb0haREwrYWNkc2k0U0tKQ0RvQTBzSUFrPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzgzOTI0NDE2CWZpbGU6dXBkYXRlX3NpZ25hdHVyZV90ZXN0X3BheWxvYWQuYmluCldRa0E4UkRDRU1oZHl1TEZPQnpwUTkxeHR0WnRyUVUrUFU4cWk0dzVjVGZJRVE2WWJkKzE0VzdFamVvQWFDRVJrNm5PQjgzRlVUVG1wVlQvSzdySUNRPT0K";

    #[test]
    fn production_public_key_gate_stays_disabled() {
        assert!(UPDATE_PUBLIC_KEY.is_empty());
    }

    #[test]
    fn update_signature_fixture_verifies() {
        verify_update_signature(TEST_PAYLOAD, TEST_PUBLIC_KEY, TEST_SIGNATURE).unwrap();
    }

    #[test]
    fn update_signature_rejects_tampered_payload() {
        let mut tampered = TEST_PAYLOAD.to_vec();
        tampered[0] ^= 1;

        assert!(verify_update_signature(&tampered, TEST_PUBLIC_KEY, TEST_SIGNATURE).is_err());
    }

    #[test]
    fn update_signature_rejects_mismatched_key() {
        assert!(
            verify_update_signature(TEST_PAYLOAD, TEST_MISMATCH_PUBLIC_KEY, TEST_SIGNATURE)
                .is_err()
        );
    }
}
