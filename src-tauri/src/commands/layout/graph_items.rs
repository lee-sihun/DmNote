use tauri::{AppHandle, WebviewWindow};

use crate::{
    commands::{
        editor::state::{emit_best_effort, publish_legacy_editor_change},
        run_blocking, run_history_mutation,
    },
    errors::CmdResult,
    models::{EditorCommitOrigin, EditorField, GraphPositions},
};

#[tauri::command]
pub async fn graph_positions_get(app: AppHandle) -> CmdResult<GraphPositions> {
    run_blocking(app, |_, state| Ok(state.store.snapshot().graph_positions)).await
}

#[tauri::command]
pub async fn graph_positions_update(
    app: AppHandle,
    window: WebviewWindow,
    positions: GraphPositions,
) -> CmdResult<GraphPositions> {
    run_history_mutation(
        app,
        window.label().to_string(),
        move |app, state, admission| {
            let transaction = state
                .store
                .commit_legacy_editor_transaction_with_admission(
                    EditorCommitOrigin::LegacyAdapter("graph_positions_update".to_string()),
                    &[EditorField::GraphPositions],
                    admission,
                    move |store| {
                        store.graph_positions = positions;
                        Ok(())
                    },
                )?;
            publish_legacy_editor_change(state, app, &transaction.change);
            let updated = transaction.change.document.graph_positions;
            emit_best_effort(app, "graphPositions:changed", &updated);
            if transaction.change.event.is_none() {
                state.refresh_obs_snapshot();
            }
            Ok(updated)
        },
    )
    .await
}
