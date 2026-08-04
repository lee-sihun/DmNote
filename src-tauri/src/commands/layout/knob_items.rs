use tauri::{AppHandle, State, WebviewWindow};

use crate::{
    commands::editor::state::{emit_best_effort, publish_editor_change},
    errors::CmdResult,
    models::{EditorCommitOrigin, EditorField, KnobPositions},
    state::AppState,
};

#[tauri::command]
pub fn knob_positions_get(state: State<'_, AppState>) -> CmdResult<KnobPositions> {
    Ok(state.store.snapshot().knob_positions)
}

#[tauri::command]
pub fn knob_positions_update(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    positions: KnobPositions,
) -> CmdResult<KnobPositions> {
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction = state
        .store
        .commit_legacy_editor_transaction_with_admission(
            EditorCommitOrigin::LegacyAdapter("knob_positions_update".to_string()),
            &[EditorField::KnobPositions],
            admission,
            move |store| {
                store.knob_positions = positions;
                Ok(())
            },
        )?;
    publish_editor_change(state.inner(), &app, &transaction.change, false);
    let updated = transaction.change.document.knob_positions;
    emit_best_effort(&app, "knobPositions:changed", &updated);
    if transaction.change.event.is_none() {
        state.refresh_obs_snapshot();
    }
    Ok(updated)
}
