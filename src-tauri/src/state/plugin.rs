use std::collections::{HashMap, HashSet};

use parking_lot::Mutex;
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

// 입장 허가 - generation 스냅샷만 든다. 잠금을 든 채 번호표 turn을 기다리면
// 앞 번호표가 admit에서 이 잠금을 기다려 교착한다 (잠금 순서: 번호표 turn → authority).
// reset과의 배제는 번호표 FIFO가 맡고, 커맨드는 turn 안에서 revalidate로 다시 확인한다
#[derive(Debug, Clone, Copy)]
pub(crate) struct PluginAuthorityLease {
    generation: u64,
}

impl PluginAuthorityLease {
    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }
}

impl PluginRuntimeAuthority {
    pub(crate) fn admit(&self, expected_generation: u64) -> Result<PluginAuthorityLease, String> {
        let guard = self.state.lock();
        if !guard.available {
            return Err("AUTHORITY_UNAVAILABLE".to_string());
        }
        if guard.generation != expected_generation {
            return Err("AUTHORITY_GENERATION_CHANGED".to_string());
        }
        Ok(PluginAuthorityLease {
            generation: guard.generation,
        })
    }

    // 번호표 turn 안 재확인 - turn 대기 중 reset이 끼어든 커밋을 거절
    pub(crate) fn revalidate(&self, lease: PluginAuthorityLease) -> Result<(), String> {
        self.admit(lease.generation()).map(drop)
    }

    pub(crate) fn reset(&self) -> Result<PluginAuthorityLease, String> {
        let mut state = self.state.lock();
        state.generation = state
            .generation
            .checked_add(1)
            .filter(|generation| *generation <= MAX_SAFE_WIRE_REVISION)
            .ok_or_else(|| "AUTHORITY_GENERATION_OUT_OF_RANGE".to_string())?;
        state.available = true;
        Ok(PluginAuthorityLease {
            generation: state.generation,
        })
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
    validate_saved_plugin_instances_envelope(&request.instances)?;
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

pub(crate) fn validate_plugin_instances_transition(
    current: &[SavedPluginInstance],
    candidate: &[SavedPluginInstance],
) -> Result<(), String> {
    validate_saved_plugin_instances_envelope(candidate)?;
    let current_by_id = current
        .iter()
        .filter_map(|instance| instance.instance_id.as_deref().map(|id| (id, instance)))
        .collect::<HashMap<_, _>>();
    for (index, instance) in candidate.iter().enumerate() {
        let counterpart = instance
            .instance_id
            .as_deref()
            .and_then(|id| current_by_id.get(id))
            .copied();
        for (current, next) in [
            (counterpart.map(|item| item.position.x), instance.position.x),
            (counterpart.map(|item| item.position.y), instance.position.y),
        ] {
            if valid_coordinate(next)
                || current.is_some_and(|value| {
                    !valid_coordinate(value) && numeric_metric_non_increasing(value, next, false)
                })
            {
                continue;
            }
            return Err(format!("INVALID_PLUGIN_INSTANCE_POSITION:{index}"));
        }
        if let Some(size) = &instance.measured_size {
            let current_size = counterpart.and_then(|item| item.measured_size.as_ref());
            for (current, next) in [
                (current_size.map(|item| item.width), size.width),
                (current_size.map(|item| item.height), size.height),
            ] {
                if valid_dimension(next)
                    || current.is_some_and(|value| {
                        !valid_dimension(value) && numeric_metric_non_increasing(value, next, true)
                    })
                {
                    continue;
                }
                return Err(format!("INVALID_PLUGIN_INSTANCE_SIZE:{index}"));
            }
        }
    }
    Ok(())
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
        || !plugin_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("INVALID_PLUGIN_ID".to_string());
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn validate_saved_plugin_instances(
    instances: &[SavedPluginInstance],
) -> Result<(), String> {
    validate_saved_plugin_instances_envelope(instances)?;
    for (index, instance) in instances.iter().enumerate() {
        if !valid_coordinate(instance.position.x) || !valid_coordinate(instance.position.y) {
            return Err(format!("INVALID_PLUGIN_INSTANCE_POSITION:{index}"));
        }
        if let Some(size) = &instance.measured_size {
            if !valid_dimension(size.width) || !valid_dimension(size.height) {
                return Err(format!("INVALID_PLUGIN_INSTANCE_SIZE:{index}"));
            }
        }
    }
    Ok(())
}

fn validate_saved_plugin_instances_envelope(
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
        if !instance.position.x.is_finite() || !instance.position.y.is_finite() {
            return Err(format!("INVALID_PLUGIN_INSTANCE_POSITION:{index}"));
        }
        if let Some(size) = &instance.measured_size {
            if !size.width.is_finite() || !size.height.is_finite() {
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

fn numeric_metric_non_increasing(current: f64, candidate: f64, dimension: bool) -> bool {
    if !current.is_finite() || !candidate.is_finite() {
        return current.to_bits() == candidate.to_bits();
    }
    if dimension && (current < 0.0 || candidate < 0.0) {
        return current.to_bits() == candidate.to_bits();
    }
    if dimension {
        candidate <= current
    } else {
        candidate.abs() <= current.abs()
    }
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
// 규칙 소스. 잘못된 항목은 로그 후 제외하고 정상 항목은 유지한다
pub(crate) fn for_each_stored_plugin_instances(
    data: &AppStoreData,
    mut visit: impl FnMut(&str, Vec<SavedPluginInstance>),
) {
    for (key, value) in &data.plugin_data {
        let Some(plugin_id) = plugin_id_from_instances_storage_key(key) else {
            continue;
        };
        let instances = decode_plugin_instances_lenient(Some(value), key).unwrap_or_default();
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
        .filter(|plugin_id| validate_plugin_id(plugin_id).is_ok())
}

pub(crate) fn is_plugin_instances_storage_key(key: &str) -> bool {
    plugin_id_from_instances_storage_key(key).is_some()
}

#[derive(Debug)]
pub(crate) enum StoredPluginInstanceEntry {
    Parsed {
        instance: SavedPluginInstance,
        original: Value,
    },
    Unparsed(Value),
}

pub(crate) fn decode_plugin_instance_entries(
    value: &Value,
    storage_key: &str,
) -> Option<Vec<StoredPluginInstanceEntry>> {
    let Some(entries) = value.as_array() else {
        log::warn!("[Store] Invalid plugin instance bucket {storage_key}: expected array");
        return None;
    };

    Some(
        entries
            .iter()
            .enumerate()
            .map(|(index, entry)| {
                match serde_json::from_value::<SavedPluginInstance>(entry.clone()) {
                    Ok(instance) => StoredPluginInstanceEntry::Parsed {
                        instance,
                        original: entry.clone(),
                    },
                    Err(error) => {
                        log::warn!(
                            "[Store] Invalid plugin instance entry key={storage_key} index={index}: {error}"
                        );
                        StoredPluginInstanceEntry::Unparsed(entry.clone())
                    }
                }
            })
            .collect(),
    )
}

pub(crate) fn encode_plugin_instance_entries(
    entries: Vec<StoredPluginInstanceEntry>,
    storage_key: &str,
) -> Value {
    Value::Array(
        entries
            .into_iter()
            .enumerate()
            .map(|(index, entry)| match entry {
                StoredPluginInstanceEntry::Parsed { instance, original } => {
                    serde_json::to_value(instance).unwrap_or_else(|error| {
                        log::warn!(
                            "[Store] Preserving original plugin instance key={storage_key} index={index}: {error}"
                        );
                        original
                    })
                }
                StoredPluginInstanceEntry::Unparsed(value) => value,
            })
            .collect(),
    )
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

    // 1차 패스: 전 플러그인의 유효 기존 instanceId 수집 (재발급 충돌 예약)
    let mut reserved = HashSet::new();
    let mut decoded = Vec::with_capacity(keys.len());
    for key in keys {
        let Some(value) = data.plugin_data.get(&key) else {
            continue;
        };
        let Some(entries) = decode_plugin_instance_entries(value, &key) else {
            continue;
        };
        if entries.is_empty() {
            continue;
        }
        for entry in &entries {
            let StoredPluginInstanceEntry::Parsed { instance, .. } = entry else {
                continue;
            };
            if let Some(id) = instance.instance_id.as_deref() {
                if is_valid_element_id(id) {
                    reserved.insert(id.to_string());
                }
            }
        }
        decoded.push((key, entries));
    }

    // 2차 패스: 유효하고 플러그인 내 최초 출현인 ID만 보존, 나머지 재발급.
    // 유일성 판정은 커밋 검증과 동일하게 플러그인 키 단위 - 교차 플러그인
    // 중복은 합법이라 무변경 (fullId가 pluginId 접두 네임스페이스라 충돌 없음).
    // reserved는 전역 유지 - 신규 발급이 기존 어떤 ID와도 겹치지 않게
    for (key, mut entries) in decoded {
        let mut seen = HashSet::new();
        let mut changed = false;
        for entry in &mut entries {
            let StoredPluginInstanceEntry::Parsed { instance, .. } = entry else {
                continue;
            };
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
        let value = encode_plugin_instance_entries(entries, &key);
        data.plugin_data.insert(key, value);
        outcome.changed = true;
    }
    outcome
}

#[cfg(test)]
pub(crate) fn decode_plugin_instances(
    value: Option<&Value>,
) -> Result<Option<Vec<SavedPluginInstance>>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let instances = serde_json::from_value::<Vec<SavedPluginInstance>>(value.clone())
        .map_err(|error| format!("INVALID_STORED_PLUGIN_INSTANCES:{error}"))?;
    validate_saved_plugin_instances_envelope(&instances)?;
    validate_compact_size(
        &instances,
        MAX_PLUGIN_INSTANCES_REQUEST_BYTES,
        "STORED_PLUGIN_INSTANCES_TOO_LARGE",
    )?;
    Ok((!instances.is_empty()).then_some(instances))
}

pub(crate) fn decode_plugin_instances_lenient(
    value: Option<&Value>,
    storage_key: &str,
) -> Option<Vec<SavedPluginInstance>> {
    let value = value?;
    let entries = decode_plugin_instance_entries(value, storage_key)?;

    let mut instances = Vec::with_capacity(entries.len().min(MAX_PLUGIN_INSTANCES));
    let mut seen_instance_ids = HashSet::new();
    let mut encoded_bytes = 2usize;
    for (index, entry) in entries.into_iter().enumerate() {
        if instances.len() == MAX_PLUGIN_INSTANCES {
            log::warn!(
                "[Store] Ignoring plugin instance entries beyond limit key={storage_key} limit={MAX_PLUGIN_INSTANCES}"
            );
            break;
        }
        let StoredPluginInstanceEntry::Parsed { instance, .. } = entry else {
            continue;
        };
        let mut validation_instance = instance.clone();
        if validation_instance.tab_id.as_deref() == Some("") {
            validation_instance.tab_id = None;
        }
        if let Err(error) =
            validate_saved_plugin_instances_envelope(std::slice::from_ref(&validation_instance))
        {
            log::warn!(
                "[Store] Ignoring invalid plugin instance key={storage_key} index={index}: {error}"
            );
            continue;
        }
        if instance
            .instance_id
            .as_deref()
            .is_some_and(|id| !seen_instance_ids.insert(id.to_string()))
        {
            log::warn!(
                "[Store] Ignoring duplicate plugin instance ID key={storage_key} index={index}"
            );
            continue;
        }
        let entry_bytes = match serde_json::to_vec(&instance) {
            Ok(bytes) => bytes.len(),
            Err(error) => {
                log::warn!(
                    "[Store] Ignoring unserializable plugin instance key={storage_key} index={index}: {error}"
                );
                continue;
            }
        };
        let separator_bytes = usize::from(!instances.is_empty());
        if encoded_bytes
            .saturating_add(separator_bytes)
            .saturating_add(entry_bytes)
            > MAX_PLUGIN_INSTANCES_REQUEST_BYTES
        {
            log::warn!(
                "[Store] Ignoring oversized plugin instance suffix key={storage_key} index={index}"
            );
            break;
        }
        encoded_bytes += separator_bytes + entry_bytes;
        instances.push(instance);
    }

    (!instances.is_empty()).then_some(instances)
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
mod tests;
