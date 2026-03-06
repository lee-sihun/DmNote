#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod commands;
mod cursor;
mod defaults;
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

use dm_note::compute_compensating_zoom;

use state::{AppState, AppStore};

fn main() {
    #[cfg(target_os = "windows")]
    {
        // WebView2 투명 오버레이(레이어드/알파) 이슈가 특정 런타임 버전에서 발생할 수 있어,
        // 고정(Fixed) 런타임을 번들/지정한 경우 우선 사용하도록 합니다.
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
        if let Err(err) = keyboard::daemon::run() {
            eprintln!("keyboard daemon error: {err:?}");
            std::process::exit(1);
        }
        return;
    }

    // macOS: 키보드/마우스 캡처를 위해 접근성 권한을 확인하고,
    // 권한이 없으면 시스템 권한 요청 다이얼로그를 자동으로 표시합니다.
    #[cfg(target_os = "macos")]
    {
        request_accessibility_permission();
    }

    if let Err(err) = setup_logging() {
        eprintln!("Failed to initialize logging: {err}");
    }

    let context = tauri::generate_context!();

    tauri::Builder::default()
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let zoom = compute_compensating_zoom();
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
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            register_dev_capability(app)?;
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // macOS: 편집 메뉴 추가 (Cmd+Z/X/C/V/A 등 네이티브 편집 단축키 활성화)
            // WKWebView에서 단축키들이 동작하려면 네이티브 Edit 메뉴가 필요
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
            let store = AppStore::initialize(&resolver)
                .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            let app_state = AppState::initialize(store)
                .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            app.manage(app_state);
            let handle = app.handle();
            {
                let state = app.state::<AppState>();
                state
                    .initialize_runtime(&handle)
                    .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            }
            configure_main_window(&app.handle());

            #[cfg(target_os = "macos")]
            launch_macos_dock_helper();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // app
            commands::app::bootstrap::app_bootstrap,
            commands::app::update::app_auto_update,
            commands::app::system::window_minimize,
            commands::app::system::window_close,
            commands::app::system::window_show_main,
            commands::app::system::app_open_external,
            commands::app::system::app_restart,
            commands::app::system::app_quit,
            commands::app::system::window_open_devtools_all,
            commands::app::system::get_cursor_settings,
            // editor
            commands::editor::css::css_get,
            commands::editor::css::css_get_use,
            commands::editor::css::css_toggle,
            commands::editor::css::css_reset,
            commands::editor::css::css_set_content,
            commands::editor::css::css_load,
            commands::editor::css::css_tab_get_all,
            commands::editor::css::css_tab_get,
            commands::editor::css::css_tab_load,
            commands::editor::css::css_tab_clear,
            commands::editor::css::css_tab_set,
            commands::editor::css::css_tab_toggle,
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
            // keys
            commands::keys::keys::keys_get,
            commands::keys::keys::positions_get,
            commands::keys::keys::keys_update,
            commands::keys::keys::positions_update,
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
            commands::keys::keys::layer_groups_get,
            commands::keys::keys::layer_groups_update,
            commands::keys::key_sound::key_sound_get_status,
            commands::keys::key_sound::key_sound_set_enabled,
            commands::keys::key_sound::key_sound_set_volume,
            commands::keys::key_sound::key_sound_load_soundpack,
            commands::keys::key_sound::key_sound_unload_soundpack,
            commands::keys::key_sound::key_sound_set_latency_logging,
            commands::keys::sound::sound_load,
            commands::keys::sound::sound_list,
            commands::keys::sound::sound_set_enabled,
            commands::keys::sound::sound_delete,
            commands::keys::sound::sound_save_processed_wav,
            commands::keys::sound::sound_load_original,
            commands::keys::sound::sound_update_processed_wav,
            // layout
            commands::layout::settings::settings_get,
            commands::layout::settings::settings_update,
            commands::layout::stat_items::stat_positions_get,
            commands::layout::stat_items::stat_positions_update,
            commands::layout::graph_items::graph_positions_get,
            commands::layout::graph_items::graph_positions_update,
            commands::layout::font::font_load,
            commands::layout::overlay::overlay_get,
            commands::layout::overlay::overlay_set_visible,
            commands::layout::overlay::overlay_set_lock,
            commands::layout::overlay::overlay_set_anchor,
            commands::layout::overlay::overlay_resize,
            // media
            commands::media::image::image_load,
            commands::media::counter_animation::counter_animation_list,
            commands::media::counter_animation::counter_animation_create,
            commands::media::counter_animation::counter_animation_update,
            commands::media::counter_animation::counter_animation_delete,
            // preset
            commands::preset::save::preset_save,
            commands::preset::save::preset_save_tab,
            commands::preset::load::preset_load,
            commands::preset::load::preset_load_tab,
            // plugin
            commands::plugin::bridge::plugin_bridge_send,
            commands::plugin::bridge::plugin_bridge_send_to,
            commands::plugin::storage::plugin_storage_get,
            commands::plugin::storage::plugin_storage_set,
            commands::plugin::storage::plugin_storage_remove,
            commands::plugin::storage::plugin_storage_clear,
            commands::plugin::storage::plugin_storage_keys,
            commands::plugin::storage::plugin_storage_has_data,
            commands::plugin::storage::plugin_storage_clear_by_prefix,
        ])
        .run(context)
        .expect("error while running tauri application");
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
    // Tauri 초기화 전이므로 직접 경로를 찾아야 함
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
    // Windows: %APPDATA%/com.dmnote.desktop/store.json
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
                if let Err(err) = apply_main_window_configuration(&handle, window) {
                    log::warn!("failed to configure main window: {err}");
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
    if let Err(err) = window.set_zoom(zoom) {
        log::warn!("failed to set main window compensating zoom: {err}");
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
            if let Err(err) = state.set_main_window_hidden(false) {
                log::warn!("failed to reset main hidden state after tray init error: {err}");
            }
        }
        return Ok(());
    }

    if let Err(err) = window.show() {
        log::warn!("failed to show main window after configuration: {err}");
    }
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
            .windows(["main", "overlay"])
            .webviews(["main", "overlay"])
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
    cmd.arg(&helper_path)
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
        // `tauri dev`에서는 바이너리 위치가 변하므로, 저장소 기준 경로도 함께 확인합니다.
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
fn is_valid_webview2_fixed_runtime_dir(dir: &PathBuf) -> bool {
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
/// 없으면 시스템 권한 요청 다이얼로그를 자동으로 표시합니다.
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
            &kCFTypeDictionaryKeyCallBacks as *const _ as *const c_void,
            &kCFTypeDictionaryValueCallBacks as *const _ as *const c_void,
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
