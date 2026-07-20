use tauri::{AppHandle, State};

use crate::{
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
    let diff = state.settings.apply_patch(patch)?;
    if let Some(previous) = previous.as_ref() {
        state.resync_global_css_watcher(previous, &state.store.snapshot());
    }
    drop(operation_guard);
    state.emit_settings_changed(&diff, &app)?;
    Ok(diff.full.unwrap_or_else(|| state.settings.snapshot()))
}
