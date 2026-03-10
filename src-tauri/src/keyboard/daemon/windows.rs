use std::io::Write;

use anyhow::{anyhow, Result};

use super::super::labels::{
    build_key_labels, should_skip_keyboard_event, IsKeyboardEventInjected, KeyPress, KeyboardEvent,
    KeyboardKey,
};
use crate::ipc::{pipe_client_connect, DaemonCommand, HookKeyState, HookMessage, InputDeviceKind};
use crate::models::ShortcutBinding;

/// 글로벌 단축키 상태 추적기
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

impl HotkeyState {
    fn new(
        toggle_overlay: ShortcutBinding,
        toggle_overlay_lock: ShortcutBinding,
        toggle_always_on_top: ShortcutBinding,
    ) -> Self {
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

    /// 수정자 키 상태 업데이트 및 단축키 트리거 확인
    /// 단축키 트리거 시 Some(command) 반환
    fn update(&mut self, vk_code: u32, is_down: bool) -> Option<DaemonCommand> {
        // 수정자 키 VK 코드
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

#[derive(Debug, Clone)]
struct ParsedHotkey {
    key_vk: u32,
    ctrl: bool,
    shift: bool,
    alt: bool,
    meta: bool,
}

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

fn vk_from_key_code(code: &str) -> Option<u32> {
    // KeyboardEvent.code 스타일 키 사용 (예: KeyO, Tab, Digit1)
    if let Some(rest) = code.strip_prefix("Key") {
        if rest.len() == 1 {
            let ch = rest.chars().next()?.to_ascii_uppercase();
            if ch.is_ascii_uppercase() {
                return Some(ch as u32);
            }
        }
    }

    if let Some(rest) = code.strip_prefix("Digit") {
        if rest.len() == 1 {
            let ch = rest.chars().next()?;
            if ch.is_ascii_digit() {
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

pub(super) fn run_raw_input() -> Result<()> {
    use std::ffi::c_void;
    use std::mem::size_of;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{GetLastError, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Input::KeyboardAndMouse::{MapVirtualKeyW, MAPVK_VSC_TO_VK_EX};
    use windows::Win32::UI::Input::{
        GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE,
        RAWINPUTHEADER, RIDEV_INPUTSINK, RIDEV_NOLEGACY, RID_INPUT, RIM_TYPEKEYBOARD,
        RIM_TYPEMOUSE,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, PostQuitMessage,
        RegisterClassExW, TranslateMessage, CS_HREDRAW, CS_VREDRAW, CW_USEDEFAULT, MSG,
        RI_KEY_BREAK, RI_KEY_E0, WM_DESTROY, WM_INPUT, WM_QUIT, WNDCLASSEXW, WS_OVERLAPPEDWINDOW,
    };

    // Named pipe 연결 시도; 불가 시 stdout으로 폴백
    let mut sink: Box<dyn Write + Send> = match pipe_client_connect("dmnote_keys_v1") {
        Ok(file) => Box::new(file),
        Err(_) => Box::new(std::io::stdout()),
    };

    // 글로벌 단축키 상태 추적기
    let hotkeys = super::load_hotkeys_from_env();
    let mut hotkey_state = HotkeyState::new(
        hotkeys.toggle_overlay,
        hotkeys.toggle_overlay_lock,
        hotkeys.toggle_always_on_top,
    );

    // Raw Input 마우스 버튼 플래그 (windows 크레이트에 상수 미노출)
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
    // 휠 상수 — 완전성을 위해 유지하나 미사용 (휠 이벤트 비활성화)
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
                // 메시지 루프 종료 신호; 키보드 데몬 프로세스도 곧 종료됨
                PostQuitMessage(0);
                LRESULT(0)
            }
            _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
        }
    }

    unsafe {
        // WM_INPUT 수신용 최소 윈도우 클래스 등록
        let class_name: Vec<u16> = "DmNoteRawInput"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
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

        // Raw Input 키보드 + 마우스 이벤트 등록 (비포커스 상태에서도 수신)
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

        // 메시지 루프: WM_INPUT 처리 후 HookMessage로 변환
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).into() {
            if msg.message == WM_INPUT {
                // 필요한 버퍼 크기 먼저 조회
                let mut size: u32 = 0;
                let header_size = size_of::<RAWINPUTHEADER>() as u32;
                let hraw = HRAWINPUT(msg.lParam.0 as *mut c_void);
                let res = GetRawInputData(hraw, RID_INPUT, None, &mut size, header_size);
                if res == u32::MAX || size == 0 {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                    continue;
                }

                let mut buffer: Vec<u8> = vec![0u8; size as usize];

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
                        // RI_KEY_E1은 windows 크레이트 상수에 미노출
                        const RI_KEY_E1: u32 = 0x0004;
                        let is_e1 = (flags & RI_KEY_E1) != 0;

                        // MAPVK_VSC_TO_VK_EX용 스캔 코드 접두사 처리 (상위 바이트에 E0/E1)
                        let scan_code_prefixed = if is_e0 {
                            scan_code | 0xE000
                        } else if is_e1 {
                            scan_code | 0xE100
                        } else {
                            scan_code
                        };

                        // 가상 키 정규화 — 좌/우 수정자 키를 예상 레이블에 맞춤
                        // 가짜 키는 스캔 코드 기반 복구 우선
                        let mut vk_norm = vkey;
                        if vk_norm == 0 || vk_norm == 0xFF {
                            let mapped = MapVirtualKeyW(scan_code_prefixed, MAPVK_VSC_TO_VK_EX);
                            if mapped != 0 {
                                vk_norm = mapped;
                            } else {
                                // VK 0/255인 가짜/불완전 키 이벤트 발생 가능
                                // 잘못된 키 레이블 강제 대신 미해석 이벤트 건너뜀
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
                            let mapped = MapVirtualKeyW(scan_code_prefixed, MAPVK_VSC_TO_VK_EX);
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

                        // Raw Input 플래그를 KeyPress (down/up)로 매핑
                        // multiinput과 동일하게 RI_KEY_BREAK 사용
                        let is_break = (flags & RI_KEY_BREAK) != 0;
                        let pressed = if is_break {
                            KeyPress::Up(false)
                        } else {
                            KeyPress::Down(false)
                        };

                        // 글로벌 단축키 확인 (Ctrl+Shift+O로 오버레이 토글)
                        if let Some(command) = hotkey_state.update(vk_norm, !is_break) {
                            let _ = super::write_command(&mut sink, &command);
                            // 키 이벤트는 계속 정상 처리
                        }

                        // Raw Input 확장 플래그를 low-level hook 스타일 플래그로 매핑
                        // keyboard_labels 넘패드/확장 키 로직과 동일 동작 보장
                        let mut ll_flags = 0u32;
                        if is_e0 {
                            // keyboard_labels.rs에서 LLKHF_EXTENDED == 0x01
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

                        let _ = super::write_message(&mut sink, &message);
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
                            let _ = super::write_message(
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
