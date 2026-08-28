use serde::{Deserialize, Serialize};

use super::{EditorField, EditorOpResultV1, EditorOpV1, EditorPatchV1, SavedPluginInstance};

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub editor_ops_version: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub editor_ops: Option<Vec<EditorOpV1>>,
    pub plugin_changes: Vec<GesturePluginInstancesChange>,
}

impl GestureCommitRequest {
    pub(crate) fn may_change_keys(&self) -> bool {
        self.editor_changes
            .as_ref()
            .is_some_and(|changes| changes.keys.is_some())
            || self
                .editor_ops
                .as_ref()
                .is_some_and(|ops| ops.iter().any(EditorOpV1::may_change_keys))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GestureCommitResult {
    pub editor_revision: u64,
    pub changed_fields: Vec<EditorField>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub editor_op_results: Option<Vec<EditorOpResultV1>>,
    pub plugin_model_revision: u64,
    pub changed_plugin_ids: Vec<String>,
    pub authority_generation: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        EditorBoundsV1, EditorElementTypeV1, EditorOpResultStatusV1, EDITOR_OPS_VERSION,
    };

    #[test]
    fn gesture_ops_wire_uses_the_versioned_camel_case_contract() {
        let bounds = EditorBoundsV1 {
            dx: 1.0,
            dy: 2.0,
            width: 3.0,
            height: 4.0,
        };
        let request = GestureCommitRequest {
            gesture_id: uuid::Uuid::new_v4().to_string(),
            mutation_id: uuid::Uuid::new_v4().to_string(),
            editor_base_revision: 0,
            plugin_base_revision: 0,
            observed_history_epoch: None,
            authority_generation: 1,
            editor_changes: None,
            editor_ops_version: Some(EDITOR_OPS_VERSION),
            editor_ops: Some(vec![EditorOpV1::SetBounds {
                element_type: EditorElementTypeV1::Key,
                id: uuid::Uuid::new_v4().to_string(),
                bounds,
            }]),
            plugin_changes: Vec::new(),
        };

        let wire = serde_json::to_value(request).unwrap();
        assert_eq!(wire["editorOpsVersion"], EDITOR_OPS_VERSION);
        assert_eq!(wire["editorOps"][0]["kind"], "setBounds");
        assert!(wire.get("editorChanges").is_none());

        let result = GestureCommitResult {
            editor_revision: 1,
            changed_fields: vec![EditorField::KeyPositions],
            editor_op_results: Some(vec![EditorOpResultV1 {
                status: EditorOpResultStatusV1::Applied,
                bounds: Some(bounds),
            }]),
            plugin_model_revision: 1,
            changed_plugin_ids: vec!["plugin-a".to_string()],
            authority_generation: 1,
        };
        let wire = serde_json::to_value(result).unwrap();
        assert_eq!(wire["editorOpResults"][0]["status"], "applied");
        assert_eq!(wire["editorOpResults"][0]["bounds"]["width"], 3.0);

        let patch_result = GestureCommitResult {
            editor_revision: 1,
            changed_fields: Vec::new(),
            editor_op_results: None,
            plugin_model_revision: 1,
            changed_plugin_ids: Vec::new(),
            authority_generation: 1,
        };
        assert!(serde_json::to_value(patch_result)
            .unwrap()
            .get("editorOpResults")
            .is_none());
    }

    #[test]
    fn gesture_request_detects_key_mapping_mutations_only() {
        let base = GestureCommitRequest {
            gesture_id: uuid::Uuid::new_v4().to_string(),
            mutation_id: uuid::Uuid::new_v4().to_string(),
            editor_base_revision: 0,
            plugin_base_revision: 0,
            observed_history_epoch: None,
            authority_generation: 1,
            editor_changes: None,
            editor_ops_version: None,
            editor_ops: None,
            plugin_changes: Vec::new(),
        };

        let mut patch = base.clone();
        patch.editor_changes = Some(EditorPatchV1 {
            keys: Some(Default::default()),
            ..EditorPatchV1::default()
        });
        assert!(patch.may_change_keys());

        let mut delete = base.clone();
        delete.editor_ops_version = Some(EDITOR_OPS_VERSION);
        delete.editor_ops = Some(vec![EditorOpV1::DeleteElement {
            element_type: EditorElementTypeV1::Key,
            id: uuid::Uuid::new_v4().to_string(),
        }]);
        assert!(delete.may_change_keys());

        let mut bounds = base;
        bounds.editor_ops_version = Some(EDITOR_OPS_VERSION);
        bounds.editor_ops = Some(vec![EditorOpV1::SetBounds {
            element_type: EditorElementTypeV1::Key,
            id: uuid::Uuid::new_v4().to_string(),
            bounds: EditorBoundsV1 {
                dx: 1.0,
                dy: 2.0,
                width: 60.0,
                height: 60.0,
            },
        }]);
        assert!(!bounds.may_change_keys());
    }
}
