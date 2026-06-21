import React, { useRef } from 'react';
import { isMac } from '@utils/core/platform';
import { useDraggable, useSmartGuidesElements } from '@hooks/Grid';
import { useSmartGuidesStore } from '@stores/grid/useSmartGuidesStore';
import { useSettingsStore } from '@stores/useSettingsStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import {
  calculateBounds,
  calculateSnapPoints,
  calculateGroupBounds,
} from '@utils/grid/smartGuides';
import { resolveImageSource } from '@utils/core/imageSource';

interface DialPosition {
  hidden?: boolean;
  dx?: number;
  dy?: number;
  width?: number;
  height?: number;
  className?: string;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  inactiveImage?: string;
  activeImage?: string;
  idleImageFit?: string;
  imageFit?: string;
  zIndex?: number;
}

interface SelectedElement {
  id: string;
  type?: string;
  index?: number;
}

interface DialItemProps {
  index: number;
  elementId?: string;
  position: DialPosition;
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

const DialItem = ({
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
}: DialItemProps) => {
  const macOS = isMac();
  const {
    dx = 0,
    dy = 0,
    width = 60,
    height = 60,
    className,
    backgroundColor,
    borderColor,
    borderWidth,
    inactiveImage,
    activeImage,
    idleImageFit,
    imageFit,
  } = position ?? ({} as Partial<DialPosition>);

  const { getOtherElements } = useSmartGuidesElements();
  const gridSnapSize = useSettingsStore(
    (state: { gridSettings?: { gridSnapSize?: number } }) =>
      state.gridSettings?.gridSnapSize || 5,
  );
  const isDraggingOrResizing = useGridSelectionStore(
    (state: { isDraggingOrResizing: boolean }) => state.isDraggingOrResizing,
  );

  const isSelectionMode = isSelected;
  const multiDragRef = useRef<{
    isDragging: boolean;
    startX: number;
    startY: number;
    lastSnappedDeltaX?: number;
    lastSnappedDeltaY?: number;
  }>({ isDragging: false, startX: 0, startY: 0 });
  const effectiveElementId = elementId || `dial-${index}`;

  const imageSrc =
    resolveImageSource(inactiveImage) ||
    resolveImageSource(activeImage) ||
    null;
  const resolvedFit = (idleImageFit ||
    imageFit ||
    'cover') as React.CSSProperties['objectFit'];

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
    elementWidth: width || 60,
    elementHeight: height || 60,
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
    const currentWidth = width || 60;
    const currentHeight = height || 60;
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
        const alignmentGuidesEnabled = gridSettings?.alignmentGuides !== false;
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

        let groupBounds: ReturnType<typeof calculateGroupBounds> | null = null;
        if (selectedElements.length > 1) {
          const selectedBoundsArray = selectedElements
            .map((sel) => {
              if (
                sel.id === currentElementId ||
                (sel.type === 'dial' && sel.index === index)
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

  const transform = `translate3d(calc(${draggable.dx}px + var(--key-offset-x, 0px)), calc(${draggable.dy}px + var(--key-offset-y, 0px)), 0)`;

  return (
    <div
      ref={attachRef}
      className={`absolute select-none ${className || ''}`}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        transform,
        zIndex: position.zIndex ?? zIndex,
        cursor: 'pointer',
        willChange:
          isDraggingOrResizing || isViewportTransforming ? 'transform' : 'auto',
        contain: 'layout style paint',
      }}
      data-editing={isDraggingOrResizing ? 'true' : undefined}
      onClick={handleClick}
      onMouseDown={isSelectionMode ? handleSelectionDragMouseDown : undefined}
      onContextMenu={handleContextMenu}
      onDragStart={(e: React.DragEvent) => e.preventDefault()}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          overflow: 'hidden',
          position: 'relative',
          background: backgroundColor || 'rgba(46, 46, 47, 0.9)',
          border:
            borderWidth && borderWidth > 0
              ? `${borderWidth}px solid ${
                  borderColor || 'rgba(113, 113, 113, 0.9)'
                }`
              : `1px solid ${borderColor || 'rgba(113, 113, 113, 0.9)'}`,
          boxSizing: 'border-box',
        }}
      >
        {imageSrc ? (
          <img
            src={imageSrc}
            alt=""
            draggable={false}
            style={{
              width: '100%',
              height: '100%',
              objectFit: resolvedFit,
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              top: '12%',
              left: '50%',
              width: '8%',
              height: '76%',
              transform: 'translateX(-50%)',
              background: borderColor || 'rgba(255, 255, 255, 0.85)',
              borderRadius: '4px',
            }}
          />
        )}
      </div>
    </div>
  );
};

export default DialItem;
