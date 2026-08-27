use std::{
    fs,
    path::{Path, PathBuf},
};

use log::info;
use serde::Serialize;
use tauri::{AppHandle, WebviewWindow};
use uuid::Uuid;

use crate::{
    commands::{
        dialog::parented_file_dialog, editor::state::emit_best_effort, issue_mutation_ticket,
        run_blocking, run_history_mutation,
    },
    errors::CmdResult,
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

fn get_normalized_script(state: &AppState) -> CmdResult<CustomJs> {
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
pub async fn js_get(app: AppHandle) -> CmdResult<CustomJs> {
    run_blocking(app, |_, state| get_normalized_script(state)).await
}

#[tauri::command]
pub async fn js_get_use(app: AppHandle) -> CmdResult<bool> {
    run_blocking(app, |_, state| Ok(state.store.snapshot().use_custom_js)).await
}

#[tauri::command]
pub async fn js_toggle(
    app: AppHandle,
    window: WebviewWindow,
    enabled: bool,
) -> CmdResult<JsToggleResponse> {
    run_history_mutation(
        app,
        window.label().to_string(),
        move |app, state, admission| {
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

            emit_history_status(app, &transaction);
            publish_event(app, "js:use", JsToggleResponse { enabled });

            if enabled {
                emit_js_state(app, &transaction.value, false)?;
            }

            Ok(JsToggleResponse { enabled })
        },
    )
    .await
}

#[tauri::command]
pub async fn js_reset(app: AppHandle, window: WebviewWindow) -> CmdResult<()> {
    let default = CustomJs::default();
    run_history_mutation(
        app,
        window.label().to_string(),
        move |app, state, admission| {
            let transaction =
                state
                    .store
                    .commit_history_overlap_mutation_with_admission(admission, |store| {
                        store.use_custom_js = false;
                        store.custom_js = default.clone();
                        Ok(store.custom_js.clone())
                    })?;

            emit_history_status(app, &transaction);
            publish_event(app, "js:use", JsToggleResponse { enabled: false });
            emit_js_state(app, &default, false)?;
            Ok(())
        },
    )
    .await
}

#[tauri::command]
pub async fn js_set_content(
    app: AppHandle,
    window: WebviewWindow,
    content: String,
) -> CmdResult<JsSetContentResponse> {
    run_history_mutation(
        app,
        window.label().to_string(),
        move |app, state, admission| {
            let transaction =
                state
                    .store
                    .commit_history_overlap_mutation_with_admission(admission, |store| {
                        let script = &mut store.custom_js;
                        let _ = script.normalize();
                        if script.plugins.is_empty() {
                            script.content = content.clone();
                        } else if let Some(plugin) =
                            script.plugins.iter_mut().find(|plugin| plugin.enabled)
                        {
                            plugin.content = content.clone();
                        } else if let Some(plugin) = script.plugins.first_mut() {
                            plugin.content = content.clone();
                        }
                        let _ = script.normalize();
                        Ok(script.clone())
                    })?;
            emit_history_status(app, &transaction);
            emit_js_state(app, &transaction.value, false)?;

            Ok(JsSetContentResponse {
                success: true,
                error: None,
            })
        },
    )
    .await
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
    let paths: Vec<PathBuf> = files
        .into_iter()
        .map(|file| file.path().to_path_buf())
        .collect();
    let window_label = window.label().to_string();
    run_blocking(app, move |app, state| {
        let mut added = Vec::new();
        let mut errors = Vec::new();
        for path in paths {
            match fs::read_to_string(&path) {
                Ok(content) => added.push(make_plugin_from_path(&path, content)),
                Err(err) => errors.push(JsPluginError::new(
                    path.to_string_lossy().to_string(),
                    err.to_string(),
                )),
            }
        }
        if added.is_empty() {
            return Ok(JsLoadResponse {
                success: false,
                added,
                errors,
            });
        }
        let ticket = issue_mutation_ticket(app)?;
        let admission = state.admit_frontend_history_mutation(&window_label)?;
        ticket.run(|| {
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
            emit_history_status(app, &transaction);
            emit_js_state(app, &transaction.value, false)?;

            Ok(JsLoadResponse {
                success: true,
                added,
                errors,
            })
        })
    })
    .await
}

#[tauri::command]
pub async fn js_reload(app: AppHandle, window: WebviewWindow) -> CmdResult<JsReloadResponse> {
    let window_label = window.label().to_string();
    // 파일 읽기는 번호표 발급 전에 - 번호표는 발급~drop 전체가 뒤 번호표의 대기 구간이라
    // prepare 단계의 I/O도 저장 큐를 막는다 (js_load와 같은 순서: I/O → 번호표 → admission → turn)
    run_blocking(app, move |app, state| {
        let script = get_normalized_script(state)?;
        let (loaded_plugins, errors) = read_plugin_sources(&script);
        let ticket = issue_mutation_ticket(app)?;
        let admission = state.admit_frontend_history_mutation(&window_label)?;
        ticket.run(|| {
            let transaction =
                state
                    .store
                    .commit_history_overlap_mutation_with_admission(admission, |store| {
                        let script = &mut store.custom_js;
                        let _ = script.normalize();
                        // 스냅샷과 turn 사이에 경로가 바뀐 플러그인은 건너뛴다
                        let updated_plugins = apply_reloaded_sources(script, &loaded_plugins);
                        let _ = script.normalize();
                        Ok((script.clone(), updated_plugins))
                    })?;
            emit_history_status(app, &transaction);
            // 디스크 재읽기는 내용이 같아도 재주입 필요 - forced 고정
            emit_js_state(app, &transaction.value.0, true)?;

            Ok(JsReloadResponse {
                updated: transaction.value.1.clone(),
                errors,
            })
        })
    })
    .await
}

type ReloadedSource = (String, String, String);

// 경로가 있는 플러그인의 파일을 읽는다 - 실패는 개별 오류로 모으고 나머지는 계속
fn read_plugin_sources(script: &CustomJs) -> (Vec<ReloadedSource>, Vec<JsPluginError>) {
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
    (loaded_plugins, errors)
}

// 읽은 내용을 id·경로가 아직 같은 플러그인에만 적용한다
fn apply_reloaded_sources(script: &mut CustomJs, loaded: &[ReloadedSource]) -> Vec<JsPlugin> {
    let mut updated_plugins = Vec::new();
    for (id, expected_path, content) in loaded {
        if let Some(plugin) = script
            .plugins
            .iter_mut()
            .find(|plugin| plugin.id == *id && plugin.path.as_ref() == Some(expected_path))
        {
            plugin.content.clone_from(content);
            updated_plugins.push(plugin.clone());
        }
    }
    updated_plugins
}

#[tauri::command]
pub async fn js_remove_plugin(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
) -> CmdResult<JsRemoveResponse> {
    run_history_mutation(
        app,
        window.label().to_string(),
        move |app, state, admission| {
            info!("js_remove_plugin: requested id={}", id);
            let current = get_normalized_script(state)?;
            info!(
                "js_remove_plugin: existing ids={}",
                current
                    .plugins
                    .iter()
                    .map(|p| p.id.as_str())
                    .collect::<Vec<_>>()
                    .join(",")
            );
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
            emit_history_status(app, &transaction);
            if !transaction.value.1 {
                info!("js_remove_plugin: id not found");
                return Ok(JsRemoveResponse {
                    success: false,
                    removed_id: None,
                    error: Some("not-found".to_string()),
                });
            }

            emit_js_state(app, &transaction.value.0, false)?;

            Ok(JsRemoveResponse {
                success: true,
                removed_id: Some(id),
                error: None,
            })
        },
    )
    .await
}

#[tauri::command]
pub async fn js_set_plugin_enabled(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
    enabled: bool,
) -> CmdResult<JsPluginUpdateResponse> {
    run_history_mutation(
        app,
        window.label().to_string(),
        move |app, state, admission| {
            let current = get_normalized_script(state)?;
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

            emit_history_status(app, &transaction);
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

            emit_js_state(app, &transaction.value.0, false)?;

            Ok(JsPluginUpdateResponse {
                success: true,
                plugin: Some(plugin),
                error: None,
            })
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    // js_reload의 forced=true 방출이 전제하는 js:content payload 계약 고정
    #[test]
    fn reloaded_sources_apply_only_to_plugins_whose_path_is_unchanged() {
        let mut script = CustomJs {
            plugins: vec![
                JsPlugin {
                    id: "same".to_string(),
                    name: "same.js".to_string(),
                    path: Some("/a/same.js".to_string()),
                    content: "old".to_string(),
                    enabled: true,
                },
                JsPlugin {
                    id: "moved".to_string(),
                    name: "moved.js".to_string(),
                    path: Some("/b/moved.js".to_string()),
                    content: "old".to_string(),
                    enabled: true,
                },
            ],
            ..CustomJs::default()
        };
        let updated = super::apply_reloaded_sources(
            &mut script,
            &[
                (
                    "same".to_string(),
                    "/a/same.js".to_string(),
                    "new".to_string(),
                ),
                (
                    "moved".to_string(),
                    "/old/moved.js".to_string(),
                    "new".to_string(),
                ),
            ],
        );
        assert_eq!(
            updated.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(),
            vec!["same"]
        );
        assert_eq!(script.plugins[0].content, "new");
        assert_eq!(script.plugins[1].content, "old");
    }

    #[test]
    fn read_plugin_sources_collects_read_errors_and_skips_pathless_plugins() {
        let script = CustomJs {
            plugins: vec![
                JsPlugin {
                    id: "inline".to_string(),
                    name: "inline.js".to_string(),
                    path: None,
                    content: "void 0;".to_string(),
                    enabled: true,
                },
                JsPlugin {
                    id: "missing".to_string(),
                    name: "missing.js".to_string(),
                    path: Some("/definitely/missing/plugin.js".to_string()),
                    content: String::new(),
                    enabled: true,
                },
            ],
            ..CustomJs::default()
        };
        let (loaded, errors) = super::read_plugin_sources(&script);
        assert!(loaded.is_empty());
        assert_eq!(errors.len(), 1);
    }

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
