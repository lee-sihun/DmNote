use tauri::{AppHandle, State, WebviewWindow};

use crate::{
    commands::editor::state::{emit_best_effort, publish_legacy_editor_change},
    errors::CmdResult,
    models::{EditorCommitOrigin, EditorField, StatPositions},
    state::AppState,
};

#[tauri::command]
pub fn stat_positions_get(state: State<'_, AppState>) -> CmdResult<StatPositions> {
    Ok(state.store.snapshot().stat_positions)
}

#[tauri::command]
pub fn stat_positions_update(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    positions: StatPositions,
) -> CmdResult<StatPositions> {
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction = state
        .store
        .commit_legacy_editor_transaction_with_admission(
            EditorCommitOrigin::LegacyAdapter("stat_positions_update".to_string()),
            &[EditorField::StatPositions],
            admission,
            move |store| {
                store.stat_positions = positions;
                Ok(())
            },
        )?;
    publish_legacy_editor_change(state.inner(), &app, &transaction.change);
    let updated = transaction.change.document.stat_positions;
    emit_best_effort(&app, "statPositions:changed", &updated);
    if transaction.change.event.is_none() {
        state.refresh_obs_snapshot();
    }
    Ok(updated)
}
