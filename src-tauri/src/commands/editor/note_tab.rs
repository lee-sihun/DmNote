use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::{
    models::{TabNoteOverrides, TabNoteSettings},
    state::AppState,
};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TabNoteResponse {
    pub tab_id: String,
    pub settings: Option<TabNoteSettings>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabNoteClearResponse {
    pub success: bool,
    pub tab_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabNoteSetResponse {
    pub success: bool,
    pub tab_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<TabNoteSettings>,
}

/// 모든 탭의 노트 설정 오버라이드 조회
#[tauri::command]
pub fn note_tab_get_all(state: State<'_, AppState>) -> Result<TabNoteOverrides, String> {
    Ok(state.store.snapshot().tab_note_overrides)
}

/// 특정 탭의 노트 설정 조회
#[tauri::command]
pub fn note_tab_get(state: State<'_, AppState>, tab_id: String) -> Result<TabNoteResponse, String> {
    let overrides = state.store.snapshot().tab_note_overrides;
    let settings = overrides.get(&tab_id).cloned();
    Ok(TabNoteResponse { tab_id, settings })
}

/// 특정 탭의 노트 설정 저장
#[tauri::command]
pub fn note_tab_set(
    state: State<'_, AppState>,
    app: AppHandle,
    tab_id: String,
    settings: Option<TabNoteSettings>,
) -> Result<TabNoteSetResponse, String> {
    if let Some(ref note_settings) = settings {
        state
            .store
            .update(|store| {
                store
                    .tab_note_overrides
                    .insert(tab_id.clone(), note_settings.clone());
            })
            .map_err(|err| err.to_string())?;
    } else {
        state
            .store
            .update(|store| {
                store.tab_note_overrides.remove(&tab_id);
            })
            .map_err(|err| err.to_string())?;
    }

    let response = TabNoteResponse {
        tab_id: tab_id.clone(),
        settings: settings.clone(),
    };
    app.emit("tabNote:changed", &response)
        .map_err(|err| err.to_string())?;

    Ok(TabNoteSetResponse {
        success: true,
        tab_id,
        settings,
    })
}

/// 특정 탭의 노트 설정 제거 (전역 설정으로 폴백)
#[tauri::command]
pub fn note_tab_clear(
    state: State<'_, AppState>,
    app: AppHandle,
    tab_id: String,
) -> Result<TabNoteClearResponse, String> {
    state
        .store
        .update(|store| {
            store.tab_note_overrides.remove(&tab_id);
        })
        .map_err(|err| err.to_string())?;

    let response = TabNoteResponse {
        tab_id: tab_id.clone(),
        settings: None,
    };
    app.emit("tabNote:changed", &response)
        .map_err(|err| err.to_string())?;

    Ok(TabNoteClearResponse {
        success: true,
        tab_id,
    })
}
