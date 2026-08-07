#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod commands;
mod cursor;
mod custom_css;
mod defaults;
mod errors;
mod ipc;
mod keyboard;
mod models;
mod services;
mod state;

use anyhow::Result;
use log::LevelFilter;
use std::{thread, time::Duration};

#[cfg(target_os = "macos")]
use std::{path::PathBuf, process::Command};

#[cfg(target_os = "windows")]
use std::{fs, path::PathBuf};

use tauri::{
    ipc::CapabilityBuilder, webview::PageLoadEvent, LogicalSize, Manager, PhysicalPosition,
    Position,
};

use dm_note::{compute_compensating_zoom, should_apply_compensating_zoom};

use state::{AppState, AppStore, PANEL_LABEL};

fn main() {
    #[cfg(target_os = "windows")]
    {
        // WebView2 투명 오버레이 이슈 방지 — 번들된 Fixed 런타임 우선 적용
        apply_embedded_webview2_fixed_runtime_override();
        apply_webview2_fixed_runtime_override();

        // GPU/하드웨어 가속 강제 활성화 및 렌더링 최적화 플래그
        let gpu_flags = [
            "--enable-gpu-rasterization", // GPU 래스터화 강제 활성화
            "--enable-zero-copy",         // 제로 카피 래스터라이저 활성화
            "--ignore-gpu-blocklist",     // GPU 블랙리스트 무시 (강제 GPU 사용)
        ];
        for flag in gpu_flags {
            apply_webview2_additional_args(flag);
        }

        // 렌더러 설정 적용 (store.json에서 읽어옴)
        apply_renderer_settings();
    }

    if std::env::args().any(|arg| arg == "--keyboard-daemon") {
        if let Err(err) = keyboard::daemon::start_parent_liveness_watch() {
            eprintln!("failed to start keyboard parent watch: {err}");
            std::process::exit(1);
        }
        if let Err(err) = keyboard::daemon::run() {
            eprintln!("keyboard daemon error: {err:?}");
            std::process::exit(1);
        }
        return;
    }

    // macOS: 접근성 권한 확인 및 미부여 시 시스템 노브로그 표시
    #[cfg(target_os = "macos")]
    {
        request_accessibility_permission();
    }

    if let Err(err) = setup_logging() {
        eprintln!("Failed to initialize logging: {err}");
    }

    let context = tauri::generate_context!();

    let app = tauri::Builder::default()
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let zoom = compute_compensating_zoom();
                // macOS WKWebView의 identity zoom은 활성 입력 선택·캐럿을 리셋
                // Windows는 이전 보정값을 1.0으로 복구해야 하므로 호출 유지
                if !should_apply_compensating_zoom(zoom) {
                    return;
                }
                let label = webview.label();
                log::info!(
                    "[zoom-guard] page loaded in '{label}', applying compensating zoom={zoom:.6}"
                );
                if let Err(err) = webview.set_zoom(zoom) {
                    log::warn!("[zoom-guard] failed to set zoom for '{label}': {err}");
                }
            }
        })
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(state) = app.try_state::<AppState>() {
                if let Err(err) = state.show_main_window(app) {
                    log::warn!("failed to show main window from second instance: {err}");
                }
            } else if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            // dev 빌드에서만 remote URL capability 등록 (릴리즈에서는 local:true만 사용)
            if cfg!(debug_assertions) {
                register_dev_capability(app)?;
            }

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // macOS: 네이티브 Edit 메뉴 추가 — WKWebView 편집 단축키(Cmd+Z/X/C/V/A) 활성화
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{Menu, PredefinedMenuItem, Submenu};

                let edit_menu = Submenu::with_items(
                    app,
                    "Edit",
                    true,
                    &[
                        &PredefinedMenuItem::undo(app, None)?,
                        &PredefinedMenuItem::redo(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::cut(app, None)?,
                        &PredefinedMenuItem::copy(app, None)?,
                        &PredefinedMenuItem::paste(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::select_all(app, None)?,
                    ],
                )?;

                let menu = Menu::with_items(app, &[&edit_menu])?;
                app.set_menu(menu)?;
            }

            let resolver = app.path();
            let store = AppStore::initialize(resolver)
                .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            let app_state = AppState::initialize(store)
                .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            let preview_broker =
                services::preview_broker::PreviewBroker::new(app_state.store.history_gate());
            app.manage(preview_broker);
            app.manage(app_state);
            let handle = app.handle();
            {
                let state = app.state::<AppState>();
                state
                    .initialize_runtime(handle)
                    .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            }
            configure_main_window(app.handle());

            #[cfg(target_os = "macos")]
            {
                state::macos_termination::install(app.handle())
                    .map_err(|error| -> Box<dyn std::error::Error> { error.into() })?;
                launch_macos_dock_helper();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 앱 생명주기
            commands::app::bootstrap::app_bootstrap,
            commands::app::update::app_auto_update,
            commands::app::system::window_minimize,
            commands::app::system::window_close,
            commands::app::system::window_show_main,
            commands::app::system::app_open_external,
            commands::app::system::app_restart,
            commands::app::system::app_quit,
            commands::app::system::app_quit_after_editor_flush,
            commands::app::system::app_cancel_editor_flush,
            commands::app::system::window_open_devtools_all,
            commands::app::system::get_cursor_settings,
            // OBS 모드
            commands::app::obs::obs_start,
            commands::app::obs::obs_stop,
            commands::app::obs::obs_status,
            commands::app::obs::obs_regenerate_token,
            // 에디터 콘텐츠
            commands::editor::css::css_get,
            commands::editor::css::css_get_use,
            commands::editor::css::css_toggle,
            commands::editor::css::css_reset,
            commands::editor::css::css_set_content,
            commands::editor::css::css_load,
            commands::editor::css::css_history_get,
            commands::editor::css::css_history_activate,
            commands::editor::css::css_history_remove,
            commands::editor::css::css_tab_get_all,
            commands::editor::css::css_tab_get,
            commands::editor::css::css_tab_load,
            commands::editor::css::css_tab_clear,
            commands::editor::css::css_tab_set,
            commands::editor::css::css_tab_toggle,
            commands::editor::css::css_tab_activate_history,
            commands::editor::css::css_tab_export,
            commands::editor::js::js_get,
            commands::editor::js::js_get_use,
            commands::editor::js::js_toggle,
            commands::editor::js::js_reset,
            commands::editor::js::js_set_content,
            commands::editor::js::js_load,
            commands::editor::js::js_reload,
            commands::editor::js::js_remove_plugin,
            commands::editor::js::js_set_plugin_enabled,
            commands::editor::note_tab::note_tab_get_all,
            commands::editor::note_tab::note_tab_get,
            commands::editor::note_tab::note_tab_set,
            commands::editor::note_tab::note_tab_clear,
            commands::editor::state::editor_get,
            commands::editor::state::editor_commit,
            commands::editor::gesture::commit_gesture,
            commands::editor::history::history_status,
            commands::editor::history::history_undo,
            commands::editor::history::history_redo,
            commands::editor::preview::editor_preview_subscribe,
            commands::editor::preview::editor_preview_publish,
            commands::editor::preview::editor_preview_cancel,
            commands::editor::selection::selection_session_get,
            commands::editor::selection::selection_session_publish,
            // 키 입력/설정
            commands::keys::keys::keys_get,
            commands::keys::keys::keys_get_counters,
            commands::keys::keys::positions_get,
            commands::keys::keys::keys_set_mode,
            commands::keys::keys::keys_reset_all,
            commands::keys::keys::keys_reset_mode,
            commands::keys::keys::keys_reset_counters,
            commands::keys::keys::keys_reset_counters_mode,
            commands::keys::keys::keys_reset_single_counter,
            commands::keys::keys::keys_set_counters,
            commands::keys::keys::raw_input_subscribe,
            commands::keys::keys::raw_input_unsubscribe,
            commands::keys::keys::custom_tabs_list,
            commands::keys::keys::custom_tabs_create,
            commands::keys::keys::custom_tabs_delete,
            commands::keys::keys::custom_tabs_select,
            commands::keys::keys::custom_tabs_restore,
            commands::keys::keys::layer_groups_get,
            commands::keys::key_sound::key_sound_get_status,
            commands::keys::key_sound::key_sound_set_enabled,
            commands::keys::key_sound::key_sound_set_volume,
            commands::keys::key_sound::key_sound_load_soundpack,
            commands::keys::key_sound::key_sound_unload_soundpack,
            commands::keys::key_sound::key_sound_set_latency_logging,
            commands::keys::key_sound::key_sound_list_output_devices,
            commands::keys::key_sound::key_sound_set_output_backend,
            commands::keys::key_sound::key_sound_get_output_state,
            commands::keys::sound::sound_load,
            commands::keys::sound::sound_list,
            commands::keys::sound::sound_set_hidden,
            commands::keys::sound::sound_set_enabled,
            commands::keys::sound::sound_rename,
            commands::keys::sound::sound_delete,
            commands::keys::sound::sound_save_processed_wav,
            commands::keys::sound::sound_load_original,
            commands::keys::sound::sound_update_processed_wav,
            // 레이아웃/오버레이
            commands::layout::settings::settings_get,
            commands::layout::settings::settings_update,
            commands::layout::stat_items::stat_positions_get,
            commands::layout::stat_items::stat_positions_update,
            commands::layout::graph_items::graph_positions_get,
            commands::layout::graph_items::graph_positions_update,
            commands::layout::knob_items::knob_positions_get,
            commands::layout::knob_items::knob_positions_update,
            commands::layout::font::font_load,
            commands::layout::overlay::overlay_get,
            commands::layout::overlay::overlay_set_visible,
            commands::layout::overlay::overlay_set_lock,
            commands::layout::overlay::overlay_sync_hit_regions,
            commands::layout::overlay::overlay_set_anchor,
            commands::layout::overlay::overlay_resize,
            commands::layout::panel::panel_window_show,
            commands::layout::panel::panel_window_close,
            commands::layout::panel::panel_window_take_view_state,
            commands::layout::panel::panel_window_close_ack,
            commands::layout::panel::panel_window_is_open,
            commands::layout::panel::panel_window_start_dragging,
            // 미디어
            commands::media::image::image_load,
            commands::media::counter_animation::counter_animation_list,
            commands::media::counter_animation::counter_animation_create,
            commands::media::counter_animation::counter_animation_update,
            commands::media::counter_animation::counter_animation_delete,
            // 프리셋
            commands::preset::save::preset_save,
            commands::preset::save::preset_save_tab,
            commands::preset::load::preset_load,
            commands::preset::load::preset_load_tab,
            // 플러그인
            commands::plugin::bridge::plugin_bridge_send,
            commands::plugin::bridge::plugin_bridge_send_to,
            commands::plugin::rpc::plugin_rpc_send,
            commands::plugin::rpc::plugin_rpc_respond,
            commands::plugin::rpc::plugin_authority_reset,
            commands::plugin::instances::plugin_instances_commit,
            commands::plugin::instances::plugin_instances_get,
            commands::plugin::instances::plugin_instances_reconcile,
            commands::plugin::storage::plugin_storage_get,
            commands::plugin::storage::plugin_storage_set,
            commands::plugin::storage::plugin_storage_remove,
            commands::plugin::storage::plugin_storage_clear,
            commands::plugin::storage::plugin_storage_keys,
            commands::plugin::storage::plugin_storage_has_data,
            commands::plugin::storage::plugin_storage_clear_by_prefix,
        ])
        .build(context)
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } => {
            if label == "main" {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    state.mark_plugin_authority_unavailable();
                }
            }
            if label == PANEL_LABEL {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    state.handle_panel_window_destroyed(app_handle);
                }
            }
            if let Some(broker) = app_handle.try_state::<services::preview_broker::PreviewBroker>()
            {
                broker.remove_label(&label);
            }
        }
        tauri::RunEvent::ExitRequested { api, .. } => {
            if let Some(state) = app_handle.try_state::<AppState>() {
                if !state.is_process_exit_authorized() {
                    api.prevent_exit();
                    state.request_frontend_shutdown(app_handle.clone());
                }
            }
        }
        tauri::RunEvent::Exit => {
            if let Some(state) = app_handle.try_state::<AppState>() {
                state.arm_shutdown_watchdog("RunEvent state shutdown");
                if let Err(err) = state.capture_and_flush_panel_bounds_for_lifecycle(app_handle) {
                    log::warn!("failed to persist panel bounds during RunEvent exit: {err}");
                }
                state.shutdown();
                state.set_shutdown_watchdog_stage("RunEvent process exit");
            }
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => {
            if let Some(state) = app_handle.try_state::<AppState>() {
                if let Err(err) = state.show_main_window(app_handle) {
                    log::warn!("failed to show main window from Dock helper: {err}");
                }
            }
        }
        _ => {}
    });
}

#[cfg(target_os = "windows")]
fn apply_webview2_additional_args(arg: &str) {
    use std::env;
    const KEY: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";
    // 기존 사용자 인자를 유지하면서, 없는 경우에만 추가
    let existing = env::var(KEY).unwrap_or_default();
    let already_present = existing
        .split_whitespace()
        .any(|token| token.eq_ignore_ascii_case(arg));
    if already_present {
        return;
    }
    let new_value = if existing.trim().is_empty() {
        arg.to_string()
    } else {
        format!("{existing} {arg}")
    };
    env::set_var(KEY, new_value);
}

/// store.json에서 렌더러 설정(angleMode)을 읽어 WebView2 플래그로 적용
#[cfg(target_os = "windows")]
fn apply_renderer_settings() {
    // Tauri 초기화 전 — 경로 직접 탐색
    let store_path = get_store_path();

    let angle_mode = if let Some(path) = store_path {
        read_angle_mode_from_store(&path).unwrap_or_else(|| "d3d11".to_string())
    } else {
        "d3d11".to_string()
    };

    // ANGLE 백엔드 또는 Skia 렌더러 설정 적용
    match angle_mode.as_str() {
        "d3d11" => {
            apply_webview2_additional_args("--use-angle=d3d11");
        }
        "d3d9" => {
            apply_webview2_additional_args("--use-angle=d3d9");
        }
        "gl" => {
            apply_webview2_additional_args("--use-angle=gl");
        }
        "skia" => {
            // Skia 렌더러 활성화 (고성능 2D 렌더링)
            apply_webview2_additional_args("--enable-features=UseSkiaRenderer");
            apply_webview2_additional_args("--use-angle=d3d11"); // Skia + D3D11 조합
        }
        _ => {
            // 기본값: D3D11
            apply_webview2_additional_args("--use-angle=d3d11");
        }
    }
}

/// 앱 데이터 디렉토리에서 store.json 경로 찾기
#[cfg(target_os = "windows")]
fn get_store_path() -> Option<PathBuf> {
    // Windows 경로: %APPDATA%/com.dmnote.desktop/store.json
    dirs_next::config_dir().map(|config| config.join("com.dmnote.desktop").join("store.json"))
}

/// store.json에서 angleMode 값 읽기
#[cfg(target_os = "windows")]
fn read_angle_mode_from_store(path: &PathBuf) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    json.get("angleMode")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn setup_logging() -> Result<()> {
    // 개발 모드에서는 Debug, 릴리즈에서는 Info
    let level = if cfg!(debug_assertions) {
        LevelFilter::Debug
    } else {
        LevelFilter::Info
    };

    let _ = fern::Dispatch::new()
        .format(|out, message, record| {
            out.finish(format_args!(
                "[{level}][{target}] {message}",
                level = record.level(),
                target = record.target(),
                message = message
            ))
        })
        .level(level)
        .chain(std::io::stdout())
        .apply();
    Ok(())
}

fn configure_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(err) = apply_main_window_configuration(app, window) {
            log::warn!("failed to configure main window: {err}");
        }
        return;
    }

    let handle = app.clone();
    thread::spawn(move || {
        for attempt in 0..15 {
            if let Some(window) = handle.get_webview_window("main") {
                // primary_monitor 조회가 macOS에서 AppKit을 직접 접근하므로 메인 스레드에서 실행
                let app_handle = handle.clone();
                let dispatched = handle.run_on_main_thread(move || {
                    if let Err(err) = apply_main_window_configuration(&app_handle, window) {
                        log::warn!("failed to configure main window: {err}");
                    }
                });
                if let Err(err) = dispatched {
                    log::warn!("failed to dispatch main window configuration: {err}");
                }
                return;
            }

            thread::sleep(Duration::from_millis(25));
            if attempt == 14 {
                log::warn!("main window was not available for configuration");
            }
        }
    });
}

fn apply_main_window_configuration(
    app: &tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<()> {
    let size = LogicalSize::new(902.0, 488.0);

    if let Err(err) = window.hide() {
        log::debug!("failed to hide main window before configuration: {err}");
    }

    if cfg!(target_os = "windows") {
        if let Err(err) = window.set_decorations(false) {
            log::warn!("failed to disable decorations: {err}");
        }
    } else if cfg!(target_os = "macos") {
        if let Err(err) = window.set_decorations(true) {
            log::warn!("failed to enable decorations: {err}");
        }
    }
    if let Err(err) = window.set_resizable(false) {
        log::warn!("failed to disable resizing: {err}");
    }
    if let Err(err) = window.set_maximizable(false) {
        log::warn!("failed to disable maximize: {err}");
    }
    if let Err(err) = window.set_min_size(Some(tauri::Size::Logical(size))) {
        log::warn!("failed to set min size: {err}");
    }
    if let Err(err) = window.set_max_size(Some(tauri::Size::Logical(size))) {
        log::warn!("failed to set max size: {err}");
    }
    if let Err(err) = window.set_size(tauri::Size::Logical(size)) {
        log::warn!("failed to set size: {err}");
    }
    if let Err(err) = window.set_shadow(true) {
        log::warn!("failed to enable shadow: {err}");
    }

    let positioned = app.primary_monitor().ok().flatten().and_then(|monitor| {
        let work_area = monitor.work_area();
        window.outer_size().ok().map(|size| {
            let width = size.width as f64;
            let height = size.height as f64;
            let origin_x = work_area.position.x as f64;
            let origin_y = work_area.position.y as f64;
            let available_width = work_area.size.width as f64;
            let available_height = work_area.size.height as f64;

            let desired_x = origin_x + (available_width - width) / 2.0;
            let desired_y = origin_y + (available_height - height) / 2.0;

            let max_x = origin_x + (available_width - width).max(0.0);
            let max_y = origin_y + (available_height - height).max(0.0);

            (
                desired_x.clamp(origin_x, max_x),
                desired_y.clamp(origin_y, max_y),
            )
        })
    });

    if let Some((x, y)) = positioned {
        if let Err(err) = window.set_position(Position::Physical(PhysicalPosition::new(
            x.round() as i32,
            y.round() as i32,
        ))) {
            log::warn!("failed to set main window position: {err}");
            if let Err(err) = window.center() {
                log::warn!("failed to center window: {err}");
            }
        }
    } else if let Err(err) = window.center() {
        log::warn!("failed to center window: {err}");
    }

    // Windows 접근성 텍스트 크기 설정에 의한 WebView2 스케일링을 보상
    let zoom = compute_compensating_zoom();
    log::info!("[zoom-guard] main window initial config: compensating zoom={zoom:.6}");
    if should_apply_compensating_zoom(zoom) {
        if let Err(err) = window.set_zoom(zoom) {
            log::warn!("failed to set main window compensating zoom: {err}");
        }
    }

    let state = app.state::<AppState>();
    let snapshot = state.store.snapshot();
    let should_start_hidden = snapshot.tray_enabled && snapshot.main_window_hidden;

    if should_start_hidden {
        if let Err(err) = state.ensure_tray_icon_for_background(app) {
            log::warn!("failed to create tray icon on startup: {err}");
            if let Err(err) = window.show() {
                log::warn!("failed to show main window after tray init error: {err}");
            }
            let _ = window.set_focus();
            if let Err(err) = state.set_main_window_hidden(false) {
                log::warn!("failed to reset main hidden state after tray init error: {err}");
            }
        }
        return Ok(());
    }

    if let Err(err) = window.show() {
        log::warn!("failed to show main window after configuration: {err}");
    }
    // 창 설정에 focus 필드가 없어 생성 기본값에 의존 중이라 시작 포커스를 명시
    let _ = window.set_focus();
    if let Err(err) = state.set_main_window_hidden(false) {
        log::warn!("failed to persist visible main window state: {err}");
    }
    Ok(())
}

fn register_dev_capability(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    const DEV_URLS: &[&str] = &[
        "http://localhost:3400",
        "http://127.0.0.1:3400",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "tauri://localhost",
    ];

    let builder = DEV_URLS.iter().fold(
        CapabilityBuilder::new("dmnote-dev")
            .local(true)
            .windows(["main", "overlay", "panel"])
            .webviews(["main", "overlay", "panel"])
            .permission("dmnote-allow-all"),
        |acc, url| acc.remote((*url).to_string()),
    );

    app.add_capability(builder)
        .map_err(|err| -> Box<dyn std::error::Error> { err.into() })
}

#[cfg(target_os = "macos")]
fn launch_macos_dock_helper() {
    let Some(helper_path) = resolve_macos_dock_helper_path() else {
        log::warn!("macOS helper app not found; dock helper launch skipped");
        return;
    };

    let mut cmd = Command::new("/usr/bin/open");
    cmd.arg("-n")
        .arg(&helper_path)
        .arg("--args")
        .arg("--main-pid")
        .arg(std::process::id().to_string())
        .arg("--main-bundle-id")
        .arg("com.dmnote.desktop");

    if let Some(bundle_path) = resolve_current_bundle_path() {
        cmd.arg("--main-bundle-path").arg(bundle_path);
    }

    match cmd.status() {
        Ok(status) if status.success() => {
            log::info!("launched macOS dock helper: {}", helper_path.display());
        }
        Ok(status) => {
            log::warn!(
                "failed to launch macOS helper app {}: open exited with {status}",
                helper_path.display()
            );
        }
        Err(err) => {
            log::warn!(
                "failed to launch macOS helper app {}: {err}",
                helper_path.display()
            );
        }
    }
}

#[cfg(target_os = "macos")]
fn resolve_macos_dock_helper_path() -> Option<PathBuf> {
    if let Some(bundle_path) = resolve_current_bundle_path() {
        let bundled_helper = bundle_path
            .join("Contents")
            .join("Resources")
            .join("DM NOTE.app");
        if bundled_helper.is_dir() {
            return Some(bundled_helper);
        }
    }

    let dev_helper = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("dmnote-helper")
        .join("DM NOTE.app");
    if dev_helper.is_dir() {
        return Some(dev_helper);
    }

    None
}

#[cfg(target_os = "macos")]
fn resolve_current_bundle_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let macos_dir = exe.parent()?;
    if macos_dir.file_name()? != "MacOS" {
        return None;
    }

    let contents_dir = macos_dir.parent()?;
    if contents_dir.file_name()? != "Contents" {
        return None;
    }

    let bundle_dir = contents_dir.parent()?;
    if bundle_dir.extension()? == "app" {
        return Some(bundle_dir.to_path_buf());
    }

    None
}

#[cfg(target_os = "windows")]
fn apply_webview2_fixed_runtime_override() {
    use std::env;
    const KEY: &str = "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER";

    if env::var_os("DMNOTE_WEBVIEW2_USE_SYSTEM").is_some() {
        return;
    }

    if env::var_os(KEY).is_some() {
        return;
    }

    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(dir) = env::var_os("DMNOTE_WEBVIEW2_FIXED_RUNTIME_DIR") {
        candidates.push(PathBuf::from(dir));
    }

    if let Ok(exe) = env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(exe_dir.join("webview2-fixed-runtime"));
            candidates.push(exe_dir.join("WebView2FixedRuntime"));
            candidates.push(exe_dir.join("resources").join("webview2-fixed-runtime"));
            candidates.push(
                exe_dir
                    .join("..")
                    .join("resources")
                    .join("webview2-fixed-runtime"),
            );
        }
    }

    if cfg!(debug_assertions) {
        // `tauri dev` — 바이너리 위치 가변, 저장소 기준 경로 추가 확인
        candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("webview2-fixed-runtime"));
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("webview2-fixed-runtime"),
        );
    }

    for candidate in candidates {
        if is_valid_webview2_fixed_runtime_dir(&candidate) {
            env::set_var(KEY, &candidate);
            log::info!(
                "using fixed WebView2 runtime override: {}",
                candidate.display()
            );
            return;
        }
    }
}

#[cfg(target_os = "windows")]
fn is_valid_webview2_fixed_runtime_dir(dir: &std::path::Path) -> bool {
    dir.is_dir() && dir.join("msedgewebview2.exe").is_file()
}

#[cfg(all(target_os = "windows", dmnote_embedded_webview2))]
fn apply_embedded_webview2_fixed_runtime_override() {
    use std::env;
    use std::fs;

    const KEY: &str = "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER";
    const VERSION_FILE: &str = "dmnote-webview2-fixed-runtime-version.txt";

    if env::var_os("DMNOTE_WEBVIEW2_USE_SYSTEM").is_some() {
        return;
    }
    if env::var_os(KEY).is_some() {
        return;
    }

    let embedded_version = option_env!("DMNOTE_WEBVIEW2_EMBEDDED_VERSION").unwrap_or("unknown");
    let embedded_arch = option_env!("DMNOTE_WEBVIEW2_EMBEDDED_ARCH").unwrap_or("x64");

    let extract_dir = match dirs_next::data_local_dir() {
        Some(dir) => dir
            .join("com.dmnote.desktop")
            .join("webview2-fixed-runtime")
            .join(format!("{embedded_version}-{embedded_arch}")),
        None => return,
    };

    let expected_version_file = extract_dir.join(VERSION_FILE);
    let needs_extract = match (
        read_first_line_trimmed(&expected_version_file),
        is_valid_webview2_fixed_runtime_dir(&extract_dir),
    ) {
        (Some(v), true) if v == embedded_version => false,
        _ => true,
    };

    if needs_extract {
        // 이전 추출 시도 정리
        let _ = fs::remove_dir_all(&extract_dir);
        if let Err(err) = fs::create_dir_all(&extract_dir) {
            log::warn!(
                "failed to create embedded webview2 dir {}: {err}",
                extract_dir.display()
            );
            return;
        }

        static ZIP_BYTES: &[u8] = include_bytes!(env!("DMNOTE_WEBVIEW2_EMBEDDED_ZIP"));
        if let Err(err) = extract_zip_bytes_to_dir(ZIP_BYTES, &extract_dir) {
            log::warn!(
                "failed to extract embedded webview2 runtime to {}: {err}",
                extract_dir.display()
            );
            return;
        }
    }

    if is_valid_webview2_fixed_runtime_dir(&extract_dir) {
        env::set_var(KEY, &extract_dir);
        log::info!(
            "using embedded fixed WebView2 runtime: {}",
            extract_dir.display()
        );
    }
}

#[cfg(all(target_os = "windows", not(dmnote_embedded_webview2)))]
fn apply_embedded_webview2_fixed_runtime_override() {}

#[cfg(all(target_os = "windows", dmnote_embedded_webview2))]
fn read_first_line_trimmed(path: &std::path::Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    content.lines().next().map(|l| l.trim().to_string())
}

#[cfg(all(target_os = "windows", dmnote_embedded_webview2))]
fn extract_zip_bytes_to_dir(zip_bytes: &[u8], dest_dir: &std::path::Path) -> Result<(), String> {
    use std::io::{self, Cursor, Write};

    let reader = Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let enclosed = match file.enclosed_name() {
            Some(name) => name.to_owned(),
            None => continue,
        };
        let out_path = dest_dir.join(enclosed);

        if file.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let mut out_file = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
        io::copy(&mut file, &mut out_file).map_err(|e| e.to_string())?;

        let _ = out_file.flush();
    }

    Ok(())
}

/// macOS 접근성(Accessibility) 권한을 확인하고,
/// 없으면 시스템 권한 요청 노브로그를 자동으로 표시합니다.
/// `AXIsProcessTrustedWithOptions`에 `kAXTrustedCheckOptionPrompt: true`를 전달하면
/// macOS가 자동으로 "시스템 설정 > 개인정보 보호 및 보안 > 손쉬운 사용" 허용 팝업을 띄워줍니다.
/// 참고: 입력 모니터링(Input Monitoring) 권한은 rdev가 CGEventTap을 생성할 때
/// macOS가 자동으로 프롬프트를 표시합니다.
#[cfg(target_os = "macos")]
fn request_accessibility_permission() {
    use std::ffi::c_void;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFDictionaryCreate(
            allocator: *const c_void,
            keys: *const *const c_void,
            values: *const *const c_void,
            num_values: isize,
            key_callbacks: *const c_void,
            value_callbacks: *const c_void,
        ) -> *const c_void;
        fn CFRelease(cf: *const c_void);

        static kCFBooleanTrue: *const c_void;
        static kCFTypeDictionaryKeyCallBacks: c_void;
        static kCFTypeDictionaryValueCallBacks: c_void;
    }

    extern "C" {
        static kAXTrustedCheckOptionPrompt: *const c_void;
    }

    unsafe {
        let keys: [*const c_void; 1] = [kAXTrustedCheckOptionPrompt];
        let values: [*const c_void; 1] = [kCFBooleanTrue];

        let options = CFDictionaryCreate(
            std::ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            1,
            &kCFTypeDictionaryKeyCallBacks as *const c_void,
            &kCFTypeDictionaryValueCallBacks as *const c_void,
        );

        let trusted = AXIsProcessTrustedWithOptions(options);

        if !options.is_null() {
            CFRelease(options);
        }

        if trusted {
            log::info!("macOS 접근성 권한이 이미 허용되어 있습니다.");
        } else {
            log::warn!("macOS 접근성 권한이 허용되지 않았습니다. 시스템 설정에서 허용해 주세요.");
        }
    }
}
