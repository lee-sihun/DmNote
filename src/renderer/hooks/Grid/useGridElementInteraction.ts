import type React from 'react';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useSettingsStore } from '@stores/useSettingsStore';
import { isMac } from '@utils/core/platform';
import { useDraggable, useSmartGuidesElements } from '@hooks/Grid';
import { useSelectionDrag } from './drag/useSelectionDrag';

export interface GridElementSelectionRef {
  id: string;
  type?: string;
  index?: number;
}

export interface GridElementInteractionProps {
  index: number;
  elementId: string;
  onPositionChange: (
    index: number,
    dx: number,
    dy: number,
    elementId: string,
  ) => void;
  onClick?: (event: React.MouseEvent) => void;
  onDoubleClick?: (event: React.MouseEvent) => void;
  onCtrlClick?: (event: React.MouseEvent) => void;
  onShiftClick?: (event: React.MouseEvent) => void;
  isSelected?: boolean;
  selectedElements?: GridElementSelectionRef[];
  onMultiDrag?: (dx: number, dy: number) => void;
  onMultiDragStart?: () => void | (() => void);
  onMultiDragEnd?: () => void;
  activeTool?: string;
  onEraserClick?: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  setReferenceRef?: (node: HTMLElement | null) => void;
  zoom?: number;
  panX?: number;
  panY?: number;
  isViewportTransforming?: boolean;
}

interface UseGridElementInteractionOptions extends GridElementInteractionProps {
  initialX: number;
  initialY: number;
  elementWidth: number;
  elementHeight: number;
}

export const useGridElementInteraction = ({
  index,
  elementId,
  initialX,
  initialY,
  elementWidth,
  elementHeight,
  onPositionChange,
  onClick,
  onDoubleClick,
  onCtrlClick,
  onShiftClick,
  isSelected = false,
  selectedElements = [],
  onMultiDrag,
  onMultiDragStart,
  onMultiDragEnd,
  activeTool,
  onEraserClick,
  onContextMenu,
  setReferenceRef,
  zoom = 1,
  panX = 0,
  panY = 0,
  isViewportTransforming = false,
}: UseGridElementInteractionOptions) => {
  const macOS = isMac();
  const { getOtherElements } = useSmartGuidesElements();
  const gridSnapSize = useSettingsStore(
    (state) => state.gridSettings?.gridSnapSize ?? 5,
  );
  const isDraggingOrResizing = useGridSelectionStore(
    (state) => state.isDraggingOrResizing,
  );

  const draggable = useDraggable({
    gridSize: gridSnapSize,
    initialX,
    initialY,
    onPositionChange: (newDx: number, newDy: number) => {
      if (!isSelected) {
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
    disabled: isSelected,
  });

  const { handlePointerDown, movedDuringPressRef, pressMovedRef } =
    useSelectionDrag({
      enabled: isSelected,
      zoom,
      startX: initialX,
      startY: initialY,
      elementId,
      elementWidth,
      elementHeight,
      selectedElements,
      getOtherElements,
      onMultiDragStart,
      onMultiDrag,
      onMultiDragEnd,
    });

  const handleClick = (event: React.MouseEvent) => {
    if (macOS && event.ctrlKey) return;
    if (draggable.wasMoved || pressMovedRef.current) {
      event.stopPropagation();
      return;
    }
    const isPrimaryModifierPressed = macOS ? event.metaKey : event.ctrlKey;

    if (isSelected && isPrimaryModifierPressed && onCtrlClick) {
      event.stopPropagation();
      onCtrlClick(event);
      return;
    }

    if (isSelected) {
      event.stopPropagation();
      return;
    }

    if (activeTool === 'eraser') {
      onEraserClick?.();
      return;
    }

    if (event.shiftKey && onShiftClick) {
      event.stopPropagation();
      onShiftClick(event);
      return;
    }
    if (isPrimaryModifierPressed && onCtrlClick) {
      event.stopPropagation();
      onCtrlClick(event);
      return;
    }
    onClick?.(event);
  };

  const handleDoubleClick = (event: React.MouseEvent) => {
    if (!onDoubleClick) return;
    if (macOS && event.ctrlKey) return;
    if (event.shiftKey || event.metaKey || event.ctrlKey) return;
    if (activeTool === 'eraser') return;
    if (isViewportTransforming) return;
    if (draggable.recentPressMovedRef.current || movedDuringPressRef.current) {
      return;
    }
    event.stopPropagation();
    onDoubleClick(event);
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onContextMenu?.(event);
  };

  const attachRef = (node: HTMLElement | null) => {
    if (!isSelected) draggable.ref(node);
    setReferenceRef?.(node);
  };

  return {
    attachRef,
    dx: draggable.dx,
    dy: draggable.dy,
    handleClick,
    handleContextMenu,
    handleDoubleClick,
    handleSelectionDragPointerDown: handlePointerDown,
    isDraggingOrResizing,
    isSelectionMode: isSelected,
    wasMoved: draggable.wasMoved,
  };
};
