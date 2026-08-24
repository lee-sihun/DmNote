use anyhow::Context;
use tauri::{AppHandle, CursorIcon, Manager, WebviewWindow};

// 마우스다운은 메인 창이 계속 소유하므로 tear-off 전환 중에는 두 창의 네이티브
// 커서를 함께 고정한다. 패널 창이 아직 없으면 메인 창만 먼저 적용한다
pub(super) fn set(app: &AppHandle, main: &WebviewWindow, active: bool) -> anyhow::Result<()> {
    let icon = if active {
        CursorIcon::Grabbing
    } else {
        CursorIcon::Default
    };
    let panel = app.get_webview_window(crate::state::PANEL_LABEL);
    // Tauri 커서 갱신 실패와 무관하게 macOS 전역 상태를 먼저 전환
    let macos_result = set_macos_drag_cursor(app, active);

    main.set_cursor_icon(icon)
        .context("failed to update main drag cursor")?;
    if let Some(panel) = panel.as_ref() {
        panel
            .set_cursor_icon(icon)
            .context("failed to update panel drag cursor")?;
    }
    macos_result
}

// WKWebView는 TaoView보다 안쪽에서 NSCursor.set을 직접 호출한다. 드래그 동안에는
// 그 요청을 모두 닫힌 손으로 치환하고, 종료 후에는 원래 NSCursor 동작을 그대로 통과시킨다
#[cfg(target_os = "macos")]
fn set_macos_drag_cursor(app: &AppHandle, active: bool) -> anyhow::Result<()> {
    use std::{sync::mpsc, time::Duration};

    const CURSOR_UPDATE_TIMEOUT: Duration = Duration::from_secs(1);

    let (sender, receiver) = mpsc::channel();
    app.run_on_main_thread(move || {
        let result = set_macos_drag_cursor_inner(active);
        let _ = sender.send(result);
    })
    .context("failed to dispatch cursor update to main thread")?;

    receiver
        .recv_timeout(CURSOR_UPDATE_TIMEOUT)
        .context("macOS cursor update timed out")?
        .map_err(anyhow::Error::msg)
}

#[cfg(target_os = "macos")]
fn set_macos_drag_cursor_inner(active: bool) -> Result<(), String> {
    use cocoa::base::id;
    use objc::{class, msg_send, sel, sel_impl};
    use std::sync::atomic::Ordering;

    install_macos_cursor_override()?;
    MACOS_PANEL_DRAG_CURSOR_ACTIVE.store(active, Ordering::Release);

    unsafe {
        let cursor: id = if active {
            msg_send![class!(NSCursor), closedHandCursor]
        } else {
            msg_send![class!(NSCursor), arrowCursor]
        };
        let _: () = msg_send![cursor, set];
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn set_macos_drag_cursor(_app: &AppHandle, _active: bool) -> anyhow::Result<()> {
    Ok(())
}

#[cfg(target_os = "macos")]
static MACOS_PANEL_DRAG_CURSOR_ACTIVE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

#[cfg(target_os = "macos")]
extern "C" fn set_macos_cursor_with_panel_drag_override(
    cursor: &objc::runtime::Object,
    _selector: objc::runtime::Sel,
) {
    use cocoa::base::id;
    use objc::{class, msg_send, sel, sel_impl};
    use std::sync::atomic::Ordering;

    unsafe {
        let target: id = if MACOS_PANEL_DRAG_CURSOR_ACTIVE.load(Ordering::Acquire) {
            msg_send![class!(NSCursor), closedHandCursor]
        } else {
            cursor as *const objc::runtime::Object as id
        };
        // swizzle 뒤 이 selector는 NSCursor의 원래 set 구현을 가리킨다
        let _: () = msg_send![target, dmnSetCursorForPanelDrag];
    }
}

#[cfg(target_os = "macos")]
fn install_macos_cursor_override() -> Result<(), String> {
    use objc::{
        class,
        runtime::{
            class_addMethod, class_getInstanceMethod, method_exchangeImplementations, Class, Imp,
            Method, NO,
        },
        sel, sel_impl,
    };
    use std::{mem, sync::OnceLock};

    static INSTALL_RESULT: OnceLock<Result<(), String>> = OnceLock::new();

    INSTALL_RESULT
        .get_or_init(|| unsafe {
            let cursor_class = class!(NSCursor) as *const Class;
            let original = class_getInstanceMethod(cursor_class, sel!(set)) as *mut Method;
            if original.is_null() {
                return Err("NSCursor.set implementation not found".to_string());
            }

            let replacement_selector = sel!(dmnSetCursorForPanelDrag);
            let replacement_imp: Imp = mem::transmute(
                set_macos_cursor_with_panel_drag_override
                    as extern "C" fn(&objc::runtime::Object, objc::runtime::Sel),
            );
            let added = class_addMethod(
                cursor_class as *mut Class,
                replacement_selector,
                replacement_imp,
                c"v@:".as_ptr(),
            );
            if added == NO {
                return Err("failed to install NSCursor drag override".to_string());
            }

            let replacement =
                class_getInstanceMethod(cursor_class, replacement_selector) as *mut Method;
            if replacement.is_null() {
                return Err("NSCursor drag override implementation not found".to_string());
            }
            method_exchangeImplementations(original, replacement);
            Ok(())
        })
        .clone()
}
