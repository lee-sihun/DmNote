import type {
  KeyPosition,
  NoteColor,
  KeyCounterSettings,
} from '@src/types/key/keys';
import { normalizeCounterSettings } from '@src/types/key/keys';
import {
  getActivePairPreservation,
  gradientPairPatch,
  type ColorModeValue,
} from '@src/types/color';
import type { StatItemPosition } from '@src/types/key/statItems';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';
import {
  resolveElementShadow,
  type ElementShadowSpec,
} from '@src/types/key/shadows';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { editorCoordinator } from '@src/renderer/editor/runtime/editorStateCoordinator';
import {
  DEFAULT_ELEMENT_SHADOW_SPEC,
  DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
} from '@utils/core/elementDefaults';

import type { EditorPatchV1 } from '@src/types/editor';

const SPACING_GROUP_TOLERANCE = 2;
const SPACING_DECIMAL_SCALE = 1;
const POSITION_CHANGE_EPSILON = 0.05;
const SPACING_GROUP_SIZE_FACTOR = 0.35;
// 엣지 오버랩 기반 그룹핑: 작은 쪽 크기의 이 비율 이상 겹치면 같은 행/열로 판정
const SPACING_GROUP_OVERLAP_THRESHOLD = 0.45;
// 같은 축 시작점이 사실상 동일한 요소(같은 열/행)로 보는 허용 오차
const PRIMARY_AXIS_STACK_EPSILON = 0.1;

type KeyLikeType = 'key' | 'stat' | 'graph' | 'knob';
type AxisDirection = 'horizontal' | 'vertical';
type IdleColorProperty = 'backgroundColor' | 'borderColor' | 'fontColor';
type ActiveColorProperty =
  | 'activeBackgroundColor'
  | 'activeBorderColor'
  | 'activeFontColor';

const ACTIVE_COLOR_PROPERTY: Record<IdleColorProperty, ActiveColorProperty> = {
  backgroundColor: 'activeBackgroundColor',
  borderColor: 'activeBorderColor',
  fontColor: 'activeFontColor',
};

const GRADIENT_PROPERTY = {
  backgroundColor: {
    idle: 'backgroundGradient',
    active: 'activeBackgroundGradient',
  },
  borderColor: {
    idle: 'borderGradient',
    active: 'activeBorderGradient',
  },
} as const;

const isIdleColorProperty = (
  property: keyof KeyPosition,
): property is IdleColorProperty => property in ACTIVE_COLOR_PROPERTY;

const ACTIVE_STATE_PROPERTIES = new Set<keyof KeyPosition>([
  'activeBackgroundColor',
  'activeBorderColor',
  'activeFontColor',
  'activeBackgroundGradient',
  'activeBorderGradient',
  'activeImage',
  'activeTransparent',
  'activeImageFit',
  'activeShadow',
]);

const isActiveStateProperty = (property: keyof KeyPosition): boolean =>
  ACTIVE_STATE_PROPERTIES.has(property);

const buildBatchStyleUpdate = (
  index: number,
  position: KeyPosition | undefined,
  property: keyof KeyPosition,
  value: KeyPosition[keyof KeyPosition],
  includeFontColor = true,
  preserveActiveState = true,
): { index: number } & Partial<KeyPosition> => {
  const update = { index, [property]: value } as {
    index: number;
  } & Partial<KeyPosition>;
  if (
    !position ||
    !preserveActiveState ||
    !isIdleColorProperty(property) ||
    (!includeFontColor && property === 'fontColor')
  ) {
    return update;
  }

  const activeProperty = ACTIVE_COLOR_PROPERTY[property];
  const gradientProperty =
    property === 'fontColor' ? undefined : GRADIENT_PROPERTY[property];
  const preservation = getActivePairPreservation(
    {
      color: position[property],
      gradient: gradientProperty ? position[gradientProperty.idle] : undefined,
    },
    {
      color: position[activeProperty],
      gradient: gradientProperty
        ? position[gradientProperty.active]
        : undefined,
    },
  );
  if (preservation?.color !== undefined) {
    Object.assign(update, { [activeProperty]: preservation.color });
  }
  if (gradientProperty && preservation?.gradient !== undefined) {
    Object.assign(update, {
      [gradientProperty.active]: preservation.gradient,
    });
  }
  return update;
};

interface LayoutElement {
  type: KeyLikeType;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

type KeyLikeBatchUpdate = {
  type: KeyLikeType;
  index: number;
} & Partial<KeyPosition>;

type BatchCommitOptions = {
  skipHistory?: boolean;
  deferSave?: boolean;
};

interface SpacingAxisPlan {
  applyHorizontal: boolean;
  applyVertical: boolean;
  horizontalGroups: LayoutElement[][];
  verticalGroups: LayoutElement[][];
}

interface SelectedElement {
  type: KeyLikeType;
  index?: number;
}

const roundToSpacingPrecision = (value: number): number => {
  const factor = 10 ** SPACING_DECIMAL_SCALE;
  return Math.round(value * factor) / factor;
};

const getLayoutElementKey = (type: KeyLikeType, index: number): string =>
  `${type}:${index}`;

const getReferenceAxisValue = (
  element: LayoutElement,
  direction: AxisDirection,
): number => (direction === 'horizontal' ? element.y : element.x);

const getReferenceAxisSize = (
  element: LayoutElement,
  direction: AxisDirection,
): number => (direction === 'horizontal' ? element.height : element.width);

const getReferenceAxisCenter = (
  element: LayoutElement,
  direction: AxisDirection,
): number =>
  getReferenceAxisValue(element, direction) +
  getReferenceAxisSize(element, direction) / 2;

const getPrimaryAxisValue = (
  element: LayoutElement,
  direction: AxisDirection,
): number => (direction === 'horizontal' ? element.x : element.y);

const getPrimaryAxisSize = (
  element: LayoutElement,
  direction: AxisDirection,
): number => (direction === 'horizontal' ? element.width : element.height);

const sortByPrimaryAxis = (
  elements: LayoutElement[],
  direction: AxisDirection,
): LayoutElement[] =>
  [...elements].sort(
    (a, b) =>
      getPrimaryAxisValue(a, direction) - getPrimaryAxisValue(b, direction),
  );

const _getAxisSpan = (
  elements: LayoutElement[],
  direction: AxisDirection,
): number => {
  if (elements.length === 0) return 0;
  const starts = elements.map((element) =>
    getPrimaryAxisValue(element, direction),
  );
  const ends = elements.map(
    (element) =>
      getPrimaryAxisValue(element, direction) +
      getPrimaryAxisSize(element, direction),
  );
  return Math.max(...ends) - Math.min(...starts);
};

/**
 * 두 범위의 오버랩 비율을 계산 (작은 쪽 크기 기준)
 * 같은 행/열에 있지만 크기가 다른 요소를 정확히 감지하기 위한 헬퍼
 */
const computeOverlapRatio = (
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): number => {
  const overlapStart = Math.max(startA, startB);
  const overlapEnd = Math.min(endA, endB);
  const overlapLength = Math.max(0, overlapEnd - overlapStart);
  const sizeA = endA - startA;
  const sizeB = endB - startB;
  const minSize = Math.min(sizeA, sizeB);
  if (minSize <= 0) return 0;
  return overlapLength / minSize;
};

/**
 * 그룹의 교차축 바운딩 범위와 요소의 오버랩 비율을 계산
 */
const computeGroupOverlapRatio = (
  group: { minEdge: number; maxEdge: number },
  elementStart: number,
  elementEnd: number,
): number => {
  return computeOverlapRatio(
    group.minEdge,
    group.maxEdge,
    elementStart,
    elementEnd,
  );
};

const groupElementsByReferenceAxis = (
  elements: LayoutElement[],
  direction: AxisDirection,
): LayoutElement[][] => {
  const sortedByReference = [...elements].sort(
    (a, b) =>
      getReferenceAxisCenter(a, direction) -
      getReferenceAxisCenter(b, direction),
  );

  const groups: Array<{
    elements: LayoutElement[];
    averageCenter: number;
    averageSize: number;
    // 그룹의 교차축 바운딩 범위 (엣지 오버랩 판정용)
    minEdge: number;
    maxEdge: number;
  }> = [];

  for (const element of sortedByReference) {
    const elementCenter = getReferenceAxisCenter(element, direction);
    const elementSize = getReferenceAxisSize(element, direction);
    const elementStart = getReferenceAxisValue(element, direction);
    const elementEnd = elementStart + elementSize;

    let targetGroupIndex = -1;
    let smallestDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i];
      const distance = Math.abs(elementCenter - group.averageCenter);
      const dynamicTolerance = Math.max(
        SPACING_GROUP_TOLERANCE,
        ((group.averageSize + elementSize) / 2) * SPACING_GROUP_SIZE_FACTOR,
      );

      // 1차: 기존 중심점 거리 기반 매칭
      if (distance <= dynamicTolerance && distance < smallestDistance) {
        smallestDistance = distance;
        targetGroupIndex = i;
      }
    }

    // 2차: 중심점 매칭 실패 시 엣지 오버랩 기반 매칭
    // 크기가 다른 요소가 같은 행/열에 있을 때 누락 방지
    if (targetGroupIndex < 0) {
      let bestOverlap = 0;
      for (let i = 0; i < groups.length; i += 1) {
        const group = groups[i];
        const overlap = computeGroupOverlapRatio(
          group,
          elementStart,
          elementEnd,
        );
        if (
          overlap >= SPACING_GROUP_OVERLAP_THRESHOLD &&
          overlap > bestOverlap
        ) {
          bestOverlap = overlap;
          targetGroupIndex = i;
        }
      }
    }

    if (targetGroupIndex >= 0) {
      const targetGroup = groups[targetGroupIndex];
      targetGroup.elements.push(element);
      targetGroup.averageCenter =
        targetGroup.elements.reduce(
          (sum, current) => sum + getReferenceAxisCenter(current, direction),
          0,
        ) / targetGroup.elements.length;
      targetGroup.averageSize =
        targetGroup.elements.reduce(
          (sum, current) => sum + getReferenceAxisSize(current, direction),
          0,
        ) / targetGroup.elements.length;
      // 바운딩 범위 갱신
      targetGroup.minEdge = Math.min(targetGroup.minEdge, elementStart);
      targetGroup.maxEdge = Math.max(targetGroup.maxEdge, elementEnd);
    } else {
      groups.push({
        elements: [element],
        averageCenter: elementCenter,
        averageSize: elementSize,
        minEdge: elementStart,
        maxEdge: elementEnd,
      });
    }
  }

  return groups.map((group) => group.elements);
};

const countAxisPairs = (groups: LayoutElement[][]): number => {
  return groups.reduce((sum, group) => sum + Math.max(0, group.length - 1), 0);
};

const inferSpacingAxisPlan = (elements: LayoutElement[]): SpacingAxisPlan => {
  const horizontalGroups = groupElementsByReferenceAxis(elements, 'horizontal');
  const verticalGroups = groupElementsByReferenceAxis(elements, 'vertical');

  // 수평 적용 여부: 하나 이상의 행에 2개 이상의 요소가 있으면 수평 간격 조절 가능
  const applyHorizontal = countAxisPairs(horizontalGroups) > 0;

  // 수직 적용 여부:
  // - 기본은 행(row) 수 기준(2개 이상)
  // - 단, 행 그룹이 1개로 뭉개진 특수 케이스(예: 세로로 긴 요소가 여러 행을 겹쳐 커버)에서는
  //   열(column) 내 쌍이 존재하면 수직 간격 fallback을 허용한다.
  const applyVertical =
    horizontalGroups.length >= 2 || countAxisPairs(verticalGroups) > 0;

  return {
    applyHorizontal,
    applyVertical,
    horizontalGroups,
    verticalGroups,
  };
};

const collectAxisGapsFromGroups = (
  groups: LayoutElement[][],
  direction: AxisDirection,
): number[] => {
  const collectFromGroup = (group: LayoutElement[]): number[] => {
    if (group.length < 2) return [];
    const sorted = sortByPrimaryAxis(group, direction);
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const current = sorted[i];
      const prevEnd =
        getPrimaryAxisValue(prev, direction) +
        getPrimaryAxisSize(prev, direction);
      const currentStart = getPrimaryAxisValue(current, direction);
      gaps.push(currentStart - prevEnd);
    }
    return gaps;
  };

  return groups.flatMap(collectFromGroup);
};

const applyAxisSpacing = (
  elements: LayoutElement[],
  direction: AxisDirection,
  spacing: number,
  updateMap: Map<string, KeyLikeBatchUpdate>,
  groups?: LayoutElement[][],
): boolean => {
  const applyToGroup = (group: LayoutElement[]): boolean => {
    if (group.length < 2) return false;
    const sorted = sortByPrimaryAxis(group, direction);
    type AxisStack = {
      start: number;
      maxSize: number;
      elements: LayoutElement[];
    };

    const stacks: AxisStack[] = [];
    for (const element of sorted) {
      const start = getPrimaryAxisValue(element, direction);
      const size = getPrimaryAxisSize(element, direction);
      const lastStack = stacks[stacks.length - 1];

      if (
        lastStack &&
        Math.abs(start - lastStack.start) <= PRIMARY_AXIS_STACK_EPSILON
      ) {
        lastStack.elements.push(element);
        lastStack.maxSize = Math.max(lastStack.maxSize, size);
      } else {
        stacks.push({
          start,
          maxSize: size,
          elements: [element],
        });
      }
    }

    let currentStart = stacks[0].start;
    stacks.forEach((stack, index) => {
      if (index > 0) {
        const prev = stacks[index - 1];
        currentStart += prev.maxSize + spacing;
      }

      const normalizedValue = roundToSpacingPrecision(currentStart);
      for (const element of stack.elements) {
        const key = getLayoutElementKey(element.type, element.index);
        const update = updateMap.get(key) ?? {
          type: element.type,
          index: element.index,
        };

        if (direction === 'horizontal') {
          update.dx = normalizedValue;
          element.x = normalizedValue;
        } else {
          update.dy = normalizedValue;
          element.y = normalizedValue;
        }
        updateMap.set(key, update);
      }
    });

    return true;
  };

  let applied = false;
  const targetGroups =
    groups ?? groupElementsByReferenceAxis(elements, direction);
  for (const group of targetGroups) {
    if (applyToGroup(group)) {
      applied = true;
    }
  }

  return applied;
};

/**
 * 행 단위 수직 간격 수집
 * 열(컬럼) 기반이 아닌 행 사이의 실제 간격을 반환
 */
const collectRowGaps = (horizontalGroups: LayoutElement[][]): number[] => {
  if (horizontalGroups.length < 2) return [];

  const sortedRows = [...horizontalGroups].sort((a, b) => {
    const centerA =
      a.reduce((sum, el) => sum + el.y + el.height / 2, 0) / a.length;
    const centerB =
      b.reduce((sum, el) => sum + el.y + el.height / 2, 0) / b.length;
    return centerA - centerB;
  });

  const gaps: number[] = [];
  for (let i = 1; i < sortedRows.length; i += 1) {
    const prevRowBottom = Math.max(
      ...sortedRows[i - 1].map((el) => el.y + el.height),
    );
    const currentRowTop = Math.min(...sortedRows[i].map((el) => el.y));
    gaps.push(currentRowTop - prevRowBottom);
  }
  return gaps;
};

/**
 * 수직 간격을 행(row) 단위로 적용
 *
 * 열(컬럼) 기반 처리는 행마다 요소 수가 다를 때 싱글톤 열 요소가 누락되어
 * 같은 행 내에서 y좌표가 달라지는 계단 현상이 발생한다.
 * 이 함수는 행 전체를 하나의 단위로 이동시켜 해당 문제를 방지한다.
 */
const applyVerticalRowSpacing = (
  horizontalGroups: LayoutElement[][],
  spacing: number,
  updateMap: Map<string, KeyLikeBatchUpdate>,
): boolean => {
  const validRows = horizontalGroups.filter((g) => g.length >= 1);
  if (validRows.length < 2) return false;

  // 행을 y 중심 기준으로 정렬
  const sortedRows = [...validRows].sort((a, b) => {
    const centerA =
      a.reduce((sum, el) => sum + el.y + el.height / 2, 0) / a.length;
    const centerB =
      b.reduce((sum, el) => sum + el.y + el.height / 2, 0) / b.length;
    return centerA - centerB;
  });

  // 첫 번째 행의 최소 y를 앵커로 사용
  let currentRowMinY = Math.min(...sortedRows[0].map((el) => el.y));
  // 행의 실제 세로 범위 = max(y + height) - min(y)
  const computeRowSpan = (row: LayoutElement[]): number => {
    const rowMinY = Math.min(...row.map((el) => el.y));
    const rowMaxBottom = Math.max(...row.map((el) => el.y + el.height));
    return rowMaxBottom - rowMinY;
  };
  let prevRowSpan = computeRowSpan(sortedRows[0]);

  for (let i = 0; i < sortedRows.length; i += 1) {
    const row = sortedRows[i];

    if (i > 0) {
      currentRowMinY = roundToSpacingPrecision(
        currentRowMinY + prevRowSpan + spacing,
      );
    }

    // 행 내 각 요소의 상대 y 오프셋을 유지
    // (세로 중앙·하단 정렬 등으로 y가 다를 수 있음)
    const rowMinY = Math.min(...row.map((el) => el.y));
    for (const element of row) {
      const relativeOffset = element.y - rowMinY;
      const newY = roundToSpacingPrecision(currentRowMinY + relativeOffset);
      const key = getLayoutElementKey(element.type, element.index);
      const update = updateMap.get(key) ?? {
        type: element.type,
        index: element.index,
      };
      update.dy = newY;
      element.y = newY;
      updateMap.set(key, update);
    }

    prevRowSpan = computeRowSpan(row);
  }

  return true;
};

interface UseBatchHandlersProps {
  selectedKeyLikeElements: SelectedElement[];
  keyPositions: Record<string, KeyPosition[] | undefined>;
  statPositions: Record<string, StatItemPosition[] | undefined>;
  graphPositions?: Record<string, GraphItemPosition[] | undefined>;
  selectedKeyType: string;
  onKeyUpdate: (data: Partial<KeyPosition> & { index: number }) => void;
  onKeyBatchUpdate?: (
    updates: Array<{ index: number } & Partial<KeyPosition>>,
    options?: BatchCommitOptions,
  ) => void;
  onKeyPreview?: (index: number, updates: Partial<KeyPosition>) => void;
  onKeyBatchPreview?: (
    updates: Array<{ index: number } & Partial<KeyPosition>>,
  ) => void;
  onStatUpdate: (data: Partial<StatItemPosition> & { index: number }) => void;
  onStatBatchUpdate?: (
    updates: Array<{ index: number } & Partial<StatItemPosition>>,
    options?: BatchCommitOptions,
  ) => void;
  onStatPreview?: (index: number, updates: Partial<StatItemPosition>) => void;
  onStatBatchPreview?: (
    updates: Array<{ index: number } & Partial<StatItemPosition>>,
  ) => void;
  onGraphUpdate?: (
    data: Partial<GraphItemPosition> & { index: number },
  ) => void;
  onGraphBatchUpdate?: (
    updates: Array<{ index: number } & Partial<GraphItemPosition>>,
    options?: BatchCommitOptions,
  ) => void;
  onGraphPreview?: (index: number, updates: Partial<GraphItemPosition>) => void;
  onGraphBatchPreview?: (
    updates: Array<{ index: number } & Partial<GraphItemPosition>>,
  ) => void;
  knobPositions?: Record<string, KnobItemPosition[] | undefined>;
  onKnobUpdate?: (data: Partial<KnobItemPosition> & { index: number }) => void;
  onKnobBatchUpdate?: (
    updates: Array<{ index: number } & Partial<KnobItemPosition>>,
    options?: BatchCommitOptions,
  ) => void;
  onKnobPreview?: (index: number, updates: Partial<KnobItemPosition>) => void;
  onKnobBatchPreview?: (
    updates: Array<{ index: number } & Partial<KnobItemPosition>>,
  ) => void;
}

export function useBatchHandlers({
  selectedKeyLikeElements,
  keyPositions,
  statPositions,
  graphPositions,
  selectedKeyType,
  onKeyUpdate,
  onKeyBatchUpdate,
  onKeyPreview,
  onKeyBatchPreview,
  onStatUpdate,
  onStatBatchUpdate,
  onStatPreview,
  onStatBatchPreview,
  onGraphUpdate,
  onGraphBatchUpdate,
  onGraphPreview,
  onGraphBatchPreview,
  knobPositions,
  onKnobUpdate,
  onKnobBatchUpdate,
  onKnobPreview,
  onKnobBatchPreview,
}: UseBatchHandlersProps) {
  const selectedKeys = selectedKeyLikeElements.filter(
    (el) => el.type === 'key',
  );
  const selectedStats = selectedKeyLikeElements.filter(
    (el) => el.type === 'stat',
  );
  const selectedGraphs = selectedKeyLikeElements.filter(
    (el) => el.type === 'graph',
  );
  const selectedKnobs = selectedKeyLikeElements.filter(
    (el) => el.type === 'knob',
  );

  const getKeyLikePosition = (type: KeyLikeType, index: number) => {
    if (type === 'key') return keyPositions[selectedKeyType]?.[index] ?? null;
    if (type === 'stat') return statPositions[selectedKeyType]?.[index] ?? null;
    if (type === 'knob')
      return knobPositions?.[selectedKeyType]?.[index] ?? null;
    return graphPositions?.[selectedKeyType]?.[index] ?? null;
  };

  const dispatchKeyUpdates = (
    updates: Array<{ index: number } & Partial<KeyPosition>>,
    kind: 'preview' | 'commit',
    options?: BatchCommitOptions,
  ) => {
    if (updates.length === 0) return;
    if (kind === 'preview') {
      if (onKeyBatchPreview) {
        onKeyBatchPreview(updates);
        return;
      }
      if (onKeyPreview) {
        updates.forEach(({ index, ...rest }) => onKeyPreview(index, rest));
        return;
      }
      return;
    }

    if (onKeyBatchUpdate) {
      onKeyBatchUpdate(updates, options);
      return;
    }
    updates.forEach((update) => onKeyUpdate(update));
  };

  const dispatchStatUpdates = (
    updates: Array<{ index: number } & Partial<StatItemPosition>>,
    kind: 'preview' | 'commit',
    options?: BatchCommitOptions,
  ) => {
    if (updates.length === 0) return;
    if (kind === 'preview') {
      if (onStatBatchPreview) {
        onStatBatchPreview(updates);
        return;
      }
      if (onStatPreview) {
        updates.forEach(({ index, ...rest }) => onStatPreview(index, rest));
        return;
      }
      // preview 핸들러가 없으면 즉시 반영
      updates.forEach((update) => onStatUpdate(update));
      return;
    }

    if (onStatBatchUpdate) {
      onStatBatchUpdate(updates, options);
      return;
    }
    updates.forEach((update) => onStatUpdate(update));
  };

  const dispatchGraphUpdates = (
    updates: Array<{ index: number } & Partial<GraphItemPosition>>,
    kind: 'preview' | 'commit',
    options?: BatchCommitOptions,
  ) => {
    if (updates.length === 0) return;
    if (kind === 'preview') {
      if (onGraphBatchPreview) {
        onGraphBatchPreview(updates);
        return;
      }
      if (onGraphPreview) {
        updates.forEach(({ index, ...rest }) => onGraphPreview(index, rest));
        return;
      }
      if (onGraphUpdate) {
        updates.forEach((update) => onGraphUpdate(update));
      }
      return;
    }

    if (onGraphBatchUpdate) {
      onGraphBatchUpdate(updates, options);
      return;
    }
    if (onGraphUpdate) {
      updates.forEach((update) => onGraphUpdate(update));
    }
  };

  const dispatchKnobUpdates = (
    updates: Array<{ index: number } & Partial<KnobItemPosition>>,
    kind: 'preview' | 'commit',
    options?: BatchCommitOptions,
  ) => {
    if (updates.length === 0) return;
    if (kind === 'preview') {
      if (onKnobBatchPreview) {
        onKnobBatchPreview(updates);
        return;
      }
      if (onKnobPreview) {
        updates.forEach(({ index, ...rest }) => onKnobPreview(index, rest));
        return;
      }
      if (onKnobUpdate) {
        updates.forEach((update) => onKnobUpdate(update));
      }
      return;
    }

    if (onKnobBatchUpdate) {
      onKnobBatchUpdate(updates, options);
      return;
    }
    if (onKnobUpdate) {
      updates.forEach((update) => onKnobUpdate(update));
    }
  };

  const getSelectedLayoutElements = (): LayoutElement[] => {
    return selectedKeyLikeElements
      .filter(
        (el): el is { type: KeyLikeType; index: number } =>
          el.index !== undefined,
      )
      .map((el) => {
        const pos = getKeyLikePosition(el.type, el.index);
        if (!pos) return null;
        return {
          type: el.type,
          index: el.index,
          x: pos.dx,
          y: pos.dy,
          width: pos.width,
          height: pos.height,
        };
      })
      .filter((element): element is LayoutElement => element !== null);
  };

  const dispatchKeyLikeUpdates = (
    updates: KeyLikeBatchUpdate[],
    kind: 'preview' | 'commit' = 'commit',
    options?: BatchCommitOptions,
  ) => {
    const keyUpdates = updates
      .filter((u) => u.type === 'key')
      .map(({ type: _t, ...rest }) => rest) as Array<
      { index: number } & Partial<KeyPosition>
    >;
    const statUpdates = updates
      .filter((u) => u.type === 'stat')
      .map(({ type: _t, ...rest }) => rest) as Array<
      { index: number } & Partial<StatItemPosition>
    >;
    const graphUpdates = updates
      .filter((u) => u.type === 'graph')
      .map(({ type: _t, ...rest }) => rest) as Array<
      { index: number } & Partial<GraphItemPosition>
    >;
    const knobUpdates = updates
      .filter((u) => u.type === 'knob')
      .map(({ type: _t, ...rest }) => rest) as Array<
      { index: number } & Partial<KnobItemPosition>
    >;

    if (kind === 'preview') {
      dispatchKeyUpdates(keyUpdates, 'preview');
      dispatchStatUpdates(statUpdates, 'preview');
      dispatchGraphUpdates(graphUpdates, 'preview');
      dispatchKnobUpdates(knobUpdates, 'preview');
      return;
    }

    let hasSavedHistory = options?.skipHistory === true;
    if (keyUpdates.length > 0) {
      dispatchKeyUpdates(keyUpdates, 'commit', {
        skipHistory: hasSavedHistory,
        deferSave: true,
      });
      hasSavedHistory = true;
    }
    if (statUpdates.length > 0) {
      dispatchStatUpdates(statUpdates, 'commit', {
        skipHistory: hasSavedHistory,
        deferSave: true,
      });
      hasSavedHistory = true;
    }
    if (graphUpdates.length > 0) {
      dispatchGraphUpdates(graphUpdates, 'commit', {
        skipHistory: hasSavedHistory,
        deferSave: true,
      });
      hasSavedHistory = true;
    }
    if (knobUpdates.length > 0) {
      dispatchKnobUpdates(knobUpdates, 'commit', {
        skipHistory: hasSavedHistory,
        deferSave: true,
      });
    }

    const patch: EditorPatchV1 = { schemaVersion: 1 };
    if (keyUpdates.length > 0) {
      patch.keyPositions = useKeyStore.getState().positions;
    }
    if (statUpdates.length > 0) {
      patch.statPositions = useStatItemStore.getState().positions;
    }
    if (graphUpdates.length > 0) {
      patch.graphPositions = useGraphItemStore.getState().positions;
    }
    if (knobUpdates.length > 0) {
      patch.knobPositions = useKnobItemStore.getState().positions;
    }
    void editorCoordinator.commitPatch(patch).catch((error) => {
      console.error('Failed to commit combined batch update', error);
    });
  };

  // 스타일 변경 (프리뷰)
  const handleBatchStyleChange = (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
  ) => {
    const keyUpdates = selectedKeys
      .filter((el) => el.index !== undefined)
      .map((el) => ({ index: el.index!, [property]: value })) as Array<
      { index: number } & Partial<KeyPosition>
    >;
    dispatchKeyUpdates(keyUpdates, 'preview');

    const statUpdates = isActiveStateProperty(property)
      ? []
      : (selectedStats
          .filter((el) => el.index !== undefined)
          .map((el) => ({ index: el.index!, [property]: value })) as Array<
          { index: number } & Partial<StatItemPosition>
        >);
    dispatchStatUpdates(statUpdates, 'preview');

    const graphUpdates = isActiveStateProperty(property)
      ? []
      : (selectedGraphs
          .filter((el) => el.index !== undefined)
          .map((el) => ({ index: el.index!, [property]: value })) as Array<
          { index: number } & Partial<GraphItemPosition>
        >);
    dispatchGraphUpdates(graphUpdates, 'preview');

    const knobUpdates = selectedKnobs
      .filter((el) => el.index !== undefined)
      .map((el) => ({ index: el.index!, [property]: value })) as Array<
      { index: number } & Partial<KnobItemPosition>
    >;
    dispatchKnobUpdates(knobUpdates, 'preview');
  };

  // 스타일 변경 완료 (저장)
  const handleBatchStyleChangeComplete = (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
  ) => {
    const currentKeys = keyPositions[selectedKeyType] || [];
    const currentStats = statPositions[selectedKeyType] || [];

    const keyUpdates = selectedKeys
      .filter((el) => el.index !== undefined)
      .map((el) => {
        const index = el.index!;
        return buildBatchStyleUpdate(
          index,
          currentKeys[index],
          property,
          value,
        );
      });
    const statUpdates = isActiveStateProperty(property)
      ? []
      : selectedStats
          .filter((el) => el.index !== undefined)
          .map((el) => {
            const index = el.index!;
            return buildBatchStyleUpdate(
              index,
              currentStats[index],
              property,
              value,
              true,
              false,
            ) as { index: number } & Partial<StatItemPosition>;
          });
    const graphUpdates = isActiveStateProperty(property)
      ? []
      : (selectedGraphs
          .filter((el) => el.index !== undefined)
          .map((el) => ({ index: el.index!, [property]: value })) as Array<
          { index: number } & Partial<GraphItemPosition>
        >);
    const currentKnobs = knobPositions?.[selectedKeyType] || [];
    const knobUpdates = selectedKnobs
      .filter((el) => el.index !== undefined)
      .map((el) => {
        const index = el.index!;
        return buildBatchStyleUpdate(
          index,
          currentKnobs[index],
          property,
          value,
          false,
        ) as { index: number } & Partial<KnobItemPosition>;
      });
    dispatchKeyLikeUpdates([
      ...keyUpdates.map((update) => ({ type: 'key' as const, ...update })),
      ...statUpdates.map((update) => ({
        type: 'stat' as const,
        ...update,
      })),
      ...graphUpdates.map((update) => ({
        type: 'graph' as const,
        ...update,
      })),
      ...knobUpdates.map((update) => ({
        type: 'knob' as const,
        ...update,
      })),
    ] as KeyLikeBatchUpdate[]);
  };

  // 요소별 저장값+기본값을 합친 실제 그림자 (이미지·노브 투명 등 기본 억제 규칙 포함)
  const resolveShadowFor = (
    position: KeyPosition,
    active: boolean,
    kind: 'key' | 'knob',
  ): ElementShadowSpec => {
    const hasImage = Boolean(
      active
        ? position.activeImage?.trim() || position.inactiveImage?.trim()
        : position.inactiveImage?.trim(),
    );
    const suppressDefault =
      hasImage ||
      (kind === 'knob' &&
        ((active
          ? position.activeTransparent === true
          : position.idleTransparent === true) ||
          (position.borderWidth ?? 0) > 0));
    return resolveElementShadow({
      active,
      shadow: position.shadow,
      activeShadow: position.activeShadow,
      defaultShadow: DEFAULT_ELEMENT_SHADOW_SPEC,
      defaultActiveShadow: DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
      suppressDefault,
    });
  };

  const dispatchShadowUpdates = (
    buildUpdate: (
      index: number,
      position: KeyPosition | undefined,
      kind: 'key' | 'knob',
      elementType: 'key' | 'stat' | 'knob',
    ) => { index: number } & Partial<KeyPosition>,
  ) => {
    const currentKeys = keyPositions[selectedKeyType] || [];
    const currentStats = statPositions[selectedKeyType] || [];
    const currentKnobs = knobPositions?.[selectedKeyType] || [];

    dispatchKeyLikeUpdates([
      ...selectedKeys
        .filter((element) => element.index !== undefined)
        .map((element) => ({
          type: 'key' as const,
          ...buildUpdate(
            element.index!,
            currentKeys[element.index!],
            'key',
            'key',
          ),
        })),
      ...selectedStats
        .filter((element) => element.index !== undefined)
        .map((element) => ({
          type: 'stat' as const,
          ...buildUpdate(
            element.index!,
            currentStats[element.index!],
            'key',
            'stat',
          ),
        })),
      ...selectedKnobs
        .filter((element) => element.index !== undefined)
        .map((element) => ({
          type: 'knob' as const,
          ...buildUpdate(
            element.index!,
            currentKnobs[element.index!],
            'knob',
            'knob',
          ),
        })),
    ] as KeyLikeBatchUpdate[]);
  };

  const handleBatchShadowChangeComplete = (
    state: 'idle' | 'active',
    patch: Partial<ElementShadowSpec>,
  ) => {
    const active = state === 'active';
    const field = active ? 'activeShadow' : 'shadow';
    dispatchShadowUpdates((index, position, kind, elementType) => {
      if (!position) return { index };
      // 통계는 눌림 상태가 없음 — 입력 그림자를 기록하지 않음
      if (active && elementType === 'stat') return { index };
      return {
        index,
        [field]: { ...resolveShadowFor(position, active, kind), ...patch },
      };
    });
  };

  // 마스터 토글 — 대기·입력 그림자를 요소별 현재 값 기준으로 한 번에 켜고 끔
  const handleBatchShadowEnabledChange = (enabled: boolean) => {
    dispatchShadowUpdates((index, position, kind, elementType) => {
      if (!position) return { index };
      return {
        index,
        shadow: { ...resolveShadowFor(position, false, kind), enabled },
        // 통계는 눌림 상태가 없음 — activeShadow 실체화 금지
        ...(elementType === 'stat'
          ? {}
          : {
              activeShadow: {
                ...resolveShadowFor(position, true, kind),
                enabled,
              },
            }),
      };
    });
  };

  // 그라데이션 커밋 — 배경/테두리 쌍(base+sibling)을 선택 요소 전체에 atomic 적용
  const handleBatchGradientCommit = (
    target: 'backgroundColor' | 'borderColor',
    state: 'idle' | 'active',
    value: ColorModeValue,
  ) => {
    const isBg = target === 'backgroundColor';
    const baseField =
      state === 'active'
        ? isBg
          ? 'activeBackgroundColor'
          : 'activeBorderColor'
        : target;
    const pairPatch = gradientPairPatch(
      baseField,
      value,
    ) as Partial<KeyPosition>;

    const buildUpdate = (
      index: number,
      pos: KeyPosition | undefined,
      preserveActiveState = true,
    ): { index: number } & Partial<KeyPosition> => {
      const update: { index: number } & Partial<KeyPosition> = {
        index,
        ...pairPatch,
      };
      // idle 편집 전 사용자 저장값 기준 active 쌍 보존
      if (state === 'idle' && pos && preserveActiveState) {
        const preservation = getActivePairPreservation(
          {
            color: isBg ? pos.backgroundColor : pos.borderColor,
            gradient: isBg ? pos.backgroundGradient : pos.borderGradient,
          },
          {
            color: isBg ? pos.activeBackgroundColor : pos.activeBorderColor,
            gradient: isBg
              ? pos.activeBackgroundGradient
              : pos.activeBorderGradient,
          },
        );
        if (preservation?.color !== undefined) {
          if (isBg) {
            update.activeBackgroundColor = preservation.color;
          } else {
            update.activeBorderColor = preservation.color;
          }
        }
        if (preservation?.gradient !== undefined) {
          if (isBg) {
            update.activeBackgroundGradient = preservation.gradient;
          } else {
            update.activeBorderGradient = preservation.gradient;
          }
        }
      }
      return update;
    };

    const currentKeys = keyPositions[selectedKeyType] || [];
    const currentStats = statPositions[selectedKeyType] || [];
    const currentGraphs = graphPositions?.[selectedKeyType] || [];
    const currentKnobs = knobPositions?.[selectedKeyType] || [];

    dispatchKeyLikeUpdates([
      ...selectedKeys
        .filter((el) => el.index !== undefined)
        .map((el) => ({
          type: 'key' as const,
          ...buildUpdate(el.index!, currentKeys[el.index!]),
        })),
      ...selectedStats
        .filter((el) => state !== 'active' && el.index !== undefined)
        .map((el) => ({
          type: 'stat' as const,
          ...buildUpdate(el.index!, currentStats[el.index!], false),
        })),
      ...selectedGraphs
        // 그래프는 active 상태가 없음 — 입력 그라데이션 기록 제외
        .filter((el) => state !== 'active' && el.index !== undefined)
        .map((el) => ({
          type: 'graph' as const,
          ...buildUpdate(el.index!, currentGraphs[el.index!]),
        })),
      ...selectedKnobs
        .filter((el) => el.index !== undefined)
        .map((el) => ({
          type: 'knob' as const,
          ...buildUpdate(el.index!, currentKnobs[el.index!]),
        })),
    ] as KeyLikeBatchUpdate[]);
  };

  // 정렬 핸들러
  const handleBatchAlign = (
    direction: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom',
  ) => {
    const elements = getSelectedLayoutElements();

    if (elements.length < 2) return;

    const minX = Math.min(...elements.map((k) => k.x));
    const maxX = Math.max(...elements.map((k) => k.x + k.width));
    const minY = Math.min(...elements.map((k) => k.y));
    const maxY = Math.max(...elements.map((k) => k.y + k.height));

    let updates: KeyLikeBatchUpdate[] = [];

    switch (direction) {
      case 'left':
        updates = elements.map((k) => ({
          type: k.type,
          index: k.index,
          dx: minX,
        }));
        break;
      case 'centerH': {
        const centerX = (minX + maxX) / 2;
        updates = elements.map((k) => ({
          type: k.type,
          index: k.index,
          dx: centerX - k.width / 2,
        }));
        break;
      }
      case 'right':
        updates = elements.map((k) => ({
          type: k.type,
          index: k.index,
          dx: maxX - k.width,
        }));
        break;
      case 'top':
        updates = elements.map((k) => ({
          type: k.type,
          index: k.index,
          dy: minY,
        }));
        break;
      case 'centerV': {
        const centerY = (minY + maxY) / 2;
        updates = elements.map((k) => ({
          type: k.type,
          index: k.index,
          dy: centerY - k.height / 2,
        }));
        break;
      }
      case 'bottom':
        updates = elements.map((k) => ({
          type: k.type,
          index: k.index,
          dy: maxY - k.height,
        }));
        break;
    }

    dispatchKeyLikeUpdates(updates);
  };

  // 분배 핸들러
  const handleBatchDistribute = (direction: 'horizontal' | 'vertical') => {
    const elements = getSelectedLayoutElements();

    if (elements.length < 3) return;

    let updates: KeyLikeBatchUpdate[];

    if (direction === 'horizontal') {
      const sorted = [...elements].sort((a, b) => a.x - b.x);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const totalSpan = last.x + last.width - first.x;
      const totalWidths = sorted.reduce((sum, k) => sum + k.width, 0);
      const gap = (totalSpan - totalWidths) / (sorted.length - 1);

      let currentX = first.x;
      updates = sorted.map((k) => {
        const newX = currentX;
        currentX += k.width + gap;
        return { type: k.type, index: k.index, dx: newX };
      });
    } else {
      const sorted = [...elements].sort((a, b) => a.y - b.y);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const totalSpan = last.y + last.height - first.y;
      const totalHeights = sorted.reduce((sum, k) => sum + k.height, 0);
      const gap = (totalSpan - totalHeights) / (sorted.length - 1);

      let currentY = first.y;
      updates = sorted.map((k) => {
        const newY = currentY;
        currentY += k.height + gap;
        return { type: k.type, index: k.index, dy: newY };
      });
    }

    dispatchKeyLikeUpdates(updates);
  };

  /**
   * 간격 적용 공통 로직 (preview/commit 공용)
   * 반환: 변경이 필요한 업데이트 배열 (없으면 빈 배열)
   */
  const computeSpacingUpdates = (spacing: number): KeyLikeBatchUpdate[] => {
    const originalElements = getSelectedLayoutElements();
    if (originalElements.length < 2) return [];

    const elements = originalElements.map((element) => ({ ...element }));
    const axisPlan = inferSpacingAxisPlan(elements);
    if (!axisPlan.applyHorizontal && !axisPlan.applyVertical) return [];

    const normalizedSpacing = roundToSpacingPrecision(Math.max(0, spacing));
    const updateMap = new Map<string, KeyLikeBatchUpdate>();

    const appliedHorizontal = axisPlan.applyHorizontal
      ? applyAxisSpacing(
          elements,
          'horizontal',
          normalizedSpacing,
          updateMap,
          axisPlan.horizontalGroups,
        )
      : false;
    let appliedVertical = false;
    if (axisPlan.applyVertical) {
      appliedVertical = applyVerticalRowSpacing(
        axisPlan.horizontalGroups,
        normalizedSpacing,
        updateMap,
      );

      // 행 기반 수직 적용이 불가능한 경우(예: 행이 1개로 인식됨)에는
      // 열 기반 수직 간격 적용으로 보완한다.
      if (!appliedVertical) {
        appliedVertical = applyAxisSpacing(
          elements,
          'vertical',
          normalizedSpacing,
          updateMap,
          axisPlan.verticalGroups,
        );
      }
    }

    if (!appliedHorizontal && !appliedVertical) return [];

    const originalById = new Map(
      originalElements.map((element) => [
        getLayoutElementKey(element.type, element.index),
        element,
      ]),
    );

    return Array.from(updateMap.values()).filter((update) => {
      const original = originalById.get(
        getLayoutElementKey(update.type, update.index),
      );
      if (!original) return false;

      const dxChanged =
        update.dx !== undefined &&
        Math.abs(update.dx - original.x) > POSITION_CHANGE_EPSILON;
      const dyChanged =
        update.dy !== undefined &&
        Math.abs(update.dy - original.y) > POSITION_CHANGE_EPSILON;

      return dxChanged || dyChanged;
    });
  };

  // 간격 프리뷰 (타이핑 중 시각적 반영, 히스토리 미저장)
  const handleBatchSpacingPreview = (spacing: number) => {
    const updates = computeSpacingUpdates(spacing);
    if (updates.length === 0) return;
    dispatchKeyLikeUpdates(updates, 'preview');
  };

  // 간격 커밋
  const handleBatchSpacingCommit = (
    spacing: number,
    options?: BatchCommitOptions,
  ) => {
    const updates = computeSpacingUpdates(spacing);
    if (updates.length === 0) return;
    dispatchKeyLikeUpdates(updates, 'commit', options);
  };

  // 기존 호환용 (외부에서 직접 호출 시 commit 모드)
  const handleBatchSpacing = (
    spacing: number,
    options?: BatchCommitOptions,
  ) => {
    handleBatchSpacingCommit(spacing, options);
  };

  const getBatchSpacingValue = () => {
    const elements = getSelectedLayoutElements();
    if (elements.length < 2) {
      return { isMixed: false, value: 0 };
    }

    const workingElements = elements.map((element) => ({ ...element }));
    const axisPlan = inferSpacingAxisPlan(workingElements);

    const rawGaps: number[] = [];
    if (axisPlan.applyHorizontal) {
      rawGaps.push(
        ...collectAxisGapsFromGroups(axisPlan.horizontalGroups, 'horizontal'),
      );
    }
    if (axisPlan.applyVertical) {
      const rowGaps = collectRowGaps(axisPlan.horizontalGroups);
      if (rowGaps.length > 0) {
        rawGaps.push(...rowGaps);
      } else {
        rawGaps.push(
          ...collectAxisGapsFromGroups(axisPlan.verticalGroups, 'vertical'),
        );
      }
    }

    const gaps = rawGaps.map((gap) =>
      roundToSpacingPrecision(Math.max(0, gap)),
    );

    if (gaps.length === 0) {
      return { isMixed: false, value: 0 };
    }

    const firstGap = gaps[0];
    const isMixed = gaps.some((gap) => Math.abs(gap - firstGap) > 0.05);
    return { isMixed, value: firstGap };
  };

  // 일괄 크기 변경 핸들러
  const handleBatchResize = (dimension: 'width' | 'height', value: number) => {
    const keyUpdates = selectedKeys
      .filter((el) => el.index !== undefined)
      .map((el) => ({ index: el.index!, [dimension]: value })) as Array<
      { index: number } & Partial<KeyPosition>
    >;
    const statUpdates = selectedStats
      .filter((el) => el.index !== undefined)
      .map((el) => ({ index: el.index!, [dimension]: value })) as Array<
      { index: number } & Partial<StatItemPosition>
    >;
    const graphUpdates = selectedGraphs
      .filter((el) => el.index !== undefined)
      .map((el) => ({ index: el.index!, [dimension]: value })) as Array<
      { index: number } & Partial<GraphItemPosition>
    >;
    const knobUpdates = selectedKnobs
      .filter((el) => el.index !== undefined)
      .map((el) => ({ index: el.index!, [dimension]: value })) as Array<
      { index: number } & Partial<KnobItemPosition>
    >;
    dispatchKeyLikeUpdates([
      ...keyUpdates.map((update) => ({ type: 'key' as const, ...update })),
      ...statUpdates.map((update) => ({
        type: 'stat' as const,
        ...update,
      })),
      ...graphUpdates.map((update) => ({
        type: 'graph' as const,
        ...update,
      })),
      ...knobUpdates.map((update) => ({
        type: 'knob' as const,
        ...update,
      })),
    ] as KeyLikeBatchUpdate[]);
  };

  // 카운터 업데이트 핸들러
  const handleBatchCounterUpdate = (
    updates: Partial<KeyCounterSettings>,
    options?: {
      activeStateOnly?: boolean;
      colorState?: 'idle' | 'active';
    },
  ) => {
    const mergeCounterSettings = (
      currentSettings: KeyCounterSettings,
    ): KeyCounterSettings => {
      const newSettings = { ...currentSettings, ...updates };
      if (options?.colorState && updates.fill) {
        newSettings.fill = {
          ...currentSettings.fill,
          [options.colorState]: updates.fill[options.colorState],
        };
      }
      if (options?.colorState && updates.stroke) {
        newSettings.stroke = {
          ...currentSettings.stroke,
          [options.colorState]: updates.stroke[options.colorState],
        };
      }
      return newSettings;
    };

    const keyUpdates = selectedKeys
      .filter((el) => el.index !== undefined)
      .map((el) => {
        const pos = keyPositions[selectedKeyType]?.[el.index!];
        if (!pos) return null;
        const currentSettings = normalizeCounterSettings(pos.counter);
        const newSettings = mergeCounterSettings(currentSettings);
        return { index: el.index!, counter: newSettings };
      })
      .filter(
        (update): update is { index: number; counter: KeyCounterSettings } =>
          update !== null,
      );
    const statUpdates = (options?.activeStateOnly ? [] : selectedStats)
      .filter((el) => el.index !== undefined)
      .map((el) => {
        const pos = statPositions[selectedKeyType]?.[el.index!];
        if (!pos) return null;
        const currentSettings = normalizeCounterSettings(pos.counter);
        const newSettings = mergeCounterSettings(currentSettings);
        return { index: el.index!, counter: newSettings } as {
          index: number;
        } & Partial<StatItemPosition>;
      })
      .filter(
        (
          update,
        ): update is {
          index: number;
          counter: KeyCounterSettings;
        } & Partial<StatItemPosition> => update !== null,
      );
    dispatchKeyLikeUpdates([
      ...keyUpdates.map((update) => ({ type: 'key' as const, ...update })),
      ...statUpdates.map((update) => ({
        type: 'stat' as const,
        ...update,
      })),
    ] as KeyLikeBatchUpdate[]);
  };

  // 노트 색상 변경 (프리뷰) - 키 요소만
  const handleBatchNoteColorChange = (newColor: NoteColor) => {
    let colorValue: NoteColor;
    if (
      newColor &&
      typeof newColor === 'object' &&
      newColor.type === 'gradient'
    ) {
      colorValue = {
        type: 'gradient',
        top: newColor.top,
        bottom: newColor.bottom,
      };
    } else {
      colorValue = newColor;
    }

    const updates = selectedKeys
      .filter((el) => el.index !== undefined)
      .map((el) => ({ index: el.index!, noteColor: colorValue }));

    dispatchKeyUpdates(
      updates as Array<{ index: number } & Partial<KeyPosition>>,
      'preview',
    );
  };

  // 노트 색상 변경 완료 (저장) - 키 요소만
  const handleBatchNoteColorChangeComplete = (newColor: NoteColor) => {
    let colorValue: NoteColor;
    if (
      newColor &&
      typeof newColor === 'object' &&
      newColor.type === 'gradient'
    ) {
      colorValue = {
        type: 'gradient',
        top: newColor.top,
        bottom: newColor.bottom,
      };
    } else {
      colorValue = newColor;
    }

    const updates = selectedKeys
      .filter((el) => el.index !== undefined)
      .map((el) => ({ index: el.index!, noteColor: colorValue }));

    dispatchKeyUpdates(
      updates as Array<{ index: number } & Partial<KeyPosition>>,
      'commit',
    );
  };

  // 글로우 색상 변경 (프리뷰) - 키 요소만
  const handleBatchGlowColorChange = (newColor: NoteColor) => {
    let colorValue: NoteColor;
    if (
      newColor &&
      typeof newColor === 'object' &&
      newColor.type === 'gradient'
    ) {
      colorValue = {
        type: 'gradient',
        top: newColor.top,
        bottom: newColor.bottom,
      };
    } else {
      colorValue = newColor;
    }

    const updates = selectedKeys
      .filter((el) => el.index !== undefined)
      .map((el) => ({ index: el.index!, noteGlowColor: colorValue }));

    dispatchKeyUpdates(
      updates as Array<{ index: number } & Partial<KeyPosition>>,
      'preview',
    );
  };

  // 글로우 색상 변경 완료 (저장) - 키 요소만
  const handleBatchGlowColorChangeComplete = (newColor: NoteColor) => {
    let colorValue: NoteColor;
    if (
      newColor &&
      typeof newColor === 'object' &&
      newColor.type === 'gradient'
    ) {
      colorValue = {
        type: 'gradient',
        top: newColor.top,
        bottom: newColor.bottom,
      };
    } else {
      colorValue = newColor;
    }

    const updates = selectedKeys
      .filter((el) => el.index !== undefined)
      .map((el) => ({ index: el.index!, noteGlowColor: colorValue }));

    dispatchKeyUpdates(
      updates as Array<{ index: number } & Partial<KeyPosition>>,
      'commit',
    );
  };

  const handleKeyOnlyStyleChangeComplete = (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
  ) => {
    const keyUpdates = selectedKeys
      .filter((el) => el.index !== undefined)
      .map((el) => ({ index: el.index!, [property]: value })) as Array<
      { index: number } & Partial<KeyPosition>
    >;
    dispatchKeyUpdates(keyUpdates, 'commit');
  };

  // 눌림 가능(키·노브) 전용 — active 상태 쓰기가 통계만 제외하고 노브는 포함
  const handleActiveCapableStyleChangeComplete = (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
  ) => {
    dispatchKeyLikeUpdates([
      ...selectedKeys
        .filter((el) => el.index !== undefined)
        .map((el) => ({
          type: 'key' as const,
          index: el.index!,
          [property]: value,
        })),
      ...selectedKnobs
        .filter((el) => el.index !== undefined)
        .map((el) => ({
          type: 'knob' as const,
          index: el.index!,
          [property]: value,
        })),
    ] as KeyLikeBatchUpdate[]);
  };

  return {
    handleBatchStyleChange,
    handleBatchStyleChangeComplete,
    handleBatchShadowChangeComplete,
    handleBatchShadowEnabledChange,
    handleBatchGradientCommit,
    handleKeyOnlyStyleChangeComplete,
    handleActiveCapableStyleChangeComplete,
    handleBatchAlign,
    handleBatchDistribute,
    handleBatchSpacing,
    handleBatchSpacingPreview,
    handleBatchSpacingCommit,
    getBatchSpacingValue,
    handleBatchResize,
    handleBatchCounterUpdate,
    handleBatchNoteColorChange,
    handleBatchNoteColorChangeComplete,
    handleBatchGlowColorChange,
    handleBatchGlowColorChangeComplete,
  };
}
