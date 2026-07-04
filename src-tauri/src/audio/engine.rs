use std::{
    collections::HashMap,
    fs::File,
    io::ErrorKind,
    num::NonZero,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, Sender},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
use std::{error::Error, fmt};

use anyhow::{Context, Result};
#[cfg(debug_assertions)]
use log::debug;
#[cfg(all(windows, feature = "asio-backend"))]
use log::info;
use log::warn;
use parking_lot::RwLock;
use rodio::{cpal, DeviceSinkBuilder, MixerDeviceSink, Source};
use serde::{Deserialize, Serialize};
use symphonia::{
    core::{
        audio::SampleBuffer,
        codecs::Decoder,
        errors::Error as SymphoniaError,
        formats::{FormatOptions, FormatReader, SeekMode, SeekTo},
        io::MediaSourceStream,
        probe::Hint,
        units::TimeBase,
    },
    default::{get_codecs, get_probe},
};

#[cfg(debug_assertions)]
const LATENCY_SUMMARY_INTERVAL: u64 = 50;

#[cfg(debug_assertions)]
fn latency_measurement_available() -> bool {
    true
}

#[cfg(not(debug_assertions))]
fn latency_measurement_available() -> bool {
    false
}

#[cfg(debug_assertions)]
#[derive(Debug, Clone, Copy)]
pub struct KeySoundDispatchTrace {
    input_started_at: Instant,
    dispatch_ms: f64,
}

#[cfg(not(debug_assertions))]
#[derive(Debug, Clone, Copy, Default)]
pub struct KeySoundDispatchTrace;

#[cfg(debug_assertions)]
impl KeySoundDispatchTrace {
    pub fn new(input_started_at: Instant, dispatch_ms: f64) -> Self {
        Self {
            input_started_at,
            dispatch_ms,
        }
    }

    fn total_elapsed_ms(self) -> f64 {
        self.input_started_at.elapsed().as_secs_f64() * 1000.0
    }

    fn dispatch_ms(self) -> f64 {
        self.dispatch_ms
    }
}

#[cfg_attr(not(debug_assertions), allow(dead_code))]
#[derive(Debug, Clone, Copy, Default)]
struct ClipLoadTrace {
    cache_hit: bool,
    decode_ms: f64,
}

#[cfg(debug_assertions)]
#[derive(Debug, Clone, Copy, Default)]
struct LatencySample {
    dispatch_ms: f64,
    queue_ms: f64,
    cache_lookup_ms: f64,
    decode_ms: f64,
    play_ms: f64,
    thread_ms: f64,
    total_ms: f64,
}

#[cfg(debug_assertions)]
#[derive(Debug, Clone, Copy, Default)]
struct LatencySummary {
    samples: u64,
    cache_miss_samples: u64,
    dispatch_sum: f64,
    queue_sum: f64,
    cache_lookup_sum: f64,
    decode_sum: f64,
    play_sum: f64,
    thread_sum: f64,
    total_sum: f64,
    total_max: f64,
}

#[cfg(debug_assertions)]
impl LatencySummary {
    fn push(&mut self, sample: LatencySample, cache_miss: bool) {
        self.samples += 1;
        if cache_miss {
            self.cache_miss_samples += 1;
        }
        self.dispatch_sum += sample.dispatch_ms;
        self.queue_sum += sample.queue_ms;
        self.cache_lookup_sum += sample.cache_lookup_ms;
        self.decode_sum += sample.decode_ms;
        self.play_sum += sample.play_ms;
        self.thread_sum += sample.thread_ms;
        self.total_sum += sample.total_ms;
        self.total_max = self.total_max.max(sample.total_ms);
    }

    fn should_emit_summary(&self) -> bool {
        self.samples > 0 && self.samples % LATENCY_SUMMARY_INTERVAL == 0
    }

    fn emit_summary(&self) {
        let count = self.samples as f64;
        if count <= 0.0 {
            return;
        }
        debug!(
            "[KeySound][Latency][Summary] samples={} cacheMisses={} avgDispatchMs={:.3} avgQueueMs={:.3} avgCacheLookupMs={:.3} avgDecodeMs={:.3} avgPlayMs={:.3} avgThreadMs={:.3} avgTotalMs={:.3} maxTotalMs={:.3}",
            self.samples,
            self.cache_miss_samples,
            self.dispatch_sum / count,
            self.queue_sum / count,
            self.cache_lookup_sum / count,
            self.decode_sum / count,
            self.play_sum / count,
            self.thread_sum / count,
            self.total_sum / count,
            self.total_max
        );
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeySoundStatus {
    pub enabled: bool,
    pub volume: f32,
    pub loaded: bool,
    pub soundpack_dir: Option<String>,
    pub mapped_labels: usize,
    pub latency_logging: bool,
}

impl Default for KeySoundStatus {
    fn default() -> Self {
        Self {
            enabled: true,
            volume: 1.0,
            loaded: false,
            soundpack_dir: None,
            mapped_labels: 0,
            latency_logging: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum KeySoundOutputBackend {
    #[default]
    DefaultDevice,
    Asio {
        driver_name: String,
        /// ASIO 버퍼 크기(프레임). None이면 기본 64 고정
        /// 다른 ASIO 앱(게임)과 공존하려면 그 앱과 동일한 버퍼로 맞춰야 함
        #[serde(default)]
        buffer_size: Option<u32>,
    },
}

impl KeySoundOutputBackend {
    fn normalized(self) -> Self {
        match self {
            Self::DefaultDevice => Self::DefaultDevice,
            Self::Asio {
                driver_name,
                buffer_size,
            } => Self::Asio {
                driver_name: driver_name.trim().to_string(),
                buffer_size: buffer_size.filter(|size| *size > 0),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeySoundOutputState {
    pub requested: KeySoundOutputBackend,
    pub effective: KeySoundOutputBackend,
    pub error: Option<String>,
    pub error_code: Option<String>,
    pub asio_available: bool,
}

impl Default for KeySoundOutputState {
    fn default() -> Self {
        Self {
            requested: KeySoundOutputBackend::DefaultDevice,
            effective: KeySoundOutputBackend::DefaultDevice,
            error: None,
            error_code: None,
            asio_available: asio_backend_available(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeySoundOutputDevices {
    pub default_device: bool,
    pub asio: Vec<String>,
}

#[derive(Debug, Clone)]
struct KeySoundRuntimeState {
    status: KeySoundStatus,
    output_state: KeySoundOutputState,
    soundpack: Option<Arc<LoadedSoundpack>>,
}

enum AudioCommand {
    PlayLabels {
        labels: Vec<String>,
        queued_at: Instant,
        trace: Option<KeySoundDispatchTrace>,
    },
    PlayFile {
        path: String,
        per_key_volume: f32,
        queued_at: Instant,
        trace: Option<KeySoundDispatchTrace>,
    },
    SetEnabled(bool),
    SetVolume(f32),
    SetLatencyLogging(bool),
    SetSoundpack(Option<Arc<LoadedSoundpack>>),
    InvalidateFileCache {
        path: String,
    },
    SetOutputBackend {
        backend: KeySoundOutputBackend,
        reply: Sender<KeySoundOutputState>,
    },
}

#[derive(Debug, Clone)]
struct CachedAudioClip {
    samples: Arc<[f32]>,
    channels: u16,
    sample_rate: u32,
}

pub struct KeySoundEngine {
    sender: Sender<AudioCommand>,
    state: Arc<RwLock<KeySoundRuntimeState>>,
}

impl Default for KeySoundEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl KeySoundEngine {
    pub fn new() -> Self {
        Self::with_output_backend(KeySoundOutputBackend::DefaultDevice)
    }

    /// 초기 출력 백엔드를 지정해 생성. 오디오 스레드가 처음부터 이 백엔드로 스트림을 열어
    /// "기본 장치 → ASIO" 전환에서 발생하던 깜빡임을 제거한다.
    pub fn with_output_backend(backend: KeySoundOutputBackend) -> Self {
        let (sender, receiver) = mpsc::channel();
        let output_state = KeySoundOutputState {
            requested: backend,
            effective: KeySoundOutputBackend::DefaultDevice,
            error: None,
            error_code: None,
            asio_available: asio_backend_available(),
        };
        let state = Arc::new(RwLock::new(KeySoundRuntimeState {
            status: KeySoundStatus::default(),
            output_state,
            soundpack: None,
        }));
        let state_for_thread = state.clone();

        thread::spawn(move || audio_thread(receiver, state_for_thread));

        Self { sender, state }
    }

    pub fn status(&self) -> KeySoundStatus {
        self.state.read().status.clone()
    }

    pub fn output_state(&self) -> KeySoundOutputState {
        self.state.read().output_state.clone()
    }

    pub fn list_output_devices(&self) -> KeySoundOutputDevices {
        KeySoundOutputDevices {
            default_device: true,
            asio: list_asio_drivers(),
        }
    }

    pub fn set_output_backend(&self, backend: KeySoundOutputBackend) -> KeySoundOutputState {
        let (reply_tx, reply_rx) = mpsc::channel();
        if self
            .sender
            .send(AudioCommand::SetOutputBackend {
                backend,
                reply: reply_tx,
            })
            .is_err()
        {
            return self.output_state();
        }

        reply_rx.recv().unwrap_or_else(|_| self.output_state())
    }

    pub fn set_enabled(&self, enabled: bool) -> KeySoundStatus {
        {
            let mut guard = self.state.write();
            guard.status.enabled = enabled;
        }
        let _ = self.sender.send(AudioCommand::SetEnabled(enabled));
        self.status()
    }

    pub fn set_volume(&self, volume: f32) -> KeySoundStatus {
        let volume = volume.clamp(0.0, 1.0);
        {
            let mut guard = self.state.write();
            guard.status.volume = volume;
        }
        let _ = self.sender.send(AudioCommand::SetVolume(volume));
        self.status()
    }

    pub fn set_latency_logging(&self, enabled: bool) -> KeySoundStatus {
        let enabled = enabled && latency_measurement_available();
        {
            let mut guard = self.state.write();
            guard.status.latency_logging = enabled;
        }
        let _ = self.sender.send(AudioCommand::SetLatencyLogging(enabled));
        self.status()
    }

    #[cfg(debug_assertions)]
    pub fn latency_logging_enabled(&self) -> bool {
        latency_measurement_available() && self.state.read().status.latency_logging
    }

    pub fn latency_logging_available(&self) -> bool {
        latency_measurement_available()
    }

    pub fn load_soundpack_dir<P>(&self, soundpack_dir: P) -> Result<KeySoundStatus>
    where
        P: AsRef<Path>,
    {
        let dir = soundpack_dir.as_ref().to_path_buf();
        let pack = Arc::new(LoadedSoundpack::from_dir(&dir)?);

        {
            let mut guard = self.state.write();
            guard.status.loaded = true;
            guard.status.soundpack_dir = Some(dir.to_string_lossy().to_string());
            guard.status.mapped_labels = pack.segments.len();
            guard.soundpack = Some(pack.clone());
        }

        let _ = self.sender.send(AudioCommand::SetSoundpack(Some(pack)));
        Ok(self.status())
    }

    pub fn unload_soundpack(&self) -> KeySoundStatus {
        {
            let mut guard = self.state.write();
            guard.status.loaded = false;
            guard.status.soundpack_dir = None;
            guard.status.mapped_labels = 0;
            guard.soundpack = None;
        }
        let _ = self.sender.send(AudioCommand::SetSoundpack(None));
        self.status()
    }

    pub fn play_labels(&self, labels: &[String], trace: Option<KeySoundDispatchTrace>) {
        if labels.is_empty() {
            return;
        }
        if !self.state.read().status.enabled {
            return;
        }

        let _ = self.sender.send(AudioCommand::PlayLabels {
            labels: labels.to_vec(),
            queued_at: Instant::now(),
            trace,
        });
    }

    pub fn invalidate_file_cache(&self, path: &str) {
        let _ = self.sender.send(AudioCommand::InvalidateFileCache {
            path: path.to_string(),
        });
    }

    pub fn play_file(&self, path: &str, per_key_volume: f32, trace: Option<KeySoundDispatchTrace>) {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return;
        }
        if !self.state.read().status.enabled {
            return;
        }

        let _ = self.sender.send(AudioCommand::PlayFile {
            path: trimmed.to_string(),
            per_key_volume: per_key_volume.clamp(0.0, 2.0),
            queued_at: Instant::now(),
            trace,
        });
    }
}

fn audio_thread(receiver: Receiver<AudioCommand>, state: Arc<RwLock<KeySoundRuntimeState>>) {
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
    let output_state = switch_output_backend(requested_backend.clone(), &mut stream_handler);
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
                    &requested_backend,
                    &state,
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
                    &requested_backend,
                    &state,
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

// sink별 에러 플래그를 분리하여 이전 sink의 콜백이 새 sink를 오염시키지 않도록 함
struct StreamHandler {
    sink: MixerDeviceSink,
    error: Arc<AtomicBool>,
}

const ERROR_CODE_ASIO_UNAVAILABLE_BUILD: &str = "asioUnavailableBuild";
const ERROR_CODE_ASIO_DEVICE_NOT_FOUND: &str = "asioDeviceNotFound";
const ERROR_CODE_ASIO_OPEN_FAILED: &str = "asioOpenFailed";
const ERROR_CODE_DEFAULT_OPEN_FAILED: &str = "defaultOpenFailed";

#[derive(Debug)]
enum AudioSinkOpenError {
    #[cfg_attr(all(windows, feature = "asio-backend"), allow(dead_code))]
    AsioUnavailableBuild,
    #[cfg_attr(not(all(windows, feature = "asio-backend")), allow(dead_code))]
    AsioDeviceNotFound,
    OpenFailed(anyhow::Error),
}

type AudioSinkResult<T> = std::result::Result<T, AudioSinkOpenError>;

impl fmt::Display for AudioSinkOpenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AsioUnavailableBuild | Self::AsioDeviceNotFound => {
                write!(f, "{}", audio_sink_error_message(self))
            }
            Self::OpenFailed(err) => write!(f, "{err:#}"),
        }
    }
}

impl Error for AudioSinkOpenError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::OpenFailed(err) => Some(err.as_ref()),
            _ => None,
        }
    }
}

fn asio_backend_available() -> bool {
    cfg!(all(windows, feature = "asio-backend"))
}

fn stream_error_callback(
    label: &'static str,
) -> (
    Arc<AtomicBool>,
    impl FnMut(cpal::StreamError) + Send + Clone + 'static,
) {
    let error = Arc::new(AtomicBool::new(false));
    let err_flag = Arc::clone(&error);
    let callback = move |err| {
        warn!("[KeySound] {label} error: {err}");
        err_flag.store(true, Ordering::Release);
    };
    (error, callback)
}

fn switch_output_backend(
    backend: KeySoundOutputBackend,
    stream_handler: &mut Option<StreamHandler>,
) -> KeySoundOutputState {
    let requested = backend.normalized();
    *stream_handler = None;

    match open_audio_sink(&requested) {
        Ok(handler) => {
            *stream_handler = Some(handler);
            KeySoundOutputState {
                requested: requested.clone(),
                effective: requested,
                error: None,
                error_code: None,
                asio_available: asio_backend_available(),
            }
        }
        Err(err) => {
            warn!("[KeySound] failed to open output backend: {err}");
            match requested {
                KeySoundOutputBackend::DefaultDevice => KeySoundOutputState {
                    requested: KeySoundOutputBackend::DefaultDevice,
                    effective: KeySoundOutputBackend::DefaultDevice,
                    error: Some(default_output_error_message(&err).to_string()),
                    error_code: Some(ERROR_CODE_DEFAULT_OPEN_FAILED.to_string()),
                    asio_available: asio_backend_available(),
                },
                KeySoundOutputBackend::Asio {
                    driver_name,
                    buffer_size,
                } => {
                    let mut error = asio_output_error_message(&err).to_string();
                    let mut error_code = asio_output_error_code(&err).to_string();
                    if let Err(default_err) = open_audio_sink(&KeySoundOutputBackend::DefaultDevice)
                        .map(|handler| {
                            *stream_handler = Some(handler);
                        })
                    {
                        warn!("[KeySound] failed to fallback to default output: {default_err}");
                        error = format!("{error}; 기본 장치 폴백도 실패: {default_err}");
                        error_code = ERROR_CODE_DEFAULT_OPEN_FAILED.to_string();
                    }

                    KeySoundOutputState {
                        requested: KeySoundOutputBackend::Asio {
                            driver_name,
                            buffer_size,
                        },
                        effective: KeySoundOutputBackend::DefaultDevice,
                        error: Some(error),
                        error_code: Some(error_code),
                        asio_available: asio_backend_available(),
                    }
                }
            }
        }
    }
}

fn audio_sink_error_message(err: &AudioSinkOpenError) -> &'static str {
    match err {
        AudioSinkOpenError::AsioUnavailableBuild => "ASIO 미지원 빌드",
        AudioSinkOpenError::AsioDeviceNotFound => "ASIO 장치를 찾을 수 없습니다",
        AudioSinkOpenError::OpenFailed(_) => "오디오 출력 장치를 열 수 없습니다",
    }
}

fn default_output_error_message(_err: &AudioSinkOpenError) -> &'static str {
    "기본 출력 장치를 열 수 없습니다"
}

fn asio_output_error_message(err: &AudioSinkOpenError) -> &'static str {
    match err {
        AudioSinkOpenError::OpenFailed(_) => "ASIO 장치를 열 수 없어 기본 출력으로 재생합니다",
        _ => audio_sink_error_message(err),
    }
}

fn asio_output_error_code(err: &AudioSinkOpenError) -> &'static str {
    match err {
        AudioSinkOpenError::AsioUnavailableBuild => ERROR_CODE_ASIO_UNAVAILABLE_BUILD,
        AudioSinkOpenError::AsioDeviceNotFound => ERROR_CODE_ASIO_DEVICE_NOT_FOUND,
        AudioSinkOpenError::OpenFailed(_) => ERROR_CODE_ASIO_OPEN_FAILED,
    }
}

fn open_audio_sink(backend: &KeySoundOutputBackend) -> AudioSinkResult<StreamHandler> {
    match backend {
        KeySoundOutputBackend::DefaultDevice => open_default_audio_sink(),
        KeySoundOutputBackend::Asio {
            driver_name,
            buffer_size,
        } => open_asio_audio_sink(driver_name, *buffer_size),
    }
}

fn open_default_audio_sink() -> AudioSinkResult<StreamHandler> {
    let (error, callback) = stream_error_callback("stream");

    let sink = DeviceSinkBuilder::from_default_device()
        .and_then(|builder| {
            builder
                .with_error_callback(callback)
                .open_sink_or_fallback()
        })
        .map_err(|err| AudioSinkOpenError::OpenFailed(anyhow::Error::new(err)))?;

    Ok(StreamHandler { sink, error })
}

#[cfg(all(windows, feature = "asio-backend"))]
fn open_asio_audio_sink(
    driver_name: &str,
    buffer_size: Option<u32>,
) -> AudioSinkResult<StreamHandler> {
    use cpal::traits::{DeviceTrait, HostTrait};

    let driver_name = driver_name.trim();
    if driver_name.is_empty() {
        return Err(AudioSinkOpenError::AsioDeviceNotFound);
    }

    let host = cpal::host_from_id(cpal::HostId::Asio)
        .map_err(|_| AudioSinkOpenError::AsioDeviceNotFound)?;
    let devices = host
        .output_devices()
        .map_err(|_| AudioSinkOpenError::AsioDeviceNotFound)?;

    for device in devices {
        let name = match device.description() {
            Ok(description) => description.name().trim().to_string(),
            Err(err) => {
                warn!("[KeySound] failed to read ASIO device name: {err}");
                continue;
            }
        };
        if name == driver_name {
            return open_device_audio_sink(device, buffer_size);
        }
    }

    Err(AudioSinkOpenError::AsioDeviceNotFound)
}

#[cfg(not(all(windows, feature = "asio-backend")))]
fn open_asio_audio_sink(
    _driver_name: &str,
    _buffer_size: Option<u32>,
) -> AudioSinkResult<StreamHandler> {
    Err(AudioSinkOpenError::AsioUnavailableBuild)
}

/// ASIO 기본 버퍼 크기(프레임). 미지정 시 이 값으로 고정 오픈
#[cfg(all(windows, feature = "asio-backend"))]
const DEFAULT_ASIO_BUFFER_FRAMES: u32 = 64;

#[cfg(all(windows, feature = "asio-backend"))]
fn open_device_audio_sink(
    device: cpal::Device,
    buffer_size: Option<u32>,
) -> AudioSinkResult<StreamHandler> {
    // 미지정(None)이면 기본 64로 오픈
    let frames = buffer_size
        .filter(|frames| *frames > 0)
        .unwrap_or(DEFAULT_ASIO_BUFFER_FRAMES);

    // 고정 버퍼 지정 시 그 값 그대로 오픈
    try_open_asio_sink(device, frames)
}

#[cfg(all(windows, feature = "asio-backend"))]
fn try_open_asio_sink(device: cpal::Device, buffer_size: u32) -> AudioSinkResult<StreamHandler> {
    use cpal::traits::DeviceTrait;

    // 일부 드라이버(Realtek ASIO 등)는 클럭 미확립 상태에서 sample rate 0을 보고함.
    // rodio from_device 내부의 NonZero unwrap 패닉(release는 abort) 방지를 위한 사전 검증
    let default_config = device
        .default_output_config()
        .map_err(|err| AudioSinkOpenError::OpenFailed(anyhow::Error::new(err)))?;
    if default_config.sample_rate() == 0 || default_config.channels() == 0 {
        return Err(AudioSinkOpenError::OpenFailed(anyhow::anyhow!(
            "ASIO 드라이버가 유효한 샘플레이트/채널 구성을 보고하지 않았습니다"
        )));
    }

    let (error, callback) = stream_error_callback("ASIO stream");

    let builder = DeviceSinkBuilder::from_device(device)
        .map_err(|err| AudioSinkOpenError::OpenFailed(anyhow::Error::new(err)))?
        .with_error_callback(callback);

    // 샘플레이트는 드라이버 현재값(default_output_config)을 그대로 사용 → ASIOSetSampleRate 회피.
    // 버퍼는 명시 고정만 사용
    let sink = builder
        .with_buffer_size(cpal::BufferSize::Fixed(buffer_size))
        .open_stream()
        .map_err(|err| AudioSinkOpenError::OpenFailed(anyhow::Error::new(err)))?;

    let config = sink.config();
    info!(
        "[KeySound] ASIO 스트림 오픈: 요청 버퍼={}, 적용 sample_rate={}Hz, buffer={:?}",
        buffer_size,
        config.sample_rate().get(),
        config.buffer_size()
    );

    Ok(StreamHandler { sink, error })
}

#[cfg(all(windows, feature = "asio-backend"))]
fn list_asio_drivers() -> Vec<String> {
    use cpal::traits::{DeviceTrait, HostTrait};

    let Ok(host) = cpal::host_from_id(cpal::HostId::Asio) else {
        return Vec::new();
    };
    let Ok(devices) = host.output_devices() else {
        return Vec::new();
    };

    let mut names: Vec<String> = devices
        .filter_map(|device| {
            device
                .description()
                .ok()
                .map(|description| description.name().trim().to_string())
                .filter(|name| !name.is_empty())
        })
        .collect();
    names.sort();
    names.dedup();
    names
}

#[cfg(not(all(windows, feature = "asio-backend")))]
fn list_asio_drivers() -> Vec<String> {
    Vec::new()
}

fn play_on_stream(
    stream_handler: &mut Option<StreamHandler>,
    source: AudioSource,
    volume: f32,
    requested_backend: &KeySoundOutputBackend,
    state: &Arc<RwLock<KeySoundRuntimeState>>,
) -> bool {
    // 장치 에러 또는 스트림 없음 → 재연결
    if stream_handler
        .as_ref()
        .is_none_or(|h| h.error.load(Ordering::Acquire))
    {
        let output_state = switch_output_backend(requested_backend.clone(), stream_handler);
        state.write().output_state = output_state;
    }

    let Some(handler) = stream_handler.as_ref() else {
        return false;
    };

    handler.sink.mixer().add(source.with_gain(volume));
    true
}

fn get_or_load_cached_clip(
    path: &str,
    cache: &mut HashMap<String, Arc<CachedAudioClip>>,
    measure_decode_ms: bool,
) -> Option<(Arc<CachedAudioClip>, ClipLoadTrace)> {
    if let Some(cached) = cache.get(path) {
        return Some((
            cached.clone(),
            ClipLoadTrace {
                cache_hit: true,
                decode_ms: 0.0,
            },
        ));
    }

    #[cfg(debug_assertions)]
    let decode_started_at = measure_decode_ms.then_some(Instant::now());
    #[cfg(not(debug_assertions))]
    let _ = measure_decode_ms;
    match decode_audio_file_clip(path) {
        Ok(clip) => {
            let shared = Arc::new(clip);
            cache.insert(path.to_string(), shared.clone());
            Some((
                shared,
                ClipLoadTrace {
                    cache_hit: false,
                    #[cfg(debug_assertions)]
                    decode_ms: decode_started_at
                        .map(|started| started.elapsed().as_secs_f64() * 1000.0)
                        .unwrap_or(0.0),
                    #[cfg(not(debug_assertions))]
                    decode_ms: 0.0,
                },
            ))
        }
        Err(error) => {
            warn!(
                "[KeySound] failed to decode key sound file '{}': {error:#}",
                path
            );
            None
        }
    }
}

fn decode_audio_file_clip(path: &str) -> Result<CachedAudioClip> {
    let file =
        File::open(path).with_context(|| format!("failed to open key sound file: {}", path))?;
    let media_source = MediaSourceStream::new(Box::new(file), Default::default());
    let path_ref = Path::new(path);

    let mut hint = Hint::new();
    if let Some(ext) = path_ref.extension().and_then(|value| value.to_str()) {
        hint.with_extension(ext);
    }

    let probe = get_probe()
        .format(
            &hint,
            media_source,
            &FormatOptions::default(),
            &Default::default(),
        )
        .context("failed to probe key sound file format")?;
    let mut format = probe.format;
    let track = format
        .default_track()
        .context("no default track in key sound file")?;
    let track_id = track.id;
    let mut decoder = get_codecs()
        .make(&track.codec_params, &Default::default())
        .context("failed to create key sound decoder")?;

    let mut channels = track
        .codec_params
        .channels
        .map(|value| value.count() as u16);
    let mut sample_rate = track.codec_params.sample_rate;
    let mut samples: Vec<f32> = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(io_error))
                if io_error.kind() == ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(err) => {
                return Err(anyhow::Error::new(err).context("failed to read key sound packet"));
            }
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(err) => {
                return Err(anyhow::Error::new(err).context("failed to decode key sound packet"));
            }
        };

        channels.get_or_insert(decoded.spec().channels.count() as u16);
        sample_rate.get_or_insert(decoded.spec().rate);

        let mut sample_buffer =
            SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
        sample_buffer.copy_interleaved_ref(decoded);
        samples.extend_from_slice(sample_buffer.samples());
    }

    if samples.is_empty() {
        anyhow::bail!("decoded sample buffer is empty");
    }

    let channels = channels.context("missing channel count in key sound file")?;
    let sample_rate = sample_rate.context("missing sample rate in key sound file")?;

    Ok(CachedAudioClip {
        samples: Arc::from(samples.into_boxed_slice()),
        channels,
        sample_rate,
    })
}

#[derive(Debug)]
struct LoadedSoundpack {
    segments: HashMap<String, Arc<[f32]>>,
    fallback: Option<Arc<[f32]>>,
    channels: u16,
    sample_rate: u32,
}

impl LoadedSoundpack {
    fn from_dir(soundpack_dir: &Path) -> Result<Self> {
        let config_path = soundpack_dir.join("config.json");
        let config: SoundpackConfig =
            serde_json::from_reader(File::open(&config_path).with_context(|| {
                format!("failed to open soundpack config: {}", config_path.display())
            })?)
            .context("failed to parse soundpack config.json")?;

        let audio_path = soundpack_dir.join(&config.audio_file);
        let mut decoder = SoundDecoder::new(&audio_path)?;
        let mut decoded_by_range: HashMap<(u64, u64), Arc<[f32]>> = HashMap::new();
        let mut segments = HashMap::new();

        for (label, [start_ms, duration_ms]) in config.defines {
            let cache_key = (start_ms, duration_ms);
            let samples = if let Some(existing) = decoded_by_range.get(&cache_key) {
                existing.clone()
            } else {
                let decoded = decoder.get_samples_buf(start_ms, duration_ms)?;
                let shared: Arc<[f32]> = Arc::from(decoded.into_boxed_slice());
                decoded_by_range.insert(cache_key, shared.clone());
                shared
            };
            segments.insert(normalize_label(&label), samples);
        }

        let fallback = if let Some([start_ms, duration_ms]) = config.fallback {
            let cache_key = (start_ms, duration_ms);
            if let Some(existing) = decoded_by_range.get(&cache_key) {
                Some(existing.clone())
            } else {
                let decoded = decoder.get_samples_buf(start_ms, duration_ms)?;
                let shared: Arc<[f32]> = Arc::from(decoded.into_boxed_slice());
                decoded_by_range.insert(cache_key, shared.clone());
                Some(shared)
            }
        } else {
            None
        };

        Ok(Self {
            segments,
            fallback,
            channels: decoder.channels,
            sample_rate: decoder.sample_rate,
        })
    }

    fn source_for_labels(&self, labels: &[String]) -> Option<AudioSource> {
        for label in labels {
            let normalized = normalize_label(label);
            if let Some(samples) = self.segments.get(&normalized) {
                return Some(AudioSource::new(
                    samples.clone(),
                    self.channels,
                    self.sample_rate,
                ));
            }
        }

        self.fallback
            .as_ref()
            .map(|samples| AudioSource::new(samples.clone(), self.channels, self.sample_rate))
    }
}

fn normalize_label(label: &str) -> String {
    label.trim().to_ascii_uppercase()
}

#[derive(Debug, Deserialize)]
struct SoundpackConfig {
    #[serde(default = "default_audio_file")]
    audio_file: String,
    defines: HashMap<String, [u64; 2]>,
    #[serde(default)]
    fallback: Option<[u64; 2]>,
}

fn default_audio_file() -> String {
    "sound.ogg".to_string()
}

#[derive(Clone, Debug)]
struct AudioSource {
    samples: Arc<[f32]>,
    channels: u16,
    sample_rate: u32,
    gain: f32,
    pos: usize,
}

/// 천장(1.0) 근처에서 부드럽게 수렴시키는 소프트 리미터
/// knee 미만은 그대로 통과(일반 볼륨 무영향), 초과분만 1.0으로 압축
fn soft_limit_sample(x: f32) -> f32 {
    const KNEE: f32 = 0.95;
    let mag = x.abs();
    if mag <= KNEE {
        return x;
    }
    let over = (mag - KNEE) / (1.0 - KNEE);
    let limited = KNEE + (1.0 - KNEE) * over.tanh();
    limited.copysign(x)
}

impl AudioSource {
    fn new(samples: Arc<[f32]>, channels: u16, sample_rate: u32) -> Self {
        Self {
            samples,
            channels,
            sample_rate,
            gain: 1.0,
            pos: 0,
        }
    }

    fn with_gain(mut self, gain: f32) -> Self {
        self.gain = gain;
        self
    }
}

impl Iterator for AudioSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let value = self.samples.get(self.pos)?;
        self.pos += 1;
        Some(soft_limit_sample(*value * self.gain))
    }
}

impl Source for AudioSource {
    fn current_span_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> NonZero<u16> {
        NonZero::new(self.channels).expect("channels must be > 0")
    }

    fn sample_rate(&self) -> NonZero<u32> {
        NonZero::new(self.sample_rate).expect("sample_rate must be > 0")
    }

    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

struct SoundDecoder {
    decoder: Box<dyn Decoder>,
    format: Box<dyn FormatReader>,
    time_base: TimeBase,
    sample_rate: u32,
    channels: u16,
}

impl SoundDecoder {
    fn new(path: &Path) -> Result<Self> {
        let file = File::open(path)
            .with_context(|| format!("failed to open sound file: {}", path.display()))?;
        let media_source = MediaSourceStream::new(Box::new(file), Default::default());

        let mut hint = Hint::new();
        if let Some(ext) = path.extension().and_then(|value| value.to_str()) {
            hint.with_extension(ext);
        }

        let probe = get_probe()
            .format(
                &hint,
                media_source,
                &FormatOptions::default(),
                &Default::default(),
            )
            .context("failed to probe sound file format")?;
        let format = probe.format;
        let track = format
            .default_track()
            .context("no default track in sound file")?;
        let decoder = get_codecs()
            .make(&track.codec_params, &Default::default())
            .context("failed to create audio decoder")?;

        let (sample_rate, channels, time_base) = {
            let params = decoder.codec_params();
            (
                params
                    .sample_rate
                    .context("missing sample rate in sound file")?,
                params
                    .channels
                    .map(|v| v.count() as u16)
                    .context("missing channels in sound file")?,
                params
                    .time_base
                    .context("missing time base in sound file")?,
            )
        };

        Ok(Self {
            decoder,
            format,
            time_base,
            sample_rate,
            channels,
        })
    }

    fn get_samples_buf(&mut self, start_ms: u64, duration_ms: u64) -> Result<Vec<f32>> {
        self.format
            .seek(
                SeekMode::Accurate,
                SeekTo::Time {
                    track_id: None,
                    time: Duration::from_millis(start_ms).into(),
                },
            )
            .context("failed to seek sound file")?;
        self.decoder.reset();

        let mut decoded_duration_ms = 0_u64;
        let mut samples = Vec::new();

        while decoded_duration_ms < duration_ms {
            let packet = self
                .format
                .next_packet()
                .context("failed to fetch audio packet")?;

            let packet_time = self.time_base.calc_time(packet.dur);
            decoded_duration_ms +=
                ((packet_time.seconds as f64 + packet_time.frac) * 1000.0) as u64;

            let decoded = self
                .decoder
                .decode(&packet)
                .context("failed to decode audio packet")?;
            let mut sample_buffer =
                SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
            sample_buffer.copy_interleaved_ref(decoded);
            samples.extend_from_slice(sample_buffer.samples());
        }

        Ok(samples)
    }
}
