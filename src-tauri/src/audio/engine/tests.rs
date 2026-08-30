
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};

use super::{
    asio_output_error_code, asio_output_error_message, open_initial_output_backend,
    open_system_device_audio_sink, output_fallback_error, startup_fallback_forgets,
    switch_output_backend_with_notification, AudioSinkOpenError, KeySoundEngine,
    KeySoundOutputBackend, ERROR_CODE_ASIO_DEVICE_NOT_FOUND, ERROR_CODE_ASIO_OPEN_FAILED,
    ERROR_CODE_ASIO_UNAVAILABLE_BUILD, ERROR_CODE_DEFAULT_OPEN_FAILED, ERROR_CODE_DEVICE_NOT_FOUND,
    ERROR_CODE_DEVICE_OPEN_FAILED,
};

#[test]
fn device_backend_normalizes_id_and_name() {
    assert_eq!(
        KeySoundOutputBackend::Device {
            id: "  coreaudio:device-id  ".to_string(),
            name: "  Speakers  ".to_string(),
        }
        .normalized(),
        KeySoundOutputBackend::Device {
            id: "coreaudio:device-id".to_string(),
            name: "Speakers".to_string(),
        }
    );
}

#[test]
fn asio_backend_normalizes_driver_name_and_zero_buffer() {
    assert_eq!(
        KeySoundOutputBackend::Asio {
            driver_name: "  Focusrite USB ASIO  ".to_string(),
            buffer_size: Some(0),
        }
        .normalized(),
        KeySoundOutputBackend::Asio {
            driver_name: "Focusrite USB ASIO".to_string(),
            buffer_size: None,
        }
    );
}

#[test]
fn asio_error_contract_distinguishes_build_device_and_open_failures() {
    let cases = [
        (
            AudioSinkOpenError::AsioUnavailableBuild,
            ERROR_CODE_ASIO_UNAVAILABLE_BUILD,
            "ASIO 미지원 빌드",
        ),
        (
            AudioSinkOpenError::AsioDeviceNotFound,
            ERROR_CODE_ASIO_DEVICE_NOT_FOUND,
            "ASIO 장치를 찾을 수 없습니다",
        ),
        (
            AudioSinkOpenError::DeviceNotFound,
            ERROR_CODE_DEVICE_NOT_FOUND,
            "출력 장치를 찾을 수 없습니다",
        ),
    ];

    for (error, expected_code, expected_message) in cases {
        assert_eq!(asio_output_error_code(&error), expected_code);
        assert_eq!(asio_output_error_message(&error), expected_message);
    }

    let open_error = AudioSinkOpenError::OpenFailed(anyhow::anyhow!("driver busy"));
    assert_eq!(
        asio_output_error_code(&open_error),
        ERROR_CODE_ASIO_OPEN_FAILED
    );
    assert_eq!(
        asio_output_error_message(&open_error),
        "ASIO 장치를 열 수 없어 기본 출력으로 재생합니다"
    );

    let backend = KeySoundOutputBackend::Asio {
        driver_name: "Focusrite USB ASIO".to_string(),
        buffer_size: Some(64),
    };
    assert_eq!(
        output_fallback_error(&backend, &open_error),
        (
            "ASIO 장치를 열 수 없어 기본 출력으로 재생합니다".to_string(),
            ERROR_CODE_ASIO_OPEN_FAILED.to_string(),
        )
    );
}

#[test]
fn invalid_device_id_is_reported_as_not_found() {
    let result = open_system_device_audio_sink("invalid-device-id", "Speakers");
    assert!(matches!(result, Err(AudioSinkOpenError::DeviceNotFound)));
}

#[test]
fn failed_device_selection_forgets_requested_backend_and_notifies() {
    let mut stream_handler = None;
    let notified = AtomicBool::new(false);
    let fallback_callback = |failed, settled| {
        assert_eq!(
            failed,
            KeySoundOutputBackend::Device {
                id: "invalid-device-id".to_string(),
                name: "Speakers".to_string(),
            }
        );
        assert_eq!(settled, KeySoundOutputBackend::DefaultDevice);
        notified.store(true, Ordering::Relaxed);
    };
    let output_state = switch_output_backend_with_notification(
        KeySoundOutputBackend::Device {
            id: "invalid-device-id".to_string(),
            name: "Speakers".to_string(),
        },
        &mut stream_handler,
        &fallback_callback,
    );

    assert_eq!(output_state.requested, KeySoundOutputBackend::DefaultDevice);
    assert!(notified.load(Ordering::Relaxed));
    if let Some(handler) = stream_handler.as_mut() {
        handler.sink.log_on_drop(false);
    }
}

#[test]
fn startup_fallback_forgets_only_missing_devices() {
    assert!(startup_fallback_forgets(ERROR_CODE_DEVICE_NOT_FOUND));
    assert!(startup_fallback_forgets(ERROR_CODE_ASIO_DEVICE_NOT_FOUND));
    assert!(!startup_fallback_forgets(ERROR_CODE_ASIO_OPEN_FAILED));
    assert!(!startup_fallback_forgets(ERROR_CODE_DEVICE_OPEN_FAILED));
    assert!(!startup_fallback_forgets(ERROR_CODE_DEFAULT_OPEN_FAILED));
    assert!(!startup_fallback_forgets(ERROR_CODE_ASIO_UNAVAILABLE_BUILD));
}

// 기동 시 장치 부재는 런타임과 같이 forget - 저장값이 기본 장치로 덮인다
#[test]
fn startup_forgets_missing_device_and_notifies() {
    let mut stream_handler = None;
    let notified = Arc::new(AtomicBool::new(false));
    let notified_for_callback = Arc::clone(&notified);
    let fallback_callback = move |_failed, _settled| {
        notified_for_callback.store(true, Ordering::Relaxed);
    };
    let output_state = open_initial_output_backend(
        KeySoundOutputBackend::Device {
            id: "invalid-device-id".to_string(),
            name: "Speakers".to_string(),
        },
        &mut stream_handler,
        &fallback_callback,
    );

    if let Some(handler) = stream_handler.as_mut() {
        handler.sink.log_on_drop(false);
    }
    // 기본 장치조차 열 수 없는 환경(헤드리스 CI)에서는 폴백 판정 자체가 성립하지 않는다
    if output_state.error_code.as_deref() == Some(ERROR_CODE_DEFAULT_OPEN_FAILED) {
        return;
    }
    assert_eq!(output_state.requested, KeySoundOutputBackend::DefaultDevice);
    assert!(notified.load(Ordering::Relaxed));
}

#[test]
fn set_output_backend_does_not_notify_fallback_callback() {
    let callback_count = Arc::new(AtomicUsize::new(0));
    let callback_count_for_engine = Arc::clone(&callback_count);
    let engine = KeySoundEngine::with_output_backend(
        KeySoundOutputBackend::DefaultDevice,
        Arc::new(move |_, _| {
            callback_count_for_engine.fetch_add(1, Ordering::Relaxed);
        }),
    );

    let output_state = engine.set_output_backend(KeySoundOutputBackend::Device {
        id: "invalid-device-id".to_string(),
        name: "Speakers".to_string(),
    });

    assert_eq!(output_state.requested, KeySoundOutputBackend::DefaultDevice);
    assert_eq!(callback_count.load(Ordering::Relaxed), 0);
}
