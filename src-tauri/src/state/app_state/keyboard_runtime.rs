use super::*;

pub(super) const MAX_INPUT_EVENT_AGE_MS: f64 = 10_000.0;
pub(super) const KEYBOARD_DAEMON_STABLE_RUNTIME: Duration = Duration::from_secs(30);
pub(super) const KEYBOARD_RECOVERY_DELAYS_MS: [u64; 5] = [250, 500, 1_000, 2_000, 4_000];

#[derive(Debug, Clone, PartialEq)]
pub(super) struct KeySoundBinding {
    pub(super) sound_path: String,
    pub(super) per_key_volume: f32,
}

pub(super) type KeySoundBindingTable = HashMap<String, Vec<Option<KeySoundBinding>>>;

pub(super) fn build_key_sound_binding_table(key_positions: &KeyPositions) -> KeySoundBindingTable {
    key_positions
        .iter()
        .map(|(mode, positions)| {
            let bindings = positions
                .iter()
                .map(|position| {
                    if !position.sound_enabled.unwrap_or(false) {
                        return None;
                    }
                    let sound_path = position.sound_path.as_deref()?.trim();
                    if sound_path.is_empty() {
                        return None;
                    }
                    let volume_percent = position.sound_volume.unwrap_or(100.0);
                    Some(KeySoundBinding {
                        sound_path: sound_path.to_string(),
                        per_key_volume: (volume_percent / 100.0).clamp(0.0, 2.0) as f32,
                    })
                })
                .collect();
            (mode.clone(), bindings)
        })
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct KeyboardRecoveryPlan {
    pub(super) attempt: usize,
    pub(super) delay: Duration,
}

pub(super) fn bootstrap_keyboard_state(keyboard: &KeyboardManager) -> (String, Vec<String>) {
    keyboard.current_mode_and_pressed_keys()
}

pub(super) fn unix_epoch_ms() -> Option<f64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs_f64() * 1000.0)
}

pub(super) fn resolve_event_age_ms(
    input_ts_ms: Option<f64>,
    now_wall_ms: Option<f64>,
    fallback_age_ms: f64,
) -> f64 {
    let Some(event_age_ms) = input_ts_ms
        .zip(now_wall_ms)
        .map(|(input_ts_ms, now_wall_ms)| now_wall_ms - input_ts_ms)
    else {
        return fallback_age_ms;
    };
    if event_age_ms.is_finite() && (0.0..=MAX_INPUT_EVENT_AGE_MS).contains(&event_age_ms) {
        event_age_ms
    } else {
        fallback_age_ms
    }
}

pub(super) fn next_keyboard_recovery_plan(
    current_attempt: usize,
    daemon_uptime: Duration,
) -> Option<KeyboardRecoveryPlan> {
    let attempt = if daemon_uptime >= KEYBOARD_DAEMON_STABLE_RUNTIME {
        1
    } else {
        current_attempt.saturating_add(1)
    };
    let delay_ms = *KEYBOARD_RECOVERY_DELAYS_MS.get(attempt.checked_sub(1)?)?;
    Some(KeyboardRecoveryPlan {
        attempt,
        delay: Duration::from_millis(delay_ms),
    })
}

pub(super) fn should_recover_keyboard_daemon(
    shutdown_started: bool,
    current_generation: u64,
    task_generation: Option<u64>,
    failed_generation: u64,
) -> bool {
    !shutdown_started
        && current_generation == failed_generation
        && task_generation == Some(failed_generation)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct KeyStatePayload<'a> {
    key: &'a str,
    state: &'a str,
    mode: &'a str,
    event_age_ms: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    hold_duration_ms: Option<f64>,
}

pub(super) fn key_state_payload<'a>(
    key: &'a str,
    state: &'a str,
    mode: &'a str,
    event_age_ms: f64,
    is_down: bool,
    hold_duration_ms: Option<f64>,
) -> KeyStatePayload<'a> {
    KeyStatePayload {
        key,
        state,
        mode,
        event_age_ms,
        hold_duration_ms: if is_down { None } else { hold_duration_ms },
    }
}

pub(super) fn canonical_hold_duration_ms(
    can_use_physical_hold_duration: bool,
    physical_hold_duration_ms: Option<f64>,
) -> Option<f64> {
    if can_use_physical_hold_duration {
        physical_hold_duration_ms
    } else {
        None
    }
}

pub(super) struct KeyboardDaemonTask {
    pub(super) generation: u64,
    pub(super) running: Arc<AtomicBool>,
    pub(super) reader_handle: Option<JoinHandle<()>>,
    pub(super) stderr_handle: Option<JoinHandle<()>>,
    pub(super) parent_stdin: Option<ChildStdin>,
    pub(super) child: Option<Child>,
}

impl Drop for KeyboardDaemonTask {
    fn drop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        self.parent_stdin.take();

        if let Some(child) = self.child.as_mut() {
            if let Err(err) = child.kill() {
                if err.kind() != std::io::ErrorKind::InvalidInput {
                    warn!("failed to kill keyboard daemon: {err}");
                }
            }
            let _ = child.wait();
        }

        if let Some(handle) = self.reader_handle.take() {
            let _ = handle.join();
        }
        if let Some(handle) = self.stderr_handle.take() {
            let _ = handle.join();
        }
    }
}
