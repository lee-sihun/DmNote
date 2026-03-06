use tauri::{AppHandle, Manager, State};

use crate::cursor::{get_macos_cursor_settings, rgb_to_hex};
use crate::state::AppState;

const TRAY_ICON_ID: &str = "background-tray";

#[tauri::command]
pub fn window_minimize(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.minimize().map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn window_close(app: AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        main.close().map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn app_open_external(_app: AppHandle, url: String) -> Result<(), String> {
    if url.is_empty() {
        return Ok(());
    }
    open::that(url).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn app_restart(app: AppHandle) -> Result<(), String> {
    app.request_restart();
    Ok(())
}

#[tauri::command]
pub fn window_show_main(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        main.show().map_err(|err| err.to_string())?;
        let _ = main.set_focus();
    }

    if app.tray_by_id(TRAY_ICON_ID).is_some() {
        let _ = app.remove_tray_by_id(TRAY_ICON_ID);
    }

    state
        .set_main_window_hidden(false)
        .map_err(|err| err.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn app_quit(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.request_shutdown(app);
    Ok(())
}

#[tauri::command]
pub fn window_open_devtools_all(app: AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.open_devtools();
        let _ = main.show();
    }
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.open_devtools();
        let _ = overlay.show();
    }
    Ok(())
}

/// macOS 시스템 커서 설정 반환 (크기, 색상)
/// 비-macOS 플랫폼에서는 기본값 반환
#[derive(Debug, Clone, serde::Serialize)]
pub struct CursorSettingsResponse {
    /// 커서 크기 배율 (1.0 ~ 4.0)
    pub size: f64,
    /// 커서 기본 픽셀 크기 (24px - macOS 기본 커서 크기)
    pub base_size: u32,
    /// 커서 채우기 색상 (HEX)
    pub fill_color: String,
    /// 커서 테두리 색상 (HEX)
    pub outline_color: String,
    /// macOS 플랫폼 여부
    pub is_macos: bool,
}

#[tauri::command]
pub fn get_cursor_settings() -> CursorSettingsResponse {
    let settings = get_macos_cursor_settings();

    let fill_color = settings
        .fill_color
        .map(rgb_to_hex)
        .unwrap_or_else(|| "#000000".to_string());

    let outline_color = settings
        .outline_color
        .map(rgb_to_hex)
        .unwrap_or_else(|| "#FFFFFF".to_string());

    CursorSettingsResponse {
        size: settings.size,
        base_size: 24,
        fill_color,
        outline_color,
        #[cfg(target_os = "macos")]
        is_macos: true,
        #[cfg(not(target_os = "macos"))]
        is_macos: false,
    }
}
