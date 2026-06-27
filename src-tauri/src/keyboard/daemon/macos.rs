use std::io::Write;

use anyhow::{anyhow, Result};

use crate::ipc::{DaemonCommand, HookKeyState, HookMessage, InputDeviceKind};
use crate::models::ShortcutBinding;

struct MacHotkeyState {
    ctrl_left: bool,
    ctrl_right: bool,
    shift_left: bool,
    shift_right: bool,
    alt_left: bool,
    alt_right: bool,
    meta_left: bool,
    meta_right: bool,
    toggle_overlay_key: String,
    toggle_overlay: ShortcutBinding,
    toggle_overlay_lock_key: String,
    toggle_overlay_lock: ShortcutBinding,
    toggle_always_on_top_key: String,
    toggle_always_on_top: ShortcutBinding,
}

impl MacHotkeyState {
    fn new(
        toggle_overlay: ShortcutBinding,
        toggle_overlay_lock: ShortcutBinding,
        toggle_always_on_top: ShortcutBinding,
    ) -> Self {
        let toggle_overlay_key = toggle_overlay.key.to_ascii_lowercase();
        let toggle_overlay_lock_key = toggle_overlay_lock.key.to_ascii_lowercase();
        let toggle_always_on_top_key = toggle_always_on_top.key.to_ascii_lowercase();
        Self {
            ctrl_left: false,
            ctrl_right: false,
            shift_left: false,
            shift_right: false,
            alt_left: false,
            alt_right: false,
            meta_left: false,
            meta_right: false,
            toggle_overlay_key,
            toggle_overlay,
            toggle_overlay_lock_key,
            toggle_overlay_lock,
            toggle_always_on_top_key,
            toggle_always_on_top,
        }
    }

    fn update(&mut self, key_name: &str, is_down: bool) -> Option<DaemonCommand> {
        match key_name {
            "controlleft" | "controlright" => {
                if key_name == "controlleft" {
                    self.ctrl_left = is_down;
                } else {
                    self.ctrl_right = is_down;
                }
            }
            "shiftleft" | "shiftright" => {
                if key_name == "shiftleft" {
                    self.shift_left = is_down;
                } else {
                    self.shift_right = is_down;
                }
            }
            "alt" | "altleft" | "altright" | "option" => {
                if key_name == "altright" {
                    self.alt_right = is_down;
                } else {
                    self.alt_left = is_down;
                }
            }
            "metaleft" | "metaright" | "command" => {
                if key_name == "metaright" {
                    self.meta_right = is_down;
                } else {
                    self.meta_left = is_down;
                }
            }
            _ => {}
        }

        if !is_down {
            return None;
        }

        let ctrl = self.ctrl_left || self.ctrl_right;
        let shift = self.shift_left || self.shift_right;
        let alt = self.alt_left || self.alt_right;
        let meta = self.meta_left || self.meta_right;

        let matches = |key: &str, binding: &ShortcutBinding| {
            !key.trim().is_empty()
                && key_name == key
                && ctrl == binding.ctrl
                && shift == binding.shift
                && alt == binding.alt
                && meta == binding.meta
        };

        if matches(&self.toggle_overlay_key, &self.toggle_overlay) {
            return Some(DaemonCommand::ToggleOverlay);
        }
        if matches(&self.toggle_overlay_lock_key, &self.toggle_overlay_lock) {
            return Some(DaemonCommand::ToggleOverlayLock);
        }
        if matches(&self.toggle_always_on_top_key, &self.toggle_always_on_top) {
            return Some(DaemonCommand::ToggleAlwaysOnTop);
        }

        None
    }
}

fn labels_from_name_hint(name: &str) -> Option<Vec<String>> {
    if name.chars().count() != 1 {
        return None;
    }
    let ch = name.chars().next()?;
    let label = match ch {
        'a'..='z' => ch.to_ascii_uppercase().to_string(),
        'A'..='Z' => ch.to_string(),
        '0'..='9' => ch.to_string(),
        ' ' => "SPACE".to_string(),
        ',' => "COMMA".to_string(),
        '.' => "DOT".to_string(),
        '/' => "FORWARD SLASH".to_string(),
        '-' => "MINUS".to_string(),
        '=' => "EQUALS".to_string(),
        '[' => "SQUARE BRACKET OPEN".to_string(),
        ']' => "SQUARE BRACKET CLOSE".to_string(),
        ';' => "SEMICOLON".to_string(),
        '\'' => "QUOTE".to_string(),
        '`' => "SECTION".to_string(),
        '\\' => "BACKSLASH".to_string(),
        _ => return None,
    };
    Some(vec![label])
}

fn labels_from_key_name(name: &str) -> Vec<String> {
    let name_lower = name.to_ascii_lowercase();
    let mut labels = match name_lower.as_str() {
        "shiftleft" => vec!["LEFT SHIFT".to_string()],
        "shiftright" => vec!["RIGHT SHIFT".to_string()],
        "controlleft" => vec!["LEFT CTRL".to_string()],
        "controlright" => vec!["25".to_string(), "RIGHT CTRL".to_string()],
        "alt" | "altleft" => vec!["LEFT ALT".to_string()],
        "altgr" | "altright" => vec!["21".to_string(), "RIGHT ALT".to_string()],
        "metaleft" => vec!["91".to_string()],
        "metaright" => vec!["92".to_string()],
        "space" => vec!["SPACE".to_string()],
        "return" | "enter" => vec!["RETURN".to_string()],
        "tab" => vec!["TAB".to_string()],
        "backspace" | "back_space" => vec!["BACKSPACE".to_string()],
        "capslock" | "caps_lock" => vec!["CAPS LOCK".to_string()],
        "escape" => vec!["ESCAPE".to_string()],
        "uparrow" | "arrowup" => vec!["UP ARROW".to_string()],
        "downarrow" | "arrowdown" => vec!["DOWN ARROW".to_string()],
        "leftarrow" | "arrowleft" => vec!["LEFT ARROW".to_string()],
        "rightarrow" | "arrowright" => vec!["RIGHT ARROW".to_string()],
        "home" => vec!["HOME".to_string()],
        "end" => vec!["END".to_string()],
        "pageup" | "page_up" => vec!["PAGE UP".to_string()],
        "pagedown" | "page_down" => vec!["PAGE DOWN".to_string()],
        "insert" => vec!["INS".to_string()],
        "delete" => vec!["DELETE".to_string()],
        "printscreen" | "print_screen" => vec!["PRINT SCREEN".to_string()],
        "scrolllock" | "scroll_lock" => vec!["SCROLL LOCK".to_string()],
        "pause" => vec!["19".to_string()],
        "contextmenu" | "context_menu" => vec!["CONTEXT MENU".to_string()],
        "fn" => vec!["FN".to_string()],
        "numlock" | "num_lock" => vec!["NUM LOCK".to_string()],
        "minus" => vec!["MINUS".to_string()],
        "equal" | "equals" => vec!["EQUALS".to_string()],
        "bracketleft" | "leftbracket" | "bracket_left" => {
            vec!["SQUARE BRACKET OPEN".to_string()]
        }
        "bracketright" | "rightbracket" | "bracket_right" => {
            vec!["SQUARE BRACKET CLOSE".to_string()]
        }
        "semicolon" => vec!["SEMICOLON".to_string()],
        "quote" | "apostrophe" => vec!["QUOTE".to_string()],
        "backquote" | "back_quote" | "grave" => vec!["SECTION".to_string()],
        "backslash" | "back_slash" => vec!["BACKSLASH".to_string()],
        "comma" => vec!["COMMA".to_string()],
        "dot" | "period" => vec!["DOT".to_string()],
        "slash" => vec!["FORWARD SLASH".to_string()],
        _ => Vec::new(),
    };

    if !labels.is_empty() {
        return labels;
    }

    if let Some(rest) = name_lower.strip_prefix("key") {
        if rest.len() == 1 && rest.chars().all(|c| c.is_ascii_alphabetic()) {
            labels.push(rest.to_ascii_uppercase());
            return labels;
        }
    }

    if let Some(rest) = name_lower.strip_prefix("num") {
        if rest.len() == 1 && rest.chars().all(|c| c.is_ascii_digit()) {
            labels.push(rest.to_string());
            return labels;
        }
    }

    if let Some(rest) = name_lower.strip_prefix("f") {
        if !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()) {
            labels.push(format!("F{}", rest));
            return labels;
        }
    }

    let numpad_prefixes = ["numpad", "num_pad", "kp"];
    for prefix in numpad_prefixes {
        if let Some(rest) = name_lower.strip_prefix(prefix) {
            if rest.len() == 1 && rest.chars().all(|c| c.is_ascii_digit()) {
                labels.push(format!("NUMPAD {}", rest));
                return labels;
            }
            let numpad_label = match rest {
                "add" | "plus" => Some("NUMPAD PLUS"),
                "subtract" | "minus" => Some("NUMPAD MINUS"),
                "multiply" => Some("NUMPAD MULTIPLY"),
                "divide" => Some("NUMPAD DIVIDE"),
                "decimal" | "delete" => Some("NUMPAD DELETE"),
                "enter" | "return" => Some("NUMPAD RETURN"),
                _ => None,
            };
            if let Some(value) = numpad_label {
                labels.push(value.to_string());
                return labels;
            }
        }
    }

    labels
}

fn mac_virtual_keycode_labels(key: rdev::Key) -> Option<Vec<String>> {
    let rdev::Key::Unknown(code) = key else {
        return None;
    };

    let label = match code {
        65 => "NUMPAD DELETE",
        67 => "NUMPAD MULTIPLY",
        69 => "NUMPAD PLUS",
        71 => "NUM LOCK",
        75 => "NUMPAD DIVIDE",
        76 => "NUMPAD RETURN",
        78 => "NUMPAD MINUS",
        82 => "NUMPAD 0",
        83 => "NUMPAD 1",
        84 => "NUMPAD 2",
        85 => "NUMPAD 3",
        86 => "NUMPAD 4",
        87 => "NUMPAD 5",
        88 => "NUMPAD 6",
        89 => "NUMPAD 7",
        91 => "NUMPAD 8",
        92 => "NUMPAD 9",
        114 => "INS",
        115 => "HOME",
        116 => "PAGE UP",
        117 => "DELETE",
        119 => "END",
        121 => "PAGE DOWN",
        _ => return None,
    };

    Some(vec![label.to_string()])
}

fn mac_key_labels(key: rdev::Key, name_hint: Option<&str>) -> Vec<String> {
    if let Some(labels) = mac_virtual_keycode_labels(key) {
        return labels;
    }
    if let Some(name) = name_hint {
        if let Some(labels) = labels_from_name_hint(name) {
            return labels;
        }
    }
    let key_name = format!("{:?}", key);
    labels_from_key_name(&key_name)
}

fn mac_mouse_label(button: rdev::Button) -> Option<String> {
    use rdev::Button::*;
    match button {
        Left => Some("MOUSE1".to_string()),
        Right => Some("MOUSE2".to_string()),
        Middle => Some("MOUSE3".to_string()),
        Unknown(4) => Some("MOUSE4".to_string()),
        Unknown(5) => Some("MOUSE5".to_string()),
        _ => None,
    }
}

pub(super) fn run_macos() -> Result<()> {
    // 접근성(Accessibility) 권한 확인 — 미부여 시 부여 대기
    if !check_accessibility_permission() {
        eprintln!("macOS 접근성 권한이 없습니다. 시스템 설정에서 허용해 주세요.");
        eprintln!("접근성 권한 대기 중...");
        loop {
            std::thread::sleep(std::time::Duration::from_secs(2));
            if check_accessibility_permission() {
                eprintln!("접근성 권한이 허용되었습니다.");
                break;
            }
        }
    }

    // rdev::listen — 접근성 + 입력 모니터링 권한 필수
    // 권한 부여 직후 CGEventTap 생성 실패 가능 — 재시도 처리
    let max_retries = 5;
    for attempt in 0..max_retries {
        if attempt > 0 {
            eprintln!(
                "rdev::listen 재시도 ({}/{}), 2초 후 시도...",
                attempt + 1,
                max_retries
            );
            std::thread::sleep(std::time::Duration::from_secs(2));
        }

        let result = run_macos_listen();
        match result {
            Ok(_) => return Ok(()),
            Err(err) => {
                eprintln!("rdev::listen 실패: {err}");
                if attempt == max_retries - 1 {
                    return Err(err);
                }
            }
        }
    }
    unreachable!()
}

/// rdev::listen 실행 내부 함수. 매 재시도마다 새로운 콜백/상태 생성
fn run_macos_listen() -> Result<()> {
    use rdev::{listen, EventType};

    let mut sink: Box<dyn Write + Send> = Box::new(std::io::stdout());
    let hotkeys = super::load_hotkeys_from_env();
    let mut hotkey_state = MacHotkeyState::new(
        hotkeys.toggle_overlay,
        hotkeys.toggle_overlay_lock,
        hotkeys.toggle_always_on_top,
    );

    let callback = move |event: rdev::Event| match event.event_type {
        EventType::KeyPress(key) => {
            let key_name = format!("{:?}", key).to_ascii_lowercase();
            if let Some(command) = hotkey_state.update(&key_name, true) {
                let _ = super::write_command(&mut sink, &command);
            }

            let labels = mac_key_labels(key, event.name.as_deref());
            if labels.is_empty() {
                return;
            }

            let message = HookMessage {
                device: InputDeviceKind::Keyboard,
                labels,
                state: HookKeyState::Down,
                vk_code: None,
                scan_code: None,
                flags: None,
            };
            let _ = super::write_message(&mut sink, &message);
        }
        EventType::KeyRelease(key) => {
            let key_name = format!("{:?}", key).to_ascii_lowercase();
            let _ = hotkey_state.update(&key_name, false);

            let labels = mac_key_labels(key, event.name.as_deref());
            if labels.is_empty() {
                return;
            }

            let message = HookMessage {
                device: InputDeviceKind::Keyboard,
                labels,
                state: HookKeyState::Up,
                vk_code: None,
                scan_code: None,
                flags: None,
            };
            let _ = super::write_message(&mut sink, &message);
        }
        EventType::ButtonPress(button) => {
            if let Some(label) = mac_mouse_label(button) {
                let _ = super::write_message(
                    &mut sink,
                    &HookMessage {
                        device: InputDeviceKind::Mouse,
                        labels: vec![label],
                        state: HookKeyState::Down,
                        vk_code: None,
                        scan_code: None,
                        flags: None,
                    },
                );
            }
        }
        EventType::ButtonRelease(button) => {
            if let Some(label) = mac_mouse_label(button) {
                let _ = super::write_message(
                    &mut sink,
                    &HookMessage {
                        device: InputDeviceKind::Mouse,
                        labels: vec![label],
                        state: HookKeyState::Up,
                        vk_code: None,
                        scan_code: None,
                        flags: None,
                    },
                );
            }
        }
        _ => {}
    };

    listen(callback).map_err(|err| anyhow!("macOS input listener failed: {err:?}"))?;
    Ok(())
}

/// macOS 접근성 권한(AXIsProcessTrusted) 확인
/// 프롬프트 없이 현재 상태만 확인하므로, 데몬 프로세스에서 폴링용으로 안전하게 사용 가능
fn check_accessibility_permission() -> bool {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }
    unsafe { AXIsProcessTrusted() }
}
