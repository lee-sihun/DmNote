use super::*;

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
    if name.trim().is_empty() {
        return Ok(CustomTabCreateResult {
            result: None,
            error: Some("invalid-name".to_string()),
        });
    }

    let trimmed = name.trim().to_string();
    let id = generate_custom_tab_id();
    let tab = CustomTab {
        id: id.clone(),
        name: trimmed,
    };
    run_history_mutation(
        app,
        window.label().to_string(),
        move |app, state, admission| {
            custom_tabs_create_inner(state, app, id, tab, observed_history_epoch, admission)
        },
    )
    .await
}

fn custom_tabs_create_inner(
    state: &AppState,
    app: &AppHandle,
    id: String,
    tab: CustomTab,
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
                        if store
                            .custom_tabs
                            .iter()
                            .any(|existing| existing.name == tab.name)
                        {
                            return Ok(Err("duplicate-name".to_string()));
                        }
                        if store.custom_tabs.len() >= MAX_CUSTOM_TABS {
                            return Ok(Err("max-reached".to_string()));
                        }
                        store.custom_tabs.push(tab.clone());
                        store.keys.insert(id.clone(), Vec::new());
                        store.key_positions.insert(id.clone(), Vec::new());
                        store.selected_key_type = id.clone();
                        Ok(Ok((tab.clone(), store.custom_tabs.clone())))
                    },
                )
        })?;
    let (tab, custom_tabs) = match transaction.value {
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
            selected_key_type: id.clone(),
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
                            store.selected_key_type.clone(),
                            store.tab_note_overrides.clone(),
                        )))
                    },
                )
        })?;
    let (custom_tabs, selected_key_type, tab_note_overrides) = match transaction.value {
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
            selected_key_type: selected_key_type.clone(),
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
                        validate_history_restore_metadata(
                            &EditorDocumentV1::from_store(store),
                            &custom_tabs,
                            &selected_key_type,
                        )?;
                        store.custom_tabs = custom_tabs;
                        store.selected_key_type = selected_key_type;
                        Ok((store.custom_tabs.clone(), store.selected_key_type.clone()))
                    },
                )
        })?;
    let (custom_tabs, selected_key_type) = transaction.value;

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
            selected_key_type: selected_key_type.clone(),
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
