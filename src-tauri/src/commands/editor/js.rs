use std::{
    fs,
    path::{Path, PathBuf},
};

use log::info;
use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use uuid::Uuid;

use crate::{
    commands::{dialog::parented_file_dialog, editor::state::emit_best_effort},
    errors::{CmdResult, CommandError},
    models::{CustomJs, JsPlugin},
    services::event_publisher::publish_event,
    state::{store::AdmittedHistoryOverlapMutation, AppState},
};

#[derive(Serialize)]
pub struct JsToggleResponse {
    pub enabled: bool,
}

#[derive(Serialize)]
pub struct JsSetContentResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct JsPluginError {
    pub path: String,
    pub error: String,
}

impl JsPluginError {
    fn new(path: String, error: impl Into<String>) -> Self {
        Self {
            path,
            error: error.into(),
        }
    }
}

#[derive(Serialize)]
pub struct JsLoadResponse {
    pub success: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub added: Vec<JsPlugin>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub errors: Vec<JsPluginError>,
}

#[derive(Serialize)]
pub struct JsReloadResponse {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub updated: Vec<JsPlugin>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub errors: Vec<JsPluginError>,
}

#[derive(Serialize)]
pub struct JsRemoveResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub removed_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct JsPluginUpdateResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin: Option<JsPlugin>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// forced: 내용이 같아도 재주입이 필요한 명시 리로드 표시
#[derive(Serialize, Clone)]
struct JsStatePayload<'a> {
    #[serde(flatten)]
    script: &'a CustomJs,
    forced: bool,
}

fn emit_js_state(app: &AppHandle, script: &CustomJs, forced: bool) -> CmdResult<()> {
    publish_event(app, "js:content", JsStatePayload { script, forced });
    Ok(())
}

fn get_normalized_script(state: &State<AppState>) -> CmdResult<CustomJs> {
    let mut script = state.store.snapshot().custom_js;
    let _ = script.normalize();
    Ok(script)
}

fn emit_history_status<T>(app: &AppHandle, transaction: &AdmittedHistoryOverlapMutation<T>) {
    if let Some(status) = transaction.history_status.as_ref() {
        emit_best_effort(app, "history:status", status);
    }
}

#[tauri::command]
pub fn js_get(state: State<'_, AppState>) -> CmdResult<CustomJs> {
    get_normalized_script(&state)
}

#[tauri::command]
pub fn js_get_use(state: State<'_, AppState>) -> CmdResult<bool> {
    Ok(state.store.snapshot().use_custom_js)
}

#[tauri::command]
pub fn js_toggle(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    enabled: bool,
) -> CmdResult<JsToggleResponse> {
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction =
        state
            .store
            .commit_history_overlap_mutation_with_admission(admission, |store| {
                store.use_custom_js = enabled;
                if enabled {
                    let _ = store.custom_js.normalize();
                }
                Ok(store.custom_js.clone())
            })?;

    emit_history_status(&app, &transaction);
    publish_event(&app, "js:use", JsToggleResponse { enabled });

    if enabled {
        emit_js_state(&app, &transaction.value, false)?;
    }

    Ok(JsToggleResponse { enabled })
}

#[tauri::command]
pub fn js_reset(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
) -> CmdResult<()> {
    let default = CustomJs::default();

    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction =
        state
            .store
            .commit_history_overlap_mutation_with_admission(admission, |store| {
                store.use_custom_js = false;
                store.custom_js = default.clone();
                Ok(store.custom_js.clone())
            })?;

    emit_history_status(&app, &transaction);
    publish_event(&app, "js:use", JsToggleResponse { enabled: false });
    emit_js_state(&app, &default, false)?;
    Ok(())
}

#[tauri::command]
pub fn js_set_content(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    content: String,
) -> CmdResult<JsSetContentResponse> {
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction =
        state
            .store
            .commit_history_overlap_mutation_with_admission(admission, |store| {
                let script = &mut store.custom_js;
                let _ = script.normalize();
                if script.plugins.is_empty() {
                    script.content = content.clone();
                } else if let Some(plugin) = script.plugins.iter_mut().find(|plugin| plugin.enabled)
                {
                    plugin.content = content.clone();
                } else if let Some(plugin) = script.plugins.first_mut() {
                    plugin.content = content.clone();
                }
                let _ = script.normalize();
                Ok(script.clone())
            })?;
    emit_history_status(&app, &transaction);
    emit_js_state(&app, &transaction.value, false)?;

    Ok(JsSetContentResponse {
        success: true,
        error: None,
    })
}

fn make_plugin_from_path(path: &Path, content: String) -> JsPlugin {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.to_string())
        .unwrap_or_else(|| "plugin.js".to_string());

    JsPlugin {
        id: Uuid::new_v4().to_string(),
        name,
        path: Some(path.to_string_lossy().to_string()),
        content,
        enabled: true,
    }
}

#[tauri::command]
pub async fn js_load(app: AppHandle, window: WebviewWindow) -> CmdResult<JsLoadResponse> {
    let picked = parented_file_dialog(&window, "JavaScript", &["js", "mjs"])
        .pick_files()
        .await;

    let Some(files) = picked else {
        return Ok(JsLoadResponse {
            success: false,
            added: Vec::new(),
            errors: Vec::new(),
        });
    };
    let paths = files
        .into_iter()
        .map(|file| file.path().to_path_buf())
        .collect();
    tauri::async_runtime::spawn_blocking(move || js_load_from_paths(app, window, paths))
        .await
        .map_err(|error| CommandError::msg(format!("JavaScript load task failed: {error}")))?
}

fn js_load_from_paths(
    app: AppHandle,
    window: WebviewWindow,
    paths: Vec<PathBuf>,
) -> CmdResult<JsLoadResponse> {
    let state = app.state::<AppState>();

    let mut added = Vec::new();
    let mut errors = Vec::new();

    for path in paths {
        match fs::read_to_string(&path) {
            Ok(content) => {
                added.push(make_plugin_from_path(&path, content));
            }
            Err(err) => {
                errors.push(JsPluginError::new(
                    path.to_string_lossy().to_string(),
                    err.to_string(),
                ));
            }
        }
    }

    if added.is_empty() {
        return Ok(JsLoadResponse {
            success: false,
            added,
            errors,
        });
    }

    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction =
        state
            .store
            .commit_history_overlap_mutation_with_admission(admission, |store| {
                let script = &mut store.custom_js;
                let _ = script.normalize();
                script.plugins.extend(added.clone());
                script.path = None;
                script.content.clear();
                let _ = script.normalize();
                Ok(script.clone())
            })?;
    emit_history_status(&app, &transaction);
    emit_js_state(&app, &transaction.value, false)?;

    Ok(JsLoadResponse {
        success: true,
        added,
        errors,
    })
}

#[tauri::command]
pub fn js_reload(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
) -> CmdResult<JsReloadResponse> {
    let script = get_normalized_script(&state)?;
    let mut loaded_plugins = Vec::new();
    let mut errors = Vec::new();

    for plugin in &script.plugins {
        let Some(ref path) = plugin.path else {
            continue;
        };
        match fs::read_to_string(path) {
            Ok(content) => loaded_plugins.push((plugin.id.clone(), path.clone(), content)),
            Err(err) => errors.push(JsPluginError::new(path.clone(), err.to_string())),
        }
    }

    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction =
        state
            .store
            .commit_history_overlap_mutation_with_admission(admission, |store| {
                let script = &mut store.custom_js;
                let _ = script.normalize();
                let mut updated_plugins = Vec::new();
                for (id, expected_path, content) in &loaded_plugins {
                    if let Some(plugin) = script.plugins.iter_mut().find(|plugin| {
                        plugin.id == *id && plugin.path.as_ref() == Some(expected_path)
                    }) {
                        plugin.content.clone_from(content);
                        updated_plugins.push(plugin.clone());
                    }
                }
                let _ = script.normalize();
                Ok((script.clone(), updated_plugins))
            })?;
    emit_history_status(&app, &transaction);
    // 디스크 재읽기는 내용이 같아도 재주입 필요 - forced 고정
    emit_js_state(&app, &transaction.value.0, true)?;

    Ok(JsReloadResponse {
        updated: transaction.value.1.clone(),
        errors,
    })
}

#[tauri::command]
pub fn js_remove_plugin(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    id: String,
) -> CmdResult<JsRemoveResponse> {
    info!("js_remove_plugin: requested id={}", id);
    let current = get_normalized_script(&state)?;
    info!(
        "js_remove_plugin: existing ids={}",
        current
            .plugins
            .iter()
            .map(|p| p.id.as_str())
            .collect::<Vec<_>>()
            .join(",")
    );
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction =
        state
            .store
            .commit_history_overlap_mutation_with_admission(admission, |store| {
                let script = &mut store.custom_js;
                let _ = script.normalize();
                let initial_len = script.plugins.len();
                script.plugins.retain(|plugin| plugin.id != id);
                let removed = script.plugins.len() != initial_len;
                let _ = script.normalize();
                Ok((script.clone(), removed))
            })?;
    emit_history_status(&app, &transaction);
    if !transaction.value.1 {
        info!("js_remove_plugin: id not found");
        return Ok(JsRemoveResponse {
            success: false,
            removed_id: None,
            error: Some("not-found".to_string()),
        });
    }

    emit_js_state(&app, &transaction.value.0, false)?;

    Ok(JsRemoveResponse {
        success: true,
        removed_id: Some(id),
        error: None,
    })
}

#[tauri::command]
pub fn js_set_plugin_enabled(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    id: String,
    enabled: bool,
) -> CmdResult<JsPluginUpdateResponse> {
    let current = get_normalized_script(&state)?;
    info!(
        "js_set_plugin_enabled: id={} enabled={} (existing ids={})",
        id,
        enabled,
        current
            .plugins
            .iter()
            .map(|p| p.id.as_str())
            .collect::<Vec<_>>()
            .join(",")
    );
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction =
        state
            .store
            .commit_history_overlap_mutation_with_admission(admission, |store| {
                let script = &mut store.custom_js;
                let _ = script.normalize();
                let updated_plugin = script.plugins.iter_mut().find_map(|plugin| {
                    (plugin.id == id).then(|| {
                        plugin.enabled = enabled;
                        plugin.clone()
                    })
                });
                let _ = script.normalize();
                Ok((script.clone(), updated_plugin))
            })?;

    emit_history_status(&app, &transaction);
    if transaction.value.1.is_none() {
        // 요청 id와 각 플러그인 path/name 로깅
        info!(
            "js_set_plugin_enabled: failed to match id={} among {} plugins (names={})",
            id,
            current.plugins.len(),
            current
                .plugins
                .iter()
                .map(|p| format!("{}:{}", p.id, p.name))
                .collect::<Vec<_>>()
                .join(" | ")
        );
    }

    let Some(plugin) = transaction.value.1.clone() else {
        return Ok(JsPluginUpdateResponse {
            success: false,
            plugin: None,
            error: Some("not-found".to_string()),
        });
    };

    emit_js_state(&app, &transaction.value.0, false)?;

    Ok(JsPluginUpdateResponse {
        success: true,
        plugin: Some(plugin),
        error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // js_reload의 forced=true 방출이 전제하는 js:content payload 계약 고정
    #[test]
    fn js_state_payload_flattens_script_and_carries_forced_flag() {
        let script = CustomJs {
            path: None,
            content: "console.log('reload')".to_string(),
            plugins: Vec::new(),
        };

        let reload = serde_json::to_value(JsStatePayload {
            script: &script,
            forced: true,
        })
        .unwrap();
        assert_eq!(reload["forced"], true);
        assert_eq!(reload["content"], "console.log('reload')");

        let broadcast = serde_json::to_value(JsStatePayload {
            script: &script,
            forced: false,
        })
        .unwrap();
        assert_eq!(broadcast["forced"], false);
    }
}
