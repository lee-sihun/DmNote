import { snapToGrid } from '@hooks/Grid/utils';
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
import type { Bounds, ElementBounds } from './groupResizeUtils';

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
  maxShrinkX: number;
  maxShrinkY: number;
  smartSnap: SmartSnapPlan;
}

export interface GroupResizePlan {
  result: GroupResizeResult;
  guides: GroupResizeGuidePlan;
}

export const calculateMaxGroupShrink = (
  boundsList: ElementBounds[],
  groupSize: number,
  axis: 'x' | 'y',
  minSize: number,
): number => {
  if (!Number.isFinite(groupSize) || groupSize <= 0) return 0;
  let minScale = 0;
  for (const { bounds } of boundsList) {
    const size = axis === 'x' ? bounds.width : bounds.height;
    if (!Number.isFinite(size) || size <= 0) continue;
    if (size >= minSize) {
      minScale = Math.max(minScale, minSize / size);
    }
  }
  const groupMinScale = minSize / groupSize;
  minScale = Math.min(1, Math.max(minScale, groupMinScale));
  return groupSize * (1 - minScale);
};

const clampShrinkDelta = (
  delta: number,
  handleDir: -1 | 0 | 1,
  maxShrink: number,
  snapSize: number,
): number => {
  if (!Number.isFinite(maxShrink) || maxShrink <= 0) return delta;
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
  maxShrinkX,
  maxShrinkY,
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
      maxShrinkX,
      snapSize,
    );
  }
  if (handle.dy !== 0) {
    snappedDeltaY = clampShrinkDelta(
      snappedDeltaY,
      handle.dy,
      maxShrinkY,
      snapSize,
    );
  }

  const minSize = GROUP_RESIZE_MIN_SIZE;
  let newGroupX = startGroupBounds.x;
  let newGroupY = startGroupBounds.y;
  let newGroupWidth = startGroupBounds.width;
  let newGroupHeight = startGroupBounds.height;

  if (handle.dx === -1) {
    newGroupWidth = Math.max(minSize, startGroupBounds.width - snappedDeltaX);
    if (newGroupWidth > minSize) {
      newGroupX = startGroupBounds.x + snappedDeltaX;
    } else {
      newGroupX = startGroupBounds.x + startGroupBounds.width - minSize;
    }
  } else if (handle.dx === 1) {
    newGroupWidth = Math.max(minSize, startGroupBounds.width + snappedDeltaX);
  }

  if (handle.dy === -1) {
    newGroupHeight = Math.max(minSize, startGroupBounds.height - snappedDeltaY);
    if (newGroupHeight > minSize) {
      newGroupY = startGroupBounds.y + snappedDeltaY;
    } else {
      newGroupY = startGroupBounds.y + startGroupBounds.height - minSize;
    }
  } else if (handle.dy === 1) {
    newGroupHeight = Math.max(minSize, startGroupBounds.height + snappedDeltaY);
  }

  newGroupWidth = Math.max(minSize, newGroupWidth);
  newGroupHeight = Math.max(minSize, newGroupHeight);

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
      } else if (handle.dx === 0) {
        newGroupX = snapResult.snappedX;
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
      } else if (handle.dy === 0) {
        newGroupY = snapResult.snappedY;
      }
    }

    let sizeSnapResult: SizeSnapResult | null = null;
    if (smartSnap.sizeMatchGuidesEnabled) {
      sizeSnapResult = calculateSizeSnap(
        newGroupWidth,
        newGroupHeight,
        smartSnap.otherElements,
        'group',
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

    const hasAlignSnap =
      (handle.dx !== 0 &&
        snapResult.didSnapX &&
        !(snapResult.didSpacingSnapX && !smartSnap.spacingGuidesEnabled)) ||
      (handle.dy !== 0 &&
        snapResult.didSnapY &&
        !(snapResult.didSpacingSnapY && !smartSnap.spacingGuidesEnabled));
    const hasSizeSnap =
      sizeSnapResult &&
      (sizeSnapResult.didSnapWidth || sizeSnapResult.didSnapHeight);

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
        activeGuides: hasAlignSnap ? snapResult.guides : [],
        spacingGuides:
          hasAlignSnap &&
          smartSnap.spacingGuidesEnabled &&
          snapResult.spacingGuides &&
          snapResult.spacingGuides.length > 0
            ? filterSpacingGuides(snapResult.spacingGuides, handle)
            : [],
        sizeMatchGuides: hasSizeSnap ? sizeSnapResult!.sizeMatchGuides : [],
      };
    } else {
      guides = { type: 'clear' };
    }
  }

  newGroupWidth = Math.max(minSize, newGroupWidth);
  newGroupHeight = Math.max(minSize, newGroupHeight);

  const scaleX =
    startGroupBounds.width > 0 ? newGroupWidth / startGroupBounds.width : 1;
  const scaleY =
    startGroupBounds.height > 0 ? newGroupHeight / startGroupBounds.height : 1;
  const newElementBounds: ElementBounds[] = startElementBounds.map(
    ({ element, bounds }) => {
      const relativeX = bounds.x - startGroupBounds.x;
      const relativeY = bounds.y - startGroupBounds.y;
      return {
        element,
        bounds: {
          x: newGroupX + relativeX * scaleX,
          y: newGroupY + relativeY * scaleY,
          width: bounds.width * scaleX,
          height: bounds.height * scaleY,
        },
      };
    },
  );

  let finalGroupMinX = newGroupX;
  let finalGroupMinY = newGroupY;
  let finalGroupMaxX = newGroupX + newGroupWidth;
  let finalGroupMaxY = newGroupY + newGroupHeight;
  for (const { bounds } of nonResizableElementBounds || []) {
    finalGroupMinX = Math.min(finalGroupMinX, bounds.x);
    finalGroupMinY = Math.min(finalGroupMinY, bounds.y);
    finalGroupMaxX = Math.max(finalGroupMaxX, bounds.x + bounds.width);
    finalGroupMaxY = Math.max(finalGroupMaxY, bounds.y + bounds.height);
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
