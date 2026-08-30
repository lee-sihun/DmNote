use std::collections::{HashMap, HashSet, VecDeque};

use serde::Serialize;
use serde_json::Value;

mod admission;

pub(crate) use admission::{
    HistoryAdmission, HistoryAdmissionGate, HistoryAdmissionLease, HistoryBarrierLease,
    HistoryBarrierWaiter,
};

use crate::models::{
    AppStoreData, CustomCss, CustomJs, CustomTab, EditorDocumentV1, EditorField, EditorPatchV1,
    FontSettings, HistoryStatus, HistoryTruncated, KeyCounters, NoteSettings, SavedPluginInstance,
    TabCss, TabCssOverrides, TabNoteOverrides, TabNoteSettings,
};
use crate::state::plugin::{is_plugin_instances_storage_key, plugin_id_from_instances_storage_key};

pub(crate) const HISTORY_ENTRY_MAX_BYTES: usize = 8 * 1024 * 1024;
const HISTORY_TOTAL_MAX_BYTES: usize = 32 * 1024 * 1024;
const HISTORY_MAX_ENTRIES: usize = 50;
const HISTORY_OPERATION_ACK_CAPACITY: usize = 64;
pub(crate) const HISTORY_IN_PROGRESS: &str = "HISTORY_IN_PROGRESS";
pub(crate) const HISTORY_ENTRY_TOO_LARGE: &str = "HISTORY_ENTRY_TOO_LARGE";
pub(crate) const INVALID_HISTORY_OPERATION_ID: &str = "INVALID_HISTORY_OPERATION_ID";
pub(crate) const HISTORY_OPERATION_ID_REUSED: &str = "HISTORY_OPERATION_ID_REUSED";
pub(crate) const HISTORY_SCOPE_MISMATCH: &str = "HISTORY_SCOPE_MISMATCH";
pub(crate) const HISTORY_TARGET_ALREADY_APPLIED: &str = "HISTORY_TARGET_ALREADY_APPLIED";
pub(crate) const HISTORY_INVALID_OPPOSITE_ENTRY: &str = "HISTORY_INVALID_OPPOSITE_ENTRY";

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
    size_bytes: usize,
    access_sequence: u64,
}

impl HistoryEntry {
    fn matches_any_gesture(&self, gesture_ids: &[String]) -> bool {
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

fn merge_editor_snapshot(
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

fn merge_plugin_elements_snapshot(
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

fn merge_gesture_snapshots(
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

fn validate_compound_snapshots(snapshots: &[HistorySnapshot]) -> Result<(), String> {
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

fn normalize_gesture_ids(gesture_ids: Vec<String>) -> Vec<String> {
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
struct HistoryEntryPayload<'a> {
    scope: HistoryScope,
    before: &'a HistorySnapshot,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    gesture_ids: &'a Vec<String>,
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

fn remove_net_zero_editor_snapshot(entry: &mut HistoryEntry, canonical: &EditorDocumentV1) -> bool {
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

fn remove_net_zero_plugin_snapshot(
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

#[derive(Debug, Clone)]
struct HistoryOperationAck {
    operation_id: String,
    direction: HistoryDirection,
}

#[derive(Debug)]
pub(crate) struct HistoryService {
    past: VecDeque<HistoryEntry>,
    future: VecDeque<HistoryEntry>,
    history_revision: u64,
    history_epoch: u64,
    status_seq: u64,
    busy: bool,
    truncated: Option<HistoryTruncated>,
    total_bytes: usize,
    next_access_sequence: u64,
    operation_acks: VecDeque<HistoryOperationAck>,
    entry_max_bytes: usize,
    total_max_bytes: usize,
    max_entries: usize,
}

impl Default for HistoryService {
    fn default() -> Self {
        Self::with_limits(
            HISTORY_ENTRY_MAX_BYTES,
            HISTORY_TOTAL_MAX_BYTES,
            HISTORY_MAX_ENTRIES,
        )
    }
}

impl HistoryService {
    fn with_limits(entry_max_bytes: usize, total_max_bytes: usize, max_entries: usize) -> Self {
        Self {
            past: VecDeque::new(),
            future: VecDeque::new(),
            history_revision: 0,
            history_epoch: 0,
            status_seq: 0,
            busy: false,
            truncated: None,
            total_bytes: 0,
            next_access_sequence: 0,
            operation_acks: VecDeque::with_capacity(HISTORY_OPERATION_ACK_CAPACITY),
            entry_max_bytes,
            total_max_bytes,
            max_entries,
        }
    }

    pub(crate) fn status(&self, admission_closed: bool) -> HistoryStatus {
        HistoryStatus {
            history_revision: self.history_revision,
            history_epoch: self.history_epoch,
            status_seq: self.status_seq,
            can_undo: !self.past.is_empty(),
            can_redo: !self.future.is_empty(),
            busy: self.busy || admission_closed,
            truncated: self.truncated.clone(),
        }
    }

    pub(crate) fn issue_status(&mut self, admission_closed: bool) -> HistoryStatus {
        self.status_seq = self.status_seq.saturating_add(1);
        self.status(admission_closed)
    }

    #[cfg(test)]
    pub(crate) fn history_revision(&self) -> u64 {
        self.history_revision
    }

    #[cfg(test)]
    pub(crate) fn prepare_entry(
        &self,
        changed_fields: Vec<EditorField>,
        before: EditorPatchV1,
        gesture_id: Option<String>,
    ) -> Result<HistoryRecordPlan, String> {
        self.prepare_entry_with_gesture_ids(
            changed_fields,
            before,
            None,
            gesture_id.into_iter().collect(),
        )
    }

    pub(crate) fn prepare_entry_with_gesture_ids(
        &self,
        changed_fields: Vec<EditorField>,
        before: EditorPatchV1,
        key_counters: Option<KeyCounters>,
        gesture_ids: Vec<String>,
    ) -> Result<HistoryRecordPlan, String> {
        let gesture_ids = normalize_gesture_ids(gesture_ids);
        if self.future.is_empty() && !gesture_ids.is_empty() {
            if let Some(top) = self
                .past
                .back()
                .filter(|entry| entry.matches_any_gesture(&gesture_ids))
            {
                let merged =
                    merge_editor_snapshot(&top.before, changed_fields, before, key_counters)?;
                let mut merged_gesture_ids = top
                    .gesture_ids
                    .iter()
                    .filter(|existing| !gesture_ids.contains(*existing))
                    .cloned()
                    .collect::<Vec<_>>();
                merged_gesture_ids.extend(gesture_ids);
                return self.prepare_snapshot_with_gesture_ids(
                    merged.scope(),
                    merged,
                    normalize_gesture_ids(merged_gesture_ids),
                    Some(top.access_sequence),
                    Vec::new(),
                );
            }
        }

        self.prepare_snapshot_with_gesture_ids(
            HistoryScope::Editor,
            HistorySnapshot::Editor {
                changed_fields,
                before: Box::new(before),
                key_counters,
            },
            gesture_ids,
            None,
            Vec::new(),
        )
    }

    pub(crate) fn prepare_opposite_editor_entry(
        &self,
        changed_fields: Vec<EditorField>,
        before: EditorPatchV1,
        key_counters: Option<KeyCounters>,
        gesture_id: Option<String>,
    ) -> Result<HistoryRecordPlan, String> {
        self.prepare_snapshot(
            HistoryScope::Editor,
            HistorySnapshot::Editor {
                changed_fields,
                before: Box::new(before),
                key_counters,
            },
            gesture_id,
            None,
        )
    }

    pub(crate) fn prepare_custom_tabs_entry(
        &self,
        before: CustomTabsHistorySnapshot,
    ) -> Result<HistoryRecordPlan, String> {
        self.prepare_snapshot(
            HistoryScope::CustomTabs,
            HistorySnapshot::CustomTabs(Box::new(before)),
            None,
            None,
        )
    }

    pub(crate) fn prepare_mode_entry(&self, before: String) -> Result<HistoryRecordPlan, String> {
        self.prepare_snapshot(
            HistoryScope::Mode,
            HistorySnapshot::Mode(before),
            None,
            None,
        )
    }

    pub(crate) fn prepare_counters_entry(
        &self,
        before: KeyCounters,
    ) -> Result<HistoryRecordPlan, String> {
        self.prepare_snapshot(
            HistoryScope::Counters,
            HistorySnapshot::Counters(before),
            None,
            None,
        )
    }

    pub(crate) fn prepare_preset_full_entry(
        &self,
        before: PresetFullHistorySnapshot,
    ) -> Result<HistoryRecordPlan, String> {
        self.prepare_snapshot(
            HistoryScope::PresetFull,
            HistorySnapshot::PresetFull(Box::new(before)),
            None,
            None,
        )
    }

    pub(crate) fn prepare_plugin_elements_entry(
        &self,
        before: PluginElementsHistorySnapshot,
        gesture_id: Option<String>,
    ) -> Result<HistoryRecordPlan, String> {
        let gesture_ids = gesture_id.into_iter().collect::<Vec<_>>();
        if let Some(target) = self.past.iter().rev().find(|entry| {
            self.future.is_empty()
                && !gesture_ids.is_empty()
                && entry.matches_any_gesture(&gesture_ids)
        }) {
            let merged = merge_plugin_elements_snapshot(&target.before, before)?;
            let mut merged_gesture_ids = target.gesture_ids.clone();
            merged_gesture_ids.extend(gesture_ids);
            return self.prepare_snapshot_with_gesture_ids(
                merged.scope(),
                merged,
                normalize_gesture_ids(merged_gesture_ids),
                Some(target.access_sequence),
                Vec::new(),
            );
        }
        self.prepare_snapshot_with_gesture_ids(
            HistoryScope::PluginElements,
            HistorySnapshot::PluginElements(before),
            gesture_ids,
            None,
            Vec::new(),
        )
    }

    pub(crate) fn prepare_opposite_plugin_elements_entry(
        &self,
        before: PluginElementsHistorySnapshot,
    ) -> Result<HistoryRecordPlan, String> {
        self.prepare_snapshot(
            HistoryScope::PluginElements,
            HistorySnapshot::PluginElements(before),
            None,
            None,
        )
    }

    pub(crate) fn prepare_opposite_compound_entry(
        &self,
        snapshots: Vec<HistorySnapshot>,
        gesture_ids: Vec<String>,
    ) -> Result<HistoryRecordPlan, String> {
        validate_compound_snapshots(&snapshots)?;
        self.prepare_snapshot_with_gesture_ids(
            HistoryScope::Compound,
            HistorySnapshot::Compound { snapshots },
            gesture_ids,
            None,
            Vec::new(),
        )
    }

    pub(crate) fn prepare_gesture_entry(
        &self,
        snapshots: Vec<HistorySnapshot>,
        gesture_id: String,
    ) -> Result<HistoryRecordPlan, String> {
        validate_compound_snapshots(&snapshots)?;
        let gesture_ids = vec![gesture_id];
        // 같은 gestureId의 선행 엔트리(디바운스 plugin 커밋 선착지·반복 커밋)와
        // 병합 - 분리 기록은 undo 1회가 제스처의 반쪽만 복원한다
        if let Some(target) = self
            .past
            .iter()
            .rev()
            .find(|entry| self.future.is_empty() && entry.matches_any_gesture(&gesture_ids))
        {
            let merged = merge_gesture_snapshots(&target.before, &snapshots)?;
            let mut merged_gesture_ids = target.gesture_ids.clone();
            merged_gesture_ids.extend(gesture_ids.iter().cloned());
            let plan = self.prepare_snapshot_with_gesture_ids(
                merged.scope(),
                merged,
                normalize_gesture_ids(merged_gesture_ids),
                Some(target.access_sequence),
                Vec::new(),
            )?;
            // 병합 결과가 엔트리 한도를 넘으면 독립 엔트리로 폴백 - gesture
            // 경로의 Truncate는 커밋 거절이라 성공하던 커밋이 실패로 바뀐다
            if !matches!(plan, HistoryRecordPlan::Truncate) {
                return Ok(plan);
            }
        }
        self.prepare_snapshot_with_gesture_ids(
            HistoryScope::Compound,
            HistorySnapshot::Compound { snapshots },
            gesture_ids,
            None,
            Vec::new(),
        )
    }

    fn prepare_snapshot(
        &self,
        scope: HistoryScope,
        before: HistorySnapshot,
        gesture_id: Option<String>,
        merge_target: Option<u64>,
    ) -> Result<HistoryRecordPlan, String> {
        self.prepare_snapshot_with_gesture_ids(
            scope,
            before,
            gesture_id.into_iter().collect(),
            merge_target,
            Vec::new(),
        )
    }

    fn prepare_snapshot_with_gesture_ids(
        &self,
        scope: HistoryScope,
        before: HistorySnapshot,
        gesture_ids: Vec<String>,
        merge_target: Option<u64>,
        remove_access_sequences: Vec<u64>,
    ) -> Result<HistoryRecordPlan, String> {
        let gesture_ids = normalize_gesture_ids(gesture_ids);
        let gesture_id = gesture_ids.last().cloned();
        let size_bytes = serde_json::to_vec(&HistoryEntryPayload {
            scope,
            before: &before,
            gesture_ids: &gesture_ids,
        })
        .map_err(|error| format!("failed to serialize history entry: {error}"))?
        .len();

        if size_bytes > self.entry_max_bytes {
            return Ok(HistoryRecordPlan::Truncate);
        }

        let entry = Box::new(HistoryEntry {
            scope,
            before,
            gesture_id,
            gesture_ids,
            size_bytes,
            access_sequence: 0,
        });
        Ok(match merge_target {
            Some(target_access_sequence) => HistoryRecordPlan::Merge {
                entry,
                target_access_sequence,
                remove_access_sequences,
            },
            None => HistoryRecordPlan::Entry(entry),
        })
    }

    pub(crate) fn apply_record_plan(&mut self, plan: HistoryRecordPlan) {
        let cleared_future = self.clear_future();
        match plan {
            HistoryRecordPlan::Entry(entry) => {
                self.push_past(*entry);
                self.advance_revision();
            }
            HistoryRecordPlan::Merge {
                mut entry,
                target_access_sequence,
                remove_access_sequences,
            } => {
                for access_sequence in remove_access_sequences {
                    self.remove_past_by_access_sequence(access_sequence);
                }
                if let Some(previous) = self
                    .past
                    .iter_mut()
                    .find(|entry| entry.access_sequence == target_access_sequence)
                {
                    entry.access_sequence = previous.access_sequence;
                    self.total_bytes = self.total_bytes.saturating_sub(previous.size_bytes);
                    self.total_bytes = self.total_bytes.saturating_add(entry.size_bytes);
                    *previous = *entry;
                } else {
                    self.push_past(*entry);
                    self.advance_revision();
                }
                if cleared_future {
                    self.advance_revision();
                }
            }
            HistoryRecordPlan::Truncate => {
                self.clear_past();
                self.truncated = Some(HistoryTruncated {
                    reason: HISTORY_ENTRY_TOO_LARGE.to_string(),
                });
                self.advance_revision();
            }
        }
        self.enforce_budget();
    }

    pub(crate) fn apply_editor_record_plan(
        &mut self,
        mut plan: HistoryRecordPlan,
        canonical: &EditorDocumentV1,
    ) {
        let remove_entry = match &mut plan {
            HistoryRecordPlan::Merge { entry, .. } => {
                remove_net_zero_editor_snapshot(entry, canonical)
            }
            _ => false,
        };
        if remove_entry {
            self.clear_future();
            self.remove_merge_target(&plan);
            self.advance_revision();
            self.enforce_budget();
            return;
        }
        self.apply_record_plan(plan);
    }

    pub(crate) fn apply_plugin_elements_record_plan(
        &mut self,
        mut plan: HistoryRecordPlan,
        canonical: &PluginElementsHistorySnapshot,
    ) {
        let remove_entry = match &mut plan {
            HistoryRecordPlan::Merge { entry, .. } => {
                remove_net_zero_plugin_snapshot(entry, canonical)
            }
            _ => false,
        };
        if remove_entry {
            self.clear_future();
            self.remove_merge_target(&plan);
            self.advance_revision();
            self.enforce_budget();
            return;
        }
        self.apply_record_plan(plan);
    }

    pub(crate) fn invalidate_future(&mut self) -> bool {
        if !self.clear_future() {
            return false;
        }
        self.advance_revision();
        true
    }

    pub(crate) fn invalidate_all(&mut self) -> bool {
        if self.past.is_empty() && self.future.is_empty() {
            return false;
        }
        self.clear_past();
        self.clear_future();
        self.advance_revision();
        true
    }

    pub(crate) fn contains_plugin_elements_for(&self, plugin_id: Option<&str>) -> bool {
        self.past
            .iter()
            .chain(self.future.iter())
            .any(|entry| snapshot_contains_plugin_elements(&entry.before, plugin_id))
    }

    pub(crate) fn begin_barrier(&mut self) {
        self.history_epoch = self.history_epoch.saturating_add(1);
        self.busy = true;
    }

    pub(crate) fn history_epoch(&self) -> u64 {
        self.history_epoch
    }

    pub(crate) fn advance_epoch(&mut self) {
        self.history_epoch = self.history_epoch.saturating_add(1);
    }

    pub(crate) fn finish_barrier(&mut self) {
        self.busy = false;
    }

    pub(crate) fn operation_replayed(
        &self,
        operation_id: &str,
        direction: HistoryDirection,
    ) -> Result<bool, String> {
        let Some(ack) = self
            .operation_acks
            .iter()
            .find(|ack| ack.operation_id == operation_id)
        else {
            return Ok(false);
        };
        if ack.direction != direction {
            return Err(HISTORY_OPERATION_ID_REUSED.to_string());
        }
        Ok(true)
    }

    pub(crate) fn target(&self, direction: HistoryDirection) -> Option<&HistoryEntry> {
        match direction {
            HistoryDirection::Undo => self.past.back(),
            HistoryDirection::Redo => self.future.back(),
        }
    }

    pub(crate) fn commit_operation(
        &mut self,
        direction: HistoryDirection,
        operation_id: String,
        opposite: HistoryEntry,
    ) {
        match direction {
            HistoryDirection::Undo => {
                self.pop_past();
                self.push_future(opposite);
            }
            HistoryDirection::Redo => {
                self.pop_future();
                self.push_past(opposite);
            }
        }
        self.operation_acks.push_back(HistoryOperationAck {
            operation_id,
            direction,
        });
        while self.operation_acks.len() > HISTORY_OPERATION_ACK_CAPACITY {
            self.operation_acks.pop_front();
        }
        self.advance_revision();
        self.enforce_budget();
    }

    fn push_past(&mut self, mut entry: HistoryEntry) {
        self.assign_access_sequence(&mut entry);
        self.total_bytes = self.total_bytes.saturating_add(entry.size_bytes);
        self.past.push_back(entry);
    }

    fn push_future(&mut self, mut entry: HistoryEntry) {
        self.assign_access_sequence(&mut entry);
        self.total_bytes = self.total_bytes.saturating_add(entry.size_bytes);
        self.future.push_back(entry);
    }

    fn pop_past(&mut self) -> Option<HistoryEntry> {
        let entry = self.past.pop_back()?;
        self.total_bytes = self.total_bytes.saturating_sub(entry.size_bytes);
        Some(entry)
    }

    fn pop_future(&mut self) -> Option<HistoryEntry> {
        let entry = self.future.pop_back()?;
        self.total_bytes = self.total_bytes.saturating_sub(entry.size_bytes);
        Some(entry)
    }

    fn remove_merge_target(&mut self, plan: &HistoryRecordPlan) {
        let HistoryRecordPlan::Merge {
            target_access_sequence,
            remove_access_sequences,
            ..
        } = plan
        else {
            return;
        };
        for access_sequence in remove_access_sequences {
            self.remove_past_by_access_sequence(*access_sequence);
        }
        self.remove_past_by_access_sequence(*target_access_sequence);
    }

    fn remove_past_by_access_sequence(&mut self, target_access_sequence: u64) {
        let Some(index) = self
            .past
            .iter()
            .position(|entry| entry.access_sequence == target_access_sequence)
        else {
            return;
        };
        if let Some(entry) = self.past.remove(index) {
            self.total_bytes = self.total_bytes.saturating_sub(entry.size_bytes);
        }
    }

    fn clear_past(&mut self) {
        self.past.clear();
        self.recalculate_total_bytes();
    }

    fn clear_future(&mut self) -> bool {
        let changed = !self.future.is_empty();
        self.future.clear();
        self.recalculate_total_bytes();
        changed
    }

    fn assign_access_sequence(&mut self, entry: &mut HistoryEntry) {
        self.next_access_sequence = self.next_access_sequence.saturating_add(1);
        entry.access_sequence = self.next_access_sequence;
    }

    fn advance_revision(&mut self) {
        self.history_revision = self.history_revision.saturating_add(1);
    }

    fn enforce_budget(&mut self) {
        while self.total_bytes > self.total_max_bytes
            || self.past.len() + self.future.len() > self.max_entries
        {
            let past_sequence = self
                .past
                .front()
                .map_or(u64::MAX, |entry| entry.access_sequence);
            let future_sequence = self
                .future
                .front()
                .map_or(u64::MAX, |entry| entry.access_sequence);
            let removed = if past_sequence <= future_sequence {
                self.past.pop_front()
            } else {
                self.future.pop_front()
            };
            let Some(removed) = removed else {
                break;
            };
            self.total_bytes = self.total_bytes.saturating_sub(removed.size_bytes);
        }
    }

    fn recalculate_total_bytes(&mut self) {
        self.total_bytes = self
            .past
            .iter()
            .chain(self.future.iter())
            .map(|entry| entry.size_bytes)
            .sum();
    }

    #[cfg(test)]
    pub(crate) fn set_limits_for_test(
        &mut self,
        entry_max_bytes: usize,
        total_max_bytes: usize,
        max_entries: usize,
    ) {
        self.entry_max_bytes = entry_max_bytes;
        self.total_max_bytes = total_max_bytes;
        self.max_entries = max_entries;
        self.enforce_budget();
    }
}

fn snapshot_contains_plugin_elements(snapshot: &HistorySnapshot, plugin_id: Option<&str>) -> bool {
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

#[cfg(test)]
mod tests;
