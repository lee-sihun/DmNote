use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State, WebviewWindow};
use uuid::Uuid;

use crate::{
    commands::editor::state::{emit_best_effort, publish_editor_change},
    errors::{CmdResult, CommandError, EditorCommitError},
    models::{
        default_counter_animation_builtin_presets, default_counter_animation_preset_id,
        find_builtin_counter_animation_preset_by_id, CommittedEditorChange, CounterAnimationPreset,
        CounterAnimationSource, EditorCommitOrigin, EditorField,
    },
    state::AppState,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CounterAnimationListResponse {
    pub builtin_presets: Vec<CounterAnimationPreset>,
    pub user_presets: Vec<CounterAnimationPreset>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CounterAnimationCreateRequest {
    pub name: String,
    pub bezier: [f64; 4],
    pub scale: f64,
    pub duration_ms: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CounterAnimationUpdateRequest {
    pub id: String,
    pub name: String,
    pub bezier: [f64; 4],
    pub scale: f64,
    pub duration_ms: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CounterAnimationUpsertResponse {
    pub preset: CounterAnimationPreset,
    pub affected_usage_count: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CounterAnimationDeleteResponse {
    pub success: bool,
    pub id: String,
    pub affected_usage_count: u32,
    pub fallback_preset_id: String,
}

#[tauri::command]
pub fn counter_animation_list(
    state: State<'_, AppState>,
) -> CmdResult<CounterAnimationListResponse> {
    let snapshot = state.store.snapshot();
    Ok(build_library_payload(&snapshot.counter_animation_presets))
}

#[tauri::command]
pub fn counter_animation_create(
    state: State<'_, AppState>,
    app: AppHandle,
    request: CounterAnimationCreateRequest,
) -> CmdResult<CounterAnimationUpsertResponse> {
    let mut preset = CounterAnimationPreset {
        id: format!("user-{}", Uuid::new_v4().simple()),
        name: request.name,
        source: CounterAnimationSource::User,
        label_key: None,
        bezier: request.bezier,
        scale: request.scale,
        duration_ms: request.duration_ms,
    };
    preset.normalize();

    if preset.name.is_empty() {
        return Err(CommandError::msg("counter animation name cannot be empty"));
    }

    let next_preset = preset.clone();
    let updated = state.store.update(|store| {
        store.counter_animation_presets.push(next_preset.clone());
    })?;

    emit_counter_animation_changed(&app, &updated.counter_animation_presets);

    Ok(CounterAnimationUpsertResponse {
        preset,
        affected_usage_count: 0,
    })
}

#[tauri::command]
pub fn counter_animation_update(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    request: CounterAnimationUpdateRequest,
) -> CmdResult<CounterAnimationUpsertResponse> {
    let target_id = request.id.trim().to_string();
    if target_id.is_empty() {
        return Err(CommandError::msg("counter animation id is required"));
    }

    let current = state.store.snapshot();
    if !current
        .counter_animation_presets
        .iter()
        .any(|preset| preset.id == target_id)
    {
        return Err(CommandError::msg(format!(
            "counter animation preset not found: {target_id}"
        )));
    }

    let mut preset = CounterAnimationPreset {
        id: target_id.clone(),
        name: request.name,
        source: CounterAnimationSource::User,
        label_key: None,
        bezier: request.bezier,
        scale: request.scale,
        duration_ms: request.duration_ms,
    };
    preset.normalize();

    if preset.name.is_empty() {
        return Err(CommandError::msg("counter animation name cannot be empty"));
    }

    let next_preset = preset.clone();
    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction = state
        .store
        .commit_legacy_editor_transaction_with_admission(
            EditorCommitOrigin::LegacyAdapter("counter_animation_update".to_string()),
            &[
                EditorField::KeyPositions,
                EditorField::StatPositions,
                EditorField::GraphPositions,
            ],
            admission,
            |store| {
                replace_counter_animation_preset(store, &target_id, &next_preset)?;

                let affected_usage_count =
                    apply_preset_to_bound_counters(store, &target_id, &next_preset);
                Ok((
                    store.counter_animation_presets.clone(),
                    affected_usage_count,
                ))
            },
        )?;
    let (user_presets, affected_usage_count) = transaction.value;

    publish_editor_change(state.inner(), &app, &transaction.change, false);
    emit_counter_animation_changed(&app, &user_presets);
    emit_positions_changed(&app, &transaction.change, affected_usage_count);

    Ok(CounterAnimationUpsertResponse {
        preset,
        affected_usage_count,
    })
}

#[tauri::command]
pub fn counter_animation_delete(
    state: State<'_, AppState>,
    app: AppHandle,
    window: WebviewWindow,
    id: String,
) -> CmdResult<CounterAnimationDeleteResponse> {
    let target_id = id.trim().to_string();
    if target_id.is_empty() {
        return Err(CommandError::msg("counter animation id is required"));
    }

    let current = state.store.snapshot();
    if !current
        .counter_animation_presets
        .iter()
        .any(|preset| preset.id == target_id)
    {
        return Err(CommandError::msg(format!(
            "counter animation preset not found: {target_id}"
        )));
    }

    let fallback_preset =
        find_builtin_counter_animation_preset_by_id(default_counter_animation_preset_id())
            .ok_or_else(|| CommandError::msg("default builtin counter animation preset missing"))?;
    let fallback_preset_id = fallback_preset.id.clone();

    let fallback_target = fallback_preset.clone();

    let admission = state.admit_frontend_history_mutation(window.label())?;
    let transaction = state
        .store
        .commit_legacy_editor_transaction_with_admission(
            EditorCommitOrigin::LegacyAdapter("counter_animation_delete".to_string()),
            &[
                EditorField::KeyPositions,
                EditorField::StatPositions,
                EditorField::GraphPositions,
            ],
            admission,
            |store| {
                remove_counter_animation_preset(store, &target_id)?;

                let affected_usage_count =
                    apply_fallback_to_bound_counters(store, &target_id, &fallback_target);
                Ok((
                    store.counter_animation_presets.clone(),
                    affected_usage_count,
                ))
            },
        )?;
    let (user_presets, affected_usage_count) = transaction.value;

    publish_editor_change(state.inner(), &app, &transaction.change, false);
    emit_counter_animation_changed(&app, &user_presets);
    emit_positions_changed(&app, &transaction.change, affected_usage_count);

    Ok(CounterAnimationDeleteResponse {
        success: true,
        id: target_id,
        affected_usage_count,
        fallback_preset_id,
    })
}

fn build_library_payload(user_presets: &[CounterAnimationPreset]) -> CounterAnimationListResponse {
    CounterAnimationListResponse {
        builtin_presets: default_counter_animation_builtin_presets(),
        user_presets: user_presets.to_vec(),
    }
}

fn emit_counter_animation_changed(app: &AppHandle, user_presets: &[CounterAnimationPreset]) {
    emit_best_effort(
        app,
        "counterAnimation:changed",
        &build_library_payload(user_presets),
    );
}

fn emit_positions_changed(
    app: &AppHandle,
    change: &CommittedEditorChange,
    affected_usage_count: u32,
) {
    if affected_usage_count == 0 {
        return;
    }

    // 같은 애니메이션 값을 다시 저장한 경우에도 기존 refresh 이벤트 계약 유지
    if change.result.changed_fields.is_empty() {
        emit_best_effort(app, "positions:changed", &change.document.key_positions);
        emit_best_effort(
            app,
            "statPositions:changed",
            &change.document.stat_positions,
        );
        emit_best_effort(
            app,
            "graphPositions:changed",
            &change.document.graph_positions,
        );
        return;
    }

    for field in &change.result.changed_fields {
        match field {
            EditorField::KeyPositions => {
                emit_best_effort(app, "positions:changed", &change.document.key_positions);
            }
            EditorField::StatPositions => {
                emit_best_effort(
                    app,
                    "statPositions:changed",
                    &change.document.stat_positions,
                );
            }
            EditorField::GraphPositions => {
                emit_best_effort(
                    app,
                    "graphPositions:changed",
                    &change.document.graph_positions,
                );
            }
            _ => {}
        }
    }
}

fn apply_preset_to_bound_counters(
    store: &mut crate::models::AppStoreData,
    preset_id: &str,
    preset: &CounterAnimationPreset,
) -> u32 {
    let mut affected = 0u32;

    for positions in store.key_positions.values_mut() {
        for position in positions.iter_mut() {
            if update_counter_animation_if_bound(&mut position.counter, preset_id, preset) {
                affected += 1;
            }
        }
    }

    for positions in store.stat_positions.values_mut() {
        for position in positions.iter_mut() {
            if update_counter_animation_if_bound(&mut position.position.counter, preset_id, preset)
            {
                affected += 1;
            }
        }
    }

    for positions in store.graph_positions.values_mut() {
        for position in positions.iter_mut() {
            if update_counter_animation_if_bound(&mut position.position.counter, preset_id, preset)
            {
                affected += 1;
            }
        }
    }

    affected
}

fn apply_fallback_to_bound_counters(
    store: &mut crate::models::AppStoreData,
    preset_id: &str,
    fallback: &CounterAnimationPreset,
) -> u32 {
    apply_preset_to_bound_counters(store, preset_id, fallback)
}

fn replace_counter_animation_preset(
    store: &mut crate::models::AppStoreData,
    preset_id: &str,
    replacement: &CounterAnimationPreset,
) -> Result<(), EditorCommitError> {
    let Some(item) = store
        .counter_animation_presets
        .iter_mut()
        .find(|item| item.id == preset_id)
    else {
        return Err(EditorCommitError::validation(
            "COUNTER_ANIMATION_PRESET_NOT_FOUND",
            format!("counter animation preset not found: {preset_id}"),
        ));
    };
    item.clone_from(replacement);
    Ok(())
}

fn remove_counter_animation_preset(
    store: &mut crate::models::AppStoreData,
    preset_id: &str,
) -> Result<(), EditorCommitError> {
    let before = store.counter_animation_presets.len();
    store
        .counter_animation_presets
        .retain(|preset| preset.id != preset_id);
    if store.counter_animation_presets.len() == before {
        return Err(EditorCommitError::validation(
            "COUNTER_ANIMATION_PRESET_NOT_FOUND",
            format!("counter animation preset not found: {preset_id}"),
        ));
    }
    Ok(())
}

fn update_counter_animation_if_bound(
    counter: &mut crate::models::KeyCounterSettings,
    preset_id: &str,
    preset: &CounterAnimationPreset,
) -> bool {
    let bound_id = counter
        .animation
        .preset_id
        .as_ref()
        .map(|value| value.trim())
        .unwrap_or_default();

    if bound_id != preset_id {
        return false;
    }

    counter.animation.preset_id = Some(preset.id.clone());
    counter.animation.bezier = preset.bezier;
    counter.animation.scale = preset.scale;
    counter.animation.duration_ms = preset.duration_ms;
    counter.normalize();
    true
}

#[cfg(test)]
mod tests {
    use super::{
        apply_preset_to_bound_counters, remove_counter_animation_preset,
        replace_counter_animation_preset,
    };
    use crate::models::{
        AppStoreData, CounterAnimationPreset, CounterAnimationSource, EditorDocumentV1,
        EditorField, GraphPosition, GraphStatType, GraphType, KeyPosition, StatPosition, StatType,
    };

    const MODE: &str = "4key";
    const TARGET_PRESET_ID: &str = "user-target";

    fn target_preset() -> CounterAnimationPreset {
        CounterAnimationPreset {
            id: TARGET_PRESET_ID.to_string(),
            name: "Target".to_string(),
            source: CounterAnimationSource::User,
            label_key: None,
            bezier: [0.1, 0.2, 0.8, 0.9],
            scale: 1.25,
            duration_ms: 420,
        }
    }

    fn position(bound: bool) -> KeyPosition {
        let mut position = KeyPosition::default();
        if bound {
            position.counter.animation.preset_id = Some(TARGET_PRESET_ID.to_string());
        }
        position
    }

    fn counter_store(key_bound: bool, stat_bound: bool, graph_bound: bool) -> AppStoreData {
        let mut store = AppStoreData::default();
        store.keys.insert(MODE.to_string(), vec!["KeyA".into()]);
        store
            .key_positions
            .insert(MODE.to_string(), vec![position(key_bound)]);
        store.stat_positions.insert(
            MODE.to_string(),
            vec![StatPosition {
                stat_type: StatType::Kps,
                position: position(stat_bound),
            }],
        );
        store.graph_positions.insert(
            MODE.to_string(),
            vec![GraphPosition {
                stat_type: GraphStatType::Kps,
                graph_type: GraphType::Line,
                graph_speed: 1,
                graph_color: "#ffffff".to_string(),
                show_avg_line: true,
                position: position(graph_bound),
            }],
        );
        store
    }

    #[test]
    fn preset_update_changes_key_stat_and_graph_references() {
        let mut store = counter_store(true, true, true);
        let before = EditorDocumentV1::from_store(&store);

        let affected =
            apply_preset_to_bound_counters(&mut store, TARGET_PRESET_ID, &target_preset());
        let after = EditorDocumentV1::from_store(&store);

        assert_eq!(affected, 3);
        assert_eq!(
            before.changed_fields(&after),
            vec![
                EditorField::KeyPositions,
                EditorField::StatPositions,
                EditorField::GraphPositions,
            ]
        );
    }

    // 프리셋 편집은 백엔드가 모든 모드의 바인딩된 요소를 갱신한다.
    // 프론트가 index로 한 번 더 얹지 않는 근거라 값까지 고정한다
    #[test]
    fn preset_update_rewrites_every_mode_and_leaves_unbound_alone() {
        const OTHER_MODE: &str = "8key";
        let preset = target_preset();
        let mut store = counter_store(true, true, true);
        store
            .keys
            .insert(OTHER_MODE.to_string(), vec!["KeyB".into()]);
        store.key_positions.insert(
            OTHER_MODE.to_string(),
            vec![position(true), position(false)],
        );

        let affected = apply_preset_to_bound_counters(&mut store, TARGET_PRESET_ID, &preset);

        assert_eq!(affected, 4);

        let other = &store.key_positions[OTHER_MODE];
        let bound = &other[0].counter.animation;
        assert_eq!(bound.preset_id.as_deref(), Some(TARGET_PRESET_ID));
        assert_eq!(bound.bezier, preset.bezier);
        assert_eq!(bound.scale, preset.scale);
        assert_eq!(bound.duration_ms, preset.duration_ms);

        // 바인딩되지 않은 요소는 그대로 둔다
        let untouched = &other[1].counter.animation;
        let default_animation = KeyPosition::default().counter.animation;
        assert_eq!(untouched.preset_id, default_animation.preset_id);
        assert_eq!(untouched.bezier, default_animation.bezier);
        assert_eq!(untouched.scale, default_animation.scale);
        assert_eq!(untouched.duration_ms, default_animation.duration_ms);
    }

    #[test]
    fn preset_update_reports_only_actually_changed_collections() {
        let mut store = counter_store(false, true, false);
        let before = EditorDocumentV1::from_store(&store);

        let affected =
            apply_preset_to_bound_counters(&mut store, TARGET_PRESET_ID, &target_preset());
        let after = EditorDocumentV1::from_store(&store);

        assert_eq!(affected, 1);
        assert_eq!(
            before.changed_fields(&after),
            vec![EditorField::StatPositions]
        );
    }

    #[test]
    fn preset_update_and_delete_recheck_existence_inside_the_transaction() {
        let replacement = target_preset();
        let mut store = counter_store(true, true, true);
        let before = store.clone();

        let update_error =
            replace_counter_animation_preset(&mut store, TARGET_PRESET_ID, &replacement)
                .unwrap_err();
        assert_eq!(
            update_error
                .details
                .as_ref()
                .and_then(|details| details.validation_code.as_deref()),
            Some("COUNTER_ANIMATION_PRESET_NOT_FOUND")
        );
        assert_eq!(store, before);

        let delete_error =
            remove_counter_animation_preset(&mut store, TARGET_PRESET_ID).unwrap_err();
        assert_eq!(
            delete_error
                .details
                .as_ref()
                .and_then(|details| details.validation_code.as_deref()),
            Some("COUNTER_ANIMATION_PRESET_NOT_FOUND")
        );
        assert_eq!(store, before);
    }
}
