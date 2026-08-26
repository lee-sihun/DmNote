use tauri::{AppHandle, WebviewWindow};

use crate::{
    commands::{
        editor::state::{emit_best_effort, publish_legacy_editor_change},
        run_blocking, run_history_mutation,
    },
    errors::CmdResult,
    models::{EditorCommitOrigin, EditorField, StatPositions},
};

#[tauri::command]
pub async fn stat_positions_get(app: AppHandle) -> CmdResult<StatPositions> {
    run_blocking(app, |_, state| Ok(state.store.snapshot().stat_positions)).await
}

#[tauri::command]
pub async fn stat_positions_update(
    app: AppHandle,
    window: WebviewWindow,
    positions: StatPositions,
) -> CmdResult<StatPositions> {
    run_history_mutation(
        app,
        window.label().to_string(),
        move |app, state, admission| {
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
            publish_legacy_editor_change(state, app, &transaction.change);
            let updated = transaction.change.document.stat_positions;
            emit_best_effort(app, "statPositions:changed", &updated);
            if transaction.change.event.is_none() {
                state.refresh_obs_snapshot();
            }
            Ok(updated)
        },
    )
    .await
}
