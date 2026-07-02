# HID 입력 지원 설계 문서

> 작성일: 2026-06-04
> 목표: 키보드/마우스 외 HID 기기(게임패드/아케이드 컨트롤러/사볼콘 등)의 버튼·축 입력을 인식하고 시각화에 통합
> 상태: **1단계(인식 검증) 완료** / **2단계(시각화 통합) 설계**
> 범위: 우선 **Windows 전용** (Raw Input 기반)

---

## 1. 배경 및 목표

기존 입력 캡처는 키보드(Raw Input usage 0x06)·마우스(0x02)만 처리한다. 게임패드/노브/조이스틱 등 HID 기기는 인식 경로가 없었다(`InputDeviceKind::Gamepad`는 placeholder만 존재).

목표:
1. **Windows Raw Input(WM_INPUT)을 확장**해 임의 HID 기기의 버튼과 축(노브/스틱)을 인식.
2. **사전 라벨 정의 없이** 동작(키보드/마우스처럼). preparsed data 기반 동적 디코딩.
3. **버튼**은 기존 키 시각화(on/off)로 동일 처리. **축(노브)**은 좌우로 회전하는 **신규 시각화 요소**로 표현.

검증 리스크를 낮추기 위해 전체 통합 전 **1단계로 인식 테스트용 임시 로깅**을 먼저 배포해 실기기 데이터를 확보했다(이 문서 §2). 그 결과를 토대로 2단계 시각화 통합을 설계한다(§3 이후).

---

## 2. 1단계 분석 기록 (인식 검증)

### 2.1 방법
- 데몬 프로세스(`--keyboard-daemon`)의 Raw Input 등록에 joystick(0x01/0x04)·gamepad(0x01/0x05)·multi-axis(0x01/0x08)를 추가하고, `WM_INPUT`의 `RIM_TYPEHID` 분기에서 `HidP_*` API로 동적 디코딩.
- 데몬에는 fern 로깅이 없으므로(`main.rs:54`에서 `setup_logging()` 전 return) 자체 파일 핸들로 NDJSON 직접 기록.
- 임시 코드: `src-tauri/src/keyboard/daemon/windows_hid.rs`. cargo feature 없이 일반 빌드에 항상 컴파일(검증 후 제거 전제).
- HID 기기 보유 테스터에게 배포 → **약 3시간 분량 로그(420MB, 3,737,918줄, 3세션)** 회수.

### 2.2 인식된 기기
```
name: \\?\HID#VID_1CCF&PID_1014#...
usagePage 1 / usage 5  (Generic Desktop / Gamepad)
buttonCaps: page 0x09, usage 1~16 (isRange)           → 버튼 16개
valueCaps : Generic Desktop, usage 0x30(X)/0x31(Y),    → 축(노브) 2개
            8-bit, logicalMin 0 / logicalMax 255
            physicalMin/Max 0 (미선언)
```
전형적인 **사운드볼텍스(SDVX) 컨트롤러**: 버튼 16개 + 좌/우 노브 2개(X/Y축). Gamepad(0x05)로 열거되어 우리 등록 경로에 정확히 잡힘.

### 2.3 결과 (kind 분포)
| kind | 건수 | 의미 |
|------|------|------|
| session_start | 3 | 앱 3회 실행 |
| device | 1 | 기기 1종 인식 |
| button | 96,342 | down **48,171** = up **48,171** (완전 균형) |
| axis | 1,844,161 | 노브 값 변화 |
| raw | 1,797,411 | 변화 리포트 원본 hex |

판정:
- **버튼**: usage 1~16 **전부** 등장(16개 모두 인식). down/up 엣지가 정확히 1:1 균형 → stuck/누락 없음. 정상 입력 정합성 확인: 단일 버튼 press 시 `usage 2 ↔ raw byte bit1(0x02)` 일치.
- **축(노브)**: X축(usage 48) 값이 **0~255 전 구간을 거의 균일하게 방문**(값당 ~3,100회, 0에만 정지값으로 약간 몰림). → **연속 순환(wrapping) 엔코더 확정** (중앙복귀형 조이스틱 아님). 절대값→각도 직접 매핑 불가, **wrap 인지 델타 누적**이 필요.
- **scaled 값**: 기기가 physicalMin/Max를 0/0으로 미선언 → `HidP_GetScaledUsageValue`가 자주 null. **`raw` 값을 사용해야 함.**
- **볼륨**: 8-bit 축이라 데드밴드 `(255-0)/256 = 0` → 노이즈 필터 사실상 무작동. 노브 연속 변화로 axis 이벤트 184만 건. → **백엔드 스로틀/델타 전송 + 프론트 보간 필수**.

### 2.4 결론
HID 인식 파이프라인(Raw Input HID 등록 → preparsed/caps 동적 디코딩 → 버튼 엣지 + 축 값 추출)이 **실기기에서 정상 동작**함이 입증됨. 사전 라벨 없이 타깃 기기(사볼콘)의 버튼·노브를 인식. **2단계 진행 가능.**

### 2.5 커버리지 한계 (인식 안 되는 경우)
- **키보드 에뮬레이션 컨트롤러**: usage 0x06으로 열거되는 기기(아케이드 컨트롤러 "키보드 모드")는 기존 키보드 경로로 잡힘(이미 동작). HID 경로엔 안 잡힘.
- **Xbox 패드**: XInput 경유 → Raw Input HID로는 트리거/축 왜곡 가능. 완전 지원은 별도 XInput 경로(범위 밖).
- **vendor-defined usage page**: 의미 불명 → raw hex로만 확인 가능.
- **검증 범위**: 사볼콘 1종만 실측. Joy-Con/일반 게임패드 등 타 클래스는 미검증.

---

## 3. 2단계 설계 — 시각화 통합

### 3.1 기존 입력→시각화 데이터 흐름 (키/버튼 기준)
```
[데몬 windows.rs run_raw_input]
   WM_INPUT → HookMessage(JSON 한 줄) → named pipe(dmnote_keys_v1)
[메인 app_state.rs reader 스레드]
   pipe 라인 파싱 → input:raw emit(main+overlay) → keyboard.match_candidate(매핑)
   → register_key_down/up(중복억제) → counter 증가 → keys:state emit
[overlay 프론트]
   keyEventBus(keys:state 구독) → setKeyActiveSignal(key, isDown)
   → keySignals(globalKey→Signal<boolean>) → Key 컴포넌트가 active 토글 렌더
   → OverlayScene가 keyMappings[mode]+positions[mode]로 배치
```
- 매핑 데이터 모델: `KeyMappings = mode→Vec<globalKey>`, `KeyPositions = mode→Vec<KeyPosition>` (`models/mod.rs`).
- 키 매핑 UI: `KeySetting`이 `input:raw`의 `label`을 globalKey로 저장. **매핑은 백엔드가 보내는 라벨 문자열에 의존.**
- **신규 위치형 요소의 정석 레퍼런스 = GraphItem**: `GraphPositions`(mode→Vec<GraphPosition>)가 store/app_state/models/migration/preset(save·load)/obs_bridge 등 **14개 파일**에 걸쳐 등록됨. 회전 요소는 이 패턴 복제가 마찰 최소.
- OBS: `obs_bridge.rs`의 `register_event_forwarding`가 `keys:state`/`input:raw` 등을 WS broadcast. **신규 이벤트는 이 배열에 등록해야 OBS 모드에서 동작.**

### 3.2 버튼 (기존 경로 재사용)
버튼은 매핑 라벨만 생기면 기존 파이프라인을 그대로 탄다.
- 데몬의 버튼 엣지 산출(현재 `windows_hid.rs`의 진단 로직)을 정식 경로로 승격, down/up마다 `HookMessage{device:Gamepad, labels:[<라벨>], state}` 전송.
- **라벨 스킴(안)**: `HIDB:<vid>:<pid>:<usagePage>:<usage>` (handle은 재접속 시 바뀌므로 vid/pid 사용 — `read_device_info`가 vid/pid 제공).
- 이러면 `KeySetting`의 `input:raw` 캡처가 그대로 동작(라벨 문자열만 globalKey로 저장), `getKeyInfoByGlobalKey` fallback 표시. 선택적으로 `extraGlobalKeyMap`에 표시명 추가.
- **ipc.rs 변경 불필요**(labels/state로 충분).

### 3.3 축(노브) → 회전 요소 (신규 경로)
요구사항의 핵심. 두 개의 신규 경로가 필요: (a) 백엔드가 축 델타를 안전 전송, (b) 프론트가 누적 각도 신호 + 신규 렌더 요소.

#### (1) wrap-aware 델타 누적 — [개정] 절대값 전송 + 프론트 델타
- wrap 최단경로 델타: `delta = ((cur - prev + half) mod full) - half`, `full = 1 << bitSize`, `half = full/2`. 255→0은 +1, 0→255는 -1.
  - 출시된 IIDX 위젯(IIDXwidget, §부록 참조)이 `(new-last+256)%256; if(delta>127)delta-=256`로 동일 알고리즘 사용 — **실전 검증됨**.
- **[개정] 전송 모델**: 당초 "백엔드 부호 델타 합산 전송"에서 → **백엔드는 throttle로 최신 절대값(raw)만 전송(+정지 시 trailing flush), 프론트가 wrap 델타 계산** 으로 변경.
  - 이유: 절대값은 **멱등** → 메시지 드롭/coalesce에 강함(델타 합산은 드롭 시 회전량 영구 손실). multi-window/OBS가 같은 절대값을 받아 각자 델타 계산 → **자동 일관**(IIDX가 이 방식). 단 한 샘플 간격에 half-turn 초과 회전 시 방향 오판 가능(현실 폴링레이트에선 드묾).
- **bitSize 일반화**(8-bit 하드코딩 금지 — 10/16bit 노브 가능). `value_caps.BitSize` 사용.
- scaled는 null 빈번 → **raw만 사용**.
- 프론트 누적: `accumAngle += delta * sensitivity`.

#### (2) 방향/속도/민감도 — **[확정] 사용자 조절**
- 방향 = 델타 부호, 속도 = 단위시간당 델타 합.
- **요소별 사용자 설정**: 민감도 슬라이더 + **방향 반전 토글**(좌/우 노브 회전 방향 맞춤). 기본 `sensitivity = 360/(1<<bitSize)`(노브 1회전 = 화면 1회전).
- 속도 기반 효과(블러/글로우)는 선택. 1차는 각도 추종만.

#### (3) 정지 거동 + 렌더 스로틀/보간
- 두 가지 스무딩 방식:
  - **[v1 권장] CSS transition** — `transform: rotate(...)`에 `transition: transform ~0.1s linear` 부여. 신호 갱신 시 transform만 바꾸면 CSS가 프레임 간 보간. 코드 최소·GPU 가속. 입력 멈추면 0.1s glide로 자연 soft-stop. **출시된 IIDX 위젯이 20ms throttle + CSS transition 0.1s로 처리(rAF 없음) — 검증됨.**
  - **[고급] rAF lerp** — `display += (target-display)*k`. 관성/마찰 등 정교한 거동에 필요. v1 CSS transition으로 부족할 때 교체.
- **[보류] 정지 거동**: 즉시 추종(소프트 정지) vs 관성/감쇠. v1은 CSS transition의 0.1s glide로 충분히 소프트 정지가 되므로 이것으로 시작, 관성 원하면 rAF lerp로 전환.
- React 리렌더 회피: `Key.tsx`의 `useSignals()`+signal 패턴 따라 **signal 구독 + transform만 직접 변경**(CSS transition이 보간하므로 rAF 루프 불필요).

#### (4) 시각 표현
- 1차: 사용자 지정 이미지(다이얼/휠)를 `transform: rotate(displayAngle)`로 회전. `KeyPosition`의 image/size 필드 재사용. 게이지/원호형은 후속.

#### (5) 매핑 UI
- 축 식별자 = `(vid, pid, usagePage, usage)`. 라벨 스킴(안): `HIDA:<vid>:<pid>:<usagePage>:<usage>`.
- 축 캡처 UI: "가장 최근 움직인 축"을 listen(델타 임계 기준 자동 선택). 회전 요소 추가/배치 UI는 GraphItem 추가 UI 복제.

#### (6) 백엔드 데이터 흐름
- **버튼**: 기존 `HookMessage`(device=Gamepad) 재사용.
- **축**: `HookMessage`는 down/up enum뿐 → 연속값 부적합. **신규 `HidAxisMessage{device, axisId, raw}` 추가**(개정: delta가 아니라 절대 raw 전송, §(1) 참조), reader가 별도 분기해 신규 `input:axis` Tauri 이벤트 emit. (pipe는 줄 단위 JSON이라 reader의 `DaemonCommand→HookMessage` 시도 패턴에 한 단계 추가.)
- **고빈도 부하 대응(필수)**: 절대값 데드밴드 폐기(8-bit에서 0). 대신 **시간 윈도우(~8~16ms) throttle로 윈도우당 최신 절대값 1개만 전송 + 값 미변동 시 스킵 + 정지 시 trailing flush**(마지막 값 누락 방지). pipe write·IPC·OBS broadcast 부하 동시 억제. reader는 축 메시지를 `register_key_*`/sound/counter 경로에 태우지 않음.
- **OBS**: 신규 `input:axis`를 `obs_bridge.rs`의 forwarded_events에 등록.

#### (7) 상태 관리
- `keySignals.ts`(boolean)와 별도 **`axisSignals.ts`**: `axisId→Signal<number>`(누적 목표각). `keyEventBus`와 대칭으로 **`axisEventBus`**(`input:axis` 단일 구독→브로드캐스트), overlay `App.tsx`에서 구독해 누적.
- 다중 축/기기: axisId에 vid/pid+usage 포함 → 자연 식별. 회전 요소 position에 바인딩된 axisId로 signal 선택.

### 3.4 데이터 모델 — **[확정] 별도 맵(GraphItem 패턴 복제)**
- 회전 요소는 **별도 position 맵 `dial_positions`(mode→Vec<DialPosition>) 신설**. `GraphPositions` 선례를 그대로 복제. `DialPosition = KeyPosition + { axisId, sensitivity, reverse, image }`.
- 비용: store/app_state/models/bootstrap/migration/preset(save·load)/obs_bridge 등 GraphItem이 등장하는 지점을 동일하게 추가 수정(§6 참조). 깔끔·확장성 우선으로 이 비용 수용.

---

## 4. 결정 현황

### 확정
| # | 항목 | 결정 |
|---|------|------|
| 2 | **민감도/방향** | **사용자 조절** — 요소별 민감도 슬라이더 + 방향 반전 토글. 기본 `360/(1<<bitSize)` |
| 3 | **회전 요소 데이터 모델** | **별도 맵 `dial_positions`(GraphItem 패턴 복제)**. `DialPosition = KeyPosition + {axisId, sensitivity, reverse, image}` |

### 보류 (차후 선택)
| # | 항목 | 비고 |
|---|------|------|
| 1 | **정지 거동** | 즉시 추종(부드러운 정지) ↔ 관성/감쇠. 같은 rAF lerp 골격에서 분기 가능 → 1차는 즉시 추종, 후속 교체 여지. |

### 추가 확정
| # | 항목 | 결정 |
|---|------|------|
| 6 | **축 캡처 방식** | **노브를 돌리는 움직임을 감지해 매핑**(키를 누르면 감지되는 것과 동일 UX). `axisEventBus`가 `input:axis`를 구독, 일정 임계 이상 움직인 axisId를 자동 선택해 회전 요소에 바인딩. |

### 구현 시 결정 (튜닝/세부)
| # | 항목 | 선택지 |
|---|------|--------|
| 4 | **식별자/표시명** | vid/pid 기반(동일모델 2대 구분 불가 → handle 추가 여부), 표시명 사용자 편집 허용 여부 |
| 5 | **throttle 윈도우 크기** | ~8ms ↔ 16ms (전송 형식은 절대 raw로 확정, §3.3(1)) |

---

## 5. 구현 순서 (2단계)

1. **백엔드 인코더 분리**: `windows_hid.rs`의 버튼 엣지 + 축 델타 산출을 진단용→정식 인코더로. 버튼 라벨/축 axisId 스킴 확정. wrap 부호 델타 + 시간 coalesce 구현.
2. **IPC 확장**: `ipc.rs`에 `HidAxisMessage` 추가(버튼은 `HookMessage` 재사용).
3. **데몬→파이프 전송 활성화**: `windows.rs` RIM_TYPEHID 분기에서 버튼=`write_message`, 축=신규 write. (파일 기록 제거/디버그 플래그화.)
4. **reader 분기**(`app_state.rs`): 버튼 HookMessage는 기존 `keys:state` 경로 그대로(자동 시각화·매핑·카운터). 축은 신규 `input:axis` emit(구독자 게이트 재사용).
5. **OBS 포워딩 등록**: `obs_bridge.rs` forwarded_events에 `input:axis` 추가.
6. **프론트 신호/버스**: `axisSignals.ts` + `axisEventBus.ts`. overlay `App.tsx`에서 구독·누적.
7. **회전 요소 타입/store/커맨드**: GraphItem 패턴 복제(graphItems 타입/`useGraphItemStore`/`graph_items.rs`/models/bootstrap/migration/preset/obs). axisId 바인딩 필드.
8. **렌더 컴포넌트**: `DialItem`(가칭) — signal 구독 + rAF lerp + `transform:rotate`. `OverlayScene`에 map 추가.
9. **매핑 UI**: 버튼은 `KeySetting`의 input:raw 캡처 재사용. 축 캡처 + 회전 요소 추가 패널(GraphItem UI 복제).
10. **임시 진단 코드 정리**: `windows_hid.rs` / 420MB `hid-diagnostic.ndjson` 정식 경로 검증 후 제거.

---

## 6. 리스크 / 대안

- **입력 스레드 블로킹(최우선)**: 데몬 WM_INPUT 루프는 키보드/마우스/HID를 같은 스레드에서 처리. 노브 폭주 시 pipe write가 키 입력 지연 유발. → **반드시 백엔드 coalesce/스로틀**로 전송 빈도를 프레임 수준으로. (1단계에서 8-bit 데드밴드 0 문제 확인됨 → 절대값 데드밴드 폐기, 시간 윈도우 누적 대체.)
- **wrap 오판**: 한 리포트에 half 이상 점프(초고속 회전) 시 최단경로가 반대로 해석. 일반 폴링레이트(250~1000Hz)에선 드묾. 임계 초과 시 마지막 방향 유지 등 보정 옵션.
- **멀티 윈도우 누적 표류**: main/overlay/OBS 각자 누적 → 표시 전용이라 절대 동기화 불필요(허용). 동기화 필요 시 백엔드가 누적각 주기 송신 대안.
- **데이터 모델 6곳+ 동시 수정 비용**: 신규 position 맵은 bootstrap/migration/preset/obs 전반 수정 필요(`GraphPositions` 14파일이 증거). 1차는 KeyPosition 확장 플래그로 흡수하는 대안도 가능.
- **데몬 재시작 시 상태 손실**: 단축키 변경 시 데몬 재시작 → `prev_values` 초기화로 첫 델타 튐 가능. 첫 리포트는 델타 0(prev=None 미전송)로 처리.

---

## 부록: 핵심 파일

| 영역 | 파일 |
|------|------|
| HID 디코딩(임시→정식) | `src-tauri/src/keyboard/daemon/windows_hid.rs` |
| Raw Input 등록/분기 | `src-tauri/src/keyboard/daemon/windows.rs` |
| IPC 메시지 | `src-tauri/src/ipc.rs` (`HidAxisMessage` 신설) |
| reader/이벤트 emit | `src-tauri/src/state/app_state.rs` |
| OBS 포워딩 | `src-tauri/src/services/obs_bridge.rs` |
| 신규 요소 데이터 모델 레퍼런스 | GraphItem (`useGraphItemStore.ts`, `commands/layout/graph_items.rs`, `models/mod.rs`) |
| 키 시각화 레퍼런스 | `keySignals.ts`, `keyEventBus.ts`, `Key.tsx`, `OverlayScene.tsx` |

### 외부 레퍼런스: IIDXwidget
[Coldlapse/IIDXwidget](https://github.com/Coldlapse/IIDXwidget) — Electron + node-hid 기반 IIDX(투덱) 방송 위젯. 스크래치(턴테이블) 회전 시각화를 구현. 우리 노브 회전 요소와 동형 문제.
- **검증된 차용**: wrap 델타 `(new-last+256)%256; if(delta>127)delta-=256`, 절대값 누적 + `transform:rotate`, 절대값 전송→렌더러 델타 계산, 20ms throttle + CSS `transition: transform 0.1s linear` 스무딩.
- **우리와 차이**: 그들은 node-hid + 기기별 바이트 레이아웃 하드코딩(범용성 없음) → 우리는 Raw Input + HidP 동적 디코딩(사전 라벨 없이 임의 기기). 민감도도 그들은 하드코딩(2.5), 우리는 사용자 조절.
