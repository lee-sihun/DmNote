use super::*;

pub(super) fn audio_thread(
    receiver: Receiver<AudioCommand>,
    state: Arc<RwLock<KeySoundRuntimeState>>,
    fallback_callback: Arc<
        dyn Fn(KeySoundOutputBackend, KeySoundOutputBackend) + Send + Sync + 'static,
    >,
) {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        use thread_priority::{set_current_thread_priority, ThreadPriority};
        let _ = set_current_thread_priority(ThreadPriority::Max);
    }

    let mut enabled = state.read().status.enabled;
    let mut volume = state.read().status.volume;
    let mut soundpack = state.read().soundpack.clone();
    #[cfg(debug_assertions)]
    let mut latency_logging = state.read().status.latency_logging;
    let mut requested_backend = state.read().output_state.requested.clone();
    let mut stream_handler = None;
    let output_state = open_initial_output_backend(
        requested_backend.clone(),
        &mut stream_handler,
        fallback_callback.as_ref(),
    );
    requested_backend = output_state.requested.clone();
    state.write().output_state = output_state;
    let mut file_cache: HashMap<String, Arc<CachedAudioClip>> = HashMap::new();
    #[cfg(debug_assertions)]
    let mut latency_summary = LatencySummary::default();

    while let Ok(command) = receiver.recv() {
        match command {
            AudioCommand::SetEnabled(value) => {
                enabled = value;
            }
            AudioCommand::SetVolume(value) => {
                volume = value;
            }
            AudioCommand::SetLatencyLogging(value) => {
                #[cfg(debug_assertions)]
                {
                    latency_logging = value;
                }
                #[cfg(not(debug_assertions))]
                {
                    let _ = value;
                }
            }
            AudioCommand::SetSoundpack(pack) => {
                soundpack = pack;
            }
            AudioCommand::InvalidateFileCache { path } => {
                file_cache.remove(&path);
            }
            AudioCommand::SetOutputBackend { backend, reply } => {
                let output_state = switch_output_backend(backend, &mut stream_handler);
                requested_backend = output_state.requested.clone();
                state.write().output_state = output_state.clone();
                let _ = reply.send(output_state);
            }
            AudioCommand::PlayLabels {
                labels,
                queued_at,
                trace,
            } => {
                if !enabled {
                    continue;
                }
                let Some(pack) = soundpack.as_ref() else {
                    continue;
                };
                #[cfg(debug_assertions)]
                let audio_started_at = latency_logging.then_some(Instant::now());
                let Some(source) = pack.source_for_labels(&labels) else {
                    continue;
                };
                #[cfg(not(debug_assertions))]
                let _ = (queued_at, trace);

                #[cfg(debug_assertions)]
                let play_started_at = latency_logging.then_some(Instant::now());
                if !play_on_stream(
                    &mut stream_handler,
                    source,
                    volume,
                    &mut requested_backend,
                    &state,
                    fallback_callback.as_ref(),
                ) {
                    continue;
                }
                #[cfg(debug_assertions)]
                {
                    let play_ms = play_started_at
                        .map(|started| started.elapsed().as_secs_f64() * 1000.0)
                        .unwrap_or(0.0);
                    if latency_logging {
                        let queue_ms = queued_at.elapsed().as_secs_f64() * 1000.0;
                        let dispatch_ms =
                            trace.map(KeySoundDispatchTrace::dispatch_ms).unwrap_or(0.0);
                        let thread_ms = audio_started_at
                            .map(|started| started.elapsed().as_secs_f64() * 1000.0)
                            .unwrap_or(0.0);
                        let total_ms = trace
                            .map(KeySoundDispatchTrace::total_elapsed_ms)
                            .unwrap_or(dispatch_ms + queue_ms + thread_ms);
                        debug!(
                            "[KeySound][Latency] route=soundpack dispatchMs={dispatch_ms:.3} queueMs={queue_ms:.3} playMs={play_ms:.3} threadMs={thread_ms:.3} totalMs={total_ms:.3} labels={labels:?}"
                        );
                        latency_summary.push(
                            LatencySample {
                                dispatch_ms,
                                queue_ms,
                                play_ms,
                                thread_ms,
                                total_ms,
                                ..Default::default()
                            },
                            false,
                        );
                        if latency_summary.should_emit_summary() {
                            latency_summary.emit_summary();
                        }
                    }
                }
            }
            AudioCommand::PlayFile {
                path,
                per_key_volume,
                queued_at,
                trace,
            } => {
                if !enabled {
                    continue;
                }
                #[cfg(debug_assertions)]
                let audio_started_at = latency_logging.then_some(Instant::now());
                #[cfg(not(debug_assertions))]
                let _ = (queued_at, trace);

                #[cfg(debug_assertions)]
                let clip_lookup_started_at = latency_logging.then_some(Instant::now());
                let (clip, clip_load_trace) =
                    match get_or_load_cached_clip(&path, &mut file_cache, {
                        #[cfg(debug_assertions)]
                        {
                            latency_logging
                        }
                        #[cfg(not(debug_assertions))]
                        {
                            false
                        }
                    }) {
                        Some(result) => result,
                        None => continue,
                    };
                #[cfg(debug_assertions)]
                let cache_lookup_ms = clip_lookup_started_at
                    .map(|started| started.elapsed().as_secs_f64() * 1000.0)
                    .unwrap_or(0.0);
                #[cfg(not(debug_assertions))]
                let _ = clip_load_trace;

                let final_volume = (volume * per_key_volume).clamp(0.0, 2.0);
                let source =
                    AudioSource::new(clip.samples.clone(), clip.channels, clip.sample_rate);

                #[cfg(debug_assertions)]
                let play_started_at = latency_logging.then_some(Instant::now());
                if !play_on_stream(
                    &mut stream_handler,
                    source,
                    final_volume,
                    &mut requested_backend,
                    &state,
                    fallback_callback.as_ref(),
                ) {
                    continue;
                }
                #[cfg(debug_assertions)]
                {
                    let play_ms = play_started_at
                        .map(|started| started.elapsed().as_secs_f64() * 1000.0)
                        .unwrap_or(0.0);
                    if latency_logging {
                        let queue_ms = queued_at.elapsed().as_secs_f64() * 1000.0;
                        let dispatch_ms =
                            trace.map(KeySoundDispatchTrace::dispatch_ms).unwrap_or(0.0);
                        let thread_ms = audio_started_at
                            .map(|started| started.elapsed().as_secs_f64() * 1000.0)
                            .unwrap_or(0.0);
                        let total_ms = trace
                            .map(KeySoundDispatchTrace::total_elapsed_ms)
                            .unwrap_or(dispatch_ms + queue_ms + thread_ms);
                        let cache_label = if clip_load_trace.cache_hit {
                            "hit"
                        } else {
                            "miss"
                        };
                        debug!(
                            "[KeySound][Latency] route=key-file dispatchMs={dispatch_ms:.3} queueMs={queue_ms:.3} cacheLookupMs={cache_lookup_ms:.3} decodeMs={:.3} playMs={play_ms:.3} threadMs={thread_ms:.3} totalMs={total_ms:.3} cache={} volume={final_volume:.3} path={path}",
                            clip_load_trace.decode_ms,
                            cache_label
                        );
                        latency_summary.push(
                            LatencySample {
                                dispatch_ms,
                                queue_ms,
                                cache_lookup_ms,
                                decode_ms: clip_load_trace.decode_ms,
                                play_ms,
                                thread_ms,
                                total_ms,
                            },
                            !clip_load_trace.cache_hit,
                        );
                        if latency_summary.should_emit_summary() {
                            latency_summary.emit_summary();
                        }
                    }
                }
            }
        }
    }
}
