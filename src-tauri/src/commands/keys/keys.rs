use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::{
    commands::{
        editor::state::{
            emit_best_effort, publish_editor_change, publish_editor_change_after_key_runtime,
            publish_legacy_editor_change,
        },
        plugin::instances::publish_plugin_instances_changed,
        run_blocking, run_history_mutation,
    },
    defaults::{default_keys, default_positions, default_stat_positions},
    errors::CmdResult,
    models::{
        AppStoreData, CommittedEditorChange, CustomCssPatch, CustomTab, EditorCommitOrigin,
        EditorDocumentV1, EditorField, KeyCounters, KeyMappings, KeyPositions, LayerGroups,
        NoteSettings, NoteSettingsPatch, SettingsPatchInput, SettingsState, StatPositions,
    },
    services::settings::apply_patch_to_store,
    state::{
        editor::validate_history_restore_metadata,
        history::{HistoryAdmissionLease, HistoryScope},
        migration::migrate_key_images_to_app_data,
        plugin::{for_each_stored_plugin_instances, normalize_plugin_instance_tab_id},
        store::{
            AuxEditorResetTransactionOptions, AuxEditorTransactionOptions,
            PluginInstancesResetScope,
        },
        tab_metadata::{normalize_bar_count, normalize_tab_order, validate_custom_tab_name},
        AppState,
    },
};

pub mod custom_tabs;

const MAX_CUSTOM_TABS: usize = 30;

fn publish_legacy_key_noop_runtime(
    state: &AppState,
    _app: &AppHandle,
    change: &CommittedEditorChange,
) {
    state.apply_committed_editor_keys_without_counters(
        change.runtime_publication_generation,
        &change.document.keys,
        &change.selected_key_type,
    );
    state.obs_broadcast_counters();
    state.refresh_obs_snapshot();
}

fn publish_legacy_reset_editor_change(
    state: &AppState,
    app: &AppHandle,
    change: &CommittedEditorChange,
    key_runtime_applied: bool,
) {
    if key_runtime_applied {
        publish_editor_change_after_key_runtime(state, app, change);
        emit_aux_history_status(app, change);
        if !change.result.changed_fields.contains(&EditorField::Keys) {
            state.apply_committed_editor_keys_without_counters(
                change.runtime_publication_generation,
                &change.document.keys,
                &change.selected_key_type,
            );
            if change.event.is_none() || change.result.changed_fields.is_empty() {
                state.refresh_obs_snapshot();
            }
        }
        return;
    }

    publish_legacy_editor_change(state, app, change);
    if !change.result.changed_fields.contains(&EditorField::Keys) {
        publish_legacy_key_noop_runtime(state, app, change);
    }
}

fn emit_aux_history_status(app: &AppHandle, change: &CommittedEditorChange) {
    if let Some(status) = change.history_status.as_ref() {
        emit_best_effort(app, "history:status", status);
    }
}

fn publish_reset_plugin_instances(app: &AppHandle, change: &CommittedEditorChange) {
    for payload in &change.plugin_instances_changes {
        publish_plugin_instances_changed(app, payload);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ModeResetKind {
    Default,
    Custom,
}

struct CustomTabDeletePlan {
    custom_tabs: Vec<CustomTab>,
    tab_order: Vec<String>,
    next_selected: String,
}

fn zeroed_counters(keys: &KeyMappings) -> KeyCounters {
    keys.iter()
        .map(|(mode, mode_keys)| {
            (
                mode.clone(),
                mode_keys.iter().map(|key| (key.canonical(), 0)).collect(),
            )
        })
        .collect()
}

fn reset_all_editor_data(
    store: &mut AppStoreData,
    keys: &KeyMappings,
    positions: &KeyPositions,
    stat_positions: &StatPositions,
) {
    store.keys = keys.clone();
    store.key_positions = positions.clone();
    store.stat_positions = stat_positions.clone();
    store.graph_positions.clear();
    store.knob_positions.clear();
    store.layer_groups.clear();
    store.key_counters = zeroed_counters(keys);
    store.custom_tabs.clear();
    store.tab_order = normalize_tab_order(&[], &store.custom_tabs);
    store.bar_count = normalize_bar_count(crate::models::default_bar_count(), &store.tab_order);
    store.selected_key_type = "4key".to_string();
    store.tab_note_overrides.clear();
    store.tab_css_overrides.clear();
    crate::state::native_element_id::rekey_store_element_ids(store);
}

fn reset_all_editor_data_with_images(
    store: &mut AppStoreData,
    keys: &KeyMappings,
    positions: &KeyPositions,
    stat_positions: &StatPositions,
    app_data_dir: &std::path::Path,
) {
    reset_all_editor_data(store, keys, positions, stat_positions);
    migrate_key_images_to_app_data(app_data_dir, store);
}

fn reset_mode_kind(store: &AppStoreData, mode: &str) -> Option<ModeResetKind> {
    if default_keys().contains_key(mode) {
        Some(ModeResetKind::Default)
    } else if store.custom_tabs.iter().any(|tab| tab.id == mode) {
        Some(ModeResetKind::Custom)
    } else {
        None
    }
}

fn is_selectable_mode(store: &AppStoreData, mode: &str) -> bool {
    default_keys().contains_key(mode)
        || (store.keys.contains_key(mode) && store.custom_tabs.iter().any(|tab| tab.id == mode))
}

fn select_mode_if_available(store: &mut AppStoreData, requested: &str) -> (bool, String) {
    if !is_selectable_mode(store, requested) {
        return (false, store.selected_key_type.clone());
    }
    store.selected_key_type = requested.to_string();
    (true, store.selected_key_type.clone())
}

#[cfg(test)]
fn set_mode_with<Commit, ApplyRuntime>(
    store: &AppStoreData,
    requested: String,
    commit: Commit,
    apply_runtime: ApplyRuntime,
) -> CmdResult<ModeResponse>
where
    Commit: FnOnce(String) -> CmdResult<String>,
    ApplyRuntime: FnOnce(&str) -> CmdResult<()>,
{
    if !is_selectable_mode(store, &requested) {
        return Ok(ModeResponse {
            success: false,
            mode: store.selected_key_type.clone(),
        });
    }

    let effective = commit(requested.clone())?;
    apply_runtime(&effective)?;
    Ok(ModeResponse {
        success: effective == requested,
        mode: effective,
    })
}

fn apply_reset_mode_data(store: &mut AppStoreData, mode: &str, kind: ModeResetKind) {
    match kind {
        ModeResetKind::Default => {
            if let Some(keys) = default_keys().get(mode) {
                store.keys.insert(mode.to_string(), keys.clone());
            }
            if let Some(positions) = default_positions().get(mode) {
                store
                    .key_positions
                    .insert(mode.to_string(), positions.clone());
            }
            if let Some(positions) = default_stat_positions().get(mode) {
                store
                    .stat_positions
                    .insert(mode.to_string(), positions.clone());
            }
        }
        ModeResetKind::Custom => {
            store.keys.insert(mode.to_string(), Vec::new());
            store.key_positions.insert(mode.to_string(), Vec::new());
            store.stat_positions.insert(mode.to_string(), Vec::new());
        }
    }

    store.graph_positions.insert(mode.to_string(), Vec::new());
    store.knob_positions.insert(mode.to_string(), Vec::new());
    store.layer_groups.remove(mode);
    store.tab_css_overrides.remove(mode);
    store.tab_note_overrides.remove(mode);

    let mode_keys = store.keys.get(mode).cloned().unwrap_or_default();
    store.key_counters.insert(
        mode.to_string(),
        mode_keys
            .into_iter()
            .map(|key| (key.canonical(), 0))
            .collect(),
    );
}

fn mode_positions_equal_without_ids(
    current: &AppStoreData,
    candidate: &AppStoreData,
    mode: &str,
) -> bool {
    let mut current_keys = current.key_positions.get(mode).cloned();
    let mut candidate_keys = candidate.key_positions.get(mode).cloned();
    for position in current_keys.iter_mut().flatten() {
        position.id.clear();
    }
    for position in candidate_keys.iter_mut().flatten() {
        position.id.clear();
    }

    let mut current_stats = current.stat_positions.get(mode).cloned();
    let mut candidate_stats = candidate.stat_positions.get(mode).cloned();
    for position in current_stats.iter_mut().flatten() {
        position.position.id.clear();
    }
    for position in candidate_stats.iter_mut().flatten() {
        position.position.id.clear();
    }

    let mut current_graphs = current.graph_positions.get(mode).cloned();
    let mut candidate_graphs = candidate.graph_positions.get(mode).cloned();
    for position in current_graphs.iter_mut().flatten() {
        position.position.id.clear();
    }
    for position in candidate_graphs.iter_mut().flatten() {
        position.position.id.clear();
    }

    let mut current_knobs = current.knob_positions.get(mode).cloned();
    let mut candidate_knobs = candidate.knob_positions.get(mode).cloned();
    for position in current_knobs.iter_mut().flatten() {
        position.position.id.clear();
    }
    for position in candidate_knobs.iter_mut().flatten() {
        position.position.id.clear();
    }

    current_keys == candidate_keys
        && optional_collections_equal(current_stats.as_deref(), candidate_stats.as_deref())
        && optional_collections_equal(current_graphs.as_deref(), candidate_graphs.as_deref())
        && optional_collections_equal(current_knobs.as_deref(), candidate_knobs.as_deref())
}

fn optional_collections_equal<T: PartialEq>(
    current: Option<&[T]>,
    candidate: Option<&[T]>,
) -> bool {
    current.unwrap_or_default() == candidate.unwrap_or_default()
}

fn mode_reset_semantics_equal(
    current: &AppStoreData,
    candidate: &AppStoreData,
    mode: &str,
) -> bool {
    current.keys.get(mode) == candidate.keys.get(mode)
        && mode_positions_equal_without_ids(current, candidate, mode)
        && optional_collections_equal(
            current.layer_groups.get(mode).map(Vec::as_slice),
            candidate.layer_groups.get(mode).map(Vec::as_slice),
        )
        && current.tab_css_overrides.get(mode) == candidate.tab_css_overrides.get(mode)
        && current.tab_note_overrides.get(mode) == candidate.tab_note_overrides.get(mode)
        && current.key_counters.get(mode) == candidate.key_counters.get(mode)
}

fn has_plugin_instances_in_mode(store: &AppStoreData, mode: &str) -> bool {
    let mut found = false;
    for_each_stored_plugin_instances(store, |_, instances| {
        found |= instances
            .iter()
            .any(|instance| normalize_plugin_instance_tab_id(instance.tab_id.as_deref()) == mode);
    });
    found
}

fn reset_mode_data(store: &mut AppStoreData, mode: &str, kind: ModeResetKind) -> bool {
    let plugin_instances_changed = has_plugin_instances_in_mode(store, mode);
    let mut candidate = store.clone();
    apply_reset_mode_data(&mut candidate, mode, kind);
    crate::state::migration::canonicalize_gradient_pairs(&mut candidate);
    if mode_reset_semantics_equal(store, &candidate, mode) && !plugin_instances_changed {
        return false;
    }

    *store = candidate;
    crate::state::native_element_id::rekey_mode_element_ids(store, mode);
    true
}

fn reset_mode_data_with_images(
    store: &mut AppStoreData,
    mode: &str,
    kind: ModeResetKind,
    app_data_dir: &std::path::Path,
) -> bool {
    let changed = reset_mode_data(store, mode, kind);
    if kind == ModeResetKind::Default {
        migrate_key_images_to_app_data(app_data_dir, store) || changed
    } else {
        changed
    }
}

#[cfg(test)]
pub(crate) fn reset_mode_data_for_test(store: &mut AppStoreData, mode: &str) -> bool {
    reset_mode_kind(store, mode).is_some_and(|kind| reset_mode_data(store, mode, kind))
}

fn plan_custom_tab_delete(store: &AppStoreData, id: &str) -> Option<CustomTabDeletePlan> {
    store.custom_tabs.iter().position(|tab| tab.id == id)?;
    let mut tab_order = normalize_tab_order(&store.tab_order, &store.custom_tabs);
    let index = tab_order.iter().position(|tab_id| tab_id == id)?;
    let next_selected = if store.selected_key_type == id {
        if index > 0 {
            tab_order[index - 1].clone()
        } else {
            tab_order.get(1)?.clone()
        }
    } else {
        store.selected_key_type.clone()
    };
    tab_order.remove(index);
    let custom_tabs: Vec<CustomTab> = store
        .custom_tabs
        .iter()
        .filter(|tab| tab.id != id)
        .cloned()
        .collect();
    Some(CustomTabDeletePlan {
        custom_tabs,
        tab_order,
        next_selected,
    })
}

fn delete_custom_tab_data(store: &mut AppStoreData, id: &str, plan: &CustomTabDeletePlan) {
    store.custom_tabs = plan.custom_tabs.clone();
    store.tab_order = plan.tab_order.clone();
    store.bar_count = normalize_bar_count(store.bar_count, &store.tab_order);
    store.keys.remove(id);
    store.key_positions.remove(id);
    store.stat_positions.remove(id);
    store.graph_positions.remove(id);
    store.knob_positions.remove(id);
    store.layer_groups.remove(id);
    store.tab_css_overrides.remove(id);
    store.tab_note_overrides.remove(id);
    store.key_counters.remove(id);
    store.selected_key_type = plan.next_selected.clone();
}

#[derive(Serialize)]
pub struct ModeResponse {
    pub success: bool,
    pub mode: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetAllResponse {
    pub keys: KeyMappings,
    pub positions: KeyPositions,
    pub custom_tabs: Vec<CustomTab>,
    pub tab_order: Vec<String>,
    pub bar_count: u8,
    pub selected_key_type: String,
}

#[derive(Serialize)]
pub struct ResetModeResponse {
    pub success: bool,
    pub mode: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomTabChangePayload {
    pub custom_tabs: Vec<CustomTab>,
    pub tab_order: Vec<String>,
    pub bar_count: u8,
    pub selected_key_type: String,
    pub selection_authoritative: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabMetadataSnapshot {
    pub custom_tabs: Vec<CustomTab>,
    pub tab_order: Vec<String>,
    pub bar_count: u8,
    pub selected_key_type: String,
}

impl TabMetadataSnapshot {
    fn from_store(store: &AppStoreData) -> Self {
        Self {
            custom_tabs: store.custom_tabs.clone(),
            tab_order: store.tab_order.clone(),
            bar_count: store.bar_count,
            selected_key_type: store.selected_key_type.clone(),
        }
    }
}

/// 탭 배치 연산
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum TabOrderOpV1 {
    /// 두 탭 자리 교환
    Swap { a: String, b: String },
}

fn rename_custom_tab_metadata(
    store: &mut AppStoreData,
    id: &str,
    name: &str,
) -> (TabMetadataSnapshot, Option<String>, bool) {
    let Some(index) = store.custom_tabs.iter().position(|tab| tab.id == id) else {
        return (
            TabMetadataSnapshot::from_store(store),
            Some("unknown-tab".to_string()),
            false,
        );
    };
    let name = match validate_custom_tab_name(name, &store.custom_tabs, Some(id)) {
        Ok(name) => name,
        Err(error) => {
            return (
                TabMetadataSnapshot::from_store(store),
                Some(error.to_string()),
                false,
            );
        }
    };
    let changed = store.custom_tabs[index].name != name;
    store.custom_tabs[index].name = name;
    (TabMetadataSnapshot::from_store(store), None, changed)
}

fn reorder_tab_metadata(
    store: &mut AppStoreData,
    op: &TabOrderOpV1,
) -> (TabMetadataSnapshot, Option<String>, bool) {
    let mut tab_order = normalize_tab_order(&store.tab_order, &store.custom_tabs);
    let TabOrderOpV1::Swap { a, b } = op;
    let error = match (
        tab_order.iter().position(|id| id == a),
        tab_order.iter().position(|id| id == b),
    ) {
        (Some(a_index), Some(b_index)) => {
            if a_index != b_index {
                tab_order.swap(a_index, b_index);
            }
            None
        }
        _ => Some("unknown-tab".to_string()),
    };
    let normalized_bar_count = normalize_bar_count(store.bar_count, &tab_order);
    let changed = store.tab_order != tab_order || store.bar_count != normalized_bar_count;
    store.tab_order = tab_order;
    store.bar_count = normalized_bar_count;
    (TabMetadataSnapshot::from_store(store), error, changed)
}

fn reorder_change_payload(
    snapshot: &TabMetadataSnapshot,
    changed: bool,
) -> Option<CustomTabChangePayload> {
    changed.then(|| CustomTabChangePayload {
        custom_tabs: snapshot.custom_tabs.clone(),
        tab_order: snapshot.tab_order.clone(),
        bar_count: snapshot.bar_count,
        selected_key_type: snapshot.selected_key_type.clone(),
        selection_authoritative: false,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabMetadataResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<TabMetadataSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct CustomTabCreateResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<CustomTab>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct CustomTabDeleteResult {
    pub success: bool,
    pub selected: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub async fn keys_get(app: AppHandle) -> CmdResult<KeyMappings> {
    run_blocking(app, |_, state| Ok(state.store.snapshot().keys)).await
}

#[tauri::command]
pub async fn positions_get(app: AppHandle) -> CmdResult<KeyPositions> {
    run_blocking(app, |_, state| Ok(state.store.snapshot().key_positions)).await
}

#[tauri::command]
pub fn keys_get_counters(state: State<'_, AppState>) -> CmdResult<KeyCounters> {
    Ok(state.snapshot_key_counters())
}

#[tauri::command]
pub async fn keys_set_mode(
    app: AppHandle,
    window: WebviewWindow,
    mode: String,
    observed_history_epoch: Option<u64>,
) -> CmdResult<ModeResponse> {
    run_history_mutation(
        app,
        window.label().to_string(),
        move |app, state, admission| {
            keys_set_mode_inner(state, app, mode, observed_history_epoch, admission)
        },
    )
    .await
}

fn keys_set_mode_inner(
    state: &AppState,
    app: &AppHandle,
    mode: String,
    observed_history_epoch: Option<u64>,
    admission: HistoryAdmissionLease,
) -> CmdResult<ModeResponse> {
    let requested = mode.clone();
    let transaction = state.store.commit_aux_editor_transaction_with_admission(
        AuxEditorTransactionOptions {
            scope: HistoryScope::Mode,
            observed_history_epoch,
            origin: EditorCommitOrigin::LegacyAdapter("keys_set_mode".to_string()),
            touched_fields: &[],
        },
        admission,
        move |store| Ok(select_mode_if_available(store, &requested)),
    )?;
    let (success, effective) = transaction.value.clone();
    if success
        && state.apply_committed_editor_keys_without_counters(
            transaction.change.runtime_publication_generation,
            &transaction.change.document.keys,
            &effective,
        )
    {
        emit_best_effort(
            app,
            "keys:mode-changed",
            &serde_json::json!({ "mode": &effective }),
        );
        state.refresh_obs_snapshot();
    }
    emit_aux_history_status(app, &transaction.change);
    Ok(ModeResponse {
        success,
        mode: effective,
    })
}

#[tauri::command]
pub async fn keys_reset_all(app: AppHandle, window: WebviewWindow) -> CmdResult<ResetAllResponse> {
    run_history_mutation(app, window.label().to_string(), keys_reset_all_inner).await
}

fn keys_reset_all_inner(
    app: &AppHandle,
    state: &AppState,
    admission: HistoryAdmissionLease,
) -> CmdResult<ResetAllResponse> {
    let keys = default_keys().clone();
    let positions = default_positions().clone();
    let stat_positions = default_stat_positions().clone();
    let app_data_dir = app.path().app_data_dir()?;
    let mut note_patch = NoteSettingsPatch::default();
    let defaults = NoteSettings::default();
    note_patch.frame_limit = Some(defaults.frame_limit);
    note_patch.speed = Some(defaults.speed);
    note_patch.track_height = Some(defaults.track_height);
    note_patch.reverse = Some(defaults.reverse);
    note_patch.fade_position = Some(defaults.fade_position.clone());
    note_patch.fade_top_px = Some(defaults.fade_top_px);
    note_patch.fade_bottom_px = Some(defaults.fade_bottom_px);
    note_patch.reverse_fade_top_px = Some(defaults.reverse_fade_top_px);
    note_patch.reverse_fade_bottom_px = Some(defaults.reverse_fade_bottom_px);
    note_patch.delayed_note_enabled = Some(defaults.delayed_note_enabled);
    note_patch.short_note_threshold_ms = Some(defaults.short_note_threshold_ms);
    note_patch.short_note_min_length_px = Some(defaults.short_note_min_length_px);
    note_patch.key_display_delay_ms = Some(defaults.key_display_delay_ms);
    // 초기화 값은 설정 기본값 단일 원천에서 유도
    let setting_defaults = SettingsState::default();
    let settings_patch = SettingsPatchInput {
        background_color: Some(setting_defaults.background_color.clone()),
        note_settings: Some(note_patch),
        laboratory_enabled: Some(setting_defaults.laboratory_enabled),
        use_custom_css: Some(setting_defaults.use_custom_css),
        custom_css: Some(CustomCssPatch {
            path: Some(setting_defaults.custom_css.path.clone()),
            content: Some(setting_defaults.custom_css.content.clone()),
        }),
        note_effect: Some(setting_defaults.note_effect),
        overlay_locked: Some(setting_defaults.overlay_locked),
        ..SettingsPatchInput::default()
    };
    let css_operation_guard = state.lock_css_operation();
    let previous_css_state = state.store.snapshot();
    let (transaction, key_runtime_applied) = state
        .commit_legacy_editor_reset_preserving_runtime_counters(
            app,
            EditorCommitOrigin::LegacyAdapter("keys_reset_all".to_string()),
            &[
                EditorField::Keys,
                EditorField::KeyPositions,
                EditorField::StatPositions,
                EditorField::GraphPositions,
                EditorField::KnobPositions,
                EditorField::LayerGroups,
            ],
            PluginInstancesResetScope::All,
            admission,
            move |store| {
                let cleared_tab_css_ids =
                    store.tab_css_overrides.keys().cloned().collect::<Vec<_>>();
                reset_all_editor_data_with_images(
                    store,
                    &keys,
                    &positions,
                    &stat_positions,
                    &app_data_dir,
                );
                let settings_diff = apply_patch_to_store(store, &settings_patch);
                Ok((settings_diff, cleared_tab_css_ids))
            },
        )?;
    let current_css_state = state.store.snapshot();
    state.resync_global_css_watcher(&previous_css_state, &current_css_state);
    for tab_id in &transaction.value.1 {
        state.unwatch_tab_css(tab_id);
    }
    drop(css_operation_guard);
    publish_legacy_reset_editor_change(state, app, &transaction.change, key_runtime_applied);
    publish_reset_plugin_instances(app, &transaction.change);

    let (settings_diff, cleared_tab_css_ids) = transaction.value;
    let keys = transaction.change.document.keys;
    let positions = transaction.change.document.key_positions;
    let stat_positions = transaction.change.document.stat_positions;
    let graph_positions = transaction.change.document.graph_positions;
    let knob_positions = transaction.change.document.knob_positions;
    let layer_groups = transaction.change.document.layer_groups;
    let selected_key_type = transaction.change.selected_key_type;
    let custom_tabs: Vec<CustomTab> = Vec::new();
    let tab_order = normalize_tab_order(&[], &custom_tabs);
    let bar_count = normalize_bar_count(crate::models::default_bar_count(), &tab_order);
    let tab_note_overrides = crate::models::TabNoteOverrides::new();

    if let Err(error) = state.emit_settings_changed(&settings_diff, app) {
        log::error!("[Keys] failed to publish reset settings: {error:#}");
    }

    emit_best_effort(app, "keys:changed", &keys);
    emit_best_effort(app, "positions:changed", &positions);
    emit_best_effort(app, "statPositions:changed", &stat_positions);
    emit_best_effort(app, "graphPositions:changed", &graph_positions);
    emit_best_effort(app, "knobPositions:changed", &knob_positions);
    emit_best_effort(app, "layerGroups:changed", &layer_groups);
    emit_best_effort(
        app,
        "customTabs:changed",
        &CustomTabChangePayload {
            custom_tabs: custom_tabs.clone(),
            tab_order: tab_order.clone(),
            bar_count,
            selected_key_type: selected_key_type.clone(),
            selection_authoritative: true,
        },
    );
    emit_best_effort(
        app,
        "keys:mode-changed",
        &serde_json::json!({ "mode": &selected_key_type }),
    );
    emit_best_effort(app, "css:use", &serde_json::json!({ "enabled": false }));
    emit_best_effort(
        app,
        "css:content",
        &serde_json::json!({ "path": serde_json::Value::Null, "content": "" }),
    );
    emit_best_effort(app, "tabNote:changed_all", &tab_note_overrides);
    for tab_id in cleared_tab_css_ids {
        emit_best_effort(
            app,
            "tabCss:changed",
            &crate::commands::editor::css::TabCssResponse { tab_id, css: None },
        );
    }

    Ok(ResetAllResponse {
        keys,
        positions,
        custom_tabs,
        tab_order,
        bar_count,
        selected_key_type,
    })
}

#[tauri::command]
pub async fn keys_reset_mode(
    app: AppHandle,
    window: WebviewWindow,
    mode: String,
) -> CmdResult<ResetModeResponse> {
    run_history_mutation(
        app,
        window.label().to_string(),
        move |app, state, admission| keys_reset_mode_inner(state, app, mode, admission),
    )
    .await
}

fn keys_reset_mode_inner(
    state: &AppState,
    app: &AppHandle,
    mode: String,
    admission: HistoryAdmissionLease,
) -> CmdResult<ResetModeResponse> {
    let app_data_dir = app.path().app_data_dir()?;
    let (transaction, key_runtime_applied) = state
        .commit_legacy_editor_reset_preserving_runtime_counters(
            app,
            EditorCommitOrigin::LegacyAdapter("keys_reset_mode".to_string()),
            &[
                EditorField::Keys,
                EditorField::KeyPositions,
                EditorField::StatPositions,
                EditorField::GraphPositions,
                EditorField::KnobPositions,
                EditorField::LayerGroups,
            ],
            PluginInstancesResetScope::Mode(mode.clone()),
            admission,
            |store| {
                let Some(kind) = reset_mode_kind(store, &mode) else {
                    return Ok(None);
                };
                let cleared_tab_css = store.tab_css_overrides.contains_key(&mode);
                reset_mode_data_with_images(store, &mode, kind, &app_data_dir);
                Ok(Some((cleared_tab_css, store.tab_note_overrides.clone())))
            },
        )?;
    let Some((cleared_tab_css, tab_note_overrides)) = transaction.value else {
        return Ok(ResetModeResponse {
            success: false,
            mode,
        });
    };
    publish_legacy_reset_editor_change(state, app, &transaction.change, key_runtime_applied);
    publish_reset_plugin_instances(app, &transaction.change);

    if cleared_tab_css {
        state.unwatch_tab_css(&mode);
    }

    emit_best_effort(app, "keys:changed", &transaction.change.document.keys);
    emit_best_effort(
        app,
        "positions:changed",
        &transaction.change.document.key_positions,
    );
    emit_best_effort(
        app,
        "statPositions:changed",
        &transaction.change.document.stat_positions,
    );
    emit_best_effort(
        app,
        "graphPositions:changed",
        &transaction.change.document.graph_positions,
    );
    emit_best_effort(
        app,
        "knobPositions:changed",
        &transaction.change.document.knob_positions,
    );
    emit_best_effort(
        app,
        "layerGroups:changed",
        &transaction.change.document.layer_groups,
    );
    emit_best_effort(app, "tabNote:changed_all", &tab_note_overrides);
    if cleared_tab_css {
        emit_best_effort(
            app,
            "tabCss:changed",
            &crate::commands::editor::css::TabCssResponse {
                tab_id: mode.clone(),
                css: None,
            },
        );
    }

    Ok(ResetModeResponse {
        success: true,
        mode,
    })
}

#[tauri::command]
pub async fn keys_reset_counters(
    app: AppHandle,
    window: WebviewWindow,
    observed_history_epoch: Option<u64>,
) -> CmdResult<KeyCounters> {
    run_history_mutation(
        app,
        window.label().to_string(),
        move |app, state, admission| {
            let mutation =
                state.reset_key_counters_with_admission(app, observed_history_epoch, admission)?;
            state.obs_broadcast_counters();
            if let Some(status) = mutation.history_status.as_ref() {
                emit_best_effort(app, "history:status", status);
            }
            Ok(mutation.counters)
        },
    )
    .await
}

#[tauri::command]
pub async fn keys_reset_counters_mode(
    app: AppHandle,
    window: WebviewWindow,
    mode: String,
    observed_history_epoch: Option<u64>,
) -> CmdResult<KeyCounters> {
    run_history_mutation(
        app,
        window.label().to_string(),
        move |app, state, admission| {
            let mutation = state.reset_mode_counters_with_admission(
                app,
                &mode,
                observed_history_epoch,
                admission,
            )?;
            state.obs_broadcast_counters();
            if let Some(status) = mutation.history_status.as_ref() {
                emit_best_effort(app, "history:status", status);
            }
            Ok(mutation.counters)
        },
    )
    .await
}

#[tauri::command]
pub async fn keys_reset_single_counter(
    app: AppHandle,
    window: WebviewWindow,
    mode: String,
    key: String,
    observed_history_epoch: Option<u64>,
) -> CmdResult<KeyCounters> {
    run_history_mutation(
        app,
        window.label().to_string(),
        move |app, state, admission| {
            let mutation = state.reset_single_key_counter_with_admission(
                app,
                &mode,
                &key,
                observed_history_epoch,
                admission,
            )?;
            state.obs_broadcast_counters();
            if let Some(status) = mutation.history_status.as_ref() {
                emit_best_effort(app, "history:status", status);
            }
            Ok(mutation.counters)
        },
    )
    .await
}

#[tauri::command]
pub async fn keys_set_counters(
    app: AppHandle,
    window: WebviewWindow,
    counters: KeyCounters,
    observed_history_epoch: Option<u64>,
) -> CmdResult<KeyCounters> {
    run_history_mutation(
        app,
        window.label().to_string(),
        move |app, state, admission| {
            let mutation = state.replace_key_counters_with_admission(
                app,
                counters,
                observed_history_epoch,
                admission,
            )?;
            state.obs_broadcast_counters();
            if let Some(status) = mutation.history_status.as_ref() {
                emit_best_effort(app, "history:status", status);
            }
            Ok(mutation.counters)
        },
    )
    .await
}

#[tauri::command]
pub async fn layer_groups_get(app: AppHandle) -> CmdResult<LayerGroups> {
    run_blocking(app, |_, state| Ok(state.store.snapshot().layer_groups)).await
}

fn generate_custom_tab_id() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("custom-{}", now)
}

#[derive(Serialize)]
pub struct RawInputSubscribeResponse {
    pub count: u32,
}

/// Subscribe to raw input stream (increment subscriber count)
#[tauri::command]
pub fn raw_input_subscribe(state: State<'_, AppState>) -> CmdResult<RawInputSubscribeResponse> {
    let count = state.subscribe_raw_input();
    log::debug!("[RawInput] Subscribe: count = {}", count);
    Ok(RawInputSubscribeResponse { count })
}

/// Unsubscribe from raw input stream (decrement subscriber count)
#[tauri::command]
pub fn raw_input_unsubscribe(state: State<'_, AppState>) -> CmdResult<RawInputSubscribeResponse> {
    let count = state.unsubscribe_raw_input();
    log::debug!("[RawInput] Unsubscribe: count = {}", count);
    Ok(RawInputSubscribeResponse { count })
}

#[cfg(test)]
mod tests;
