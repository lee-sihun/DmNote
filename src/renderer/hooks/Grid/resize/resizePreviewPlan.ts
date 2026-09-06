import {
  calculateBounds,
  calculateSizeSnap,
  calculateSnapPoints,
  type ElementBounds,
  type GuideLine,
  type SizeMatchGuide,
  type SizeSnapResult,
  type SpacingGuide,
} from '@utils/grid/smartGuides';
import {
  exactSizeFor,
  scaleBoundsAnchored,
  settleAspectScale,
  type AspectPrimaryAxis,
  type ScaleRange,
} from '@components/main/Grid/handles/aspectResize';

export interface ResizeHandle {
  id: string;
  dx: number;
  dy: number;
}

export interface ResizeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 비율 고정 리사이즈 - 기준 축만 스냅하고 반대 축은 같은 배율로 다시 구한다 */
export interface ResizeAspectLock {
  start: ResizeBounds;
  primary: AspectPrimaryAxis;
  range: ScaleRange;
}

export interface ResizePreviewBounds extends ResizeBounds {
  handle?: ResizeHandle;
  suppressSmartSnap?: boolean;
  aspect?: ResizeAspectLock;
}

interface ResizeGuideSettings {
  alignmentGuidesEnabled: boolean;
  spacingGuidesEnabled: boolean;
  sizeMatchGuidesEnabled: boolean;
  gridSnapSize: number;
}

export type ResizePreviewPolicy = 'native' | 'plugin';

export type ResizeGuideUpdate =
  | { kind: 'none' }
  | { kind: 'clear' }
  | {
      kind: 'set';
      draggedBounds: ElementBounds;
      activeGuides: GuideLine[];
      spacingGuides: SpacingGuide[];
      sizeMatchGuides: SizeMatchGuide[];
    };

export interface ResizePreviewPlan {
  bounds: ResizeBounds;
  guideUpdate: ResizeGuideUpdate;
}

interface CalculateResizePreviewPlanOptions {
  elementId: string;
  newBounds: ResizePreviewBounds;
  otherElements?: ElementBounds[];
  settings: ResizeGuideSettings;
  policy: ResizePreviewPolicy;
}

// 실제로 위치를 옮긴 축 - 잡지 않은 축과 비율 고정이 버린 스냅은 가이드에서 뺀다
interface AppliedSnapAxes {
  x: boolean;
  y: boolean;
}

const filterSpacingGuides = (
  guides: SpacingGuide[],
  elementId: string,
  handle: ResizeHandle,
  includeUnrelatedHorizontalGuides: boolean,
  applied: AppliedSnapAxes,
): SpacingGuide[] =>
  guides.filter((guide) => {
    if (guide.direction === 'horizontal') {
      // 좌우 핸들이 아니거나 그 축 스냅을 안 썼으면 표시 안 함
      if (handle.dx === 0 || !applied.x) return false;

      const isDraggedElement =
        guide.fromElementId === elementId || guide.toElementId === elementId;
      if (!isDraggedElement) return includeUnrelatedHorizontalGuides;

      if (handle.dx === -1) return guide.toElementId === elementId;
      if (handle.dx === 1) return guide.fromElementId === elementId;
    }

    if (guide.direction === 'vertical') {
      if (handle.dy === 0 || !applied.y) return false;

      const isDraggedElement =
        guide.fromElementId === elementId || guide.toElementId === elementId;
      if (!isDraggedElement) return false;

      if (handle.dy === -1) return guide.toElementId === elementId;
      if (handle.dy === 1) return guide.fromElementId === elementId;
    }

    return false;
  });

export const calculateResizePreviewPlan = ({
  elementId,
  newBounds,
  otherElements,
  settings,
  policy,
}: CalculateResizePreviewPlanOptions): ResizePreviewPlan => {
  let finalX = newBounds.x;
  let finalY = newBounds.y;
  let finalWidth = newBounds.width;
  let finalHeight = newBounds.height;

  const createPlan = (guideUpdate: ResizeGuideUpdate): ResizePreviewPlan => ({
    bounds: {
      x: finalX,
      y: finalY,
      width: finalWidth,
      height: finalHeight,
    },
    guideUpdate,
  });

  if (newBounds.suppressSmartSnap) return createPlan({ kind: 'clear' });
  if (!settings.alignmentGuidesEnabled || !otherElements) {
    return createPlan({ kind: 'none' });
  }

  const draggedBounds = calculateBounds(
    newBounds.x,
    newBounds.y,
    newBounds.width,
    newBounds.height,
    elementId,
  );
  const snapResult = calculateSnapPoints(
    draggedBounds,
    otherElements,
    undefined,
    {
      disableSpacing: !settings.spacingGuidesEnabled,
      gridSnapSize: settings.gridSnapSize,
    },
  );
  const handle = newBounds.handle;
  if (!handle) return createPlan({ kind: 'none' });

  const aspect = newBounds.aspect;
  // 비율 고정 중에는 기준 축의 스냅만 받는다 - 반대 축은 같은 배율로 다시 구한다
  const snapWidthAllowed = !aspect || aspect.primary === 'width';
  const snapHeightAllowed = !aspect || aspect.primary === 'height';

  const alignSnapX =
    handle.dx !== 0 &&
    snapWidthAllowed &&
    snapResult.didSnapX &&
    !(snapResult.didSpacingSnapX && !settings.spacingGuidesEnabled);
  if (alignSnapX) {
    if (handle.dx === -1) {
      const widthDiff = finalX - snapResult.snappedX;
      finalX = snapResult.snappedX;
      finalWidth += widthDiff;
    } else if (handle.dx === 1) {
      const snappedRight = snapResult.snappedX + draggedBounds.width;
      finalWidth = snappedRight - finalX;
    }
  }

  const alignSnapY =
    handle.dy !== 0 &&
    snapHeightAllowed &&
    snapResult.didSnapY &&
    !(snapResult.didSpacingSnapY && !settings.spacingGuidesEnabled);
  if (alignSnapY) {
    if (handle.dy === -1) {
      const heightDiff = finalY - snapResult.snappedY;
      finalY = snapResult.snappedY;
      finalHeight += heightDiff;
    } else if (handle.dy === 1) {
      const snappedBottom = snapResult.snappedY + draggedBounds.height;
      finalHeight = snappedBottom - finalY;
    }
  }

  // 크기 일치 스냅 - 잡은 핸들이 움직이는 축만 (가로 핸들은 높이를 안 바꾼다)
  let sizeSnapResult: SizeSnapResult | null = null;
  if (settings.sizeMatchGuidesEnabled) {
    sizeSnapResult = calculateSizeSnap(
      finalWidth,
      finalHeight,
      otherElements,
      elementId,
      {
        matchWidth: handle.dx !== 0 && snapWidthAllowed,
        matchHeight: handle.dy !== 0 && snapHeightAllowed,
      },
    );

    if (sizeSnapResult.didSnapWidth) {
      if (handle.dx === -1) {
        finalX -= sizeSnapResult.snappedWidth - finalWidth;
      }
      finalWidth = sizeSnapResult.snappedWidth;
    }
    if (sizeSnapResult.didSnapHeight) {
      if (handle.dy === -1) {
        finalY -= sizeSnapResult.snappedHeight - finalHeight;
      }
      finalHeight = sizeSnapResult.snappedHeight;
    }
  }

  // 비율 고정 - 스냅된 기준 축 크기로 배율을 다시 구해 두 축을 함께 놓는다
  // (배율이 범위에 잘리면 그 스냅은 화면에 없으니 가이드도 뺀다)
  let aspectSnapDropped = false;
  if (aspect) {
    const axisHandle = {
      dx: Math.sign(handle.dx) as -1 | 0 | 1,
      dy: Math.sign(handle.dy) as -1 | 0 | 1,
    };
    const startSize =
      aspect.primary === 'width' ? aspect.start.width : aspect.start.height;
    const requestedSize = aspect.primary === 'width' ? finalWidth : finalHeight;
    const requested = requestedSize / startSize;
    const exact = { axis: aspect.primary, size: requestedSize };
    const scale = settleAspectScale(
      aspect.start,
      requested,
      axisHandle,
      aspect.range,
      exact,
    );
    aspectSnapDropped = scale !== requested;
    const scaled = scaleBoundsAnchored(
      aspect.start,
      scale,
      axisHandle,
      exactSizeFor(aspect.start, scale, requested, exact),
    );
    finalX = scaled.x;
    finalY = scaled.y;
    finalWidth = scaled.width;
    finalHeight = scaled.height;
  }

  const applied: AppliedSnapAxes = {
    x: alignSnapX && !aspectSnapDropped,
    y: alignSnapY && !aspectSnapDropped,
  };
  const hasAlignSnap = applied.x || applied.y;
  const hasSizeSnap =
    !aspectSnapDropped &&
    (sizeSnapResult?.didSnapWidth === true ||
      sizeSnapResult?.didSnapHeight === true);
  const sizeMatchGuides =
    hasSizeSnap && sizeSnapResult ? sizeSnapResult.sizeMatchGuides : [];

  if (!hasAlignSnap && !hasSizeSnap) return createPlan({ kind: 'clear' });

  const spacingGuides =
    hasAlignSnap &&
    settings.spacingGuidesEnabled &&
    snapResult.spacingGuides.length > 0
      ? filterSpacingGuides(
          snapResult.spacingGuides,
          elementId,
          handle,
          policy === 'plugin' && !settings.sizeMatchGuidesEnabled,
          applied,
        )
      : [];

  return createPlan({
    kind: 'set',
    draggedBounds: calculateBounds(
      finalX,
      finalY,
      finalWidth,
      finalHeight,
      elementId,
    ),
    // 반영한 축의 정렬 가이드만
    activeGuides: hasAlignSnap
      ? snapResult.guides.filter((guide) =>
          guide.type === 'vertical' ? applied.x : applied.y,
        )
      : [],
    spacingGuides,
    sizeMatchGuides,
  });
};
