# OBS 모드 성능 분석 보고서

> 작성일: 2026-03-07
> 대상: `feat/obs-mode` 브랜치 (v3 구현 완료 상태)

---

## 분석 요약

OBS 모드가 기존 오버레이 윈도우 모드보다 게임 프레임을 **더 떨어뜨리는** 원인을 코드 분석을 통해 조사한 결과,
**가설 자체는 유효**하나 현재 구현에 **중대한 리소스 이중 소모 문제**가 존재하며,
이것이 성능 저하의 **가장 큰 원인**으로 판단됩니다.

---

## 1. 가설 검증: 컴포지팅(DWM 합성) 비용이 주요 병목인가?

### 결론: **가설은 부분적으로 유효하나, 유일한 병목은 아님**

기존 오버레이 윈도우의 게임 FPS 영향 요인은 크게 세 가지입니다:

| 요인 | 영향도 | 설명 |
|------|--------|------|
| **DWM 합성 비용** | 중~고 | 투명 창이 존재하면 매 프레임마다 Windows DWM이 게임 프레임과 합성. 합성 면적이 클수록 비용 증가 |
| **GPU 경쟁** | 중 | 오버레이의 WebGL 렌더링(노트 이펙트)이 게임과 동일 GPU를 공유 |
| **WebView 프로세스 오버헤드** | 중 | Chromium(WebView2) 프로세스의 JS 실행, 이벤트 처리, rAF 루프 등 CPU/메모리 사용 |

OBS 모드는 DWM 합성 비용을 제거하는 것이 목표였으나, **실제 구현에서는 오버레이 윈도우가 완전히 제거되지 않아** 이 가설을 제대로 검증하지 못한 상태입니다.

---

## 2. OBS 모드 최적화 부족 여부

### 결론: **초기 구현 수준에서 충분하며, 핵심 문제는 최적화가 아닌 아키텍처 결함**

OBS 브릿지 서비스(`obs_bridge.rs`) 자체는 잘 설계되어 있습니다:

- ✅ `tokio` broadcast channel로 효율적인 멀티캐스트
- ✅ `localhost` 바인딩으로 네트워크 지연 최소화 (<1ms)
- ✅ JSON 직렬화는 키 이벤트 수준에서 무시할 수 있는 비용
- ✅ 시퀀스 기반 gap 감지 + 스냅샷 재전송

WebSocket 프로토콜의 추가 비용은 경미합니다. **진짜 문제는 아래 §3에서 설명하는 리소스 이중 소모입니다.**

---

## 3. 핵심 문제: 오버레이 윈도우 리소스 이중 소모 🔴

### 결론: **OBS 모드 시 숨겨진 오버레이 윈도우가 계속 리소스를 소모하고 있음**

이것이 **성능 저하의 가장 큰 원인**입니다.

### 3.1 오버레이 숨김 메커니즘 분석

OBS 모드 시작 시 호출되는 `obs_hide_overlay`:

```rust
// src-tauri/src/state/app_state.rs:348-356
pub fn obs_hide_overlay(&self, app: &AppHandle) {
    let was_visible = *self.overlay_visible.read();
    *self.obs_previous_overlay_visible.write() = Some(was_visible);
    if was_visible {
        if let Err(e) = self.set_overlay_visibility(app, false) {
            log::warn!("[ObsBridge] 오버레이 숨기기 실패: {}", e);
        }
    }
}
```

이 함수는 `set_overlay_visibility(false)`를 호출하며, 이는 다시:

```rust
// src-tauri/src/state/app_state.rs:424-430
} else {
    // 오버레이를 숨길 때: 창이 존재하는 경우에만 숨김
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        hide_overlay_window(&window)?;  // ← ShowWindow(hwnd, SW_HIDE)
    }
}
```

**`ShowWindow(hwnd, SW_HIDE)`는 창을 화면에서 숨기기만 할 뿐, WebView2 프로세스는 계속 실행됩니다.**

### 3.2 키 이벤트 이중 전송 🔴🔴

키보드 이벤트 처리 루프(`app_state.rs:954-996`)에서 **OBS 모드 활성 여부와 무관하게** 오버레이 윈도우에 이벤트를 전송합니다:

```rust
// 1. OBS 브릿지로 전송 (OBS 모드 시)
if app_state.obs_bridge.is_running() {
    app_state.obs_bridge.broadcast_key_event(...);  // ← OBS 클라이언트로
}

// 2. 오버레이 윈도우로도 전송 (항상!) ← 문제
let mut emitted = false;
if let Some(overlay) = overlay_window.as_ref() {
    match overlay.emit("keys:state", &payload) {  // ← 숨겨진 오버레이에도 전송!
        Ok(_) => emitted = true,
        ...
    }
}
```

**숨겨진 오버레이 윈도우의 WebView2가 이 이벤트를 받아서 처리합니다:**

1. `keyEventBus` → 모든 리스너에 브로드캐스트
2. `setKeyActiveSignal()` → Preact Signal 업데이트
3. `handleKeyDown/Up()` → 노트 시스템 처리
4. `requestAnimationFrame()` → WebGL 렌더링 스케줄링
5. KPS 계산 타이머 (50ms 인터벌)

### 3.3 리소스 소모 경로 요약

```
OBS 모드 ON 상태에서의 리소스 소모:

[키 입력]
  ├── → OBS WebSocket → OBS 브라우저 소스 (의도된 경로)
  │     └── useOverlayRuntime → 키 신호 + KPS + 노트 → WebGL 렌더링
  │
  └── → 숨겨진 오버레이 윈도우 (불필요한 경로) 🔴
        └── keyEventBus → 키 신호 + KPS + 노트 → WebGL 렌더링
            (화면에 표시되지 않으면서 GPU/CPU 리소스 소모)
```

**결과적으로 OBS 모드는 기존 오버레이 오버헤드 + OBS 추가 오버헤드로 기존보다 더 많은 리소스를 소모합니다.**

### 3.4 숨겨진 WebView2의 구체적 리소스 소모

| 리소스 | 영향 |
|--------|------|
| **GPU** | WebGL 컨텍스트 유지 + rAF 루프 (숨겨진 창이라도 WebView2는 rAF를 완전히 중단하지 않을 수 있음) |
| **CPU** | JS 이벤트 처리, KPS setInterval(50ms), Preact Signal 업데이트 |
| **메모리** | WebView2 프로세스(~50-100MB), GPU 텍스처/버퍼 |
| **IPC** | Tauri IPC 이벤트 직렬화/역직렬화 (keys:state, keys:counter, settings:changed 등) |

---

## 4. 기타 병목 요인

### 4.1 `raw_input` 이벤트도 오버레이에 전송 (경미)

```rust
// src-tauri/src/state/app_state.rs:845-848
// 오버레이에도 emit (플러그인용)
if let Some(overlay) = app_handle.get_webview_window(OVERLAY_LABEL) {
    let _ = overlay.emit("input:raw", &raw_payload);
}
```

OBS 모드에서 이 emit도 불필요합니다.

### 4.2 `settings:changed` 이벤트 글로벌 emit

```rust
app.emit("settings:changed", payload)?;
```

이 이벤트는 `app.emit()`으로 **모든 윈도우**에 전송되므로, 숨겨진 오버레이도 설정 변경 처리를 수행합니다.

### 4.3 `bootstrap_payload` 직렬화 반복

`notify_obs_settings_diff()` 호출 시마다 `bootstrap_payload()`를 전체 직렬화하여 캐시 갱신합니다.
이는 설정 변경 빈도에서 큰 문제는 아니지만, 프리셋 연속 변경 등에서 비효율이 존재합니다.

### 4.4 OBS 브라우저 소스 자체의 GPU 비용

OBS 브라우저 소스(CEF)는 별도 프로세스에서 렌더링하지만, 게임과 동일한 GPU를 사용합니다.
다만 DWM 합성 경로가 아닌 OBS 자체의 합성 경로를 사용하므로, 오버레이보다는 영향이 적습니다.

---

## 5. 수정 방안

### 5.1 즉시 수정 (P0) — OBS 모드 시 오버레이 키 이벤트 차단

키 이벤트 처리 루프에서 OBS 모드 활성 시 오버레이 윈도우로의 이벤트 전송을 차단합니다:

```rust
// OBS 브릿지 키 이벤트 브로드캐스트
if app_state.obs_bridge.is_running() {
    app_state.obs_bridge.broadcast_key_event(...);
}

// OBS 모드가 아닐 때만 오버레이에 emit
if !app_state.obs_bridge.is_running() {
    // 기존 오버레이 emit 로직
}
```

이 수정만으로도 OBS 모드 시 숨겨진 오버레이의 이벤트 처리 비용을 완전히 제거할 수 있습니다.

### 5.2 중기 수정 (P1) — 오버레이 윈도우 완전 종료

OBS 모드 시 오버레이 윈도우를 `hide`가 아닌 `destroy`/`close`하여 WebView2 프로세스 자체를 종료합니다.
OBS 모드 종료 시 `ensure_overlay_window`로 재생성하면 됩니다.

### 5.3 장기 최적화 (P2) — 이벤트 라우팅 최적화

- `raw_input` emit도 OBS 모드 시 오버레이 전송 차단
- `settings:changed` 글로벌 emit 대신 대상 윈도우 지정 emit으로 변경
- `bootstrap_payload` 직렬화 캐싱 (TTL 기반)

---

## 6. 결론

| 질문 | 답변 |
|------|------|
| **1. 가설이 잘못되었는가?** | 아니오. DWM 합성 비용은 실제 영향 요인이지만, 현재 구현이 가설을 제대로 검증하지 못하는 상태임 |
| **2. OBS 모드 최적화가 부족한가?** | OBS 브릿지 자체는 충분히 효율적. 문제는 최적화가 아닌 아키텍처 결함 |
| **3. 숨겨진 오버레이가 자원을 소모하는가?** | **예. 이것이 핵심 원인.** 숨김(SW_HIDE)은 WebView2 프로세스를 종료하지 않으며, 키 이벤트가 계속 전송되어 GPU/CPU 리소스를 이중 소모 |
| **4. 다른 병목이 있는가?** | raw_input emit, 글로벌 settings 이벤트 등 부차적 이슈 존재. OBS 브라우저 소스 자체의 GPU 비용도 고려 필요 |

**핵심**: OBS 모드의 의도는 "오버레이 창을 제거하여 게임 FPS 영향 원천 차단"이었으나,
현재 구현은 오버레이 창을 숨기기만 하고 키 이벤트를 계속 전송하여 **기존 오버레이 비용 + OBS 추가 비용**이 동시에 발생합니다.
§5.1의 키 이벤트 차단 수정이 가장 시급한 개선 사항입니다.
