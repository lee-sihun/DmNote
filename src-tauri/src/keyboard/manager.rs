use std::{collections::HashSet, sync::Arc};

use parking_lot::RwLock;

use crate::models::KeyMappings;

#[derive(Clone)]
pub struct KeyboardManager {
    mappings: Arc<RwLock<KeyMappings>>,
    current_mode: Arc<RwLock<String>>,
    valid_keys: Arc<RwLock<HashSet<String>>>,
}

impl KeyboardManager {
    pub fn new(initial: KeyMappings, default_mode: impl Into<String>) -> Self {
        let mappings = Arc::new(RwLock::new(initial));
        let current_mode = Arc::new(RwLock::new(default_mode.into()));
        let manager = Self {
            mappings,
            current_mode,
            valid_keys: Arc::new(RwLock::new(HashSet::new())),
        };
        manager.rebuild_valid_keys();
        manager
    }

    pub fn update_mappings(&self, mappings: KeyMappings) {
        *self.mappings.write() = mappings;
        self.rebuild_valid_keys();
    }

    pub fn set_mode(&self, mode: impl Into<String>) -> bool {
        let mode = mode.into();
        let exists = self.mappings.read().contains_key(&mode);
        if exists {
            *self.current_mode.write() = mode;
            self.rebuild_valid_keys();
        }
        exists
    }

    pub fn current_mode(&self) -> String {
        self.current_mode.read().clone()
    }

    pub fn match_candidate<'a>(
        &self,
        candidates: impl IntoIterator<Item = &'a str>,
    ) -> Option<String> {
        let guard = self.valid_keys.read();
        for candidate in candidates {
            if guard.contains(candidate) {
                return Some(candidate.to_string());
            }
        }
        None
    }

    fn rebuild_valid_keys(&self) {
        let mappings = self.mappings.read();
        let mode = self.current_mode.read();
        let keys = mappings.get(mode.as_str()).cloned().unwrap_or_default();
        let mut guard = self.valid_keys.write();
        guard.clear();
        for key in keys {
            guard.insert(key);
        }
    }
}
