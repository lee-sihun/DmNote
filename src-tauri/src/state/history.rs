use std::collections::VecDeque;

mod admission;
mod snapshot;

pub(crate) use admission::{
    HistoryAdmission, HistoryAdmissionGate, HistoryAdmissionLease, HistoryBarrierLease,
    HistoryBarrierWaiter,
};
use snapshot::{
    merge_editor_snapshot, merge_gesture_snapshots, merge_plugin_elements_snapshot,
    normalize_gesture_ids, remove_net_zero_editor_snapshot, remove_net_zero_plugin_snapshot,
    snapshot_contains_plugin_elements, validate_compound_snapshots, HistoryEntryPayload,
};
pub(crate) use snapshot::{
    CustomTabsHistorySnapshot, HistoryDirection, HistoryEntry, HistoryRecordPlan, HistoryScope,
    HistorySnapshot, PluginElementsHistorySnapshot, PresetFullHistorySnapshot,
    PresetHistorySettingsSnapshot,
};

use crate::models::{
    EditorDocumentV1, EditorField, EditorPatchV1, HistoryStatus, HistoryTruncated, KeyCounters,
};

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

#[cfg(test)]
mod tests;
