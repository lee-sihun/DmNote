use std::io::Write;

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
use anyhow::anyhow;
use anyhow::Result;
use serde_json::to_string;

#[cfg(target_os = "windows")]
use crate::ipc::HidAxisMessage;
use crate::ipc::{DaemonCommand, HookMessage};
use crate::models::ShortcutsState;

#[cfg(target_os = "windows")]
mod windows;

// HID 입력 처리 (버튼/축 동적 디코딩)
#[cfg(target_os = "windows")]
mod windows_hid;

#[cfg(target_os = "macos")]
mod macos;

fn load_hotkeys_from_env() -> ShortcutsState {
    std::env::var("DMNOTE_HOTKEYS_V1")
        .ok()
        .and_then(|value| serde_json::from_str::<ShortcutsState>(&value).ok())
        .unwrap_or_default()
}

fn write_message(sink: &mut Box<dyn Write + Send>, message: &HookMessage) -> Result<()> {
    let line = to_string(message)?;
    sink.write_all(line.as_bytes())?;
    sink.write_all(b"\n")?;
    Ok(())
}

fn write_command(sink: &mut Box<dyn Write + Send>, command: &DaemonCommand) -> Result<()> {
    let line = to_string(command)?;
    sink.write_all(line.as_bytes())?;
    sink.write_all(b"\n")?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn write_axis(sink: &mut Box<dyn Write + Send>, message: &HidAxisMessage) -> Result<()> {
    let line = to_string(message)?;
    sink.write_all(line.as_bytes())?;
    sink.write_all(b"\n")?;
    Ok(())
}

pub fn run() -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        windows::run_raw_input()
    }

    #[cfg(target_os = "macos")]
    {
        return macos::run_macos();
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err(anyhow!(
            "Raw input backend is only available on Windows and macOS"
        ))
    }
}
