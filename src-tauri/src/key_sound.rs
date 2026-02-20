use std::{
    collections::HashMap,
    fs::File,
    path::Path,
    sync::{
        mpsc::{self, Receiver, Sender},
        Arc,
    },
    thread,
    time::Duration,
};

use anyhow::{Context, Result};
use parking_lot::RwLock;
use rodio::{OutputStream, PlayError, Sink, Source};
use serde::{Deserialize, Serialize};
use symphonia::{
    core::{
        audio::SampleBuffer,
        codecs::Decoder,
        formats::{FormatOptions, FormatReader, SeekMode, SeekTo},
        io::MediaSourceStream,
        probe::Hint,
        units::TimeBase,
    },
    default::{get_codecs, get_probe},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeySoundStatus {
    pub enabled: bool,
    pub volume: f32,
    pub loaded: bool,
    pub soundpack_dir: Option<String>,
    pub mapped_labels: usize,
}

impl Default for KeySoundStatus {
    fn default() -> Self {
        Self {
            enabled: false,
            volume: 1.0,
            loaded: false,
            soundpack_dir: None,
            mapped_labels: 0,
        }
    }
}

#[derive(Debug, Clone)]
struct KeySoundRuntimeState {
    status: KeySoundStatus,
    soundpack: Option<Arc<LoadedSoundpack>>,
}

enum AudioCommand {
    PlayLabels(Vec<String>),
    SetEnabled(bool),
    SetVolume(f32),
    SetSoundpack(Option<Arc<LoadedSoundpack>>),
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

    pub fn play_labels(&self, labels: &[String]) {
        if labels.is_empty() {
            return;
        }
        if !self.state.read().status.enabled {
            return;
        }

        let _ = self
            .sender
            .send(AudioCommand::PlayLabels(labels.to_vec()));
    }
}

fn audio_thread(
    receiver: Receiver<AudioCommand>,
    state: Arc<RwLock<KeySoundRuntimeState>>,
) {
    #[cfg(target_os = "windows")]
    {
        use thread_priority::{set_current_thread_priority, ThreadPriority};
        let _ = set_current_thread_priority(ThreadPriority::Max);
    }

    let mut enabled = state.read().status.enabled;
    let mut volume = state.read().status.volume;
    let mut soundpack = state.read().soundpack.clone();
    let mut stream_handler = OutputStream::try_default().ok();

    while let Ok(command) = receiver.recv() {
        match command {
            AudioCommand::SetEnabled(value) => {
                enabled = value;
            }
            AudioCommand::SetVolume(value) => {
                volume = value;
            }
            AudioCommand::SetSoundpack(pack) => {
                soundpack = pack;
            }
            AudioCommand::PlayLabels(labels) => {
                if !enabled {
                    continue;
                }
                let Some(pack) = soundpack.as_ref() else {
                    continue;
                };
                let Some(source) = pack.source_for_labels(&labels) else {
                    continue;
                };

                if stream_handler.is_none() {
                    stream_handler = OutputStream::try_default().ok();
                }

                let Some(sink) = build_sink(&mut stream_handler) else {
                    continue;
                };

                sink.set_volume(volume);
                sink.append(source);
                sink.detach();
            }
        }
    }
}

fn build_sink(
    stream_handler: &mut Option<(OutputStream, rodio::OutputStreamHandle)>,
) -> Option<Sink> {
    let handler = stream_handler.as_ref()?;
    match Sink::try_new(&handler.1) {
        Ok(sink) => Some(sink),
        Err(PlayError::NoDevice) => {
            *stream_handler = OutputStream::try_default().ok();
            stream_handler
                .as_ref()
                .and_then(|new_handler| Sink::try_new(&new_handler.1).ok())
        }
        Err(_) => None,
    }
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
