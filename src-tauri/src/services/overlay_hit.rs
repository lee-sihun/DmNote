use std::{
    sync::Arc,
    thread::{self, ThreadId},
    time::Duration,
};

use anyhow::{anyhow, Context, Result};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

const OVERLAY_LABEL: &str = "overlay";
const MAX_HIT_RECTS: usize = 4_096;
const HIT_RESYNC_EVENT: &str = "overlay:hit-resync";
const PROBE_DELAYS_MS: [u64; 5] = [100, 250, 500, 1_000, 5_000];

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

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum HitResyncReason {
    ParentChanged,
    ScaleChanged,
    RegionClipped,
    RendererReady,
    Probe,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct HitResyncPayload {
    epoch: u64,
    reason: HitResyncReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HitRegionStatus {
    Applied,
    FullyClipped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RegionSyncDecision {
    Applied,
    StaleRevision,
    LeaseMismatch,
}

impl RegionSyncDecision {
    fn accepted(self) -> bool {
        !matches!(self, Self::LeaseMismatch)
    }
}

#[derive(Clone)]
pub struct OverlayHitService {
    inner: Arc<OverlayHitServiceInner>,
}

struct OverlayHitServiceInner {
    desired: Mutex<OverlayHitDesiredState>,
    native: Mutex<platform::NativeState>,
    main_thread_id: ThreadId,
}

#[derive(Debug, Clone)]
struct OverlayHitDesiredState {
    rects: Vec<OverlayHitRect>,
    /// 웹뷰의 CSS px -> 물리 px 배율(devicePixelRatio).
    /// WebView2 보정 줌(접근성 텍스트 배율 상쇄)이 곱해진 실측값이라
    /// GetDpiForWindow만으로는 대신할 수 없다
    device_pixel_ratio: f64,
    last_revision: Option<u64>,
    parent: Option<usize>,
    visible: bool,
    locked: bool,
    always_on_top: bool,
    resync_epoch: u64,
    renderer_session: Option<String>,
    pending_resync: bool,
    probe_lease: Arc<()>,
}

impl OverlayHitDesiredState {
    fn apply_regions(
        &mut self,
        rects: Vec<OverlayHitRect>,
        revision: u64,
        device_pixel_ratio: f64,
    ) -> Result<bool> {
        if self
            .last_revision
            .is_some_and(|last_revision| revision <= last_revision)
        {
            return Ok(false);
        }
        validate_hit_rects(&rects)?;
        self.rects = rects;
        self.device_pixel_ratio = if device_pixel_ratio.is_finite() && device_pixel_ratio > 0.0 {
            device_pixel_ratio
        } else {
            1.0
        };
        self.last_revision = Some(revision);
        Ok(true)
    }

    fn apply_renderer_regions(
        &mut self,
        rects: Vec<OverlayHitRect>,
        revision: u64,
        device_pixel_ratio: f64,
        epoch: u64,
        renderer_session_id: &str,
    ) -> Result<RegionSyncDecision> {
        if epoch != self.resync_epoch
            || self.renderer_session.as_deref() != Some(renderer_session_id)
        {
            return Ok(RegionSyncDecision::LeaseMismatch);
        }
        if !self.apply_regions(rects, revision, device_pixel_ratio)? {
            return Ok(RegionSyncDecision::StaleRevision);
        }
        self.pending_resync = false;
        self.cancel_probe();
        Ok(RegionSyncDecision::Applied)
    }

    fn observe_parent(&mut self, parent: Option<usize>) -> bool {
        let parent_lost = self.parent.is_some() && parent.is_none();
        let orphaned_measurement = self.parent.is_none()
            && parent.is_none()
            && (self.last_revision.is_some() || !self.rects.is_empty());
        let parent_replaced = matches!(
            (self.parent, parent),
            (Some(previous), Some(current)) if previous != current
        );
        self.parent = parent;
        parent_lost || parent_replaced || orphaned_measurement
    }

    fn mark_parent_absent(&mut self) {
        self.parent = None;
    }

    fn reset_regions(&mut self) -> bool {
        if self.rects.is_empty() && self.last_revision.is_none() {
            return false;
        }
        self.rects.clear();
        self.last_revision = None;
        true
    }

    fn invalidate(&mut self, revoke_renderer: bool) -> Result<u64> {
        self.reset_regions();
        self.pending_resync = true;
        self.cancel_probe();
        if revoke_renderer {
            self.renderer_session = None;
        }
        let Some(next_epoch) = self.resync_epoch.checked_add(1) else {
            self.renderer_session = None;
            log::error!("[OverlayHit] resync epoch overflow; renderer lease revoked");
            return Err(anyhow!("overlay hit resync epoch overflow"));
        };
        self.resync_epoch = next_epoch;
        Ok(next_epoch)
    }

    fn renew_renderer_session(&mut self, renderer_session_id: String) -> Result<u64> {
        let epoch = self.invalidate(true)?;
        self.renderer_session = Some(renderer_session_id);
        Ok(epoch)
    }

    fn can_probe(&self) -> bool {
        self.visible && !self.locked && self.renderer_session.is_some() && self.pending_resync
    }

    fn cancel_probe(&mut self) {
        self.probe_lease = Arc::new(());
    }
}

impl OverlayHitService {
    pub fn new(visible: bool, locked: bool, always_on_top: bool) -> Self {
        Self {
            inner: Arc::new(OverlayHitServiceInner {
                desired: Mutex::new(OverlayHitDesiredState {
                    rects: Vec::new(),
                    device_pixel_ratio: 1.0,
                    last_revision: None,
                    parent: None,
                    visible,
                    locked,
                    always_on_top,
                    resync_epoch: 0,
                    renderer_session: None,
                    pending_resync: true,
                    probe_lease: Arc::new(()),
                }),
                native: Mutex::new(platform::NativeState::default()),
                main_thread_id: thread::current().id(),
            }),
        }
    }

    pub fn sync_regions(
        &self,
        app: &AppHandle,
        rects: Vec<OverlayHitRect>,
        revision: u64,
        device_pixel_ratio: f64,
        epoch: u64,
        renderer_session_id: String,
    ) -> Result<bool> {
        let decision = {
            let mut desired = self.inner.desired.lock();
            desired.apply_renderer_regions(
                rects,
                revision,
                device_pixel_ratio,
                epoch,
                &renderer_session_id,
            )?
        };
        match decision {
            RegionSyncDecision::Applied => {
                self.reconcile(app)?;
                Ok(decision.accepted())
            }
            RegionSyncDecision::StaleRevision => {
                let desired = self.inner.desired.lock();
                log::debug!(
                    "[OverlayHit] stale revision ignored: revision={revision}, last={:?}",
                    desired.last_revision
                );
                Ok(decision.accepted())
            }
            RegionSyncDecision::LeaseMismatch => {
                log::debug!(
                    "[OverlayHit] stale renderer response ignored: epoch={epoch}, renderer_session_id={renderer_session_id}"
                );
                Ok(decision.accepted())
            }
        }
    }

    pub fn renderer_ready(&self, app: &AppHandle, renderer_session_id: String) -> Result<u64> {
        // ready 반환 epoch 보호를 위한 부모 교체 선반영
        self.reconcile(app)?;
        let epoch = self
            .inner
            .desired
            .lock()
            .renew_renderer_session(renderer_session_id)?;
        self.reconcile(app)?;
        self.restart_probe(app, HitResyncReason::RendererReady);
        Ok(epoch)
    }

    pub fn renderer_load_started(&self, app: &AppHandle) -> Result<()> {
        self.invalidate_and_reconcile(app, HitResyncReason::Probe, true)
    }

    pub fn invalidate_for_scale_change(&self, app: &AppHandle) -> Result<()> {
        self.invalidate_and_reconcile(app, HitResyncReason::ScaleChanged, false)
    }

    pub fn set_configuration(
        &self,
        app: &AppHandle,
        visible: bool,
        locked: bool,
        always_on_top: bool,
    ) -> Result<()> {
        let probe_gate_changed = {
            let mut desired = self.inner.desired.lock();
            let changed = desired.visible != visible || desired.locked != locked;
            desired.visible = visible;
            desired.locked = locked;
            desired.always_on_top = always_on_top;
            changed
        };
        self.reconcile(app)?;
        if probe_gate_changed {
            self.restart_probe(app, HitResyncReason::Probe);
        }
        Ok(())
    }

    pub fn set_visible(&self, app: &AppHandle, visible: bool) -> Result<()> {
        self.inner.desired.lock().visible = visible;
        self.reconcile(app)?;
        self.restart_probe(app, HitResyncReason::Probe);
        Ok(())
    }

    pub fn set_locked(&self, app: &AppHandle, locked: bool) -> Result<()> {
        self.inner.desired.lock().locked = locked;
        self.reconcile(app)?;
        self.restart_probe(app, HitResyncReason::Probe);
        Ok(())
    }

    pub fn set_always_on_top(&self, app: &AppHandle, always_on_top: bool) -> Result<()> {
        self.inner.desired.lock().always_on_top = always_on_top;
        self.reconcile(app)
    }

    pub fn reset_for_parent_loss(&self, app: &AppHandle) -> Result<()> {
        {
            let mut desired = self.inner.desired.lock();
            desired.mark_parent_absent();
            desired.invalidate(true)?;
        }
        self.reconcile(app)
    }

    pub fn reconcile(&self, app: &AppHandle) -> Result<()> {
        if is_current_thread(self.inner.main_thread_id) {
            return self.reconcile_on_main(app);
        }

        let service = self.clone();
        let app_handle = app.clone();
        app.run_on_main_thread(move || {
            if let Err(error) = service.reconcile_on_main(&app_handle) {
                log::warn!("failed to reconcile overlay hit windows on main thread: {error:#}");
            }
        })
        .context("failed to dispatch overlay hit reconciliation")
    }

    fn reconcile_on_main(&self, app: &AppHandle) -> Result<()> {
        let overlay = app.get_webview_window(OVERLAY_LABEL);
        let parent = platform::parent_identity(overlay.as_ref())?;
        let (desired, parent_changed) = {
            let mut desired = self.inner.desired.lock();
            let parent_changed = desired.observe_parent(parent);
            if parent_changed {
                desired.invalidate(false)?;
                log::debug!("[OverlayHit] parent changed; stale regions cleared");
            }
            (desired.clone(), parent_changed)
        };
        let mut native = self.inner.native.lock();
        let status = platform::reconcile(app, overlay.as_ref(), &desired, &mut native)?;
        drop(native);

        if parent_changed {
            self.restart_probe(app, HitResyncReason::ParentChanged);
        }
        if status == HitRegionStatus::FullyClipped {
            let invalidated = {
                let mut current = self.inner.desired.lock();
                if current.resync_epoch != desired.resync_epoch
                    || current.last_revision != desired.last_revision
                {
                    false
                } else {
                    current.invalidate(false)?;
                    true
                }
            };
            if invalidated {
                self.restart_probe(app, HitResyncReason::RegionClipped);
            }
        }
        Ok(())
    }

    fn invalidate_and_reconcile(
        &self,
        app: &AppHandle,
        reason: HitResyncReason,
        revoke_renderer: bool,
    ) -> Result<()> {
        self.inner.desired.lock().invalidate(revoke_renderer)?;
        self.reconcile(app)?;
        self.restart_probe(app, reason);
        Ok(())
    }

    fn restart_probe(&self, app: &AppHandle, reason: HitResyncReason) {
        let probe = {
            let mut desired = self.inner.desired.lock();
            desired.cancel_probe();
            if desired.can_probe() {
                Some((
                    desired.probe_lease.clone(),
                    HitResyncPayload {
                        epoch: desired.resync_epoch,
                        reason,
                    },
                ))
            } else {
                None
            }
        };
        let Some((lease, payload)) = probe else {
            return;
        };
        emit_resync(app, payload);
        self.schedule_probe(app.clone(), lease, 0);
    }

    fn schedule_probe(&self, app: AppHandle, lease: Arc<()>, delay_index: usize) {
        let service = self.clone();
        let delay = Duration::from_millis(probe_delay_ms(delay_index));
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(delay).await;
            service.run_probe(app, lease, delay_index.saturating_add(1));
        });
    }

    fn run_probe(&self, app: AppHandle, lease: Arc<()>, next_delay_index: usize) {
        let payload = {
            let desired = self.inner.desired.lock();
            if !Arc::ptr_eq(&desired.probe_lease, &lease) || !desired.can_probe() {
                return;
            }
            HitResyncPayload {
                epoch: desired.resync_epoch,
                reason: HitResyncReason::Probe,
            }
        };
        emit_resync(&app, payload);
        self.schedule_probe(app, lease, next_delay_index);
    }
}

fn emit_resync(app: &AppHandle, payload: HitResyncPayload) {
    if let Err(error) = app.emit(HIT_RESYNC_EVENT, payload) {
        log::warn!("[OverlayHit] failed to emit resync request: {error}");
    }
}

fn probe_delay_ms(index: usize) -> u64 {
    PROBE_DELAYS_MS[index.min(PROBE_DELAYS_MS.len() - 1)]
}

fn hit_region_status(measured_empty: bool, region_count: usize) -> HitRegionStatus {
    if !measured_empty && region_count == 0 {
        HitRegionStatus::FullyClipped
    } else {
        HitRegionStatus::Applied
    }
}

fn is_current_thread(expected: ThreadId) -> bool {
    thread::current().id() == expected
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

#[cfg(any(target_os = "macos", test))]
fn clip_hit_rect_to_bounds(
    rect: OverlayHitRect,
    content_width: f64,
    content_height: f64,
) -> Option<OverlayHitRect> {
    if !content_width.is_finite()
        || !content_height.is_finite()
        || content_width <= 0.0
        || content_height <= 0.0
    {
        return None;
    }
    let right = rect.x + rect.width;
    let bottom = rect.y + rect.height;
    if !right.is_finite() || !bottom.is_finite() {
        return None;
    }
    let left = rect.x.max(0.0);
    let top = rect.y.max(0.0);
    let right = right.min(content_width);
    let bottom = bottom.min(content_height);
    if right <= left || bottom <= top {
        return None;
    }
    Some(OverlayHitRect {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    })
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

    unsafe fn start_parent_drag(
        parent: usize,
        rect: OverlayHitRect,
        source_event: id,
    ) -> Result<()> {
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
                    let _: () =
                        msg_send![parent, addChildWindow: panel_id ordered: NS_WINDOW_ABOVE];
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
                ClientToScreen, CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn,
                ValidateRect, HGDIOBJ, RGN_OR,
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
                    CREATESTRUCTW, GWLP_USERDATA, HTCAPTION, HWND_NOTOPMOST, HWND_TOPMOST,
                    IDC_SIZEALL, MA_NOACTIVATE, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_SHOWWINDOW,
                    SW_HIDE, WM_CLOSE, WM_DPICHANGED, WM_ERASEBKGND, WM_LBUTTONDOWN,
                    WM_MOUSEACTIVATE, WM_NCCREATE, WM_NCDESTROY, WM_NCLBUTTONDOWN, WM_PAINT,
                    WM_RBUTTONUP, WM_SETCURSOR, WM_WINDOWPOSCHANGED, WNDCLASSEXW, WS_EX_NOACTIVATE,
                    WS_EX_NOREDIRECTIONBITMAP, WS_EX_TOOLWINDOW, WS_POPUP,
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

    use super::{HitRegionStatus, OverlayHitDesiredState};

    #[derive(Default)]
    pub(super) struct NativeState;

    pub(super) fn parent_identity(overlay: Option<&WebviewWindow>) -> Result<Option<usize>> {
        Ok(overlay.map(|_| 1))
    }

    pub(super) fn reconcile(
        _app: &AppHandle,
        _overlay: Option<&WebviewWindow>,
        _desired: &OverlayHitDesiredState,
        _native: &mut NativeState,
    ) -> Result<HitRegionStatus> {
        Ok(HitRegionStatus::Applied)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        clip_hit_rect_to_bounds, hit_region_status, probe_delay_ms, validate_hit_rects,
        HitRegionStatus, OverlayHitDesiredState, OverlayHitRect, RegionSyncDecision, MAX_HIT_RECTS,
    };
    use std::sync::Arc;

    fn desired_state() -> OverlayHitDesiredState {
        OverlayHitDesiredState {
            rects: Vec::new(),
            device_pixel_ratio: 1.0,
            last_revision: None,
            parent: None,
            visible: true,
            locked: false,
            always_on_top: true,
            resync_epoch: 0,
            renderer_session: None,
            pending_resync: true,
            probe_lease: Arc::new(()),
        }
    }

    // 보정 줌이 곱해진 실측 배율만 채택하고, 비정상값은 1.0으로 떨어뜨린다
    #[test]
    fn device_pixel_ratio_is_adopted_and_sanitized() {
        let mut desired = desired_state();

        assert!(desired.apply_regions(vec![rect(1.0)], 1, 1.25).unwrap());
        assert_eq!(desired.device_pixel_ratio, 1.25);

        assert!(desired.apply_regions(vec![rect(2.0)], 2, f64::NAN).unwrap());
        assert_eq!(desired.device_pixel_ratio, 1.0);

        assert!(desired.apply_regions(vec![rect(3.0)], 3, 0.0).unwrap());
        assert_eq!(desired.device_pixel_ratio, 1.0);
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
        assert!(desired.apply_regions(vec![rect(1.0)], 10, 1.0).unwrap());
        assert!(!desired.apply_regions(vec![rect(2.0)], 10, 1.0).unwrap());
        assert!(!desired
            .apply_regions(
                vec![OverlayHitRect {
                    x: f64::NAN,
                    y: 0.0,
                    width: 10.0,
                    height: 10.0,
                }],
                9,
                1.0,
            )
            .unwrap());
        assert_eq!(desired.rects, vec![rect(1.0)]);
        assert!(desired
            .apply_regions(
                vec![OverlayHitRect {
                    x: f64::NAN,
                    y: 0.0,
                    width: 10.0,
                    height: 10.0,
                }],
                11,
                1.0,
            )
            .is_err());
        assert_eq!(desired.rects, vec![rect(1.0)]);
        assert!(desired.apply_regions(vec![rect(4.0)], 11, 1.0).unwrap());
        assert_eq!(desired.rects, vec![rect(4.0)]);
    }

    #[test]
    fn parent_replacement_and_loss_are_invalidation_edges() {
        let mut desired = desired_state();
        assert!(desired.apply_regions(vec![rect(0.0)], 1, 1.0).unwrap());
        assert!(desired.observe_parent(None));
        desired.invalidate(false).unwrap();

        assert!(!desired.observe_parent(Some(10)));
        assert!(desired.apply_regions(vec![rect(1.0)], 90, 1.0).unwrap());
        assert!(!desired.observe_parent(Some(10)));

        assert!(desired.observe_parent(Some(11)));
        desired.invalidate(false).unwrap();
        assert!(desired.rects.is_empty());
        assert_eq!(desired.last_revision, None);
        assert!(desired.apply_regions(vec![rect(2.0)], 1, 1.0).unwrap());

        assert!(desired.observe_parent(None));
        desired.mark_parent_absent();
        desired.invalidate(true).unwrap();
        assert!(desired.rects.is_empty());
        assert_eq!(desired.last_revision, None);
        assert!(!desired.observe_parent(None));
        assert!(!desired.observe_parent(Some(12)));
        assert!(desired.apply_regions(vec![rect(3.0)], 1, 1.0).unwrap());
        assert!(desired.observe_parent(None));
        desired.invalidate(false).unwrap();
        assert!(!desired.observe_parent(None));
    }

    #[test]
    fn matching_epoch_and_renderer_session_are_accepted() {
        let mut desired = desired_state();
        let epoch = desired
            .renew_renderer_session("renderer".to_string())
            .unwrap();
        let decision = desired
            .apply_renderer_regions(vec![rect(1.0)], 1, 1.25, epoch, "renderer")
            .unwrap();

        assert_eq!(decision, RegionSyncDecision::Applied);
        assert!(decision.accepted());
        assert!(!desired.pending_resync);
        assert_eq!(desired.rects, vec![rect(1.0)]);
    }

    #[test]
    fn renderer_session_mismatch_is_not_accepted_or_mutated() {
        let mut desired = desired_state();
        let epoch = desired
            .renew_renderer_session("renderer".to_string())
            .unwrap();
        let decision = desired
            .apply_renderer_regions(vec![rect(1.0)], 1, 1.0, epoch, "stale-renderer")
            .unwrap();

        assert_eq!(decision, RegionSyncDecision::LeaseMismatch);
        assert!(!decision.accepted());
        assert!(desired.pending_resync);
        assert!(desired.rects.is_empty());
        assert_eq!(desired.last_revision, None);
    }

    #[test]
    fn epoch_mismatch_is_not_accepted_or_mutated() {
        let mut desired = desired_state();
        let epoch = desired
            .renew_renderer_session("renderer".to_string())
            .unwrap();
        let decision = desired
            .apply_renderer_regions(vec![rect(1.0)], 1, 1.0, epoch - 1, "renderer")
            .unwrap();

        assert_eq!(decision, RegionSyncDecision::LeaseMismatch);
        assert!(!decision.accepted());
        assert!(desired.pending_resync);
        assert!(desired.rects.is_empty());
        assert_eq!(desired.last_revision, None);
    }

    #[test]
    fn stale_revision_keeps_valid_lease_accepted() {
        let mut desired = desired_state();
        let epoch = desired
            .renew_renderer_session("renderer".to_string())
            .unwrap();
        assert_eq!(
            desired
                .apply_renderer_regions(vec![rect(2.0)], 2, 1.0, epoch, "renderer")
                .unwrap(),
            RegionSyncDecision::Applied
        );
        let decision = desired
            .apply_renderer_regions(vec![rect(1.0)], 1, 1.0, epoch, "renderer")
            .unwrap();

        assert_eq!(decision, RegionSyncDecision::StaleRevision);
        assert!(decision.accepted());
        assert!(!desired.pending_resync);
        assert_eq!(desired.rects, vec![rect(2.0)]);
        assert_eq!(desired.last_revision, Some(2));
    }

    #[test]
    fn hidden_locked_and_unready_states_pause_without_clearing_pending() {
        let mut desired = desired_state();
        assert!(!desired.can_probe());
        assert!(desired.pending_resync);

        desired
            .renew_renderer_session("renderer".to_string())
            .unwrap();
        assert!(desired.can_probe());

        desired.visible = false;
        assert!(!desired.can_probe());
        assert!(desired.pending_resync);

        desired.visible = true;
        desired.locked = true;
        assert!(!desired.can_probe());
        assert!(desired.pending_resync);

        desired.locked = false;
        assert!(desired.can_probe());
    }

    #[test]
    fn measured_empty_and_fully_clipped_regions_remain_distinct() {
        assert_eq!(hit_region_status(true, 0), HitRegionStatus::Applied);
        assert_eq!(hit_region_status(false, 0), HitRegionStatus::FullyClipped);
        assert_eq!(hit_region_status(false, 1), HitRegionStatus::Applied);

        let mut desired = desired_state();
        let epoch = desired
            .renew_renderer_session("renderer".to_string())
            .unwrap();
        assert_eq!(
            desired
                .apply_renderer_regions(Vec::new(), 1, 1.0, epoch, "renderer")
                .unwrap(),
            RegionSyncDecision::Applied
        );
        assert!(desired.rects.is_empty());
        assert_eq!(desired.last_revision, Some(1));
        assert!(!desired.pending_resync);
    }

    #[test]
    fn epoch_overflow_revokes_renderer_and_keeps_resync_pending() {
        let mut desired = desired_state();
        desired.resync_epoch = u64::MAX;
        desired.renderer_session = Some("renderer".to_string());
        desired.pending_resync = false;

        assert!(desired.invalidate(false).is_err());
        assert_eq!(desired.resync_epoch, u64::MAX);
        assert_eq!(desired.renderer_session, None);
        assert!(desired.pending_resync);
        assert!(!desired.can_probe());
    }

    #[test]
    fn probe_schedule_reaches_indefinite_five_second_interval() {
        assert_eq!(
            (0..8).map(probe_delay_ms).collect::<Vec<_>>(),
            vec![100, 250, 500, 1_000, 5_000, 5_000, 5_000, 5_000]
        );
    }

    #[test]
    fn hit_rect_clipping_uses_client_bounds_and_drops_empty_intersections() {
        assert_eq!(
            clip_hit_rect_to_bounds(
                OverlayHitRect {
                    x: -5.0,
                    y: -10.0,
                    width: 20.0,
                    height: 30.0,
                },
                100.0,
                100.0,
            ),
            Some(OverlayHitRect {
                x: 0.0,
                y: 0.0,
                width: 15.0,
                height: 20.0,
            })
        );
        assert_eq!(
            clip_hit_rect_to_bounds(
                OverlayHitRect {
                    x: 90.0,
                    y: 95.0,
                    width: 30.0,
                    height: 10.0,
                },
                100.0,
                100.0,
            ),
            Some(OverlayHitRect {
                x: 90.0,
                y: 95.0,
                width: 10.0,
                height: 5.0,
            })
        );
        assert_eq!(clip_hit_rect_to_bounds(rect(110.0), 100.0, 100.0), None);
        assert_eq!(clip_hit_rect_to_bounds(rect(1.0), 0.0, 100.0), None);
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
    fn hit_rect_validation_rejects_non_finite_values() {
        for invalid in [
            OverlayHitRect {
                x: f64::NAN,
                y: 0.0,
                width: 10.0,
                height: 10.0,
            },
            OverlayHitRect {
                x: 0.0,
                y: f64::INFINITY,
                width: 10.0,
                height: 10.0,
            },
            OverlayHitRect {
                x: 0.0,
                y: 0.0,
                width: f64::NEG_INFINITY,
                height: 10.0,
            },
            OverlayHitRect {
                x: 0.0,
                y: 0.0,
                width: 10.0,
                height: f64::NAN,
            },
        ] {
            assert!(validate_hit_rects(&[invalid]).is_err());
        }
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
