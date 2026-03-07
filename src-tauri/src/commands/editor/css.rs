use std::fs;

use rfd::FileDialog;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::{
    errors::CmdResult,
    models::{CustomCss, TabCss, TabCssOverrides},
    state::AppState,
};

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
    enabled: bool,
) -> CmdResult<CssToggleResponse> {
    state.store.update(|store| {
        store.use_custom_css = enabled;
    })?;

    app.emit("css:use", &CssToggleResponse { enabled })?;

    if enabled {
        let css = state.store.snapshot().custom_css;
        app.emit("css:content", &css)?;

        // CSS 핫리로딩: 활성화 시 파일 워칭 시작
        if let Some(path) = &css.path {
            if let Err(err) = state.watch_global_css(path) {
                log::warn!("[css_toggle] Failed to start watching: {}", err);
            }
        }
    } else {
        // CSS 핫리로딩: 비활성화 시 워칭 중지
        state.unwatch_global_css();
    }

    Ok(CssToggleResponse { enabled })
}

#[tauri::command]
pub fn css_reset(state: State<'_, AppState>, app: AppHandle) -> CmdResult<()> {
    // CSS 핫리로딩: 전역 CSS 워칭 중지
    state.unwatch_global_css();

    state.store.update(|store| {
        store.use_custom_css = false;
        store.custom_css = CustomCss::default();
    })?;

    app.emit("css:use", &CssToggleResponse { enabled: false })?;
    app.emit("css:content", &CustomCss::default())?;
    Ok(())
}

#[tauri::command]
pub fn css_set_content(
    state: State<'_, AppState>,
    app: AppHandle,
    content: String,
) -> CmdResult<CssSetContentResponse> {
    let mut current = state.store.snapshot().custom_css;
    current.content = content.clone();

    state.store.update(|store| {
        store.custom_css = current.clone();
    })?;

    app.emit("css:content", &current)?;

    Ok(CssSetContentResponse {
        success: true,
        error: None,
    })
}

#[tauri::command]
pub fn css_load(state: State<'_, AppState>, app: AppHandle) -> CmdResult<CssLoadResponse> {
    let picked = FileDialog::new().add_filter("CSS", &["css"]).pick_file();

    let Some(path) = picked else {
        return Ok(CssLoadResponse {
            success: false,
            error: None,
            content: None,
            path: None,
        });
    };

    let path_string = path.to_string_lossy().to_string();
    match fs::read_to_string(&path) {
        Ok(content) => {
            // 이전 파일 워칭 중지
            state.unwatch_global_css();

            let css = CustomCss {
                path: Some(path_string.clone()),
                content: content.clone(),
            };
            state.store.update(|store| {
                store.custom_css = css.clone();
            })?;

            app.emit("css:content", &css)?;

            // CSS 핫리로딩: 새 파일 워칭 시작 (use_custom_css가 활성화된 경우에만)
            if state.store.snapshot().use_custom_css {
                if let Err(err) = state.watch_global_css(&path_string) {
                    log::warn!("[css_load] Failed to start watching: {}", err);
                }
            }

            Ok(CssLoadResponse {
                success: true,
                error: None,
                content: Some(content),
                path: Some(path_string),
            })
        }
        Err(err) => Ok(CssLoadResponse {
            success: false,
            error: Some(err.to_string()),
            content: None,
            path: Some(path_string),
        }),
    }
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
pub fn css_tab_load(
    state: State<'_, AppState>,
    app: AppHandle,
    tab_id: String,
) -> CmdResult<TabCssLoadResponse> {
    let picked = FileDialog::new().add_filter("CSS", &["css"]).pick_file();

    let Some(path) = picked else {
        return Ok(TabCssLoadResponse {
            success: false,
            error: None,
            tab_id,
            css: None,
        });
    };

    let path_string = path.to_string_lossy().to_string();
    match fs::read_to_string(&path) {
        Ok(content) => {
            // 이전 탭 CSS 워칭 중지
            state.unwatch_tab_css(&tab_id);

            let tab_css = TabCss {
                path: Some(path_string.clone()),
                content: content.clone(),
                enabled: true,
            };

            state.store.update(|store| {
                store
                    .tab_css_overrides
                    .insert(tab_id.clone(), tab_css.clone());
            })?;

            let response = TabCssResponse {
                tab_id: tab_id.clone(),
                css: Some(tab_css.clone()),
            };
            app.emit("tabCss:changed", &response)?;

            // CSS 핫리로딩: 새 탭 CSS 파일 워칭 시작
            if let Err(err) = state.watch_tab_css(&path_string, &tab_id) {
                log::warn!(
                    "[css_tab_load] Failed to start watching tab {}: {}",
                    tab_id,
                    err
                );
            }

            Ok(TabCssLoadResponse {
                success: true,
                error: None,
                tab_id,
                css: Some(tab_css),
            })
        }
        Err(err) => Ok(TabCssLoadResponse {
            success: false,
            error: Some(err.to_string()),
            tab_id,
            css: None,
        }),
    }
}

/// 특정 탭의 CSS 제거 (전역 CSS로 폴백)
#[tauri::command]
pub fn css_tab_clear(
    state: State<'_, AppState>,
    app: AppHandle,
    tab_id: String,
) -> CmdResult<TabCssClearResponse> {
    // CSS 핫리로딩: 탭 CSS 워칭 중지
    state.unwatch_tab_css(&tab_id);

    state.store.update(|store| {
        store.tab_css_overrides.remove(&tab_id);
    })?;

    let response = TabCssResponse {
        tab_id: tab_id.clone(),
        css: None,
    };
    app.emit("tabCss:changed", &response)?;

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
    tab_id: String,
    css: Option<TabCss>,
) -> CmdResult<TabCssSetResponse> {
    // 이전 탭 CSS 워칭 중지
    state.unwatch_tab_css(&tab_id);

    if let Some(ref tab_css) = css {
        state.store.update(|store| {
            store
                .tab_css_overrides
                .insert(tab_id.clone(), tab_css.clone());
        })?;

        // CSS 핫리로딩: 파일이 있고 enabled인 경우 워칭 시작
        if tab_css.enabled {
            if let Some(path) = &tab_css.path {
                if let Err(err) = state.watch_tab_css(path, &tab_id) {
                    log::warn!(
                        "[css_tab_set] Failed to start watching tab {}: {}",
                        tab_id,
                        err
                    );
                }
            }
        }
    } else {
        state.store.update(|store| {
            store.tab_css_overrides.remove(&tab_id);
        })?;
    }

    let response = TabCssResponse {
        tab_id: tab_id.clone(),
        css: css.clone(),
    };
    app.emit("tabCss:changed", &response)?;

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
    tab_id: String,
    enabled: bool,
) -> CmdResult<TabCssToggleResponse> {
    let mut updated_css: Option<TabCss> = None;

    state.store.update(|store| {
        if let Some(tab_css) = store.tab_css_overrides.get_mut(&tab_id) {
            tab_css.enabled = enabled;
            updated_css = Some(tab_css.clone());
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
            updated_css = Some(new_css);
        }
    })?;

    // CSS 핫리로딩: 활성화/비활성화에 따른 워칭 관리
    if let Some(ref css) = updated_css {
        if enabled {
            if let Some(path) = &css.path {
                if let Err(err) = state.watch_tab_css(path, &tab_id) {
                    log::warn!(
                        "[css_tab_toggle] Failed to start watching tab {}: {}",
                        tab_id,
                        err
                    );
                }
            }
        } else {
            state.unwatch_tab_css(&tab_id);
        }
    }

    let response = TabCssResponse {
        tab_id: tab_id.clone(),
        css: updated_css,
    };
    app.emit("tabCss:changed", &response)?;

    Ok(TabCssToggleResponse {
        success: true,
        tab_id,
        enabled,
    })
}
