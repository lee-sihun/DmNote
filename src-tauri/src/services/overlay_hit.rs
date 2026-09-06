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

    #[cfg(target_os = "macos")]
    pub(crate) fn reconcile_after_parent_order(&self, app: &AppHandle) -> Result<()> {
        platform::request_reorder(&mut self.inner.native.lock());
        self.reconcile(app)
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
        #[cfg(target_os = "macos")]
        platform::set_owner(&mut native, Arc::downgrade(&self.inner));
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
#[path = "overlay_hit/platform/macos.rs"]
mod platform;

#[cfg(target_os = "windows")]
#[path = "overlay_hit/platform/windows.rs"]
mod platform;

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
#[path = "overlay_hit/platform/fallback.rs"]
mod platform;

#[cfg(test)]
mod tests;
