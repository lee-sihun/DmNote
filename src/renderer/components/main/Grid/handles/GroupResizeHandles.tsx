import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isMac } from '@utils/core/platform';
import { useSmartGuidesStore } from '@stores/grid/useSmartGuidesStore';
import { useSettingsStore } from '@stores/useSettingsStore';
import {
  calculateBounds,
  calculateSnapPoints,
  calculateSizeSnap,
  type ElementBounds as SmartGuideElementBounds,
  type SizeSnapResult,
  type SpacingGuide,
} from '@utils/grid/smartGuides';
import {
  clearPendingCustomCursorHover,
  type CursorType,
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
import type { CanonicalEditorDocumentV1 } from '@src/types/editor';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import {
  isElementResizable,
  getElementBounds,
  calculateGroupBounds,
  elementBoundsChanged,
  type Bounds,
  type SelectedElement,
  type ElementBounds,
} from './groupResizeUtils';

/**
 * 다중 선택 시 그룹 전체를 감싸는 리사이즈 핸들을 표시하는 컴포넌트
 * 선택된 모든 요소의 바운딩 박스를 계산하고, 비율을 유지하며 크기를 조절합니다.
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

interface HandleProps {
  handle: HandleDef;
  centerX: number;
  centerY: number;
  onMouseDown: (e: React.MouseEvent, handle: HandleDef) => void;
}

interface GroupResizeHandlesProps {
  selectedElements: SelectedElement[];
  positions: CanonicalEditorDocumentV1['keyPositions'];
  statPositions: CanonicalEditorDocumentV1['statPositions'];
  graphPositions: CanonicalEditorDocumentV1['graphPositions'];
  knobPositions: CanonicalEditorDocumentV1['knobPositions'];
  selectedKeyType: string;
  pluginElements: PluginDisplayElementInternal[];
  zoom?: number;
  panX?: number;
  panY?: number;
  previewGroupBounds?: Bounds | null;
  onGroupResizeStart?: (handle: HandleDef) => void;
  onGroupResize?: (result: {
    groupBounds: Bounds;
    elementBounds: ElementBounds[];
    handle: HandleDef;
  }) => void;
  onGroupResizeEnd?: () => void;
  getOtherElements?: (excludeIds: string[]) => SmartGuideElementBounds[];
  continuousInputStrategy?: ContinuousInputStrategy;
}

interface ResizeState {
  isResizing: boolean;
  handleId: string | null;
  startMouseX: number;
  startMouseY: number;
  startGroupBounds: Bounds | null;
  startElementBounds: ElementBounds[];
  nonResizableElementBounds?: ElementBounds[];
  maxShrinkX: number;
  maxShrinkY: number;
  handle?: HandleDef;
}

// ===== 조절 가능한 설정 값들 =====
const CORNER_HANDLE_SIZE = 10; // 꼭짓점 핸들의 시각적 크기 (픽셀)
const EDGE_HANDLE_WIDTH = 8; // 상하좌우 핸들의 두께 (픽셀)
const EDGE_HANDLE_LENGTH = 18; // 상하좌우 핸들의 길이 (픽셀)
const HANDLE_HIT_SIZE = 18; // 핸들의 클릭 가능 영역 크기 (픽셀)
const MIN_SIZE = 10; // 최소 크기 (픽셀)
const GROUP_BORDER_WIDTH = 3; // 그룹 테두리 두께 (픽셀)
// ================================

const HANDLE_HIT_HALF = HANDLE_HIT_SIZE / 2;

// 핸들 타입 정의
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
  type: HandleDef['type'],
  isHovered: boolean,
): React.CSSProperties => {
  const baseStyle: React.CSSProperties = {
    backgroundColor: isHovered ? 'var(--ui-selection)' : 'white',
    border: '2px solid var(--ui-selection-border-strong)',
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
  onMouseDown,
}: HandleProps): React.ReactElement => {
  const [isHovered, setIsHovered] = useState<boolean>(false);
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
      data-group-resize-handle={handle.id}
      style={{
        position: 'absolute',
        left: hitX,
        top: hitY,
        width: HANDLE_HIT_SIZE,
        height: HANDLE_HIT_SIZE,
        cursor: cursorStyle,
        zIndex: 25,
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
      <div style={getHandleStyle(handle.type, isHovered)} />
    </div>
  );
};

const GroupResizeHandles = ({
  selectedElements,
  positions,
  statPositions,
  graphPositions,
  knobPositions,
  selectedKeyType,
  pluginElements,
  zoom = 1,
  panX = 0,
  panY = 0,
  previewGroupBounds,
  onGroupResizeStart,
  onGroupResize,
  onGroupResizeEnd,
  getOtherElements,
  continuousInputStrategy = 'frame',
}: GroupResizeHandlesProps): React.ReactElement | null => {
  const resizeRef = useRef<ResizeState>({
    isResizing: false,
    handleId: null,
    startMouseX: 0,
    startMouseY: 0,
    startGroupBounds: null,
    startElementBounds: [],
    maxShrinkX: 0,
    maxShrinkY: 0,
  });
  const activeResizeCleanupRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    return () => activeResizeCleanupRef.current?.();
  }, []);

  // 그룹 바운딩 박스 계산
  const groupData = calculateGroupBounds(
    selectedElements,
    positions,
    statPositions,
    graphPositions,
    knobPositions,
    selectedKeyType,
    pluginElements,
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

  const handleMouseDown = (e: React.MouseEvent, handle: HandleDef) => {
    e.preventDefault();
    e.stopPropagation();
    lockCustomCursor(handle.cursor, e.nativeEvent);

    if (!groupData) return;

    // 리사이즈 가능한 요소만 처리 (리사이즈 불가능한 요소의 bounds도 기억)
    const resizableElementBounds = groupData.elementBounds.filter(
      ({ element }) =>
        isElementResizable(
          element,
          positions,
          statPositions,
          graphPositions,
          knobPositions,
          selectedKeyType,
          pluginElements,
        ),
    );

    const nonResizableElementBounds = groupData.elementBounds.filter(
      ({ element }) =>
        !isElementResizable(
          element,
          positions,
          statPositions,
          graphPositions,
          knobPositions,
          selectedKeyType,
          pluginElements,
        ),
    );

    const getMaxShrink = (
      boundsList: ElementBounds[],
      groupSize: number,
      axis: 'x' | 'y',
    ): number => {
      if (!Number.isFinite(groupSize) || groupSize <= 0) return 0;
      let minScale = 0;
      for (const { bounds } of boundsList) {
        const size = axis === 'x' ? bounds.width : bounds.height;
        if (!Number.isFinite(size) || size <= 0) continue;
        if (size >= MIN_SIZE) {
          minScale = Math.max(minScale, MIN_SIZE / size);
        }
      }
      const groupMinScale = MIN_SIZE / groupSize;
      minScale = Math.min(1, Math.max(minScale, groupMinScale));
      return groupSize * (1 - minScale);
    };

    resizeRef.current = {
      isResizing: true,
      handleId: handle.id,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startGroupBounds: {
        x: groupData.x,
        y: groupData.y,
        width: groupData.width,
        height: groupData.height,
      },
      startElementBounds: resizableElementBounds,
      nonResizableElementBounds: nonResizableElementBounds,
      maxShrinkX: getMaxShrink(resizableElementBounds, groupData.width, 'x'),
      maxShrinkY: getMaxShrink(resizableElementBounds, groupData.height, 'y'),
      handle,
    };

    let resizeStarted = false;
    let resizeFinished = false;

    const applyMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeRef.current.isResizing) return;

      const {
        handle,
        startMouseX,
        startMouseY,
        startGroupBounds,
        startElementBounds,
        nonResizableElementBounds,
        maxShrinkX,
        maxShrinkY,
      } = resizeRef.current;

      if (!handle || !startGroupBounds) return;

      // 마우스 이동량 계산 (줌 보정)
      const rawDeltaX = (moveEvent.clientX - startMouseX) / zoom;
      const rawDeltaY = (moveEvent.clientY - startMouseY) / zoom;

      // store에서 스냅 크기 가져오기
      const snapSize =
        useSettingsStore.getState().gridSettings?.gridSnapSize || 5;

      const snapDelta = (delta: number): number =>
        Math.round(delta / snapSize) * snapSize;

      const clampShrinkDelta = (
        delta: number,
        handleDir: -1 | 0 | 1,
        maxShrink: number,
      ): number => {
        if (!Number.isFinite(maxShrink) || maxShrink <= 0) return delta;
        const maxSnapped = Math.floor(maxShrink / snapSize) * snapSize;
        if (handleDir === -1) {
          return Math.min(delta, maxSnapped);
        }
        if (handleDir === 1) {
          return Math.max(delta, -maxSnapped);
        }
        return delta;
      };

      let snappedDeltaX = handle.dx !== 0 ? snapDelta(rawDeltaX) : 0;
      let snappedDeltaY = handle.dy !== 0 ? snapDelta(rawDeltaY) : 0;

      if (handle.dx !== 0) {
        snappedDeltaX = clampShrinkDelta(snappedDeltaX, handle.dx, maxShrinkX);
      }
      if (handle.dy !== 0) {
        snappedDeltaY = clampShrinkDelta(snappedDeltaY, handle.dy, maxShrinkY);
      }

      // 새 그룹 bounds 계산
      let newGroupX = startGroupBounds.x;
      let newGroupY = startGroupBounds.y;
      let newGroupWidth = startGroupBounds.width;
      let newGroupHeight = startGroupBounds.height;

      // 핸들 방향에 따라 크기 조정
      if (handle.dx === -1) {
        newGroupWidth = Math.max(
          MIN_SIZE,
          startGroupBounds.width - snappedDeltaX,
        );
        if (newGroupWidth > MIN_SIZE) {
          newGroupX = startGroupBounds.x + snappedDeltaX;
        } else {
          newGroupX = startGroupBounds.x + startGroupBounds.width - MIN_SIZE;
        }
      } else if (handle.dx === 1) {
        newGroupWidth = Math.max(
          MIN_SIZE,
          startGroupBounds.width + snappedDeltaX,
        );
      }

      if (handle.dy === -1) {
        newGroupHeight = Math.max(
          MIN_SIZE,
          startGroupBounds.height - snappedDeltaY,
        );
        if (newGroupHeight > MIN_SIZE) {
          newGroupY = startGroupBounds.y + snappedDeltaY;
        } else {
          newGroupY = startGroupBounds.y + startGroupBounds.height - MIN_SIZE;
        }
      } else if (handle.dy === 1) {
        newGroupHeight = Math.max(
          MIN_SIZE,
          startGroupBounds.height + snappedDeltaY,
        );
      }

      // 최소 크기 보장
      newGroupWidth = Math.max(MIN_SIZE, newGroupWidth);
      newGroupHeight = Math.max(MIN_SIZE, newGroupHeight);

      // === 스마트 가이드 스냅 적용 (그룹 바운딩 박스 기준) ===
      const smartGuidesStore = useSmartGuidesStore.getState();
      const gridSettings = useSettingsStore.getState().gridSettings;
      // 플랫폼 primary modifier로 스마트 스냅 일시 해제 (그리드 스냅은 유지)
      const suppressSmartSnap = isMac() ? moveEvent.metaKey : moveEvent.ctrlKey;
      const alignmentGuidesEnabled =
        gridSettings?.alignmentGuides !== false && !suppressSmartSnap;
      const spacingGuidesEnabled = gridSettings?.spacingGuides !== false;
      const sizeMatchGuidesEnabled = gridSettings?.sizeMatchGuides !== false;

      // 선택된 요소들의 ID 수집 (스마트 가이드에서 제외).
      // 선택 id와 가이드 bounds id가 같은 생성자(position.id)를 쓰므로 그대로 넘긴다
      const selectedIds = selectedElements.map((el) => el.id);

      if (suppressSmartSnap) {
        smartGuidesStore.clearGuides();
      } else if (getOtherElements && alignmentGuidesEnabled) {
        const otherElements = getOtherElements(selectedIds);

        // 그룹 바운딩 박스를 기준으로 스냅 계산
        const groupBoundsForSnap = calculateBounds(
          newGroupX,
          newGroupY,
          newGroupWidth,
          newGroupHeight,
          'group',
        );

        const snapResult = calculateSnapPoints(
          groupBoundsForSnap,
          otherElements,
          undefined,
          { disableSpacing: !spacingGuidesEnabled },
        );

        // X축 스냅 적용
        if (
          handle.dx !== 0 &&
          snapResult.didSnapX &&
          !(snapResult.didSpacingSnapX && !spacingGuidesEnabled)
        ) {
          if (handle.dx === -1) {
            // 왼쪽 핸들: 왼쪽 가장자리 스냅
            const widthDiff = newGroupX - snapResult.snappedX;
            newGroupX = snapResult.snappedX;
            newGroupWidth = newGroupWidth + widthDiff;
          } else if (handle.dx === 1) {
            // 오른쪽 핸들: 오른쪽 가장자리 스냅
            const snappedRight = snapResult.snappedX + groupBoundsForSnap.width;
            newGroupWidth = snappedRight - newGroupX;
          } else if (handle.dx === 0) {
            // 수직 핸들 (상/하): 중앙 정렬 스냅
            newGroupX = snapResult.snappedX;
          }
        }

        // Y축 스냅 적용
        if (
          handle.dy !== 0 &&
          snapResult.didSnapY &&
          !(snapResult.didSpacingSnapY && !spacingGuidesEnabled)
        ) {
          if (handle.dy === -1) {
            // 위쪽 핸들: 위쪽 가장자리 스냅
            const heightDiff = newGroupY - snapResult.snappedY;
            newGroupY = snapResult.snappedY;
            newGroupHeight = newGroupHeight + heightDiff;
          } else if (handle.dy === 1) {
            // 아래쪽 핸들: 아래쪽 가장자리 스냅
            const snappedBottom =
              snapResult.snappedY + groupBoundsForSnap.height;
            newGroupHeight = snappedBottom - newGroupY;
          } else if (handle.dy === 0) {
            // 수평 핸들 (좌/우): 중앙 정렬 스냅
            newGroupY = snapResult.snappedY;
          }
        }

        // Size Matching: 다른 요소와 동일한 크기로 스냅
        let sizeSnapResult: SizeSnapResult | null = null;
        if (sizeMatchGuidesEnabled) {
          sizeSnapResult = calculateSizeSnap(
            newGroupWidth,
            newGroupHeight,
            otherElements,
            'group',
          );

          if (sizeSnapResult.didSnapWidth) {
            if (handle.dx === -1) {
              newGroupX =
                newGroupX - (sizeSnapResult.snappedWidth - newGroupWidth);
            }
            newGroupWidth = sizeSnapResult.snappedWidth;
          }

          if (sizeSnapResult.didSnapHeight) {
            if (handle.dy === -1) {
              newGroupY =
                newGroupY - (sizeSnapResult.snappedHeight - newGroupHeight);
            }
            newGroupHeight = sizeSnapResult.snappedHeight;
          }
        }

        // 가이드라인 업데이트
        const hasAlignSnap =
          (handle.dx !== 0 &&
            snapResult.didSnapX &&
            !(snapResult.didSpacingSnapX && !spacingGuidesEnabled)) ||
          (handle.dy !== 0 &&
            snapResult.didSnapY &&
            !(snapResult.didSpacingSnapY && !spacingGuidesEnabled));
        const hasSizeSnap =
          sizeSnapResult &&
          (sizeSnapResult.didSnapWidth || sizeSnapResult.didSnapHeight);

        if (hasAlignSnap || hasSizeSnap) {
          const snappedBounds = calculateBounds(
            newGroupX,
            newGroupY,
            newGroupWidth,
            newGroupHeight,
            'group',
          );
          smartGuidesStore.setDraggedBounds(snappedBounds);

          if (hasAlignSnap) {
            smartGuidesStore.setActiveGuides(snapResult.guides);
            if (
              spacingGuidesEnabled &&
              snapResult.spacingGuides &&
              snapResult.spacingGuides.length > 0
            ) {
              // 핸들 방향에 따라 간격 가이드 필터링
              const filteredSpacingGuides = snapResult.spacingGuides.filter(
                (guide: SpacingGuide) => {
                  // 수평 방향 간격 가이드 (좌우 간격)
                  if (guide.direction === 'horizontal') {
                    // 좌우 핸들이 아니면 표시 안 함
                    if (handle.dx === 0) return false;

                    // 드래그 중인 요소와 관련된 가이드만 표시
                    const isDraggedElement =
                      guide.fromElementId === 'group' ||
                      guide.toElementId === 'group';

                    if (!isDraggedElement) return false;

                    // 왼쪽 핸들(dx: -1): 왼쪽 간격만 표시
                    if (handle.dx === -1) {
                      return guide.toElementId === 'group';
                    }
                    // 오른쪽 핸들(dx: 1): 오른쪽 간격만 표시
                    if (handle.dx === 1) {
                      return guide.fromElementId === 'group';
                    }
                  }

                  // 수직 방향 간격 가이드 (상하 간격)
                  if (guide.direction === 'vertical') {
                    // 상하 핸들이 아니면 표시 안 함
                    if (handle.dy === 0) return false;

                    // 드래그 중인 요소와 관련된 가이드만 표시
                    const isDraggedElement =
                      guide.fromElementId === 'group' ||
                      guide.toElementId === 'group';

                    if (!isDraggedElement) return false;

                    // 위쪽 핸들(dy: -1): 위쪽 간격만 표시
                    if (handle.dy === -1) {
                      return guide.toElementId === 'group';
                    }
                    // 아래쪽 핸들(dy: 1): 아래쪽 간격만 표시
                    if (handle.dy === 1) {
                      return guide.fromElementId === 'group';
                    }
                  }

                  return false;
                },
              );
              smartGuidesStore.setSpacingGuides(filteredSpacingGuides);
            } else {
              smartGuidesStore.setSpacingGuides([]);
            }
          } else {
            smartGuidesStore.setActiveGuides([]);
            smartGuidesStore.setSpacingGuides([]);
          }

          if (hasSizeSnap) {
            smartGuidesStore.setSizeMatchGuides(
              sizeSnapResult!.sizeMatchGuides,
            );
          } else {
            smartGuidesStore.setSizeMatchGuides([]);
          }
        } else {
          smartGuidesStore.clearGuides();
        }
      }

      // 최소 크기 재보장 (스마트 가이드 스냅 후)
      newGroupWidth = Math.max(MIN_SIZE, newGroupWidth);
      newGroupHeight = Math.max(MIN_SIZE, newGroupHeight);

      // 스케일 비율 계산 (스냅 적용된 그룹 bounds 기준)
      const scaleX =
        startGroupBounds.width > 0 ? newGroupWidth / startGroupBounds.width : 1;
      const scaleY =
        startGroupBounds.height > 0
          ? newGroupHeight / startGroupBounds.height
          : 1;

      // 각 리사이즈 가능한 요소의 새 위치/크기 계산 (그룹 스케일만 적용)
      const newElementBounds: ElementBounds[] = startElementBounds.map(
        ({ element, bounds }) => {
          // 그룹 내에서의 상대 위치
          const relativeX = bounds.x - startGroupBounds.x;
          const relativeY = bounds.y - startGroupBounds.y;

          // 새 위치 계산 (스케일 적용)
          const newX = newGroupX + relativeX * scaleX;
          const newY = newGroupY + relativeY * scaleY;
          const newWidth = bounds.width * scaleX;
          const newHeight = bounds.height * scaleY;

          // 내부 요소는 스케일만 적용해 비율을 유지한다. (스냅은 그룹 bounds에서만 처리)

          return {
            element,
            bounds: {
              x: newX,
              y: newY,
              width: newWidth,
              height: newHeight,
            },
          };
        },
      );

      // 새 그룹 bounds 계산
      // - 요소별 스냅 결과로 min/max가 흔들리면(특히 왼쪽 핸들) 프리뷰 선이 좌우로 떨릴 수 있어,
      //   프리뷰는 "그룹 변환 결과"를 기준으로 유지한다.
      let finalGroupMinX = newGroupX;
      let finalGroupMinY = newGroupY;
      let finalGroupMaxX = newGroupX + newGroupWidth;
      let finalGroupMaxY = newGroupY + newGroupHeight;

      // 리사이즈 불가능한 요소들 (원래 위치 유지)
      for (const { bounds } of nonResizableElementBounds || []) {
        finalGroupMinX = Math.min(finalGroupMinX, bounds.x);
        finalGroupMinY = Math.min(finalGroupMinY, bounds.y);
        finalGroupMaxX = Math.max(finalGroupMaxX, bounds.x + bounds.width);
        finalGroupMaxY = Math.max(finalGroupMaxY, bounds.y + bounds.height);
      }

      const result = {
        groupBounds: {
          x: finalGroupMinX,
          y: finalGroupMinY,
          width: finalGroupMaxX - finalGroupMinX,
          height: finalGroupMaxY - finalGroupMinY,
        },
        elementBounds: newElementBounds,
        handle,
      };
      const changed = elementBoundsChanged(
        startElementBounds,
        newElementBounds,
      );
      if (!resizeStarted && changed) {
        resizeStarted = true;
        onGroupResizeStart?.(handle);
      }
      if (resizeStarted) onGroupResize?.(result);
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
      // 스마트 가이드 클리어
      useSmartGuidesStore.getState().clearGuides();
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
      window.removeEventListener('pointercancel', handleMouseUp);
      unlockCustomCursor();
      if (resizeStarted) onGroupResizeEnd?.();
      moveScheduler.cancel();
    };

    activeResizeCleanupRef.current = handleMouseUp;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);
    window.addEventListener('pointercancel', handleMouseUp);
  };

  if (!groupData || selectedElements.length < 2) return null;

  // 표시할 bounds (프리뷰 또는 실제)
  const displayBounds: Bounds = previewGroupBounds || {
    x: groupData.x,
    y: groupData.y,
    width: groupData.width,
    height: groupData.height,
  };

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
        style={{
          position: 'absolute',
          left: selectionLeft,
          top: selectionTop,
          width: selectionWidth,
          height: selectionHeight,
          border: `${GROUP_BORDER_WIDTH}px solid var(--ui-selection-border-strong)`,
          borderRadius: '6px',
          pointerEvents: 'none' as const,
          zIndex: 22,
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
              zIndex: 21,
            }}
            title="크기 조절 불가능한 요소"
          />
        );
      })}

      {/* 리사이즈 핸들들 - 리사이즈 가능한 요소가 있을 때만 표시 */}
      {resizableElements.length > 0 &&
        HANDLES.map((handle) => {
          // 핸들을 테두리 중앙에 배치
          const centerX = handleAreaLeft + handleAreaWidth * handle.x;
          const centerY = handleAreaTop + handleAreaHeight * handle.y;

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

export default GroupResizeHandles;
