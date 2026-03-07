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
    let diff = state.settings.apply_patch(patch)?;
    state.emit_settings_changed(&diff, &app)?;
    Ok(diff.full.unwrap_or_else(|| state.settings.snapshot()))
}
