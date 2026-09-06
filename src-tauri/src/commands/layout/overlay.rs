use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State, WebviewWindow};

use crate::{
    commands::run_blocking,
    errors::CmdResult,
    models::{BootstrapOverlayState, OverlayBounds},
    services::overlay_hit::OverlayHitRect,
    state::AppState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayResizeArgs {
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub anchor: Option<String>,
    #[serde(default)]
    pub content_left_offset: Option<f64>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlaySyncHitRegionsArgs {
    pub rects: Vec<OverlayHitRect>,
    pub revision: u64,
    /// 웹뷰 실측 배율 - 보정 줌이 곱해져 있어 백엔드가 DPI로 대신 계산할 수 없다
    pub device_pixel_ratio: f64,
    pub epoch: u64,
    pub renderer_session_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayHitRendererReadyResponse {
    pub epoch: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlaySyncHitRegionsResponse {
    pub accepted: bool,
}

#[tauri::command]
pub fn overlay_hit_renderer_ready(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    renderer_session_id: String,
) -> CmdResult<OverlayHitRendererReadyResponse> {
    if window.label() != "overlay" {
        return Err(crate::errors::CommandError::msg(
            "overlay hit renderer can only be readied from the overlay window",
        ));
    }
    let epoch = state.overlay_hit_renderer_ready(&app, renderer_session_id)?;
    Ok(OverlayHitRendererReadyResponse { epoch })
}

/// 오버레이 웹뷰가 실측한 키 영역을 히트 창에 반영.
/// store 쓰기가 없으므로 번호표(run_mutation)가 아니라 run_blocking을 쓴다 -
/// 저장 FIFO 뒤에 줄서면 레이아웃 변경마다 fsync를 기다리게 된다
#[tauri::command]
pub async fn overlay_sync_hit_regions(
    app: AppHandle,
    window: tauri::WebviewWindow,
    payload: OverlaySyncHitRegionsArgs,
) -> CmdResult<OverlaySyncHitRegionsResponse> {
    if window.label() != "overlay" {
        return Err(crate::errors::CommandError::msg(
            "overlay hit regions can only be synced from the overlay window",
        ));
    }
    run_blocking(app, move |app, state| {
        let accepted = state.sync_overlay_hit_regions(
            app,
            payload.rects,
            payload.revision,
            payload.device_pixel_ratio,
            payload.epoch,
            payload.renderer_session_id,
        )?;
        Ok(OverlaySyncHitRegionsResponse { accepted })
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
            payload.content_left_offset,
            payload.content_top_offset,
            payload.fixed_position_delta_x,
            payload.fixed_position_delta_y,
        )?)
    })
    .await
}
