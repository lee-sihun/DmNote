import {
  calculateBounds,
  calculateSizeSnap,
  calculateSnapPoints,
  type ElementBounds,
  type GuideLine,
  type SizeMatchGuide,
  type SpacingGuide,
} from '@utils/grid/smartGuides';

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

export interface ResizePreviewBounds extends ResizeBounds {
  handle?: ResizeHandle;
  suppressSmartSnap?: boolean;
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

const filterSpacingGuides = (
  guides: SpacingGuide[],
  elementId: string,
  handle: ResizeHandle,
  includeUnrelatedHorizontalGuides: boolean,
): SpacingGuide[] =>
  guides.filter((guide) => {
    if (guide.direction === 'horizontal') {
      if (handle.dx === 0) return false;

      const isDraggedElement =
        guide.fromElementId === elementId || guide.toElementId === elementId;
      if (!isDraggedElement) return includeUnrelatedHorizontalGuides;

      if (handle.dx === -1) return guide.toElementId === elementId;
      if (handle.dx === 1) return guide.fromElementId === elementId;
    }

    if (guide.direction === 'vertical') {
      if (handle.dy === 0) return false;

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

  if (
    handle.dx !== 0 &&
    snapResult.didSnapX &&
    !(snapResult.didSpacingSnapX && !settings.spacingGuidesEnabled)
  ) {
    if (handle.dx === -1) {
      const widthDiff = finalX - snapResult.snappedX;
      finalX = snapResult.snappedX;
      finalWidth += widthDiff;
    } else if (handle.dx === 1) {
      const snappedRight = snapResult.snappedX + draggedBounds.width;
      finalWidth = snappedRight - finalX;
    }
  }

  if (
    handle.dy !== 0 &&
    snapResult.didSnapY &&
    !(snapResult.didSpacingSnapY && !settings.spacingGuidesEnabled)
  ) {
    if (handle.dy === -1) {
      const heightDiff = finalY - snapResult.snappedY;
      finalY = snapResult.snappedY;
      finalHeight += heightDiff;
    } else if (handle.dy === 1) {
      const snappedBottom = snapResult.snappedY + draggedBounds.height;
      finalHeight = snappedBottom - finalY;
    }
  }

  const hasAlignSnap =
    (handle.dx !== 0 &&
      snapResult.didSnapX &&
      !(snapResult.didSpacingSnapX && !settings.spacingGuidesEnabled)) ||
    (handle.dy !== 0 &&
      snapResult.didSnapY &&
      !(snapResult.didSpacingSnapY && !settings.spacingGuidesEnabled));

  let sizeMatchGuides: SizeMatchGuide[] = [];
  let hasSizeSnap = false;
  if (settings.sizeMatchGuidesEnabled) {
    const sizeSnapResult = calculateSizeSnap(
      finalWidth,
      finalHeight,
      otherElements,
      elementId,
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

    hasSizeSnap = sizeSnapResult.didSnapWidth || sizeSnapResult.didSnapHeight;
    if (hasSizeSnap) sizeMatchGuides = sizeSnapResult.sizeMatchGuides;
  }

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
    activeGuides: hasAlignSnap ? snapResult.guides : [],
    spacingGuides,
    sizeMatchGuides,
  });
};
