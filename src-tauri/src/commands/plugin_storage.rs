use serde_json::Value;
use tauri::State;

use crate::app_state::AppState;

/// 플러그인 스토리지 키 생성 (네임스페이스 자동 적용)
fn make_storage_key(key: &str) -> String {
    format!("plugin_data_{}", key)
}

/// 플러그인 데이터 조회
#[tauri::command]
pub async fn plugin_storage_get(
    state: State<'_, AppState>,
    key: String,
) -> Result<Option<Value>, String> {
    let storage_key = make_storage_key(&key);
    state
        .store
        .get_plugin_data(&storage_key)
        .map_err(|e| e.to_string())
}

/// 플러그인 데이터 저장
#[tauri::command]
pub async fn plugin_storage_set(
    state: State<'_, AppState>,
    key: String,
    value: Value,
) -> Result<(), String> {
    let storage_key = make_storage_key(&key);
    state
        .store
        .set_plugin_data(&storage_key, value)
        .map_err(|e| e.to_string())
}

/// 플러그인 데이터 삭제
#[tauri::command]
pub async fn plugin_storage_remove(state: State<'_, AppState>, key: String) -> Result<(), String> {
    let storage_key = make_storage_key(&key);
    state
        .store
        .remove_plugin_data(&storage_key)
        .map_err(|e| e.to_string())
}

/// 모든 플러그인 데이터 삭제
#[tauri::command]
pub async fn plugin_storage_clear(state: State<'_, AppState>) -> Result<(), String> {
    state
        .store
        .clear_all_plugin_data()
        .map_err(|e| e.to_string())
}

/// 플러그인 데이터 키 목록 조회
#[tauri::command]
pub async fn plugin_storage_keys(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let all_keys = state
        .store
        .get_all_plugin_keys()
        .map_err(|e| e.to_string())?;

    // "plugin_data_" 프리픽스 제거하여 반환
    let prefix = "plugin_data_";
    let user_keys: Vec<String> = all_keys
        .into_iter()
        .filter(|k| k.starts_with(prefix))
        .map(|k| k.strip_prefix(prefix).unwrap_or(&k).to_string())
        .collect();

    Ok(user_keys)
}

/// 특정 접두사로 시작하는 플러그인 데이터가 있는지 확인
#[tauri::command]
pub async fn plugin_storage_has_data(
    state: State<'_, AppState>,
    prefix: String,
) -> Result<bool, String> {
    let all_keys = state
        .store
        .get_all_plugin_keys()
        .map_err(|e| e.to_string())?;

    let storage_prefix = format!("plugin_data_{}", prefix);
    let has_data = all_keys.iter().any(|k| k.starts_with(&storage_prefix));

    Ok(has_data)
}

/// 특정 접두사로 시작하는 모든 플러그인 데이터 삭제
#[tauri::command]
pub async fn plugin_storage_clear_by_prefix(
    state: State<'_, AppState>,
    prefix: String,
) -> Result<usize, String> {
    let all_keys = state
        .store
        .get_all_plugin_keys()
        .map_err(|e| e.to_string())?;

    let storage_prefix = format!("plugin_data_{}", prefix);
    let keys_to_remove: Vec<String> = all_keys
        .into_iter()
        .filter(|k| k.starts_with(&storage_prefix))
        .collect();

    let count = keys_to_remove.len();
    for key in keys_to_remove {
        state
            .store
            .remove_plugin_data(&key)
            .map_err(|e| e.to_string())?;
    }

    Ok(count)
}
