use tauri::State;

use crate::{audio::KeySoundStatus, state::AppState};

#[tauri::command]
pub fn key_sound_get_status(state: State<'_, AppState>) -> Result<KeySoundStatus, String> {
    Ok(state.key_sound_status())
}

#[tauri::command]
pub fn key_sound_set_enabled(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<KeySoundStatus, String> {
    Ok(state.key_sound_set_enabled(enabled))
}

#[tauri::command]
pub fn key_sound_set_volume(
    state: State<'_, AppState>,
    volume: f32,
) -> Result<KeySoundStatus, String> {
    Ok(state.key_sound_set_volume(volume))
}

#[tauri::command]
pub fn key_sound_load_soundpack(
    state: State<'_, AppState>,
    soundpack_dir: String,
) -> Result<KeySoundStatus, String> {
    state.key_sound_load_soundpack(&soundpack_dir)
}

#[tauri::command]
pub fn key_sound_unload_soundpack(state: State<'_, AppState>) -> Result<KeySoundStatus, String> {
    Ok(state.key_sound_unload_soundpack())
}

#[tauri::command]
pub fn key_sound_set_latency_logging(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<KeySoundStatus, String> {
    if enabled && !state.key_sound_latency_logging_available() {
        return Err("Latency measurement is only available in tauri dev/debug builds".to_string());
    }
    Ok(state.key_sound_set_latency_logging(enabled))
}
