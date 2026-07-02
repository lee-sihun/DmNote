//! HID 입력 처리 (Windows Raw Input).
//! WM_INPUT(RIM_TYPEHID)에서 preparsed/caps 기반으로 버튼·축을 동적 디코딩.
//! - 버튼: 엣지(down/up) 감지 → HookMessage(device=Gamepad, label="HIDB:vid:pid:page:usage")
//! - 축(노브): 절대 raw 값을 시간 윈도우로 throttle → HidAxisMessage(axis_id, value, full)
//!   wrap 델타 계산·누적은 프론트엔드가 수행(절대값은 멱등 → 드롭/멀티윈도우에 강건).
//!
//! 데몬은 같은 메시지 루프에서 키보드/마우스도 처리하므로 축 전송은 throttle 필수.

use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use std::io::Write;
use std::mem::size_of;
use std::time::{SystemTime, UNIX_EPOCH};

use windows::Win32::Devices::HumanInterfaceDevice::{
    HidP_GetButtonCaps, HidP_GetCaps, HidP_GetUsageValue, HidP_GetUsages, HidP_GetValueCaps,
    HidP_Input, HidP_MaxUsageListLength, HIDP_BUTTON_CAPS, HIDP_CAPS, HIDP_STATUS_SUCCESS,
    HIDP_VALUE_CAPS, PHIDP_PREPARSED_DATA,
};
use windows::Win32::Foundation::HANDLE;
use windows::Win32::UI::Input::{
    GetRawInputDeviceInfoW, RAWINPUT, RIDI_DEVICEINFO, RIDI_PREPARSEDDATA, RID_DEVICE_INFO,
    RIM_TYPEHID,
};

use crate::ipc::{HidAxisMessage, HookKeyState, HookMessage, InputDeviceKind};

/// 축 값 전송 최소 간격(ms) — 고빈도 노브 입력이 파이프/입력 스레드를 막지 않도록.
const AXIS_THROTTLE_MS: u64 = 12;

type Sink = Box<dyn Write + Send>;

/// 디바이스별 정적 정보 (preparsed data + caps 캐시)
struct DeviceCaps {
    preparsed: Vec<u8>,
    button_caps: Vec<HIDP_BUTTON_CAPS>,
    value_caps: Vec<HIDP_VALUE_CAPS>,
    vid: u16,
    pid: u16,
}

impl DeviceCaps {
    fn preparsed_ptr(&self) -> PHIDP_PREPARSED_DATA {
        PHIDP_PREPARSED_DATA(self.preparsed.as_ptr() as isize)
    }
}

/// 축 throttle 상태
#[derive(Default, Clone, Copy)]
struct AxisThrottle {
    last_value: u32,
    last_emit_ms: u64,
    sent: bool,
}

/// 디바이스별 동적 상태 (엣지/변화/throttle)
#[derive(Default)]
struct DeviceState {
    prev_buttons: HashSet<(u16, u16)>,
    prev_raw: Vec<u8>,
    axis: HashMap<(u16, u16), AxisThrottle>,
}

pub struct HidProcessor {
    devices: HashMap<usize, DeviceCaps>,
    states: HashMap<usize, DeviceState>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl HidProcessor {
    pub fn new() -> Self {
        Self {
            devices: HashMap::new(),
            states: HashMap::new(),
        }
    }

    /// WM_INPUT (RIM_TYPEHID) 진입점
    pub fn handle_hid(&mut self, raw: &RAWINPUT, hdevice: HANDLE, sink: &mut Sink) {
        let key = hdevice.0 as usize;
        if let std::collections::hash_map::Entry::Vacant(e) = self.devices.entry(key) {
            match build_device_caps(hdevice) {
                Some(caps) => {
                    e.insert(caps);
                    self.states.insert(key, DeviceState::default());
                }
                None => return,
            }
        }

        // RAWHID: dwSizeHid 크기의 리포트가 dwCount개 연속
        let hid = unsafe { raw.data.hid };
        let size = hid.dwSizeHid as usize;
        let count = hid.dwCount as usize;
        if size == 0 || count == 0 {
            return;
        }
        let base = hid.bRawData.as_ptr();

        for i in 0..count {
            let report = unsafe { std::slice::from_raw_parts(base.add(i * size), size) };
            self.decode_report(key, report, sink);
        }
    }

    fn decode_report(&mut self, key: usize, report: &[u8], sink: &mut Sink) {
        // 동일 리포트 반복 skip — 상수 주기 전송 디바이스의 폭주 방지
        {
            let state = self.states.entry(key).or_default();
            if state.prev_raw == report {
                return;
            }
            state.prev_raw = report.to_vec();
        }

        let Some(caps) = self.devices.get(&key) else {
            return;
        };
        let preparsed = caps.preparsed_ptr();
        let vid = caps.vid;
        let pid = caps.pid;

        // --- 버튼: 현재 눌린 (page, usage) 집합 ---
        let mut current: HashSet<(u16, u16)> = HashSet::new();
        let mut pages: HashSet<u16> = HashSet::new();
        for bc in &caps.button_caps {
            pages.insert(bc.UsagePage);
        }
        for page in pages {
            let max = unsafe { HidP_MaxUsageListLength(HidP_Input, Some(page), preparsed) };
            if max == 0 {
                continue;
            }
            let mut usages = vec![0u16; max as usize];
            let mut len = max;
            // 페이지별 신규 복사 — HidP_GetUsages가 &mut 버퍼를 받으므로 상호 오염 방지
            let mut page_buf = report.to_vec();
            let status = unsafe {
                HidP_GetUsages(
                    HidP_Input,
                    page,
                    None,
                    usages.as_mut_ptr(),
                    &mut len,
                    preparsed,
                    &mut page_buf,
                )
            };
            if status == HIDP_STATUS_SUCCESS {
                for &u in usages.iter().take(len as usize) {
                    current.insert((page, u));
                }
            }
        }

        // --- 축: (page, usage, raw value, wrap modulus) ---
        let mut axis_values: Vec<(u16, u16, u32, u32)> = Vec::new();
        for vc in &caps.value_caps {
            let page = vc.UsagePage;
            let usage = if vc.IsRange {
                unsafe { vc.Anonymous.Range.UsageMin }
            } else {
                unsafe { vc.Anonymous.NotRange.Usage }
            };
            let mut raw_value: u32 = 0;
            let status = unsafe {
                HidP_GetUsageValue(
                    HidP_Input,
                    page,
                    None,
                    usage,
                    &mut raw_value,
                    preparsed,
                    report,
                )
            };
            if status != HIDP_STATUS_SUCCESS {
                continue;
            }
            // wrap modulus: logicalMin 0이면 logicalMax+1, 아니면 bit 폭
            let full = if vc.LogicalMin == 0 && vc.LogicalMax > 0 {
                vc.LogicalMax as u32 + 1
            } else {
                1u32 << (vc.BitSize.min(31))
            };
            axis_values.push((page, usage, raw_value, full));
        }

        // caps 차용 종료 — 이후 상태(states) 갱신 + 전송
        let now = now_ms();
        let state = self.states.entry(key).or_default();

        // 버튼 엣지
        let down: Vec<(u16, u16)> = current.difference(&state.prev_buttons).copied().collect();
        let up: Vec<(u16, u16)> = state.prev_buttons.difference(&current).copied().collect();
        state.prev_buttons = current;

        for (page, usage) in down {
            let label = button_label(vid, pid, page, usage);
            let _ = super::write_message(sink, &button_msg(label, HookKeyState::Down));
        }
        for (page, usage) in up {
            let label = button_label(vid, pid, page, usage);
            let _ = super::write_message(sink, &button_msg(label, HookKeyState::Up));
        }

        // 축 throttle 전송
        for (page, usage, value, full) in axis_values {
            let th = state.axis.entry((page, usage)).or_default();
            let changed = !th.sent || th.last_value != value;
            if changed && now.saturating_sub(th.last_emit_ms) >= AXIS_THROTTLE_MS {
                th.last_value = value;
                th.last_emit_ms = now;
                th.sent = true;
                let _ = super::write_axis(
                    sink,
                    &HidAxisMessage {
                        axis_id: axis_label(vid, pid, page, usage),
                        value,
                        full,
                    },
                );
            }
        }
    }
}

fn button_label(vid: u16, pid: u16, page: u16, usage: u16) -> String {
    format!("HIDB:{:04x}:{:04x}:{}:{}", vid, pid, page, usage)
}

fn axis_label(vid: u16, pid: u16, page: u16, usage: u16) -> String {
    format!("HIDA:{:04x}:{:04x}:{}:{}", vid, pid, page, usage)
}

fn button_msg(label: String, state: HookKeyState) -> HookMessage {
    HookMessage {
        device: InputDeviceKind::Gamepad,
        labels: vec![label],
        state,
        vk_code: None,
        scan_code: None,
        flags: None,
    }
}

/// 신규 디바이스 caps 구축 (RIDI_* 조회 + HidP_GetCaps)
fn build_device_caps(hdevice: HANDLE) -> Option<DeviceCaps> {
    unsafe {
        // preparsed data
        let mut size: u32 = 0;
        GetRawInputDeviceInfoW(Some(hdevice), RIDI_PREPARSEDDATA, None, &mut size);
        if size == 0 {
            return None;
        }
        let mut preparsed = vec![0u8; size as usize];
        let r = GetRawInputDeviceInfoW(
            Some(hdevice),
            RIDI_PREPARSEDDATA,
            Some(preparsed.as_mut_ptr() as *mut c_void),
            &mut size,
        );
        if r == u32::MAX {
            return None;
        }
        let preparsed_ptr = PHIDP_PREPARSED_DATA(preparsed.as_ptr() as isize);

        let mut caps = HIDP_CAPS::default();
        if HidP_GetCaps(preparsed_ptr, &mut caps) != HIDP_STATUS_SUCCESS {
            return None;
        }

        let mut button_caps = Vec::new();
        if caps.NumberInputButtonCaps > 0 {
            let mut len = caps.NumberInputButtonCaps;
            let mut buf = vec![HIDP_BUTTON_CAPS::default(); len as usize];
            if HidP_GetButtonCaps(HidP_Input, buf.as_mut_ptr(), &mut len, preparsed_ptr)
                == HIDP_STATUS_SUCCESS
            {
                buf.truncate(len as usize);
                button_caps = buf;
            }
        }

        let mut value_caps = Vec::new();
        if caps.NumberInputValueCaps > 0 {
            let mut len = caps.NumberInputValueCaps;
            let mut buf = vec![HIDP_VALUE_CAPS::default(); len as usize];
            if HidP_GetValueCaps(HidP_Input, buf.as_mut_ptr(), &mut len, preparsed_ptr)
                == HIDP_STATUS_SUCCESS
            {
                buf.truncate(len as usize);
                value_caps = buf;
            }
        }

        let (vid, pid) = read_device_info(hdevice);

        Some(DeviceCaps {
            preparsed,
            button_caps,
            value_caps,
            vid,
            pid,
        })
    }
}

unsafe fn read_device_info(hdevice: HANDLE) -> (u16, u16) {
    let mut info = RID_DEVICE_INFO {
        cbSize: size_of::<RID_DEVICE_INFO>() as u32,
        ..Default::default()
    };
    let mut size = size_of::<RID_DEVICE_INFO>() as u32;
    let r = GetRawInputDeviceInfoW(
        Some(hdevice),
        RIDI_DEVICEINFO,
        Some(&mut info as *mut _ as *mut c_void),
        &mut size,
    );
    if r == u32::MAX || info.dwType != RIM_TYPEHID {
        return (0, 0);
    }
    let hid = info.Anonymous.hid;
    (hid.dwVendorId as u16, hid.dwProductId as u16)
}
