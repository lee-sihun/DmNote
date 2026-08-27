use serde::Deserialize;
use tauri::AppHandle;

use crate::{
    commands::run_blocking,
    errors::CmdResult,
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

#[tauri::command]
pub async fn overlay_get(app: AppHandle) -> CmdResult<BootstrapOverlayState> {
    run_blocking(app, |_, state| Ok(state.overlay_status())).await
}

#[tauri::command]
pub async fn overlay_set_visible(app: AppHandle, visible: bool) -> CmdResult<()> {
    // store 쓰기(fsync)를 async 런타임 스레드에서 직접 하지 않는다 - overlay_set_lock과 동일
    run_blocking(app, move |app, state| {
        // OBS 모드 활성화 중에는 오버레이 수동 토글 차단
        if state.is_obs_mode_active() {
            return Err(crate::errors::CommandError::msg(
                "OBS 모드 활성화 중에는 오버레이를 수동으로 전환할 수 없습니다",
            ));
        }
        Ok(state.set_overlay_visibility(app, visible)?)
    })
    .await
}

#[tauri::command]
pub async fn overlay_set_lock(app: AppHandle, locked: bool) -> CmdResult<()> {
    run_blocking(app, move |app, state| {
        Ok(state.set_overlay_lock(app, locked, true)?)
    })
    .await
}

#[tauri::command]
pub async fn overlay_set_anchor(app: AppHandle, anchor: String) -> CmdResult<String> {
    run_blocking(app, move |app, state| {
        Ok(state.set_overlay_anchor(app, &anchor)?)
    })
    .await
}

#[tauri::command]
pub fn overlay_transition_fade(app: AppHandle, alpha: f64, duration_ms: u64) -> CmdResult<bool> {
    Ok(crate::state::app_state::fade_overlay_window(
        &app,
        alpha,
        duration_ms,
    )?)
}

#[tauri::command]
pub async fn overlay_reset_position(app: AppHandle) -> CmdResult<OverlayBounds> {
    run_blocking(app, |app, state| Ok(state.reset_overlay_position(app)?)).await
}

#[tauri::command]
pub async fn overlay_resize(
    app: AppHandle,
    payload: OverlayResizeArgs,
) -> CmdResult<OverlayBounds> {
    run_blocking(app, move |app, state| {
        Ok(state.resize_overlay(
            app,
            payload.width,
            payload.height,
            payload.anchor,
            payload.content_top_offset,
            payload.fixed_position_delta_x,
            payload.fixed_position_delta_y,
        )?)
    })
    .await
}
