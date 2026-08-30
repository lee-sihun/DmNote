use super::*;

pub(super) fn get_or_load_cached_clip(
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
pub(super) struct LoadedSoundpack {
    pub(super) segments: HashMap<String, Arc<[f32]>>,
    fallback: Option<Arc<[f32]>>,
    channels: u16,
    sample_rate: u32,
}

impl LoadedSoundpack {
    pub(super) fn from_dir(soundpack_dir: &Path) -> Result<Self> {
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

    pub(super) fn source_for_labels(&self, labels: &[String]) -> Option<AudioSource> {
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
pub(super) struct AudioSource {
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
    pub(super) fn new(samples: Arc<[f32]>, channels: u16, sample_rate: u32) -> Self {
        Self {
            samples,
            channels,
            sample_rate,
            gain: 1.0,
            pos: 0,
        }
    }

    pub(super) fn with_gain(mut self, gain: f32) -> Self {
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
