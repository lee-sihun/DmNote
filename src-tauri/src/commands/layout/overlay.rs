use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::{
    errors::CmdResult,
    models::{BootstrapOverlayState, ContentMargins, OverlayBounds},
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
    pub fixed_position_delta_x: Option<f64>,
    #[serde(default)]
    pub fixed_position_delta_y: Option<f64>,
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
    payload: OverlayResizeArgs,
) -> CmdResult<OverlayBounds> {
    state.resize_overlay(
        &app,
        payload.width,
        payload.height,
        payload.anchor,
        payload.content_top_offset,
        payload.content_margins,
        payload.fixed_position_delta_x,
        payload.fixed_position_delta_y,
    )
}

#[cfg(test)]
mod tests {
    use super::OverlayResizeArgs;
    use crate::models::ContentMargins;

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
            }
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
    }
}
