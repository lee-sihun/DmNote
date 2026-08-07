use std::{sync::mpsc, time::Duration};

use anyhow::{anyhow, Context, Result};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const OVERLAY_LABEL: &str = "overlay";
const MAIN_THREAD_DISPATCH_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_HIT_RECTS: usize = 4_096;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OverlayHitRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, Serialize)]
struct OverlayHitContextMenuPayload {
    x: f64,
    y: f64,
}

#[derive(Clone)]
pub struct OverlayHitService {
    inner: std::sync::Arc<OverlayHitServiceInner>,
}

struct OverlayHitServiceInner {
    desired: Mutex<OverlayHitDesiredState>,
    native: Mutex<platform::NativeState>,
}

#[derive(Debug, Clone)]
struct OverlayHitDesiredState {
    rects: Vec<OverlayHitRect>,
    last_revision: Option<u64>,
    visible: bool,
    locked: bool,
    always_on_top: bool,
}

impl OverlayHitDesiredState {
    fn apply_regions(&mut self, rects: Vec<OverlayHitRect>, revision: u64) -> bool {
        if self
            .last_revision
            .is_some_and(|last_revision| revision <= last_revision)
        {
            return false;
        }
        self.rects = rects;
        self.last_revision = Some(revision);
        true
    }
}

impl OverlayHitService {
    pub fn new(visible: bool, locked: bool, always_on_top: bool) -> Self {
        Self {
            inner: std::sync::Arc::new(OverlayHitServiceInner {
                desired: Mutex::new(OverlayHitDesiredState {
                    rects: Vec::new(),
                    last_revision: None,
                    visible,
                    locked,
                    always_on_top,
                }),
                native: Mutex::new(platform::NativeState::default()),
            }),
        }
    }

    pub fn sync_regions(
        &self,
        app: &AppHandle,
        rects: Vec<OverlayHitRect>,
        revision: u64,
    ) -> Result<()> {
        {
            let mut desired = self.inner.desired.lock();
            if desired
                .last_revision
                .is_some_and(|last_revision| revision <= last_revision)
            {
                log::debug!(
                    "[OverlayHit] stale revision ignored: revision={revision}, last={:?}",
                    desired.last_revision
                );
                return Ok(());
            }
            validate_hit_rects(&rects)?;
            let applied = desired.apply_regions(rects, revision);
            debug_assert!(applied);
        }
        self.reconcile(app)
    }

    pub fn set_configuration(
        &self,
        app: &AppHandle,
        visible: bool,
        locked: bool,
        always_on_top: bool,
    ) -> Result<()> {
        {
            let mut desired = self.inner.desired.lock();
            desired.visible = visible;
            desired.locked = locked;
            desired.always_on_top = always_on_top;
        }
        self.reconcile(app)
    }

    pub fn set_visible(&self, app: &AppHandle, visible: bool) -> Result<()> {
        self.inner.desired.lock().visible = visible;
        self.reconcile(app)
    }

    pub fn set_locked(&self, app: &AppHandle, locked: bool) -> Result<()> {
        self.inner.desired.lock().locked = locked;
        self.reconcile(app)
    }

    pub fn set_always_on_top(&self, app: &AppHandle, always_on_top: bool) -> Result<()> {
        self.inner.desired.lock().always_on_top = always_on_top;
        self.reconcile(app)
    }

    pub fn reconcile(&self, app: &AppHandle) -> Result<()> {
        let overlay = app.get_webview_window(OVERLAY_LABEL);
        let main_window = app.get_webview_window("main");
        let thread_window = overlay.as_ref().or(main_window.as_ref());
        if platform::is_main_thread(thread_window) {
            return self.reconcile_on_main(app);
        }

        let service = self.clone();
        let app_handle = app.clone();
        let (sender, receiver) = mpsc::sync_channel(1);
        app.run_on_main_thread(move || {
            let result = service.reconcile_on_main(&app_handle);
            let _ = sender.send(result);
        })
        .context("failed to dispatch overlay hit reconciliation")?;

        receiver
            .recv_timeout(MAIN_THREAD_DISPATCH_TIMEOUT)
            .map_err(|error| anyhow!("overlay hit reconciliation timed out: {error}"))?
    }

    fn reconcile_on_main(&self, app: &AppHandle) -> Result<()> {
        let desired = self.inner.desired.lock().clone();
        let overlay = app.get_webview_window(OVERLAY_LABEL);
        let mut native = self.inner.native.lock();
        platform::reconcile(app, overlay.as_ref(), &desired, &mut native)
    }
}

fn validate_hit_rects(rects: &[OverlayHitRect]) -> Result<()> {
    if rects.len() > MAX_HIT_RECTS {
        return Err(anyhow!(
            "overlay hit rect count exceeds limit of {MAX_HIT_RECTS}"
        ));
    }
    for (index, rect) in rects.iter().enumerate() {
        if !rect.x.is_finite()
            || !rect.y.is_finite()
            || !rect.width.is_finite()
            || !rect.height.is_finite()
            || rect.width <= 0.0
            || rect.height <= 0.0
        {
            return Err(anyhow!("invalid overlay hit rect at index {index}"));
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
mod platform {
    use std::{
        os::raw::c_void,
        panic::{catch_unwind, AssertUnwindSafe},
    };

    use anyhow::{anyhow, Context, Result};
    use cocoa::{
        appkit::{NSBackingStoreBuffered, NSEvent, NSEventType},
        base::{id, nil, BOOL, NO, YES},
        foundation::{NSInteger, NSPoint, NSRect, NSSize},
    };
    use objc::{
        class,
        declare::ClassDecl,
        msg_send,
        runtime::{Class, Object, Sel},
        sel, sel_impl,
    };
    use once_cell::sync::Lazy;
    use tauri::{AppHandle, Emitter, WebviewWindow};

    use super::{
        OverlayHitContextMenuPayload, OverlayHitDesiredState, OverlayHitRect, OVERLAY_LABEL,
    };

    const HIT_CONTEXT_IVAR: &str = "dmNoteOverlayHitContext";
    const NS_NONACTIVATING_PANEL_MASK: u64 = 1 << 7;
    const NS_WINDOW_ABOVE: i64 = 1;

    #[derive(Default)]
    pub(super) struct NativeState {
        panels: Vec<HitPanel>,
    }

    struct HitPanel {
        panel: usize,
        view: usize,
        context: Box<HitContext>,
    }

    struct HitContext {
        app: AppHandle,
        parent: usize,
        rect: OverlayHitRect,
        active: bool,
    }

    struct ObjectiveCClass(&'static Class);

    unsafe impl Send for ObjectiveCClass {}
    unsafe impl Sync for ObjectiveCClass {}

    static HIT_PANEL_CLASS: Lazy<ObjectiveCClass> = Lazy::new(|| unsafe {
        if let Some(class) = Class::get("DmNoteOverlayHitPanel") {
            return ObjectiveCClass(class);
        }
        let superclass = class!(NSPanel);
        let mut declaration =
            ClassDecl::new("DmNoteOverlayHitPanel", superclass).expect("hit panel class");
        declaration.add_method(
            sel!(canBecomeKeyWindow),
            never_becomes_key as extern "C" fn(&Object, Sel) -> BOOL,
        );
        declaration.add_method(
            sel!(canBecomeMainWindow),
            never_becomes_key as extern "C" fn(&Object, Sel) -> BOOL,
        );
        ObjectiveCClass(declaration.register())
    });

    static HIT_VIEW_CLASS: Lazy<ObjectiveCClass> = Lazy::new(|| unsafe {
        if let Some(class) = Class::get("DmNoteOverlayHitView") {
            return ObjectiveCClass(class);
        }
        let superclass = class!(NSView);
        let mut declaration =
            ClassDecl::new("DmNoteOverlayHitView", superclass).expect("hit view class");
        declaration.add_method(
            sel!(acceptsFirstMouse:),
            accepts_first_mouse as extern "C" fn(&Object, Sel, id) -> BOOL,
        );
        declaration.add_method(
            sel!(acceptsFirstResponder),
            never_becomes_key as extern "C" fn(&Object, Sel) -> BOOL,
        );
        declaration.add_method(
            sel!(mouseDown:),
            mouse_down as extern "C" fn(&Object, Sel, id),
        );
        declaration.add_method(
            sel!(rightMouseUp:),
            right_mouse_up as extern "C" fn(&Object, Sel, id),
        );
        declaration.add_method(
            sel!(resetCursorRects),
            reset_cursor_rects as extern "C" fn(&Object, Sel),
        );
        declaration.add_ivar::<*mut c_void>(HIT_CONTEXT_IVAR);
        ObjectiveCClass(declaration.register())
    });

    extern "C" fn never_becomes_key(_this: &Object, _selector: Sel) -> BOOL {
        NO
    }

    extern "C" fn accepts_first_mouse(_this: &Object, _selector: Sel, _event: id) -> BOOL {
        YES
    }

    extern "C" fn mouse_down(this: &Object, _selector: Sel, event: id) {
        let _ = catch_unwind(AssertUnwindSafe(|| unsafe {
            let cursor: id = msg_send![class!(NSCursor), closedHandCursor];
            let _: () = msg_send![cursor, set];
            if let Some(context) = hit_context(this).filter(|context| context.active) {
                if let Err(error) = start_parent_drag(context, event) {
                    log::warn!("failed to start macOS overlay hit drag: {error:#}");
                }
            }
            let cursor: id = msg_send![class!(NSCursor), openHandCursor];
            let _: () = msg_send![cursor, set];
        }));
    }

    extern "C" fn right_mouse_up(this: &Object, _selector: Sel, event: id) {
        let _ = catch_unwind(AssertUnwindSafe(|| unsafe {
            let Some(context) = hit_context(this) else {
                return;
            };
            if !context.active {
                return;
            }
            let location: NSPoint = msg_send![event, locationInWindow];
            let payload = OverlayHitContextMenuPayload {
                x: context.rect.x + location.x,
                y: context.rect.y + context.rect.height - location.y,
            };
            if let Err(error) =
                context
                    .app
                    .emit_to(OVERLAY_LABEL, "overlay-hit-context-menu", payload)
            {
                log::warn!("failed to emit macOS overlay hit context menu: {error}");
            }
        }));
    }

    extern "C" fn reset_cursor_rects(this: &Object, _selector: Sel) {
        unsafe {
            let bounds: NSRect = msg_send![this, bounds];
            let cursor: id = msg_send![class!(NSCursor), openHandCursor];
            let _: () = msg_send![this, addCursorRect: bounds cursor: cursor];
        }
    }

    unsafe fn hit_context(this: &Object) -> Option<&HitContext> {
        let context: *mut c_void = *this.get_ivar(HIT_CONTEXT_IVAR);
        context.cast::<HitContext>().as_ref()
    }

    unsafe fn start_parent_drag(context: &HitContext, source_event: id) -> Result<()> {
        if source_event.is_null() || context.parent == 0 {
            return Err(anyhow!("overlay hit drag context is unavailable"));
        }
        let parent = context.parent as id;
        let content_view: id = msg_send![parent, contentView];
        if content_view.is_null() {
            return Err(anyhow!("overlay content view is unavailable"));
        }

        let panel_location: NSPoint = msg_send![source_event, locationInWindow];
        let client_x = context.rect.x + panel_location.x;
        let client_y = context.rect.y + context.rect.height - panel_location.y;
        let content_bounds: NSRect = msg_send![content_view, bounds];
        let content_location = NSPoint::new(client_x, content_bounds.size.height - client_y);
        let window_location: NSPoint =
            msg_send![content_view, convertPoint: content_location toView: nil];
        let target_window_number: NSInteger = msg_send![parent, windowNumber];
        let modifier_flags = NSEvent::modifierFlags(source_event);
        let timestamp = NSEvent::timestamp(source_event);
        let event_number = NSEvent::eventNumber(source_event);
        let drag_event = NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure_(
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
        );
        if drag_event.is_null() {
            return Err(anyhow!("failed to synthesize overlay drag event"));
        }
        let _: () = msg_send![parent, performWindowDragWithEvent: drag_event];
        Ok(())
    }

    pub(super) fn is_main_thread(_overlay: Option<&WebviewWindow>) -> bool {
        unsafe {
            let is_main: BOOL = msg_send![class!(NSThread), isMainThread];
            is_main != NO
        }
    }

    pub(super) fn reconcile(
        app: &AppHandle,
        overlay: Option<&WebviewWindow>,
        desired: &OverlayHitDesiredState,
        native: &mut NativeState,
    ) -> Result<()> {
        let Some(overlay) = overlay else {
            hide_panels(native);
            return Ok(());
        };
        let parent = overlay
            .ns_window()
            .context("failed to get overlay NSWindow")? as id;
        if parent.is_null() {
            hide_panels(native);
            return Ok(());
        }

        let parent_visible: BOOL = unsafe { msg_send![parent, isVisible] };
        let active =
            desired.visible && !desired.locked && !desired.rects.is_empty() && parent_visible != NO;
        if !active {
            hide_panels(native);
            if desired.rects.is_empty() {
                resize_panel_pool(app, parent, &desired.rects, native)?;
            }
            return Ok(());
        }
        resize_panel_pool(app, parent, &desired.rects, native)?;

        for (panel, rect) in native.panels.iter_mut().zip(&desired.rects) {
            panel.context.parent = parent as usize;
            panel.context.rect = *rect;
            let frame = panel_frame(parent, rect)?;
            unsafe {
                let panel_id = panel.panel as id;
                let view_id = panel.view as id;
                let current_parent: id = msg_send![panel_id, parentWindow];
                if current_parent != parent {
                    if !current_parent.is_null() {
                        let _: () = msg_send![current_parent, removeChildWindow: panel_id];
                    }
                    let _: () =
                        msg_send![parent, addChildWindow: panel_id ordered: NS_WINDOW_ABOVE];
                }
                let parent_level: NSInteger = msg_send![parent, level];
                let _: () = msg_send![panel_id, setLevel: parent_level];
                let _: () = msg_send![panel_id, setFrame: frame display: NO];
                let _: () = msg_send![panel_id, setIgnoresMouseEvents: NO];
                let _: () = msg_send![panel_id, invalidateCursorRectsForView: view_id];
                if active {
                    panel.context.active = true;
                    let _: () = msg_send![panel_id, orderFront: nil];
                } else {
                    panel.context.active = false;
                    let _: () = msg_send![panel_id, orderOut: nil];
                }
            }
        }
        Ok(())
    }

    fn resize_panel_pool(
        app: &AppHandle,
        parent: id,
        rects: &[OverlayHitRect],
        native: &mut NativeState,
    ) -> Result<()> {
        while native.panels.len() > rects.len() {
            if let Some(panel) = native.panels.pop() {
                destroy_panel(panel);
            }
        }
        while native.panels.len() < rects.len() {
            let rect = rects[native.panels.len()];
            native.panels.push(create_panel(app, parent, rect)?);
        }
        Ok(())
    }

    fn create_panel(app: &AppHandle, parent: id, rect: OverlayHitRect) -> Result<HitPanel> {
        let frame = panel_frame(parent, &rect)?;
        let mut context = Box::new(HitContext {
            app: app.clone(),
            parent: parent as usize,
            rect,
            active: false,
        });
        unsafe {
            let panel: id = msg_send![HIT_PANEL_CLASS.0, alloc];
            let panel: id = msg_send![panel,
                initWithContentRect: frame
                styleMask: NS_NONACTIVATING_PANEL_MASK
                backing: NSBackingStoreBuffered
                defer: NO
            ];
            if panel.is_null() {
                return Err(anyhow!("failed to create overlay hit NSPanel"));
            }

            let view_frame = NSRect::new(NSPoint::new(0.0, 0.0), frame.size);
            let view: id = msg_send![HIT_VIEW_CLASS.0, alloc];
            let view: id = msg_send![view, initWithFrame: view_frame];
            if view.is_null() {
                let _: () = msg_send![panel, release];
                return Err(anyhow!("failed to create overlay hit NSView"));
            }
            let context_pointer = (&mut *context as *mut HitContext).cast::<c_void>();
            (*view).set_ivar(HIT_CONTEXT_IVAR, context_pointer);

            let clear_color: id = msg_send![class!(NSColor), clearColor];
            let _: () = msg_send![panel, setOpaque: NO];
            let _: () = msg_send![panel, setBackgroundColor: clear_color];
            let _: () = msg_send![panel, setHasShadow: NO];
            let _: () = msg_send![panel, setReleasedWhenClosed: NO];
            let _: () = msg_send![panel, setHidesOnDeactivate: NO];
            let _: () = msg_send![panel, setBecomesKeyOnlyIfNeeded: YES];
            let _: () = msg_send![panel, setAcceptsMouseMovedEvents: YES];
            let _: () = msg_send![panel, setIgnoresMouseEvents: NO];
            let _: () = msg_send![view, setAlphaValue: 0.0_f64];
            let _: () = msg_send![panel, setContentView: view];
            let _: () = msg_send![view, release];
            let _: () = msg_send![parent, addChildWindow: panel ordered: NS_WINDOW_ABOVE];

            Ok(HitPanel {
                panel: panel as usize,
                view: view as usize,
                context,
            })
        }
    }

    fn panel_frame(parent: id, rect: &OverlayHitRect) -> Result<NSRect> {
        unsafe {
            let content_view: id = msg_send![parent, contentView];
            if content_view.is_null() {
                return Err(anyhow!("overlay content view is unavailable"));
            }
            let content_bounds: NSRect = msg_send![content_view, bounds];
            let local_frame = NSRect::new(
                NSPoint::new(rect.x, content_bounds.size.height - rect.y - rect.height),
                NSSize::new(rect.width, rect.height),
            );
            let window_frame: NSRect =
                msg_send![content_view, convertRect: local_frame toView: nil];
            let screen_frame: NSRect = msg_send![parent, convertRectToScreen: window_frame];
            Ok(screen_frame)
        }
    }

    fn hide_panels(native: &mut NativeState) {
        for panel in &mut native.panels {
            panel.context.parent = 0;
            panel.context.active = false;
            unsafe {
                let panel_id = panel.panel as id;
                let _: () = msg_send![panel_id, setIgnoresMouseEvents: YES];
                let _: () = msg_send![panel_id, orderOut: nil];
            }
        }
    }

    fn destroy_panel(panel: HitPanel) {
        unsafe {
            let panel_id = panel.panel as id;
            let view_id = panel.view as id;
            (*view_id).set_ivar(HIT_CONTEXT_IVAR, std::ptr::null_mut::<c_void>());
            let parent: id = msg_send![panel_id, parentWindow];
            if !parent.is_null() {
                let _: () = msg_send![parent, removeChildWindow: panel_id];
            }
            let _: () = msg_send![panel_id, orderOut: nil];
            let _: () = msg_send![panel_id, close];
            let _: () = msg_send![panel_id, release];
        }
    }

    #[cfg(test)]
    pub(super) fn register_classes_for_test() {
        Lazy::force(&HIT_PANEL_CLASS);
        Lazy::force(&HIT_VIEW_CLASS);
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use std::{
        ffi::c_void,
        mem::size_of,
        panic::{catch_unwind, AssertUnwindSafe},
        sync::atomic::{AtomicBool, AtomicUsize, Ordering},
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
                ClientToScreen, CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn,
                ValidateRect, HGDIOBJ, RGN_OR,
            },
            System::{LibraryLoader::GetModuleHandleW, Threading::GetCurrentThreadId},
            UI::{
                HiDpi::GetDpiForWindow,
                Input::KeyboardAndMouse::ReleaseCapture,
                Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
                WindowsAndMessaging::{
                    CreateWindowExW, DefWindowProcW, DestroyWindow, GetClientRect, GetCursorPos,
                    GetWindowLongPtrW, GetWindowThreadProcessId, IsWindow, IsWindowVisible,
                    LoadCursorW, PostMessageW, RegisterClassExW, SetCursor, SetWindowLongPtrW,
                    SetWindowPos, ShowWindow, CREATESTRUCTW, GWLP_USERDATA, HTCAPTION,
                    HWND_NOTOPMOST, HWND_TOPMOST, IDC_SIZEALL, MA_NOACTIVATE, SWP_NOACTIVATE,
                    SWP_NOOWNERZORDER, SWP_NOZORDER, SWP_SHOWWINDOW, SW_HIDE, WM_DPICHANGED,
                    WM_ERASEBKGND, WM_LBUTTONDOWN, WM_MOUSEACTIVATE, WM_MOVE, WM_MOVING,
                    WM_NCCREATE, WM_NCDESTROY, WM_NCLBUTTONDOWN, WM_PAINT, WM_RBUTTONUP,
                    WM_SETCURSOR, WM_SHOWWINDOW, WM_SIZE, WM_WINDOWPOSCHANGED, WNDCLASSEXW,
                    WS_EX_NOACTIVATE, WS_EX_NOREDIRECTIONBITMAP, WS_EX_TOOLWINDOW, WS_POPUP,
                },
            },
        },
    };

    use super::{
        OverlayHitContextMenuPayload, OverlayHitDesiredState, OverlayHitRect, OVERLAY_LABEL,
    };

    const PARENT_SUBCLASS_ID: usize = 0x444d_4849;
    const APPLY_MOVING_RECT_REFRESH: bool = false;

    #[derive(Default)]
    pub(super) struct NativeState {
        context: Option<Box<HitContext>>,
    }

    struct HitContext {
        app: AppHandle,
        parent: AtomicUsize,
        hit: AtomicUsize,
        rects: RwLock<Vec<OverlayHitRect>>,
        active: AtomicBool,
        always_on_top: AtomicBool,
    }

    pub(super) fn is_main_thread(overlay: Option<&WebviewWindow>) -> bool {
        let Some(overlay) = overlay else {
            return false;
        };
        let Ok(hwnd) = overlay.hwnd() else {
            return false;
        };
        unsafe { GetWindowThreadProcessId(hwnd, None) == GetCurrentThreadId() }
    }

    pub(super) fn reconcile(
        app: &AppHandle,
        overlay: Option<&WebviewWindow>,
        desired: &OverlayHitDesiredState,
        native: &mut NativeState,
    ) -> Result<()> {
        let Some(overlay) = overlay else {
            hide_native(native);
            return Ok(());
        };
        let parent = overlay.hwnd().context("failed to get overlay HWND")?;
        ensure_native(app, parent, native)?;
        let context = native
            .context
            .as_ref()
            .ok_or_else(|| anyhow!("overlay hit HWND context is unavailable"))?;
        *context.rects.write() = desired.rects.clone();
        context.active.store(
            desired.visible && !desired.locked && !desired.rects.is_empty(),
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
                    WM_MOVING if APPLY_MOVING_RECT_REFRESH && lparam.0 != 0 => {
                        let suggested = &*(lparam.0 as *const RECT);
                        let _ = SetWindowPos(
                            window,
                            None,
                            suggested.left,
                            suggested.top,
                            suggested.right - suggested.left,
                            suggested.bottom - suggested.top,
                            SWP_NOACTIVATE | SWP_NOZORDER,
                        );
                    }
                    WM_MOVE | WM_SIZE | WM_DPICHANGED | WM_SHOWWINDOW | WM_WINDOWPOSCHANGED => {
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

    unsafe fn sync_hit_window(context: &HitContext) -> Result<()> {
        let parent = hwnd(context.parent.load(Ordering::Acquire));
        let hit = hwnd(context.hit.load(Ordering::Acquire));
        if !IsWindow(Some(parent)).as_bool() || !IsWindow(Some(hit)).as_bool() {
            return Ok(());
        }
        if !context.active.load(Ordering::Acquire) || !IsWindowVisible(parent).as_bool() {
            let _ = ShowWindow(hit, SW_HIDE);
            return Ok(());
        }

        let mut client = RECT::default();
        GetClientRect(parent, &mut client).context("failed to read overlay client rect")?;
        let width = client.right - client.left;
        let height = client.bottom - client.top;
        if width <= 0 || height <= 0 {
            let _ = ShowWindow(hit, SW_HIDE);
            return Ok(());
        }
        let mut origin = POINT::default();
        if !ClientToScreen(parent, &mut origin).as_bool() {
            return Err(WindowsError::from_win32().into());
        }

        if !apply_hit_region(context, hit, width, height)? {
            let _ = ShowWindow(hit, SW_HIDE);
            return Ok(());
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
        Ok(())
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
        let scale = f64::from(GetDpiForWindow(hwnd(
            context.parent.load(Ordering::Acquire),
        ))) / 96.0;
        let scale = if scale.is_finite() && scale > 0.0 {
            scale
        } else {
            1.0
        };
        let mut region_count = 0usize;
        for rect in context.rects.read().iter() {
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
            let _ = DeleteObject(HGDIOBJ(union.0));
            return Ok(false);
        }
        if SetWindowRgn(hit, Some(union), false) == 0 {
            let _ = DeleteObject(HGDIOBJ(union.0));
            return Err(WindowsError::from_win32().into());
        }
        Ok(true)
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
                let _ =
                    RemoveWindowSubclass(parent, Some(parent_subclass_proc), PARENT_SUBCLASS_ID);
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
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
mod platform {
    use anyhow::Result;
    use tauri::{AppHandle, WebviewWindow};

    use super::OverlayHitDesiredState;

    #[derive(Default)]
    pub(super) struct NativeState;

    pub(super) fn is_main_thread(_overlay: Option<&WebviewWindow>) -> bool {
        true
    }

    pub(super) fn reconcile(
        _app: &AppHandle,
        _overlay: Option<&WebviewWindow>,
        _desired: &OverlayHitDesiredState,
        _native: &mut NativeState,
    ) -> Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{validate_hit_rects, OverlayHitDesiredState, OverlayHitRect, MAX_HIT_RECTS};

    fn desired_state() -> OverlayHitDesiredState {
        OverlayHitDesiredState {
            rects: Vec::new(),
            last_revision: None,
            visible: true,
            locked: false,
            always_on_top: true,
        }
    }

    fn rect(x: f64) -> OverlayHitRect {
        OverlayHitRect {
            x,
            y: 0.0,
            width: 10.0,
            height: 10.0,
        }
    }

    #[test]
    fn hit_region_revision_only_accepts_newer_values() {
        let mut desired = desired_state();
        assert!(desired.apply_regions(vec![rect(1.0)], 10));
        assert!(!desired.apply_regions(vec![rect(2.0)], 10));
        assert!(!desired.apply_regions(vec![rect(3.0)], 9));
        assert_eq!(desired.rects, vec![rect(1.0)]);
        assert!(desired.apply_regions(vec![rect(4.0)], 11));
        assert_eq!(desired.rects, vec![rect(4.0)]);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_hit_classes_register() {
        super::platform::register_classes_for_test();
    }

    #[test]
    fn hit_rect_validation_accepts_finite_positive_rects() {
        assert!(validate_hit_rects(&[OverlayHitRect {
            x: -10.0,
            y: 20.0,
            width: 30.0,
            height: 40.0,
        }])
        .is_ok());
    }

    #[test]
    fn hit_rect_validation_rejects_non_positive_dimensions() {
        assert!(validate_hit_rects(&[OverlayHitRect {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 10.0,
        }])
        .is_err());
    }

    #[test]
    fn hit_rect_validation_rejects_excessive_count() {
        let rect = OverlayHitRect {
            x: 0.0,
            y: 0.0,
            width: 10.0,
            height: 10.0,
        };
        assert!(validate_hit_rects(&vec![rect; MAX_HIT_RECTS + 1]).is_err());
    }
}
