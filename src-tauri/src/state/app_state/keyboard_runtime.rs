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

impl AppState {
    pub fn start_keyboard_hook(&self, app: AppHandle) -> Result<()> {
        let mut task_guard = self.keyboard_task.write();
        if task_guard.is_some() {
            return Ok(());
        }
        self.start_keyboard_hook_locked(app, &mut task_guard, 0, None)
    }

    fn start_keyboard_hook_locked(
        &self,
        app: AppHandle,
        task_slot: &mut Option<KeyboardDaemonTask>,
        recovery_attempt: usize,
        expected_generation: Option<u64>,
    ) -> Result<()> {
        if self.shutdown_started.load(Ordering::SeqCst) {
            return Ok(());
        }

        let generation = if let Some(expected_generation) = expected_generation {
            let next_generation = expected_generation.wrapping_add(1);
            if self
                .keyboard_task_generation
                .compare_exchange(
                    expected_generation,
                    next_generation,
                    Ordering::SeqCst,
                    Ordering::SeqCst,
                )
                .is_err()
            {
                return Ok(());
            }
            next_generation
        } else {
            self.keyboard_task_generation
                .fetch_add(1, Ordering::SeqCst)
                .wrapping_add(1)
        };

        self.reset_keyboard_hook_state(&app);

        let daemon_started_at = Instant::now();

        let current_exe = std::env::current_exe().context("failed to locate dm-note executable")?;
        let shortcuts_json = serde_json::to_string(&self.store.settings_snapshot().shortcuts)
            .unwrap_or_else(|_| "{}".to_string());

        // Named Pipe 서버를 비동기로 준비 (daemon 스폰 전 블로킹 방지)
        #[cfg(target_os = "windows")]
        let pipe_receiver: Option<std::sync::mpsc::Receiver<Option<std::fs::File>>> = {
            use std::sync::mpsc;
            let (tx, rx) = mpsc::channel();
            std::thread::spawn(
                move || match crate::ipc::pipe_server_create("dmnote_keys_v1") {
                    Ok(f) => {
                        let _ = tx.send(Some(f));
                    }
                    Err(err) => {
                        warn!("failed to create named pipe: {err}");
                        let _ = tx.send(None);
                    }
                },
            );
            Some(rx)
        };
        #[cfg(not(target_os = "windows"))]
        let _pipe_receiver: Option<std::sync::mpsc::Receiver<Option<std::fs::File>>> = None;
        let mut child = Command::new(current_exe)
            .arg("--keyboard-daemon")
            .env("DMNOTE_HOTKEYS_V1", shortcuts_json)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("failed to spawn keyboard daemon process")?;

        let parent_stdin = child
            .stdin
            .take()
            .context("keyboard daemon stdin unavailable")?;
        let stdout = child
            .stdout
            .take()
            .context("keyboard daemon stdout unavailable")?;
        let stderr = child.stderr.take();

        let running = Arc::new(AtomicBool::new(true));
        let running_reader = running.clone();
        let keyboard = self.keyboard.clone();
        let app_handle = app.clone();

        let reader_handle = thread::Builder::new()
            .name("keyboard-daemon-reader".into())
            .spawn(move || {
            let mut keys_state_emit_count: u64 = 0;
                // Named Pipe 우선 사용; 불가 시 stdout fallback
                #[allow(unused_mut)]
                let mut reader: BufReader<Box<dyn std::io::Read + Send>> = {
                    #[cfg(target_os = "windows")]
                    {
                        if let Some(rx) = pipe_receiver {
                            // Pipe 준비 대기; 타임아웃 시 stdout fallback
                            match rx.recv_timeout(Duration::from_millis(1500)) {
                                Ok(Some(f)) => BufReader::new(Box::new(f)),
                                _ => BufReader::new(Box::new(stdout)),
                            }
                        } else {
                            BufReader::new(Box::new(stdout))
                        }
                    }
                    #[cfg(not(target_os = "windows"))]
                    {
                        BufReader::new(Box::new(stdout))
                    }
                };
                // Windows에서 reader 스레드 우선순위 약간 상향
                #[cfg(target_os = "windows")]
                unsafe {
                    use windows::Win32::System::Threading::{GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_ABOVE_NORMAL};
                    let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_ABOVE_NORMAL);
                }

                let mut exit_reason = None;
                while running_reader.load(Ordering::SeqCst) {
                    let mut line = String::new();
                    match reader.read_line(&mut line) {
                        Ok(0) => {
                            exit_reason = Some(String::from("output EOF"));
                            break;
                        }
                        Ok(_) => {
                            let s = line.trim();
                            if s.is_empty() {
                                continue;
                            }

                            // DaemonCommand(글로벌 단축키) 파싱 우선 시도
                            if let Ok(command) = serde_json::from_str::<crate::ipc::DaemonCommand>(s) {
                                match command {
                                    crate::ipc::DaemonCommand::ToggleOverlay => {
                                        log::info!("[AppState] received ToggleOverlay command from daemon");
                                        let app_state = app_handle.state::<AppState>();
                                        if app_state.is_obs_mode_active() {
                                            log::info!("[AppState] OBS 모드 활성화 중 — 오버레이 토글 무시");
                                        } else {
                                        let is_visible = *app_state.overlay_visible.read();
                                        if let Err(err) = app_state.set_overlay_visibility(&app_handle, !is_visible) {
                                            log::error!("failed to toggle overlay visibility: {err}");
                                        }
                                        }
                                    }
                                    crate::ipc::DaemonCommand::ToggleOverlayLock => {
                                        log::info!("[AppState] received ToggleOverlayLock command from daemon");
                                        let app_state = app_handle.state::<AppState>();
                                        let current = app_state.store.snapshot().overlay_locked;
                                        match app_state.settings.apply_patch(crate::models::SettingsPatchInput {
                                            overlay_locked: Some(!current),
                                            ..Default::default()
                                        }) {
                                            Ok(diff) => {
                                                if let Err(err) = app_state.emit_settings_changed(&diff, &app_handle) {
                                                    log::error!("failed to apply overlay lock toggle: {err}");
                                                }
                                            }
                                            Err(err) => log::error!("failed to toggle overlay lock: {err}"),
                                        }
                                    }
                                    crate::ipc::DaemonCommand::ToggleAlwaysOnTop => {
                                        log::info!("[AppState] received ToggleAlwaysOnTop command from daemon");
                                        let app_state = app_handle.state::<AppState>();
                                        let current = app_state.store.snapshot().always_on_top;
                                        match app_state.settings.apply_patch(crate::models::SettingsPatchInput {
                                            always_on_top: Some(!current),
                                            ..Default::default()
                                        }) {
                                            Ok(diff) => {
                                                if let Err(err) = app_state.emit_settings_changed(&diff, &app_handle) {
                                                    log::error!("failed to apply always-on-top toggle: {err}");
                                                }
                                            }
                                            Err(err) => log::error!("failed to toggle always-on-top: {err}"),
                                        }
                                    }
                                }
                                continue;
                            }

                            // HID 축(노브) 메시지 → input:axis 이벤트 브로드캐스트
                            // (버튼은 아래 HookMessage 경로로 기존 키 시각화 재사용)
                            if let Ok(axis) =
                                serde_json::from_str::<crate::ipc::HidAxisMessage>(s)
                            {
                                publish_event(
                                    &app_handle,
                                    "input:axis",
                                    InputAxisPayload {
                                        axis_id: &axis.axis_id,
                                        value: axis.value,
                                        full: axis.full,
                                    },
                                );
                                continue;
                            }

                            // 입력 수신 시각 — 노트 위치의 프레임 양자화 보정용 age 측정 기준
                            let recv_at = Instant::now();

                            // 우선 형식: JSON 인코딩된 HookMessage (device 포함)
                            let parsed: Option<crate::ipc::HookMessage> =
                                serde_json::from_str(s).ok();

                            let message = if let Some(msg) = parsed {
                                if msg.labels.is_empty() {
                                    continue;
                                }
                                msg
                            } else {
                                // 레거시 간소 형식: "D:<label>" / "U:<label>"
                                if s.len() < 3
                                    || !s.as_bytes().get(1).map(|c| *c == b':').unwrap_or(false)
                                {
                                    continue;
                                }
                                let (state_ch, rest) = s.split_at(1);
                                let key = &rest[1..];
                                if key.is_empty() {
                                    continue;
                                }
                                crate::ipc::HookMessage {
                                    device: crate::ipc::InputDeviceKind::Keyboard,
                                    labels: vec![key.to_string()],
                                    state: if state_ch == "D" {
                                        crate::ipc::HookKeyState::Down
                                    } else {
                                        crate::ipc::HookKeyState::Up
                                    },
                                    physical_id: None,
                                    vk_code: None,
                                    scan_code: None,
                                    flags: None,
                                    hold_duration_ms: None,
                                    input_ts_ms: None,
                                }
                            };

                            let device_str = match message.device {
                                crate::ipc::InputDeviceKind::Keyboard => "keyboard",
                                crate::ipc::InputDeviceKind::Mouse => "mouse",
                                crate::ipc::InputDeviceKind::Gamepad => "gamepad",
                                crate::ipc::InputDeviceKind::Unknown => "unknown",
                            };
                            let state = match message.state {
                                crate::ipc::HookKeyState::Down => "DOWN",
                                crate::ipc::HookKeyState::Up => "UP",
                            };
                            let primary_label =
                                message.labels.first().map(String::as_str).unwrap_or("");

                            // 구독자가 있을 때만 raw input 스트림 emit
                            let app_state = app_handle.state::<AppState>();
                            if app_state.raw_input_subscriber_count() > 0 {
                                publish_event(
                                    &app_handle,
                                    "input:raw",
                                    RawInputPayload {
                                        label: primary_label,
                                        labels: &message.labels,
                                        state,
                                        device: device_str,
                                    },
                                );
                            }

                            let is_down = state == "DOWN";
                            let Some(outcome) = keyboard.match_and_register(
                                message.physical_id.as_deref(),
                                message.device,
                                message.labels.iter().map(String::as_str),
                                is_down,
                            ) else {
                                continue;
                            };

                            if let Some(pressed_label) = outcome.pressed_label.as_ref() {
                                publish_event(
                                    &app_handle,
                                    "input:press",
                                    InputPressPayload {
                                        label: pressed_label,
                                        mode: &outcome.mode,
                                    },
                                );
                            }

                            let fallback_age_ms = recv_at.elapsed().as_secs_f64() * 1000.0;
                            let event_age_ms = resolve_event_age_ms(
                                message.input_ts_ms,
                                unix_epoch_ms(),
                                fallback_age_ms,
                            );

                            // 키음은 물리 다운당 1회: press 기여 슬롯을 병합해
                            // 사운드 활성 첫 슬롯 설정 사용 (오디오 중첩 방지)
                            if is_down && message.device == crate::ipc::InputDeviceKind::Keyboard {
                                if let Some((_sound_canonical, sound_slot_indices)) =
                                    crate::keyboard::manager::collect_sound_dispatch(&outcome.events)
                                {
                                    if let Some((sound_path, per_key_volume)) = app_state
                                        .resolve_key_sound_binding(
                                            &outcome.mode,
                                            &sound_slot_indices,
                                        )
                                    {
                                        #[cfg(debug_assertions)]
                                        let key_sound_input_started_at = Instant::now();
                                        #[cfg(debug_assertions)]
                                        let key_sound_dispatch_started_at = Instant::now();
                                        #[cfg(debug_assertions)]
                                        let dispatch_ms = key_sound_dispatch_started_at
                                            .elapsed()
                                            .as_secs_f64()
                                            * 1000.0;
                                        #[cfg(debug_assertions)]
                                        let trace = KeySoundDispatchTrace::new(
                                            key_sound_input_started_at,
                                            dispatch_ms,
                                        );
                                        app_state.key_sound.play_file(
                                            &sound_path,
                                            per_key_volume,
                                            #[cfg(debug_assertions)]
                                            Some(trace),
                                            #[cfg(not(debug_assertions))]
                                            None,
                                        );
                                        #[cfg(debug_assertions)]
                                        if app_state.key_sound.latency_logging_enabled() {
                                            log::debug!(
                                                "[KeySound][Latency] route=dispatch dispatchMs={dispatch_ms:.3} mode={} key={} volume={:.3} path={}",
                                                outcome.mode,
                                                _sound_canonical,
                                                per_key_volume,
                                                sound_path
                                            );
                                        }
                                    } else {
                                        #[cfg(debug_assertions)]
                                        let key_sound_input_started_at = Instant::now();
                                        #[cfg(debug_assertions)]
                                        let key_sound_dispatch_started_at = Instant::now();
                                        #[cfg(debug_assertions)]
                                        let dispatch_ms = key_sound_dispatch_started_at
                                            .elapsed()
                                            .as_secs_f64()
                                            * 1000.0;
                                        #[cfg(debug_assertions)]
                                        let trace = KeySoundDispatchTrace::new(
                                            key_sound_input_started_at,
                                            dispatch_ms,
                                        );
                                        app_state.key_sound.play_labels(
                                            &message.labels,
                                            #[cfg(debug_assertions)]
                                            Some(trace),
                                            #[cfg(not(debug_assertions))]
                                            None,
                                        );
                                        #[cfg(debug_assertions)]
                                        if app_state.key_sound.latency_logging_enabled() {
                                            log::debug!(
                                                "[KeySound][Latency] route=dispatch dispatchMs={dispatch_ms:.3} mode={} key={} source=soundpack",
                                                outcome.mode,
                                                _sound_canonical
                                            );
                                        }
                                    }
                                }
                            }

                            for slot_event in outcome.events {
                                if slot_event.press && is_down {
                                    app_state.increment_key_counter_and_emit(
                                        &app_handle,
                                        &outcome.mode,
                                        &slot_event.canonical,
                                    );
                                }

                                let Some(is_active) = slot_event.transition else {
                                    continue;
                                };
                                let transition_state = if is_active { "DOWN" } else { "UP" };
                                let payload = key_state_payload(
                                    &slot_event.canonical,
                                    transition_state,
                                    &outcome.mode,
                                    event_age_ms,
                                    is_active,
                                    canonical_hold_duration_ms(
                                        slot_event.can_use_physical_hold_duration,
                                        message.hold_duration_ms,
                                    ),
                                );

                                publish_event(&app_handle, "keys:state", payload);
                                keys_state_emit_count += 1;
                                if keys_state_emit_count.is_multiple_of(500) {
                                    log::debug!(
                                        "[AppState] emitted keys:state {} times (last key={}, state={})",
                                        keys_state_emit_count,
                                        slot_event.canonical,
                                        transition_state
                                    );
                                }
                            }
                        }
                        Err(err) => {
                            if err.kind() == std::io::ErrorKind::Interrupted
                                || err.kind() == std::io::ErrorKind::WouldBlock
                            {
                                continue;
                            }
                            exit_reason = Some(format!("output read failed: {err}"));
                            break;
                        }
                    }
                }
                if running_reader.load(Ordering::SeqCst) {
                    let exit_reason =
                        exit_reason.unwrap_or_else(|| String::from("reader loop stopped"));
                    let daemon_uptime = daemon_started_at.elapsed();
                    let recovery_plan =
                        next_keyboard_recovery_plan(recovery_attempt, daemon_uptime);
                    if let Some(plan) = recovery_plan {
                        warn!(
                            "keyboard daemon ended unexpectedly ({exit_reason}); scheduling recovery attempt {}/{} in {} ms",
                            plan.attempt,
                            KEYBOARD_RECOVERY_DELAYS_MS.len(),
                            plan.delay.as_millis()
                        );
                    } else {
                        error!(
                            "keyboard daemon ended unexpectedly ({exit_reason}); automatic recovery limit reached after {recovery_attempt} attempts"
                        );
                    }
                    AppState::schedule_keyboard_hook_recovery(
                        app_handle,
                        generation,
                        recovery_plan,
                    );
                }
            })
            .map_err(|err| anyhow!("failed to spawn keyboard daemon reader: {err}"))?;

        let stderr_handle = if let Some(stderr) = stderr {
            match thread::Builder::new()
                .name("keyboard-daemon-stderr".into())
                .spawn(move || {
                    let reader = BufReader::new(stderr);
                    for line in reader.lines() {
                        match line {
                            Ok(text) if !text.trim().is_empty() => {
                                warn!("keyboard-daemon stderr: {text}");
                            }
                            Ok(_) => {}
                            Err(err) => {
                                error!("error reading keyboard daemon stderr: {err}");
                                break;
                            }
                        }
                    }
                }) {
                Ok(handle) => Some(handle),
                Err(err) => {
                    warn!("failed to spawn keyboard daemon stderr reader: {err}");
                    None
                }
            }
        } else {
            None
        };

        *task_slot = Some(KeyboardDaemonTask {
            generation,
            running,
            reader_handle: Some(reader_handle),
            stderr_handle,
            parent_stdin: Some(parent_stdin),
            child: Some(child),
        });
        Ok(())
    }

    fn schedule_keyboard_hook_recovery(
        app: AppHandle,
        failed_generation: u64,
        plan: Option<KeyboardRecoveryPlan>,
    ) {
        let fallback_app = app.clone();
        let spawn_result = thread::Builder::new()
            .name("keyboard-daemon-supervisor".into())
            .spawn(move || {
                if let Some(plan) = plan {
                    thread::sleep(plan.delay);
                }
                let app_state = app.state::<AppState>();
                let mut task_guard = app_state.keyboard_task.write();
                let task_generation = task_guard.as_ref().map(|task| task.generation);
                if !should_recover_keyboard_daemon(
                    app_state.shutdown_started.load(Ordering::SeqCst),
                    app_state.keyboard_task_generation.load(Ordering::SeqCst),
                    task_generation,
                    failed_generation,
                ) {
                    log::debug!(
                        "keyboard daemon recovery canceled for generation {failed_generation}"
                    );
                    return;
                }

                let previous_task = task_guard.take();
                drop(previous_task);
                if let Some(plan) = plan {
                    if let Err(err) = app_state.start_keyboard_hook_locked(
                        app.clone(),
                        &mut task_guard,
                        plan.attempt,
                        Some(failed_generation),
                    ) {
                        error!(
                            "failed to recover keyboard daemon on attempt {}: {err:#}",
                            plan.attempt
                        );
                    }
                } else {
                    app_state.reset_keyboard_hook_state(&app);
                }
            });
        if let Err(err) = spawn_result {
            error!("failed to spawn keyboard daemon supervisor: {err}");
            fallback_app
                .state::<AppState>()
                .reset_keyboard_hook_state(&fallback_app);
        }
    }

    fn reset_keyboard_hook_state(&self, app: &AppHandle) {
        self.clear_active_keys();
        publish_event(app, "keys:reset", json!({ "reason": "hook_restart" }));
    }

    pub(super) fn restart_keyboard_hook(&self, app: AppHandle) -> Result<()> {
        self.keyboard_task_generation.fetch_add(1, Ordering::SeqCst);
        let mut task_guard = self.keyboard_task.write();
        let previous_task = task_guard.take();
        drop(previous_task);
        self.start_keyboard_hook_locked(app, &mut task_guard, 0, None)
    }
}
