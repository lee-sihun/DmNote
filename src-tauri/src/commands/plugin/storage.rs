use serde_json::Value;
use tauri::{AppHandle, State, WebviewWindow};

use crate::{
    commands::{
        editor::state::emit_best_effort,
        plugin::instances::{publish_plugin_instances_changed, PluginInstancesEventEmitter},
    },
    errors::CmdResult,
    models::PluginInstancesChangedPayload,
    state::{plugin::PLUGIN_DATA_KEY_PREFIX, store::PluginInstancesStorageChange, AppState},
};

/// 플러그인 스토리지 키 생성 (네임스페이스 자동 적용)
fn make_storage_key(key: &str) -> String {
    format!("{PLUGIN_DATA_KEY_PREFIX}{key}")
}

fn publish_plugin_instances_deletions(
    emitter: &dyn PluginInstancesEventEmitter,
    changes: &[PluginInstancesStorageChange],
) {
    for change in changes {
        publish_plugin_instances_changed(
            emitter,
            &PluginInstancesChangedPayload {
                plugin_id: change.plugin_id.clone(),
                revision: change.revision,
                origin_mutation_id: None,
            },
        );
    }
}

/// 플러그인 데이터 조회
#[tauri::command]
pub fn plugin_storage_get(state: State<'_, AppState>, key: String) -> CmdResult<Option<Value>> {
    let storage_key = make_storage_key(&key);
    Ok(state.store.get_plugin_data(&storage_key)?)
}

/// 플러그인 데이터 저장
#[tauri::command]
pub fn plugin_storage_set(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    key: String,
    value: Value,
) -> CmdResult<()> {
    let storage_key = make_storage_key(&key);
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let mutation = state
        .store
        .set_plugin_data_with_admission(&storage_key, value, admission)?;
    if let Some(status) = mutation.history_status.as_ref() {
        emit_best_effort(&app, "history:status", status);
    }
    Ok(())
}

/// 플러그인 데이터 삭제
#[tauri::command]
pub fn plugin_storage_remove(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    key: String,
) -> CmdResult<()> {
    let storage_key = make_storage_key(&key);
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let mutation = state
        .store
        .remove_plugin_data_with_admission(&storage_key, admission)?;
    if let Some(status) = mutation.history_status.as_ref() {
        emit_best_effort(&app, "history:status", status);
    }
    Ok(())
}

/// 모든 플러그인 데이터 삭제
#[tauri::command]
pub fn plugin_storage_clear(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
) -> CmdResult<()> {
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let mutation = state
        .store
        .clear_all_plugin_data_with_admission(admission)?;
    publish_plugin_instances_deletions(&app, &mutation.plugin_instances_changes);
    if let Some(status) = mutation.history_status.as_ref() {
        emit_best_effort(&app, "history:status", status);
    }
    Ok(())
}

/// 플러그인 데이터 키 목록 조회
#[tauri::command]
pub fn plugin_storage_keys(state: State<'_, AppState>) -> CmdResult<Vec<String>> {
    let all_keys = state.store.get_all_plugin_keys()?;

    // 네임스페이스 프리픽스 제거하여 반환
    let user_keys: Vec<String> = all_keys
        .into_iter()
        .filter(|k| k.starts_with(PLUGIN_DATA_KEY_PREFIX))
        .map(|k| {
            k.strip_prefix(PLUGIN_DATA_KEY_PREFIX)
                .unwrap_or(&k)
                .to_string()
        })
        .collect();

    Ok(user_keys)
}

/// 특정 접두사로 시작하는 플러그인 데이터가 있는지 확인
#[tauri::command]
pub fn plugin_storage_has_data(state: State<'_, AppState>, prefix: String) -> CmdResult<bool> {
    let all_keys = state.store.get_all_plugin_keys()?;

    let storage_prefix = make_storage_key(&prefix);
    let has_data = all_keys.iter().any(|k| k.starts_with(&storage_prefix));

    Ok(has_data)
}

/// 특정 접두사로 시작하는 모든 플러그인 데이터 삭제
#[tauri::command]
pub fn plugin_storage_clear_by_prefix(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    prefix: String,
) -> CmdResult<usize> {
    let storage_prefix = make_storage_key(&prefix);
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let mutation = state
        .store
        .remove_plugin_data_by_prefix_with_admission(&storage_prefix, admission)?;
    publish_plugin_instances_deletions(&app, &mutation.plugin_instances_changes);
    if let Some(status) = mutation.history_status.as_ref() {
        emit_best_effort(&app, "history:status", status);
    }
    Ok(mutation.value)
}

#[cfg(test)]
mod tests {
    use parking_lot::Mutex;

    use super::*;

    #[derive(Default)]
    struct TestEmitter {
        events: Mutex<Vec<PluginInstancesChangedPayload>>,
    }

    impl PluginInstancesEventEmitter for TestEmitter {
        fn main_available(&self) -> bool {
            true
        }

        fn emit_plugin_instances_changed(
            &self,
            payload: &PluginInstancesChangedPayload,
        ) -> Result<(), String> {
            self.events.lock().push(payload.clone());
            Ok(())
        }
    }

    // 저장 키 네임스페이스 wire 바이트 고정
    #[test]
    fn storage_key_namespace_wire_bytes_are_stable() {
        assert_eq!(
            make_storage_key("demo/settings"),
            "plugin_data_demo/settings"
        );
    }

    #[test]
    fn bulk_deletion_publishes_each_plugin_revision_without_origin() {
        let emitter = TestEmitter::default();
        let changes = vec![
            PluginInstancesStorageChange {
                plugin_id: "alpha".to_string(),
                revision: 7,
            },
            PluginInstancesStorageChange {
                plugin_id: "beta".to_string(),
                revision: 7,
            },
        ];

        publish_plugin_instances_deletions(&emitter, &changes);

        assert_eq!(
            *emitter.events.lock(),
            vec![
                PluginInstancesChangedPayload {
                    plugin_id: "alpha".to_string(),
                    revision: 7,
                    origin_mutation_id: None,
                },
                PluginInstancesChangedPayload {
                    plugin_id: "beta".to_string(),
                    revision: 7,
                    origin_mutation_id: None,
                },
            ]
        );
    }
}
