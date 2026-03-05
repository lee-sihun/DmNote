# DmNote 리팩토링 계획서

## 목표

현재의 기능과 디자인을 유지하면서 프로젝트의 장기적인 유지보수성을 향상시킨다.

---

## Phase 1: 코드 정리 및 기반 작업

### 1-1. 사용되지 않는 파일 제거

| 파일 | 사유 | 상태 |
|------|------|------|
| `src/renderer/components/main/Modal/content/GridSettingsModal.tsx` | import 없음 | DONE |
| `src/renderer/components/main/Modal/content/legacy/NoteColorSetting.jsx` | legacy, 미사용 | DONE |
| `src/renderer/components/overlay/LatencyDisplay.jsx` | import 없음 | DONE |
| `src/renderer/components/overlay/Track.jsx` | deprecated, OGL 버전으로 대체됨 | DONE |
| `src/renderer/components/overlay/Note.jsx` | deprecated, OGL 버전으로 대체됨 | DONE |
| `src/renderer/components/overlay/WebGLTracks.jsx` | deprecated, OGL 버전으로 대체됨 | DONE |
| ~~`src/renderer/utils/templateEngine.ts`~~ | ~~불필요한 추상화~~ -> 4곳에서 사용 중, 보존 | 보존 |

> 제거 완료 (6개 파일 삭제)
> 리팩토링 과정에서 추가 미사용 파일 발견 시 즉시 체크 후 삭제

**보존 대상:**
- `src/renderer/components/main/common/Radio.tsx` — 공통 컴포넌트, 차후 활용 여지 있음

### 1-2. JS/JSX -> TypeScript 전환 ✅ DONE

**총 33개 파일 전환 완료** (wasm 제외)

- MEDIUM 우선순위 7개 파일 (유틸/훅): ✅ 완료
- HIGH 우선순위 23개 파일 (핵심 컴포넌트): ✅ 완료
- LOW 우선순위 2개 파일 (legacy): ✅ 완료
- 엔트리 포인트 1개: ✅ 완료
- TypeScript 컴파일 에러 212개 → 0개 수정 완료
- 남은 JS 파일: `note_wasm.js` (wasm 생성 코드, 제외 대상)

### 1-3. 주석 한글화 및 키워드/명사형 통일 ✅ DONE

- 58개 파일의 영어 주석을 한글로 전환 완료
- 기술 용어(DOM, ref, state, hook, emit, render 등)는 영어 유지
- 키워드/명사형 스타일로 통일

---

## Phase 2: 폴더 구조 개선 ✅ DONE

### 2-1. 현재 구조 피드백

**긍정적:**
- 경로 alias(@components, @hooks 등) 잘 활용
- 깊은 상대경로(`../../../../`) 없음
- Hook 네이밍 규칙(`use~`) 일관적
- Store 간 순환 의존 없음

**개선 필요:**
- `Modal/content/` 28개 파일 — 과밀
- `utils/` 23개 파일 — 도메인별 분류 필요
- `stores/` 19개 파일 — 그룹핑 필요
- `overlay/` 10개 파일 — WebGL 분리 필요

### 2-2. 폴더 구조 개선안

```
src/renderer/
├── components/
│   ├── main/
│   │   ├── Grid/
│   │   │   ├── core/              # Grid.tsx, GridBackground.tsx, GridMinimap.tsx
│   │   │   ├── overlays/          # SmartGuidesOverlay, MarqueeSelectionOverlay, ZoomIndicator
│   │   │   ├── handles/           # ResizeHandles, GroupResizeHandles
│   │   │   ├── layers/            # KeyCounterPreviewLayer, StatCounterLayer, GraphItem
│   │   │   └── PropertiesPanel/   # (기존 유지)
│   │   ├── Modal/
│   │   │   ├── common/            # FloatingPopup, FloatingTooltip, TooltipGroup
│   │   │   ├── pickers/           # ColorPicker, ImagePicker, Palette, WebFontInputModal
│   │   │   ├── settings/          # NoteSetting, KeyTabContent, NoteTabContent, CounterTabContent
│   │   │   ├── managers/          # PluginManagerModal, SoundManagerModal, SoundTrimModal
│   │   │   ├── editors/           # TabCssModal, CounterAnimationEditorModal
│   │   │   ├── dialogs/           # Alert, PluginDataDeleteModal, UnifiedKeySetting, Laboratory
│   │   │   └── legacy/            # (미사용 파일 제거 후 축소)
│   │   ├── Tool/
│   │   ├── common/                # Checkbox, Radio, Dropdown 등 공통 UI
│   │   ├── Settings.tsx
│   │   └── TitleBar.tsx
│   ├── overlay/
│   │   ├── rendering/             # WebGLTracksOGL
│   │   └── counters/              # CountDisplay, StatItem, StatCounterLayer, KeyCounterLayer
│   ├── shared/                    # (NEW) main/overlay 공통 컴포넌트
│   │   └── CounterDisplay.tsx     # 카운터 렌더링 공통 로직
│   ├── graph/
│   ├── PluginElement.tsx
│   └── PluginElementsRenderer.tsx
├── hooks/
│   ├── Grid/
│   ├── Modal/
│   ├── shared/                    # (NEW) main/overlay 공통 훅
│   │   ├── useCounterSettings.ts  # 카운터 설정 정규화
│   │   ├── useImageWarmup.ts      # 이미지 프리로딩
│   │   └── useDragState.ts        # 드래그 상태 관리
│   └── (기존 훅 유지)
├── utils/
│   ├── plugin/                    # pluginUtils, pluginComponents, pluginDropdownManager, pluginI18n
│   ├── animation/                 # animationScheduler
│   ├── color/                     # colorUtils, colorPaletteStorage
│   ├── grid/                      # smartGuides, cursorUtils, scrollShadow
│   ├── counter/                   # (NEW) counterPositioning.ts
│   └── core/                      # keyEventBus, rawKeyEventBus, KeyMaps, imageSource, imageWarmup, typography
├── stores/
│   ├── signals/                   # keySignals, statsSignals, keyCounterSignals
│   └── (나머지 zustand store는 현재 위치 유지)
├── styles/
│   ├── colors.ts                  # 디자인 토큰 (확장)
│   ├── typography.ts
│   └── components.css             # (NEW) 공통 컴포넌트 스타일
└── (나머지 폴더 기존 유지)
```

### 2-3. 과밀 디렉토리 파일 수 변화

| 디렉토리 | 변경 전 | 변경 후 |
|----------|---------|---------|
| `Modal/content/` | 28개 | 하위 6개 폴더로 분산 (각 3~5개) |
| `utils/` | 23개 | 하위 6개 폴더로 분산 (각 2~5개) |
| `Grid/` | 13개 | 하위 4개 폴더로 분산 (각 2~4개) |
| `overlay/` | 10개 | deprecated 제거 후 2개 폴더 (각 1~4개) |

---

## Phase 3: 재사용 패턴 추출 ✅ DONE

### 3-1. 공통 훅 추출

| 훅 이름 | 추출 대상 | 영향 파일 |
|---------|----------|----------|
| `useCounterSettings(counter)` | 카운터 설정 정규화 + 기본값 | KeyCounterLayer, StatCounterLayer (main/overlay 각 2개, 총 4개) |
| `useImageWarmup(sources[])` | 이미지 프리로딩 useEffect 패턴 | overlay/main 컴포넌트 다수 |
| `useDragState()` | `useRef({ isDragging, startX, startY })` 패턴 | ResizeHandles, GroupResizeHandles, 드래그 관련 컴포넌트 |

### 3-2. 공통 유틸리티 추출

| 유틸 | 현황 | 개선 |
|------|------|------|
| `computeOutsideStyle()` | 4개 파일에 동일 함수 복붙 | `utils/counter/counterPositioning.ts`로 추출 |
| `OUTSIDE_OFFSET = 5` | 4개 파일에 매직넘버 | 상수로 통합 |

### 3-3. 디자인 토큰 확장 (`colors.ts`)

**현재:** primary, button, text 색상만 정의

**추가 필요 토큰:**

```typescript
// 현재 120+ 곳에 하드코딩된 색상
border: '#3A3943',           // 120+ 사용
surface: '#2A2A30',          // 139+ 사용
surfaceHover: '#303036',
surfaceActive: '#393941',
hoverDark: '#353540',
focus: '#459BF8',
textDisabled: '#6B6D75',
danger: {
  bg: '#3C1E1E',             // 11+ 사용
  hover: '#442222',
  active: '#522929',
  text: '#E6DBDB',
},
```

### 3-4. 공통 스타일 클래스 추출

Tailwind `@layer components`로 반복 패턴 통합:

| 클래스명 | 현재 반복 횟수 | 패턴 |
|---------|---------------|------|
| `.icon-btn` | 11+ | `w-[24px] h-[24px] flex items-center justify-center hover:bg-surface rounded-[4px] transition-colors` |
| `.input-field` | 16+ | `text-center h-[23px] bg-surface rounded-[7px] border border-border focus:border-focus text-style-4 text-text` |
| `.btn-danger` | 11+ | `bg-danger hover:bg-danger-hover active:bg-danger-active rounded-[7px] text-danger-text` |
| `.btn-secondary` | 8+ | `bg-surface hover:bg-surfaceHover active:bg-surfaceActive rounded-[7px] text-text` |
| `.btn-default` | 5+ | `px-[10px] h-[23px] bg-surface hover:bg-surfaceHover active:bg-surfaceActive rounded-[7px] text-style-4` |

---

## Phase 4: Preact -> React 전환 및 React Compiler 도입 ✅ DONE

### 4-1. Preact -> React 전환

**변경 범위:** 설정 파일만 수정 (코드는 이미 React 문법)

1. 패키지 교체:
   - `preact`, `@preact/preset-vite`, `preact-render-to-string` 제거
   - `react`, `react-dom` 설치
2. `vite.config.ts`에서 preact alias 제거, React plugin 추가
3. `tsconfig.json`의 `jsx` 설정 확인

### 4-2. React Compiler 도입

1. `babel-plugin-react-compiler` 설치 및 Vite 설정
2. **Signals 파일 제외 설정:**
   ```js
   // React Compiler 설정에서 제외
   compilationMode: "annotation" // 또는 파일 단위 제외
   ```
   - `src/renderer/stores/signals/keySignals.ts`
   - `src/renderer/stores/signals/statsSignals.ts`
   - `src/renderer/stores/signals/keyCounterSignals.ts`
   - 위 signal을 import하는 컴포넌트도 제외 대상 검토

### 4-3. 수동 메모이제이션 제거

**현황:** `useCallback` 351개, `useMemo` 123개 (총 474개)

**최다 사용 파일 (우선 제거 대상):**

| 파일 | useCallback | useMemo | 합계 |
|------|-------------|---------|------|
| PropertiesPanel.tsx | 55 | 11 | 66 |
| LayerTabContent.tsx | 25 | 7 | 32 |
| StyleTabContent.tsx | 26 | 2 | 28 |
| App.tsx (overlay) | 10 | 14 | 24 |
| useBatchHandlers.ts | 23 | 0 | 23 |
| SoundTrimModal.tsx | 18 | 3 | 21 |
| CounterAnimationEditorModal.tsx | 13 | 7 | 20 |

> React Compiler 도입 후 불필요한 useMemo/useCallback 제거. 단, signal 의존 코드는 수동 메모이제이션 유지.

---

## Phase 5: 코드 품질 향상 ✅ DONE

### 5-1. 대형 파일 분할

| 파일 | 라인 수 | 분할 방안 |
|------|---------|----------|
| `PropertiesPanel.tsx` | 4,439 | coordinator + SingleSelectionPanel + BatchSelectionPanel로 분리 |
| `LayerTabContent.tsx` | 3,112 | 레이어 목록 / 레이어 액션 / 레이어 DnD로 분리 |
| `PluginElement.tsx` | 1,668 | Shadow DOM / 드래그 / 리사이즈 로직 hook으로 분리 |
| `useKeyManager.ts` | 1,570 | key 히스토리 / key 배치 / key 상태 관리로 분리 |
| `useGridResize.ts` | 1,088 | 리사이즈 코어 / 스마트 가이드 연동 분리 |
| `smartGuides.ts` | 1,061 | 가이드 계산 / 스냅 로직 / 정렬 로직 분리 |
| `dmnoteApi.ts` | 975 | 서브시스템별 분할 (settings, notes, keys, overlay 등) |

### 5-2. 불필요한 오버엔지니어링 제거

| 대상 | 문제 | 개선 |
|------|------|------|
| `pluginComponents.ts` (332줄) | HTML 문자열 빌더가 57줄짜리 함수로 구성 | 템플릿 리터럴로 단순화 |
| `templateEngine.ts` (37줄) | 한 줄짜리 유틸의 불필요한 모듈 분리 | 인라인 처리 후 파일 제거 |
| `storageWrapper.ts` (36줄) | key에 prefix 붙이기만 하는 얇은 래퍼 | 인라인 처리 또는 단순 함수로 축소 |
| `functionWrapper.ts` (73줄) | 재귀적 함수 래핑 + window 전역 변수 관리 | 클로저 기반 단순화 |
| `defineElement.ts` (608줄) | 팩토리 함수에 5가지 관심사 혼재 | 관심사별 hook/함수 분리 |
| `defineSettings.ts` (573줄) | 설정 로직 + UI 알림 + 구독 관리 혼재 | 관심사별 분리 |

### 5-3. 네이밍 개선

> 현재 네이밍 품질은 양호함 (40자 초과 없음, 제네릭 이름 없음). 아래는 발견된 소수 개선 사항.

| AS-IS | TO-BE | 사유 |
|-------|-------|------|
| `overlayConfig.js` | `overlayDefaults.ts` | "config"보다 "defaults"가 내용에 적합 |
| `dmnoteApi.ts` (975줄) | 서브시스템별 분할 | 단일 파일에 모든 API 집중 |

---

## Phase 6: Lint 에러 해소 ✅ DONE

### 6-1. react-hooks/rules-of-hooks (49개, warn)

- 조건부 Hook 호출 패턴 -> 컴포넌트 분리로 해결
- 주로 `Key.jsx`, overlay 컴포넌트에 집중

### 6-2. react-hooks/exhaustive-deps (60개, warn)

- 의존성 배열 누락 -> Phase 4의 React Compiler 도입으로 대부분 자동 해결
- 나머지는 수동 검토

### 6-3. react-compiler 에러 (78개, error)

- `setState in effect` (33개), `refs during render` (26개) 등
- Phase 5의 대형 파일 분할 과정에서 자연스럽게 해결
- 분할 후에도 남는 것은 개별 수정

---

## 실행 순서 요약

```
Phase 1        Phase 2        Phase 3        Phase 4        Phase 5        Phase 6
(코드 정리)     (폴더 구조)    (재사용 추출)   (React 전환)   (코드 품질)    (린트 해소)
┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐
│ 미사용     │  │ 폴더 구조 │  │ 공통 훅   │  │ Preact->  │  │ 대형 파일 │  │ Hook 규칙 │
│ 파일 제거  │->│ 재편      │->│ 추출      │->│ React     │->│ 분할      │->│ 위반 수정 │
│            │  │           │  │           │  │           │  │           │  │           │
│ JS->TS    │  │ import    │  │ 공통 유틸 │  │ React     │  │ 오버엔지  │  │ 의존성    │
│ 전환      │  │ 경로 갱신 │  │ 추출      │  │ Compiler  │  │ 니어링    │  │ 배열 정리 │
│            │  │           │  │           │  │           │  │ 제거      │  │           │
│ 주석      │  │           │  │ 디자인    │  │ 메모이    │  │           │  │ compiler  │
│ 한글화    │  │           │  │ 토큰 확장 │  │ 제이션    │  │ 네이밍    │  │ 에러 수정 │
│            │  │           │  │           │  │ 제거      │  │ 개선      │  │           │
│ deprecated│  │           │  │ 스타일    │  │           │  │           │  │           │
│ 파일 제거 │  │           │  │ 클래스    │  │           │  │           │  │           │
└───────────┘  └───────────┘  └───────────┘  └───────────┘  └───────────┘  └───────────┘
```

---

## 주의사항

- 각 Phase 완료 후 `npm run build` + `cargo build` 통과 확인
- 리팩토링은 기능 변경 없이 진행 (동작 변경 금지)
- Phase별 별도 커밋/PR로 관리하여 rollback 가능하게 유지
- Signals 파일은 React Compiler 제외 설정 필수
- 리팩토링 과정에서 추가 미사용 파일 발견 시 즉시 체크 후 삭제
