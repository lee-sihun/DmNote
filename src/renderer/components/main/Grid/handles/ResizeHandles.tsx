import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isMac } from '@utils/core/platform';
import { snapToGrid } from '@hooks/Grid/utils';
import { useSettingsStore } from '@stores/useSettingsStore';
import {
  clearPendingCustomCursorHover,
  CursorType,
  getCursor,
  isCustomCursorHoverSuspended,
  lockCustomCursor,
  setCustomCursorHover,
  setPendingCustomCursorHover,
  unlockCustomCursor,
} from '@utils/grid/cursorUtils';
import {
  createRafLatestScheduler,
  type ContinuousInputStrategy,
} from '@utils/animation/rafLatestScheduler';

/**
 * 8방향 리사이즈 핸들을 표시하는 컴포넌트
 * 단일 선택 시에만 표시됨
 */

// ===== 타입 정의 =====
interface HandleDef {
  id: string;
  cursor: CursorType;
  x: number;
  y: number;
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
  type: 'corner' | 'edge-v' | 'edge-h';
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ResizeResult {
  x: number;
  y: number;
  width: number;
  height: number;
  handle: HandleDef;
  /** 플랫폼 primary modifier 유지 중 - 스마트 가이드·크기 일치 스냅 일시 해제 */
  suppressSmartSnap: boolean;
}

interface HandleProps {
  handle: HandleDef;
  centerX: number;
  centerY: number;
  onMouseDown: (e: React.MouseEvent, handle: HandleDef) => void;
}

interface ResizeHandlesProps {
  bounds: Bounds | null;
  previewBounds?: Bounds | null;
  zoom?: number;
  panX?: number;
  panY?: number;
  onResizeStart?: (handle: HandleDef) => void;
  onResize?: (result: ResizeResult) => void;
  onResizeEnd?: () => void;
  elementId?: string;
  getOtherElements?: (excludeIds: string | string[]) => {
    id: string;
    left: number;
    top: number;
    right: number;
    bottom: number;
    centerX: number;
    centerY: number;
    width: number;
    height: number;
  }[];
  continuousInputStrategy?: ContinuousInputStrategy;
}

interface ResizeState {
  isResizing: boolean;
  handleId: string | null;
  startMouseX: number;
  startMouseY: number;
  startBounds: Bounds | null;
  startAspectRatio: number;
  handle?: HandleDef;
}

// ===== 조절 가능한 설정 값들 =====
const CORNER_HANDLE_SIZE = 10; // 꼭짓점 핸들의 시각적 크기 (픽셀)
const EDGE_HANDLE_WIDTH = 8; // 상하좌우 핸들의 두께 (픽셀) - 꼭짓점과 비슷한 두께
const EDGE_HANDLE_LENGTH = 18; // 상하좌우 핸들의 길이 (픽셀)
const HANDLE_HIT_SIZE = 18; // 핸들의 클릭 가능 영역 크기 (픽셀) - 이 값을 조절하여 잡는 범위 변경
const MIN_SIZE = 10; // 키의 최소 크기 (픽셀)
// ================================

const HANDLE_HIT_HALF = HANDLE_HIT_SIZE / 2;

// 핸들 타입 정의 (corner: 꼭짓점, edge-v: 수직 방향 모서리, edge-h: 수평 방향 모서리)
const HANDLES: HandleDef[] = [
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
  type: string,
  isHovered: boolean,
): React.CSSProperties => {
  const baseStyle: React.CSSProperties = {
    backgroundColor: isHovered
      ? 'var(--ui-selection)'
      : 'var(--ui-handle-fill)',
    border: '1.5px solid var(--ui-selection-border-strong)',
    pointerEvents: 'none',
    transition: 'background-color 0.15s ease',
  };

  if (type === 'corner') {
    return {
      ...baseStyle,
      width: CORNER_HANDLE_SIZE,
      height: CORNER_HANDLE_SIZE,
      borderRadius: '50%',
    };
  } else if (type === 'edge-h') {
    // 상/하 핸들: 가로로 긴 형태
    return {
      ...baseStyle,
      width: EDGE_HANDLE_LENGTH,
      height: EDGE_HANDLE_WIDTH,
      borderRadius: EDGE_HANDLE_WIDTH / 2,
    };
  } else {
    // edge-v: 좌/우 핸들: 세로로 긴 형태
    return {
      ...baseStyle,
      width: EDGE_HANDLE_WIDTH,
      height: EDGE_HANDLE_LENGTH,
      borderRadius: EDGE_HANDLE_WIDTH / 2,
    };
  }
};

// 개별 핸들 컴포넌트 (호버 상태 관리)
const Handle = ({ handle, centerX, centerY, onMouseDown }: HandleProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const hoveredRef = useRef(false);
  const pendingApplyRef = useRef<(() => void) | null>(null);

  // 호버 중 unmount로 leave가 유실되면 남는 커서 오버레이·보류 기록 정리
  useEffect(() => {
    return () => {
      if (pendingApplyRef.current) {
        clearPendingCustomCursorHover(pendingApplyRef.current);
        pendingApplyRef.current = null;
      }
      if (hoveredRef.current) setCustomCursorHover(null);
    };
  }, []);

  const setHovered = (next: boolean) => {
    hoveredRef.current = next;
    setIsHovered(next);
  };

  const hitX = centerX - HANDLE_HIT_HALF;
  const hitY = centerY - HANDLE_HIT_HALF;

  // 플랫폼에 따른 커서 스타일 적용 (macOS는 커스텀 SVG, Windows/Linux는 기본 CSS)
  const cursorStyle = getCursor(handle.cursor);

  return (
    <div
      data-resize-handle={handle.id}
      style={{
        position: 'absolute',
        left: hitX,
        top: hitY,
        width: HANDLE_HIT_SIZE,
        height: HANDLE_HIT_SIZE,
        cursor: cursorStyle,
        zIndex: 'var(--z-canvas-selection-handle)',
        backgroundColor: 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onMouseDown={(e) => onMouseDown(e, handle)}
      onPointerEnter={(e) => {
        // 드래그 세션 중 enter는 즉시 적용하지 않고 보류 기록 - 릴리즈 후
        // resume 시점에 포인터가 핸들 안이면 그 hover를 적용한다
        if (isCustomCursorHoverSuspended()) {
          const apply = () => {
            pendingApplyRef.current = null;
            setHovered(true);
          };
          pendingApplyRef.current = apply;
          setPendingCustomCursorHover(handle.cursor, apply, e.nativeEvent);
          return;
        }
        setHovered(true);
        setCustomCursorHover(handle.cursor, e.nativeEvent);
      }}
      onPointerLeave={(e) => {
        // 자기 보류 기록만 소거 - 다른 핸들의 pending은 건드리지 않는다
        if (pendingApplyRef.current) {
          clearPendingCustomCursorHover(pendingApplyRef.current);
          pendingApplyRef.current = null;
        }
        setHovered(false);
        setCustomCursorHover(null, e.nativeEvent);
      }}
    >
      {/* 시각적 핸들 (히트 영역 중앙에 배치) */}
      <div style={getHandleStyle(handle.type, isHovered)} />
    </div>
  );
};

const ResizeHandles = ({
  bounds, // { x, y, width, height } - 그리드 좌표
  previewBounds, // { x, y, width, height } - 드래그 중 프리뷰용 bounds (선택적)
  zoom = 1,
  panX = 0,
  panY = 0,
  onResizeStart,
  onResize,
  onResizeEnd,
  elementId: _elementId, // 스마트 가이드용 요소 ID
  getOtherElements: _getOtherElements, // 스마트 가이드용 다른 요소 가져오기 함수
  continuousInputStrategy = 'frame',
}: ResizeHandlesProps) => {
  const resizeRef = useRef<ResizeState>({
    isResizing: false,
    handleId: null,
    startMouseX: 0,
    startMouseY: 0,
    startBounds: null,
    startAspectRatio: 1,
  });
  const activeResizeCleanupRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    return () => activeResizeCleanupRef.current?.();
  }, []);

  const handleMouseDown = (e: React.MouseEvent, handle: HandleDef) => {
    e.preventDefault();
    e.stopPropagation();
    lockCustomCursor(handle.cursor, e.nativeEvent);

    const startAspectRatio =
      Number.isFinite(bounds?.width) &&
      Number.isFinite(bounds?.height) &&
      bounds!.width > 0 &&
      bounds!.height > 0
        ? bounds!.width / bounds!.height
        : 1;

    resizeRef.current = {
      isResizing: true,
      handleId: handle.id,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startBounds: { ...bounds! },
      handle,
      startAspectRatio,
    };

    let resizeStarted = false;
    let resizeFinished = false;

    const applyMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeRef.current.isResizing) return;

      const {
        handle,
        startMouseX,
        startMouseY,
        startBounds,
        startAspectRatio,
      } = resizeRef.current;

      // 마우스 이동량 계산 (줌 보정)
      const rawDeltaX = (moveEvent.clientX - startMouseX) / zoom;
      const rawDeltaY = (moveEvent.clientY - startMouseY) / zoom;

      // store에서 스냅 크기 가져오기
      const snapSize =
        useSettingsStore.getState().gridSettings?.gridSnapSize ?? 5;

      const snap = (value: number): number => snapToGrid(value, snapSize);

      // 새 bounds 계산 (스냅 전)
      let nextWidth = startBounds!.width;
      let nextHeight = startBounds!.height;

      // 핸들 방향에 따라 크기 조정 (크기만 계산)
      if (handle!.dx === -1) {
        nextWidth = Math.max(MIN_SIZE, startBounds!.width - rawDeltaX);
      } else if (handle!.dx === 1) {
        nextWidth = Math.max(MIN_SIZE, startBounds!.width + rawDeltaX);
      }

      if (handle!.dy === -1) {
        nextHeight = Math.max(MIN_SIZE, startBounds!.height - rawDeltaY);
      } else if (handle!.dy === 1) {
        nextHeight = Math.max(MIN_SIZE, startBounds!.height + rawDeltaY);
      }

      const keepAspect =
        !!moveEvent.shiftKey &&
        Number.isFinite(startAspectRatio) &&
        startAspectRatio > 0 &&
        Number.isFinite(startBounds!.width) &&
        Number.isFinite(startBounds!.height) &&
        startBounds!.width > 0 &&
        startBounds!.height > 0;

      let newWidth = nextWidth;
      let newHeight = nextHeight;

      if (keepAspect) {
        const isCorner = handle!.dx !== 0 && handle!.dy !== 0;
        const primary =
          handle!.dx !== 0 && handle!.dy === 0
            ? 'width'
            : handle!.dy !== 0 && handle!.dx === 0
            ? 'height'
            : isCorner
            ? (() => {
                const relW =
                  Math.abs(newWidth - startBounds!.width) / startBounds!.width;
                const relH =
                  Math.abs(newHeight - startBounds!.height) /
                  startBounds!.height;
                return relW >= relH ? 'width' : 'height';
              })()
            : 'width';

        if (primary === 'width') {
          newWidth = Math.max(MIN_SIZE, snap(newWidth));
          const scale = newWidth / startBounds!.width;
          newHeight = Math.max(MIN_SIZE, startBounds!.height * scale);
        } else {
          newHeight = Math.max(MIN_SIZE, snap(newHeight));
          const scale = newHeight / startBounds!.height;
          newWidth = Math.max(MIN_SIZE, startBounds!.width * scale);
        }
      } else {
        // 드래그한 축만 스냅 - 반대 축까지 스냅하면 비배수 크기의 요소가
        // 가로/세로 전용 리사이즈마다 1px씩 밀린다 (중앙 보정이 절반을 이동)
        if (handle!.dx !== 0) {
          newWidth = Math.max(MIN_SIZE, snap(newWidth));
        }
        if (handle!.dy !== 0) {
          newHeight = Math.max(MIN_SIZE, snap(newHeight));
        }
      }

      // 위치 계산 (앵커 엣지 보존: 드래그하지 않은 쪽은 고정)
      let newX = startBounds!.x;
      let newY = startBounds!.y;

      if (handle!.dx === -1) {
        // 좌측 핸들: 우측 엣지가 앵커 — 위치 스냅 후 width를 앵커에서 역산
        const rightAnchor = startBounds!.x + startBounds!.width;
        newX = snap(rightAnchor - newWidth);
        newWidth = rightAnchor - newX;
      } else if (handle!.dx === 0) {
        // 비례 유지 시 중앙 정렬 (스냅 없이 앵커 보존)
        newX = startBounds!.x + (startBounds!.width - newWidth) / 2;
      }
      // dx === 1: newX = startBounds.x (좌측 앵커 유지)

      if (handle!.dy === -1) {
        // 상단 핸들: 하단 엣지가 앵커 — 위치 스냅 후 height를 앵커에서 역산
        const bottomAnchor = startBounds!.y + startBounds!.height;
        newY = snap(bottomAnchor - newHeight);
        newHeight = bottomAnchor - newY;
      } else if (handle!.dy === 0) {
        // 비례 유지 시 중앙 정렬 (스냅 없이 앵커 보존)
        newY = startBounds!.y + (startBounds!.height - newHeight) / 2;
      }
      // dy === 1: newY = startBounds.y (상단 앵커 유지)

      const result = {
        x: newX,
        y: newY,
        width: newWidth,
        height: newHeight,
        handle: handle!,
        suppressSmartSnap: isMac() ? moveEvent.metaKey : moveEvent.ctrlKey,
      };
      const changed =
        result.x !== startBounds!.x ||
        result.y !== startBounds!.y ||
        result.width !== startBounds!.width ||
        result.height !== startBounds!.height;
      if (!resizeStarted && changed) {
        resizeStarted = true;
        onResizeStart?.(handle!);
      }
      if (resizeStarted) onResize?.(result);
    };
    const moveScheduler = createRafLatestScheduler(
      applyMouseMove,
      continuousInputStrategy,
    );
    const handleMouseMove = (moveEvent: MouseEvent) => {
      moveScheduler.push(moveEvent);
    };

    const handleMouseUp = () => {
      if (resizeFinished) return;
      moveScheduler.flush();
      resizeFinished = true;
      resizeRef.current.isResizing = false;
      activeResizeCleanupRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
      window.removeEventListener('pointercancel', handleMouseUp);
      unlockCustomCursor();
      if (resizeStarted) onResizeEnd?.();
      moveScheduler.cancel();
    };

    activeResizeCleanupRef.current = handleMouseUp;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);
    window.addEventListener('pointercancel', handleMouseUp);
  };

  if (!bounds) return null;

  // 프리뷰 bounds가 있으면 프리뷰용으로 사용, 없으면 실제 bounds 사용
  const displayBounds = previewBounds || bounds;

  // 선택 테두리의 중심선 기준 좌표 (테두리 두께 2px의 중심 = 1px)
  const borderThickness = 2;
  const borderCenter = borderThickness / 2; // 테두리의 중심선까지의 거리
  const selectionLeft = displayBounds.x * zoom + panX - borderCenter;
  const selectionTop = displayBounds.y * zoom + panY - borderCenter;
  const selectionWidth = displayBounds.width * zoom + borderCenter * 2;
  const selectionHeight = displayBounds.height * zoom + borderCenter * 2;

  return (
    <>
      {HANDLES.map((handle) => {
        // 핸들 중심 위치 계산 (선택 테두리의 가장자리 중앙에 배치)
        const centerX = selectionLeft + selectionWidth * handle.x;
        const centerY = selectionTop + selectionHeight * handle.y;

        return (
          <Handle
            key={handle.id}
            handle={handle}
            centerX={centerX}
            centerY={centerY}
            onMouseDown={handleMouseDown}
          />
        );
      })}
    </>
  );
};

export default ResizeHandles;
