import { snapToGrid } from '@hooks/Grid/utils';
import { EDITOR_BOUNDS_LIMITS } from '@src/types/editor';
import type { CursorType } from '@utils/grid/cursorUtils';
import {
  calculateBounds,
  calculateSizeSnap,
  calculateSnapPoints,
  type ElementBounds as SmartGuideElementBounds,
  type GuideLine,
  type SizeMatchGuide,
  type SizeSnapResult,
  type SpacingGuide,
} from '@utils/grid/smartGuides';
import {
  isAspectLockedElement,
  limitGroupGrowth,
  projectGroupElementBounds,
  shrinkLimitSize,
  type Bounds,
  type ElementBounds,
} from './groupResizeUtils';

export const GROUP_RESIZE_MIN_SIZE = 10;

export interface GroupResizeHandle {
  id: string;
  cursor: CursorType;
  x: number;
  y: number;
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
  type: 'corner' | 'edge-v' | 'edge-h';
}

export interface GroupResizeResult {
  groupBounds: Bounds;
  elementBounds: ElementBounds[];
  handle: GroupResizeHandle;
}

export type GroupResizeGuidePlan =
  | { type: 'unchanged' }
  | { type: 'clear' }
  | {
      type: 'set';
      draggedBounds: SmartGuideElementBounds;
      activeGuides: GuideLine[];
      spacingGuides: SpacingGuide[];
      sizeMatchGuides: SizeMatchGuide[];
    };

type SmartSnapPlan =
  | { type: 'suppressed' }
  | { type: 'unchanged' }
  | {
      type: 'enabled';
      otherElements: SmartGuideElementBounds[];
      spacingGuidesEnabled: boolean;
      sizeMatchGuidesEnabled: boolean;
    };

interface CalculateGroupResizePlanOptions {
  handle: GroupResizeHandle;
  startMouseX: number;
  startMouseY: number;
  pointerX: number;
  pointerY: number;
  zoom: number;
  snapSize: number;
  startGroupBounds: Bounds;
  startElementBounds: ElementBounds[];
  nonResizableElementBounds?: ElementBounds[];
  /** 요소 하한에서 유도한 그룹 최소 크기 - 시작 크기면 그 축은 더 못 줄인다 */
  minGroupWidth: number;
  minGroupHeight: number;
  smartSnap: SmartSnapPlan;
}

export interface GroupResizePlan {
  result: GroupResizeResult;
  guides: GroupResizeGuidePlan;
}

/**
 * 요소 하한 기준 그룹 최소 크기. 비율 고정 요소는 어느 축을 끌어도 함께 줄어드는
 * 보호 축으로 재고, 이미 두 축이 얇으면 현재보다 축소를 막는다
 */
export const calculateMinGroupSize = (
  boundsList: ElementBounds[],
  groupSize: number,
  axis: 'x' | 'y',
  minSize: number,
): number => {
  if (!Number.isFinite(groupSize) || groupSize <= 0) return groupSize;
  let minScale = 0;
  const guardedSizes: number[] = [];
  for (const { element, bounds } of boundsList) {
    const size = shrinkLimitSize(element, bounds, axis, minSize);
    if (!Number.isFinite(size) || size <= 0) continue;
    if (size >= minSize) {
      guardedSizes.push(size);
      minScale = Math.max(minScale, minSize / size);
    } else if (isAspectLockedElement(element)) {
      minScale = 1;
    }
  }
  // 그룹 자체 하한은 얇은 스프라이트의 정상 축소까지 막으므로
  // 보호할 요소 축에서만 유도하고 보호 축이 없으면 현재 크기 유지
  minScale = minScale > 0 ? Math.min(1, minScale) : 1;
  let minGroupSize = groupSize * minScale;
  // 그룹 크기에서 배율을 다시 나눠 요소에 곱하는 실제 투영까지 하한 보장
  while (
    guardedSizes.some((size) => size * (minGroupSize / groupSize) < minSize)
  ) {
    minGroupSize += Math.max(Number.MIN_VALUE, minGroupSize * Number.EPSILON);
  }
  return minGroupSize;
};

const clampShrinkDelta = (
  delta: number,
  handleDir: -1 | 0 | 1,
  maxShrink: number,
  snapSize: number,
): number => {
  // maxShrink 0은 더 못 줄인다는 뜻이라 여기서도 잘라야 한다
  if (!Number.isFinite(maxShrink) || maxShrink < 0) return delta;
  const maxSnapped =
    snapSize > 0 ? Math.floor(maxShrink / snapSize) * snapSize : maxShrink;
  if (handleDir === -1) return Math.min(delta, maxSnapped);
  if (handleDir === 1) return Math.max(delta, -maxSnapped);
  return delta;
};

const filterSpacingGuides = (
  guides: SpacingGuide[],
  handle: GroupResizeHandle,
): SpacingGuide[] =>
  guides.filter((guide) => {
    if (guide.direction === 'horizontal') {
      if (handle.dx === 0) return false;
      const isDraggedElement =
        guide.fromElementId === 'group' || guide.toElementId === 'group';
      if (!isDraggedElement) return false;
      if (handle.dx === -1) return guide.toElementId === 'group';
      if (handle.dx === 1) return guide.fromElementId === 'group';
    }

    if (guide.direction === 'vertical') {
      if (handle.dy === 0) return false;
      const isDraggedElement =
        guide.fromElementId === 'group' || guide.toElementId === 'group';
      if (!isDraggedElement) return false;
      if (handle.dy === -1) return guide.toElementId === 'group';
      if (handle.dy === 1) return guide.fromElementId === 'group';
    }

    return false;
  });

export const calculateGroupResizePlan = ({
  handle,
  startMouseX,
  startMouseY,
  pointerX,
  pointerY,
  zoom,
  snapSize,
  startGroupBounds,
  startElementBounds,
  nonResizableElementBounds,
  minGroupWidth: minimumWidth,
  minGroupHeight: minimumHeight,
  smartSnap,
}: CalculateGroupResizePlanOptions): GroupResizePlan => {
  const rawDeltaX = (pointerX - startMouseX) / zoom;
  const rawDeltaY = (pointerY - startMouseY) / zoom;

  let snappedDeltaX = handle.dx !== 0 ? snapToGrid(rawDeltaX, snapSize) : 0;
  let snappedDeltaY = handle.dy !== 0 ? snapToGrid(rawDeltaY, snapSize) : 0;

  if (handle.dx !== 0) {
    snappedDeltaX = clampShrinkDelta(
      snappedDeltaX,
      handle.dx,
      startGroupBounds.width - minimumWidth,
      snapSize,
    );
  }
  if (handle.dy !== 0) {
    snappedDeltaY = clampShrinkDelta(
      snappedDeltaY,
      handle.dy,
      startGroupBounds.height - minimumHeight,
      snapSize,
    );
  }

  let newGroupX = startGroupBounds.x;
  let newGroupY = startGroupBounds.y;
  let newGroupWidth = startGroupBounds.width;
  let newGroupHeight = startGroupBounds.height;

  if (handle.dx === -1) {
    newGroupWidth = Math.max(
      minimumWidth,
      startGroupBounds.width - snappedDeltaX,
    );
    newGroupX = startGroupBounds.x + (startGroupBounds.width - newGroupWidth);
  } else if (handle.dx === 1) {
    newGroupWidth = Math.max(
      minimumWidth,
      startGroupBounds.width + snappedDeltaX,
    );
  }

  if (handle.dy === -1) {
    newGroupHeight = Math.max(
      minimumHeight,
      startGroupBounds.height - snappedDeltaY,
    );
    newGroupY = startGroupBounds.y + (startGroupBounds.height - newGroupHeight);
  } else if (handle.dy === 1) {
    newGroupHeight = Math.max(
      minimumHeight,
      startGroupBounds.height + snappedDeltaY,
    );
  }

  // 요소 하한 기준 그룹 최소 크기 - 잡은 핸들이 움직이는 축만. 잡지 않은 축은 시작값
  // 그대로 둔다 (얇은 그룹의 높이를 가로 핸들이 10으로 키우면 요소가 밀려난다)
  // - 스마트 스냅이 하한을 다시 넘으면 잡지 않은 가장자리를 고정한 채
  // 되돌리고, 되돌린 축을 알려 그 축의 스냅을 무효화한다
  const minGroupWidth = handle.dx === 0 ? startGroupBounds.width : minimumWidth;
  const minGroupHeight =
    handle.dy === 0 ? startGroupBounds.height : minimumHeight;
  const enforceMinGroupSize = (): { width: boolean; height: boolean } => {
    const clamped = { width: false, height: false };
    if (newGroupWidth < minGroupWidth) {
      if (handle.dx === -1) {
        newGroupX = newGroupX + newGroupWidth - minGroupWidth;
      }
      newGroupWidth = minGroupWidth;
      clamped.width = true;
    }
    if (newGroupHeight < minGroupHeight) {
      if (handle.dy === -1) {
        newGroupY = newGroupY + newGroupHeight - minGroupHeight;
      }
      newGroupHeight = minGroupHeight;
      clamped.height = true;
    }
    return clamped;
  };

  // 요소 상한(치수·저장 좌표)까지 한 번에. 후보를 요소에 투영해 넘치면 시작 →
  // 후보 진행 배율을 줄인다. 되돌린 축은 하한과 같은 규칙으로 가이드에서 뺀다
  const enforceGroupLimits = (): { width: boolean; height: boolean } => {
    const clamped = enforceMinGroupSize();
    const growth = limitGroupGrowth(
      startElementBounds,
      startGroupBounds,
      {
        x: newGroupX,
        y: newGroupY,
        width: newGroupWidth,
        height: newGroupHeight,
      },
      handle,
      EDITOR_BOUNDS_LIMITS,
    );
    if (growth.limitedWidth || growth.limitedHeight) {
      newGroupX = growth.bounds.x;
      newGroupY = growth.bounds.y;
      newGroupWidth = growth.bounds.width;
      newGroupHeight = growth.bounds.height;
    }
    return {
      width: clamped.width || growth.limitedWidth,
      height: clamped.height || growth.limitedHeight,
    };
  };

  let guides: GroupResizeGuidePlan = { type: 'unchanged' };
  if (smartSnap.type === 'suppressed') {
    guides = { type: 'clear' };
  } else if (smartSnap.type === 'enabled') {
    const groupBoundsForSnap = calculateBounds(
      newGroupX,
      newGroupY,
      newGroupWidth,
      newGroupHeight,
      'group',
    );
    const snapResult = calculateSnapPoints(
      groupBoundsForSnap,
      smartSnap.otherElements,
      undefined,
      {
        disableSpacing: !smartSnap.spacingGuidesEnabled,
        gridSnapSize: snapSize,
      },
    );

    if (
      handle.dx !== 0 &&
      snapResult.didSnapX &&
      !(snapResult.didSpacingSnapX && !smartSnap.spacingGuidesEnabled)
    ) {
      if (handle.dx === -1) {
        const widthDiff = newGroupX - snapResult.snappedX;
        newGroupX = snapResult.snappedX;
        newGroupWidth = newGroupWidth + widthDiff;
      } else if (handle.dx === 1) {
        const snappedRight = snapResult.snappedX + groupBoundsForSnap.width;
        newGroupWidth = snappedRight - newGroupX;
      }
    }

    if (
      handle.dy !== 0 &&
      snapResult.didSnapY &&
      !(snapResult.didSpacingSnapY && !smartSnap.spacingGuidesEnabled)
    ) {
      if (handle.dy === -1) {
        const heightDiff = newGroupY - snapResult.snappedY;
        newGroupY = snapResult.snappedY;
        newGroupHeight = newGroupHeight + heightDiff;
      } else if (handle.dy === 1) {
        const snappedBottom = snapResult.snappedY + groupBoundsForSnap.height;
        newGroupHeight = snappedBottom - newGroupY;
      }
    }

    let sizeSnapResult: SizeSnapResult | null = null;
    if (smartSnap.sizeMatchGuidesEnabled) {
      // 잡은 핸들이 움직이는 축만 - 가로 핸들이 그룹 높이를 바꾸면 안 된다
      sizeSnapResult = calculateSizeSnap(
        newGroupWidth,
        newGroupHeight,
        smartSnap.otherElements,
        'group',
        { matchWidth: handle.dx !== 0, matchHeight: handle.dy !== 0 },
      );

      if (sizeSnapResult.didSnapWidth) {
        if (handle.dx === -1) {
          newGroupX = newGroupX - (sizeSnapResult.snappedWidth - newGroupWidth);
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

    // 스냅이 요소 하한 아래로 내려갔으면 되돌린다. 되돌린 축의 정렬·간격·크기 일치는
    // 화면에서 성립하지 않으므로 가이드에서도 뺀다 - 가이드는 최종 결과를 따라야 한다
    const clamped = enforceGroupLimits();
    const alignSnapX = snapResult.didSnapX && !clamped.width;
    const alignSnapY = snapResult.didSnapY && !clamped.height;
    const sizeSnapWidth =
      sizeSnapResult?.didSnapWidth === true && !clamped.width;
    const sizeSnapHeight =
      sizeSnapResult?.didSnapHeight === true && !clamped.height;
    const activeGuides = snapResult.guides.filter((guide) =>
      guide.type === 'vertical' ? alignSnapX : alignSnapY,
    );
    const activeSpacingGuides = (snapResult.spacingGuides ?? []).filter(
      (guide) => (guide.direction === 'horizontal' ? alignSnapX : alignSnapY),
    );
    const activeSizeMatchGuides = (
      sizeSnapResult?.sizeMatchGuides ?? []
    ).filter((guide) =>
      guide.dimension === 'width' ? sizeSnapWidth : sizeSnapHeight,
    );

    const hasAlignSnap =
      (handle.dx !== 0 &&
        alignSnapX &&
        !(snapResult.didSpacingSnapX && !smartSnap.spacingGuidesEnabled)) ||
      (handle.dy !== 0 &&
        alignSnapY &&
        !(snapResult.didSpacingSnapY && !smartSnap.spacingGuidesEnabled));
    const hasSizeSnap = sizeSnapWidth || sizeSnapHeight;

    if (hasAlignSnap || hasSizeSnap) {
      guides = {
        type: 'set',
        draggedBounds: calculateBounds(
          newGroupX,
          newGroupY,
          newGroupWidth,
          newGroupHeight,
          'group',
        ),
        activeGuides: hasAlignSnap ? activeGuides : [],
        spacingGuides:
          hasAlignSnap &&
          smartSnap.spacingGuidesEnabled &&
          activeSpacingGuides.length > 0
            ? filterSpacingGuides(activeSpacingGuides, handle)
            : [],
        sizeMatchGuides: hasSizeSnap ? activeSizeMatchGuides : [],
      };
    } else {
      guides = { type: 'clear' };
    }
  }

  // 스마트 스냅을 건너뛴 경로도 같은 하한·상한을 지킨다 (스냅 경로에서는 이미 적용돼 무변화)
  enforceGroupLimits();

  // 각 리사이즈 가능한 요소에 그룹 변환 투영 (스냅 적용된 그룹 bounds 기준).
  // 스냅은 그룹 bounds에서만 처리하고, 비율 고정 요소는 단일 배율을 따른다
  const nextGroupBounds: Bounds = {
    x: newGroupX,
    y: newGroupY,
    width: newGroupWidth,
    height: newGroupHeight,
  };
  const newElementBounds: ElementBounds[] = startElementBounds.map(
    ({ element, bounds }) => ({
      element,
      bounds: projectGroupElementBounds(
        element,
        bounds,
        startGroupBounds,
        nextGroupBounds,
        handle,
      ),
    }),
  );

  let finalGroupMinX = newGroupX;
  let finalGroupMinY = newGroupY;
  let finalGroupMaxX = newGroupX + newGroupWidth;
  let finalGroupMaxY = newGroupY + newGroupHeight;
  const includeInGroup = (bounds: Bounds) => {
    finalGroupMinX = Math.min(finalGroupMinX, bounds.x);
    finalGroupMinY = Math.min(finalGroupMinY, bounds.y);
    finalGroupMaxX = Math.max(finalGroupMaxX, bounds.x + bounds.width);
    finalGroupMaxY = Math.max(finalGroupMaxY, bounds.y + bounds.height);
  };
  // 리사이즈 불가능한 요소는 원래 위치 유지
  for (const { bounds } of nonResizableElementBounds || []) {
    includeInGroup(bounds);
  }
  // 비율 고정 요소는 한 축만 끌어도 반대 축이 함께 자라 그룹 변환 밖으로 나갈 수 있다
  for (const { element, bounds } of newElementBounds) {
    if (isAspectLockedElement(element)) includeInGroup(bounds);
  }

  return {
    result: {
      groupBounds: {
        x: finalGroupMinX,
        y: finalGroupMinY,
        width: finalGroupMaxX - finalGroupMinX,
        height: finalGroupMaxY - finalGroupMinY,
      },
      elementBounds: newElementBounds,
      handle,
    },
    guides,
  };
};
