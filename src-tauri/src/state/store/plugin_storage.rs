use super::*;

impl AppStore {
    pub(crate) fn plugin_instances_get(
        &self,
        plugin_id: &str,
    ) -> std::result::Result<(Vec<SavedPluginInstance>, u64), String> {
        validate_plugin_id(plugin_id)?;
        let guard = self.state.read();
        let key = plugin_instances_storage_key(plugin_id);
        let instances = decode_plugin_instances_lenient(guard.data.plugin_data.get(&key), &key)
            .unwrap_or_default();
        Ok((instances, guard.plugin_model_revision))
    }

    // 전 플러그인 저장 인스턴스의 그룹 참조를 pluginId 구분 유지로 수집 - 미로드
    // 플러그인 포함. 순회·관대 decode 규칙은 for_each_stored_plugin_instances가
    // 단일 소스 (병합 소비가 플러그인 단위라 수집 형태만 다름)
    pub(crate) fn plugin_group_refs_by_plugin(&self) -> (HashMap<String, PluginGroupRefs>, u64) {
        let guard = self.state.read();
        let mut refs_by_plugin: HashMap<String, PluginGroupRefs> = HashMap::new();
        for_each_stored_plugin_instances(&guard.data, |plugin_id, instances| {
            let mut refs = PluginGroupRefs::new();
            add_plugin_group_refs(&mut refs, &instances);
            if !refs.is_empty() {
                refs_by_plugin.insert(plugin_id.to_string(), refs);
            }
        });
        (refs_by_plugin, guard.plugin_model_revision)
    }

    #[cfg(test)]
    pub(crate) fn commit_plugin_instances(
        &self,
        request: PluginInstancesCommitRequest,
    ) -> std::result::Result<AdmittedPluginInstancesCommit, String> {
        let admission = self.history_gate.admit_mutation()?;
        self.commit_plugin_instances_with_admission(request, admission)
    }

    pub(crate) fn commit_plugin_instances_with_admission(
        &self,
        request: PluginInstancesCommitRequest,
        admission: HistoryAdmissionLease,
    ) -> std::result::Result<AdmittedPluginInstancesCommit, String> {
        validate_plugin_instances_request(&request)?;
        let outcome = self.commit_plugin_instances_admitted(request, &admission)?;
        Ok(AdmittedPluginInstancesCommit {
            outcome,
            _admission: admission,
        })
    }

    fn commit_plugin_instances_admitted(
        &self,
        request: PluginInstancesCommitRequest,
        admission: &HistoryAdmissionLease,
    ) -> std::result::Result<PluginInstancesCommitOutcome, String> {
        let mut guard = self.lock_for_update().map_err(|error| error.to_string())?;
        admission.revalidate_for(&self.history_gate)?;

        if request
            .observed_history_epoch
            .is_some_and(|epoch| epoch != guard.history.history_epoch())
        {
            return Err("HISTORY_EPOCH_CONFLICT".to_string());
        }
        if request
            .expected_model_revision
            .is_some_and(|revision| revision != guard.plugin_model_revision)
        {
            return Err("PLUGIN_MODEL_REVISION_CONFLICT".to_string());
        }

        let current_snapshot = plugin_elements_snapshot(&guard.data, &request.plugin_id)?;
        self.apply_plugin_instances_mutation_locked(
            &mut guard,
            current_snapshot,
            PluginInstancesMutationInput {
                plugin_id: request.plugin_id,
                instances: request.instances,
                gesture_id: request.gesture_id,
            },
        )
    }

    #[cfg(test)]
    pub(crate) fn reconcile_plugin_instances(
        &self,
        request: PluginInstancesReconcileRequest,
    ) -> std::result::Result<AdmittedPluginInstancesCommit, String> {
        let admission = self.history_gate.admit_mutation()?;
        self.reconcile_plugin_instances_with_admission(request, admission)
    }

    pub(crate) fn reconcile_plugin_instances_with_admission(
        &self,
        request: PluginInstancesReconcileRequest,
        admission: HistoryAdmissionLease,
    ) -> std::result::Result<AdmittedPluginInstancesCommit, String> {
        validate_plugin_instances_reconcile_request(&request)?;
        let outcome = self.reconcile_plugin_instances_admitted(request, &admission)?;
        Ok(AdmittedPluginInstancesCommit {
            outcome,
            _admission: admission,
        })
    }

    fn reconcile_plugin_instances_admitted(
        &self,
        request: PluginInstancesReconcileRequest,
        admission: &HistoryAdmissionLease,
    ) -> std::result::Result<PluginInstancesCommitOutcome, String> {
        let mut guard = self.lock_for_update().map_err(|error| error.to_string())?;
        admission.revalidate_for(&self.history_gate)?;

        if request
            .observed_history_epoch
            .is_some_and(|epoch| epoch != guard.history.history_epoch())
        {
            return Err("HISTORY_EPOCH_CONFLICT".to_string());
        }

        let current_snapshot = plugin_elements_snapshot(&guard.data, &request.plugin_id)?;
        let valid_tab_ids = request.valid_tab_ids.into_iter().collect::<HashSet<_>>();
        let mut reconciled = current_snapshot.instances.clone().unwrap_or_default();
        reconciled.retain_mut(|instance| {
            let tab_id = normalize_plugin_instance_tab_id(instance.tab_id.as_deref()).to_string();
            if !valid_tab_ids.contains(&tab_id) {
                return false;
            }
            instance.tab_id = Some(tab_id);
            true
        });

        self.apply_plugin_instances_mutation_locked(
            &mut guard,
            current_snapshot,
            PluginInstancesMutationInput {
                plugin_id: request.plugin_id,
                instances: reconciled,
                gesture_id: None,
            },
        )
    }

    fn apply_plugin_instances_mutation_locked(
        &self,
        guard: &mut VersionedStoreState,
        current_snapshot: PluginElementsHistorySnapshot,
        mutation: PluginInstancesMutationInput,
    ) -> std::result::Result<PluginInstancesCommitOutcome, String> {
        let current_instances = current_snapshot.instances.clone().unwrap_or_default();
        validate_plugin_instances_transition(&current_instances, &mutation.instances)?;
        if current_instances == mutation.instances {
            return Ok(PluginInstancesCommitOutcome {
                plugin_id: mutation.plugin_id,
                model_revision: guard.plugin_model_revision,
                changed: false,
                history_status: None,
            });
        }

        let history_plan = guard
            .history
            .prepare_plugin_elements_entry(current_snapshot, mutation.gesture_id)?;
        let mut scratch = guard.data.clone();
        let canonical = PluginElementsHistorySnapshot {
            plugin_id: mutation.plugin_id.clone(),
            instances: (!mutation.instances.is_empty()).then_some(mutation.instances),
        };
        apply_plugin_elements_snapshot(&mut scratch, &canonical)?;
        let plugin_model_revision = next_plugin_model_revision(guard.plugin_model_revision)?;
        self.commit_locked(guard, scratch, ())
            .map_err(|error| error.to_string())?;
        guard.plugin_model_revision = plugin_model_revision;
        guard
            .history
            .apply_plugin_elements_record_plan(history_plan, &canonical);
        let history_status = Some(guard.history.issue_status(self.history_gate.is_closed()));

        Ok(PluginInstancesCommitOutcome {
            plugin_id: mutation.plugin_id,
            model_revision: plugin_model_revision,
            changed: true,
            history_status,
        })
    }

    // 플러그인 데이터 관련 메서드
    pub fn get_plugin_data(&self, key: &str) -> Result<Option<Value>> {
        let guard = self.state.read();
        Ok(guard.data.plugin_data.get(key).cloned())
    }

    #[cfg(test)]
    pub(crate) fn set_plugin_data(
        &self,
        key: &str,
        value: Value,
    ) -> Result<AdmittedPluginStorageMutation<()>> {
        let admission = self
            .history_gate
            .admit_mutation()
            .map_err(anyhow::Error::msg)?;
        self.set_plugin_data_with_admission(key, value, admission)
    }

    pub(crate) fn set_plugin_data_with_admission(
        &self,
        key: &str,
        value: Value,
        admission: HistoryAdmissionLease,
    ) -> Result<AdmittedPluginStorageMutation<()>> {
        // canonical 배치 버킷은 revision·history·이벤트를 우회하는 일반 storage 경로로
        // 쓰거나 지울 수 없다 (namespace 전체 clear만 배치를 함께 지운다)
        if is_plugin_instances_storage_key(key) {
            return Err(anyhow!("PLUGIN_INSTANCES_KEY_RESERVED"));
        }
        let mut guard = self.lock_for_update()?;
        admission
            .revalidate_for(&self.history_gate)
            .map_err(anyhow::Error::msg)?;
        if guard.data.plugin_data.get(key) == Some(&value) {
            return Ok(AdmittedPluginStorageMutation {
                value: (),
                history_status: None,
                plugin_instances_changes: Vec::new(),
                _admission: admission,
            });
        }
        let mut scratch = guard.data.clone();
        scratch.plugin_data.insert(key.to_string(), value);
        self.commit_locked(&mut guard, scratch, ())?;
        Ok(AdmittedPluginStorageMutation {
            value: (),
            history_status: None,
            plugin_instances_changes: Vec::new(),
            _admission: admission,
        })
    }

    #[cfg(test)]
    pub(crate) fn remove_plugin_data(
        &self,
        key: &str,
    ) -> Result<AdmittedPluginStorageMutation<()>> {
        let admission = self
            .history_gate
            .admit_mutation()
            .map_err(anyhow::Error::msg)?;
        self.remove_plugin_data_with_admission(key, admission)
    }

    pub(crate) fn remove_plugin_data_with_admission(
        &self,
        key: &str,
        admission: HistoryAdmissionLease,
    ) -> Result<AdmittedPluginStorageMutation<()>> {
        if is_plugin_instances_storage_key(key) {
            return Err(anyhow!("PLUGIN_INSTANCES_KEY_RESERVED"));
        }
        let mut guard = self.lock_for_update()?;
        admission
            .revalidate_for(&self.history_gate)
            .map_err(anyhow::Error::msg)?;
        if !guard.data.plugin_data.contains_key(key) {
            return Ok(AdmittedPluginStorageMutation {
                value: (),
                history_status: None,
                plugin_instances_changes: Vec::new(),
                _admission: admission,
            });
        }
        let mut scratch = guard.data.clone();
        scratch.plugin_data.remove(key);
        self.commit_locked(&mut guard, scratch, ())?;
        Ok(AdmittedPluginStorageMutation {
            value: (),
            history_status: None,
            plugin_instances_changes: Vec::new(),
            _admission: admission,
        })
    }

    #[cfg(test)]
    pub(crate) fn clear_all_plugin_data(&self) -> Result<AdmittedPluginStorageMutation<()>> {
        let admission = self
            .history_gate
            .admit_mutation()
            .map_err(anyhow::Error::msg)?;
        self.clear_all_plugin_data_with_admission(admission)
    }

    pub(crate) fn clear_all_plugin_data_with_admission(
        &self,
        admission: HistoryAdmissionLease,
    ) -> Result<AdmittedPluginStorageMutation<()>> {
        let mut guard = self.lock_for_update()?;
        admission
            .revalidate_for(&self.history_gate)
            .map_err(anyhow::Error::msg)?;
        let plugin_history_exists = guard.history.contains_plugin_elements_for(None);
        if guard.data.plugin_data.is_empty() {
            let history_status = (plugin_history_exists && guard.history.invalidate_all())
                .then(|| guard.history.issue_status(self.history_gate.is_closed()));
            return Ok(AdmittedPluginStorageMutation {
                value: (),
                history_status,
                plugin_instances_changes: Vec::new(),
                _admission: admission,
            });
        }
        let mut scratch = guard.data.clone();
        let affected_plugin_ids =
            collect_plugin_instance_ids(scratch.plugin_data.keys().map(String::as_str));
        let instance_data_changed = !affected_plugin_ids.is_empty();
        let next_model_revision = instance_data_changed
            .then(|| next_plugin_model_revision(guard.plugin_model_revision))
            .transpose()
            .map_err(anyhow::Error::msg)?;
        scratch.plugin_data.clear();
        self.commit_locked(&mut guard, scratch, ())?;
        if let Some(revision) = next_model_revision {
            guard.plugin_model_revision = revision;
        }
        let history_status = ((instance_data_changed || plugin_history_exists)
            && guard.history.invalidate_all())
        .then(|| guard.history.issue_status(self.history_gate.is_closed()));
        let plugin_instances_changes = next_model_revision
            .map(|revision| {
                affected_plugin_ids
                    .into_iter()
                    .map(|plugin_id| PluginInstancesStorageChange {
                        plugin_id,
                        revision,
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok(AdmittedPluginStorageMutation {
            value: (),
            history_status,
            plugin_instances_changes,
            _admission: admission,
        })
    }

    pub fn get_all_plugin_keys(&self) -> Result<Vec<String>> {
        let guard = self.state.read();
        Ok(guard.data.plugin_data.keys().cloned().collect())
    }

    #[cfg(test)]
    pub(crate) fn remove_plugin_data_by_prefix(
        &self,
        prefix: &str,
    ) -> Result<AdmittedPluginStorageMutation<usize>> {
        let admission = self
            .history_gate
            .admit_mutation()
            .map_err(anyhow::Error::msg)?;
        self.remove_plugin_data_by_prefix_with_admission(prefix, admission)
    }

    pub(crate) fn remove_plugin_data_by_prefix_with_admission(
        &self,
        prefix: &str,
        admission: HistoryAdmissionLease,
    ) -> Result<AdmittedPluginStorageMutation<usize>> {
        let mut guard = self.lock_for_update()?;
        admission
            .revalidate_for(&self.history_gate)
            .map_err(anyhow::Error::msg)?;
        let namespace_plugin_id = plugin_id_from_storage_namespace_prefix(prefix);
        let plugin_history_exists = namespace_plugin_id
            .is_some_and(|plugin_id| guard.history.contains_plugin_elements_for(Some(plugin_id)));
        // 공개 storage의 개별 키는 canonical 배치와 독립이다. 다만 플러그인
        // 전체 namespace clear는 1.6.1의 "모든 데이터 삭제" 계약대로 내부
        // 배치도 함께 지운다. cache/ 같은 하위 prefix에는 적용하지 않음
        let canonical_instances_key = namespace_plugin_id.map(plugin_instances_storage_key);
        let keys = guard
            .data
            .plugin_data
            .keys()
            .filter(|key| {
                key.starts_with(prefix)
                    || canonical_instances_key
                        .as_ref()
                        .is_some_and(|canonical| *key == canonical)
            })
            .cloned()
            .collect::<Vec<_>>();
        if keys.is_empty() {
            let history_status = (plugin_history_exists && guard.history.invalidate_all())
                .then(|| guard.history.issue_status(self.history_gate.is_closed()));
            return Ok(AdmittedPluginStorageMutation {
                value: 0,
                history_status,
                plugin_instances_changes: Vec::new(),
                _admission: admission,
            });
        }
        let affected_plugin_ids = collect_plugin_instance_ids(keys.iter().map(String::as_str));
        let instance_data_changed = !affected_plugin_ids.is_empty();
        let next_model_revision = instance_data_changed
            .then(|| next_plugin_model_revision(guard.plugin_model_revision))
            .transpose()
            .map_err(anyhow::Error::msg)?;
        let mut scratch = guard.data.clone();
        for key in &keys {
            scratch.plugin_data.remove(key);
        }
        self.commit_locked(&mut guard, scratch, ())?;
        if let Some(revision) = next_model_revision {
            guard.plugin_model_revision = revision;
        }
        let history_status = ((instance_data_changed || plugin_history_exists)
            && guard.history.invalidate_all())
        .then(|| guard.history.issue_status(self.history_gate.is_closed()));
        let plugin_instances_changes = next_model_revision
            .map(|revision| {
                affected_plugin_ids
                    .into_iter()
                    .map(|plugin_id| PluginInstancesStorageChange {
                        plugin_id,
                        revision,
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok(AdmittedPluginStorageMutation {
            value: keys.len(),
            history_status,
            plugin_instances_changes,
            _admission: admission,
        })
    }
}
