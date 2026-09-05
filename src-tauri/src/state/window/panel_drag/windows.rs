use super::*;
use crate::state::{AppState, PANEL_LABEL};

#[cfg(target_os = "windows")]
pub async fn start_windows_drag(
    app: AppHandle,
    controller: Arc<PanelDragController>,
    geometry: PanelDragGeometry,
    mode: PanelDragStartMode,
) -> Result<(), PanelDragError> {
    geometry.validate()?;
    if geometry.origin != mode.expected_origin() {
        return Err(panel_drag_error(
            PanelDragErrorCode::InvalidGeometry,
            "panel drag origin does not match the start command",
        ));
    }
    controller.begin(&geometry)?;

    let (enter_sender, enter_receiver) = oneshot::channel();
    let (owner_sender, owner_receiver) = oneshot::channel();
    let owner_app = app.clone();
    let owner_controller = Arc::clone(&controller);
    let owner_geometry = geometry.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| unsafe {
            start_on_owner_thread(
                &owner_app,
                &owner_controller,
                &owner_geometry,
                mode,
                enter_sender,
            )
        }))
        .unwrap_or_else(|_| {
            owner_start_failure(
                &owner_controller,
                &owner_geometry.gesture_id,
                false,
                panel_drag_error(
                    PanelDragErrorCode::DragStartFailed,
                    "panel drag owner transaction panicked",
                ),
            )
        });
        let _ = owner_sender.send(result);
    }) {
        let payload = controller.machine.lock().finish_start(
            &geometry.gesture_id,
            PanelDragOutcome::StartFailed,
            None,
        );
        if let Some(payload) = payload {
            emit_ended(&app, payload);
        }
        return Err(panel_drag_error(
            match mode {
                PanelDragStartMode::PresentAndStart => PanelDragErrorCode::PresentFailed,
                PanelDragStartMode::StartExisting => PanelDragErrorCode::DragStartFailed,
            },
            format!("failed to dispatch panel drag to the owner thread: {error}"),
        ));
    }

    let owner_result = match owner_receiver.await {
        Ok(result) => result,
        Err(_) => {
            let payload = controller.machine.lock().finish_start(
                &geometry.gesture_id,
                PanelDragOutcome::StartFailed,
                None,
            );
            if let Some(payload) = payload {
                emit_ended(&app, payload);
            }
            return Err(panel_drag_error(
                PanelDragErrorCode::DragStartFailed,
                "panel drag owner transaction was canceled",
            ));
        }
    };
    let presented = owner_result.presented;
    if presented {
        app.state::<AppState>().flush_panel_detached();
    }
    match owner_result.status {
        OwnerStartStatus::Waiting => {}
        OwnerStartStatus::Finished(payload) => {
            emit_ended(&app, payload);
            return Ok(());
        }
        OwnerStartStatus::Failed { error, payload } => {
            log_start_failure(&geometry.gesture_id, error.error_code);
            if let Some(payload) = payload {
                emit_ended(&app, payload);
            }
            if presented {
                return Ok(());
            }
            return Err(error);
        }
    }

    match tokio::time::timeout(DRAG_START_TIMEOUT, enter_receiver).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) | Err(_) => {
            let result = resolve_start_timeout(&app, controller, &geometry.gesture_id).await;
            if presented && result.is_err() {
                Ok(())
            } else {
                result
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn log_start_failure(gesture_id: &str, code: PanelDragErrorCode) {
    log::warn!(
        "panel_drag startFailed gestureId={gesture_id} code={}",
        code.as_str()
    );
}

#[cfg(target_os = "windows")]
struct OwnerStartResult {
    presented: bool,
    status: OwnerStartStatus,
}

#[cfg(target_os = "windows")]
enum OwnerStartStatus {
    Waiting,
    Finished(PanelDragEndedPayload),
    Failed {
        error: PanelDragError,
        payload: Option<PanelDragEndedPayload>,
    },
}

#[cfg(target_os = "windows")]
struct NativeDragContext {
    app: AppHandle,
    machine: Arc<Mutex<GestureMachine>>,
    identity: Arc<AtomicUsize>,
    hwnd: usize,
    hook: AtomicUsize,
}

#[cfg(target_os = "windows")]
thread_local! {
    static HOOK_CONTEXT: std::cell::Cell<*mut NativeDragContext> = const {
        std::cell::Cell::new(std::ptr::null_mut())
    };
}

#[cfg(target_os = "windows")]
unsafe fn start_on_owner_thread(
    app: &AppHandle,
    controller: &Arc<PanelDragController>,
    geometry: &PanelDragGeometry,
    mode: PanelDragStartMode,
    enter_sender: oneshot::Sender<()>,
) -> OwnerStartResult {
    use ::windows::Win32::{
        Foundation::{LPARAM, POINT, WPARAM},
        UI::{
            Input::KeyboardAndMouse::{GetAsyncKeyState, ReleaseCapture, VK_LBUTTON, VK_RBUTTON},
            WindowsAndMessaging::{
                GetCursorPos, GetSystemMetrics, IsWindowVisible, PostMessageW, HTCAPTION,
                SM_SWAPBUTTON, WM_NCLBUTTONDOWN,
            },
        },
    };
    use tauri::PhysicalPosition;

    let Some(window) = app.get_webview_window(PANEL_LABEL) else {
        return owner_start_failure(
            controller,
            &geometry.gesture_id,
            false,
            panel_drag_error(PanelDragErrorCode::PanelNotOpen, "panel window is not open"),
        );
    };
    if !controller
        .machine
        .lock()
        .is_presenting(&geometry.gesture_id)
    {
        log::info!(
            "panel_drag staleOwnerSkipped gestureId={} action=start",
            geometry.gesture_id
        );
        return OwnerStartResult {
            presented: false,
            status: OwnerStartStatus::Failed {
                error: panel_drag_error(
                    PanelDragErrorCode::DragStartFailed,
                    "panel drag gesture was cleared before owner execution",
                ),
                payload: None,
            },
        };
    }
    if matches!(mode, PanelDragStartMode::StartExisting)
        && (!window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(false))
    {
        return owner_start_failure(
            controller,
            &geometry.gesture_id,
            false,
            panel_drag_error(
                PanelDragErrorCode::PanelNotOpen,
                "panel window is not visible",
            ),
        );
    }

    let (main_scale, main_residual) = match main_drag_scale(app, geometry) {
        Ok(metrics) => metrics,
        Err(error) => {
            return owner_start_failure(controller, &geometry.gesture_id, false, error);
        }
    };

    let mut cursor = POINT::default();
    if let Err(error) = unsafe { GetCursorPos(&mut cursor) } {
        return owner_start_failure(
            controller,
            &geometry.gesture_id,
            false,
            panel_drag_error(
                PanelDragErrorCode::MonitorUnavailable,
                format!("failed to read the drag cursor position: {error}"),
            ),
        );
    }

    let (start_native, snap_scale) = match geometry.origin {
        PanelDragOrigin::Docked => {
            match main_press_native(app, geometry.press_client_css, main_scale, main_residual) {
                Ok(value) => (Some(value.0), Some(value.1)),
                Err(error) => {
                    return owner_start_failure(controller, &geometry.gesture_id, false, error);
                }
            }
        }
        PanelDragOrigin::Detached => (None, None),
    };

    let mut presented = false;
    let mut present_snapshot = None;
    if matches!(mode, PanelDragStartMode::PresentAndStart) {
        let hwnd = match window.hwnd() {
            Ok(hwnd) => hwnd,
            Err(error) => {
                return owner_start_failure(
                    controller,
                    &geometry.gesture_id,
                    false,
                    panel_drag_error(
                        PanelDragErrorCode::PresentFailed,
                        format!("failed to get the panel HWND for presentation: {error}"),
                    ),
                );
            }
        };
        let monitor = match app.monitor_from_point(cursor.x as f64, cursor.y as f64) {
            Ok(Some(monitor)) if scale_is_usable(monitor.scale_factor()) => monitor,
            Ok(_) => {
                return owner_start_failure(
                    controller,
                    &geometry.gesture_id,
                    false,
                    panel_drag_error(
                        PanelDragErrorCode::MonitorUnavailable,
                        "cursor monitor is unavailable",
                    ),
                );
            }
            Err(error) => {
                return owner_start_failure(
                    controller,
                    &geometry.gesture_id,
                    false,
                    panel_drag_error(
                        PanelDragErrorCode::MonitorUnavailable,
                        format!("failed to resolve the cursor monitor: {error}"),
                    ),
                );
            }
        };
        let panel_scale = match geometry.panel_device_pixel_ratio {
            None => {
                log::debug!(
                    "panel_drag panelCoordinateScale gestureId={} panelDevicePixelRatio=missing mainZoomResidual={} source=mainResidual",
                    geometry.gesture_id,
                    main_residual,
                );
                None
            }
            Some(_) => match window.scale_factor() {
                Ok(panel_scale) if scale_is_usable(panel_scale) => Some(panel_scale),
                Ok(panel_scale) => {
                    log::warn!(
                        "panel_drag panelScaleFallback gestureId={} panelScale={} mainZoomResidual={}",
                        geometry.gesture_id,
                        panel_scale,
                        main_residual,
                    );
                    None
                }
                Err(error) => {
                    log::warn!(
                        "panel_drag panelScaleFallback gestureId={} error={} mainZoomResidual={}",
                        geometry.gesture_id,
                        error,
                        main_residual,
                    );
                    None
                }
            },
        };
        let panel_residual = resolve_panel_seed_residual(
            geometry.panel_device_pixel_ratio,
            panel_scale,
            main_residual,
        );
        if let (Some(panel_device_pixel_ratio), Some(panel_scale)) =
            (geometry.panel_device_pixel_ratio, panel_scale)
        {
            if calculate_zoom_residual(panel_device_pixel_ratio, panel_scale).is_some() {
                log::debug!(
                    "panel_drag panelCoordinateScale gestureId={} panelDevicePixelRatio={} panelScale={} panelZoomResidual={}",
                    geometry.gesture_id,
                    panel_device_pixel_ratio,
                    panel_scale,
                    panel_residual,
                );
            } else {
                log::warn!(
                    "panel_drag panelZoomResidualFallback gestureId={} panelDevicePixelRatio={} panelScale={} panelZoomResidual=1",
                    geometry.gesture_id,
                    panel_device_pixel_ratio,
                    panel_scale,
                );
            }
        }
        let inset =
            tao_undecorated_shadow_seed_inset(monitor.scale_factor()).unwrap_or_else(|| {
                log::warn!(
                    "panel_drag targetDpiInsetFallback gestureId={} targetScale={}",
                    geometry.gesture_id,
                    monitor.scale_factor()
                );
                match (window.outer_position(), window.inner_position()) {
                    (Ok(outer), Ok(inner)) => NativePoint {
                        x: (inner.x - outer.x) as f64,
                        y: (inner.y - outer.y) as f64,
                    },
                    _ => NativePoint { x: 0.0, y: 0.0 },
                }
            });
        let target = seed_panel_position_native(
            NativePoint {
                x: cursor.x as f64,
                y: cursor.y as f64,
            },
            geometry.grab_offset_css,
            monitor.scale_factor(),
            panel_residual,
            inset,
        );
        let target_x = target.x;
        let target_y = target.y;
        let Some(target_x) = checked_native_coordinate(target_x) else {
            return owner_start_failure(
                controller,
                &geometry.gesture_id,
                false,
                panel_drag_error(
                    PanelDragErrorCode::InvalidGeometry,
                    "panel seed X coordinate is out of range",
                ),
            );
        };
        let Some(target_y) = checked_native_coordinate(target_y) else {
            return owner_start_failure(
                controller,
                &geometry.gesture_id,
                false,
                panel_drag_error(
                    PanelDragErrorCode::InvalidGeometry,
                    "panel seed Y coordinate is out of range",
                ),
            );
        };
        {
            let state = app.state::<AppState>();
            let Some(_creation_guard) = state.try_lock_panel_creation_for_drag() else {
                return owner_start_failure(
                    controller,
                    &geometry.gesture_id,
                    false,
                    panel_drag_error(
                        PanelDragErrorCode::PresentFailed,
                        "panel creation lock is busy",
                    ),
                );
            };
            let _ = window.unminimize();
            if let Err(error) = window.set_position(PhysicalPosition::new(target_x, target_y)) {
                return owner_start_failure(
                    controller,
                    &geometry.gesture_id,
                    false,
                    panel_drag_error(
                        PanelDragErrorCode::PresentFailed,
                        format!("failed to seed the panel window position: {error}"),
                    ),
                );
            }
            if let Err(error) = window.show() {
                return owner_start_failure(
                    controller,
                    &geometry.gesture_id,
                    false,
                    panel_drag_error(
                        PanelDragErrorCode::PresentFailed,
                        format!("failed to show the panel window: {error}"),
                    ),
                );
            }
            presented = true;
            present_snapshot = Some(state.record_panel_drag_presented(app));
            if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
                return owner_start_failure(
                    controller,
                    &geometry.gesture_id,
                    presented,
                    panel_drag_error(
                        PanelDragErrorCode::PresentFailed,
                        "panel HWND did not become visible",
                    ),
                );
            }
        }
    }

    let context = match unsafe { ensure_native_observer(app, controller, &window) } {
        Ok(context) => context,
        Err(error) => {
            return owner_start_failure(controller, &geometry.gesture_id, presented, error);
        }
    };
    if let Err(error) = unsafe { install_native_hook(context) } {
        return owner_start_failure(controller, &geometry.gesture_id, presented, error);
    }
    let origin = match controller.machine.lock().prepare_starting(
        &geometry.gesture_id,
        start_native,
        snap_scale,
        main_residual,
        enter_sender,
    ) {
        Ok(origin) => origin,
        Err(error) => {
            unsafe { cleanup_native_hook(context) };
            let mut visible_after_failure = presented;
            if presented {
                match window.hide() {
                    Ok(()) => {
                        visible_after_failure = false;
                        if let Some(snapshot) = present_snapshot.take() {
                            app.state::<AppState>()
                                .revert_panel_drag_presented(app, snapshot);
                        } else {
                            log::warn!(
                                "panel_drag lifecycleStateRestoreMissing gestureId={}",
                                geometry.gesture_id
                            );
                        }
                        log::info!(
                            "panel_drag lifecycleHideRestored gestureId={} action=prepareStarting",
                            geometry.gesture_id
                        );
                    }
                    Err(error) => log::warn!(
                        "panel_drag lifecycleHideRestoreFailed gestureId={} error={error}",
                        geometry.gesture_id
                    ),
                }
            }
            return owner_start_failure(
                controller,
                &geometry.gesture_id,
                visible_after_failure,
                error,
            );
        }
    };
    log_transition(
        &geometry.gesture_id,
        GesturePhase::Presenting.as_str(),
        GesturePhase::Starting.as_str(),
        origin,
        None,
    );

    let primary_button_vk = if unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0 {
        VK_RBUTTON
    } else {
        VK_LBUTTON
    };
    let primary_button_down =
        unsafe { GetAsyncKeyState(primary_button_vk.0 as i32) } as u16 & 0x8000 != 0;
    if !primary_button_down {
        unsafe { cleanup_native_hook(context) };
        let would_snap_back = if geometry.origin == PanelDragOrigin::Docked {
            let mut release_cursor = POINT::default();
            match unsafe { GetCursorPos(&mut release_cursor) } {
                Ok(()) => released_before_start_snap_back(
                    start_native,
                    NativePoint {
                        x: release_cursor.x as f64,
                        y: release_cursor.y as f64,
                    },
                    snap_scale,
                ),
                Err(error) => {
                    log::warn!(
                        "panel_drag releasedBeforeStartCursorFailed gestureId={} error={error}",
                        geometry.gesture_id
                    );
                    None
                }
            }
        } else {
            None
        };
        if let Some(payload) = controller.machine.lock().finish_start(
            &geometry.gesture_id,
            PanelDragOutcome::ReleasedBeforeStart,
            would_snap_back,
        ) {
            return OwnerStartResult {
                presented,
                status: OwnerStartStatus::Finished(payload),
            };
        }
        return owner_start_failure(
            controller,
            &geometry.gesture_id,
            presented,
            panel_drag_error(
                PanelDragErrorCode::DragStartFailed,
                "panel drag gesture ended before native start",
            ),
        );
    }

    if let Err(error) = unsafe { ReleaseCapture() } {
        unsafe { cleanup_native_hook(context) };
        return owner_start_failure(
            controller,
            &geometry.gesture_id,
            presented,
            panel_drag_error(
                PanelDragErrorCode::DragStartFailed,
                format!("failed to release mouse capture: {error}"),
            ),
        );
    }
    let hwnd = windows_hwnd((*context).hwnd);
    let lparam = LPARAM(pack_cursor_lparam(cursor.x, cursor.y));
    if let Err(error) = unsafe {
        PostMessageW(
            Some(hwnd),
            WM_NCLBUTTONDOWN,
            WPARAM(HTCAPTION as usize),
            lparam,
        )
    } {
        unsafe { cleanup_native_hook(context) };
        return owner_start_failure(
            controller,
            &geometry.gesture_id,
            presented,
            panel_drag_error(
                PanelDragErrorCode::DragStartFailed,
                format!("failed to post the native drag message: {error}"),
            ),
        );
    }

    OwnerStartResult {
        presented,
        status: OwnerStartStatus::Waiting,
    }
}

#[cfg(target_os = "windows")]
fn owner_start_failure(
    controller: &PanelDragController,
    gesture_id: &str,
    presented: bool,
    error: PanelDragError,
) -> OwnerStartResult {
    unsafe { cleanup_controller_hook(controller) };
    let payload =
        controller
            .machine
            .lock()
            .finish_start(gesture_id, PanelDragOutcome::StartFailed, None);
    OwnerStartResult {
        presented,
        status: OwnerStartStatus::Failed { error, payload },
    }
}

#[cfg(target_os = "windows")]
fn main_press_native(
    app: &AppHandle,
    press_client_css: PanelDragPoint,
    main_scale: f64,
    zoom_residual: f64,
) -> Result<(NativePoint, f64), PanelDragError> {
    let main = app.get_webview_window("main").ok_or_else(|| {
        panel_drag_error(
            PanelDragErrorCode::MonitorUnavailable,
            "main window is unavailable for snapBack",
        )
    })?;
    let origin = main.inner_position().map_err(|error| {
        panel_drag_error(
            PanelDragErrorCode::MonitorUnavailable,
            format!("failed to read the main content origin: {error}"),
        )
    })?;
    let scale = main_scale * zoom_residual;
    let point = NativePoint {
        x: origin.x as f64 + press_client_css.x * scale,
        y: origin.y as f64 + press_client_css.y * scale,
    };
    if !point.x.is_finite() || !point.y.is_finite() {
        return Err(panel_drag_error(
            PanelDragErrorCode::InvalidGeometry,
            "snapBack origin conversion failed",
        ));
    }
    Ok((point, scale))
}

#[cfg(target_os = "windows")]
fn main_drag_scale(
    app: &AppHandle,
    geometry: &PanelDragGeometry,
) -> Result<(f64, f64), PanelDragError> {
    let main = app.get_webview_window("main").ok_or_else(|| {
        panel_drag_error(
            PanelDragErrorCode::MonitorUnavailable,
            "main window is unavailable for panel drag scaling",
        )
    })?;
    let main_scale = main
        .scale_factor()
        .ok()
        .filter(|scale| scale_is_usable(*scale))
        .ok_or_else(|| {
            panel_drag_error(
                PanelDragErrorCode::MonitorUnavailable,
                "main window scale is unavailable for panel drag scaling",
            )
        })?;
    let zoom_residual = calculate_zoom_residual(geometry.main_device_pixel_ratio, main_scale)
        .unwrap_or_else(|| {
            log::warn!(
                "panel_drag zoomResidualFallback gestureId={} mainDevicePixelRatio={} mainScale={} zoomResidual=1",
                geometry.gesture_id,
                geometry.main_device_pixel_ratio,
                main_scale,
            );
            1.0
        });
    log::debug!(
        "panel_drag coordinateScale gestureId={} mainDevicePixelRatio={} mainScale={} zoomResidual={}",
        geometry.gesture_id,
        geometry.main_device_pixel_ratio,
        main_scale,
        zoom_residual,
    );
    Ok((main_scale, zoom_residual))
}

#[cfg(target_os = "windows")]
fn tao_undecorated_shadow_seed_inset(target_scale: f64) -> Option<NativePoint> {
    use ::windows::Win32::UI::{
        HiDpi::GetSystemMetricsForDpi,
        WindowsAndMessaging::{SM_CXPADDEDBORDER, SM_CXSIZEFRAME},
    };

    let dpi = target_monitor_dpi(target_scale)?;
    let resize_frame_thickness = unsafe { GetSystemMetricsForDpi(SM_CXSIZEFRAME, dpi) };
    let padding_thickness = unsafe { GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi) };
    let insets = tao_undecorated_shadow_insets(
        dpi,
        resize_frame_thickness,
        padding_thickness,
        windows_build_number(),
    );
    Some(NativePoint {
        x: insets.left as f64,
        y: insets.top as f64,
    })
}

#[cfg(target_os = "windows")]
fn windows_build_number() -> u32 {
    use std::{mem::size_of, sync::OnceLock};

    #[repr(C)]
    struct OsVersionInfoW {
        size: u32,
        major: u32,
        minor: u32,
        build: u32,
        platform_id: u32,
        service_pack: [u16; 128],
    }

    #[link(name = "ntdll")]
    unsafe extern "system" {
        #[link_name = "RtlGetVersion"]
        fn rtl_get_version(version_info: *mut OsVersionInfoW) -> i32;
    }

    static BUILD: OnceLock<u32> = OnceLock::new();
    *BUILD.get_or_init(|| {
        let mut version_info: OsVersionInfoW = unsafe { std::mem::zeroed() };
        version_info.size = size_of::<OsVersionInfoW>() as u32;
        let status = unsafe { rtl_get_version(&mut version_info) };
        if status >= 0 {
            version_info.build
        } else {
            0
        }
    })
}

#[cfg(target_os = "windows")]
unsafe fn ensure_native_observer(
    app: &AppHandle,
    controller: &PanelDragController,
    window: &tauri::WebviewWindow,
) -> Result<*mut NativeDragContext, PanelDragError> {
    use ::windows::Win32::UI::Shell::SetWindowSubclass;

    const SUBCLASS_ID: usize = 0x444d_5044;

    let hwnd = window.hwnd().map_err(|error| {
        panel_drag_error(
            PanelDragErrorCode::DragStartFailed,
            format!("failed to get the panel HWND: {error}"),
        )
    })?;
    let hwnd_value = hwnd.0 as usize;
    let existing = controller.native_context.load(Ordering::Acquire);
    if existing != 0 {
        let context = existing as *mut NativeDragContext;
        if unsafe { (*context).hwnd } == hwnd_value {
            return Ok(context);
        }
        return Err(panel_drag_error(
            PanelDragErrorCode::DragStartFailed,
            "panel drag observer belongs to another HWND",
        ));
    }

    let context = Box::new(NativeDragContext {
        app: app.clone(),
        machine: Arc::clone(&controller.machine),
        identity: Arc::clone(&controller.native_context),
        hwnd: hwnd_value,
        hook: AtomicUsize::new(0),
    });
    let context = Box::into_raw(context);
    let installed = unsafe {
        SetWindowSubclass(
            hwnd,
            Some(panel_drag_subclass_proc),
            SUBCLASS_ID,
            context as usize,
        )
    };
    if !installed.as_bool() {
        unsafe { drop(Box::from_raw(context)) };
        return Err(panel_drag_error(
            PanelDragErrorCode::DragStartFailed,
            "failed to install the panel drag HWND observer",
        ));
    }
    controller
        .native_context
        .store(context as usize, Ordering::Release);
    Ok(context)
}

#[cfg(target_os = "windows")]
unsafe fn install_native_hook(context: *mut NativeDragContext) -> Result<(), PanelDragError> {
    use ::windows::Win32::{
        System::Threading::GetCurrentThreadId,
        UI::WindowsAndMessaging::{SetWindowsHookExW, WH_GETMESSAGE},
    };

    if unsafe { (*context).hook.load(Ordering::Acquire) } != 0 {
        return Err(panel_drag_error(
            PanelDragErrorCode::DragStartFailed,
            "panel drag Escape hook is already installed",
        ));
    }
    let occupied = HOOK_CONTEXT.with(|slot| {
        let current = slot.get();
        if current.is_null() || current == context {
            slot.set(context);
            false
        } else {
            true
        }
    });
    if occupied {
        return Err(panel_drag_error(
            PanelDragErrorCode::DragStartFailed,
            "another panel drag Escape hook is active",
        ));
    }
    let hook = match unsafe {
        SetWindowsHookExW(
            WH_GETMESSAGE,
            Some(panel_drag_message_hook),
            None,
            GetCurrentThreadId(),
        )
    } {
        Ok(hook) => hook,
        Err(error) => {
            HOOK_CONTEXT.with(|slot| {
                if slot.get() == context {
                    slot.set(std::ptr::null_mut());
                }
            });
            return Err(panel_drag_error(
                PanelDragErrorCode::DragStartFailed,
                format!("failed to install the panel drag Escape hook: {error}"),
            ));
        }
    };
    unsafe { (*context).hook.store(hook.0 as usize, Ordering::Release) };
    Ok(())
}

#[cfg(target_os = "windows")]
unsafe fn cleanup_native_hook(context: *mut NativeDragContext) {
    use ::windows::Win32::UI::WindowsAndMessaging::{UnhookWindowsHookEx, HHOOK};

    if context.is_null() {
        return;
    }
    let hook = unsafe { (*context).hook.swap(0, Ordering::AcqRel) };
    if hook != 0 {
        let _ = unsafe { UnhookWindowsHookEx(HHOOK(hook as *mut std::ffi::c_void)) };
    }
    HOOK_CONTEXT.with(|slot| {
        if slot.get() == context {
            slot.set(std::ptr::null_mut());
        }
    });
}

#[cfg(target_os = "windows")]
unsafe fn cleanup_controller_hook(controller: &PanelDragController) {
    let context = controller.native_context.load(Ordering::Acquire) as *mut NativeDragContext;
    if !context.is_null() {
        unsafe { cleanup_native_hook(context) };
    }
}

#[cfg(target_os = "windows")]
pub(super) fn schedule_native_hook_cleanup(app: &AppHandle, identity: Arc<AtomicUsize>) {
    if identity.load(Ordering::Acquire) == 0 {
        return;
    }
    if let Err(error) = app.run_on_main_thread(move || {
        let context = identity.load(Ordering::Acquire) as *mut NativeDragContext;
        if !context.is_null() {
            unsafe { cleanup_native_hook(context) };
            let hwnd = unsafe { windows_hwnd((*context).hwnd) };
            let _ = unsafe {
                ::windows::Win32::UI::WindowsAndMessaging::SendMessageW(
                    hwnd,
                    ::windows::Win32::UI::WindowsAndMessaging::WM_CANCELMODE,
                    None,
                    None,
                )
            };
        }
    }) {
        log::warn!("panel_drag hookCleanupDispatchFailed error={error}");
    }
}

#[cfg(target_os = "windows")]
async fn resolve_start_timeout(
    app: &AppHandle,
    controller: Arc<PanelDragController>,
    gesture_id: &str,
) -> Result<(), PanelDragError> {
    let (sender, receiver) = oneshot::channel();
    let owner_controller = Arc::clone(&controller);
    let gesture_id_owned = gesture_id.to_string();
    if let Err(error) = app.run_on_main_thread(move || {
        let resolution = owner_controller
            .machine
            .lock()
            .resolve_timeout(&gesture_id_owned);
        if matches!(resolution, TimeoutResolution::Failed(_)) {
            unsafe { cleanup_controller_hook(&owner_controller) };
        }
        let _ = sender.send(resolution);
    }) {
        let payload =
            controller
                .machine
                .lock()
                .finish_start(gesture_id, PanelDragOutcome::StartFailed, None);
        if let Some(payload) = payload {
            emit_ended(app, payload);
        }
        log::warn!(
            "panel_drag startFailed gestureId={gesture_id} code=DRAG_START_NOT_OBSERVED dispatchError={error}"
        );
        return Err(panel_drag_error(
            PanelDragErrorCode::DragStartNotObserved,
            "native panel drag start was not observed",
        ));
    }
    match receiver.await.unwrap_or(TimeoutResolution::Stale) {
        TimeoutResolution::Started => Ok(()),
        TimeoutResolution::Failed(payload) => {
            emit_ended(app, payload);
            log::warn!(
                "panel_drag startFailed gestureId={gesture_id} code=DRAG_START_NOT_OBSERVED"
            );
            Err(panel_drag_error(
                PanelDragErrorCode::DragStartNotObserved,
                "native panel drag start was not observed",
            ))
        }
        TimeoutResolution::Stale => Err(panel_drag_error(
            PanelDragErrorCode::DragStartNotObserved,
            "native panel drag start observer became stale",
        )),
    }
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn panel_drag_subclass_proc(
    hwnd: ::windows::Win32::Foundation::HWND,
    message: u32,
    wparam: ::windows::Win32::Foundation::WPARAM,
    lparam: ::windows::Win32::Foundation::LPARAM,
    subclass_id: usize,
    reference_data: usize,
) -> ::windows::Win32::Foundation::LRESULT {
    use ::windows::Win32::UI::{
        Shell::{DefSubclassProc, RemoveWindowSubclass},
        WindowsAndMessaging::{
            SendMessageW, WM_CANCELMODE, WM_ENTERSIZEMOVE, WM_EXITSIZEMOVE, WM_NCDESTROY,
        },
    };
    use std::panic::{catch_unwind, AssertUnwindSafe};

    catch_unwind(AssertUnwindSafe(|| unsafe {
        let context = reference_data as *mut NativeDragContext;
        if context.is_null() {
            return DefSubclassProc(hwnd, message, wparam, lparam);
        }
        match message {
            WM_ENTERSIZEMOVE => {
                let observed = (*context).machine.lock().observe_enter();
                if let Some((gesture_id, origin, sender)) = observed {
                    log_transition(
                        &gesture_id,
                        GesturePhase::Starting.as_str(),
                        GesturePhase::Dragging.as_str(),
                        origin,
                        None,
                    );
                    let _ = sender.send(());
                } else {
                    let _ = SendMessageW(hwnd, WM_CANCELMODE, None, None);
                }
            }
            WM_EXITSIZEMOVE => {
                let payload = (*context).machine.lock().finish_native_exit();
                cleanup_native_hook(context);
                if let Some(payload) = payload {
                    emit_ended(&(*context).app, payload);
                }
            }
            WM_NCDESTROY => {
                let payload = (*context).machine.lock().finish_window_destroyed();
                cleanup_native_hook(context);
                let _ = RemoveWindowSubclass(hwnd, Some(panel_drag_subclass_proc), subclass_id);
                (*context).identity.store(0, Ordering::Release);
                if let Some(payload) = payload {
                    emit_ended(&(*context).app, payload);
                }
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

#[cfg(target_os = "windows")]
unsafe extern "system" fn panel_drag_message_hook(
    code: i32,
    wparam: ::windows::Win32::Foundation::WPARAM,
    lparam: ::windows::Win32::Foundation::LPARAM,
) -> ::windows::Win32::Foundation::LRESULT {
    use ::windows::Win32::UI::{
        Input::KeyboardAndMouse::VK_ESCAPE,
        WindowsAndMessaging::{CallNextHookEx, MSG, WM_KEYDOWN, WM_SYSKEYDOWN},
    };
    use std::panic::{catch_unwind, AssertUnwindSafe};

    let _ = catch_unwind(AssertUnwindSafe(|| unsafe {
        if code < 0 || lparam.0 == 0 {
            return;
        }
        let message = &*(lparam.0 as *const MSG);
        if matches!(message.message, WM_KEYDOWN | WM_SYSKEYDOWN)
            && message.wParam.0 == VK_ESCAPE.0 as usize
        {
            HOOK_CONTEXT.with(|slot| {
                if let Some(context) = slot.get().as_ref() {
                    context.machine.lock().latch_escape();
                }
            });
        }
    }));
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

#[cfg(target_os = "windows")]
fn windows_hwnd(value: usize) -> ::windows::Win32::Foundation::HWND {
    ::windows::Win32::Foundation::HWND(value as *mut std::ffi::c_void)
}

#[cfg(target_os = "windows")]
fn checked_native_coordinate(value: f64) -> Option<i32> {
    if !value.is_finite() || value < i32::MIN as f64 || value > i32::MAX as f64 {
        return None;
    }
    Some(value.round() as i32)
}

#[cfg(target_os = "windows")]
fn pack_cursor_lparam(x: i32, y: i32) -> isize {
    let packed = (x as u32 & 0xffff) | ((y as u32 & 0xffff) << 16);
    packed as isize
}
