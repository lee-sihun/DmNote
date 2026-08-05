use tauri::{AppHandle, State, WebviewWindow};

use crate::{
    commands::editor::state::emit_best_effort,
    errors::CmdResult,
    models::{SettingsPatchInput, SettingsState},
    state::AppState,
};

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> CmdResult<SettingsState> {
    Ok(state.settings.snapshot())
}

#[tauri::command]
pub fn settings_update(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    patch: SettingsPatchInput,
) -> CmdResult<SettingsState> {
    let css_changed = patch.use_custom_css.is_some() || patch.custom_css.is_some();
    let operation_guard = if css_changed {
        Some(state.lock_css_operation())
    } else {
        None
    };
    let previous = if css_changed {
        Some(state.store.snapshot())
    } else {
        None
    };
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction =
        state
            .store
            .commit_history_overlap_mutation_with_admission(admission, |store| {
                Ok(crate::services::settings::apply_patch_to_store(
                    store, &patch,
                ))
            })?;
    if let Some(previous) = previous.as_ref() {
        state.resync_global_css_watcher(previous, &state.store.snapshot());
    }
    drop(operation_guard);
    if let Some(status) = transaction.history_status.as_ref() {
        emit_best_effort(&app, "history:status", status);
    }
    state.emit_settings_changed(&transaction.value, &app)?;
    Ok(transaction
        .value
        .full
        .clone()
        .unwrap_or_else(|| state.settings.snapshot()))
}
