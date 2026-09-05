import type { GradientSpec } from '@src/types/color';
import React, { useState } from 'react';
import { isMac } from '@utils/core/platform';
import { useDraggable, useSmartGuidesElements } from '@hooks/Grid';
import { useSelectionDrag } from '@hooks/Grid/useSelectionDrag';
import { useSettingsStore } from '@stores/useSettingsStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useGradientPreviewSession } from '@stores/grid/useGradientEditStore';
import GraphPanel from '@components/shared/GraphPanel';
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
  backgroundGradient?: GradientSpec | null;
  borderGradient?: GradientSpec | null;
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
  elementId: string;
  position: GraphPosition;
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

const PREVIEW_HISTORY_BASE: number[] = [
  8, 10, 11, 13, 12, 14, 15, 16, 14, 13, 12, 14, 15, 14, 14,
];
const PREVIEW_AVG = 12;
const PREVIEW_MAX = 18;

const GraphItem = ({
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
}: GraphItemProps) => {
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
      state.gridSettings?.gridSnapSize ?? 5,
  );
  const isDraggingOrResizing = useGridSelectionStore(
    (state: { isDraggingOrResizing: boolean }) => state.isDraggingOrResizing,
  );

  const isSelectionMode = isSelected;

  // 편집 세션 일시 페인트 — 저장·히스토리를 거치지 않는 드래그 프리뷰
  const previewSession = useGradientPreviewSession(
    'graph',
    elementId,
    isSelected,
  );
  const previewBgSpec =
    previewSession?.surface === 'background' ? previewSession.spec : null;
  const previewBorderSpec =
    previewSession?.surface === 'border' ? previewSession.spec : null;
  const [uid] = useState(
    () => `graph-preview-${Math.random().toString(36).slice(2, 11)}`,
  );
  const effectiveElementId = elementId;

  const previewHistory = [...PREVIEW_HISTORY_BASE];
  const previewImageSrc =
    resolveImageSource(inactiveImage) ||
    resolveImageSource(activeImage) ||
    null;
  const previewImageFit = idleImageFit || imageFit || 'cover';

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
    elementId: effectiveElementId,
    elementWidth: width || 200,
    elementHeight: height || 100,
    getOtherElements,
    disabled: isSelectionMode,
  });

  const { handlePointerDown, movedDuringPressRef, pressMovedRef } =
    useSelectionDrag({
      enabled: isSelectionMode,
      zoom,
      startX: dx,
      startY: dy,
      elementId: effectiveElementId,
      elementWidth: width || 200,
      elementHeight: height || 100,
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
      backgroundGradient={previewBgSpec ?? position.backgroundGradient}
      borderGradient={previewBorderSpec ?? position.borderGradient}
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
      onClick={handleClick}
      onPointerDown={isSelectionMode ? handlePointerDown : undefined}
      onDoubleClick={onDoubleClick ? handleDoubleClick : undefined}
      onContextMenu={handleContextMenu}
      onDragStart={(e: React.DragEvent) => e.preventDefault()}
    />
  );
};

export default GraphItem;
