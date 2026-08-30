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
pub async fn custom_tabs_list(app: AppHandle) -> CmdResult<Vec<CustomTab>> {
    run_blocking(app, |_, state| Ok(state.store.snapshot().custom_tabs)).await
}

#[tauri::command]
pub async fn custom_tabs_create(
    app: AppHandle,
    window: WebviewWindow,
    name: String,
    observed_history_epoch: Option<u64>,
) -> CmdResult<CustomTabCreateResult> {
    let id = generate_custom_tab_id();
    run_history_mutation(
        app,
        window.label().to_string(),
        move |app, state, admission| {
            custom_tabs_create_inner(state, app, id, name, observed_history_epoch, admission)
        },
    )
    .await
}

fn custom_tabs_create_inner(
    state: &AppState,
    app: &AppHandle,
    id: String,
    name: String,
    observed_history_epoch: Option<u64>,
    admission: HistoryAdmissionLease,
) -> CmdResult<CustomTabCreateResult> {
    let (transaction, key_runtime_applied) = state
        .commit_editor_transaction_preserving_runtime_counters(app, |runtime_counters| {
            state
                .store
                .commit_aux_editor_transaction_with_runtime_counters_admission(
                    AuxEditorTransactionOptions {
                        scope: HistoryScope::CustomTabs,
                        observed_history_epoch,
                        origin: EditorCommitOrigin::LegacyAdapter("custom_tabs_create".to_string()),
                        touched_fields: &[EditorField::Keys, EditorField::KeyPositions],
                    },
                    admission,
                    runtime_counters,
                    |store| {
                        let name = match validate_custom_tab_name(&name, &store.custom_tabs, None) {
                            Ok(name) => name,
                            Err(error) => return Ok(Err(error.to_string())),
                        };
                        if store.custom_tabs.len() >= MAX_CUSTOM_TABS {
                            return Ok(Err("max-reached".to_string()));
                        }
                        let tab = CustomTab {
                            id: id.clone(),
                            name,
                        };
                        store.custom_tabs.push(tab.clone());
                        store.tab_order = normalize_tab_order(&store.tab_order, &store.custom_tabs);
                        store.keys.insert(id.clone(), Vec::new());
                        store.key_positions.insert(id.clone(), Vec::new());
                        store.selected_key_type = id.clone();
                        Ok(Ok((
                            tab,
                            store.custom_tabs.clone(),
                            store.tab_order.clone(),
                            store.bar_count,
                        )))
                    },
                )
        })?;
    let (tab, custom_tabs, tab_order, bar_count) = match transaction.value {
        Ok(result) => result,
        Err(error) => {
            return Ok(CustomTabCreateResult {
                result: None,
                error: Some(error),
            });
        }
    };
    if key_runtime_applied {
        publish_editor_change_after_key_runtime(state, app, &transaction.change);
    } else {
        publish_editor_change(state, app, &transaction.change, false);
    }

    emit_best_effort(
        app,
        "customTabs:changed",
        &CustomTabChangePayload {
            custom_tabs: custom_tabs.clone(),
            tab_order,
            bar_count,
            selected_key_type: id.clone(),
            selection_authoritative: true,
        },
    );
    emit_best_effort(app, "keys:changed", &transaction.change.document.keys);
    emit_best_effort(
        app,
        "positions:changed",
        &transaction.change.document.key_positions,
    );
    emit_best_effort(
        app,
        "keys:mode-changed",
        &serde_json::json!({ "mode": &id }),
    );
    emit_aux_history_status(app, &transaction.change);

    Ok(CustomTabCreateResult {
        result: Some(tab),
        error: None,
    })
}

#[tauri::command]
pub async fn custom_tabs_rename(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
    name: String,
    observed_history_epoch: Option<u64>,
) -> CmdResult<TabMetadataResult> {
    run_history_mutation(
        app,
        window.label().to_string(),
        move |app, state, admission| {
            custom_tabs_rename_inner(state, app, id, name, observed_history_epoch, admission)
        },
    )
    .await
}

fn custom_tabs_rename_inner(
    state: &AppState,
    app: &AppHandle,
    id: String,
    name: String,
    observed_history_epoch: Option<u64>,
    admission: HistoryAdmissionLease,
) -> CmdResult<TabMetadataResult> {
    let (transaction, _) =
        state.commit_editor_transaction_preserving_runtime_counters(app, |runtime_counters| {
            state
                .store
                .commit_aux_editor_transaction_with_runtime_counters_admission(
                    AuxEditorTransactionOptions {
                        scope: HistoryScope::CustomTabs,
                        observed_history_epoch,
                        origin: EditorCommitOrigin::LegacyAdapter("custom_tabs_rename".to_string()),
                        touched_fields: &[],
                    },
                    admission,
                    runtime_counters,
                    |store| Ok(rename_custom_tab_metadata(store, &id, &name)),
                )
        })?;
    let (snapshot, error, changed) = transaction.value;
    if changed {
        publish_editor_change(state, app, &transaction.change, false);
        emit_best_effort(
            app,
            "customTabs:changed",
            &CustomTabChangePayload {
                custom_tabs: snapshot.custom_tabs.clone(),
                tab_order: snapshot.tab_order.clone(),
                bar_count: snapshot.bar_count,
                selected_key_type: snapshot.selected_key_type.clone(),
                selection_authoritative: false,
            },
        );
        state.refresh_obs_snapshot();
    }
    emit_aux_history_status(app, &transaction.change);

    Ok(TabMetadataResult {
        result: Some(snapshot),
        error,
    })
}

#[tauri::command]
pub async fn tabs_reorder(
    app: AppHandle,
    window: WebviewWindow,
    op: TabOrderOpV1,
) -> CmdResult<TabMetadataResult> {
    run_history_mutation(
        app,
        window.label().to_string(),
        move |app, state, admission| tabs_reorder_inner(state, app, op, admission),
    )
    .await
}

fn tabs_reorder_inner(
    state: &AppState,
    app: &AppHandle,
    op: TabOrderOpV1,
    admission: HistoryAdmissionLease,
) -> CmdResult<TabMetadataResult> {
    let (transaction, _) =
        state.commit_editor_transaction_preserving_runtime_counters(app, |runtime_counters| {
            state
                .store
                .commit_aux_editor_transaction_with_runtime_counters_admission(
                    AuxEditorTransactionOptions {
                        scope: HistoryScope::CustomTabs,
                        observed_history_epoch: None,
                        origin: EditorCommitOrigin::LegacyAdapter("tabs_reorder".to_string()),
                        touched_fields: &[],
                    },
                    admission,
                    runtime_counters,
                    |store| Ok(reorder_tab_metadata(store, &op)),
                )
        })?;
    let (snapshot, error, changed) = transaction.value;
    if let Some(payload) = reorder_change_payload(&snapshot, changed) {
        publish_editor_change(state, app, &transaction.change, false);
        emit_best_effort(app, "customTabs:changed", &payload);
        state.refresh_obs_snapshot();
    }
    emit_aux_history_status(app, &transaction.change);

    Ok(TabMetadataResult {
        result: Some(snapshot),
        error,
    })
}

#[tauri::command]
pub async fn custom_tabs_delete(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
    observed_history_epoch: Option<u64>,
) -> CmdResult<CustomTabDeleteResult> {
    run_history_mutation(
        app,
        window.label().to_string(),
        move |app, state, admission| {
            custom_tabs_delete_inner(state, app, id, observed_history_epoch, admission)
        },
    )
    .await
}

fn custom_tabs_delete_inner(
    state: &AppState,
    app: &AppHandle,
    id: String,
    observed_history_epoch: Option<u64>,
    admission: HistoryAdmissionLease,
) -> CmdResult<CustomTabDeleteResult> {
    let (transaction, key_runtime_applied) = state
        .commit_editor_transaction_preserving_runtime_counters(app, |runtime_counters| {
            state
                .store
                .commit_aux_editor_reset_transaction_with_runtime_counters_admission(
                    AuxEditorResetTransactionOptions {
                        scope: HistoryScope::CustomTabs,
                        observed_history_epoch,
                        origin: EditorCommitOrigin::LegacyAdapter("custom_tabs_delete".to_string()),
                        touched_fields: &[
                            EditorField::Keys,
                            EditorField::KeyPositions,
                            EditorField::StatPositions,
                            EditorField::GraphPositions,
                            EditorField::KnobPositions,
                            EditorField::LayerGroups,
                        ],
                        plugin_instances_reset: PluginInstancesResetScope::Mode(id.clone()),
                    },
                    admission,
                    runtime_counters,
                    |store| {
                        let Some(plan) = plan_custom_tab_delete(store, &id) else {
                            return Ok(Err(store.selected_key_type.clone()));
                        };
                        delete_custom_tab_data(store, &id, &plan);
                        Ok(Ok((
                            store.custom_tabs.clone(),
                            store.tab_order.clone(),
                            store.bar_count,
                            store.selected_key_type.clone(),
                            store.tab_note_overrides.clone(),
                        )))
                    },
                )
        })?;
    let (custom_tabs, tab_order, bar_count, selected_key_type, tab_note_overrides) =
        match transaction.value {
            Ok(result) => result,
            Err(selected) => {
                return Ok(CustomTabDeleteResult {
                    success: false,
                    selected,
                    error: Some("not-found".to_string()),
                });
            }
        };
    if key_runtime_applied {
        publish_editor_change_after_key_runtime(state, app, &transaction.change);
    } else {
        publish_editor_change(state, app, &transaction.change, false);
    }
    publish_reset_plugin_instances(app, &transaction.change);
    state.unwatch_tab_css(&id);

    emit_best_effort(
        app,
        "customTabs:changed",
        &CustomTabChangePayload {
            custom_tabs,
            tab_order,
            bar_count,
            selected_key_type: selected_key_type.clone(),
            selection_authoritative: true,
        },
    );
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
    emit_best_effort(
        app,
        "tabCss:changed",
        &crate::commands::editor::css::TabCssResponse {
            tab_id: id,
            css: None,
        },
    );
    emit_best_effort(
        app,
        "keys:mode-changed",
        &serde_json::json!({ "mode": &selected_key_type }),
    );
    emit_aux_history_status(app, &transaction.change);

    Ok(CustomTabDeleteResult {
        success: true,
        selected: selected_key_type,
        error: None,
    })
}

#[derive(Serialize)]
pub struct CustomTabSelectResult {
    pub success: bool,
    pub selected: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub async fn custom_tabs_select(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
    observed_history_epoch: Option<u64>,
) -> CmdResult<CustomTabSelectResult> {
    run_history_mutation(
        app,
        window.label().to_string(),
        move |app, state, admission| {
            custom_tabs_select_inner(state, app, id, observed_history_epoch, admission)
        },
    )
    .await
}

fn custom_tabs_select_inner(
    state: &AppState,
    app: &AppHandle,
    id: String,
    observed_history_epoch: Option<u64>,
    admission: HistoryAdmissionLease,
) -> CmdResult<CustomTabSelectResult> {
    let requested = id;
    let transaction = state.store.commit_aux_editor_transaction_with_admission(
        AuxEditorTransactionOptions {
            scope: HistoryScope::Mode,
            observed_history_epoch,
            origin: EditorCommitOrigin::LegacyAdapter("custom_tabs_select".to_string()),
            touched_fields: &[],
        },
        admission,
        move |store| Ok(select_mode_if_available(store, &requested)),
    )?;
    let (success, selected) = transaction.value.clone();
    if success
        && state.apply_committed_editor_keys_without_counters(
            transaction.change.runtime_publication_generation,
            &transaction.change.document.keys,
            &selected,
        )
    {
        emit_best_effort(
            app,
            "keys:mode-changed",
            &serde_json::json!({ "mode": &selected }),
        );
        state.refresh_obs_snapshot();
    }
    emit_aux_history_status(app, &transaction.change);

    Ok(CustomTabSelectResult {
        success,
        selected,
        error: (!success).then(|| "not-found".to_string()),
    })
}

/// 커스텀 탭 목록과 선택 모드를 원자적으로 복원
#[tauri::command]
pub async fn custom_tabs_restore(
    app: AppHandle,
    window: WebviewWindow,
    custom_tabs: Vec<CustomTab>,
    selected_key_type: String,
    observed_history_epoch: Option<u64>,
) -> CmdResult<()> {
    run_history_mutation(
        app,
        window.label().to_string(),
        move |app, state, admission| {
            custom_tabs_restore_inner(
                state,
                app,
                custom_tabs,
                selected_key_type,
                observed_history_epoch,
                admission,
            )
        },
    )
    .await
}

fn custom_tabs_restore_inner(
    state: &AppState,
    app: &AppHandle,
    custom_tabs: Vec<CustomTab>,
    selected_key_type: String,
    observed_history_epoch: Option<u64>,
    admission: HistoryAdmissionLease,
) -> CmdResult<()> {
    let (transaction, _) =
        state.commit_editor_transaction_preserving_runtime_counters(app, |runtime_counters| {
            state
                .store
                .commit_aux_editor_transaction_with_runtime_counters_admission(
                    AuxEditorTransactionOptions {
                        scope: HistoryScope::CustomTabs,
                        observed_history_epoch,
                        origin: EditorCommitOrigin::LegacyAdapter(
                            "custom_tabs_restore".to_string(),
                        ),
                        touched_fields: &[],
                    },
                    admission,
                    runtime_counters,
                    move |store| {
                        let tab_order = normalize_tab_order(&store.tab_order, &custom_tabs);
                        validate_history_restore_metadata(
                            &EditorDocumentV1::from_store(store),
                            &custom_tabs,
                            &tab_order,
                            &selected_key_type,
                        )?;
                        store.custom_tabs = custom_tabs;
                        store.tab_order = tab_order;
                        store.bar_count = normalize_bar_count(store.bar_count, &store.tab_order);
                        store.selected_key_type = selected_key_type;
                        Ok((
                            store.custom_tabs.clone(),
                            store.tab_order.clone(),
                            store.bar_count,
                            store.selected_key_type.clone(),
                        ))
                    },
                )
        })?;
    let (custom_tabs, tab_order, bar_count, selected_key_type) = transaction.value;

    state.apply_committed_editor_keys_without_counters(
        transaction.change.runtime_publication_generation,
        &transaction.change.document.keys,
        &selected_key_type,
    );
    emit_best_effort(
        app,
        "customTabs:changed",
        &CustomTabChangePayload {
            custom_tabs,
            tab_order,
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
    state.refresh_obs_snapshot();
    emit_aux_history_status(app, &transaction.change);
    Ok(())
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
mod tests {
    use super::{
        delete_custom_tab_data, plan_custom_tab_delete, rename_custom_tab_metadata,
        reorder_change_payload, reorder_tab_metadata, reset_all_editor_data,
        reset_all_editor_data_with_images, reset_mode_data, reset_mode_data_with_images,
        reset_mode_kind, select_mode_if_available, set_mode_with, ModeResetKind, TabOrderOpV1,
    };
    use crate::{
        defaults::{default_keys, default_positions, default_stat_positions},
        keyboard::KeyboardManager,
        models::{
            AppStoreData, CustomTab, EditorCommitOrigin, EditorField, GraphPosition, GraphStatType,
            GraphType, KeyCounters, KeySlot, KnobPosition, LayerGroupDef, StatPosition, StatType,
            TabCss, TabNoteSettings,
        },
        state::{
            app_state::KeyCounterEventEmitter,
            history::{HistoryDirection, HistoryScope},
            store::PluginInstancesResetScope,
            AppState, AppStore,
        },
    };
    use std::{cell::Cell, collections::HashSet};

    const TARGET_TAB: &str = "custom-target";

    struct NoopCounterEmitter;

    impl KeyCounterEventEmitter for NoopCounterEmitter {
        fn emit_key_counters(
            &self,
            _counters: &KeyCounters,
            _session_id: &str,
            _revision: u64,
        ) -> anyhow::Result<()> {
            Ok(())
        }

        fn emit_key_counter(
            &self,
            _mode: &str,
            _key: &str,
            _count: u32,
            _session_id: &str,
            _revision: u64,
        ) -> anyhow::Result<()> {
            Ok(())
        }
    }

    fn populated_custom_tab_store() -> AppStoreData {
        let position = default_positions()
            .values()
            .next()
            .and_then(|positions| positions.first())
            .cloned()
            .expect("default position fixture");
        let mut store = AppStoreData {
            custom_tabs: vec![
                CustomTab {
                    id: "custom-before".to_string(),
                    name: "Before".to_string(),
                },
                CustomTab {
                    id: TARGET_TAB.to_string(),
                    name: "Target".to_string(),
                },
            ],
            selected_key_type: TARGET_TAB.to_string(),
            ..AppStoreData::default()
        };
        store
            .keys
            .insert(TARGET_TAB.to_string(), vec![KeySlot::from("KeyD")]);
        store
            .key_positions
            .insert(TARGET_TAB.to_string(), vec![position.clone()]);
        store.stat_positions.insert(
            TARGET_TAB.to_string(),
            vec![StatPosition {
                stat_type: StatType::Kps,
                position: position.clone(),
            }],
        );
        store.graph_positions.insert(
            TARGET_TAB.to_string(),
            vec![GraphPosition {
                stat_type: GraphStatType::Kps,
                graph_type: GraphType::Line,
                graph_speed: 1,
                graph_color: "#ffffff".to_string(),
                show_avg_line: true,
                position: position.clone(),
            }],
        );
        store.knob_positions.insert(
            TARGET_TAB.to_string(),
            vec![KnobPosition {
                axis_id: "axis".to_string(),
                sensitivity: 1.0,
                reverse: false,
                position,
            }],
        );
        store.layer_groups.insert(
            TARGET_TAB.to_string(),
            vec![LayerGroupDef {
                id: "group".to_string(),
                name: "Group".to_string(),
            }],
        );
        store
            .tab_css_overrides
            .insert(TARGET_TAB.to_string(), TabCss::default());
        store
            .tab_note_overrides
            .insert(TARGET_TAB.to_string(), TabNoteSettings::default());
        store.key_counters.insert(
            TARGET_TAB.to_string(),
            [("KeyD".to_string(), 7)].into_iter().collect(),
        );
        store
    }

    #[test]
    fn deleting_selected_custom_tab_clears_all_tab_scoped_data() {
        let mut store = populated_custom_tab_store();
        store.bar_count = 5;
        let plan = plan_custom_tab_delete(&store, TARGET_TAB).expect("delete plan");

        assert_eq!(plan.next_selected, "custom-before");
        delete_custom_tab_data(&mut store, TARGET_TAB, &plan);

        assert!(!store.custom_tabs.iter().any(|tab| tab.id == TARGET_TAB));
        assert!(!store.keys.contains_key(TARGET_TAB));
        assert!(!store.key_positions.contains_key(TARGET_TAB));
        assert!(!store.stat_positions.contains_key(TARGET_TAB));
        assert!(!store.graph_positions.contains_key(TARGET_TAB));
        assert!(!store.knob_positions.contains_key(TARGET_TAB));
        assert!(!store.layer_groups.contains_key(TARGET_TAB));
        assert!(!store.tab_css_overrides.contains_key(TARGET_TAB));
        assert!(!store.tab_note_overrides.contains_key(TARGET_TAB));
        assert!(!store.key_counters.contains_key(TARGET_TAB));
        assert_eq!(store.selected_key_type, "custom-before");
        assert_eq!(store.bar_count, 4);
    }

    #[test]
    fn deleting_first_selected_tab_chooses_next_builtin_neighbor() {
        let mut store = populated_custom_tab_store();
        store.tab_order = [TARGET_TAB, "4key", "custom-before", "5key", "6key", "8key"]
            .map(str::to_string)
            .to_vec();

        let plan = plan_custom_tab_delete(&store, TARGET_TAB).expect("delete plan");

        assert_eq!(plan.next_selected, "4key");
        assert_eq!(
            plan.tab_order,
            ["4key", "custom-before", "5key", "6key", "8key"]
        );
    }

    #[test]
    fn rename_rejects_long_reserved_duplicate_and_builtin_targets() {
        let mut store = populated_custom_tab_store();

        let (_, long_error, _) = rename_custom_tab_metadata(&mut store, TARGET_TAB, "12345678901");
        let (_, reserved_error, _) = rename_custom_tab_metadata(&mut store, TARGET_TAB, "4key");
        let (_, duplicate_error, _) = rename_custom_tab_metadata(&mut store, TARGET_TAB, "Before");
        let (_, builtin_error, _) = rename_custom_tab_metadata(&mut store, "4key", "Built in");

        assert_eq!(long_error.as_deref(), Some("name-too-long"));
        assert_eq!(reserved_error.as_deref(), Some("reserved-name"));
        assert_eq!(duplicate_error.as_deref(), Some("duplicate-name"));
        assert_eq!(builtin_error.as_deref(), Some("unknown-tab"));
        assert_eq!(
            store
                .custom_tabs
                .iter()
                .find(|tab| tab.id == TARGET_TAB)
                .unwrap()
                .name,
            "Target"
        );
    }

    #[test]
    fn reorder_applies_after_unrelated_tab_is_created() {
        let mut store = crate::state::migration::normalize_state(AppStoreData::default());
        let unrelated_id = "created-after-drag".to_string();
        store.custom_tabs.push(CustomTab {
            id: unrelated_id.clone(),
            name: "Created later".to_string(),
        });
        store.tab_order =
            crate::state::tab_metadata::normalize_tab_order(&store.tab_order, &store.custom_tabs);

        let (snapshot, error, changed) = reorder_tab_metadata(
            &mut store,
            &TabOrderOpV1::Swap {
                a: "4key".to_string(),
                b: "5key".to_string(),
            },
        );

        assert!(error.is_none());
        assert!(changed);
        assert_eq!(
            snapshot.tab_order,
            ["5key", "4key", "6key", "8key", unrelated_id.as_str()]
        );
    }

    #[test]
    fn reorder_applies_after_unrelated_tab_is_deleted() {
        let mut store = crate::state::migration::normalize_state(AppStoreData::default());
        let unrelated_id = "deleted-after-drag".to_string();
        store.custom_tabs.push(CustomTab {
            id: unrelated_id.clone(),
            name: "Deleted later".to_string(),
        });
        store.tab_order.push(unrelated_id.clone());
        store.custom_tabs.retain(|tab| tab.id != unrelated_id);
        store.tab_order.retain(|id| id != &unrelated_id);

        let (snapshot, error, changed) = reorder_tab_metadata(
            &mut store,
            &TabOrderOpV1::Swap {
                a: "6key".to_string(),
                b: "8key".to_string(),
            },
        );

        assert!(error.is_none());
        assert!(changed);
        assert_eq!(snapshot.tab_order, ["4key", "5key", "8key", "6key"]);
    }

    #[test]
    fn reorder_unknown_tab_repairs_noncanonical_metadata() {
        let mut store = crate::state::migration::normalize_state(AppStoreData::default());
        store.tab_order = ["4key", "unknown", "4key", "5key"]
            .map(str::to_string)
            .to_vec();
        store.bar_count = 9;

        let (snapshot, error, changed) = reorder_tab_metadata(
            &mut store,
            &TabOrderOpV1::Swap {
                a: "missing".to_string(),
                b: "5key".to_string(),
            },
        );

        assert_eq!(error.as_deref(), Some("unknown-tab"));
        assert!(changed);
        assert_eq!(snapshot.tab_order, ["4key", "5key", "6key", "8key"]);
        assert_eq!(snapshot.bar_count, 4);
        assert_eq!(store.tab_order, snapshot.tab_order);
        assert_eq!(store.bar_count, snapshot.bar_count);
        assert!(reorder_change_payload(&snapshot, changed).is_some());
    }

    #[test]
    fn reorder_same_tab_repairs_noncanonical_metadata() {
        let mut store = crate::state::migration::normalize_state(AppStoreData::default());
        store.tab_order = ["4key", "unknown", "4key", "5key"]
            .map(str::to_string)
            .to_vec();
        store.bar_count = 9;

        let (snapshot, error, changed) = reorder_tab_metadata(
            &mut store,
            &TabOrderOpV1::Swap {
                a: "4key".to_string(),
                b: "4key".to_string(),
            },
        );

        assert!(error.is_none());
        assert!(changed);
        assert_eq!(snapshot.tab_order, ["4key", "5key", "6key", "8key"]);
        assert_eq!(snapshot.bar_count, 4);
        assert_eq!(store.tab_order, snapshot.tab_order);
        assert_eq!(store.bar_count, snapshot.bar_count);
        assert!(reorder_change_payload(&snapshot, changed).is_some());
    }

    #[test]
    fn reorder_rejects_each_missing_operand_with_current_snapshot() {
        for op in [
            TabOrderOpV1::Swap {
                a: "missing".to_string(),
                b: "5key".to_string(),
            },
            TabOrderOpV1::Swap {
                a: "4key".to_string(),
                b: "missing".to_string(),
            },
        ] {
            let mut store = crate::state::migration::normalize_state(AppStoreData::default());
            let before = store.clone();

            let (snapshot, error, changed) = reorder_tab_metadata(&mut store, &op);

            assert_eq!(error.as_deref(), Some("unknown-tab"));
            assert!(!changed);
            assert_eq!(snapshot.custom_tabs, before.custom_tabs);
            assert_eq!(snapshot.tab_order, before.tab_order);
            assert_eq!(snapshot.bar_count, before.bar_count);
            assert_eq!(snapshot.selected_key_type, before.selected_key_type);
            assert_eq!(store, before);
        }
    }

    #[test]
    fn reorder_same_tab_is_a_no_op() {
        let mut store = crate::state::migration::normalize_state(AppStoreData::default());
        let before = store.clone();

        let (snapshot, error, changed) = reorder_tab_metadata(
            &mut store,
            &TabOrderOpV1::Swap {
                a: "4key".to_string(),
                b: "4key".to_string(),
            },
        );

        assert!(error.is_none());
        assert!(!changed);
        assert_eq!(snapshot.tab_order, before.tab_order);
        assert_eq!(store, before);
    }

    #[test]
    fn reorder_true_no_op_preserves_history_events_and_store() {
        let directory = tempfile::tempdir().unwrap();
        let store = AppStore::initialize_for_test(directory.path()).unwrap();
        let before = store.snapshot();
        let history_before = store.history_status();

        for (op, expected_error) in [
            (
                TabOrderOpV1::Swap {
                    a: "4key".to_string(),
                    b: "4key".to_string(),
                },
                None,
            ),
            (
                TabOrderOpV1::Swap {
                    a: "missing".to_string(),
                    b: "5key".to_string(),
                },
                Some("unknown-tab"),
            ),
        ] {
            let transaction = store
                .commit_aux_editor_transaction(
                    HistoryScope::CustomTabs,
                    None,
                    EditorCommitOrigin::LegacyAdapter("tabs_reorder_test".to_string()),
                    &[],
                    |data| Ok(reorder_tab_metadata(data, &op)),
                )
                .unwrap();
            let (snapshot, error, changed) = &transaction.value;

            assert_eq!(error.as_deref(), expected_error);
            assert!(!changed);
            assert!(transaction.change.event.is_none());
            assert!(transaction.change.history_status.is_none());
            assert!(reorder_change_payload(snapshot, *changed).is_none());
            assert_eq!(store.snapshot(), before);
        }
        let history_after = store.history_status();
        assert_eq!(
            history_after.history_revision,
            history_before.history_revision
        );
        assert!(!history_after.can_undo);
        store.flush_and_shutdown().unwrap();
    }

    #[test]
    fn reorder_history_undo_restores_tab_order_and_bar_count_together() {
        let directory = tempfile::tempdir().unwrap();
        let tab_id = "reorder-tab".to_string();
        let mut data = crate::state::migration::normalize_state(AppStoreData::default());
        data.custom_tabs.push(CustomTab {
            id: tab_id.clone(),
            name: "Reorder".to_string(),
        });
        data.keys.insert(tab_id.clone(), Vec::new());
        data.key_positions.insert(tab_id.clone(), Vec::new());
        data.tab_order = ["4key", "5key", "6key", "8key", tab_id.as_str()]
            .map(str::to_string)
            .to_vec();
        data.bar_count = 2;
        crate::state::native_element_id::backfill_store_element_ids(&mut data);
        std::fs::write(
            directory.path().join("store.json"),
            serde_json::to_vec_pretty(&data).unwrap(),
        )
        .unwrap();
        let store = AppStore::initialize_for_test(directory.path()).unwrap();
        let before = store.snapshot();
        let reordered = [tab_id.as_str(), "5key", "6key", "8key", "4key"]
            .map(str::to_string)
            .to_vec();

        store
            .commit_aux_editor_transaction(
                HistoryScope::CustomTabs,
                None,
                EditorCommitOrigin::LegacyAdapter("tabs_reorder_test".to_string()),
                &[],
                |data| {
                    let (_, error, changed) = reorder_tab_metadata(
                        data,
                        &TabOrderOpV1::Swap {
                            a: "4key".to_string(),
                            b: tab_id.clone(),
                        },
                    );
                    assert!(error.is_none());
                    assert!(changed);
                    Ok(())
                },
            )
            .unwrap();
        assert_eq!(store.snapshot().tab_order, reordered);
        assert_eq!(store.snapshot().bar_count, 2);

        let operation_id = uuid::Uuid::new_v4().to_string();
        let gate = store.history_gate();
        let barrier = gate.close(&operation_id).unwrap();
        let counters = store.snapshot().key_counters;
        let undo = store
            .apply_history_operation(HistoryDirection::Undo, &operation_id, &counters, || {})
            .unwrap();
        drop(barrier);

        assert_eq!(store.snapshot().tab_order, before.tab_order);
        assert_eq!(store.snapshot().bar_count, before.bar_count);
        assert!(undo.status.can_redo);

        let operation_id = uuid::Uuid::new_v4().to_string();
        let barrier = gate.close(&operation_id).unwrap();
        let counters = store.snapshot().key_counters;
        let redo = store
            .apply_history_operation(HistoryDirection::Redo, &operation_id, &counters, || {})
            .unwrap();
        drop(barrier);

        assert_eq!(store.snapshot().tab_order, reordered);
        assert_eq!(store.snapshot().bar_count, 2);
        assert!(redo.status.can_undo);
        store.flush_and_shutdown().unwrap();
    }

    #[test]
    fn tab_order_op_rejects_unknown_kind_and_unknown_fields() {
        let unknown_kind = serde_json::from_value::<TabOrderOpV1>(serde_json::json!({
            "kind": "move",
            "a": "4key",
            "b": "5key"
        }));
        let unknown_field = serde_json::from_value::<TabOrderOpV1>(serde_json::json!({
            "kind": "swap",
            "a": "4key",
            "b": "5key",
            "extra": true
        }));

        assert!(unknown_kind.is_err());
        assert!(unknown_field.is_err());
    }

    #[test]
    fn reset_all_clears_knob_positions_and_zeroes_default_counters() {
        let mut store = populated_custom_tab_store();
        reset_all_editor_data(
            &mut store,
            default_keys(),
            default_positions(),
            default_stat_positions(),
        );

        assert!(store.knob_positions.is_empty());
        assert!(store.custom_tabs.is_empty());
        assert_eq!(store.selected_key_type, "4key");
        assert_eq!(store.stat_positions.len(), default_stat_positions().len());
        assert!(store
            .key_counters
            .values()
            .flat_map(|mode| mode.values())
            .all(|count| *count == 0));
    }

    #[test]
    fn reset_all_issues_a_fresh_globally_unique_id_generation_each_time() {
        let mut store = populated_custom_tab_store();
        reset_all_editor_data(
            &mut store,
            default_keys(),
            default_positions(),
            default_stat_positions(),
        );
        let first = store
            .key_positions
            .values()
            .flatten()
            .map(|position| position.id.clone())
            .collect::<HashSet<_>>();
        let first_count = store.key_positions.values().map(Vec::len).sum::<usize>();

        reset_all_editor_data(
            &mut store,
            default_keys(),
            default_positions(),
            default_stat_positions(),
        );
        let second = store
            .key_positions
            .values()
            .flatten()
            .map(|position| position.id.clone())
            .collect::<HashSet<_>>();

        assert_eq!(first.len(), first_count);
        assert_eq!(second.len(), first_count);
        assert!(first.is_disjoint(&second));
        assert!(second
            .iter()
            .all(|id| crate::state::native_element_id::is_valid_element_id(id)));
    }

    #[test]
    fn reset_all_migrates_default_data_url_images_immediately() {
        let dir = std::env::temp_dir().join(format!(
            "dmnote-reset-all-default-images-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let mut store = populated_custom_tab_store();

        reset_all_editor_data_with_images(
            &mut store,
            default_keys(),
            default_positions(),
            default_stat_positions(),
            &dir,
        );

        let positions = store
            .key_positions
            .values()
            .flatten()
            .chain(
                store
                    .stat_positions
                    .values()
                    .flatten()
                    .map(|stat| &stat.position),
            )
            .chain(
                store
                    .graph_positions
                    .values()
                    .flatten()
                    .map(|graph| &graph.position),
            )
            .chain(
                store
                    .knob_positions
                    .values()
                    .flatten()
                    .map(|knob| &knob.position),
            )
            .collect::<Vec<_>>();
        let image_paths = positions
            .iter()
            .flat_map(|position| [&position.active_image, &position.inactive_image])
            .flatten()
            .filter(|image| !image.is_empty())
            .collect::<Vec<_>>();
        assert!(!image_paths.is_empty());
        assert!(image_paths.iter().all(|image| !image.starts_with("data:")));
        assert!(image_paths
            .iter()
            .all(|image| std::path::Path::new(image.as_str()).is_file()));
        assert!(store.stat_positions.values().flatten().all(|stat| {
            crate::state::native_element_id::is_valid_element_id(&stat.position.id)
        }));

        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn custom_mode_reset_is_supported_and_preserves_tab_identity() {
        let mut store = populated_custom_tab_store();
        let tabs_before = store.custom_tabs.clone();
        let kind = reset_mode_kind(&store, TARGET_TAB);

        assert_eq!(kind, Some(ModeResetKind::Custom));
        reset_mode_data(&mut store, TARGET_TAB, kind.unwrap());

        assert_eq!(store.custom_tabs, tabs_before);
        assert!(store.keys[TARGET_TAB].is_empty());
        assert!(store.key_positions[TARGET_TAB].is_empty());
        assert!(store.stat_positions[TARGET_TAB].is_empty());
        assert!(store.graph_positions[TARGET_TAB].is_empty());
        assert!(store.knob_positions[TARGET_TAB].is_empty());
        assert!(!store.layer_groups.contains_key(TARGET_TAB));
        assert!(!store.tab_css_overrides.contains_key(TARGET_TAB));
        assert!(!store.tab_note_overrides.contains_key(TARGET_TAB));
        assert!(store.key_counters[TARGET_TAB].is_empty());
    }

    #[test]
    fn default_mode_reset_clears_knob_positions() {
        let mut store = AppStoreData::default();
        store.knob_positions.insert(
            "4key".to_string(),
            populated_custom_tab_store().knob_positions[TARGET_TAB].clone(),
        );

        reset_mode_data(&mut store, "4key", ModeResetKind::Default);

        assert!(store.knob_positions["4key"].is_empty());
        assert_eq!(
            store.stat_positions["4key"].len(),
            default_stat_positions()["4key"].len()
        );
    }

    #[test]
    fn ghost_mode_request_leaves_store_keyboard_and_events_unchanged() {
        let mut store = AppStoreData {
            selected_key_type: "8key".to_string(),
            ..AppStoreData::default()
        };
        store
            .keys
            .insert("ghost-mode".to_string(), vec![KeySlot::from("KeyA")]);
        let keyboard = KeyboardManager::new(store.keys.clone(), "8key");
        let commit_calls = Cell::new(0);
        let emit_calls = Cell::new(0);

        let response = set_mode_with(
            &store,
            "ghost-mode".to_string(),
            |candidate| {
                commit_calls.set(commit_calls.get() + 1);
                Ok(candidate)
            },
            |effective| {
                keyboard.set_mode(effective.to_string());
                emit_calls.set(emit_calls.get() + 1);
                Ok(())
            },
        )
        .unwrap();

        assert!(!response.success);
        assert_eq!(response.mode, "8key");
        assert_eq!(store.selected_key_type, "8key");
        assert_eq!(keyboard.current_mode(), "8key");
        assert_eq!(commit_calls.get(), 0);
        assert_eq!(emit_calls.get(), 0);
    }

    #[test]
    fn absent_mode_request_remains_a_no_op() {
        let store = AppStoreData {
            selected_key_type: "8key".to_string(),
            ..AppStoreData::default()
        };
        let keyboard = KeyboardManager::new(store.keys.clone(), "8key");
        let commit_calls = Cell::new(0);
        let emit_calls = Cell::new(0);

        let response = set_mode_with(
            &store,
            "missing-mode".to_string(),
            |candidate| {
                commit_calls.set(commit_calls.get() + 1);
                Ok(candidate)
            },
            |effective| {
                keyboard.set_mode(effective.to_string());
                emit_calls.set(emit_calls.get() + 1);
                Ok(())
            },
        )
        .unwrap();

        assert!(!response.success);
        assert_eq!(response.mode, "8key");
        assert_eq!(store.selected_key_type, "8key");
        assert_eq!(keyboard.current_mode(), "8key");
        assert_eq!(commit_calls.get(), 0);
        assert_eq!(emit_calls.get(), 0);
    }

    #[test]
    fn selection_after_concurrent_delete_uses_locked_store_state() {
        let stale_snapshot = populated_custom_tab_store();
        assert!(super::is_selectable_mode(&stale_snapshot, TARGET_TAB));

        let mut locked_store = stale_snapshot;
        let delete_plan = plan_custom_tab_delete(&locked_store, TARGET_TAB).unwrap();
        delete_custom_tab_data(&mut locked_store, TARGET_TAB, &delete_plan);
        let selected_after_delete = locked_store.selected_key_type.clone();

        let (success, selected) = select_mode_if_available(&mut locked_store, TARGET_TAB);

        assert!(!success);
        assert_eq!(selected, selected_after_delete);
        assert_eq!(locked_store.selected_key_type, selected_after_delete);
        assert!(!locked_store.keys.contains_key(TARGET_TAB));
    }

    #[test]
    fn reset_mode_with_changed_keys_preserves_other_live_mode_counters() {
        let directory = tempfile::tempdir().unwrap();
        let store = AppStore::initialize_for_test(directory.path()).unwrap();
        store
            .update(|data| data.key_counter_enabled = true)
            .unwrap();
        let customized = store
            .commit_legacy_editor_transaction(
                EditorCommitOrigin::LegacyAdapter("reset-test-setup".to_string()),
                &[EditorField::Keys, EditorField::KeyPositions],
                |data| {
                    data.keys.get_mut("4key").unwrap()[0] = KeySlot::from("QA RESET KEY");
                    Ok(())
                },
            )
            .unwrap();
        drop(customized);
        let state = AppState::initialize(store).unwrap();
        let emitter = NoopCounterEmitter;
        let reset_mode = "4key";
        let reset_key = state.store.snapshot().keys[reset_mode][0].canonical();
        let preserved_mode = "5key";
        let preserved_key = state.store.snapshot().keys[preserved_mode][0].canonical();
        for expected in 1..=3 {
            assert_eq!(
                state.increment_key_counter_and_emit(&emitter, reset_mode, &reset_key),
                Some(expected)
            );
        }
        for expected in 1..=7 {
            assert_eq!(
                state.increment_key_counter_and_emit(&emitter, preserved_mode, &preserved_key),
                Some(expected)
            );
        }
        assert_eq!(
            state.store.snapshot().key_counters[preserved_mode][&preserved_key],
            0
        );

        let admission = state.store.admit_editor_mutation().unwrap();
        let (transaction, key_runtime_applied) = state
            .commit_legacy_editor_reset_preserving_runtime_counters(
                &emitter,
                EditorCommitOrigin::LegacyAdapter("keys_reset_mode".to_string()),
                &[
                    EditorField::Keys,
                    EditorField::KeyPositions,
                    EditorField::StatPositions,
                    EditorField::GraphPositions,
                    EditorField::KnobPositions,
                    EditorField::LayerGroups,
                ],
                PluginInstancesResetScope::Mode(reset_mode.to_string()),
                admission,
                |data| {
                    reset_mode_data_with_images(
                        data,
                        reset_mode,
                        ModeResetKind::Default,
                        directory.path(),
                    );
                    Ok(())
                },
            )
            .unwrap();
        assert!(key_runtime_applied);
        assert!(transaction
            .change
            .result
            .changed_fields
            .contains(&EditorField::Keys));

        assert_eq!(
            state.snapshot_key_counters()[preserved_mode][&preserved_key],
            7
        );
        assert!(state.snapshot_key_counters()[reset_mode]
            .values()
            .all(|count| *count == 0));
        assert_eq!(
            state.store.snapshot().key_counters[preserved_mode][&preserved_key],
            7
        );
        state.shutdown();
    }

    #[test]
    fn reset_mode_with_default_keys_applies_counter_only_reset_to_runtime() {
        let directory = tempfile::tempdir().unwrap();
        let store = AppStore::initialize_for_test(directory.path()).unwrap();
        store
            .update(|data| data.key_counter_enabled = true)
            .unwrap();
        let state = AppState::initialize(store).unwrap();
        let emitter = NoopCounterEmitter;
        let mode = "4key";
        let key = state.store.snapshot().keys[mode][0].canonical();
        for expected in 1..=7 {
            assert_eq!(
                state.increment_key_counter_and_emit(&emitter, mode, &key),
                Some(expected)
            );
        }
        assert_eq!(state.store.snapshot().key_counters[mode][&key], 0);
        let generation_before = state.store.runtime_publication_generation();

        let admission = state.store.admit_editor_mutation().unwrap();
        let (transaction, key_runtime_applied) = state
            .commit_legacy_editor_reset_preserving_runtime_counters(
                &emitter,
                EditorCommitOrigin::LegacyAdapter("keys_reset_mode".to_string()),
                &[
                    EditorField::Keys,
                    EditorField::KeyPositions,
                    EditorField::StatPositions,
                    EditorField::GraphPositions,
                    EditorField::KnobPositions,
                    EditorField::LayerGroups,
                ],
                PluginInstancesResetScope::Mode(mode.to_string()),
                admission,
                |data| {
                    reset_mode_data_with_images(
                        data,
                        mode,
                        ModeResetKind::Default,
                        directory.path(),
                    );
                    Ok(())
                },
            )
            .unwrap();
        assert!(key_runtime_applied);
        assert!(!transaction
            .change
            .result
            .changed_fields
            .contains(&EditorField::Keys));
        assert!(transaction.change.runtime_publication_generation > generation_before);

        assert_eq!(state.snapshot_key_counters()[mode][&key], 0);
        assert_eq!(state.store.snapshot().key_counters[mode][&key], 0);
        state.shutdown();
    }

    #[test]
    fn reset_mode_replays_queued_increment_for_unchanged_mapping() {
        let directory = tempfile::tempdir().unwrap();
        let store = AppStore::initialize_for_test(directory.path()).unwrap();
        store
            .update(|data| data.key_counter_enabled = true)
            .unwrap();
        let state = AppState::initialize(store).unwrap();
        let emitter = NoopCounterEmitter;
        let reset_mode = "4key";
        let reset_key = state.store.snapshot().keys[reset_mode][0].canonical();
        let preserved_mode = "5key";
        let preserved_key = state.store.snapshot().keys[preserved_mode][0].canonical();
        for expected in 1..=3 {
            assert_eq!(
                state.increment_key_counter_and_emit(&emitter, reset_mode, &reset_key),
                Some(expected)
            );
        }
        for expected in 1..=7 {
            assert_eq!(
                state.increment_key_counter_and_emit(&emitter, preserved_mode, &preserved_key),
                Some(expected)
            );
        }

        let admission = state.store.admit_editor_mutation().unwrap();
        let (_, key_runtime_applied) = state
            .commit_legacy_editor_reset_preserving_runtime_counters(
                &emitter,
                EditorCommitOrigin::LegacyAdapter("keys_reset_mode".to_string()),
                &[
                    EditorField::Keys,
                    EditorField::KeyPositions,
                    EditorField::StatPositions,
                    EditorField::GraphPositions,
                    EditorField::KnobPositions,
                    EditorField::LayerGroups,
                ],
                PluginInstancesResetScope::Mode(reset_mode.to_string()),
                admission,
                |data| {
                    assert_eq!(
                        state.increment_key_counter_and_emit(&emitter, reset_mode, &reset_key,),
                        None
                    );
                    reset_mode_data_with_images(
                        data,
                        reset_mode,
                        ModeResetKind::Default,
                        directory.path(),
                    );
                    Ok(())
                },
            )
            .unwrap();

        assert!(key_runtime_applied);
        assert_eq!(state.snapshot_key_counters()[reset_mode][&reset_key], 1);
        assert_eq!(
            state.snapshot_key_counters()[preserved_mode][&preserved_key],
            7
        );
        assert_eq!(
            state.store.snapshot().key_counters[reset_mode][&reset_key],
            0
        );
        assert_eq!(
            state.store.snapshot().key_counters[preserved_mode][&preserved_key],
            7
        );
        state.shutdown();
    }

    #[test]
    fn reset_mode_drops_queued_increment_for_replaced_key() {
        let directory = tempfile::tempdir().unwrap();
        let store = AppStore::initialize_for_test(directory.path()).unwrap();
        store
            .update(|data| data.key_counter_enabled = true)
            .unwrap();
        let mode = "4key";
        let replaced_key = "QA REPLACED KEY";
        let setup = store
            .commit_legacy_editor_transaction(
                EditorCommitOrigin::LegacyAdapter("reset-queue-test-setup".to_string()),
                &[EditorField::Keys, EditorField::KeyPositions],
                |data| {
                    data.keys.get_mut(mode).unwrap()[0] = KeySlot::from(replaced_key);
                    Ok(())
                },
            )
            .unwrap();
        drop(setup);
        let state = AppState::initialize(store).unwrap();
        let emitter = NoopCounterEmitter;

        let admission = state.store.admit_editor_mutation().unwrap();
        let (_, key_runtime_applied) = state
            .commit_legacy_editor_reset_preserving_runtime_counters(
                &emitter,
                EditorCommitOrigin::LegacyAdapter("keys_reset_mode".to_string()),
                &[
                    EditorField::Keys,
                    EditorField::KeyPositions,
                    EditorField::StatPositions,
                    EditorField::GraphPositions,
                    EditorField::KnobPositions,
                    EditorField::LayerGroups,
                ],
                PluginInstancesResetScope::Mode(mode.to_string()),
                admission,
                |data| {
                    assert_eq!(
                        state.increment_key_counter_and_emit(&emitter, mode, replaced_key),
                        None
                    );
                    reset_mode_data_with_images(
                        data,
                        mode,
                        ModeResetKind::Default,
                        directory.path(),
                    );
                    Ok(())
                },
            )
            .unwrap();

        assert!(key_runtime_applied);
        assert!(!state.snapshot_key_counters()[mode].contains_key(replaced_key));
        assert!(!state.store.snapshot().key_counters[mode].contains_key(replaced_key));
        state.shutdown();
        drop(state);
        let reloaded = AppStore::initialize_for_test(directory.path()).unwrap();
        assert!(!reloaded.snapshot().key_counters[mode].contains_key(replaced_key));
        reloaded.flush_and_shutdown().unwrap();
    }

    #[test]
    fn reset_all_drops_queued_increment_for_removed_custom_mode() {
        let directory = tempfile::tempdir().unwrap();
        let store = AppStore::initialize_for_test(directory.path()).unwrap();
        store
            .update(|data| data.key_counter_enabled = true)
            .unwrap();
        let mode = "qa-removed-custom-mode";
        let key = "QA REMOVED KEY";
        let mut position = default_positions()["4key"][0].clone();
        position.id = uuid::Uuid::new_v4().to_string();
        let setup = store
            .commit_legacy_editor_transaction(
                EditorCommitOrigin::LegacyAdapter("reset-queue-test-setup".to_string()),
                &[EditorField::Keys, EditorField::KeyPositions],
                |data| {
                    data.custom_tabs.push(CustomTab {
                        id: mode.to_string(),
                        name: "Removed during reset".to_string(),
                    });
                    data.keys.insert(mode.to_string(), vec![KeySlot::from(key)]);
                    data.key_positions.insert(mode.to_string(), vec![position]);
                    data.selected_key_type = mode.to_string();
                    Ok(())
                },
            )
            .unwrap();
        drop(setup);
        let state = AppState::initialize(store).unwrap();
        let emitter = NoopCounterEmitter;

        let admission = state.store.admit_editor_mutation().unwrap();
        let (_, key_runtime_applied) = state
            .commit_legacy_editor_reset_preserving_runtime_counters(
                &emitter,
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
                |data| {
                    assert_eq!(
                        state.increment_key_counter_and_emit(&emitter, mode, key),
                        None
                    );
                    reset_all_editor_data_with_images(
                        data,
                        default_keys(),
                        default_positions(),
                        default_stat_positions(),
                        directory.path(),
                    );
                    Ok(())
                },
            )
            .unwrap();

        assert!(key_runtime_applied);
        assert!(!state.snapshot_key_counters().contains_key(mode));
        assert!(!state.store.snapshot().key_counters.contains_key(mode));
        state.shutdown();
        drop(state);
        let reloaded = AppStore::initialize_for_test(directory.path()).unwrap();
        assert!(!reloaded.snapshot().key_counters.contains_key(mode));
        reloaded.flush_and_shutdown().unwrap();
    }

    #[test]
    fn reset_all_with_default_keys_applies_counter_only_reset_to_runtime() {
        let directory = tempfile::tempdir().unwrap();
        let store = AppStore::initialize_for_test(directory.path()).unwrap();
        store
            .update(|data| data.key_counter_enabled = true)
            .unwrap();
        let state = AppState::initialize(store).unwrap();
        let emitter = NoopCounterEmitter;
        let mode = "4key";
        let key = state.store.snapshot().keys[mode][0].canonical();
        for expected in 1..=7 {
            assert_eq!(
                state.increment_key_counter_and_emit(&emitter, mode, &key),
                Some(expected)
            );
        }
        assert_eq!(state.store.snapshot().key_counters[mode][&key], 0);
        let generation_before = state.store.runtime_publication_generation();

        let admission = state.store.admit_editor_mutation().unwrap();
        let (transaction, key_runtime_applied) = state
            .commit_legacy_editor_reset_preserving_runtime_counters(
                &emitter,
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
                |data| {
                    reset_all_editor_data_with_images(
                        data,
                        default_keys(),
                        default_positions(),
                        default_stat_positions(),
                        directory.path(),
                    );
                    Ok(())
                },
            )
            .unwrap();
        assert!(key_runtime_applied);
        assert!(!transaction
            .change
            .result
            .changed_fields
            .contains(&EditorField::Keys));
        assert!(transaction.change.runtime_publication_generation > generation_before);

        assert_eq!(state.snapshot_key_counters()[mode][&key], 0);
        assert!(state
            .store
            .snapshot()
            .key_counters
            .values()
            .flat_map(|counters| counters.values())
            .all(|count| *count == 0));
        state.shutdown();
    }

    #[test]
    fn reset_all_with_changed_keys_zeroes_every_live_counter() {
        let directory = tempfile::tempdir().unwrap();
        let store = AppStore::initialize_for_test(directory.path()).unwrap();
        store
            .update(|data| data.key_counter_enabled = true)
            .unwrap();
        let customized = store
            .commit_legacy_editor_transaction(
                EditorCommitOrigin::LegacyAdapter("reset-all-test-setup".to_string()),
                &[EditorField::Keys, EditorField::KeyPositions],
                |data| {
                    data.keys.get_mut("4key").unwrap()[0] = KeySlot::from("QA RESET ALL KEY");
                    Ok(())
                },
            )
            .unwrap();
        drop(customized);
        let state = AppState::initialize(store).unwrap();
        let emitter = NoopCounterEmitter;
        for mode in ["4key", "5key"] {
            let key = state.store.snapshot().keys[mode][0].canonical();
            for expected in 1..=7 {
                assert_eq!(
                    state.increment_key_counter_and_emit(&emitter, mode, &key),
                    Some(expected)
                );
            }
        }

        let admission = state.store.admit_editor_mutation().unwrap();
        let (transaction, key_runtime_applied) = state
            .commit_legacy_editor_reset_preserving_runtime_counters(
                &emitter,
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
                |data| {
                    reset_all_editor_data_with_images(
                        data,
                        default_keys(),
                        default_positions(),
                        default_stat_positions(),
                        directory.path(),
                    );
                    Ok(())
                },
            )
            .unwrap();

        assert!(key_runtime_applied);
        assert!(transaction
            .change
            .result
            .changed_fields
            .contains(&EditorField::Keys));
        assert_eq!(transaction.change.document.keys, *default_keys());
        assert!(state
            .snapshot_key_counters()
            .values()
            .flat_map(|counters| counters.values())
            .all(|count| *count == 0));
        assert!(state
            .store
            .snapshot()
            .key_counters
            .values()
            .flat_map(|counters| counters.values())
            .all(|count| *count == 0));
        state.shutdown();
    }
}
