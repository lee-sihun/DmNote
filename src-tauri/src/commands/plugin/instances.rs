use std::collections::{BTreeMap, HashMap};

use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::{
    commands::{editor::state::emit_best_effort, run_blocking, run_mutation_task},
    errors::{CmdResult, CommandError},
    models::{
        PluginGroupRefsSnapshot, PluginInstancesChangedPayload, PluginInstancesCommitRequest,
        PluginInstancesCommitResult, PluginInstancesReconcileRequest, PluginInstancesSnapshot,
    },
    state::{plugin::PluginGroupRefs, store::AdmittedPluginInstancesCommit},
};

const MAIN_WINDOW_LABEL: &str = "main";
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
pub async fn plugin_instances_get(
    app: AppHandle,
    plugin_id: String,
) -> CmdResult<PluginInstancesSnapshot> {
    run_blocking(app, move |_, state| {
        let (instances, model_revision) = state
            .store
            .plugin_instances_get(&plugin_id)
            .map_err(CommandError::msg)?;
        let snapshot = PluginInstancesSnapshot {
            plugin_id,
            instances,
            model_revision,
            authority_generation: state.plugin_authority().generation(),
        };
        if serde_json::to_vec(&snapshot)
            .map_err(|error| {
                CommandError::msg(format!("INVALID_PLUGIN_INSTANCES_SNAPSHOT:{error}"))
            })?
            .len()
            > crate::state::plugin::MAX_PLUGIN_INSTANCES_REQUEST_BYTES
        {
            return Err(CommandError::msg("PLUGIN_INSTANCES_SNAPSHOT_TOO_LARGE"));
        }
        Ok(snapshot)
    })
    .await
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
pub async fn plugin_group_refs_get(app: AppHandle) -> CmdResult<PluginGroupRefsSnapshot> {
    run_blocking(app, |_, state| {
        let (refs_by_plugin, model_revision) = state.store.plugin_group_refs_by_plugin();
        Ok(plugin_group_refs_snapshot(refs_by_plugin, model_revision))
    })
    .await
}

#[tauri::command]
pub async fn plugin_instances_commit(
    app: AppHandle,
    window: WebviewWindow,
    request: PluginInstancesCommitRequest,
) -> CmdResult<PluginInstancesCommitResult> {
    let window_label = window.label().to_string();
    run_mutation_task(app, move |app, state, ticket| {
        crate::state::plugin::validate_plugin_instances_request(&request)
            .map_err(CommandError::msg)?;
        if window_label != MAIN_WINDOW_LABEL {
            return Err(CommandError::msg("PLUGIN_INSTANCE_MUTATION_NOT_ALLOWED"));
        }
        let authority = state
            .plugin_authority()
            .admit(request.authority_generation)
            .map_err(CommandError::msg)?;
        let admission = state
            .admit_frontend_history_mutation(&window_label)
            .map_err(|_| CommandError::msg("HISTORY_IN_PROGRESS"))?;
        ticket.run(move || {
            // 잠금 순서: 번호표 turn → authority (gesture.rs와 동일)
            state
                .plugin_authority()
                .revalidate(authority)
                .map_err(CommandError::msg)?;
            let mutation_id = request.mutation_id.clone();
            let committed = state
                .store
                .commit_plugin_instances_with_admission(request, admission)
                .map_err(CommandError::msg)?;
            Ok(finish_plugin_instances_commit(
                app,
                mutation_id,
                authority.generation(),
                committed,
            ))
        })
    })
    .await
}

#[tauri::command]
pub async fn plugin_instances_reconcile(
    app: AppHandle,
    window: WebviewWindow,
    request: PluginInstancesReconcileRequest,
) -> CmdResult<PluginInstancesCommitResult> {
    let window_label = window.label().to_string();
    run_mutation_task(app, move |app, state, ticket| {
        crate::state::plugin::validate_plugin_instances_reconcile_request(&request)
            .map_err(CommandError::msg)?;
        if window_label != MAIN_WINDOW_LABEL {
            return Err(CommandError::msg("PLUGIN_INSTANCE_MUTATION_NOT_ALLOWED"));
        }
        let authority = state
            .plugin_authority()
            .admit(request.authority_generation)
            .map_err(CommandError::msg)?;
        let admission = state
            .admit_frontend_history_mutation(&window_label)
            .map_err(|_| CommandError::msg("HISTORY_IN_PROGRESS"))?;
        ticket.run(move || {
            // 잠금 순서: 번호표 turn → authority (gesture.rs와 동일)
            state
                .plugin_authority()
                .revalidate(authority)
                .map_err(CommandError::msg)?;
            let mutation_id = request.mutation_id.clone();
            let committed = state
                .store
                .reconcile_plugin_instances_with_admission(request, admission)
                .map_err(CommandError::msg)?;
            Ok(finish_plugin_instances_commit(
                app,
                mutation_id,
                authority.generation(),
                committed,
            ))
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use parking_lot::Mutex;

    use super::*;

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
}
