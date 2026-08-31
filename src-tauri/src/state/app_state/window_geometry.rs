use super::*;

mod overlay_placement;
mod persistence;
pub(super) use overlay_placement::*;
#[cfg(test)]
pub(super) use persistence::{
    apply_panel_bounds_change, changed_panel_max_height, panel_bounds_from_sample,
    PanelBoundsPersistenceState, PanelBoundsSample,
};
pub(super) use persistence::{
    panel_bounds_sample_from_window, PanelBoundsChange, PanelBoundsPersistenceController,
};
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

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct NativeRect {
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) width: f64,
    pub(super) height: f64,
}

impl NativeRect {
    pub(super) fn contains_point(&self, x: f64, y: f64) -> bool {
        x >= self.x && x <= self.x + self.width && y >= self.y && y <= self.y + self.height
    }

    pub(super) fn intersection_area_native(&self, other: NativeRect) -> f64 {
        let left = self.x.max(other.x);
        let top = self.y.max(other.y);
        let right = (self.x + self.width).min(other.x + other.width);
        let bottom = (self.y + self.height).min(other.y + other.height);
        (right - left).max(0.0) * (bottom - top).max(0.0)
    }

    pub(super) fn clamp_native(&self, rect: NativeRect) -> OverlayPosition {
        let max_x = self.x + (self.width - rect.width).max(0.0);
        let max_y = self.y + (self.height - rect.height).max(0.0);
        OverlayPosition {
            x: rect.x.clamp(self.x, max_x),
            y: rect.y.clamp(self.y, max_y),
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct MonitorSpec {
    pub(super) identity: String,
    pub(super) enumeration_index: usize,
    pub(super) full_rect_native: NativeRect,
    pub(super) work_rect_native: NativeRect,
    pub(super) full_rect_physical: NativeRect,
    pub(super) scale_factor: f64,
    pub(super) logical_to_native_scale: f64,
}

impl MonitorSpec {
    pub(super) fn from_monitor(monitor: Monitor, enumeration_index: usize) -> Option<Self> {
        let scale = monitor.scale_factor();
        // 병리적 scale이 spec에 섞이면 환산이 조용히 깨진다
        if !monitor_scale_is_usable(scale) {
            return None;
        }
        let full_origin = *monitor.position();
        let full_size = *monitor.size();
        let work_area = monitor.work_area();
        let full_rect_physical = NativeRect {
            x: full_origin.x as f64,
            y: full_origin.y as f64,
            width: full_size.width as f64,
            height: full_size.height as f64,
        };
        let work_rect_physical = NativeRect {
            x: work_area.position.x as f64,
            y: work_area.position.y as f64,
            width: work_area.size.width as f64,
            height: work_area.size.height as f64,
        };
        #[cfg(target_os = "windows")]
        let (full_rect_native, work_rect_native, logical_to_native_scale) =
            (full_rect_physical, work_rect_physical, scale);
        #[cfg(not(target_os = "windows"))]
        let (full_rect_native, work_rect_native, logical_to_native_scale) = (
            NativeRect {
                x: full_rect_physical.x / scale,
                y: full_rect_physical.y / scale,
                width: full_rect_physical.width / scale,
                height: full_rect_physical.height / scale,
            },
            NativeRect {
                x: work_rect_physical.x / scale,
                y: work_rect_physical.y / scale,
                width: work_rect_physical.width / scale,
                height: work_rect_physical.height / scale,
            },
            1.0,
        );
        let identity = format!(
            "{}@{}:{}:{}:{}",
            monitor.name().map(String::as_str).unwrap_or("unnamed"),
            full_origin.x,
            full_origin.y,
            full_size.width,
            full_size.height
        );

        Some(Self {
            identity,
            enumeration_index,
            full_rect_native,
            work_rect_native,
            full_rect_physical,
            scale_factor: scale,
            logical_to_native_scale,
        })
    }

    pub(super) fn matches(&self, other: &Self) -> bool {
        (self.full_rect_physical.x - other.full_rect_physical.x).abs() < 0.5
            && (self.full_rect_physical.y - other.full_rect_physical.y).abs() < 0.5
            && (self.full_rect_physical.width - other.full_rect_physical.width).abs() < 0.5
            && (self.full_rect_physical.height - other.full_rect_physical.height).abs() < 0.5
            && (self.scale_factor - other.scale_factor).abs() < f64::EPSILON
    }

    #[cfg(not(target_os = "windows"))]
    pub(super) fn contains_physical(&self, x: f64, y: f64) -> bool {
        self.full_rect_physical.contains_point(x, y)
    }

    pub(super) fn logical_length_to_native(&self, value: f64) -> f64 {
        value * self.logical_to_native_scale
    }

    pub(super) fn native_length_to_logical(&self, value: f64) -> f64 {
        value / self.logical_to_native_scale
    }

    pub(super) fn intersection_area_native(&self, rect: NativeRect) -> f64 {
        self.full_rect_native.intersection_area_native(rect)
    }

    pub(super) fn clamp_native(&self, rect: NativeRect) -> OverlayPosition {
        self.work_rect_native.clamp_native(rect)
    }
}

#[derive(Clone, Debug, Default)]
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
            .enumerate()
            .filter_map(|(index, monitor)| MonitorSpec::from_monitor(monitor, index))
            .collect();

        let mut primary_index = None;
        if let Ok(Some(primary)) = app.primary_monitor() {
            if let Some(primary_spec) = MonitorSpec::from_monitor(primary, usize::MAX) {
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

    #[cfg(not(target_os = "windows"))]
    pub(super) fn fallback_scale(&self) -> f64 {
        self.primary_spec()
            .map(|spec| spec.scale_factor)
            .unwrap_or(1.0)
    }

    #[cfg(not(target_os = "windows"))]
    pub(super) fn find_by_physical(&self, x: f64, y: f64) -> Option<&MonitorSpec> {
        self.specs.iter().find(|spec| spec.contains_physical(x, y))
    }

    /// full monitor rect 기준 최대 겹침, 동률이면 고유한 열거 인덱스 순
    pub(super) fn find_best_overlap_native(&self, rect: NativeRect) -> Option<&MonitorSpec> {
        self.specs
            .iter()
            .filter(|spec| spec.intersection_area_native(rect) > 0.0)
            .min_by(|a, b| {
                b.intersection_area_native(rect)
                    .total_cmp(&a.intersection_area_native(rect))
                    .then_with(|| a.enumeration_index.cmp(&b.enumeration_index))
            })
    }

    #[cfg(any(target_os = "windows", test))]
    pub(super) fn find_by_native_point(&self, x: f64, y: f64) -> Option<&MonitorSpec> {
        self.specs
            .iter()
            .find(|spec| spec.full_rect_native.contains_point(x, y))
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
    /// Windows 메인 창은 프레임리스+그림자(tao undecorated-shadow 인셋, 좌우 약 8 논리 px·상단 0~2 물리 px)라
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

/// 기본 배치용 플랫폼 네이티브 사각형
pub(super) fn main_window_native_rect(app: &AppHandle) -> Option<NativeRect> {
    let window = app.get_webview_window("main")?;
    let position = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    #[cfg(target_os = "windows")]
    {
        Some(NativeRect {
            x: position.x as f64,
            y: position.y as f64,
            width: size.width as f64,
            height: size.height as f64,
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let scale = window
            .scale_factor()
            .ok()
            .filter(|scale| monitor_scale_is_usable(*scale))
            .unwrap_or(1.0);
        let position = position.to_logical::<f64>(scale);
        let size = size.to_logical::<f64>(scale);
        Some(NativeRect {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        })
    }
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

pub(super) fn logical_position_to_native(
    window: &WebviewWindow,
    position: LogicalPosition<f64>,
) -> OverlayPosition {
    #[cfg(target_os = "windows")]
    {
        let scale = window
            .scale_factor()
            .ok()
            .filter(|scale| monitor_scale_is_usable(*scale))
            .unwrap_or(1.0);
        OverlayPosition {
            x: position.x * scale,
            y: position.y * scale,
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        OverlayPosition {
            x: position.x,
            y: position.y,
        }
    }
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
    main: &NativeRect,
    panel_height: f64,
    work_area: &MonitorSpec,
) -> OverlayPosition {
    let panel_width_native = work_area.logical_length_to_native(PANEL_WIDTH);
    let panel_height_native = work_area.logical_length_to_native(panel_height);
    let gap_native = work_area.logical_length_to_native(PANEL_BESIDE_GAP);
    let right_x = main.x + main.width + gap_native;
    let left_x = main.x - gap_native - panel_width_native;
    let fits_right = right_x + panel_width_native
        <= work_area.work_rect_native.x + work_area.work_rect_native.width;
    let fits_left = left_x >= work_area.work_rect_native.x;
    // 양쪽 다 안 들어가면 오른쪽 후보를 넘겨 clamp가 작업 영역 오른쪽 끝에 붙이게 둔다
    let x = if fits_right || !fits_left {
        right_x
    } else {
        left_x
    };
    // 패널이 화면보다 높으면 clamp가 위쪽 정렬로 떨어뜨린다
    let y = main.y + (main.height - panel_height_native) / 2.0;
    work_area.clamp_native(NativeRect {
        x,
        y,
        width: panel_width_native,
        height: panel_height_native,
    })
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
    main_rect: Option<NativeRect>,
    monitors: &MonitorData,
    fallback_height: Option<f64>,
) -> PanelWindowLayout {
    // 기준 화면은 메인 창이 놓인 모니터 - 패널이 그 옆에 붙으니 높이 한계도 같은 화면을 따른다
    let target_monitor = main_rect
        .and_then(|rect| monitors.find_best_overlap_native(rect))
        .or_else(|| monitors.primary_spec());
    let (min_height, max_height) = panel_height_bounds(
        target_monitor
            .map(|monitor| monitor.native_length_to_logical(monitor.work_rect_native.height)),
    );
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
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct OverlayPosition {
    pub(super) x: f64,
    pub(super) y: f64,
}
