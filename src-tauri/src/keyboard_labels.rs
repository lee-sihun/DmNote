const LLKHF_EXTENDED: u32 = 0x01;

/// Keyboard event injected status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum IsKeyboardEventInjected {
    Injected,
    NotInjected,
}

/// Key press state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyPress {
    Down(bool),
    Up(bool),
}

/// Keyboard event data
#[derive(Debug, Clone)]
pub struct KeyboardEvent {
    pub pressed: KeyPress,
    pub key: Option<KeyboardKey>,
    pub vk_code: Option<u32>,
    pub scan_code: Option<u32>,
    pub flags: Option<u32>,
    pub is_injected: Option<IsKeyboardEventInjected>,
}

/// Keyboard key enumeration
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum KeyboardKey {
    A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X, Y, Z,
    Number0, Number1, Number2, Number3, Number4, Number5, Number6, Number7, Number8, Number9,
    LeftAlt, RightAlt, LeftShift, RightShift, LeftControl, RightControl,
    BackSpace, Tab, Enter, Escape, Space,
    PageUp, PageDown, Home,
    ArrowLeft, ArrowUp, ArrowRight, ArrowDown,
    Print, PrintScreen, Insert, Delete,
    LeftWindows, RightWindows,
    Comma, Period, Slash, SemiColon, Apostrophe,
    LeftBrace, BackwardSlash, RightBrace, Grave,
    Add, Subtract, Decimal, Divide, Multiply, Separator,
    F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F11, F12,
    F13, F14, F15, F16, F17, F18, F19, F20, F21, F22, F23, F24,
    NumLock, ScrollLock, CapsLock,
    Numpad0, Numpad1, Numpad2, Numpad3, Numpad4, Numpad5, Numpad6, Numpad7, Numpad8, Numpad9,
    Other(u32),
    InvalidKeyCodeReceived,
}

impl From<u32> for KeyboardKey {
    fn from(vk: u32) -> Self {
        match vk {
            0x41 => KeyboardKey::A, 0x42 => KeyboardKey::B, 0x43 => KeyboardKey::C, 0x44 => KeyboardKey::D,
            0x45 => KeyboardKey::E, 0x46 => KeyboardKey::F, 0x47 => KeyboardKey::G, 0x48 => KeyboardKey::H,
            0x49 => KeyboardKey::I, 0x4A => KeyboardKey::J, 0x4B => KeyboardKey::K, 0x4C => KeyboardKey::L,
            0x4D => KeyboardKey::M, 0x4E => KeyboardKey::N, 0x4F => KeyboardKey::O, 0x50 => KeyboardKey::P,
            0x51 => KeyboardKey::Q, 0x52 => KeyboardKey::R, 0x53 => KeyboardKey::S, 0x54 => KeyboardKey::T,
            0x55 => KeyboardKey::U, 0x56 => KeyboardKey::V, 0x57 => KeyboardKey::W, 0x58 => KeyboardKey::X,
            0x59 => KeyboardKey::Y, 0x5A => KeyboardKey::Z,
            0x30 => KeyboardKey::Number0, 0x31 => KeyboardKey::Number1, 0x32 => KeyboardKey::Number2,
            0x33 => KeyboardKey::Number3, 0x34 => KeyboardKey::Number4, 0x35 => KeyboardKey::Number5,
            0x36 => KeyboardKey::Number6, 0x37 => KeyboardKey::Number7, 0x38 => KeyboardKey::Number8,
            0x39 => KeyboardKey::Number9,
            0xA4 => KeyboardKey::LeftAlt, 0xA5 => KeyboardKey::RightAlt,
            0xA0 => KeyboardKey::LeftShift, 0xA1 => KeyboardKey::RightShift,
            0xA2 => KeyboardKey::LeftControl, 0xA3 => KeyboardKey::RightControl,
            0x08 => KeyboardKey::BackSpace, 0x09 => KeyboardKey::Tab,
            0x0D => KeyboardKey::Enter, 0x1B => KeyboardKey::Escape, 0x20 => KeyboardKey::Space,
            0x21 => KeyboardKey::PageUp, 0x22 => KeyboardKey::PageDown, 0x24 => KeyboardKey::Home,
            0x25 => KeyboardKey::ArrowLeft, 0x26 => KeyboardKey::ArrowUp,
            0x27 => KeyboardKey::ArrowRight, 0x28 => KeyboardKey::ArrowDown,
            0x2A => KeyboardKey::Print, 0x2C => KeyboardKey::PrintScreen,
            0x2D => KeyboardKey::Insert, 0x2E => KeyboardKey::Delete,
            0x5B => KeyboardKey::LeftWindows, 0x5C => KeyboardKey::RightWindows,
            0xBC => KeyboardKey::Comma, 0xBE => KeyboardKey::Period,
            0xBF => KeyboardKey::Slash, 0xBA => KeyboardKey::SemiColon, 0xDE => KeyboardKey::Apostrophe,
            0xDB => KeyboardKey::LeftBrace, 0xDC => KeyboardKey::BackwardSlash,
            0xDD => KeyboardKey::RightBrace, 0xC0 => KeyboardKey::Grave,
            0x6B => KeyboardKey::Add, 0x6D => KeyboardKey::Subtract,
            0x6E => KeyboardKey::Decimal, 0x6F => KeyboardKey::Divide,
            0x6A => KeyboardKey::Multiply, 0x6C => KeyboardKey::Separator,
            0x70 => KeyboardKey::F1, 0x71 => KeyboardKey::F2, 0x72 => KeyboardKey::F3, 0x73 => KeyboardKey::F4,
            0x74 => KeyboardKey::F5, 0x75 => KeyboardKey::F6, 0x76 => KeyboardKey::F7, 0x77 => KeyboardKey::F8,
            0x78 => KeyboardKey::F9, 0x79 => KeyboardKey::F10, 0x7A => KeyboardKey::F11, 0x7B => KeyboardKey::F12,
            0x7C => KeyboardKey::F13, 0x7D => KeyboardKey::F14, 0x7E => KeyboardKey::F15, 0x7F => KeyboardKey::F16,
            0x80 => KeyboardKey::F17, 0x81 => KeyboardKey::F18, 0x82 => KeyboardKey::F19, 0x83 => KeyboardKey::F20,
            0x84 => KeyboardKey::F21, 0x85 => KeyboardKey::F22, 0x86 => KeyboardKey::F23, 0x87 => KeyboardKey::F24,
            0x90 => KeyboardKey::NumLock, 0x91 => KeyboardKey::ScrollLock, 0x14 => KeyboardKey::CapsLock,
            0x60 => KeyboardKey::Numpad0, 0x61 => KeyboardKey::Numpad1, 0x62 => KeyboardKey::Numpad2,
            0x63 => KeyboardKey::Numpad3, 0x64 => KeyboardKey::Numpad4, 0x65 => KeyboardKey::Numpad5,
            0x66 => KeyboardKey::Numpad6, 0x67 => KeyboardKey::Numpad7, 0x68 => KeyboardKey::Numpad8,
            0x69 => KeyboardKey::Numpad9,
            other => KeyboardKey::Other(other),
        }
    }
}

pub fn build_key_labels(event: &KeyboardEvent) -> Vec<String> {
    let mut labels = Vec::new();

    // Handle Right Alt / Han/Eng key specifically by VK code first
    // VK_RMENU (0xA5/165): Right Alt in US keyboard layout -> map to "21"
    // VK_HANGUL (0x15/21): Han/Eng toggle in Korean IME (same physical key) -> use "21"
    if let Some(vk_code) = event.vk_code {
        if vk_code == 0xA5 || vk_code == 0x15 {
            labels.push("21".to_string());
            labels.push("RIGHT ALT".to_string());
            return labels;
        }
    }

    if let Some(label) = numpad_override_label(event) {
        labels.push(label.to_string());
    } else if let Some(key) = event.key {
        extend_unique(&mut labels, keyboard_key_to_global(key));
    }

    if labels.is_empty() {
        if let Some(vk_code) = event.vk_code {
            labels.push(vk_code.to_string());
        } else if let Some(scan_code) = event.scan_code {
            labels.push(scan_code.to_string());
        }
    }

    labels
}

pub fn should_skip_keyboard_event(event: &KeyboardEvent) -> bool {
    let is_shift = matches!(event.vk_code, Some(0x10) | Some(0xA0) | Some(0xA1))
        || matches!(
            event.key,
            Some(KeyboardKey::LeftShift) | Some(KeyboardKey::RightShift)
        );

    if !is_shift {
        return false;
    }

    if matches!(event.is_injected, Some(IsKeyboardEventInjected::Injected)) {
        return true;
    }

    if matches!(event.scan_code, Some(554)) {
        return true;
    }

    false
}

fn extend_unique(target: &mut Vec<String>, items: Vec<String>) {
    for item in items {
        if !target.iter().any(|existing| existing == &item) {
            target.push(item);
        }
    }
}

fn numpad_override_label(event: &KeyboardEvent) -> Option<&'static str> {
    let scan_code = event.scan_code?;
    let label = match scan_code {
        82 => "NUMPAD 0",
        79 => "NUMPAD 1",
        80 => "NUMPAD 2",
        81 => "NUMPAD 3",
        75 => "NUMPAD 4",
        76 => "NUMPAD 5",
        77 => "NUMPAD 6",
        71 => "NUMPAD 7",
        72 => "NUMPAD 8",
        73 => "NUMPAD 9",
        28 => "NUMPAD RETURN",
        83 => "NUMPAD DELETE",
        _ => return None,
    };

    let flags = event.flags.unwrap_or(0);
    let is_extended = (flags & LLKHF_EXTENDED) != 0;

    match scan_code {
        28 => {
            if is_extended {
                Some(label)
            } else {
                None
            }
        }
        _ => {
            if !is_extended {
                Some(label)
            } else {
                None
            }
        }
    }
}

fn keyboard_key_to_global(key: KeyboardKey) -> Vec<String> {
    use KeyboardKey::*;
    match key {
        A => vec!["A".to_string()],
        B => vec!["B".to_string()],
        C => vec!["C".to_string()],
        D => vec!["D".to_string()],
        E => vec!["E".to_string()],
        F => vec!["F".to_string()],
        G => vec!["G".to_string()],
        H => vec!["H".to_string()],
        I => vec!["I".to_string()],
        J => vec!["J".to_string()],
        K => vec!["K".to_string()],
        L => vec!["L".to_string()],
        M => vec!["M".to_string()],
        N => vec!["N".to_string()],
        O => vec!["O".to_string()],
        P => vec!["P".to_string()],
        Q => vec!["Q".to_string()],
        R => vec!["R".to_string()],
        S => vec!["S".to_string()],
        T => vec!["T".to_string()],
        U => vec!["U".to_string()],
        V => vec!["V".to_string()],
        W => vec!["W".to_string()],
        X => vec!["X".to_string()],
        Y => vec!["Y".to_string()],
        Z => vec!["Z".to_string()],
        Number0 => vec!["0".to_string()],
        Number1 => vec!["1".to_string()],
        Number2 => vec!["2".to_string()],
        Number3 => vec!["3".to_string()],
        Number4 => vec!["4".to_string()],
        Number5 => vec!["5".to_string()],
        Number6 => vec!["6".to_string()],
        Number7 => vec!["7".to_string()],
        Number8 => vec!["8".to_string()],
        Number9 => vec!["9".to_string()],
        LeftAlt => vec!["LEFT ALT".to_string()],
        RightAlt => vec!["RIGHT ALT".to_string()],
        LeftShift => vec!["LEFT SHIFT".to_string()],
        RightShift => vec!["RIGHT SHIFT".to_string()],
        LeftControl => vec!["LEFT CTRL".to_string()],
        RightControl => vec!["25".to_string(), "RIGHT CTRL".to_string()],
        BackSpace => vec!["BACKSPACE".to_string()],
        Tab => vec!["TAB".to_string()],
        Enter => vec!["RETURN".to_string(), "NUMPAD RETURN".to_string()],
        Escape => vec!["ESCAPE".to_string()],
        Space => vec!["SPACE".to_string()],
        PageUp => vec!["PAGE UP".to_string()],
        PageDown => vec!["PAGE DOWN".to_string()],
        Home => vec!["HOME".to_string()],
        ArrowLeft => vec!["LEFT ARROW".to_string()],
        ArrowUp => vec!["UP ARROW".to_string()],
        ArrowRight => vec!["RIGHT ARROW".to_string()],
        ArrowDown => vec!["DOWN ARROW".to_string()],
        Print => vec!["PRINT".to_string()],
        PrintScreen => vec!["PRINT SCREEN".to_string()],
        Insert => vec!["INS".to_string()],
        Delete => vec!["DELETE".to_string()],
        LeftWindows => vec!["91".to_string(), "LEFT WINDOWS".to_string()],
        RightWindows => vec!["92".to_string(), "RIGHT WINDOWS".to_string()],
        Comma => vec!["COMMA".to_string()],
        Period => vec!["DOT".to_string(), "PERIOD".to_string()],
        Slash => vec!["FORWARD SLASH".to_string(), "/".to_string()],
        SemiColon => vec!["SEMICOLON".to_string()],
        Apostrophe => vec!["QUOTE".to_string()],
        LeftBrace => vec!["SQUARE BRACKET OPEN".to_string()],
        BackwardSlash => vec!["BACKSLASH".to_string()],
        RightBrace => vec!["SQUARE BRACKET CLOSE".to_string()],
        Grave => vec!["SECTION".to_string(), "GRAVE".to_string()],
        Add => vec!["NUMPAD PLUS".to_string(), "+".to_string()],
        Subtract => vec!["NUMPAD MINUS".to_string(), "-".to_string()],
        Decimal => vec!["NUMPAD DELETE".to_string(), "DECIMAL".to_string()],
        Divide => vec!["NUMPAD DIVIDE".to_string(), "/".to_string()],
        Multiply => vec!["NUMPAD MULTIPLY".to_string(), "*".to_string()],
        Separator => vec!["NUMPAD SEPARATOR".to_string()],
        F1 => vec!["F1".to_string()],
        F2 => vec!["F2".to_string()],
        F3 => vec!["F3".to_string()],
        F4 => vec!["F4".to_string()],
        F5 => vec!["F5".to_string()],
        F6 => vec!["F6".to_string()],
        F7 => vec!["F7".to_string()],
        F8 => vec!["F8".to_string()],
        F9 => vec!["F9".to_string()],
        F10 => vec!["F10".to_string()],
        F11 => vec!["F11".to_string()],
        F12 => vec!["F12".to_string()],
        F13 => vec!["F13".to_string()],
        F14 => vec!["F14".to_string()],
        F15 => vec!["F15".to_string()],
        F16 => vec!["F16".to_string()],
        F17 => vec!["F17".to_string()],
        F18 => vec!["F18".to_string()],
        F19 => vec!["F19".to_string()],
        F20 => vec!["F20".to_string()],
        F21 => vec!["F21".to_string()],
        F22 => vec!["F22".to_string()],
        F23 => vec!["F23".to_string()],
        F24 => vec!["F24".to_string()],
        NumLock => vec!["NUM LOCK".to_string()],
        ScrollLock => vec!["SCROLL LOCK".to_string()],
        CapsLock => vec!["CAPS LOCK".to_string()],
        Numpad0 => vec!["NUMPAD 0".to_string()],
        Numpad1 => vec!["NUMPAD 1".to_string()],
        Numpad2 => vec!["NUMPAD 2".to_string()],
        Numpad3 => vec!["NUMPAD 3".to_string()],
        Numpad4 => vec!["NUMPAD 4".to_string()],
        Numpad5 => vec!["NUMPAD 5".to_string()],
        Numpad6 => vec!["NUMPAD 6".to_string()],
        Numpad7 => vec!["NUMPAD 7".to_string()],
        Numpad8 => vec!["NUMPAD 8".to_string()],
        Numpad9 => vec!["NUMPAD 9".to_string()],
        Other(code) => other_key_labels(code),
        InvalidKeyCodeReceived => Vec::new(),
    }
}

fn other_key_labels(code: u32) -> Vec<String> {
    match code {
        187 => vec!["EQUALS".to_string(), "=".to_string()],
        189 => vec!["MINUS".to_string(), "-".to_string()],
        93 => vec!["CONTEXT MENU".to_string(), "APPS".to_string()],
        19 => vec!["PAUSE".to_string()],
        // VK_END (0x23 / 35) is not mapped in KeyboardKey,
        // so it comes through as Other(35); normalize to "END"
        // to match frontend key map expectations.
        35 => vec!["END".to_string()],
        _ => vec![code.to_string()],
    }
}
