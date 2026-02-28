use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::{
    app_state::AppState,
    models::{
        default_counter_animation_builtin_presets, default_counter_animation_preset_id,
        find_builtin_counter_animation_preset_by_id, CounterAnimationPreset,
        CounterAnimationSource,
    },
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

#[tauri::command(permission = "dmnote-allow-all")]
pub fn counter_animation_list(
    state: State<'_, AppState>,
) -> Result<CounterAnimationListResponse, String> {
    let snapshot = state.store.snapshot();
    Ok(build_library_payload(&snapshot.counter_animation_presets))
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn counter_animation_create(
    state: State<'_, AppState>,
    app: AppHandle,
    request: CounterAnimationCreateRequest,
) -> Result<CounterAnimationUpsertResponse, String> {
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
        return Err("counter animation name cannot be empty".to_string());
    }

    let next_preset = preset.clone();
    let updated = state
        .store
        .update(|store| {
            store.counter_animation_presets.push(next_preset.clone());
        })
        .map_err(|err| err.to_string())?;

    emit_counter_animation_changed(&app, &updated.counter_animation_presets)?;

    Ok(CounterAnimationUpsertResponse {
        preset,
        affected_usage_count: 0,
    })
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn counter_animation_update(
    state: State<'_, AppState>,
    app: AppHandle,
    request: CounterAnimationUpdateRequest,
) -> Result<CounterAnimationUpsertResponse, String> {
    let target_id = request.id.trim().to_string();
    if target_id.is_empty() {
        return Err("counter animation id is required".to_string());
    }

    let current = state.store.snapshot();
    if !current
        .counter_animation_presets
        .iter()
        .any(|preset| preset.id == target_id)
    {
        return Err(format!("counter animation preset not found: {target_id}"));
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
        return Err("counter animation name cannot be empty".to_string());
    }

    let next_preset = preset.clone();
    let mut affected_usage_count = 0u32;

    let updated = state
        .store
        .update(|store| {
            if let Some(item) = store
                .counter_animation_presets
                .iter_mut()
                .find(|item| item.id == target_id)
            {
                *item = next_preset.clone();
            }

            affected_usage_count = apply_preset_to_bound_counters(store, &target_id, &next_preset);
        })
        .map_err(|err| err.to_string())?;

    emit_counter_animation_changed(&app, &updated.counter_animation_presets)?;
    if affected_usage_count > 0 {
        emit_positions_changed(
            &app,
            &updated.key_positions,
            &updated.stat_positions,
            &updated.graph_positions,
        )?;
    }

    Ok(CounterAnimationUpsertResponse {
        preset,
        affected_usage_count,
    })
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn counter_animation_delete(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
) -> Result<CounterAnimationDeleteResponse, String> {
    let target_id = id.trim().to_string();
    if target_id.is_empty() {
        return Err("counter animation id is required".to_string());
    }

    let current = state.store.snapshot();
    if !current
        .counter_animation_presets
        .iter()
        .any(|preset| preset.id == target_id)
    {
        return Err(format!("counter animation preset not found: {target_id}"));
    }

    let fallback_preset =
        find_builtin_counter_animation_preset_by_id(default_counter_animation_preset_id())
            .ok_or_else(|| "default builtin counter animation preset missing".to_string())?;
    let fallback_preset_id = fallback_preset.id.clone();

    let mut affected_usage_count = 0u32;
    let fallback_target = fallback_preset.clone();

    let updated = state
        .store
        .update(|store| {
            store
                .counter_animation_presets
                .retain(|preset| preset.id != target_id);

            affected_usage_count =
                apply_fallback_to_bound_counters(store, &target_id, &fallback_target);
        })
        .map_err(|err| err.to_string())?;

    emit_counter_animation_changed(&app, &updated.counter_animation_presets)?;
    if affected_usage_count > 0 {
        emit_positions_changed(
            &app,
            &updated.key_positions,
            &updated.stat_positions,
            &updated.graph_positions,
        )?;
    }

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

fn emit_counter_animation_changed(
    app: &AppHandle,
    user_presets: &[CounterAnimationPreset],
) -> Result<(), String> {
    app.emit(
        "counterAnimation:changed",
        &build_library_payload(user_presets),
    )
    .map_err(|err| err.to_string())
}

fn emit_positions_changed(
    app: &AppHandle,
    key_positions: &crate::models::KeyPositions,
    stat_positions: &crate::models::StatPositions,
    graph_positions: &crate::models::GraphPositions,
) -> Result<(), String> {
    app.emit("positions:changed", key_positions)
        .map_err(|err| err.to_string())?;
    app.emit("statPositions:changed", stat_positions)
        .map_err(|err| err.to_string())?;
    app.emit("graphPositions:changed", graph_positions)
        .map_err(|err| err.to_string())?;
    Ok(())
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
