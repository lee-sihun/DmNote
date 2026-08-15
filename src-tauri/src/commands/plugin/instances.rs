use std::collections::{BTreeMap, HashMap};

use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::{
    commands::editor::state::emit_best_effort,
    errors::CmdResult,
    models::{
        PluginGroupRefsSnapshot, PluginInstancesChangedPayload, PluginInstancesCommitRequest,
        PluginInstancesCommitResult, PluginInstancesReconcileRequest, PluginInstancesSnapshot,
    },
    state::{
        plugin::{PluginGroupRefs, PluginRpcRouter},
        store::AdmittedPluginInstancesCommit,
        AppState,
    },
};

const MAIN_WINDOW_LABEL: &str = "main";
const PANEL_WINDOW_LABEL: &str = "panel";

fn plugin_mutation_source<'a>(
    router: &PluginRpcRouter,
    authority_generation: u64,
    rpc_request_id: Option<&str>,
    direct_window_label: &'a str,
) -> Result<&'a str, String> {
    let Some(request_id) = rpc_request_id else {
        return Ok(direct_window_label);
    };
    if uuid::Uuid::parse_str(request_id).is_err()
        || !router.has_pending_request(
            request_id,
            PANEL_WINDOW_LABEL,
            MAIN_WINDOW_LABEL,
            authority_generation,
        )
    {
        return Err("PLUGIN_RPC_REQUEST_NOT_FOUND".to_string());
    }
    Ok(PANEL_WINDOW_LABEL)
}

pub(crate) trait PluginInstancesEventEmitter {
    fn main_available(&self) -> bool;
    fn emit_plugin_instances_changed(
        &self,
        payload: &PluginInstancesChangedPayload,
    ) -> Result<(), String>;
}

impl PluginInstancesEventEmitter for AppHandle {
    fn main_available(&self) -> bool {
        self.get_webview_window(MAIN_WINDOW_LABEL).is_some()
    }

    fn emit_plugin_instances_changed(
        &self,
        payload: &PluginInstancesChangedPayload,
    ) -> Result<(), String> {
        self.emit_to(MAIN_WINDOW_LABEL, "pluginInstances:changed", payload)
            .map_err(|error| error.to_string())
    }
}

pub(crate) fn publish_plugin_instances_changed(
    emitter: &dyn PluginInstancesEventEmitter,
    payload: &PluginInstancesChangedPayload,
) -> bool {
    if !emitter.main_available() {
        return false;
    }
    if let Err(error) = emitter.emit_plugin_instances_changed(payload) {
        log::warn!("failed to publish plugin instance projection: {error}");
        return false;
    }
    true
}

fn finish_plugin_instances_commit(
    app: &AppHandle,
    mutation_id: String,
    authority_generation: u64,
    committed: AdmittedPluginInstancesCommit,
) -> PluginInstancesCommitResult {
    let outcome = &committed.outcome;
    if outcome.changed {
        let payload = PluginInstancesChangedPayload {
            plugin_id: outcome.plugin_id.clone(),
            revision: outcome.model_revision,
            origin_mutation_id: Some(mutation_id),
        };
        publish_plugin_instances_changed(app, &payload);
    }
    if let Some(status) = outcome.history_status.as_ref() {
        emit_best_effort(app, "history:status", status);
    }

    PluginInstancesCommitResult {
        plugin_id: outcome.plugin_id.clone(),
        model_revision: outcome.model_revision,
        authority_generation,
        changed: outcome.changed,
    }
}

#[tauri::command]
pub fn plugin_instances_get(
    state: State<'_, AppState>,
    plugin_id: String,
) -> Result<PluginInstancesSnapshot, String> {
    let (instances, model_revision) = state.store.plugin_instances_get(&plugin_id)?;
    let snapshot = PluginInstancesSnapshot {
        plugin_id,
        instances,
        model_revision,
        authority_generation: state.plugin_authority().generation(),
    };
    if serde_json::to_vec(&snapshot)
        .map_err(|error| format!("INVALID_PLUGIN_INSTANCES_SNAPSHOT:{error}"))?
        .len()
        > crate::state::plugin::MAX_PLUGIN_INSTANCES_REQUEST_BYTES
    {
        return Err("PLUGIN_INSTANCES_SNAPSHOT_TOO_LARGE".to_string());
    }
    Ok(snapshot)
}

// wire 정렬 변환 - HashSet 비결정 순서를 결정적 스냅샷으로 고정
fn plugin_group_refs_snapshot(
    refs_by_plugin: HashMap<String, PluginGroupRefs>,
    model_revision: u64,
) -> PluginGroupRefsSnapshot {
    let refs = refs_by_plugin
        .into_iter()
        .map(|(plugin_id, modes)| {
            let modes = modes
                .into_iter()
                .map(|(mode, group_ids)| {
                    let mut group_ids = group_ids.into_iter().collect::<Vec<_>>();
                    group_ids.sort_unstable();
                    (mode, group_ids)
                })
                .collect::<BTreeMap<_, _>>();
            (plugin_id, modes)
        })
        .collect();
    PluginGroupRefsSnapshot {
        refs,
        model_revision,
    }
}

// editor 단독 커밋의 normalize 그룹 생존 판정 모집단 미러용 - 미로드·데이터만
// 남은 플러그인의 저장 인스턴스까지 포함해 프론트 replay와 백엔드 판정을 일치시킨다
#[tauri::command]
pub fn plugin_group_refs_get(state: State<'_, AppState>) -> CmdResult<PluginGroupRefsSnapshot> {
    let (refs_by_plugin, model_revision) = state.store.plugin_group_refs_by_plugin();
    Ok(plugin_group_refs_snapshot(refs_by_plugin, model_revision))
}

#[tauri::command]
pub fn plugin_instances_commit(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    request: PluginInstancesCommitRequest,
    rpc_request_id: Option<String>,
) -> Result<PluginInstancesCommitResult, String> {
    crate::state::plugin::validate_plugin_instances_request(&request)?;
    if window.label() != MAIN_WINDOW_LABEL {
        return Err("PLUGIN_INSTANCE_MUTATION_NOT_ALLOWED".to_string());
    }
    let authority = state
        .plugin_authority()
        .admit(request.authority_generation)?;
    let source_window_label = plugin_mutation_source(
        state.plugin_rpc_router(),
        authority.generation(),
        rpc_request_id.as_deref(),
        window.label(),
    )?;
    let admission = state
        .admit_frontend_history_mutation(source_window_label)
        .map_err(|_| "HISTORY_IN_PROGRESS".to_string())?;
    let mutation_id = request.mutation_id.clone();
    let committed = state
        .store
        .commit_plugin_instances_with_admission(request, admission)?;
    Ok(finish_plugin_instances_commit(
        &app,
        mutation_id,
        authority.generation(),
        committed,
    ))
}

#[tauri::command]
pub fn plugin_instances_reconcile(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    request: PluginInstancesReconcileRequest,
) -> Result<PluginInstancesCommitResult, String> {
    crate::state::plugin::validate_plugin_instances_reconcile_request(&request)?;
    if window.label() != MAIN_WINDOW_LABEL {
        return Err("PLUGIN_INSTANCE_MUTATION_NOT_ALLOWED".to_string());
    }
    let authority = state
        .plugin_authority()
        .admit(request.authority_generation)?;
    let admission = state
        .admit_frontend_history_mutation(window.label())
        .map_err(|_| "HISTORY_IN_PROGRESS".to_string())?;
    let mutation_id = request.mutation_id.clone();
    let committed = state
        .store
        .reconcile_plugin_instances_with_admission(request, admission)?;
    Ok(finish_plugin_instances_commit(
        &app,
        mutation_id,
        authority.generation(),
        committed,
    ))
}

#[cfg(test)]
mod tests {
    use parking_lot::Mutex;

    use super::*;
    use crate::models::{PluginRpcRequestEnvelope, PluginRpcResponse};

    struct TestEmitter {
        main_available: bool,
        events: Mutex<Vec<PluginInstancesChangedPayload>>,
    }

    impl PluginInstancesEventEmitter for TestEmitter {
        fn main_available(&self) -> bool {
            self.main_available
        }

        fn emit_plugin_instances_changed(
            &self,
            payload: &PluginInstancesChangedPayload,
        ) -> Result<(), String> {
            self.events.lock().push(payload.clone());
            Ok(())
        }
    }

    #[test]
    fn missing_main_leaves_plugin_projection_pending_without_failure() {
        let emitter = TestEmitter {
            main_available: false,
            events: Mutex::new(Vec::new()),
        };
        let payload = PluginInstancesChangedPayload {
            plugin_id: "demo".to_string(),
            revision: 3,
            origin_mutation_id: None,
        };

        assert!(!publish_plugin_instances_changed(&emitter, &payload));
        assert!(emitter.events.lock().is_empty());
    }

    #[test]
    fn changed_payload_serializes_origin_for_commit_and_omits_it_for_history() {
        let committed = PluginInstancesChangedPayload {
            plugin_id: "demo".to_string(),
            revision: 4,
            origin_mutation_id: Some("mutation-1".to_string()),
        };
        assert_eq!(
            serde_json::to_value(committed).unwrap(),
            serde_json::json!({
                "pluginId": "demo",
                "revision": 4,
                "originMutationId": "mutation-1",
            })
        );

        let restored = PluginInstancesChangedPayload {
            plugin_id: "demo".to_string(),
            revision: 5,
            origin_mutation_id: None,
        };
        assert_eq!(
            serde_json::to_value(restored).unwrap(),
            serde_json::json!({ "pluginId": "demo", "revision": 5 })
        );
    }

    #[test]
    fn group_refs_snapshot_sorts_group_ids_and_serializes_camel_case() {
        let mut refs_by_plugin: HashMap<String, PluginGroupRefs> = HashMap::new();
        let mut beta_modes = PluginGroupRefs::new();
        beta_modes
            .entry("6key".to_string())
            .or_default()
            .extend(["g-b".to_string(), "g-a".to_string()]);
        beta_modes
            .entry("4key".to_string())
            .or_default()
            .insert("g-c".to_string());
        refs_by_plugin.insert("beta".to_string(), beta_modes);
        let mut alpha_modes = PluginGroupRefs::new();
        alpha_modes
            .entry("4key".to_string())
            .or_default()
            .insert("g-z".to_string());
        refs_by_plugin.insert("alpha".to_string(), alpha_modes);

        let snapshot = plugin_group_refs_snapshot(refs_by_plugin, 7);
        assert_eq!(
            serde_json::to_value(snapshot).unwrap(),
            serde_json::json!({
                "refs": {
                    "alpha": { "4key": ["g-z"] },
                    "beta": { "4key": ["g-c"], "6key": ["g-a", "g-b"] },
                },
                "modelRevision": 7,
            })
        );
    }

    #[test]
    fn routed_commit_uses_pending_panel_provenance_until_response() {
        let router = PluginRpcRouter::default();
        let request_id = "00000000-0000-0000-0000-000000000001".to_string();
        let envelope = PluginRpcRequestEnvelope {
            protocol_version: 1,
            request_id: request_id.clone(),
            source_window_label: PANEL_WINDOW_LABEL.to_string(),
            authority_generation: 7,
            expected_model_revision: 3,
            operation: "elements:delete".to_string(),
            payload: serde_json::json!({ "fullIds": ["demo:one"] }),
        };
        router
            .forward_request(MAIN_WINDOW_LABEL, envelope, 3, |_, _| Ok(()))
            .unwrap();

        assert_eq!(
            plugin_mutation_source(&router, 7, Some(&request_id), MAIN_WINDOW_LABEL).unwrap(),
            PANEL_WINDOW_LABEL
        );
        assert_eq!(
            plugin_mutation_source(&router, 7, Some(&request_id), MAIN_WINDOW_LABEL).unwrap(),
            PANEL_WINDOW_LABEL
        );
        assert_eq!(
            plugin_mutation_source(&router, 7, None, MAIN_WINDOW_LABEL).unwrap(),
            MAIN_WINDOW_LABEL
        );
        assert_eq!(
            plugin_mutation_source(
                &router,
                7,
                Some("00000000-0000-0000-0000-000000000002"),
                MAIN_WINDOW_LABEL,
            )
            .unwrap_err(),
            "PLUGIN_RPC_REQUEST_NOT_FOUND"
        );

        let response = PluginRpcResponse {
            protocol_version: 1,
            request_id: request_id.clone(),
            authority_generation: 7,
            model_revision: 4,
            ok: true,
            payload: None,
            error: None,
        };
        router
            .forward_response(MAIN_WINDOW_LABEL, &response, |_, _| Ok(()))
            .unwrap();

        assert_eq!(
            plugin_mutation_source(&router, 7, Some(&request_id), MAIN_WINDOW_LABEL).unwrap_err(),
            "PLUGIN_RPC_REQUEST_NOT_FOUND"
        );
    }
}
