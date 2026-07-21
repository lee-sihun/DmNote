use std::{collections::HashSet, sync::Arc};

use parking_lot::RwLock;

use crate::models::KeyMappings;

#[derive(Clone)]
pub struct KeyboardManager {
    mappings: Arc<RwLock<KeyMappings>>,
    current_mode: Arc<RwLock<String>>,
    valid_keys: Arc<RwLock<HashSet<String>>>,
    active_keys: Arc<RwLock<HashSet<String>>>,
}

impl KeyboardManager {
    pub fn new(initial: KeyMappings, default_mode: impl Into<String>) -> Self {
        let mappings = Arc::new(RwLock::new(initial));
        let current_mode = Arc::new(RwLock::new(default_mode.into()));
        let manager = Self {
            mappings,
            current_mode,
            valid_keys: Arc::new(RwLock::new(HashSet::new())),
            active_keys: Arc::new(RwLock::new(HashSet::new())),
        };
        manager.rebuild_valid_keys();
        manager
    }

    pub fn set_mode(&self, mode: impl Into<String>) -> bool {
        let mode = mode.into();
        let mappings = self.mappings.read();
        if !mappings.contains_key(&mode) {
            return false;
        }

        let next_valid_keys = Self::valid_keys_for_mode(&mappings, &mode);
        let mut current_mode = self.current_mode.write();
        let mut valid_keys = self.valid_keys.write();
        let mut active_keys = self.active_keys.write();

        Self::rekey_active_keys(&mut active_keys, &current_mode, &mode, &next_valid_keys);
        *current_mode = mode;
        *valid_keys = next_valid_keys;
        true
    }

    pub fn update_mappings_and_set_mode(
        &self,
        mappings: KeyMappings,
        mode: impl Into<String>,
    ) -> bool {
        let mode = mode.into();
        let mode_exists = mappings.contains_key(&mode);
        let mut mappings_guard = self.mappings.write();
        let mut current_mode = self.current_mode.write();
        let next_mode = if mode_exists {
            mode.as_str()
        } else {
            current_mode.as_str()
        };
        let next_valid_keys = Self::valid_keys_for_mode(&mappings, next_mode);
        let mut valid_keys = self.valid_keys.write();
        let mut active_keys = self.active_keys.write();

        if mode_exists {
            Self::rekey_active_keys(&mut active_keys, &current_mode, &mode, &next_valid_keys);
            *current_mode = mode;
        } else {
            Self::retain_active_keys(&mut active_keys, &current_mode, &next_valid_keys);
        }

        *mappings_guard = mappings;
        *valid_keys = next_valid_keys;
        mode_exists
    }

    pub fn update_mappings(&self, mappings: KeyMappings) {
        let mut mappings_guard = self.mappings.write();
        let current_mode = self.current_mode.read();
        let next_valid_keys = Self::valid_keys_for_mode(&mappings, &current_mode);
        let mut valid_keys = self.valid_keys.write();
        let mut active_keys = self.active_keys.write();

        Self::retain_active_keys(&mut active_keys, &current_mode, &next_valid_keys);
        *mappings_guard = mappings;
        *valid_keys = next_valid_keys;
    }

    pub fn current_mode(&self) -> String {
        self.current_mode.read().clone()
    }

    pub fn match_and_register<'a>(
        &self,
        candidates: impl IntoIterator<Item = &'a str>,
        is_down: bool,
    ) -> Option<(String, String, bool)> {
        let current_mode = self.current_mode.read();
        let valid_keys = self.valid_keys.read();
        let key = candidates
            .into_iter()
            .find(|candidate| valid_keys.contains(*candidate))?
            .to_string();
        let mut active_keys = self.active_keys.write();
        let active_key = Self::compose_active_key(&current_mode, &key);
        let changed = if is_down {
            active_keys.insert(active_key)
        } else {
            active_keys.remove(&active_key)
        };

        Some((current_mode.clone(), key, changed))
    }

    #[cfg(test)]
    pub fn register_key_down(&self, mode: &str, key: &str) -> bool {
        let current_mode = self.current_mode.read();
        if current_mode.as_str() != mode {
            return false;
        }
        let valid_keys = self.valid_keys.read();
        if !valid_keys.contains(key) {
            return false;
        }
        self.active_keys
            .write()
            .insert(Self::compose_active_key(&current_mode, key))
    }

    #[cfg(test)]
    pub fn register_key_up(&self, mode: &str, key: &str) -> bool {
        let current_mode = self.current_mode.read();
        if current_mode.as_str() != mode {
            return false;
        }
        let valid_keys = self.valid_keys.read();
        if !valid_keys.contains(key) {
            return false;
        }
        self.active_keys
            .write()
            .remove(&Self::compose_active_key(&current_mode, key))
    }

    pub fn clear_active_keys(&self) {
        self.active_keys.write().clear();
    }

    pub fn pressed_keys(&self) -> Vec<String> {
        let current_mode = self.current_mode.read();
        let prefix = format!("{current_mode}::");
        let active_keys = self.active_keys.read();
        let mut keys: Vec<String> = active_keys
            .iter()
            .filter_map(|entry| entry.strip_prefix(&prefix).map(str::to_string))
            .collect();
        keys.sort();
        keys
    }

    fn rebuild_valid_keys(&self) {
        let mappings = self.mappings.read();
        let mode = self.current_mode.read();
        *self.valid_keys.write() = Self::valid_keys_for_mode(&mappings, &mode);
    }

    fn valid_keys_for_mode(mappings: &KeyMappings, mode: &str) -> HashSet<String> {
        mappings.get(mode).into_iter().flatten().cloned().collect()
    }

    fn retain_active_keys(
        active_keys: &mut HashSet<String>,
        mode: &str,
        valid_keys: &HashSet<String>,
    ) {
        let prefix = format!("{mode}::");
        active_keys.retain(|entry| {
            entry
                .strip_prefix(&prefix)
                .is_some_and(|key| valid_keys.contains(key))
        });
    }

    fn rekey_active_keys(
        active_keys: &mut HashSet<String>,
        current_mode: &str,
        next_mode: &str,
        next_valid_keys: &HashSet<String>,
    ) {
        let prefix = format!("{current_mode}::");
        *active_keys = active_keys
            .drain()
            .filter_map(|entry| {
                let key = entry.strip_prefix(&prefix)?;
                next_valid_keys
                    .contains(key)
                    .then(|| Self::compose_active_key(next_mode, key))
            })
            .collect();
    }

    fn compose_active_key(mode: &str, key: &str) -> String {
        format!("{mode}::{key}")
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::KeyboardManager;

    #[test]
    fn pressed_keys_use_event_key_names_for_current_mode() {
        let mappings = HashMap::from([
            (
                "4key".to_string(),
                vec!["KeyD".to_string(), "KeyF".to_string()],
            ),
            (
                "8key".to_string(),
                vec!["KeyD".to_string(), "KeyF".to_string()],
            ),
        ]);
        let manager = KeyboardManager::new(mappings, "4key");

        assert!(manager.register_key_down("4key", "KeyF"));
        assert!(manager.register_key_down("4key", "KeyD"));
        assert_eq!(manager.pressed_keys(), vec!["KeyD", "KeyF"]);

        assert!(manager.set_mode("8key"));
        assert_eq!(manager.pressed_keys(), vec!["KeyD", "KeyF"]);
        assert!(manager.register_key_up("8key", "KeyD"));
        assert_eq!(manager.pressed_keys(), vec!["KeyF"]);
    }

    #[test]
    fn mode_switch_retains_only_shared_active_keys() {
        let mappings = HashMap::from([
            (
                "source".to_string(),
                vec!["KeyD".to_string(), "KeyF".to_string()],
            ),
            (
                "target".to_string(),
                vec!["KeyF".to_string(), "KeyJ".to_string()],
            ),
        ]);
        let manager = KeyboardManager::new(mappings, "source");

        assert!(manager.register_key_down("source", "KeyD"));
        assert!(manager.register_key_down("source", "KeyF"));
        assert!(manager.set_mode("target"));

        assert_eq!(manager.pressed_keys(), vec!["KeyF"]);
        assert!(!manager.register_key_up("target", "KeyD"));
        assert!(manager.register_key_up("target", "KeyF"));
    }

    #[test]
    fn reset_to_empty_mapping_clears_active_keys() {
        let manager = KeyboardManager::new(
            HashMap::from([("custom".to_string(), vec!["KeyD".to_string()])]),
            "custom",
        );
        assert!(manager.register_key_down("custom", "KeyD"));

        manager.update_mappings_and_set_mode(
            HashMap::from([("custom".to_string(), Vec::new())]),
            "custom".to_string(),
        );

        assert!(manager.pressed_keys().is_empty());
        assert!(!manager.register_key_up("custom", "KeyD"));
    }

    #[test]
    fn update_mappings_and_mode_prunes_removed_active_keys() {
        let manager = KeyboardManager::new(
            HashMap::from([(
                "4key".to_string(),
                vec!["KeyD".to_string(), "KeyF".to_string()],
            )]),
            "4key",
        );
        assert!(manager.register_key_down("4key", "KeyD"));
        assert!(manager.register_key_down("4key", "KeyF"));

        manager.update_mappings_and_set_mode(
            HashMap::from([(
                "4key".to_string(),
                vec!["KeyF".to_string(), "KeyJ".to_string()],
            )]),
            "4key".to_string(),
        );

        assert_eq!(manager.pressed_keys(), vec!["KeyF"]);
        assert!(!manager.register_key_up("4key", "KeyD"));
        assert!(manager.register_key_up("4key", "KeyF"));
    }

    #[test]
    fn stale_mode_or_invalid_key_registration_is_rejected() {
        let manager = KeyboardManager::new(
            HashMap::from([
                ("source".to_string(), vec!["KeyD".to_string()]),
                ("target".to_string(), vec!["KeyF".to_string()]),
            ]),
            "source",
        );

        assert!(manager.set_mode("target"));
        assert!(!manager.register_key_down("target", "KeyD"));
        assert!(!manager.register_key_down("source", "KeyD"));
        assert!(manager.pressed_keys().is_empty());
    }

    #[test]
    fn matching_and_registration_share_one_mode_snapshot() {
        let manager = KeyboardManager::new(
            HashMap::from([
                ("source".to_string(), vec!["KeyD".to_string()]),
                ("target".to_string(), vec!["KeyF".to_string()]),
            ]),
            "source",
        );

        assert_eq!(
            manager.match_and_register(["KeyD"], true),
            Some(("source".to_string(), "KeyD".to_string(), true))
        );
        assert!(manager.set_mode("target"));
        assert!(manager.pressed_keys().is_empty());
        assert_eq!(manager.match_and_register(["KeyD"], true), None);
    }
}
