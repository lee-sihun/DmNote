use serde::Deserialize;
use tauri::{AppHandle, State, WebviewWindow};

use crate::{
    errors::CmdResult,
    models::{BootstrapOverlayState, ContentMargins, ContentMin, OverlayResizeResponse},
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
    pub content_top_offset: Option<f64>,
    #[serde(default)]
    pub content_margins: Option<ContentMargins>,
    #[serde(default)]
    pub content_min: Option<ContentMin>,
    #[serde(default)]
    pub fixed_position_delta_x: Option<f64>,
    #[serde(default)]
    pub fixed_position_delta_y: Option<f64>,
    #[serde(default)]
    pub request_session: Option<u64>,
    #[serde(default)]
    pub request_gen: Option<u64>,
}

#[tauri::command]
pub fn overlay_get(state: State<'_, AppState>) -> CmdResult<BootstrapOverlayState> {
    Ok(state.overlay_status())
}

#[tauri::command]
pub async fn overlay_set_visible(
    state: State<'_, AppState>,
    app: AppHandle,
    visible: bool,
) -> CmdResult<()> {
    // OBS 모드 활성화 중에는 오버레이 수동 토글 차단
    if state.is_obs_mode_active() {
        return Err(crate::errors::CommandError::msg(
            "OBS 모드 활성화 중에는 오버레이를 수동으로 전환할 수 없습니다",
        ));
    }
    Ok(state.set_overlay_visibility(&app, visible)?)
}

#[tauri::command]
pub fn overlay_set_lock(state: State<'_, AppState>, app: AppHandle, locked: bool) -> CmdResult<()> {
    Ok(state.set_overlay_lock(&app, locked, true)?)
}

#[tauri::command]
pub fn overlay_set_anchor(
    state: State<'_, AppState>,
    app: AppHandle,
    anchor: String,
) -> CmdResult<String> {
    Ok(state.set_overlay_anchor(&app, &anchor)?)
}

#[tauri::command]
pub fn overlay_resize(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    payload: OverlayResizeArgs,
) -> CmdResult<OverlayResizeResponse> {
    state.resize_overlay(
        &app,
        window.label(),
        payload.width,
        payload.height,
        payload.anchor,
        payload.content_top_offset,
        payload.content_margins,
        payload.content_min,
        payload.fixed_position_delta_x,
        payload.fixed_position_delta_y,
        payload.request_session,
        payload.request_gen,
    )
}

#[cfg(test)]
mod tests {
    use super::OverlayResizeArgs;
    use crate::models::{ContentMargins, ContentMin};

    #[test]
    fn resize_payload_accepts_legacy_top_offset_without_margins() {
        let payload: OverlayResizeArgs = serde_json::from_value(serde_json::json!({
            "width": 860,
            "height": 320,
            "contentTopOffset": 150
        }))
        .unwrap();

        assert_eq!(payload.content_top_offset, Some(150.0));
        assert_eq!(payload.content_margins, None);
        assert_eq!(payload.content_min, None);
        assert_eq!(payload.request_session, None);
        assert_eq!(payload.request_gen, None);
    }

    #[test]
    fn resize_payload_deserializes_all_content_margins() {
        let payload: OverlayResizeArgs = serde_json::from_value(serde_json::json!({
            "width": 860,
            "height": 320,
            "contentMargins": {
                "top": 11,
                "bottom": 22,
                "left": 33,
                "right": 44
            },
            "contentMin": {
                "x": -12.5,
                "y": 48
            },
            "requestSession": 41,
            "requestGen": 73
        }))
        .unwrap();

        assert_eq!(
            payload.content_margins,
            Some(ContentMargins {
                top: 11.0,
                bottom: 22.0,
                left: 33.0,
                right: 44.0,
            })
        );
        assert_eq!(payload.content_min, Some(ContentMin { x: -12.5, y: 48.0 }));
        assert_eq!(payload.request_session, Some(41));
        assert_eq!(payload.request_gen, Some(73));
    }
}
