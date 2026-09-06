import React from 'react';
import type { ElementBounds as SmartGuideElementBounds } from '@utils/grid/smartGuides';
import { getCursor } from '@utils/grid/cursorUtils';
import { useCustomCursorHover } from '@hooks/Grid/useCustomCursorHover';
import type { ContinuousInputStrategy } from '@utils/animation/rafLatestScheduler';
import type { CanonicalEditorDocumentV1 } from '@src/types/editor';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import {
  isElementResizable,
  getElementBounds,
  calculateGroupBounds,
  type Bounds,
  type SelectedElement,
} from './groupResizeUtils';
import type { GroupResizeHandle, GroupResizeResult } from './groupResizePlan';
import { useGroupResizeSession } from './useGroupResizeSession';
import { rotatePointAround } from '@utils/core/rotation';
import { resizeCursorForHandle } from './rotatedResize';
import type { GroupRotationFrame } from './rotatedGroupResize';

/**
 * 다중 선택 시 그룹 전체를 감싸는 리사이즈 핸들을 표시하는 컴포넌트
 * 선택된 모든 요소의 바운딩 박스를 계산하고, 비율을 유지하며 크기를 조절합니다.
 */

// ===== 타입 정의 =====

interface HandleProps {
  handle: GroupResizeHandle;
  centerX: number;
  centerY: number;
  rotation: number;
  onMouseDown: (e: React.MouseEvent, handle: GroupResizeHandle) => void;
}

interface GroupResizeHandlesProps {
  selectedElements: SelectedElement[];
  positions: CanonicalEditorDocumentV1['keyPositions'];
  statPositions: CanonicalEditorDocumentV1['statPositions'];
  graphPositions: CanonicalEditorDocumentV1['graphPositions'];
  knobPositions: CanonicalEditorDocumentV1['knobPositions'];
  // Grid 배선 전에도 컴포넌트가 동작하도록 선택 prop - 미전달 시 스프라이트만 제외
  spritePositions?: CanonicalEditorDocumentV1['spritePositions'];
  selectedKeyType: string;
  pluginElements: PluginDisplayElementInternal[];
  zoom?: number;
  panX?: number;
  panY?: number;
  previewGroupBounds?: Bounds | null;
  rotationFrame?: GroupRotationFrame;
  onGroupResizeStart?: (handle: GroupResizeHandle) => void;
  onGroupResize?: (result: GroupResizeResult) => void;
  onGroupResizeEnd?: () => void;
  getOtherElements?: (excludeIds: string[]) => SmartGuideElementBounds[];
  continuousInputStrategy?: ContinuousInputStrategy;
}

// ===== 조절 가능한 설정 값들 =====
const CORNER_HANDLE_SIZE = 10; // 꼭짓점 핸들의 시각적 크기 (픽셀)
const EDGE_HANDLE_WIDTH = 8; // 상하좌우 핸들의 두께 (픽셀)
const EDGE_HANDLE_LENGTH = 18; // 상하좌우 핸들의 길이 (픽셀)
const HANDLE_HIT_SIZE = 18; // 핸들의 클릭 가능 영역 크기 (픽셀)
const GROUP_BORDER_WIDTH = 3; // 그룹 테두리 두께 (픽셀)
// ================================

const HANDLE_HIT_HALF = HANDLE_HIT_SIZE / 2;

// 핸들 타입 정의
const HANDLES: GroupResizeHandle[] = [
  {
    id: 'nw',
    cursor: 'nwse-resize',
    x: 0,
    y: 0,
    dx: -1,
    dy: -1,
    type: 'corner',
  },
  { id: 'n', cursor: 'ns-resize', x: 0.5, y: 0, dx: 0, dy: -1, type: 'edge-h' },
  {
    id: 'ne',
    cursor: 'nesw-resize',
    x: 1,
    y: 0,
    dx: 1,
    dy: -1,
    type: 'corner',
  },
  { id: 'w', cursor: 'ew-resize', x: 0, y: 0.5, dx: -1, dy: 0, type: 'edge-v' },
  { id: 'e', cursor: 'ew-resize', x: 1, y: 0.5, dx: 1, dy: 0, type: 'edge-v' },
  {
    id: 'sw',
    cursor: 'nesw-resize',
    x: 0,
    y: 1,
    dx: -1,
    dy: 1,
    type: 'corner',
  },
  { id: 's', cursor: 'ns-resize', x: 0.5, y: 1, dx: 0, dy: 1, type: 'edge-h' },
  { id: 'se', cursor: 'nwse-resize', x: 1, y: 1, dx: 1, dy: 1, type: 'corner' },
];

// 핸들 시각적 스타일 반환
const getHandleStyle = (
  type: GroupResizeHandle['type'],
): React.CSSProperties => {
  const baseStyle: React.CSSProperties = {
    backgroundColor: 'white',
    border: '2px solid var(--ui-selection-border-strong)',
    pointerEvents: 'none',
  };

  if (type === 'corner') {
    return {
      ...baseStyle,
      width: CORNER_HANDLE_SIZE,
      height: CORNER_HANDLE_SIZE,
      borderRadius: '50%',
    };
  } else if (type === 'edge-h') {
    return {
      ...baseStyle,
      width: EDGE_HANDLE_LENGTH,
      height: EDGE_HANDLE_WIDTH,
      borderRadius: EDGE_HANDLE_WIDTH / 2,
    };
  } else {
    return {
      ...baseStyle,
      width: EDGE_HANDLE_WIDTH,
      height: EDGE_HANDLE_LENGTH,
      borderRadius: EDGE_HANDLE_WIDTH / 2,
    };
  }
};

// 개별 핸들 컴포넌트
const Handle = ({
  handle,
  centerX,
  centerY,
  rotation,
  onMouseDown,
}: HandleProps): React.ReactElement => {
  const hover = useCustomCursorHover(handle.cursor);

  const hitX = centerX - HANDLE_HIT_HALF;
  const hitY = centerY - HANDLE_HIT_HALF;

  // 플랫폼에 따른 커서 스타일 적용 (macOS는 커스텀 SVG, Windows/Linux는 기본 CSS)
  const cursorStyle = getCursor(handle.cursor);

  return (
    <div
      data-group-resize-handle={handle.id}
      style={{
        position: 'absolute',
        left: hitX,
        top: hitY,
        width: HANDLE_HIT_SIZE,
        height: HANDLE_HIT_SIZE,
        cursor: cursorStyle,
        zIndex: 'var(--z-canvas-group-handle)',
        backgroundColor: 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onMouseDown={(e) => onMouseDown(e, handle)}
      onPointerEnter={hover.onPointerEnter}
      onPointerLeave={hover.onPointerLeave}
    >
      <div
        style={{
          ...getHandleStyle(handle.type),
          ...(rotation !== 0 ? { transform: `rotate(${rotation}deg)` } : {}),
        }}
      />
    </div>
  );
};

const GroupResizeHandles = ({
  selectedElements,
  positions,
  statPositions,
  graphPositions,
  knobPositions,
  spritePositions,
  selectedKeyType,
  pluginElements,
  zoom = 1,
  panX = 0,
  panY = 0,
  previewGroupBounds,
  rotationFrame,
  onGroupResizeStart,
  onGroupResize,
  onGroupResizeEnd,
  getOtherElements,
  continuousInputStrategy = 'frame',
}: GroupResizeHandlesProps): React.ReactElement | null => {
  // 그룹 바운딩 박스 계산
  const groupData = calculateGroupBounds(
    selectedElements,
    positions,
    statPositions,
    graphPositions,
    knobPositions,
    selectedKeyType,
    pluginElements,
    spritePositions,
  );

  // 각 요소가 리사이즈 가능한지 확인
  const resizabilityInfo = selectedElements.map((element) => ({
    element,
    isResizable: isElementResizable(
      element,
      positions,
      statPositions,
      graphPositions,
      knobPositions,
      selectedKeyType,
      pluginElements,
    ),
  }));

  const nonResizableElements = resizabilityInfo.filter(
    (info) => !info.isResizable,
  );
  const resizableElements = resizabilityInfo.filter((info) => info.isResizable);

  const handleMouseDown = useGroupResizeSession({
    groupData,
    selectedElements,
    positions,
    statPositions,
    graphPositions,
    knobPositions,
    selectedKeyType,
    pluginElements,
    zoom,
    spritePositions,
    rotationFrame,
    onGroupResizeStart,
    onGroupResize,
    onGroupResizeEnd,
    getOtherElements,
    continuousInputStrategy,
  });
  if (!groupData || selectedElements.length < 2) return null;

  // 표시할 bounds (프리뷰 또는 실제)
  const displayBounds: Bounds = previewGroupBounds ||
    rotationFrame?.bounds || {
      x: groupData.x,
      y: groupData.y,
      width: groupData.width,
      height: groupData.height,
    };
  const rotation = rotationFrame?.rotation ?? 0;

  // 그룹 테두리 좌표 계산 - 내부 요소 테두리와 동일한 위치에 겹치게
  const selectionLeft = displayBounds.x * zoom + panX - 2;
  const selectionTop = displayBounds.y * zoom + panY - 2;
  const selectionWidth = displayBounds.width * zoom + 4;
  const selectionHeight = displayBounds.height * zoom + 4;

  // 핸들 위치 계산용 - 테두리 중앙에 배치하기 위해 테두리 두께의 절반만큼 오프셋
  const borderHalf = GROUP_BORDER_WIDTH / 2;
  const handleAreaLeft = selectionLeft + borderHalf;
  const handleAreaTop = selectionTop + borderHalf;
  const handleAreaWidth = selectionWidth - GROUP_BORDER_WIDTH;
  const handleAreaHeight = selectionHeight - GROUP_BORDER_WIDTH;

  // 리사이즈 불가능한 요소가 있으면 핸들 비활성화
  const _hasNonResizable = nonResizableElements.length > 0;

  return (
    <>
      {/* 그룹 바운딩 박스 테두리 */}
      <div
        data-group-resize-outline=""
        style={{
          position: 'absolute',
          left: selectionLeft,
          top: selectionTop,
          width: selectionWidth,
          height: selectionHeight,
          ...(rotation !== 0 ? { transform: `rotate(${rotation}deg)` } : {}),
          border: `${GROUP_BORDER_WIDTH}px solid var(--ui-selection-border-strong)`,
          borderRadius: '6px',
          pointerEvents: 'none' as const,
          zIndex: 'var(--z-canvas-group-outline)',
        }}
      />

      {/* 리사이즈 불가능한 요소들에 대한 표시 (주황색 점선만, 아이콘 없음) */}
      {nonResizableElements.map(({ element }) => {
        const bounds = getElementBounds(
          element,
          positions,
          statPositions,
          graphPositions,
          knobPositions,
          selectedKeyType,
          pluginElements,
          spritePositions,
        );
        if (!bounds) return null;

        return (
          <div
            key={`non-resizable-${element.id}`}
            style={{
              position: 'absolute',
              left: bounds.x * zoom + panX - 2,
              top: bounds.y * zoom + panY - 2,
              width: bounds.width * zoom + 4,
              height: bounds.height * zoom + 4,
              border: '2px dashed rgba(251, 146, 60, 0.9)',
              borderRadius: '4px',
              pointerEvents: 'none' as const,
              zIndex: 'var(--z-canvas-selection-handle)',
            }}
            title="크기 조절 불가능한 요소"
          />
        );
      })}

      {/* 리사이즈 핸들들 - 리사이즈 가능한 요소가 있을 때만 표시 */}
      {resizableElements.length > 0 &&
        HANDLES.map((handle) => {
          // 핸들을 테두리 중앙에 배치
          const center = rotatePointAround(
            {
              x: handleAreaLeft + handleAreaWidth * handle.x,
              y: handleAreaTop + handleAreaHeight * handle.y,
            },
            {
              x: selectionLeft + selectionWidth / 2,
              y: selectionTop + selectionHeight / 2,
            },
            rotation,
          );
          const rotatedHandle = rotationFrame
            ? {
                ...handle,
                cursor: resizeCursorForHandle(handle.dx, handle.dy, rotation),
              }
            : handle;

          return (
            <Handle
              key={handle.id}
              handle={rotatedHandle}
              centerX={center.x}
              centerY={center.y}
              rotation={rotation}
              onMouseDown={handleMouseDown}
            />
          );
        })}
    </>
  );
};

export default GroupResizeHandles;
