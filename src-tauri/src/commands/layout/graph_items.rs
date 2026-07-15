use tauri::{AppHandle, State};

use crate::{
    commands::editor::state::{emit_best_effort, publish_editor_change},
    errors::CmdResult,
    models::{EditorCommitOrigin, EditorField, GraphPositions},
    state::AppState,
};

#[tauri::command]
pub fn graph_positions_get(state: State<'_, AppState>) -> CmdResult<GraphPositions> {
    Ok(state.store.snapshot().graph_positions)
}

#[tauri::command]
pub fn graph_positions_update(
    state: State<'_, AppState>,
    app: AppHandle,
    positions: GraphPositions,
) -> CmdResult<GraphPositions> {
    let transaction = state.store.commit_legacy_editor_transaction(
        EditorCommitOrigin::LegacyAdapter("graph_positions_update".to_string()),
        &[EditorField::GraphPositions],
        move |store| {
            store.graph_positions = positions;
            Ok(())
        },
    )?;
    publish_editor_change(state.inner(), &app, &transaction.change, false);
    let updated = transaction.change.document.graph_positions;
    emit_best_effort(&app, "graphPositions:changed", &updated);
    if transaction.change.event.is_none() {
        state.refresh_obs_snapshot();
    }
    Ok(updated)
}
