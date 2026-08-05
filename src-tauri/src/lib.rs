pub mod audio;
pub mod commands;
pub mod cursor;
pub mod custom_css;
pub mod defaults;
pub mod errors;
pub mod ipc;
pub mod keyboard;
pub mod models;
pub mod services;
pub mod state;

/// Windows 접근성 "텍스트 크기" 설정에 의한 WebView2 스케일링을 보상하는 줌 레벨을 계산
///
/// Windows의 접근성 → 텍스트 크기 설정은 WebView2(Chromium)에 추가 스케일링을 적용하여
/// 고정 크기 윈도우의 CSS 뷰포트가 줄어드는 문제를 유발합니다.
/// 예: 텍스트 크기 110% → 902px 윈도우의 뷰포트가 820px(902/1.1)로 축소
///
/// 이 함수는 `1.0 / textScaleFactor`를 반환하여 WebView2 줌에 적용하면
/// 추가 스케일링이 상쇄되어 의도한 뷰포트 크기가 유지됩니다.
pub fn compute_compensating_zoom() -> f64 {
    #[cfg(target_os = "windows")]
    {
        let scale = get_windows_text_scale_factor();
        if scale > 1.0 {
            log::info!(
                "[zoom-guard] Windows text scale factor detected: {scale:.4} ({}%)",
                (scale * 100.0).round()
            );
        }
        1.0 / scale
    }
    #[cfg(not(target_os = "windows"))]
    {
        1.0
    }
}

fn should_apply_zoom_for_platform(zoom: f64, is_macos: bool) -> bool {
    !is_macos || (zoom - 1.0).abs() >= f64::EPSILON
}

/// macOS WKWebView의 identity zoom은 선택·캐럿을 리셋하므로 생략
/// Windows는 이전 보정값에서 1.0으로 복귀할 수 있어 항상 적용
pub fn should_apply_compensating_zoom(zoom: f64) -> bool {
    should_apply_zoom_for_platform(zoom, cfg!(target_os = "macos"))
}

/// Windows 레지스트리에서 접근성 텍스트 크기 비율을 읽습니다.
/// 레지스트리 키: HKCU\SOFTWARE\Microsoft\Accessibility\TextScaleFactor (DWORD, 100~225)
/// 읽기에 실패하거나 설정이 없으면 1.0(100%)을 반환합니다.
#[cfg(target_os = "windows")]
fn get_windows_text_scale_factor() -> f64 {
    use windows::core::w;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ, REG_DWORD,
        REG_VALUE_TYPE,
    };

    unsafe {
        let mut key_handle = HKEY::default();
        let result = RegOpenKeyExW(
            HKEY_CURRENT_USER,
            w!("SOFTWARE\\Microsoft\\Accessibility"),
            None,
            KEY_READ,
            &mut key_handle,
        );
        if result.is_err() {
            return 1.0;
        }

        let mut data: u32 = 0;
        let mut data_size: u32 = std::mem::size_of::<u32>() as u32;
        let mut data_type = REG_VALUE_TYPE::default();

        let result = RegQueryValueExW(
            key_handle,
            w!("TextScaleFactor"),
            None,
            Some(&mut data_type),
            Some(&mut data as *mut u32 as *mut u8),
            Some(&mut data_size),
        );

        let _ = RegCloseKey(key_handle);

        if result.is_err() || data_type != REG_DWORD {
            return 1.0;
        }

        let factor = data as f64 / 100.0;
        if factor.is_finite() && (1.0..=2.25).contains(&factor) {
            factor
        } else {
            1.0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::should_apply_zoom_for_platform;

    #[test]
    fn macos_skips_only_identity_zoom() {
        assert!(!should_apply_zoom_for_platform(1.0, true));
        assert!(should_apply_zoom_for_platform(0.8, true));
    }

    #[test]
    fn windows_applies_identity_zoom_after_a_previous_compensation() {
        assert!(should_apply_zoom_for_platform(0.8, false));
        assert!(should_apply_zoom_for_platform(1.0, false));
    }
}
