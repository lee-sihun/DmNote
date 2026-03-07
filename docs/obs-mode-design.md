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
    static_dir: RwLock<Option<PathBuf>>,      // v2: HTTP 정적 서빙용
}
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
tokio-tungstenite = "0.26"
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
| bounds/position 계산 | | ✅ | ✅ (중복) |
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

### 7.2 모드 전환 동작 ⚠️ 부분 구현

1. ✅ OBS 모드 ON → WS 서버 bind → URL 표시
2. ✅ OBS 클라이언트 접속 → 상태 점등
3. ✅ 연결 끊김 → 서버 유지, 상태 표시 갱신
4. ❌ 오버레이 창 자동 숨김/복구 미구현
5. ❌ OBS 설정이 백엔드 설정 모델과 분리 (런타임 토글만, 재시작 시 초기화)

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
| 포트 보안 | 중 | 랜덤 세션 토큰 검토 필요 | ❌ 미구현 |
| tokio 런타임 추가 | 낮 | 기존 tokio 재사용 | ✅ |

### 8.2 기능 제약 (v2 기준)

| 기능 | 지원 여부 |
|------|-----------|
| 키 UI + 노트 효과 | ✅ 지원 |
| 통계/그래프 표시 | ✅ 지원 (렌더링만, KPS 값은 항상 0) |
| 키 카운터 | ✅ 지원 |
| HTTP 정적 서빙 | ✅ 지원 |
| 레이아웃 동기화 | ✅ 지원 (snapshot 재전송) |
| 커스텀 CSS | × 미지원 |
| 배경 미디어 서빙 | × 미지원 |
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
| 5 | **커스텀 CSS** | OBS 페이지에 사용자 CSS 주입, HTTP 서빙 경로로 제공 | ❌ |
| 6 | **배경 이미지/영상** | 사용자 미디어 파일 HTTP 서빙 + 경로 해석 | ❌ |
| 7 | **keyDisplayDelayMs** | OBS에서 키 표시 지연 반영 (메인 오버레이와 동일 패턴) | ✅ |
| 8 | **개별 키 noteEffectEnabled** | 키별 노트 효과 on/off 반영 | ✅ |
| 9 | **보안 토큰** | 랜덤 세션 토큰 생성 + WS hello 검증 | ❌ |
| 10 | **Dev 모드 서빙** | dev 모드 시 Vite dev server로 프록시하여 빌드 없이 OBS 페이지 테스트 가능하도록 지원 | ❌ |
| 11 | **DataSource 호환성 레이어** | Tauri API / WebSocket 통합 인터페이스 (DataSource adapter) 도입, overlay/obs 공용 레이아웃 훅 추출로 중복 제거 | ❌ |

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
