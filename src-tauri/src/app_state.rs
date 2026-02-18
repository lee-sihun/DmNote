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
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, Monitor, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_runtime_wry::wry::dpi::{LogicalPosition, LogicalSize};

use crate::{
    keyboard::KeyboardManager,
    models::{
        overlay_resize_anchor_from_str, BootstrapOverlayState, BootstrapPayload, KeyCounters,
        KeyMappings, OverlayBounds, OverlayResizeAnchor, SettingsDiff, SettingsState,
    },
    services::{css_watcher::CssWatcher, settings::SettingsService},
    store::AppStore,
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
    keyboard_task: RwLock<Option<KeyboardDaemonTask>>,
    key_counters: Arc<RwLock<KeyCounters>>,
    key_counter_enabled: Arc<AtomicBool>,
    active_keys: Arc<RwLock<HashSet<String>>>,
    /// Raw input stream subscriber count - emit only when > 0
    raw_input_subscribers: Arc<std::sync::atomic::AtomicU32>,
    /// CSS 파일 핫리로딩 워처
    css_watcher: RwLock<Option<CssWatcher>>,
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

        Ok(Self {
            store,
            settings,
            keyboard,
            overlay_visible: Arc::new(RwLock::new(false)),
            overlay_force_close: Arc::new(AtomicBool::new(false)),
            keyboard_task: RwLock::new(None),
            key_counters,
            key_counter_enabled,
            active_keys,
            raw_input_subscribers: Arc::new(std::sync::atomic::AtomicU32::new(0)),
            css_watcher: RwLock::new(None),
        })
    }

    pub fn initialize_runtime(&self, app: &AppHandle) -> Result<()> {
        self.attach_main_window_handlers(app);
        self.ensure_overlay_window(app)?;
        // 개발자 모드가 켜져 있으면 시작 시 DevTools 오픈 허용 및 자동 오픈 시도
        let snapshot = self.store.snapshot();
        if snapshot.developer_mode_enabled {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.open_devtools();
            }
            if let Some(overlay) = app.get_webview_window("overlay") {
                let _ = overlay.open_devtools();
            }
        }
        self.start_keyboard_hook(app.clone())?;
        // CSS 핫리로딩 워처 초기화
        self.initialize_css_watcher(app);
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
        let quit_item = MenuItem::with_id(
            app,
            TRAY_MENU_QUIT_ID,
            quit_label,
            true,
            None::<&str>,
        )?;
        let menu = Menu::with_items(app, &[&settings_item, &quit_item])?;
        let overlay_force_close = self.overlay_force_close.clone();

        let mut tray_builder = TrayIconBuilder::with_id(TRAY_ICON_ID).menu(&menu);
        if let Some(icon) = app.default_window_icon().cloned() {
            tray_builder = tray_builder.icon(icon);
        }

        tray_builder
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
            },
            keys: state.keys.clone(),
            positions: state.key_positions.clone(),
            stat_positions: state.stat_positions.clone(),
            graph_positions: state.graph_positions.clone(),
            custom_tabs: state.custom_tabs.clone(),
            selected_key_type: state.selected_key_type.clone(),
            current_mode: self.keyboard.current_mode(),
            overlay: BootstrapOverlayState {
                visible: *self.overlay_visible.read(),
                locked: state.overlay_locked,
                anchor: state.overlay_resize_anchor.as_str().to_string(),
            },
            key_counters: self.key_counters.read().clone(),
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
        log::debug!("[IPC] emit_settings_changed: {} fields changed", diff.changed_count());
        self.apply_settings_effects(diff, app)?;
        if let Some(value) = diff.changed.key_counter_enabled {
            self.key_counter_enabled.store(value, Ordering::SeqCst);
        }
        // Avoid sending the full settings payload (can be large with embedded fonts).
        let mut payload = diff.clone();
        payload.full = None;
        app.emit("settings:changed", payload)?;
        Ok(())
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
            // 창이 없으면 아무 것도 하지 않음 (창을 생성하지 않음)
            if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
                hide_overlay_window(&window)?;
            }
        }
        
        *self.overlay_visible.write() = visible;
        app.emit("overlay:visibility", &json!({ "visible": visible }))?;
        Ok(())
    }

    pub fn set_overlay_lock(&self, app: &AppHandle, locked: bool, persist: bool) -> Result<()> {
        log::debug!("[IPC] set_overlay_lock: locked={}, persist={}", locked, persist);
        if persist {
            let _ = self.store.update(|state| {
                state.overlay_locked = locked;
            })?;
        }

        // 오버레이가 보이는 상태일 때만 설정 적용
        // 숨겨져 있거나 닫혀있는 상태에서는 설정값만 저장하고, 나중에 오버레이를 열 때 적용됨
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
        // 창이 없으면 에러 반환 (창을 자동으로 생성하지 않음)
        let window = app.get_webview_window(OVERLAY_LABEL)
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
            bounds.width, bounds.height, bounds.x, bounds.y
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

        // Prepare Named Pipe server asynchronously to avoid blocking before spawning the daemon.
        #[cfg(target_os = "windows")]
        let pipe_receiver: Option<std::sync::mpsc::Receiver<Option<std::fs::File>>> = {
            use std::sync::mpsc;
            let (tx, rx) = mpsc::channel();
            std::thread::spawn(move || {
                match crate::ipc::pipe_server_create("dmnote_keys_v1") {
                    Ok(f) => { let _ = tx.send(Some(f)); }
                    Err(err) => { warn!("failed to create named pipe: {err}"); let _ = tx.send(None); }
                }
            });
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
                // Prefer Named Pipe if available; otherwise, use stdout
                #[allow(unused_mut)]
                let mut reader: BufReader<Box<dyn std::io::Read + Send>> = {
                    #[cfg(target_os = "windows")]
                    {
                        if let Some(rx) = pipe_receiver {
                            // Wait a short time for the pipe to be ready; otherwise, fall back to stdout.
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
                // Elevate reader thread priority slightly on Windows
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

                            // First, try to parse as DaemonCommand (global hotkeys)
                            if let Ok(command) = serde_json::from_str::<crate::ipc::DaemonCommand>(s) {
                                match command {
                                    crate::ipc::DaemonCommand::ToggleOverlay => {
                                        log::info!("[AppState] received ToggleOverlay command from daemon");
                                        let app_state = app_handle.state::<AppState>();
                                        let is_visible = *app_state.overlay_visible.read();
                                        if let Err(err) = app_state.set_overlay_visibility(&app_handle, !is_visible) {
                                            log::error!("failed to toggle overlay visibility: {err}");
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

                            // Preferred: JSON encoded HookMessage (with device).
                            let parsed: Option<crate::ipc::HookMessage> =
                                serde_json::from_str(s).ok();

                            let message = if let Some(msg) = parsed {
                                if msg.labels.is_empty() {
                                    continue;
                                }
                                msg
                            } else {
                                // Legacy compact format: "D:<label>" / "U:<label>"
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
                            let primary_label = labels_for_emit
                                .get(0)
                                .cloned()
                                .unwrap_or_else(|| String::from(""));

                            // Emit raw input stream only when there are subscribers
                            let app_state = app_handle.state::<AppState>();
                            if app_state.raw_input_subscriber_count() > 0 {
                                let raw_payload = json!({
                                    "label": primary_label,
                                    "labels": labels_for_emit.clone(),
                                    "state": state,
                                    "device": device_str,
                                });
                                
                                // Emit to main window first, then fallback to app-wide emit
                                if let Some(main) = app_handle.get_webview_window("main") {
                                    let _ = main.emit("input:raw", &raw_payload);
                                }
                                // Also emit to overlay for plugins running there
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
                                    if let Err(err) = app_handle.emit("keys:state", &payload) {
                                        error!("failed to emit keys:state (fallback): {err}");
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

        let position = self.compute_overlay_position(&bounds, had_bounds, &monitor_data);
        bounds.x = position.x;
        bounds.y = position.y;
        if !monitor_data.is_empty() {
            bounds_are_logical = true;
        }

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
            .visible(true)
            .inner_size(bounds.width, bounds.height)
            .position(bounds.x, bounds.y)
            .shadow(false)
            .devtools(true)
            .build()
            .context("failed to create overlay window")?;

        // WebView2에 잔류된 줌 레벨을 항상 100%로 강제 리셋
        if let Err(err) = window.set_zoom(1.0) {
            log::warn!("failed to reset overlay zoom to 100%: {err}");
        }

        // macOS에서 오버레이 창이 앱 포커스를 빼앗지 않도록 설정
        #[cfg(target_os = "macos")]
        {
            if let Err(err) = window.set_focusable(false) {
                log::warn!("failed to set overlay non-focusable on macOS: {err}");
            }
        }

        // Windows에서 오버레이 창이 포커스를 받지 않도록 설정
        #[cfg(target_os = "windows")]
        {
            if let Err(err) = set_window_no_activate(&window) {
                log::warn!("failed to set WS_EX_NOACTIVATE for overlay: {err}");
            }
            // 시스템 컨텍스트 메뉴 비활성화
            if let Err(err) = disable_system_context_menu(&window) {
                log::warn!("failed to disable system context menu for overlay: {err}");
            }
        }

        window.set_ignore_cursor_events(snapshot.overlay_locked)?;
        window.set_always_on_top(snapshot.always_on_top)?;
        #[cfg(target_os = "macos")]
        apply_macos_overlay_fullscreen_behavior(&window, snapshot.always_on_top);
        let _ = window.set_maximizable(false);

        self.overlay_force_close.store(false, Ordering::SeqCst);

        *self.overlay_visible.write() = true;

        let _ = self.store.update(|state| {
            state.overlay_bounds = Some(bounds.clone());
            state.overlay_bounds_are_logical = bounds_are_logical;
        })?;

        self.configure_overlay_window(&window, app);

        Ok(window)
    }

    fn configure_overlay_window(&self, window: &WebviewWindow, app: &AppHandle) {
        let overlay_visible = self.overlay_visible.clone();
        let store = self.store.clone();
        let app_handle = app.clone();
        let overlay_window = window.clone();
        let force_close_flag = self.overlay_force_close.clone();

        window.on_window_event(move |event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                if force_close_flag.swap(false, Ordering::SeqCst) {
                    *overlay_visible.write() = false;
                } else {
                    api.prevent_close();
                    if let Err(err) = overlay_window.hide() {
                        log::error!("failed to hide overlay window on close: {err}");
                    }
                    *overlay_visible.write() = false;
                    if let Err(err) =
                        app_handle.emit("overlay:visibility", &json!({ "visible": false }))
                    {
                        log::error!("failed to emit overlay visibility change: {err}");
                    }
                }
            }
            WindowEvent::Focused(true) => {
                // WS_EX_NOACTIVATE 스타일 때문에 이 이벤트는 발생하지 않아야 함
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
                if let Err(err) = persist_overlay_bounds(&overlay_window, &store) {
                    log::warn!("failed to persist overlay bounds: {err}");
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

        let target_spec = if had_stored_bounds {
            let center_x = bounds.x + bounds.width / 2.0;
            let center_y = bounds.y + bounds.height / 2.0;
            monitors
                .find_by_logical(center_x, center_y)
                .cloned()
                .unwrap_or(fallback_spec.clone())
        } else {
            fallback_spec.clone()
        };

        let base_x = if had_stored_bounds {
            bounds.x
        } else {
            target_spec.logical_origin_x + target_spec.logical_width - bounds.width - OVERLAY_MARGIN
        };

        let base_y = if had_stored_bounds {
            bounds.y
        } else {
            target_spec.logical_origin_y + target_spec.logical_height
                - bounds.height
                - OVERLAY_MARGIN
        };

        target_spec.clamp(base_x, base_y, bounds.width, bounds.height)
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
            // 숨겨져 있거나 닫혀있는 상태에서는 설정값은 이미 저장되었으므로, 나중에 오버레이를 열 때 적용됨
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
                    let _ = main.open_devtools();
                }
                if let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) {
                    let _ = overlay.open_devtools();
                }
            }
        }

        if let Some(enabled) = diff.changed.tray_enabled {
            if !enabled {
                let _ = app.remove_tray_by_id(TRAY_ICON_ID);
                if let Err(err) = self.set_main_window_hidden(false) {
                    log::warn!("failed to clear main_window_hidden when disabling tray mode: {err}");
                }
            } else if self.store.snapshot().main_window_hidden {
                self.ensure_tray_icon_for_background(app)?;
            }
        }

        if diff.changed.shortcuts.is_some() {
            // Restart keyboard daemon to apply updated global hotkeys.
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
            // Prevent underflow
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

            // 시각적으로 즉시 종료되도록 먼저 윈도우를 숨기고,
            // 실제 정리/프로세스 종료는 백그라운드 스레드에서 수행합니다.
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
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        // Ensure the overlay does not become key/main window when shown.
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
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};

        let hwnd = window.hwnd()?;
        unsafe {
            let _ = ShowWindow(hwnd, SW_HIDE);
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        window.hide()?;
        Ok(())
    }
}

/// macOS 전체화면 Space에서도 오버레이가 보이도록 NSWindow 동작을 보정
#[cfg(target_os = "macos")]
fn apply_macos_overlay_fullscreen_behavior(window: &WebviewWindow, always_on_top: bool) {
    use objc::{msg_send, sel, sel_impl};

    match window.ns_window() {
        Ok(ns_window) => unsafe {
            let ns_window = ns_window as *mut objc::runtime::Object;

            // 전체화면 Space에서도 보이도록 레벨 및 컬렉션 동작 설정
            // NSStatusWindowLevel (25) 수준으로 설정
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

#[cfg(target_os = "windows")]
fn set_window_no_activate(window: &WebviewWindow) -> Result<()> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongW, SetWindowLongW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
    };

    let hwnd = window.hwnd()?;
    unsafe {
        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
        SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_NOACTIVATE.0 as i32);
    }
    Ok(())
}

/// 드래그 가능한 영역에서 시스템 컨텍스트 메뉴(이전 크기, 이동, 최소화 등)가 표시되지 않도록 설정
/// WM_INITMENU 메시지를 후킹하여 메뉴가 초기화될 때 창을 비활성화했다 활성화하여 메뉴를 취소시키는 방식
/// (Electron의 hookWindowMessage 방식과 동일)
#[cfg(target_os = "windows")]
fn disable_system_context_menu(window: &WebviewWindow) -> Result<()> {
    use std::ffi::c_void;
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
    let hwnd_win = HWND(hwnd.0 as *mut c_void);

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

    fn contains_logical(&self, x: f64, y: f64) -> bool {
        x >= self.logical_origin_x
            && x <= self.logical_origin_x + self.logical_width
            && y >= self.logical_origin_y
            && y <= self.logical_origin_y + self.logical_height
    }

    fn contains_physical(&self, x: f64, y: f64) -> bool {
        x >= self.physical_origin_x
            && x <= self.physical_origin_x + self.physical_width
            && y >= self.physical_origin_y
            && y <= self.physical_origin_y + self.physical_height
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

    fn find_by_logical(&self, x: f64, y: f64) -> Option<&MonitorSpec> {
        self.specs.iter().find(|spec| spec.contains_logical(x, y))
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

