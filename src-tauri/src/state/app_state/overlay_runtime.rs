use super::*;

impl AppState {
    pub fn overlay_status(&self) -> BootstrapOverlayState {
        let state = self.store.snapshot();
        BootstrapOverlayState {
            visible: *self.overlay_visible.read(),
            locked: state.overlay_locked,
            anchor: state.overlay_resize_anchor.as_str().to_string(),
        }
    }

    pub fn emit_settings_changed(&self, diff: &SettingsDiff, app: &AppHandle) -> Result<()> {
        log::debug!(
            "[IPC] emit_settings_changed: {} fields changed",
            diff.changed_count()
        );
        self.apply_settings_effects(diff, app)?;
        if let Some(value) = diff.changed.key_counter_enabled {
            self.key_counter_enabled.store(value, Ordering::SeqCst);
        }
        // OBS 브릿지 캐시 갱신
        if self.obs_bridge.is_running() {
            let bp = self.bootstrap_payload();
            if let Ok(snap) = serde_json::to_value(&bp) {
                self.obs_bridge.update_snapshot(snap);
            }
        }
        // 전체 설정 페이로드 전송 방지 (임베디드 폰트 등 대용량 데이터 제외)
        let mut payload = diff.clone();
        payload.full = None;
        publish_event(app, "settings:changed", payload);
        Ok(())
    }

    /// 저장된 토큰 재사용 또는 신규 생성 후 store에 저장
    /// 기존 토큰은 commit-after-persist로 디스크 저장이 보장되므로 재저장 생략
    pub fn resolve_and_save_obs_token(&self) -> Result<String> {
        if let Some(token) = self
            .store
            .with_state(|s| s.obs_token.clone())
            .filter(|token| !token.is_empty())
        {
            return Ok(token);
        }

        let token = uuid::Uuid::new_v4().simple().to_string();
        let t = token.clone();
        self.store.update(|s| {
            s.obs_token = Some(t.clone());
        })?;
        Ok(token)
    }

    /// 부팅 시 OBS 모드 자동 시작 (obs_mode_enabled=true일 때)
    pub(super) fn auto_start_obs(&self, app: &AppHandle) {
        let bridge = self.obs_bridge.clone();
        let store = self.store.clone();

        // 부팅 시에는 오버레이를 생성하지 않았으므로 이전 표시 상태만 저장
        // (initialize_runtime에서 obs_mode_enabled일 때 ensure_overlay_window 건너뜀)
        let was_visible = store.with_state(|s| s.overlay_visible);
        *self.obs_previous_overlay_visible.write() = Some(was_visible);
        let app_handle = app.clone();

        // dev 모드: Vite dev server로 리다이렉트
        if cfg!(debug_assertions) {
            let dev_url = "http://localhost:3400".to_string();
            log::info!("[ObsBridge] dev 모드: Vite dev server로 리다이렉트 ({dev_url})");
            bridge.set_dev_url(dev_url);
        } else {
            // 프로덕션: Tauri 임베딩 에셋으로 서빙
            let handle = app_handle.clone();
            let fetcher = std::sync::Arc::new(move |path: &str| {
                let resolver = handle.asset_resolver();
                resolver.get(path.into()).map(|asset| {
                    let mime = asset.mime_type.clone();
                    (asset.bytes.to_vec(), mime)
                })
            });
            bridge.set_asset_fetcher(fetcher);
        }

        // AppHandle 전달 (invoke_request 디스패치용)
        bridge.set_app_handle(app.clone());
        // async start를 tokio 런타임에서 실행
        tauri::async_runtime::spawn(async move {
            let state = app_handle.state::<AppState>();
            let _lifecycle_guard = state.obs_lifecycle_lock.lock().await;
            let port = store.with_state(|s| s.obs_port);
            // 미저장 토큰 사용 방지를 위한 시작 중단
            let token = match state.resolve_and_save_obs_token() {
                Ok(token) => token,
                Err(e) => {
                    log::error!(
                        "[ObsBridge] auto-start 중단: 토큰 저장 실패 ({e}), obs_mode_enabled를 false로 복구"
                    );
                    let _ = store.update(|s| {
                        s.obs_mode_enabled = false;
                    });
                    state.obs_restore_overlay(&app_handle);
                    let _ = app_handle.emit("obs:status", &state.obs_bridge.status());
                    return;
                }
            };

            match bridge.start(port, token).await {
                Ok(actual_port) => {
                    log::info!("[ObsBridge] auto-start 성공 (port={})", actual_port);
                    // fallback 포트가 사용된 경우 store에 저장
                    if actual_port != port {
                        let _ = store.update(|s| {
                            s.obs_port = actual_port;
                        });
                    }
                    // 초기 스냅샷 캐싱 (신규 클라이언트에 전송됨)
                    state.refresh_obs_snapshot();
                    let _ = app_handle.emit("obs:status", &state.obs_bridge.status());
                }
                Err(e) => {
                    log::error!(
                        "[ObsBridge] auto-start 실패: {}, obs_mode_enabled를 false로 복구",
                        e
                    );
                    let _ = store.update(|state| {
                        state.obs_mode_enabled = false;
                    });
                    // 실패 시 오버레이 복원 (윈도우 재생성 포함)
                    state.obs_restore_overlay(&app_handle);
                    let _ = app_handle.emit("obs:status", &state.obs_bridge.status());
                }
            }
        });
    }

    /// OBS 시작 시 오버레이 윈도우 destroy (이전 상태 보존)
    pub fn obs_hide_overlay(&self, app: &AppHandle) {
        let was_visible = *self.overlay_visible.read();
        *self.obs_previous_overlay_visible.write() = Some(was_visible);
        // destroy()는 CloseRequested 이벤트 없이 즉시 윈도우를 파괴
        if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
            if let Err(e) = window.destroy() {
                log::warn!("[ObsBridge] 오버레이 destroy 실패: {}", e);
                // destroy 실패 시 hide로 fallback
                if was_visible {
                    if let Err(e) = self.set_overlay_visibility(app, false) {
                        log::warn!("[ObsBridge] 오버레이 hide fallback 실패: {}", e);
                    }
                }
                return;
            }
        }
        if let Err(error) = self.overlay_hit.reset_for_parent_loss(app) {
            log::warn!("failed to reset overlay hit state for OBS mode: {error:#}");
        }
        // destroy 성공(또는 윈도우 부재) 후 런타임 플래그만 갱신
        // store.overlay_visible은 변경하지 않음 — ensure_overlay_window가 재생성 시
        // 이 값을 기준으로 show/hide를 결정하므로, 원래 값을 유지해야 함
        *self.overlay_visible.write() = false;
        publish_event(app, "overlay:visibility", json!({ "visible": false }));
    }

    /// OBS 중지 시 오버레이 재생성 + 복원
    pub fn obs_restore_overlay(&self, app: &AppHandle) {
        let prev = self.obs_previous_overlay_visible.write().take();
        match prev {
            Some(true) => {
                // set_overlay_visibility(true) 내부에서 ensure_overlay_window + show + store 갱신 + emit 처리
                if let Err(e) = self.set_overlay_visibility(app, true) {
                    log::warn!("[ObsBridge] 오버레이 복원 실패: {}", e);
                }
            }
            Some(false) => {
                // 이전 상태가 hidden이었더라도 윈도우는 재생성 필요
                // (이후 sync 커맨드에서 WebView2 빌드 시 메시지 루프 블로킹 방지)
                if let Err(e) = self.ensure_overlay_window(app) {
                    log::warn!("[ObsBridge] 오버레이 윈도우 재생성 실패: {}", e);
                }
            }
            None => {}
        }
    }

    /// OBS 모드 활성화 여부
    pub fn is_obs_mode_active(&self) -> bool {
        self.obs_bridge.is_running()
    }

    /// OBS 브릿지용 전체 스냅샷 빌드 + 캐시 갱신 + 연결된 클라이언트에 broadcast
    pub fn refresh_obs_snapshot(&self) {
        if !self.obs_bridge.is_running() {
            return;
        }
        let payload = self.bootstrap_payload();
        if let Ok(snapshot) = serde_json::to_value(&payload) {
            self.obs_bridge.update_snapshot(snapshot);
            self.obs_bridge.broadcast_snapshot();
        }
    }

    /// OBS 브릿지 캐시 스냅샷 갱신
    /// CSS 등 개별 설정 변경이 OBS 런타임 상태(키 시그널, KPS)를 리셋하지 않도록 사용
    pub fn notify_obs_settings_diff(&self, _diff: serde_json::Value) {
        if !self.obs_bridge.is_running() {
            return;
        }
        let bp = self.bootstrap_payload();
        if let Ok(snap) = serde_json::to_value(&bp) {
            self.obs_bridge.update_snapshot(snap);
        }
    }

    /// OBS 브릿지 카운터 스냅샷 갱신
    pub fn obs_broadcast_counters(&self) {
        if !self.obs_bridge.is_running() {
            return;
        }
        let bp = self.bootstrap_payload();
        if let Ok(snap) = serde_json::to_value(&bp) {
            self.obs_bridge.update_snapshot(snap);
        }
    }

    pub fn set_overlay_visibility(&self, app: &AppHandle, visible: bool) -> Result<()> {
        log::debug!("[IPC] set_overlay_visibility: visible={}", visible);
        let _transition_guard = self
            .overlay_creation_lock
            .try_lock_for(OVERLAY_CREATION_LOCK_TIMEOUT)
            .ok_or_else(|| {
                anyhow!(
                    "timed out after {} seconds waiting for overlay creation lock",
                    OVERLAY_CREATION_LOCK_TIMEOUT.as_secs()
                )
            })?;

        if !visible {
            flush_deferred_overlay_bounds(&self.store, &self.overlay_bounds_generation)?;
        }

        if visible {
            // 오버레이를 열 때: 창이 없으면 생성하고 표시
            let window = self.ensure_overlay_window_while_locked(app)?;
            let snapshot = self.store.snapshot();
            show_overlay_window(&window, snapshot.always_on_top)?;

            // 오버레이가 숨겨진 동안 변경된 설정을 다시 적용.
            // 본체는 상시 클릭 통과 - 실제 잠금은 히트 창이 강제한다
            window.set_ignore_cursor_events(true)?;
            window.set_always_on_top(snapshot.always_on_top)?;
            #[cfg(target_os = "macos")]
            apply_macos_overlay_fullscreen_behavior(&window, snapshot.always_on_top);
            if let Err(error) = self.overlay_hit.set_configuration(
                app,
                true,
                snapshot.overlay_locked,
                snapshot.always_on_top,
            ) {
                log::warn!("failed to configure overlay hit windows: {error:#}");
            }
        } else {
            // 오버레이를 숨길 때: 창이 존재하는 경우에만 숨김
            // 창 미존재 시 무시 (창 생성하지 않음)
            // 히트 창 먼저 - CloseRequested의 HideAndPersist와 같은 전환 순서
            if let Err(error) = self.overlay_hit.set_visible(app, false) {
                log::warn!("failed to hide overlay hit windows: {error:#}");
            }
            if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
                hide_overlay_window(&window)?;
            }
        }

        // 창 조작 성공 후에만 영속. 저장 실패면 창 조작을 보상해 전 계층을 이전 상태로 복원
        if let Err(persist_err) = self.store.update(|state| {
            state.overlay_visible = visible;
        }) {
            let compensation = if visible {
                app.get_webview_window(OVERLAY_LABEL)
                    .map_or(Ok(()), |window| hide_overlay_window(&window))
            } else {
                match app.get_webview_window(OVERLAY_LABEL) {
                    Some(window) => {
                        let snapshot = self.store.snapshot();
                        show_overlay_window(&window, snapshot.always_on_top)
                    }
                    None => Ok(()),
                }
            };
            if let Err(comp_err) = compensation {
                // 보상 실패 — 실제 창 상태를 권위로 runtime과 이벤트를 동기화
                log::error!(
                    "[Overlay] 저장 실패 후 보상도 실패({comp_err}) — 창 상태({visible})를 권위로 동기화"
                );
                *self.overlay_visible.write() = visible;
                publish_event(app, "overlay:visibility", json!({ "visible": visible }));
            } else if let Err(error) = self.overlay_hit.set_visible(app, !visible) {
                log::warn!("failed to restore overlay hit visibility: {error:#}");
            }
            return Err(persist_err);
        }

        *self.overlay_visible.write() = visible;
        publish_event(app, "overlay:visibility", json!({ "visible": visible }));
        Ok(())
    }

    pub fn set_overlay_lock(&self, app: &AppHandle, locked: bool, persist: bool) -> Result<()> {
        log::debug!(
            "[IPC] set_overlay_lock: locked={}, persist={}",
            locked,
            persist
        );
        if persist {
            let _ = self.store.update(|state| {
                state.overlay_locked = locked;
            })?;
        }

        // 본체는 상시 클릭 통과라 잠금은 히트 창에만 반영한다
        if let Err(error) = self.overlay_hit.set_locked(app, locked) {
            log::warn!("failed to update overlay hit lock: {error:#}");
        }
        publish_event(app, "overlay:lock", json!({ "locked": locked }));
        Ok(())
    }

    pub fn sync_overlay_hit_regions(
        &self,
        app: &AppHandle,
        rects: Vec<OverlayHitRect>,
        revision: u64,
        device_pixel_ratio: f64,
        epoch: u64,
        renderer_session_id: String,
    ) -> Result<bool> {
        self.overlay_hit.sync_regions(
            app,
            rects,
            revision,
            device_pixel_ratio,
            epoch,
            renderer_session_id,
        )
    }

    pub fn overlay_hit_renderer_ready(
        &self,
        app: &AppHandle,
        renderer_session_id: String,
    ) -> Result<u64> {
        self.overlay_hit.renderer_ready(app, renderer_session_id)
    }

    pub fn overlay_hit_renderer_load_started(&self, app: &AppHandle) -> Result<()> {
        self.overlay_hit.renderer_load_started(app)
    }

    pub fn set_overlay_anchor(&self, app: &AppHandle, anchor: &str) -> Result<String> {
        let parsed = overlay_resize_anchor_from_str(anchor);
        let value: OverlayResizeAnchor =
            parsed.unwrap_or_else(|| self.store.snapshot().overlay_resize_anchor.clone());
        let updated = self.store.update(|state| {
            state.overlay_resize_anchor = value.clone();
        })?;
        publish_event(app, "overlay:anchor", json!({ "anchor": value.as_str() }));
        Ok(updated.overlay_resize_anchor.as_str().to_string())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn resize_overlay(
        &self,
        app: &AppHandle,
        width: f64,
        height: f64,
        anchor: Option<String>,
        content_left_offset: Option<f64>,
        content_top_offset: Option<f64>,
        fixed_position_delta_x: Option<f64>,
        fixed_position_delta_y: Option<f64>,
    ) -> Result<OverlayBounds> {
        // 오버레이가 이미 열려있을 때만 리사이즈 수행
        // 창 미존재 시 에러 반환 (자동 생성하지 않음)
        let window = app
            .get_webview_window(OVERLAY_LABEL)
            .ok_or_else(|| anyhow!("Overlay window is not open"))?;
        let anchor = anchor
            .and_then(|value| overlay_resize_anchor_from_str(&value))
            .unwrap_or_else(|| self.store.snapshot().overlay_resize_anchor.clone());

        let requested_width = width;
        let requested_height = height;
        let width = clamp_overlay_dimension(width);
        let height = clamp_overlay_dimension(height);
        // 잘린 경우 콘텐츠 일부가 창 밖에 남으므로 진단용 기록
        if (requested_width - width).abs() >= 0.5 || (requested_height - height).abs() >= 0.5 {
            log::warn!(
                "[overlay] resize clamped: requested {requested_width}x{requested_height} -> {width}x{height}"
            );
        }

        let initializing = self.overlay_initializing.load(Ordering::SeqCst);
        let resolved = initializing
            .then(|| self.overlay_resolved_placement.lock().clone())
            .flatten();
        let current = match resolved.as_ref() {
            Some(resolved) => resolved.placement,
            None => native_placement_from_window(&window)?,
        };
        let mut placement = if let Some(resolved) = resolved.as_ref() {
            resolved.for_size(width, height)
        } else {
            NativePlacement {
                width,
                height,
                ..current
            }
        };
        // 직전 오프셋 두 개만 읽는다, 리사이즈마다 store 전체를 복제하지 않도록
        let (last_content_left_offset, last_content_top_offset) = self.store.with_state(|state| {
            (
                state.overlay_last_content_left_offset,
                state.overlay_last_content_top_offset,
            )
        });
        let content_left_change =
            content_offset_change(content_left_offset, last_content_left_offset);
        let content_top_change = content_offset_change(content_top_offset, last_content_top_offset);
        let next_content_left_offset = content_left_change.map(|(offset, _)| offset);
        let next_content_top_offset = content_top_change.map(|(offset, _)| offset);

        // 초기화 중(첫 resize)에는 anchor 기반 position 재계산을 건너뛰고
        // 기동 시 한 번 해석한 배치를 사용
        if !initializing {
            adjust_overlay_resize_position(
                &mut placement,
                current,
                &anchor,
                fixed_position_delta_x.filter(|value| value.is_finite()),
                fixed_position_delta_y.filter(|value| value.is_finite()),
                content_left_change.map(|(_, delta)| delta),
                content_top_change.map(|(_, delta)| delta),
            );
        }

        // 크기·위치를 단일 네이티브 트랜잭션으로 적용 - 분리 호출은 창이 두 단계로 움직여 덜컥거림 유발
        let applied = apply_overlay_frame(&window, placement)?;
        if initializing {
            *self.overlay_resolved_placement.lock() = None;
            self.overlay_initializing.store(false, Ordering::SeqCst);
        }
        persist_overlay_placement(
            &self.store,
            &self.overlay_bounds_generation,
            &self.overlay_placement_trust,
            applied.clone(),
            next_content_left_offset,
            next_content_top_offset,
            OverlayPersistenceAuthority::General,
        )?;
        let bounds = applied.public_bounds;

        log::debug!(
            "[IPC] resize_overlay: emit overlay:resized ({}x{} at {}, {})",
            bounds.width,
            bounds.height,
            bounds.x,
            bounds.y
        );
        publish_event(
            app,
            "overlay:resized",
            json!({
                "x": bounds.x,
                "y": bounds.y,
                "width": bounds.width,
                "height": bounds.height,
            }),
        );

        Ok(bounds)
    }

    /// 오버레이를 겹침이 가장 큰 모니터(없으면 주 모니터) 작업 영역 가운데로 되돌린다.
    /// 창이 화면 밖으로 나가 잡을 수 없을 때의 탈출구이므로 표시 여부도 창 존재 여부도 따지지 않는다.
    /// 창이 없으면 저장된 위치만 갱신해, 다음에 오버레이를 켰을 때 제자리에 뜬다
    pub fn reset_overlay_position(&self, app: &AppHandle) -> Result<OverlayBounds> {
        let window = app.get_webview_window(OVERLAY_LABEL);
        let snapshot = self.store.snapshot();
        let stored = snapshot.overlay_bounds;
        // 저장된 사각형을 해석하려면 모니터 정보가 먼저 필요하다
        let monitors = MonitorData::gather(app);

        // 창도 모니터 정보도 없으면 착지점을 고를 근거가 전무하다. 임의 좌표로
        // 덮어써 성공을 보고하느니 실패시켜 저장된 값과 마커를 보존한다
        if window.is_none() && monitors.is_empty() {
            return Err(anyhow!("monitor information unavailable"));
        }

        let current = match window.as_ref() {
            Some(window) => native_placement_from_window(window)?,
            None => overlay_reset_fallback_rect(
                stored.as_ref(),
                snapshot.overlay_bounds_are_logical,
                &monitors,
            ),
        };
        let target = monitors
            .find_best_overlap_native(current.native_rect())
            .or_else(|| monitors.primary_spec());
        let planned = match target {
            Some(spec) => {
                let width_native = spec.logical_length_to_native(current.width);
                let height_native = spec.logical_length_to_native(current.height);
                let rect = NativeRect {
                    x: spec.work_rect_native.x + (spec.work_rect_native.width - width_native) / 2.0,
                    y: spec.work_rect_native.y
                        + (spec.work_rect_native.height - height_native) / 2.0,
                    width: width_native,
                    height: height_native,
                };
                NativePlacement {
                    position: spec.clamp_native(rect),
                    width: current.width,
                    height: current.height,
                    target_scale: spec.logical_to_native_scale,
                }
            }
            None => NativePlacement {
                position: OverlayPosition {
                    x: OVERLAY_MARGIN * current.target_scale,
                    y: OVERLAY_MARGIN * current.target_scale,
                },
                ..current
            },
        };

        let applied = match window.as_ref() {
            Some(window) => apply_overlay_frame(window, planned)?,
            None => applied_overlay_frame_from_placement(planned),
        };

        // 크기가 그대로라 창 안에서의 콘텐츠 위치도 그대로 - 기준선을 건드리면
        // 다음 resize가 이동량을 두 번 반영한다
        persist_overlay_placement(
            &self.store,
            &self.overlay_bounds_generation,
            &self.overlay_placement_trust,
            applied.clone(),
            None,
            None,
            OverlayPersistenceAuthority::Reset,
        )?;
        let bounds = applied.public_bounds;

        publish_event(
            app,
            "overlay:resized",
            json!({
                "x": bounds.x,
                "y": bounds.y,
                "width": bounds.width,
                "height": bounds.height,
            }),
        );

        Ok(bounds)
    }

    pub(super) fn ensure_overlay_window(&self, app: &AppHandle) -> Result<WebviewWindow> {
        if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
            return Ok(window);
        }
        let _creation_guard = self.overlay_creation_lock.lock();
        self.ensure_overlay_window_while_locked(app)
    }

    fn ensure_overlay_window_while_locked(&self, app: &AppHandle) -> Result<WebviewWindow> {
        if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
            return Ok(window);
        }

        let snapshot = self.store.snapshot();
        let monitor_data = MonitorData::gather(app);
        let mut resolved = resolve_overlay_placement(
            snapshot.overlay_bounds.as_ref(),
            snapshot.overlay_bounds_are_logical,
            &monitor_data,
        );

        self.overlay_initializing.store(true, Ordering::SeqCst);
        *self.overlay_resolved_placement.lock() = None;

        let mut window_builder = WebviewWindowBuilder::new(
            app,
            OVERLAY_LABEL,
            WebviewUrl::App("overlay/index.html".into()),
        )
        .title("DM Note - Overlay")
        .window_classname(OVERLAY_WINDOW_CLASS)
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .zoom_hotkeys_enabled(false)
        .transparent(true)
            .always_on_top(true)
            .skip_taskbar(false)
            // 첫 표시를 SW_SHOWNOACTIVATE로 처리하도록 tao에 지시 (포커스 미탈취)
            .focused(false)
            .inner_size(resolved.placement.width, resolved.placement.height)
            .shadow(false)
            .devtools(true);
        #[cfg(target_os = "windows")]
        {
            window_builder = window_builder.visible(false);
        }
        #[cfg(not(target_os = "windows"))]
        {
            window_builder = window_builder
                .visible(snapshot.overlay_visible && resolved.pending_scale_resolution.is_none())
                .position(resolved.placement.position.x, resolved.placement.position.y);
        }

        let window = match window_builder.build() {
            Ok(window) => window,
            Err(error) => {
                self.overlay_initializing.store(false, Ordering::SeqCst);
                return Err(error).context("failed to create overlay window");
            }
        };
        if resolved.pending_scale_resolution.is_some() {
            let completed = overlay_restore_window_scale(&window)
                .ok()
                .and_then(|scale| complete_overlay_scale_resolution(resolved.clone(), scale));
            let Some(completed) = completed else {
                self.overlay_initializing.store(false, Ordering::SeqCst);
                let _ = window.destroy();
                return Err(anyhow!(
                    "failed to resolve initial overlay placement from the window scale"
                ));
            };
            resolved = completed;
        }

        log::debug!(
            "[overlay] restore source={} nativeRejectReason={} candidateCount={} selectedMonitor={} selectedScale={} visibilityAdjustment={}",
            resolved.source.as_str(),
            resolved.native_reject_reason.as_str(),
            resolved.candidate_count,
            resolved.selected_monitor.as_deref().unwrap_or("none"),
            resolved.selected_scale,
            resolved.visibility_adjustment,
        );
        log::trace!(
            "[overlay] restore nativePosition=({}, {}) logicalSize={}x{}",
            resolved.placement.position.x,
            resolved.placement.position.y,
            resolved.placement.width,
            resolved.placement.height,
        );
        *self.overlay_resolved_placement.lock() = Some(resolved.clone());
        #[cfg(target_os = "windows")]
        {
            *self.overlay_placement_trust.lock() = resolved.source.initial_trust();
        }
        #[cfg(not(target_os = "windows"))]
        {
            *self.overlay_placement_trust.lock() = OverlayPlacementTrust::Clean;
        }

        // Windows 접근성 텍스트 크기 설정에 의한 WebView2 스케일링을 보상
        let zoom = crate::compute_compensating_zoom();
        if crate::should_apply_compensating_zoom(zoom) {
            if let Err(err) = window.set_zoom(zoom) {
                log::warn!("failed to set overlay compensating zoom: {err}");
            }
        }

        // macOS 오버레이 창 포커스 탈취 방지
        #[cfg(target_os = "macos")]
        {
            if let Err(err) = window.set_focusable(false) {
                log::warn!("failed to set overlay non-focusable on macOS: {err}");
            }
        }

        // Windows 오버레이 창 포커스 수신 방지
        // set_focusable(false): tao가 FOCUSABLE 플래그로 WS_EX_NOACTIVATE를 추적 적용
        // (raw SetWindowLongW 적용 시 이후 tao의 스타일 재적용에서 NOACTIVATE가 소실됨)
        #[cfg(target_os = "windows")]
        {
            if let Err(err) = window.set_focusable(false) {
                log::warn!("failed to set overlay non-focusable: {err}");
            }
            // 시스템 컨텍스트 메뉴 비활성화
            if let Err(err) = disable_system_context_menu(&window) {
                log::warn!("failed to disable system context menu for overlay: {err}");
            }
        }

        let applied = match apply_overlay_frame(&window, resolved.placement) {
            Ok(applied) => applied,
            Err(error) => {
                self.overlay_initializing.store(false, Ordering::SeqCst);
                *self.overlay_resolved_placement.lock() = None;
                let _ = window.destroy();
                return Err(error.context("failed to apply initial overlay frame"));
            }
        };

        // 본체는 상시 클릭 통과 - 실제 잠금은 히트 창이 강제한다
        window.set_ignore_cursor_events(true)?;
        window.set_always_on_top(snapshot.always_on_top)?;
        if let Err(error) = self.overlay_hit.set_configuration(
            app,
            snapshot.overlay_visible,
            snapshot.overlay_locked,
            snapshot.always_on_top,
        ) {
            log::warn!("failed to configure overlay hit windows: {error:#}");
        }
        // show_overlay_window 내부에서 호출하므로, visible일 때만 적용
        // hidden 상태에서 호출 시 orderFrontRegardless가 윈도우를 강제 표시함
        #[cfg(target_os = "macos")]
        if snapshot.overlay_visible {
            apply_macos_overlay_fullscreen_behavior(&window, snapshot.always_on_top);
        }
        let _ = window.set_maximizable(false);

        self.configure_overlay_window(&window, app);
        #[cfg(target_os = "windows")]
        if let Err(error) = install_overlay_move_observer(
            &window,
            Arc::clone(&self.store),
            Arc::clone(&self.overlay_bounds_generation),
            Arc::clone(&self.overlay_placement_trust),
        ) {
            self.overlay_initializing.store(false, Ordering::SeqCst);
            *self.overlay_resolved_placement.lock() = None;
            let _ = window.destroy();
            return Err(error.context("failed to install overlay move observer"));
        }

        #[cfg(target_os = "windows")]
        let needs_marker_sync = resolved.source == OverlayRestoreSource::LegacyPhysical;
        #[cfg(not(target_os = "windows"))]
        let needs_marker_sync = !monitor_data.is_empty() && !snapshot.overlay_bounds_are_logical;
        if resolved.visibility_adjustment || snapshot.overlay_bounds.is_none() || needs_marker_sync
        {
            if let Err(err) = persist_overlay_placement(
                &self.store,
                &self.overlay_bounds_generation,
                &self.overlay_placement_trust,
                applied,
                None,
                None,
                OverlayPersistenceAuthority::General,
            ) {
                log::warn!("failed to persist initial overlay bounds: {err}");
            }
        }

        // overlay_initializing은 첫 resize_overlay 호출 시 해제됨
        // (프론트엔드 초기 렌더에서 resize가 반드시 호출되므로)

        // 모든 플랫폼별 설정(WS_EX_NOACTIVATE 등)이 완료된 후,
        // store의 overlay_visible 상태에 따라 조건부 표시
        if snapshot.overlay_visible {
            // SW_SHOWNOACTIVATE 표시로 포커스 미탈취 보장
            show_overlay_window(&window, snapshot.always_on_top)?;
            *self.overlay_visible.write() = true;
        } else {
            hide_overlay_window(&window)?;
            *self.overlay_visible.write() = false;
        }

        Ok(window)
    }

    fn configure_overlay_window(&self, window: &WebviewWindow, app: &AppHandle) {
        let overlay_visible = self.overlay_visible.clone();
        let store = self.store.clone();
        let app_handle = app.clone();
        let overlay_window = window.clone();
        let force_close_flag = self.overlay_force_close.clone();
        let initializing_flag = self.overlay_initializing.clone();
        let resolved_placement = self.overlay_resolved_placement.clone();
        let bounds_generation = self.overlay_bounds_generation.clone();
        let placement_trust = self.overlay_placement_trust.clone();
        let overlay_hit = self.overlay_hit.clone();

        window.on_window_event(move |event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                #[cfg(target_os = "windows")]
                let lifecycle_pending = app_handle
                    .try_state::<AppState>()
                    .is_some_and(|state| state.frontend_lifecycle_pending());
                #[cfg(not(target_os = "windows"))]
                let lifecycle_pending = false;

                match overlay_close_action(
                    force_close_flag.load(Ordering::SeqCst),
                    lifecycle_pending,
                ) {
                    OverlayCloseAction::AllowClose => {
                        // 앱 종료 시 — 실제 close 허용.
                        // 히트 창 정리는 뒤따르는 Destroyed가 맡는다 - 종료 중
                        // 메인 스레드 디스패치는 도달을 보장할 수 없다
                        *overlay_visible.write() = false;
                    }
                    OverlayCloseAction::PreserveVisibility => {
                        // Windows의 작업 표시줄 그룹 종료가 오버레이에도 WM_CLOSE를 보내는 구간.
                        // 표시 상태를 보존하는 경로라 히트 창도 그대로 둔다
                        api.prevent_close();
                        log::debug!(
                            "[Overlay] preserving visibility during frontend lifecycle flush"
                        );
                    }
                    OverlayCloseAction::HideAndPersist => {
                        api.prevent_close();
                        if let Err(err) =
                            flush_deferred_overlay_bounds(&store, &bounds_generation)
                        {
                            log::warn!("failed to flush overlay bounds on close: {err}");
                            return;
                        }
                        // 숨김 먼저, 저장은 성공 후 — set_overlay_visibility와 같은 전환 계약
                        if let Err(err) = overlay_hit.set_visible(&app_handle, false) {
                            log::warn!("failed to hide overlay hit windows on close: {err:#}");
                        }
                        if let Err(err) = overlay_window.hide() {
                            log::error!("failed to hide overlay window on close: {err}");
                            let _ = overlay_hit.set_visible(&app_handle, true);
                            return;
                        }
                        if let Err(err) = store.update(|state| {
                            state.overlay_visible = false;
                        }) {
                            log::warn!("failed to persist overlay visibility on close: {err}");
                            // 보상: 숨김을 되돌려 전 계층을 이전 상태로 일치
                            if let Err(show_err) = overlay_window.show() {
                                // 보상 실패 — 실제 창 상태(숨김)를 권위로 runtime과 이벤트만 동기화
                                log::error!("failed to compensate overlay hide: {show_err}");
                                *overlay_visible.write() = false;
                                publish_event(
                                    &app_handle,
                                    "overlay:visibility",
                                    json!({ "visible": false }),
                                );
                            } else if let Err(error) =
                                overlay_hit.set_visible(&app_handle, true)
                            {
                                log::warn!("failed to restore overlay hit windows: {error:#}");
                            }
                            return;
                        }
                        *overlay_visible.write() = false;
                        publish_event(
                            &app_handle,
                            "overlay:visibility",
                            json!({ "visible": false }),
                        );
                    }
                }
            }
            WindowEvent::Focused(true) => {
                // WS_EX_NOACTIVATE 적용 시 미발생 예상 이벤트
                log::debug!("overlay received focus event (unexpected with WS_EX_NOACTIVATE)");
            }
            WindowEvent::Focused(false) => {
                let snapshot = store.snapshot();
                if let Err(err) = overlay_window.set_always_on_top(snapshot.always_on_top) {
                    log::warn!("failed to reapply always on top: {err}");
                }
                #[cfg(target_os = "macos")]
                apply_macos_overlay_fullscreen_behavior(&overlay_window, snapshot.always_on_top);
            }
            WindowEvent::Moved(_) | WindowEvent::Resized(_)
                // 윈도우 초기화 중에는 OS가 보고하는 좌표로 저장된 bounds를 덮어쓰지 않음
                if !initializing_flag.load(Ordering::SeqCst) => {
                    if let Err(err) = persist_overlay_placement_from_window(
                        &overlay_window,
                        &store,
                        &bounds_generation,
                        &placement_trust,
                        OverlayPersistenceAuthority::General,
                    ) {
                        log::warn!("failed to defer overlay bounds: {err}");
                    }
                    if let Err(err) = overlay_hit.reconcile(&app_handle) {
                        log::warn!("failed to follow overlay hit windows: {err:#}");
                    }
                }
            WindowEvent::ScaleFactorChanged { .. } => {
                if let Err(err) = overlay_hit.invalidate_for_scale_change(&app_handle) {
                    log::warn!("failed to invalidate scaled overlay hit regions: {err:#}");
                }
            }
            WindowEvent::Destroyed => {
                initializing_flag.store(false, Ordering::SeqCst);
                *resolved_placement.lock() = None;
                if let Err(err) = overlay_hit.reset_for_parent_loss(&app_handle) {
                    log::warn!("failed to reset overlay hit state after parent loss: {err:#}");
                }
            }
            _ => {}
        });
    }

    fn apply_settings_effects(&self, diff: &SettingsDiff, app: &AppHandle) -> Result<()> {
        // 오버레이가 보이는 상태일 때만 설정 적용
        let is_visible = *self.overlay_visible.read();

        if let Some(value) = diff.changed.always_on_top {
            if is_visible {
                if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
                    window.set_always_on_top(value)?;
                    #[cfg(target_os = "macos")]
                    apply_macos_overlay_fullscreen_behavior(&window, value);
                }
            }
            if let Err(error) = self.overlay_hit.set_always_on_top(app, value) {
                log::warn!("failed to update overlay hit always-on-top: {error:#}");
            }
        }

        if let Some(value) = diff.changed.overlay_locked {
            // 본체는 상시 클릭 통과라 잠금은 히트 창에만 반영한다
            if let Err(error) = self.overlay_hit.set_locked(app, value) {
                log::warn!("failed to update overlay hit lock: {error:#}");
            }
            publish_event(app, "overlay:lock", json!({ "locked": value }));
        }

        if let Some(enabled) = diff.changed.developer_mode_enabled {
            // 활성화 시에만 DevTools 열기
            if enabled {
                if let Some(main) = app.get_webview_window("main") {
                    main.open_devtools();
                }
                if let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) {
                    overlay.open_devtools();
                }
                if let Some(panel) = app.get_webview_window(PANEL_LABEL) {
                    panel.open_devtools();
                }
            }
        }

        if let Some(enabled) = diff.changed.tray_enabled {
            if !enabled {
                dispatch_remove_tray_icon(app)?;
                if let Err(err) = self.set_main_window_hidden(false) {
                    log::warn!(
                        "failed to clear main_window_hidden when disabling tray mode: {err}"
                    );
                }
            } else if self.store.snapshot().main_window_hidden {
                self.ensure_tray_icon_for_background(app)?;
            }
        }

        if diff.changed.shortcuts.is_some() {
            // 변경된 글로벌 단축키 적용을 위해 키보드 daemon 재시작
            self.restart_keyboard_hook(app.clone())?;
        }

        Ok(())
    }
}
