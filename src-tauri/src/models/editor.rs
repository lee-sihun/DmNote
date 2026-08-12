use serde::{Deserialize, Serialize};

use super::{
    AppStoreData, GraphPositions, KeyCounters, KeyMappings, KeyPositions, KnobPositions,
    LayerGroups, StatPositions,
};

pub const EDITOR_SCHEMA_VERSION: u16 = 1;
pub const EDITOR_COMMIT_SCHEMA_VERSION_V2: u16 = 2;
pub const EDITOR_OPS_VERSION: u16 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EditorField {
    Keys,
    KeyPositions,
    StatPositions,
    GraphPositions,
    KnobPositions,
    LayerGroups,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorDocumentV1 {
    pub schema_version: u16,
    pub keys: KeyMappings,
    pub key_positions: KeyPositions,
    pub stat_positions: StatPositions,
    pub graph_positions: GraphPositions,
    pub knob_positions: KnobPositions,
    pub layer_groups: LayerGroups,
}

impl EditorDocumentV1 {
    pub fn from_store(store: &AppStoreData) -> Self {
        Self {
            schema_version: EDITOR_SCHEMA_VERSION,
            keys: store.keys.clone(),
            key_positions: store.key_positions.clone(),
            stat_positions: store.stat_positions.clone(),
            graph_positions: store.graph_positions.clone(),
            knob_positions: store.knob_positions.clone(),
            layer_groups: store.layer_groups.clone(),
        }
    }

    pub fn apply_to_store(&self, store: &mut AppStoreData) {
        store.keys = self.keys.clone();
        store.key_positions = self.key_positions.clone();
        store.stat_positions = self.stat_positions.clone();
        store.graph_positions = self.graph_positions.clone();
        store.knob_positions = self.knob_positions.clone();
        store.layer_groups = self.layer_groups.clone();
    }

    pub fn apply_patch(&mut self, patch: &EditorPatchV1) {
        if let Some(value) = patch.keys.as_ref() {
            self.keys = value.clone();
        }
        if let Some(value) = patch.key_positions.as_ref() {
            self.key_positions = value.clone();
        }
        if let Some(value) = patch.stat_positions.as_ref() {
            self.stat_positions = value.clone();
        }
        if let Some(value) = patch.graph_positions.as_ref() {
            self.graph_positions = value.clone();
        }
        if let Some(value) = patch.knob_positions.as_ref() {
            self.knob_positions = value.clone();
        }
        if let Some(value) = patch.layer_groups.as_ref() {
            self.layer_groups = value.clone();
        }
    }

    pub fn changed_fields(&self, next: &Self) -> Vec<EditorField> {
        let mut fields = Vec::new();
        if self.keys != next.keys {
            fields.push(EditorField::Keys);
        }
        if self.key_positions != next.key_positions {
            fields.push(EditorField::KeyPositions);
        }
        if self.stat_positions != next.stat_positions {
            fields.push(EditorField::StatPositions);
        }
        if self.graph_positions != next.graph_positions {
            fields.push(EditorField::GraphPositions);
        }
        if self.knob_positions != next.knob_positions {
            fields.push(EditorField::KnobPositions);
        }
        if self.layer_groups != next.layer_groups {
            fields.push(EditorField::LayerGroups);
        }
        fields
    }

    pub fn patch_for_fields(&self, fields: &[EditorField]) -> EditorPatchV1 {
        let mut patch = EditorPatchV1::default();
        for field in fields {
            match field {
                EditorField::Keys => patch.keys = Some(self.keys.clone()),
                EditorField::KeyPositions => {
                    patch.key_positions = Some(self.key_positions.clone());
                }
                EditorField::StatPositions => {
                    patch.stat_positions = Some(self.stat_positions.clone());
                }
                EditorField::GraphPositions => {
                    patch.graph_positions = Some(self.graph_positions.clone());
                }
                EditorField::KnobPositions => {
                    patch.knob_positions = Some(self.knob_positions.clone());
                }
                EditorField::LayerGroups => {
                    patch.layer_groups = Some(self.layer_groups.clone());
                }
            }
        }
        patch
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorPatchV1 {
    pub schema_version: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keys: Option<KeyMappings>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_positions: Option<KeyPositions>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stat_positions: Option<StatPositions>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub graph_positions: Option<GraphPositions>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub knob_positions: Option<KnobPositions>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layer_groups: Option<LayerGroups>,
}

impl Default for EditorPatchV1 {
    fn default() -> Self {
        Self {
            schema_version: EDITOR_SCHEMA_VERSION,
            keys: None,
            key_positions: None,
            stat_positions: None,
            graph_positions: None,
            knob_positions: None,
            layer_groups: None,
        }
    }
}

impl EditorPatchV1 {
    pub fn includes(&self, field: EditorField) -> bool {
        match field {
            EditorField::Keys => self.keys.is_some(),
            EditorField::KeyPositions => self.key_positions.is_some(),
            EditorField::StatPositions => self.stat_positions.is_some(),
            EditorField::GraphPositions => self.graph_positions.is_some(),
            EditorField::KnobPositions => self.knob_positions.is_some(),
            EditorField::LayerGroups => self.layer_groups.is_some(),
        }
    }

    pub fn included_fields(&self) -> Vec<EditorField> {
        [
            EditorField::Keys,
            EditorField::KeyPositions,
            EditorField::StatPositions,
            EditorField::GraphPositions,
            EditorField::KnobPositions,
            EditorField::LayerGroups,
        ]
        .into_iter()
        .filter(|field| self.includes(*field))
        .collect()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EditorElementTypeV1 {
    Key,
    Stat,
    Graph,
    Knob,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorBoundsV1 {
    pub dx: f64,
    pub dy: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum EditorOpV1 {
    SetBounds {
        #[serde(rename = "elementType")]
        element_type: EditorElementTypeV1,
        id: String,
        bounds: EditorBoundsV1,
    },
}

impl EditorOpV1 {
    pub fn id(&self) -> &str {
        match self {
            Self::SetBounds { id, .. } => id,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorCommitRequest {
    pub base_revision: u64,
    pub mutation_id: String,
    #[serde(default)]
    pub multi_key: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gesture_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub gesture_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changes: Option<EditorPatchV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ops_version: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ops: Option<Vec<EditorOpV1>>,
}

impl EditorCommitRequest {
    pub fn echoed_gesture_ids(&self) -> Vec<String> {
        let mut gesture_ids =
            Vec::with_capacity(self.gesture_ids.len() + usize::from(self.gesture_id.is_some()));
        for gesture_id in self.gesture_ids.iter().chain(self.gesture_id.iter()) {
            if !gesture_ids.contains(gesture_id) {
                gesture_ids.push(gesture_id.clone());
            }
        }
        gesture_ids
    }

    pub fn history_gesture_id(&self) -> Option<String> {
        self.gesture_id
            .clone()
            .or_else(|| self.gesture_ids.last().cloned())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EditorOpResultStatusV1 {
    Applied,
    NoChange,
    TargetMissing,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorOpResultV1 {
    pub status: EditorOpResultStatusV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<EditorBoundsV1>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorCommitResult {
    pub revision: u64,
    pub changed_fields: Vec<EditorField>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub op_results: Option<Vec<EditorOpResultV1>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorGetResult {
    pub revision: u64,
    pub document: EditorDocumentV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryTruncated {
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryStatus {
    pub history_revision: u64,
    pub history_epoch: u64,
    pub status_seq: u64,
    pub can_undo: bool,
    pub can_redo: bool,
    pub busy: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub truncated: Option<HistoryTruncated>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorCommittedV1 {
    pub schema_version: u16,
    pub revision: u64,
    pub mutation_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gesture_id: Option<String>,
    #[serde(default)]
    pub gesture_ids: Vec<String>,
    pub origin: String,
    pub changed_fields: Vec<EditorField>,
    pub patch: EditorPatchV1,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EditorCommitOrigin {
    StrictEditorCommit,
    GestureCommit,
    LegacyAdapter(String),
    HistoryUndo,
    HistoryRedo,
    // 이벤트 없는 부팅 복구용 origin 계약
    #[allow(dead_code)]
    LoadRecovery,
}

impl EditorCommitOrigin {
    pub fn event_name(&self) -> Option<String> {
        match self {
            Self::StrictEditorCommit => Some("editorCommit".to_string()),
            Self::GestureCommit => Some("gestureCommit".to_string()),
            Self::LegacyAdapter(command) => Some(format!("legacy:{command}")),
            Self::HistoryUndo => Some("historyUndo".to_string()),
            Self::HistoryRedo => Some("historyRedo".to_string()),
            Self::LoadRecovery => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CommittedEditorChange {
    pub result: EditorCommitResult,
    pub event: Option<EditorCommittedV1>,
    pub replayed: bool,
    pub document: EditorDocumentV1,
    pub selected_key_type: String,
    pub key_counters: KeyCounters,
    pub history_status: Option<HistoryStatus>,
    pub(crate) runtime_publication_generation: u64,
}

#[derive(Debug, Clone)]
pub struct EditorTransactionResult<T> {
    pub value: T,
    pub change: CommittedEditorChange,
}
