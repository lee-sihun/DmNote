//! macOS 자동 업데이트 — 릴리즈 DMG 다운로드 → 서명 검증 → 번들 교체

use crate::errors::{CmdResult, CommandError};

#[cfg(target_os = "macos")]
pub fn run(app: tauri::AppHandle, tag: &str) -> CmdResult<super::update::AutoUpdateResult> {
    let _ = (app, tag);
    Err(CommandError::msg(
        "macOS auto update is not implemented yet",
    ))
}
