use super::*;

impl AppState {
    // ========== CSS 핫리로딩 관련 메서드 ==========

    /// 잠금 순서: 번호표 turn -> CSS 잠금, 역순이면 preset_load와 교착
    pub(crate) fn lock_css_operation(&self) -> parking_lot::MutexGuard<'_, ()> {
        self.css_operation_lock.lock()
    }

    pub(crate) fn authorize_css_path(&self, path: &str) {
        self.authorized_css_paths
            .write()
            .insert(path_identity_key(Path::new(path)));
    }

    pub(crate) fn is_css_path_authorized(&self, path: &str) -> bool {
        self.authorized_css_paths
            .read()
            .contains(&path_identity_key(Path::new(path)))
    }

    pub(crate) fn resync_global_css_watcher(
        &self,
        previous: &AppStoreData,
        current: &AppStoreData,
    ) {
        let previous_path = global_css_watch_path(previous);
        let current_path = global_css_watch_path(current);
        if previous_path == current_path {
            return;
        }

        self.unwatch_global_css();
        if let Some(path) = current_path {
            if let Err(error) = self.watch_global_css(path) {
                log::warn!("[AppState] Failed to resync global CSS watcher: {error}");
            }
        }
    }

    /// CSS 워처 초기화
    pub(super) fn initialize_css_watcher(&self, app: &AppHandle) {
        let watcher = CssWatcher::new(self.store.clone(), app.clone());
        watcher.initialize_from_store();
        *self.css_watcher.write() = Some(watcher);
        log::info!("[AppState] CSS watcher initialized");
    }

    /// 전역 CSS 파일 워칭 시작
    pub fn watch_global_css(&self, path: &str) -> Result<(), String> {
        if let Some(watcher) = self.css_watcher.read().as_ref() {
            watcher.watch_global(path)
        } else {
            Err("CSS watcher not initialized".to_string())
        }
    }

    /// 전역 CSS 파일 워칭 중지
    pub fn unwatch_global_css(&self) {
        if let Some(watcher) = self.css_watcher.read().as_ref() {
            watcher.unwatch_global();
        }
    }

    /// 탭별 CSS 파일 워칭 시작
    pub fn watch_tab_css(&self, path: &str, tab_id: &str) -> Result<(), String> {
        if let Some(watcher) = self.css_watcher.read().as_ref() {
            watcher.watch_tab(path, tab_id)
        } else {
            Err("CSS watcher not initialized".to_string())
        }
    }

    /// 탭별 CSS 파일 워칭 중지
    pub fn unwatch_tab_css(&self, tab_id: &str) {
        if let Some(watcher) = self.css_watcher.read().as_ref() {
            watcher.unwatch_tab(tab_id);
        }
    }

    pub(crate) fn resync_tab_css_watchers(&self, overrides: &TabCssOverrides) {
        if let Some(watcher) = self.css_watcher.read().as_ref() {
            watcher.resync_tabs(overrides);
        }
    }
}

pub(super) fn global_css_watch_path(state: &AppStoreData) -> Option<&str> {
    state
        .use_custom_css
        .then_some(state.custom_css.path.as_deref())
        .flatten()
}

pub(super) fn collect_authorized_css_paths(state: &AppStoreData) -> HashSet<String> {
    state
        .custom_css
        .path
        .iter()
        .chain(
            state
                .tab_css_overrides
                .values()
                .filter_map(|css| css.path.as_ref()),
        )
        .map(|path| path_identity_key(Path::new(path)))
        .collect()
}
