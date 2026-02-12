import { create } from "zustand";
import type { KeyPosition } from "@src/types/keys";
import type { PluginDisplayElementInternal } from "@src/types/api";
import type { StatItemPosition } from "@src/types/statItems";
import type { GraphItemPosition } from "@src/types/graphItems";

export type SelectableElementType = "key" | "stat" | "graph" | "plugin";

export interface SelectedElement {
  type: SelectableElementType;
  id: string; // key의 경우 "key-{index}", plugin의 경우 fullId
  index?: number; // key인 경우 인덱스
}

// 클립보드에 저장되는 키 데이터
export interface ClipboardKeyData {
  type: "key";
  keyCode: string;
  position: KeyPosition;
}

// 클립보드에 저장되는 통계 요소 데이터
export interface ClipboardStatData {
  type: "stat";
  position: StatItemPosition;
}

// 클립보드에 저장되는 그래프 데이터
export interface ClipboardGraphData {
  type: "graph";
  position: GraphItemPosition;
}

// 클립보드에 저장되는 플러그인 요소 데이터
export interface ClipboardPluginData {
  type: "plugin";
  element: Omit<PluginDisplayElementInternal, "fullId">;
}

export type ClipboardItem =
  | ClipboardKeyData
  | ClipboardStatData
  | ClipboardGraphData
  | ClipboardPluginData;

interface GridSelectionState {
  // 선택된 요소들
  selectedElements: SelectedElement[];

  // 마지막으로 선택된 키의 좌표 (Shift+클릭 범위 선택용)
  lastSelectedKeyBounds: { x: number; y: number; width: number; height: number } | null;

  // 클립보드 (복사된 요소들)
  clipboard: ClipboardItem[];

  // 마퀴 선택 상태
  isMarqueeSelecting: boolean;
  marqueeStart: { x: number; y: number } | null;
  marqueeEnd: { x: number; y: number } | null;

  // 미들 버튼 드래그 상태
  isMiddleButtonDragging: boolean;

  // 드래그/리사이즈 중인 상태 (CSS 애니메이션 비활성화용)
  isDraggingOrResizing: boolean;

  // Actions
  selectElement: (element: SelectedElement, addToSelection?: boolean) => void;
  toggleSelection: (element: SelectedElement) => void;
  deselectElement: (id: string) => void;
  clearSelection: () => void;
  setSelectedElements: (elements: SelectedElement[]) => void;
  isSelected: (id: string) => boolean;
  setLastSelectedKeyBounds: (bounds: { x: number; y: number; width: number; height: number } | null) => void;

  // 클립보드 Actions
  setClipboard: (items: ClipboardItem[]) => void;
  clearClipboard: () => void;

  // 마퀴 선택 Actions
  startMarqueeSelection: (x: number, y: number) => void;
  updateMarqueeSelection: (x: number, y: number) => void;
  endMarqueeSelection: () => void;

  // 미들 버튼 드래그 Actions
  setMiddleButtonDragging: (isDragging: boolean) => void;

  // 드래그/리사이즈 상태 설정
  setDraggingOrResizing: (isDragging: boolean) => void;

  // 선택된 요소들 일괄 이동
  moveSelectedElements: (deltaX: number, deltaY: number) => void;
}

export const useGridSelectionStore = create<GridSelectionState>((set, get) => ({
  selectedElements: [],
  lastSelectedKeyBounds: null,
  clipboard: [],
  isMarqueeSelecting: false,
  marqueeStart: null,
  marqueeEnd: null,
  isMiddleButtonDragging: false,
  isDraggingOrResizing: false,

  selectElement: (element, addToSelection = false) => {
    set((state) => {
      if (addToSelection) {
        // 이미 선택되어 있으면 토글 (선택 해제)
        const existingIndex = state.selectedElements.findIndex(
          (el) => el.id === element.id
        );
        if (existingIndex >= 0) {
          return {
            selectedElements: state.selectedElements.filter(
              (el) => el.id !== element.id
            ),
          };
        }
        // 선택에 추가
        return {
          selectedElements: [...state.selectedElements, element],
        };
      }
      // 단일 선택 (기존 선택 대체)
      return {
        selectedElements: [element],
      };
    });
  },

  toggleSelection: (element) => {
    set((state) => {
      const existingIndex = state.selectedElements.findIndex(
        (el) => el.id === element.id
      );
      if (existingIndex >= 0) {
        // 이미 선택되어 있으면 선택 해제
        return {
          selectedElements: state.selectedElements.filter(
            (el) => el.id !== element.id
          ),
        };
      }
      // 선택에 추가
      return {
        selectedElements: [...state.selectedElements, element],
      };
    });
  },

  deselectElement: (id) => {
    set((state) => ({
      selectedElements: state.selectedElements.filter((el) => el.id !== id),
    }));
  },

  clearSelection: () => {
    set({ selectedElements: [] });
  },

  setSelectedElements: (elements) => {
    set({ selectedElements: elements });
  },

  isSelected: (id) => {
    return get().selectedElements.some((el) => el.id === id);
  },

  setLastSelectedKeyBounds: (bounds) => {
    set({ lastSelectedKeyBounds: bounds });
  },

  setClipboard: (items) => {
    set({ clipboard: items });
  },

  clearClipboard: () => {
    set({ clipboard: [] });
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

  moveSelectedElements: (_deltaX, _deltaY) => {
    // 실제 이동 로직은 Grid 컴포넌트에서 처리
    // 이 함수는 외부에서 호출될 콜백을 위한 placeholder
  },
}));

/**
 * 마퀴 영역 계산 헬퍼
 */
export function getMarqueeRect(
  start: { x: number; y: number } | null,
  end: { x: number; y: number } | null
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
  marqueeRect: { left: number; top: number; width: number; height: number }
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
