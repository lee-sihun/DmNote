use std::{
    collections::HashMap,
    fs::File,
    io::ErrorKind,
    num::NonZero,
    path::Path,
    str::FromStr,
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

mod asio;
mod clips;
mod runtime;

use asio::{
    backend_available as asio_backend_available, list_drivers as list_asio_drivers,
    open_audio_sink as open_asio_audio_sink,
};
use clips::{get_or_load_cached_clip, AudioSource, LoadedSoundpack};
use runtime::audio_thread;

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
        self.samples > 0 && self.samples.is_multiple_of(LATENCY_SUMMARY_INTERVAL)
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
    Device {
        id: String,
        name: String,
    },
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
            Self::Device { id, name } => Self::Device {
                id: id.trim().to_string(),
                name: name.trim().to_string(),
            },
            Self::Asio {
                driver_name,
                buffer_size,
            } => Self::Asio {
                driver_name: asio::normalize_driver_name(&driver_name),
                buffer_size: asio::normalize_buffer_size(buffer_size),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeySoundOutputState {
    pub requested: KeySoundOutputBackend,
    pub effective: Option<KeySoundOutputBackend>,
    pub error: Option<String>,
    pub error_code: Option<String>,
    pub asio_available: bool,
}

impl Default for KeySoundOutputState {
    fn default() -> Self {
        Self {
            requested: KeySoundOutputBackend::DefaultDevice,
            effective: None,
            error: None,
            error_code: None,
            asio_available: asio_backend_available(),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KeySoundOutputDevice {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeySoundOutputDevices {
    pub default_device: bool,
    pub system: Vec<KeySoundOutputDevice>,
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
        Self::with_output_backend(KeySoundOutputBackend::DefaultDevice, Arc::new(|_, _| {}))
    }

    /// 저장된 출력 백엔드로 초기화
    /// 기동 직후 기본 장치 전환 방지
    pub fn with_output_backend(
        backend: KeySoundOutputBackend,
        fallback_callback: Arc<
            dyn Fn(KeySoundOutputBackend, KeySoundOutputBackend) + Send + Sync + 'static,
        >,
    ) -> Self {
        let (sender, receiver) = mpsc::channel();
        let output_state = KeySoundOutputState {
            requested: backend,
            effective: None,
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

        thread::spawn(move || audio_thread(receiver, state_for_thread, fallback_callback));

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
            system: list_system_output_devices(),
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

// sink별 에러 플래그를 분리하여 이전 sink의 콜백이 새 sink를 오염시키지 않도록 함
struct StreamHandler {
    sink: MixerDeviceSink,
    error: Arc<AtomicBool>,
}

const ERROR_CODE_ASIO_UNAVAILABLE_BUILD: &str = "asioUnavailableBuild";
const ERROR_CODE_ASIO_DEVICE_NOT_FOUND: &str = "asioDeviceNotFound";
const ERROR_CODE_ASIO_OPEN_FAILED: &str = "asioOpenFailed";
const ERROR_CODE_DEVICE_NOT_FOUND: &str = "deviceNotFound";
const ERROR_CODE_DEVICE_OPEN_FAILED: &str = "deviceOpenFailed";
const ERROR_CODE_DEFAULT_OPEN_FAILED: &str = "defaultOpenFailed";

#[derive(Debug)]
enum AudioSinkOpenError {
    #[cfg_attr(all(windows, feature = "asio-backend"), allow(dead_code))]
    AsioUnavailableBuild,
    #[cfg_attr(not(all(windows, feature = "asio-backend")), allow(dead_code))]
    AsioDeviceNotFound,
    DeviceNotFound,
    OpenFailed(anyhow::Error),
}

type AudioSinkResult<T> = std::result::Result<T, AudioSinkOpenError>;

impl fmt::Display for AudioSinkOpenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AsioUnavailableBuild | Self::AsioDeviceNotFound | Self::DeviceNotFound => {
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
        Ok(opened) => {
            let effective = opened.backend;
            *stream_handler = Some(opened.handler);
            KeySoundOutputState {
                requested: effective.clone(),
                effective: Some(effective),
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
                    effective: None,
                    error: Some(default_output_error_message(&err).to_string()),
                    error_code: Some(ERROR_CODE_DEFAULT_OPEN_FAILED.to_string()),
                    asio_available: asio_backend_available(),
                },
                requested => {
                    let (mut error, mut error_code) = output_fallback_error(&requested, &err);
                    let effective = match open_audio_sink(&KeySoundOutputBackend::DefaultDevice) {
                        Ok(opened) => {
                            *stream_handler = Some(opened.handler);
                            Some(KeySoundOutputBackend::DefaultDevice)
                        }
                        Err(default_err) => {
                            warn!("[KeySound] failed to fallback to default output: {default_err}");
                            error = format!("{error}; 기본 장치 폴백도 실패: {default_err}");
                            error_code = ERROR_CODE_DEFAULT_OPEN_FAILED.to_string();
                            None
                        }
                    };

                    KeySoundOutputState {
                        requested: KeySoundOutputBackend::DefaultDevice,
                        effective,
                        error: Some(error),
                        error_code: Some(error_code),
                        asio_available: asio_backend_available(),
                    }
                }
            }
        }
    }
}

// 기동 시 폴백 정책: 장치 부재(뽑힌 USB DAC 등)는 저장값을 기본 장치로 잊고(런타임 규칙과
// 동일), 열기 실패(게임의 ASIO 배타 점유·드라이버 오류)는 일시적일 수 있어 저장값을 지킨다 -
// 이번 세션만 기본 장치로 재생하고 다음 기동에 다시 시도한다
fn startup_fallback_forgets(error_code: &str) -> bool {
    matches!(
        error_code,
        ERROR_CODE_DEVICE_NOT_FOUND | ERROR_CODE_ASIO_DEVICE_NOT_FOUND
    )
}

fn open_initial_output_backend(
    backend: KeySoundOutputBackend,
    stream_handler: &mut Option<StreamHandler>,
    fallback_callback: &(dyn Fn(KeySoundOutputBackend, KeySoundOutputBackend) + Send + Sync),
) -> KeySoundOutputState {
    let requested = backend.clone();
    let requested_non_default = !matches!(&backend, KeySoundOutputBackend::DefaultDevice);
    let mut output_state = switch_output_backend(backend, stream_handler);
    if requested_non_default
        && matches!(
            &output_state.requested,
            KeySoundOutputBackend::DefaultDevice
        )
    {
        if output_state
            .error_code
            .as_deref()
            .is_some_and(startup_fallback_forgets)
        {
            fallback_callback(requested, output_state.requested.clone());
        } else {
            // 저장값 유지 - 스트림 오류 재연결(play_on_stream)에서 다시 시도된다
            output_state.requested = requested;
        }
    }
    output_state
}

fn switch_output_backend_with_notification(
    backend: KeySoundOutputBackend,
    stream_handler: &mut Option<StreamHandler>,
    fallback_callback: &(dyn Fn(KeySoundOutputBackend, KeySoundOutputBackend) + Send + Sync),
) -> KeySoundOutputState {
    let failed = backend.clone();
    let requested_non_default = !matches!(&backend, KeySoundOutputBackend::DefaultDevice);
    let output_state = switch_output_backend(backend, stream_handler);
    if requested_non_default
        && matches!(
            &output_state.requested,
            KeySoundOutputBackend::DefaultDevice
        )
    {
        fallback_callback(failed, output_state.requested.clone());
    }
    output_state
}

fn audio_sink_error_message(err: &AudioSinkOpenError) -> &'static str {
    match err {
        AudioSinkOpenError::AsioUnavailableBuild => "ASIO 미지원 빌드",
        AudioSinkOpenError::AsioDeviceNotFound => "ASIO 장치를 찾을 수 없습니다",
        AudioSinkOpenError::DeviceNotFound => "출력 장치를 찾을 수 없습니다",
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
        AudioSinkOpenError::DeviceNotFound => ERROR_CODE_DEVICE_NOT_FOUND,
        AudioSinkOpenError::OpenFailed(_) => ERROR_CODE_ASIO_OPEN_FAILED,
    }
}

fn device_output_error_message(err: &AudioSinkOpenError) -> &'static str {
    match err {
        AudioSinkOpenError::DeviceNotFound => "출력 장치를 찾을 수 없어 기본 출력으로 재생합니다",
        AudioSinkOpenError::OpenFailed(_) => "출력 장치를 열 수 없어 기본 출력으로 재생합니다",
        _ => audio_sink_error_message(err),
    }
}

fn device_output_error_code(err: &AudioSinkOpenError) -> &'static str {
    match err {
        AudioSinkOpenError::DeviceNotFound => ERROR_CODE_DEVICE_NOT_FOUND,
        _ => ERROR_CODE_DEVICE_OPEN_FAILED,
    }
}

fn output_fallback_error(
    backend: &KeySoundOutputBackend,
    err: &AudioSinkOpenError,
) -> (String, String) {
    match backend {
        KeySoundOutputBackend::Device { .. } => (
            device_output_error_message(err).to_string(),
            device_output_error_code(err).to_string(),
        ),
        KeySoundOutputBackend::Asio { .. } => (
            asio_output_error_message(err).to_string(),
            asio_output_error_code(err).to_string(),
        ),
        KeySoundOutputBackend::DefaultDevice => (
            default_output_error_message(err).to_string(),
            ERROR_CODE_DEFAULT_OPEN_FAILED.to_string(),
        ),
    }
}

struct OpenedAudioSink {
    handler: StreamHandler,
    backend: KeySoundOutputBackend,
}

fn open_audio_sink(backend: &KeySoundOutputBackend) -> AudioSinkResult<OpenedAudioSink> {
    match backend {
        KeySoundOutputBackend::DefaultDevice => {
            open_default_audio_sink().map(|handler| OpenedAudioSink {
                handler,
                backend: KeySoundOutputBackend::DefaultDevice,
            })
        }
        KeySoundOutputBackend::Device { id, name } => open_system_device_audio_sink(id, name),
        KeySoundOutputBackend::Asio {
            driver_name,
            buffer_size,
        } => open_asio_audio_sink(driver_name, *buffer_size).map(|handler| OpenedAudioSink {
            handler,
            backend: KeySoundOutputBackend::Asio {
                driver_name: driver_name.clone(),
                buffer_size: *buffer_size,
            },
        }),
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

fn open_system_device_audio_sink(id: &str, stored_name: &str) -> AudioSinkResult<OpenedAudioSink> {
    use cpal::traits::{DeviceTrait, HostTrait};

    let device_id = cpal::DeviceId::from_str(id).map_err(|_| AudioSinkOpenError::DeviceNotFound)?;
    let host = cpal::default_host();
    let device = host
        .device_by_id(&device_id)
        .ok_or(AudioSinkOpenError::DeviceNotFound)?;
    let resolved_id = device_id.to_string();
    let default_config = device
        .default_output_config()
        .map_err(|err| AudioSinkOpenError::OpenFailed(anyhow::Error::new(err)))?;
    if default_config.sample_rate() == 0 || default_config.channels() == 0 {
        return Err(AudioSinkOpenError::OpenFailed(anyhow::anyhow!(
            "출력 장치가 유효한 샘플레이트/채널 구성을 보고하지 않았습니다"
        )));
    }

    let current_name = match device.description() {
        Ok(description) => {
            let name = description.name().trim();
            if name.is_empty() {
                resolved_id.clone()
            } else {
                name.to_string()
            }
        }
        Err(err) => {
            warn!("[KeySound] failed to read system output device name: {err}");
            let stored_name = stored_name.trim();
            if stored_name.is_empty() {
                resolved_id.clone()
            } else {
                stored_name.to_string()
            }
        }
    };
    let (error, callback) = stream_error_callback("system stream");
    let sink = DeviceSinkBuilder::from_device(device)
        .map_err(|err| AudioSinkOpenError::OpenFailed(anyhow::Error::new(err)))?
        .with_error_callback(callback)
        .open_sink_or_fallback()
        .map_err(|err| AudioSinkOpenError::OpenFailed(anyhow::Error::new(err)))?;

    Ok(OpenedAudioSink {
        handler: StreamHandler { sink, error },
        backend: KeySoundOutputBackend::Device {
            id: resolved_id,
            name: current_name,
        },
    })
}

fn list_system_output_devices() -> Vec<KeySoundOutputDevice> {
    use cpal::traits::{DeviceTrait, HostTrait};

    let host = cpal::default_host();
    let host_id = host.id();
    let devices = match host.output_devices() {
        Ok(devices) => devices,
        Err(err) => {
            warn!("[KeySound] failed to list system output devices on host {host_id}: {err}");
            return Vec::new();
        }
    };
    let mut devices_by_id = HashMap::new();

    for device in devices {
        let id = match device.id() {
            Ok(id) => id.to_string(),
            Err(err) => {
                warn!("[KeySound] failed to read system output device id: {err}");
                continue;
            }
        };
        match device.default_output_config() {
            Ok(config) if config.sample_rate() > 0 && config.channels() > 0 => {}
            Ok(_) => {
                warn!("[KeySound] system output device '{id}' excluded: invalid sample rate or channels");
                continue;
            }
            Err(err) => {
                warn!("[KeySound] system output device '{id}' excluded: failed to read default config ({err})");
                continue;
            }
        }
        let name = match device.description() {
            Ok(description) => description.name().trim().to_string(),
            Err(err) => {
                warn!("[KeySound] failed to read system output device name for '{id}': {err}");
                String::new()
            }
        };
        let name = if name.is_empty() { id.clone() } else { name };
        devices_by_id
            .entry(id.clone())
            .or_insert(KeySoundOutputDevice { id, name });
    }

    let mut devices: Vec<_> = devices_by_id.into_values().collect();
    devices.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then_with(|| left.id.cmp(&right.id))
    });
    devices
}

fn play_on_stream(
    stream_handler: &mut Option<StreamHandler>,
    source: AudioSource,
    volume: f32,
    requested_backend: &mut KeySoundOutputBackend,
    state: &Arc<RwLock<KeySoundRuntimeState>>,
    fallback_callback: &(dyn Fn(KeySoundOutputBackend, KeySoundOutputBackend) + Send + Sync),
) -> bool {
    // 장치 에러 또는 스트림 없음 시 재연결
    let stream_unavailable = stream_handler
        .as_ref()
        .is_none_or(|h| h.error.load(Ordering::Acquire));
    if stream_unavailable {
        let output_state = switch_output_backend_with_notification(
            requested_backend.clone(),
            stream_handler,
            fallback_callback,
        );
        *requested_backend = output_state.requested.clone();
        state.write().output_state = output_state;
    }

    let Some(handler) = stream_handler.as_ref() else {
        return false;
    };

    handler.sink.mixer().add(source.with_gain(volume));
    true
}

#[cfg(test)]
#[path = "engine/tests.rs"]
mod output_backend_tests;
