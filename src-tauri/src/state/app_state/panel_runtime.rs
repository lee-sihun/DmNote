use super::*;

impl AppState {
    // 분리 상태 기록: 값 갱신만 창 전환과 같은 락 안에서 끝내 순서가 뒤집히지 않게 하고,
    // 디스크 대기는 flush_panel_detached가 락 밖에서 맡는다
    fn mark_panel_detached(&self, detached: bool) {
        if let Err(err) = self
            .store
            .update_deferred(move |data| data.panel_detached = detached)
        {
            log::warn!("failed to record panel detached={detached} state: {err}");
        }
    }

    // 드문 조작이라 즉시 디스크로 - deferred로 두면 강제 종료 때 유저가 고른 배치가 날아간다.
    // 반드시 panel_creation_lock을 놓은 뒤 부를 것: 저장 대기 동안 창 전환이 막힌다.
    // 사이에 반대 전환이 끝났다면 그쪽 저장이 이미 dirty를 걷어가 여기서 값을 되살리지 않는다
    pub(crate) fn flush_panel_detached(&self) {
        if let Err(err) = self.store.flush() {
            log::warn!("failed to persist panel detached state: {err}");
        }
    }

    // 메인이 window.open을 부르기 직전에 세운다. 핸들러가 이 토큰을 1회 소비한다
    pub fn arm_panel_open(&self) {
        *self.panel_open_armed.lock() = Some(Instant::now());
    }

    pub(crate) fn panel_drag_controller(&self) -> Arc<PanelDragController> {
        Arc::clone(&self.panel_drag)
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn try_lock_panel_creation_for_drag(
        &self,
    ) -> Option<parking_lot::MutexGuard<'_, ()>> {
        self.panel_creation_lock.try_lock()
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn record_panel_drag_presented(&self, app: &AppHandle) -> PanelPresentSnapshot {
        let panel_detached = self.store.snapshot().panel_detached;
        let mut destroy_reason = self.panel_destroy_reason.lock();
        let snapshot = PanelPresentSnapshot {
            panel_visible: self.panel_visible.load(Ordering::SeqCst),
            panel_detached,
            panel_destroy_reason: *destroy_reason,
        };
        *destroy_reason = None;
        drop(destroy_reason);
        if let Err(error) =
            publish_panel_visibility_transition(&self.panel_visible, app, true, None)
        {
            self.panel_visible.store(true, Ordering::SeqCst);
            log::warn!("failed to publish the visible panel state during native drag: {error}");
        }
        self.mark_panel_detached(true);
        snapshot
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn revert_panel_drag_presented(
        &self,
        app: &AppHandle,
        snapshot: PanelPresentSnapshot,
    ) {
        if let Err(error) = publish_panel_visibility_transition(
            &self.panel_visible,
            app,
            snapshot.panel_visible,
            snapshot.panel_destroy_reason,
        ) {
            self.panel_visible
                .store(snapshot.panel_visible, Ordering::SeqCst);
            log::warn!("failed to publish the restored panel state after native drag: {error}");
        }
        self.mark_panel_detached(snapshot.panel_detached);
        *self.panel_destroy_reason.lock() = snapshot.panel_destroy_reason;
    }

    fn take_panel_open_arm(&self) -> bool {
        take_panel_open_arm(&mut self.panel_open_armed.lock(), Instant::now())
    }

    // 메인 웹뷰의 window.open 요청을 패널 창으로 만든다 (on_new_window 핸들러 진입점).
    // WKUIDelegate/NewWindowRequested 콜백 안 - 메인 스레드에서 window.open이 동기로
    // 기다리는 중이라 메인 웹뷰 JS 왕복은 금지, 게터는 인라인이라 안전하다.
    // 창은 프로세스 수명 동안 한 번만 만든다: opener와 WKUserContentController를 공유해
    // 자식 웹뷰를 파괴하면 메인의 IPC 핸들러까지 제거된다(도킹은 hide, 파괴는 종료 시만)
    pub fn open_panel_window_for_request(
        &self,
        app: &AppHandle,
        url: &str,
        features: tauri::webview::NewWindowFeatures,
    ) -> Result<WebviewWindow> {
        if !self.take_panel_open_arm() {
            return Err(anyhow!(
                "window.open request was not armed as the panel window"
            ));
        }
        if !is_panel_open_url(url) {
            return Err(anyhow!(
                "panel window must be opened with an empty url, got {url}"
            ));
        }
        // 배치 정보는 락과 무관하니 락 밖에서 먼저 읽는다
        let main_rect = main_window_native_rect(app);
        let monitors = MonitorData::gather(app);
        // 메인 스레드 콜백이라 락은 try_lock만 - 잡고 있는 오프메인 태스크(ack 타임아웃)를
        // 기다리면 역전 데드락
        let Some(_creation_guard) = self.panel_creation_lock.try_lock() else {
            return Err(anyhow!("panel creation lock is busy"));
        };
        if app.get_webview_window(PANEL_LABEL).is_some() {
            return Err(anyhow!("panel window already exists"));
        }
        // 창은 숨긴 채 만든다 - 메인이 문서를 채운 뒤 present_panel_window로 드러내야
        // 빈 창이 한 프레임 비치지 않는다. 가시성 전환·분리 기록도 그쪽이 맡는다
        let window = self.create_panel_window(app, features, main_rect, &monitors)?;
        log::info!("panel window created as an opener child of main");
        Ok(window)
    }

    // 도킹(hide)돼 있던 패널 창을 다시 띄운다. 창이 없으면 메인이 window.open으로 만들어야 한다.
    // position이 있으면(드래그 드롭) 그 자리에, 없으면 메인 옆에 붙인다.
    // focus=false는 드래그 도중 tear-off용 - 포커스를 뺏으면 메인의 드래그 세션이 끊긴다
    pub fn present_panel_window(
        &self,
        app: &AppHandle,
        position: Option<LogicalPosition<f64>>,
        focus: bool,
    ) -> Result<()> {
        // 배치 정보는 락과 무관하니 락 밖에서 먼저 읽는다
        let main_rect = main_window_native_rect(app);
        let monitors = MonitorData::gather(app);
        let result = {
            let _creation_guard = self.panel_creation_lock.lock();
            let Some(window) = app.get_webview_window(PANEL_LABEL) else {
                return Err(anyhow!("panel window is not open"));
            };
            *self.panel_destroy_reason.lock() = None;
            // 재표시는 저장 높이만 이어받고 자리는 메인 옆으로 다시 잡는다 (기존 계약).
            // 드롭 위치가 오면 그 자리가 우선이다
            let stored_bounds = self.store.snapshot().panel_bounds;
            let mut layout = resolve_panel_window_layout(stored_bounds, main_rect, &monitors, None);
            if let Some(position) = position {
                let outer = panel_client_to_outer_position(&window, position.x, position.y);
                layout.position = Some(logical_position_to_native(&window, outer));
            }
            self.apply_panel_window_layout(&window, &layout);
            let _ = window.unminimize();
            // 네이티브 show가 적용된 뒤의 보조 작업 실패를 커맨드 실패로 돌려보내면
            // 프론트는 도킹으로 되돌아가지만 창은 이미 보여 서로 다른 상태가 된다.
            window.show().context("failed to show panel window")?;
            // Windows의 show는 z-order를 건드리지 않아 활성 창(메인) 뒤에 깔린다 -
            // 포커스는 그대로 두고 순서만 올린다 (드래그 tear-off 세션 유지)
            #[cfg(target_os = "windows")]
            raise_panel_window_without_activation(&window);
            if focus {
                if let Err(error) = window.set_focus() {
                    log::warn!("failed to focus the visible panel window: {error}");
                }
            }
            if let Err(error) =
                publish_panel_visibility_transition(&self.panel_visible, app, true, None)
            {
                // 이벤트 발행 실패 시 helper가 원래 값으로 되돌리므로 실제 창 상태로 재정렬
                self.panel_visible.store(true, Ordering::SeqCst);
                log::warn!("failed to publish the visible panel state: {error}");
            }
            self.mark_panel_detached(true);
            Ok(())
        };
        if result.is_ok() {
            self.flush_panel_detached();
        }
        result
    }

    // 드래그 중 창 이동 - 락·가시성 전환 없이 위치만 (bounds 세션이 Moved로 받아 적는다)
    pub fn move_panel_window_to(&self, app: &AppHandle, x: f64, y: f64) -> Result<()> {
        let window = app
            .get_webview_window(PANEL_LABEL)
            .ok_or_else(|| anyhow!("panel window is not open"))?;
        let position = panel_client_to_outer_position(&window, x, y);
        window
            .set_position(position)
            .context("failed to move panel window")
    }

    // 저장값을 비우고 기본 배치로 되돌린다. 창을 새로 보이거나 포커스를 옮기지 않는다.
    // 즉시 저장은 panel_creation_lock 밖에서 - 디스크 대기 동안 창 전환이 막힌다
    pub fn reset_panel_window_position(&self, app: &AppHandle) -> Result<()> {
        let main_rect = main_window_native_rect(app);
        let monitors = MonitorData::gather(app);
        let window = app.get_webview_window(PANEL_LABEL);
        let layout = window
            .as_ref()
            .map(|_| resolve_panel_window_layout(None, main_rect, &monitors, None));

        self.panel_bounds_persistence
            .clear_saved_bounds(layout.as_ref())?;

        if let (Some(window), Some(layout)) = (window, layout) {
            let _creation_guard = self.panel_creation_lock.lock();
            self.apply_panel_window_layout(&window, &layout);
        }
        Ok(())
    }

    // 헤더 드래그 세션 시작 시 한 번 읽는 값 - 도크 존 판정 기준 좌표
    pub fn panel_drag_context(&self, app: &AppHandle) -> PanelDragContext {
        PanelDragContext {
            main_frame: main_window_logical_rect(app),
            main_content_origin: main_window_content_origin(app),
        }
    }

    fn apply_panel_window_layout(&self, window: &WebviewWindow, layout: &PanelWindowLayout) {
        if let Err(err) =
            window.set_min_size(Some(LogicalSize::new(PANEL_WIDTH, layout.min_height)))
        {
            log::warn!("failed to apply panel min size: {err}");
        }
        if let Err(err) =
            window.set_max_size(Some(LogicalSize::new(PANEL_WIDTH, layout.max_height)))
        {
            log::warn!("failed to apply panel max size: {err}");
        }
        if let Err(err) = window.set_size(LogicalSize::new(PANEL_WIDTH, layout.height)) {
            log::warn!("failed to apply panel size: {err}");
        }
        if let Some(position) = layout.position {
            #[cfg(target_os = "windows")]
            let result = window.set_position(PhysicalPosition::new(
                position.x.round() as i32,
                position.y.round() as i32,
            ));
            #[cfg(not(target_os = "windows"))]
            let result = window.set_position(LogicalPosition::new(position.x, position.y));
            if let Err(err) = result {
                log::warn!("failed to apply panel position: {err}");
            }
        }
    }

    // 기동 시 분리 패널 복원 진입점. 창은 메인 렌더러만 만들 수 있으므로(opener 관계) 여기서는
    // 요청만 남기고, 메인이 부트스트랩 뒤 take_panel_restore_request로 1회 소비한다.
    // main_window_hidden은 트레이 아이콘 생성 실패 폴백까지 반영된 값이어야 한다
    pub fn restore_detached_panel_on_startup(&self, main_window_hidden: bool) {
        let snapshot = self.store.snapshot();
        let restore = should_restore_panel_on_startup(
            snapshot.obs_mode_enabled,
            main_window_hidden,
            snapshot.panel_detached,
        );
        self.panel_restore_pending.store(restore, Ordering::SeqCst);
    }

    pub fn take_panel_restore_request(&self) -> bool {
        self.panel_restore_pending.swap(false, Ordering::SeqCst)
    }

    // 트레이로 숨는 메인과 동행 - panel:visibility는 재부착 신호라 여기서 발행하지 않는다
    // (발행하면 메인이 인라인 패널을 다시 붙이고 열린 시트가 사라짐)
    // 메인 스레드에서 불리므로 panel_creation_lock을 잡지 않는다 - 락을 쥔 ack 타임아웃
    // 태스크가 메인 스레드 응답을 기다리는 구간(bounds 샘플링)이 있어 잡으면 역전 데드락.
    // 도킹된(hide) 창은 is_visible이 false라 표식이 서지 않는다
    pub(super) fn hide_detached_panel_with_main(&self, app: &AppHandle) {
        self.panel_drag
            .clear_for_lifecycle(Some(app), "hiddenWithMain");
        let Some(window) = app.get_webview_window(PANEL_LABEL) else {
            return;
        };
        // 이미 숨어 있거나 최소화된 창은 건너뛴다 - 우리가 감추지 않은 창을 동행 복원 대상으로
        // 올리지 않기 위한 가드다. Windows의 is_visible은 최소화 창도 true라 is_minimized를 함께 본다
        let visible =
            window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
        let hidden = hide_panel_with_main_transition(&self.panel_hidden_with_main, visible, || {
            window.hide().map_err(anyhow::Error::from)
        });
        if let Err(err) = hidden {
            log::warn!("failed to hide detached panel with main window: {err}");
        }
    }

    // 메인이 트레이에서 나올 때, 우리가 감췄던 패널만 되돌린다
    pub(super) fn restore_detached_panel_with_main(&self, app: &AppHandle) {
        let Some(window) = app.get_webview_window(PANEL_LABEL) else {
            drop_panel_hidden_with_main(&self.panel_hidden_with_main);
            return;
        };
        let restored = restore_panel_with_main_transition(&self.panel_hidden_with_main, || {
            // 메인 표시 경로와 같은 순서 - 최소화 해제부터
            let _ = window.unminimize();
            window.show().map_err(anyhow::Error::from)?;
            // present_panel_window와 같은 이유 - show가 z-order를 안 건드려 메인 뒤에 깔린다.
            // 메인을 위에 남기는 건 뒤따르는 main.show()+set_focus가 맡는다
            #[cfg(target_os = "windows")]
            raise_panel_window_without_activation(&window);
            Ok(())
        });
        if let Err(err) = restored {
            // 표식은 되살렸지만 자동 재시도는 없다 - 유저가 트레이로 다시 숨겼다 꺼내야 복원된다
            log::warn!("failed to show detached panel with main window: {err}");
        }
    }

    // 도킹: 창을 감추고 도킹 상태를 기록한다 (명시 재부착 경로)
    pub fn dock_panel_window(&self, app: &AppHandle) -> Result<()> {
        let result = {
            let _creation_guard = self.panel_creation_lock.lock();
            *self.panel_close_request.lock() = PanelCloseRequestState::Closing;
            let result = self.dock_panel_window_inner(app, PanelVisibilityReason::Closed);
            finish_panel_close(&self.panel_close_request);
            result
        };
        // 실패해 되돌린 경우도 저장한다 - 어느 쪽이든 마지막 값이 디스크에 남아야 다음 기동이 맞는다
        self.flush_panel_detached();
        result
    }

    // 메인 문서가 다시 로드되면 opener 쪽 WindowProxy가 사라진다 - 창은 살려 두고(파괴 금지)
    // 감춰서 새 문서가 다시 붙일 수 있게 한다. dev reload 대비.
    // on_page_load 콜백(메인 스레드)에서 불리므로 blocking lock 금지 - 락을 쥔 오프메인
    // 태스크(ack 타임아웃 등)가 메인 왕복 게터를 기다리는 구간과 겹치면 역전 데드락이다.
    // try_lock에 실패하면 그 경합 중인 전환이 이미 가시성을 정리하므로 건너뛴다
    pub fn dock_panel_window_for_main_reload(&self, app: &AppHandle) {
        if app.get_webview_window(PANEL_LABEL).is_none() {
            return;
        }
        let docked = {
            let Some(_creation_guard) = self.panel_creation_lock.try_lock() else {
                log::warn!("panel creation lock busy on main reload; docking skipped");
                return;
            };
            *self.panel_close_request.lock() = PanelCloseRequestState::Closing;
            let result = self.dock_panel_window_inner(app, PanelVisibilityReason::Closed);
            finish_panel_close(&self.panel_close_request);
            if let Err(err) = &result {
                log::warn!("failed to dock panel window on main reload: {err}");
            }
            result.is_ok()
        };
        // 도킹 기록 저장은 락을 놓은 뒤 - 저장 대기 동안 창 전환이 막히지 않게
        if docked {
            self.flush_panel_detached();
        }
    }

    fn dock_panel_window_inner(
        &self,
        app: &AppHandle,
        reason: PanelVisibilityReason,
    ) -> Result<()> {
        self.panel_drag.clear_for_lifecycle(Some(app), "docked");
        // 도킹 상태 기록: 명시 재부착과 close-ack 타임아웃 강제 도킹이 모두 이 경로를 지남
        // Destroyed 핸들러에서는 기록 금지 - 종료 시 shutdown_application이 panel.destroy()를
        // 직접 호출해 같은 핸들러로 들어오므로 분리 채 종료할 때마다 플래그가 지워짐.
        // 이 함수는 panel_creation_lock 안에서 도는 만큼 저장은 호출자가 락을 놓은 뒤 맡는다
        self.mark_panel_detached(false);
        *self.panel_destroy_reason.lock() = Some(reason);
        if let Some(window) = app.get_webview_window(PANEL_LABEL) {
            if let Err(error) = self.panel_bounds_persistence.flush_now(&window) {
                // 위치 저장 실패는 이미 적용될 도킹을 되돌릴 수 없으므로 별도로 기록
                log::warn!("failed to persist panel bounds before docking: {error}");
            }
            if let Err(error) = window.hide() {
                self.clear_panel_destroy_reason(reason);
                // 창이 보이면 여전히 분리 상태다. 도킹 기록을 되돌리지
                // 않으면 다음 기동에서 분리 패널이 복원되지 않는다
                self.mark_panel_detached(true);
                return Err(error.into());
            }
        }
        if let Err(error) = self.publish_panel_hidden(app, reason) {
            // 이벤트 발행 실패 시 helper가 가시성과 사유를 되돌린다. 네이티브 창은 이미
            // 숨겨졌으므로 실제 상태를 우선하고 다음 전환에 낡은 사유를 남기지 않는다
            self.panel_visible.store(false, Ordering::SeqCst);
            self.clear_panel_destroy_reason(reason);
            log::warn!("failed to publish the hidden panel state: {error}");
        }
        Ok(())
    }

    fn publish_panel_hidden(
        &self,
        app: &AppHandle,
        fallback_reason: PanelVisibilityReason,
    ) -> Result<()> {
        publish_panel_hidden_transition(
            &self.panel_visible,
            &self.panel_destroy_reason,
            app,
            fallback_reason,
        )
    }

    fn clear_panel_destroy_reason(&self, reason: PanelVisibilityReason) {
        let mut pending = self.panel_destroy_reason.lock();
        if *pending == Some(reason) {
            *pending = None;
        }
    }

    pub fn acknowledge_panel_window_close(&self, request_id: &str) -> bool {
        acknowledge_panel_close_request(&self.panel_close_request, request_id)
    }

    pub fn capture_and_flush_panel_bounds_for_lifecycle(&self, app: &AppHandle) -> Result<()> {
        if self.shutdown_started.load(Ordering::SeqCst) {
            return Ok(());
        }
        self.panel_drag
            .clear_for_lifecycle(Some(app), "applicationLifecycle");
        let _creation_guard = self.panel_creation_lock.lock();
        let Some(window) = app.get_webview_window(PANEL_LABEL) else {
            return Ok(());
        };
        self.panel_bounds_persistence.flush_now(&window)
    }

    pub fn handle_panel_window_destroyed(&self, app: &AppHandle) {
        self.panel_drag.finish_window_destroyed(app);
        drop_panel_hidden_with_main(&self.panel_hidden_with_main);
        finish_panel_close(&self.panel_close_request);
        if let Err(error) = self.publish_panel_hidden(app, PanelVisibilityReason::Destroyed) {
            log::warn!("failed to emit destroyed panel visibility: {error}");
        }
    }

    // monitors는 호출자가 panel_creation_lock 밖에서 모아 넘긴다
    fn create_panel_window(
        &self,
        app: &AppHandle,
        features: tauri::webview::NewWindowFeatures,
        main_rect: Option<NativeRect>,
        monitors: &MonitorData,
    ) -> Result<WebviewWindow> {
        let snapshot = self.store.snapshot();
        let stored_bounds = snapshot.panel_bounds;
        let layout = resolve_panel_window_layout(stored_bounds, main_rect, monitors, None);

        // about:blank는 runtime-wry가 초기 네비게이션을 건너뛴다 - opener가 문서를 채우고,
        // WebView2의 "NewWindow는 네비게이션 전이어야 함" 요건도 이걸로 맞는다.
        // window_features는 opener의 configuration/environment를 물려주는 필수 호출이라
        // 크기·위치를 덮어쓰기 전에 먼저 둔다
        let mut builder = WebviewWindowBuilder::new(
            app,
            PANEL_LABEL,
            WebviewUrl::External("about:blank".parse().expect("about:blank url")),
        )
        .window_features(features)
        .title("DM Note - Panel")
        .window_classname(PANEL_WINDOW_CLASS)
        // 메인·오버레이와 같은 프레임리스 크롬 - 드래그 영역은 패널 상단 스트립이 담당
        .decorations(false)
        // Windows는 DWM이 실루엣을 소유하므로(windows_window_corners) 모서리 바깥을 비출
        // 필요가 없다. 투명이면 wry가 WebView2 기본 배경을 (0,0,0,0)으로 못박고 빌더
        // background_color를 버려, 리사이즈로 새로 드러난 띠가 그대로 비친다.
        // 메인 창(transparent: false + backgroundColor)과 같은 구성
        .transparent(cfg!(not(target_os = "windows")))
        .shadow(true)
        .resizable(true)
        .maximizable(false)
        .always_on_top(false)
        .skip_taskbar(false)
        .focused(false)
        // 비포커스 상태의 첫 클릭이 포커스 획득에만 소비되지 않게 함
        // (유틸리티 패널 관례 - 버튼이 첫 클릭에 바로 동작)
        .accept_first_mouse(true)
        .visible(false)
        .inner_size(PANEL_WIDTH, layout.height)
        .min_inner_size(PANEL_WIDTH, layout.min_height)
        .max_inner_size(PANEL_WIDTH, layout.max_height)
        .zoom_hotkeys_enabled(false);

        // 컨트롤러 생성 옵션에 실려야 첫 프레임부터 유효하다 - build() 이후 런타임 호출은
        // 이미 내비게이션이 시작된 뒤라 늦다. 실제 색은 렌더러가 토큰을 읽어 덮는다
        #[cfg(target_os = "windows")]
        {
            builder = builder.background_color(crate::state::windows_window_corners::SEED_FILL);
        }

        #[cfg(not(target_os = "windows"))]
        if let Some(position) = layout.position {
            builder = builder.position(position.x, position.y);
        }

        let window = builder.build().context("failed to create panel window")?;

        if let Some(position) = layout.position {
            #[cfg(target_os = "windows")]
            let result = window.set_position(PhysicalPosition::new(
                position.x.round() as i32,
                position.y.round() as i32,
            ));
            #[cfg(not(target_os = "windows"))]
            let result = window.set_position(LogicalPosition::new(position.x, position.y));
            if let Err(err) = result {
                log::warn!("failed to restore panel position after build: {err}");
            }
        }

        // Windows 접근성 텍스트 배율 보상 - about:blank는 네비게이션이 없어
        // zoom-guard(on_page_load)가 이 창에 닿지 않는다. 메인과 같은 배율을 직접 적용
        let zoom = crate::compute_compensating_zoom();
        if crate::should_apply_compensating_zoom(zoom) {
            // 성공도 남긴다 - WebView2가 이후 네비게이션에서 리셋하면 로그 부재로 판별해야 한다
            match window.set_zoom(zoom) {
                Ok(()) => log::info!("[zoom-guard] panel window compensating zoom={zoom:.6}"),
                Err(err) => log::warn!("failed to set panel compensating zoom: {err}"),
            }
        }

        self.configure_panel_window(&window, app, layout.max_height);
        Ok(window)
    }

    fn configure_panel_window(
        &self,
        window: &WebviewWindow,
        app: &AppHandle,
        initial_max_height: f64,
    ) {
        // 웹 콘텐츠가 그리는 라운딩은 리사이즈 프레임을 못 따라옴 - 실루엣은 컴포지터가 소유
        #[cfg(target_os = "macos")]
        crate::state::macos_window_corners::apply_rounded_corners(app, window);
        // Windows는 DWM이 이미 자기 반경으로 자르고 있어 웹 라운딩과 어긋난다 - 반경 지정이
        // 불가능하므로 실루엣을 DWM에 넘기고 웹은 사각으로 채운다 (메인 창과 같은 처리)
        #[cfg(target_os = "windows")]
        crate::state::windows_window_corners::apply_initial_chrome(window);

        let bounds_session = self
            .panel_bounds_persistence
            .attach(window, initial_max_height);
        let bounds_persistence = Arc::clone(&self.panel_bounds_persistence);
        let panel_window = window.clone();
        let app_handle = app.clone();

        window.on_window_event(move |event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                match panel_bounds_sample_from_window(&panel_window) {
                    Ok(sample) => bounds_persistence
                        .record_event(bounds_session, PanelBoundsChange::Snapshot(sample)),
                    Err(err) => {
                        log::warn!("failed to capture panel bounds on close request: {err}")
                    }
                }
                let Some(state) = app_handle.try_state::<AppState>() else {
                    return;
                };
                let request_id = uuid::Uuid::new_v4().to_string();
                if !begin_panel_close_request(&state.panel_close_request, &request_id) {
                    return;
                }
                let payload = PanelCloseRequestedPayload {
                    request_id: request_id.clone(),
                };
                if let Err(err) = app_handle.emit("panel:close-requested", &payload) {
                    log::warn!("failed to emit panel close request: {err}");
                }
                let timeout_app = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(PANEL_CLOSE_ACK_TIMEOUT).await;
                    let Some(state) = timeout_app.try_state::<AppState>() else {
                        return;
                    };
                    let closed = {
                        let _creation_guard = state.panel_creation_lock.lock();
                        match run_panel_close_timeout(
                            &state.panel_close_request,
                            &request_id,
                            || {
                                state.dock_panel_window_inner(
                                    &timeout_app,
                                    PanelVisibilityReason::Closed,
                                )
                            },
                        ) {
                            Ok(claimed) => claimed,
                            Err(error) => {
                                log::warn!("failed to close panel after missing ack: {error}");
                                true
                            }
                        }
                    };
                    // 도킹 기록 저장은 락을 놓은 뒤 - 저장 대기 동안 창 전환이 막히지 않게
                    if closed {
                        state.flush_panel_detached();
                    }
                });
            }
            WindowEvent::Moved(position) => {
                bounds_persistence
                    .record_event(bounds_session, PanelBoundsChange::Moved(*position));
                #[cfg(target_os = "windows")]
                if let Some(state) = app_handle.try_state::<AppState>() {
                    state.panel_drag.handle_moved(&app_handle);
                }
            }
            WindowEvent::Resized(size) => {
                bounds_persistence.record_event(bounds_session, PanelBoundsChange::Resized(*size));
            }
            WindowEvent::ScaleFactorChanged {
                scale_factor,
                new_inner_size,
                ..
            } => {
                bounds_persistence.record_event(
                    bounds_session,
                    PanelBoundsChange::ScaleFactorChanged {
                        position: panel_window.outer_position().ok(),
                        size: *new_inner_size,
                        scale_factor: *scale_factor,
                    },
                );
            }
            WindowEvent::Destroyed => {
                bounds_persistence.deactivate(bounds_session);
            }
            _ => {}
        });
    }
}
