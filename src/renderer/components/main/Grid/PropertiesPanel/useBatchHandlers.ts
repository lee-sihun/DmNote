import { useCallback } from "react";
import type {
  KeyPosition,
  NoteColor,
  KeyCounterSettings,
} from "@src/types/keys";
import { normalizeCounterSettings } from "@src/types/keys";
import type { StatItemPosition } from "@src/types/statItems";

const DEFAULT_ACTIVE_BACKGROUND_COLOR = "rgba(121, 121, 121, 0.9)";
const DEFAULT_ACTIVE_BORDER_COLOR = "rgba(255, 255, 255, 0.9)";
const DEFAULT_ACTIVE_FONT_COLOR = "#FFFFFF";
const SPACING_GROUP_TOLERANCE = 2;
const SPACING_DECIMAL_SCALE = 1;
const POSITION_CHANGE_EPSILON = 0.05;
const SPACING_AXIS_DOMINANCE_RATIO = 1.6;
const SPACING_GROUP_SIZE_FACTOR = 0.35;
// 엣지 오버랩 기반 그룹핑: 작은 쪽 크기의 이 비율 이상 겹치면 같은 행/열로 판정
const SPACING_GROUP_OVERLAP_THRESHOLD = 0.45;
// 그리드 정합성 검증: 행/열 크기 편차 허용 범위
const GRID_ROW_SIZE_TOLERANCE = 1;

type KeyLikeType = "key" | "stat";
type AxisDirection = "horizontal" | "vertical";

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
): number => (direction === "horizontal" ? element.y : element.x);

const getReferenceAxisSize = (
  element: LayoutElement,
  direction: AxisDirection,
): number => (direction === "horizontal" ? element.height : element.width);

const getReferenceAxisCenter = (
  element: LayoutElement,
  direction: AxisDirection,
): number =>
  getReferenceAxisValue(element, direction) +
  getReferenceAxisSize(element, direction) / 2;

const getPrimaryAxisValue = (
  element: LayoutElement,
  direction: AxisDirection,
): number => (direction === "horizontal" ? element.x : element.y);

const getPrimaryAxisSize = (
  element: LayoutElement,
  direction: AxisDirection,
): number => (direction === "horizontal" ? element.width : element.height);

const sortByPrimaryAxis = (
  elements: LayoutElement[],
  direction: AxisDirection,
): LayoutElement[] =>
  [...elements].sort(
    (a, b) =>
      getPrimaryAxisValue(a, direction) - getPrimaryAxisValue(b, direction),
  );

const getAxisSpan = (
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

const countGroupsWithPairs = (groups: LayoutElement[][]): number =>
  groups.filter((group) => group.length >= 2).length;

/**
 * 그리드 정합성 검증: 행/열 구조가 실제 정규 그리드인지 확인
 * 불규칙 배치에서 양축 동시 적용이 잘못 트리거되는 것을 방지
 */
const isRegularGridLayout = (
  horizontalGroups: LayoutElement[][],
  verticalGroups: LayoutElement[][],
  totalElements: number,
): boolean => {
  // pair가 있는 그룹만 필터
  const hGroupsWithPairs = horizontalGroups.filter((g) => g.length >= 2);
  const vGroupsWithPairs = verticalGroups.filter((g) => g.length >= 2);

  if (hGroupsWithPairs.length < 2 || vGroupsWithPairs.length < 2) return false;

  // 각 행의 요소 수가 균일해야 함 (최대 GRID_ROW_SIZE_TOLERANCE 차이 허용)
  const hSizes = hGroupsWithPairs.map((g) => g.length);
  const hMin = Math.min(...hSizes);
  const hMax = Math.max(...hSizes);
  if (hMax - hMin > GRID_ROW_SIZE_TOLERANCE) return false;

  // 각 열의 요소 수도 균일해야 함
  const vSizes = vGroupsWithPairs.map((g) => g.length);
  const vMin = Math.min(...vSizes);
  const vMax = Math.max(...vSizes);
  if (vMax - vMin > GRID_ROW_SIZE_TOLERANCE) return false;

  // rows × cols가 전체 요소 수와 근접해야 함
  const expectedRows = horizontalGroups.length;
  const expectedCols = verticalGroups.length;
  const expectedTotal = expectedRows * expectedCols;
  if (Math.abs(expectedTotal - totalElements) > GRID_ROW_SIZE_TOLERANCE) {
    return false;
  }

  return true;
};

const inferSpacingAxisPlan = (elements: LayoutElement[]): SpacingAxisPlan => {
  const horizontalGroups = groupElementsByReferenceAxis(elements, "horizontal");
  const verticalGroups = groupElementsByReferenceAxis(elements, "vertical");

  const horizontalPairCount = countAxisPairs(horizontalGroups);
  const verticalPairCount = countAxisPairs(verticalGroups);

  if (horizontalPairCount === 0 && verticalPairCount === 0) {
    return {
      applyHorizontal: false,
      applyVertical: false,
      horizontalGroups,
      verticalGroups,
    };
  }

  if (horizontalPairCount > 0 && verticalPairCount === 0) {
    return {
      applyHorizontal: true,
      applyVertical: false,
      horizontalGroups,
      verticalGroups,
    };
  }

  if (verticalPairCount > 0 && horizontalPairCount === 0) {
    return {
      applyHorizontal: false,
      applyVertical: true,
      horizontalGroups,
      verticalGroups,
    };
  }

  const horizontalGroupCount = countGroupsWithPairs(horizontalGroups);
  const verticalGroupCount = countGroupsWithPairs(verticalGroups);

  // 양축 동시 적용: 기본 조건 + 그리드 정합성 검증
  const canApplyBoth =
    elements.length >= 4 &&
    horizontalGroupCount >= 2 &&
    verticalGroupCount >= 2 &&
    isRegularGridLayout(horizontalGroups, verticalGroups, elements.length);

  if (canApplyBoth) {
    return {
      applyHorizontal: true,
      applyVertical: true,
      horizontalGroups,
      verticalGroups,
    };
  }

  if (horizontalPairCount >= verticalPairCount * SPACING_AXIS_DOMINANCE_RATIO) {
    return {
      applyHorizontal: true,
      applyVertical: false,
      horizontalGroups,
      verticalGroups,
    };
  }

  if (verticalPairCount >= horizontalPairCount * SPACING_AXIS_DOMINANCE_RATIO) {
    return {
      applyHorizontal: false,
      applyVertical: true,
      horizontalGroups,
      verticalGroups,
    };
  }

  const horizontalSpan = getAxisSpan(elements, "horizontal");
  const verticalSpan = getAxisSpan(elements, "vertical");
  const preferHorizontal = horizontalSpan >= verticalSpan;

  return {
    applyHorizontal: preferHorizontal,
    applyVertical: !preferHorizontal,
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
    let currentStart = getPrimaryAxisValue(sorted[0], direction);

    sorted.forEach((element, index) => {
      if (index > 0) {
        const prev = sorted[index - 1];
        currentStart += getPrimaryAxisSize(prev, direction) + spacing;
      }

      const key = `${element.type}:${element.index}`;
      const update = updateMap.get(key) ?? {
        type: element.type,
        index: element.index,
      };
      const normalizedValue = roundToSpacingPrecision(currentStart);
      if (direction === "horizontal") {
        update.dx = normalizedValue;
        element.x = normalizedValue;
      } else {
        update.dy = normalizedValue;
        element.y = normalizedValue;
      }
      updateMap.set(key, update);
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

interface UseBatchHandlersProps {
  selectedKeyLikeElements: SelectedElement[];
  keyPositions: Record<string, KeyPosition[] | undefined>;
  statPositions: Record<string, StatItemPosition[] | undefined>;
  selectedKeyType: string;
  onKeyUpdate: (data: Partial<KeyPosition> & { index: number }) => void;
  onKeyBatchUpdate?: (
    updates: Array<{ index: number } & Partial<KeyPosition>>,
  ) => void;
  onKeyPreview?: (index: number, updates: Partial<KeyPosition>) => void;
  onKeyBatchPreview?: (
    updates: Array<{ index: number } & Partial<KeyPosition>>,
  ) => void;
  onStatUpdate: (data: Partial<StatItemPosition> & { index: number }) => void;
  onStatBatchUpdate?: (
    updates: Array<{ index: number } & Partial<StatItemPosition>>,
  ) => void;
  onStatPreview?: (index: number, updates: Partial<StatItemPosition>) => void;
  onStatBatchPreview?: (
    updates: Array<{ index: number } & Partial<StatItemPosition>>,
  ) => void;
}

export function useBatchHandlers({
  selectedKeyLikeElements,
  keyPositions,
  statPositions,
  selectedKeyType,
  onKeyUpdate,
  onKeyBatchUpdate,
  onKeyPreview,
  onKeyBatchPreview,
  onStatUpdate,
  onStatBatchUpdate,
  onStatPreview,
  onStatBatchPreview,
}: UseBatchHandlersProps) {
  const selectedKeys = selectedKeyLikeElements.filter(
    (el) => el.type === "key",
  );
  const selectedStats = selectedKeyLikeElements.filter(
    (el) => el.type === "stat",
  );

  const getKeyLikePosition = useCallback(
    (type: KeyLikeType, index: number) => {
      if (type === "key") return keyPositions[selectedKeyType]?.[index] ?? null;
      return statPositions[selectedKeyType]?.[index] ?? null;
    },
    [keyPositions, statPositions, selectedKeyType],
  );

  const dispatchKeyUpdates = useCallback(
    (
      updates: Array<{ index: number } & Partial<KeyPosition>>,
      kind: "preview" | "commit",
    ) => {
      if (updates.length === 0) return;
      if (kind === "preview") {
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
        onKeyBatchUpdate(updates);
        return;
      }
      updates.forEach((update) => onKeyUpdate(update));
    },
    [onKeyBatchPreview, onKeyPreview, onKeyBatchUpdate, onKeyUpdate],
  );

  const dispatchStatUpdates = useCallback(
    (
      updates: Array<{ index: number } & Partial<StatItemPosition>>,
      kind: "preview" | "commit",
    ) => {
      if (updates.length === 0) return;
      if (kind === "preview") {
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
        onStatBatchUpdate(updates);
        return;
      }
      updates.forEach((update) => onStatUpdate(update));
    },
    [onStatBatchPreview, onStatPreview, onStatBatchUpdate, onStatUpdate],
  );

  const getSelectedLayoutElements = useCallback((): LayoutElement[] => {
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
  }, [getKeyLikePosition, selectedKeyLikeElements]);

  const dispatchKeyLikeUpdates = useCallback(
    (updates: KeyLikeBatchUpdate[], kind: "preview" | "commit" = "commit") => {
      const keyUpdates = updates
        .filter((u) => u.type === "key")
        .map(({ type: _t, ...rest }) => rest) as Array<
        { index: number } & Partial<KeyPosition>
      >;
      const statUpdates = updates
        .filter((u) => u.type === "stat")
        .map(({ type: _t, ...rest }) => rest) as Array<
        { index: number } & Partial<StatItemPosition>
      >;

      dispatchKeyUpdates(keyUpdates, kind);
      dispatchStatUpdates(statUpdates, kind);
    },
    [dispatchKeyUpdates, dispatchStatUpdates],
  );

  // 스타일 변경 (프리뷰)
  const handleBatchStyleChange = useCallback(
    (property: keyof KeyPosition, value: any) => {
      const keyUpdates = selectedKeys
        .filter((el) => el.index !== undefined)
        .map((el) => ({ index: el.index!, [property]: value })) as Array<
        { index: number } & Partial<KeyPosition>
      >;
      dispatchKeyUpdates(keyUpdates, "preview");

      const statUpdates = selectedStats
        .filter((el) => el.index !== undefined)
        .map((el) => ({ index: el.index!, [property]: value })) as Array<
        { index: number } & Partial<StatItemPosition>
      >;
      dispatchStatUpdates(statUpdates, "preview");
    },
    [dispatchKeyUpdates, dispatchStatUpdates, selectedKeys, selectedStats],
  );

  // 스타일 변경 완료 (저장)
  const handleBatchStyleChangeComplete = useCallback(
    (property: keyof KeyPosition, value: any) => {
      const currentKeys = keyPositions[selectedKeyType] || [];
      const currentStats = statPositions[selectedKeyType] || [];

      const keyUpdates = selectedKeys
        .filter((el) => el.index !== undefined)
        .map((el) => {
          const index = el.index!;
          const pos = currentKeys[index];
          if (pos) {
            if (
              property === "backgroundColor" &&
              pos.activeBackgroundColor == null
            ) {
              return {
                index,
                backgroundColor: value,
                activeBackgroundColor:
                  pos.activeBackgroundColor ??
                  pos.backgroundColor ??
                  DEFAULT_ACTIVE_BACKGROUND_COLOR,
              };
            }
            if (property === "borderColor" && pos.activeBorderColor == null) {
              return {
                index,
                borderColor: value,
                activeBorderColor:
                  pos.activeBorderColor ??
                  pos.borderColor ??
                  DEFAULT_ACTIVE_BORDER_COLOR,
              };
            }
            if (property === "fontColor" && pos.activeFontColor == null) {
              return {
                index,
                fontColor: value,
                activeFontColor:
                  pos.activeFontColor ??
                  pos.fontColor ??
                  DEFAULT_ACTIVE_FONT_COLOR,
              };
            }
          }
          return { index, [property]: value } as {
            index: number;
          } & Partial<KeyPosition>;
        });
      dispatchKeyUpdates(keyUpdates, "commit");

      const statUpdates = selectedStats
        .filter((el) => el.index !== undefined)
        .map((el) => {
          const index = el.index!;
          const pos = currentStats[index];
          if (pos) {
            if (
              property === "backgroundColor" &&
              pos.activeBackgroundColor == null
            ) {
              return {
                index,
                backgroundColor: value,
                activeBackgroundColor:
                  pos.activeBackgroundColor ??
                  pos.backgroundColor ??
                  DEFAULT_ACTIVE_BACKGROUND_COLOR,
              } as any;
            }
            if (property === "borderColor" && pos.activeBorderColor == null) {
              return {
                index,
                borderColor: value,
                activeBorderColor:
                  pos.activeBorderColor ??
                  pos.borderColor ??
                  DEFAULT_ACTIVE_BORDER_COLOR,
              } as any;
            }
            if (property === "fontColor" && pos.activeFontColor == null) {
              return {
                index,
                fontColor: value,
                activeFontColor:
                  pos.activeFontColor ??
                  pos.fontColor ??
                  DEFAULT_ACTIVE_FONT_COLOR,
              } as any;
            }
          }
          return { index, [property]: value } as any;
        });
      dispatchStatUpdates(statUpdates, "commit");
    },
    [
      keyPositions,
      statPositions,
      selectedKeyType,
      selectedKeys,
      selectedStats,
      dispatchKeyUpdates,
      dispatchStatUpdates,
    ],
  );

  // 정렬 핸들러
  const handleBatchAlign = useCallback(
    (
      direction: "left" | "centerH" | "right" | "top" | "centerV" | "bottom",
    ) => {
      const elements = getSelectedLayoutElements();

      if (elements.length < 2) return;

      const minX = Math.min(...elements.map((k) => k.x));
      const maxX = Math.max(...elements.map((k) => k.x + k.width));
      const minY = Math.min(...elements.map((k) => k.y));
      const maxY = Math.max(...elements.map((k) => k.y + k.height));

      let updates: KeyLikeBatchUpdate[] = [];

      switch (direction) {
        case "left":
          updates = elements.map((k) => ({
            type: k.type,
            index: k.index,
            dx: minX,
          }));
          break;
        case "centerH": {
          const centerX = (minX + maxX) / 2;
          updates = elements.map((k) => ({
            type: k.type,
            index: k.index,
            dx: centerX - k.width / 2,
          }));
          break;
        }
        case "right":
          updates = elements.map((k) => ({
            type: k.type,
            index: k.index,
            dx: maxX - k.width,
          }));
          break;
        case "top":
          updates = elements.map((k) => ({
            type: k.type,
            index: k.index,
            dy: minY,
          }));
          break;
        case "centerV": {
          const centerY = (minY + maxY) / 2;
          updates = elements.map((k) => ({
            type: k.type,
            index: k.index,
            dy: centerY - k.height / 2,
          }));
          break;
        }
        case "bottom":
          updates = elements.map((k) => ({
            type: k.type,
            index: k.index,
            dy: maxY - k.height,
          }));
          break;
      }

      dispatchKeyLikeUpdates(updates);
    },
    [dispatchKeyLikeUpdates, getSelectedLayoutElements],
  );

  // 분배 핸들러
  const handleBatchDistribute = useCallback(
    (direction: "horizontal" | "vertical") => {
      const elements = getSelectedLayoutElements();

      if (elements.length < 3) return;

      let updates: KeyLikeBatchUpdate[] = [];

      if (direction === "horizontal") {
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
    },
    [dispatchKeyLikeUpdates, getSelectedLayoutElements],
  );

  /**
   * 간격 적용 공통 로직 (preview/commit 공용)
   * 반환: 변경이 필요한 업데이트 배열 (없으면 빈 배열)
   */
  const computeSpacingUpdates = useCallback(
    (spacing: number): KeyLikeBatchUpdate[] => {
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
            "horizontal",
            normalizedSpacing,
            updateMap,
            axisPlan.horizontalGroups,
          )
        : false;
      const appliedVertical = axisPlan.applyVertical
        ? applyAxisSpacing(
            elements,
            "vertical",
            normalizedSpacing,
            updateMap,
            axisPlan.verticalGroups,
          )
        : false;

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
    },
    [getSelectedLayoutElements],
  );

  // 간격 프리뷰 (타이핑 중 시각적 반영, 히스토리 미저장)
  const handleBatchSpacingPreview = useCallback(
    (spacing: number) => {
      const updates = computeSpacingUpdates(spacing);
      if (updates.length === 0) return;
      dispatchKeyLikeUpdates(updates, "preview");
    },
    [computeSpacingUpdates, dispatchKeyLikeUpdates],
  );

  // 간격 커밋 (blur 시 최종 반영 + 히스토리 저장)
  const handleBatchSpacingCommit = useCallback(
    (spacing: number) => {
      const updates = computeSpacingUpdates(spacing);
      if (updates.length === 0) return;
      dispatchKeyLikeUpdates(updates, "commit");
    },
    [computeSpacingUpdates, dispatchKeyLikeUpdates],
  );

  // 기존 호환용 (외부에서 직접 호출 시 commit 모드)
  const handleBatchSpacing = useCallback(
    (spacing: number) => {
      handleBatchSpacingCommit(spacing);
    },
    [handleBatchSpacingCommit],
  );

  const getBatchSpacingValue = useCallback(() => {
    const elements = getSelectedLayoutElements();
    if (elements.length < 2) {
      return { isMixed: false, value: 0 };
    }

    const workingElements = elements.map((element) => ({ ...element }));
    const axisPlan = inferSpacingAxisPlan(workingElements);

    const rawGaps: number[] = [];
    if (axisPlan.applyHorizontal) {
      rawGaps.push(
        ...collectAxisGapsFromGroups(axisPlan.horizontalGroups, "horizontal"),
      );
    }
    if (axisPlan.applyVertical) {
      rawGaps.push(
        ...collectAxisGapsFromGroups(axisPlan.verticalGroups, "vertical"),
      );
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
  }, [getSelectedLayoutElements]);

  // 일괄 크기 변경 핸들러
  const handleBatchResize = useCallback(
    (dimension: "width" | "height", value: number) => {
      const keyUpdates = selectedKeys
        .filter((el) => el.index !== undefined)
        .map((el) => ({ index: el.index!, [dimension]: value })) as Array<
        { index: number } & Partial<KeyPosition>
      >;
      dispatchKeyUpdates(keyUpdates, "commit");

      const statUpdates = selectedStats
        .filter((el) => el.index !== undefined)
        .map((el) => ({ index: el.index!, [dimension]: value })) as Array<
        { index: number } & Partial<StatItemPosition>
      >;
      dispatchStatUpdates(statUpdates, "commit");
    },
    [dispatchKeyUpdates, dispatchStatUpdates, selectedKeys, selectedStats],
  );

  // 카운터 업데이트 핸들러
  const handleBatchCounterUpdate = useCallback(
    (updates: Partial<KeyCounterSettings>) => {
      const keyUpdates = selectedKeys
        .filter((el) => el.index !== undefined)
        .map((el) => {
          const pos = keyPositions[selectedKeyType]?.[el.index!];
          if (!pos) return null;
          const currentSettings = normalizeCounterSettings(pos.counter);
          const newSettings = { ...currentSettings, ...updates };
          return { index: el.index!, counter: newSettings };
        })
        .filter(
          (update): update is { index: number; counter: KeyCounterSettings } =>
            update !== null,
        );
      dispatchKeyUpdates(keyUpdates as any, "commit");

      const statUpdates = selectedStats
        .filter((el) => el.index !== undefined)
        .map((el) => {
          const pos = statPositions[selectedKeyType]?.[el.index!];
          if (!pos) return null;
          const currentSettings = normalizeCounterSettings(
            (pos as any).counter,
          );
          const newSettings = { ...currentSettings, ...updates };
          return { index: el.index!, counter: newSettings } as any;
        })
        .filter((update) => update !== null) as Array<
        {
          index: number;
          counter: KeyCounterSettings;
        } & Partial<StatItemPosition>
      >;
      dispatchStatUpdates(statUpdates as any, "commit");
    },
    [
      dispatchKeyUpdates,
      dispatchStatUpdates,
      keyPositions,
      statPositions,
      selectedKeyType,
      selectedKeys,
      selectedStats,
    ],
  );

  // 노트 색상 변경 (프리뷰) - 키 요소만
  const handleBatchNoteColorChange = useCallback(
    (newColor: any) => {
      let colorValue: NoteColor;
      if (
        newColor &&
        typeof newColor === "object" &&
        newColor.type === "gradient"
      ) {
        colorValue = {
          type: "gradient",
          top: newColor.top,
          bottom: newColor.bottom,
        };
      } else {
        colorValue = newColor;
      }

      const updates = selectedKeys
        .filter((el) => el.index !== undefined)
        .map((el) => ({ index: el.index!, noteColor: colorValue }));

      dispatchKeyUpdates(updates as any, "preview");
    },
    [dispatchKeyUpdates, selectedKeys],
  );

  // 노트 색상 변경 완료 (저장) - 키 요소만
  const handleBatchNoteColorChangeComplete = useCallback(
    (newColor: any) => {
      let colorValue: NoteColor;
      if (
        newColor &&
        typeof newColor === "object" &&
        newColor.type === "gradient"
      ) {
        colorValue = {
          type: "gradient",
          top: newColor.top,
          bottom: newColor.bottom,
        };
      } else {
        colorValue = newColor;
      }

      const updates = selectedKeys
        .filter((el) => el.index !== undefined)
        .map((el) => ({ index: el.index!, noteColor: colorValue }));

      dispatchKeyUpdates(updates as any, "commit");
    },
    [dispatchKeyUpdates, selectedKeys],
  );

  // 글로우 색상 변경 (프리뷰) - 키 요소만
  const handleBatchGlowColorChange = useCallback(
    (newColor: any) => {
      let colorValue: NoteColor;
      if (
        newColor &&
        typeof newColor === "object" &&
        newColor.type === "gradient"
      ) {
        colorValue = {
          type: "gradient",
          top: newColor.top,
          bottom: newColor.bottom,
        };
      } else {
        colorValue = newColor;
      }

      const updates = selectedKeys
        .filter((el) => el.index !== undefined)
        .map((el) => ({ index: el.index!, noteGlowColor: colorValue }));

      dispatchKeyUpdates(updates as any, "preview");
    },
    [dispatchKeyUpdates, selectedKeys],
  );

  // 글로우 색상 변경 완료 (저장) - 키 요소만
  const handleBatchGlowColorChangeComplete = useCallback(
    (newColor: any) => {
      let colorValue: NoteColor;
      if (
        newColor &&
        typeof newColor === "object" &&
        newColor.type === "gradient"
      ) {
        colorValue = {
          type: "gradient",
          top: newColor.top,
          bottom: newColor.bottom,
        };
      } else {
        colorValue = newColor;
      }

      const updates = selectedKeys
        .filter((el) => el.index !== undefined)
        .map((el) => ({ index: el.index!, noteGlowColor: colorValue }));

      dispatchKeyUpdates(updates as any, "commit");
    },
    [dispatchKeyUpdates, selectedKeys],
  );

  return {
    handleBatchStyleChange,
    handleBatchStyleChangeComplete,
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
