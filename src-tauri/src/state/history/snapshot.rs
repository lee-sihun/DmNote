use std::collections::{HashMap, HashSet};

use serde::Serialize;
use serde_json::Value;

use crate::models::{
    AppStoreData, CustomCss, CustomJs, CustomTab, EditorDocumentV1, EditorField, EditorPatchV1,
    FontSettings, KeyCounters, NoteSettings, SavedPluginInstance, TabCss, TabCssOverrides,
    TabNoteOverrides, TabNoteSettings,
};
use crate::state::plugin::{is_plugin_instances_storage_key, plugin_id_from_instances_storage_key};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum HistoryScope {
    Editor,
    CustomTabs,
    Mode,
    Counters,
    PresetFull,
    PluginElements,
    Compound,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HistoryDirection {
    Undo,
    Redo,
}

impl HistoryDirection {
    pub(crate) fn empty_error(self) -> &'static str {
        match self {
            Self::Undo => "HISTORY_NOTHING_TO_UNDO",
            Self::Redo => "HISTORY_NOTHING_TO_REDO",
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct HistoryEntry {
    pub(crate) scope: HistoryScope,
    pub(crate) before: HistorySnapshot,
    pub(crate) gesture_id: Option<String>,
    pub(crate) gesture_ids: Vec<String>,
    pub(super) size_bytes: usize,
    pub(super) access_sequence: u64,
}

impl HistoryEntry {
    pub(super) fn matches_any_gesture(&self, gesture_ids: &[String]) -> bool {
        gesture_ids
            .iter()
            .any(|gesture_id| self.gesture_ids.contains(gesture_id))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CustomTabsHistorySnapshot {
    pub(crate) document: EditorDocumentV1,
    pub(crate) custom_tabs: Vec<CustomTab>,
    pub(crate) tab_order: Vec<String>,
    pub(crate) bar_count: u8,
    pub(crate) selected_key_type: String,
    pub(crate) key_counters: KeyCounters,
    pub(crate) tab_css_patch: HashMap<String, Option<TabCss>>,
    pub(crate) tab_note_patch: HashMap<String, Option<TabNoteSettings>>,
    pub(crate) plugin_instances_patch: HashMap<String, Option<Value>>,
}

impl CustomTabsHistorySnapshot {
    pub(crate) fn from_transition(before: &AppStoreData, after: &AppStoreData) -> Self {
        Self {
            document: EditorDocumentV1::from_store(before),
            custom_tabs: before.custom_tabs.clone(),
            tab_order: before.tab_order.clone(),
            bar_count: before.bar_count,
            selected_key_type: before.selected_key_type.clone(),
            key_counters: before.key_counters.clone(),
            tab_css_patch: changed_value_patch(&before.tab_css_overrides, &after.tab_css_overrides),
            tab_note_patch: changed_value_patch(
                &before.tab_note_overrides,
                &after.tab_note_overrides,
            ),
            plugin_instances_patch: changed_value_patch(&before.plugin_data, &after.plugin_data)
                .into_iter()
                .filter(|(key, _)| is_plugin_instances_storage_key(key))
                .collect(),
        }
    }

    pub(crate) fn from_store_for_target(store: &AppStoreData, target: &Self) -> Self {
        Self {
            document: EditorDocumentV1::from_store(store),
            custom_tabs: store.custom_tabs.clone(),
            tab_order: store.tab_order.clone(),
            bar_count: store.bar_count,
            selected_key_type: store.selected_key_type.clone(),
            key_counters: store.key_counters.clone(),
            tab_css_patch: current_values_for_keys(
                &store.tab_css_overrides,
                target.tab_css_patch.keys(),
            ),
            tab_note_patch: current_values_for_keys(
                &store.tab_note_overrides,
                target.tab_note_patch.keys(),
            ),
            plugin_instances_patch: current_values_for_keys(
                &store.plugin_data,
                target.plugin_instances_patch.keys(),
            ),
        }
    }

    pub(crate) fn matches_store(&self, store: &AppStoreData) -> bool {
        self.document == EditorDocumentV1::from_store(store)
            && self.custom_tabs == store.custom_tabs
            && self.tab_order == store.tab_order
            && self.bar_count == store.bar_count
            && self.selected_key_type == store.selected_key_type
            && patch_matches(&self.tab_css_patch, &store.tab_css_overrides)
            && patch_matches(&self.tab_note_patch, &store.tab_note_overrides)
            && patch_matches(&self.plugin_instances_patch, &store.plugin_data)
    }

    pub(crate) fn apply_override_patches(&self, store: &mut AppStoreData) {
        apply_value_patch(&self.tab_css_patch, &mut store.tab_css_overrides);
        apply_value_patch(&self.tab_note_patch, &mut store.tab_note_overrides);
        apply_value_patch(&self.plugin_instances_patch, &mut store.plugin_data);
    }

    pub(crate) fn changed_plugin_ids(&self) -> Vec<String> {
        let mut plugin_ids = self
            .plugin_instances_patch
            .keys()
            .filter_map(|key| plugin_id_from_instances_storage_key(key))
            .map(str::to_string)
            .collect::<Vec<_>>();
        plugin_ids.sort_unstable();
        plugin_ids.dedup();
        plugin_ids
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PresetHistorySettingsSnapshot {
    pub(crate) use_custom_css: bool,
    pub(crate) custom_css: CustomCss,
    pub(crate) use_custom_js: bool,
    pub(crate) custom_js: CustomJs,
    pub(crate) font_settings: FontSettings,
    pub(crate) background_color: String,
    pub(crate) note_settings: NoteSettings,
    pub(crate) note_effect: bool,
    pub(crate) laboratory_enabled: bool,
    pub(crate) tab_note_overrides: TabNoteOverrides,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PresetFullHistorySnapshot {
    pub(crate) document: EditorDocumentV1,
    pub(crate) custom_tabs: Vec<CustomTab>,
    pub(crate) tab_order: Vec<String>,
    pub(crate) bar_count: u8,
    pub(crate) selected_key_type: String,
    pub(crate) key_counters: KeyCounters,
    pub(crate) settings: PresetHistorySettingsSnapshot,
    pub(crate) tab_css_overrides: TabCssOverrides,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginElementsHistorySnapshot {
    pub(crate) plugin_id: String,
    pub(crate) instances: Option<Vec<SavedPluginInstance>>,
}

impl PresetFullHistorySnapshot {
    pub(crate) fn from_store(store: &AppStoreData) -> Self {
        Self {
            document: EditorDocumentV1::from_store(store),
            custom_tabs: store.custom_tabs.clone(),
            tab_order: store.tab_order.clone(),
            bar_count: store.bar_count,
            selected_key_type: store.selected_key_type.clone(),
            key_counters: store.key_counters.clone(),
            settings: PresetHistorySettingsSnapshot {
                use_custom_css: store.use_custom_css,
                custom_css: store.custom_css.clone(),
                use_custom_js: store.use_custom_js,
                custom_js: store.custom_js.clone(),
                font_settings: store.font_settings.clone(),
                background_color: store.background_color.clone(),
                note_settings: store.note_settings.clone(),
                note_effect: store.note_effect,
                laboratory_enabled: store.laboratory_enabled,
                tab_note_overrides: store.tab_note_overrides.clone(),
            },
            tab_css_overrides: store.tab_css_overrides.clone(),
        }
    }

    pub(crate) fn matches_store(&self, store: &AppStoreData) -> bool {
        let current = Self::from_store(store);
        self.document == current.document
            && self.custom_tabs == current.custom_tabs
            && self.tab_order == current.tab_order
            && self.bar_count == current.bar_count
            && self.selected_key_type == current.selected_key_type
            && self.settings == current.settings
            && self.tab_css_overrides == current.tab_css_overrides
    }
}

fn changed_value_patch<T: Clone + PartialEq>(
    before: &HashMap<String, T>,
    after: &HashMap<String, T>,
) -> HashMap<String, Option<T>> {
    before
        .keys()
        .chain(after.keys())
        .collect::<HashSet<_>>()
        .into_iter()
        .filter(|key| before.get(*key) != after.get(*key))
        .map(|key| (key.clone(), before.get(key).cloned()))
        .collect()
}

fn current_values_for_keys<'a, T: Clone + 'a>(
    values: &HashMap<String, T>,
    keys: impl Iterator<Item = &'a String>,
) -> HashMap<String, Option<T>> {
    keys.map(|key| (key.clone(), values.get(key).cloned()))
        .collect()
}

fn patch_matches<T: PartialEq>(
    patch: &HashMap<String, Option<T>>,
    values: &HashMap<String, T>,
) -> bool {
    patch
        .iter()
        .all(|(key, value)| values.get(key) == value.as_ref())
}

fn apply_value_patch<T: Clone>(
    patch: &HashMap<String, Option<T>>,
    values: &mut HashMap<String, T>,
) {
    for (key, value) in patch {
        match value {
            Some(value) => {
                values.insert(key.clone(), value.clone());
            }
            None => {
                values.remove(key);
            }
        }
    }
}

fn preserve_editor_before_values(merged: &mut EditorPatchV1, first: &EditorPatchV1) {
    if first.keys.is_some() {
        merged.keys.clone_from(&first.keys);
    }
    if first.key_positions.is_some() {
        merged.key_positions.clone_from(&first.key_positions);
    }
    if first.stat_positions.is_some() {
        merged.stat_positions.clone_from(&first.stat_positions);
    }
    if first.graph_positions.is_some() {
        merged.graph_positions.clone_from(&first.graph_positions);
    }
    if first.knob_positions.is_some() {
        merged.knob_positions.clone_from(&first.knob_positions);
    }
    if first.layer_groups.is_some() {
        merged.layer_groups.clone_from(&first.layer_groups);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub(crate) enum HistorySnapshot {
    Editor {
        changed_fields: Vec<EditorField>,
        before: Box<EditorPatchV1>,
        #[serde(skip_serializing_if = "Option::is_none")]
        key_counters: Option<KeyCounters>,
    },
    CustomTabs(Box<CustomTabsHistorySnapshot>),
    Mode(String),
    Counters(KeyCounters),
    PresetFull(Box<PresetFullHistorySnapshot>),
    PluginElements(PluginElementsHistorySnapshot),
    Compound {
        snapshots: Vec<HistorySnapshot>,
    },
}

impl HistorySnapshot {
    pub(crate) fn scope(&self) -> HistoryScope {
        match self {
            Self::Editor { .. } => HistoryScope::Editor,
            Self::CustomTabs(_) => HistoryScope::CustomTabs,
            Self::Mode(_) => HistoryScope::Mode,
            Self::Counters(_) => HistoryScope::Counters,
            Self::PresetFull(_) => HistoryScope::PresetFull,
            Self::PluginElements(_) => HistoryScope::PluginElements,
            Self::Compound { .. } => HistoryScope::Compound,
        }
    }
}

fn merged_editor_before(
    first_fields: &[EditorField],
    first_before: &EditorPatchV1,
    first_key_counters: &Option<KeyCounters>,
    changed_fields: Vec<EditorField>,
    before: EditorPatchV1,
    key_counters: Option<KeyCounters>,
) -> HistorySnapshot {
    let mut merged_fields = first_fields.to_vec();
    for field in changed_fields {
        if !merged_fields.contains(&field) {
            merged_fields.push(field);
        }
    }
    let mut merged_before = before;
    preserve_editor_before_values(&mut merged_before, first_before);
    let key_counters = if first_fields.contains(&EditorField::Keys) {
        first_key_counters.clone().or(key_counters)
    } else if merged_fields.contains(&EditorField::Keys) {
        key_counters
    } else {
        None
    };
    HistorySnapshot::Editor {
        changed_fields: merged_fields,
        before: Box::new(merged_before),
        key_counters,
    }
}

pub(super) fn merge_editor_snapshot(
    existing: &HistorySnapshot,
    changed_fields: Vec<EditorField>,
    before: EditorPatchV1,
    key_counters: Option<KeyCounters>,
) -> Result<HistorySnapshot, String> {
    match existing {
        HistorySnapshot::Editor {
            changed_fields: first_fields,
            before: first_before,
            key_counters: first_key_counters,
        } => Ok(merged_editor_before(
            first_fields,
            first_before,
            first_key_counters,
            changed_fields,
            before,
            key_counters,
        )),
        HistorySnapshot::PluginElements(_) => Ok(HistorySnapshot::Compound {
            snapshots: vec![
                existing.clone(),
                HistorySnapshot::Editor {
                    changed_fields,
                    before: Box::new(before),
                    key_counters,
                },
            ],
        }),
        HistorySnapshot::Compound { snapshots } => {
            validate_compound_snapshots(snapshots)?;
            let mut merged = snapshots.clone();
            if let Some(index) = merged
                .iter()
                .position(|snapshot| matches!(snapshot, HistorySnapshot::Editor { .. }))
            {
                let HistorySnapshot::Editor {
                    changed_fields: first_fields,
                    before: first_before,
                    key_counters: first_key_counters,
                } = &merged[index]
                else {
                    unreachable!();
                };
                merged[index] = merged_editor_before(
                    first_fields,
                    first_before,
                    first_key_counters,
                    changed_fields,
                    before,
                    key_counters,
                );
            } else {
                merged.push(HistorySnapshot::Editor {
                    changed_fields,
                    before: Box::new(before),
                    key_counters,
                });
            }
            Ok(HistorySnapshot::Compound { snapshots: merged })
        }
        _ => Err("gesture history cannot merge editor with this scope".to_string()),
    }
}

pub(super) fn merge_plugin_elements_snapshot(
    existing: &HistorySnapshot,
    before: PluginElementsHistorySnapshot,
) -> Result<HistorySnapshot, String> {
    match existing {
        HistorySnapshot::Editor { .. } => Ok(HistorySnapshot::Compound {
            snapshots: vec![existing.clone(), HistorySnapshot::PluginElements(before)],
        }),
        HistorySnapshot::PluginElements(first_before) => {
            if first_before.plugin_id == before.plugin_id {
                Ok(existing.clone())
            } else {
                Ok(HistorySnapshot::Compound {
                    snapshots: vec![existing.clone(), HistorySnapshot::PluginElements(before)],
                })
            }
        }
        HistorySnapshot::Compound { snapshots } => {
            validate_compound_snapshots(snapshots)?;
            if snapshots.iter().any(|snapshot| {
                matches!(
                    snapshot,
                    HistorySnapshot::PluginElements(first_before)
                        if first_before.plugin_id == before.plugin_id
                )
            }) {
                return Ok(existing.clone());
            }
            let mut merged = snapshots.clone();
            merged.push(HistorySnapshot::PluginElements(before));
            Ok(HistorySnapshot::Compound { snapshots: merged })
        }
        _ => Err("gesture history cannot merge plugin elements with this scope".to_string()),
    }
}

pub(super) fn merge_gesture_snapshots(
    existing: &HistorySnapshot,
    snapshots: &[HistorySnapshot],
) -> Result<HistorySnapshot, String> {
    let mut merged = existing.clone();
    for snapshot in snapshots {
        merged = match snapshot {
            HistorySnapshot::Editor {
                changed_fields,
                before,
                key_counters,
            } => merge_editor_snapshot(
                &merged,
                changed_fields.clone(),
                before.as_ref().clone(),
                key_counters.clone(),
            )?,
            HistorySnapshot::PluginElements(before) => {
                merge_plugin_elements_snapshot(&merged, before.clone())?
            }
            _ => return Err("gesture history cannot merge this snapshot scope".to_string()),
        };
    }
    Ok(merged)
}

pub(super) fn validate_compound_snapshots(snapshots: &[HistorySnapshot]) -> Result<(), String> {
    let mut has_editor = false;
    let mut plugin_ids = HashSet::new();
    for snapshot in snapshots {
        match snapshot {
            HistorySnapshot::Editor { .. } if !has_editor => has_editor = true,
            HistorySnapshot::PluginElements(before)
                if plugin_ids.insert(before.plugin_id.as_str()) => {}
            HistorySnapshot::Editor { .. } => {
                return Err("compound history contains duplicate editor snapshots".to_string())
            }
            HistorySnapshot::PluginElements(_) => {
                return Err("compound history contains duplicate plugin snapshots".to_string())
            }
            _ => return Err("compound history contains an unsupported snapshot".to_string()),
        }
    }
    if snapshots.is_empty() {
        return Err("compound history cannot be empty".to_string());
    }
    Ok(())
}

pub(super) fn normalize_gesture_ids(gesture_ids: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::with_capacity(gesture_ids.len());
    for gesture_id in gesture_ids {
        if !normalized.contains(&gesture_id) {
            normalized.push(gesture_id);
        }
    }
    normalized
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct HistoryEntryPayload<'a> {
    pub(super) scope: HistoryScope,
    pub(super) before: &'a HistorySnapshot,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(super) gesture_ids: &'a Vec<String>,
}

fn refresh_history_entry_size(entry: &mut HistoryEntry) {
    if let Ok(payload) = serde_json::to_vec(&HistoryEntryPayload {
        scope: entry.scope,
        before: &entry.before,
        gesture_ids: &entry.gesture_ids,
    }) {
        entry.size_bytes = payload.len();
    }
}

pub(super) fn remove_net_zero_editor_snapshot(
    entry: &mut HistoryEntry,
    canonical: &EditorDocumentV1,
) -> bool {
    let editor_is_net_zero = |snapshot: &HistorySnapshot| {
        matches!(
            snapshot,
            HistorySnapshot::Editor {
                changed_fields,
                before,
                ..
            } if canonical.patch_for_fields(changed_fields) == **before
        )
    };
    match &mut entry.before {
        snapshot @ HistorySnapshot::Editor { .. } if editor_is_net_zero(snapshot) => return true,
        HistorySnapshot::Compound { snapshots } => {
            snapshots.retain(|snapshot| !editor_is_net_zero(snapshot));
        }
        _ => {}
    }
    refresh_history_entry_size(entry);
    matches!(&entry.before, HistorySnapshot::Compound { snapshots } if snapshots.is_empty())
}

pub(super) fn remove_net_zero_plugin_snapshot(
    entry: &mut HistoryEntry,
    canonical: &PluginElementsHistorySnapshot,
) -> bool {
    let plugin_is_net_zero = |snapshot: &HistorySnapshot| matches!(snapshot, HistorySnapshot::PluginElements(before) if before == canonical);
    match &mut entry.before {
        snapshot @ HistorySnapshot::PluginElements(_) if plugin_is_net_zero(snapshot) => {
            return true
        }
        HistorySnapshot::Compound { snapshots } => {
            snapshots.retain(|snapshot| !plugin_is_net_zero(snapshot));
        }
        _ => {}
    }
    refresh_history_entry_size(entry);
    matches!(&entry.before, HistorySnapshot::Compound { snapshots } if snapshots.is_empty())
}

#[derive(Debug)]
pub(crate) enum HistoryRecordPlan {
    Entry(Box<HistoryEntry>),
    Merge {
        entry: Box<HistoryEntry>,
        target_access_sequence: u64,
        remove_access_sequences: Vec<u64>,
    },
    Truncate,
}

pub(super) fn snapshot_contains_plugin_elements(
    snapshot: &HistorySnapshot,
    plugin_id: Option<&str>,
) -> bool {
    match snapshot {
        HistorySnapshot::PluginElements(snapshot) => {
            plugin_id.is_none_or(|plugin_id| snapshot.plugin_id == plugin_id)
        }
        HistorySnapshot::Compound { snapshots } => snapshots
            .iter()
            .any(|snapshot| snapshot_contains_plugin_elements(snapshot, plugin_id)),
        HistorySnapshot::CustomTabs(snapshot) => snapshot
            .changed_plugin_ids()
            .iter()
            .any(|candidate| plugin_id.is_none_or(|plugin_id| candidate == plugin_id)),
        HistorySnapshot::Editor { .. }
        | HistorySnapshot::Mode(_)
        | HistorySnapshot::Counters(_)
        | HistorySnapshot::PresetFull(_) => false,
    }
}
