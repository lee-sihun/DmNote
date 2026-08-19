use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginSize {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum PluginSettingValue {
    String(String),
    Number(f64),
    Boolean(bool),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedPluginInstance {
    // 영구 인스턴스 ID (재시작·undo 생존), backfill 전 구데이터는 None
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    pub position: PluginPoint,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings: Option<BTreeMap<String, PluginSettingValue>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub measured_size: Option<PluginSize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_id: Option<String>,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub z_index: Option<f64>,
    // 레이어 그룹 소속
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginInstancesCommitRequest {
    pub plugin_id: String,
    pub instances: Vec<SavedPluginInstance>,
    pub mutation_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gesture_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed_history_epoch: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_model_revision: Option<u64>,
    pub authority_generation: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginInstancesReconcileRequest {
    pub plugin_id: String,
    pub valid_tab_ids: Vec<String>,
    pub mutation_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed_history_epoch: Option<u64>,
    pub authority_generation: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstancesSnapshot {
    pub plugin_id: String,
    pub instances: Vec<SavedPluginInstance>,
    pub model_revision: u64,
    pub authority_generation: u64,
}

// 전 플러그인 저장 인스턴스의 그룹 참조 - pluginId → normalize 모드 → 그룹 id (정렬).
// 미로드 플러그인 포함이 목적이라 pluginId 구분을 유지한다
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginGroupRefsSnapshot {
    pub refs: BTreeMap<String, BTreeMap<String, Vec<String>>>,
    pub model_revision: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstancesCommitResult {
    pub plugin_id: String,
    pub model_revision: u64,
    pub authority_generation: u64,
    pub changed: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstancesChangedPayload {
    pub plugin_id: String,
    pub revision: u64,
    // commit 발신 mutation id - undo/redo 복원 이벤트는 None (self-echo 구분용)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_mutation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginAuthoritySnapshot {
    pub authority_generation: u64,
    pub model_revision: u64,
}
