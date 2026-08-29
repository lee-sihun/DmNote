/// ASIO 기본 버퍼 크기(프레임). 미지정 시 이 값으로 고정 오픈
#[cfg(any(test, all(windows, feature = "asio-backend")))]
const DEFAULT_BUFFER_FRAMES: u32 = 64;

use super::{AudioSinkOpenError, AudioSinkResult, StreamHandler};

pub(super) const fn backend_available() -> bool {
    cfg!(all(windows, feature = "asio-backend"))
}

pub(super) fn normalize_driver_name(driver_name: &str) -> String {
    driver_name.trim().to_string()
}

pub(super) fn normalize_buffer_size(buffer_size: Option<u32>) -> Option<u32> {
    buffer_size.filter(|frames| *frames > 0)
}

#[cfg(any(test, all(windows, feature = "asio-backend")))]
fn effective_buffer_frames(buffer_size: Option<u32>) -> u32 {
    normalize_buffer_size(buffer_size).unwrap_or(DEFAULT_BUFFER_FRAMES)
}

#[cfg(any(test, all(windows, feature = "asio-backend")))]
fn is_valid_output_config(sample_rate: u32, channels: u16) -> bool {
    sample_rate > 0 && channels > 0
}

#[cfg(any(test, all(windows, feature = "asio-backend")))]
fn normalize_driver_names(names: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut names = names
        .into_iter()
        .map(|name| normalize_driver_name(&name))
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();
    names
}

#[cfg(all(windows, feature = "asio-backend"))]
pub(super) fn open_audio_sink(
    driver_name: &str,
    buffer_size: Option<u32>,
) -> AudioSinkResult<StreamHandler> {
    use cpal::traits::{DeviceTrait, HostTrait};

    let driver_name = normalize_driver_name(driver_name);
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
            Ok(description) => normalize_driver_name(description.name()),
            Err(err) => {
                log::warn!("[KeySound] failed to read ASIO device name: {err}");
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
pub(super) fn open_audio_sink(
    _driver_name: &str,
    _buffer_size: Option<u32>,
) -> AudioSinkResult<StreamHandler> {
    Err(AudioSinkOpenError::AsioUnavailableBuild)
}

#[cfg(all(windows, feature = "asio-backend"))]
fn open_device_audio_sink(
    device: cpal::Device,
    buffer_size: Option<u32>,
) -> AudioSinkResult<StreamHandler> {
    try_open_asio_sink(device, effective_buffer_frames(buffer_size))
}

#[cfg(all(windows, feature = "asio-backend"))]
fn try_open_asio_sink(device: cpal::Device, buffer_size: u32) -> AudioSinkResult<StreamHandler> {
    use cpal::traits::DeviceTrait;
    use rodio::DeviceSinkBuilder;

    // 일부 드라이버(Realtek ASIO 등)는 클럭 미확립 상태에서 sample rate 0을 보고함.
    // rodio from_device 내부의 NonZero unwrap 패닉(release는 abort) 방지를 위한 사전 검증
    let default_config = device
        .default_output_config()
        .map_err(|err| AudioSinkOpenError::OpenFailed(anyhow::Error::new(err)))?;
    if !is_valid_output_config(default_config.sample_rate(), default_config.channels()) {
        return Err(AudioSinkOpenError::OpenFailed(anyhow::anyhow!(
            "ASIO 드라이버가 유효한 샘플레이트/채널 구성을 보고하지 않았습니다"
        )));
    }

    let (error, callback) = super::stream_error_callback("ASIO stream");
    let sink = DeviceSinkBuilder::from_device(device)
        .map_err(|err| AudioSinkOpenError::OpenFailed(anyhow::Error::new(err)))?
        .with_error_callback(callback)
        // 샘플레이트는 드라이버 현재값 유지, 버퍼만 명시 고정
        .with_buffer_size(cpal::BufferSize::Fixed(buffer_size))
        .open_stream()
        .map_err(|err| AudioSinkOpenError::OpenFailed(anyhow::Error::new(err)))?;

    let config = sink.config();
    log::info!(
        "[KeySound] ASIO 스트림 오픈: 요청 버퍼={}, 적용 sample_rate={}Hz, buffer={:?}",
        buffer_size,
        config.sample_rate().get(),
        config.buffer_size()
    );

    Ok(StreamHandler { sink, error })
}

#[cfg(all(windows, feature = "asio-backend"))]
pub(super) fn list_drivers() -> Vec<String> {
    use cpal::traits::{DeviceTrait, HostTrait};

    let Ok(host) = cpal::host_from_id(cpal::HostId::Asio) else {
        return Vec::new();
    };
    let Ok(devices) = host.output_devices() else {
        return Vec::new();
    };

    normalize_driver_names(devices.filter_map(|device| {
        let name = device
            .description()
            .ok()
            .map(|description| normalize_driver_name(description.name()))
            .filter(|name| !name.is_empty())?;
        match device.default_output_config() {
            Ok(config) if is_valid_output_config(config.sample_rate(), config.channels()) => {
                Some(name)
            }
            Ok(_) => {
                log::warn!("[KeySound] ASIO 드라이버 '{name}' 목록 제외: 유효하지 않은 샘플레이트/채널 보고");
                None
            }
            Err(err) => {
                log::warn!("[KeySound] ASIO 드라이버 '{name}' 목록 제외: 기본 구성 조회 실패 ({err})");
                None
            }
        }
    }))
}

#[cfg(not(all(windows, feature = "asio-backend")))]
pub(super) fn list_drivers() -> Vec<String> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::{
        backend_available, effective_buffer_frames, is_valid_output_config, normalize_buffer_size,
        normalize_driver_name, normalize_driver_names, DEFAULT_BUFFER_FRAMES,
    };
    #[cfg(not(all(windows, feature = "asio-backend")))]
    use super::{open_audio_sink, AudioSinkOpenError};

    #[test]
    fn driver_name_normalization_trims_only_outer_whitespace() {
        assert_eq!(
            normalize_driver_name("  Focusrite USB ASIO  "),
            "Focusrite USB ASIO"
        );
        assert_eq!(normalize_driver_name("  "), "");
    }

    #[test]
    fn buffer_normalization_rejects_zero_and_preserves_explicit_frames() {
        assert_eq!(normalize_buffer_size(None), None);
        assert_eq!(normalize_buffer_size(Some(0)), None);
        assert_eq!(normalize_buffer_size(Some(128)), Some(128));
    }

    #[test]
    fn effective_buffer_uses_default_only_for_missing_or_zero_values() {
        assert_eq!(effective_buffer_frames(None), DEFAULT_BUFFER_FRAMES);
        assert_eq!(effective_buffer_frames(Some(0)), DEFAULT_BUFFER_FRAMES);
        assert_eq!(effective_buffer_frames(Some(256)), 256);
    }

    #[test]
    fn output_config_requires_nonzero_sample_rate_and_channels() {
        assert!(is_valid_output_config(48_000, 2));
        assert!(!is_valid_output_config(0, 2));
        assert!(!is_valid_output_config(48_000, 0));
    }

    #[test]
    fn driver_catalog_is_trimmed_sorted_deduplicated_and_nonempty() {
        assert_eq!(
            normalize_driver_names([
                " Zebra ASIO ".to_string(),
                "Alpha ASIO".to_string(),
                "".to_string(),
                "Alpha ASIO ".to_string(),
            ]),
            vec!["Alpha ASIO".to_string(), "Zebra ASIO".to_string()]
        );
    }

    #[test]
    fn backend_capability_matches_compile_configuration() {
        assert_eq!(
            backend_available(),
            cfg!(all(windows, feature = "asio-backend"))
        );
    }

    #[cfg(not(all(windows, feature = "asio-backend")))]
    #[test]
    fn unsupported_build_returns_the_typed_unavailable_error() {
        assert!(matches!(
            open_audio_sink("Focusrite USB ASIO", Some(64)),
            Err(AudioSinkOpenError::AsioUnavailableBuild)
        ));
    }
}
