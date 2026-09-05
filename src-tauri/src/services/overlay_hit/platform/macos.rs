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
    clip_hit_rect_to_bounds, hit_region_status, HitRegionStatus, OverlayHitContextMenuPayload,
    OverlayHitDesiredState, OverlayHitRect, OVERLAY_LABEL,
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
        // performWindowDragWithEvent는 모달 이벤트 루프를 돈다 - 그 사이 창 이동이
        // reconcile을 재진입시켜 이 컨텍스트를 덮어쓰거나 패널을 해제할 수 있으므로
        // 필요한 값만 복사해 참조를 놓고 호출한다
        let drag_target = hit_context(this)
            .filter(|context| context.active)
            .map(|context| (context.parent, context.rect));
        if let Some((parent, rect)) = drag_target {
            if let Err(error) = start_parent_drag(parent, rect, event) {
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
        if let Err(error) = context
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

unsafe fn start_parent_drag(parent: usize, rect: OverlayHitRect, source_event: id) -> Result<()> {
    if source_event.is_null() || parent == 0 {
        return Err(anyhow!("overlay hit drag context is unavailable"));
    }
    let parent = parent as id;
    let content_view: id = msg_send![parent, contentView];
    if content_view.is_null() {
        return Err(anyhow!("overlay content view is unavailable"));
    }

    let panel_location: NSPoint = msg_send![source_event, locationInWindow];
    let client_x = rect.x + panel_location.x;
    let client_y = rect.y + rect.height - panel_location.y;
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

pub(super) fn parent_identity(overlay: Option<&WebviewWindow>) -> Result<Option<usize>> {
    let Some(overlay) = overlay else {
        return Ok(None);
    };
    let parent = overlay
        .ns_window()
        .context("failed to get overlay NSWindow")? as id;
    if parent.is_null() {
        return Err(anyhow!("overlay NSWindow is unavailable"));
    }
    Ok(Some(parent as usize))
}

pub(super) fn reconcile(
    app: &AppHandle,
    overlay: Option<&WebviewWindow>,
    desired: &OverlayHitDesiredState,
    native: &mut NativeState,
) -> Result<HitRegionStatus> {
    let Some(overlay) = overlay else {
        hide_panels(native);
        return Ok(HitRegionStatus::Applied);
    };
    let parent = overlay
        .ns_window()
        .context("failed to get overlay NSWindow")? as id;
    if parent.is_null() {
        hide_panels(native);
        return Ok(HitRegionStatus::Applied);
    }

    let parent_visible: BOOL = unsafe { msg_send![parent, isVisible] };
    // 프론트가 "키 0개"를 확정 보고했으면 콘텐츠 전체를 잡는다 - 모든 키를 숨기거나
    // 커스텀 CSS로 지웠을 때 창을 옮길 수도 우클릭할 수도 없게 되는 것을 막는다.
    // 첫 측정 전(last_revision == None)에는 그대로 클릭 통과
    let clipped_rects = if desired.rects.is_empty() {
        if desired.last_revision.is_some() {
            let (content_width, content_height) = content_size(parent)?;
            vec![OverlayHitRect {
                x: 0.0,
                y: 0.0,
                width: content_width,
                height: content_height,
            }]
        } else {
            Vec::new()
        }
    } else {
        let (content_width, content_height) = content_size(parent)?;
        desired
            .rects
            .iter()
            .filter_map(|rect| clip_hit_rect_to_bounds(*rect, content_width, content_height))
            .collect::<Vec<_>>()
    };
    let active =
        desired.visible && !desired.locked && !clipped_rects.is_empty() && parent_visible != NO;
    if !active {
        hide_panels(native);
        if clipped_rects.is_empty() {
            resize_panel_pool(app, parent, &clipped_rects, native)?;
        }
        if desired.visible && !desired.locked && parent_visible != NO {
            return Ok(hit_region_status(
                desired.rects.is_empty(),
                clipped_rects.len(),
            ));
        }
        return Ok(HitRegionStatus::Applied);
    }
    resize_panel_pool(app, parent, &clipped_rects, native)?;

    for (panel, rect) in native.panels.iter_mut().zip(&clipped_rects) {
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
                let _: () = msg_send![parent, addChildWindow: panel_id ordered: NS_WINDOW_ABOVE];
            }
            let parent_level: NSInteger = msg_send![parent, level];
            let _: () = msg_send![panel_id, setLevel: parent_level];
            let _: () = msg_send![panel_id, setFrame: frame display: NO];
            let _: () = msg_send![panel_id, setIgnoresMouseEvents: NO];
            let _: () = msg_send![panel_id, invalidateCursorRectsForView: view_id];
            panel.context.active = true;
            let _: () = msg_send![panel_id, orderFront: nil];
        }
    }
    Ok(HitRegionStatus::Applied)
}

fn content_size(parent: id) -> Result<(f64, f64)> {
    unsafe {
        let content_view: id = msg_send![parent, contentView];
        if content_view.is_null() {
            return Err(anyhow!("overlay content view is unavailable"));
        }
        let content_bounds: NSRect = msg_send![content_view, bounds];
        Ok((content_bounds.size.width, content_bounds.size.height))
    }
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
        let window_frame: NSRect = msg_send![content_view, convertRect: local_frame toView: nil];
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
