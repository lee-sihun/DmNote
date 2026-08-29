use super::*;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct PanelBoundsSample {
    pub(super) position: PhysicalPosition<i32>,
    pub(super) position_scale_factor: f64,
    pub(super) size: PhysicalSize<u32>,
    pub(super) size_scale_factor: f64,
    pub(super) current_scale_factor: f64,
}

#[derive(Debug, Clone, Copy)]
pub(super) enum PanelBoundsChange {
    Snapshot(PanelBoundsSample),
    Moved(PhysicalPosition<i32>),
    Resized(PhysicalSize<u32>),
    ScaleFactorChanged {
        position: Option<PhysicalPosition<i32>>,
        size: PhysicalSize<u32>,
        scale_factor: f64,
    },
}

impl PanelBoundsChange {
    // 복원에 쓰는 값은 높이뿐이라 이동은 디스크로 가지 않는다.
    // x/y는 store 호환을 위해 계속 기록만 되고 창 배치에는 쓰이지 않음
    pub(super) fn changes_persisted_bounds(self) -> bool {
        !matches!(self, Self::Moved(_))
    }
}

#[derive(Default)]
pub(super) struct PanelBoundsPersistenceState {
    pub(super) latest: Option<PanelBoundsSample>,
    pub(super) window: Option<WebviewWindow>,
    pub(super) applied_max_height: Option<f64>,
    // 초기화로 발생한 resize가 비운 저장값을 되살리지 않게 하는 기본 높이 추적
    pub(super) unpersisted_default_height: Option<f64>,
    pub(super) default_height_pending: bool,
    pub(super) session: u64,
    pub(super) generation: u64,
    pub(super) worker_running: bool,
    // dirty는 워커가 처리할 변경이 남았는지, persist_dirty는 그중 저장까지 필요한지
    pub(super) dirty: bool,
    pub(super) persist_dirty: bool,
    pub(super) active: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct PanelBoundsPersistWork {
    pub(super) session: u64,
    pub(super) generation: u64,
    pub(super) sample: PanelBoundsSample,
    pub(super) persist: bool,
}

pub(super) struct PanelBoundsPersistenceController {
    store: Arc<AppStore>,
    state: Mutex<PanelBoundsPersistenceState>,
    persist_lock: Mutex<()>,
}

pub(super) fn convert_physical_bounds_to_logical(
    bounds: &OverlayBounds,
    monitors: &MonitorData,
) -> Option<OverlayBounds> {
    if monitors.is_empty() {
        return None;
    }

    let center_x = bounds.x + bounds.width / 2.0;
    let center_y = bounds.y + bounds.height / 2.0;

    let scale = monitors
        .find_by_physical(center_x, center_y)
        .map(|spec| spec.scale_factor)
        .unwrap_or_else(|| monitors.fallback_scale());

    scale_physical_bounds_to_logical(bounds, scale)
}

#[derive(Clone)]
pub(super) struct MonitorSpec {
    pub(super) logical_origin_x: f64,
    pub(super) logical_origin_y: f64,
    pub(super) logical_width: f64,
    pub(super) logical_height: f64,
    pub(super) physical_origin_x: f64,
    pub(super) physical_origin_y: f64,
    pub(super) physical_width: f64,
    pub(super) physical_height: f64,
    pub(super) scale_factor: f64,
}

impl MonitorSpec {
    pub(super) fn from_monitor(monitor: Monitor) -> Option<Self> {
        let scale = monitor.scale_factor();
        // 병리적 scale이 spec에 섞이면 환산이 조용히 깨진다
        if !monitor_scale_is_usable(scale) {
            return None;
        }
        let work_area = monitor.work_area();
        let origin = work_area.position;
        let size = work_area.size;

        let logical_origin = origin.to_logical::<f64>(scale);
        let logical_size = size.to_logical::<f64>(scale);

        Some(Self {
            logical_origin_x: logical_origin.x,
            logical_origin_y: logical_origin.y,
            logical_width: logical_size.width,
            logical_height: logical_size.height,
            physical_origin_x: origin.x as f64,
            physical_origin_y: origin.y as f64,
            physical_width: size.width as f64,
            physical_height: size.height as f64,
            scale_factor: scale,
        })
    }

    pub(super) fn matches(&self, other: &Self) -> bool {
        (self.physical_origin_x - other.physical_origin_x).abs() < 0.5
            && (self.physical_origin_y - other.physical_origin_y).abs() < 0.5
            && (self.physical_width - other.physical_width).abs() < 0.5
            && (self.physical_height - other.physical_height).abs() < 0.5
            && (self.scale_factor - other.scale_factor).abs() < f64::EPSILON
    }

    pub(super) fn contains_physical(&self, x: f64, y: f64) -> bool {
        x >= self.physical_origin_x
            && x <= self.physical_origin_x + self.physical_width
            && y >= self.physical_origin_y
            && y <= self.physical_origin_y + self.physical_height
    }

    /// 주어진 사각형과 이 모니터 work_area의 교차 영역 넓이 (logical px²)
    pub(super) fn intersection_area(&self, x: f64, y: f64, width: f64, height: f64) -> f64 {
        let left = x.max(self.logical_origin_x);
        let top = y.max(self.logical_origin_y);
        let right = (x + width).min(self.logical_origin_x + self.logical_width);
        let bottom = (y + height).min(self.logical_origin_y + self.logical_height);
        (right - left).max(0.0) * (bottom - top).max(0.0)
    }

    pub(super) fn clamp(&self, x: f64, y: f64, width: f64, height: f64) -> OverlayPosition {
        let max_x = self.logical_origin_x + (self.logical_width - width).max(0.0);
        let max_y = self.logical_origin_y + (self.logical_height - height).max(0.0);

        OverlayPosition {
            x: x.clamp(self.logical_origin_x, max_x),
            y: y.clamp(self.logical_origin_y, max_y),
        }
    }
}

#[derive(Default)]
pub(super) struct MonitorData {
    pub(super) specs: Vec<MonitorSpec>,
    pub(super) primary_index: Option<usize>,
}

impl MonitorData {
    #[cfg(not(target_os = "macos"))]
    pub(super) fn gather(app: &AppHandle) -> Self {
        Self::gather_inner(app)
    }

    /// macOS: available_monitors/primary_monitor의 Monitor 변환이 NSScreen(AppKit)을
    /// 호출 스레드에서 직접 접근함 → 메인 스레드 밖(async 커맨드 등)에서 호출 시 크래시 (#67)
    /// run_on_main_thread는 메인 스레드에서 호출되면 인라인 실행되므로 데드락 없음
    #[cfg(target_os = "macos")]
    pub(super) fn gather(app: &AppHandle) -> Self {
        let empty = Self::default();
        let (tx, rx) = std::sync::mpsc::channel();
        let app_handle = app.clone();
        if let Err(err) = app.run_on_main_thread(move || {
            let _ = tx.send(Self::gather_inner(&app_handle));
        }) {
            log::warn!("monitor gather: failed to dispatch to main thread: {err}");
            return empty;
        }
        match rx.recv_timeout(std::time::Duration::from_secs(3)) {
            Ok(data) => data,
            Err(err) => {
                log::warn!("monitor gather: main thread result unavailable: {err}");
                empty
            }
        }
    }

    pub(super) fn gather_inner(app: &AppHandle) -> Self {
        let mut specs: Vec<MonitorSpec> = app
            .available_monitors()
            .ok()
            .unwrap_or_default()
            .into_iter()
            .filter_map(MonitorSpec::from_monitor)
            .collect();

        let mut primary_index = None;
        if let Ok(Some(primary)) = app.primary_monitor() {
            if let Some(primary_spec) = MonitorSpec::from_monitor(primary) {
                primary_index = specs.iter().position(|spec| spec.matches(&primary_spec));

                if primary_index.is_none() {
                    specs.push(primary_spec);
                    primary_index = Some(specs.len() - 1);
                }
            }
        }

        Self {
            specs,
            primary_index,
        }
    }

    pub(super) fn is_empty(&self) -> bool {
        self.specs.is_empty()
    }

    pub(super) fn primary_spec(&self) -> Option<&MonitorSpec> {
        self.primary_index
            .and_then(|idx| self.specs.get(idx))
            .or_else(|| self.specs.first())
    }

    pub(super) fn fallback_scale(&self) -> f64 {
        self.primary_spec()
            .map(|spec| spec.scale_factor)
            .unwrap_or(1.0)
    }

    pub(super) fn find_by_physical(&self, x: f64, y: f64) -> Option<&MonitorSpec> {
        self.specs.iter().find(|spec| spec.contains_physical(x, y))
    }

    /// 주어진 사각형과 가장 많이 겹치는 모니터를 반환
    pub(super) fn find_best_overlap(
        &self,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> Option<&MonitorSpec> {
        self.specs
            .iter()
            .max_by(|a, b| {
                a.intersection_area(x, y, width, height)
                    .partial_cmp(&b.intersection_area(x, y, width, height))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .filter(|spec| spec.intersection_area(x, y, width, height) > 0.0)
    }

    pub(super) fn first(&self) -> Option<&MonitorSpec> {
        self.specs.first()
    }
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelDragContext {
    /// 메인 창 outer 사각형 - content 원점 실측 실패 시 근사 폴백
    pub main_frame: Option<LogicalRect>,
    /// 메인 창 content(웹뷰) 원점 - 드래그 도크 존 판정 기준.
    /// Windows 메인 창은 프레임리스+그림자(tao undecorated-shadow 인셋, 좌우 ≈8px·상단 0~1px)라
    /// outer와 어긋나고, 렌더러의 outerWidth-innerWidth는 WebView2에서 0이라 여기서 실측한다
    pub main_content_origin: Option<LogicalPoint>,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogicalPoint {
    pub x: f64,
    pub y: f64,
}

/// 논리 좌표계 사각형 - 창 게터가 주는 physical 값을 scale로 나눈 도메인
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogicalRect {
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) width: f64,
    pub(super) height: f64,
}

/// 메인 창의 현재 사각형을 logical로 읽는다.
/// 창 게터는 메인 스레드로 왕복하므로 panel_creation_lock 밖에서만 호출할 것.
/// outer 기준이라 Windows 프레임과 macOS 타이틀바가 포함되는데, 패널은 그 바깥에 붙는 게 맞다
pub(super) fn main_window_logical_rect(app: &AppHandle) -> Option<LogicalRect> {
    let window = app.get_webview_window("main")?;
    let scale = window
        .scale_factor()
        .ok()
        .filter(|scale| monitor_scale_is_usable(*scale))
        .unwrap_or(1.0);
    let position = window.outer_position().ok()?.to_logical::<f64>(scale);
    let size = window.outer_size().ok()?.to_logical::<f64>(scale);
    Some(LogicalRect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

// 렌더러의 드롭 좌표는 "커서 - client 기준 grab 오프셋" = 원하는 client 원점이다.
// 패널 창도 프레임리스+그림자라 Windows에선 outer가 client보다 인셋만큼 크다 -
// set_position(outer)에 그대로 꽂으면 콘텐츠가 그만큼 밀리므로 실측 인셋으로 보정한다.
// macOS는 인셋 0이라 무변화. 실측 실패 시 보정 없이 진행
pub(super) fn panel_client_to_outer_position(
    window: &WebviewWindow,
    x: f64,
    y: f64,
) -> LogicalPosition<f64> {
    let inset = window
        .scale_factor()
        .ok()
        .filter(|scale| monitor_scale_is_usable(*scale))
        .and_then(|scale| {
            let outer = window.outer_position().ok()?.to_logical::<f64>(scale);
            let inner = window.inner_position().ok()?.to_logical::<f64>(scale);
            Some((inner.x - outer.x, inner.y - outer.y))
        })
        .unwrap_or((0.0, 0.0));
    LogicalPosition::new(x - inset.0, y - inset.1)
}

/// 메인 창 content(웹뷰) 영역의 화면 논리 원점.
/// 렌더러 client 좌표 + 이 원점 = 화면 논리 좌표 (드래그 도크 존 판정에 사용)
pub(super) fn main_window_content_origin(app: &AppHandle) -> Option<LogicalPoint> {
    let window = app.get_webview_window("main")?;
    let scale = window
        .scale_factor()
        .ok()
        .filter(|scale| monitor_scale_is_usable(*scale))
        .unwrap_or(1.0);
    let position = window.inner_position().ok()?.to_logical::<f64>(scale);
    Some(LogicalPoint {
        x: position.x,
        y: position.y,
    })
}

/// 분리 패널을 메인 창 오른쪽에 여백을 두고 세로 중앙으로 붙인다.
/// 오른쪽 자리가 모자라면 왼쪽, 양쪽 다 모자라면 작업 영역 안으로 밀어 넣는다
pub(super) fn panel_position_beside_main(
    main: &LogicalRect,
    panel_height: f64,
    work_area: &MonitorSpec,
) -> OverlayPosition {
    let right_x = main.x + main.width + PANEL_BESIDE_GAP;
    let left_x = main.x - PANEL_BESIDE_GAP - PANEL_WIDTH;
    let fits_right = right_x + PANEL_WIDTH <= work_area.logical_origin_x + work_area.logical_width;
    let fits_left = left_x >= work_area.logical_origin_x;
    // 양쪽 다 안 들어가면 오른쪽 후보를 넘겨 clamp가 작업 영역 오른쪽 끝에 붙이게 둔다
    let x = if fits_right || !fits_left {
        right_x
    } else {
        left_x
    };
    // 패널이 화면보다 높으면 clamp가 위쪽 정렬로 떨어뜨린다
    let y = main.y + (main.height - panel_height) / 2.0;
    work_area.clamp(x, y, PANEL_WIDTH, panel_height)
}

pub(super) struct PanelWindowLayout {
    pub(super) position: Option<OverlayPosition>,
    pub(super) height: f64,
    pub(super) min_height: f64,
    pub(super) max_height: f64,
}

// 작업 영역이 하한보다 좁으면 하한을 화면에 맞춰 낮춤 - 그러지 않으면 창 아래쪽이
// 화면 밖으로 나가 리사이즈 가장자리에 손이 닿지 않는다
pub(super) fn panel_height_bounds(work_area_height: Option<f64>) -> (f64, f64) {
    let Some(work_area_height) =
        work_area_height.filter(|height| height.is_finite() && *height > 0.0)
    else {
        return (PANEL_MIN_HEIGHT, PANEL_FALLBACK_MAX_HEIGHT);
    };
    let max_height = work_area_height * PANEL_MAX_HEIGHT_RATIO;
    (PANEL_MIN_HEIGHT.min(max_height), max_height)
}

pub(super) fn resolve_panel_window_layout(
    stored_bounds: Option<PanelBounds>,
    main_rect: Option<LogicalRect>,
    monitors: &MonitorData,
    fallback_height: Option<f64>,
) -> PanelWindowLayout {
    // 기준 화면은 메인 창이 놓인 모니터 - 패널이 그 옆에 붙으니 높이 한계도 같은 화면을 따른다
    let target_monitor = main_rect
        .and_then(|rect| monitors.find_best_overlap(rect.x, rect.y, rect.width, rect.height))
        .or_else(|| monitors.primary_spec());
    let (min_height, max_height) =
        panel_height_bounds(target_monitor.map(|monitor| monitor.logical_height));
    // 저장된 높이가 없으면 메인 창 높이를 기본값으로 (프로그램 높이 동기)
    let requested_height = stored_bounds
        .map(|bounds| bounds.height)
        .or(fallback_height)
        .unwrap_or(PANEL_INITIAL_HEIGHT);
    let height = requested_height.clamp(min_height, max_height);
    // 위치는 열 때마다 메인 창 옆으로 다시 잡는다 - 저장된 x/y는 이동 기록으로만 남고 복원에 쓰지 않음.
    // 메인 좌표를 못 읽으면 OS 기본 배치에 맡긴다
    let position = main_rect
        .zip(target_monitor)
        .map(|(rect, monitor)| panel_position_beside_main(&rect, height, monitor));

    PanelWindowLayout {
        position,
        height,
        min_height,
        max_height,
    }
}

pub(super) fn changed_panel_max_height(previous: Option<f64>, next: f64) -> Option<f64> {
    if !next.is_finite() || next <= 0.0 {
        return None;
    }
    if previous.is_some_and(|value| (value - next).abs() < 0.5) {
        return None;
    }
    Some(next)
}

pub(super) fn panel_bounds_sample_from_window(window: &WebviewWindow) -> Result<PanelBoundsSample> {
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    Ok(PanelBoundsSample {
        position: window.outer_position()?,
        position_scale_factor: scale_factor,
        size: window.inner_size()?,
        size_scale_factor: scale_factor,
        current_scale_factor: scale_factor,
    })
}

pub(super) fn valid_panel_scale_factor(scale_factor: f64) -> f64 {
    if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    }
}

pub(super) fn panel_bounds_from_sample(sample: PanelBoundsSample) -> PanelBounds {
    let position = sample
        .position
        .to_logical::<f64>(valid_panel_scale_factor(sample.position_scale_factor));
    let size = sample
        .size
        .to_logical::<f64>(valid_panel_scale_factor(sample.size_scale_factor));
    PanelBounds {
        x: position.x,
        y: position.y,
        height: size.height,
    }
}

pub(super) fn apply_panel_bounds_change(sample: &mut PanelBoundsSample, change: PanelBoundsChange) {
    match change {
        PanelBoundsChange::Snapshot(snapshot) => *sample = snapshot,
        PanelBoundsChange::Moved(position) => {
            sample.position = position;
            sample.position_scale_factor = sample.current_scale_factor;
        }
        PanelBoundsChange::Resized(size) => {
            sample.size = size;
            sample.size_scale_factor = sample.current_scale_factor;
        }
        PanelBoundsChange::ScaleFactorChanged {
            position,
            size,
            scale_factor,
        } => {
            let scale_factor = valid_panel_scale_factor(scale_factor);
            sample.current_scale_factor = scale_factor;
            if let Some(position) = position {
                sample.position = position;
                sample.position_scale_factor = scale_factor;
            }
            sample.size = size;
            sample.size_scale_factor = scale_factor;
        }
    }
}

impl PanelBoundsPersistenceController {
    pub(super) fn new(store: Arc<AppStore>) -> Self {
        Self {
            store,
            state: Mutex::new(PanelBoundsPersistenceState::default()),
            persist_lock: Mutex::new(()),
        }
    }

    pub(super) fn attach(&self, window: &WebviewWindow, max_height: f64) -> u64 {
        let latest = panel_bounds_sample_from_window(window).ok();
        let mut state = self.state.lock();
        state.session = state.session.wrapping_add(1);
        state.latest = latest;
        state.window = Some(window.clone());
        state.applied_max_height = Some(max_height);
        state.unpersisted_default_height = None;
        state.default_height_pending = false;
        state.generation = state.generation.wrapping_add(1);
        state.dirty = false;
        state.persist_dirty = false;
        state.active = true;
        state.session
    }

    pub(super) fn record_event(self: &Arc<Self>, session: u64, change: PanelBoundsChange) {
        let should_spawn = {
            let mut state = self.state.lock();
            if !state.active || state.session != session {
                return;
            }
            if state.latest.is_none() {
                state.latest = state
                    .window
                    .as_ref()
                    .and_then(|window| panel_bounds_sample_from_window(window).ok());
            }
            Self::record_change(&mut state, session, change)
        };
        if should_spawn {
            self.spawn_worker();
        }
    }

    pub(super) fn record_change(
        state: &mut PanelBoundsPersistenceState,
        session: u64,
        change: PanelBoundsChange,
    ) -> bool {
        if !state.active || state.session != session {
            return false;
        }
        let persist = change.changes_persisted_bounds();
        if let PanelBoundsChange::Snapshot(snapshot) = change {
            state.latest = Some(snapshot);
        } else {
            let Some(latest) = state.latest.as_mut() else {
                return false;
            };
            apply_panel_bounds_change(latest, change);
        }
        let persist = Self::should_persist_change(state, persist);
        Self::mark_dirty(state, persist)
    }

    pub(super) fn should_persist_change(
        state: &mut PanelBoundsPersistenceState,
        persist: bool,
    ) -> bool {
        if !persist {
            return false;
        }
        let Some(default_height) = state.unpersisted_default_height else {
            return true;
        };
        let Some(sample) = state.latest else {
            state.unpersisted_default_height = None;
            state.default_height_pending = false;
            return true;
        };
        let height = panel_bounds_from_sample(sample).height;
        if (height - default_height).abs() < 0.5 {
            state.default_height_pending = false;
            return false;
        }
        if state.default_height_pending {
            return false;
        }
        state.unpersisted_default_height = None;
        true
    }

    // 이동만 바뀌어도 워커는 깨운다 - 모니터가 바뀌면 높이 한계를 다시 걸어야 하기 때문
    pub(super) fn mark_dirty(state: &mut PanelBoundsPersistenceState, persist: bool) -> bool {
        state.generation = state.generation.wrapping_add(1);
        state.dirty = true;
        state.persist_dirty |= persist;
        let should_spawn = !state.worker_running;
        state.worker_running = true;
        should_spawn
    }

    pub(super) fn take_dirty_work(
        state: &mut PanelBoundsPersistenceState,
    ) -> Option<PanelBoundsPersistWork> {
        let sample = state.latest.filter(|_| state.active && state.dirty)?;
        let persist = state.persist_dirty;
        state.dirty = false;
        state.persist_dirty = false;
        Some(PanelBoundsPersistWork {
            session: state.session,
            generation: state.generation,
            sample,
            persist,
        })
    }

    pub(super) fn work_is_current(
        state: &PanelBoundsPersistenceState,
        work: &PanelBoundsPersistWork,
    ) -> bool {
        state.active && state.session == work.session && state.generation == work.generation
    }

    pub(super) fn restore_failed_work(
        state: &mut PanelBoundsPersistenceState,
        work: &PanelBoundsPersistWork,
    ) -> bool {
        if !Self::work_is_current(state, work) {
            return false;
        }
        state.dirty = true;
        state.persist_dirty |= work.persist;
        true
    }

    pub(super) fn persist_sample(&self, sample: PanelBoundsSample) -> Result<()> {
        let bounds = panel_bounds_from_sample(sample);
        self.store
            .update_deferred(move |data| {
                data.panel_bounds = Some(bounds);
            })
            .context("failed to capture settled panel bounds")?;
        self.store
            .flush()
            .context("failed to flush settled panel bounds")
    }

    pub(super) fn clear_saved_bounds(&self, layout: Option<&PanelWindowLayout>) -> Result<()> {
        let _persist_guard = self.persist_lock.lock();
        self.store
            .update_deferred(|data| data.panel_bounds = None)
            .context("failed to clear saved panel bounds")?;
        self.store
            .flush()
            .context("failed to flush cleared panel bounds")?;

        let mut state = self.state.lock();
        let default_height = layout.map(|value| value.height);
        let current_height = state
            .latest
            .map(panel_bounds_from_sample)
            .map(|value| value.height);
        state.unpersisted_default_height = default_height;
        state.default_height_pending = default_height
            .zip(current_height)
            .is_none_or(|(default, current)| (default - current).abs() >= 0.5);
        state.applied_max_height = layout.map(|value| value.max_height);
        state.generation = state.generation.wrapping_add(1);
        state.dirty = false;
        state.persist_dirty = false;
        Ok(())
    }

    pub(super) fn persist_worker_work(&self, work: PanelBoundsPersistWork) -> Result<bool> {
        // 이동만 바뀐 구간은 디스크를 건드리지 않는다 - 저장 값은 높이뿐이라 쓸 이유가 없다
        if !work.persist {
            return Ok(false);
        }
        let _persist_guard = self.persist_lock.lock();
        if !Self::work_is_current(&self.state.lock(), &work) {
            return Ok(false);
        }
        self.persist_sample(work.sample)?;
        Ok(true)
    }

    pub(super) fn spawn_worker(self: &Arc<Self>) {
        let controller = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(PANEL_BOUNDS_DEBOUNCE_MS)).await;
                let (work, window) = {
                    let mut state = controller.state.lock();
                    let Some(work) = Self::take_dirty_work(&mut state) else {
                        state.worker_running = false;
                        return;
                    };
                    (work, state.window.clone())
                };

                let persist_result = controller.persist_worker_work(work);
                if let Err(err) = &persist_result {
                    log::warn!("failed to persist settled panel bounds: {err:#}");
                }

                if let Some(window) = window {
                    let constraint_controller = Arc::clone(&controller);
                    let constraint_window = window.clone();
                    if let Err(err) = window.app_handle().run_on_main_thread(move || {
                        if let Err(err) = constraint_controller.apply_monitor_constraints(
                            &constraint_window,
                            work.session,
                            work.generation,
                        ) {
                            log::warn!("failed to update settled panel monitor constraints: {err}");
                        }
                    }) {
                        log::warn!("failed to schedule settled panel constraints: {err}");
                    }
                }

                let mut state = controller.state.lock();
                if persist_result.is_err() && Self::restore_failed_work(&mut state, &work) {
                    state.worker_running = false;
                    return;
                }
                if !state.active || !state.dirty {
                    state.worker_running = false;
                    return;
                }
            }
        });
    }

    pub(super) fn apply_monitor_constraints(
        &self,
        window: &WebviewWindow,
        session: u64,
        generation: u64,
    ) -> Result<()> {
        let Some((min_height, monitor_max_height)) = window
            .current_monitor()?
            .and_then(MonitorSpec::from_monitor)
            .map(|monitor| panel_height_bounds(Some(monitor.logical_height)))
        else {
            return Ok(());
        };
        let max_height = {
            let state = self.state.lock();
            if !state.active || state.session != session || state.generation != generation {
                return Ok(());
            }
            changed_panel_max_height(state.applied_max_height, monitor_max_height)
        };
        let Some(max_height) = max_height else {
            return Ok(());
        };
        // 좁은 모니터로 옮겨가면 하한도 함께 내려야 창이 화면 밖으로 나가지 않음
        window.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize::new(
            PANEL_WIDTH,
            min_height,
        ))))?;
        window.set_max_size(Some(tauri::Size::Logical(tauri::LogicalSize::new(
            PANEL_WIDTH,
            max_height,
        ))))?;
        let mut state = self.state.lock();
        if state.active && state.session == session && state.generation == generation {
            state.applied_max_height = Some(max_height);
        }
        Ok(())
    }

    pub(super) fn flush_now(&self, window: &WebviewWindow) -> Result<()> {
        let _persist_guard = self.persist_lock.lock();
        let generation_before_sample = self.state.lock().generation;
        let sampled = panel_bounds_sample_from_window(window);
        let persisted =
            Self::flush_samples(&self.state, generation_before_sample, sampled, |sample| {
                self.persist_sample(sample)
            })?;
        if !persisted {
            self.store
                .flush()
                .context("failed to flush store with cleared panel bounds")?;
        }
        Ok(())
    }

    pub(super) fn flush_samples(
        state_mutex: &Mutex<PanelBoundsPersistenceState>,
        generation_before_sample: u64,
        sampled: Result<PanelBoundsSample>,
        mut persist: impl FnMut(PanelBoundsSample) -> Result<()>,
    ) -> Result<bool> {
        let mut work = {
            let mut state = state_mutex.lock();
            let sampled = match sampled {
                Ok(sample) => sample,
                Err(error) => state.latest.ok_or(error)?,
            };
            let sample = if state.generation != generation_before_sample {
                state.latest.unwrap_or(sampled)
            } else {
                sampled
            };
            state.latest = Some(sample);
            state.generation = state.generation.wrapping_add(1);
            state.dirty = false;
            state.persist_dirty = false;
            let persist = Self::should_persist_change(&mut state, true);
            PanelBoundsPersistWork {
                session: state.session,
                generation: state.generation,
                sample,
                persist,
            }
        };
        let mut persisted = false;

        loop {
            if work.persist {
                if let Err(error) = persist(work.sample) {
                    Self::restore_failed_work(&mut state_mutex.lock(), &work);
                    return Err(error);
                }
                persisted = true;
            }
            let next = {
                let mut state = state_mutex.lock();
                let Some(mut next) = Self::take_dirty_work(&mut state) else {
                    return Ok(persisted);
                };
                next.persist = Self::should_persist_change(&mut state, true);
                next
            };
            work = next;
        }
    }

    pub(super) fn deactivate(&self, session: u64) {
        let mut state = self.state.lock();
        Self::deactivate_state(&mut state, session);
    }

    pub(super) fn deactivate_state(state: &mut PanelBoundsPersistenceState, session: u64) -> bool {
        if state.session != session {
            return false;
        }
        state.active = false;
        state.window = None;
        state.applied_max_height = None;
        state.unpersisted_default_height = None;
        state.default_height_pending = false;
        state.generation = state.generation.wrapping_add(1);
        state.dirty = false;
        state.persist_dirty = false;
        true
    }
}

pub(super) fn compute_overlay_position(
    bounds: &OverlayBounds,
    had_stored_bounds: bool,
    monitors: &MonitorData,
) -> OverlayPosition {
    // 최소 가시 면적 — 오버레이 전체 면적의 25% 또는 100×100 중 작은 값
    let min_visible_area = (bounds.width * bounds.height * 0.25).min(100.0 * 100.0);

    if monitors.is_empty() {
        return if had_stored_bounds {
            OverlayPosition {
                x: bounds.x,
                y: bounds.y,
            }
        } else {
            OverlayPosition {
                x: OVERLAY_MARGIN,
                y: OVERLAY_MARGIN,
            }
        };
    }

    let fallback = monitors
        .primary_spec()
        .cloned()
        .or_else(|| monitors.first().cloned());

    let Some(fallback_spec) = fallback else {
        return OverlayPosition {
            x: bounds.x,
            y: bounds.y,
        };
    };

    // 저장된 위치가 없으면 기본 위치로 배치 (clamp 적용)
    if !had_stored_bounds {
        let base_x = fallback_spec.logical_origin_x + fallback_spec.logical_width
            - bounds.width
            - OVERLAY_MARGIN;
        let base_y = fallback_spec.logical_origin_y + fallback_spec.logical_height
            - bounds.height
            - OVERLAY_MARGIN;
        return fallback_spec.clamp(base_x, base_y, bounds.width, bounds.height);
    }

    // 저장된 bounds와 가장 많이 겹치는 모니터 탐색
    if let Some(best) = monitors.find_best_overlap(bounds.x, bounds.y, bounds.width, bounds.height)
    {
        let area = best.intersection_area(bounds.x, bounds.y, bounds.width, bounds.height);
        if area >= min_visible_area {
            // 충분히 보이므로 저장 좌표 그대로 복원
            return OverlayPosition {
                x: bounds.x,
                y: bounds.y,
            };
        }
        // 겹침이 부족하면 해당 모니터에 clamp
        return best.clamp(bounds.x, bounds.y, bounds.width, bounds.height);
    }

    // 어떤 모니터와도 겹치지 않음 — fallback 모니터에 clamp
    fallback_spec.clamp(bounds.x, bounds.y, bounds.width, bounds.height)
}

pub(super) fn defer_overlay_bounds_from_window(
    window: &WebviewWindow,
    store: &Arc<AppStore>,
    generation: &Arc<AtomicU64>,
) -> Result<()> {
    // scale 조회가 실패하면 1.0으로 때우지 않는다 - physical 값이 logical 라벨로 굳는다
    let scale_factor = window.scale_factor()?;
    let position = window.outer_position()?.to_logical::<f64>(scale_factor);
    let size = window.outer_size()?.to_logical::<f64>(scale_factor);

    defer_overlay_bounds(
        store,
        generation,
        OverlayBounds {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        },
        None,
    )
}

/// 모든 호출부는 logical 사각형만 넘긴다 - `apply_overlay_frame` 반환값,
/// `MonitorSpec`의 logical 필드, `to_logical(scale)` 산출값이 전부다.
/// 따라서 `overlay_bounds_are_logical = true`는 참인 단언이다.
/// 마커를 인자화해 false를 보존하면 다음 세션의 ensure_overlay_window가
/// x/y/width/height 전부를 scale로 다시 나눠 이중 환산이 발생한다
/// (신규 설치 후 위치 초기화, 창 드래그 경로가 즉시 깨진다)
pub(super) fn defer_overlay_bounds(
    store: &Arc<AppStore>,
    generation: &Arc<AtomicU64>,
    bounds: OverlayBounds,
    content_top_offset: Option<f64>,
) -> Result<()> {
    store.update_deferred(move |state| {
        state.overlay_bounds = Some(bounds);
        state.overlay_bounds_are_logical = true;
        if let Some(offset) = content_top_offset {
            state.overlay_last_content_top_offset = Some(offset);
        }
    })?;
    let scheduled_generation = generation.fetch_add(1, Ordering::SeqCst).wrapping_add(1);

    let store = Arc::clone(store);
    let generation = Arc::clone(generation);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(OVERLAY_BOUNDS_DEBOUNCE_MS)).await;
        if generation.load(Ordering::SeqCst) != scheduled_generation {
            return;
        }
        if let Err(err) = store.flush() {
            log::warn!("failed to flush debounced overlay bounds: {err}");
        }
    });

    Ok(())
}

pub(super) fn flush_deferred_overlay_bounds(
    store: &Arc<AppStore>,
    generation: &Arc<AtomicU64>,
) -> Result<()> {
    generation.fetch_add(1, Ordering::SeqCst);
    store.flush()
}

#[derive(Clone, Copy)]
pub(super) struct OverlayPosition {
    pub(super) x: f64,
    pub(super) y: f64,
}
