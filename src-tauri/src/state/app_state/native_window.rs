use super::*;

#[cfg(target_os = "macos")]
const OVERLAY_FRAME_APPLY_TIMEOUT_MS: u64 = 250;

/// 오버레이 창 알파를 페이드 - 트랙 예약 토글처럼 창 프레임과 콘텐츠가 함께 바뀌는 전환을 가린다
/// 창 프레임 변경과 웹뷰 리페인트는 프로세스 경계라 같은 프레임에 커밋될 수 없음
/// 반환값은 페이드 적용 여부 - false면 호출부가 가림 없이 즉시 전환해야 한다
pub(crate) fn fade_overlay_window(app: &AppHandle, alpha: f64, duration_ms: u64) -> Result<bool> {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
        // OBS 모드 등 창 미존재 시 무시
        return Ok(false);
    };
    #[cfg(target_os = "macos")]
    {
        let alpha = alpha.clamp(0.0, 1.0);
        let duration = (duration_ms as f64 / 1000.0).max(0.0);
        let target = window.clone();
        app.run_on_main_thread(move || {
            use objc::{class, msg_send, sel, sel_impl};

            match target.ns_window() {
                Ok(ns_window) => unsafe {
                    let ns_window = ns_window as *mut objc::runtime::Object;
                    if duration <= 0.0 {
                        let _: () = msg_send![ns_window, setAlphaValue: alpha];
                    } else {
                        let _: () = msg_send![class!(NSAnimationContext), beginGrouping];
                        let ctx: *mut objc::runtime::Object =
                            msg_send![class!(NSAnimationContext), currentContext];
                        let _: () = msg_send![ctx, setDuration: duration];
                        let animator: *mut objc::runtime::Object = msg_send![ns_window, animator];
                        let _: () = msg_send![animator, setAlphaValue: alpha];
                        let _: () = msg_send![class!(NSAnimationContext), endGrouping];
                    }
                },
                Err(err) => log::warn!("overlay fade: failed to get NSWindow handle: {err}"),
            }
        })?;
        Ok(true)
    }
    #[cfg(not(target_os = "macos"))]
    {
        // 네이티브 창 알파 미지원 - false를 돌려 렌더러가 콘텐츠 페이드로 대체한다
        let _ = (alpha, duration_ms, window);
        Ok(false)
    }
}

/// 오버레이 표시 시 알파를 1로 복원 - 페이드 도중 종료된 전환이 남긴 투명 상태의 마지막 방어선
#[cfg(target_os = "macos")]
fn reset_overlay_alpha(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    let target = window.clone();
    let _ = app.run_on_main_thread(move || {
        use objc::{msg_send, sel, sel_impl};

        if let Ok(ns_window) = target.ns_window() {
            let ns_window = ns_window as *mut objc::runtime::Object;
            unsafe {
                let _: () = msg_send![ns_window, setAlphaValue: 1.0f64];
            }
        }
    });
}

/// 오버레이 크기와 위치를 한 번의 네이티브 호출로 적용
/// set_size와 set_position을 나눠 부르면 창 이동이 두 트랜잭션으로 쪼개져 중간 프레임이 보인다
pub(super) fn apply_overlay_frame(
    window: &WebviewWindow,
    placement: NativePlacement,
) -> Result<AppliedOverlayFrame> {
    #[cfg(target_os = "macos")]
    {
        use objc::{class, msg_send, sel, sel_impl};

        let requested = applied_overlay_frame_from_placement(placement);
        // 메인 스레드에서 큐잉 후 대기하면 교착하므로 직접 실행
        let on_main: bool = unsafe { msg_send![class!(NSThread), isMainThread] };
        if on_main {
            return Ok(apply_overlay_frame_macos(window, placement)
                .map(|public_bounds| AppliedOverlayFrame {
                    public_bounds,
                    native_position: None,
                })
                .unwrap_or(requested));
        }

        let (tx, rx) = std::sync::mpsc::channel();
        let target = window.clone();
        window.app_handle().run_on_main_thread(move || {
            let _ = tx.send(apply_overlay_frame_macos(&target, placement));
        })?;
        Ok(rx
            .recv_timeout(Duration::from_millis(OVERLAY_FRAME_APPLY_TIMEOUT_MS))
            .ok()
            .flatten()
            .map(|public_bounds| AppliedOverlayFrame {
                public_bounds,
                native_position: None,
            })
            .unwrap_or(requested))
    }
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER};

        let hwnd = window.hwnd()?;
        let px = placement.position.x.round() as i32;
        let py = placement.position.y.round() as i32;
        let pw = (placement.width * placement.target_scale).round() as i32;
        let ph = (placement.height * placement.target_scale).round() as i32;
        unsafe {
            SetWindowPos(hwnd, None, px, py, pw, ph, SWP_NOZORDER | SWP_NOACTIVATE)?;
        }
        applied_overlay_frame_from_window(window)
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        window.set_size(LogicalSize::new(placement.width, placement.height))?;
        window.set_position(LogicalPosition::new(
            placement.position.x,
            placement.position.y,
        ))?;
        applied_overlay_frame_from_window(window)
    }
}

/// tao 좌표(주 모니터 좌상단 원점)를 AppKit 좌표(주 모니터 좌하단 원점)로 변환해 setFrame 적용
#[cfg(target_os = "macos")]
fn apply_overlay_frame_macos(
    window: &WebviewWindow,
    placement: NativePlacement,
) -> Option<OverlayBounds> {
    use cocoa::foundation::{NSPoint, NSRect, NSSize};
    use objc::{class, msg_send, sel, sel_impl};

    let fallback = || {
        let _ = window.set_size(LogicalSize::new(placement.width, placement.height));
        let _ = window.set_position(LogicalPosition::new(
            placement.position.x,
            placement.position.y,
        ));
    };

    match window.ns_window() {
        Ok(ns_window) => unsafe {
            let ns_window = ns_window as *mut objc::runtime::Object;

            let screens: *mut objc::runtime::Object = msg_send![class!(NSScreen), screens];
            let count: usize = msg_send![screens, count];
            if count == 0 {
                fallback();
                return None;
            }
            let primary: *mut objc::runtime::Object = msg_send![screens, objectAtIndex: 0usize];
            let screen_frame: NSRect = msg_send![primary, frame];

            let flipped_y = screen_frame.size.height - (placement.position.y + placement.height);
            let frame = NSRect::new(
                NSPoint::new(placement.position.x, flipped_y),
                NSSize::new(placement.width, placement.height),
            );
            let _: () = msg_send![ns_window, setFrame: frame display: true];

            // AppKit이 창을 화면 안으로 되밀 수 있어 실제 반영된 프레임을 읽는다
            let applied: NSRect = msg_send![ns_window, frame];
            Some(OverlayBounds {
                x: applied.origin.x,
                y: screen_frame.size.height - (applied.origin.y + applied.size.height),
                width: applied.size.width,
                height: applied.size.height,
            })
        },
        Err(err) => {
            log::warn!("overlay frame: failed to get NSWindow handle: {err}");
            fallback();
            None
        }
    }
}

pub(super) fn show_overlay_window(window: &WebviewWindow, _always_on_top: bool) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};

        let hwnd = window.hwnd()?;
        unsafe {
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
        // tao 내부 VISIBLE 플래그 동기화 — raw ShowWindow는 tao 상태를 갱신하지 않아,
        // 이후 set_always_on_top/set_ignore_cursor_events 호출 시 tao가 창을 숨겨버림
        window.show()?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        reset_overlay_alpha(window);
        // 오버레이 표시 시 key/main 윈도우 전환 방지
        let _ = window.set_focusable(false);
        apply_macos_overlay_fullscreen_behavior(window, _always_on_top);
        window.show()?;
        apply_macos_overlay_fullscreen_behavior(window, _always_on_top);
        Ok(())
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        window.show()?;
        Ok(())
    }
}

pub(super) fn hide_overlay_window(window: &WebviewWindow) -> Result<()> {
    // tao API 사용으로 내부 VISIBLE 플래그와 실제 창 상태 일치 유지
    window.hide()?;
    Ok(())
}

/// 분리 창을 포커스 이동 없이 메인 위로 올린다.
///
/// 빌더의 focused(false)가 tao에 MARKER_DONT_FOCUS를 남기는데, 이 플래그를 내리는 코드는
/// apply_diff가 값으로 받은 복사본만 바꾸므로 창 수명 내내 살아 있다. 그래서 show()는 항상
/// SW_SHOWNOACTIVATE로 나가고, 그건 활성 창 위로 올려주지 않아 패널이 메인 뒤에 깔린다.
/// 순서를 올리는 유일한 경로였던 set_focus는 드래그 tear-off에서 쓸 수 없다 -
/// 메인 웹뷰가 kill-focus를 받으면 mousedown 암시적 캡처가 풀려 드래그 세션이 끊긴다.
///
/// TOPMOST 밴드는 쓰지 않는다 - 한 프레임이라도 올라가면 always-on-top 오버레이 위로 나온다
#[cfg(target_os = "windows")]
pub(super) fn raise_panel_window_without_activation(window: &WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE,
    };

    let hwnd = match window.hwnd() {
        Ok(hwnd) => hwnd,
        Err(err) => {
            log::warn!("failed to get panel HWND for z-order raise: {err}");
            return;
        }
    };
    if let Err(err) = unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND_TOP),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
        )
    } {
        log::warn!("failed to raise panel window above main: {err}");
    }
}

/// macOS 전체화면 Space에서도 오버레이가 보이도록 NSWindow 동작을 보정
/// 어떤 스레드에서 호출되든 안전하게 메인 스레드에서 AppKit API를 실행
#[cfg(target_os = "macos")]
pub(super) fn apply_macos_overlay_fullscreen_behavior(window: &WebviewWindow, always_on_top: bool) {
    let app = window.app_handle().clone();
    let window = window.clone();
    let _ = app.run_on_main_thread(move || {
        apply_macos_overlay_fullscreen_behavior_inner(&window, always_on_top);
        let app = window.app_handle();
        if let Some(state) = app.try_state::<AppState>() {
            if let Err(error) = state.overlay_hit.reconcile_after_parent_order(app) {
                log::warn!("failed to follow macOS overlay window ordering: {error:#}");
            }
        }
    });
}

#[cfg(target_os = "macos")]
fn apply_macos_overlay_fullscreen_behavior_inner(window: &WebviewWindow, always_on_top: bool) {
    use objc::{msg_send, sel, sel_impl};

    match window.ns_window() {
        Ok(ns_window) => unsafe {
            let ns_window = ns_window as *mut objc::runtime::Object;

            // 전체화면 Space 표시를 위한 레벨 및 컬렉션 동작 설정
            // NSStatusWindowLevel (25) 수준 적용
            let target_level: i64 = if always_on_top { 25 } else { 0 };
            let _: () = msg_send![ns_window, setLevel: target_level];

            let behavior: u64 = (1 << 0) | (1 << 8); // canJoinAllSpaces | fullScreenAuxiliary
            let _: () = msg_send![ns_window, setCollectionBehavior: behavior];

            let _: () = msg_send![ns_window, setHidesOnDeactivate: false];
            let _: () = msg_send![ns_window, orderFrontRegardless];

            log::info!("macOS overlay: level={target_level}, behavior={behavior}");
        },
        Err(err) => {
            log::warn!("macOS overlay: failed to get NSWindow handle: {err}");
        }
    }
}

/// 드래그 가능한 영역에서 시스템 컨텍스트 메뉴(이전 크기, 이동, 최소화 등)가 표시되지 않도록 설정
/// WM_INITMENU 메시지를 후킹하여 메뉴가 초기화될 때 창을 비활성화했다 활성화하여 메뉴를 취소시키는 방식
/// (Electron의 hookWindowMessage 방식과 동일)
#[cfg(target_os = "windows")]
pub(super) fn disable_system_context_menu(window: &WebviewWindow) -> Result<()> {
    use windows::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        UI::{
            Shell::{DefSubclassProc, SetWindowSubclass},
            WindowsAndMessaging::{GetSystemMenu, WM_INITMENU},
        },
    };

    // EnableWindow는 user32.dll에서 직접 호출
    #[link(name = "user32")]
    extern "system" {
        fn EnableWindow(hwnd: isize, enable: i32) -> i32;
    }

    const SUBCLASS_ID: usize = 1;

    unsafe extern "system" fn subclass_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _uid_subclass: usize,
        _dw_ref_data: usize,
    ) -> LRESULT {
        if msg == WM_INITMENU {
            let system_menu = GetSystemMenu(hwnd, false);
            let is_system_menu = !system_menu.0.is_null() && (system_menu.0 as usize == wparam.0);
            if is_system_menu {
                // 시스템 메뉴만 차단하고, 앱이 띄우는 커스텀 메뉴(Menu.popup)는 허용
                EnableWindow(hwnd.0 as isize, 0); // FALSE
                EnableWindow(hwnd.0 as isize, 1); // TRUE
                return LRESULT(0);
            }
        }
        DefSubclassProc(hwnd, msg, wparam, lparam)
    }

    let hwnd = window.hwnd()?;
    let hwnd_win = HWND(hwnd.0);

    unsafe {
        SetWindowSubclass(hwnd_win, Some(subclass_proc), SUBCLASS_ID, 0)
            .ok()
            .map_err(|e| anyhow!("SetWindowSubclass failed: {e}"))?;
    }

    Ok(())
}

#[cfg(target_os = "windows")]
struct OverlayMoveObserverContext {
    store: Arc<AppStore>,
    generation: Arc<AtomicU64>,
    trust: Arc<Mutex<OverlayPlacementTrust>>,
    entered: AtomicBool,
}

#[cfg(target_os = "windows")]
pub(super) fn install_overlay_move_observer(
    window: &WebviewWindow,
    store: Arc<AppStore>,
    generation: Arc<AtomicU64>,
    trust: Arc<Mutex<OverlayPlacementTrust>>,
) -> Result<()> {
    use std::panic::{catch_unwind, AssertUnwindSafe};
    use windows::Win32::{
        System::Threading::GetCurrentThreadId, UI::WindowsAndMessaging::GetWindowThreadProcessId,
    };

    let hwnd = window.hwnd()?;
    let owner_thread = unsafe { GetWindowThreadProcessId(hwnd, None) };
    if owner_thread == 0 {
        return Err(anyhow!("failed to identify overlay HWND owner thread"));
    }
    if owner_thread == unsafe { GetCurrentThreadId() } {
        return unsafe {
            install_overlay_move_observer_on_owner_thread(window, store, generation, trust)
        };
    }

    let (sender, receiver) = std::sync::mpsc::channel();
    let target = window.clone();
    window.app_handle().run_on_main_thread(move || {
        let result = catch_unwind(AssertUnwindSafe(|| unsafe {
            install_overlay_move_observer_on_owner_thread(&target, store, generation, trust)
        }))
        .unwrap_or_else(|_| Err(anyhow!("overlay move observer installation panicked")));
        let _ = sender.send(result);
    })?;
    receiver
        .recv_timeout(Duration::from_secs(3))
        .map_err(|error| anyhow!("overlay move observer owner result unavailable: {error}"))?
}

#[cfg(target_os = "windows")]
unsafe fn install_overlay_move_observer_on_owner_thread(
    window: &WebviewWindow,
    store: Arc<AppStore>,
    generation: Arc<AtomicU64>,
    trust: Arc<Mutex<OverlayPlacementTrust>>,
) -> Result<()> {
    use windows::Win32::{
        System::Threading::GetCurrentThreadId,
        UI::{Shell::SetWindowSubclass, WindowsAndMessaging::GetWindowThreadProcessId},
    };

    const SUBCLASS_ID: usize = 0x444d_4f50;

    let hwnd = window.hwnd()?;
    let owner_thread = unsafe { GetWindowThreadProcessId(hwnd, None) };
    if owner_thread == 0 || owner_thread != unsafe { GetCurrentThreadId() } {
        return Err(anyhow!(
            "overlay move observer installation requires the HWND owner thread"
        ));
    }
    let context = Box::into_raw(Box::new(OverlayMoveObserverContext {
        store,
        generation,
        trust,
        entered: AtomicBool::new(false),
    }));
    let installed = unsafe {
        SetWindowSubclass(
            hwnd,
            Some(overlay_move_subclass_proc),
            SUBCLASS_ID,
            context as usize,
        )
    };
    if !installed.as_bool() {
        unsafe { drop(Box::from_raw(context)) };
        return Err(anyhow!("failed to subclass overlay HWND"));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub(in crate::state::app_state) unsafe fn applied_overlay_frame_from_hwnd(
    hwnd: windows::Win32::Foundation::HWND,
) -> Result<AppliedOverlayFrame> {
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
    use windows::Win32::{Foundation::RECT, UI::HiDpi::GetDpiForWindow};

    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect)? };
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    let scale = f64::from(dpi) / 96.0;
    applied_overlay_frame_from_native(
        NativeRect {
            x: f64::from(rect.left),
            y: f64::from(rect.top),
            width: f64::from(rect.right - rect.left),
            height: f64::from(rect.bottom - rect.top),
        },
        scale,
        true,
    )
    .ok_or_else(|| anyhow!("overlay HWND frame is invalid"))
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn overlay_move_subclass_proc(
    hwnd: windows::Win32::Foundation::HWND,
    message: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    subclass_id: usize,
    reference_data: usize,
) -> windows::Win32::Foundation::LRESULT {
    use std::panic::{catch_unwind, AssertUnwindSafe};
    use windows::Win32::UI::{
        Shell::{DefSubclassProc, RemoveWindowSubclass},
        WindowsAndMessaging::{WM_ENTERSIZEMOVE, WM_EXITSIZEMOVE, WM_NCDESTROY},
    };

    catch_unwind(AssertUnwindSafe(|| unsafe {
        let context = reference_data as *mut OverlayMoveObserverContext;
        if context.is_null() {
            return DefSubclassProc(hwnd, message, wparam, lparam);
        }
        match message {
            WM_ENTERSIZEMOVE => {
                (*context).entered.store(true, Ordering::Release);
            }
            WM_EXITSIZEMOVE => {
                if (*context).entered.swap(false, Ordering::AcqRel) {
                    match applied_overlay_frame_from_hwnd(hwnd).and_then(|frame| {
                        persist_overlay_placement(
                            &(*context).store,
                            &(*context).generation,
                            &(*context).trust,
                            frame,
                            None,
                            None,
                            OverlayPersistenceAuthority::NativeMoveEnded,
                        )
                    }) {
                        Ok(()) => {}
                        Err(error) => {
                            log::warn!("failed to persist overlay move end: {error:#}")
                        }
                    }
                }
            }
            WM_NCDESTROY => {
                let _ = RemoveWindowSubclass(hwnd, Some(overlay_move_subclass_proc), subclass_id);
                let result = DefSubclassProc(hwnd, message, wparam, lparam);
                drop(Box::from_raw(context));
                return result;
            }
            _ => {}
        }
        DefSubclassProc(hwnd, message, wparam, lparam)
    }))
    .unwrap_or_else(|_| unsafe { DefSubclassProc(hwnd, message, wparam, lparam) })
}
