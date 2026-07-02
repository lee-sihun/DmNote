#[cfg(debug_assertions)]
use std::time::Instant;
use std::{
    collections::HashSet,
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

use anyhow::{anyhow, Context, Result};
use log::{error, warn};
use parking_lot::RwLock;
use serde_json::json;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Monitor, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_runtime_wry::wry::dpi::{LogicalPosition, LogicalSize};

use super::store::AppStore;
#[cfg(debug_assertions)]
use crate::audio::KeySoundDispatchTrace;
use crate::{
    audio::{
        KeySoundEngine, KeySoundOutputBackend, KeySoundOutputDevices, KeySoundOutputState,
        KeySoundStatus,
    },
    keyboard::KeyboardManager,
    models::{
        overlay_resize_anchor_from_str, BootstrapOverlayState, BootstrapPayload, DefaultsPayload,
        KeyCounterSettings, KeyCounters, KeyMappings, KeySoundOutputBackendPersist, OverlayBounds,
        OverlayResizeAnchor, SettingsDiff, SettingsState,
    },
    services::{css_watcher::CssWatcher, obs_bridge::ObsBridgeService, settings::SettingsService},
};

const OVERLAY_LABEL: &str = "overlay";
const TRAY_ICON_ID: &str = "background-tray";
const TRAY_MENU_SETTINGS_ID: &str = "tray-settings";
const TRAY_MENU_QUIT_ID: &str = "tray-quit";
const DEFAULT_OVERLAY_WIDTH: f64 = 860.0;
const DEFAULT_OVERLAY_HEIGHT: f64 = 320.0;
const OVERLAY_MARGIN: f64 = 40.0;

pub struct AppState {
    pub store: Arc<AppStore>,
    pub settings: SettingsService,
    pub keyboard: KeyboardManager,
    overlay_visible: Arc<RwLock<bool>>,
    overlay_force_close: Arc<AtomicBool>,
    /// 오버레이 윈도우 초기화 중 Moved/Resized 이벤트에서 bounds 저장 억제
    overlay_initializing: Arc<AtomicBool>,
    keyboard_task: RwLock<Option<KeyboardDaemonTask>>,
    key_counters: Arc<RwLock<KeyCounters>>,
    key_counter_enabled: Arc<AtomicBool>,
    active_keys: Arc<RwLock<HashSet<String>>>,
    /// Raw input stream subscriber count - emit only when > 0
    raw_input_subscribers: Arc<std::sync::atomic::AtomicU32>,
    key_sound: Arc<KeySoundEngine>,
    /// CSS 파일 핫리로딩 워처
    css_watcher: RwLock<Option<CssWatcher>>,
    /// OBS WebSocket 브릿지
    pub obs_bridge: Arc<ObsBridgeService>,
    /// OBS 모드 시작 전 오버레이 가시성 상태 (복원용)
    obs_previous_overlay_visible: Arc<RwLock<Option<bool>>>,
}

impl AppState {
    pub fn initialize(store: AppStore) -> Result<Self> {
        let store = Arc::new(store);
        let snapshot = store.snapshot();
        let keyboard =
            KeyboardManager::new(snapshot.keys.clone(), snapshot.selected_key_type.clone());
        let settings = SettingsService::new(store.clone());

        let key_counters = Arc::new(RwLock::new(snapshot.key_counters.clone()));
        Self::sync_counters_with_keys_impl(&key_counters, &snapshot.keys);
        let key_counter_enabled = Arc::new(AtomicBool::new(snapshot.key_counter_enabled));
        let active_keys = Arc::new(RwLock::new(HashSet::new()));
        // 저장된 출력 백엔드로 엔진을 처음부터 초기화 → "기본 장치 → ASIO" 전환 깜빡임 제거.
        let initial_backend = snapshot
            .key_sound_output_backend
            .clone()
            .map(output_backend_from_persist)
            .unwrap_or_default();
        let key_sound = Arc::new(KeySoundEngine::with_output_backend(initial_backend));
        let obs_bridge = Arc::new(ObsBridgeService::new(env!("CARGO_PKG_VERSION")));

        Ok(Self {
            store,
            settings,
            keyboard,
            overlay_visible: Arc::new(RwLock::new(false)),
            overlay_force_close: Arc::new(AtomicBool::new(false)),
            overlay_initializing: Arc::new(AtomicBool::new(false)),
            keyboard_task: RwLock::new(None),
            key_counters,
            key_counter_enabled,
            active_keys,
            raw_input_subscribers: Arc::new(std::sync::atomic::AtomicU32::new(0)),
            key_sound,
            css_watcher: RwLock::new(None),
            obs_bridge,
            obs_previous_overlay_visible: Arc::new(RwLock::new(None)),
        })
    }

    pub fn initialize_runtime(&self, app: &AppHandle) -> Result<()> {
        self.attach_main_window_handlers(app);
        let snapshot = self.store.snapshot();
        // OBS 모드가 활성화된 상태로 부팅하면 오버레이 생성 건너뛰기 (create→destroy 낭비 방지)
        if !snapshot.obs_mode_enabled {
            self.ensure_overlay_window(app)?;
        }
        // 개발자 모드가 켜져 있으면 시작 시 DevTools 오픈 허용 및 자동 오픈 시도
        if snapshot.developer_mode_enabled {
            if let Some(main) = app.get_webview_window("main") {
                main.open_devtools();
            }
            if let Some(overlay) = app.get_webview_window("overlay") {
                overlay.open_devtools();
            }
        }
        self.start_keyboard_hook(app.clone())?;
        // CSS 핫리로딩 워처 초기화
        self.initialize_css_watcher(app);
        // OBS 모드 자동 복원
        if snapshot.obs_mode_enabled {
            self.auto_start_obs(app);
        }
        Ok(())
    }

    fn attach_main_window_handlers(&self, app: &AppHandle) {
        let overlay_force_close = self.overlay_force_close.clone();
        if let Some(window) = app.get_webview_window("main") {
            attach_main_window_close_handler(window, overlay_force_close, app.clone());
            return;
        }

        let overlay_force_close = overlay_force_close.clone();
        let app_handle = app.clone();
        thread::spawn(move || {
            for _ in 0..15 {
                if let Some(window) = app_handle.get_webview_window("main") {
                    attach_main_window_close_handler(
                        window,
                        overlay_force_close.clone(),
                        app_handle.clone(),
                    );
                    break;
                }
                thread::sleep(Duration::from_millis(25));
            }
        });
    }

    pub fn ensure_tray_icon_for_background(&self, app: &AppHandle) -> Result<()> {
        if app.tray_by_id(TRAY_ICON_ID).is_some() {
            return Ok(());
        }

        let snapshot = self.store.snapshot();
        let (settings_label, quit_label) = tray_menu_labels(&snapshot.language);

        let settings_item = MenuItem::with_id(
            app,
            TRAY_MENU_SETTINGS_ID,
            settings_label,
            true,
            None::<&str>,
        )?;
        let quit_item = MenuItem::with_id(app, TRAY_MENU_QUIT_ID, quit_label, true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&settings_item, &quit_item])?;
        let overlay_force_close = self.overlay_force_close.clone();

        let mut tray_builder = TrayIconBuilder::with_id(TRAY_ICON_ID)
            .menu(&menu)
            .show_menu_on_left_click(false);
        if let Some(icon) = app.default_window_icon().cloned() {
            tray_builder = tray_builder.icon(icon);
        }

        tray_builder
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    if let Err(err) = show_main_window(tray.app_handle()) {
                        log::error!("failed to show main window from tray click: {err}");
                    }
                }
            })
            .on_menu_event(move |app_handle, event| {
                if event.id() == TRAY_MENU_SETTINGS_ID {
                    if let Err(err) = show_main_window(app_handle) {
                        log::error!("failed to show main window from tray: {err}");
                    }
                    return;
                }

                if event.id() == TRAY_MENU_QUIT_ID {
                    let app_for_shutdown = app_handle.clone();
                    let overlay_force_close_for_shutdown = overlay_force_close.clone();
                    thread::spawn(move || {
                        shutdown_application(app_for_shutdown, overlay_force_close_for_shutdown);
                    });
                }
            })
            .build(app)?;

        Ok(())
    }

    pub fn set_main_window_hidden(&self, hidden: bool) -> Result<()> {
        let _ = self.store.update(|state| {
            state.main_window_hidden = hidden;
        })?;
        Ok(())
    }

    pub fn bootstrap_payload(&self) -> BootstrapPayload {
        let state = self.store.snapshot();
        let mut custom_js = state.custom_js.clone();
        let _ = custom_js.normalize();
        BootstrapPayload {
            defaults: DefaultsPayload {
                settings: SettingsState::default(),
                counter_settings: KeyCounterSettings::default(),
            },
            settings: SettingsState {
                hardware_acceleration: state.hardware_acceleration,
                always_on_top: state.always_on_top,
                overlay_locked: state.overlay_locked,
                note_effect: state.note_effect,
                note_settings: state.note_settings.clone(),
                angle_mode: state.angle_mode.clone(),
                language: state.language.clone(),
                laboratory_enabled: state.laboratory_enabled,
                developer_mode_enabled: state.developer_mode_enabled,
                tray_enabled: state.tray_enabled,
                auto_update_enabled: state.auto_update_enabled,
                background_color: state.background_color.clone(),
                use_custom_css: state.use_custom_css,
                custom_css: state.custom_css.clone(),
                font_settings: state.font_settings.clone(),
                use_custom_js: state.use_custom_js,
                custom_js,
                overlay_resize_anchor: state.overlay_resize_anchor.clone(),
                key_counter_enabled: state.key_counter_enabled,
                grid_settings: state.grid_settings.clone(),
                shortcuts: state.shortcuts.clone(),
                obs_mode_enabled: state.obs_mode_enabled,
            },
            keys: state.keys.clone(),
            positions: state.key_positions.clone(),
            stat_positions: state.stat_positions.clone(),
            graph_positions: state.graph_positions.clone(),
            knob_positions: state.knob_positions.clone(),
            custom_tabs: state.custom_tabs.clone(),
            selected_key_type: state.selected_key_type.clone(),
            current_mode: self.keyboard.current_mode(),
            overlay: BootstrapOverlayState {
                visible: *self.overlay_visible.read(),
                locked: state.overlay_locked,
                anchor: state.overlay_resize_anchor.as_str().to_string(),
            },
            key_counters: self.key_counters.read().clone(),
            layer_groups: state.layer_groups.clone(),
            tab_note_overrides: state.tab_note_overrides.clone(),
            tab_css_overrides: state.tab_css_overrides.clone(),
        }
    }

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
        // OBS 브릿지 캐시 갱신 (이벤트는 register_event_forwarding이 자동 포워딩)
        if self.obs_bridge.is_running() {
            let bp = self.bootstrap_payload();
            if let Ok(snap) = serde_json::to_value(&bp) {
                self.obs_bridge.update_snapshot(snap);
            }
        }
        // 전체 설정 페이로드 전송 방지 (임베디드 폰트 등 대용량 데이터 제외)
        let mut payload = diff.clone();
        payload.full = None;
        app.emit("settings:changed", payload)?;
        Ok(())
    }

    /// 부팅 시 OBS 모드 자동 시작 (obs_mode_enabled=true일 때)
    fn auto_start_obs(&self, app: &AppHandle) {
        let bridge = self.obs_bridge.clone();
        let store = self.store.clone();
        let (port, existing_token) = store.with_state(|s| (s.obs_port, s.obs_token.clone()));
        // 저장된 토큰 재사용 또는 신규 생성
        let token = match existing_token {
            Some(t) if !t.is_empty() => t,
            _ => {
                let t = uuid::Uuid::new_v4().simple().to_string();
                let tc = t.clone();
                let _ = store.update(|s| {
                    s.obs_token = Some(tc.clone());
                });
                t
            }
        };
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
        // Tauri 이벤트 → OBS WS 포워딩 리스너 등록
        bridge.register_event_forwarding(app);

        // 부팅 시에는 오버레이를 생성하지 않았으므로 상태만 저장
        // (initialize_runtime에서 obs_mode_enabled일 때 ensure_overlay_window 건너뜀)
        let was_visible = self.store.with_state(|s| s.overlay_visible);
        *self.obs_previous_overlay_visible.write() = Some(was_visible);

        // async start를 tokio 런타임에서 실행
        tauri::async_runtime::spawn(async move {
            match bridge.start(port, token).await {
                Ok(actual_port) => {
                    log::info!("[ObsBridge] auto-start 성공 (port={})", actual_port);
                    // fallback 포트가 사용된 경우 store에 저장
                    if actual_port != port {
                        let _ = store.update(|s| {
                            s.obs_port = actual_port;
                        });
                    }
                    let state = app_handle.state::<AppState>();
                    // 초기 스냅샷 캐싱 (신규 클라이언트에 전송됨)
                    state.refresh_obs_snapshot();
                    let _ = app_handle.emit("obs:status", &state.obs_bridge.status());
                }
                Err(e) => {
                    log::error!(
                        "[ObsBridge] auto-start 실패: {} — obs_mode_enabled를 false로 복구",
                        e
                    );
                    let _ = store.update(|state| {
                        state.obs_mode_enabled = false;
                    });
                    // 실패 시 오버레이 복원 (윈도우 재생성 포함)
                    let state = app_handle.state::<AppState>();
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
        // destroy 성공(또는 윈도우 부재) 후 런타임 플래그만 갱신
        // store.overlay_visible은 변경하지 않음 — ensure_overlay_window가 재생성 시
        // 이 값을 기준으로 show/hide를 결정하므로, 원래 값을 유지해야 함
        *self.overlay_visible.write() = false;
        let _ = app.emit("overlay:visibility", &json!({ "visible": false }));
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

    /// OBS 브릿지 캐시 스냅샷 갱신 (이벤트는 register_event_forwarding이 자동 포워딩)
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

    /// OBS 브릿지 캐시 스냅샷 갱신 (카운터 이벤트는 register_event_forwarding이 자동 포워딩)
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

        if visible {
            // 오버레이를 열 때: 창이 없으면 생성하고 표시
            let window = self.ensure_overlay_window(app)?;
            let snapshot = self.store.snapshot();
            show_overlay_window(&window, snapshot.always_on_top)?;

            // 오버레이가 숨겨진 동안 변경된 설정을 다시 적용
            window.set_ignore_cursor_events(snapshot.overlay_locked)?;
            window.set_always_on_top(snapshot.always_on_top)?;
            #[cfg(target_os = "macos")]
            apply_macos_overlay_fullscreen_behavior(&window, snapshot.always_on_top);
        } else {
            // 오버레이를 숨길 때: 창이 존재하는 경우에만 숨김
            // 창 미존재 시 무시 (창 생성하지 않음)
            if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
                hide_overlay_window(&window)?;
            }
        }

        *self.overlay_visible.write() = visible;
        if let Err(err) = self.store.update(|state| {
            state.overlay_visible = visible;
        }) {
            log::warn!("failed to persist overlay visibility: {err}");
        }
        app.emit("overlay:visibility", &json!({ "visible": visible }))?;
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

        // 오버레이가 보이는 상태일 때만 설정 적용
        // 비표시 상태: 설정값만 저장, 오버레이 열 때 적용
        let is_visible = *self.overlay_visible.read();
        if is_visible {
            if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
                window.set_ignore_cursor_events(locked)?;
            }
        }
        app.emit("overlay:lock", &json!({ "locked": locked }))?;
        Ok(())
    }

    pub fn shutdown(&self) {
        if let Err(err) = self.persist_key_counters() {
            log::warn!("failed to persist key counters during shutdown: {err}");
        }
        if let Err(err) = self.store.cleanup_orphan_assets_now() {
            log::warn!("failed to cleanup orphan assets during shutdown: {err}");
        }
        if let Some(task) = self.keyboard_task.write().take() {
            drop(task);
        }
        // CSS 워처 정리
        if let Some(watcher) = self.css_watcher.write().take() {
            watcher.shutdown();
        }
    }

    pub fn request_shutdown(&self, app_handle: AppHandle) {
        let overlay_force_close = self.overlay_force_close.clone();
        thread::spawn(move || {
            shutdown_application(app_handle, overlay_force_close);
        });
    }

    pub fn set_overlay_anchor(&self, app: &AppHandle, anchor: &str) -> Result<String> {
        let parsed = overlay_resize_anchor_from_str(anchor);
        let value: OverlayResizeAnchor =
            parsed.unwrap_or_else(|| self.store.snapshot().overlay_resize_anchor.clone());
        let updated = self.store.update(|state| {
            state.overlay_resize_anchor = value.clone();
        })?;
        app.emit("overlay:anchor", &json!({ "anchor": value.as_str() }))?;
        Ok(updated.overlay_resize_anchor.as_str().to_string())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn resize_overlay(
        &self,
        app: &AppHandle,
        width: f64,
        height: f64,
        anchor: Option<String>,
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

        let width = width.clamp(100.0, 2000.0).round();
        let height = height.clamp(100.0, 2000.0).round();

        let scale_factor = window.scale_factor().unwrap_or(1.0);
        let position = window
            .outer_position()
            .map(|value| value.to_logical::<f64>(scale_factor))
            .unwrap_or_else(|_| LogicalPosition::new(0.0, 0.0));
        let size = window
            .outer_size()
            .map(|value| value.to_logical::<f64>(scale_factor))
            .unwrap_or_else(|_| LogicalSize::new(DEFAULT_OVERLAY_WIDTH, DEFAULT_OVERLAY_HEIGHT));

        let mut new_x = position.x;
        let mut new_y = position.y;

        // 초기화 중(첫 resize)에는 anchor 기반 position 재계산을 건너뛰고
        // store에 저장된 위치를 사용 (빌더 position이 무시될 수 있으므로)
        let initializing = self.overlay_initializing.swap(false, Ordering::SeqCst);
        if initializing {
            // store에서 저장된 위치를 가져와 사용 (빌더 position이 무시될 수 있으므로)
            if let Some(stored) = self.store.snapshot().overlay_bounds.as_ref() {
                new_x = stored.x;
                new_y = stored.y;
            }
            // 초기화 중이라도 content_top_offset은 저장해야 다음 resize에서 delta 계산이 정확함
            if let Some(offset) = content_top_offset {
                if offset.is_finite() {
                    let _ = self.store.update(|state| {
                        state.overlay_last_content_top_offset = Some(offset);
                    })?;
                }
            }
        } else {
            match anchor {
                OverlayResizeAnchor::BottomLeft => new_y += size.height - height,
                OverlayResizeAnchor::TopRight => new_x += size.width - width,
                OverlayResizeAnchor::BottomRight => {
                    new_x += size.width - width;
                    new_y += size.height - height;
                }
                OverlayResizeAnchor::Center => {
                    new_x += (size.width - width) / 2.0;
                    new_y += (size.height - height) / 2.0;
                }
                OverlayResizeAnchor::FixedPosition => {}
                OverlayResizeAnchor::TopLeft => {}
            }

            if anchor == OverlayResizeAnchor::FixedPosition {
                if let Some(delta_x) = fixed_position_delta_x.filter(|value| value.is_finite()) {
                    new_x += delta_x;
                }
                if let Some(delta_y) = fixed_position_delta_y.filter(|value| value.is_finite()) {
                    new_y += delta_y;
                }
            }

            if let Some(offset) = content_top_offset {
                if offset.is_finite() {
                    let previous = self
                        .store
                        .snapshot()
                        .overlay_last_content_top_offset
                        .unwrap_or(offset);
                    let delta = offset - previous;
                    if delta != 0.0 {
                        match anchor {
                            OverlayResizeAnchor::Center => new_y -= delta / 2.0,
                            OverlayResizeAnchor::BottomLeft | OverlayResizeAnchor::BottomRight => {}
                            OverlayResizeAnchor::FixedPosition => new_y -= delta,
                            _ => new_y -= delta,
                        }
                    }
                    let _ = self.store.update(|state| {
                        state.overlay_last_content_top_offset = Some(offset);
                    })?;
                }
            }
        }

        window.set_size(LogicalSize::new(width, height))?;
        window.set_position(LogicalPosition::new(new_x, new_y))?;

        let bounds = OverlayBounds {
            x: new_x,
            y: new_y,
            width,
            height,
        };

        let _ = self.store.update(|state| {
            state.overlay_bounds = Some(bounds.clone());
            state.overlay_bounds_are_logical = true;
        })?;

        log::debug!(
            "[IPC] resize_overlay: emit overlay:resized ({}x{} at {}, {})",
            bounds.width,
            bounds.height,
            bounds.x,
            bounds.y
        );
        app.emit(
            "overlay:resized",
            &json!({
                "x": bounds.x,
                "y": bounds.y,
                "width": bounds.width,
                "height": bounds.height,
            }),
        )?;

        Ok(bounds)
    }

    pub fn start_keyboard_hook(&self, app: AppHandle) -> Result<()> {
        let mut task_guard = self.keyboard_task.write();
        if task_guard.is_some() {
            return Ok(());
        }

        self.clear_active_keys();

        let current_exe = std::env::current_exe().context("failed to locate dm-note executable")?;
        let shortcuts_json = serde_json::to_string(&self.store.settings_snapshot().shortcuts)
            .unwrap_or_else(|_| "{}".to_string());

        // Named Pipe 서버를 비동기로 준비 (daemon 스폰 전 블로킹 방지)
        #[cfg(target_os = "windows")]
        let pipe_receiver: Option<std::sync::mpsc::Receiver<Option<std::fs::File>>> = {
            use std::sync::mpsc;
            let (tx, rx) = mpsc::channel();
            std::thread::spawn(
                move || match crate::ipc::pipe_server_create("dmnote_keys_v1") {
                    Ok(f) => {
                        let _ = tx.send(Some(f));
                    }
                    Err(err) => {
                        warn!("failed to create named pipe: {err}");
                        let _ = tx.send(None);
                    }
                },
            );
            Some(rx)
        };
        #[cfg(not(target_os = "windows"))]
        let _pipe_receiver: Option<std::sync::mpsc::Receiver<Option<std::fs::File>>> = None;
        let mut child = Command::new(current_exe)
            .arg("--keyboard-daemon")
            .env("DMNOTE_HOTKEYS_V1", shortcuts_json)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("failed to spawn keyboard daemon process")?;

        let stdout = child
            .stdout
            .take()
            .context("keyboard daemon stdout unavailable")?;
        let stderr = child.stderr.take();

        let running = Arc::new(AtomicBool::new(true));
        let running_reader = running.clone();
        let keyboard = self.keyboard.clone();
        let app_handle = app.clone();

        let reader_handle = thread::Builder::new()
            .name("keyboard-daemon-reader".into())
            .spawn(move || {
            let mut keys_state_emit_count: u64 = 0;
                // Named Pipe 우선 사용; 불가 시 stdout fallback
                #[allow(unused_mut)]
                let mut reader: BufReader<Box<dyn std::io::Read + Send>> = {
                    #[cfg(target_os = "windows")]
                    {
                        if let Some(rx) = pipe_receiver {
                            // Pipe 준비 대기; 타임아웃 시 stdout fallback
                            match rx.recv_timeout(Duration::from_millis(1500)) {
                                Ok(Some(f)) => BufReader::new(Box::new(f)),
                                _ => BufReader::new(Box::new(stdout)),
                            }
                        } else {
                            BufReader::new(Box::new(stdout))
                        }
                    }
                    #[cfg(not(target_os = "windows"))]
                    {
                        BufReader::new(Box::new(stdout))
                    }
                };
                let mut overlay_window = app_handle.get_webview_window(OVERLAY_LABEL);
                // Windows에서 reader 스레드 우선순위 약간 상향
                #[cfg(target_os = "windows")]
                unsafe {
                    use windows::Win32::System::Threading::{GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_ABOVE_NORMAL};
                    let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_ABOVE_NORMAL);
                }

                while running_reader.load(Ordering::SeqCst) {
                    let mut line = String::new();
                    match reader.read_line(&mut line) {
                        Ok(0) => break,
                        Ok(_) => {
                            let s = line.trim();
                            if s.is_empty() {
                                continue;
                            }

                            // DaemonCommand(글로벌 단축키) 파싱 우선 시도
                            if let Ok(command) = serde_json::from_str::<crate::ipc::DaemonCommand>(s) {
                                match command {
                                    crate::ipc::DaemonCommand::ToggleOverlay => {
                                        log::info!("[AppState] received ToggleOverlay command from daemon");
                                        let app_state = app_handle.state::<AppState>();
                                        if app_state.is_obs_mode_active() {
                                            log::info!("[AppState] OBS 모드 활성화 중 — 오버레이 토글 무시");
                                        } else {
                                        let is_visible = *app_state.overlay_visible.read();
                                        if let Err(err) = app_state.set_overlay_visibility(&app_handle, !is_visible) {
                                            log::error!("failed to toggle overlay visibility: {err}");
                                        }
                                        }
                                    }
                                    crate::ipc::DaemonCommand::ToggleOverlayLock => {
                                        log::info!("[AppState] received ToggleOverlayLock command from daemon");
                                        let app_state = app_handle.state::<AppState>();
                                        let current = app_state.store.snapshot().overlay_locked;
                                        match app_state.settings.apply_patch(crate::models::SettingsPatchInput {
                                            overlay_locked: Some(!current),
                                            ..Default::default()
                                        }) {
                                            Ok(diff) => {
                                                if let Err(err) = app_state.emit_settings_changed(&diff, &app_handle) {
                                                    log::error!("failed to apply overlay lock toggle: {err}");
                                                }
                                            }
                                            Err(err) => log::error!("failed to toggle overlay lock: {err}"),
                                        }
                                    }
                                    crate::ipc::DaemonCommand::ToggleAlwaysOnTop => {
                                        log::info!("[AppState] received ToggleAlwaysOnTop command from daemon");
                                        let app_state = app_handle.state::<AppState>();
                                        let current = app_state.store.snapshot().always_on_top;
                                        match app_state.settings.apply_patch(crate::models::SettingsPatchInput {
                                            always_on_top: Some(!current),
                                            ..Default::default()
                                        }) {
                                            Ok(diff) => {
                                                if let Err(err) = app_state.emit_settings_changed(&diff, &app_handle) {
                                                    log::error!("failed to apply always-on-top toggle: {err}");
                                                }
                                            }
                                            Err(err) => log::error!("failed to toggle always-on-top: {err}"),
                                        }
                                    }
                                }
                                continue;
                            }

                            // HID 축(노브) 메시지 → input:axis 이벤트 브로드캐스트
                            // (버튼은 아래 HookMessage 경로로 기존 키 시각화 재사용)
                            if let Ok(axis) =
                                serde_json::from_str::<crate::ipc::HidAxisMessage>(s)
                            {
                                let _ = app_handle.emit(
                                    "input:axis",
                                    &json!({
                                        "axisId": axis.axis_id,
                                        "value": axis.value,
                                        "full": axis.full,
                                    }),
                                );
                                continue;
                            }

                            // 우선 형식: JSON 인코딩된 HookMessage (device 포함)
                            let parsed: Option<crate::ipc::HookMessage> =
                                serde_json::from_str(s).ok();

                            let message = if let Some(msg) = parsed {
                                if msg.labels.is_empty() {
                                    continue;
                                }
                                msg
                            } else {
                                // 레거시 간소 형식: "D:<label>" / "U:<label>"
                                if s.len() < 3
                                    || !s.as_bytes().get(1).map(|c| *c == b':').unwrap_or(false)
                                {
                                    continue;
                                }
                                let (state_ch, rest) = s.split_at(1);
                                let key = &rest[1..];
                                if key.is_empty() {
                                    continue;
                                }
                                crate::ipc::HookMessage {
                                    device: crate::ipc::InputDeviceKind::Keyboard,
                                    labels: vec![key.to_string()],
                                    state: if state_ch == "D" {
                                        crate::ipc::HookKeyState::Down
                                    } else {
                                        crate::ipc::HookKeyState::Up
                                    },
                                    vk_code: None,
                                    scan_code: None,
                                    flags: None,
                                }
                            };

                            let device_str = match message.device {
                                crate::ipc::InputDeviceKind::Keyboard => "keyboard",
                                crate::ipc::InputDeviceKind::Mouse => "mouse",
                                crate::ipc::InputDeviceKind::Gamepad => "gamepad",
                                crate::ipc::InputDeviceKind::Unknown => "unknown",
                            };
                            let state = match message.state {
                                crate::ipc::HookKeyState::Down => "DOWN",
                                crate::ipc::HookKeyState::Up => "UP",
                            };
                            let labels_for_emit = message.labels.clone();
                            let primary_label = labels_for_emit.first()
                                .cloned()
                                .unwrap_or_else(|| String::from(""));

                            // 구독자가 있을 때만 raw input 스트림 emit
                            let app_state = app_handle.state::<AppState>();
                            if app_state.raw_input_subscriber_count() > 0 {
                                let raw_payload = json!({
                                    "label": primary_label,
                                    "labels": labels_for_emit.clone(),
                                    "state": state,
                                    "device": device_str,
                                });

                                // 메인 윈도우에 우선 emit
                                if let Some(main) = app_handle.get_webview_window("main") {
                                    let _ = main.emit("input:raw", &raw_payload);
                                }
                                // 오버레이에도 emit (플러그인용)
                                if let Some(overlay) = app_handle.get_webview_window(OVERLAY_LABEL) {
                                    let _ = overlay.emit("input:raw", &raw_payload);
                                }
                            }

                            let Some(key_label) =
                                keyboard.match_candidate(message.labels.iter().map(|s| s.as_str()))
                            else {
                                continue;
                            };
                            let mode = keyboard.current_mode();
                            let state_changed = if state == "DOWN" {
                                let changed = app_state.register_key_down(&mode, &key_label);
                                if changed {
                                    if let Some(count) = app_state.increment_key_counter(&mode, &key_label) {
                                        log::trace!(
                                            "[IPC] emit keys:counter: mode={}, key={}, count={}",
                                            mode, key_label, count
                                        );
                                        if let Err(err) = app_handle.emit(
                                            "keys:counter",
                                            &json!({
                                                "mode": mode.clone(),
                                                "key": key_label.clone(),
                                                "count": count,
                                            }),
                                        ) {
                                            error!("failed to emit keys:counter event: {err}");
                                        }
                                    }
                                }
                                changed
                            } else {
                                app_state.register_key_up(&mode, &key_label)
                            };
                            if !state_changed {
                                continue;
                            }
                            if message.device == crate::ipc::InputDeviceKind::Keyboard
                                && state == "DOWN"
                            {
                                if let Some((sound_path, per_key_volume)) =
                                    app_state.resolve_key_sound_binding(&mode, &key_label)
                                {
                                    #[cfg(debug_assertions)]
                                    let key_sound_input_started_at = Instant::now();
                                    #[cfg(debug_assertions)]
                                    let key_sound_dispatch_started_at = Instant::now();
                                    #[cfg(debug_assertions)]
                                    let dispatch_ms =
                                        key_sound_dispatch_started_at.elapsed().as_secs_f64()
                                            * 1000.0;
                                    #[cfg(debug_assertions)]
                                    let trace = KeySoundDispatchTrace::new(
                                        key_sound_input_started_at,
                                        dispatch_ms,
                                    );
                                    app_state.key_sound.play_file(
                                        &sound_path,
                                        per_key_volume,
                                        #[cfg(debug_assertions)]
                                        Some(trace),
                                        #[cfg(not(debug_assertions))]
                                        None,
                                    );
                                    #[cfg(debug_assertions)]
                                    if app_state.key_sound.latency_logging_enabled() {
                                        log::debug!(
                                            "[KeySound][Latency] route=dispatch dispatchMs={dispatch_ms:.3} mode={} key={} volume={:.3} path={}",
                                            mode,
                                            key_label,
                                            per_key_volume,
                                            sound_path
                                        );
                                    }
                                } else {
                                    #[cfg(debug_assertions)]
                                    let key_sound_input_started_at = Instant::now();
                                    #[cfg(debug_assertions)]
                                    let key_sound_dispatch_started_at = Instant::now();
                                    #[cfg(debug_assertions)]
                                    let dispatch_ms =
                                        key_sound_dispatch_started_at.elapsed().as_secs_f64()
                                            * 1000.0;
                                    #[cfg(debug_assertions)]
                                    let trace = KeySoundDispatchTrace::new(
                                        key_sound_input_started_at,
                                        dispatch_ms,
                                    );
                                    app_state
                                        .key_sound
                                        .play_labels(
                                            &message.labels,
                                            #[cfg(debug_assertions)]
                                            Some(trace),
                                            #[cfg(not(debug_assertions))]
                                            None,
                                        );
                                    #[cfg(debug_assertions)]
                                    if app_state.key_sound.latency_logging_enabled() {
                                        log::debug!(
                                            "[KeySound][Latency] route=dispatch dispatchMs={dispatch_ms:.3} mode={} key={} source=soundpack",
                                            mode,
                                            key_label
                                        );
                                    }
                                }
                            }
                            let payload = json!({ "key": key_label, "state": state, "mode": mode });

                            let mut emitted = false;
                            if let Some(overlay) = overlay_window.as_ref() {
                                match overlay.emit("keys:state", &payload) {
                                    Ok(_) => emitted = true,
                                    Err(err) => {
                                        error!("failed to emit keys:state to overlay: {err}");
                                        overlay_window = None;
                                    }
                                }
                            }
                            if !emitted {
                                if overlay_window.is_none() {
                                    overlay_window = app_handle.get_webview_window(OVERLAY_LABEL);
                                    if let Some(overlay) = overlay_window.as_ref() {
                                        if overlay.emit("keys:state", &payload).is_ok() {
                                            emitted = true;
                                        } else {
                                            overlay_window = None;
                                        }
                                    }
                                }
                                if !emitted {
                                    if app_state.is_obs_mode_active() {
                                        app_state.obs_bridge.broadcast_tauri_event(
                                            "keys:state".to_string(),
                                            payload.clone(),
                                        );
                                        emitted = true;
                                    } else if let Err(err) =
                                        app_handle.emit("keys:state", &payload)
                                    {
                                        error!("failed to emit keys:state (fallback): {err}");
                                    } else {
                                        emitted = true;
                                    }
                                }
                            }

                            if emitted {
                                keys_state_emit_count += 1;
                                if keys_state_emit_count % 500 == 0 {
                                    log::debug!(
                                        "[AppState] emitted keys:state {} times (last key={}, state={})",
                                        keys_state_emit_count,
                                        key_label,
                                        state
                                    );
                                }
                            }
                        }
                        Err(err) => {
                            if err.kind() == std::io::ErrorKind::Interrupted
                                || err.kind() == std::io::ErrorKind::WouldBlock
                            {
                                continue;
                            }
                            break;
                        }
                    }
                }
            })
            .map_err(|err| anyhow!("failed to spawn keyboard daemon reader: {err}"))?;

        let stderr_handle = if let Some(stderr) = stderr {
            match thread::Builder::new()
                .name("keyboard-daemon-stderr".into())
                .spawn(move || {
                    let reader = BufReader::new(stderr);
                    for line in reader.lines() {
                        match line {
                            Ok(text) if !text.trim().is_empty() => {
                                warn!("keyboard-daemon stderr: {text}");
                            }
                            Ok(_) => {}
                            Err(err) => {
                                error!("error reading keyboard daemon stderr: {err}");
                                break;
                            }
                        }
                    }
                }) {
                Ok(handle) => Some(handle),
                Err(err) => {
                    warn!("failed to spawn keyboard daemon stderr reader: {err}");
                    None
                }
            }
        } else {
            None
        };

        *task_guard = Some(KeyboardDaemonTask {
            running,
            reader_handle: Some(reader_handle),
            stderr_handle,
            child: Some(child),
        });
        Ok(())
    }

    fn ensure_overlay_window(&self, app: &AppHandle) -> Result<WebviewWindow> {
        if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
            return Ok(window);
        }

        let snapshot = self.store.snapshot();
        let monitor_data = MonitorData::gather(app);

        let (mut bounds, had_bounds, mut bounds_are_logical) = if let Some(mut bounds) =
            snapshot.overlay_bounds.clone()
        {
            let mut is_logical = snapshot.overlay_bounds_are_logical;
            if !is_logical {
                if let Some(converted) = convert_physical_bounds_to_logical(&bounds, &monitor_data)
                {
                    bounds = converted;
                    is_logical = true;
                }
            }
            (bounds, true, is_logical)
        } else {
            (
                OverlayBounds {
                    x: 0.0,
                    y: 0.0,
                    width: DEFAULT_OVERLAY_WIDTH,
                    height: DEFAULT_OVERLAY_HEIGHT,
                },
                false,
                true,
            )
        };

        let original_x = bounds.x;
        let original_y = bounds.y;
        let position = self.compute_overlay_position(&bounds, had_bounds, &monitor_data);
        bounds.x = position.x;
        bounds.y = position.y;
        let position_was_adjusted =
            (bounds.x - original_x).abs() > 0.5 || (bounds.y - original_y).abs() > 0.5;
        if !monitor_data.is_empty() {
            bounds_are_logical = true;
        }

        self.overlay_initializing.store(true, Ordering::SeqCst);

        let window_builder = {
            let window_builder = WebviewWindowBuilder::new(
                app,
                OVERLAY_LABEL,
                WebviewUrl::App("overlay/index.html".into()),
            )
            .title("DM Note - Overlay")
            .decorations(false)
            .resizable(false)
            .maximizable(false)
            .zoom_hotkeys_enabled(false);

            let window_builder = window_builder.transparent(true);

            window_builder
        };

        let window = window_builder
            .always_on_top(true)
            .skip_taskbar(false)
            // 첫 표시를 SW_SHOWNOACTIVATE로 처리하도록 tao에 지시 (포커스 미탈취)
            .focused(false)
            .visible(snapshot.overlay_visible)
            .inner_size(bounds.width, bounds.height)
            .position(bounds.x, bounds.y)
            .shadow(false)
            .devtools(true)
            .build()
            .context("failed to create overlay window")?;

        // Windows에서 WebviewWindowBuilder::position()이 무시되는 경우가 있어
        // 빌드 직후 명시적으로 위치 재설정
        if let Err(err) = window.set_position(LogicalPosition::new(bounds.x, bounds.y)) {
            log::warn!("failed to set overlay position after build: {err}");
        }

        // Windows 접근성 텍스트 크기 설정에 의한 WebView2 스케일링을 보상
        let zoom = crate::compute_compensating_zoom();
        if let Err(err) = window.set_zoom(zoom) {
            log::warn!("failed to set overlay compensating zoom: {err}");
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

        window.set_ignore_cursor_events(snapshot.overlay_locked)?;
        window.set_always_on_top(snapshot.always_on_top)?;
        // show_overlay_window 내부에서 호출하므로, visible일 때만 적용
        // hidden 상태에서 호출 시 orderFrontRegardless가 윈도우를 강제 표시함
        #[cfg(target_os = "macos")]
        if snapshot.overlay_visible {
            apply_macos_overlay_fullscreen_behavior(&window, snapshot.always_on_top);
        }
        let _ = window.set_maximizable(false);

        self.overlay_force_close.store(false, Ordering::SeqCst);

        self.configure_overlay_window(&window, app);

        // 위치가 보정되었거나 logical 플래그 동기화가 필요한 경우에만 store 갱신
        let needs_logical_sync = bounds_are_logical && !snapshot.overlay_bounds_are_logical;
        if position_was_adjusted || !had_bounds || needs_logical_sync {
            if let Err(err) = self.store.update(|state| {
                state.overlay_bounds = Some(bounds.clone());
                state.overlay_bounds_are_logical = bounds_are_logical;
            }) {
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

        window.on_window_event(move |event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                if force_close_flag.swap(false, Ordering::SeqCst) {
                    // 앱 종료 시 — 실제 close 허용
                    *overlay_visible.write() = false;
                } else {
                    api.prevent_close();
                    if let Err(err) = overlay_window.hide() {
                        log::error!("failed to hide overlay window on close: {err}");
                    }
                    *overlay_visible.write() = false;
                    if let Err(err) = store.update(|state| {
                        state.overlay_visible = false;
                    }) {
                        log::warn!("failed to persist overlay visibility on close: {err}");
                    }
                    if let Err(err) =
                        app_handle.emit("overlay:visibility", &json!({ "visible": false }))
                    {
                        log::error!("failed to emit overlay visibility change: {err}");
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
            WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                // 윈도우 초기화 중에는 OS가 보고하는 좌표로 저장된 bounds를 덮어쓰지 않음
                if !initializing_flag.load(Ordering::SeqCst) {
                    if let Err(err) = persist_overlay_bounds(&overlay_window, &store) {
                        log::warn!("failed to persist overlay bounds: {err}");
                    }
                }
            }
            _ => {}
        });
    }

    fn compute_overlay_position(
        &self,
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
        if let Some(best) =
            monitors.find_best_overlap(bounds.x, bounds.y, bounds.width, bounds.height)
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
        }

        if let Some(value) = diff.changed.overlay_locked {
            // 오버레이가 보이는 상태일 때만 lock 설정 적용
            // 비표시 상태: 설정값 저장 완료, 오버레이 열 때 적용
            if is_visible {
                if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
                    window.set_ignore_cursor_events(value)?;
                }
            }
            app.emit("overlay:lock", &json!({ "locked": value }))?;
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
            }
        }

        if let Some(enabled) = diff.changed.tray_enabled {
            if !enabled {
                let _ = app.remove_tray_by_id(TRAY_ICON_ID);
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
            if let Some(task) = self.keyboard_task.write().take() {
                drop(task);
            }
            self.start_keyboard_hook(app.clone())?;
        }

        Ok(())
    }

    pub fn increment_key_counter(&self, mode: &str, key: &str) -> Option<u32> {
        if !self.key_counter_enabled.load(Ordering::Relaxed) {
            return None;
        }
        let mut counters = self.key_counters.write();
        let mode_entry = counters.entry(mode.to_string()).or_default();
        let count = mode_entry.entry(key.to_string()).or_insert(0);
        *count = count.saturating_add(1);
        Some(*count)
    }

    pub fn snapshot_key_counters(&self) -> KeyCounters {
        self.key_counters.read().clone()
    }

    pub fn reset_key_counters(&self) -> KeyCounters {
        let mut counters = self.key_counters.write();
        for mode_entry in counters.values_mut() {
            for value in mode_entry.values_mut() {
                *value = 0;
            }
        }
        counters.clone()
    }

    pub fn replace_key_counters(
        &self,
        counters: KeyCounters,
        keys: &KeyMappings,
    ) -> Result<KeyCounters> {
        {
            let mut guard = self.key_counters.write();
            *guard = counters;
        }
        self.sync_counters_with_keys(keys);
        self.persist_key_counters()
    }

    pub fn reset_mode_counters(&self, mode: &str) {
        let mut counters = self.key_counters.write();
        if let Some(entry) = counters.get_mut(mode) {
            for value in entry.values_mut() {
                *value = 0;
            }
        }
    }

    pub fn reset_single_key_counter(&self, mode: &str, key: &str) {
        let mut counters = self.key_counters.write();
        if let Some(entry) = counters.get_mut(mode) {
            if let Some(value) = entry.get_mut(key) {
                *value = 0;
            }
        }
    }

    pub fn register_key_down(&self, mode: &str, key: &str) -> bool {
        let mut guard = self.active_keys.write();
        guard.insert(Self::compose_active_key(mode, key))
    }

    pub fn register_key_up(&self, mode: &str, key: &str) -> bool {
        let mut guard = self.active_keys.write();
        guard.remove(&Self::compose_active_key(mode, key))
    }

    pub fn clear_active_keys(&self) {
        self.active_keys.write().clear();
    }

    /// 모드 전환 시 active_keys의 prefix를 새 모드로 교체
    pub fn transfer_active_keys(&self, new_mode: &str) {
        let mut guard = self.active_keys.write();
        let transferred: HashSet<String> = guard
            .drain()
            .filter_map(|entry| {
                entry
                    .split_once("::")
                    .map(|(_, key)| Self::compose_active_key(new_mode, key))
            })
            .collect();
        *guard = transferred;
    }

    pub fn persist_key_counters(&self) -> Result<KeyCounters> {
        let snapshot = self.key_counters.read().clone();
        self.store.set_key_counters(snapshot.clone())?;
        Ok(snapshot)
    }

    pub fn sync_counters_with_keys(&self, keys: &KeyMappings) {
        Self::sync_counters_with_keys_impl(&self.key_counters, keys);
    }

    fn sync_counters_with_keys_impl(target: &Arc<RwLock<KeyCounters>>, keys: &KeyMappings) {
        let mut guard = target.write();
        guard.retain(|mode, _| keys.contains_key(mode));
        for (mode, key_list) in keys.iter() {
            let entry = guard.entry(mode.clone()).or_default();
            entry.retain(|key, _| key_list.contains(key));
            for key in key_list.iter() {
                entry.entry(key.clone()).or_insert(0);
            }
        }
    }

    fn compose_active_key(mode: &str, key: &str) -> String {
        format!("{}::{}", mode, key)
    }

    /// Subscribe to raw input stream (increment subscriber count)
    pub fn subscribe_raw_input(&self) -> u32 {
        self.raw_input_subscribers.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Unsubscribe from raw input stream (decrement subscriber count)
    pub fn unsubscribe_raw_input(&self) -> u32 {
        let prev = self.raw_input_subscribers.fetch_sub(1, Ordering::SeqCst);
        if prev == 0 {
            // 언더플로우 방지
            self.raw_input_subscribers.store(0, Ordering::SeqCst);
            0
        } else {
            prev - 1
        }
    }

    /// Get current raw input subscriber count
    pub fn raw_input_subscriber_count(&self) -> u32 {
        self.raw_input_subscribers.load(Ordering::Relaxed)
    }

    pub fn key_sound_status(&self) -> KeySoundStatus {
        self.key_sound.status()
    }

    pub fn key_sound_set_enabled(&self, enabled: bool) -> KeySoundStatus {
        self.key_sound.set_enabled(enabled)
    }

    pub fn key_sound_set_volume(&self, volume: f32) -> KeySoundStatus {
        self.key_sound.set_volume(volume)
    }

    pub fn key_sound_set_latency_logging(&self, enabled: bool) -> KeySoundStatus {
        self.key_sound.set_latency_logging(enabled)
    }

    pub fn key_sound_list_output_devices(&self) -> KeySoundOutputDevices {
        self.key_sound.list_output_devices()
    }

    pub fn key_sound_set_output_backend(
        &self,
        backend: KeySoundOutputBackend,
    ) -> KeySoundOutputState {
        let output_state = self.key_sound.set_output_backend(backend);
        let requested = output_state.requested.clone();
        if let Err(err) = self.store.update(|state| {
            state.key_sound_output_backend = Some(output_backend_to_persist(requested.clone()));
        }) {
            warn!("[KeySound] failed to persist output backend: {err}");
        }
        output_state
    }

    pub fn key_sound_get_output_state(&self) -> KeySoundOutputState {
        self.key_sound.output_state()
    }

    pub fn key_sound_latency_logging_available(&self) -> bool {
        self.key_sound.latency_logging_available()
    }

    pub fn key_sound_load_soundpack(&self, soundpack_dir: &str) -> Result<KeySoundStatus, String> {
        self.key_sound
            .load_soundpack_dir(soundpack_dir)
            .map_err(|err| err.to_string())
    }

    pub fn key_sound_unload_soundpack(&self) -> KeySoundStatus {
        self.key_sound.unload_soundpack()
    }

    pub fn key_sound_invalidate_file_cache(&self, path: &str) {
        self.key_sound.invalidate_file_cache(path);
    }

    fn resolve_key_sound_binding(&self, mode: &str, key_label: &str) -> Option<(String, f32)> {
        self.store.with_state(|state| {
            let mappings = state.keys.get(mode)?;
            let positions = state.key_positions.get(mode)?;

            for (index, mapped_key) in mappings.iter().enumerate() {
                if mapped_key != key_label {
                    continue;
                }

                let Some(position) = positions.get(index) else {
                    continue;
                };

                if !position.sound_enabled.unwrap_or(false) {
                    continue;
                }
                let Some(sound_path) = position.sound_path.as_ref() else {
                    continue;
                };
                let trimmed_path = sound_path.trim();
                if trimmed_path.is_empty() {
                    continue;
                }

                let volume_percent = position.sound_volume.unwrap_or(100.0);
                let per_key_volume = (volume_percent / 100.0).clamp(0.0, 2.0) as f32;
                return Some((trimmed_path.to_string(), per_key_volume));
            }

            None
        })
    }

    // ========== CSS 핫리로딩 관련 메서드 ==========

    /// CSS 워처 초기화
    fn initialize_css_watcher(&self, app: &AppHandle) {
        let watcher = CssWatcher::new(self.store.clone(), app.clone());
        watcher.initialize_from_store();
        *self.css_watcher.write() = Some(watcher);
        log::info!("[AppState] CSS watcher initialized");
    }

    /// 전역 CSS 파일 워칭 시작
    pub fn watch_global_css(&self, path: &str) -> Result<(), String> {
        if let Some(watcher) = self.css_watcher.read().as_ref() {
            watcher.watch_global(path)
        } else {
            Err("CSS watcher not initialized".to_string())
        }
    }

    /// 전역 CSS 파일 워칭 중지
    pub fn unwatch_global_css(&self) {
        if let Some(watcher) = self.css_watcher.read().as_ref() {
            watcher.unwatch_global();
        }
    }

    /// 탭별 CSS 파일 워칭 시작
    pub fn watch_tab_css(&self, path: &str, tab_id: &str) -> Result<(), String> {
        if let Some(watcher) = self.css_watcher.read().as_ref() {
            watcher.watch_tab(path, tab_id)
        } else {
            Err("CSS watcher not initialized".to_string())
        }
    }

    /// 탭별 CSS 파일 워칭 중지
    pub fn unwatch_tab_css(&self, tab_id: &str) {
        if let Some(watcher) = self.css_watcher.read().as_ref() {
            watcher.unwatch_tab(tab_id);
        }
    }
}

impl Drop for AppState {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn output_backend_from_persist(value: KeySoundOutputBackendPersist) -> KeySoundOutputBackend {
    match value {
        KeySoundOutputBackendPersist::DefaultDevice => KeySoundOutputBackend::DefaultDevice,
        KeySoundOutputBackendPersist::Asio {
            driver_name,
            buffer_size,
        } => KeySoundOutputBackend::Asio {
            driver_name,
            buffer_size,
        },
    }
}

fn output_backend_to_persist(value: KeySoundOutputBackend) -> KeySoundOutputBackendPersist {
    match value {
        KeySoundOutputBackend::DefaultDevice => KeySoundOutputBackendPersist::DefaultDevice,
        KeySoundOutputBackend::Asio {
            driver_name,
            buffer_size,
        } => KeySoundOutputBackendPersist::Asio {
            driver_name,
            buffer_size,
        },
    }
}

fn attach_main_window_close_handler(
    window: WebviewWindow,
    overlay_force_close: Arc<AtomicBool>,
    app_handle: AppHandle,
) {
    // 시스템 컨텍스트 메뉴 비활성화
    #[cfg(target_os = "windows")]
    {
        if let Err(err) = disable_system_context_menu(&window) {
            log::warn!("failed to disable system context menu for main window: {err}");
        }
    }

    let main_window = window.clone();
    let shutdown_started = Arc::new(AtomicBool::new(false));

    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            if overlay_force_close.load(Ordering::SeqCst) {
                return;
            }

            let state = app_handle.state::<AppState>();
            if state.store.snapshot().tray_enabled {
                api.prevent_close();
                if let Err(err) = main_window.hide() {
                    log::warn!("failed to hide main window for tray mode: {err}");
                }
                if let Err(err) = state.set_main_window_hidden(true) {
                    log::warn!("failed to persist main hidden state: {err}");
                }
                if let Err(err) = state.ensure_tray_icon_for_background(&app_handle) {
                    log::warn!("failed to create tray icon: {err}");
                }
                return;
            }

            // 중복 종료 요청 방지
            if shutdown_started.swap(true, Ordering::SeqCst) {
                api.prevent_close();
                return;
            }

            // 즉시 종료 효과를 위해 윈도우 먼저 숨김
            // 실제 정리/프로세스 종료는 백그라운드 스레드에서 수행
            api.prevent_close();
            if let Err(err) = main_window.hide() {
                log::warn!("failed to hide main window during shutdown: {err}");
            }
            if let Some(overlay) = app_handle.get_webview_window(OVERLAY_LABEL) {
                if let Err(err) = overlay.hide() {
                    log::warn!("failed to hide overlay window during shutdown: {err}");
                }
            }

            let app_for_shutdown = app_handle.clone();
            let overlay_force_close_for_shutdown = overlay_force_close.clone();
            thread::spawn(move || {
                shutdown_application(app_for_shutdown, overlay_force_close_for_shutdown);
            });
        }
    });
}

fn tray_menu_labels(_language: &str) -> (&'static str, &'static str) {
    ("Settings", "Quit")
}

fn show_main_window(app_handle: &AppHandle) -> Result<()> {
    if let Some(main) = app_handle.get_webview_window("main") {
        let _ = main.unminimize();
        main.show()?;
        let _ = main.set_focus();
    }

    if app_handle.tray_by_id(TRAY_ICON_ID).is_some() {
        let _ = app_handle.remove_tray_by_id(TRAY_ICON_ID);
    }

    let state = app_handle.state::<AppState>();
    state.set_main_window_hidden(false)?;
    Ok(())
}

fn shutdown_application(app_handle: AppHandle, overlay_force_close: Arc<AtomicBool>) {
    if overlay_force_close.swap(true, Ordering::SeqCst) {
        return;
    }

    let main_hidden = app_handle
        .get_webview_window("main")
        .and_then(|window| window.is_visible().ok().map(|visible| !visible))
        .unwrap_or(false);

    {
        let state = app_handle.state::<AppState>();
        let tray_enabled = state.store.snapshot().tray_enabled;
        let persist_hidden = tray_enabled && main_hidden;
        if let Err(err) = state.set_main_window_hidden(persist_hidden) {
            log::warn!("failed to persist main hidden state during shutdown: {err}");
        }
        state.shutdown();
    }

    let _ = app_handle.remove_tray_by_id(TRAY_ICON_ID);

    if let Some(overlay) = app_handle.get_webview_window(OVERLAY_LABEL) {
        if let Err(err) = overlay.close() {
            log::warn!("failed to close overlay window during shutdown: {err}");
        }
    }

    app_handle.exit(0);
}

fn show_overlay_window(window: &WebviewWindow, _always_on_top: bool) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};

        let hwnd = window.hwnd()?;
        unsafe {
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
        // tao 내부 VISIBLE 플래그 동기화 — raw ShowWindow는 tao 상태를 갱신하지 않아,
        // 이후 set_always_on_top/set_ignore_cursor_events 호출 시 tao가 창을 숨겨버림
        window.show()?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        // 오버레이 표시 시 key/main 윈도우 전환 방지
        let _ = window.set_focusable(false);
        apply_macos_overlay_fullscreen_behavior(window, _always_on_top);
        window.show()?;
        apply_macos_overlay_fullscreen_behavior(window, _always_on_top);
        Ok(())
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        window.show()?;
        Ok(())
    }
}

fn hide_overlay_window(window: &WebviewWindow) -> Result<()> {
    // tao API 사용으로 내부 VISIBLE 플래그와 실제 창 상태 일치 유지
    window.hide()?;
    Ok(())
}

/// macOS 전체화면 Space에서도 오버레이가 보이도록 NSWindow 동작을 보정
/// 어떤 스레드에서 호출되든 안전하게 메인 스레드에서 AppKit API를 실행
#[cfg(target_os = "macos")]
fn apply_macos_overlay_fullscreen_behavior(window: &WebviewWindow, always_on_top: bool) {
    let app = window.app_handle().clone();
    let window = window.clone();
    let _ = app.run_on_main_thread(move || {
        apply_macos_overlay_fullscreen_behavior_inner(&window, always_on_top);
    });
}

#[cfg(target_os = "macos")]
fn apply_macos_overlay_fullscreen_behavior_inner(window: &WebviewWindow, always_on_top: bool) {
    use objc::{msg_send, sel, sel_impl};

    match window.ns_window() {
        Ok(ns_window) => unsafe {
            let ns_window = ns_window as *mut objc::runtime::Object;

            // 전체화면 Space 표시를 위한 레벨 및 컬렉션 동작 설정
            // NSStatusWindowLevel (25) 수준 적용
            let target_level: i64 = if always_on_top { 25 } else { 0 };
            let _: () = msg_send![ns_window, setLevel: target_level];

            let behavior: u64 = (1 << 0) | (1 << 8); // canJoinAllSpaces | fullScreenAuxiliary
            let _: () = msg_send![ns_window, setCollectionBehavior: behavior];

            let _: () = msg_send![ns_window, setHidesOnDeactivate: false];
            let _: () = msg_send![ns_window, orderFrontRegardless];

            log::info!("macOS overlay: level={target_level}, behavior={behavior}");
        },
        Err(err) => {
            log::warn!("macOS overlay: failed to get NSWindow handle: {err}");
        }
    }
}

/// 드래그 가능한 영역에서 시스템 컨텍스트 메뉴(이전 크기, 이동, 최소화 등)가 표시되지 않도록 설정
/// WM_INITMENU 메시지를 후킹하여 메뉴가 초기화될 때 창을 비활성화했다 활성화하여 메뉴를 취소시키는 방식
/// (Electron의 hookWindowMessage 방식과 동일)
#[cfg(target_os = "windows")]
fn disable_system_context_menu(window: &WebviewWindow) -> Result<()> {
    use windows::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        UI::{
            Shell::{DefSubclassProc, SetWindowSubclass},
            WindowsAndMessaging::{GetSystemMenu, WM_INITMENU},
        },
    };

    // EnableWindow는 user32.dll에서 직접 호출
    #[link(name = "user32")]
    extern "system" {
        fn EnableWindow(hwnd: isize, enable: i32) -> i32;
    }

    const SUBCLASS_ID: usize = 1;

    unsafe extern "system" fn subclass_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _uid_subclass: usize,
        _dw_ref_data: usize,
    ) -> LRESULT {
        if msg == WM_INITMENU {
            let system_menu = GetSystemMenu(hwnd, false);
            let is_system_menu = !system_menu.0.is_null() && (system_menu.0 as usize == wparam.0);
            if is_system_menu {
                // 시스템 메뉴만 차단하고, 앱이 띄우는 커스텀 메뉴(Menu.popup)는 허용
                EnableWindow(hwnd.0 as isize, 0); // FALSE
                EnableWindow(hwnd.0 as isize, 1); // TRUE
                return LRESULT(0);
            }
        }
        DefSubclassProc(hwnd, msg, wparam, lparam)
    }

    let hwnd = window.hwnd()?;
    let hwnd_win = HWND(hwnd.0);

    unsafe {
        SetWindowSubclass(hwnd_win, Some(subclass_proc), SUBCLASS_ID, 0)
            .ok()
            .map_err(|e| anyhow!("SetWindowSubclass failed: {e}"))?;
    }

    Ok(())
}

fn convert_physical_bounds_to_logical(
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

    if !scale.is_finite() || scale <= 0.0 {
        return None;
    }

    Some(OverlayBounds {
        x: bounds.x / scale,
        y: bounds.y / scale,
        width: bounds.width / scale,
        height: bounds.height / scale,
    })
}

#[derive(Clone)]
struct MonitorSpec {
    logical_origin_x: f64,
    logical_origin_y: f64,
    logical_width: f64,
    logical_height: f64,
    physical_origin_x: f64,
    physical_origin_y: f64,
    physical_width: f64,
    physical_height: f64,
    scale_factor: f64,
}

impl MonitorSpec {
    fn from_monitor(monitor: Monitor) -> Option<Self> {
        let scale = monitor.scale_factor();
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

    fn matches(&self, other: &Self) -> bool {
        (self.physical_origin_x - other.physical_origin_x).abs() < 0.5
            && (self.physical_origin_y - other.physical_origin_y).abs() < 0.5
            && (self.physical_width - other.physical_width).abs() < 0.5
            && (self.physical_height - other.physical_height).abs() < 0.5
            && (self.scale_factor - other.scale_factor).abs() < f64::EPSILON
    }

    fn contains_physical(&self, x: f64, y: f64) -> bool {
        x >= self.physical_origin_x
            && x <= self.physical_origin_x + self.physical_width
            && y >= self.physical_origin_y
            && y <= self.physical_origin_y + self.physical_height
    }

    /// 주어진 사각형과 이 모니터 work_area의 교차 영역 넓이 (logical px²)
    fn intersection_area(&self, x: f64, y: f64, width: f64, height: f64) -> f64 {
        let left = x.max(self.logical_origin_x);
        let top = y.max(self.logical_origin_y);
        let right = (x + width).min(self.logical_origin_x + self.logical_width);
        let bottom = (y + height).min(self.logical_origin_y + self.logical_height);
        (right - left).max(0.0) * (bottom - top).max(0.0)
    }

    fn clamp(&self, x: f64, y: f64, width: f64, height: f64) -> OverlayPosition {
        let max_x = self.logical_origin_x + (self.logical_width - width).max(0.0);
        let max_y = self.logical_origin_y + (self.logical_height - height).max(0.0);

        OverlayPosition {
            x: x.clamp(self.logical_origin_x, max_x),
            y: y.clamp(self.logical_origin_y, max_y),
        }
    }
}

struct MonitorData {
    specs: Vec<MonitorSpec>,
    primary_index: Option<usize>,
}

impl MonitorData {
    fn gather(app: &AppHandle) -> Self {
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

    fn is_empty(&self) -> bool {
        self.specs.is_empty()
    }

    fn primary_spec(&self) -> Option<&MonitorSpec> {
        self.primary_index
            .and_then(|idx| self.specs.get(idx))
            .or_else(|| self.specs.first())
    }

    fn fallback_scale(&self) -> f64 {
        self.primary_spec()
            .map(|spec| spec.scale_factor)
            .unwrap_or(1.0)
    }

    fn find_by_physical(&self, x: f64, y: f64) -> Option<&MonitorSpec> {
        self.specs.iter().find(|spec| spec.contains_physical(x, y))
    }

    /// 주어진 사각형과 가장 많이 겹치는 모니터를 반환
    fn find_best_overlap(&self, x: f64, y: f64, width: f64, height: f64) -> Option<&MonitorSpec> {
        self.specs
            .iter()
            .max_by(|a, b| {
                a.intersection_area(x, y, width, height)
                    .partial_cmp(&b.intersection_area(x, y, width, height))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .filter(|spec| spec.intersection_area(x, y, width, height) > 0.0)
    }

    fn first(&self) -> Option<&MonitorSpec> {
        self.specs.first()
    }
}

fn persist_overlay_bounds(window: &WebviewWindow, store: &Arc<AppStore>) -> Result<()> {
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let position = window.outer_position()?.to_logical::<f64>(scale_factor);
    let size = window.outer_size()?.to_logical::<f64>(scale_factor);

    let bounds = OverlayBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };

    let _ = store.update(|state| {
        state.overlay_bounds = Some(bounds.clone());
        state.overlay_bounds_are_logical = true;
    })?;
    Ok(())
}

struct KeyboardDaemonTask {
    running: Arc<AtomicBool>,
    reader_handle: Option<JoinHandle<()>>,
    stderr_handle: Option<JoinHandle<()>>,
    child: Option<Child>,
}

impl Drop for KeyboardDaemonTask {
    fn drop(&mut self) {
        self.running.store(false, Ordering::SeqCst);

        if let Some(child) = self.child.as_mut() {
            if let Err(err) = child.kill() {
                if err.kind() != std::io::ErrorKind::InvalidInput {
                    warn!("failed to kill keyboard daemon: {err}");
                }
            }
            let _ = child.wait();
        }

        if let Some(handle) = self.reader_handle.take() {
            let _ = handle.join();
        }

        if let Some(handle) = self.stderr_handle.take() {
            let _ = handle.join();
        }
    }
}

#[derive(Clone)]
struct OverlayPosition {
    x: f64,
    y: f64,
}
