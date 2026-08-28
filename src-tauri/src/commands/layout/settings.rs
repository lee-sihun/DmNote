use tauri::{AppHandle, WebviewWindow};

use crate::{
    commands::{editor::state::emit_best_effort, run_blocking, run_history_mutation},
    errors::CmdResult,
    models::{SettingsPatchInput, SettingsState},
};

#[tauri::command]
pub async fn settings_get(app: AppHandle) -> CmdResult<SettingsState> {
    run_blocking(app, |_, state| Ok(state.settings.snapshot())).await
}

#[tauri::command]
pub async fn settings_update(
    app: AppHandle,
    window: WebviewWindow,
    patch: SettingsPatchInput,
) -> CmdResult<SettingsState> {
    run_history_mutation(
        app,
        window.label().to_string(),
        move |app, state, admission| {
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
            let transaction =
                state
                    .store
                    .commit_history_overlap_mutation_with_admission(admission, |store| {
                        crate::services::settings::apply_patch_to_store(store, &patch)
                            .map_err(crate::services::settings::settings_patch_validation_error)
                    })?;
            if let Some(previous) = previous.as_ref() {
                state.resync_global_css_watcher(previous, &state.store.snapshot());
            }
            drop(operation_guard);
            if let Some(status) = transaction.history_status.as_ref() {
                emit_best_effort(app, "history:status", status);
            }
            state.emit_settings_changed(&transaction.value, app)?;
            Ok(transaction
                .value
                .full
                .clone()
                .unwrap_or_else(|| state.settings.snapshot()))
        },
    )
    .await
}
