use tauri::{AppHandle, State};

use crate::{
    models::{SettingsPatchInput, SettingsState},
    state::AppState,
};

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> Result<SettingsState, String> {
    Ok(state.settings.snapshot())
}

#[tauri::command]
pub fn settings_update(
    state: State<'_, AppState>,
    app: AppHandle,
    patch: SettingsPatchInput,
) -> Result<SettingsState, String> {
    let diff = state
        .settings
        .apply_patch(patch)
        .map_err(|err| err.to_string())?;
    state
        .emit_settings_changed(&diff, &app)
        .map_err(|err| err.to_string())?;
    Ok(diff.full.unwrap_or_else(|| state.settings.snapshot()))
}
