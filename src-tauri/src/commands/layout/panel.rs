use anyhow::{anyhow, Context};
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::{errors::CmdResult, state::AppState};

fn ensure_main_caller(window: &WebviewWindow, action: &str) -> CmdResult<()> {
    if window.label() != "main" {
        return Err(anyhow!("panel window can only be {action} from main").into());
    }
    Ok(())
}

// window.open 직전 arm - 이어지는 요청 하나만 패널 창으로 인정한다
#[tauri::command]
pub fn panel_window_arm_open(state: State<'_, AppState>, window: WebviewWindow) -> CmdResult<()> {
    ensure_main_caller(&window, "armed")?;
    state.arm_panel_open();
    Ok(())
}

// 도킹(hide)된 패널 창을 다시 띄운다. 창이 없으면 메인이 window.open으로 만들어야 한다
#[tauri::command]
pub fn panel_window_present(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
) -> CmdResult<()> {
    ensure_main_caller(&window, "presented")?;
    Ok(state.present_panel_window(&app)?)
}

// 도킹: 창은 살려 둔 채 감춘다 (파괴는 종료 시만 - opener와 컨트롤러를 공유)
#[tauri::command]
pub fn panel_window_dock(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
) -> CmdResult<()> {
    ensure_main_caller(&window, "docked")?;
    Ok(state.dock_panel_window(&app)?)
}

// 기동 시 분리 복원 요청 1회 소비 - true면 메인이 window.open으로 패널을 연다
#[tauri::command]
pub fn panel_window_take_restore_request(
    state: State<'_, AppState>,
    window: WebviewWindow,
) -> CmdResult<bool> {
    ensure_main_caller(&window, "restored")?;
    Ok(state.take_panel_restore_request())
}

#[tauri::command]
pub fn panel_window_close_ack(state: State<'_, AppState>, request_id: String) -> CmdResult<bool> {
    Ok(state.acknowledge_panel_window_close(&request_id))
}

#[tauri::command]
pub fn panel_window_start_dragging(app: AppHandle, client_x: f64, client_y: f64) -> CmdResult<()> {
    let window = app
        .get_webview_window(crate::state::PANEL_LABEL)
        .ok_or_else(|| anyhow!("panel window is not open"))?;
    start_panel_window_dragging(&window, client_x, client_y)?;
    Ok(())
}

// 창 가장자리 표면을 네이티브 레이어가 그리게 한다 - 리사이즈 프레임을 못 따라오는
// 웹 페인트 대신 면과 1px 인셋 라인을 컴포지터가 소유.
// 색은 CSS 토큰이 단일 출처라 렌더러가 계산값(sRGB 0~1)을 넘겨준다.
// 반환값이 true면 렌더러는 CSS 링을 그리지 않는다 (겹치면 라인이 진해짐)
#[tauri::command]
pub fn panel_window_apply_native_chrome(
    app: AppHandle,
    window: WebviewWindow,
    fill: [f64; 4],
    line: [f64; 4],
) -> CmdResult<bool> {
    ensure_main_caller(&window, "styled")?;
    let panel = app
        .get_webview_window(crate::state::PANEL_LABEL)
        .ok_or_else(|| anyhow!("panel window is not open"))?;
    #[cfg(target_os = "macos")]
    {
        Ok(crate::state::macos_window_corners::apply_surface_chrome(
            &app, &panel, fill, line,
        ))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, panel, fill, line);
        Ok(false)
    }
}

#[cfg(not(target_os = "macos"))]
fn start_panel_window_dragging(
    window: &WebviewWindow,
    _client_x: f64,
    _client_y: f64,
) -> anyhow::Result<()> {
    window
        .start_dragging()
        .context("failed to start panel window dragging")
}

#[cfg(target_os = "macos")]
fn start_panel_window_dragging(
    window: &WebviewWindow,
    client_x: f64,
    client_y: f64,
) -> anyhow::Result<()> {
    use cocoa::{
        appkit::{NSEvent, NSEventModifierFlags, NSEventType},
        base::{id, nil},
        foundation::{NSInteger, NSPoint, NSRect, NSUInteger},
    };
    use objc::{class, msg_send, sel, sel_impl};

    let ns_window =
        window.ns_window().context("failed to get panel NSWindow")? as *mut objc::runtime::Object;

    unsafe {
        let application: id = msg_send![class!(NSApplication), sharedApplication];
        let current_event: id = msg_send![application, currentEvent];
        let target_window_number: NSInteger = msg_send![ns_window, windowNumber];

        let use_current_event = if current_event.is_null() {
            false
        } else {
            let event_type: NSUInteger = msg_send![current_event, type];
            let event_window_number: NSInteger = msg_send![current_event, windowNumber];
            is_panel_mouse_down_event(event_type, event_window_number, target_window_number)
        };

        let drag_event = if use_current_event {
            current_event
        } else {
            let content_view: id = msg_send![ns_window, contentView];
            if content_view.is_null() {
                return Err(anyhow!("failed to get panel content view"));
            }
            let content_bounds: NSRect = msg_send![content_view, bounds];
            let (local_x, local_y) = panel_drag_local_coordinates(
                client_x,
                client_y,
                content_bounds.size.width,
                content_bounds.size.height,
            )
            .ok_or_else(|| anyhow!("invalid panel drag coordinates"))?;
            let window_location = NSPoint::new(local_x, local_y);
            let (modifier_flags, timestamp, event_number) = if current_event.is_null() {
                (NSEventModifierFlags::empty(), 0.0, 0)
            } else {
                let modifier_flags = NSEvent::modifierFlags(current_event);
                let timestamp = NSEvent::timestamp(current_event);
                // eventNumber는 마우스 계열 이벤트에만 유효, 키 이벤트 등에 조회하면 NSInternalInconsistencyException
                let event_type: NSUInteger = msg_send![current_event, type];
                let event_number = if is_mouse_event_type(event_type) {
                    NSEvent::eventNumber(current_event)
                } else {
                    0
                };
                (modifier_flags, timestamp, event_number)
            };

            NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure_(
                nil,
                NSEventType::NSLeftMouseDown,
                window_location,
                modifier_flags,
                timestamp,
                target_window_number,
                nil,
                event_number,
                1,
                1.0,
            )
        };

        if drag_event.is_null() {
            return Err(anyhow!("failed to create panel drag event"));
        }
        let _: () = msg_send![ns_window, performWindowDragWithEvent: drag_event];
    }

    Ok(())
}

fn panel_drag_local_coordinates(
    client_x: f64,
    client_y: f64,
    content_width: f64,
    content_height: f64,
) -> Option<(f64, f64)> {
    if !client_x.is_finite()
        || !client_y.is_finite()
        || !content_width.is_finite()
        || !content_height.is_finite()
        || content_width <= 0.0
        || content_height <= 0.0
    {
        return None;
    }
    Some((
        client_x.clamp(0.0, content_width),
        (content_height - client_y).clamp(0.0, content_height),
    ))
}

fn is_panel_mouse_down_event(
    event_type: u64,
    event_window_number: i64,
    target_window_number: i64,
) -> bool {
    event_type == 1 && event_window_number == target_window_number
}

// NSLeftMouseDown(1)~NSMouseExited(9), NSOtherMouse*(25~27)
fn is_mouse_event_type(event_type: u64) -> bool {
    matches!(event_type, 1..=9 | 25..=27)
}

#[cfg(test)]
mod tests {
    use super::{is_mouse_event_type, is_panel_mouse_down_event, panel_drag_local_coordinates};

    #[test]
    fn panel_drag_synthetic_event_borrows_event_number_from_mouse_events_only() {
        assert!(is_mouse_event_type(1));
        assert!(is_mouse_event_type(9));
        assert!(is_mouse_event_type(26));
        assert!(!is_mouse_event_type(10)); // NSKeyDown
        assert!(!is_mouse_event_type(11)); // NSKeyUp
        assert!(!is_mouse_event_type(12)); // NSFlagsChanged
    }

    #[test]
    fn panel_drag_reuses_only_the_target_windows_mouse_down_event() {
        assert!(is_panel_mouse_down_event(1, 42, 42));
        assert!(!is_panel_mouse_down_event(1, 7, 42));
        assert!(!is_panel_mouse_down_event(0x15, 42, 42));
        assert!(!is_panel_mouse_down_event(6, 42, 42));
    }

    #[test]
    fn panel_drag_fallback_preserves_the_original_webview_anchor() {
        assert_eq!(
            panel_drag_local_coordinates(24.0, 18.0, 240.0, 530.0),
            Some((24.0, 512.0))
        );
        assert_eq!(
            panel_drag_local_coordinates(-10.0, 900.0, 240.0, 530.0),
            Some((0.0, 0.0))
        );
        assert_eq!(
            panel_drag_local_coordinates(f64::NAN, 18.0, 240.0, 530.0),
            None
        );
    }
}
