use std::collections::{HashMap, HashSet};

use parking_lot::{Mutex, MutexGuard};
use serde::Serialize;
use serde_json::Value;

use crate::models::{
    AppStoreData, PluginInstancesCommitRequest, PluginInstancesReconcileRequest,
    SavedPluginInstance,
};
use crate::state::editor::{is_valid_gesture_id, is_valid_group_id_shape, MAX_SAFE_WIRE_REVISION};
use crate::state::native_element_id::{is_valid_element_id, new_unique_id, BackfillOutcome};

pub(crate) const MAX_PLUGIN_INSTANCES_REQUEST_BYTES: usize = 8 * 1024 * 1024;
// 플러그인 스토리지 키 네임스페이스 - storage 커맨드와 canonical 헬퍼의 단일 원천
pub(crate) const PLUGIN_DATA_KEY_PREFIX: &str = "plugin_data_";
const MAX_PLUGIN_ID_BYTES: usize = 128;
const MAX_PLUGIN_INSTANCES: usize = 4_096;
const MAX_PLUGIN_RECONCILE_TAB_IDS: usize = 64;
const MAX_TAB_ID_BYTES: usize = 128;
const MAX_SETTING_FIELDS: usize = 1_024;
const MAX_SETTING_KEY_BYTES: usize = 256;
const MAX_SETTING_STRING_BYTES: usize = 64 * 1024;
const MAX_ABS_COORDINATE: f64 = 32_768.0;
const MAX_DIMENSION: f64 = 32_768.0;

#[derive(Debug, Default)]
struct PluginAuthorityState {
    generation: u64,
    available: bool,
}

#[derive(Debug, Default)]
pub(crate) struct PluginRuntimeAuthority {
    state: Mutex<PluginAuthorityState>,
}

#[derive(Debug)]
pub(crate) struct PluginAuthorityLease<'a> {
    guard: MutexGuard<'a, PluginAuthorityState>,
}

impl PluginAuthorityLease<'_> {
    pub(crate) fn generation(&self) -> u64 {
        self.guard.generation
    }
}

impl PluginRuntimeAuthority {
    pub(crate) fn admit(
        &self,
        expected_generation: u64,
    ) -> Result<PluginAuthorityLease<'_>, String> {
        let guard = self.state.lock();
        if !guard.available {
            return Err("AUTHORITY_UNAVAILABLE".to_string());
        }
        if guard.generation != expected_generation {
            return Err("AUTHORITY_GENERATION_CHANGED".to_string());
        }
        Ok(PluginAuthorityLease { guard })
    }

    pub(crate) fn reset(&self) -> Result<PluginAuthorityLease<'_>, String> {
        let mut state = self.state.lock();
        state.generation = state
            .generation
            .checked_add(1)
            .filter(|generation| *generation <= MAX_SAFE_WIRE_REVISION)
            .ok_or_else(|| "AUTHORITY_GENERATION_OUT_OF_RANGE".to_string())?;
        state.available = true;
        Ok(PluginAuthorityLease { guard: state })
    }

    pub(crate) fn generation(&self) -> u64 {
        self.state.lock().generation
    }

    pub(crate) fn mark_unavailable(&self) {
        let mut state = self.state.lock();
        state.available = false;
    }
}

pub(crate) fn validate_plugin_instances_request(
    request: &PluginInstancesCommitRequest,
) -> Result<usize, String> {
    validate_plugin_id(&request.plugin_id)?;
    validate_plugin_mutation_id(&request.mutation_id)?;
    // editor 커밋과 동일한 gestureId 규칙 공유 - UUID + 길이 상한
    if request
        .gesture_id
        .as_deref()
        .is_some_and(|gesture_id| !is_valid_gesture_id(gesture_id))
    {
        return Err("INVALID_PLUGIN_GESTURE_ID".to_string());
    }
    if request.authority_generation > MAX_SAFE_WIRE_REVISION
        || request
            .observed_history_epoch
            .is_some_and(|revision| revision > MAX_SAFE_WIRE_REVISION)
        || request
            .expected_model_revision
            .is_some_and(|revision| revision > MAX_SAFE_WIRE_REVISION)
    {
        return Err("PLUGIN_REVISION_OUT_OF_RANGE".to_string());
    }
    validate_saved_plugin_instances(&request.instances)?;
    // 커밋 진입 fail-closed - 프론트 발급이 배선된 뒤의 무ID 커밋은 영속
    // 신원 없는 저장이므로 거절. 저장 데이터 읽기(decode)는 backfill 전
    // 데이터를 위해 관대 유지
    for (index, instance) in request.instances.iter().enumerate() {
        if instance.instance_id.is_none() {
            return Err(format!("MISSING_PLUGIN_INSTANCE_ID:{index}"));
        }
    }
    validate_compact_size(
        request,
        MAX_PLUGIN_INSTANCES_REQUEST_BYTES,
        "PLUGIN_INSTANCES_REQUEST_TOO_LARGE",
    )
}

pub(crate) fn validate_plugin_instances_reconcile_request(
    request: &PluginInstancesReconcileRequest,
) -> Result<usize, String> {
    validate_plugin_id(&request.plugin_id)?;
    validate_plugin_mutation_id(&request.mutation_id)?;
    if request.authority_generation > MAX_SAFE_WIRE_REVISION
        || request
            .observed_history_epoch
            .is_some_and(|epoch| epoch > MAX_SAFE_WIRE_REVISION)
    {
        return Err("PLUGIN_REVISION_OUT_OF_RANGE".to_string());
    }
    if request.valid_tab_ids.len() > MAX_PLUGIN_RECONCILE_TAB_IDS {
        return Err("TOO_MANY_PLUGIN_RECONCILE_TAB_IDS".to_string());
    }
    for (index, tab_id) in request.valid_tab_ids.iter().enumerate() {
        if !valid_plugin_tab_id(tab_id) {
            return Err(format!("INVALID_PLUGIN_RECONCILE_TAB_ID:{index}"));
        }
    }
    validate_compact_size(
        request,
        MAX_PLUGIN_INSTANCES_REQUEST_BYTES,
        "PLUGIN_INSTANCES_RECONCILE_REQUEST_TOO_LARGE",
    )
}

fn validate_plugin_mutation_id(mutation_id: &str) -> Result<(), String> {
    if mutation_id.len() > 64 || uuid::Uuid::parse_str(mutation_id).is_err() {
        return Err("INVALID_PLUGIN_MUTATION_ID".to_string());
    }
    Ok(())
}

pub(crate) fn validate_plugin_id(plugin_id: &str) -> Result<(), String> {
    if plugin_id.is_empty()
        || plugin_id.len() > MAX_PLUGIN_ID_BYTES
        || !plugin_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("INVALID_PLUGIN_ID".to_string());
    }
    Ok(())
}

pub(crate) fn validate_saved_plugin_instances(
    instances: &[SavedPluginInstance],
) -> Result<(), String> {
    if instances.len() > MAX_PLUGIN_INSTANCES {
        return Err("TOO_MANY_PLUGIN_INSTANCES".to_string());
    }
    let mut seen_instance_ids = HashSet::new();
    for (index, instance) in instances.iter().enumerate() {
        // 영구 인스턴스 ID는 canonical element ID와 같은 UUID 형식, 같은 플러그인 안에서 유일.
        // None은 여기서는 허용 - decode(backfill 전 데이터 읽기)가 이 함수를 공유하므로
        // 무ID 거절은 커밋 진입(validate_plugin_instances_request)만 수행.
        // group_id는 형상만 검증 (비어있지 않음, 바이트 상한) - 그룹 존재
        // 검증은 도메인 결합 회피로 미수행, dangling은 읽기 가드가 무해화
        if let Some(instance_id) = instance.instance_id.as_deref() {
            if !is_valid_element_id(instance_id) {
                return Err(format!("INVALID_PLUGIN_INSTANCE_ID:{index}"));
            }
            if !seen_instance_ids.insert(instance_id) {
                return Err(format!("DUPLICATE_PLUGIN_INSTANCE_ID:{index}"));
            }
        }
        if !valid_coordinate(instance.position.x) || !valid_coordinate(instance.position.y) {
            return Err(format!("INVALID_PLUGIN_INSTANCE_POSITION:{index}"));
        }
        if let Some(size) = &instance.measured_size {
            if !valid_dimension(size.width) || !valid_dimension(size.height) {
                return Err(format!("INVALID_PLUGIN_INSTANCE_SIZE:{index}"));
            }
        }
        if instance.z_index.is_some_and(|z_index| {
            !z_index.is_finite()
                || z_index.fract() != 0.0
                || z_index < f64::from(i32::MIN)
                || z_index > f64::from(i32::MAX)
        }) {
            return Err(format!("INVALID_PLUGIN_INSTANCE_Z_INDEX:{index}"));
        }
        if instance
            .tab_id
            .as_deref()
            .is_some_and(|tab_id| !valid_plugin_tab_id(tab_id))
        {
            return Err(format!("INVALID_PLUGIN_INSTANCE_TAB_ID:{index}"));
        }
        if instance
            .group_id
            .as_deref()
            .is_some_and(|group_id| !is_valid_group_id_shape(group_id))
        {
            return Err(format!("INVALID_PLUGIN_INSTANCE_GROUP_ID:{index}"));
        }
        if let Some(settings) = &instance.settings {
            if settings.len() > MAX_SETTING_FIELDS {
                return Err(format!("TOO_MANY_PLUGIN_INSTANCE_SETTINGS:{index}"));
            }
            for (key, value) in settings {
                if key.is_empty() || key.len() > MAX_SETTING_KEY_BYTES {
                    return Err(format!("INVALID_PLUGIN_SETTING_KEY:{index}"));
                }
                match value {
                    crate::models::PluginSettingValue::String(value)
                        if value.len() > MAX_SETTING_STRING_BYTES =>
                    {
                        return Err(format!("PLUGIN_SETTING_STRING_TOO_LARGE:{index}"));
                    }
                    crate::models::PluginSettingValue::Number(value) if !value.is_finite() => {
                        return Err(format!("INVALID_PLUGIN_SETTING_NUMBER:{index}"));
                    }
                    _ => {}
                }
            }
        }
    }
    Ok(())
}

fn valid_plugin_tab_id(tab_id: &str) -> bool {
    !tab_id.is_empty() && tab_id.len() <= MAX_TAB_ID_BYTES
}

pub(crate) fn normalize_plugin_instance_tab_id(tab_id: Option<&str>) -> &str {
    // 프론트 normalizePluginInstanceTabId(`tabId || '4key'`)와 동일 규칙 -
    // 빈 문자열도 4key로 접는다. 정상 커밋은 ""를 거절하지만 관대 decode
    // 경로(backfill, 그룹 refs 수집)는 검증을 안 거치므로 여기서 맞춘다
    tab_id.filter(|tab_id| !tab_id.is_empty()).unwrap_or("4key")
}

fn valid_coordinate(value: f64) -> bool {
    value.is_finite() && value.abs() <= MAX_ABS_COORDINATE
}

fn valid_dimension(value: f64) -> bool {
    value.is_finite() && (0.0..=MAX_DIMENSION).contains(&value)
}

// 모드별 플러그인 그룹 참조 집합 - remove_empty_layer_groups의 생존 판정 입력.
// 모드 판정은 저장 규칙(tab_id normalize)과 동일해야 프론트 집계와 드리프트가 없다
pub(crate) type PluginGroupRefs = HashMap<String, HashSet<String>>;

pub(crate) fn add_plugin_group_refs(refs: &mut PluginGroupRefs, instances: &[SavedPluginInstance]) {
    for instance in instances {
        if let Some(group_id) = instance.group_id.as_deref() {
            let mode = normalize_plugin_instance_tab_id(instance.tab_id.as_deref());
            refs.entry(mode.to_string())
                .or_default()
                .insert(group_id.to_string());
        }
    }
}

// plugin_data의 인스턴스 키를 관대한 decode로 순회 - 그룹 refs 수집의 단일
// 규칙 소스. 형태가 깨진 키는 건너뛰어 집계에서만 제외하고 커밋을 막지 않는다
pub(crate) fn for_each_stored_plugin_instances(
    data: &AppStoreData,
    mut visit: impl FnMut(&str, Vec<SavedPluginInstance>),
) {
    for (key, value) in &data.plugin_data {
        let Some(plugin_id) = plugin_id_from_instances_storage_key(key) else {
            continue;
        };
        let Ok(instances) = serde_json::from_value::<Vec<SavedPluginInstance>>(value.clone())
        else {
            continue;
        };
        visit(plugin_id, instances);
    }
}

// store의 인스턴스에서 그룹 참조 수집. exclude는 gesture 동봉 plugin_changes로
// 대체될 플러그인 - editor op 적용이 pluginChanges보다 먼저라 store 값은 낡았다
pub(crate) fn plugin_group_refs_from_store(
    data: &AppStoreData,
    exclude_plugin_ids: &HashSet<&str>,
) -> PluginGroupRefs {
    let mut refs = PluginGroupRefs::new();
    for_each_stored_plugin_instances(data, |plugin_id, instances| {
        if exclude_plugin_ids.contains(plugin_id) {
            return;
        }
        add_plugin_group_refs(&mut refs, &instances);
    });
    refs
}

pub(crate) fn plugin_instances_storage_key(plugin_id: &str) -> String {
    format!("{PLUGIN_DATA_KEY_PREFIX}{plugin_id}/instances")
}

pub(crate) fn plugin_id_from_instances_storage_key(key: &str) -> Option<&str> {
    key.strip_prefix(PLUGIN_DATA_KEY_PREFIX)
        .and_then(|key| key.strip_suffix("/instances"))
        .filter(|plugin_id| !plugin_id.is_empty())
}

pub(crate) fn is_plugin_instances_storage_key(key: &str) -> bool {
    plugin_id_from_instances_storage_key(key).is_some()
}

// 로드 시점 backfill: 무ID 플러그인 인스턴스에 영구 instanceId 부여.
// recovery 완료 후 호출 전제 - None은 구데이터 승격(changed만),
// invalid나 플러그인 내 중복은 수리(repaired)로 재발급
pub(crate) fn backfill_plugin_instance_ids(data: &mut AppStoreData) -> BackfillOutcome {
    let mut outcome = BackfillOutcome::default();
    // 정렬 순회로 HashMap 비결정성 제거 - 첫 출현 보존이 결정적이게
    let mut keys = data
        .plugin_data
        .keys()
        .filter(|key| is_plugin_instances_storage_key(key))
        .cloned()
        .collect::<Vec<_>>();
    keys.sort_unstable();

    // 부수효과: 형태가 깨져 skip된 버킷은 for_each_stored_plugin_instances에서도
    // 빠지므로 plugin_group_refs에 잡히지 않는다. 그 플러그인 인스턴스만 들어
    // 있던 layer group은 다음 complete_mode_order reorder에서 빈 그룹으로 정리되고,
    // 나중에 버킷이 복구돼도 그룹 def는 돌아오지 않는다 (인스턴스 데이터 자체는
    // 원본 보존으로 살아남는다)
    // 1차 패스: 전 플러그인의 유효 기존 instanceId 수집 (재발급 충돌 예약)
    // decode_plugin_instances 대신 관대한 decode 사용 - decode_plugin_instances는
    // validate를 경유하므로 invalid ID가 남은 store가 여기서 decode 실패로
    // 빠져 영구 수리 불가가 된다. 형태 자체가 깨진 키만 skip하고 원본 Value를
    // 보존해 런타임 read의 fail-closed에 위임
    let mut reserved = HashSet::new();
    let mut decoded = Vec::with_capacity(keys.len());
    for key in keys {
        let Some(value) = data.plugin_data.get(&key) else {
            continue;
        };
        let instances = match serde_json::from_value::<Vec<SavedPluginInstance>>(value.clone()) {
            Ok(instances) => instances,
            Err(error) => {
                log::warn!("[Store] Skipping plugin instance ID backfill for {key}: {error}");
                continue;
            }
        };
        if instances.is_empty() {
            continue;
        }
        for instance in &instances {
            if let Some(id) = instance.instance_id.as_deref() {
                if is_valid_element_id(id) {
                    reserved.insert(id.to_string());
                }
            }
        }
        decoded.push((key, instances));
    }

    // 2차 패스: 유효하고 플러그인 내 최초 출현인 ID만 보존, 나머지 재발급.
    // 유일성 판정은 커밋 검증과 동일하게 플러그인 키 단위 - 교차 플러그인
    // 중복은 합법이라 무변경 (fullId가 pluginId 접두 네임스페이스라 충돌 없음).
    // reserved는 전역 유지 - 신규 발급이 기존 어떤 ID와도 겹치지 않게
    for (key, mut instances) in decoded {
        let mut seen = HashSet::new();
        let mut changed = false;
        for instance in &mut instances {
            let kept = instance
                .instance_id
                .as_deref()
                .is_some_and(|id| is_valid_element_id(id) && seen.insert(id.to_string()));
            if kept {
                continue;
            }
            if instance.instance_id.is_some() {
                outcome.repaired = true;
            }
            let id = new_unique_id(&mut reserved);
            seen.insert(id.clone());
            instance.instance_id = Some(id);
            changed = true;
        }
        if !changed {
            continue;
        }
        match serde_json::to_value(&instances) {
            Ok(value) => {
                data.plugin_data.insert(key, value);
                outcome.changed = true;
            }
            Err(error) => {
                log::warn!("[Store] Skipping plugin instance ID backfill for {key}: {error}");
            }
        }
    }
    outcome
}

pub(crate) fn decode_plugin_instances(
    value: Option<&Value>,
) -> Result<Option<Vec<SavedPluginInstance>>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let instances = serde_json::from_value::<Vec<SavedPluginInstance>>(value.clone())
        .map_err(|error| format!("INVALID_STORED_PLUGIN_INSTANCES:{error}"))?;
    validate_saved_plugin_instances(&instances)?;
    validate_compact_size(
        &instances,
        MAX_PLUGIN_INSTANCES_REQUEST_BYTES,
        "STORED_PLUGIN_INSTANCES_TOO_LARGE",
    )?;
    Ok((!instances.is_empty()).then_some(instances))
}

pub(crate) fn encode_plugin_instances(
    instances: &[SavedPluginInstance],
) -> Result<Option<Value>, String> {
    if instances.is_empty() {
        return Ok(None);
    }
    serde_json::to_value(instances)
        .map(Some)
        .map_err(|error| format!("INVALID_PLUGIN_INSTANCES_PAYLOAD:{error}"))
}

fn validate_compact_size(
    value: &impl Serialize,
    limit: usize,
    error_code: &str,
) -> Result<usize, String> {
    let size = serde_json::to_vec(value)
        .map_err(|error| format!("INVALID_WIRE_PAYLOAD:{error}"))?
        .len();
    if size > limit {
        return Err(error_code.to_string());
    }
    Ok(size)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::models::{
        PluginInstancesCommitRequest, PluginInstancesReconcileRequest, PluginPoint,
        PluginSettingValue,
    };
    use crate::state::editor::MAX_GROUP_ID_BYTES;

    fn saved_instance() -> SavedPluginInstance {
        SavedPluginInstance {
            instance_id: Some(uuid::Uuid::new_v4().to_string()),
            position: PluginPoint { x: 1.0, y: 2.0 },
            settings: None,
            measured_size: None,
            tab_id: Some("4key".to_string()),
            hidden: false,
            z_index: None,
            group_id: None,
        }
    }

    #[test]
    fn authority_generation_advances_and_rejects_stale_leases() {
        let authority = PluginRuntimeAuthority::default();
        assert_eq!(
            authority.admit(0).unwrap_err(),
            "AUTHORITY_UNAVAILABLE".to_string()
        );
        let generation = authority.reset().unwrap().generation();
        assert_eq!(generation, 1);
        assert!(authority.admit(1).is_ok());
        assert_eq!(
            authority.admit(0).unwrap_err(),
            "AUTHORITY_GENERATION_CHANGED".to_string()
        );
        authority.mark_unavailable();
        assert_eq!(
            authority.admit(1).unwrap_err(),
            "AUTHORITY_UNAVAILABLE".to_string()
        );
    }

    #[test]
    fn saved_instance_wire_rejects_unknown_fields() {
        let error = serde_json::from_value::<SavedPluginInstance>(serde_json::json!({
            "position": { "x": 1.0, "y": 2.0 },
            "tabId": "4key",
            "handler": "not allowed"
        }))
        .unwrap_err();
        assert!(error.to_string().contains("unknown field"));

        validate_saved_plugin_instances(&[saved_instance()]).unwrap();
    }

    #[test]
    fn saved_instance_wire_defaults_legacy_visibility_and_z_index() {
        let instance = serde_json::from_value::<SavedPluginInstance>(serde_json::json!({
            "position": { "x": 1.0, "y": 2.0 },
            "tabId": "4key"
        }))
        .unwrap();

        assert!(!instance.hidden);
        assert_eq!(instance.z_index, None);
    }

    #[test]
    fn saved_instance_wire_rejects_invalid_z_indexes() {
        for z_index in [1.5, f64::from(i32::MAX) + 1.0, f64::NAN] {
            let instance = SavedPluginInstance {
                z_index: Some(z_index),
                ..saved_instance()
            };

            assert_eq!(
                validate_saved_plugin_instances(&[instance]).unwrap_err(),
                "INVALID_PLUGIN_INSTANCE_Z_INDEX:0"
            );
        }
    }

    #[test]
    fn legacy_saved_instances_decode_without_identity_fields() {
        // 구형 JSON에는 instanceId/groupId가 없다 - decode(validate 경유) 통과와 None 기본값 고정
        let legacy = serde_json::json!([
            { "position": { "x": 1.0, "y": 2.0 }, "tabId": "4key" },
            { "position": { "x": 3.0, "y": 4.0 }, "tabId": "4key" }
        ]);

        let instances = decode_plugin_instances(Some(&legacy)).unwrap().unwrap();

        assert_eq!(instances.len(), 2);
        assert!(instances
            .iter()
            .all(|instance| instance.instance_id.is_none() && instance.group_id.is_none()));
    }

    #[test]
    fn saved_instance_identity_fields_survive_encode_decode_round_trip() {
        let instance = SavedPluginInstance {
            instance_id: Some(uuid::Uuid::new_v4().to_string()),
            group_id: Some("layer-group".to_string()),
            ..saved_instance()
        };

        let encoded = encode_plugin_instances(std::slice::from_ref(&instance))
            .unwrap()
            .unwrap();
        let decoded = decode_plugin_instances(Some(&encoded)).unwrap().unwrap();

        assert_eq!(decoded, vec![instance]);
    }

    #[test]
    fn saved_instance_wire_rejects_invalid_instance_ids() {
        for invalid_id in ["not-a-uuid".to_string(), uuid::Uuid::nil().to_string()] {
            let instance = SavedPluginInstance {
                instance_id: Some(invalid_id),
                ..saved_instance()
            };

            assert_eq!(
                validate_saved_plugin_instances(&[instance]).unwrap_err(),
                "INVALID_PLUGIN_INSTANCE_ID:0"
            );
        }
    }

    #[test]
    fn decode_rejects_stored_instances_with_invalid_instance_id() {
        // decode 경로가 validate를 경유하는지 고정
        let stored = serde_json::json!([{
            "position": { "x": 1.0, "y": 2.0 },
            "tabId": "4key",
            "instanceId": "not-a-uuid"
        }]);

        assert_eq!(
            decode_plugin_instances(Some(&stored)).unwrap_err(),
            "INVALID_PLUGIN_INSTANCE_ID:0"
        );
    }

    #[test]
    fn saved_instance_wire_rejects_invalid_group_ids() {
        for invalid_group_id in [String::new(), "x".repeat(MAX_GROUP_ID_BYTES + 1)] {
            let instance = SavedPluginInstance {
                group_id: Some(invalid_group_id),
                ..saved_instance()
            };

            assert_eq!(
                validate_saved_plugin_instances(&[instance]).unwrap_err(),
                "INVALID_PLUGIN_INSTANCE_GROUP_ID:0"
            );
        }

        // 상한 경계 길이는 통과
        let boundary = SavedPluginInstance {
            group_id: Some("x".repeat(MAX_GROUP_ID_BYTES)),
            ..saved_instance()
        };
        validate_saved_plugin_instances(&[boundary]).unwrap();
    }

    #[test]
    fn decode_rejects_stored_instances_with_empty_group_id() {
        // decode도 validate 공유 - 손상 group_id는 해당 플러그인만 격리 초기화
        let stored = serde_json::json!([{
            "position": { "x": 1.0, "y": 2.0 },
            "tabId": "4key",
            "instanceId": uuid::Uuid::new_v4().to_string(),
            "groupId": ""
        }]);

        assert_eq!(
            decode_plugin_instances(Some(&stored)).unwrap_err(),
            "INVALID_PLUGIN_INSTANCE_GROUP_ID:0"
        );
    }

    #[test]
    fn normalize_tab_id_folds_missing_and_empty_to_default_mode() {
        // 프론트 normalizePluginInstanceTabId(`tabId || '4key'`)와 동일 규칙 고정
        assert_eq!(normalize_plugin_instance_tab_id(None), "4key");
        assert_eq!(normalize_plugin_instance_tab_id(Some("")), "4key");
        assert_eq!(normalize_plugin_instance_tab_id(Some("8key")), "8key");
    }

    #[test]
    fn group_refs_fold_empty_tab_id_into_default_mode() {
        // 손상 store의 "" tabId도 4key 모드로 집계 - 모드 판정 드리프트 방지
        let mut refs = PluginGroupRefs::new();
        let instance = SavedPluginInstance {
            tab_id: Some(String::new()),
            group_id: Some("plugin-group".to_string()),
            ..saved_instance()
        };
        add_plugin_group_refs(&mut refs, &[instance]);
        assert!(refs["4key"].contains("plugin-group"));
        assert!(!refs.contains_key(""));

        // store 수집(관대 decode 경로)도 동일 판정
        let mut data = AppStoreData::default();
        data.plugin_data.insert(
            "plugin_data_demo/instances".to_string(),
            serde_json::json!([{
                "position": { "x": 1.0, "y": 2.0 },
                "tabId": "",
                "groupId": "stored-group"
            }]),
        );
        let refs = plugin_group_refs_from_store(&data, &HashSet::new());
        assert!(refs["4key"].contains("stored-group"));
        assert!(!refs.contains_key(""));
    }

    #[test]
    fn saved_instance_wire_rejects_duplicate_instance_ids_within_plugin() {
        let shared = uuid::Uuid::new_v4().to_string();
        let instances = [
            SavedPluginInstance {
                instance_id: Some(shared.clone()),
                ..saved_instance()
            },
            SavedPluginInstance {
                instance_id: Some(shared),
                ..saved_instance()
            },
        ];

        assert_eq!(
            validate_saved_plugin_instances(&instances).unwrap_err(),
            "DUPLICATE_PLUGIN_INSTANCE_ID:1"
        );
    }

    #[test]
    fn plugin_instances_request_enforces_compact_size_limit() {
        let mut settings = BTreeMap::new();
        settings.insert(
            "label".to_string(),
            PluginSettingValue::String("x".repeat(MAX_SETTING_STRING_BYTES)),
        );
        // ID 중복 거절에 먼저 걸리지 않게 인스턴스별 고유 ID 부여
        let instances = (0..129)
            .map(|index| SavedPluginInstance {
                instance_id: Some(format!("00000000-0000-4000-8000-{index:012x}")),
                settings: Some(settings.clone()),
                ..saved_instance()
            })
            .collect::<Vec<_>>();
        let request = PluginInstancesCommitRequest {
            plugin_id: "demo".to_string(),
            instances,
            mutation_id: uuid::Uuid::new_v4().to_string(),
            gesture_id: None,
            observed_history_epoch: None,
            expected_model_revision: None,
            authority_generation: 1,
        };

        assert_eq!(
            validate_plugin_instances_request(&request).unwrap_err(),
            "PLUGIN_INSTANCES_REQUEST_TOO_LARGE"
        );
    }

    #[test]
    fn plugin_instances_request_shares_editor_gesture_id_rules() {
        let mut request = PluginInstancesCommitRequest {
            plugin_id: "demo".to_string(),
            instances: vec![saved_instance()],
            mutation_id: uuid::Uuid::new_v4().to_string(),
            gesture_id: None,
            observed_history_epoch: None,
            expected_model_revision: None,
            authority_generation: 1,
        };

        // 프론트 crypto.randomUUID() 발급분은 통과
        request.gesture_id = Some(uuid::Uuid::new_v4().to_string());
        validate_plugin_instances_request(&request).unwrap();

        // 비UUID 형식 거절 - editor 경로와 동일 규칙 (길이 상한은 UUID 파싱이
        // 먼저 걸러 독립 관측 불가, 방어층으로만 존재)
        for invalid_gesture_id in ["not-a-uuid".to_string(), "가".repeat(22)] {
            request.gesture_id = Some(invalid_gesture_id);
            assert_eq!(
                validate_plugin_instances_request(&request).unwrap_err(),
                "INVALID_PLUGIN_GESTURE_ID"
            );
        }
    }

    #[test]
    fn plugin_storage_key_wire_bytes_are_stable() {
        assert_eq!(
            plugin_instances_storage_key("demo"),
            "plugin_data_demo/instances"
        );
        assert_eq!(
            plugin_id_from_instances_storage_key("plugin_data_demo/instances"),
            Some("demo")
        );
        assert!(is_plugin_instances_storage_key(
            "plugin_data_demo/instances"
        ));
    }

    #[test]
    fn plugin_instances_request_rejects_missing_instance_id() {
        let request = PluginInstancesCommitRequest {
            plugin_id: "demo".to_string(),
            instances: vec![SavedPluginInstance {
                instance_id: None,
                ..saved_instance()
            }],
            mutation_id: uuid::Uuid::new_v4().to_string(),
            gesture_id: None,
            observed_history_epoch: None,
            expected_model_revision: None,
            authority_generation: 1,
        };

        assert_eq!(
            validate_plugin_instances_request(&request).unwrap_err(),
            "MISSING_PLUGIN_INSTANCE_ID:0"
        );
    }

    #[test]
    fn plugin_instances_reconcile_request_validates_tabs_and_wire_shape() {
        let base = PluginInstancesReconcileRequest {
            plugin_id: "demo".to_string(),
            valid_tab_ids: vec!["4key".to_string()],
            mutation_id: uuid::Uuid::new_v4().to_string(),
            observed_history_epoch: None,
            authority_generation: 1,
        };
        validate_plugin_instances_reconcile_request(&base).unwrap();

        let mut invalid_epoch = base.clone();
        invalid_epoch.observed_history_epoch = Some(MAX_SAFE_WIRE_REVISION + 1);
        assert_eq!(
            validate_plugin_instances_reconcile_request(&invalid_epoch).unwrap_err(),
            "PLUGIN_REVISION_OUT_OF_RANGE"
        );

        let mut too_many = base.clone();
        too_many.valid_tab_ids = vec!["4key".to_string(); MAX_PLUGIN_RECONCILE_TAB_IDS + 1];
        assert_eq!(
            validate_plugin_instances_reconcile_request(&too_many).unwrap_err(),
            "TOO_MANY_PLUGIN_RECONCILE_TAB_IDS"
        );

        for invalid_tab_id in [String::new(), "x".repeat(MAX_TAB_ID_BYTES + 1)] {
            let mut invalid = base.clone();
            invalid.valid_tab_ids = vec![invalid_tab_id];
            assert_eq!(
                validate_plugin_instances_reconcile_request(&invalid).unwrap_err(),
                "INVALID_PLUGIN_RECONCILE_TAB_ID:0"
            );
        }

        let unknown = serde_json::json!({
            "pluginId": "demo",
            "validTabIds": ["4key"],
            "mutationId": uuid::Uuid::new_v4().to_string(),
            "authorityGeneration": 1,
            "unexpected": true,
        });
        assert!(serde_json::from_value::<PluginInstancesReconcileRequest>(unknown).is_err());
    }
}
