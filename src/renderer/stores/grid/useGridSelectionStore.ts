import { create } from 'zustand';
import type { KeyPosition, KeySlot } from '@src/types/key/keys';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import type { StatItemPosition } from '@src/types/key/statItems';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';
import type { ReactiveSpritePosition } from '@src/types/key/sprites';
import type { CanonicalEditorDocumentV1 } from '@src/types/editor';

export type SelectableElementType =
  | 'key'
  | 'stat'
  | 'graph'
  | 'knob'
  | 'sprite'
  | 'plugin';

export type IndexedSelectableElementType = Exclude<
  SelectableElementType,
  'plugin'
>;

export interface IndexedElementArrays {
  keyMappings: readonly unknown[];
  keyPositions: readonly CanonicalEditorDocumentV1['keyPositions'][string][number][];
  stat: readonly CanonicalEditorDocumentV1['statPositions'][string][number][];
  graph: readonly CanonicalEditorDocumentV1['graphPositions'][string][number][];
  knob: readonly CanonicalEditorDocumentV1['knobPositions'][string][number][];
  sprite: readonly CanonicalEditorDocumentV1['spritePositions'][string][number][];
}

type NativeSelectedElement = {
  [Type in IndexedSelectableElementType]: {
    type: Type;
    id: string;
    // canonical에서 파생된 locator 캐시. 신원이 아니다 - 문서 적용 시 id로 재계산된다
    index?: number;
  };
}[IndexedSelectableElementType];

interface PluginSelectedElement {
  type: 'plugin';
  id: string;
  index?: never;
}

export type SelectedElement = NativeSelectedElement | PluginSelectedElement;

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

// 클립보드에 저장되는 스프라이트 데이터
export interface ClipboardSpriteData {
  type: 'sprite';
  position: ReactiveSpritePosition;
  // 복사 시점의 트리거 -> canonical 키. 다른 탭에 붙일 때 같은 키로 다시 결합한다
  triggerCanonicals?: Record<string, string>;
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
  | ClipboardSpriteData
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
  // 복사한 모드. 탭을 옮겨 붙여넣는지 판정한다 - 요소 id는 문서 전역 유일이라
  // 다른 탭에서는 스프라이트 자세 트리거가 절대 해석되지 않는다
  clipboardMode: string | null;

  // 마퀴 선택 상태
  isMarqueeSelecting: boolean;
  marqueeStart: { x: number; y: number } | null;
  marqueeEnd: { x: number; y: number } | null;

  // 미들 버튼 드래그 상태
  isMiddleButtonDragging: boolean;

  // 드래그/리사이즈 중인 상태 (CSS 애니메이션 비활성화용)
  isDraggingOrResizing: boolean;

  // 리사이즈 중인 상태 (이동 합성 레이어와 분리)
  isResizing: boolean;

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
    mode?: string | null,
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
  setResizing: (isResizing: boolean) => void;

  // 선택된 요소들 일괄 이동
  moveSelectedElements: (deltaX: number, deltaY: number) => void;
}

export const selectGridTransformLayerPromotion = (state: {
  isDraggingOrResizing: boolean;
  isResizing: boolean;
}): boolean => state.isDraggingOrResizing && !state.isResizing;

export const useGridSelectionStore = create<GridSelectionState>((set, get) => ({
  selectedElements: [],
  selectedGroupIds: [],
  lastSelectedKeyBounds: null,
  clipboard: [],
  clipboardGroups: [],
  clipboardMode: null,
  isMarqueeSelecting: false,
  marqueeStart: null,
  marqueeEnd: null,
  isMiddleButtonDragging: false,
  isDraggingOrResizing: false,
  isResizing: false,

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

  setClipboard: (items, groups, mode) => {
    set({
      clipboard: items,
      clipboardGroups: groups || [],
      clipboardMode: mode ?? null,
    });
  },

  clearClipboard: () => {
    set({ clipboard: [], clipboardGroups: [], clipboardMode: null });
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
    set({ isDraggingOrResizing: isDragging, isResizing: false });
  },

  setResizing: (isResizing) => {
    set({ isDraggingOrResizing: isResizing, isResizing });
  },

  moveSelectedElements: (_deltaX, _deltaY) => {
    // 실제 이동 로직은 Grid 컴포넌트에서 처리
    // 이 함수는 외부에서 호출될 콜백을 위한 placeholder
  },
}));

export function invalidateSelectionForChangedIndexedElementArrays(
  _current: IndexedElementArrays,
  next: IndexedElementArrays,
) {
  const selection = useGridSelectionStore.getState();
  if (selection.selectedElements.length === 0) return;

  const nextPositionsFor = (
    type: IndexedSelectableElementType,
  ): readonly { id: string }[] =>
    type === 'key' ? next.keyPositions : next[type];

  let changed = false;
  const selectedElements = selection.selectedElements.reduce<SelectedElement[]>(
    (resolved, element) => {
      if (element.type === 'plugin') {
        resolved.push(element);
        return resolved;
      }

      const newIndex = nextPositionsFor(element.type).findIndex(
        (position) => position?.id === element.id,
      );
      if (newIndex === -1) {
        changed = true;
        return resolved;
      }
      if (newIndex !== element.index) {
        changed = true;
        resolved.push({ ...element, index: newIndex });
        return resolved;
      }
      resolved.push(element);
      return resolved;
    },
    [],
  );

  if (changed) selection.setSelectedElements(selectedElements);
}

// 재주입으로 fullId가 갈린 플러그인 선택 제거. 현존 fullId 집합 기준.
// ownerPluginId를 주면 그 플러그인 소유 선택만 판정한다 - 스토어는 전
// 플러그인 공용이라, 리로드 공백(요소가 잠시 비는 창)에 있는 다른 플러그인의
// 정당한 선택까지 죽은 것으로 보고 지우는 것을 막는다
export function pruneStalePluginSelection(
  liveFullIds: ReadonlySet<string>,
  ownerPluginId?: string,
) {
  const selection = useGridSelectionStore.getState();
  if (selection.selectedElements.length === 0) return;
  // 표시 요소 fullId는 `${pluginId}::${id}`다. pluginId에는 콜론이 들어갈 수
  // 없으므로(백엔드 validate_plugin_id: 영숫자·하이픈·언더스코어) 콜론 1개
  // 접두사로 충분하고, plugin-a ↔ plugin-ab 오탐도 막힌다
  const ownedByPull = (fullId: string) =>
    ownerPluginId === undefined || fullId.startsWith(`${ownerPluginId}:`);
  const kept = selection.selectedElements.filter(
    (element) =>
      element.type !== 'plugin' ||
      !ownedByPull(element.id) ||
      liveFullIds.has(element.id),
  );
  if (kept.length === selection.selectedElements.length) return;
  selection.setSelectedElements(kept);
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
