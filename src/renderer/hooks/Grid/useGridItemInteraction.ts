import type React from 'react';

import { isMac } from '@utils/core/platform';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useSettingsStore } from '@stores/useSettingsStore';

import { useDraggable } from './useDraggable';
import { useSelectionDrag } from './useSelectionDrag';
import { useSmartGuidesElements } from './useSmartGuidesElements';

/**
 * 캔버스 아이템의 공통 상호작용 골격 - 개별 드래그, 선택 모드 다중 드래그,
 * 클릭·더블클릭·컨텍스트 메뉴 라우팅, 루트 ref 부착.
 * 키·그래프·노브·스프라이트 잎이 같은 계약을 공유한다.
 * 기본 크기 폴백처럼 요소별로 다른 값은 호출부가 이미 풀어서 넘긴다
 */

export interface GridItemSelectedElement {
  id: string;
  type?: string;
  index?: number;
}

export interface GridItemInteractionOptions {
  index: number;
  elementId: string;
  dx: number;
  dy: number;
  /** 폴백까지 적용된 실제 크기 */
  elementWidth: number;
  elementHeight: number;
  isSelected: boolean;
  selectedElements: GridItemSelectedElement[];
  zoom: number;
  panX: number;
  panY: number;
  activeTool?: string;
  isViewportTransforming: boolean;
  onPositionChange: (
    index: number,
    dx: number,
    dy: number,
    elementId: string,
  ) => void;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onCtrlClick?: (e: React.MouseEvent) => void;
  onShiftClick?: (e: React.MouseEvent) => void;
  onMultiDrag?: (dx: number, dy: number) => void;
  onMultiDragStart?: () => void | (() => void);
  onMultiDragEnd?: () => void;
  onEraserClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  setReferenceRef?: (node: HTMLElement | null) => void;
}

export const useGridItemInteraction = ({
  index,
  elementId,
  dx,
  dy,
  elementWidth,
  elementHeight,
  isSelected,
  selectedElements,
  zoom,
  panX,
  panY,
  activeTool,
  isViewportTransforming,
  onPositionChange,
  onClick,
  onDoubleClick,
  onCtrlClick,
  onShiftClick,
  onMultiDrag,
  onMultiDragStart,
  onMultiDragEnd,
  onEraserClick,
  onContextMenu,
  setReferenceRef,
}: GridItemInteractionOptions) => {
  const macOS = isMac();
  const { getOtherElements } = useSmartGuidesElements();
  const gridSnapSize = useSettingsStore(
    (state: { gridSettings?: { gridSnapSize?: number } }) =>
      state.gridSettings?.gridSnapSize ?? 5,
  );
  const isDraggingOrResizing = useGridSelectionStore(
    (state: { isDraggingOrResizing: boolean }) => state.isDraggingOrResizing,
  );

  const isSelectionMode = isSelected;

  const draggable = useDraggable({
    gridSize: gridSnapSize,
    initialX: dx,
    initialY: dy,
    onPositionChange: (newDx: number, newDy: number) => {
      if (!isSelectionMode) {
        // 프리즈된 index의 재해석은 수신 측이 elementId로 수행
        onPositionChange(index, newDx, newDy, elementId);
      }
    },
    zoom,
    panX,
    panY,
    elementId,
    elementWidth,
    elementHeight,
    getOtherElements,
    disabled: isSelectionMode,
  });

  const {
    handlePointerDown: handleSelectionDragPointerDown,
    movedDuringPressRef,
    pressMovedRef,
  } = useSelectionDrag({
    enabled: isSelectionMode,
    zoom,
    startX: dx,
    startY: dy,
    elementId,
    elementWidth,
    elementHeight,
    selectedElements,
    getOtherElements,
    onMultiDragStart,
    onMultiDrag,
    onMultiDragEnd,
  });

  const handleClick = (e: React.MouseEvent) => {
    // macOS ctrl+클릭은 우클릭 제스처 - Chromium이 contextmenu 뒤에 click도 발화하므로
    // 이 클릭이 선택·패널 오픈으로 이어져 방금 연 메뉴를 닫는 것을 차단
    if (macOS && e.ctrlKey) return;
    // 드래그로 끝난 press의 trailing click은 클릭이 아니다 - 수식키 토글·
    // 범위 선택·지우개로 새지 않게 흡수. 개별 드래그는 wasMoved,
    // 선택 모드 다중 드래그는 pressMovedRef가 판별 (선택 모드에서는
    // 개별 draggable이 disabled라 wasMoved가 항상 false)
    if (draggable.wasMoved || pressMovedRef.current) {
      e.stopPropagation();
      return;
    }
    const isPrimaryModifierPressed = macOS ? e.metaKey : e.ctrlKey;
    const isShiftPressed = e.shiftKey;

    if (isSelectionMode && isPrimaryModifierPressed && onCtrlClick) {
      e.stopPropagation();
      onCtrlClick(e);
      return;
    }

    if (isSelectionMode) {
      e.stopPropagation();
      return;
    }

    if (activeTool === 'eraser') {
      onEraserClick?.();
      return;
    }

    if (!draggable.wasMoved) {
      if (isShiftPressed && onShiftClick) {
        e.stopPropagation();
        onShiftClick(e);
        return;
      }
      if (isPrimaryModifierPressed && onCtrlClick) {
        e.stopPropagation();
        onCtrlClick(e);
        return;
      }
      onClick?.(e);
    }
  };

  // 더블클릭 편집 진입 - 순수 더블클릭만 통과.
  // 두 번째 press가 다중 드래그로 이어진 경우(movedDuringPressRef)와
  // 단일 드래그(wasMoved), 수식키·지우개·뷰포트 변환 중은 제외
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (!onDoubleClick) return;
    if (macOS && e.ctrlKey) return;
    if (e.shiftKey || e.metaKey || e.ctrlKey) return;
    if (activeTool === 'eraser') return;
    if (isViewportTransforming) return;
    if (draggable.recentPressMovedRef.current || movedDuringPressRef.current)
      return;
    e.stopPropagation();
    onDoubleClick(e);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu?.(e);
  };

  const attachRef = (node: HTMLElement | null) => {
    if (!isSelectionMode) {
      draggable.ref(node);
    }
    if (typeof setReferenceRef === 'function') {
      setReferenceRef(node);
    }
  };

  return {
    isSelectionMode,
    isDraggingOrResizing,
    draggable,
    handleSelectionDragPointerDown,
    handleClick,
    handleDoubleClick,
    handleContextMenu,
    attachRef,
  };
};
