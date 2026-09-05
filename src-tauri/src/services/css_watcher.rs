//! CSS 파일 핫리로딩 서비스
//!
//! 커스텀 CSS 파일 변경을 감지하여 자동으로 리로드합니다.
//! - 전역 CSS 파일 워칭
//! - 탭별 CSS 파일 워칭
//! - 디바운싱으로 연속 변경 시 한 번만 리로드

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use notify::RecommendedWatcher;
use notify_debouncer_mini::{new_debouncer, Debouncer};
use parking_lot::RwLock;
use tauri::{AppHandle, Manager};

use crate::commands::editor::{css::TabCssResponse, state::emit_best_effort};
use crate::errors::EditorCommitError;
use crate::state::{store::AdmittedHistoryOverlapMutation, AppState, AppStore};
use crate::{
    custom_css::{custom_css_settings_diff, validate_css_path, ValidatedCssFile},
    models::{AppStoreData, CustomCss, TabCss, TabCssOverrides},
    state::assets::local_asset_path::path_identity_key,
};

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

fn resolve_css_watch_path(path: &str) -> Result<PathBuf, String> {
    let requested = PathBuf::from(path);
    match std::fs::canonicalize(&requested) {
        Ok(canonical) => Ok(canonical),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let file_name = requested
                .file_name()
                .ok_or_else(|| format!("Failed to resolve CSS file name from {path}"))?;
            let parent = requested
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .unwrap_or_else(|| Path::new("."));
            let canonical_parent = std::fs::canonicalize(parent).map_err(|parent_error| {
                format!("Failed to resolve CSS parent directory {path}: {parent_error}")
            })?;
            Ok(canonical_parent.join(file_name))
        }
        Err(error) => Err(format!("Failed to resolve CSS path {path}: {error}")),
    }
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

    pub fn resync_tabs(&self, overrides: &TabCssOverrides) {
        {
            let mut watchers = self.watchers.write();
            watchers.retain(|_, entry| {
                entry
                    .targets
                    .retain(|target| matches!(target, CssWatchTarget::Global));
                !entry.targets.is_empty()
            });
        }

        for (tab_id, css) in overrides {
            if !css.enabled {
                continue;
            }
            let Some(path) = css.path.as_deref() else {
                continue;
            };
            if let Err(error) = self.watch_tab(path, tab_id) {
                log::warn!("[CssWatcher] Failed to restore tab CSS watcher {tab_id}: {error}");
            }
        }
    }

    /// 특정 경로에 대한 워칭 시작
    fn watch_path(&self, path: &str, target: CssWatchTarget) -> Result<(), String> {
        let path_buf = resolve_css_watch_path(path)?;
        let identity = path_identity_key(&path_buf);

        let mut watchers = self.watchers.write();

        if let Some(entry) = watchers
            .iter_mut()
            .find(|(watched_path, _)| path_identity_key(watched_path) == identity)
            .map(|(_, entry)| entry)
        {
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
                            // 이벤트 kind 필터 미적용 — 플랫폼/에디터별 kind 차이(Write/Create/Rename 등)로
                            // Any만 필터 시 핫리로딩 누락 가능
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
        let watch_target = if path_buf.is_dir() {
            &path_buf
        } else {
            path_buf.parent().unwrap_or(&path_buf)
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

    let global_matches = snapshot.use_custom_css
        && snapshot
            .custom_css
            .path
            .as_deref()
            .is_some_and(|path| paths_match(path, &changed_path_str));
    let tab_matches = snapshot.tab_css_overrides.values().any(|css| {
        css.enabled
            && css
                .path
                .as_deref()
                .is_some_and(|path| paths_match(path, &changed_path_str))
    });
    if !global_matches && !tab_matches {
        return Ok(());
    }

    reload_css_consumers(store, app, &changed_path_str)
}

fn reload_css_consumers(store: &AppStore, app: &AppHandle, path: &str) -> Result<(), String> {
    let app_state = app.state::<AppState>();
    let _operation_guard = app_state.lock_css_operation();
    let loaded = validate_css_path(Path::new(path)).map_err(|error| {
        format!(
            "CSS reload rejected code={} path={} detail={}",
            error.code.as_str(),
            path,
            error.detail
        )
    })?;
    let transaction = commit_css_reload(store, path, &loaded).map_err(|error| error.to_string())?;
    let (committed_global, committed_tabs) = &transaction.value;

    if let Some(status) = transaction.history_status.as_ref() {
        emit_best_effort(app, "history:status", status);
    }

    if let Some(css) = committed_global.as_ref() {
        emit_best_effort(app, "css:content", css);
        app_state.notify_obs_settings_diff(custom_css_settings_diff(&store.snapshot()));
    }
    for (tab_id, css) in committed_tabs {
        emit_best_effort(
            app,
            "tabCss:changed",
            &TabCssResponse {
                tab_id: tab_id.clone(),
                css: Some(css.clone()),
            },
        );
    }

    if committed_global.is_none() && committed_tabs.is_empty() {
        log::debug!("[CssWatcher] Discarded stale CSS reload for: {path}");
    } else {
        log::info!(
            "[CssWatcher] Reloaded CSS from {} global={} tabs={}",
            path,
            committed_global.is_some(),
            committed_tabs.len()
        );
    }
    Ok(())
}

pub(crate) type CssReloadChanges = (Option<CustomCss>, Vec<(String, TabCss)>);

pub(crate) fn commit_css_reload(
    store: &AppStore,
    path: &str,
    loaded: &ValidatedCssFile,
) -> Result<AdmittedHistoryOverlapMutation<CssReloadChanges>, EditorCommitError> {
    let admission = store.admit_editor_mutation()?;
    store.commit_history_overlap_mutation_with_admission(admission, |state| {
        Ok(apply_reload_if_current(state, path, loaded))
    })
}

pub(crate) fn apply_reload_if_current(
    state: &mut AppStoreData,
    path: &str,
    loaded: &ValidatedCssFile,
) -> (Option<CustomCss>, Vec<(String, TabCss)>) {
    let global_css = if state.use_custom_css
        && state
            .custom_css
            .path
            .as_deref()
            .is_some_and(|current| paths_match(current, path))
    {
        let css = CustomCss {
            path: Some(loaded.canonical_path.clone()),
            content: loaded.content.clone(),
        };
        state.custom_css = css.clone();
        Some(css)
    } else {
        None
    };

    let mut tabs = Vec::new();
    for (tab_id, css) in &mut state.tab_css_overrides {
        if !css.enabled {
            continue;
        }
        let Some(current_path) = css.path.as_deref() else {
            continue;
        };
        if !paths_match(current_path, path) {
            continue;
        }

        css.path = Some(loaded.canonical_path.clone());
        css.content = loaded.content.clone();
        tabs.push((tab_id.clone(), css.clone()));
    }

    (global_css, tabs)
}

fn paths_match(path1: &str, path2: &str) -> bool {
    let p1 = PathBuf::from(path1);
    let p2 = PathBuf::from(path2);
    if path_identity_key(&p1) == path_identity_key(&p2) {
        return true;
    }

    matches!(
        (p1.canonicalize(), p2.canonicalize()),
        (Ok(canonical1), Ok(canonical2)) if canonical1 == canonical2
    )
}

#[cfg(test)]
mod tests {
    use super::{apply_reload_if_current, resolve_css_watch_path};
    use crate::{
        custom_css::ValidatedCssFile,
        models::{AppStoreData, CustomCss, TabCss},
    };

    #[test]
    fn stale_global_reload_cannot_replace_a_new_path() {
        let mut state = AppStoreData {
            use_custom_css: true,
            custom_css: CustomCss {
                path: Some("/tmp/new.css".to_string()),
                content: "new".to_string(),
            },
            ..AppStoreData::default()
        };
        let stale = ValidatedCssFile {
            canonical_path: "/tmp/old.css".to_string(),
            content: "old".to_string(),
        };

        let (global, tabs) = apply_reload_if_current(&mut state, "/tmp/old.css", &stale);
        assert!(global.is_none());
        assert!(tabs.is_empty());
        assert_eq!(state.custom_css.content, "new");
    }

    #[test]
    fn current_global_reload_replaces_content() {
        let path = "/tmp/current.css";
        let mut state = AppStoreData {
            use_custom_css: true,
            custom_css: CustomCss {
                path: Some(path.to_string()),
                content: "before".to_string(),
            },
            ..AppStoreData::default()
        };
        let reloaded = ValidatedCssFile {
            canonical_path: "/tmp/canonical.css".to_string(),
            content: "after".to_string(),
        };

        let (global, _) = apply_reload_if_current(&mut state, path, &reloaded);
        assert!(global.is_some());
        assert_eq!(state.custom_css.content, "after");
        assert_eq!(state.custom_css.path.as_deref(), Some("/tmp/canonical.css"));
    }

    #[cfg(unix)]
    #[test]
    fn symlink_alias_and_canonical_target_share_reload_identity() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "dmnote-css-watcher-canonical-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let target = root.join("target.css");
        let alias = root.join("alias.css");
        std::fs::write(&target, "body {}").unwrap();
        symlink(&target, &alias).unwrap();

        assert!(super::paths_match(
            &alias.to_string_lossy(),
            &target.to_string_lossy()
        ));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn missing_css_file_keeps_a_watchable_path_under_its_existing_parent() {
        let root = std::env::temp_dir().join(format!(
            "dmnote-css-watcher-missing-start-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let missing = root.join("restored.css");

        let resolved = resolve_css_watch_path(&missing.to_string_lossy()).unwrap();
        let canonical_root = root.canonicalize().unwrap();

        assert_eq!(resolved.parent(), Some(canonical_root.as_path()));
        assert_eq!(resolved.file_name(), missing.file_name());
        assert!(!resolved.exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn stale_tab_reload_preserves_new_path_and_enabled_state() {
        let mut state = AppStoreData::default();
        state.tab_css_overrides.insert(
            "4key".to_string(),
            TabCss {
                path: Some("/tmp/new.css".to_string()),
                content: "new".to_string(),
                enabled: false,
            },
        );
        let loaded = ValidatedCssFile {
            canonical_path: "/tmp/old.css".to_string(),
            content: "old".to_string(),
        };

        let (_, tabs) = apply_reload_if_current(&mut state, "/tmp/old.css", &loaded);

        assert!(tabs.is_empty());
        let css = &state.tab_css_overrides["4key"];
        assert_eq!(css.content, "new");
        assert!(!css.enabled);
    }

    #[test]
    fn shared_file_reload_fans_out_to_global_and_all_tabs() {
        let path = "/tmp/shared.css";
        let tab_css = TabCss {
            path: Some(path.to_string()),
            content: "before".to_string(),
            enabled: true,
        };
        let mut state = AppStoreData {
            use_custom_css: true,
            custom_css: CustomCss {
                path: Some(path.to_string()),
                content: "before".to_string(),
            },
            ..AppStoreData::default()
        };
        state
            .tab_css_overrides
            .insert("4key".to_string(), tab_css.clone());
        state.tab_css_overrides.insert("5key".to_string(), tab_css);
        let loaded = ValidatedCssFile {
            canonical_path: path.to_string(),
            content: "after".to_string(),
        };

        let (global, tabs) = apply_reload_if_current(&mut state, path, &loaded);

        assert_eq!(global.unwrap().content, "after");
        assert_eq!(tabs.len(), 2);
        assert!(state
            .tab_css_overrides
            .values()
            .all(|css| css.content == "after" && css.enabled));
    }
}
