use super::*;

impl AppState {
    /// Subscribe to raw input stream (increment subscriber count)
    pub fn subscribe_raw_input(&self) -> u32 {
        self.raw_input_subscribers.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Unsubscribe from raw input stream (decrement subscriber count)
    pub fn unsubscribe_raw_input(&self) -> u32 {
        let prev = self.raw_input_subscribers.fetch_sub(1, Ordering::SeqCst);
        if prev == 0 {
            // 언더플로우 방지
            self.raw_input_subscribers.store(0, Ordering::SeqCst);
            0
        } else {
            prev - 1
        }
    }

    /// Get current raw input subscriber count
    pub fn raw_input_subscriber_count(&self) -> u32 {
        self.raw_input_subscribers.load(Ordering::Relaxed)
    }

    pub fn key_sound_status(&self) -> KeySoundStatus {
        self.key_sound.status()
    }

    pub fn key_sound_set_enabled(&self, enabled: bool) -> KeySoundStatus {
        self.key_sound.set_enabled(enabled)
    }

    pub fn key_sound_set_volume(&self, volume: f32) -> KeySoundStatus {
        self.key_sound.set_volume(volume)
    }

    pub fn key_sound_set_latency_logging(&self, enabled: bool) -> KeySoundStatus {
        self.key_sound.set_latency_logging(enabled)
    }

    pub fn key_sound_list_output_devices(&self) -> KeySoundOutputDevices {
        self.key_sound.list_output_devices()
    }

    pub fn key_sound_set_output_backend(
        &self,
        backend: KeySoundOutputBackend,
    ) -> Result<KeySoundOutputState> {
        let _persistence_guard = self.key_sound_output_persistence_lock.lock();
        // 셧다운 뒤 요청은 장치를 열기 전에 거절 (persist 단계의 turn 검사와 동일 조건)
        self.ensure_mutation_allowed().map_err(anyhow::Error::msg)?;
        self.key_sound_output_generation
            .fetch_add(1, Ordering::AcqRel);
        // 장치 열기는 번호표 밖에서 기다린다 - turn 안에서 기다리면 드라이버가 멈춘 동안
        // 뒤 번호표(저장·커밋) 전부가 정지한다. 엔진 콜백은 저장 스레드만 생성하므로
        // 동기 대기 중 교착 없음
        let output_state = self.key_sound.set_output_backend(backend);
        let requested = output_state.requested.clone();
        // 잠금 순서: persistence_lock → 번호표. 번호표 보유자는 이 잠금을 잡지 않고
        // fallback persist 스레드는 잠금만 잡고 번호표는 잡지 않으므로 역순이 없다.
        // 잠금을 든 채 번호표를 받아야 겹친 요청의 엔진 전환 순서와 persist 순서가 일치한다
        let ticket = self
            .issue_mutation_publication()
            .map_err(anyhow::Error::msg)?;
        ticket.run(|| {
            self.ensure_mutation_allowed().map_err(anyhow::Error::msg)?;
            self.store.update(|state| {
                state.key_sound_output_backend = Some(output_backend_to_persist(requested));
            })
        })?;
        Ok(output_state)
    }

    pub fn key_sound_get_output_state(&self) -> KeySoundOutputState {
        self.key_sound.output_state()
    }

    pub fn key_sound_latency_logging_available(&self) -> bool {
        self.key_sound.latency_logging_available()
    }

    pub fn key_sound_load_soundpack(&self, soundpack_dir: &str) -> Result<KeySoundStatus, String> {
        self.key_sound
            .load_soundpack_dir(soundpack_dir)
            .map_err(|err| err.to_string())
    }

    pub fn key_sound_unload_soundpack(&self) -> KeySoundStatus {
        self.key_sound.unload_soundpack()
    }

    pub fn key_sound_invalidate_file_cache(&self, path: &str) {
        self.key_sound.invalidate_file_cache(path);
    }

    pub(crate) fn publish_committed_key_sound_bindings(
        &self,
        change: &CommittedEditorChange,
    ) -> bool {
        if !change
            .result
            .changed_fields
            .contains(&crate::models::EditorField::KeyPositions)
        {
            return false;
        }

        let bindings = Arc::new(build_key_sound_binding_table(
            &change.document.key_positions,
        ));
        let mut publication = self.runtime_publication.lock();
        if change.runtime_publication_generation < publication.key_sound_bindings_generation {
            return false;
        }
        *self.key_sound_bindings.write() = bindings;
        publication.key_sound_bindings_generation = change.runtime_publication_generation;
        true
    }

    pub(super) fn resolve_key_sound_binding(
        &self,
        mode: &str,
        slot_indices: &[usize],
    ) -> Option<(String, f32)> {
        let bindings = Arc::clone(&self.key_sound_bindings.read());
        let mode_bindings = bindings.get(mode)?;

        slot_indices.iter().find_map(|index| {
            mode_bindings
                .get(*index)
                .and_then(Option::as_ref)
                .map(|binding| (binding.sound_path.clone(), binding.per_key_volume))
        })
    }
}
