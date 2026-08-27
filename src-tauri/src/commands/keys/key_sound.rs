use tauri::{AppHandle, State};

use crate::{
    audio::{KeySoundOutputBackend, KeySoundOutputDevices, KeySoundOutputState, KeySoundStatus},
    commands::run_blocking,
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

// 장치 열거는 엔드포인트마다 드라이버 질의를 하므로 IPC(메인) 스레드 밖에서
#[tauri::command]
pub async fn key_sound_list_output_devices(app: AppHandle) -> CmdResult<KeySoundOutputDevices> {
    run_blocking(app, |_, state| Ok(state.key_sound_list_output_devices())).await
}

// 장치 전환 대기는 번호표 밖, persist만 번호표 turn 안 (AppState가 순서를 소유)
#[tauri::command]
pub async fn key_sound_set_output_backend(
    app: AppHandle,
    backend: KeySoundOutputBackend,
) -> CmdResult<KeySoundOutputState> {
    run_blocking(app, move |_, state| {
        Ok(state.key_sound_set_output_backend(backend)?)
    })
    .await
}

#[tauri::command]
pub fn key_sound_get_output_state(state: State<'_, AppState>) -> CmdResult<KeySoundOutputState> {
    Ok(state.key_sound_get_output_state())
}
