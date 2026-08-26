use tauri::{AppHandle, State};

use crate::{
    audio::{KeySoundOutputBackend, KeySoundOutputDevices, KeySoundOutputState, KeySoundStatus},
    commands::run_mutation,
    errors::{CmdResult, CommandError},
    state::AppState,
};

#[tauri::command]
pub fn key_sound_get_status(state: State<'_, AppState>) -> CmdResult<KeySoundStatus> {
    Ok(state.key_sound_status())
}

#[tauri::command]
pub fn key_sound_set_enabled(
    state: State<'_, AppState>,
    enabled: bool,
) -> CmdResult<KeySoundStatus> {
    Ok(state.key_sound_set_enabled(enabled))
}

#[tauri::command]
pub fn key_sound_set_volume(state: State<'_, AppState>, volume: f32) -> CmdResult<KeySoundStatus> {
    Ok(state.key_sound_set_volume(volume))
}

#[tauri::command]
pub fn key_sound_load_soundpack(
    state: State<'_, AppState>,
    soundpack_dir: String,
) -> CmdResult<KeySoundStatus> {
    state
        .key_sound_load_soundpack(&soundpack_dir)
        .map_err(CommandError::msg)
}

#[tauri::command]
pub fn key_sound_unload_soundpack(state: State<'_, AppState>) -> CmdResult<KeySoundStatus> {
    Ok(state.key_sound_unload_soundpack())
}

#[tauri::command]
pub fn key_sound_set_latency_logging(
    state: State<'_, AppState>,
    enabled: bool,
) -> CmdResult<KeySoundStatus> {
    if enabled && !state.key_sound_latency_logging_available() {
        return Err(CommandError::msg(
            "Latency measurement is only available in tauri dev/debug builds",
        ));
    }
    Ok(state.key_sound_set_latency_logging(enabled))
}

#[tauri::command]
pub fn key_sound_list_output_devices(
    state: State<'_, AppState>,
) -> CmdResult<KeySoundOutputDevices> {
    Ok(state.key_sound_list_output_devices())
}

#[tauri::command]
pub async fn key_sound_set_output_backend(
    app: AppHandle,
    backend: KeySoundOutputBackend,
) -> CmdResult<KeySoundOutputState> {
    run_mutation(app, move |_, state| {
        Ok(state.key_sound_set_output_backend(backend)?)
    })
    .await
}

#[tauri::command]
pub fn key_sound_get_output_state(state: State<'_, AppState>) -> CmdResult<KeySoundOutputState> {
    Ok(state.key_sound_get_output_state())
}
