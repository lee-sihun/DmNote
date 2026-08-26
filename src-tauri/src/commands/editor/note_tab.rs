use serde::Serialize;
use tauri::{AppHandle, WebviewWindow};

use crate::{
    commands::{editor::state::emit_best_effort, run_blocking, run_history_mutation},
    errors::CmdResult,
    models::{TabNoteOverrides, TabNoteSettings},
    services::event_publisher::publish_event,
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
pub async fn note_tab_get_all(app: AppHandle) -> CmdResult<TabNoteOverrides> {
    run_blocking(app, |_, state| {
        Ok(state.store.snapshot().tab_note_overrides)
    })
    .await
}

/// 특정 탭의 노트 설정 조회
#[tauri::command]
pub async fn note_tab_get(app: AppHandle, tab_id: String) -> CmdResult<TabNoteResponse> {
    run_blocking(app, move |_, state| {
        let overrides = state.store.snapshot().tab_note_overrides;
        let settings = overrides.get(&tab_id).cloned();
        Ok(TabNoteResponse { tab_id, settings })
    })
    .await
}

/// 특정 탭의 노트 설정 저장
#[tauri::command]
pub async fn note_tab_set(
    app: AppHandle,
    window: WebviewWindow,
    tab_id: String,
    settings: Option<TabNoteSettings>,
) -> CmdResult<TabNoteSetResponse> {
    run_history_mutation(
        app,
        window.label().to_string(),
        move |app, state, admission| {
            let transaction =
                state
                    .store
                    .commit_history_overlap_mutation_with_admission(admission, |store| {
                        if let Some(ref note_settings) = settings {
                            store
                                .tab_note_overrides
                                .insert(tab_id.clone(), note_settings.clone());
                        } else {
                            store.tab_note_overrides.remove(&tab_id);
                        }
                        Ok(())
                    })?;

            let response = TabNoteResponse {
                tab_id: tab_id.clone(),
                settings: settings.clone(),
            };
            if let Some(status) = transaction.history_status.as_ref() {
                emit_best_effort(app, "history:status", status);
            }
            publish_event(app, "tabNote:changed", &response);
            state.refresh_obs_snapshot();

            Ok(TabNoteSetResponse {
                success: true,
                tab_id,
                settings,
            })
        },
    )
    .await
}

/// 특정 탭의 노트 설정 제거 (전역 설정으로 폴백)
#[tauri::command]
pub async fn note_tab_clear(
    app: AppHandle,
    window: WebviewWindow,
    tab_id: String,
) -> CmdResult<TabNoteClearResponse> {
    run_history_mutation(
        app,
        window.label().to_string(),
        move |app, state, admission| {
            let transaction =
                state
                    .store
                    .commit_history_overlap_mutation_with_admission(admission, |store| {
                        store.tab_note_overrides.remove(&tab_id);
                        Ok(())
                    })?;

            let response = TabNoteResponse {
                tab_id: tab_id.clone(),
                settings: None,
            };
            if let Some(status) = transaction.history_status.as_ref() {
                emit_best_effort(app, "history:status", status);
            }
            publish_event(app, "tabNote:changed", &response);
            state.refresh_obs_snapshot();

            Ok(TabNoteClearResponse {
                success: true,
                tab_id,
            })
        },
    )
    .await
}
