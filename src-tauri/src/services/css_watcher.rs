//! CSS 파일 핫리로딩 서비스
//!
//! 커스텀 CSS 파일 변경을 감지하여 자동으로 리로드합니다.
//! - 전역 CSS 파일 워칭
//! - 탭별 CSS 파일 워칭
//! - 디바운싱으로 연속 변경 시 한 번만 리로드

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use notify::RecommendedWatcher;
use notify_debouncer_mini::{new_debouncer, Debouncer};
use parking_lot::RwLock;
use tauri::{AppHandle, Emitter};

use crate::models::{CustomCss, TabCss};
use crate::store::AppStore;

/// CSS 워칭 타입
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum CssWatchTarget {
    /// 전역 CSS
    Global,
    /// 탭별 CSS (탭 ID)
    Tab(String),
}

/// CSS 파일 워처
pub struct CssWatcher {
    store: Arc<AppStore>,
    app: AppHandle,
    /// 워처 인스턴스들 (경로 -> 디바운서)
    watchers: RwLock<HashMap<PathBuf, WatcherEntry>>,
}

struct WatcherEntry {
    #[allow(dead_code)]
    debouncer: Debouncer<RecommendedWatcher>,
    targets: Vec<CssWatchTarget>,
}

impl CssWatcher {
    pub fn new(store: Arc<AppStore>, app: AppHandle) -> Self {
        Self {
            store,
            app,
            watchers: RwLock::new(HashMap::new()),
        }
    }

    /// 전역 CSS 파일 워칭 시작
    pub fn watch_global(&self, path: &str) -> Result<(), String> {
        self.watch_path(path, CssWatchTarget::Global)
    }

    /// 탭별 CSS 파일 워칭 시작
    pub fn watch_tab(&self, path: &str, tab_id: &str) -> Result<(), String> {
        self.watch_path(path, CssWatchTarget::Tab(tab_id.to_string()))
    }

    /// 전역 CSS 워칭 중지
    pub fn unwatch_global(&self) {
        self.unwatch_target(&CssWatchTarget::Global);
    }

    /// 탭별 CSS 워칭 중지
    pub fn unwatch_tab(&self, tab_id: &str) {
        self.unwatch_target(&CssWatchTarget::Tab(tab_id.to_string()));
    }

    /// 특정 경로에 대한 워칭 시작
    fn watch_path(&self, path: &str, target: CssWatchTarget) -> Result<(), String> {
        let path_buf = PathBuf::from(path);

        // 파일이 존재하는지 확인
        if !path_buf.exists() {
            return Err(format!("File not found: {}", path));
        }

        let mut watchers = self.watchers.write();

        // 이미 같은 경로를 워칭 중인 경우
        if let Some(entry) = watchers.get_mut(&path_buf) {
            // 같은 타겟이 이미 등록되어 있으면 무시
            if !entry.targets.contains(&target) {
                entry.targets.push(target);
            }
            return Ok(());
        }

        // 새 워처 생성
        let store = self.store.clone();
        let app = self.app.clone();
        let watch_path = path_buf.clone();

        let mut debouncer = new_debouncer(
            Duration::from_millis(100), // 100ms 디바운스
            move |res: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
                match res {
                    Ok(events) => {
                        for event in events {
                            // 플랫폼/에디터에 따라 이벤트 kind가 Any가 아닐 수 있습니다.
                            // (예: Write/Create/Rename 등) Any만 처리하면 macOS/Windows에서
                            // 핫리로딩이 누락되는 케이스가 생길 수 있어 kind 필터를 두지 않습니다.
                            log::debug!(
                                "[CssWatcher] Debounced event: kind={:?}, path={:?}",
                                event.kind,
                                event.path
                            );

                            if let Err(err) = handle_css_change(&store, &app, &event.path) {
                                log::error!("Failed to handle CSS change: {}", err);
                            }
                        }
                    }
                    Err(err) => {
                        log::error!("CSS watcher error: {:?}", err);
                    }
                }
            },
        )
        .map_err(|e| format!("Failed to create debouncer: {}", e))?;

        // 파일의 부모 디렉토리 또는 파일 자체를 워칭
        let watch_target = if path_buf.is_file() {
            path_buf.parent().unwrap_or(&path_buf)
        } else {
            &path_buf
        };

        debouncer
            .watcher()
            .watch(watch_target, notify::RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to start watching: {}", e))?;

        log::info!(
            "[CssWatcher] Started watching: {:?} for {:?}",
            watch_path,
            target
        );

        watchers.insert(
            watch_path,
            WatcherEntry {
                debouncer,
                targets: vec![target],
            },
        );

        Ok(())
    }

    /// 특정 타겟에 대한 워칭 중지
    fn unwatch_target(&self, target: &CssWatchTarget) {
        let mut watchers = self.watchers.write();
        let mut paths_to_remove = Vec::new();

        for (path, entry) in watchers.iter_mut() {
            entry.targets.retain(|t| t != target);
            if entry.targets.is_empty() {
                paths_to_remove.push(path.clone());
            }
        }

        for path in paths_to_remove {
            if let Some(_entry) = watchers.remove(&path) {
                log::info!("[CssWatcher] Stopped watching: {:?}", path);
            }
        }
    }

    /// 저장된 CSS 경로들에 대해 워칭 시작 (앱 시작 시)
    pub fn initialize_from_store(&self) {
        let snapshot = self.store.snapshot();

        // 전역 CSS
        if snapshot.use_custom_css {
            if let Some(path) = &snapshot.custom_css.path {
                if let Err(err) = self.watch_global(path) {
                    log::warn!("[CssWatcher] Failed to watch global CSS: {}", err);
                }
            }
        }

        // 탭별 CSS
        for (tab_id, tab_css) in &snapshot.tab_css_overrides {
            if tab_css.enabled {
                if let Some(path) = &tab_css.path {
                    if let Err(err) = self.watch_tab(path, tab_id) {
                        log::warn!("[CssWatcher] Failed to watch tab CSS {}: {}", tab_id, err);
                    }
                }
            }
        }
    }

    /// 모든 워칭 중지
    pub fn shutdown(&self) {
        let mut watchers = self.watchers.write();
        watchers.clear();
        log::info!("[CssWatcher] Shutdown complete");
    }
}

/// CSS 파일 변경 처리
fn handle_css_change(store: &AppStore, app: &AppHandle, changed_path: &Path) -> Result<(), String> {
    let snapshot = store.snapshot();
    let changed_path_str = changed_path.to_string_lossy().to_string();

    log::debug!("[CssWatcher] File changed: {}", changed_path_str);

    // 전역 CSS 체크
    if let Some(global_path) = &snapshot.custom_css.path {
        if paths_match(global_path, &changed_path_str) && snapshot.use_custom_css {
            return reload_global_css(store, app, global_path);
        }
    }

    // 탭별 CSS 체크
    for (tab_id, tab_css) in &snapshot.tab_css_overrides {
        if let Some(tab_path) = &tab_css.path {
            if paths_match(tab_path, &changed_path_str) && tab_css.enabled {
                return reload_tab_css(store, app, tab_id, tab_path);
            }
        }
    }

    Ok(())
}

/// 전역 CSS 리로드
fn reload_global_css(store: &AppStore, app: &AppHandle, path: &str) -> Result<(), String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;

    let css = CustomCss {
        path: Some(path.to_string()),
        content: content.clone(),
    };

    store
        .update(|s| {
            s.custom_css = css.clone();
        })
        .map_err(|e| e.to_string())?;

    app.emit("css:content", &css).map_err(|e| e.to_string())?;

    log::info!("[CssWatcher] Reloaded global CSS from: {}", path);
    Ok(())
}

/// 탭별 CSS 리로드
fn reload_tab_css(
    store: &AppStore,
    app: &AppHandle,
    tab_id: &str,
    path: &str,
) -> Result<(), String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;

    let tab_css = TabCss {
        path: Some(path.to_string()),
        content: content.clone(),
        enabled: true,
    };

    store
        .update(|s| {
            s.tab_css_overrides
                .insert(tab_id.to_string(), tab_css.clone());
        })
        .map_err(|e| e.to_string())?;

    #[derive(serde::Serialize, Clone)]
    #[serde(rename_all = "camelCase")]
    struct TabCssResponse {
        tab_id: String,
        css: Option<TabCss>,
    }

    let response = TabCssResponse {
        tab_id: tab_id.to_string(),
        css: Some(tab_css),
    };

    app.emit("tabCss:changed", &response)
        .map_err(|e| e.to_string())?;

    log::info!("[CssWatcher] Reloaded tab CSS {} from: {}", tab_id, path);
    Ok(())
}

/// 경로 비교 (플랫폼별 차이 무시)
fn paths_match(path1: &str, path2: &str) -> bool {
    let p1 = PathBuf::from(path1);
    let p2 = PathBuf::from(path2);

    // 먼저 파일명이 같은지 빠르게 확인
    match (p1.file_name(), p2.file_name()) {
        (Some(name1), Some(name2)) if name1 == name2 => {
            // 파일명이 같으면 전체 경로 비교
            // 플랫폼 차이를 무시하기 위해 정규화된 문자열로 비교
            let normalized1 = path1.replace('\\', "/").to_lowercase();
            let normalized2 = path2.replace('\\', "/").to_lowercase();

            if normalized1 == normalized2 {
                return true;
            }

            // 문자열이 다르면 canonicalize로 최종 확인 (비용이 크므로 마지막에만)
            if let (Ok(canonical1), Ok(canonical2)) = (p1.canonicalize(), p2.canonicalize()) {
                return canonical1 == canonical2;
            }

            false
        }
        _ => false,
    }
}
