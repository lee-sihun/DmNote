use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::{
    app_state::AppState,
    models::{BootstrapOverlayState, OverlayBounds},
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayResizeArgs {
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub anchor: Option<String>,
    #[serde(default)]
    pub content_top_offset: Option<f64>,
    #[serde(default)]
    pub fixed_position_delta_x: Option<f64>,
    #[serde(default)]
    pub fixed_position_delta_y: Option<f64>,
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn overlay_get(state: State<'_, AppState>) -> Result<BootstrapOverlayState, String> {
    Ok(state.overlay_status())
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn overlay_set_visible(
    state: State<'_, AppState>,
    app: AppHandle,
    visible: bool,
) -> Result<(), String> {
    state
        .set_overlay_visibility(&app, visible)
        .map_err(|err| err.to_string())
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn overlay_set_lock(
    state: State<'_, AppState>,
    app: AppHandle,
    locked: bool,
) -> Result<(), String> {
    state
        .set_overlay_lock(&app, locked, true)
        .map_err(|err| err.to_string())
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn overlay_set_anchor(
    state: State<'_, AppState>,
    app: AppHandle,
    anchor: String,
) -> Result<String, String> {
    state
        .set_overlay_anchor(&app, &anchor)
        .map_err(|err| err.to_string())
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn overlay_resize(
    state: State<'_, AppState>,
    app: AppHandle,
    payload: OverlayResizeArgs,
) -> Result<OverlayBounds, String> {
    state
        .resize_overlay(
            &app,
            payload.width,
            payload.height,
            payload.anchor,
            payload.content_top_offset,
            payload.fixed_position_delta_x,
            payload.fixed_position_delta_y,
        )
        .map_err(|err| err.to_string())
}
