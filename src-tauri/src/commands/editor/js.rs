use std::{fs, path::Path};

use log::info;
use rfd::FileDialog;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::{
    commands::editor::state::emit_best_effort,
    errors::CmdResult,
    models::{CustomJs, JsPlugin},
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

fn emit_js_state(app: &AppHandle, script: &CustomJs) -> CmdResult<()> {
    app.emit("js:content", script)?;
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
    enabled: bool,
) -> CmdResult<JsToggleResponse> {
    let transaction = state.store.commit_history_overlap_mutation(|store| {
        store.use_custom_js = enabled;
        if enabled {
            let _ = store.custom_js.normalize();
        }
        Ok(store.custom_js.clone())
    })?;

    emit_history_status(&app, &transaction);
    app.emit("js:use", &JsToggleResponse { enabled })?;

    if enabled {
        emit_js_state(&app, &transaction.value)?;
    }

    Ok(JsToggleResponse { enabled })
}

#[tauri::command]
pub fn js_reset(state: State<'_, AppState>, app: AppHandle) -> CmdResult<()> {
    let default = CustomJs::default();

    let transaction = state.store.commit_history_overlap_mutation(|store| {
        store.use_custom_js = false;
        store.custom_js = default.clone();
        Ok(store.custom_js.clone())
    })?;

    emit_history_status(&app, &transaction);
    app.emit("js:use", &JsToggleResponse { enabled: false })?;
    emit_js_state(&app, &default)?;
    Ok(())
}

#[tauri::command]
pub fn js_set_content(
    state: State<'_, AppState>,
    app: AppHandle,
    content: String,
) -> CmdResult<JsSetContentResponse> {
    let transaction = state.store.commit_history_overlap_mutation(|store| {
        let script = &mut store.custom_js;
        let _ = script.normalize();
        if script.plugins.is_empty() {
            script.content = content.clone();
        } else if let Some(plugin) = script.plugins.iter_mut().find(|plugin| plugin.enabled) {
            plugin.content = content.clone();
        } else if let Some(plugin) = script.plugins.first_mut() {
            plugin.content = content.clone();
        }
        let _ = script.normalize();
        Ok(script.clone())
    })?;
    emit_history_status(&app, &transaction);
    emit_js_state(&app, &transaction.value)?;

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
pub fn js_load(state: State<'_, AppState>, app: AppHandle) -> CmdResult<JsLoadResponse> {
    let Some(paths) = FileDialog::new()
        .add_filter("JavaScript", &["js", "mjs"])
        .pick_files()
    else {
        return Ok(JsLoadResponse {
            success: false,
            added: Vec::new(),
            errors: Vec::new(),
        });
    };

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

    let transaction = state.store.commit_history_overlap_mutation(|store| {
        let script = &mut store.custom_js;
        let _ = script.normalize();
        script.plugins.extend(added.clone());
        script.path = None;
        script.content.clear();
        let _ = script.normalize();
        Ok(script.clone())
    })?;
    emit_history_status(&app, &transaction);
    emit_js_state(&app, &transaction.value)?;

    Ok(JsLoadResponse {
        success: true,
        added,
        errors,
    })
}

#[tauri::command]
pub fn js_reload(state: State<'_, AppState>, app: AppHandle) -> CmdResult<JsReloadResponse> {
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

    let transaction = state.store.commit_history_overlap_mutation(|store| {
        let script = &mut store.custom_js;
        let _ = script.normalize();
        let mut updated_plugins = Vec::new();
        for (id, expected_path, content) in &loaded_plugins {
            if let Some(plugin) = script
                .plugins
                .iter_mut()
                .find(|plugin| plugin.id == *id && plugin.path.as_ref() == Some(expected_path))
            {
                plugin.content.clone_from(content);
                updated_plugins.push(plugin.clone());
            }
        }
        let _ = script.normalize();
        Ok((script.clone(), updated_plugins))
    })?;
    emit_history_status(&app, &transaction);
    emit_js_state(&app, &transaction.value.0)?;

    Ok(JsReloadResponse {
        updated: transaction.value.1.clone(),
        errors,
    })
}

#[tauri::command]
pub fn js_remove_plugin(
    state: State<'_, AppState>,
    app: AppHandle,
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
    let transaction = state.store.commit_history_overlap_mutation(|store| {
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

    emit_js_state(&app, &transaction.value.0)?;

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
    let transaction = state.store.commit_history_overlap_mutation(|store| {
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

    emit_js_state(&app, &transaction.value.0)?;

    Ok(JsPluginUpdateResponse {
        success: true,
        plugin: Some(plugin),
        error: None,
    })
}
