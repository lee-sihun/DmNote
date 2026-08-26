//! Windows 자동 업데이트 — 단일 exe 다운로드 후 self_replace로 제자리 교체

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};

use crate::errors::{CmdResult, CommandError};

const UPDATE_PUBLIC_KEY: &str = "";

#[cfg(target_os = "windows")]
pub fn run(app: tauri::AppHandle, tag: &str) -> CmdResult<super::update::AutoUpdateResult> {
    use super::update::{
        asset_download_url, build_download_client, download_asset, emit_update_progress,
        validate_update_target, AutoUpdateResult, UpdatePhase,
    };

    const ASSET_NAME: &str = "DM.NOTE.exe";
    const SIGNATURE_ASSET_NAME: &str = "DM.NOTE.exe.sig";

    let target = validate_update_target(&app, tag)?;
    let download_url = asset_download_url(&target.tag, ASSET_NAME);
    let client = build_download_client()?;

    emit_update_progress(&app, UpdatePhase::Downloading, None);
    let bytes = download_asset(&client, &download_url, "update")?;
    if bytes.is_empty() {
        return Err(CommandError::msg("downloaded update file is empty"));
    }

    emit_update_progress(&app, UpdatePhase::Verifying, None);
    if UPDATE_PUBLIC_KEY.trim().is_empty() {
        log::warn!(
            "[Updater] signature verification is disabled because the production public key is empty"
        );
    } else {
        let signature_url = asset_download_url(&target.tag, SIGNATURE_ASSET_NAME);
        let signature_bytes = download_asset(&client, &signature_url, "update signature")?;
        let signature_text = std::str::from_utf8(&signature_bytes).map_err(|error| {
            CommandError::msg(format!("downloaded update signature is not UTF-8: {error}"))
        })?;
        verify_update_signature(&bytes, UPDATE_PUBLIC_KEY, signature_text)?;
        log::info!("[Updater] downloaded update signature verified");
    }

    emit_update_progress(&app, UpdatePhase::Installing, None);
    let temp_dir = tempfile::Builder::new()
        .prefix("dmnote-update-")
        .tempdir()?;
    let temp_exe = temp_dir.path().join(ASSET_NAME);
    std::fs::write(&temp_exe, &bytes)?;

    self_replace::self_replace(&temp_exe)?;

    Ok(AutoUpdateResult {
        previous_version: target.previous_version,
        updated_to: target.target_version.to_string(),
        download_url,
    })
}

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

fn decode_tauri_minisign_text(wrapped: &str, label: &str) -> CmdResult<String> {
    let decoded = BASE64_STANDARD
        .decode(wrapped.trim())
        .map_err(|error| CommandError::msg(format!("invalid base64-wrapped {label}: {error}")))?;
    String::from_utf8(decoded)
        .map_err(|error| CommandError::msg(format!("decoded {label} is not UTF-8: {error}")))
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
