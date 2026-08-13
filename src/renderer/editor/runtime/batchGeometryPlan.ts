import type { EditorBoundsV1 } from '@src/types/editor';

const SPACING_GROUP_TOLERANCE = 2;
const SPACING_DECIMAL_SCALE = 1;
const POSITION_CHANGE_EPSILON = 0.05;
const SPACING_GROUP_SIZE_FACTOR = 0.35;
const SPACING_GROUP_OVERLAP_THRESHOLD = 0.45;
const PRIMARY_AXIS_STACK_EPSILON = 0.1;

type AxisDirection = 'horizontal' | 'vertical';

export type BatchGeometryOperation =
  | {
      kind: 'align';
      direction: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom';
    }
  | { kind: 'distribute'; direction: AxisDirection }
  | { kind: 'spacing'; spacing: number }
  | { kind: 'resize'; dimension: 'width' | 'height'; value: number };

export interface BatchGeometryLayoutElement {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BatchGeometryUpdate {
  key: string;
  patch: Partial<EditorBoundsV1>;
}

export interface BatchGeometryPlan {
  updates: BatchGeometryUpdate[];
  bounds: Array<{ key: string; bounds: EditorBoundsV1 }>;
}

interface SpacingAxisPlan {
  applyHorizontal: boolean;
  applyVertical: boolean;
  horizontalGroups: BatchGeometryLayoutElement[][];
  verticalGroups: BatchGeometryLayoutElement[][];
}

const roundToSpacingPrecision = (value: number): number => {
  const factor = 10 ** SPACING_DECIMAL_SCALE;
  return Math.round(value * factor) / factor;
};

const getReferenceAxisValue = (
  element: BatchGeometryLayoutElement,
  direction: AxisDirection,
): number => (direction === 'horizontal' ? element.y : element.x);

const getReferenceAxisSize = (
  element: BatchGeometryLayoutElement,
  direction: AxisDirection,
): number => (direction === 'horizontal' ? element.height : element.width);

const getReferenceAxisCenter = (
  element: BatchGeometryLayoutElement,
  direction: AxisDirection,
): number =>
  getReferenceAxisValue(element, direction) +
  getReferenceAxisSize(element, direction) / 2;

const getPrimaryAxisValue = (
  element: BatchGeometryLayoutElement,
  direction: AxisDirection,
): number => (direction === 'horizontal' ? element.x : element.y);

const getPrimaryAxisSize = (
  element: BatchGeometryLayoutElement,
  direction: AxisDirection,
): number => (direction === 'horizontal' ? element.width : element.height);

const sortByPrimaryAxis = (
  elements: BatchGeometryLayoutElement[],
  direction: AxisDirection,
): BatchGeometryLayoutElement[] =>
  [...elements].sort(
    (a, b) =>
      getPrimaryAxisValue(a, direction) - getPrimaryAxisValue(b, direction),
  );

const computeOverlapRatio = (
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): number => {
  const overlapLength = Math.max(
    0,
    Math.min(endA, endB) - Math.max(startA, startB),
  );
  const minSize = Math.min(endA - startA, endB - startB);
  return minSize <= 0 ? 0 : overlapLength / minSize;
};

const groupElementsByReferenceAxis = (
  elements: BatchGeometryLayoutElement[],
  direction: AxisDirection,
): BatchGeometryLayoutElement[][] => {
  const sorted = [...elements].sort(
    (a, b) =>
      getReferenceAxisCenter(a, direction) -
      getReferenceAxisCenter(b, direction),
  );
  const groups: Array<{
    elements: BatchGeometryLayoutElement[];
    averageCenter: number;
    averageSize: number;
    minEdge: number;
    maxEdge: number;
  }> = [];

  for (const element of sorted) {
    const center = getReferenceAxisCenter(element, direction);
    const size = getReferenceAxisSize(element, direction);
    const start = getReferenceAxisValue(element, direction);
    const end = start + size;
    let targetIndex = -1;
    let smallestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      const distance = Math.abs(center - group.averageCenter);
      const tolerance = Math.max(
        SPACING_GROUP_TOLERANCE,
        ((group.averageSize + size) / 2) * SPACING_GROUP_SIZE_FACTOR,
      );
      if (distance <= tolerance && distance < smallestDistance) {
        smallestDistance = distance;
        targetIndex = index;
      }
    }

    if (targetIndex < 0) {
      let bestOverlap = 0;
      for (let index = 0; index < groups.length; index += 1) {
        const group = groups[index];
        const overlap = computeOverlapRatio(
          group.minEdge,
          group.maxEdge,
          start,
          end,
        );
        if (
          overlap >= SPACING_GROUP_OVERLAP_THRESHOLD &&
          overlap > bestOverlap
        ) {
          bestOverlap = overlap;
          targetIndex = index;
        }
      }
    }

    if (targetIndex < 0) {
      groups.push({
        elements: [element],
        averageCenter: center,
        averageSize: size,
        minEdge: start,
        maxEdge: end,
      });
      continue;
    }

    const group = groups[targetIndex];
    group.elements.push(element);
    group.averageCenter =
      group.elements.reduce(
        (sum, current) => sum + getReferenceAxisCenter(current, direction),
        0,
      ) / group.elements.length;
    group.averageSize =
      group.elements.reduce(
        (sum, current) => sum + getReferenceAxisSize(current, direction),
        0,
      ) / group.elements.length;
    group.minEdge = Math.min(group.minEdge, start);
    group.maxEdge = Math.max(group.maxEdge, end);
  }

  return groups.map((group) => group.elements);
};

const countAxisPairs = (groups: BatchGeometryLayoutElement[][]): number =>
  groups.reduce((sum, group) => sum + Math.max(0, group.length - 1), 0);

const inferSpacingAxisPlan = (
  elements: BatchGeometryLayoutElement[],
): SpacingAxisPlan => {
  const horizontalGroups = groupElementsByReferenceAxis(elements, 'horizontal');
  const verticalGroups = groupElementsByReferenceAxis(elements, 'vertical');
  return {
    applyHorizontal: countAxisPairs(horizontalGroups) > 0,
    applyVertical:
      horizontalGroups.length >= 2 || countAxisPairs(verticalGroups) > 0,
    horizontalGroups,
    verticalGroups,
  };
};

const collectAxisGapsFromGroups = (
  groups: BatchGeometryLayoutElement[][],
  direction: AxisDirection,
): number[] =>
  groups.flatMap((group) => {
    if (group.length < 2) return [];
    const sorted = sortByPrimaryAxis(group, direction);
    return sorted.slice(1).map((element, index) => {
      const previous = sorted[index];
      return (
        getPrimaryAxisValue(element, direction) -
        (getPrimaryAxisValue(previous, direction) +
          getPrimaryAxisSize(previous, direction))
      );
    });
  });

const collectRowGaps = (
  horizontalGroups: BatchGeometryLayoutElement[][],
): number[] => {
  if (horizontalGroups.length < 2) return [];
  const sortedRows = [...horizontalGroups].sort((a, b) => {
    const centerA =
      a.reduce((sum, element) => sum + element.y + element.height / 2, 0) /
      a.length;
    const centerB =
      b.reduce((sum, element) => sum + element.y + element.height / 2, 0) /
      b.length;
    return centerA - centerB;
  });
  return sortedRows.slice(1).map((row, index) => {
    const previous = sortedRows[index];
    const previousBottom = Math.max(
      ...previous.map((element) => element.y + element.height),
    );
    return Math.min(...row.map((element) => element.y)) - previousBottom;
  });
};

export const computeBatchSpacingValue = (
  elements: readonly BatchGeometryLayoutElement[],
): { isMixed: boolean; value: number } => {
  if (elements.length < 2) return { isMixed: false, value: 0 };
  const axisPlan = inferSpacingAxisPlan(
    elements.map((element) => ({ ...element })),
  );
  const rawGaps: number[] = [];
  if (axisPlan.applyHorizontal) {
    rawGaps.push(
      ...collectAxisGapsFromGroups(axisPlan.horizontalGroups, 'horizontal'),
    );
  }
  if (axisPlan.applyVertical) {
    const rowGaps = collectRowGaps(axisPlan.horizontalGroups);
    rawGaps.push(
      ...(rowGaps.length > 0
        ? rowGaps
        : collectAxisGapsFromGroups(axisPlan.verticalGroups, 'vertical')),
    );
  }
  const gaps = rawGaps.map((gap) => roundToSpacingPrecision(Math.max(0, gap)));
  if (gaps.length === 0) return { isMixed: false, value: 0 };
  return {
    isMixed: gaps.some(
      (gap) => Math.abs(gap - gaps[0]) > POSITION_CHANGE_EPSILON,
    ),
    value: gaps[0],
  };
};

const applyAxisSpacing = (
  direction: AxisDirection,
  spacing: number,
  updates: Map<string, Partial<EditorBoundsV1>>,
  groups: BatchGeometryLayoutElement[][],
): boolean => {
  let applied = false;
  for (const group of groups) {
    if (group.length < 2) continue;
    const sorted = sortByPrimaryAxis(group, direction);
    const stacks: Array<{
      start: number;
      maxSize: number;
      elements: BatchGeometryLayoutElement[];
    }> = [];
    for (const element of sorted) {
      const start = getPrimaryAxisValue(element, direction);
      const size = getPrimaryAxisSize(element, direction);
      const last = stacks[stacks.length - 1];
      if (last && Math.abs(start - last.start) <= PRIMARY_AXIS_STACK_EPSILON) {
        last.elements.push(element);
        last.maxSize = Math.max(last.maxSize, size);
      } else {
        stacks.push({ start, maxSize: size, elements: [element] });
      }
    }

    let currentStart = stacks[0].start;
    stacks.forEach((stack, index) => {
      if (index > 0) {
        currentStart += stacks[index - 1].maxSize + spacing;
      }
      const normalized = roundToSpacingPrecision(currentStart);
      for (const element of stack.elements) {
        const patch = updates.get(element.key) ?? {};
        if (direction === 'horizontal') {
          patch.dx = normalized;
          element.x = normalized;
        } else {
          patch.dy = normalized;
          element.y = normalized;
        }
        updates.set(element.key, patch);
      }
    });
    applied = true;
  }
  return applied;
};

const applyVerticalRowSpacing = (
  horizontalGroups: BatchGeometryLayoutElement[][],
  spacing: number,
  updates: Map<string, Partial<EditorBoundsV1>>,
): boolean => {
  const rows = horizontalGroups.filter((group) => group.length > 0);
  if (rows.length < 2) return false;
  const sortedRows = [...rows].sort((a, b) => {
    const centerA =
      a.reduce((sum, element) => sum + element.y + element.height / 2, 0) /
      a.length;
    const centerB =
      b.reduce((sum, element) => sum + element.y + element.height / 2, 0) /
      b.length;
    return centerA - centerB;
  });
  const rowSpan = (row: BatchGeometryLayoutElement[]) =>
    Math.max(...row.map((element) => element.y + element.height)) -
    Math.min(...row.map((element) => element.y));
  let currentMinY = Math.min(...sortedRows[0].map((element) => element.y));
  let previousSpan = rowSpan(sortedRows[0]);

  sortedRows.forEach((row, index) => {
    if (index > 0) {
      currentMinY = roundToSpacingPrecision(
        currentMinY + previousSpan + spacing,
      );
    }
    const originalMinY = Math.min(...row.map((element) => element.y));
    for (const element of row) {
      const nextY = roundToSpacingPrecision(
        currentMinY + element.y - originalMinY,
      );
      const patch = updates.get(element.key) ?? {};
      patch.dy = nextY;
      element.y = nextY;
      updates.set(element.key, patch);
    }
    previousSpan = rowSpan(row);
  });
  return true;
};

const materializePlan = (
  original: BatchGeometryLayoutElement[],
  working: BatchGeometryLayoutElement[],
  updates: Map<string, Partial<EditorBoundsV1>>,
  preserveUnchangedUpdates: boolean,
): BatchGeometryPlan | null => {
  const originalByKey = new Map(
    original.map((element) => [element.key, element] as const),
  );
  const changed = [...updates.entries()].filter(([key, patch]) => {
    const before = originalByKey.get(key);
    if (!before) return false;
    return (
      (patch.dx !== undefined &&
        Math.abs(patch.dx - before.x) > POSITION_CHANGE_EPSILON) ||
      (patch.dy !== undefined &&
        Math.abs(patch.dy - before.y) > POSITION_CHANGE_EPSILON) ||
      (patch.width !== undefined &&
        Math.abs(patch.width - before.width) > POSITION_CHANGE_EPSILON) ||
      (patch.height !== undefined &&
        Math.abs(patch.height - before.height) > POSITION_CHANGE_EPSILON)
    );
  });
  const emitted = preserveUnchangedUpdates ? [...updates.entries()] : changed;
  return {
    updates: emitted.map(([key, patch]) => ({ key, patch })),
    bounds: working.map((element) => ({
      key: element.key,
      bounds: {
        dx: element.x,
        dy: element.y,
        width: element.width,
        height: element.height,
      },
    })),
  };
};

export const computeBatchGeometryPlan = (
  elements: readonly BatchGeometryLayoutElement[],
  operation: BatchGeometryOperation,
): BatchGeometryPlan | null => {
  const minimum =
    operation.kind === 'distribute' ? 3 : operation.kind === 'resize' ? 1 : 2;
  if (
    elements.length < minimum ||
    new Set(elements.map((element) => element.key)).size !== elements.length ||
    elements.some(
      (element) =>
        !Number.isFinite(element.x) ||
        !Number.isFinite(element.y) ||
        !Number.isFinite(element.width) ||
        !Number.isFinite(element.height) ||
        element.width <= 0 ||
        element.height <= 0,
    )
  ) {
    return null;
  }

  const original = elements.map((element) => ({ ...element }));
  const working = elements.map((element) => ({ ...element }));
  const updates = new Map<string, Partial<EditorBoundsV1>>();
  const setPatch = (
    element: BatchGeometryLayoutElement,
    patch: Partial<EditorBoundsV1>,
  ) => {
    updates.set(element.key, { ...(updates.get(element.key) ?? {}), ...patch });
    if (patch.dx !== undefined) element.x = patch.dx;
    if (patch.dy !== undefined) element.y = patch.dy;
    if (patch.width !== undefined) element.width = patch.width;
    if (patch.height !== undefined) element.height = patch.height;
  };

  if (operation.kind === 'align') {
    const minX = Math.min(...working.map((element) => element.x));
    const maxX = Math.max(
      ...working.map((element) => element.x + element.width),
    );
    const minY = Math.min(...working.map((element) => element.y));
    const maxY = Math.max(
      ...working.map((element) => element.y + element.height),
    );
    for (const element of working) {
      if (operation.direction === 'left') setPatch(element, { dx: minX });
      if (operation.direction === 'centerH') {
        setPatch(element, { dx: (minX + maxX) / 2 - element.width / 2 });
      }
      if (operation.direction === 'right') {
        setPatch(element, { dx: maxX - element.width });
      }
      if (operation.direction === 'top') setPatch(element, { dy: minY });
      if (operation.direction === 'centerV') {
        setPatch(element, { dy: (minY + maxY) / 2 - element.height / 2 });
      }
      if (operation.direction === 'bottom') {
        setPatch(element, { dy: maxY - element.height });
      }
    }
  } else if (operation.kind === 'distribute') {
    const horizontal = operation.direction === 'horizontal';
    const sorted = [...working].sort((a, b) =>
      horizontal ? a.x - b.x : a.y - b.y,
    );
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const span = horizontal
      ? last.x + last.width - first.x
      : last.y + last.height - first.y;
    const totalSize = sorted.reduce(
      (sum, element) => sum + (horizontal ? element.width : element.height),
      0,
    );
    const gap = (span - totalSize) / (sorted.length - 1);
    let cursor = horizontal ? first.x : first.y;
    for (const element of sorted) {
      if (horizontal) setPatch(element, { dx: cursor });
      else setPatch(element, { dy: cursor });
      cursor += (horizontal ? element.width : element.height) + gap;
    }
  } else if (operation.kind === 'spacing') {
    if (!Number.isFinite(operation.spacing)) return null;
    const spacing = roundToSpacingPrecision(Math.max(0, operation.spacing));
    const axisPlan = inferSpacingAxisPlan(working);
    if (axisPlan.applyHorizontal) {
      applyAxisSpacing(
        'horizontal',
        spacing,
        updates,
        axisPlan.horizontalGroups,
      );
    }
    if (axisPlan.applyVertical) {
      const appliedRows = applyVerticalRowSpacing(
        axisPlan.horizontalGroups,
        spacing,
        updates,
      );
      if (!appliedRows) {
        applyAxisSpacing('vertical', spacing, updates, axisPlan.verticalGroups);
      }
    }
  } else {
    if (!Number.isFinite(operation.value) || operation.value <= 0) {
      return null;
    }
    for (const element of working) {
      setPatch(element, { [operation.dimension]: operation.value });
    }
  }

  return materializePlan(
    original,
    working,
    updates,
    operation.kind !== 'spacing',
  );
};
