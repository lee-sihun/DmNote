import React from 'react';
import { isMac } from '@utils/core/platform';
import { useDraggable, useSmartGuidesElements } from '@hooks/Grid';
import { useSelectionDrag } from '@hooks/Grid/useSelectionDrag';
import { useSettingsStore } from '@stores/useSettingsStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { resolveImageSource } from '@utils/core/imageSource';
import { spriteTransformToCss } from '@src/types/key/sprites';
import type { CanonicalReactiveSpritePosition } from '@src/types/editor';

interface SelectedElement {
  id: string;
  type?: string;
  index?: number;
}

interface SpriteItemProps {
  index: number;
  elementId: string;
  position: CanonicalReactiveSpritePosition;
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
  isSelected?: boolean;
  selectedElements?: SelectedElement[];
  onMultiDrag?: (dx: number, dy: number) => void;
  onMultiDragStart?: () => void | (() => void);
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

// 활동 영역은 에디터 전용 가이드 - 오버레이에는 그리지 않는다
const ACTIVITY_AREA_BORDER = '1px dashed rgba(237, 238, 242, 0.4)';
const SELECTED_AREA_BORDER = '1px solid var(--ui-selection-border)';

// 캔버스의 스프라이트는 정적이다: idle transform 상태만 그린다.
// 키 눌림 라이브 반응은 오버레이 창(OverlaySpriteItem) 몫
const SpriteItem = ({
  index,
  elementId,
  position,
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
  zIndex = 0,
  isViewportTransforming = false,
}: SpriteItemProps) => {
  const macOS = isMac();
  const { dx = 0, dy = 0, width = 200, height = 200, className } = position;

  const { getOtherElements } = useSmartGuidesElements();
  const gridSnapSize = useSettingsStore(
    (state: { gridSettings?: { gridSnapSize?: number } }) =>
      state.gridSettings?.gridSnapSize ?? 5,
  );
  const isDraggingOrResizing = useGridSelectionStore(
    (state: { isDraggingOrResizing: boolean }) => state.isDraggingOrResizing,
  );

  const isSelectionMode = isSelected;

  const imageSrc = resolveImageSource(position.baseImage);

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
    elementWidth: width || 200,
    elementHeight: height || 200,
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
    elementWidth: width || 200,
    elementHeight: height || 200,
    selectedElements,
    getOtherElements,
    onMultiDragStart,
    onMultiDrag,
    onMultiDragEnd,
  });

  if (position.hidden) return null;

  const handleClick = (e: React.MouseEvent) => {
    // macOS ctrl+클릭은 우클릭 제스처 - contextmenu 뒤에 오는 click이
    // 선택·패널 오픈으로 이어져 방금 연 메뉴를 닫는 것을 차단
    if (macOS && e.ctrlKey) return;
    // 드래그로 끝난 press의 trailing click 흡수 (KnobItem과 동일 규칙)
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

  // 더블클릭 편집 진입 - 순수 더블클릭만 통과
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

  const transform = `translate(calc(${draggable.dx}px + var(--key-offset-x, 0px)), calc(${draggable.dy}px + var(--key-offset-y, 0px)))`;

  return (
    <div
      ref={attachRef}
      className={`absolute select-none dmn-grabbable ${className || ''}`}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        transform,
        zIndex: position.zIndex ?? zIndex,
        // 그리드 안 승격 금지 - WebKit은 합성 자식이 생기면 스케일 컨테이너를
        // 레이어로 만들어 전체가 흐려진다
        willChange: 'auto',
        contain: 'layout style',
      }}
      data-editing={isDraggingOrResizing ? 'true' : undefined}
      onClick={handleClick}
      onDoubleClick={onDoubleClick ? handleDoubleClick : undefined}
      onPointerDown={
        isSelectionMode ? handleSelectionDragPointerDown : undefined
      }
      onContextMenu={handleContextMenu}
      onDragStart={(e: React.DragEvent) => e.preventDefault()}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          boxSizing: 'border-box',
          border: isSelected ? SELECTED_AREA_BORDER : ACTIVITY_AREA_BORDER,
          borderRadius: '4px',
        }}
        data-sprite-element="true"
        data-selected={isSelected ? 'true' : undefined}
      >
        {imageSrc ? (
          <img
            src={imageSrc}
            alt=""
            draggable={false}
            style={{
              position: 'absolute',
              left: `${position.imageRect.x}px`,
              top: `${position.imageRect.y}px`,
              width: `${position.imageRect.width}px`,
              height: `${position.imageRect.height}px`,
              objectFit: position.imageFit ?? 'contain',
              transformOrigin: `${position.pivot.x * 100}% ${
                position.pivot.y * 100
              }%`,
              transform: spriteTransformToCss(position.idleTransform),
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              color: 'rgba(237, 238, 242, 0.45)',
            }}
            data-sprite-placeholder="true"
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <rect
                x="3"
                y="3"
                width="18"
                height="18"
                rx="3"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <circle cx="9" cy="9" r="2" fill="currentColor" />
              <path
                d="M4 17.5L9.5 12.5L13.5 16L16.5 13.5L20 16.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
};

export default SpriteItem;
