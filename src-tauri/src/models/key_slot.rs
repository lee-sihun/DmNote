use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub const MAX_SLOT_KEYS: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SlotMatch {
    All,
    Any,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged, from = "RawKeySlot")]
pub enum KeySlot {
    Single(String),
    Multi {
        keys: Vec<String>,
        #[serde(rename = "match")]
        match_mode: SlotMatch,
    },
}

#[derive(Deserialize)]
#[serde(transparent)]
struct RawKeySlot(serde_json::Value);

impl From<RawKeySlot> for KeySlot {
    fn from(raw: RawKeySlot) -> Self {
        normalize_key_slot(raw.0)
    }
}

impl From<String> for KeySlot {
    fn from(value: String) -> Self {
        Self::Single(value)
    }
}

impl From<&str> for KeySlot {
    fn from(value: &str) -> Self {
        Self::Single(value.to_string())
    }
}

impl Default for KeySlot {
    fn default() -> Self {
        Self::Single(String::new())
    }
}

impl KeySlot {
    pub fn canonical(&self) -> String {
        match self {
            Self::Single(key) => key.clone(),
            Self::Multi {
                keys,
                match_mode: SlotMatch::All,
            } => keys.join("+"),
            Self::Multi {
                keys,
                match_mode: SlotMatch::Any,
            } => keys.join("|"),
        }
    }

    pub fn members(&self) -> std::slice::Iter<'_, String> {
        match self {
            Self::Single(key) => std::slice::from_ref(key).iter(),
            Self::Multi { keys, .. } => keys.iter(),
        }
    }

    pub fn is_unassigned(&self) -> bool {
        matches!(self, Self::Single(key) if key.is_empty())
    }

    pub fn is_multi(&self) -> bool {
        matches!(self, Self::Multi { .. })
    }
}

pub fn normalize_key_slot(raw: serde_json::Value) -> KeySlot {
    match raw {
        serde_json::Value::String(key) => {
            if (key.contains('+') && key != "+") || key.contains('|') {
                log::warn!(
                    "[Store] Key slot string contains a reserved canonical separator and may collide visually"
                );
            }
            KeySlot::Single(key)
        }
        serde_json::Value::Object(object) => {
            let has_unknown_fields = object.keys().any(|key| key != "keys" && key != "match");
            let match_mode = match object.get("match").and_then(serde_json::Value::as_str) {
                Some("all") => SlotMatch::All,
                Some("any") => SlotMatch::Any,
                _ => {
                    log::warn!("[Store] Normalized an invalid multi-key slot to an unassigned key");
                    return KeySlot::default();
                }
            };

            let mut changed = has_unknown_fields;
            let mut seen = HashSet::new();
            let mut keys = Vec::new();
            let entries = match object.get("keys") {
                Some(serde_json::Value::Array(entries)) => entries.as_slice(),
                _ => {
                    changed = true;
                    &[]
                }
            };
            for entry in entries {
                let Some(key) = entry.as_str() else {
                    changed = true;
                    continue;
                };
                if key.is_empty() || key.contains('+') || key.contains('|') {
                    changed = true;
                    continue;
                }
                if !seen.insert(key.to_string()) {
                    changed = true;
                    continue;
                }
                if keys.len() == MAX_SLOT_KEYS {
                    changed = true;
                    continue;
                }
                keys.push(key.to_string());
            }

            let normalized = match keys.len() {
                0 => KeySlot::default(),
                1 => KeySlot::Single(keys.pop().unwrap_or_default()),
                _ => KeySlot::Multi { keys, match_mode },
            };
            changed |= !normalized.is_multi();
            if changed {
                log::warn!("[Store] Normalized a malformed multi-key slot");
            }
            normalized
        }
        _ => {
            log::warn!("[Store] Normalized an invalid key slot to an unassigned key");
            KeySlot::default()
        }
    }
}

pub fn normalize_key_mappings(mappings: &mut HashMap<String, Vec<KeySlot>>) {
    for slot in mappings.values_mut().flatten() {
        let raw = serde_json::to_value(&*slot).unwrap_or(serde_json::Value::Null);
        *slot = normalize_key_slot(raw);
    }
}

pub fn key_mappings_contain_multi(mappings: &HashMap<String, Vec<KeySlot>>) -> bool {
    mappings.values().flatten().any(KeySlot::is_multi)
}

pub type KeyMappings = HashMap<String, Vec<KeySlot>>;
