import type { GradientSpec } from '@src/types/color';
import React, { useState } from 'react';
import { useGridItemInteraction } from '@hooks/Grid/useGridItemInteraction';
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

  const previewHistory = [...PREVIEW_HISTORY_BASE];
  const previewImageSrc =
    resolveImageSource(inactiveImage) ||
    resolveImageSource(activeImage) ||
    null;
  const previewImageFit = idleImageFit || imageFit || 'cover';

  const {
    isSelectionMode,
    isDraggingOrResizing,
    draggable,
    handleSelectionDragPointerDown,
    handleClick,
    handleDoubleClick,
    handleContextMenu,
    attachRef,
  } = useGridItemInteraction({
    index,
    elementId,
    dx,
    dy,
    elementWidth: width || 200,
    elementHeight: height || 100,
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
  });

  if (position?.hidden) return null;

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
      onPointerDown={
        isSelectionMode ? handleSelectionDragPointerDown : undefined
      }
      onDoubleClick={onDoubleClick ? handleDoubleClick : undefined}
      onContextMenu={handleContextMenu}
      onDragStart={(e: React.DragEvent) => e.preventDefault()}
    />
  );
};

export default GraphItem;
