use anyhow::anyhow;
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::{
    commands::run_blocking,
    errors::CmdResult,
    state::{
        window::panel_drag::start_windows_drag, AppState, PanelDragGeometry,
        PanelDragHitTestResult, PanelDragOrigin, PanelDragStartMode,
    },
};

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
pub async fn panel_window_present(app: AppHandle, window: WebviewWindow) -> CmdResult<()> {
    run_blocking(app, move |app, state| {
        ensure_main_caller(&window, "presented")?;
        Ok(state.present_panel_window(app, None, true)?)
    })
    .await
}

// 드래그 드롭 위치(논리 좌표, 창 좌상단)에 패널 창을 띄운다.
// focus=false는 드래그 도중 tear-off - 메인의 드래그 세션을 끊지 않게 포커스를 두지 않는다
#[tauri::command]
pub async fn panel_window_present_at(
    app: AppHandle,
    window: WebviewWindow,
    x: f64,
    y: f64,
    focus: bool,
) -> CmdResult<()> {
    run_blocking(app, move |app, state| {
        ensure_main_caller(&window, "presented")?;
        if !focus {
            super::panel_drag_cursor::set(app, &window, true)?;
        }
        let result =
            state.present_panel_window(app, Some(tauri::LogicalPosition::new(x, y)), focus);
        if result.is_err() && !focus {
            let _ = super::panel_drag_cursor::set(app, &window, false);
        }
        Ok(result?)
    })
    .await
}

// 드래그 중 창 이동 (논리 좌표, 창 좌상단)
#[tauri::command]
pub fn panel_window_move_to(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    x: f64,
    y: f64,
) -> CmdResult<()> {
    ensure_main_caller(&window, "moved")?;
    Ok(state.move_panel_window_to(&app, x, y)?)
}

#[tauri::command]
pub async fn panel_window_reset_position(app: AppHandle, window: WebviewWindow) -> CmdResult<()> {
    run_blocking(app, move |app, state| {
        ensure_main_caller(&window, "reset")?;
        Ok(state.reset_panel_window_position(app)?)
    })
    .await
}

#[tauri::command]
pub fn panel_window_set_drag_cursor(
    app: AppHandle,
    window: WebviewWindow,
    active: bool,
) -> CmdResult<()> {
    ensure_main_caller(&window, "cursor-controlled")?;
    super::panel_drag_cursor::set(&app, &window, active)?;
    Ok(())
}

// 헤더 드래그 세션 컨텍스트 - 도크 존 판정 기준 좌표(메인 content 원점·outer 폴백)
#[tauri::command]
pub fn panel_window_drag_context(
    state: State<'_, AppState>,
    app: AppHandle,
) -> crate::state::PanelDragContext {
    state.panel_drag_context(&app)
}

// 도킹: 창은 살려 둔 채 감춘다 (파괴는 종료 시만 - opener와 컨트롤러를 공유)
#[tauri::command]
pub async fn panel_window_dock(app: AppHandle, window: WebviewWindow) -> CmdResult<()> {
    run_blocking(app, move |app, state| {
        ensure_main_caller(&window, "docked")?;
        Ok(state.dock_panel_window(app)?)
    })
    .await
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
pub async fn panel_drag_present_and_start(
    app: AppHandle,
    window: WebviewWindow,
    geometry: PanelDragGeometry,
) -> CmdResult<()> {
    ensure_main_caller(&window, "drag-presented")?;
    let controller = app.state::<AppState>().panel_drag_controller();
    start_windows_drag(
        app,
        controller,
        geometry,
        PanelDragStartMode::PresentAndStart,
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn panel_drag_start_existing(
    app: AppHandle,
    window: WebviewWindow,
    geometry: PanelDragGeometry,
) -> CmdResult<()> {
    ensure_main_caller(&window, "drag-started")?;
    let controller = app.state::<AppState>().panel_drag_controller();
    start_windows_drag(app, controller, geometry, PanelDragStartMode::StartExisting).await?;
    Ok(())
}

#[tauri::command]
pub fn panel_drag_disarm_dock_zone(
    app: AppHandle,
    window: WebviewWindow,
    gesture_id: String,
) -> CmdResult<()> {
    ensure_main_caller(&window, "drag-updated")?;
    app.state::<AppState>()
        .panel_drag_controller()
        .disarm_dock_zone(&gesture_id)?;
    Ok(())
}

#[tauri::command]
pub fn panel_drag_hit_test(
    app: AppHandle,
    window: WebviewWindow,
    gesture_id: String,
    origin: PanelDragOrigin,
) -> CmdResult<PanelDragHitTestResult> {
    ensure_main_caller(&window, "drag-hit-tested")?;
    Ok(app
        .state::<AppState>()
        .panel_drag_controller()
        .hit_test(&app, &gesture_id, origin)?)
}

// 웹이 그리는 분리 창 모서리 반경 - panelChrome.ts의 CSS 폴백과 같은 값을 유지한다.
// macOS 레이어 마스크(macos_window_corners::CORNER_RADIUS)도 같은 값이라 겹쳐도 어긋나지 않는다
// Windows는 실루엣이 항상 네이티브라 이 값을 쓰지 않는다
#[cfg(not(target_os = "windows"))]
const WEB_CORNER_RADIUS: f64 = 12.0;

/// 네이티브가 창 가장자리를 얼마나 가져갔는지 - 렌더러는 남은 몫만 그린다.
/// 두 값을 따로 두는 이유는 Windows 10: 창이 불투명이라 실루엣은 이미 네이티브(사각)인데
/// DWM 보더 속성이 없어 라인만 웹이 그려야 한다
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelWindowChrome {
    /// 웹이 그릴 모서리 반경(px). 네이티브가 실루엣을 소유하면 0
    web_radius: f64,
    /// 웹이 1px 인셋 링을 그려야 하는지. 네이티브가 라인을 그리면 false (겹치면 진해짐)
    web_ring: bool,
}

// 창 가장자리 표면을 네이티브가 그리게 한다 - 리사이즈 프레임을 못 따라오는
// 웹 페인트 대신 면과 1px 라인을 컴포지터(macOS CALayer / Windows DWM)가 소유.
// 색은 CSS 토큰이 단일 출처라 렌더러가 계산값(sRGB 0~1)을 넘겨준다
#[tauri::command]
pub fn panel_window_apply_native_chrome(
    app: AppHandle,
    window: WebviewWindow,
    fill: [f64; 4],
    line: [f64; 4],
) -> CmdResult<PanelWindowChrome> {
    ensure_main_caller(&window, "styled")?;
    let panel = app
        .get_webview_window(crate::state::PANEL_LABEL)
        .ok_or_else(|| anyhow!("panel window is not open"))?;
    // macOS 레이어 마스크는 CSS와 같은 12px라 반경을 웹에 남긴다 - 실패해도 그대로 정답
    #[cfg(target_os = "macos")]
    {
        let applied = crate::state::window::macos_window_corners::apply_surface_chrome(
            &app, &panel, fill, line,
        );
        Ok(PanelWindowChrome {
            web_radius: WEB_CORNER_RADIUS,
            web_ring: !applied,
        })
    }
    // Windows는 창이 불투명이라 실루엣이 항상 네이티브 - 웹 반경은 성공 여부와 무관하게 0
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        let applied =
            crate::state::window::windows_window_corners::apply_surface_chrome(&panel, fill, line);
        Ok(PanelWindowChrome {
            web_radius: 0.0,
            web_ring: !applied,
        })
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (app, panel, fill, line);
        Ok(PanelWindowChrome {
            web_radius: WEB_CORNER_RADIUS,
            web_ring: true,
        })
    }
}
