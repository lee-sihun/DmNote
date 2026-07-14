use std::{
    io::{self, Read, Write},
    thread,
};

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

fn wait_for_parent_disconnect(reader: &mut impl Read) -> io::Result<()> {
    let mut buffer = [0_u8; 1];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => return Ok(()),
            Ok(_) => {}
            Err(err) if err.kind() == io::ErrorKind::Interrupted => {}
            Err(err) => return Err(err),
        }
    }
}

pub fn start_parent_liveness_watch() -> io::Result<()> {
    thread::Builder::new()
        .name("keyboard-parent-watch".into())
        .spawn(|| {
            let stdin = io::stdin();
            let mut stdin = stdin.lock();
            if let Err(err) = wait_for_parent_disconnect(&mut stdin) {
                eprintln!("keyboard parent watch failed: {err}");
            }
            std::process::exit(0);
        })
        .map(|_| ())
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
        macos::run_macos()
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err(anyhow!(
            "Raw input backend is only available on Windows and macOS"
        ))
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::wait_for_parent_disconnect;

    #[test]
    fn parent_watch_returns_after_pipe_eof() {
        let mut reader = Cursor::new(Vec::<u8>::new());
        wait_for_parent_disconnect(&mut reader).unwrap();
    }

    #[test]
    fn parent_watch_ignores_bytes_until_pipe_eof() {
        let mut reader = Cursor::new(b"keepalive".to_vec());
        wait_for_parent_disconnect(&mut reader).unwrap();
        assert_eq!(reader.position(), b"keepalive".len() as u64);
    }
}
