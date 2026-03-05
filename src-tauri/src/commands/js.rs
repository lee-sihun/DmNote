use std::{fs, path::Path};

use log::info;
use rfd::FileDialog;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::{
    app_state::AppState,
    models::{CustomJs, JsPlugin},
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

fn emit_js_state(app: &AppHandle, script: &CustomJs) -> Result<(), String> {
    app.emit("js:content", script)
        .map_err(|err| err.to_string())
}

fn get_normalized_script(state: &State<AppState>) -> Result<CustomJs, String> {
    let mut script = state.store.snapshot().custom_js;
    if script.normalize() {
        state
            .store
            .update(|store| {
                store.custom_js = script.clone();
            })
            .map_err(|err| err.to_string())?;
    }
    Ok(script)
}

fn persist_script(state: &State<AppState>, script: &CustomJs) -> Result<CustomJs, String> {
    state
        .store
        .update(|store| {
            store.custom_js = script.clone();
        })
        .map(|data| data.custom_js.clone())
        .map_err(|err| err.to_string())
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn js_get(state: State<'_, AppState>) -> Result<CustomJs, String> {
    get_normalized_script(&state)
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn js_get_use(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.store.snapshot().use_custom_js)
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn js_toggle(
    state: State<'_, AppState>,
    app: AppHandle,
    enabled: bool,
) -> Result<JsToggleResponse, String> {
    state
        .store
        .update(|store| {
            store.use_custom_js = enabled;
        })
        .map_err(|err| err.to_string())?;

    app.emit("js:use", &JsToggleResponse { enabled })
        .map_err(|err| err.to_string())?;

    if enabled {
        let script = get_normalized_script(&state)?;
        emit_js_state(&app, &script)?;
    }

    Ok(JsToggleResponse { enabled })
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn js_reset(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    let default = CustomJs::default();

    state
        .store
        .update(|store| {
            store.use_custom_js = false;
            store.custom_js = default.clone();
        })
        .map_err(|err| err.to_string())?;

    app.emit("js:use", &JsToggleResponse { enabled: false })
        .map_err(|err| err.to_string())?;
    emit_js_state(&app, &default)?;
    Ok(())
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn js_set_content(
    state: State<'_, AppState>,
    app: AppHandle,
    content: String,
) -> Result<JsSetContentResponse, String> {
    let mut script = get_normalized_script(&state)?;
    if script.plugins.is_empty() {
        script.content = content.clone();
    } else if let Some(plugin) = script.plugins.iter_mut().find(|plugin| plugin.enabled) {
        plugin.content = content.clone();
    } else if let Some(plugin) = script.plugins.first_mut() {
        plugin.content = content.clone();
    }

    let _ = script.normalize();
    let updated = persist_script(&state, &script)?;
    emit_js_state(&app, &updated)?;

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

#[tauri::command(permission = "dmnote-allow-all")]
pub fn js_load(state: State<'_, AppState>, app: AppHandle) -> Result<JsLoadResponse, String> {
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

    let mut script = get_normalized_script(&state)?;
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

    script.plugins.extend(added.clone());
    script.path = None;
    script.content.clear();
    let _ = script.normalize();

    let updated = persist_script(&state, &script)?;
    emit_js_state(&app, &updated)?;

    Ok(JsLoadResponse {
        success: true,
        added,
        errors,
    })
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn js_reload(state: State<'_, AppState>, app: AppHandle) -> Result<JsReloadResponse, String> {
    let mut script = get_normalized_script(&state)?;
    let mut updated_plugins = Vec::new();
    let mut errors = Vec::new();

    for plugin in script.plugins.iter_mut() {
        let Some(ref path) = plugin.path else {
            continue;
        };
        match fs::read_to_string(path) {
            Ok(content) => {
                plugin.content = content.clone();
                updated_plugins.push(plugin.clone());
            }
            Err(err) => errors.push(JsPluginError::new(path.clone(), err.to_string())),
        }
    }

    let _ = script.normalize();
    let updated = persist_script(&state, &script)?;
    emit_js_state(&app, &updated)?;

    Ok(JsReloadResponse {
        updated: updated_plugins,
        errors,
    })
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn js_remove_plugin(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
) -> Result<JsRemoveResponse, String> {
    let mut script = get_normalized_script(&state)?;
    info!("js_remove_plugin: requested id={}", id);
    info!(
        "js_remove_plugin: existing ids={}",
        script
            .plugins
            .iter()
            .map(|p| p.id.as_str())
            .collect::<Vec<_>>()
            .join(",")
    );
    let initial_len = script.plugins.len();
    script.plugins.retain(|plugin| plugin.id != id);
    if script.plugins.len() == initial_len {
        info!("js_remove_plugin: id not found");
        return Ok(JsRemoveResponse {
            success: false,
            removed_id: None,
            error: Some("not-found".to_string()),
        });
    }

    let _ = script.normalize();
    let updated = persist_script(&state, &script)?;
    emit_js_state(&app, &updated)?;

    Ok(JsRemoveResponse {
        success: true,
        removed_id: Some(id),
        error: None,
    })
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn js_set_plugin_enabled(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
    enabled: bool,
) -> Result<JsPluginUpdateResponse, String> {
    let mut script = get_normalized_script(&state)?;
    info!(
        "js_set_plugin_enabled: id={} enabled={} (existing ids={})",
        id,
        enabled,
        script
            .plugins
            .iter()
            .map(|p| p.id.as_str())
            .collect::<Vec<_>>()
            .join(",")
    );
    let mut updated_plugin = None;

    for plugin in script.plugins.iter_mut() {
        if plugin.id == id {
            plugin.enabled = enabled;
            updated_plugin = Some(plugin.clone());
            break;
        }
    }

    if updated_plugin.is_none() {
        // 요청 id와 각 플러그인 path/name 로깅
        info!(
            "js_set_plugin_enabled: failed to match id={} among {} plugins (names={})",
            id,
            script.plugins.len(),
            script
                .plugins
                .iter()
                .map(|p| format!("{}:{}", p.id, p.name))
                .collect::<Vec<_>>()
                .join(" | ")
        );
    }

    let Some(plugin) = updated_plugin else {
        return Ok(JsPluginUpdateResponse {
            success: false,
            plugin: None,
            error: Some("not-found".to_string()),
        });
    };

    let _ = script.normalize();
    let updated = persist_script(&state, &script)?;
    emit_js_state(&app, &updated)?;

    Ok(JsPluginUpdateResponse {
        success: true,
        plugin: Some(plugin),
        error: None,
    })
}
