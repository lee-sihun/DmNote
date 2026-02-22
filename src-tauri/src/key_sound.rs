use std::{
    collections::HashMap,
    fs::File,
    io::ErrorKind,
    path::Path,
    sync::{
        mpsc::{self, Receiver, Sender},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
#[cfg(debug_assertions)]
use log::debug;
use log::warn;
use parking_lot::RwLock;
use rodio::{OutputStream, PlayError, Source};
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

#[derive(Debug, Clone)]
struct KeySoundRuntimeState {
    status: KeySoundStatus,
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
    InvalidateFileCache { path: String },
}

#[derive(Debug, Clone)]
struct CachedAudioClip {
    samples: Arc<[i16]>,
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
        let (sender, receiver) = mpsc::channel();
        let state = Arc::new(RwLock::new(KeySoundRuntimeState {
            status: KeySoundStatus::default(),
            soundpack: None,
        }));
        let state_for_thread = state.clone();

        thread::spawn(move || audio_thread(receiver, state_for_thread));

        Self { sender, state }
    }

    pub fn status(&self) -> KeySoundStatus {
        self.state.read().status.clone()
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

    pub fn play_labels(
        &self,
        labels: &[String],
        trace: Option<KeySoundDispatchTrace>,
    ) {
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

    pub fn play_file(
        &self,
        path: &str,
        per_key_volume: f32,
        trace: Option<KeySoundDispatchTrace>,
    ) {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return;
        }
        if !self.state.read().status.enabled {
            return;
        }

        let _ = self.sender.send(AudioCommand::PlayFile {
            path: trimmed.to_string(),
            per_key_volume: per_key_volume.clamp(0.0, 1.0),
            queued_at: Instant::now(),
            trace,
        });
    }
}

fn audio_thread(
    receiver: Receiver<AudioCommand>,
    state: Arc<RwLock<KeySoundRuntimeState>>,
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
    let mut stream_handler = OutputStream::try_default().ok();
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

                if stream_handler.is_none() {
                    stream_handler = OutputStream::try_default().ok();
                }

                #[cfg(debug_assertions)]
                let play_started_at = latency_logging.then_some(Instant::now());
                if !play_on_stream(&mut stream_handler, source, volume) {
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
                let (clip, clip_load_trace) = match get_or_load_cached_clip(
                    &path,
                    &mut file_cache,
                    {
                        #[cfg(debug_assertions)]
                        {
                            latency_logging
                        }
                        #[cfg(not(debug_assertions))]
                        {
                            false
                        }
                    },
                ) {
                        Some(result) => result,
                        None => continue,
                    };
                #[cfg(debug_assertions)]
                let cache_lookup_ms = clip_lookup_started_at
                    .map(|started| started.elapsed().as_secs_f64() * 1000.0)
                    .unwrap_or(0.0);
                #[cfg(not(debug_assertions))]
                let _ = clip_load_trace;

                if stream_handler.is_none() {
                    stream_handler = OutputStream::try_default().ok();
                }

                let final_volume = (volume * per_key_volume).clamp(0.0, 1.0);
                let source = AudioSource::new(
                    clip.samples.clone(),
                    clip.channels,
                    clip.sample_rate,
                );

                #[cfg(debug_assertions)]
                let play_started_at = latency_logging.then_some(Instant::now());
                if !play_on_stream(&mut stream_handler, source, final_volume) {
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

fn play_on_stream(
    stream_handler: &mut Option<(OutputStream, rodio::OutputStreamHandle)>,
    source: AudioSource,
    volume: f32,
) -> bool {
    fn try_play(
        handle: &rodio::OutputStreamHandle,
        source: AudioSource,
        volume: f32,
    ) -> Result<(), PlayError> {
        handle.play_raw(source.amplify(volume).convert_samples::<f32>())
    }

    let Some(handler) = stream_handler.as_ref() else {
        return false;
    };

    match try_play(&handler.1, source.clone(), volume) {
        Ok(()) => true,
        Err(PlayError::NoDevice) => {
            *stream_handler = OutputStream::try_default().ok();
            stream_handler
                .as_ref()
                .map_or(false, |h| try_play(&h.1, source, volume).is_ok())
        }
        Err(_) => false,
    }
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
            warn!("[KeySound] failed to decode key sound file '{}': {error:#}", path);
            None
        }
    }
}

fn decode_audio_file_clip(path: &str) -> Result<CachedAudioClip> {
    let file = File::open(path)
        .with_context(|| format!("failed to open key sound file: {}", path))?;
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

    let mut channels = track.codec_params.channels.map(|value| value.count() as u16);
    let mut sample_rate = track.codec_params.sample_rate;
    let mut samples: Vec<i16> = Vec::new();

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
            SampleBuffer::<i16>::new(decoded.capacity() as u64, *decoded.spec());
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
    segments: HashMap<String, Arc<[i16]>>,
    fallback: Option<Arc<[i16]>>,
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
        let mut decoded_by_range: HashMap<(u64, u64), Arc<[i16]>> = HashMap::new();
        let mut segments = HashMap::new();

        for (label, [start_ms, duration_ms]) in config.defines {
            let cache_key = (start_ms, duration_ms);
            let samples = if let Some(existing) = decoded_by_range.get(&cache_key) {
                existing.clone()
            } else {
                let decoded = decoder.get_samples_buf(start_ms, duration_ms)?;
                let shared: Arc<[i16]> = Arc::from(decoded.into_boxed_slice());
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
                let shared: Arc<[i16]> = Arc::from(decoded.into_boxed_slice());
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
    samples: Arc<[i16]>,
    channels: u16,
    sample_rate: u32,
    pos: usize,
}

impl AudioSource {
    fn new(samples: Arc<[i16]>, channels: u16, sample_rate: u32) -> Self {
        Self {
            samples,
            channels,
            sample_rate,
            pos: 0,
        }
    }
}

impl Iterator for AudioSource {
    type Item = i16;

    fn next(&mut self) -> Option<Self::Item> {
        let value = self.samples.get(self.pos)?;
        self.pos += 1;
        Some(*value)
    }
}

impl Source for AudioSource {
    fn current_frame_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
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
        let track = format.default_track().context("no default track in sound file")?;
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
                params.time_base.context("missing time base in sound file")?,
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

    fn get_samples_buf(&mut self, start_ms: u64, duration_ms: u64) -> Result<Vec<i16>> {
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
                SampleBuffer::<i16>::new(decoded.capacity() as u64, *decoded.spec());
            sample_buffer.copy_interleaved_ref(decoded);
            samples.extend_from_slice(sample_buffer.samples());
        }

        Ok(samples)
    }
}
