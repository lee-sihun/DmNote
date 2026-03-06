import React, { useRef, useState } from 'react';
import { isMac } from '@utils/core/platform';
import { useDraggable, useSmartGuidesElements } from '@hooks/Grid';
import { useSmartGuidesStore } from '@stores/useSmartGuidesStore';
import { useSettingsStore } from '@stores/useSettingsStore';
import { useGridSelectionStore } from '@stores/useGridSelectionStore';
import {
  calculateBounds,
  calculateSnapPoints,
  calculateGroupBounds,
} from '@utils/grid/smartGuides';
import GraphPanel from '@components/graph/GraphPanel';
import { resolveImageSource } from '@utils/core/imageSource';

interface GraphPosition {
  hidden?: boolean;
  dx?: number;
  dy?: number;
  width?: number;
  height?: number;
  className?: string;
  graphType?: string;
  graphColor?: string;
  showAvgLine?: boolean;
  graphAnimationEnabled?: boolean;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  inactiveImage?: string;
  activeImage?: string;
  idleImageFit?: string;
  imageFit?: string;
  useInlineStyles?: boolean;
  zIndex?: number;
}

interface SelectedElement {
  id: string;
  type?: string;
  index?: number;
}

interface GraphItemProps {
  index: number;
  elementId?: string;
  position: GraphPosition;
  onPositionChange: (index: number, dx: number, dy: number) => void;
  onClick?: (e: React.MouseEvent) => void;
  onCtrlClick?: (e: React.MouseEvent) => void;
  onShiftClick?: (e: React.MouseEvent) => void;
  isSelected?: boolean;
  selectedElements?: SelectedElement[];
  onMultiDrag?: (dx: number, dy: number) => void;
  onMultiDragStart?: () => void;
  onMultiDragEnd?: () => void;
  activeTool?: string;
  onEraserClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  setReferenceRef?: (node: HTMLElement | null) => void;
  zoom?: number;
  panX?: number;
  panY?: number;
  zIndex?: number;
  isViewportTransforming?: boolean;
}

const PREVIEW_HISTORY_BASE: number[] = [
  8, 10, 11, 13, 12, 14, 15, 16, 14, 13, 12, 14, 15, 14, 14,
];
const PREVIEW_AVG = 12;
const PREVIEW_MAX = 18;

export default function GraphItem({
  index,
  elementId,
  position,
  onPositionChange,
  onClick,
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
  zIndex = 0,
  isViewportTransforming = false,
}: GraphItemProps) {
  const macOS = isMac();
  const {
    dx = 0,
    dy = 0,
    width = 200,
    height = 100,
    className,
    graphType = 'line',
    graphColor = '#86EFAC',
    showAvgLine = true,
    graphAnimationEnabled = true,
    backgroundColor,
    borderColor,
    borderWidth,
    borderRadius,
    inactiveImage,
    activeImage,
    idleImageFit,
    imageFit,
    useInlineStyles = false,
  } = position ?? ({} as Partial<GraphPosition>);

  const { getOtherElements } = useSmartGuidesElements();
  const gridSnapSize = useSettingsStore(
    (state: { gridSettings?: { gridSnapSize?: number } }) =>
      state.gridSettings?.gridSnapSize || 5,
  );
  const isDraggingOrResizing = useGridSelectionStore(
    (state: { isDraggingOrResizing: boolean }) => state.isDraggingOrResizing,
  );

  const isSelectionMode = isSelected;
  const [uid] = useState(() =>
    `graph-preview-${Math.random().toString(36).slice(2, 11)}`,
  );
  const multiDragRef = useRef<{
    isDragging: boolean;
    startX: number;
    startY: number;
    lastSnappedDeltaX?: number;
    lastSnappedDeltaY?: number;
  }>({ isDragging: false, startX: 0, startY: 0 });
  const effectiveElementId = elementId || `graph-${index}`;

  const previewHistory = [...PREVIEW_HISTORY_BASE];
  const previewImageSrc = resolveImageSource(inactiveImage) ||
      resolveImageSource(activeImage) ||
      null;
  const previewImageFit = idleImageFit || imageFit || 'cover';

  const draggable = useDraggable({
    gridSize: gridSnapSize,
    initialX: dx,
    initialY: dy,
    onPositionChange: (newDx: number, newDy: number) => {
      if (!isSelectionMode) {
        onPositionChange(index, newDx, newDy);
      }
    },
    zoom,
    panX,
    panY,
    elementId: effectiveElementId,
    elementWidth: width || 200,
    elementHeight: height || 100,
    getOtherElements,
    disabled: isSelectionMode,
  });

  if (position?.hidden) return null;

  const handleSelectionDragMouseDown = (e: React.MouseEvent) => {
      if (!isSelectionMode || e.button !== 0) return;

      e.preventDefault();
      e.stopPropagation();

      useSmartGuidesStore.getState().clearGuides();
      useGridSelectionStore.getState().setDraggingOrResizing(true);

      onMultiDragStart?.();

      const startDx = dx;
      const startDy = dy;
      const currentWidth = width || 200;
      const currentHeight = height || 100;
      const currentElementId = effectiveElementId;

      multiDragRef.current = {
        isDragging: true,
        startX: e.clientX,
        startY: e.clientY,
        lastSnappedDeltaX: 0,
        lastSnappedDeltaY: 0,
      };

      let rafId: number | null = null;
      let dragEnded = false;
      const smartGuidesStore = useSmartGuidesStore.getState();

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!multiDragRef.current.isDragging || dragEnded) return;
        if (rafId) return;

        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (dragEnded) return;

          const currentZoom = zoom;
          const rawDeltaX =
            (moveEvent.clientX - multiDragRef.current.startX) / currentZoom;
          const rawDeltaY =
            (moveEvent.clientY - multiDragRef.current.startY) / currentZoom;

          const newX = startDx + rawDeltaX;
          const newY = startDy + rawDeltaY;

          const gridSettings = useSettingsStore.getState().gridSettings;
          const alignmentGuidesEnabled =
            gridSettings?.alignmentGuides !== false;
          const spacingGuidesEnabled = gridSettings?.spacingGuides !== false;

          const otherElements = getOtherElements(currentElementId);
          const nonSelectedElements = otherElements.filter(
            (el: { id: string }) =>
              !selectedElements.some((sel) => sel.id === el.id),
          );

          const draggedBounds = calculateBounds(
            newX,
            newY,
            currentWidth,
            currentHeight,
            currentElementId,
          );

          let groupBounds: ReturnType<typeof calculateGroupBounds> | null =
            null;
          if (selectedElements.length > 1) {
            const selectedBoundsArray = selectedElements
              .map((sel) => {
                if (
                  sel.id === currentElementId ||
                  (sel.type === 'graph' && sel.index === index)
                ) {
                  return draggedBounds;
                }

                const found = otherElements.find(
                  (el: { id: string }) => el.id === sel.id,
                );
                if (!found) return null;

                return calculateBounds(
                  found.left + rawDeltaX,
                  found.top + rawDeltaY,
                  found.width,
                  found.height,
                  found.id,
                );
              })
              .filter(Boolean);
            groupBounds = calculateGroupBounds(selectedBoundsArray);
          }

          const snapTargetBounds =
            selectedElements.length > 1 && groupBounds
              ? groupBounds
              : draggedBounds;

          const snapResult = alignmentGuidesEnabled
            ? calculateSnapPoints(
                snapTargetBounds,
                nonSelectedElements,
                undefined,
                {
                  groupBounds,
                  disableSpacing: !spacingGuidesEnabled,
                },
              )
            : null;

          let finalX: number;
          let finalY: number;

          if (snapResult?.didSnapX) {
            if (selectedElements.length > 1 && groupBounds) {
              const groupSnapDeltaX = snapResult.snappedX - groupBounds.left;
              finalX = newX + groupSnapDeltaX;
            } else {
              finalX = snapResult.snappedX;
            }
          } else {
            const snapSize = gridSettings?.gridSnapSize || 5;
            finalX = Math.round(newX / snapSize) * snapSize;
          }

          if (snapResult?.didSnapY) {
            if (selectedElements.length > 1 && groupBounds) {
              const groupSnapDeltaY = snapResult.snappedY - groupBounds.top;
              finalY = newY + groupSnapDeltaY;
            } else {
              finalY = snapResult.snappedY;
            }
          } else {
            const snapSize = gridSettings?.gridSnapSize || 5;
            finalY = Math.round(newY / snapSize) * snapSize;
          }

          const snappedDeltaX = Math.round(finalX - startDx);
          const snappedDeltaY = Math.round(finalY - startDy);

          if (snapResult && (snapResult.didSnapX || snapResult.didSnapY)) {
            const displayBounds =
              selectedElements.length > 1 && groupBounds
                ? calculateBounds(
                    groupBounds.left +
                      (snapResult.didSnapX
                        ? snapResult.snappedX - groupBounds.left
                        : 0),
                    groupBounds.top +
                      (snapResult.didSnapY
                        ? snapResult.snappedY - groupBounds.top
                        : 0),
                    groupBounds.width,
                    groupBounds.height,
                    'group',
                  )
                : calculateBounds(
                    finalX,
                    finalY,
                    currentWidth,
                    currentHeight,
                    currentElementId,
                  );

            smartGuidesStore.setDraggedBounds(displayBounds);
            smartGuidesStore.setActiveGuides(snapResult.guides);

            if (
              spacingGuidesEnabled &&
              snapResult.spacingGuides &&
              snapResult.spacingGuides.length > 0
            ) {
              smartGuidesStore.setSpacingGuides(snapResult.spacingGuides);
            } else {
              smartGuidesStore.setSpacingGuides([]);
            }
          } else {
            smartGuidesStore.clearGuides();
          }

          const moveDeltaX =
            snappedDeltaX - (multiDragRef.current.lastSnappedDeltaX ?? 0);
          const moveDeltaY =
            snappedDeltaY - (multiDragRef.current.lastSnappedDeltaY ?? 0);

          if (moveDeltaX !== 0 || moveDeltaY !== 0) {
            multiDragRef.current.lastSnappedDeltaX = snappedDeltaX;
            multiDragRef.current.lastSnappedDeltaY = snappedDeltaY;
            onMultiDrag?.(moveDeltaX, moveDeltaY);
          }
        });
      };

      const handleMouseUp = () => {
        dragEnded = true;
        multiDragRef.current.isDragging = false;

        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }

        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('blur', handleMouseUp);
        useSmartGuidesStore.getState().clearGuides();
        useGridSelectionStore.getState().setDraggingOrResizing(false);
        onMultiDragEnd?.();
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('blur', handleMouseUp);
    };

  const handleClick = (e: React.MouseEvent) => {
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

  return (
    <GraphPanel
      ref={attachRef}
      dx={draggable.dx}
      dy={draggable.dy}
      width={width}
      height={height}
      zIndex={position.zIndex ?? zIndex}
      className={className}
      graphType={graphType as 'line' | 'bar'}
      graphColor={graphColor || '#86EFAC'}
      showAvgLine={showAvgLine}
      animationEnabled={graphAnimationEnabled ?? true}
      backgroundColor={backgroundColor}
      borderColor={borderColor}
      borderWidth={borderWidth}
      borderRadius={borderRadius}
      imageSrc={previewImageSrc}
      imageFit={previewImageFit}
      useInlineStyles={useInlineStyles}
      history={previewHistory}
      avg={PREVIEW_AVG}
      maxval={PREVIEW_MAX}
      uid={uid}
      withOffsetVars={true}
      interactive={true}
      dataEditing={isDraggingOrResizing}
      isViewportTransforming={isViewportTransforming}
      onClick={handleClick}
      onMouseDown={isSelectionMode ? handleSelectionDragMouseDown : undefined}
      onContextMenu={handleContextMenu}
      onDragStart={(e: React.DragEvent) => e.preventDefault()}
    />
  );
}
