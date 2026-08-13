import { create } from 'zustand';
import type { KeyPosition, KeySlot } from '@src/types/key/keys';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import type { StatItemPosition } from '@src/types/key/statItems';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';
import { stableStringify } from '@utils/core/stableStringify';
import { isSyntheticElementId } from '@src/renderer/editor/model/elementIdMap';

export type SelectableElementType =
  | 'key'
  | 'stat'
  | 'graph'
  | 'knob'
  | 'plugin';

export type IndexedSelectableElementType = Exclude<
  SelectableElementType,
  'plugin'
>;

export interface IndexedElementArrays {
  keyMappings: readonly unknown[];
  keyPositions: readonly unknown[];
  stat: readonly unknown[];
  graph: readonly unknown[];
  knob: readonly unknown[];
}

export interface SelectedElement {
  type: SelectableElementType;
  // 네이티브 요소는 position.id(UUID). backfill 전 데이터만 "type-{index}" 폴백.
  // plugin은 fullId
  id: string;
  // canonical에서 파생된 locator 캐시. 신원이 아니다 - 문서 적용 시 id로 재계산된다
  index?: number;
}

// 선택 id 생성의 단일 지점. 신원은 요소 안의 UUID이고, 합성 문자열은
// id가 아직 없는 구형 데이터를 위한 폴백일 뿐이다
export const selectionElementId = (
  type: IndexedSelectableElementType,
  position: { id?: string } | undefined,
  index: number,
): string => position?.id || `${type}-${index}`;

// 클립보드에 저장되는 키 데이터
export interface ClipboardKeyData {
  type: 'key';
  keyCode: KeySlot;
  position: KeyPosition;
}

// 클립보드에 저장되는 통계 요소 데이터
export interface ClipboardStatData {
  type: 'stat';
  position: StatItemPosition;
}

// 클립보드에 저장되는 그래프 데이터
export interface ClipboardGraphData {
  type: 'graph';
  position: GraphItemPosition;
}

// 클립보드에 저장되는 노브 데이터
export interface ClipboardKnobData {
  type: 'knob';
  position: KnobItemPosition;
}

// 클립보드에 저장되는 플러그인 요소 데이터
export interface ClipboardPluginData {
  type: 'plugin';
  element: Omit<PluginDisplayElementInternal, 'fullId'>;
}

export type ClipboardItem =
  | ClipboardKeyData
  | ClipboardStatData
  | ClipboardGraphData
  | ClipboardKnobData
  | ClipboardPluginData;

interface GridSelectionState {
  // 선택된 요소들
  selectedElements: SelectedElement[];
  // 명시적으로 선택된 그룹 ID들 (그룹 헤더 클릭으로 선택된 경우)
  selectedGroupIds: string[];

  // 마지막으로 선택된 키의 좌표 (Shift+클릭 범위 선택용)
  lastSelectedKeyBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;

  // 클립보드 (복사된 요소들)
  clipboard: ClipboardItem[];
  // 클립보드에 포함된 그룹 정보 (그룹 헤더 선택 후 복사 시)
  clipboardGroups: { id: string; name: string; collapsed?: boolean }[];

  // 마퀴 선택 상태
  isMarqueeSelecting: boolean;
  marqueeStart: { x: number; y: number } | null;
  marqueeEnd: { x: number; y: number } | null;

  // 미들 버튼 드래그 상태
  isMiddleButtonDragging: boolean;

  // 드래그/리사이즈 중인 상태 (CSS 애니메이션 비활성화용)
  isDraggingOrResizing: boolean;

  // 키보드 동작(paste 등)에서 선택 변경 시 패널 모드 전환 건너뛰기
  _skipPanelModeSwitch: boolean;

  // 액션
  selectElement: (element: SelectedElement, addToSelection?: boolean) => void;
  toggleSelection: (element: SelectedElement) => void;
  deselectElement: (id: string) => void;
  clearSelection: () => void;
  setSelectedElements: (elements: SelectedElement[]) => void;
  setFullSelection: (elements: SelectedElement[], groupIds: string[]) => void;
  isSelected: (id: string) => boolean;
  setLastSelectedKeyBounds: (
    bounds: { x: number; y: number; width: number; height: number } | null,
  ) => void;

  // 클립보드 Actions
  setClipboard: (
    items: ClipboardItem[],
    groups?: { id: string; name: string; collapsed?: boolean }[],
  ) => void;
  clearClipboard: () => void;

  // 마퀴 선택 Actions
  startMarqueeSelection: (x: number, y: number) => void;
  updateMarqueeSelection: (x: number, y: number) => void;
  endMarqueeSelection: () => void;

  // 미들 버튼 드래그 Actions
  setMiddleButtonDragging: (isDragging: boolean) => void;

  // 드래그/리사이즈 상태 설정
  setDraggingOrResizing: (isDragging: boolean) => void;

  // 패널 모드 전환 건너뛰기 설정
  setSkipPanelModeSwitch: (skip: boolean) => void;

  // 선택된 요소들 일괄 이동
  moveSelectedElements: (deltaX: number, deltaY: number) => void;
}

export const useGridSelectionStore = create<GridSelectionState>((set, get) => ({
  selectedElements: [],
  selectedGroupIds: [],
  lastSelectedKeyBounds: null,
  clipboard: [],
  clipboardGroups: [],
  isMarqueeSelecting: false,
  marqueeStart: null,
  marqueeEnd: null,
  isMiddleButtonDragging: false,
  isDraggingOrResizing: false,
  _skipPanelModeSwitch: false,

  selectElement: (element, addToSelection = false) => {
    set((state) => {
      if (addToSelection) {
        const existingIndex = state.selectedElements.findIndex(
          (el) => el.id === element.id,
        );
        if (existingIndex >= 0) {
          return {
            selectedElements: state.selectedElements.filter(
              (el) => el.id !== element.id,
            ),
            selectedGroupIds: [],
          };
        }
        return {
          selectedElements: [...state.selectedElements, element],
          selectedGroupIds: [],
        };
      }
      return {
        selectedElements: [element],
        selectedGroupIds: [],
      };
    });
  },

  toggleSelection: (element) => {
    set((state) => {
      const existingIndex = state.selectedElements.findIndex(
        (el) => el.id === element.id,
      );
      if (existingIndex >= 0) {
        return {
          selectedElements: state.selectedElements.filter(
            (el) => el.id !== element.id,
          ),
          selectedGroupIds: [],
        };
      }
      return {
        selectedElements: [...state.selectedElements, element],
        selectedGroupIds: [],
      };
    });
  },

  deselectElement: (id) => {
    set((state) => ({
      selectedElements: state.selectedElements.filter((el) => el.id !== id),
      selectedGroupIds: [],
    }));
  },

  clearSelection: () => {
    set({ selectedElements: [], selectedGroupIds: [] });
  },

  setSelectedElements: (elements) => {
    set((state) => {
      // 논리적으로 같은 선택이면 참조를 유지해 구독자 리렌더 방지
      const same =
        state.selectedElements.length === elements.length &&
        state.selectedElements.every((el, i) => {
          const next = elements[i];
          return (
            el.type === next.type &&
            el.id === next.id &&
            el.index === next.index
          );
        });
      if (same && state.selectedGroupIds.length === 0) return {};
      return {
        selectedElements: same ? state.selectedElements : elements,
        selectedGroupIds: [],
      };
    });
  },

  setFullSelection: (elements, groupIds) => {
    set({ selectedElements: elements, selectedGroupIds: groupIds });
  },

  isSelected: (id) => {
    return get().selectedElements.some((el) => el.id === id);
  },

  setLastSelectedKeyBounds: (bounds) => {
    set({ lastSelectedKeyBounds: bounds });
  },

  setClipboard: (items, groups) => {
    set({ clipboard: items, clipboardGroups: groups || [] });
  },

  clearClipboard: () => {
    set({ clipboard: [], clipboardGroups: [] });
  },

  startMarqueeSelection: (x, y) => {
    set({
      isMarqueeSelecting: true,
      marqueeStart: { x, y },
      marqueeEnd: { x, y },
    });
  },

  updateMarqueeSelection: (x, y) => {
    set({ marqueeEnd: { x, y } });
  },

  endMarqueeSelection: () => {
    set({
      isMarqueeSelecting: false,
      marqueeStart: null,
      marqueeEnd: null,
    });
  },

  setMiddleButtonDragging: (isDragging) => {
    set({ isMiddleButtonDragging: isDragging });
  },

  setDraggingOrResizing: (isDragging) => {
    set({ isDraggingOrResizing: isDragging });
  },

  setSkipPanelModeSwitch: (skip) => {
    set({ _skipPanelModeSwitch: skip });
  },

  moveSelectedElements: (_deltaX, _deltaY) => {
    // 실제 이동 로직은 Grid 컴포넌트에서 처리
    // 이 함수는 외부에서 호출될 콜백을 위한 placeholder
  },
}));

export function reconcileSelectionAfterIndexedElementDeletion(
  elementType: IndexedSelectableElementType,
  indexToDelete: number,
) {
  const selection = useGridSelectionStore.getState();
  let changed = false;
  const selectedElements = selection.selectedElements.flatMap((element) => {
    if (element.type !== elementType || typeof element.index !== 'number') {
      return [element];
    }
    if (element.index === indexToDelete) {
      changed = true;
      return [];
    }
    if (element.index < indexToDelete) return [element];

    // 신원(id)은 그대로, locator(index)만 한 칸 당긴다.
    // UUID id는 유지되고 합성 폴백 id만 새 index로 재작성된다
    changed = true;
    const index = element.index - 1;
    const id =
      element.id === `${elementType}-${element.index}`
        ? `${elementType}-${index}`
        : element.id;
    return [{ ...element, id, index }];
  });

  if (changed) selection.setSelectedElements(selectedElements);
}

export function invalidateSelectionForChangedIndexedElementArrays(
  current: IndexedElementArrays,
  next: IndexedElementArrays,
) {
  // id는 신원이지 값이 아니다. 이 경계 탐지는 "값이 같으면 같은 요소"라는
  // 단계 5 이전의 근사를 유지하므로 id를 지문에서 뺀다 - 넣으면 값이 동일한
  // 요소의 id 재발급만으로 앞쪽 선택이 무효화된다
  const withoutElementId = (item: unknown): unknown => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return item;
    }
    const { id: _id, ...rest } = item as { id?: unknown };
    return rest;
  };

  const firstDifferentIndex = (
    currentItems: readonly unknown[],
    nextItems: readonly unknown[],
  ) => {
    const sharedLength = Math.min(currentItems.length, nextItems.length);
    for (let index = 0; index < sharedLength; index += 1) {
      if (
        stableStringify(withoutElementId(currentItems[index])) !==
        stableStringify(withoutElementId(nextItems[index]))
      ) {
        return index;
      }
    }
    return sharedLength;
  };

  const boundaries = new Map<IndexedSelectableElementType, number>();
  if (current.keyMappings.length !== next.keyMappings.length) {
    boundaries.set(
      'key',
      firstDifferentIndex(current.keyMappings, next.keyMappings),
    );
  }
  if (current.keyPositions.length !== next.keyPositions.length) {
    const positionBoundary = firstDifferentIndex(
      current.keyPositions,
      next.keyPositions,
    );
    boundaries.set(
      'key',
      Math.min(boundaries.get('key') ?? positionBoundary, positionBoundary),
    );
  }
  for (const elementType of ['stat', 'graph', 'knob'] as const) {
    if (current[elementType].length !== next[elementType].length) {
      boundaries.set(
        elementType,
        firstDifferentIndex(current[elementType], next[elementType]),
      );
    }
  }
  const selection = useGridSelectionStore.getState();
  if (selection.selectedElements.length === 0) return;

  const nextPositionsFor = (
    type: IndexedSelectableElementType,
  ): readonly { id?: string }[] =>
    (type === 'key' ? next.keyPositions : next[type]) as readonly {
      id?: string;
    }[];

  let changed = false;
  const selectedElements = selection.selectedElements.flatMap((element) => {
    if (element.type === 'plugin') return [element];

    // 신원 id를 가진 선택은 id로 재조정한다: 살아 있으면 index만 갱신,
    // 사라졌으면 제거. 재정렬돼도 선택은 같은 요소를 따라간다
    if (!isSyntheticElementId(element.id)) {
      const nextPositions = nextPositionsFor(element.type);
      const newIndex = nextPositions.findIndex(
        (position) => position?.id === element.id,
      );
      if (newIndex !== -1) {
        if (newIndex !== element.index) {
          changed = true;
          return [{ ...element, index: newIndex }];
        }
        return [element];
      }

      // id가 사라졌어도 그 타입에 구조 경계가 없으면 요소는 그대로이고 신원만
      // 재발급된 것이다 (탭 프리셋 rekey, v1 어댑터 재발급) - 자리로 재채택한다
      const rekeyed =
        boundaries.get(element.type) === undefined &&
        typeof element.index === 'number'
          ? nextPositions[element.index]?.id
          : undefined;
      if (rekeyed !== undefined) {
        changed = true;
        return [{ ...element, id: rekeyed }];
      }
      changed = true;
      return [];
    }

    // 합성 id 폴백 (backfill 전 데이터): 기존 경계 휴리스틱 유지
    const boundary = boundaries.get(element.type);
    if (boundary === undefined) return [element];
    if (typeof element.index === 'number' && element.index < boundary) {
      return [element];
    }
    changed = true;
    return [];
  });

  if (changed) selection.setSelectedElements(selectedElements);
}

/**
 * 마퀴 영역 계산 헬퍼
 */
export function getMarqueeRect(
  start: { x: number; y: number } | null,
  end: { x: number; y: number } | null,
): { left: number; top: number; width: number; height: number } | null {
  if (!start || !end) return null;

  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  return { left, top, width, height };
}

/**
 * 요소가 마퀴 영역 내에 있는지 확인
 */
export function isElementInMarquee(
  elementBounds: { x: number; y: number; width: number; height: number },
  marqueeRect: { left: number; top: number; width: number; height: number },
): boolean {
  const elementRight = elementBounds.x + elementBounds.width;
  const elementBottom = elementBounds.y + elementBounds.height;
  const marqueeRight = marqueeRect.left + marqueeRect.width;
  const marqueeBottom = marqueeRect.top + marqueeRect.height;

  // 교차 여부 확인
  return !(
    elementBounds.x > marqueeRight ||
    elementRight < marqueeRect.left ||
    elementBounds.y > marqueeBottom ||
    elementBottom < marqueeRect.top
  );
}
