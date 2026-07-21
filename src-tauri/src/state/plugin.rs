use std::collections::VecDeque;

use parking_lot::{Mutex, MutexGuard};
use serde::Serialize;
use serde_json::Value;

use crate::models::{
    PluginInstancesCommitRequest, PluginInstancesReconcileRequest, PluginRpcRequest,
    PluginRpcRequestEnvelope, PluginRpcResponse, SavedPluginInstance,
};

pub(crate) const PLUGIN_RPC_PROTOCOL_VERSION: u32 = 1;
pub(crate) const MAX_PLUGIN_RPC_BYTES: usize = 256 * 1024;
pub(crate) const MAX_PLUGIN_INSTANCES_REQUEST_BYTES: usize = 8 * 1024 * 1024;
const PLUGIN_RPC_ROUTE_CAPACITY: usize = 512;
const MAX_SAFE_WIRE_REVISION: u64 = 9_007_199_254_740_991;
const MAX_PLUGIN_ID_BYTES: usize = 128;
const MAX_PLUGIN_INSTANCES: usize = 4_096;
const MAX_PLUGIN_RECONCILE_TAB_IDS: usize = 64;
const MAX_TAB_ID_BYTES: usize = 128;
const MAX_GESTURE_ID_BYTES: usize = 64;
const MAX_SETTING_FIELDS: usize = 1_024;
const MAX_SETTING_KEY_BYTES: usize = 256;
const MAX_SETTING_STRING_BYTES: usize = 64 * 1024;
const MAX_ABS_COORDINATE: f64 = 32_768.0;
const MAX_DIMENSION: f64 = 32_768.0;
const MAX_RPC_OPERATION_BYTES: usize = 128;
const MAX_RPC_ERROR_CODE_BYTES: usize = 128;
const MAX_RPC_ERROR_MESSAGE_BYTES: usize = 4 * 1024;

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

    pub(crate) fn reset<'a>(
        &'a self,
        router: &PluginRpcRouter,
    ) -> Result<PluginAuthorityLease<'a>, String> {
        let mut state = self.state.lock();
        state.generation = state
            .generation
            .checked_add(1)
            .filter(|generation| *generation <= MAX_SAFE_WIRE_REVISION)
            .ok_or_else(|| "AUTHORITY_GENERATION_OUT_OF_RANGE".to_string())?;
        state.available = true;
        router.clear();
        Ok(PluginAuthorityLease { guard: state })
    }

    pub(crate) fn generation(&self) -> u64 {
        self.state.lock().generation
    }

    pub(crate) fn mark_unavailable(&self, router: &PluginRpcRouter) {
        let mut state = self.state.lock();
        state.available = false;
        router.clear();
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PendingPluginRpcRoute {
    request_id: String,
    source_window_label: String,
    target_window_label: String,
    authority_generation: u64,
}

#[derive(Debug, Default)]
pub(crate) struct PluginRpcRouter {
    pending: Mutex<VecDeque<PendingPluginRpcRoute>>,
}

impl PluginRpcRouter {
    pub(crate) fn has_pending_request(
        &self,
        request_id: &str,
        source_window_label: &str,
        target_window_label: &str,
        authority_generation: u64,
    ) -> bool {
        self.pending.lock().iter().any(|route| {
            route.request_id == request_id
                && route.source_window_label == source_window_label
                && route.target_window_label == target_window_label
                && route.authority_generation == authority_generation
        })
    }

    pub(crate) fn forward_request(
        &self,
        target_window_label: &str,
        envelope: PluginRpcRequestEnvelope,
        current_model_revision: u64,
        emit: impl FnOnce(&str, &PluginRpcRequestEnvelope) -> Result<(), String>,
    ) -> Result<(), String> {
        let mut pending = self.pending.lock();
        if pending
            .iter()
            .any(|route| route.request_id == envelope.request_id)
        {
            return Err("PLUGIN_RPC_REQUEST_ID_REUSED".to_string());
        }
        if !envelope.operation.starts_with("settings:")
            && envelope.expected_model_revision != current_model_revision
        {
            return Err("PLUGIN_MODEL_REVISION_CONFLICT".to_string());
        }

        emit(target_window_label, &envelope)?;
        if pending.len() == PLUGIN_RPC_ROUTE_CAPACITY {
            pending.pop_front();
        }
        pending.push_back(PendingPluginRpcRoute {
            request_id: envelope.request_id,
            source_window_label: envelope.source_window_label,
            target_window_label: target_window_label.to_string(),
            authority_generation: envelope.authority_generation,
        });
        Ok(())
    }

    pub(crate) fn forward_response(
        &self,
        responder_window_label: &str,
        response: &PluginRpcResponse,
        emit: impl FnOnce(&str, &PluginRpcResponse) -> Result<(), String>,
    ) -> Result<(), String> {
        let mut pending = self.pending.lock();
        let index = pending
            .iter()
            .position(|route| route.request_id == response.request_id)
            .ok_or_else(|| "PLUGIN_RPC_REQUEST_NOT_FOUND".to_string())?;
        let route = pending
            .get(index)
            .cloned()
            .ok_or_else(|| "PLUGIN_RPC_REQUEST_NOT_FOUND".to_string())?;
        if route.target_window_label != responder_window_label {
            return Err("PLUGIN_RPC_RESPONDER_MISMATCH".to_string());
        }
        if route.authority_generation != response.authority_generation {
            return Err("AUTHORITY_GENERATION_CHANGED".to_string());
        }
        let result = emit(&route.source_window_label, response);
        pending.remove(index);
        result
    }

    pub(crate) fn clear(&self) {
        self.pending.lock().clear();
    }

    pub(crate) fn remove_window(&self, window_label: &str) {
        self.pending.lock().retain(|route| {
            route.target_window_label != window_label && route.source_window_label != window_label
        });
    }

    #[cfg(test)]
    pub(crate) fn pending_count(&self) -> usize {
        self.pending.lock().len()
    }
}

pub(crate) fn validate_plugin_rpc_request(request: &PluginRpcRequest) -> Result<usize, String> {
    validate_rpc_common(
        request.protocol_version,
        &request.request_id,
        request.authority_generation,
        request.expected_model_revision,
    )?;
    if request.operation.is_empty()
        || request.operation.len() > MAX_RPC_OPERATION_BYTES
        || !request
            .operation
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'.' | b'_' | b'-'))
    {
        return Err("INVALID_PLUGIN_RPC_OPERATION".to_string());
    }
    validate_compact_size(
        request,
        MAX_PLUGIN_RPC_BYTES,
        "PLUGIN_RPC_REQUEST_TOO_LARGE",
    )
}

pub(crate) fn validate_plugin_rpc_response(response: &PluginRpcResponse) -> Result<usize, String> {
    validate_rpc_common(
        response.protocol_version,
        &response.request_id,
        response.authority_generation,
        response.model_revision,
    )?;
    match (
        response.ok,
        response.payload.is_some(),
        response.error.as_ref(),
    ) {
        (true, _, None) => {}
        (false, false, Some(error)) => {
            if error.code.is_empty()
                || error.code.len() > MAX_RPC_ERROR_CODE_BYTES
                || error.message.len() > MAX_RPC_ERROR_MESSAGE_BYTES
            {
                return Err("INVALID_PLUGIN_RPC_ERROR".to_string());
            }
        }
        _ => return Err("INVALID_PLUGIN_RPC_RESPONSE".to_string()),
    }
    validate_compact_size(
        response,
        MAX_PLUGIN_RPC_BYTES,
        "PLUGIN_RPC_RESPONSE_TOO_LARGE",
    )
}

fn validate_rpc_common(
    protocol_version: u32,
    request_id: &str,
    authority_generation: u64,
    model_revision: u64,
) -> Result<(), String> {
    if protocol_version != PLUGIN_RPC_PROTOCOL_VERSION {
        return Err("UNSUPPORTED_PLUGIN_RPC_PROTOCOL".to_string());
    }
    if request_id.len() > 64 || uuid::Uuid::parse_str(request_id).is_err() {
        return Err("INVALID_PLUGIN_RPC_REQUEST_ID".to_string());
    }
    if authority_generation > MAX_SAFE_WIRE_REVISION || model_revision > MAX_SAFE_WIRE_REVISION {
        return Err("PLUGIN_RPC_REVISION_OUT_OF_RANGE".to_string());
    }
    Ok(())
}

pub(crate) fn validate_plugin_instances_request(
    request: &PluginInstancesCommitRequest,
) -> Result<usize, String> {
    validate_plugin_id(&request.plugin_id)?;
    validate_plugin_mutation_id(&request.mutation_id)?;
    if request
        .gesture_id
        .as_ref()
        .is_some_and(|gesture_id| gesture_id.len() > MAX_GESTURE_ID_BYTES)
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
    for (index, instance) in instances.iter().enumerate() {
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
    tab_id.unwrap_or("4key")
}

fn valid_coordinate(value: f64) -> bool {
    value.is_finite() && value.abs() <= MAX_ABS_COORDINATE
}

fn valid_dimension(value: f64) -> bool {
    value.is_finite() && (0.0..=MAX_DIMENSION).contains(&value)
}

pub(crate) fn plugin_instances_storage_key(plugin_id: &str) -> String {
    format!("plugin_data_{plugin_id}/instances")
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
        PluginInstancesCommitRequest, PluginInstancesReconcileRequest, PluginPoint, PluginRpcError,
        PluginSettingValue,
    };

    fn rpc_request(payload: Value) -> PluginRpcRequest {
        PluginRpcRequest {
            protocol_version: PLUGIN_RPC_PROTOCOL_VERSION,
            request_id: uuid::Uuid::new_v4().to_string(),
            authority_generation: 1,
            expected_model_revision: 3,
            operation: "elements:delete".to_string(),
            payload,
        }
    }

    #[test]
    fn rpc_validation_rejects_protocol_shape_and_size_violations() {
        let mut invalid_protocol = rpc_request(Value::Null);
        invalid_protocol.protocol_version += 1;
        assert_eq!(
            validate_plugin_rpc_request(&invalid_protocol).unwrap_err(),
            "UNSUPPORTED_PLUGIN_RPC_PROTOCOL"
        );

        let mut invalid_operation = rpc_request(Value::Null);
        invalid_operation.operation = "bad operation".to_string();
        assert_eq!(
            validate_plugin_rpc_request(&invalid_operation).unwrap_err(),
            "INVALID_PLUGIN_RPC_OPERATION"
        );

        let oversized = rpc_request(Value::String("x".repeat(MAX_PLUGIN_RPC_BYTES)));
        assert_eq!(
            validate_plugin_rpc_request(&oversized).unwrap_err(),
            "PLUGIN_RPC_REQUEST_TOO_LARGE"
        );

        let invalid_response = PluginRpcResponse {
            protocol_version: PLUGIN_RPC_PROTOCOL_VERSION,
            request_id: uuid::Uuid::new_v4().to_string(),
            authority_generation: 1,
            model_revision: 4,
            ok: false,
            payload: Some(Value::Null),
            error: Some(PluginRpcError {
                code: "FAILED".to_string(),
                message: "failed".to_string(),
            }),
        };
        assert_eq!(
            validate_plugin_rpc_response(&invalid_response).unwrap_err(),
            "INVALID_PLUGIN_RPC_RESPONSE"
        );
    }

    #[test]
    fn rpc_router_targets_source_and_rejects_pending_request_id_reuse() {
        let router = PluginRpcRouter::default();
        let request = rpc_request(serde_json::json!({ "fullId": "demo:1" }));
        let envelope = PluginRpcRequestEnvelope {
            protocol_version: request.protocol_version,
            request_id: request.request_id.clone(),
            source_window_label: "panel".to_string(),
            authority_generation: request.authority_generation,
            expected_model_revision: request.expected_model_revision,
            operation: request.operation,
            payload: request.payload,
        };
        let requests = Mutex::new(Vec::new());
        router
            .forward_request("main", envelope.clone(), 3, |target, forwarded| {
                requests
                    .lock()
                    .push((target.to_string(), forwarded.clone()));
                Ok(())
            })
            .unwrap();
        let duplicate_error = router
            .forward_request("main", envelope.clone(), 3, |target, forwarded| {
                requests
                    .lock()
                    .push((target.to_string(), forwarded.clone()));
                Ok(())
            })
            .unwrap_err();
        assert_eq!(duplicate_error, "PLUGIN_RPC_REQUEST_ID_REUSED");
        assert_eq!(router.pending_count(), 1);
        assert_eq!(requests.lock().len(), 1);
        assert!(router.has_pending_request(&envelope.request_id, "panel", "main", 1));
        assert!(!router.has_pending_request(&envelope.request_id, "main", "main", 1));
        assert!(!router.has_pending_request(&envelope.request_id, "panel", "main", 2));

        let response = PluginRpcResponse {
            protocol_version: PLUGIN_RPC_PROTOCOL_VERSION,
            request_id: envelope.request_id.clone(),
            authority_generation: 1,
            model_revision: 4,
            ok: true,
            payload: Some(serde_json::json!({ "applied": true })),
            error: None,
        };
        let responses = Mutex::new(Vec::new());
        router
            .forward_response("main", &response, |target, forwarded| {
                responses
                    .lock()
                    .push((target.to_string(), forwarded.clone()));
                Ok(())
            })
            .unwrap();

        assert_eq!(responses.lock()[0].0, "panel");
        assert_eq!(router.pending_count(), 0);
        assert!(!router.has_pending_request(&envelope.request_id, "panel", "main", 1));
        let mut reused_after_completion = envelope;
        reused_after_completion.expected_model_revision = 4;
        router
            .forward_request("main", reused_after_completion, 4, |target, forwarded| {
                requests
                    .lock()
                    .push((target.to_string(), forwarded.clone()));
                Ok(())
            })
            .unwrap();
        assert_eq!(router.pending_count(), 1);
        assert_eq!(requests.lock().len(), 2);
    }

    #[test]
    fn rpc_router_exempts_settings_operations_from_model_revision_gate() {
        let router = PluginRpcRouter::default();
        let request = rpc_request(Value::Null);
        let mut envelope = PluginRpcRequestEnvelope {
            protocol_version: request.protocol_version,
            request_id: request.request_id,
            source_window_label: "panel".to_string(),
            authority_generation: request.authority_generation,
            expected_model_revision: request.expected_model_revision,
            operation: request.operation,
            payload: request.payload,
        };

        let error = router
            .forward_request("main", envelope.clone(), 4, |_, _| Ok(()))
            .unwrap_err();
        assert_eq!(error, "PLUGIN_MODEL_REVISION_CONFLICT");

        envelope.operation = "settings:change".to_string();
        router
            .forward_request("main", envelope, 4, |_, _| Ok(()))
            .unwrap();
        assert_eq!(router.pending_count(), 1);
    }

    #[test]
    fn unavailable_rpc_target_does_not_leave_a_pending_route() {
        let router = PluginRpcRouter::default();
        let request = rpc_request(Value::Null);
        let envelope = PluginRpcRequestEnvelope {
            protocol_version: request.protocol_version,
            request_id: request.request_id,
            source_window_label: "panel".to_string(),
            authority_generation: request.authority_generation,
            expected_model_revision: request.expected_model_revision,
            operation: request.operation,
            payload: request.payload,
        };

        let error = router
            .forward_request("main", envelope, 3, |_, _| {
                Err("AUTHORITY_UNAVAILABLE".to_string())
            })
            .unwrap_err();

        assert_eq!(error, "AUTHORITY_UNAVAILABLE");
        assert_eq!(router.pending_count(), 0);
    }

    #[test]
    fn authority_generation_advances_and_rejects_stale_leases() {
        let authority = PluginRuntimeAuthority::default();
        assert_eq!(authority.admit(0).unwrap_err(), "AUTHORITY_UNAVAILABLE");
        let router = PluginRpcRouter::default();
        assert_eq!(authority.reset(&router).unwrap().generation(), 1);
        assert_eq!(
            authority.admit(0).unwrap_err(),
            "AUTHORITY_GENERATION_CHANGED"
        );
        assert_eq!(authority.admit(1).unwrap().generation(), 1);
        assert_eq!(authority.reset(&router).unwrap().generation(), 2);
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

        let valid = SavedPluginInstance {
            position: PluginPoint { x: 1.0, y: 2.0 },
            settings: None,
            measured_size: None,
            tab_id: Some("4key".to_string()),
            hidden: false,
            z_index: None,
        };
        validate_saved_plugin_instances(&[valid]).unwrap();
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
                position: PluginPoint { x: 1.0, y: 2.0 },
                settings: None,
                measured_size: None,
                tab_id: Some("4key".to_string()),
                hidden: false,
                z_index: Some(z_index),
            };

            assert_eq!(
                validate_saved_plugin_instances(&[instance]).unwrap_err(),
                "INVALID_PLUGIN_INSTANCE_Z_INDEX:0"
            );
        }
    }

    #[test]
    fn plugin_instances_request_enforces_compact_size_limit() {
        let mut settings = BTreeMap::new();
        settings.insert(
            "label".to_string(),
            PluginSettingValue::String("x".repeat(MAX_SETTING_STRING_BYTES)),
        );
        let instance = SavedPluginInstance {
            position: PluginPoint { x: 1.0, y: 2.0 },
            settings: Some(settings),
            measured_size: None,
            tab_id: Some("4key".to_string()),
            hidden: false,
            z_index: None,
        };
        let request = PluginInstancesCommitRequest {
            plugin_id: "demo".to_string(),
            instances: vec![instance; 129],
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
