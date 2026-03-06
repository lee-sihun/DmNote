# DmNote 프론트엔드 리팩토링 계획서

> **작성일**: 2026-03-06
> **작성**: Claude (Opus 4.6) + Codex (GPT 5.4) 협업
> **브랜치**: `refactor/code-quality`
> **현황**: 총 61,796줄 / 130+ TypeScript 파일 / 코드 품질 점수 7.5~7.8/10

---

## 목차

1. [현황 진단 요약](#1-현황-진단-요약)
2. [목표 아키텍처](#2-목표-아키텍처)
3. [Phase 1 — 기반 구축: 순수 함수 추출](#3-phase-1--기반-구축-순수-함수-추출)
4. [Phase 2 — 트랜잭션 실행기 도입](#4-phase-2--트랜잭션-실행기-도입)
5. [Phase 3 — useKeyManager 분해](#5-phase-3--usekeymanager-분해)
6. [Phase 4 — Grid.tsx 분해](#6-phase-4--gridtsx-분해)
7. [Phase 5 — LayerTabContent / PropertiesPanel 정리](#7-phase-5--layertabcontent--propertiespanel-정리)
8. [Phase 6 — 코드 위생 및 훅 안정화](#8-phase-6--코드-위생-및-훅-안정화)
9. [리스크 및 주의사항](#9-리스크-및-주의사항)
10. [마이그레이션 원칙](#10-마이그레이션-원칙)

---

## 1. 현황 진단 요약

### 양호한 점

| 항목 | 상태 | 비고 |
|------|------|------|
| 타입 안전성 | `any` 4건 | 매우 우수 |
| 네이밍 컨벤션 | 일관됨 | CLAUDE.md 규칙 준수 |
| API 레이어 | 타입 안전한 invoke 래핑 | 구독 패턴 일관 |
| 상태 관리 | Zustand + Signals | 목적별 분리 적절 |
| 성능 의식 | 오버레이 Signal, 오브젝트 풀링 | useNoteSystem 등 |
| 폴더 구조 | 대분류 명확 | api/hooks/stores/components |

### 핵심 문제

| 순위 | 문제 | 심각도 | 파일 수 |
|------|------|--------|---------|
| 1 | **초대형 파일** (1,000줄+) | 높음 | 14개 |
| 2 | **도메인 로직이 UI에 매몰** | 높음 | Grid, Key, useKeyManager |
| 3 | **eslint-disable 누적** | 중간 | 35건 (20+ 파일) |
| 4 | **console.* 잔존** | 중간 | 253건 (49파일) |
| 5 | **이벤트 리스너 생명주기 불안정** | 중간 | useGridZoomPan 등 |
| 6 | **스토어 setter 장황** | 낮음 | useSettingsStore |

### 리팩토링 대상 파일 (줄 수 순)

```
Grid.tsx                    3,054줄  ← Phase 4
LayerTabContent.tsx         2,971줄  ← Phase 5
PropertiesPanel.tsx         2,450줄  ← Phase 5
PluginElement.tsx           1,623줄
useKeyManager.ts            1,531줄  ← Phase 3
ColorPicker.tsx             1,453줄
CounterAnimationEditor.tsx  1,397줄
BatchSelectionPanel.tsx     1,331줄
useBatchHandlers.ts         1,313줄
SoundTrimModal.tsx          1,193줄
SingleSelectionPanel.tsx    1,131줄
PropertyInputs.tsx          1,117줄
smartGuides.ts              1,061줄
useGridResize.ts            1,060줄
```

---

## 2. 목표 아키텍처

### 핵심 원칙

> **"순수 변환 함수 + 트랜잭션 실행기 + React 바인딩"** 3층 구조
>
> 완전한 DDD/CQRS가 아닌, 현재 코드베이스의 패턴(layerGroupUtils 등)을 확장하는 실용적 접근

### 디렉토리 구조

```
src/renderer/
├── editor/                    ← 신규
│   ├── model/                 ← 순수 함수 (React/Store 의존 없음)
│   │   ├── zOrder.ts          ← moveToFront/Back/Forward/Backward
│   │   ├── selection.ts       ← 마르키 판정, 범위 선택 계산
│   │   ├── snap.ts            ← snap, bounds 계산 (순수 부분)
│   │   ├── keys.ts            ← 키 CRUD, 스타일, 노트, 카운터 상태 계산
│   │   ├── canvasItems.ts     ← key/stat/graph/plugin 공통 정렬/가시성/그룹
│   │   └── groups.ts          ← layerGroupUtils 흡수 또는 재export
│   │
│   └── runtime/               ← 트랜잭션 실행기 (Store/API 의존)
│       ├── editorTransaction.ts     ← runTransaction (store + API + history)
│       ├── captureSnapshot.ts       ← 현재 편집 상태 스냅샷
│       ├── applySnapshot.ts         ← 스냅샷 복원 (undo/redo)
│       ├── persistState.ts          ← Tauri API 동기화
│       └── restorePluginElements.ts ← 플러그인 핸들러 복원
│
├── hooks/                     ← 기존: React 바인딩만
│   ├── Grid/
│   │   ├── useGridCanvasActions.ts  ← 신규: add/delete/duplicate/move/z-order
│   │   ├── useGridContextActions.ts ← 신규: 컨텍스트 메뉴 액션
│   │   ├── useGridModalState.ts     ← 신규: 모달 상태
│   │   ├── useGridSceneData.ts      ← 신규: 렌더용 view model
│   │   └── ... (기존 훅 유지)
│   └── useKeyManager.ts       ← 축소: 입력 해석 + 함수 조립만
│
├── components/
│   └── main/Grid/core/
│       ├── Grid.tsx            ← 축소: orchestration shell
│       ├── GridScene.tsx       ← 신규: 요소 렌더링
│       ├── GridOverlays.tsx    ← 신규: marquee/guides/resize/minimap
│       └── GridModalHost.tsx   ← 신규: 모달만 렌더
│
├── stores/                    ← 기존 유지
├── api/                       ← 기존 유지
├── utils/                     ← 기존 유지 (일부 editor/model로 이동)
└── ...
```

### 데이터 흐름

```
[사용자 입력]
    ↓
[React 컴포넌트/훅]  — 이벤트 해석, UI 상태
    ↓
[editor/runtime]     — 트랜잭션: snapshot → 계산 → store 반영 → API persist
    ↓                    ↑
[editor/model]       — 순수 상태 변환 함수 (side-effect 없음)
    ↓
[stores → components] — 리렌더링
```

---

## 3. Phase 1 — 기반 구축: 순수 함수 추출

> **목표**: editor/model에 순수 함수를 추출하여 도메인 로직의 단일 진입점 마련
> **영향 범위**: 신규 파일만 추가, 기존 코드 변경 없음

### 3-1. `editor/model/zOrder.ts`

useKeyManager의 handleMoveToFront/Back/Forward/Backward에서 **상태 계산부만** 추출:

```typescript
// editor/model/zOrder.ts — 순수 함수, Store/React 의존 없음

interface ZOrderItem {
  zIndex?: number;
  [key: string]: unknown;
}

/** 대상을 맨 앞으로 이동한 새 배열 반환 */
export function moveItemToFront<T extends ZOrderItem>(
  items: T[],
  index: number,
): T[] { ... }

/** 대상을 맨 뒤로 이동한 새 배열 반환 */
export function moveItemToBack<T extends ZOrderItem>(
  items: T[],
  index: number,
): T[] { ... }

/** 대상을 한 칸 앞으로 이동한 새 배열 반환 */
export function moveItemForward<T extends ZOrderItem>(
  items: T[],
  index: number,
): T[] { ... }

/** 대상을 한 칸 뒤로 이동한 새 배열 반환 */
export function moveItemBackward<T extends ZOrderItem>(
  items: T[],
  index: number,
): T[] { ... }

/** zIndex 기준 정렬 순서 재정렬 */
export function reindexZOrder<T extends ZOrderItem>(items: T[]): T[] { ... }
```

### 3-2. `editor/model/keys.ts`

useKeyManager의 키 CRUD, 스타일, 노트, 카운터 업데이트에서 **다음 상태 계산부** 추출:

```typescript
// editor/model/keys.ts

import type { KeyMappings, KeyPositions, KeyPosition } from '@src/types/key/keys';

/** 키 추가 후 새 mappings/positions 반환 */
export function addKey(
  mappings: KeyMappings,
  positions: KeyPositions,
  mode: string,
  options?: { dx?: number; dy?: number },
): { mappings: KeyMappings; positions: KeyPositions } { ... }

/** 키 삭제 후 새 mappings/positions 반환 */
export function removeKey(
  mappings: KeyMappings,
  positions: KeyPositions,
  mode: string,
  index: number,
): { mappings: KeyMappings; positions: KeyPositions } { ... }

/** 키 복제 후 새 mappings/positions 반환 */
export function duplicateKey(
  mappings: KeyMappings,
  positions: KeyPositions,
  mode: string,
  sourceIndex: number,
  targetDx: number,
  targetDy: number,
): { mappings: KeyMappings; positions: KeyPositions } { ... }

/** 키 위치 변경 후 새 positions 반환 */
export function updateKeyPosition(
  positions: KeyPositions,
  mode: string,
  index: number,
  dx: number,
  dy: number,
): KeyPositions { ... }

/** 키 스타일 업데이트 후 새 positions 반환 */
export function updateKeyStyle(
  positions: KeyPositions,
  mode: string,
  index: number,
  updates: Partial<KeyPosition>,
): KeyPositions { ... }

/** 배치 키 스타일 업데이트 */
export function batchUpdateKeyStyle(
  positions: KeyPositions,
  mode: string,
  updates: Array<{ index: number } & Partial<KeyPosition>>,
): KeyPositions { ... }

/** 키 매핑 변경 */
export function updateKeyMapping(
  mappings: KeyMappings,
  mode: string,
  index: number,
  newKey: string,
): KeyMappings { ... }
```

### 3-3. `editor/model/canvasItems.ts`

key/stat/graph/plugin에 걸쳐 **공통으로 사용되는** 정렬/가시성/그룹 연산:

```typescript
// editor/model/canvasItems.ts

export interface CanvasItem {
  type: 'key' | 'stat' | 'graph' | 'plugin';
  id: string;
  index?: number;
  zIndex?: number;
  hidden?: boolean;
  groupId?: string;
}

/** 통합 캔버스 아이템 목록 생성 */
export function buildCanvasItems(
  keyPositions: KeyPosition[],
  statPositions: StatItemPosition[],
  graphPositions: GraphItemPosition[],
  pluginElements: PluginDisplayElementInternal[],
): CanvasItem[] { ... }

/** 가시성 토글 */
export function toggleItemVisibility<T extends { hidden?: boolean }>(
  items: T[],
  index: number,
): T[] { ... }
```

### 3-4. `editor/model/groups.ts`

기존 `utils/layerGroupUtils.ts`를 재export하거나 점진적으로 흡수:

```typescript
// editor/model/groups.ts
export {
  applyGroupIdToSelectedElements,
  buildNextLayerGroupName,
  normalizeLayerGroupsForMode,
  resolveSingleGroupIdFromSelection,
} from '@utils/layerGroupUtils';
```

### Phase 1 체크리스트

- [ ] `editor/model/zOrder.ts` 생성 + 테스트
- [ ] `editor/model/keys.ts` 생성 + 테스트
- [ ] `editor/model/canvasItems.ts` 생성 + 테스트
- [ ] `editor/model/groups.ts` 생성 (재export)
- [ ] 기존 코드에서 import 경로만 변경하여 동작 확인

---

## 4. Phase 2 — 트랜잭션 실행기 도입

> **목표**: 히스토리 스냅샷 캡처/복원/API 동기화를 한곳으로 격리
> **핵심**: 현재 스냅샷 기반 undo/redo를 유지하면서 실행 계층만 분리

### 4-1. `editor/runtime/captureSnapshot.ts`

```typescript
// editor/runtime/captureSnapshot.ts

export interface EditorSnapshot {
  keyMappings: KeyMappings;
  positions: KeyPositions;
  statPositions: StatItemPositions;
  graphPositions: GraphItemPositions;
  pluginElements: PluginDisplayElementInternal[];
  layerGroups: LayerGroups;
  counters: KeyCounters;
}

/** 현재 편집 상태의 스냅샷 캡처 */
export function captureEditorSnapshot(): EditorSnapshot {
  return {
    keyMappings: useKeyStore.getState().keyMappings,
    positions: useKeyStore.getState().positions,
    statPositions: useStatItemStore.getState().positions,
    graphPositions: useGraphItemStore.getState().positions,
    pluginElements: usePluginDisplayElementStore.getState().elements,
    layerGroups: useLayerGroupStore.getState().groups,
    counters: /* 현재 카운터 상태 */,
  };
}
```

### 4-2. `editor/runtime/applySnapshot.ts`

```typescript
// editor/runtime/applySnapshot.ts

/** 스냅샷을 store에 적용 (undo/redo 시 사용) */
export async function applyEditorSnapshot(
  snapshot: EditorSnapshot,
): Promise<void> {
  // 1. 로컬 스토어 업데이트
  useKeyStore.getState().setKeyMappingsAndPositions(
    snapshot.keyMappings,
    snapshot.positions,
  );
  useStatItemStore.getState().setPositions(snapshot.statPositions);
  useGraphItemStore.getState().setPositions(snapshot.graphPositions);

  // 2. 플러그인 요소 복원 (핸들러 포함)
  await restorePluginElements(snapshot.pluginElements);

  // 3. 카운터 복원
  applyCounterSnapshot(snapshot.counters);

  // 4. 레이어 그룹 복원
  useLayerGroupStore.getState().setGroups(snapshot.layerGroups);
}
```

### 4-3. `editor/runtime/persistState.ts`

```typescript
// editor/runtime/persistState.ts

/** 현재 store 상태를 Tauri 백엔드에 동기화 */
export async function persistEditorState(
  partial?: Partial<EditorSnapshot>,
): Promise<void> {
  const promises: Promise<unknown>[] = [];

  if (partial?.keyMappings) {
    promises.push(window.api.keys.update(partial.keyMappings));
  }
  if (partial?.positions) {
    promises.push(window.api.keys.updatePositions(partial.positions));
  }
  // ... stat, graph, layerGroups 등

  await Promise.all(promises);
}
```

### 4-4. `editor/runtime/editorTransaction.ts`

```typescript
// editor/runtime/editorTransaction.ts

interface TransactionOptions {
  saveHistory?: boolean;  // 기본 true
  persist?: boolean;      // 기본 true
}

/**
 * 편집 트랜잭션 실행
 * 1. (옵션) 히스토리에 현재 상태 저장
 * 2. 변환 함수 실행하여 다음 상태 계산
 * 3. store 반영
 * 4. (옵션) Tauri API 동기화
 */
export async function runEditorTransaction<T>(
  transform: () => T,
  apply: (result: T) => Partial<EditorSnapshot>,
  options: TransactionOptions = {},
): Promise<void> {
  const { saveHistory = true, persist = true } = options;

  if (saveHistory) {
    const snapshot = captureEditorSnapshot();
    useHistoryStore.getState().pushState(/* snapshot */);
  }

  const result = transform();          // editor/model 함수 호출
  const changes = apply(result);       // store 반영할 변경분 계산

  // store 반영
  if (changes.keyMappings) { ... }
  if (changes.positions) { ... }

  // 백엔드 동기화
  if (persist) {
    await persistEditorState(changes);
  }
}
```

### Phase 2 체크리스트

- [ ] `EditorSnapshot` 타입 정의
- [ ] `captureSnapshot.ts` 구현
- [ ] `applySnapshot.ts` 구현 (undo/redo 복원 로직 이동)
- [ ] `persistState.ts` 구현
- [ ] `editorTransaction.ts` 구현
- [ ] `restorePluginElements.ts` 구현 (useKeyManager의 플러그인 복원 로직 이동)
- [ ] useKeyManager의 `handleUndo/handleRedo`를 runtime 함수로 교체하여 동작 확인

---

## 5. Phase 3 — useKeyManager 분해

> **목표**: 1,531줄 → ~200줄 (입력 해석 + 함수 조립)
> **전략**: 기존 외부 API(반환 타입) 유지, 내부만 교체

### 분해 맵

```
useKeyManager.ts (현재 1,531줄)
│
├─→ editor/model/keys.ts (Phase 1에서 생성)
│     handleAddKey         → addKey()
│     handleAddKeyAt       → addKey({ dx, dy })
│     handleDuplicateKey   → duplicateKey()
│     handleKeyUpdate      → updateKeyStyle()
│     handleKeyMappingChange → updateKeyMapping()
│     handleKeyStyleUpdate → updateKeyStyle()
│     handleKeyBatchStyleUpdate → batchUpdateKeyStyle()
│     handleNoteColorUpdate → updateKeyStyle() (노트 필드)
│     handleCounterSettings → updateKeyStyle() (카운터 필드)
│     handleKeyPreview     → updateKeyStyle() (프리뷰 플래그)
│     handleKeyBatchPreview → batchUpdateKeyStyle()
│
├─→ editor/model/zOrder.ts (Phase 1에서 생성)
│     handleMoveToFront    → moveItemToFront()
│     handleMoveToBack     → moveItemToBack()
│     handleMoveForward    → moveItemForward()
│     handleMoveBackward   → moveItemBackward()
│
├─→ editor/runtime/ (Phase 2에서 생성)
│     히스토리 저장         → runEditorTransaction()
│     undo/redo            → applyEditorSnapshot()
│     API 동기화            → persistEditorState()
│     플러그인 복원         → restorePluginElements()
│
└─→ useKeyManager.ts (리팩토링 후 ~200줄)
      - selectedKey 로컬 상태
      - 각 handler = 검증 + model 함수 + runtime 트랜잭션 조합
      - 외부 반환 인터페이스 유지
```

### 리팩토링 후 useKeyManager 예시

```typescript
// hooks/useKeyManager.ts — 리팩토링 후

import { useState } from 'react';
import { useKeyStore } from '@stores/data/useKeyStore';
import * as keyModel from '@editor/model/keys';
import * as zOrderModel from '@editor/model/zOrder';
import { runEditorTransaction } from '@editor/runtime/editorTransaction';

export function useKeyManager() {
  const selectedKeyType = useKeyStore((s) => s.selectedKeyType);
  const [selectedKey, setSelectedKey] = useState<SelectedKey>(null);

  const handleAddKey = () => {
    runEditorTransaction(
      () => keyModel.addKey(/* 현재 상태 */, selectedKeyType),
      (result) => ({ keyMappings: result.mappings, positions: result.positions }),
    );
  };

  const handleMoveToFront = (index: number) => {
    runEditorTransaction(
      () => zOrderModel.moveItemToFront(/* 현재 positions */, index),
      (result) => ({ positions: result }),
    );
  };

  // ... 나머지 핸들러도 동일 패턴

  return {
    selectedKey, setSelectedKey,
    handleAddKey, handleMoveToFront, /* ... */
  };
}
```

### Phase 3 체크리스트

- [ ] useKeyManager의 각 handler에서 "상태 계산부"를 editor/model 함수로 교체
- [ ] 히스토리/API 동기화를 runEditorTransaction으로 교체
- [ ] undo/redo 로직을 editor/runtime으로 이동
- [ ] useKeyManager가 ~200줄 이하인지 확인
- [ ] 기존 동작 회귀 테스트

---

## 6. Phase 4 — Grid.tsx 분해

> **목표**: 3,054줄 → ~300줄 orchestration shell
> **전략**: 컴포넌트 분리보다 "행동 단위 훅"을 먼저 분리

### 6-1. 훅 분리

| 신규 훅 | 책임 | 추출 대상 |
|---------|------|----------|
| `useGridCanvasActions` | add/delete/duplicate/move/z-order/group | Grid 내 액션 핸들러들 |
| `useGridContextActions` | 컨텍스트 메뉴용 액션 조립 | 우클릭 메뉴 로직 |
| `useGridModalState` | KeySetting/CSS/Note 모달 상태 | 모달 open/close 상태 |
| `useGridSceneData` | 렌더용 view model 계산 | key/stat/graph/plugin 목록 계산 |

### 6-2. 컴포넌트 분리

```
Grid.tsx (현재 3,054줄)
│
├─→ Grid.tsx (~300줄) — orchestration shell
│     훅 조합, 자식 컴포넌트 배치, 이벤트 wiring
│
├─→ GridScene.tsx (~400줄)
│     키/스탯/그래프/플러그인 요소 실제 렌더링
│     DraggableKey, GraphItem, StatItem, PluginElement 배치
│
├─→ GridOverlays.tsx (~200줄)
│     MarqueeSelectionOverlay, SmartGuidesOverlay
│     ResizeHandles, GroupResizeHandles
│     GridMinimap, GridBackground
│
└─→ GridModalHost.tsx (~150줄)
      UnifiedKeySetting, TabCssModal, TabNoteSettingModal
      ListPopup (컨텍스트 메뉴)
```

### 6-3. GridProps 축소

현재 30+ props → **Grid 자체는 최소 props만 받음**:

```typescript
// 리팩토링 후
interface GridProps {
  showConfirm: ConfirmFn;
  showAlert: AlertFn;
  activeTool: string;
  color: string;
}

// 나머지는 내부 훅에서 store 직접 접근
// useGridCanvasActions → useKeyStore, useStatItemStore 등
// useGridModalState → 로컬 상태로 관리
```

### Phase 4 체크리스트

- [ ] `useGridCanvasActions` 훅 추출
- [ ] `useGridContextActions` 훅 추출
- [ ] `useGridModalState` 훅 추출
- [ ] `useGridSceneData` 훅 추출
- [ ] `GridScene.tsx` 컴포넌트 분리
- [ ] `GridOverlays.tsx` 컴포넌트 분리
- [ ] `GridModalHost.tsx` 컴포넌트 분리
- [ ] Grid.tsx가 ~300줄 이하인지 확인
- [ ] GridProps가 10개 이하인지 확인

---

## 7. Phase 5 — LayerTabContent / PropertiesPanel 정리

### 7-1. LayerTabContent (2,971줄) 분해

```
LayerTabContent.tsx (현재 2,971줄)
│
├─→ hooks/Grid/useLayerTreeModel.ts
│     레이어 아이템 목록 구성, 그룹 트리 계산
│     DisplayItem[], GroupHeaderItem 생성
│
├─→ hooks/Grid/useLayerDnD.ts
│     드래그 앤 드롭 정렬 로직
│     sortable 상태, drop handler
│
├─→ hooks/Grid/useLayerCommands.ts
│     가시성/잠금 토글, 이름 변경, 삭제
│     editor/runtime 트랜잭션 사용
│
├─→ LayerGroupHeader.tsx
│     그룹 헤더 렌더링, 접기/펼치기
│
├─→ LayerItemRow.tsx
│     개별 레이어 아이템 렌더링
│
└─→ LayerTabContent.tsx (~300줄)
      훅 조합 + 목록 렌더링
```

### 7-2. PropertiesPanel (2,450줄) 개선

이미 분리 진행 중 (SingleSelectionPanel, BatchSelectionPanel 등). 추가 작업:

```
PropertiesPanel.tsx (현재 2,450줄)
│
├─→ hooks/Grid/useSelectionInterpreter.ts (신규)
│     선택 상태 해석: 어떤 타입이 선택됐는지, 단일/배치인지
│     현재 PropertiesPanel 상단의 선택 분기 로직
│
├─→ application/selectionCommands.ts (신규)
│     stat/graph/key/plugin 배치 update 디스패치
│     현재 PropertiesPanel에 분산된 업데이트 로직
│
└─→ PropertiesPanel.tsx (~400줄)
      선택 해석 결과에 따라 적절한 패널 렌더
```

### Phase 5 체크리스트

- [ ] `useLayerTreeModel` 훅 추출
- [ ] `useLayerDnD` 훅 추출
- [ ] `useLayerCommands` 훅 추출
- [ ] `LayerGroupHeader`, `LayerItemRow` 컴포넌트 분리
- [ ] `useSelectionInterpreter` 훅 추출
- [ ] LayerTabContent가 ~400줄 이하인지 확인
- [ ] PropertiesPanel이 ~400줄 이하인지 확인

---

## 8. Phase 6 — 코드 위생 및 훅 안정화

### 8-1. console.* 정리 (253건 → 0)

```typescript
// utils/logger.ts — 신규

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const logger = {
  debug: (...args: unknown[]) => {
    if (import.meta.env.DEV) console.log('[DEBUG]', ...args);
  },
  info: (...args: unknown[]) => {
    if (import.meta.env.DEV) console.info('[INFO]', ...args);
  },
  warn: (...args: unknown[]) => console.warn('[WARN]', ...args),
  error: (...args: unknown[]) => console.error('[ERROR]', ...args),
};

export default logger;
```

- console.log → `logger.debug` (개발 빌드에서만 출력)
- console.warn → `logger.warn`
- console.error → `logger.error`
- ESLint rule 추가: `no-console` (warn → error)

### 8-2. eslint-disable 해소 (35건)

| 패턴 | 건수 | 해결 방향 |
|------|------|----------|
| `set-state-in-effect` | 12 | 파생값 계산, reducer, signal 분리 |
| `exhaustive-deps` | 6 | stable callback 패턴, useEffectEvent 검토 |
| `refs` | 6 | ref 접근 패턴 정리 |
| `purity` | 3 | 의도적 패턴이면 라인별 이유 주석 추가 |
| `immutability` | 2 | 뮤테이션 제거 또는 이유 주석 |

**원칙**: 파일 상단 일괄 disable → 해당 라인 + 이유 주석으로 전환

### 8-3. useGridZoomPan 훅 안정화

현재 문제: 의존성 배열 없는 useEffect → 매 렌더마다 이벤트 리스너 재등록

```typescript
// 현재 (문제)
useEffect(() => {
  container.addEventListener('wheel', handleWheel, { passive: false });
  return () => container.removeEventListener('wheel', handleWheel);
}); // ← 의존성 배열 없음

// 개선안 1: useEffectEvent 패턴 (React 19+)
const onWheel = useEffectEvent(handleWheel);
useEffect(() => {
  container.addEventListener('wheel', onWheel, { passive: false });
  return () => container.removeEventListener('wheel', onWheel);
}, []);

// 개선안 2: stable ref 패턴 (현재 React 버전 호환)
const handleWheelRef = useRef(handleWheel);
handleWheelRef.current = handleWheel;

useEffect(() => {
  const handler = (e: WheelEvent) => handleWheelRef.current(e);
  container.addEventListener('wheel', handler, { passive: false });
  return () => container.removeEventListener('wheel', handler);
}, []);
```

- matchesShortcut 함수 → 모듈 레벨 또는 stable ref로 분리
- handleMiddleMouseDown, handleKeyDown 동일 패턴 적용

### 8-4. useSettingsStore 정리 (후순위)

```typescript
// 현재: 25+ 개별 setter
setHardwareAcceleration: (value) => set({ hardwareAcceleration: value }),
setAlwaysOnTop: (value) => set({ alwaysOnTop: value }),
// ... 23개 더

// 개선: generic setter
setSetting: <K extends keyof SettingsStateSnapshot>(
  key: K,
  value: SettingsStateSnapshot[K],
) => set({ [key]: value }),

// 도메인 슬라이스 분리 (선택)
// useNoteSettingsSlice, useFontSettingsSlice 등
```

### Phase 6 체크리스트

- [ ] `utils/logger.ts` 생성
- [ ] console.* → logger 일괄 교체
- [ ] ESLint `no-console` 규칙 추가
- [ ] eslint-disable 파일별 원인 분류 및 해소/주석 추가
- [ ] useGridZoomPan useEffect 의존성 안정화
- [ ] useSettingsStore generic setter 도입 (선택)
- [ ] `npx tsc --noEmit` 통과 확인
- [ ] `npm run lint` 통과 확인

---

## 9. 리스크 및 주의사항

### 높은 리스크

| 리스크 | 설명 | 대응 |
|--------|------|------|
| **플러그인 요소 복원** | undo/redo 시 단순 상태가 아닌 핸들러 복원 필요. restorePluginElements를 별도 보존해야 함 | Phase 2에서 별도 모듈로 격리, 충분한 테스트 |
| **인덱스 기반 참조 불안정** | `key-{index}` 형태의 ID로 삭제/정렬 시 selection이 틀어질 수 있음 | "UI 식별자 ↔ 현재 인덱스 해석"을 한곳에 격리 |
| **stale closure** | 훅 분해 시 클로저가 이전 상태를 참조할 수 있음 | useRef + stable callback 패턴 활용 |
| **비동기 persist 실패** | 로컬 반영 후 API 호출 실패 시 불일치 | 에러 시 토스트 표시, 롤백 정책 검토 |

### 중간 리스크

| 리스크 | 설명 | 대응 |
|--------|------|------|
| **React Compiler 호환** | 훅 분리 시 컴파일러 최적화가 깨질 수 있음 | 분리 후 `'use no memo'` 필요 여부 확인 |
| **히스토리 이중 체계** | snapshot + command를 섞으면 혼란 | snapshot 모델 유지, command 패턴은 미래 요구사항 발생 시 도입 |
| **eslint-disable 제거 부작용** | disable 제거 시 린트 자동 수정이 의도적 패턴을 덮어쓸 수 있음 | 변경 전후 동작 확인 |

### 절대 하지 않을 것

- undo/redo를 command 패턴으로 전면 교체하지 않음 (현재 스냅샷 모델 유지)
- 인덱스 기반 참조를 안정 ID로 전면 교체하지 않음 (격리만)
- feature slice 폴더 재구성하지 않음 (현재 구조 유지하면서 editor/ 만 추가)

---

## 10. 마이그레이션 원칙

### 안전한 단계별 접근

```
Phase 1 → 2 → 3 → 4 → 5 → 6
  ↓        ↓      ↓      ↓      ↓      ↓
신규 추가  신규 추가  교체   분리   분리   정리
(무위험)  (무위험) (중위험) (중위험) (중위험) (저위험)
```

1. **Phase 1~2는 기존 코드 변경 없이 신규 파일만 추가**
   - 실패해도 삭제하면 원복
   - 병렬 구조로 먼저 검증 가능

2. **Phase 3부터 기존 코드 교체 시작**
   - 각 handler를 하나씩 교체 (Big Bang 금지)
   - 교체할 때마다 동작 확인

3. **각 Phase 완료 시 체크**
   - `npx tsc --noEmit` 통과
   - `npm run lint` 통과
   - `npm run format` 실행
   - 수동 동작 테스트 (키 추가/삭제/undo/redo/프리뷰)

### 커밋 전략

```
refactor: editor/model 순수 함수 추출 (Phase 1)
refactor: editor/runtime 트랜잭션 실행기 도입 (Phase 2)
refactor: useKeyManager CRUD 로직을 editor/model로 이동 (Phase 3-1)
refactor: useKeyManager undo/redo를 editor/runtime으로 이동 (Phase 3-2)
refactor: useKeyManager z-order를 editor/model로 이동 (Phase 3-3)
refactor: Grid.tsx 훅 분리 (Phase 4-1)
refactor: Grid.tsx 컴포넌트 분리 (Phase 4-2)
...
```

- Phase당 여러 커밋으로 분리
- 각 커밋은 독립적으로 동작 가능해야 함
- revert가 쉽도록 작은 단위로 커밋

---

## 부록: 현실적 대안

만약 editor/ 레이어 도입이 과도하다고 판단되면, **최소 버전**으로:

1. `utils/editor/` 하위에 순수 함수만 추출 (model 역할)
2. `hooks/useEditorTransaction.ts` 하나에 트랜잭션 로직 통합
3. useKeyManager → 함수 조립만 남김

이것만으로도 **useKeyManager 1,531줄 → ~200줄** 축소와 **도메인 로직 단일 진입점** 확보가 가능합니다.
