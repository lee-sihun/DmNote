# OBS 모드 설계 문서

> 작성일: 2026-03-07
> 목표: OBS 브라우저 소스로 키뷰어를 표시하여 게임 FPS 영향 완전 제거
> 상태: **v2 구현 완료** (`feat/obs-mode` 브랜치)

---

## 1. 배경 및 동기

현재 오버레이 윈도우는 투명 + always-on-top으로 게임 위에 직접 렌더링됨.
이로 인해 다음과 같은 게임 FPS 저하 요인이 존재:

| 요인 | 영향 |
|------|------|
| DWM 합성 | 투명 창 존재 자체로 매 프레임 합성 비용 |
| GPU 경쟁 | 오버레이 WebGL이 게임과 동일 GPU 공유 |
| fill-rate | glow 효과로 렌더링 면적 확장 |

**OBS 모드**는 오버레이 창을 완전히 제거하고, OBS 브라우저 소스가 키뷰어를 렌더링하도록 하여
게임 프로세스에 대한 영향을 **원천 차단**하는 것이 목표.

---

## 2. 전체 아키텍처

```
[Keyboard Daemon]
  → [AppState (단일 상태 허브)]
      ├─ [기존 overlay window]     ← OBS 모드 OFF
      ├─ [ObsBridgeService]        ← OBS 모드 ON
      │    └─ WebSocket 서버 (localhost:PORT)
      │         ├─ HTTP: OBS 페이지 정적 파일 서빙  ✅
      │         └─ WS: 키 이벤트 / 설정 / 레이아웃 브로드캐스트
      └─ [Main window]
           └─ OBS 모드 설정 UI / 연결 상태 / URL 표시
```

### 핵심 원칙

1. **AppState가 단일 상태 소스** — 키보드 데몬이 직접 WS로 보내지 않음 ✅
2. **렌더링 코드 재사용** — useNoteSystem, noteBuffer, WebGLTracksOGL 공유 ✅
3. **OBS 페이지는 Tauri API 무의존** — window.api.* 참조 없음 ✅

### 데이터 흐름

```
입력: Keyboard daemon → AppState → ObsBridgeService → OBS 페이지       ✅
설정: settings/preset/mode 변경 → AppState emit → ObsBridge 캐시 갱신   ✅ (settings_diff, counter_update, layout snapshot)
```

---

## 3. WebSocket 프로토콜

### 3.1 공통 Envelope ✅

```json
{
  "v": 1,
  "type": "key_event",
  "seq": 10241,
  "ts": 1741339200123,
  "payload": {}
}
```

- `v`: 프로토콜 버전 (하위 호환용)
- `seq`: 단조 증가 시퀀스 (gap 감지용)
- `ts`: 서버 타임스탬프 (ms)

### 3.2 메시지 타입

| 방향 | 타입 | 용도 | 빈도 | v1 상태 |
|------|------|------|------|---------|
| C→S | `hello` | 최초 접속 핸드셰이크 | 1회 | ✅ |
| S→C | `hello_ack` | 프로토콜 승인 | 1회 | ✅ |
| S→C | `snapshot` | 전체 상태 동기화 | 접속 시 + resync | ✅ |
| S→C | `key_event` | 키 입력 이벤트 | 매우 빈번 | ✅ |
| S→C | `settings_diff` | 설정 변경분 | 가끔 | ✅ |
| S→C | `layout_diff` | 레이아웃/모드/탭 변경 | 가끔 | ✅ snapshot 재전송으로 대체 |
| S→C | `counter_update` | 키 카운터 갱신 | 주기적 | ✅ |
| 양방향 | `ping` / `pong` | 연결 상태 확인 | 주기적 | ✅ |
| C→S | `resync_request` | 상태 재동기화 요청 | 드묾 | ✅ |

### 3.3 핸드셰이크 시퀀스 ✅

```
1. OBS 페이지 접속 (WS 직접 연결)              ← v1: HTTP upgrade 없이 직접 WS
2. 클라이언트 → hello { client, protocol, appVersion }
3. 서버 → hello_ack { serverVersion, obsMode }
4. 서버 → snapshot { 전체 상태 }
5. 이후 key_event, settings_diff, counter_update 스트리밍
6. seq gap 감지 시 → resync_request → snapshot 재전송
```

### 3.4 주요 메시지 상세

#### hello (C→S) ✅
```json
{
  "v": 1,
  "type": "hello",
  "payload": {
    "client": "obs-browser",
    "protocol": 1,
    "appVersion": "1.5.2",
    "resumeFromSeq": 0
  }
}
```

#### snapshot (S→C) ✅
```json
{
  "v": 1,
  "type": "snapshot",
  "seq": 10,
  "payload": {
    "mode": "4key",
    "settings": { "noteEffect": true, "noteSettings": { "speed": 400, "trackHeight": 300 } },
    "keys": { "4key": ["A", "S", "D", "F"] },
    "positions": { "4key": [] },
    "statPositions": { "4key": [] },
    "graphPositions": { "4key": [] },
    "tabNoteOverrides": {},
    "customTabs": [],
    "keyCounters": {},
    "overlayState": { "backgroundColor": "transparent" }
  }
}
```

#### key_event (S→C) ✅
```json
{
  "v": 1,
  "type": "key_event",
  "seq": 11,
  "payload": {
    "key": "A",
    "state": "DOWN",
    "mode": "4key"
  }
}
```

#### layout_diff (S→C) ✅ snapshot 재전송으로 대체
```json
{
  "v": 1,
  "type": "layout_diff",
  "seq": 15,
  "payload": {
    "reason": "preset_loaded",
    "selectedKeyType": "6key",
    "keys": {},
    "positions": {},
    "statPositions": {},
    "graphPositions": {},
    "tabNoteOverrides": {}
  }
}
```

### 3.5 상태 일관성 ✅

프리셋 로드처럼 여러 Tauri 이벤트가 연속 발생하는 경우:
- ✅ 서버에서 프리셋 로드 후 `snapshot` 재전송 (refresh_obs_snapshot)
- ✅ 모든 레이아웃 변경 시 `refresh_obs_snapshot` 호출로 캐시 + 클라이언트 동기화

---

## 4. Rust 백엔드 변경사항

### 4.1 새 모듈 구조 ✅

```
src-tauri/src/
├── services/
│   └── obs_bridge.rs       ✅ 신설: WebSocket 서버 lifecycle
├── models/
│   └── obs.rs              ✅ 신설: WS 메시지 타입
├── commands/
│   └── app/
│       └── obs.rs          ✅ 신설: OBS 모드 on/off, status
└── state/
    └── app_state.rs        ✅ 수정: obs_bridge 필드, refresh_obs_snapshot, obs_broadcast_counters
```

### 4.2 ObsBridgeService 설계 ✅

```rust
pub struct ObsBridgeService {
    running: AtomicBool,
    port: RwLock<u16>,
    client_count: AtomicU32,
    cached_snapshot: RwLock<Value>,           // ← ObsSnapshot 대신 serde_json::Value 사용
    broadcast_tx: broadcast::Sender<ObsBroadcast>,
    shutdown_tx: RwLock<Option<oneshot::Sender<()>>>,
    server_version: String,
    asset_fetcher: RwLock<Option<AssetFetcher>>,  // v4: Tauri 임베딩 에셋 (포터블 exe)
    server_handle: tokio::sync::Mutex<Option<JoinHandle<()>>>,  // v3: stop→start 경쟁 방지
    dev_url: RwLock<Option<String>>,          // v3: dev 모드 Vite dev server URL
    session_token: RwLock<String>,            // v3: UUID v4 세션 토큰
}

// 임베딩 에셋 조회 함수 타입
pub type AssetFetcher = Arc<dyn Fn(&str) -> Option<(Vec<u8>, String)> + Send + Sync>;
```

주요 API:
- `start(port: u16)` — WS 서버 bind ✅
- `stop()` — Shutdown broadcast → 서버 shutdown ✅
- `broadcast_key_event(key, state, mode)` — 키 이벤트 전송 ✅
- `broadcast_settings_diff(diff)` — 설정 변경 전송 ✅
- `broadcast_layout_diff(diff)` — 레이아웃 변경 전송 ✅ (서버측, 호출 지점 미연동)
- `broadcast_counter_update(data)` — 카운터 갱신 전송 ✅
- `broadcast_snapshot(snapshot)` — 스냅샷 전송 ✅
- `update_snapshot(snapshot)` — 캐시 갱신 ✅
- `status()` — 실행 상태 + 포트 + 클라이언트 수 조회 ✅

### 4.3 크레이트 의존성 ✅

```toml
tokio-tungstenite = "0.24"
futures-util = "0.3"
```
> tokio는 기존에 이미 포함됨

### 4.4 기존 코드 연동 지점

| 기존 코드 위치 | 추가할 호출 | v1 상태 |
|----------------|-------------|---------|
| `app_state.rs` 키 입력 처리 루프 (~L813) | `obs_bridge.broadcast_key_event()` | ✅ |
| `app_state.rs` emit_settings_changed (~L252) | `obs_bridge.broadcast_settings_diff()` | ✅ |
| `commands/preset/load.rs` 프리셋 로드 후 | `refresh_obs_snapshot()` + `broadcast_snapshot()` | ✅ |
| `commands/keys/keys.rs` 카운터 emit 지점 (9개) | `obs_broadcast_counters()` | ✅ |
| `commands/keys/keys.rs` 모드 변경 | `refresh_obs_snapshot()` | ✅ |
| `commands/layout/*` 레이아웃 변경 | `refresh_obs_snapshot()` | ✅ |

---

## 5. 프론트엔드 번들 전략

### 5.1 코드 분리 구조 ✅ (설계 대비 단순화)

```
src/renderer/
├── windows/
│   ├── overlay/App.tsx         ✅ 기존 (OverlayScene 사용으로 리팩터링)
│   └── obs/
│       ├── App.tsx             ✅ 신설 (WebSocket + OverlayScene)
│       ├── index.tsx           ✅ 신설 (bootstrap)
│       └── index.html          ✅ 신설
├── components/shared/
│   └── OverlayScene.tsx        ✅ 신설 (공용 렌더링 컴포넌트)
├── hooks/obs/
│   └── useObsWebSocket.ts      ✅ 신설 (WS 연결 + auto-reconnect)
├── hooks/overlay/
│   └── useNoteSystem.ts        ✅ 그대로 재사용
├── stores/signals/
│   └── noteBuffer.ts           ✅ 그대로 재사용
├── api/modules/
│   └── obsApi.ts               ✅ 신설 (Tauri 커맨드 래퍼)
└── components/overlay/
    └── WebGLTracksOGL.tsx      ✅ 그대로 재사용
```

> 설계 문서의 adapter 패턴 대신, OBS App.tsx에서 직접 상태 관리하는 단순한 구조로 구현

### 5.2 OverlayScene 추출 ✅

| 책임 | OverlayScene (공용) | overlay/App.tsx (Tauri) | obs/App.tsx (OBS) |
|------|:---:|:---:|:---:|
| 키 UI 렌더링 | ✅ | | |
| 노트 효과 (WebGL) | ✅ | | |
| bounds/position 계산 | | ✅ | ✅ (공유: computeLayout) |
| 통계/그래프 표시 | ✅ | | |
| 플러그인 엘리먼트 | ✅ (props로 제어) | | |
| 창 드래그/리사이즈 | | ✅ | |
| 컨텍스트 메뉴 | | ✅ | |
| window.api.* 구독 | | ✅ | |
| WebSocket 연결/동기화 | | | ✅ |

### 5.3 Vite 멀티 엔트리 ✅

```js
// vite.config.ts
rollupOptions: {
  input: {
    main: path.resolve(windowsRoot, "main/index.html"),
    overlay: path.resolve(windowsRoot, "overlay/index.html"),
    obs: path.resolve(windowsRoot, "obs/index.html"),  // ← 추가됨
  },
},
```

### 5.4 OBS 페이지 서빙 ✅

같은 포트에서 HTTP(정적 파일) + WS(실시간 통신) 통합.
TCP 스트림을 peek하여 `Upgrade: websocket` 헤더 유무로 분기.

---

## 6. 설정 동기화

### 6.1 동기화 대상 계층

| 계층 | 데이터 | 변경 빈도 | v1 상태 |
|------|--------|-----------|---------|
| 글로벌 설정 | noteEffect, noteSettings, backgroundColor | 드묾 | ✅ settings_diff |
| 레이아웃 | selectedKeyType, keys, positions, statPositions, graphPositions | 가끔 | ✅ 변경 시 snapshot 재전송 |
| 탭/프리셋 | customTabs, tabNoteOverrides | 가끔 | ✅ 변경 시 snapshot 재전송 |
| 런타임 | keyCounters, active mode | 실시간 | ✅ counter_update |
| 키 입력 | key, state | 매우 빈번 | ✅ key_event |

### 6.2 동기화 전략

- **최초 접속**: `snapshot` (전체 상태) ✅
- **이후 변경**: `settings_diff` ✅ / layout 변경 시 `snapshot` 재전송 ✅
- **대규모 변경** (프리셋 로드): `snapshot` 재전송 ✅
- **연결 끊김 후 재접속**: `snapshot` 재전송 ✅ (auto-reconnect 3초)

### 6.3 OBS 클라이언트 상태 관리 ✅ (설계 대비 단순화)

설계: Zustand store 사용
v1 구현: React useState로 직접 관리 (obs/App.tsx)

---

## 7. OBS 모드 UX

### 7.1 메인 윈도우 UI ✅ (설계 대비 간소화)

v1 구현:
- OBS 모드 섹션 (bg-primary 카드)
- 상단: "OBS 모드" 라벨 + 실행 상태 (초록/회색) + 클라이언트 수
- 하단: 포트 입력 + URL 복사 버튼 + 시작/중지 버튼
- 3초 주기 상태 폴링 (shallow 비교로 불필요한 리렌더 방지)

v3 추가:
- ✅ OBS 모드 시 오버레이 창 자동 숨김/복원
- ✅ 안내 문구 (OBS 설정 방법 가이드 + 오버레이 숨김 경고)
- 라디오 버튼 모드 전환은 자동 숨김/복원으로 대체

### 7.2 모드 전환 동작 ✅

1. ✅ OBS 모드 ON → WS 서버 bind → URL 표시
2. ✅ OBS 클라이언트 접속 → 상태 점등
3. ✅ 연결 끊김 → 서버 유지, 상태 표시 갱신
4. ✅ 오버레이 창 자동 숨김/복구 (v3: obs_hide_overlay / obs_restore_overlay)
5. ✅ 설정 영속화 (v3: obs_port, obs_mode_enabled store 저장, 재시작 시 복원)

### 7.3 포트 충돌 처리 ✅

- 기본값: `34891`
- 충돌 시: 명시적 실패 + 에러 표시 (자동 fallback 없음)

---

## 8. 리스크 및 제약사항

### 8.1 기술적 리스크

| 리스크 | 심각도 | 대응 | v1 상태 |
|--------|--------|------|---------|
| OBS CEF Chromium 버전 차이 | 중 | WebGL 1.0 기준 유지 | ⚠️ 미검증 |
| 키 이벤트 지연 (WS 전송) | 낮 | localhost <1ms, seq+ts로 모니터링 | ✅ |
| 상태 일관성 (프리셋 로드 시) | 중 | snapshot 재전송으로 대응 | ✅ |
| 포트 보안 | 중 | UUID v4 세션 토큰 + WS hello/HTTP 검증 | ✅ (v3) |
| tokio 런타임 추가 | 낮 | 기존 tokio 재사용 | ✅ |

### 8.2 기능 제약 (v2 기준)

| 기능 | 지원 여부 |
|------|-----------|
| 키 UI + 노트 효과 | ✅ 지원 |
| 통계/그래프 표시 | ✅ 지원 (v3: KPS 로컬 1초 슬라이딩 윈도우 계산) |
| 키 카운터 | ✅ 지원 |
| HTTP 정적 서빙 | ✅ 지원 (Tauri 임베딩 에셋, 포터블 exe 호환) |
| 레이아웃 동기화 | ✅ 지원 (snapshot 재전송) |
| 커스텀 CSS | ✅ 지원 (v3: settings_diff 경유 실시간 주입) |
| 배경 미디어 서빙 | ✅ 지원 (v3: /media/ 엔드포인트 + 토큰 검증) |
| 커스텀 JS (플러그인) | × 미지원 (Tauri API 의존) |
| 플러그인 엘리먼트 | × 미지원 (bridge API 의존) |

### 8.3 성능 참고

- **게임 FPS**: 오버레이 창 제거로 DWM 합성 + GPU 경쟁 **완전 제거**
- **OBS 렌더링**: 브라우저 소스 자체의 GPU 비용은 존재하나, OBS 프로세스에서 분리 처리
- **시스템 전체**: 렌더링 비용이 0이 되는 것은 아니지만, 게임 프로세스와 합성 경로가 분리됨

---

## 9. 구현 우선순위

| 순서 | 작업 | 설명 | v1 상태 |
|------|------|------|---------|
| 1 | Rust ObsBridgeService | tokio WS 서버, hello/snapshot/key_event | ✅ |
| 2 | OBS standalone 페이지 | obs/App.tsx, WebSocket 연결, useNoteSystem 재사용 | ✅ |
| 3 | OverlayScene 추출 | 기존 overlay/App.tsx에서 공용 렌더링 분리 | ✅ |
| 4 | 설정/레이아웃 동기화 | settings_diff, counter_update, preset snapshot, layout snapshot | ✅ |
| 5 | 메인 UI OBS 설정 | 시작/중지, 포트, 연결 상태, URL 복사 | ✅ |
| 6 | HTTP 정적 파일 서빙 | 같은 포트에서 OBS 페이지 제공 | ✅ |
| 7 | 플러그인/커스텀 지원 여부 | bridge 없는 환경 대응 검토 | ❌ v3+ |

---

## 10. 요약

```
핵심 가치:
게임 FPS 영향 = 0 (오버레이 창 자체가 없으므로)

구현 키포인트:
1. ✅ AppState를 단일 상태 허브로 유지
2. ✅ ObsBridgeService로 WS 브로드캐스트
3. ✅ useNoteSystem + WebGLTracksOGL 코드 재사용
4. ✅ OverlayScene 추출로 Tauri/OBS 공용화
5. ✅ 같은 포트에서 HTTP + WS 서빙
```

---

## 11. v2 로드맵

### 11.1 v2 구현 범위

v2는 **OBS 브라우저 소스에서 바로 사용 가능**한 수준까지 완성하는 것이 목표.

#### v2 포함 (P0)

| # | 작업 | 설명 | v2 상태 |
|---|------|------|---------|
| 1 | **HTTP 정적 파일 서빙** | 같은 포트에서 HTTP(정적 파일) + WS(실시간 통신) 통합. `http://localhost:PORT` 입력만으로 OBS 접속 | ✅ |
| 2 | **layout_diff 연동** | 모드/키/위치/탭 변경 시 refresh_obs_snapshot으로 전체 상태 동기화 | ✅ |
| 3 | **cached_snapshot 증분 갱신** | settings_diff/layout 변경 시 캐시도 함께 갱신, 새 클라이언트에 최신 상태 제공 | ✅ |

#### v2 제외 — 후속 버전으로 이관

| 영역 | 현재 상태 | 미구현 이유 | 우선순위 |
|------|-----------|-------------|----------|
| **커스텀 CSS** | OBS 페이지에 사용자 CSS 주입 없음 | HTTP 서빙 이후 CSS 파일 서빙 경로 설계 필요 | P2 |
| **배경 이미지/영상** | 미디어 파일 HTTP 서빙 없음 | 사용자 미디어 파일 경로 해석 + 보안 검토 필요 | P2 |
| **keyDisplayDelayMs** | OBS에서 키 표시 지연 미반영 | obs/App.tsx에 delay 로직 추가 필요 | P2 |
| **개별 키 noteEffectEnabled** | 키별 노트 효과 on/off 미반영 | snapshot에서 키 매핑 데이터 추출 필요 | P2 |
| **보안 토큰** | 인증 없음 (localhost 바인딩만) | 랜덤 세션 토큰 생성 + WS hello 검증 | P2 |
| **설정 영속화** | 런타임 토글만 (재시작 시 초기화) | useSettingsStore + 백엔드 settings.update 연동 | P1 |
| **오버레이 연동** | OBS 모드와 오버레이 독립 동작 | obs_start 시 overlay 숨김/복원 로직 | P1 |
| **Stats (KPS) 동기화** | KPS 값 항상 0 | stats broadcast 추가 또는 counter_update에 포함 | P1 |
| **UI 안내 문구** | OBS 설정 방법 미표시 | 가이드 텍스트 + 모드 전환 라디오 버튼 | P1 |
| **플러그인 엘리먼트** | OBS에서 렌더링 불가 | bridge API 없는 환경 대응 — 서버에서 HTML 스냅샷 등 | P3 |
| **커스텀 JS (플러그인)** | Tauri API 의존으로 불가 | bridge API WebSocket 프록시 레이어 필요 | P3 |
| **OBS CEF 호환 테스트** | 미검증 | OBS 28+ 브라우저 소스 WebGL/CSS 실제 테스트 | P3 |

### 11.2 v3 구현 범위

v3는 **OBS 모드의 완성도를 높이고 실사용 편의성을 개선**하는 것이 목표.

#### v3 포함 (P1)

| # | 작업 | 설명 | 상태 |
|---|------|------|------|
| 1 | **설정 영속화** | OBS 포트/활성 상태를 useSettingsStore + 백엔드 settings에 저장, 재시작 시 복원 | ✅ |
| 2 | **오버레이 연동** | OBS 모드 시작 시 오버레이 창 자동 숨김, 중지 시 복원 | ✅ |
| 3 | **Stats (KPS) 동기화** | KPS 값을 OBS 클라이언트 로컬에서 계산 (1초 슬라이딩 윈도우) | ✅ |
| 4 | **UI 안내 문구** | OBS 설정 방법 가이드 텍스트 + 오버레이 숨김 경고 | ✅ |

#### v3 포함 (P2)

| # | 작업 | 설명 | 상태 |
|---|------|------|------|
| 5 | **커스텀 CSS** | OBS 페이지에 사용자 CSS 주입, HTTP 서빙 경로로 제공 | ✅ |
| 6 | **배경 이미지/영상** | 사용자 미디어 파일 HTTP 서빙 + 경로 해석 | ✅ |
| 7 | **keyDisplayDelayMs** | OBS에서 키 표시 지연 반영 (메인 오버레이와 동일 패턴) | ✅ |
| 8 | **개별 키 noteEffectEnabled** | 키별 노트 효과 on/off 반영 | ✅ |
| 9 | **보안 토큰** | 랜덤 세션 토큰 생성 + WS hello 검증 | ✅ |
| 10 | **Dev 모드 서빙** | dev 모드 시 Vite dev server로 프록시하여 빌드 없이 OBS 페이지 테스트 가능하도록 지원 | ✅ |
| 11 | **DataSource 호환성 레이어** | OverlayHost adapter로 Tauri API / WebSocket 통합 인터페이스 도입 (§12 참조) | ⚠️ computeLayout 추출 완료, adapter 설계 확정 / 구현 대기 |
| 12 | **포터블 exe 에셋 서빙** | static_dir 디스크 파일 → Tauri asset_resolver() 기반 AssetFetcher로 전환, 단일 exe 배포 지원 | ✅ |

#### v3+ 이후 (P3)

| # | 작업 | 설명 | 상태 |
|---|------|------|------|
| 10 | **플러그인 엘리먼트** | bridge API 없는 환경에서 플러그인 UI 렌더링 (서버 HTML 스냅샷 등) | ❌ |
| 11 | **커스텀 JS (플러그인)** | bridge API WebSocket 프록시 레이어로 Tauri API 의존 해소 | ❌ |
| 12 | **OBS CEF 호환 테스트** | OBS 28+ 브라우저 소스에서 WebGL/CSS 실제 검증 | ❌ |

### 11.3 v1 → v2 변경 요약

| 영역 | v1 | v2 |
|------|-----|-----|
| OBS 접속 방식 | WS URL 직접 연결 (별도 웹 서버 필요) | `http://localhost:PORT` 한 줄 입력 |
| layout_diff | 서버 API만 구현 | 모드/키/위치/탭 변경 시 자동 broadcast |
| cached_snapshot | 초기 + 프리셋 로드 시만 갱신 | 모든 diff 시 증분 갱신 |
| 메인 UI URL 복사 | `ws://localhost:PORT` | `http://localhost:PORT` |

---

## 12. Tauri IPC Shim 호환성 레이어 설계

> 상태: **설계 확정 (C 방식)** / 구현 대기
> P2 #11 상세 설계

### 12.1 배경 및 목표

현재 overlay/App.tsx와 obs/App.tsx는 동일한 UI를 렌더링하면서 데이터 수신 방식만 다름:
- overlay: Tauri IPC (`invoke`, `listen`) → `window.api.*` → Zustand 스토어 → OverlayScene
- obs: WebSocket → `useOverlayRuntime` (중복 로직) → OverlayScene

이 구조의 문제:
1. **렌더링 로직 중복** — 키 딜레이, KPS 계산, 레이아웃 등이 useOverlayRuntime에 복제됨
2. **유지보수 부담** — 기능 추가 시 overlay/obs 양쪽 모두 수정 필요
3. **플러그인 미지원** — OBS에서 커스텀 JS/플러그인이 동작하지 않음

### 12.2 검토한 접근 방식

| 방식 | 설명 | overlay 변경 | 중복 제거 | 비고 |
|------|------|:---:|:---:|------|
| A. 분리형 유지 | 현재 구조 유지, computeLayout만 공유 | 없음 | 일부 | 변경 적을 때만 적합 |
| B. OverlayRuntime 통합 | TauriHost/WebSocketHost → useOverlayRuntime | 대규모 | 완전 | 기존 훅 해체 필요 |
| **C. Tauri IPC Shim** | `invoke`/`listen` 프리미티브를 WS로 교체 | **없음** | **완전** | **채택** |

### 12.3 최종 결정: C 방식 (Tauri IPC Shim)

Tauri 프론트엔드 API는 모두 두 가지 프리미티브에 의존:
- `invoke(command, args)` → 요청/응답 (81개 커맨드)
- `listen(event, callback)` → 이벤트 구독 (25개 이벤트)

이 두 함수는 내부적으로 `window.__TAURI_INTERNALS__`를 호출함.
**OBS 진입점에서 이 글로벌을 WS 기반 shim으로 교체**하면,
overlay/App.tsx 및 모든 의존 훅(useAppBootstrap, keyEventBus 등)이 코드 변경 없이 동작.

```
overlay 환경:
  overlay/App.tsx → window.api.* → invoke/listen → Tauri IPC → Rust 백엔드

OBS 환경:
  obs/App.tsx → initIpcShim() → overlay/App.tsx (동일 코드)
                    ↓
  window.__TAURI_INTERNALS__ = { invoke: wsInvoke, ... }
                    ↓
  invoke/listen → WebSocket → Rust 백엔드 (동일 서버)
```

장점:
- **overlay/App.tsx 변경 0** — 기존 훅, 스토어, 이벤트 버스 모두 그대로
- **useOverlayRuntime.ts 제거** — 중복 로직 완전 해소
- **shim 표면적 최소** — invoke + listen 2개만 교체
- **향후 확장 자동 지원** — 새 window.api 메서드 추가 시 shim 수정 불필요
- **플러그인 자연 지원** — dmn.* API가 invoke를 사용하므로 자동 호환

#### 재사용성 원칙

이 호환성 레이어는 **DmNote에 종속되지 않는 범용 구조**로 설계:

| 계층 | 역할 | 프로젝트 종속 여부 |
|------|------|:---:|
| 프론트 IPC shim | `__TAURI_INTERNALS__` → WS RPC 교체 | **범용** |
| 프론트 이벤트 시스템 | 콜백 레지스트리 + `tauri_event` 디스패치 | **범용** |
| 프론트 deny 체크 | `hello_ack`에서 수신한 단일 배열로 동적 구성 | **백엔드에서 수신 (관리 불필요)** |
| 백엔드 WS RPC | `invoke_request` → `webview.on_message()` 자동 디스패치 | **범용** |
| 백엔드 deny 리스트 | OBS에서 의미 없는 커맨드 차단 | **프로젝트별 설정 (유일한 관리 포인트)** |
| 백엔드 이벤트 포워딩 | Tauri emit → `tauri_event` WS 브로드캐스트 | **범용** |

프로젝트별로 관리하는 것은 **deny 리스트 하나뿐** — **백엔드 Rust 코드에서 1곳만 관리**.
프론트엔드는 WS handshake(`hello_ack`)에서 deny 리스트를 수신하여 No-op Set을 동적 구성.
나머지 인프라는 어떤 Tauri 앱이든 그대로 이식 가능.

### 12.4 IPC Shim 구현

#### 설계 원칙

shim은 **커맨드별 분기를 하지 않는다**. 모든 invoke 호출은 다음 3단계로만 처리:

1. **이벤트 플러그인** (`plugin:event|*`) → 로컬 콜백 레지스트리에서 처리
2. **No-op** (OBS에서 의미 없는 창 관리 커맨드) → 즉시 반환
3. **WS RPC** → 백엔드에 전달, 실제 커맨드 핸들러가 처리

```typescript
// src/renderer/api/ipcShim.ts

// deny 리스트는 하드코딩 아님 — WS handshake(hello_ack)에서 수신
let denyList: string[] = [];

async function shimInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  // 1. 이벤트 플러그인 (프론트엔드 로컬)
  if (cmd === 'plugin:event|listen') return handleEventListen(args);
  if (cmd === 'plugin:event|unlisten') { handleEventUnlisten(args); return; }
  if (cmd === 'plugin:event|emit') { handleEventEmit(args); return; }

  // 2. deny 체크 (백엔드에서 수신한 단일 리스트)
  if (isDenied(cmd)) return;

  // 3. 나머지 전부 → WS RPC (백엔드가 실제 처리)
  return wsRpc(cmd, args);
}

// "|"로 끝나면 prefix 매칭, 아니면 exact 매칭
function isDenied(cmd: string): boolean {
  return denyList.some(entry =>
    entry.endsWith('|') ? cmd.startsWith(entry) : cmd === entry
  );
}
```

**커맨드 추가 시 shim 수정 불필요** — 백엔드에 커맨드가 있으면 자동으로 동작.

#### deny 리스트 일원화

**백엔드가 유일한 source of truth**. 단일 배열 하나로 exact + prefix 매칭 통합.
`|`로 끝나는 항목은 prefix 매칭, 아니면 exact 매칭.
프론트엔드는 WS handshake에서 수신:

```json
// hello_ack 응답에 deny 리스트 포함
{
  "type": "hello_ack",
  "payload": {
    "serverVersion": "1.5.2",
    "obsMode": true,
    "denyList": [
      "overlay_resize", "overlay_set_visible", "overlay_set_lock",
      "overlay_set_anchor", "overlay_get",
      "window_minimize", "window_close", "window_show_main",
      "window_open_devtools_all",
      "app_quit", "app_restart", "app_open_external", "app_auto_update",
      "plugin:window|", "plugin:menu|", "plugin:resources|"
    ]
  }
}
```

프론트 shim은 `hello_ack` 수신 시 `denyList`를 그대로 저장:

```typescript
function onHelloAck(payload: HelloAckPayload) {
  denyList = payload.denyList ?? [];
}
```

이 구조의 장점:
- **관리 포인트 1곳** — Rust 코드의 `DENIED_WS_COMMANDS` 배열 하나만 수정
- **단일 배열** — exact/prefix 구분 없이 하나의 리스트로 통합 (`|` suffix 컨벤션)
- **빌드 의존성 없음** — codegen이나 공유 JSON 파일 불필요
- **런타임 동기화** — 백엔드 버전이 올라가도 프론트 shim 재빌드 필요 없음

#### deny 커맨드 목록 (참고 — Rust에서만 관리)

| 항목 | 매칭 | 이유 |
|------|------|------|
| `overlay_resize`, `overlay_set_visible` 등 | exact | Tauri 윈도우 조작 |
| `window_minimize`, `window_close` 등 | exact | 네이티브 윈도우 제어 |
| `app_quit`, `app_restart` 등 | exact | 앱 생명주기 |
| `plugin:window\|` | prefix | Tauri window 플러그인 전체 |
| `plugin:menu\|` | prefix | Tauri menu 플러그인 전체 |
| `plugin:resources\|` | prefix | Tauri resources 플러그인 전체 |

`raw_input_subscribe` 등 **백엔드 기능이 필요한 커맨드**는 deny가 아닌 WS RPC로 처리.

### 12.5 WS ↔ Tauri 이벤트 매핑

#### invoke (요청/응답) — 백엔드 WS RPC

shim에서는 커맨드를 구분하지 않고 전부 WS RPC로 전달.
백엔드 WS 서버가 실제 커맨드 핸들러를 호출하여 응답 (§12.11 참조).

```
프론트엔드                        백엔드
shimInvoke('settings_get')
  → WS: { type: "invoke_request", requestId, command: "settings_get", args }
                                  → settings_get() 핸들러 호출
                                  ← WS: { type: "invoke_response", requestId, result: {...} }
  ← resolve(result)
```

#### listen (이벤트 구독) — WS 메시지 → Tauri 이벤트 디스패치

WS 브로드캐스트 메시지를 수신하면 Tauri 이벤트명으로 변환하여 등록된 리스너에 디스패치:

| WS 메시지 타입 | → Tauri 이벤트 | 비고 |
|---------------|---------------|------|
| `key_event` | `keys:state` | keyEventBus 구독 |
| `settings_diff` | `settings:changed` | `{ changed: patch }` 래핑 |
| `counter_update` | `keys:counters` | 전체 카운터 |
| `snapshot` | `keys:changed`, `positions:changed`, `settings:changed` 등 | 다수 이벤트 일괄 디스패치 |
| `tauri_event` | 이벤트명 그대로 | 범용 이벤트 포워딩 (§12.12) |

#### stats 구독

`keyStatsService`가 `listen('keys:state')` + `invoke('app_bootstrap')`을 사용.
shim이 설치되면 자동으로 WS 경유 동작 — 별도 처리 불필요.

### 12.6 창 관리 API No-op 스텁

overlay/App.tsx가 `@tauri-apps/api/window`, `@tauri-apps/api/menu` 등을 직접 import.
이 모듈들은 내부적으로 `invoke('plugin:window|...', ...)` 형태로 호출.

백엔드 deny 리스트의 `denyPrefixes`에 `plugin:window|`, `plugin:menu|` 등이 포함되어
shim이 handshake 시 수신한 prefix 매칭으로 자동 no-op 처리 — 별도 모듈 모킹 불필요.

`convertFileSrc()`는 `__TAURI_INTERNALS__.convertFileSrc`에 설치되므로 shim에서 직접 제공.
OBS HTTP 서버의 `/media/<base64>?token=...` 경로로 변환:

```typescript
function shimConvertFileSrc(filePath: string): string {
  const encoded = btoa(filePath);
  return `http://${host}:${port}/media/${encoded}?token=${sessionToken}`;
}
```

### 12.7 obs/index.tsx 진입점

```tsx
// src/renderer/windows/obs/index.tsx
import { initIpcShim, disposeIpcShim } from '@api/ipcShim';

async function bootstrap() {
  const params = new URLSearchParams(window.location.search);
  const host = params.get('host') || window.location.hostname || '127.0.0.1';
  const port = params.get('port') || window.location.port || '34891';
  const token = params.get('token') || '';
  const wsUrl = `ws://${host}:${port}`;

  await initIpcShim(wsUrl, token);
  await import('@api/dmnoteApi');
  window.__dmn_window_type = 'overlay';

  const { I18nProvider } = await import('@contexts/I18nContext');
  const { default: App } = await import('@windows/overlay/App');
  // render <I18nProvider><App /></I18nProvider>
}
```

### 12.8 구현 단계

| 단계 | 작업 | 영역 |
|------|------|------|
| 1 | **프론트 IPC shim** — WS 연결, `__TAURI_INTERNALS__` 설치, No-op, WS RPC | `api/ipcShim.ts` |
| 2 | **백엔드 WS RPC 핸들러** — `invoke_request` 수신 → 커맨드 라우팅 → `invoke_response` (§12.11) | `obs_bridge.rs` |
| 3 | **백엔드 이벤트 포워딩** — Tauri 이벤트를 `tauri_event` WS 메시지로 포워딩 (§12.12) | `obs_bridge.rs` |
| 4 | **snapshot 필드 보강** — `layerGroups`, `tabNoteOverrides`, `tabCssOverrides` 추가 | `app_state.rs`, `mod.rs` |
| 5 | **obs/index.tsx 재작성** — shim 초기화 + overlay/App 동적 임포트 | `windows/obs/index.tsx` |
| 6 | **convertFileSrc 수정** — OBS HTTP `/media/` 경로 매핑 | `api/ipcShim.ts` |
| 7 | **검증 + 정리** — useOverlayRuntime.ts, useObsWebSocket.ts 제거 | |

### 12.9 WS 프로토콜 확장

#### 신규 메시지 타입

| 방향 | 타입 | 용도 |
|------|------|------|
| C→S | `invoke_request` | 커맨드 실행 요청 |
| S→C | `invoke_response` | 커맨드 실행 결과 |
| S→C | `tauri_event` | 범용 Tauri 이벤트 포워딩 |

#### invoke_request / invoke_response

```json
// C→S
{ "v": 1, "type": "invoke_request", "seq": 42,
  "payload": { "requestId": "rpc_xxx", "command": "settings_get", "args": {} } }

// S→C
{ "v": 1, "type": "invoke_response", "seq": 43,
  "payload": { "requestId": "rpc_xxx", "result": { ... } } }
// 에러 시
{ "v": 1, "type": "invoke_response", "seq": 43,
  "payload": { "requestId": "rpc_xxx", "error": "Not found" } }
```

#### tauri_event (범용 이벤트 포워딩)

```json
// S→C — 백엔드의 모든 Tauri emit을 WS로 전달
{ "v": 1, "type": "tauri_event", "seq": 44,
  "payload": { "event": "keys:counter", "data": { "mode": "4key", "key": "A", "count": 42 } } }
```

### 12.10 리스크 및 제약

| 리스크 | 심각도 | 대응 |
|--------|--------|------|
| `window.__TAURI_INTERNALS__` 내부 API 변경 | 중 | Tauri 버전 고정 + 업그레이드 시 shim 검증 |
| WS RPC 보안 (임의 커맨드 실행) | 중 | deny 리스트 + Tauri ACL 재사용 + 세션 토큰 검증 |
| `InvokeRequest` API 안정성 | 중 | Tauri 2.x 내 변경 가능성 낮음, 업그레이드 시 한 곳만 수정 |
| overlay 전용 API 누락으로 런타임 에러 | 낮 | No-op prefix 매칭 (`plugin:window|*`) + try/catch 가드 |
| WS RPC 지연 (localhost) | 낮 | <1ms, 체감 불가 |
| pendingRpc dispose 시 미해결 Promise | 낮 | dispose 시 모든 pending을 reject 처리 |

### 12.11 백엔드 WS RPC 핸들러

OBS 브라우저에서 `invoke(cmd, args)`가 호출되면 shim이 WS `invoke_request`로 전달.
백엔드 WS 서버가 이를 **Tauri의 기존 커맨드 파이프라인에 주입**하여 자동 처리.

#### 핵심: `Webview::on_message(InvokeRequest)` 활용

Tauri v2는 `WebviewWindow::on_message(request, responder)` API를 제공.
이를 통해 WS 요청을 "가짜 IPC"로 주입하면 **수동 커맨드 라우팅 없이** 기존 `#[tauri::command]` 파이프라인을 그대로 탈 수 있음.

```rust
// obs_bridge.rs — WS invoke_request 핸들러
async fn handle_invoke_request(
    app: &AppHandle,
    request_id: &str,
    command: &str,
    args: Value,
    ws_tx: &WsSender,
) {
    // 1. deny 리스트 체크 (= 프론트 No-op 리스트와 동일)
    if DENIED_WS_COMMANDS.contains(&command) {
        ws_tx.send(invoke_response_error(request_id, "Command not allowed"));
        return;
    }

    // 2. Tauri 파이프라인에 주입 — match문 없음
    let webview = app.get_webview_window("main").unwrap();
    let request = InvokeRequest {
        cmd: command.to_string(),
        body: InvokeBody::Json(args),
        headers: Default::default(),
        url: webview.url().unwrap(),  // ACL 검증용
        invoke_key: app.invoke_key().to_string(),
    };

    let request_id = request_id.to_string();
    let tx = ws_tx.clone();
    webview.on_message(request, Box::new(move |_webview, _cmd, response, _cb, _err| {
        // 3. Tauri 응답을 WS invoke_response로 변환
        tx.send(invoke_response(&request_id, response));
    }));
}
```

#### deny 리스트 (유일한 source of truth)

**이 배열 하나가 프론트/백엔드 양쪽의 유일한 관리 포인트**.
`|`로 끝나는 항목은 prefix 매칭, 아니면 exact 매칭 — 프론트/백엔드 동일 규칙.
WS handshake 시 `hello_ack`에 포함하여 프론트엔드에 전달 (§12.4 참조).

```rust
// obs_bridge.rs — 유일한 deny 리스트 정의 (단일 배열)
const DENIED_WS_COMMANDS: &[&str] = &[
    // exact 매칭
    "overlay_resize", "overlay_set_visible", "overlay_set_lock",
    "overlay_set_anchor", "overlay_get",
    "window_minimize", "window_close", "window_show_main",
    "window_open_devtools_all",
    "app_quit", "app_restart", "app_open_external", "app_auto_update",
    // prefix 매칭 ("|"로 끝남)
    "plugin:window|", "plugin:menu|", "plugin:resources|",
];

fn is_denied(cmd: &str) -> bool {
    DENIED_WS_COMMANDS.iter().any(|entry| {
        if entry.ends_with('|') { cmd.starts_with(entry) }
        else { cmd == *entry }
    })
}
```

```rust
// hello_ack 전송 시 deny 리스트 포함
fn build_hello_ack(&self) -> Value {
    json!({
        "serverVersion": self.server_version,
        "obsMode": true,
        "denyList": DENIED_WS_COMMANDS,
    })
}
```

deny에 없는 커맨드는 **자동으로 Tauri가 처리** — 새 커맨드 추가 시 양쪽 모두 수정 불필요.
Tauri의 ACL 시스템이 보안 경계 역할을 하므로 별도 화이트리스트 불필요.

#### 장점

- **match문 완전 제거** — 커맨드별 분기 없음
- **인자 역직렬화 자동** — Tauri의 `#[tauri::command]` 매크로가 처리
- **ACL 재사용** — Tauri permissions 시스템이 보안 검증
- **새 커맨드 자동 지원** — `#[tauri::command]` 추가하면 WS에서도 즉시 동작
- **관리 포인트 1개** — Rust deny 리스트만 수정하면 `hello_ack`로 프론트에 자동 전파

#### 제약

- `InvokeRequest`는 Tauri에서 stable API로 보장하지 않음 — Tauri 메이저 업그레이드 시 검증 필요
- `webview.on_message()` 호출에 기존 Webview 인스턴스 필요 (main window 사용)
- `invoke_key`는 내부 보안 키이므로 외부 노출 금지

### 12.12 백엔드 이벤트 포워딩

현재 WS 서버는 `key_event`, `settings_diff`, `counter_update`, `snapshot`만 전송.
IPC shim이 모든 이벤트를 `listen()`할 수 있으려면 백엔드가 **Tauri 이벤트를 WS로 포워딩**해야 함.

#### 접근 방식: `tauri_event` 범용 메시지

백엔드에서 Tauri 이벤트가 emit될 때 WS 클라이언트에도 전달:

```rust
// app_state.rs — 이벤트 emit 시 WS도 함께 전송
fn emit_and_forward(&self, event: &str, payload: &impl Serialize) {
    // 1. 기존: Tauri 윈도우로 emit
    self.app_handle.emit(event, payload).ok();

    // 2. 신규: OBS WS 클라이언트로 포워딩
    if let Some(bridge) = &self.obs_bridge {
        bridge.forward_tauri_event(event, payload);
    }
}
```

```rust
// obs_bridge.rs
pub fn forward_tauri_event(&self, event: &str, payload: &impl Serialize) {
    let envelope = ObsEnvelope::tauri_event(event, serde_json::to_value(payload).unwrap());
    self.broadcast(envelope);
}
```

#### 포워딩 대상 이벤트

| 이벤트 | 소비자 | 기존 WS 대체 |
|--------|--------|-------------|
| `keys:state` | keyEventBus, keyStatsService | 기존 `key_event` → `tauri_event`로 통합 가능 |
| `keys:counter` | keyStatsService (total 실시간 갱신) | **신규** — 현재 누락 |
| `keys:counters` | useAppBootstrap | 기존 `counter_update` |
| `settings:changed` | useAppBootstrap | 기존 `settings_diff` |
| `keys:changed` | useAppBootstrap | 기존 `snapshot` 내 |
| `positions:changed` | useAppBootstrap | 기존 `snapshot` 내 |
| `css:use`, `css:content` | useCustomCssInjection | **신규** — 현재 누락 |
| `tabCss:changed` | useCustomCssInjection | **신규** — 현재 누락 |
| `js:use`, `js:content` | customJsRuntime | **신규** — 현재 누락 |
| `input:raw` | rawKeyEventBus (플러그인) | **신규** — raw_input_subscribe 시 |
| `plugin-bridge:message` | PluginElementsRenderer | **신규** — 플러그인 지원 시 |

#### 전환 전략

기존 전용 WS 메시지(`key_event`, `settings_diff`, `counter_update`)를 즉시 제거하면 하위 호환 깨짐.
단계적 전환:

1. **1단계**: `tauri_event` 포워딩 추가 (신규 이벤트만: `keys:counter`, `css:*`, `js:*`, `input:raw`)
2. **2단계**: shim의 `onWsMessage`에서 기존 메시지 타입 처리 유지 + `tauri_event` 처리 추가
3. **3단계** (선택): 기존 전용 메시지를 `tauri_event`로 통합, `onWsMessage` 매핑 로직 제거

### 12.13 프론트엔드 shim 최종 구조

위 백엔드 호환성 레이어가 완성되면, ipcShim.ts는 다음으로 축소:

```typescript
// ── deny 리스트 (hello_ack에서 수신, 하드코딩 없음) ──
let denyList: string[] = [];

// ── invoke 핸들러 ──
async function shimInvoke(cmd, args) {
  // 1. 이벤트 플러그인 (프론트엔드 로컬 — 콜백 레지스트리)
  if (cmd.startsWith('plugin:event|')) { /* listen/unlisten/emit */ }

  // 2. deny 체크 ("|"로 끝나면 prefix, 아니면 exact)
  if (isDenied(cmd)) return;

  // 3. WS RPC (백엔드가 처리)
  return wsRpc(cmd, args);
}

// ── WS 메시지 수신 ──
function onWsMessage(envelope) {
  switch (envelope.type) {
    // 기존 호환 (1단계)
    case 'key_event':      dispatchEvent('keys:state', envelope.payload); break;
    case 'settings_diff':  dispatchEvent('settings:changed', { changed: envelope.payload }); break;
    case 'counter_update': dispatchEvent('keys:counters', envelope.payload); break;
    case 'snapshot':       /* 다수 이벤트 일괄 디스패치 */ break;

    // 범용 포워딩 (2단계)
    case 'tauri_event':    dispatchEvent(envelope.payload.event, envelope.payload.data); break;

    // RPC 응답
    case 'invoke_response': /* pending RPC resolve/reject */ break;
  }
}
```

3단계 전환 완료 후에는 기존 `case 'key_event'` 등이 제거되고 `tauri_event` 하나로 통합.

---

## 13. 남은 작업 우선순위 (2026-03-08 기준)

> v3 P1/P2 대부분 완료. 아래는 미완료 항목을 우선순위별로 정리.

### Tier 1 — IPC Shim + 백엔드 호환성 레이어 (§12)

| # | 작업 | 영역 | 비고 |
|---|------|------|------|
| 1 | **프론트 IPC shim** — WS 연결 + invoke/listen + No-op + WS RPC | `api/ipcShim.ts` | |
| 2 | **백엔드 WS RPC** — `invoke_request` → `webview.on_message()` 자동 디스패치 | `obs_bridge.rs` | §12.11 |
| 3 | **백엔드 이벤트 포워딩** — `tauri_event` WS 메시지 추가 | `obs_bridge.rs`, `app_state.rs` | §12.12 |
| 4 | **snapshot 필드 보강** — `layerGroups`, `tabNoteOverrides`, `tabCssOverrides` | `app_state.rs`, `mod.rs` | |
| 5 | **convertFileSrc 수정** — OBS HTTP `/media/` 경로 매핑 | `api/ipcShim.ts` | |
| 6 | **obs/index.tsx 재작성** — shim → dmnoteApi → overlay/App | `windows/obs/index.tsx` | |
| 7 | **검증 + 정리** — useOverlayRuntime.ts, useObsWebSocket.ts 제거 | | |

구현 결과:
- overlay/App.tsx **코드 변경 0**
- obs/App.tsx가 overlay/App.tsx와 **동일 코드** 실행
- 중복 로직 **완전 해소** (useOverlayRuntime 417줄 제거)
- **커맨드 추가 시 양쪽 모두 수정 불필요** — deny 리스트에 없으면 자동 동작
- **deny 리스트 관리 포인트 1곳** — Rust `DENIED_WS_COMMANDS` 수정 시 WS handshake로 프론트에 자동 반영

### Tier 2 — 프로토콜 통합 (Tier 1 완료 후)

| # | 작업 | 설명 |
|---|------|------|
| 8 | **기존 WS 메시지를 `tauri_event`로 통합** | `key_event` → `tauri_event { event: "keys:state" }` 등 |
| 9 | **shim `onWsMessage` 매핑 제거** | 통합 후 `tauri_event` + `invoke_response` 만 남김 |

### Tier 3 — 알려진 이슈 (낮은 우선순위)

| # | 이슈 | 증상 | 추정 원인 |
|---|------|------|-----------|
| 10 | **초기 접속 시 빈 화면** | 최초 접속 시 키 UI 미표시, 위치 변경 후 표시 | 레이아웃 계산 타이밍. IPC shim 도입 시 자연 해소 가능성 |

### 완료된 주요 마일스톤

```
v1: WS 서버 + OBS 페이지 기본 동작
v2: HTTP+WS 통합 서빙, layout_diff, cached_snapshot 증분 갱신
v3 P1: 설정 영속화, 오버레이 연동, KPS 로컬 계산, UI 안내
v3 P2: 커스텀 CSS, 배경 미디어, keyDisplayDelayMs, 키별 노트 효과,
       보안 토큰, dev 모드 서빙, 포터블 exe AssetFetcher
v4 (예정): Tauri IPC Shim + 백엔드 호환성 레이어 → 완전한 코드 재사용
```
