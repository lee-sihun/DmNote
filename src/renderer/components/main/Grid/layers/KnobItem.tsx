import React from 'react';
import {
  gradientToCss,
  gradientRingStyle,
  type GradientSpec,
} from '@src/types/color';
import { isMac } from '@utils/core/platform';
import { useDraggable, useSmartGuidesElements } from '@hooks/Grid';
import { useSelectionDrag } from '@hooks/Grid/useSelectionDrag';
import { useSettingsStore } from '@stores/useSettingsStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { resolveImageSource } from '@utils/core/imageSource';
import {
  DEFAULT_ELEMENT_BG,
  DEFAULT_ELEMENT_BORDER_WIDTH,
  DEFAULT_ELEMENT_FONT,
  DEFAULT_ELEMENT_SHADOW,
} from '@utils/core/elementDefaults';

interface KnobPosition {
  hidden?: boolean;
  dx?: number;
  dy?: number;
  width?: number;
  height?: number;
  className?: string;
  backgroundColor?: string;
  borderColor?: string;
  backgroundGradient?: GradientSpec | null;
  borderGradient?: GradientSpec | null;
  borderWidth?: number;
  borderRadius?: number;
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

interface KnobItemProps {
  index: number;
  elementId?: string;
  position: KnobPosition;
  onPositionChange: (index: number, dx: number, dy: number) => void;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
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

const KnobItem = ({
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
}: KnobItemProps) => {
  const macOS = isMac();
  const {
    dx = 0,
    dy = 0,
    width = 60,
    height = 60,
    className,
    backgroundColor,
    borderColor,
    backgroundGradient,
    borderGradient,
    borderWidth,
    borderRadius,
    inactiveImage,
    activeImage,
    idleImageFit,
    imageFit,
  } = position ?? ({} as Partial<KnobPosition>);

  // 키·그래프와 동일 규칙 — 두께 미지정이면 기본 두께 링, 0은 명시적 비활성
  const gradientRingWidth = borderWidth ?? DEFAULT_ELEMENT_BORDER_WIDTH;
  const showBorderRing =
    Boolean(borderGradient) && (borderWidth != null ? borderWidth > 0 : true);

  const { getOtherElements } = useSmartGuidesElements();
  const gridSnapSize = useSettingsStore(
    (state: { gridSettings?: { gridSnapSize?: number } }) =>
      state.gridSettings?.gridSnapSize || 5,
  );
  const isDraggingOrResizing = useGridSelectionStore(
    (state: { isDraggingOrResizing: boolean }) => state.isDraggingOrResizing,
  );

  const isSelectionMode = isSelected;
  const effectiveElementId = elementId || `knob-${index}`;

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

  const {
    handlePointerDown: handleSelectionDragPointerDown,
    movedDuringPressRef,
  } = useSelectionDrag({
    enabled: isSelectionMode,
    zoom,
    startX: dx,
    startY: dy,
    elementId: effectiveElementId,
    elementWidth: width || 60,
    elementHeight: height || 60,
    elementType: 'knob',
    elementIndex: index,
    selectedElements,
    getOtherElements,
    onMultiDragStart,
    onMultiDrag,
    onMultiDragEnd,
  });

  if (position?.hidden) return null;

  const handleClick = (e: React.MouseEvent) => {
    // macOS ctrl+클릭은 우클릭 제스처 — Chromium이 contextmenu 뒤에 click도 발화하므로
    // 이 클릭이 선택·패널 오픈으로 이어져 방금 연 메뉴를 닫는 것을 차단
    if (macOS && e.ctrlKey) return;
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

  // 더블클릭 편집 진입 — 순수 더블클릭만 통과 (드래그·수식키·지우개·뷰포트 변환 제외)
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

  const transform = `translate3d(calc(${draggable.dx}px + var(--key-offset-x, 0px)), calc(${draggable.dy}px + var(--key-offset-y, 0px)), 0)`;

  return (
    <div
      ref={attachRef}
      className={`absolute select-none dmn-grabbable ${className || ''}`}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        transform,
        zIndex: position.zIndex ?? zIndex,
        willChange:
          isDraggingOrResizing || isViewportTransforming ? 'transform' : 'auto',
        contain: 'layout style paint',
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
          // 모서리 반경 미지정 시 원형 유지 (px 지정 시 키와 동일한 px 단위)
          borderRadius: borderRadius != null ? `${borderRadius}px` : '50%',
          overflow: 'hidden',
          position: 'relative',
          background: backgroundGradient
            ? gradientToCss(backgroundGradient)
            : backgroundColor || DEFAULT_ELEMENT_BG,
          // 그라데이션 보더는 보더 대신 동일 두께 padding + 링 자식
          border:
            !borderGradient && borderWidth && borderWidth > 0
              ? `${borderWidth}px solid ${borderColor || DEFAULT_ELEMENT_FONT}`
              : undefined,
          padding: showBorderRing ? `${gradientRingWidth}px` : undefined,
          // 오버레이와 동일한 기본 인셋 링 섀도 — 이미지·명시 보더 노브는 제외
          boxShadow:
            imageSrc || (borderWidth && borderWidth > 0)
              ? undefined
              : DEFAULT_ELEMENT_SHADOW,
          boxSizing: 'border-box',
        }}
      >
        {showBorderRing && borderGradient && (
          <span
            aria-hidden="true"
            style={gradientRingStyle(borderGradient, gradientRingWidth)}
          />
        )}
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
              background: borderColor || DEFAULT_ELEMENT_FONT,
              borderRadius: '4px',
            }}
          />
        )}
      </div>
    </div>
  );
};

export default KnobItem;
