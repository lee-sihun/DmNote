use std::{
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use reqwest::blocking::Client;
use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tokio::sync::Semaphore;

use crate::{
    commands::{dialog::parented_file_dialog, editor::state::emit_best_effort},
    custom_css::{
        custom_css_settings_diff, history_paths_match, inspect_css_history_status,
        normalize_custom_css_history, record_custom_css_load, touch_custom_css_history,
        validate_css_path, CssHistoryErrorCode, CssPathError, CustomCssHistoryStatus,
        ValidatedCssFile, MAX_CUSTOM_CSS_BYTES,
    },
    defaults::default_keys,
    errors::{CmdResult, CommandError},
    models::{AppStoreData, CustomCss, CustomCssHistoryEntry, TabCss, TabCssOverrides},
    state::{
        atomic_file::atomic_replace, history::HistoryAdmissionLease,
        store::AdmittedHistoryOverlapMutation, AppState,
    },
};

const CSS_IMPORT_FETCH_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_CONCURRENT_CSS_IMPORT_FETCHES: usize = 4;
const MAX_CSS_IMPORT_BYTES: usize = 1024 * 1024;
const MAX_CSS_IMPORT_REDIRECTS: usize = 3;
static CSS_IMPORT_CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();
static CSS_IMPORT_FETCH_LIMIT: OnceLock<Arc<Semaphore>> = OnceLock::new();

/// OBS 브릿지에 CSS 설정 변경을 settings_diff로 전달 (전체 스냅샷 브로드캐스트 방지)
fn notify_obs_css(state: &AppState) {
    let snap = state.store.snapshot();
    state.notify_obs_settings_diff(custom_css_settings_diff(&snap));
}

fn emit_history_status<T>(app: &AppHandle, transaction: &AdmittedHistoryOverlapMutation<T>) {
    if let Some(status) = transaction.history_status.as_ref() {
        emit_best_effort(app, "history:status", status);
    }
}

#[derive(Serialize)]
pub struct CssToggleResponse {
    pub enabled: bool,
}

#[derive(Serialize)]
pub struct CssSetContentResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct CssLoadResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CssImportFetchResult {
    pub final_url: String,
    pub text: String,
}

fn is_cloud_metadata_url(url: &url::Url) -> bool {
    match url.host() {
        Some(url::Host::Domain(host)) => matches!(
            host.trim_end_matches('.').to_ascii_lowercase().as_str(),
            "metadata.google.internal" | "metadata.azure.internal"
        ),
        Some(url::Host::Ipv4(ip)) => matches!(
            ip.octets(),
            [169, 254, 169, 254] | [169, 254, 170, 2] | [100, 100, 100, 200] | [192, 0, 0, 192]
        ),
        Some(url::Host::Ipv6(ip)) => ip.to_string() == "fd00:ec2::254",
        None => false,
    }
}

fn validate_css_import_url(raw: &str) -> CmdResult<url::Url> {
    let url = url::Url::parse(raw)
        .map_err(|error| CommandError::msg(format!("invalid CSS import URL: {error}")))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(CommandError::msg(format!(
            "unsupported CSS import URL scheme '{}': only http and https are allowed",
            url.scheme()
        )));
    }
    if is_cloud_metadata_url(&url) {
        return Err(CommandError::msg(
            "CSS import access to cloud metadata endpoints is blocked",
        ));
    }
    Ok(url)
}

fn read_css_import_body(reader: impl Read) -> CmdResult<Vec<u8>> {
    let mut bytes = Vec::new();
    reader
        .take((MAX_CSS_IMPORT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            CommandError::msg(format!("failed to read CSS import response: {error}"))
        })?;
    if bytes.len() > MAX_CSS_IMPORT_BYTES {
        return Err(CommandError::msg(format!(
            "CSS import response exceeds {MAX_CSS_IMPORT_BYTES} bytes"
        )));
    }
    Ok(bytes)
}

fn ensure_css_import_window(window_label: &str) -> CmdResult<()> {
    if window_label != super::MAIN_WINDOW_LABEL {
        return Err(CommandError::msg(
            "CSS import fetch is only available in the main window",
        ));
    }
    Ok(())
}

fn css_import_fetch_limit() -> &'static Arc<Semaphore> {
    CSS_IMPORT_FETCH_LIMIT
        .get_or_init(|| Arc::new(Semaphore::new(MAX_CONCURRENT_CSS_IMPORT_FETCHES)))
}

fn css_import_client() -> CmdResult<&'static Client> {
    CSS_IMPORT_CLIENT
        .get_or_init(|| {
            Client::builder()
                .timeout(CSS_IMPORT_FETCH_TIMEOUT)
                .redirect(reqwest::redirect::Policy::custom(|attempt| {
                    if attempt.previous().len() > MAX_CSS_IMPORT_REDIRECTS {
                        attempt.error("CSS import exceeded redirect limit")
                    } else if is_cloud_metadata_url(attempt.url()) {
                        attempt.error("CSS import access to cloud metadata endpoints is blocked")
                    } else {
                        attempt.follow()
                    }
                }))
                .build()
                .map_err(|error| format!("failed to initialize CSS import client: {error}"))
        })
        .as_ref()
        .map_err(|error| CommandError::msg(error.clone()))
}

fn fetch_css_import(url: String) -> CmdResult<CssImportFetchResult> {
    let url = validate_css_import_url(&url)?;
    let response = css_import_client()?
        .get(url)
        .send()
        .map_err(|error| CommandError::msg(format!("failed to fetch CSS import: {error}")))?;
    let response = response
        .error_for_status()
        .map_err(|error| CommandError::msg(format!("CSS import request failed: {error}")))?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_CSS_IMPORT_BYTES as u64)
    {
        return Err(CommandError::msg(format!(
            "CSS import response exceeds {MAX_CSS_IMPORT_BYTES} bytes"
        )));
    }
    let final_url = response.url().to_string();
    let bytes = read_css_import_body(response)?;
    Ok(CssImportFetchResult {
        final_url,
        text: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

#[tauri::command]
pub async fn css_fetch_import(
    window: WebviewWindow,
    url: String,
) -> CmdResult<CssImportFetchResult> {
    ensure_css_import_window(window.label())?;
    let permit = Arc::clone(css_import_fetch_limit())
        .acquire_owned()
        .await
        .map_err(|error| CommandError::msg(format!("CSS import fetch limit closed: {error}")))?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        fetch_css_import(url)
    })
    .await
    .map_err(|error| CommandError::msg(format!("CSS import fetch task failed: {error}")))?
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CustomCssHistoryItem {
    pub path: String,
    pub last_used_at: i64,
    pub status: CustomCssHistoryStatus,
}

#[derive(Serialize)]
pub struct CssActivateResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<CssHistoryErrorCode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

fn history_items(entries: &[CustomCssHistoryEntry]) -> Vec<CustomCssHistoryItem> {
    entries
        .iter()
        .map(|entry| CustomCssHistoryItem {
            path: entry.path.clone(),
            last_used_at: entry.last_used_at,
            status: inspect_css_history_status(Path::new(&entry.path)),
        })
        .collect()
}

fn has_history_path(entries: &[CustomCssHistoryEntry], path: &str) -> bool {
    entries
        .iter()
        .any(|entry| history_paths_match(&entry.path, path))
}

fn replace_tab_css_override(store: &mut AppStoreData, tab_id: &str, css: Option<TabCss>) {
    if let Some(css) = css {
        store.tab_css_overrides.insert(tab_id.to_string(), css);
    } else {
        store.tab_css_overrides.remove(tab_id);
    }
}

fn current_unix_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

fn log_css_rejection(operation: &str, path: &str, error: &CssPathError) {
    log::warn!(
        "[{operation}] Rejected CSS path code={} path={} detail={}",
        error.code.as_str(),
        path,
        error.detail
    );
}

fn activate_failure(code: CssHistoryErrorCode, path: String) -> CssActivateResponse {
    CssActivateResponse {
        success: false,
        code: Some(code),
        content: None,
        path: Some(path),
    }
}

// touch_history: 새 파일 불러오기만 히스토리 맨 앞에 추가.
// 히스토리 항목 적용은 순서를 바꾸지 않음 (목록 순서 고정)
fn commit_loaded_css(
    state: &AppState,
    loaded: &ValidatedCssFile,
    touch_history: bool,
    admission: HistoryAdmissionLease,
) -> CmdResult<AdmittedHistoryOverlapMutation<(CustomCss, bool)>> {
    let css = CustomCss {
        path: Some(loaded.canonical_path.clone()),
        content: loaded.content.clone(),
    };
    let timestamp = current_unix_millis();
    Ok(state
        .store
        .commit_history_overlap_mutation_with_admission(admission, |store| {
            store.custom_css = css.clone();
            if touch_history {
                record_custom_css_load(
                    &mut store.custom_css_history,
                    loaded.canonical_path.clone(),
                    timestamp,
                );
            } else {
                touch_custom_css_history(
                    &mut store.custom_css_history,
                    &loaded.canonical_path,
                    timestamp,
                );
            }
            Ok((css, store.use_custom_css))
        })?)
}

// ========== 탭별 CSS 응답 타입 ==========

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TabCssResponse {
    pub tab_id: String,
    pub css: Option<TabCss>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabCssLoadResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub tab_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub css: Option<TabCss>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabCssClearResponse {
    pub success: bool,
    pub tab_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabCssToggleResponse {
    pub success: bool,
    pub tab_id: String,
    pub enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabCssSetResponse {
    pub success: bool,
    pub tab_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub css: Option<TabCss>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabCssActivateResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<CssHistoryErrorCode>,
    pub tab_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub css: Option<TabCss>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TabCssExportErrorCode {
    NoTabCss,
    IoError,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabCssExportResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<TabCssExportErrorCode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[tauri::command]
pub fn css_get(state: State<'_, AppState>) -> CmdResult<CustomCss> {
    Ok(state.store.snapshot().custom_css)
}

#[tauri::command]
pub fn css_get_use(state: State<'_, AppState>) -> CmdResult<bool> {
    Ok(state.store.snapshot().use_custom_css)
}

#[tauri::command]
pub fn css_toggle(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    enabled: bool,
) -> CmdResult<CssToggleResponse> {
    let _operation_guard = state.lock_css_operation();
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction =
        state
            .store
            .commit_history_overlap_mutation_with_admission(admission, |store| {
                store.use_custom_css = enabled;
                Ok(store.custom_css.clone())
            })?;
    let css = &transaction.value;
    if enabled {
        state.unwatch_global_css();
        if let Some(path) = &css.path {
            if let Err(err) = state.watch_global_css(path) {
                log::warn!("[css_toggle] Failed to start watching: {}", err);
            }
        }
    } else {
        state.unwatch_global_css();
    }

    emit_history_status(&app, &transaction);
    emit_best_effort(&app, "css:use", &CssToggleResponse { enabled });
    if enabled {
        emit_best_effort(&app, "css:content", css);
    }
    notify_obs_css(&state);
    Ok(CssToggleResponse { enabled })
}

#[tauri::command]
pub fn css_reset(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
) -> CmdResult<()> {
    let _operation_guard = state.lock_css_operation();
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction =
        state
            .store
            .commit_history_overlap_mutation_with_admission(admission, |store| {
                store.use_custom_css = false;
                store.custom_css = CustomCss::default();
                Ok(())
            })?;
    state.unwatch_global_css();

    emit_history_status(&app, &transaction);
    emit_best_effort(&app, "css:use", &CssToggleResponse { enabled: false });
    emit_best_effort(&app, "css:content", &CustomCss::default());

    notify_obs_css(&state);
    Ok(())
}

#[tauri::command]
pub fn css_set_content(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    content: String,
) -> CmdResult<CssSetContentResponse> {
    let _operation_guard = state.lock_css_operation();
    if content.len() as u64 > MAX_CUSTOM_CSS_BYTES {
        return Ok(CssSetContentResponse {
            success: false,
            error: Some(CssHistoryErrorCode::TooLarge.as_str().to_string()),
        });
    }
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction =
        state
            .store
            .commit_history_overlap_mutation_with_admission(admission, |store| {
                store.custom_css.content = content;
                Ok(store.custom_css.clone())
            })?;

    emit_history_status(&app, &transaction);
    emit_best_effort(&app, "css:content", &transaction.value);

    notify_obs_css(&state);
    Ok(CssSetContentResponse {
        success: true,
        error: None,
    })
}

#[tauri::command]
pub async fn css_load(app: AppHandle, window: WebviewWindow) -> CmdResult<CssLoadResponse> {
    let picked = parented_file_dialog(&window, "CSS", &["css"])
        .pick_file()
        .await;

    let Some(file) = picked else {
        return Ok(CssLoadResponse {
            success: false,
            error: None,
            content: None,
            path: None,
        });
    };
    let path = file.path().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || css_load_from_path(app, window, path))
        .await
        .map_err(|error| CommandError::msg(format!("CSS load task failed: {error}")))?
}

fn css_load_from_path(
    app: AppHandle,
    window: WebviewWindow,
    path: PathBuf,
) -> CmdResult<CssLoadResponse> {
    let state = app.state::<AppState>();

    let selected_path = path.to_string_lossy().to_string();
    let _operation_guard = state.lock_css_operation();
    let loaded = match validate_css_path(&path) {
        Ok(loaded) => loaded,
        Err(error) => {
            log_css_rejection("css_load", &selected_path, &error);
            return Ok(CssLoadResponse {
                success: false,
                error: Some(error.code.as_str().to_string()),
                content: None,
                path: Some(selected_path),
            });
        }
    };
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction = commit_loaded_css(&state, &loaded, true, admission)?;
    let (css, use_custom_css) = &transaction.value;
    state.authorize_css_path(&loaded.canonical_path);
    state.unwatch_global_css();
    if *use_custom_css {
        if let Err(error) = state.watch_global_css(&loaded.canonical_path) {
            log::warn!("[css_load] Failed to start watching: {error}");
        }
    }
    emit_history_status(&app, &transaction);
    emit_best_effort(&app, "css:content", css);
    notify_obs_css(&state);

    Ok(CssLoadResponse {
        success: true,
        error: None,
        content: Some(loaded.content),
        path: Some(loaded.canonical_path),
    })
}

#[tauri::command]
pub fn css_history_get(state: State<'_, AppState>) -> CmdResult<Vec<CustomCssHistoryItem>> {
    Ok(history_items(&state.store.snapshot().custom_css_history))
}

#[tauri::command]
pub fn css_history_activate(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    path: String,
) -> CmdResult<CssActivateResponse> {
    let _operation_guard = state.lock_css_operation();
    let authorized = state
        .store
        .with_state(|store| has_history_path(&store.custom_css_history, &path));
    if !authorized {
        log::warn!(
            "[css_history_activate] Rejected CSS path code={} path={}",
            CssHistoryErrorCode::PathNotAuthorized.as_str(),
            path
        );
        return Ok(activate_failure(
            CssHistoryErrorCode::PathNotAuthorized,
            path,
        ));
    }

    let loaded = match validate_css_path(Path::new(&path)) {
        Ok(loaded) => loaded,
        Err(error) => {
            log_css_rejection("css_history_activate", &path, &error);
            return Ok(activate_failure(error.code, path));
        }
    };
    let canonical_authorized = state
        .store
        .with_state(|store| has_history_path(&store.custom_css_history, &loaded.canonical_path));
    if !canonical_authorized {
        log::warn!(
            "[css_history_activate] Rejected canonical CSS path code={} path={}",
            CssHistoryErrorCode::PathNotAuthorized.as_str(),
            loaded.canonical_path
        );
        return Ok(activate_failure(
            CssHistoryErrorCode::PathNotAuthorized,
            path,
        ));
    }

    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction = commit_loaded_css(&state, &loaded, false, admission)?;
    let (css, use_custom_css) = &transaction.value;
    state.authorize_css_path(&loaded.canonical_path);
    state.unwatch_global_css();
    if *use_custom_css {
        if let Err(error) = state.watch_global_css(&loaded.canonical_path) {
            log::warn!("[css_history_activate] Failed to start watching: {error}");
        }
    }
    emit_history_status(&app, &transaction);
    emit_best_effort(&app, "css:content", css);
    notify_obs_css(&state);

    Ok(CssActivateResponse {
        success: true,
        code: None,
        content: Some(loaded.content),
        path: Some(loaded.canonical_path),
    })
}

#[tauri::command]
pub fn css_history_remove(
    state: State<'_, AppState>,
    window: WebviewWindow,
    path: String,
) -> CmdResult<Vec<CustomCssHistoryItem>> {
    let operation_guard = state.lock_css_operation();
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction =
        state
            .store
            .commit_history_overlap_mutation_with_admission(admission, |store| {
                store
                    .custom_css_history
                    .retain(|entry| !history_paths_match(&entry.path, &path));
                normalize_custom_css_history(&mut store.custom_css_history);
                Ok(store.custom_css_history.clone())
            })?;
    drop(operation_guard);
    Ok(history_items(&transaction.value))
}

// ========== 탭별 CSS 커맨드 ==========

/// 모든 탭의 CSS 오버라이드 조회
#[tauri::command]
pub fn css_tab_get_all(state: State<'_, AppState>) -> CmdResult<TabCssOverrides> {
    Ok(state.store.snapshot().tab_css_overrides)
}

/// 특정 탭의 CSS 조회
#[tauri::command]
pub fn css_tab_get(state: State<'_, AppState>, tab_id: String) -> CmdResult<TabCssResponse> {
    let overrides = state.store.snapshot().tab_css_overrides;
    let css = overrides.get(&tab_id).cloned();
    Ok(TabCssResponse { tab_id, css })
}

/// 특정 탭에 CSS 파일 로드
#[tauri::command]
pub async fn css_tab_load(
    app: AppHandle,
    window: WebviewWindow,
    tab_id: String,
) -> CmdResult<TabCssLoadResponse> {
    let picked = parented_file_dialog(&window, "CSS", &["css"])
        .pick_file()
        .await;

    let Some(file) = picked else {
        return Ok(TabCssLoadResponse {
            success: false,
            error: None,
            tab_id,
            css: None,
        });
    };
    let path = file.path().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || css_tab_load_from_path(app, window, tab_id, path))
        .await
        .map_err(|error| CommandError::msg(format!("tab CSS load task failed: {error}")))?
}

fn css_tab_load_from_path(
    app: AppHandle,
    window: WebviewWindow,
    tab_id: String,
    path: PathBuf,
) -> CmdResult<TabCssLoadResponse> {
    let state = app.state::<AppState>();

    let selected_path = path.to_string_lossy().to_string();
    let _operation_guard = state.lock_css_operation();
    let loaded = match validate_css_path(&path) {
        Ok(loaded) => loaded,
        Err(error) => {
            log_css_rejection("css_tab_load", &selected_path, &error);
            return Ok(TabCssLoadResponse {
                success: false,
                error: Some(error.code.as_str().to_string()),
                tab_id,
                css: None,
            });
        }
    };
    let tab_css = TabCss {
        path: Some(loaded.canonical_path.clone()),
        content: loaded.content,
        enabled: true,
    };
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction =
        state
            .store
            .commit_history_overlap_mutation_with_admission(admission, |store| {
                replace_tab_css_override(store, &tab_id, Some(tab_css.clone()));
                Ok(())
            })?;
    state.authorize_css_path(&loaded.canonical_path);
    state.unwatch_tab_css(&tab_id);
    if let Err(error) = state.watch_tab_css(&loaded.canonical_path, &tab_id) {
        log::warn!("[css_tab_load] Failed to watch tab {tab_id}: {error}");
    }
    emit_history_status(&app, &transaction);
    emit_best_effort(
        &app,
        "tabCss:changed",
        &TabCssResponse {
            tab_id: tab_id.clone(),
            css: Some(tab_css.clone()),
        },
    );

    Ok(TabCssLoadResponse {
        success: true,
        error: None,
        tab_id,
        css: Some(tab_css),
    })
}

/// 특정 탭의 CSS 제거 (전역 CSS로 폴백)
#[tauri::command]
pub fn css_tab_clear(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    tab_id: String,
) -> CmdResult<TabCssClearResponse> {
    let _operation_guard = state.lock_css_operation();
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction =
        state
            .store
            .commit_history_overlap_mutation_with_admission(admission, |store| {
                replace_tab_css_override(store, &tab_id, None);
                Ok(())
            })?;
    state.unwatch_tab_css(&tab_id);

    emit_history_status(&app, &transaction);
    emit_best_effort(
        &app,
        "tabCss:changed",
        &TabCssResponse {
            tab_id: tab_id.clone(),
            css: None,
        },
    );

    Ok(TabCssClearResponse {
        success: true,
        tab_id,
    })
}

/// 특정 탭의 CSS 직접 설정 (복원용)
#[tauri::command]
pub fn css_tab_set(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    tab_id: String,
    css: Option<TabCss>,
) -> CmdResult<TabCssSetResponse> {
    let _operation_guard = state.lock_css_operation();
    let css = css.map(|tab_css| prepare_tab_css_for_set(&state, tab_css));
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction =
        state
            .store
            .commit_history_overlap_mutation_with_admission(admission, |store| {
                replace_tab_css_override(store, &tab_id, css.clone());
                Ok(())
            })?;
    state.unwatch_tab_css(&tab_id);
    if let Some(path) = css
        .as_ref()
        .filter(|tab_css| tab_css.enabled)
        .and_then(|tab_css| tab_css.path.as_deref())
    {
        if let Err(error) = state.watch_tab_css(path, &tab_id) {
            log::warn!("[css_tab_set] Failed to watch tab {tab_id}: {error}");
        }
    }

    emit_history_status(&app, &transaction);
    emit_best_effort(
        &app,
        "tabCss:changed",
        &TabCssResponse {
            tab_id: tab_id.clone(),
            css: css.clone(),
        },
    );

    Ok(TabCssSetResponse {
        success: true,
        tab_id,
        css,
    })
}

/// 특정 탭의 CSS 사용 여부 토글
#[tauri::command]
pub fn css_tab_toggle(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    tab_id: String,
    enabled: bool,
) -> CmdResult<TabCssToggleResponse> {
    let _operation_guard = state.lock_css_operation();
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction =
        state
            .store
            .commit_history_overlap_mutation_with_admission(admission, |store| {
                let updated_css = if let Some(tab_css) = store.tab_css_overrides.get_mut(&tab_id) {
                    tab_css.enabled = enabled;
                    tab_css.clone()
                } else {
                    // 탭 CSS가 없으면 기본 설정으로 생성
                    let new_css = TabCss {
                        path: None,
                        content: String::new(),
                        enabled,
                    };
                    store
                        .tab_css_overrides
                        .insert(tab_id.clone(), new_css.clone());
                    new_css
                };
                Ok(updated_css)
            })?;

    state.unwatch_tab_css(&tab_id);
    if enabled {
        if let Some(path) = &transaction.value.path {
            if let Err(err) = state.watch_tab_css(path, &tab_id) {
                log::warn!(
                    "[css_tab_toggle] Failed to start watching tab {}: {}",
                    tab_id,
                    err
                );
            }
        }
    }

    emit_history_status(&app, &transaction);
    emit_best_effort(
        &app,
        "tabCss:changed",
        &TabCssResponse {
            tab_id: tab_id.clone(),
            css: Some(transaction.value.clone()),
        },
    );

    Ok(TabCssToggleResponse {
        success: true,
        tab_id,
        enabled,
    })
}

fn prepare_tab_css_for_set(state: &AppState, css: TabCss) -> TabCss {
    prepare_tab_css_for_set_with(css, |path| state.is_css_path_authorized(path))
}

fn prepare_tab_css_for_set_with(
    mut css: TabCss,
    is_authorized: impl FnOnce(&str) -> bool,
) -> TabCss {
    let Some(path) = css.path.clone() else {
        return css;
    };
    if !is_authorized(&path) {
        log::warn!(
            "[css_tab_set] Dropped unauthorized CSS path path={} code={}",
            path,
            CssHistoryErrorCode::PathNotAuthorized.as_str()
        );
        css.path = None;
        return css;
    }

    match validate_css_path(Path::new(&path)) {
        Ok(loaded) => css.path = Some(loaded.canonical_path),
        Err(error) => {
            log_css_rejection("css_tab_set", &path, &error);
            css.path = None;
        }
    }
    css
}

fn is_valid_tab_id(state: &AppState, tab_id: &str) -> bool {
    default_keys().contains_key(tab_id)
        || state
            .store
            .with_state(|store| store.custom_tabs.iter().any(|tab| tab.id == tab_id))
}

fn tab_activate_failure(
    tab_id: String,
    code: Option<CssHistoryErrorCode>,
) -> TabCssActivateResponse {
    TabCssActivateResponse {
        success: false,
        code,
        tab_id,
        css: None,
    }
}

#[tauri::command]
pub fn css_tab_activate_history(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    tab_id: String,
    path: String,
) -> CmdResult<TabCssActivateResponse> {
    let _operation_guard = state.lock_css_operation();
    let authorized = state
        .store
        .with_state(|store| has_history_path(&store.custom_css_history, &path));
    if !authorized {
        log::warn!(
            "[css_tab_activate_history] Rejected CSS path code={} path={}",
            CssHistoryErrorCode::PathNotAuthorized.as_str(),
            path
        );
        return Ok(tab_activate_failure(
            tab_id,
            Some(CssHistoryErrorCode::PathNotAuthorized),
        ));
    }

    let loaded = match validate_css_path(Path::new(&path)) {
        Ok(loaded) => loaded,
        Err(error) => {
            log_css_rejection("css_tab_activate_history", &path, &error);
            return Ok(tab_activate_failure(tab_id, Some(error.code)));
        }
    };
    let canonical_authorized = state
        .store
        .with_state(|store| has_history_path(&store.custom_css_history, &loaded.canonical_path));
    if !canonical_authorized {
        log::warn!(
            "[css_tab_activate_history] Rejected canonical CSS path code={} path={}",
            CssHistoryErrorCode::PathNotAuthorized.as_str(),
            loaded.canonical_path
        );
        return Ok(tab_activate_failure(
            tab_id,
            Some(CssHistoryErrorCode::PathNotAuthorized),
        ));
    }
    if !is_valid_tab_id(&state, &tab_id) {
        log::warn!("[css_tab_activate_history] Rejected unknown tab id={tab_id}");
        return Ok(tab_activate_failure(tab_id, None));
    }

    let tab_css = TabCss {
        path: Some(loaded.canonical_path.clone()),
        content: loaded.content,
        enabled: true,
    };
    let timestamp = current_unix_millis();
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction =
        state
            .store
            .commit_history_overlap_mutation_with_admission(admission, |store| {
                replace_tab_css_override(store, &tab_id, Some(tab_css.clone()));
                touch_custom_css_history(
                    &mut store.custom_css_history,
                    &loaded.canonical_path,
                    timestamp,
                );
                Ok(())
            })?;
    state.authorize_css_path(&loaded.canonical_path);
    state.unwatch_tab_css(&tab_id);
    if let Err(error) = state.watch_tab_css(&loaded.canonical_path, &tab_id) {
        log::warn!("[css_tab_activate_history] Failed to watch tab {tab_id}: {error}");
    }
    emit_history_status(&app, &transaction);
    emit_best_effort(
        &app,
        "tabCss:changed",
        &TabCssResponse {
            tab_id: tab_id.clone(),
            css: Some(tab_css.clone()),
        },
    );

    Ok(TabCssActivateResponse {
        success: true,
        code: None,
        tab_id,
        css: Some(tab_css),
    })
}

fn no_tab_css_export() -> TabCssExportResponse {
    TabCssExportResponse {
        success: false,
        code: Some(TabCssExportErrorCode::NoTabCss),
        error: None,
        path: None,
    }
}

fn ensure_css_extension(mut path: PathBuf) -> PathBuf {
    let has_css_extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("css"));
    if !has_css_extension {
        path.set_extension("css");
    }
    path
}

fn write_tab_css_export(path: &Path, content: &str) -> anyhow::Result<()> {
    atomic_replace(path, content.as_bytes(), "tab-css-export")
}

#[tauri::command]
pub async fn css_tab_export(
    app: AppHandle,
    window: WebviewWindow,
    tab_id: String,
) -> CmdResult<TabCssExportResponse> {
    let initial_css = app
        .state::<AppState>()
        .store
        .with_state(|store| store.tab_css_overrides.get(&tab_id).cloned());
    let Some(initial_css) = initial_css.filter(|css| !css.content.is_empty()) else {
        return Ok(no_tab_css_export());
    };
    let default_file_name = initial_css
        .path
        .as_deref()
        .and_then(|path| Path::new(path).file_name())
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| format!("{tab_id}.css"));
    let selected_file = parented_file_dialog(&window, "CSS", &["css"])
        .set_file_name(&default_file_name)
        .save_file()
        .await;
    let Some(file) = selected_file else {
        return Ok(TabCssExportResponse {
            success: false,
            code: None,
            error: None,
            path: None,
        });
    };
    let selected_path = file.path().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        css_tab_export_from_path(app, tab_id, selected_path)
    })
    .await
    .map_err(|error| CommandError::msg(format!("tab CSS export task failed: {error}")))?
}

fn css_tab_export_from_path(
    app: AppHandle,
    tab_id: String,
    selected_path: PathBuf,
) -> CmdResult<TabCssExportResponse> {
    let state = app.state::<AppState>();
    let export_path = ensure_css_extension(selected_path);
    let current_content = state.store.with_state(|store| {
        store
            .tab_css_overrides
            .get(&tab_id)
            .map(|css| css.content.clone())
    });
    let Some(current_content) = current_content.filter(|content| !content.is_empty()) else {
        return Ok(no_tab_css_export());
    };

    if let Err(error) = write_tab_css_export(&export_path, &current_content) {
        return Ok(TabCssExportResponse {
            success: false,
            code: Some(TabCssExportErrorCode::IoError),
            error: Some(format!("{error:#}")),
            path: None,
        });
    }

    Ok(TabCssExportResponse {
        success: true,
        code: None,
        error: None,
        path: Some(export_path.to_string_lossy().to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        ensure_css_extension, ensure_css_import_window, fetch_css_import,
        prepare_tab_css_for_set_with, read_css_import_body, replace_tab_css_override,
        validate_css_import_url, write_tab_css_export, MAX_CSS_IMPORT_BYTES,
    };
    use crate::models::{AppStoreData, TabCss};
    use parking_lot::Mutex;
    use std::{
        fs,
        path::Path,
        sync::{mpsc, Arc},
        thread,
    };

    fn test_directory(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "dmnote-css-command-{label}-{}",
            uuid::Uuid::new_v4()
        ))
    }

    #[test]
    fn css_import_url_accepts_only_http_and_https() {
        assert_eq!(
            validate_css_import_url("https://example.com/theme.css")
                .unwrap()
                .scheme(),
            "https"
        );
        assert_eq!(
            validate_css_import_url("http://example.com/theme.css")
                .unwrap()
                .scheme(),
            "http"
        );
        for invalid in ["file:///tmp/theme.css", "data:text/css,body{}", "theme.css"] {
            assert!(validate_css_import_url(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn css_import_fetch_is_limited_to_the_main_window() {
        ensure_css_import_window(super::super::MAIN_WINDOW_LABEL).unwrap();
        for label in ["overlay", "panel"] {
            assert_eq!(
                ensure_css_import_window(label).unwrap_err().to_string(),
                "CSS import fetch is only available in the main window"
            );
        }
    }

    #[test]
    fn css_import_blocks_only_explicit_metadata_targets() {
        for allowed in [
            "http://127.0.0.1:5500/theme.css",
            "http://10.0.0.1/theme.css",
            "https://example.com/theme.css",
        ] {
            validate_css_import_url(allowed).unwrap();
        }
        for blocked in [
            "http://169.254.169.254/latest/meta-data",
            "http://169.254.170.2/v2/credentials",
            "http://100.100.100.200/latest/meta-data",
            "http://192.0.0.192/metadata",
            "http://[fd00:ec2::254]/latest/meta-data",
            "http://metadata.google.internal/computeMetadata/v1",
            "http://metadata.azure.internal/metadata/instance",
        ] {
            assert!(validate_css_import_url(blocked).is_err(), "{blocked}");
        }
    }

    #[test]
    fn css_import_follows_local_redirect_without_prompt() {
        use std::io::{Read as _, Write as _};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            for request_index in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0_u8; 2_048];
                let _ = stream.read(&mut request).unwrap();
                if request_index == 0 {
                    stream
                        .write_all(
                            b"HTTP/1.1 302 Found\r\nLocation: /theme.css\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        )
                        .unwrap();
                } else {
                    stream
                        .write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Length: 22\r\nConnection: close\r\n\r\n.counter { color:red }",
                        )
                        .unwrap();
                }
            }
        });
        let fetched = fetch_css_import(format!("http://{address}/start.css")).unwrap();

        server.join().unwrap();
        assert_eq!(fetched.final_url, format!("http://{address}/theme.css"));
        assert_eq!(fetched.text, ".counter { color:red }");
    }

    #[test]
    fn css_import_blocks_metadata_redirect_before_requesting_it() {
        use std::io::{Read as _, Write as _};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 2_048];
            let _ = stream.read(&mut request).unwrap();
            stream
                .write_all(
                    b"HTTP/1.1 302 Found\r\nLocation: http://169.254.169.254/latest/meta-data\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .unwrap();
        });

        let error = fetch_css_import(format!("http://{address}/start.css")).unwrap_err();

        server.join().unwrap();
        assert!(
            error.to_string().contains("error following redirect"),
            "unexpected redirect error: {error}"
        );
    }

    #[test]
    fn css_import_body_enforces_the_one_mibibyte_limit() {
        let accepted = vec![b'a'; MAX_CSS_IMPORT_BYTES];
        assert_eq!(
            read_css_import_body(std::io::Cursor::new(accepted.clone())).unwrap(),
            accepted
        );

        let rejected = vec![b'a'; MAX_CSS_IMPORT_BYTES + 1];
        assert_eq!(
            read_css_import_body(std::io::Cursor::new(rejected))
                .unwrap_err()
                .to_string(),
            format!("CSS import response exceeds {MAX_CSS_IMPORT_BYTES} bytes")
        );
    }

    #[test]
    fn unauthorized_tab_set_preserves_content_without_persisting_path() {
        let css = TabCss {
            path: Some("/tmp/not-authorized.css".to_string()),
            content: "preserved".to_string(),
            enabled: true,
        };

        let prepared = prepare_tab_css_for_set_with(css, |_| false);

        assert_eq!(prepared.path, None);
        assert_eq!(prepared.content, "preserved");
        assert!(prepared.enabled);
    }

    #[test]
    fn authorized_tab_set_persists_the_canonical_path() {
        let root = test_directory("authorized");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("theme.css");
        fs::write(&path, "body {}").unwrap();
        let css = TabCss {
            path: Some(path.to_string_lossy().to_string()),
            content: "preserved".to_string(),
            enabled: true,
        };

        let prepared = prepare_tab_css_for_set_with(css, |_| true);

        let canonical = fs::canonicalize(&path)
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert_eq!(prepared.path.as_deref(), Some(canonical.as_str()));
        assert_eq!(prepared.content, "preserved");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn export_corrects_extension_and_atomically_replaces_existing_file() {
        let root = test_directory("export");
        fs::create_dir_all(&root).unwrap();
        let selected = root.join("theme.txt");
        let export = ensure_css_extension(selected);
        fs::write(&export, "old").unwrap();

        write_tab_css_export(&export, "new").unwrap();

        assert_eq!(
            export.extension().and_then(|value| value.to_str()),
            Some("css")
        );
        assert_eq!(fs::read_to_string(&export).unwrap(), "new");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        assert!(Path::new(&export).is_file());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn clear_waiting_on_activation_lock_wins_with_the_last_commit() {
        let operation_lock = Arc::new(Mutex::new(()));
        let store = Arc::new(Mutex::new(AppStoreData::default()));
        let (locked_tx, locked_rx) = mpsc::channel();
        let (continue_tx, continue_rx) = mpsc::channel();

        let activation_lock = operation_lock.clone();
        let activation_store = store.clone();
        let activate = thread::spawn(move || {
            let _guard = activation_lock.lock();
            locked_tx.send(()).unwrap();
            continue_rx.recv().unwrap();
            replace_tab_css_override(
                &mut activation_store.lock(),
                "4key",
                Some(TabCss {
                    path: Some("/tmp/theme.css".to_string()),
                    content: "active".to_string(),
                    enabled: true,
                }),
            );
        });
        locked_rx.recv().unwrap();

        let clear_lock = operation_lock.clone();
        let clear_store = store.clone();
        let clear = thread::spawn(move || {
            let _guard = clear_lock.lock();
            replace_tab_css_override(&mut clear_store.lock(), "4key", None);
        });
        continue_tx.send(()).unwrap();
        activate.join().unwrap();
        clear.join().unwrap();

        assert!(!store.lock().tab_css_overrides.contains_key("4key"));
    }
}
