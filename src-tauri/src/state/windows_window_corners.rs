// lib와 bin의 독립 state 모듈 컴파일
#![allow(dead_code)]

use tauri::{window::Color, Theme, WebviewWindow};
use windows::Win32::Foundation::COLORREF;
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    DWMWINDOWATTRIBUTE, DWM_WINDOW_CORNER_PREFERENCE,
};

// 프레임리스 창의 가장자리 형상을 DWM이 소유하게 한다.
//
// tao는 decorations(false)에서도 HWND에 WS_CAPTION|WS_SIZEBOX를 남기고 WM_NCCALCSIZE로만
// 프레임을 지운다. 그래서 Windows 11 DWM은 이 창을 평범한 프레임 창으로 보고, 웹 콘텐츠가
// 그려지는 것과 같은 사각형 위에 자기 반경으로 모서리를 자르고 1px 보더를 그린다.
// 웹이 다른 반경으로 또 라운딩하면 두 원호 사이 초승달이 창의 투명 영역으로 남아 간극이 된다.
//
// DWM 반경은 조회도 지정도 할 수 없어(ROUND ≈8dip / ROUNDSMALL ≈4dip 두 프리셋뿐) CSS를
// 그 값에 맞출 수 없다. 대신 웹이 라운딩을 포기하고 사각으로 채우면 DWM이 창 프레임과 같은
// 합성 패스에서 잘라내므로, 어떤 DPI에서도 원호가 하나뿐이라 간극이 생길 수 없다.
// 메인 창(decorations: true, transparent: false)이 이미 같은 처리다.
//
// Windows 10(빌드 < 22000)에는 두 속성이 모두 없어 실패한다. 그래도 웹 반경은 0으로 둔다 -
// 창이 불투명이라 웹이 라운딩해도 모서리 바깥이 같은 색으로 남아 사각으로 보이므로,
// 반경만 살리면 각진 면 위에 둥근 링만 떠서 어긋난다. 라인은 웹이 사각 링으로 메운다.

// 첫 페인트 전 구간을 메우는 씨앗값 - tokens.css의 --ui-bg-panel-detached와 같은 값을 유지한다.
// 창 빌더에 실려 WebView2 컨트롤러 생성 옵션으로 들어가므로 첫 프레임부터 유효하고,
// 실제 색은 렌더러가 토큰을 읽어 apply_surface_chrome으로 덮는다
const DARK_SEED_FILL: Color = Color(0x1C, 0x1C, 0x1E, 0xFF);
const LIGHT_SEED_FILL: Color = Color(0xEE, 0xF3, 0xF7, 0xFF);

// tokens.css의 --ui-line과 같은 값. DWM 기본 보더는 시스템 색이라 훨씬 진해서, 렌더러가
// 토큰을 읽어 덮는 순간 선 굵기가 바뀐 것처럼 보인다 - 창 생성 시점에 미리 맞춰 전환을 없앤다
const DARK_SEED_LINE: [f64; 4] = [1.0, 1.0, 1.0, 0.1];
// 라이트 --ui-line은 순흑이 아니라 살짝 남색으로 기운 잉크다.
// 무채색 위 순흑 저알파는 때가 탄 것처럼 보인다
const LIGHT_SEED_LINE: [f64; 4] = [0.062745, 0.094118, 0.156863, 0.12];

pub(crate) fn seed_fill(theme: Theme) -> Color {
    match theme {
        Theme::Light => LIGHT_SEED_FILL,
        Theme::Dark => DARK_SEED_FILL,
        _ => DARK_SEED_FILL,
    }
}

fn seed_line(theme: Theme) -> [f64; 4] {
    match theme {
        Theme::Light => LIGHT_SEED_LINE,
        Theme::Dark => DARK_SEED_LINE,
        _ => DARK_SEED_LINE,
    }
}

fn seed_fill_components(theme: Theme) -> [f64; 4] {
    let fill = seed_fill(theme);
    [
        f64::from(fill.0) / 255.0,
        f64::from(fill.1) / 255.0,
        f64::from(fill.2) / 255.0,
        1.0,
    ]
}

// 창 생성 시점 - 결과를 기다릴 소비자가 없어 fire-and-forget.
// Win11의 기본값이 이미 라운드지만, 창 종류에 따라 달라지는 휴리스틱에 기대지 않는다
pub(crate) fn apply_initial_chrome(window: &WebviewWindow, theme: Theme) {
    match set_corner_preference(window) {
        Ok(()) => log::info!(
            "[window-corners] applied native corner preference to '{}'",
            window.label()
        ),
        Err(reason) => log::debug!(
            "[window-corners] skipped native corner preference for '{}': {reason}",
            window.label()
        ),
    }

    if let Err(reason) = set_border_color(
        window,
        composite_over(seed_line(theme), seed_fill_components(theme)),
    ) {
        log::debug!(
            "[window-corners] skipped seed border color for '{}': {reason}",
            window.label()
        );
    }
}

// 창 가장자리 표면(면 + 1px 라인)을 웹이 아니라 DWM이 그리게 한다.
//
// 색은 CSS 토큰이 단일 출처 - 렌더러가 계산값(sRGB 0~1)을 넘겨준다.
// 반환값은 DWM이 라인을 그리는지 - 실패하면 렌더러가 CSS 링으로 메운다.
// 실루엣은 반환값과 무관하게 항상 네이티브 소유다: 창이 불투명이라 웹이 어떤 반경으로
// 라운딩해도 모서리 바깥이 같은 색으로 남아 사각으로 보인다. 그래서 Windows 10처럼
// DWM 라운딩이 없는 OS에서도 웹 반경은 0이어야 하고, 그 판단은 호출자가 고정한다
pub(crate) fn apply_surface_chrome(window: &WebviewWindow, fill: [f64; 4], line: [f64; 4]) -> bool {
    if fill.iter().chain(line.iter()).any(|c| !c.is_finite()) {
        log::warn!("[window-corners] ignoring non-finite surface chrome");
        return false;
    }
    let fill = fill.map(|component| component.clamp(0.0, 1.0));
    let line = line.map(|component| component.clamp(0.0, 1.0));

    // 리사이즈로 새로 드러난 띠는 웹 페인트가 IPC로 늦게 도착한다 - 그 구간을 같은 색으로
    // 메운다. tao의 WM_ERASEBKGND 브러시와 WebView2 DefaultBackgroundColor를 함께 세운다.
    // 라운딩 지원과 무관하므로 DWM 속성보다 먼저, 실패해도 나머지를 막지 않는다
    let opaque_fill = Color(channel(fill[0]), channel(fill[1]), channel(fill[2]), 0xFF);
    if let Err(err) = window.set_background_color(Some(opaque_fill)) {
        log::warn!("[window-corners] failed to set panel background color: {err}");
    }

    // Windows 10(빌드 < 22000)에는 두 속성이 모두 없다 - 라운딩도 보더도 없는 사각 창이
    // 정답이므로 조용히(debug) 물러난다. 커스텀 CSS 편집마다 다시 오는 경로라 warn 금지
    if let Err(reason) = set_corner_preference(window) {
        log::debug!(
            "[window-corners] skipped native corner preference for '{}': {reason}",
            window.label()
        );
        return false;
    }
    // 메인 창의 네이티브 엣지에 대응하는 1px 라인 - DWM이 원호를 따라 그린다
    if let Err(reason) = set_border_color(window, composite_over(line, fill)) {
        log::debug!(
            "[window-corners] skipped native border color for '{}': {reason}",
            window.label()
        );
        return false;
    }

    log::info!(
        "[window-corners] applied native surface chrome to '{}'",
        window.label()
    );
    true
}

fn set_corner_preference(window: &WebviewWindow) -> Result<(), String> {
    set_attribute::<DWM_WINDOW_CORNER_PREFERENCE>(
        window,
        DWMWA_WINDOW_CORNER_PREFERENCE,
        DWMWCP_ROUND,
    )
}

fn set_border_color(window: &WebviewWindow, rgb: [f64; 3]) -> Result<(), String> {
    set_attribute::<COLORREF>(window, DWMWA_BORDER_COLOR, to_colorref(rgb))
}

fn set_attribute<T>(
    window: &WebviewWindow,
    attribute: DWMWINDOWATTRIBUTE,
    value: T,
) -> Result<(), String> {
    let hwnd = window
        .hwnd()
        .map_err(|err| format!("HWND unavailable: {err}"))?;
    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            attribute,
            std::ptr::from_ref(&value).cast(),
            std::mem::size_of::<T>() as u32,
        )
    }
    .map_err(|err| err.to_string())
}

// DWM 보더 색은 COLORREF라 알파를 받지 못한다 - 반투명 라인을 면 위에 미리 합성한다.
// 라인은 패널 바닥과 바깥 경계에 놓이므로 면 위 합성이 웹 인셋 링이 보이던 색과 같다
fn composite_over(line: [f64; 4], fill: [f64; 4]) -> [f64; 3] {
    let alpha = line[3];
    [
        line[0] * alpha + fill[0] * (1.0 - alpha),
        line[1] * alpha + fill[1] * (1.0 - alpha),
        line[2] * alpha + fill[2] * (1.0 - alpha),
    ]
}

fn channel(component: f64) -> u8 {
    (component.clamp(0.0, 1.0) * 255.0).round() as u8
}

// COLORREF는 0x00BBGGRR - RGB 순서로 넣으면 색이 뒤집힌다
fn to_colorref(rgb: [f64; 3]) -> COLORREF {
    COLORREF(
        u32::from(channel(rgb[0]))
            | (u32::from(channel(rgb[1])) << 8)
            | (u32::from(channel(rgb[2])) << 16),
    )
}

#[cfg(test)]
mod tests {
    use super::{composite_over, seed_fill_components, seed_line, to_colorref};
    use tauri::Theme;

    #[test]
    fn opaque_line_replaces_the_fill() {
        assert_eq!(
            composite_over([1.0, 1.0, 1.0, 1.0], [0.0, 0.0, 0.0, 1.0]),
            [1.0, 1.0, 1.0]
        );
    }

    #[test]
    fn fully_transparent_line_leaves_the_fill() {
        assert_eq!(
            composite_over([1.0, 1.0, 1.0, 0.0], [0.2, 0.4, 0.6, 1.0]),
            [0.2, 0.4, 0.6]
        );
    }

    // --ui-line rgba(255,255,255,0.1)을 --ui-bg-panel-detached #1c1c1e 위에 올린 값
    #[test]
    fn dark_translucent_line_blends_toward_the_fill() {
        let blended = composite_over(seed_line(Theme::Dark), seed_fill_components(Theme::Dark));
        assert_eq!(super::channel(blended[0]), 51);
        assert_eq!(super::channel(blended[2]), 53);
    }

    // --ui-line rgba(16,24,40,0.12)을 --ui-bg-panel-detached #eef3f7 위에 올린 값
    #[test]
    fn light_translucent_line_blends_toward_the_fill() {
        let blended = composite_over(seed_line(Theme::Light), seed_fill_components(Theme::Light));
        assert_eq!(super::channel(blended[0]), 211);
        assert_eq!(super::channel(blended[2]), 222);
    }

    #[test]
    fn colorref_packs_blue_into_the_high_byte() {
        assert_eq!(to_colorref([1.0, 0.0, 0.0]).0, 0x0000_00FF);
        assert_eq!(to_colorref([0.0, 0.0, 1.0]).0, 0x00FF_0000);
    }
}
