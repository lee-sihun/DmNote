// lib와 bin의 독립 state 모듈 컴파일
#![allow(dead_code)]

use std::sync::mpsc;
use std::time::Duration;

use objc2::runtime::{AnyClass, AnyObject};
use objc2::{msg_send, sel};
use tauri::{AppHandle, WebviewWindow};

// 분리 창 모서리 반경 - panelChrome.ts의 WINDOW_PANEL_FRAME_CLASS와 같은 값을 유지.
// CSS 라운딩은 네이티브 실패 시 폴백이자 비macOS 경로라 양쪽이 같은 값이어야 겹친다
const CORNER_RADIUS: f64 = 12.0;

// 메인 스레드가 리사이즈 루프 등으로 막혀 있을 때의 상한 - 넘기면 CSS 링을 유지시킨다
const APPLY_TIMEOUT: Duration = Duration::from_secs(2);

// 프레임리스 창의 둥근 모서리를 웹 콘텐츠가 아니라 컴포지터가 소유하게 한다.
//
// 창 프레임은 OS가 리사이즈 프레임마다 바꾸지만 웹뷰 픽셀은 웹 콘텐츠 프로세스가
// IPC로 보내와 늦게 도착한다. 모서리 원호가 그 늦은 그림 안에 있으면, 창을 줄이는
// 순간 원호가 새 창 밖으로 밀려나 각진 모서리가 노출된다.
// contentView 레이어의 cornerRadius는 bounds 상대 속성이라 AppKit이 창 프레임과
// 같은 CATransaction에서 갱신하는 뷰 크기를 그대로 따라간다 - 프로세스 경계가 없어
// 늦을 구간 자체가 없다.
//
// 실패해도 CSS 라운딩이 그대로 남으므로 조용히 폴백한다.
pub(crate) fn apply_rounded_corners(app: &AppHandle, window: &WebviewWindow) {
    // 창 생성 시점 - 결과를 기다릴 소비자가 없어 fire-and-forget
    let target = window.clone();
    let label = window.label().to_string();
    let dispatched = app.run_on_main_thread(move || {
        report("corner mask", &label, unsafe { mask_content_view(&target) });
    });
    if let Err(err) = dispatched {
        log::warn!("[window-corners] failed to dispatch corner mask: {err}");
    }
}

// 창 가장자리 표면(면 + 1px 라인)을 웹이 아니라 레이어가 그리게 한다.
//
// 상단 엣지를 끌면 창은 즉시 커지는데 웹 콘텐츠는 뷰포트 위쪽을 기준으로 그려져 있어,
// 아직 옛 높이인 그림의 아래끝이 새 창 바닥에 닿지 못한다. 창이 투명하면 그 띠가
// 그대로 비쳐 바닥이 흔들리고, 웹이 그리는 인셋 라인은 그 옛 아래끝에 잔상으로 남는다.
// 웹뷰는 drawsBackground=NO라 부모 레이어의 배경색이 그대로 비치고,
// CALayer의 border는 서브레이어 위에 그려져 웹 콘텐츠를 덮는다.
//
// 색은 CSS 토큰이 단일 출처 - 렌더러가 계산값(sRGB 0~1)을 넘겨준다.
// 반환값은 실제 적용 여부 - 렌더러가 이 값으로 CSS 링을 끄므로 낙관적으로 답하면
// 링도 네이티브 라인도 없는 창이 된다
pub(crate) fn apply_surface_chrome(
    app: &AppHandle,
    window: &WebviewWindow,
    fill: [f64; 4],
    line: [f64; 4],
) -> bool {
    if fill.iter().chain(line.iter()).any(|c| !c.is_finite()) {
        log::warn!("[window-corners] ignoring non-finite surface chrome");
        return false;
    }
    let fill = fill.map(|component| component.clamp(0.0, 1.0));
    let line = line.map(|component| component.clamp(0.0, 1.0));

    let (sender, receiver) = mpsc::channel();
    let target = window.clone();
    let label = window.label().to_string();
    let dispatched = app.run_on_main_thread(move || {
        let result = unsafe { paint_content_view(&target, fill, line) };
        report("surface chrome", &label, result);
        let _ = sender.send(result.is_ok());
    });
    if let Err(err) = dispatched {
        log::warn!("[window-corners] failed to dispatch surface chrome: {err}");
        return false;
    }
    // 메인 스레드에서 호출되면 위 클로저가 인라인 실행돼 값이 이미 들어 있다
    match receiver.recv_timeout(APPLY_TIMEOUT) {
        Ok(applied) => applied,
        Err(err) => {
            log::warn!("[window-corners] surface chrome did not settle: {err}");
            false
        }
    }
}

fn report(what: &str, label: &str, result: Result<(), &'static str>) {
    match result {
        Ok(()) => log::info!("[window-corners] applied native {what} to '{label}'"),
        Err(reason) => {
            log::warn!("[window-corners] skipped native {what} for '{label}': {reason}")
        }
    }
}

unsafe fn mask_content_view(window: &WebviewWindow) -> Result<(), &'static str> {
    let (ns_window, content_view, layer) = content_view_layer(window)?;
    set_corner_mask(content_view, layer);
    // 투명 창 그림자는 합성 결과 alpha에서 파생 - 새 실루엣으로 한 번 갱신
    let _: () = msg_send![ns_window, invalidateShadow];
    Ok(())
}

unsafe fn paint_content_view(
    window: &WebviewWindow,
    fill: [f64; 4],
    line: [f64; 4],
) -> Result<(), &'static str> {
    let (ns_window, content_view, layer) = content_view_layer(window)?;

    // 불투명한 면은 마스크 없이 깔면 모서리를 사각으로 덮는다 - 항상 함께 적용
    set_corner_mask(content_view, layer);

    let fill_color = cg_color(fill)?;
    let _: () = msg_send![layer, setBackgroundColor: fill_color];

    // 메인 창의 네이티브 엣지에 대응하는 인셋 라인 - CSS 링과 같은 1pt
    let line_color = cg_color(line)?;
    let _: () = msg_send![layer, setBorderColor: line_color];
    let _: () = msg_send![layer, setBorderWidth: 1.0f64];

    let _: () = msg_send![ns_window, invalidateShadow];
    Ok(())
}

unsafe fn set_corner_mask(content_view: *mut AnyObject, layer: *mut AnyObject) {
    let _: () = msg_send![layer, setCornerRadius: CORNER_RADIUS];
    let _: () = msg_send![layer, setMasksToBounds: true];

    // macOS 14+는 NSView.clipsToBounds가 레이어의 masksToBounds를 되돌릴 수 있음
    let syncs_clipping: bool = msg_send![content_view, respondsToSelector: sel!(setClipsToBounds:)];
    if syncs_clipping {
        let _: () = msg_send![content_view, setClipsToBounds: true];
    }
}

unsafe fn cg_color(components: [f64; 4]) -> Result<*mut AnyObject, &'static str> {
    let Some(color_class) = AnyClass::get(c"NSColor") else {
        return Err("NSColor class not found");
    };
    let color: *mut AnyObject = msg_send![
        color_class,
        colorWithSRGBRed: components[0],
        green: components[1],
        blue: components[2],
        alpha: components[3],
    ];
    if color.is_null() {
        return Err("NSColor unavailable");
    }
    // CALayer가 CGColorRef를 retain하므로 autorelease 시점과 무관
    let cg: *mut AnyObject = msg_send![color, CGColor];
    if cg.is_null() {
        return Err("CGColor unavailable");
    }
    Ok(cg)
}

// wry가 setContentView로 심어둔 WKWebView의 부모 뷰와 그 레이어
type ContentLayer = (*mut AnyObject, *mut AnyObject, *mut AnyObject);

unsafe fn content_view_layer(window: &WebviewWindow) -> Result<ContentLayer, &'static str> {
    let ns_window = window
        .ns_window()
        .map_err(|_| "NSWindow handle unavailable")?;
    let ns_window: *mut AnyObject = ns_window.cast();
    if ns_window.is_null() {
        return Err("NSWindow handle is null");
    }

    let content_view: *mut AnyObject = msg_send![ns_window, contentView];
    if content_view.is_null() {
        return Err("contentView unavailable");
    }

    // layer 접근 전에 레이어 백드로 승격
    let _: () = msg_send![content_view, setWantsLayer: true];
    let layer: *mut AnyObject = msg_send![content_view, layer];
    if layer.is_null() {
        return Err("layer unavailable");
    }
    Ok((ns_window, content_view, layer))
}
