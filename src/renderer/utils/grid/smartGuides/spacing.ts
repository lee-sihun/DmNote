import type { ElementBounds, SpacingGuide } from './types';

// 간격 스냅 임계값 (픽셀)
const SPACING_SNAP_THRESHOLD = 5;

/**
 * 간격 정보를 담는 헬퍼 인터페이스
 */
interface _SpacingInfo {
  element: ElementBounds;
  gap: number; // 간격 값
  direction: 'left' | 'right' | 'above' | 'below';
}

/**
 * 간격 가이드 계산 결과
 */
interface SpacingSnapResult {
  snappedX: number;
  snappedY: number;
  spacingGuides: SpacingGuide[];
  didSpacingSnapX: boolean;
  didSpacingSnapY: boolean;
}

/**
 * 요소 간 간격 계산 및 동일 간격 스냅
 * A요소와 B요소 사이의 간격이 C요소와 D요소 사이 간격과 같으면 스냅
 */
export function calculateSpacingGuides(
  draggedBounds: ElementBounds,
  otherElements: ElementBounds[],
): SpacingSnapResult {
  const spacingGuides: SpacingGuide[] = [];
  let snappedX = draggedBounds.left;
  let snappedY = draggedBounds.top;
  let didSpacingSnapX = false;
  let didSpacingSnapY = false;

  // 다른 요소들만 필터링 (자기 자신 제외)
  const others = otherElements.filter((el) => el.id !== draggedBounds.id);

  if (others.length < 2) {
    // 최소 2개 요소가 있어야 간격 비교 가능
    return {
      snappedX,
      snappedY,
      spacingGuides,
      didSpacingSnapX,
      didSpacingSnapY,
    };
  }

  // Y축 겹침 여부 확인 함수 (수평 간격 계산 시 사용)
  const hasVerticalOverlap = (a: ElementBounds, b: ElementBounds): boolean => {
    return a.bottom > b.top && a.top < b.bottom;
  };

  // X축 겹침 여부 확인 함수 (수직 간격 계산 시 사용)
  const hasHorizontalOverlap = (
    a: ElementBounds,
    b: ElementBounds,
  ): boolean => {
    return a.right > b.left && a.left < b.right;
  };

  // === 수평 간격 계산 (X축) ===
  // 드래그 요소와 Y축이 겹치는 요소들만 고려 (같은 행에 있는 요소들)
  const horizontallyRelevant = others.filter((el) =>
    hasVerticalOverlap(draggedBounds, el),
  );

  // 드래그 요소 기준 왼쪽/오른쪽에 있는 요소들 찾기
  const leftElements = horizontallyRelevant
    .filter((el) => el.right <= draggedBounds.left + SPACING_SNAP_THRESHOLD)
    .sort((a, b) => b.right - a.right); // 가장 가까운 것 먼저

  const rightElements = horizontallyRelevant
    .filter((el) => el.left >= draggedBounds.right - SPACING_SNAP_THRESHOLD)
    .sort((a, b) => a.left - b.left); // 가장 가까운 것 먼저

  // 기존 요소들 사이의 수평 간격 수집 (서로 Y축이 겹치는 쌍만)
  const horizontalGaps: {
    from: ElementBounds;
    to: ElementBounds;
    gap: number;
  }[] = [];
  const sortedByX = [...horizontallyRelevant].sort((a, b) => a.left - b.left);

  for (let i = 0; i < sortedByX.length - 1; i++) {
    const current = sortedByX[i];
    const next = sortedByX[i + 1];
    // 겹치지 않고, Y축이 겹치는 경우만 간격 계산
    if (current.right < next.left && hasVerticalOverlap(current, next)) {
      const gap = next.left - current.right;
      if (gap > 0 && gap < 500) {
        // 너무 큰 간격은 무시
        horizontalGaps.push({ from: current, to: next, gap });
      }
    }
  }

  // 드래그 요소와 인접 요소 사이 간격이 기존 간격과 일치하는지 확인
  if (leftElements.length > 0 && !didSpacingSnapX) {
    const leftNearest = leftElements[0];
    const currentGap = draggedBounds.left - leftNearest.right;

    for (const existingGap of horizontalGaps) {
      // 이미 관련된 요소는 스킵
      if (
        existingGap.from.id === leftNearest.id ||
        existingGap.to.id === leftNearest.id
      )
        continue;

      const diff = Math.abs(currentGap - existingGap.gap);
      if (diff <= SPACING_SNAP_THRESHOLD && diff > 0) {
        // 스냅: 동일 간격으로 조정
        snappedX = leftNearest.right + existingGap.gap;
        didSpacingSnapX = true;

        // 기존 간격 가이드 추가
        spacingGuides.push({
          type: 'spacing',
          direction: 'horizontal',
          value: existingGap.gap,
          startPos: existingGap.from.right,
          endPos: existingGap.to.left,
          crossAxisPos: Math.max(
            existingGap.from.centerY,
            existingGap.to.centerY,
          ),
          fromElementId: existingGap.from.id,
          toElementId: existingGap.to.id,
          isMatched: true,
        });

        // 현재 간격 가이드 추가 (스냅 후)
        spacingGuides.push({
          type: 'spacing',
          direction: 'horizontal',
          value: existingGap.gap,
          startPos: leftNearest.right,
          endPos: snappedX,
          crossAxisPos: Math.max(leftNearest.centerY, draggedBounds.centerY),
          fromElementId: leftNearest.id,
          toElementId: draggedBounds.id,
          isMatched: true,
        });
        break;
      }
    }
  }

  if (rightElements.length > 0 && !didSpacingSnapX) {
    const rightNearest = rightElements[0];
    const currentGap = rightNearest.left - draggedBounds.right;

    for (const existingGap of horizontalGaps) {
      if (
        existingGap.from.id === rightNearest.id ||
        existingGap.to.id === rightNearest.id
      )
        continue;

      const diff = Math.abs(currentGap - existingGap.gap);
      if (diff <= SPACING_SNAP_THRESHOLD && diff > 0) {
        snappedX = rightNearest.left - existingGap.gap - draggedBounds.width;
        didSpacingSnapX = true;

        spacingGuides.push({
          type: 'spacing',
          direction: 'horizontal',
          value: existingGap.gap,
          startPos: existingGap.from.right,
          endPos: existingGap.to.left,
          crossAxisPos: Math.max(
            existingGap.from.centerY,
            existingGap.to.centerY,
          ),
          fromElementId: existingGap.from.id,
          toElementId: existingGap.to.id,
          isMatched: true,
        });

        spacingGuides.push({
          type: 'spacing',
          direction: 'horizontal',
          value: existingGap.gap,
          startPos: snappedX + draggedBounds.width,
          endPos: rightNearest.left,
          crossAxisPos: Math.max(rightNearest.centerY, draggedBounds.centerY),
          fromElementId: draggedBounds.id,
          toElementId: rightNearest.id,
          isMatched: true,
        });
        break;
      }
    }
  }

  // 3개 요소 등간격 스냅 (A - dragged - B)
  if (leftElements.length > 0 && rightElements.length > 0 && !didSpacingSnapX) {
    const leftNearest = leftElements[0];
    const rightNearest = rightElements[0];
    const totalSpace =
      rightNearest.left - leftNearest.right - draggedBounds.width;

    if (totalSpace > 0) {
      const equalGap = totalSpace / 2;
      const idealX = leftNearest.right + equalGap;
      const diff = Math.abs(draggedBounds.left - idealX);

      if (diff <= SPACING_SNAP_THRESHOLD && diff > 0) {
        snappedX = idealX;
        didSpacingSnapX = true;

        // 왼쪽 간격
        spacingGuides.push({
          type: 'spacing',
          direction: 'horizontal',
          value: Math.round(equalGap),
          startPos: leftNearest.right,
          endPos: idealX,
          crossAxisPos: Math.max(leftNearest.centerY, draggedBounds.centerY),
          fromElementId: leftNearest.id,
          toElementId: draggedBounds.id,
          isMatched: true,
        });

        // 오른쪽 간격
        spacingGuides.push({
          type: 'spacing',
          direction: 'horizontal',
          value: Math.round(equalGap),
          startPos: idealX + draggedBounds.width,
          endPos: rightNearest.left,
          crossAxisPos: Math.max(rightNearest.centerY, draggedBounds.centerY),
          fromElementId: draggedBounds.id,
          toElementId: rightNearest.id,
          isMatched: true,
        });
      }
    }
  }

  // === 수직 간격 계산 (Y축) ===
  // 드래그 요소와 X축이 겹치는 요소들만 고려 (같은 열에 있는 요소들)
  const verticallyRelevant = others.filter((el) =>
    hasHorizontalOverlap(draggedBounds, el),
  );

  const aboveElements = verticallyRelevant
    .filter((el) => el.bottom <= draggedBounds.top + SPACING_SNAP_THRESHOLD)
    .sort((a, b) => b.bottom - a.bottom);

  const belowElements = verticallyRelevant
    .filter((el) => el.top >= draggedBounds.bottom - SPACING_SNAP_THRESHOLD)
    .sort((a, b) => a.top - b.top);

  const verticalGaps: {
    from: ElementBounds;
    to: ElementBounds;
    gap: number;
  }[] = [];
  const sortedByY = [...verticallyRelevant].sort((a, b) => a.top - b.top);

  for (let i = 0; i < sortedByY.length - 1; i++) {
    const current = sortedByY[i];
    const next = sortedByY[i + 1];
    // 겹치지 않고, X축이 겹치는 경우만 간격 계산
    if (current.bottom < next.top && hasHorizontalOverlap(current, next)) {
      const gap = next.top - current.bottom;
      if (gap > 0 && gap < 500) {
        verticalGaps.push({ from: current, to: next, gap });
      }
    }
  }

  if (aboveElements.length > 0 && !didSpacingSnapY) {
    const aboveNearest = aboveElements[0];
    const currentGap = draggedBounds.top - aboveNearest.bottom;

    for (const existingGap of verticalGaps) {
      if (
        existingGap.from.id === aboveNearest.id ||
        existingGap.to.id === aboveNearest.id
      )
        continue;

      const diff = Math.abs(currentGap - existingGap.gap);
      if (diff <= SPACING_SNAP_THRESHOLD && diff > 0) {
        snappedY = aboveNearest.bottom + existingGap.gap;
        didSpacingSnapY = true;

        spacingGuides.push({
          type: 'spacing',
          direction: 'vertical',
          value: existingGap.gap,
          startPos: existingGap.from.bottom,
          endPos: existingGap.to.top,
          crossAxisPos: Math.max(
            existingGap.from.centerX,
            existingGap.to.centerX,
          ),
          fromElementId: existingGap.from.id,
          toElementId: existingGap.to.id,
          isMatched: true,
        });

        spacingGuides.push({
          type: 'spacing',
          direction: 'vertical',
          value: existingGap.gap,
          startPos: aboveNearest.bottom,
          endPos: snappedY,
          crossAxisPos: Math.max(aboveNearest.centerX, draggedBounds.centerX),
          fromElementId: aboveNearest.id,
          toElementId: draggedBounds.id,
          isMatched: true,
        });
        break;
      }
    }
  }

  if (belowElements.length > 0 && !didSpacingSnapY) {
    const belowNearest = belowElements[0];
    const currentGap = belowNearest.top - draggedBounds.bottom;

    for (const existingGap of verticalGaps) {
      if (
        existingGap.from.id === belowNearest.id ||
        existingGap.to.id === belowNearest.id
      )
        continue;

      const diff = Math.abs(currentGap - existingGap.gap);
      if (diff <= SPACING_SNAP_THRESHOLD && diff > 0) {
        snappedY = belowNearest.top - existingGap.gap - draggedBounds.height;
        didSpacingSnapY = true;

        spacingGuides.push({
          type: 'spacing',
          direction: 'vertical',
          value: existingGap.gap,
          startPos: existingGap.from.bottom,
          endPos: existingGap.to.top,
          crossAxisPos: Math.max(
            existingGap.from.centerX,
            existingGap.to.centerX,
          ),
          fromElementId: existingGap.from.id,
          toElementId: existingGap.to.id,
          isMatched: true,
        });

        spacingGuides.push({
          type: 'spacing',
          direction: 'vertical',
          value: existingGap.gap,
          startPos: snappedY + draggedBounds.height,
          endPos: belowNearest.top,
          crossAxisPos: Math.max(belowNearest.centerX, draggedBounds.centerX),
          fromElementId: draggedBounds.id,
          toElementId: belowNearest.id,
          isMatched: true,
        });
        break;
      }
    }
  }

  // 3개 요소 등간격 스냅 (위 - dragged - 아래)
  if (
    aboveElements.length > 0 &&
    belowElements.length > 0 &&
    !didSpacingSnapY
  ) {
    const aboveNearest = aboveElements[0];
    const belowNearest = belowElements[0];
    const totalSpace =
      belowNearest.top - aboveNearest.bottom - draggedBounds.height;

    if (totalSpace > 0) {
      const equalGap = totalSpace / 2;
      const idealY = aboveNearest.bottom + equalGap;
      const diff = Math.abs(draggedBounds.top - idealY);

      if (diff <= SPACING_SNAP_THRESHOLD && diff > 0) {
        snappedY = idealY;
        didSpacingSnapY = true;

        spacingGuides.push({
          type: 'spacing',
          direction: 'vertical',
          value: Math.round(equalGap),
          startPos: aboveNearest.bottom,
          endPos: idealY,
          crossAxisPos: Math.max(aboveNearest.centerX, draggedBounds.centerX),
          fromElementId: aboveNearest.id,
          toElementId: draggedBounds.id,
          isMatched: true,
        });

        spacingGuides.push({
          type: 'spacing',
          direction: 'vertical',
          value: Math.round(equalGap),
          startPos: idealY + draggedBounds.height,
          endPos: belowNearest.top,
          crossAxisPos: Math.max(belowNearest.centerX, draggedBounds.centerX),
          fromElementId: draggedBounds.id,
          toElementId: belowNearest.id,
          isMatched: true,
        });
      }
    }
  }

  return {
    snappedX,
    snappedY,
    spacingGuides,
    didSpacingSnapX,
    didSpacingSnapY,
  };
}
