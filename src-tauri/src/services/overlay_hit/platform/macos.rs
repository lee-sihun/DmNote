use std::{
    os::raw::c_void,
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{
        atomic::{AtomicBool, Ordering},
        Weak,
    },
};

use anyhow::{anyhow, Context, Result};
use cocoa::{
    appkit::{NSBackingStoreBuffered, NSEvent, NSEventType},
    base::{id, nil, BOOL, NO, YES},
    foundation::{NSInteger, NSPoint, NSRect, NSSize, NSString},
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
    OverlayHitDesiredState, OverlayHitRect, OverlayHitService, OverlayHitServiceInner,
    OVERLAY_LABEL,
};

const HIT_CONTEXT_IVAR: &str = "dmNoteOverlayHitContext";
const PARENT_OBSERVER_IVAR: &str = "dmNoteOverlayParentObserverContext";
const NS_NONACTIVATING_PANEL_MASK: u64 = 1 << 7;
const NS_WINDOW_ABOVE: i64 = 1;
const NS_WINDOW_ANIMATION_NONE: NSInteger = 2;

#[derive(Default)]
pub(super) struct NativeState {
    panels: Vec<HitPanel>,
    owner: Weak<OverlayHitServiceInner>,
    observer: Option<ParentObserver>,
    needs_reorder: bool,
}

struct HitPanel {
    panel: usize,
    view: usize,
    context: Box<HitContext>,
    frame: NSRect,
    level: Option<NSInteger>,
    collection_behavior: Option<u64>,
}

struct ParentObserver {
    object: usize,
    parent: usize,
    _context: Box<ParentObserverContext>,
}

struct ParentObserverContext {
    app: AppHandle,
    owner: Weak<OverlayHitServiceInner>,
    queued: AtomicBool,
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

static PARENT_OBSERVER_CLASS: Lazy<ObjectiveCClass> = Lazy::new(|| unsafe {
    if let Some(class) = Class::get("DmNoteOverlayParentObserver") {
        return ObjectiveCClass(class);
    }
    let mut declaration = ClassDecl::new("DmNoteOverlayParentObserver", class!(NSObject))
        .expect("overlay parent observer class");
    declaration.add_method(
        sel!(parentStateChanged:),
        parent_state_changed as extern "C" fn(&Object, Sel, id),
    );
    declaration.add_method(
        sel!(reconcileParent:),
        reconcile_parent as extern "C" fn(&Object, Sel, id),
    );
    declaration.add_ivar::<*mut c_void>(PARENT_OBSERVER_IVAR);
    ObjectiveCClass(declaration.register())
});

extern "C" fn parent_state_changed(this: &Object, _selector: Sel, _notification: id) {
    let _ = catch_unwind(AssertUnwindSafe(|| unsafe {
        let pointer: *mut c_void = *this.get_ivar(PARENT_OBSERVER_IVAR);
        let Some(context) = pointer.cast::<ParentObserverContext>().as_ref() else {
            return;
        };
        if context.queued.swap(true, Ordering::AcqRel) {
            return;
        }
        // AppKit 알림은 창 정산 중에도 발생하므로 다음 공통 실행 루프에서 처리
        let _: () = msg_send![this,
            performSelectorOnMainThread: sel!(reconcileParent:)
            withObject: nil
            waitUntilDone: NO
        ];
    }));
}

extern "C" fn reconcile_parent(this: &Object, _selector: Sel, _argument: id) {
    let _ = catch_unwind(AssertUnwindSafe(|| {
        let (owner, app) = unsafe {
            let pointer: *mut c_void = *this.get_ivar(PARENT_OBSERVER_IVAR);
            let Some(context) = pointer.cast::<ParentObserverContext>().as_ref() else {
                return;
            };
            context.queued.store(false, Ordering::Release);
            (context.owner.upgrade(), context.app.clone())
        };
        if let Some(inner) = owner {
            if let Err(error) = (OverlayHitService { inner }).reconcile_after_parent_order(&app) {
                log::warn!("failed to follow macOS overlay parent state: {error:#}");
            }
        }
    }));
}

impl ParentObserver {
    fn new(app: &AppHandle, parent: id, owner: Weak<OverlayHitServiceInner>) -> Result<Self> {
        let mut context = Box::new(ParentObserverContext {
            app: app.clone(),
            owner,
            queued: AtomicBool::new(false),
        });
        unsafe {
            let object: id = msg_send![PARENT_OBSERVER_CLASS.0, new];
            if object.is_null() {
                return Err(anyhow!("failed to create overlay parent observer"));
            }
            (*object).set_ivar(
                PARENT_OBSERVER_IVAR,
                (&mut *context as *mut ParentObserverContext).cast::<c_void>(),
            );
            let center: id = msg_send![class!(NSNotificationCenter), defaultCenter];
            add_observer(
                center,
                object,
                "NSWindowDidChangeOcclusionStateNotification",
                parent,
            );
            let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
            let center: id = msg_send![workspace, notificationCenter];
            for name in [
                "NSWorkspaceActiveSpaceDidChangeNotification",
                "NSWorkspaceDidActivateApplicationNotification",
            ] {
                add_observer(center, object, name, nil);
            }
            Ok(Self {
                object: object as usize,
                parent: parent as usize,
                _context: context,
            })
        }
    }
}

impl Drop for ParentObserver {
    fn drop(&mut self) {
        unsafe {
            let object = self.object as id;
            let center: id = msg_send![class!(NSNotificationCenter), defaultCenter];
            let _: () = msg_send![center, removeObserver: object];
            let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
            let center: id = msg_send![workspace, notificationCenter];
            let _: () = msg_send![center, removeObserver: object];
            // 이미 예약된 선택자는 객체를 유지하므로 컨텍스트만 먼저 해제
            (*object).set_ivar(PARENT_OBSERVER_IVAR, std::ptr::null_mut::<c_void>());
            let _: () = msg_send![object, release];
        }
    }
}

unsafe fn add_observer(center: id, observer: id, name: &str, object: id) {
    let name = NSString::alloc(nil).init_str(name);
    let _: () = msg_send![center,
        addObserver: observer
        selector: sel!(parentStateChanged:)
        name: name
        object: object
    ];
    let _: () = msg_send![name, release];
}

pub(super) fn set_owner(native: &mut NativeState, owner: Weak<OverlayHitServiceInner>) {
    native.owner = owner;
}

pub(super) fn request_reorder(native: &mut NativeState) {
    native.needs_reorder = true;
}

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
        native.observer = None;
        hide_panels(native);
        return Ok(HitRegionStatus::Applied);
    };
    let parent = overlay
        .ns_window()
        .context("failed to get overlay NSWindow")? as id;
    if parent.is_null() {
        native.observer = None;
        hide_panels(native);
        return Ok(HitRegionStatus::Applied);
    }

    if native.observer.as_ref().map(|observer| observer.parent) != Some(parent as usize) {
        native.observer = Some(ParentObserver::new(app, parent, native.owner.clone())?);
        native.needs_reorder = true;
    }
    let parent_visible: BOOL = unsafe { msg_send![parent, isVisible] };
    let parent_on_space: BOOL = unsafe { msg_send![parent, isOnActiveSpace] };
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
    let parent_available = parent_visible != NO && parent_on_space != NO;
    let active =
        desired.visible && !desired.locked && !clipped_rects.is_empty() && parent_available;
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
    let (parent_level, parent_behavior, parent_number): (NSInteger, u64, NSInteger) = unsafe {
        (
            msg_send![parent, level],
            msg_send![parent, collectionBehavior],
            msg_send![parent, windowNumber],
        )
    };
    let collection_behavior = hit_panel_collection_behavior(parent_behavior);

    for (panel, rect) in native.panels.iter_mut().zip(&clipped_rects) {
        panel.context.parent = parent as usize;
        panel.context.rect = *rect;
        let frame = panel_frame(parent, rect)?;
        unsafe {
            let panel_id = panel.panel as id;
            let view_id = panel.view as id;
            let reorder = native.needs_reorder
                || !panel.context.active
                || panel.level != Some(parent_level)
                || panel.collection_behavior != Some(collection_behavior);
            if panel.level != Some(parent_level) {
                let _: () = msg_send![panel_id, setLevel: parent_level];
                panel.level = Some(parent_level);
            }
            if panel.collection_behavior != Some(collection_behavior) {
                let _: () = msg_send![panel_id, setCollectionBehavior: collection_behavior];
                panel.collection_behavior = Some(collection_behavior);
            }
            if panel.frame.origin.x != frame.origin.x
                || panel.frame.origin.y != frame.origin.y
                || panel.frame.size.width != frame.size.width
                || panel.frame.size.height != frame.size.height
                || !panel.context.active
            {
                let _: () = msg_send![panel_id, setFrame: frame display: NO];
                let _: () = msg_send![panel_id, invalidateCursorRectsForView: view_id];
                panel.frame = frame;
            }
            if !panel.context.active {
                let _: () = msg_send![panel_id, setIgnoresMouseEvents: NO];
            }
            panel.context.active = true;
            if reorder {
                // 자식 창 그룹과 중복 정렬은 회전 띠의 대량 정리 비용을 키움
                let _: () =
                    msg_send![panel_id, orderWindow: NS_WINDOW_ABOVE relativeTo: parent_number];
            }
        }
    }
    native.needs_reorder = false;
    Ok(HitRegionStatus::Applied)
}

fn hit_panel_collection_behavior(parent_behavior: u64) -> u64 {
    let managed_stationary_cycle = (1 << 2) | (1 << 4) | (1 << 5);
    let transient_ignores_cycle = (1 << 3) | (1 << 6);
    (parent_behavior & !managed_stationary_cycle) | transient_ignores_cycle
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
        let _: () = msg_send![panel, setAnimationBehavior: NS_WINDOW_ANIMATION_NONE];
        let _: () = msg_send![panel, setReleasedWhenClosed: NO];
        let _: () = msg_send![panel, setHidesOnDeactivate: NO];
        let _: () = msg_send![panel, setIgnoresMouseEvents: NO];
        let _: () = msg_send![view, setAlphaValue: 0.0_f64];
        let _: () = msg_send![panel, setContentView: view];
        let _: () = msg_send![view, release];
        Ok(HitPanel {
            panel: panel as usize,
            view: view as usize,
            context,
            frame,
            level: None,
            collection_behavior: None,
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
        if !panel.context.active {
            continue;
        }
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
        let _: () = msg_send![panel_id, orderOut: nil];
        let _: () = msg_send![panel_id, close];
        let _: () = msg_send![panel_id, release];
    }
}

#[cfg(test)]
pub(super) fn register_classes_for_test() {
    Lazy::force(&HIT_PANEL_CLASS);
    Lazy::force(&HIT_VIEW_CLASS);
    Lazy::force(&PARENT_OBSERVER_CLASS);
}

#[cfg(test)]
mod tests {
    use super::hit_panel_collection_behavior;

    #[test]
    fn hit_panels_follow_parent_spaces_without_joining_window_cycles() {
        let spaces_and_fullscreen = (1 << 0) | (1 << 8);
        let managed_stationary_cycle = (1 << 2) | (1 << 4) | (1 << 5);
        let transient_ignores_cycle = (1 << 3) | (1 << 6);
        for parent in [
            spaces_and_fullscreen,
            spaces_and_fullscreen | managed_stationary_cycle,
        ] {
            let behavior = hit_panel_collection_behavior(parent);
            assert_eq!(behavior & spaces_and_fullscreen, spaces_and_fullscreen);
            assert_eq!(behavior & managed_stationary_cycle, 0);
            assert_eq!(behavior & transient_ignores_cycle, transient_ignores_cycle);
        }
    }
}
