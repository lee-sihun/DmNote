use std::io::Write;

use anyhow::{anyhow, Result};
use serde_json::to_string;

use crate::ipc::{DaemonCommand, HookKeyState, HookMessage, InputDeviceKind};
use crate::models::{ShortcutBinding, ShortcutsState};

fn load_hotkeys_from_env() -> ShortcutsState {
    std::env::var("DMNOTE_HOTKEYS_V1")
        .ok()
        .and_then(|value| serde_json::from_str::<ShortcutsState>(&value).ok())
        .unwrap_or_default()
}

#[cfg(target_os = "windows")]
use crate::{
    ipc::pipe_client_connect,
    keyboard_labels::{
        build_key_labels, should_skip_keyboard_event, IsKeyboardEventInjected, KeyboardEvent,
        KeyboardKey, KeyPress,
    },
};

/// Global hotkey state tracker
#[cfg(target_os = "windows")]
struct HotkeyState {
    ctrl_left: bool,
    ctrl_right: bool,
    shift_left: bool,
    shift_right: bool,
    alt_left: bool,
    alt_right: bool,
    meta_left: bool,
    meta_right: bool,
    toggle_overlay: Option<ParsedHotkey>,
    toggle_overlay_lock: Option<ParsedHotkey>,
    toggle_always_on_top: Option<ParsedHotkey>,
}

#[cfg(target_os = "windows")]
impl HotkeyState {
    fn new(toggle_overlay: ShortcutBinding, toggle_overlay_lock: ShortcutBinding, toggle_always_on_top: ShortcutBinding) -> Self {
        Self {
            ctrl_left: false,
            ctrl_right: false,
            shift_left: false,
            shift_right: false,
            alt_left: false,
            alt_right: false,
            meta_left: false,
            meta_right: false,
            toggle_overlay: ParsedHotkey::from_binding(&toggle_overlay),
            toggle_overlay_lock: ParsedHotkey::from_binding(&toggle_overlay_lock),
            toggle_always_on_top: ParsedHotkey::from_binding(&toggle_always_on_top),
        }
    }

    /// Update modifier state and check for hotkey triggers
    /// Returns Some(command) if a hotkey was triggered
    fn update(&mut self, vk_code: u32, is_down: bool) -> Option<DaemonCommand> {
        // VK codes for modifiers
        const VK_LCONTROL: u32 = 0xA2;
        const VK_RCONTROL: u32 = 0xA3;
        const VK_LSHIFT: u32 = 0xA0;
        const VK_RSHIFT: u32 = 0xA1;
        const VK_LMENU: u32 = 0xA4; // Left Alt
        const VK_RMENU: u32 = 0xA5; // Right Alt
        const VK_LWIN: u32 = 0x5B;
        const VK_RWIN: u32 = 0x5C;

        match vk_code {
            VK_LCONTROL => self.ctrl_left = is_down,
            VK_RCONTROL => self.ctrl_right = is_down,
            VK_LSHIFT => self.shift_left = is_down,
            VK_RSHIFT => self.shift_right = is_down,
            VK_LMENU => self.alt_left = is_down,
            VK_RMENU => self.alt_right = is_down,
            VK_LWIN => self.meta_left = is_down,
            VK_RWIN => self.meta_right = is_down,
            _ => {}
        }

        if !is_down {
            return None;
        }

        let ctrl = self.ctrl_left || self.ctrl_right;
        let shift = self.shift_left || self.shift_right;
        let alt = self.alt_left || self.alt_right;
        let meta = self.meta_left || self.meta_right;

        let matches = |hotkey: &ParsedHotkey| {
            vk_code == hotkey.key_vk
                && ctrl == hotkey.ctrl
                && shift == hotkey.shift
                && alt == hotkey.alt
                && meta == hotkey.meta
        };

        if let Some(hk) = self.toggle_overlay.as_ref() {
            if matches(hk) {
                return Some(DaemonCommand::ToggleOverlay);
            }
        }
        if let Some(hk) = self.toggle_overlay_lock.as_ref() {
            if matches(hk) {
                return Some(DaemonCommand::ToggleOverlayLock);
            }
        }
        if let Some(hk) = self.toggle_always_on_top.as_ref() {
            if matches(hk) {
                return Some(DaemonCommand::ToggleAlwaysOnTop);
            }
        }

        None
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone)]
struct ParsedHotkey {
    key_vk: u32,
    ctrl: bool,
    shift: bool,
    alt: bool,
    meta: bool,
}

#[cfg(target_os = "windows")]
impl ParsedHotkey {
    fn from_binding(binding: &ShortcutBinding) -> Option<Self> {
        let key_vk = vk_from_key_code(&binding.key)?;
        Some(Self {
            key_vk,
            ctrl: binding.ctrl,
            shift: binding.shift,
            alt: binding.alt,
            meta: binding.meta,
        })
    }
}

#[cfg(target_os = "windows")]
fn vk_from_key_code(code: &str) -> Option<u32> {
    // Uses KeyboardEvent.code-style keys (e.g., KeyO, Tab, Digit1).
    if let Some(rest) = code.strip_prefix("Key") {
        if rest.len() == 1 {
            let ch = rest.chars().next()?.to_ascii_uppercase();
            if ('A'..='Z').contains(&ch) {
                return Some(ch as u32);
            }
        }
    }

    if let Some(rest) = code.strip_prefix("Digit") {
        if rest.len() == 1 {
            let ch = rest.chars().next()?;
            if ('0'..='9').contains(&ch) {
                return Some(ch as u32);
            }
        }
    }

    if let Some(rest) = code.strip_prefix("F") {
        if !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()) {
            let n: u32 = rest.parse().ok()?;
            if (1..=24).contains(&n) {
                return Some(0x6F + n);
            }
        }
    }

    match code {
        "Tab" => Some(0x09),
        "Enter" => Some(0x0D),
        "Escape" => Some(0x1B),
        "Space" => Some(0x20),
        "Backspace" => Some(0x08),
        "Insert" => Some(0x2D),
        "Delete" => Some(0x2E),
        "Home" => Some(0x24),
        "End" => Some(0x23),
        "PageUp" => Some(0x21),
        "PageDown" => Some(0x22),
        "ArrowLeft" => Some(0x25),
        "ArrowUp" => Some(0x26),
        "ArrowRight" => Some(0x27),
        "ArrowDown" => Some(0x28),
        "Comma" => Some(0xBC),
        "Period" => Some(0xBE),
        "Slash" => Some(0xBF),
        "Semicolon" => Some(0xBA),
        "Quote" => Some(0xDE),
        "BracketLeft" => Some(0xDB),
        "BracketRight" => Some(0xDD),
        "Backslash" => Some(0xDC),
        "Backquote" => Some(0xC0),
        "Minus" => Some(0xBD),
        "Equal" => Some(0xBB),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
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

#[cfg(target_os = "macos")]
impl MacHotkeyState {
    fn new(toggle_overlay: ShortcutBinding, toggle_overlay_lock: ShortcutBinding, toggle_always_on_top: ShortcutBinding) -> Self {
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

#[cfg(target_os = "macos")]
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

#[cfg(target_os = "macos")]
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

    let numpad_prefixes = ["numpad", "num_pad"];
    for prefix in numpad_prefixes {
        if let Some(rest) = name_lower.strip_prefix(prefix) {
            if rest.len() == 1 && rest.chars().all(|c| c.is_ascii_digit()) {
                labels.push(format!("NUMPAD {}", rest));
                return labels;
            }
            let numpad_label = match rest {
                "add" => Some("NUMPAD PLUS"),
                "subtract" => Some("NUMPAD MINUS"),
                "multiply" => Some("NUMPAD MULTIPLY"),
                "divide" => Some("NUMPAD DIVIDE"),
                "decimal" => Some("NUMPAD DELETE"),
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

#[cfg(target_os = "macos")]
fn mac_key_labels(key: rdev::Key, name_hint: Option<&str>) -> Vec<String> {
    if let Some(name) = name_hint {
        if let Some(labels) = labels_from_name_hint(name) {
            return labels;
        }
    }
    let key_name = format!("{:?}", key);
    labels_from_key_name(&key_name)
}

#[cfg(target_os = "macos")]
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

fn write_message(
    sink: &mut Box<dyn Write + Send>,
    message: &HookMessage,
) -> Result<()> {
    let line = to_string(message)?;
    sink.write_all(line.as_bytes())?;
    sink.write_all(b"\n")?;
    Ok(())
}

fn write_command(
    sink: &mut Box<dyn Write + Send>,
    command: &DaemonCommand,
) -> Result<()> {
    let line = to_string(command)?;
    sink.write_all(line.as_bytes())?;
    sink.write_all(b"\n")?;
    Ok(())
}

pub fn run() -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        return run_raw_input();
    }

    #[cfg(target_os = "macos")]
    {
        return run_macos();
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err(anyhow!("Raw input backend is only available on Windows and macOS"))
    }
}

#[cfg(target_os = "windows")]
fn run_raw_input() -> Result<()> {
    use std::ffi::c_void;
    use std::mem::size_of;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{GetLastError, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Input::{
        GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE,
        RAWINPUTHEADER, RIDEV_INPUTSINK, RIDEV_NOLEGACY, RID_INPUT, RIM_TYPEKEYBOARD, RIM_TYPEMOUSE,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{MapVirtualKeyW, MAPVK_VSC_TO_VK_EX};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassExW,
        TranslateMessage, CS_HREDRAW, CS_VREDRAW, CW_USEDEFAULT, MSG, WNDCLASSEXW, WM_DESTROY,
        WM_INPUT, WM_QUIT, WS_OVERLAPPEDWINDOW, PostQuitMessage, RI_KEY_BREAK, RI_KEY_E0,
    };

    // Try to connect to named pipe; fall back to stdout if unavailable
    let mut sink: Box<dyn Write + Send> = match pipe_client_connect("dmnote_keys_v1") {
        Ok(file) => Box::new(file),
        Err(_) => Box::new(std::io::stdout()),
    };

    // Global hotkey state tracker
    let hotkeys = load_hotkeys_from_env();
    let mut hotkey_state = HotkeyState::new(
        hotkeys.toggle_overlay,
        hotkeys.toggle_overlay_lock,
        hotkeys.toggle_always_on_top,
    );

    // Raw Input mouse button flags (not exposed as constants in windows crate today).
    const RI_MOUSE_LEFT_BUTTON_DOWN: u16 = 0x0001;
    const RI_MOUSE_LEFT_BUTTON_UP: u16 = 0x0002;
    const RI_MOUSE_RIGHT_BUTTON_DOWN: u16 = 0x0004;
    const RI_MOUSE_RIGHT_BUTTON_UP: u16 = 0x0008;
    const RI_MOUSE_MIDDLE_BUTTON_DOWN: u16 = 0x0010;
    const RI_MOUSE_MIDDLE_BUTTON_UP: u16 = 0x0020;
    const RI_MOUSE_BUTTON_4_DOWN: u16 = 0x0040;
    const RI_MOUSE_BUTTON_4_UP: u16 = 0x0080;
    const RI_MOUSE_BUTTON_5_DOWN: u16 = 0x0100;
    const RI_MOUSE_BUTTON_5_UP: u16 = 0x0200;
    // Wheel constants kept for completeness but not used (wheel events disabled).
    const _RI_MOUSE_WHEEL: u16 = 0x0400;
    const _RI_MOUSE_HWHEEL: u16 = 0x0800;

    unsafe extern "system" fn wndproc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_DESTROY => {
                // Signal message loop to quit; keyboard daemon process should exit shortly after.
                PostQuitMessage(0);
                LRESULT(0)
            }
            _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
        }
    }

    unsafe {
        // Register a minimal window class for receiving WM_INPUT.
        let class_name: Vec<u16> = "DmNoteRawInput".encode_utf16().chain(std::iter::once(0)).collect();
        use windows::Win32::System::LibraryLoader::GetModuleHandleW;
        let hinstance = GetModuleHandleW(None)?;

        let wnd_class = WNDCLASSEXW {
            cbSize: size_of::<WNDCLASSEXW>() as u32,
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(wndproc),
            hInstance: hinstance.into(),
            lpszClassName: PCWSTR(class_name.as_ptr()),
            ..Default::default()
        };

        if RegisterClassExW(&wnd_class) == 0 {
            return Err(anyhow!("RegisterClassExW failed: {:?}", GetLastError()));
        }

        let hwnd = CreateWindowExW(
            Default::default(),
            PCWSTR(class_name.as_ptr()),
            PCWSTR(class_name.as_ptr()),
            WS_OVERLAPPEDWINDOW,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            None,
            None,
            Some(hinstance.into()),
            None,
        )?;

        // Register for Raw Input keyboard + mouse events, even when not in focus.
        let devices = [
            RAWINPUTDEVICE {
                usUsagePage: 0x01,
                usUsage: 0x06, // Keyboard
                dwFlags: RIDEV_INPUTSINK | RIDEV_NOLEGACY,
                hwndTarget: hwnd,
            },
            RAWINPUTDEVICE {
                usUsagePage: 0x01,
                usUsage: 0x02, // Mouse
                dwFlags: RIDEV_INPUTSINK,
                hwndTarget: hwnd,
            },
        ];

        RegisterRawInputDevices(&devices, size_of::<RAWINPUTDEVICE>() as u32)
            .map_err(|e| anyhow!("RegisterRawInputDevices failed: {e}"))?;

        // Message loop: process WM_INPUT and translate to HookMessage.
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).into() {
            if msg.message == WM_INPUT {
                // First query required buffer size.
                let mut size: u32 = 0;
                let header_size = size_of::<RAWINPUTHEADER>() as u32;
                let hraw = HRAWINPUT(msg.lParam.0 as *mut c_void);
                let res = GetRawInputData(hraw, RID_INPUT, None, &mut size, header_size);
                if res == u32::MAX || size == 0 {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                    continue;
                }

                let mut buffer: Vec<u8> = Vec::with_capacity(size as usize);
                buffer.set_len(size as usize);

                let hraw = HRAWINPUT(msg.lParam.0 as *mut c_void);
                let res = GetRawInputData(
                    hraw,
                    RID_INPUT,
                    Some(buffer.as_mut_ptr() as *mut c_void),
                    &mut size,
                    header_size,
                );
                if res == u32::MAX {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                    continue;
                }

                let raw: &RAWINPUT = &*(buffer.as_ptr() as *const RAWINPUT);
                match raw.header.dwType {
                    t if t == RIM_TYPEKEYBOARD.0 => {
                        let kbd = raw.data.keyboard;
                        let vkey = kbd.VKey as u32;
                        let scan_code = kbd.MakeCode as u32;
                        let flags = kbd.Flags as u32;

                        let is_e0 = (flags & RI_KEY_E0) != 0;
                        // RI_KEY_E1 is not currently exposed in windows crate constants.
                        const RI_KEY_E1: u32 = 0x0004;
                        let is_e1 = (flags & RI_KEY_E1) != 0;

                        // Prefix scan code for MAPVK_VSC_TO_VK_EX (E0/E1 in high byte).
                        let scan_code_prefixed = if is_e0 {
                            scan_code | 0xE000
                        } else if is_e1 {
                            scan_code | 0xE100
                        } else {
                            scan_code
                        };

                        // Normalize virtual key so that left/right modifiers and others
                        // match expected labels. Prefer scancode-based recovery for fake keys.
                        let mut vk_norm = vkey;
                        if vk_norm == 0 || vk_norm == 0xFF {
                            let mapped = MapVirtualKeyW(scan_code_prefixed, MAPVK_VSC_TO_VK_EX) as u32;
                            if mapped != 0 {
                                vk_norm = mapped;
                            } else {
                                // Fake/incomplete key events can appear as VK 0/255.
                                // Skip unresolved events instead of forcing a wrong key label.
                                let _ = TranslateMessage(&msg);
                                DispatchMessageW(&msg);
                                continue;
                            }
                        }

                        const VK_SHIFT: u32 = 0x10;
                        const VK_CONTROL: u32 = 0x11;
                        const VK_MENU: u32 = 0x12;
                        const VK_LSHIFT: u32 = 0xA0;
                        const VK_RSHIFT: u32 = 0xA1;
                        const VK_LCONTROL: u32 = 0xA2;
                        const VK_RCONTROL: u32 = 0xA3;
                        const VK_LMENU: u32 = 0xA4;
                        const VK_RMENU: u32 = 0xA5;

                        if vk_norm == VK_SHIFT {
                            let mapped = MapVirtualKeyW(scan_code_prefixed, MAPVK_VSC_TO_VK_EX) as u32;
                            match mapped {
                                VK_LSHIFT | VK_RSHIFT => vk_norm = mapped,
                                _ => match scan_code {
                                    42 => vk_norm = VK_LSHIFT,
                                    54 => vk_norm = VK_RSHIFT,
                                    _ => {}
                                },
                            }
                        }

                        if vk_norm == VK_CONTROL {
                            if is_e0 {
                                vk_norm = VK_RCONTROL;
                            } else {
                                vk_norm = VK_LCONTROL;
                            }
                        }

                        if vk_norm == VK_MENU {
                            if is_e0 {
                                vk_norm = VK_RMENU;
                            } else {
                                vk_norm = VK_LMENU;
                            }
                        }

                        let key = Some(KeyboardKey::from(vk_norm));

                        // Map Raw Input flags to KeyPress (down/up),
                        // using RI_KEY_BREAK similar to multiinput.
                        let is_break = (flags & RI_KEY_BREAK) != 0;
                        let pressed = if is_break {
                            KeyPress::Up(false)
                        } else {
                            KeyPress::Down(false)
                        };

                        // Check for global hotkeys (Ctrl+Shift+O for overlay toggle)
                        if let Some(command) = hotkey_state.update(vk_norm, !is_break) {
                            let _ = write_command(&mut sink, &command);
                            // Continue processing the key event normally
                        }

                        // Map Raw Input extended flag to low-level hook-style flags
                        // so that keyboard_labels' numpad/extended logic behaves identically.
                        let mut ll_flags = 0u32;
                        if is_e0 {
                            // LLKHF_EXTENDED == 0x01 in keyboard_labels.rs
                            ll_flags |= 0x01;
                        }

                        let event = KeyboardEvent {
                            pressed,
                            key,
                            vk_code: Some(vk_norm),
                            scan_code: Some(scan_code),
                            flags: Some(ll_flags),
                            is_injected: Some(IsKeyboardEventInjected::NotInjected),
                        };

                        if should_skip_keyboard_event(&event) {
                            let _ = TranslateMessage(&msg);
                            DispatchMessageW(&msg);
                            continue;
                        }

                        let labels = build_key_labels(&event);
                        if labels.is_empty() {
                            let _ = TranslateMessage(&msg);
                            DispatchMessageW(&msg);
                            continue;
                        }

                        let state = match event.pressed {
                            KeyPress::Down(_) => HookKeyState::Down,
                            KeyPress::Up(_) => HookKeyState::Up,
                        };

                        let message = HookMessage {
                            device: InputDeviceKind::Keyboard,
                            labels,
                            state,
                            vk_code: event.vk_code,
                            scan_code: event.scan_code,
                            flags: event.flags,
                        };

                        let _ = write_message(&mut sink, &message);
                    }
                    t if t == RIM_TYPEMOUSE.0 => {
                        let mouse = raw.data.mouse;
                        let button_flags = mouse.Anonymous.Anonymous.usButtonFlags;

                        let mut events: Vec<(String, HookKeyState)> = Vec::new();
                        let mut push = |label: &str, state: HookKeyState| {
                            events.push((label.to_string(), state));
                        };

                        if (button_flags & RI_MOUSE_LEFT_BUTTON_DOWN) != 0 {
                            push("MOUSE1", HookKeyState::Down);
                        }
                        if (button_flags & RI_MOUSE_LEFT_BUTTON_UP) != 0 {
                            push("MOUSE1", HookKeyState::Up);
                        }
                        if (button_flags & RI_MOUSE_RIGHT_BUTTON_DOWN) != 0 {
                            push("MOUSE2", HookKeyState::Down);
                        }
                        if (button_flags & RI_MOUSE_RIGHT_BUTTON_UP) != 0 {
                            push("MOUSE2", HookKeyState::Up);
                        }
                        if (button_flags & RI_MOUSE_MIDDLE_BUTTON_DOWN) != 0 {
                            push("MOUSE3", HookKeyState::Down);
                        }
                        if (button_flags & RI_MOUSE_MIDDLE_BUTTON_UP) != 0 {
                            push("MOUSE3", HookKeyState::Up);
                        }
                        if (button_flags & RI_MOUSE_BUTTON_4_DOWN) != 0 {
                            push("MOUSE4", HookKeyState::Down);
                        }
                        if (button_flags & RI_MOUSE_BUTTON_4_UP) != 0 {
                            push("MOUSE4", HookKeyState::Up);
                        }
                        if (button_flags & RI_MOUSE_BUTTON_5_DOWN) != 0 {
                            push("MOUSE5", HookKeyState::Down);
                        }
                        if (button_flags & RI_MOUSE_BUTTON_5_UP) != 0 {
                            push("MOUSE5", HookKeyState::Up);
                        }

                        for (label, state) in events {
                            let _ = write_message(
                                &mut sink,
                                &HookMessage {
                                    device: InputDeviceKind::Mouse,
                                    labels: vec![label],
                                    state,
                                    vk_code: None,
                                    scan_code: None,
                                    flags: None,
                                },
                            );
                        }
                    }
                    _ => {}
                }
            }

            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);

            if msg.message == WM_QUIT {
                break;
            }
        }
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn run_macos() -> Result<()> {
    // 접근성(Accessibility) 권한을 확인하고, 없으면 부여될 때까지 대기합니다.
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

    // rdev::listen은 접근성 + 입력 모니터링 권한이 모두 필요합니다.
    // 권한 부여 직후 타이밍 이슈로 CGEventTap 생성이 실패할 수 있으므로 재시도합니다.
    let max_retries = 5;
    for attempt in 0..max_retries {
        if attempt > 0 {
            eprintln!("rdev::listen 재시도 ({}/{}), 2초 후 시도...", attempt + 1, max_retries);
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

/// rdev::listen을 실행하는 내부 함수. 매 재시도마다 새로운 콜백/상태를 생성합니다.
#[cfg(target_os = "macos")]
fn run_macos_listen() -> Result<()> {
    use rdev::{listen, EventType};

    let mut sink: Box<dyn Write + Send> = Box::new(std::io::stdout());
    let hotkeys = load_hotkeys_from_env();
    let mut hotkey_state = MacHotkeyState::new(
        hotkeys.toggle_overlay,
        hotkeys.toggle_overlay_lock,
        hotkeys.toggle_always_on_top,
    );

    let callback = move |event: rdev::Event| {
        match event.event_type {
            EventType::KeyPress(key) => {
                let key_name = format!("{:?}", key).to_ascii_lowercase();
                if let Some(command) = hotkey_state.update(&key_name, true) {
                    let _ = write_command(&mut sink, &command);
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
                let _ = write_message(&mut sink, &message);
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
                let _ = write_message(&mut sink, &message);
            }
            EventType::ButtonPress(button) => {
                if let Some(label) = mac_mouse_label(button) {
                    let _ = write_message(
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
                    let _ = write_message(
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
        }
    };

    listen(callback).map_err(|err| anyhow!("macOS input listener failed: {err:?}"))?;
    Ok(())
}

/// macOS 접근성 권한(AXIsProcessTrusted)을 확인합니다.
/// 프롬프트 없이 현재 상태만 확인하므로, 데몬 프로세스에서 폴링용으로 안전하게 사용할 수 있습니다.
#[cfg(target_os = "macos")]
fn check_accessibility_permission() -> bool {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }
    unsafe { AXIsProcessTrusted() }
}


