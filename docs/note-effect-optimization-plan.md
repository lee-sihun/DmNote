# 노트 효과 프레임 드랍 최적화 계획

> 작성일: 2026-03-06
> 목표: 노트 효과 활성화 시 게임 및 오버레이 프레임 안정화
> 원칙: 시스템 자원 사용 증가 허용, 프레임 안정성 최우선

---

## 1. 현재 아키텍처 요약

```
[Tauri 백엔드] → onKeyState → [KeyEventBus] → [App.tsx 리스너]
                                                    │
                                    ┌───────────────┼───────────────┐
                                    ▼               ▼               ▼
                              키 UI 업데이트   useNoteSystem    WebGL 렌더러
                             (Preact Signals)  (노트 생성/종료)  (OGL instanced)
                                                    │
                                                    ▼
                                              NoteBuffer
                                         (Float32Array × 9)
                                                    │
                                                    ▼
                                          animationScheduler
                                              (rAF 루프)
```

### 핵심 파일

| 파일 | 역할 | 크기 |
|------|------|------|
| `src/renderer/hooks/overlay/useNoteSystem.ts` | 노트 생명주기 관리 | 631줄 |
| `src/renderer/stores/signals/noteBuffer.ts` | GPU 버퍼 데이터 관리 | 561줄 |
| `src/renderer/components/overlay/WebGLTracksOGL.tsx` | WebGL 렌더링 | 711줄 |
| `src/renderer/windows/overlay/App.tsx` | 오버레이 루트 컴포넌트 | 948줄 |
| `src/renderer/utils/animation/animationScheduler.ts` | rAF 스케줄러 | 31줄 |
| `src/renderer/utils/core/keyEventBus.ts` | 키 이벤트 버스 | 59줄 |

---

## 2. 병목 분석 및 심각도 평가

### 2.1 [Critical] NoteBuffer의 O(n) 삽입/삭제

**위치**: `noteBuffer.ts` - `allocate()`, `release()`, `releaseBatch()`

**문제**:
- `allocate()` 시 trackIndex 기준 정렬 삽입 → 삽입 위치 이후 모든 슬롯을 `copyWithin`으로 시프트
- 9개의 Float32Array(noteInfo, noteSize, noteColorTop, noteColorBottom, noteRadius, trackIndex, noteGlow, noteGlowColorTop, noteGlowColorBottom)에 대해 각각 `copyWithin` 실행
- `release()`/`releaseBatch()`에서도 동일한 O(n) 시프트 발생
- 빠른 키 입력(예: 200+ KPS) 시 매 키 입력마다 CPU 스파이크 발생

**영향**: CPU 메인스레드 블로킹 → rAF 콜백 지연 → 프레임 드랍

**수치 추정**: MAX_NOTES=2048, Float32Array 9개, 각 1~4 컴포넌트 → 최악의 경우 한 번의 allocate에서 ~150KB 메모리 이동

### 2.2 [High] requestAnimationFrame 래핑으로 인한 입력 지연

**위치**: `overlay/App.tsx:526-529`

```typescript
requestAnimationFrame(() => {
  if (isDown) handleKeyDown(key);
  else handleKeyUp(key);
});
```

**문제**:
- 키 이벤트 도착 시 노트 생성/종료를 다음 프레임으로 지연
- burst 입력 시 여러 이벤트가 같은 rAF 콜백으로 배치되어 타이밍 정확도 저하
- 노트의 `startTime`이 실제 키 입력 시점과 최대 16.67ms 어긋남

**영향**: 노트 타이밍 부정확 + 불필요한 1프레임 지연

### 2.3 [High] 오버레이 App 리렌더링 → 불필요한 재계산/재구독

**위치**: `overlay/App.tsx`

**문제 1 - webglTracks 매 렌더 재생성 (721~763줄)**:
```typescript
const webglTracks = currentKeys.map((key, index) => { ... }).filter(Boolean);

useEffect(() => {
  updateTrackLayouts(webglTracks);
}, [webglTracks, updateTrackLayouts]); // 매 렌더마다 실행
```
- `webglTracks`가 매 렌더링마다 새 배열로 생성됨
- `useEffect` 참조 비교 실패 → 매번 `updateTrackLayouts` 호출
- `updateTrackLayouts` 내부에서 `resolveTrackLayout` (색상 파싱 등) 반복 실행

**문제 2 - 키 이벤트 리스너 재등록 (555~562줄)**:
```typescript
useEffect(() => {
  // 키 이벤트 구독 로직...
}, [handleKeyDown, handleKeyUp, noteEffect, keyMappings, positions, selectedKeyType]);
```
- 6개 의존성 중 하나라도 변경 시 구독 해제 → 재구독
- `handleKeyDown`/`handleKeyUp`은 `noteEffect` 변경 시 새 함수 참조 생성

### 2.4 [High] WebGL 컨텍스트의 GPU 자원 경쟁

**위치**: `WebGLTracksOGL.tsx`

**문제**:
- 오버레이의 WebGL 컨텍스트가 게임과 동일한 GPU를 공유
- 투명 배경 + 블렌딩 + glow 효과로 인한 fill-rate 부담
- fragment shader에서 SDF rounded rect + glow `pow` 연산 수행
- glow가 큰 노트는 실제 렌더링 면적이 노트 본체의 수배

**영향**: GPU 경쟁으로 게임 측 프레임 드랍

### 2.5 [High] Tauri 오버레이 창의 컴포지팅 오버헤드

**문제**:
- 투명 창 + always-on-top + DWM 합성
- Windows에서 borderless fullscreen 게임과 겹칠 때 DWM 합성 비용 증가
- 오버레이 창 크기가 실제 콘텐츠보다 클 수 있음

### 2.6 [Medium] setTimeout 기반 클린업/종료 스케줄링

**위치**: `useNoteSystem.ts` - `scheduleCleanup()`, `scheduleNoteFinalization()`

**문제**:
- 각 노트 종료마다 `setTimeout` 생성
- 짧은 노트가 빠르게 생성될 때 타이머 과다 생성 가능
- `setTimeout` 정확도 한계 (최소 4ms, 실제로는 더 큰 지터)
- 메인스레드 wake-up 빈도 증가

### 2.7 [Medium] 미사용 trackIndex attribute

**위치**: `noteBuffer.ts`, `WebGLTracksOGL.tsx`

**문제**:
- `trackIndex` attribute가 vertex shader에서 선언되지만 실제 렌더링 로직에 사용되지 않음
- 그럼에도 allocate/release 시 copyWithin 대상에 포함
- 불필요한 메모리 이동 및 GPU 업로드

### 2.8 [Low] animationScheduler의 전역 태스크 순회

**위치**: `animationScheduler.ts`

**문제**: 오버레이 외 다른 태스크가 추가되면 매 프레임 간섭 가능성

---

## 3. 최적화 실행 계획

### Phase 1: CPU 메모리 이동 제거 (Critical - 최우선)

#### 1-1. NoteBuffer를 Free-list/Swap-remove 구조로 교체

**현재**: 정렬 유지를 위해 삽입/삭제 시 O(n) copyWithin × 9개 배열

**변경 방안**:

```
방안 A: Swap-remove + GPU 정렬
- 삽입: 항상 activeCount 위치에 추가 (O(1))
- 삭제: 마지막 슬롯과 swap 후 activeCount-- (O(1))
- 그리기 순서: trackIndex를 셰이더의 z값으로 사용하여 GPU에서 처리
- 장점: 구현 단순, CPU 부담 최소
- 단점: 투명 블렌딩 시 z-test만으로 정확한 순서 보장 어려울 수 있음

방안 B: Free-list 슬롯 할당자
- 삭제된 슬롯을 free-list로 관리
- 새 노트는 free-list에서 빈 슬롯 획득 (O(1))
- 삭제 시 슬롯만 free-list에 반환 (O(1), 메모리 이동 없음)
- instancedCount 대신 shader에서 startTime == 0인 슬롯 스킵 (이미 구현됨)
- 장점: 메모리 이동 완전 제거, 기존 셰이더 호환
- 단점: 빈 슬롯이 GPU에 업로드되어 약간의 낭비 (2048 고정이므로 무시 가능)

권장: 방안 B (Free-list)
```

**구현 세부사항**:
- `freeSlots: number[]` (스택) 추가
- `allocate()`: freeSlots에서 pop, 없으면 nextSlot++ (O(1))
- `release()`: 슬롯의 noteInfo를 0으로 클리어하고 freeSlots에 push (O(1))
- `releaseBatch()`: 각 슬롯을 개별 클리어 후 freeSlots에 추가 (O(k), k=삭제 수)
- `instancedCount`를 `maxAllocatedSlot`으로 변경하여 shader가 빈 슬롯 스킵
- copyWithin 호출 완전 제거

**예상 효과**: allocate/release당 CPU 시간 O(n) → O(1), 9개 배열 시프트 완전 제거

**리스크**:
- 노트 겹침 시 렌더 순서가 변경될 수 있음 → 시각적 회귀 테스트 필요
- 기존 셰이더에서 `startTime == 0`이면 화면 밖으로 보내는 로직이 이미 있어 호환성 양호

---

### Phase 2: 이벤트 처리 지연 제거 (High)

#### 2-1. 키 이벤트 rAF 래핑 제거

**현재** (`overlay/App.tsx:526-529`):
```typescript
requestAnimationFrame(() => {
  if (isDown) handleKeyDown(key);
  else handleKeyUp(key);
});
```

**변경**:
```typescript
// 즉시 실행 - 노트 데이터 생성은 동기, GPU 업로드만 다음 프레임
if (isDown) handleKeyDown(key);
else handleKeyUp(key);
```

**근거**: `handleKeyDown`/`handleKeyUp`은 NoteBuffer에 데이터를 쓰고 subscriber에게 이벤트를 알리는 것뿐. WebGL 렌더러의 `handleNoteEvent`가 이미 attribute 업데이트를 큐잉하고 다음 프레임에 배치 처리하므로 rAF 래핑은 불필요한 1프레임 지연.

**리스크**: 짧은 노트 판정 타이밍이 변경될 수 있음 → 단노트/롱노트 분기 테스트 필요

#### 2-2. 키 이벤트 리스너 1회 구독 + Ref 기반 최신값 접근

**현재**: 6개 의존성 변경마다 구독 해제/재구독

**변경**:
```typescript
// Ref로 최신값 유지
const noteEffectRef = useRef(noteEffect);
const keyMappingsRef = useRef(keyMappings);
const positionsRef = useRef(positions);
const selectedKeyTypeRef = useRef(selectedKeyType);
const handleKeyDownRef = useRef(handleKeyDown);
const handleKeyUpRef = useRef(handleKeyUp);

useEffect(() => {
  noteEffectRef.current = noteEffect;
  keyMappingsRef.current = keyMappings;
  positionsRef.current = positions;
  selectedKeyTypeRef.current = selectedKeyType;
  handleKeyDownRef.current = handleKeyDown;
  handleKeyUpRef.current = handleKeyUp;
});

// 구독은 1회만
useEffect(() => {
  keyEventBus.initialize();
  const unsub = keyEventBus.subscribe(({ key, state }) => {
    const isDown = state === 'DOWN';
    updateKeySignalWithDelay(key, isDown);
    if (noteEffectRef.current) {
      const keys = keyMappingsRef.current[selectedKeyTypeRef.current] ?? [];
      const pos = positionsRef.current[selectedKeyTypeRef.current] ?? [];
      const idx = keys.indexOf(key);
      if (pos[idx]?.noteEffectEnabled !== false) {
        if (isDown) handleKeyDownRef.current(key);
        else handleKeyUpRef.current(key);
      }
    }
  });
  return () => unsub();
}, []); // 의존성 없음 - 1회만 구독
```

**예상 효과**: 불필요한 구독 해제/재구독 제거, 클로저 갱신 문제 해결

---

### Phase 3: React 리렌더링 최소화 (High)

#### 3-1. webglTracks 메모이제이션

**현재**: 매 렌더링마다 `webglTracks` 배열 재생성 → `updateTrackLayouts` 매번 호출

**변경**: `useMemo`로 안정화
```typescript
const webglTracks = useMemo(() => {
  return currentKeys.map((key, index) => {
    // ... 기존 로직
  }).filter(Boolean);
}, [currentKeys, currentPositions, displayPositions, topMostY, noteSettings?.speed, trackHeight]);
```

**추가**: `updateTrackLayouts`도 내부적으로 이전 값과 비교하여 변경 시에만 실제 업데이트

#### 3-2. 오버레이 레이어 분리

**현재**: App 루트에서 모든 상태를 관리하여 하나의 변경이 전체 리렌더 유발

**변경**: 독립적인 레이어로 분리
```
App (최소 상태만)
├── NoteEffectLayer (WebGL 전용, 노트 관련 상태만)
├── KeyLayer (키 UI 전용)
├── StatLayer (통계 전용)
├── GraphLayer (그래프 전용)
└── PluginLayer (플러그인 전용)
```

각 레이어가 자신의 store/signal만 구독하여 교차 리렌더링 방지

---

### Phase 4: GPU 업로드 최적화 (High)

#### 4-1. Attribute 분리: 동적 vs 정적

**자주 변경되는 attribute** (매 프레임 또는 노트 이벤트마다):
- `noteInfo` (startTime, endTime, trackX) → 노트 생성/종료 시

**거의 변경되지 않는 attribute** (노트 생성 시 1회):
- `noteSize`, `noteColorTop`, `noteColorBottom`, `noteRadius`, `noteGlow`, `noteGlowColorTop`, `noteGlowColorBottom`

**변경**:
- 동적 attribute: `DYNAMIC_DRAW` 유지, 부분 업로드 (`bufferSubData`)
- 정적 attribute: `STATIC_DRAW`로 변경, 노트 생성 시에만 해당 슬롯 업로드

#### 4.2. 부분 업로드 (Dirty Range Tracking)

**현재**: 이벤트마다 전체 attribute에 `needsUpdate = true`

**변경**:
```typescript
interface DirtyRange {
  start: number; // 시작 슬롯
  end: number;   // 끝 슬롯 (exclusive)
}

// 노트 추가 시: 해당 슬롯만 dirty
// 노트 종료 시: noteInfo의 해당 슬롯만 dirty
// 프레임 시작 시: dirty range를 병합하여 bufferSubData 1회 호출
```

**주의**: OGL 라이브러리가 `bufferSubData`를 직접 지원하지 않을 수 있음 → raw WebGL 호출 필요할 수 있음

#### 4-3. 미사용 trackIndex attribute 제거

- vertex shader에서 `trackIndex` 선언 제거
- NoteBuffer에서 `trackIndex` Float32Array 제거
- allocate/release/releaseBatch에서 관련 copyWithin/fill 제거

**효과**: 메모리 이동량 ~11% 감소, GPU 업로드 1개 attribute 감소

---

### Phase 5: 타이머 기반 스케줄링 개선 (Medium)

#### 5-1. Deadline Queue로 통합

**현재**: 각 노트 종료마다 개별 `setTimeout`

**변경**:
```typescript
// Min-heap 기반 deadline queue
class DeadlineQueue {
  private heap: { time: number; noteId: string; keyName: string }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  add(deadline: number, noteId: string, keyName: string): void { ... }

  // 다음 deadline에 맞춰 단일 타이머만 유지
  private scheduleNext(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.heap.length === 0) return;
    const delay = Math.max(0, this.heap[0].time - performance.now());
    this.timer = setTimeout(() => this.processExpired(), delay);
  }

  private processExpired(): void {
    const now = performance.now();
    while (this.heap.length > 0 && this.heap[0].time <= now) {
      const { noteId, keyName } = this.extractMin();
      finalizeNote(keyName, noteId);
    }
    this.scheduleNext();
  }
}
```

**효과**: 타이머 수 N개 → 1개로 감소, 메인스레드 wake-up 최소화

#### 5-2. 클린업을 Animation Tick으로 이동

**현재**: `setTimeout` 기반 클린업 스케줄링

**변경**:
- animation loop 내에서 매 프레임(또는 N프레임마다) 만료된 노트 확인
- 이미 rAF 루프가 돌고 있으므로 추가 타이머 불필요
- 노트가 없으면 루프 자체가 멈추므로 idle 시 비용 없음

---

### Phase 6: GPU/렌더링 부담 감소 (High)

#### 6-1. 성능 모드 도입

사용자 설정으로 제공:

| 옵션 | 기본값 | 성능 모드 |
|------|--------|-----------|
| Glow 효과 | ON | OFF |
| DPR | 시스템값 | 1 (강제) |
| Frame Limit | 무제한 | 게임 FPS 약수 (예: 60) |
| 최대 동시 노트 수 | 2048 | 512 또는 256 |
| Fragment precision | highp | mediump |
| Fade 효과 | ON | OFF |
| 라운드 코너 반경 | 사용자 설정값 | 0 (사각형) |

#### 6-2. Fragment Shader 최적화

**현재 비용이 높은 연산**:
- SDF rounded rectangle 계산
- Glow falloff: `pow(glowFalloff, 2.0)`
- Fade mask 계산 (top/bottom)
- 색상 그라디언트 보간

**최적화**:
```glsl
// 성능 모드: glow/fade/round 분기 제거
#ifdef PERFORMANCE_MODE
  // 단순 사각형, glow 없음, fade 없음
  float bodyAlpha = baseColor.a;
  gl_FragColor = vec4(baseColor.rgb * bodyAlpha, bodyAlpha);
#else
  // 기존 풀 퀄리티 로직
#endif
```

또는 런타임에 두 개의 Program을 미리 컴파일하고 모드에 따라 교체

#### 6-3. 화면 밖 노트 조기 컬링 강화

**현재**: vertex shader에서 `trackTopY`/`trackBottomY` 기준 클리핑

**추가**:
- CPU 측에서 화면 밖 노트를 더 공격적으로 감지하여 instancedCount에서 제외
- 또는 vertex shader에서 조기 discard 조건 추가

---

### Phase 7: OS/창 레벨 최적화 (High)

#### 7-1. 오버레이 창 크기 최소화

**현재**: 콘텐츠 bounding box + padding으로 리사이즈

**추가**:
- 노트 트랙 영역만 별도 계산하여 WebGL canvas 크기를 최소화
- 비어있는 영역은 투명으로 두되 창 자체를 더 작게

#### 7-2. 유휴 시 프레임 최소화

**현재**: 노트가 없으면 animation loop 중지 (이미 구현)

**추가**:
- 노트가 없고 키 입력도 없는 상태가 일정 시간 지속되면 오버레이 창 숨김
- 키 입력 재개 시 즉시 표시
- 설정 UI에서 토글 가능

#### 7-3. Windows DWM 합성 최적화

- `set_ignore_cursor_events(true)` 유지하여 히트 테스트 비용 제거
- 투명 영역 최소화: 실제 렌더링 영역만 포함하도록 창 크기 축소
- 가능하면 `WS_EX_NOREDIRECTIONBITMAP` 스타일 검토 (Tauri 지원 확인 필요)

---

## 4. 구현 우선순위 및 일정

| 순서 | 작업 | 심각도 | 예상 효과 | 리스크 |
|------|------|--------|-----------|--------|
| 1 | NoteBuffer Free-list 구조 전환 | Critical | CPU 스파이크 제거 | 렌더 순서 변경 가능 → 시각 테스트 |
| 2 | rAF 래핑 제거 + 리스너 1회 구독 | High | 입력 지연 제거, 재구독 비용 제거 | 짧은 노트 타이밍 회귀 가능 |
| 3 | webglTracks 메모이제이션 + 리렌더 분리 | High | 불필요한 재계산/재구독 제거 | 리팩터 범위가 넓을 수 있음 |
| 4 | GPU 부분 업로드 + attribute 분리 | High | GPU 업로드 대역폭 감소 | OGL 추상화 한계 시 raw WebGL 필요 |
| 5 | 타이머 → Deadline Queue 전환 | Medium | 메인스레드 wake-up 감소 | 판정 타이밍 변경 → 테스트 필요 |
| 6 | 성능 모드 도입 (glow/DPR/frame cap 등) | High | GPU 부담 대폭 감소 | 화질 저하 (사용자 선택) |
| 7 | OS/창 레벨 최적화 | High | 컴포지팅 비용 감소 | UX 변경 가능 |

---

## 5. 추가 발견 사항

### 5-1. Fragment Shader fill-rate 문제

노트 효과의 프레임 드랍은 노트 **개수**보다 **그려지는 픽셀 수**에 더 민감할 수 있음. Glow 효과가 활성화되면 노트 본체 대비 렌더링 면적이 `(noteWidth + glowSize*2) × (noteLength + glowSize*2)`로 확장되어 fill-rate 부담이 급증.

### 5-2. updateTrackLayouts 데이터 일관성

`updateTrackLayouts()`가 활성 노트가 존재하는 상태에서 호출되면 `trackIndex`만 갱신하고 위치/폭/색상은 기존 값 유지. 레이아웃이 동적으로 변경되는 경우 노트 데이터 불일치 가능성 있음.

### 5-3. 플러그인/통계/그래프 레이어의 compositor 경쟁

노트 효과와 동일한 compositor 경로를 공유. 성능 모드에서 이들 레이어의 애니메이션 비활성화 옵션도 고려 필요.

### 5-4. dynamic import의 반복 호출

`overlay/App.tsx`의 키 이벤트 구독 `useEffect` 내부에서 `import('@utils/core/keyEventBus')`를 사용하지만, 의존성 변경 시마다 재실행되어 dynamic import가 반복 호출됨. 모듈 캐시로 실제 네트워크 비용은 없으나, Promise 체인 오버헤드는 있음.

---

## 6. 리스크 및 주의사항

1. **시각적 회귀**: NoteBuffer 구조 변경 시 노트 겹침 순서가 달라질 수 있음. 변경 전후 스크린샷 비교 필수.

2. **타이밍 정확도**: rAF 래핑 제거 및 타이머 통합 시 단노트/롱노트 판정 로직에 영향. 다양한 KPS 시나리오에서 테스트 필요.

3. **OGL 라이브러리 한계**: `bufferSubData` 등 저수준 WebGL 접근이 필요할 경우 OGL 추상화를 우회해야 할 수 있음. `renderer.gl`로 직접 접근 가능하지만 OGL의 내부 상태와 충돌 가능성.

4. **성능 모드 UX**: 사용자가 성능 모드의 존재를 인지하고 쉽게 토글할 수 있어야 함. 기본값은 자동 감지(프레임 드랍 감지 시 제안) 또는 수동 선택.

5. **크로스 플랫폼**: macOS는 이미 DPR 1 제한이 있으나, Windows에서의 DWM 최적화는 별도 검증 필요.

---

## 7. 검증 방법

### 프레임 측정
- 오버레이: `animationScheduler` 내부에 frame time 로깅 추가
- 게임: 외부 FPS 카운터 (MSI Afterburner, RTSS 등) 사용
- 시나리오: 200+ KPS 자동 입력 시뮬레이션

### 메모리 프로파일링
- Chrome DevTools Memory 탭으로 NoteBuffer 할당/해제 패턴 확인
- Float32Array copyWithin 호출 빈도 측정 (Performance 탭)

### GPU 프로파일링
- Chrome DevTools Performance 탭의 GPU 레인 확인
- WebGL Inspector로 draw call 수 및 업로드 크기 모니터링

---

## 8. 요약

```
최적화 흐름:
CPU 메모리 이동 제거 → 이벤트 지연 제거 → React 재구독/재렌더 제거
→ GPU 업로드 범위 축소 → 합성 비용 절감
```

핵심은 **NoteBuffer의 O(n) → O(1) 전환**과 **불필요한 rAF 래핑/리렌더링 제거**. 이 두 가지만으로도 상당한 프레임 안정화가 예상되며, 이후 GPU/OS 레벨 최적화로 게임 측 프레임 영향을 추가 감소시킬 수 있음.
