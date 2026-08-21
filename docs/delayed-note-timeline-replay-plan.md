# 단노트 판정용 입력 타임라인 지연 재생 기획

> 작성일: 2026-08-21  
> 상태: 구현 중 — source timeline, canonical batch, 프론트 shadow clock 기반 작업  
> 대상 기능: `단노트 길이 일관성 유지`, 노트 이펙트, 키 표시 지연, 카운터 지연, OBS 오버레이  
> 핵심 목표: 입력 이벤트 전달이 늦어져도 잘못된 노트를 먼저 그린 뒤 길이를 고치지 않는다

---

## 1. 결론

고정된 추가 지연값으로 UP 이벤트를 기다리는 방식은 근본 해결이 아니다. 어떤 고정값을 사용해도 그보다 늦게 도착하는 이벤트가 존재할 수 있기 때문이다.

근본 해결은 다음 구조로 전환하는 것이다.

1. 입력 캡처 계층이 모든 물리 입력에 단조 증가 시각과 순서를 부여한다.
2. 백엔드가 해당 시각까지의 입력을 모두 처리했다는 **확정선(watermark)** 을 함께 전달한다.
3. 프론트는 실시간 `performance.now()`가 아니라 확정선보다 뒤에 있는 **프레젠테이션 시계**로 노트·키·카운터를 재생한다.
4. 전달이 밀리면 잘못된 롱노트를 추정하지 않고 프레젠테이션 시계를 잠시 멈춘다.
5. 밀린 지연은 화면에 노트가 없는 안전 구간에서만 회수한다.

이 구조에서는 이벤트 전달이 오래 밀려도 단노트가 롱노트처럼 자랐다가 줄어들지 않는다. 대신 입력 스트림이 확정되지 않은 동안 화면 진행이 잠시 늦어질 수 있다. 이는 알 수 없는 미래 입력을 추측하지 않기 위해 의도적으로 선택하는 동작이다.

### 1.1 독립 리뷰 반영 확정 사항

다음 항목은 구현 전에 선택지를 남겨두지 않고 규칙으로 확정한다.

- source 보장은 OS가 물리 입력을 발생시킨 시각이 아니라 **DmNote 입력 callback에서 시각화 대상 이벤트가 sequencer capture 구간에 들어온 시점**부터 적용한다.
- callback capture와 watermark는 하나의 sequencer barrier로 직렬화한다. writer는 barrier를 얻은 뒤 이미 등록된 출력을 모두 비우고 watermark를 기록한다.
- threshold, 고정 길이, 속도, 트랙 높이, 방향, 지연 모드처럼 판정·geometry를 바꾸는 설정은 press별 혼합 스냅샷을 사용하지 않는다. 짧은 fade 안에서 기존 화면과 대기 이벤트를 비우고 새 presentation epoch를 시작한다.
- timeline은 canonical 키 상태뿐 아니라 counter action을 포함한다. 신규 stream 또는 replay 불가능한 rebase에는 counter baseline과 활성 키 snapshot이 필요하다. 활성 키 snapshot으로 과거 DOWN 시각을 합성해 노트를 만들지는 않는다.
- 노트 생성, 완료, 이동, 정리 같은 CPU 수명주기와 WebGL geometry는 모두 같은 presentation playhead를 사용한다. `setTimeout`과 `performance.now()`를 판정 시계로 섞지 않는다.
- stream reset과 복구 불가능한 gap은 같은 fade-clear epoch reset으로 처리한다. 이전 stream과 새 stream을 한 화면에 섞지 않는다.
- OBS는 같은 reducer와 clock을 사용하며 transport gap을 timeline replay로 복구한다. replay 범위를 벗어나면 baseline을 받은 뒤 hard rebase한다.

---

## 2. 배경과 현재 문제

### 2.1 현재 입력 흐름

```text
OS 입력
  → 키보드 데몬이 DOWN/UP 캡처
  → named pipe로 HookMessage 전송
  → app_state가 canonical 키 전환 계산
  → keys:state 이벤트 emit
  → keyEventBus가 프론트 구독자에게 전달
  → useNoteSystem.handleKeyDown / handleKeyUp
  → WebGL 셰이더가 performance.now()로 활성 노트 길이 계산
```

현재 백엔드는 다음 정보를 이미 제공한다.

- 데몬 캡처 시각을 이용한 `eventAgeMs`
- 같은 물리 입력의 UP에서 측정한 `holdDurationMs`
- canonical 키의 DOWN/UP 전환
- UP 유실 복구를 위한 활성 키 스냅샷
- OBS 전송 계층의 transport sequence와 Lagged 재동기화

그러나 프론트의 노트 재생은 여전히 도착 시점의 `setTimeout`과 실제 렌더 시계에 의존한다.

### 2.2 레이스 조건

```text
물리 DOWN ───────── 물리 UP
    │                  │
    │                  └─ UP 전달이 메인 스레드 또는 브릿지에서 지연
    │
    └─ 프론트의 노트 시작 타이머가 먼저 실행
                         ↓
                  셰이더는 아직 누르는 중이라고 판단
                         ↓
                  실제보다 긴 활성 노트 렌더
                         ↓
                  늦은 UP 도착 후 길이 수정
```

이때 선택지는 둘뿐이다.

- 과거의 정확한 종료 시각으로 확정하면 꼬리가 되돌아가는 것처럼 보인다.
- 현재 시각 이후로 종료를 밀면 되돌아가지는 않지만 실제 hold보다 롱노트가 길어진다.

고정 버퍼는 이 레이스가 발생하는 범위만 뒤로 미룬다. 레이스 자체를 제거하지 않는다.

### 2.3 동시에 지켜야 할 동작

단노트 기능이 켜졌을 때 길이 정책은 처음 의도대로 이진 판정을 사용한다.

```text
hold < threshold  → 설정한 고정 단노트 길이
hold >= threshold → 실제 canonical hold 길이
```

추가로 다음 조건을 만족해야 한다.

- 하나의 노트가 표시된 뒤 과거 길이로 줄어들지 않는다.
- 빠른 동일 키 연타에서도 각 press가 독립적으로 연결된다.
- UP 전달 지연이 실제 노트 길이에 포함되지 않는다.
- 로컬 오버레이와 OBS 오버레이가 같은 결과를 만든다.
- 저프레임, WebView stall, OBS 재연결에서도 잘못된 상태를 추정하지 않는다.

### 2.4 의도적으로 허용하는 경계 계단

고정 단노트 길이를 `M px`, threshold를 `T ms`, 노트 속도를 `V px/s`라고 한다. 롱노트의 실제 길이는 `R(h) = V × h / 1000 px`이므로 다음 두 조건을 동시에 고정한 순간 `M != R(T)`이면 경계에서 불연속이다.

```text
L(T - ε) = M px
L(T)     = R(T) px
```

따라서 서로 다른 두 노트가 threshold 바로 아래와 바로 위에 있으면 길이 차이가 날 수 있다. 이것은 단일 노트가 도중에 변하는 현상과 다른 문제다.

본 기획에서는 사용자 판정 의도를 우선하여 이 경계 계단을 허용한다. 램프나 보간으로 경계를 연결하지 않는다.

---

## 3. 목표와 비목표

### 3.1 목표

1. strict binary 단노트 판정을 복원한다.
2. 프론트 이벤트 도착 시각과 무관하게 canonical hold로 길이를 결정한다.
3. 렌더가 아직 확정되지 않은 입력 시각을 앞질러 가지 못하게 한다.
4. 노트가 화면에 나타난 뒤 `endTime`이 현재 재생 시각보다 과거로 이동하지 않게 한다.
5. 노트, 키 활성 표시, 카운터 지연의 상대 싱크를 유지한다.
6. OBS의 추가 전송 지연과 패킷 gap을 같은 규칙으로 처리한다.
7. 자동 지연 계산에 새 프레젠테이션 지연을 포함한다.
8. 임의의 추정값이 아니라 실측 데이터로 평상시 지터 여유값을 결정한다.

### 3.2 비목표

- strict binary 판정과 경계 연속성을 동시에 만족시키는 램프 추가
- 단노트 기능을 사용하지 않는 기존 즉시 노트 경로의 동작 변경
- 키음 재생 지연
- 물리 입력 자체의 누락을 시각화 계층에서 추정 복원
- OBS 게임 화면을 DmNote가 직접 지연시키는 기능

---

## 4. 용어

| 용어              | 의미                                                                        |
| ----------------- | --------------------------------------------------------------------------- |
| 입력 시각         | 데몬의 단조 증가 시계로 기록한 물리 입력 시각                               |
| press ID          | canonical DOWN부터 대응하는 UP까지를 식별하는 ID                            |
| sequence          | 입력 스트림에서 이벤트 순서를 식별하는 단조 증가 번호                       |
| 확정선            | 이 시각 이하의 입력은 모두 전달·처리됐음을 보장하는 시각                    |
| lookahead         | 단/롱 판정을 위해 프레젠테이션 시계가 입력 확정선보다 뒤에 있어야 하는 시간 |
| 프레젠테이션 시계 | 노트 셰이더와 지연 UI가 공통으로 사용하는 가상 재생 시각                    |
| 지연 부채         | 입력 stall 때문에 목표 지연보다 추가로 누적된 화면 지연                     |
| 안전 구간         | 화면에 활성·이동 중인 노트와 적용 대기 중인 키 전환이 없는 구간             |

---

## 5. 제안 아키텍처

### 5.1 전체 흐름

```text
[입력 캡처/단일 sequencer]
  물리 DOWN/UP + monotonic time + raw sequence
  주기적 watermark
                 │
                 ▼
[Rust canonical timeline]
  매핑 및 refcount 적용
  canonical pressId / DOWN / UP 생성
  watermark 이전 이벤트를 batch로 확정
                 │
        ┌────────┴────────┐
        ▼                 ▼
 [Tauri local]       [OBS WebSocket]
        └────────┬────────┘
                 ▼
[프론트 InputTimelineBuffer]
  sequence gap 검사
  event buffer + safeThrough 갱신
                 │
                 ▼
[PresentationClock]
  playhead <= safeThrough - threshold
  stall 시 정지, 안전 구간에서만 지연 부채 회수
                 │
      ┌──────────┼──────────┐
      ▼          ▼          ▼
 [노트]       [키 표시]   [카운터]
      │
      ▼
[WebGL uTime = presentation playhead]
```

### 5.2 책임 분리

#### 입력 데몬

- 물리 이벤트를 캡처한 순서를 확정한다.
- wall clock이 아닌 세션 단조 시각을 생성한다.
- 입력 이벤트와 watermark가 같은 순서 보장 경로를 지나게 한다.
- pipe 정체가 있어도 이벤트보다 뒤의 watermark가 먼저 확정되지 않게 한다.
- 물리 hold 측정은 현재처럼 `Instant` 기반 값을 유지한다.

#### Rust app state

- raw 입력을 현재 매핑과 refcount 규칙으로 canonical 전환으로 바꾼다.
- canonical DOWN에서 고유 `pressId`를 만들고 UP까지 유지한다.
- raw watermark를 처리하기 전에 그 앞의 canonical 전환을 모두 batch에 넣는다.
- 단노트 threshold나 최소 길이처럼 화면 정책을 판정하지 않는다.
- 기존 공개 `keys:state` 계약은 호환성을 위해 유지한다.

#### 프론트 타임라인

- batch sequence와 stream session을 검증한다.
- threshold만큼의 확정된 미래를 확보한 시각까지만 playhead를 진행한다.
- 단노트 판정과 노트 길이는 입력 시각 및 canonical hold만 사용한다.
- 로컬 타이머 실행 시각은 노트 길이 계산에 사용하지 않는다.

#### WebGL 렌더러

- `performance.now()` 대신 프레젠테이션 시계를 `uTime`으로 사용한다.
- 미래의 확정 `endTime`을 미리 받더라도 `uTime < endTime`이면 활성 노트 모양으로 그린다.
- `uTime`이 `endTime`을 지난 뒤에만 완료 노트 이동을 시작한다.

---

## 6. 입력 타임라인 계약 초안

### 6.1 배치 payload

아래 타입은 목표 v1 계약이다. 64-bit 정수는 JavaScript 정밀도 손실을 피하기 위해 10진 문자열로 전달한다.

```ts
interface CanonicalInputTimelineBatchV1 {
  version: 1;
  streamId: string;
  revision: string;
  sourceRevision: string;
  safeThroughUs: string;
  baseline?: CanonicalInputBaselineV1;
  actions: CanonicalInputTimelineActionV1[];
}

type CanonicalInputTimelineActionV1 =
  | {
      kind: 'state';
      pressId: string;
      mode: string;
      key: string;
      state: 'DOWN' | 'UP';
      eventTimeUs: string;
    }
  | {
      kind: 'counter';
      mode: string;
      key: string;
      count: number;
      counterSessionId: string;
      counterRevision: string;
      eventTimeUs: string;
    };

interface CanonicalInputBaselineV1 {
  counterSessionId: string;
  counterRevision: string;
  counters: Record<string, number>;
  activeKeys: string[];
}
```

### 6.2 필드 불변식

- `streamId`는 데몬 재시작 또는 입력 상태 전체 reset마다 변경한다.
- batch `revision`은 같은 stream 안에서 1부터 연속 증가한다.
- source frame revision은 모든 input/watermark frame에서 연속이고, batch의 `sourceRevision`은 watermark를 가리키므로 batch 사이에서는 단조 증가한다.
- 한 `pressId`에는 canonical DOWN 하나와 최대 UP 하나만 존재한다.
- canonical UP의 `eventTimeUs`는 대응 DOWN보다 빠를 수 없다.
- `safeThroughUs` 이하의 아직 전달되지 않은 action이 나중 batch에 등장해서는 안 된다.
- 동일 시각의 이벤트는 watermark보다 먼저 처리한다.
- counter revision은 같은 counter session 안에서 증가하며, `any` 매핑처럼 canonical state 전환이 없는 press도 counter action으로 남긴다.
- 첫 batch 또는 hard rebase batch는 baseline을 포함한다. baseline 이전 counter action을 추정하지 않는다.

### 6.3 watermark 생성 조건

watermark는 단순히 app state에서 현재 시각을 찍어 만들면 안 된다. named pipe에 아직 들어오지 못한 과거 UP을 app state가 알 수 없기 때문이다.

다음 조건을 만족하는 입력 sequencer에서 생성해야 한다.

1. callback에서 시각화 대상 이벤트를 식별한 뒤 sequencer barrier를 얻고 단조 source time을 기록한다.
2. callback은 barrier를 유지한 채 해당 capture에서 발생한 모든 출력을 writer queue에 등록한다.
3. watermark writer도 같은 barrier를 얻는다.
4. writer는 barrier 대기 중 queue에 등록된 출력을 모두 named pipe에 기록한 뒤 watermark를 기록한다.
5. app state는 pipe 순서대로 처리한 뒤 canonical batch를 emit한다.

현재 구현은 Windows Raw Input과 macOS listener가 시각화 대상 키·버튼 이벤트를 식별한 지점부터 이 계약을 적용한다. 마우스 이동이나 축 전용 이벤트는 barrier를 점유하지 않는다. OS 내부 큐에 있으나 아직 sequencer capture 구간에 들어오지 않은 이벤트까지 과거 입력으로 보장하지는 않는다. writer가 먼저 barrier를 얻으면 그 뒤 capture의 source time도 watermark 뒤로 기록되므로 계약은 유지된다.

### 6.4 기존 이벤트와 호환성

- `keys:state`는 플러그인 및 단노트 비활성 경로를 위해 유지한다.
- 신규 내부 이벤트로 `keys:timeline`을 추가한다.
- OBS가 동일 기능을 사용하므로 `obs_bridge.rs`의 forwarding 목록에 등록한다.
- OBS의 기존 envelope sequence는 WebSocket transport 순서일 뿐 입력 확정선이 아니므로 timeline sequence를 대체하지 않는다.
- 공개 API에 timeline 필드를 노출한다면 `docs/content/en/`과 `docs/content/ko/`를 함께 갱신한다.

---

## 7. 프레젠테이션 시계

### 7.1 기본 규칙

단노트 threshold를 `T`, 현재 입력 확정선을 `W`라고 할 때 노트 playhead `P`는 항상 다음을 만족해야 한다.

```text
P <= W - T
```

이 규칙 때문에 playhead가 어떤 DOWN 시각에 도달했을 때, 프론트는 이미 `DOWN + T`까지의 입력을 모두 알고 있다.

- 그 안에 UP이 있으면 확정 단노트다.
- UP이 없으면 threshold를 실제로 넘긴 롱노트다.
- 이후 UP도 playhead가 해당 UP 시각에 도달하기 전에 buffer에 들어온다.

따라서 표시 중인 노트의 과거 길이를 나중에 고칠 필요가 없다.

### 7.2 정상 진행

평상시에는 playhead를 1배속으로 진행한다.

```text
L = threshold + transportReserve
S(r) = 마지막 watermark source time + (r - 그 watermark의 local 수신 시각)
nominalTarget(r) = S(r) - L
safeTarget = W - threshold
target(r) = min(nominalTarget(r), safeTarget)
```

여기서 `r`은 local monotonic 시각, `S(r)`은 source 시각에 대한 local 추정, `W`는 마지막 확정선이다. playhead는 이전 값에서 최대 1배속으로 `target(r)`까지만 진행하며 뒤로 이동하지 않는다.

`transportReserve`는 정확성을 위한 값이 아니라 watermark 갱신 간격과 평상시 transport 지터 때문에 시계가 자주 멈추는 것을 줄이는 값이다. 이 값이 부족해도 잘못된 노트를 그리지 않고 시계가 잠시 멈춰야 한다.

### 7.3 입력 전달 stall

`P`가 `W - T`에 도달했는데 새 watermark가 없으면 다음과 같이 처리한다.

1. playhead를 확정선에서 정지한다.
2. 활성 노트 길이, 키 상태 전환, 카운터 적용도 같은 시점에서 정지한다.
3. watermark가 다시 들어오면 현재 playhead부터 1배속으로 재개한다.
4. 목표 지연보다 늘어난 값은 `delayDebtMs`로 기록한다.

복구 직후 playhead를 최신 시각으로 점프시키지 않는다. 점프하면 노트 위치와 길이가 한 프레임에 변해 별도의 시각적 점핑이 발생한다.

### 7.4 지연 부채 회수

지연 부채는 다음 조건을 모두 만족할 때만 제거한다.

- 활성 노트가 없음
- 트랙에 이동 중인 완료 노트가 없음
- 적용 대기 중인 key transition이 없음
- sequence gap 또는 resync 진행 중이 아님

안전 구간에서는 보이는 geometry가 없으므로 playhead anchor를 nominal delay로 재설정할 수 있다.

연속 입력 때문에 안전 구간이 오지 않으면 지연 부채를 유지한다. 재생 속도를 임의로 높여 따라잡거나 표시 중인 노트를 건너뛰지 않는다.

### 7.5 프레임 제한

watermark cadence와 렌더 frame limit은 별개다.

- watermark cadence가 너무 낮으면 playhead가 계단식으로 진행할 수 있다.
- frame limit이 낮아도 입력 확정성은 유지돼야 한다.
- cadence 기본값은 추정으로 정하지 않고 Windows, macOS, 로컬 Tauri, OBS 브라우저 소스에서 측정 후 결정한다.

---

## 8. 노트 판정과 렌더 규칙

### 8.1 설정 변경과 presentation epoch

다음 설정은 단노트 판정 또는 노트 geometry를 바꾼다.

- threshold
- 단노트 최소 길이
- flow speed
- track height에 따른 유효 최소 길이
- reverse 등 geometry에 영향을 주는 값
- 단노트 지연 모드 활성 여부

이 값이 바뀌면 진행 중 press에 옛 설정과 새 설정을 혼합하지 않는다. 짧은 fade 안에서 기존 노트와 대기 action을 제거하고 timeline buffer와 clock을 새 epoch로 초기화한다. 새 설정은 epoch 이후 DOWN부터 적용한다.

### 8.2 단노트

```text
canonicalHold < threshold
```

- DOWN이 화면 playhead에 도달하기 전에 UP이 이미 buffer에 존재한다.
- 노트는 처음부터 단노트로 분류한다.
- 최종 길이는 설정한 고정 최소 길이다.
- 고정 길이에 도달할 때까지 자연스럽게 성장한 뒤 이동한다.
- 한 번 화면에 나온 뒤 롱노트로 바뀌거나 길이가 과거로 줄지 않는다.

### 8.3 롱노트

```text
canonicalHold >= threshold
```

- playhead가 DOWN에 도달했을 때 확정선이 이미 `DOWN + threshold`를 지났다.
- 해당 구간에 UP이 없으므로 롱노트임이 확정된다.
- UP 전까지 playhead와 함께 성장한다.
- UP은 playhead가 UP 시각에 도달하기 전에 buffer에 들어오므로 정확한 종료 시각을 미리 설정할 수 있다.
- 최종 길이는 canonical hold와 같다.

### 8.4 셰이더 변경

현재 셰이더는 `endTime` 존재 여부만으로 active/completed를 구분한다. 새 경로에서는 미래의 종료 시각을 미리 알 수 있으므로 다음 규칙으로 바꾼다.

```text
effectiveEnd = endTime이 없으면 playhead
               endTime이 있으면 min(playhead, endTime)

noteLength = effectiveEnd - startTime
completed  = endTime이 있고 playhead >= endTime
```

이렇게 하면 UP 정보를 미리 buffer에 넣어도 노트 전체 길이가 시작 순간에 한꺼번에 나타나지 않는다.

노트 cleanup, 슬롯 재사용, 완료 노트 이동 시작도 `performance.now()`나 별도 wall-clock 타이머가 아니라 같은 `playhead` 조건으로 수행한다. CPU와 GPU가 서로 다른 시계를 보면 stall 뒤에 geometry는 멈췄는데 데이터가 먼저 삭제되는 문제가 생긴다.

### 8.5 제거 대상 임시 방어

신규 경로가 검증된 뒤 단노트 활성 경로에서 다음 타이머 기반 방어를 제거한다.

- 도착 시각 기준 start/finalize timer
- `Math.max(targetEndTime, performance.now())` 형태의 길이 증가 방어
- threshold 아래 길이를 변화시키는 continuity ramp
- 늦은 UP을 현재 시각으로 보정하는 정책

단노트 기능 비활성 경로는 회귀 범위를 줄이기 위해 별도로 유지한다.

---

## 9. 키 표시·카운터·자동 지연 계산

### 9.1 공통 스케줄러

현재 키 활성 신호와 카운터는 각각 `setTimeout` 기반 지연을 사용한다. 단노트 기능이 켜진 경로에서는 둘 다 같은 `PresentationScheduler`에 등록한다.

- 노트는 source event time을 그대로 사용한다.
- 키와 카운터는 사용자가 설정한 총 키 표시 지연에 맞춰 timeline offset을 적용한다.
- input stall로 지연 부채가 생기면 노트·키·카운터에 같은 부채를 적용한다.
- 이로써 stall 중에도 세 요소의 상대 싱크가 벌어지지 않는다.

기본 presentation 지연을 `L`, 사용자가 원하는 키·카운터 총 지연을 `D`, action source 시각을 `E`라고 하면 scheduler의 적용 위치는 다음과 같다.

```text
key/counter target on playhead = E + (D - L)
```

신규 stream은 counter baseline을 먼저 적용하고 그 다음 revision의 action부터 재생한다. baseline 없이 중간 revision부터 받은 counter 값은 화면에 적용하지 않는다.

단노트 기능이 꺼져 있으면 기존 즉시 노트 및 key/counter timer 경로를 유지한다.

### 9.2 자동 계산식

```text
noteTravelTimeMs = trackHeight / speed * 1000
nominalNoteDelayMs = threshold + measuredTransportReserveMs

recommendedKeyDisplayDelayMs =
  round(noteTravelTimeMs + nominalNoteDelayMs)
```

`measuredTransportReserveMs`는 임의의 80ms 같은 상수로 정하지 않는다.

출시 전 계측으로 다음 값을 분리해 측정한다.

- 데몬 캡처 → app state 처리
- app state → 로컬 WebView 수신
- app state → OBS WebSocket 수신
- watermark 갱신 간격
- 프론트 메인 스레드 stall

측정한 분포의 어느 percentile과 안전 여유를 기본값으로 사용할지는 실제 데이터와 함께 별도 결정 기록으로 남긴다. 정확성은 reserve 값에 의존하지 않으며, reserve는 평상시 시계 정지 빈도를 줄이는 용도다.

### 9.3 수동 설정의 의미

`keyDisplayDelayMs`는 계속 **물리 입력부터 키·카운터가 보이기까지의 목표 총 지연**을 의미한다.

- 내부 reserve를 수동 입력값에 몰래 더하지 않는다.
- 자동 계산 버튼을 눌렀을 때만 계산된 총 지연값을 입력한다.
- stall이 발생하면 실제 지연은 일시적으로 설정값보다 커질 수 있다.
- 늘어난 실제 지연은 안전 구간에서 nominal 값으로 복귀한다.

필요하면 설정 화면 또는 디버그 HUD에 다음 값을 구분해서 표시한다.

- 설정된 목표 지연
- 자동 계산 권장 지연
- 현재 실제 프레젠테이션 지연
- 현재 지연 부채

---

## 10. reset, gap, OBS 재연결

### 10.1 stream reset

다음 상황에서는 새 `streamId`를 발급한다.

- 키보드 데몬 재시작
- `keys:reset`
- canonical 매핑 전체 재구성으로 press 연결을 보장할 수 없음
- 입력 시계 초기화

프론트는 이전 stream의 대기 이벤트를 폐기하고 다음 규칙을 따른다.

- 활성 노트와 완료 노트는 짧은 화면 전환 fade 안에서 함께 정리한다.
- 이전 stream의 key/counter 대기 action과 지연 부채를 모두 폐기한다.
- 새 stream의 baseline을 적용한 뒤 playhead를 새 source anchor로 시작한다.
- 새 스냅샷의 active key는 키 하이라이트 복구에만 사용한다.
- DOWN 시각을 모르는 이미 눌린 키에 대해 합성 노트를 만들지 않는다.

### 10.2 sequence gap

예상 sequence보다 큰 값이 오면 입력을 추정해서 건너뛰지 않는다.

1. playhead 정지
2. timeline replay 또는 snapshot 요청
3. 누락 구간이 ring buffer에 있으면 순서대로 재적용
4. 복구 불가능하면 새 stream으로 rebase

잘못된 노트를 계속 그리는 것보다 잠시 멈추거나 안전하게 재시작하는 것을 우선한다.

### 10.3 OBS

- `keys:timeline`을 OBS forwarding 대상에 추가한다.
- OBS transport envelope sequence와 input timeline sequence를 모두 검사한다.
- Lagged 또는 재연결 시 timeline ring buffer replay를 우선한다.
- 보유 범위를 넘은 gap은 기존 bootstrap만으로 과거 press를 합성하지 않고 hard rebase한다.
- 로컬 오버레이와 OBS 오버레이는 동일한 timeline reducer와 presentation clock 구현을 사용한다.

### 10.4 bounded buffer

Rust와 프론트의 event buffer는 메모리 상한을 가진다.

- 보유 시간 또는 이벤트 수는 실측 입력률을 기준으로 결정한다.
- 미소비 이벤트를 조용히 삭제하지 않는다.
- 상한 도달 시 gap 상태로 전환하고 명시적으로 resync한다.
- 빠른 연타와 HID 버튼 입력률을 포함해 용량을 검증한다.

---

## 11. 계측 계획

### 11.1 목적

계측은 고정 버퍼로 정확성을 확보하기 위한 것이 아니다. 다음 운영값을 실측으로 정하기 위한 것이다.

- watermark cadence
- transport reserve 기본값
- timeline ring buffer 크기
- stall 경고 기준
- 로컬과 OBS의 권장 지연 차이 필요 여부

### 11.2 수집 항목

debug 또는 opt-in 진단에서 다음 값을 기록한다.

| 지표                           | 의미                                     |
| ------------------------------ | ---------------------------------------- |
| `captureToBackendMs`           | 물리 캡처부터 canonical 처리까지         |
| `backendToRendererMs`          | canonical batch emit부터 렌더러 수신까지 |
| `watermarkIntervalMs`          | 확정선 갱신 간격                         |
| `safeHeadroomMs`               | `safeThrough - threshold - playhead`     |
| `effectivePresentationDelayMs` | 현재 실제 입력→프레젠테이션 지연         |
| `delayDebtMs`                  | stall로 추가된 지연                      |
| `queueDepth`                   | 미재생 timeline 이벤트 수                |
| `clockStallMs`                 | 확정선 대기로 playhead가 멈춘 시간       |
| `sequenceGapCount`             | timeline gap 발생 수                     |
| `resyncCount`                  | timeline 재동기화 횟수                   |

평균만 사용하지 않고 percentile, 최대 연속 stall, 입력 밀도별 분포를 함께 본다. 성능값은 실제 측정 전 문서에 추정치로 기록하지 않는다.

### 11.3 측정 환경

- Windows 11 로컬 Tauri 오버레이
- Windows 11 OBS 브라우저 소스
- macOS 로컬 Tauri 오버레이
- frame limit별 렌더
- 같은 키 빠른 연타
- 여러 canonical 키 동시 입력
- CPU 부하 및 WebView main-thread stall 주입
- OBS WebSocket 지연·Lagged·재연결

---

## 12. 구현 단계

### 1단계 — 입력 순서와 watermark 가능성 검증

목표는 기능 변경 없이 입력 소스가 확정선 계약을 만들 수 있는지 확인하는 것이다.

예상 변경 파일:

- `src-tauri/src/keyboard/daemon/mod.rs`
- `src-tauri/src/keyboard/daemon/windows.rs`
- `src-tauri/src/keyboard/daemon/macos.rs`
- `src-tauri/src/ipc.rs`
- `src-tauri/src/state/app_state.rs`

작업:

1. 데몬 세션 ID, monotonic input time, raw sequence를 진단 payload에 추가한다.
2. 입력과 같은 writer 순서를 지나는 watermark prototype을 만든다.
3. 플랫폼별로 `eventTime <= watermark` 이벤트가 watermark 뒤에 도착하지 않는지 검증한다.
4. pipe stall과 writer backlog를 강제로 만들고 순서를 확인한다.
5. 계약을 만족하지 못하면 source sequencer 구조를 먼저 고친다.

완료 기준:

- Windows와 macOS 각각에서 watermark 불변식을 자동 테스트와 실기 로그로 확인
- 임의 성능 수치 없이 실제 cadence와 지연 분포 확보
- 기존 `keys:state` 동작 변화 없음

### 2단계 — canonical timeline v1

예상 변경 파일:

- `src-tauri/src/keyboard/manager.rs`
- `src-tauri/src/state/app_state.rs`
- `src-tauri/src/models/` 하위 신규 timeline 타입
- `src-tauri/src/services/obs_bridge.rs`
- 관련 Rust 테스트

작업:

1. canonical press ID와 canonical event sequence를 추가한다.
2. action batch와 `safeThroughUs`를 atomic payload로 만든다.
3. bounded ring buffer와 replay/snapshot 계약을 추가한다.
4. 로컬 Tauri와 OBS 양쪽에 같은 batch를 전달한다.
5. 기존 `keys:state`와 공개 API payload는 유지한다.

완료 기준:

- 같은 키 연타, 다중 물리 source, `all`/`any` 매핑에서 press 연결 정확
- batch gap과 stream reset 검증
- OBS forwarding 및 resync 검증

### 3단계 — 프론트 timeline buffer와 clock shadow mode

예상 신규 파일:

- `src/renderer/utils/core/inputTimeline.ts`
- `src/renderer/utils/core/presentationClock.ts`
- 각 모듈 테스트

예상 수정 파일:

- `src/renderer/utils/core/keyEventBus.ts`
- `src/renderer/windows/overlay/App.tsx`

작업:

1. batch reducer, gap 검사, stream generation을 구현한다.
2. 실제 화면에는 연결하지 않고 기존 렌더 결과와 병렬로 계산한다.
3. old path의 판정 결과와 timeline 결과 차이를 진단 로그로 비교한다.
4. stall 주입 시 playhead가 확정선을 넘지 않는지 검증한다.

완료 기준:

- `playhead <= safeThrough - threshold` 불변식 위반 0건
- gap 발생 시 진행 정지 및 resync
- 새 clock이 렌더에 연결되지 않은 상태에서 기존 사용자 동작 회귀 없음

### 4단계 — 지연 노트 렌더 전환

예상 수정 파일:

- `src/renderer/hooks/overlay/useNoteSystem.ts`
- `src/renderer/utils/core/noteLengthPolicy.ts`
- `src/renderer/stores/signals/noteBuffer.ts`
- `src/renderer/components/overlay/WebGLTracksOGL.tsx`
- 관련 note system 및 shader 테스트

작업:

1. 단노트 활성 경로를 timeline event 기반 state machine으로 교체한다.
2. strict binary 길이 정책을 복원한다.
3. WebGL `uTime`을 presentation clock으로 전환한다.
4. 미래 end time을 자연스럽게 렌더하는 shader 규칙을 추가한다.
5. 기존 ramp와 `NoShrink` 계열 보정을 제거한다.

완료 기준:

- 전달 지연 크기와 무관하게 표시된 노트가 과거 길이로 수정되지 않음
- threshold 바로 아래는 고정 길이, threshold 이상은 실제 길이
- stall 시 노트 geometry 수정 대신 playhead 정지
- reverse, track clipping, glow, cleanup 회귀 없음

### 5단계 — 키·카운터·자동 계산 통합

예상 수정 파일:

- `src/renderer/windows/overlay/App.tsx`
- `src/renderer/hooks/app/useAppBootstrap.ts`
- `src/renderer/components/main/Modal/content/settings/NoteSetting.tsx`
- `src/types/settings/noteSettings.ts`
- 필요 시 locale 및 설정 테스트

작업:

1. 단노트 활성 경로의 key/counter timer를 PresentationScheduler로 교체한다.
2. 노트·키·카운터에 동일한 delay debt를 적용한다.
3. 자동 계산을 `travel + threshold + measured reserve`로 변경한다.
4. 수동 지연은 총 지연값이라는 기존 의미를 보존한다.
5. 현재 실제 출력 지연을 진단 화면에서 확인할 수 있게 한다.

완료 기준:

- 정상 시 key/counter와 노트 상대 싱크 유지
- stall 이후에도 세 요소의 상대 지연 동일
- 자동 계산값과 실제 nominal delay 계산 일치
- 설정 최대값 clamp와 탭별 override 유지

### 6단계 — OBS 및 실기 검증 후 전환

1. Windows 11 로컬 및 OBS 장시간 연타 테스트
2. macOS 로컬 입력 테스트
3. OBS Lagged, 브라우저 소스 재시작, 네트워크 지연 주입
4. 실측값으로 watermark cadence, reserve, buffer 상한 결정
5. shadow mode 비교 결과에서 회귀가 없을 때 새 경로를 기본값으로 전환
6. 안정화 후 사용되지 않는 delayed-note timer 코드를 제거

---

## 13. 테스트 계획

### 13.1 길이 경계

| 입력          | 기대                               |
| ------------- | ---------------------------------- |
| `T - ε`       | 고정 단노트 길이                   |
| `T`           | 실제 hold 길이                     |
| `T + ε`       | 실제 hold 길이                     |
| `M > R(T)`    | strict binary 유지, 경계 계단 허용 |
| `M < R(T)`    | strict binary 유지, 경계 계단 허용 |
| 트랙보다 큰 M | 기존 track clipping 유지           |

### 13.2 전달 지연

각 시나리오에서 UP 전달을 정상, threshold 미만 지연, threshold 초과 지연, 장시간 stall로 바꿔 실행한다.

- 짧은 단일 press
- threshold 직전 press
- threshold 정확 경계 press
- 긴 hold
- 같은 키 빠른 연타
- 여러 키 교차 연타
- frame limit이 낮은 상태

공통 기대값:

- 최종 길이 동일
- 이미 표시된 노트의 end가 playhead 과거로 이동하지 않음
- 전달 지연이 hold 길이에 더해지지 않음
- 확정 정보가 부족하면 clock stall이 발생하고 오판정은 발생하지 않음

### 13.3 순서·유실·복구

- 중복 DOWN
- unmatched UP
- sequence 중복
- sequence gap
- 이전 stream의 늦은 batch
- daemon reset
- mode 전환
- 매핑 변경
- OBS Lagged 및 replay 가능/불가능 gap
- ring buffer 상한 도달

### 13.4 설정 변경

- 누르는 도중 threshold 변경
- 누르는 도중 최소 길이 변경
- 속도 및 track height 변경
- 단노트 기능 ON/OFF
- key display delay 변경
- 탭별 note override 전환

진행 중 노트와 대기 action은 fade-clear epoch reset으로 정리되고, 새 epoch의 DOWN부터 새 설정을 사용해야 한다. 이전 epoch와 새 epoch의 geometry가 한 화면에 섞이면 실패다.

### 13.5 property 기반 불변식

랜덤 press sequence와 랜덤 전달 지연을 생성해 다음을 반복 검증한다.

```text
playhead <= safeThrough - threshold
한 pressId에 DOWN은 정확히 하나
UP은 대응 DOWN 이후
short length는 항상 M
long length는 항상 canonical hold
렌더된 endTime은 playhead보다 과거로 새로 설정되지 않음
sequence gap 상태에서는 playhead 진행 금지
```

---

## 14. 수용 기준

- [ ] strict binary 단노트 판정이 코드와 테스트에 명시됨
- [ ] threshold 미만 hold는 모두 동일한 고정 길이
- [ ] threshold 이상 hold는 모두 canonical 실제 길이
- [ ] UP callback 도착 지연이 노트 길이에 포함되지 않음
- [ ] 지연 크기와 무관하게 표시 중인 노트가 줄어들지 않음
- [ ] 입력이 미확정인 경우 추정 렌더 대신 clock stall 발생
- [ ] 같은 키 연타에서 press ID 연결 오류 없음
- [ ] sequence gap에서 조용한 이벤트 유실 없음
- [ ] 로컬과 OBS가 같은 timeline reducer 결과를 생성
- [ ] OBS 재연결 후 과거 press 합성으로 잘못된 노트가 생기지 않음
- [ ] key/counter와 노트의 상대 싱크 유지
- [ ] 자동 계산이 threshold와 실측 reserve를 포함
- [ ] 수동 key delay에 숨은 추가 상수를 더하지 않음
- [ ] 지연 부채는 안전 구간에서만 회수
- [ ] 기존 단노트 비활성 경로, 키음, 플러그인 `keys:state` 계약 회귀 없음
- [ ] 프론트 타입·lint·format·전체 테스트 통과
- [ ] Rust check·clippy·format·전체 테스트 통과
- [ ] Windows 11 및 macOS 실기 검증 완료
- [ ] OBS 브라우저 소스 실기 검증 완료

---

## 15. 주요 위험과 대응

| 위험                                       | 영향                             | 대응                                                                      |
| ------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------- |
| watermark가 실제 입력 순서를 보장하지 못함 | 과거 UP이 확정선 뒤에 도착       | 1단계에서 플랫폼별 source sequencer 검증을 선행하고 실패 시 구조부터 수정 |
| watermark cadence가 낮음                   | playhead 계단 또는 잦은 stall    | 실측 후 cadence 결정, batch 및 writer 비용 함께 측정                      |
| 긴 main-thread stall                       | 화면 진행 정지 및 지연 부채 증가 | 정확성 우선으로 정지, 안전 구간 회수, 현재 실제 지연 진단 제공            |
| 연속 입력으로 안전 구간이 없음             | 목표 지연 복귀가 늦음            | 지연 유지, 임의 배속·geometry 점프 금지                                   |
| OBS gap이 ring buffer 범위를 초과          | 과거 이벤트 복구 불가            | hard rebase, 과거 press 합성 금지                                         |
| 미래 endTime 사전 반영                     | 전체 롱노트가 즉시 보일 수 있음  | shader가 `min(playhead, endTime)`으로 성장 길이 계산                      |
| 설정 변경과 대기 press 충돌                | 한 press의 정책이 중간에 변함    | fade-clear presentation epoch reset                                       |
| 타임라인이 플러그인 계약을 깨뜨림          | 외부 플러그인 회귀               | 기존 `keys:state` 유지, 내부 timeline 이벤트 분리                         |

---

## 16. 최종 설계 원칙

1. **도착하지 않은 UP을 없다고 추정하지 않는다.**
2. **정확성을 고정 버퍼 크기에 의존시키지 않는다.**
3. **입력이 불확실하면 geometry를 고치는 대신 재생 시계를 늦춘다.**
4. **한 번 사용자에게 보여 준 과거 노트 geometry는 다시 쓰지 않는다.**
5. **단노트 판정은 고정/실제 길이의 이진 의미를 유지한다.**
6. **경계 연속성보다 사용자 판정 의도를 우선한다.**
7. **노트·키·카운터는 같은 지연 부채를 공유한다.**
8. **성능 관련 기본값은 추정하지 않고 실측 후 결정한다.**
