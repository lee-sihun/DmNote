// lib와 bin의 독립 state 모듈 컴파일
#![allow(dead_code)]

use std::ffi::CStr;
use std::os::raw::c_char;

use objc2::runtime::{AnyClass, AnyObject};
use objc2::{msg_send, sel};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::Runtime;

// WKWebView 렌더링을 60fps 근처로 묶는 WebKit feature flag
const FRAME_RATE_CAP_FEATURE: &CStr = c"PreferPageRenderingUpdatesNear60FPSEnabled";

// ProMotion(120Hz+) 디스플레이 대응: 웹뷰 생성 시점에 60fps 캡 해제
// private API 기반이라 WebKit 변경으로 사라질 수 있음, 실패 시 기본 60fps 유지
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("webview-frame-rate")
        .on_webview_ready(|webview| {
            let label = webview.label().to_string();
            let result = webview.with_webview(move |platform_webview| {
                match unsafe { disable_frame_rate_cap(platform_webview.inner().cast()) } {
                    Ok(()) => {
                        log::info!("[frame-rate] uncapped rendering for webview '{label}'")
                    }
                    Err(reason) => {
                        log::warn!("[frame-rate] keeping 60fps cap for webview '{label}': {reason}")
                    }
                }
            });
            if let Err(err) = result {
                log::warn!("[frame-rate] failed to access webview handle: {err}");
            }
        })
        .build()
}

// with_webview 클로저가 메인 스레드에서 실행되므로 WKPreferences 접근 요건 충족
unsafe fn disable_frame_rate_cap(webview: *mut AnyObject) -> Result<(), &'static str> {
    if webview.is_null() {
        return Err("webview handle is null");
    }
    let configuration: *mut AnyObject = msg_send![webview, configuration];
    if configuration.is_null() {
        return Err("configuration unavailable");
    }
    let preferences: *mut AnyObject = msg_send![configuration, preferences];
    if preferences.is_null() {
        return Err("preferences unavailable");
    }
    let Some(preferences_class) = AnyClass::get(c"WKPreferences") else {
        return Err("WKPreferences class not found");
    };

    // private selector 존재 확인, 사라졌으면 조용히 폴백
    let has_features: bool = msg_send![preferences_class, respondsToSelector: sel!(_features)];
    let has_setter: bool =
        msg_send![preferences, respondsToSelector: sel!(_setEnabled:forFeature:)];
    if !has_features || !has_setter {
        return Err("WebKit feature API unavailable");
    }

    let features: *mut AnyObject = msg_send![preferences_class, _features];
    if features.is_null() {
        return Err("feature list unavailable");
    }
    let count: usize = msg_send![features, count];
    for index in 0..count {
        let feature: *mut AnyObject = msg_send![features, objectAtIndex: index];
        if feature.is_null() {
            continue;
        }
        let has_key: bool = msg_send![feature, respondsToSelector: sel!(key)];
        if !has_key {
            continue;
        }
        let key: *mut AnyObject = msg_send![feature, key];
        if key.is_null() {
            continue;
        }
        let key_chars: *const c_char = msg_send![key, UTF8String];
        if key_chars.is_null() {
            continue;
        }
        if CStr::from_ptr(key_chars) != FRAME_RATE_CAP_FEATURE {
            continue;
        }

        let _: () = msg_send![preferences, _setEnabled: false, forFeature: feature];

        // 게터가 살아 있으면 실제로 꺼졌는지 재확인
        let has_getter: bool =
            msg_send![preferences, respondsToSelector: sel!(_isEnabledForFeature:)];
        if has_getter {
            let still_enabled: bool = msg_send![preferences, _isEnabledForFeature: feature];
            if still_enabled {
                return Err("feature flag did not change");
            }
        }
        return Ok(());
    }
    Err("frame rate cap feature not found")
}
