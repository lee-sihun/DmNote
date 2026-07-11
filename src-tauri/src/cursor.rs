//! macOS 커서 설정 읽기 모듈
//! NSUserDefaults에서 com.apple.universalaccess 도메인의 커서 설정을 읽어옵니다.

#[cfg(target_os = "macos")]
use objc::{
    class, msg_send,
    runtime::{Object, BOOL, YES},
    sel, sel_impl,
};
#[cfg(target_os = "macos")]
use std::{
    ffi::CString,
    os::raw::{c_char, c_void},
    ptr,
};

#[cfg(target_os = "macos")]
type CFStringRef = *const c_void;
#[cfg(target_os = "macos")]
type CFPropertyListRef = *const c_void;
#[cfg(target_os = "macos")]
type CFTypeRef = *const c_void;

#[cfg(target_os = "macos")]
const CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

#[cfg(target_os = "macos")]
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringCreateWithCString(
        alloc: *const c_void,
        c_str: *const c_char,
        encoding: u32,
    ) -> CFStringRef;
    fn CFPreferencesCopyValue(
        key: CFStringRef,
        application_id: CFStringRef,
        user: CFStringRef,
        host: CFStringRef,
    ) -> CFPropertyListRef;
    fn CFRelease(cf: CFTypeRef);
    static kCFPreferencesCurrentUser: CFStringRef;
    static kCFPreferencesCurrentHost: CFStringRef;
    static kCFPreferencesAnyHost: CFStringRef;
}

/// macOS 시스템 커서 설정
#[derive(Debug, Clone, serde::Serialize)]
pub struct MacOSCursorSettings {
    /// 커서 크기 배율 (1.0 ~ 4.0, 기본값 1.0)
    pub size: f64,
    /// 커서 채우기 색상 (RGB 배열 [r, g, b], 각 0.0~1.0)
    pub fill_color: Option<[f64; 3]>,
    /// 커서 테두리 색상 (RGB 배열 [r, g, b], 각 0.0~1.0)
    pub outline_color: Option<[f64; 3]>,
}

impl Default for MacOSCursorSettings {
    fn default() -> Self {
        Self {
            size: 1.0,
            fill_color: Some([0.0, 0.0, 0.0]),    // 기본 검정
            outline_color: Some([1.0, 1.0, 1.0]), // 기본 흰색
        }
    }
}

#[cfg(target_os = "macos")]
pub fn get_macos_cursor_settings() -> MacOSCursorSettings {
    unsafe {
        let mut settings = MacOSCursorSettings::default();

        // com.apple.universalaccess 도메인에서 설정 읽기
        let user_defaults: *mut Object = msg_send![class!(NSUserDefaults), standardUserDefaults];
        let domain = create_nsstring("com.apple.universalaccess");
        let prefs: *mut Object = msg_send![user_defaults, persistentDomainForName: domain];
        let suite_defaults = create_suite_defaults("com.apple.universalaccess");

        // 커서 크기 읽기 (mouseDriverCursorSize)
        let size =
            read_double_from_cf_preferences("mouseDriverCursorSize", kCFPreferencesCurrentHost)
                .or_else(|| {
                    read_double_from_cf_preferences("mouseDriverCursorSize", kCFPreferencesAnyHost)
                })
                .or_else(|| read_double_from_user_defaults(suite_defaults, "mouseDriverCursorSize"))
                .or_else(|| read_double_from_prefs(prefs, "mouseDriverCursorSize"));
        if let Some(size) = size {
            if (1.0..=4.0).contains(&size) {
                settings.size = size;
            }
        }

        let fill_keys = [
            "mouseDriverCursorFillColor",
            "mouseDriverCursorColor",
            "cursorFill",
            "cursorFillColor",
        ];
        let outline_keys = [
            "mouseDriverCursorOutlineColor",
            "cursorOutline",
            "cursorOutlineColor",
        ];

        // 커서 채우기 색상 읽기
        if let Some(color) =
            read_color_from_cf_preferences_keys(&fill_keys, kCFPreferencesCurrentHost)
                .or_else(|| read_color_from_cf_preferences_keys(&fill_keys, kCFPreferencesAnyHost))
                .or_else(|| read_color_from_user_defaults_keys(suite_defaults, &fill_keys))
                .or_else(|| read_color_from_prefs_keys(prefs, &fill_keys))
        {
            settings.fill_color = Some(color);
        }

        // 커서 테두리 색상 읽기
        if let Some(color) =
            read_color_from_cf_preferences_keys(&outline_keys, kCFPreferencesCurrentHost)
                .or_else(|| {
                    read_color_from_cf_preferences_keys(&outline_keys, kCFPreferencesAnyHost)
                })
                .or_else(|| read_color_from_user_defaults_keys(suite_defaults, &outline_keys))
                .or_else(|| read_color_from_prefs_keys(prefs, &outline_keys))
        {
            settings.outline_color = Some(color);
        }

        release_obj(suite_defaults);

        settings
    }
}

#[cfg(target_os = "macos")]
unsafe fn read_color_from_prefs_keys(prefs: *mut Object, keys: &[&str]) -> Option<[f64; 3]> {
    for key in keys {
        if let Some(color) = read_color_from_prefs(prefs, key) {
            return Some(color);
        }
    }
    None
}

#[cfg(target_os = "macos")]
unsafe fn read_color_from_prefs(prefs: *mut Object, key: &str) -> Option<[f64; 3]> {
    if prefs.is_null() {
        return None;
    }
    let color_key = create_nsstring(key);
    let color_value: *mut Object = msg_send![prefs, objectForKey: color_key];
    if color_value.is_null() {
        return None;
    }
    read_color_from_value(color_value)
}

#[cfg(target_os = "macos")]
unsafe fn read_color_from_user_defaults_keys(
    defaults: *mut Object,
    keys: &[&str],
) -> Option<[f64; 3]> {
    if defaults.is_null() {
        return None;
    }
    for key in keys {
        if let Some(color) = read_color_from_user_defaults(defaults, key) {
            return Some(color);
        }
    }
    None
}

#[cfg(target_os = "macos")]
unsafe fn read_color_from_user_defaults(defaults: *mut Object, key: &str) -> Option<[f64; 3]> {
    if defaults.is_null() {
        return None;
    }
    let key_obj = create_nsstring(key);
    let data: *mut Object = msg_send![defaults, dataForKey: key_obj];
    if !data.is_null() {
        if let Some(color) = read_color_from_value(data) {
            return Some(color);
        }
    }
    let value: *mut Object = msg_send![defaults, objectForKey: key_obj];
    if value.is_null() {
        return None;
    }
    read_color_from_value(value)
}

#[cfg(target_os = "macos")]
unsafe fn read_color_from_cf_preferences_keys(
    keys: &[&str],
    host: CFStringRef,
) -> Option<[f64; 3]> {
    for key in keys {
        if let Some(color) = read_color_from_cf_preferences(key, host) {
            return Some(color);
        }
    }
    None
}

#[cfg(target_os = "macos")]
unsafe fn read_color_from_cf_preferences(key: &str, host: CFStringRef) -> Option<[f64; 3]> {
    let value = read_cf_preferences_value(key, host);
    if value.is_null() {
        return None;
    }
    let color = read_color_from_value(value);
    cf_release_if_needed(value as CFTypeRef);
    color
}

#[cfg(target_os = "macos")]
unsafe fn read_color_from_value(color_value: *mut Object) -> Option<[f64; 3]> {
    if let Some(color) = rgb_from_object(color_value) {
        return Some(color);
    }

    let nsdata_class = class!(NSData);
    let is_data: BOOL = msg_send![color_value, isKindOfClass: nsdata_class];
    if is_data == YES {
        if let Some(unarchived) = unarchive_nscolor(color_value) {
            if let Some(color) = rgb_from_object(unarchived) {
                return Some(color);
            }
        }
    }

    let nsdict_class = class!(NSDictionary);
    let is_dict: BOOL = msg_send![color_value, isKindOfClass: nsdict_class];
    if is_dict == YES {
        if let Some(color) = color_from_dict(color_value) {
            return Some(color);
        }
    }

    None
}

#[cfg(target_os = "macos")]
unsafe fn read_double_from_prefs(prefs: *mut Object, key: &str) -> Option<f64> {
    if prefs.is_null() {
        return None;
    }
    let size_key = create_nsstring(key);
    let size_value: *mut Object = msg_send![prefs, objectForKey: size_key];
    if size_value.is_null() {
        return None;
    }
    let size: f64 = msg_send![size_value, doubleValue];
    Some(size)
}

#[cfg(target_os = "macos")]
unsafe fn read_double_from_user_defaults(defaults: *mut Object, key: &str) -> Option<f64> {
    if defaults.is_null() {
        return None;
    }
    let key_obj = create_nsstring(key);
    let value: *mut Object = msg_send![defaults, objectForKey: key_obj];
    if value.is_null() {
        return None;
    }
    let number: f64 = msg_send![value, doubleValue];
    Some(number)
}

#[cfg(target_os = "macos")]
unsafe fn read_double_from_cf_preferences(key: &str, host: CFStringRef) -> Option<f64> {
    let value = read_cf_preferences_value(key, host);
    if value.is_null() {
        return None;
    }
    let number: f64 = msg_send![value, doubleValue];
    cf_release_if_needed(value as CFTypeRef);
    Some(number)
}

#[cfg(target_os = "macos")]
unsafe fn rgb_from_object(color_value: *mut Object) -> Option<[f64; 3]> {
    if let Some(color) = nscolor_to_rgb(color_value) {
        return Some(color);
    }

    let responds: BOOL = msg_send![color_value, respondsToSelector: sel!(red)];
    if responds == YES {
        let r: f64 = msg_send![color_value, red];
        let g: f64 = msg_send![color_value, green];
        let b: f64 = msg_send![color_value, blue];
        return Some([r, g, b]);
    }

    None
}

#[cfg(target_os = "macos")]
unsafe fn unarchive_nscolor(data: *mut Object) -> Option<*mut Object> {
    let unarchiver_class = class!(NSKeyedUnarchiver);
    let supports_secure: BOOL = msg_send![
        unarchiver_class,
        respondsToSelector: sel!(unarchivedObjectOfClass:fromData:error:)
    ];

    if supports_secure == YES {
        let mut error: *mut Object = ptr::null_mut();
        let color_class = class!(NSColor);
        let unarchived: *mut Object = msg_send![
            unarchiver_class,
            unarchivedObjectOfClass: color_class
            fromData: data
            error: &mut error
        ];
        if !unarchived.is_null() {
            return Some(unarchived);
        }
    }

    let keyed_legacy: *mut Object = msg_send![unarchiver_class, unarchiveObjectWithData: data];
    if !keyed_legacy.is_null() {
        return Some(keyed_legacy);
    }

    let unarchiver_class = class!(NSUnarchiver);
    let legacy: *mut Object = msg_send![unarchiver_class, unarchiveObjectWithData: data];
    if legacy.is_null() {
        None
    } else {
        Some(legacy)
    }
}

#[cfg(target_os = "macos")]
unsafe fn read_cf_preferences_value(key: &str, host: CFStringRef) -> *mut Object {
    let key_ref = cfstring_from_str(key);
    let app_ref = cfstring_from_str("com.apple.universalaccess");
    if key_ref.is_null() || app_ref.is_null() {
        cf_release_if_needed(key_ref as CFTypeRef);
        cf_release_if_needed(app_ref as CFTypeRef);
        return ptr::null_mut();
    }
    let value = CFPreferencesCopyValue(key_ref, app_ref, kCFPreferencesCurrentUser, host);
    cf_release_if_needed(key_ref as CFTypeRef);
    cf_release_if_needed(app_ref as CFTypeRef);
    value as *mut Object
}

#[cfg(target_os = "macos")]
unsafe fn cfstring_from_str(s: &str) -> CFStringRef {
    let cstring = CString::new(s).unwrap_or_else(|_| CString::new("").unwrap());
    CFStringCreateWithCString(ptr::null(), cstring.as_ptr(), CF_STRING_ENCODING_UTF8)
}

#[cfg(target_os = "macos")]
unsafe fn cf_release_if_needed(value: CFTypeRef) {
    if !value.is_null() {
        CFRelease(value);
    }
}

#[cfg(target_os = "macos")]
unsafe fn nscolor_to_rgb(color: *mut Object) -> Option<[f64; 3]> {
    let nscolor_class = class!(NSColor);
    let is_color: BOOL = msg_send![color, isKindOfClass: nscolor_class];
    if is_color != YES {
        return None;
    }

    let color_space = class!(NSColorSpace);
    let srgb_space: *mut Object = msg_send![color_space, sRGBColorSpace];
    let converted: *mut Object = msg_send![color, colorUsingColorSpace: srgb_space];

    if converted.is_null() {
        return None;
    }

    let r: f64 = msg_send![converted, redComponent];
    let g: f64 = msg_send![converted, greenComponent];
    let b: f64 = msg_send![converted, blueComponent];

    Some([r, g, b])
}

#[cfg(target_os = "macos")]
unsafe fn color_from_dict(dict: *mut Object) -> Option<[f64; 3]> {
    let r = read_component_from_dict(dict, &["Red Component", "red", "Red", "NSRed"])?;
    let g = read_component_from_dict(dict, &["Green Component", "green", "Green", "NSGreen"])?;
    let b = read_component_from_dict(dict, &["Blue Component", "blue", "Blue", "NSBlue"])?;
    Some([r, g, b])
}

#[cfg(target_os = "macos")]
unsafe fn read_component_from_dict(dict: *mut Object, keys: &[&str]) -> Option<f64> {
    for key in keys {
        let key_obj = create_nsstring(key);
        let value: *mut Object = msg_send![dict, objectForKey: key_obj];
        if value.is_null() {
            continue;
        }
        let number: f64 = msg_send![value, doubleValue];
        return Some(number);
    }
    None
}

#[cfg(target_os = "macos")]
unsafe fn create_nsstring(s: &str) -> *mut Object {
    let cls = class!(NSString);
    let cstring = CString::new(s).unwrap_or_else(|_| CString::new("").unwrap());
    msg_send![cls, stringWithUTF8String: cstring.as_ptr()]
}

#[cfg(target_os = "macos")]
unsafe fn create_suite_defaults(suite: &str) -> *mut Object {
    let suite_name = create_nsstring(suite);
    let defaults: *mut Object = msg_send![class!(NSUserDefaults), alloc];
    let defaults: *mut Object = msg_send![defaults, initWithSuiteName: suite_name];
    defaults
}

#[cfg(target_os = "macos")]
unsafe fn release_obj(obj: *mut Object) {
    if !obj.is_null() {
        let _: () = msg_send![obj, release];
    }
}

#[cfg(not(target_os = "macos"))]
pub fn get_macos_cursor_settings() -> MacOSCursorSettings {
    MacOSCursorSettings::default()
}

/// 색상 배열을 HEX 문자열로 변환
pub fn rgb_to_hex(rgb: [f64; 3]) -> String {
    let r = (rgb[0] * 255.0).round() as u8;
    let g = (rgb[1] * 255.0).round() as u8;
    let b = (rgb[2] * 255.0).round() as u8;
    format!("#{:02X}{:02X}{:02X}", r, g, b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rgb_to_hex() {
        assert_eq!(rgb_to_hex([0.0, 0.0, 0.0]), "#000000");
        assert_eq!(rgb_to_hex([1.0, 1.0, 1.0]), "#FFFFFF");
        assert_eq!(rgb_to_hex([1.0, 0.0, 0.0]), "#FF0000");
    }
}
