use std::{
    ffi::c_void,
    mem::size_of,
    panic::{catch_unwind, AssertUnwindSafe},
    sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
};

use anyhow::{anyhow, Context, Result};
use parking_lot::RwLock;
use tauri::{AppHandle, Emitter, WebviewWindow};
use windows::{
    core::{w, Error as WindowsError},
    Win32::{
        Foundation::{
            GetLastError, ERROR_CLASS_ALREADY_EXISTS, HINSTANCE, HWND, LPARAM, LRESULT, POINT,
            RECT, WPARAM,
        },
        Graphics::Gdi::{
            ClientToScreen, CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, ValidateRect,
            HGDIOBJ, RGN_OR,
        },
        System::LibraryLoader::GetModuleHandleW,
        UI::{
            HiDpi::GetDpiForWindow,
            Input::KeyboardAndMouse::ReleaseCapture,
            Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::{
                CreateWindowExW, DefWindowProcW, DestroyWindow, GetClientRect, GetCursorPos,
                GetWindowLongPtrW, IsWindow, IsWindowVisible, LoadCursorW, PostMessageW,
                RegisterClassExW, SetCursor, SetWindowLongPtrW, SetWindowPos, ShowWindow,
                CREATESTRUCTW, GWLP_USERDATA, HTCAPTION, HWND_NOTOPMOST, HWND_TOPMOST, IDC_SIZEALL,
                MA_NOACTIVATE, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_SHOWWINDOW, SW_HIDE,
                WM_CLOSE, WM_DPICHANGED, WM_ERASEBKGND, WM_LBUTTONDOWN, WM_MOUSEACTIVATE,
                WM_NCCREATE, WM_NCDESTROY, WM_NCLBUTTONDOWN, WM_PAINT, WM_RBUTTONUP, WM_SETCURSOR,
                WM_WINDOWPOSCHANGED, WNDCLASSEXW, WS_EX_NOACTIVATE, WS_EX_NOREDIRECTIONBITMAP,
                WS_EX_TOOLWINDOW, WS_POPUP,
            },
        },
    },
};

use super::{
    hit_region_status, HitRegionStatus, OverlayHitContextMenuPayload, OverlayHitDesiredState,
    OverlayHitRect, OVERLAY_LABEL,
};

const PARENT_SUBCLASS_ID: usize = 0x444d_4849;
#[derive(Default)]
pub(super) struct NativeState {
    context: Option<Box<HitContext>>,
}

struct HitContext {
    app: AppHandle,
    parent: AtomicUsize,
    hit: AtomicUsize,
    rects: RwLock<Vec<OverlayHitRect>>,
    // CSS px -> 물리 px 배율. f64 원자값이 없어 비트 패턴으로 보관
    device_pixel_ratio: AtomicU64,
    active: AtomicBool,
    always_on_top: AtomicBool,
}

pub(super) fn parent_identity(overlay: Option<&WebviewWindow>) -> Result<Option<usize>> {
    let Some(overlay) = overlay else {
        return Ok(None);
    };
    let parent = overlay.hwnd().context("failed to get overlay HWND")?;
    Ok(Some(parent.0 as usize))
}

pub(super) fn reconcile(
    app: &AppHandle,
    overlay: Option<&WebviewWindow>,
    desired: &OverlayHitDesiredState,
    native: &mut NativeState,
) -> Result<HitRegionStatus> {
    let Some(overlay) = overlay else {
        hide_native(native);
        return Ok(HitRegionStatus::Applied);
    };
    let parent = overlay.hwnd().context("failed to get overlay HWND")?;
    ensure_native(app, parent, native)?;
    let context = native
        .context
        .as_ref()
        .ok_or_else(|| anyhow!("overlay hit HWND context is unavailable"))?;
    *context.rects.write() = desired.rects.clone();
    context
        .device_pixel_ratio
        .store(desired.device_pixel_ratio.to_bits(), Ordering::Release);
    // rect가 비어도 측정이 끝났으면 활성 - apply_hit_region이 클라이언트 전체를 잡는다
    context.active.store(
        desired.visible && !desired.locked && desired.last_revision.is_some(),
        Ordering::Release,
    );
    context
        .always_on_top
        .store(desired.always_on_top, Ordering::Release);
    unsafe { sync_hit_window(context) }
}

fn ensure_native(app: &AppHandle, parent: HWND, native: &mut NativeState) -> Result<()> {
    let needs_recreate = native.context.as_ref().is_none_or(|context| unsafe {
        context.parent.load(Ordering::Acquire) != parent.0 as usize
            || !IsWindow(Some(hwnd(context.hit.load(Ordering::Acquire)))).as_bool()
    });
    if !needs_recreate {
        return Ok(());
    }
    destroy_native(native);
    register_hit_window_class()?;

    let mut context = Box::new(HitContext {
        app: app.clone(),
        parent: AtomicUsize::new(parent.0 as usize),
        hit: AtomicUsize::new(0),
        rects: RwLock::new(Vec::new()),
        device_pixel_ratio: AtomicU64::new(1.0f64.to_bits()),
        active: AtomicBool::new(false),
        always_on_top: AtomicBool::new(true),
    });
    let context_pointer = (&mut *context as *mut HitContext).cast::<c_void>();
    let module = unsafe { GetModuleHandleW(None) }.context("failed to get module handle")?;
    let hit = unsafe {
        CreateWindowExW(
            WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_NOREDIRECTIONBITMAP,
            w!("DmNoteOverlayHitWindow"),
            w!(""),
            WS_POPUP,
            0,
            0,
            0,
            0,
            Some(parent),
            None,
            Some(HINSTANCE(module.0)),
            Some(context_pointer.cast_const()),
        )
    }
    .context("failed to create overlay hit HWND")?;
    context.hit.store(hit.0 as usize, Ordering::Release);
    let installed = unsafe {
        SetWindowSubclass(
            parent,
            Some(parent_subclass_proc),
            PARENT_SUBCLASS_ID,
            context_pointer as usize,
        )
    };
    if !installed.as_bool() {
        unsafe {
            SetWindowLongPtrW(hit, GWLP_USERDATA, 0);
            let _ = DestroyWindow(hit);
        }
        return Err(anyhow!("failed to subclass overlay HWND"));
    }
    native.context = Some(context);
    Ok(())
}

fn register_hit_window_class() -> Result<()> {
    let module = unsafe { GetModuleHandleW(None) }.context("failed to get module handle")?;
    let class = WNDCLASSEXW {
        cbSize: size_of::<WNDCLASSEXW>() as u32,
        lpfnWndProc: Some(hit_window_proc),
        hInstance: HINSTANCE(module.0),
        lpszClassName: w!("DmNoteOverlayHitWindow"),
        ..Default::default()
    };
    let atom = unsafe { RegisterClassExW(&class) };
    if atom == 0 && unsafe { GetLastError() } != ERROR_CLASS_ALREADY_EXISTS {
        return Err(WindowsError::from_win32().into());
    }
    Ok(())
}

unsafe extern "system" fn hit_window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    catch_unwind(AssertUnwindSafe(|| unsafe {
        if message == WM_NCCREATE {
            let create = &*(lparam.0 as *const CREATESTRUCTW);
            let context = create.lpCreateParams as *mut HitContext;
            SetWindowLongPtrW(window, GWLP_USERDATA, context as isize);
            if let Some(context) = context.as_ref() {
                context.hit.store(window.0 as usize, Ordering::Release);
            }
        }

        let context = GetWindowLongPtrW(window, GWLP_USERDATA) as *mut HitContext;
        match message {
            WM_MOUSEACTIVATE => return LRESULT(MA_NOACTIVATE as isize),
            WM_LBUTTONDOWN => {
                if let Some(context) = context
                    .as_ref()
                    .filter(|context| context.active.load(Ordering::Acquire))
                {
                    begin_parent_drag(context);
                }
                return LRESULT(0);
            }
            WM_RBUTTONUP => {
                if let Some(context) = context
                    .as_ref()
                    .filter(|context| context.active.load(Ordering::Acquire))
                {
                    emit_context_menu(context, lparam);
                }
                return LRESULT(0);
            }
            WM_SETCURSOR => {
                if let Ok(cursor) = LoadCursorW(None, IDC_SIZEALL) {
                    SetCursor(Some(cursor));
                    return LRESULT(1);
                }
            }
            // 작업 표시줄 그룹 종료 등 외부 WM_CLOSE로 히트 창이 사라지면
            // 재생성 트리거(reconcile)가 올 때까지 상호작용이 죽는다
            WM_CLOSE => return LRESULT(0),
            WM_ERASEBKGND => return LRESULT(1),
            WM_PAINT => {
                let _ = ValidateRect(Some(window), None);
                return LRESULT(0);
            }
            WM_NCDESTROY => {
                if let Some(context) = context.as_ref() {
                    context.hit.store(0, Ordering::Release);
                }
                SetWindowLongPtrW(window, GWLP_USERDATA, 0);
            }
            _ => {}
        }
        DefWindowProcW(window, message, wparam, lparam)
    }))
    .unwrap_or_else(|_| DefWindowProcW(window, message, wparam, lparam))
}

unsafe extern "system" fn parent_subclass_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    reference_data: usize,
) -> LRESULT {
    catch_unwind(AssertUnwindSafe(|| unsafe {
        let context = (reference_data as *mut HitContext).as_ref();
        if let Some(context) = context {
            match message {
                WM_DPICHANGED | WM_WINDOWPOSCHANGED => {
                    if let Err(error) = sync_hit_window(context) {
                        log::warn!("failed to follow overlay HWND: {error:#}");
                    }
                }
                WM_NCDESTROY => {
                    context.parent.store(0, Ordering::Release);
                    let hit = hwnd(context.hit.load(Ordering::Acquire));
                    if IsWindow(Some(hit)).as_bool() {
                        let _ = ShowWindow(hit, SW_HIDE);
                    }
                }
                _ => {}
            }
        }
        DefSubclassProc(window, message, wparam, lparam)
    }))
    .unwrap_or_else(|_| DefSubclassProc(window, message, wparam, lparam))
}

unsafe fn sync_hit_window(context: &HitContext) -> Result<HitRegionStatus> {
    let parent = hwnd(context.parent.load(Ordering::Acquire));
    let hit = hwnd(context.hit.load(Ordering::Acquire));
    if !IsWindow(Some(parent)).as_bool() || !IsWindow(Some(hit)).as_bool() {
        return Ok(HitRegionStatus::Applied);
    }
    if !context.active.load(Ordering::Acquire) || !IsWindowVisible(parent).as_bool() {
        let _ = ShowWindow(hit, SW_HIDE);
        return Ok(HitRegionStatus::Applied);
    }

    let mut client = RECT::default();
    GetClientRect(parent, &mut client).context("failed to read overlay client rect")?;
    let width = client.right - client.left;
    let height = client.bottom - client.top;
    if width <= 0 || height <= 0 {
        let _ = ShowWindow(hit, SW_HIDE);
        return Ok(HitRegionStatus::Applied);
    }
    let mut origin = POINT::default();
    if !ClientToScreen(parent, &mut origin).as_bool() {
        return Err(WindowsError::from_win32().into());
    }

    if !apply_hit_region(context, hit, width, height)? {
        let _ = ShowWindow(hit, SW_HIDE);
        return Ok(HitRegionStatus::FullyClipped);
    }
    let insert_after = if context.always_on_top.load(Ordering::Acquire) {
        HWND_TOPMOST
    } else {
        HWND_NOTOPMOST
    };
    SetWindowPos(
        hit,
        Some(insert_after),
        origin.x,
        origin.y,
        width,
        height,
        SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_SHOWWINDOW,
    )
    .context("failed to position overlay hit HWND")?;
    Ok(HitRegionStatus::Applied)
}

unsafe fn apply_hit_region(
    context: &HitContext,
    hit: HWND,
    client_width: i32,
    client_height: i32,
) -> Result<bool> {
    let union = CreateRectRgn(0, 0, 0, 0);
    if union.0.is_null() {
        return Err(WindowsError::from_win32().into());
    }
    // 웹뷰 실측 배율(devicePixelRatio)을 쓴다 - WebView2 보정 줌이 곱해져 있어
    // GetDpiForWindow/96으로는 접근성 텍스트 배율 사용자에서 좌표가 어긋난다.
    // (emit_context_menu의 dpi 나눗셈은 LogicalPosition 계약이라 별개 - 함께 바꾸지 말 것)
    let scale = f64::from_bits(context.device_pixel_ratio.load(Ordering::Acquire));
    let scale = if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        f64::from(GetDpiForWindow(hwnd(
            context.parent.load(Ordering::Acquire),
        ))) / 96.0
    };
    let scale = if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    };
    let mut region_count = 0usize;
    let measured_rects = context.rects.read();
    // 측정 결과가 통째로 비었는지와, 클리핑으로 전부 날아갔는지는 다르다.
    // 후자는 리사이즈·DPI 변경 직후의 과도기라 창 전체를 잡으면 안 된다
    let measured_empty = measured_rects.is_empty();
    for rect in measured_rects.iter() {
        let left = (rect.x * scale).floor().clamp(0.0, f64::from(client_width)) as i32;
        let top = (rect.y * scale)
            .floor()
            .clamp(0.0, f64::from(client_height)) as i32;
        let right = ((rect.x + rect.width) * scale)
            .ceil()
            .clamp(0.0, f64::from(client_width)) as i32;
        let bottom = ((rect.y + rect.height) * scale)
            .ceil()
            .clamp(0.0, f64::from(client_height)) as i32;
        if right <= left || bottom <= top {
            continue;
        }
        let part = CreateRectRgn(left, top, right, bottom);
        if part.0.is_null() {
            let _ = DeleteObject(HGDIOBJ(union.0));
            return Err(WindowsError::from_win32().into());
        }
        let _ = CombineRgn(Some(union), Some(union), Some(part), RGN_OR);
        let _ = DeleteObject(HGDIOBJ(part.0));
        region_count += 1;
    }
    if region_count == 0 {
        if !measured_empty {
            // 옛 rect가 새 클라이언트 밖으로 밀린 과도기 - 다음 측정까지 숨긴다
            let _ = DeleteObject(HGDIOBJ(union.0));
            return Ok(false);
        }
        // 측정 결과가 "키 0개" - 창 전체를 잡아 이식 전 동작으로 폴백한다
        let full = CreateRectRgn(0, 0, client_width, client_height);
        if full.0.is_null() {
            let _ = DeleteObject(HGDIOBJ(union.0));
            return Err(WindowsError::from_win32().into());
        }
        let _ = CombineRgn(Some(union), Some(union), Some(full), RGN_OR);
        let _ = DeleteObject(HGDIOBJ(full.0));
    }
    if SetWindowRgn(hit, Some(union), false) == 0 {
        let _ = DeleteObject(HGDIOBJ(union.0));
        return Err(WindowsError::from_win32().into());
    }
    Ok(hit_region_status(measured_empty, region_count) == HitRegionStatus::Applied)
}

unsafe fn begin_parent_drag(context: &HitContext) {
    let parent = hwnd(context.parent.load(Ordering::Acquire));
    if !IsWindow(Some(parent)).as_bool() {
        return;
    }
    let mut cursor = POINT::default();
    if GetCursorPos(&mut cursor).is_err() {
        return;
    }
    let _ = ReleaseCapture();
    let packed = ((cursor.y as u32 & 0xffff) << 16) | (cursor.x as u32 & 0xffff);
    let _ = PostMessageW(
        Some(parent),
        WM_NCLBUTTONDOWN,
        WPARAM(HTCAPTION as usize),
        LPARAM(packed as isize),
    );
}

unsafe fn emit_context_menu(context: &HitContext, lparam: LPARAM) {
    let parent = hwnd(context.parent.load(Ordering::Acquire));
    let dpi = if IsWindow(Some(parent)).as_bool() {
        GetDpiForWindow(parent).max(96)
    } else {
        96
    };
    let scale = f64::from(dpi) / 96.0;
    let x = f64::from(lparam.0 as i16) / scale;
    let y = f64::from((lparam.0 >> 16) as i16) / scale;
    let payload = OverlayHitContextMenuPayload { x, y };
    if let Err(error) = context
        .app
        .emit_to(OVERLAY_LABEL, "overlay-hit-context-menu", payload)
    {
        log::warn!("failed to emit Windows overlay hit context menu: {error}");
    }
}

fn hide_native(native: &mut NativeState) {
    if let Some(context) = native.context.as_ref() {
        context.active.store(false, Ordering::Release);
        let hit = hwnd(context.hit.load(Ordering::Acquire));
        unsafe {
            if IsWindow(Some(hit)).as_bool() {
                let _ = ShowWindow(hit, SW_HIDE);
            }
        }
    }
}

fn destroy_native(native: &mut NativeState) {
    let Some(context) = native.context.take() else {
        return;
    };
    let parent = hwnd(context.parent.load(Ordering::Acquire));
    let hit = hwnd(context.hit.load(Ordering::Acquire));
    unsafe {
        if IsWindow(Some(parent)).as_bool() {
            let _ = RemoveWindowSubclass(parent, Some(parent_subclass_proc), PARENT_SUBCLASS_ID);
        }
        if IsWindow(Some(hit)).as_bool() {
            SetWindowLongPtrW(hit, GWLP_USERDATA, 0);
            let _ = DestroyWindow(hit);
        }
    }
}

fn hwnd(value: usize) -> HWND {
    HWND(value as *mut c_void)
}
