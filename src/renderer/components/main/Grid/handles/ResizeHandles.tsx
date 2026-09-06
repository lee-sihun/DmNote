import React, { useLayoutEffect, useRef } from 'react';
import { isMac } from '@utils/core/platform';
import { snapToGrid } from '@hooks/Grid/utils';
import { useSettingsStore } from '@stores/useSettingsStore';
import {
  CursorType,
  getCursor,
  lockCustomCursor,
  unlockCustomCursor,
} from '@utils/grid/cursorUtils';
import { useCustomCursorHover } from '@hooks/Grid/viewport/useCustomCursorHover';
import {
  createRafLatestScheduler,
  type ContinuousInputStrategy,
} from '@utils/animation/rafLatestScheduler';
import {
  aspectScaleFromPrimary,
  aspectScaleRange,
  exactSizeFor,
  scaleBoundsAnchored,
  settleAspectScale,
  type AspectPrimaryAxis,
  type ScaleRange,
} from './aspectResize';
import { SELECTION_BORDER_CENTER } from './selectionOutline';
import { rotatePointAround } from '@utils/element/rotation';
import {
  anchorRotatedResize,
  constrainRotatedResize,
  resizeCursorForHandle,
  screenDeltaToLocal,
} from './rotatedResize';

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
  /** 비율 고정 중 - 스마트 스냅은 기준 축만 받고 반대 축은 같은 배율로 다시 구한다 */
  aspect?: {
    start: Bounds;
    primary: AspectPrimaryAxis;
    range: ScaleRange;
  };
}

interface HandleProps {
  handle: HandleDef;
  centerX: number;
  centerY: number;
  // 요소 회전(도) - 핸들 모양이 틀과 같은 각도로 돈다
  rotation: number;
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
  /** 항상 비율 유지 - 그림 레이어(스프라이트)처럼 늘리면 안 되는 요소 */
  lockAspect?: boolean;
  /** 다른 표식이 차지한 자리(정규화 좌표) - 그 자리 핸들은 그리지 않는다 */
  occupiedHandle?: { x: number; y: number } | null;
  /** 요소 회전(도). 틀·핸들·드래그 축이 함께 돌고 저장 상자는 축 정렬 유지 */
  rotation?: number;
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
const getHandleStyle = (type: string): React.CSSProperties => {
  const baseStyle: React.CSSProperties = {
    backgroundColor: 'white',
    border: '1.5px solid var(--ui-selection-border-strong)',
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

// 개별 핸들 컴포넌트
const Handle = ({
  handle,
  centerX,
  centerY,
  rotation,
  onMouseDown,
}: HandleProps) => {
  const hover = useCustomCursorHover(handle.cursor);

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
      onPointerEnter={hover.onPointerEnter}
      onPointerLeave={hover.onPointerLeave}
    >
      {/* 시각적 핸들 (히트 영역 중앙에 배치) */}
      <div
        style={{
          ...getHandleStyle(handle.type),
          ...(rotation !== 0 ? { transform: `rotate(${rotation}deg)` } : {}),
        }}
      />
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
  lockAspect = false,
  occupiedHandle = null,
  rotation = 0,
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

      // 마우스 이동량 계산 (줌 보정). 회전 요소는 틀의 로컬 축으로 되돌려
      // 아래 축 정렬 수식을 그대로 쓴다
      const screenDelta = screenDeltaToLocal(
        (moveEvent.clientX - startMouseX) / zoom,
        (moveEvent.clientY - startMouseY) / zoom,
        rotation,
      );
      const rawDeltaX = screenDelta.x;
      const rawDeltaY = screenDelta.y;

      // store에서 스냅 크기 가져오기
      const snapSize =
        useSettingsStore.getState().gridSettings?.gridSnapSize ?? 5;

      const snap = (value: number): number => snapToGrid(value, snapSize);

      const keepAspect =
        (lockAspect || !!moveEvent.shiftKey) &&
        Number.isFinite(startAspectRatio) &&
        startAspectRatio > 0 &&
        Number.isFinite(startBounds!.width) &&
        Number.isFinite(startBounds!.height) &&
        startBounds!.width > 0 &&
        startBounds!.height > 0;

      let newX = startBounds!.x;
      let newY = startBounds!.y;
      let newWidth = startBounds!.width;
      let newHeight = startBounds!.height;
      let aspect: ResizeResult['aspect'];

      if (keepAspect) {
        // 비율 고정은 배율 하나로만 움직인다. 하한 floor 없는 raw 후보로 기준 축을
        // 고르고(변 핸들은 그 축, 모서리는 상대 변화가 큰 축) 공용 규칙으로 배율을
        // 자른 뒤 잡지 않은 가장자리를 고정한다. 파생 축에 하한을 따로 먹이면
        // 얇은 요소의 비율이 깨지고, 상한이 없으면 백엔드가 커밋을 거부한다
        const rawWidth =
          handle!.dx === -1
            ? startBounds!.width - rawDeltaX
            : handle!.dx === 1
            ? startBounds!.width + rawDeltaX
            : startBounds!.width;
        const rawHeight =
          handle!.dy === -1
            ? startBounds!.height - rawDeltaY
            : handle!.dy === 1
            ? startBounds!.height + rawDeltaY
            : startBounds!.height;
        const isCorner = handle!.dx !== 0 && handle!.dy !== 0;
        const primary: AspectPrimaryAxis =
          handle!.dx !== 0 && handle!.dy === 0
            ? 'width'
            : handle!.dy !== 0 && handle!.dx === 0
            ? 'height'
            : isCorner
            ? (() => {
                const relW =
                  Math.abs(rawWidth - startBounds!.width) / startBounds!.width;
                const relH =
                  Math.abs(rawHeight - startBounds!.height) /
                  startBounds!.height;
                return relW >= relH ? 'width' : 'height';
              })()
            : 'width';
        // 그리드 스냅 기준은 방향별 현행 유지 - 오른쪽·아래는 크기, 왼쪽·위는
        // 움직이는 가장자리 좌표
        const snapPrimarySize = (size: number): number => {
          if (primary === 'width') {
            if (handle!.dx !== -1) return snap(size);
            const right = startBounds!.x + startBounds!.width;
            return right - snap(right - size);
          }
          if (handle!.dy !== -1) return snap(size);
          const bottom = startBounds!.y + startBounds!.height;
          return bottom - snap(bottom - size);
        };
        const range = aspectScaleRange(
          startBounds!,
          handle!,
          MIN_SIZE,
          rotation,
        );
        const primaryScale = aspectScaleFromPrimary(
          startBounds!,
          primary,
          primary === 'width' ? rawWidth : rawHeight,
          snapPrimarySize,
          range,
        );
        const scale = settleAspectScale(
          startBounds!,
          primaryScale.scale,
          handle!,
          range,
          primaryScale.exact,
          rotation,
        );
        const scaled = scaleBoundsAnchored(
          startBounds!,
          scale,
          handle!,
          exactSizeFor(
            startBounds!,
            scale,
            primaryScale.scale,
            primaryScale.exact,
          ),
        );
        newX = scaled.x;
        newY = scaled.y;
        newWidth = scaled.width;
        newHeight = scaled.height;
        aspect = { start: { ...startBounds! }, primary, range };
      } else {
        // 핸들 방향에 따라 크기 조정 (크기만 계산)
        if (handle!.dx === -1) {
          newWidth = Math.max(MIN_SIZE, startBounds!.width - rawDeltaX);
        } else if (handle!.dx === 1) {
          newWidth = Math.max(MIN_SIZE, startBounds!.width + rawDeltaX);
        }

        if (handle!.dy === -1) {
          newHeight = Math.max(MIN_SIZE, startBounds!.height - rawDeltaY);
        } else if (handle!.dy === 1) {
          newHeight = Math.max(MIN_SIZE, startBounds!.height + rawDeltaY);
        }

        // 드래그한 축만 스냅 - 반대 축까지 스냅하면 비배수 크기의 요소가
        // 가로/세로 전용 리사이즈마다 1px씩 밀린다 (중앙 보정이 절반을 이동)
        if (handle!.dx !== 0) {
          newWidth = Math.max(MIN_SIZE, snap(newWidth));
        }
        if (handle!.dy !== 0) {
          newHeight = Math.max(MIN_SIZE, snap(newHeight));
        }

        // 위치 계산 (앵커 엣지 보존: 드래그하지 않은 쪽은 고정)
        if (handle!.dx === -1) {
          // 좌측 핸들: 우측 엣지가 앵커 - 위치 스냅 후 width를 앵커에서 역산
          const rightAnchor = startBounds!.x + startBounds!.width;
          newX = snap(rightAnchor - newWidth);
          newWidth = rightAnchor - newX;
        }
        // dx === 1: newX = startBounds.x (좌측 앵커 유지)

        if (handle!.dy === -1) {
          // 상단 핸들: 하단 엣지가 앵커 - 위치 스냅 후 height를 앵커에서 역산
          const bottomAnchor = startBounds!.y + startBounds!.height;
          newY = snap(bottomAnchor - newHeight);
          newHeight = bottomAnchor - newY;
        }
        // dy === 1: newY = startBounds.y (상단 앵커 유지)
      }

      // 회전 요소는 반대 변이 화면에서 고정되도록 중심 이동만 회전시킨다.
      // 스마트 가이드는 논리 상자 변이 화면 변과 다르므로 회전 중엔 쓰지 않는다
      const rotated = anchorRotatedResize(
        startBounds!,
        { x: newX, y: newY, width: newWidth, height: newHeight },
        rotation,
      );
      const anchored =
        rotation !== 0 && !keepAspect
          ? constrainRotatedResize(startBounds!, rotated)
          : rotated;
      const result: ResizeResult = {
        x: anchored.x,
        y: anchored.y,
        width: anchored.width,
        height: anchored.height,
        handle: handle!,
        suppressSmartSnap:
          rotation !== 0 || (isMac() ? moveEvent.metaKey : moveEvent.ctrlKey),
        aspect,
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

  // 선택 테두리의 중심선 기준 좌표 - 핸들은 테두리 선 위에 앉는다
  const borderCenter = SELECTION_BORDER_CENTER;
  const selectionLeft = displayBounds.x * zoom + panX - borderCenter;
  const selectionTop = displayBounds.y * zoom + panY - borderCenter;
  const selectionWidth = displayBounds.width * zoom + borderCenter * 2;
  const selectionHeight = displayBounds.height * zoom + borderCenter * 2;

  return (
    <>
      {HANDLES.filter(
        (handle) =>
          !occupiedHandle ||
          handle.x !== occupiedHandle.x ||
          handle.y !== occupiedHandle.y,
      ).map((handle) => {
        // 핸들 중심 위치 계산 (선택 테두리의 가장자리 중앙에 배치). 회전 요소는
        // 틀 중심 기준으로 같이 돌고 커서도 화면 방향에 맞춘다
        const center = rotatePointAround(
          {
            x: selectionLeft + selectionWidth * handle.x,
            y: selectionTop + selectionHeight * handle.y,
          },
          {
            x: selectionLeft + selectionWidth / 2,
            y: selectionTop + selectionHeight / 2,
          },
          rotation,
        );
        const rotatedHandle =
          rotation === 0
            ? handle
            : {
                ...handle,
                cursor: resizeCursorForHandle(handle.dx, handle.dy, rotation),
              };

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

export default ResizeHandles;
