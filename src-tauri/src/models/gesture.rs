use serde::{Deserialize, Serialize};

use super::{EditorField, EditorPatchV1, SavedPluginInstance};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GesturePluginInstancesChange {
    pub plugin_id: String,
    pub instances: Vec<SavedPluginInstance>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GestureCommitRequest {
    pub gesture_id: String,
    pub mutation_id: String,
    pub editor_base_revision: u64,
    pub plugin_base_revision: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed_history_epoch: Option<u64>,
    pub authority_generation: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub editor_changes: Option<EditorPatchV1>,
    pub plugin_changes: Vec<GesturePluginInstancesChange>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GestureCommitResult {
    pub editor_revision: u64,
    pub changed_fields: Vec<EditorField>,
    pub plugin_model_revision: u64,
    pub changed_plugin_ids: Vec<String>,
    pub authority_generation: u64,
}
