/**
 * Smart Guides (스마트 가이드) 유틸리티
 * 드래그 중 다른 요소와 정렬될 때 가이드라인을 표시하고 스냅하는 기능
 * - 정렬 가이드 (Alignment Guides)
 * - 간격 가이드 (Spacing Guides)
 * - 크기 일치 가이드 (Size Matching Guides)
 */

import { roundToGrid } from './gridSnap';

export interface ElementBounds {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export interface GuideLine {
  type: 'vertical' | 'horizontal';
  position: number; // 가이드라인의 x 또는 y 위치
  alignType: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
}

/**
 * 간격 가이드 인터페이스
 * 요소 사이의 간격을 시각화
 */
export interface SpacingGuide {
  type: 'spacing';
  direction: 'horizontal' | 'vertical';
  value: number; // 간격 값 (px)
  // 간격 표시 위치
  startPos: number; // 간격 시작 위치 (x 또는 y)
  endPos: number; // 간격 끝 위치 (x 또는 y)
  crossAxisPos: number; // 교차 축 위치 (라벨 표시용)
  // 관련 요소
  fromElementId: string;
  toElementId: string;
  // 이 간격이 다른 간격과 일치하여 스냅됐는지
  isMatched: boolean;
}

/**
 * 크기 일치 가이드 인터페이스
 * 리사이즈 시 다른 요소와 동일한 크기로 스냅
 */
export interface SizeMatchGuide {
  type: 'size-match';
  dimension: 'width' | 'height';
  value: number; // 일치하는 크기 값
  position: { x: number; y: number }; // 표시 위치
  matchedElementId: string;
  // 일치하는 요소의 bounds (테두리 표시용)
  matchedElementBounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export interface SnapResult {
  snappedX: number;
  snappedY: number;
  guides: GuideLine[];
  spacingGuides: SpacingGuide[];
  didSnapX: boolean;
  didSnapY: boolean;
  // 간격 스냅 여부
  didSpacingSnapX: boolean;
  didSpacingSnapY: boolean;
}

export interface SizeSnapResult {
  snappedWidth: number;
  snappedHeight: number;
  sizeMatchGuides: SizeMatchGuide[];
  didSnapWidth: boolean;
  didSnapHeight: boolean;
}

// 스냅 거리 임계값 (픽셀)
const SNAP_THRESHOLD = 8;
// 간격 스냅 임계값 (픽셀)
const SPACING_SNAP_THRESHOLD = 5;
// 크기 일치 스냅 임계값 (픽셀)
const SIZE_MATCH_THRESHOLD = 4;

/**
 * 요소의 bounds 정보 계산
 */
export function calculateBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  id: string = '',
): ElementBounds {
  return {
    id,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    centerX: x + width / 2,
    centerY: y + height / 2,
    width,
    height,
  };
}

/**
 * 여러 요소들의 전체 바운딩 박스 계산 (그룹 선택용)
 * @param elements 요소들의 bounds 배열
 * @returns 전체 요소를 감싸는 바운딩 박스
 */
export function calculateGroupBounds(
  elements: ElementBounds[],
): ElementBounds | null {
  if (elements.length === 0) return null;

  if (elements.length === 1) return elements[0];

  const left = Math.min(...elements.map((el) => el.left));
  const top = Math.min(...elements.map((el) => el.top));
  const right = Math.max(...elements.map((el) => el.right));
  const bottom = Math.max(...elements.map((el) => el.bottom));
  const width = right - left;
  const height = bottom - top;

  return {
    id: 'group',
    left,
    top,
    right,
    bottom,
    centerX: left + width / 2,
    centerY: top + height / 2,
    width,
    height,
  };
}

/**
 * 두 값이 스냅 거리 내에 있는지 확인
 */
function _isWithinThreshold(
  value1: number,
  value2: number,
  threshold: number = SNAP_THRESHOLD,
): boolean {
  return Math.abs(value1 - value2) <= threshold;
}

// 캔버스 중앙 좌표 (그리드 렌더링 영역 900x396 기준)
export const CANVAS_CENTER_X = 450;
export const CANVAS_CENTER_Y = 195;

/**
 * calculateSnapPoints 옵션 인터페이스
 */
export interface SnapPointsOptions {
  /** 그룹 선택 시 전체 그룹의 bounds (캔버스 중앙 스냅에 사용) */
  groupBounds?: ElementBounds | null;

  /** 간격(Spacing) 가이드/스냅 계산을 비활성화 */
  disableSpacing?: boolean;

  /** 캔버스 중앙 스냅 결과를 맞출 그리드 크기, 0이면 반올림 없음 */
  gridSnapSize?: number;
}

/**
 * 드래그 중인 요소와 다른 요소들 사이의 스냅 포인트 계산
 * 캔버스 중앙 기준 스냅도 포함
 * @param draggedBounds 드래그 중인 요소의 bounds
 * @param otherElements 다른 요소들의 bounds
 * @param threshold 스냅 임계값 (기본값: 8px)
 * @param options 추가 옵션 (groupBounds 등)
 */
export function calculateSnapPoints(
  draggedBounds: ElementBounds,
  otherElements: ElementBounds[],
  threshold: number = SNAP_THRESHOLD,
  options?: SnapPointsOptions,
): SnapResult {
  const guides: GuideLine[] = [];
  let snappedX = draggedBounds.left;
  let snappedY = draggedBounds.top;
  let didSnapX = false;
  let didSnapY = false;
  let didSnapCanvasCenterX = false;
  let didSnapCanvasCenterY = false;

  // 가장 가까운 스냅 포인트 추적
  let closestXDiff = Infinity;
  let closestYDiff = Infinity;

  // === 캔버스 중앙 기준 스냅 ===
  // 그룹 선택 시에는 그룹 전체의 중심을 기준으로, 아니면 개별 요소의 중심을 기준으로
  const centerBounds = options?.groupBounds || draggedBounds;

  // 요소(또는 그룹)의 중심이 캔버스 가로 중앙에 정렬
  let diff = Math.abs(centerBounds.centerX - CANVAS_CENTER_X);
  if (diff <= threshold && diff < closestXDiff) {
    closestXDiff = diff;
    // 그룹의 중심이 캔버스 중앙에 오도록 드래그 요소의 위치 계산
    const offsetX = draggedBounds.centerX - centerBounds.centerX;
    snappedX = CANVAS_CENTER_X - draggedBounds.width / 2 + offsetX;
    snappedX = roundToGrid(snappedX, options?.gridSnapSize ?? 0);
    didSnapX = true;
    didSnapCanvasCenterX = true;
  }

  // 요소(또는 그룹)의 중심이 캔버스 세로 중앙에 정렬
  diff = Math.abs(centerBounds.centerY - CANVAS_CENTER_Y);
  if (diff <= threshold && diff < closestYDiff) {
    closestYDiff = diff;
    // 그룹의 중심이 캔버스 중앙에 오도록 드래그 요소의 위치 계산
    const offsetY = draggedBounds.centerY - centerBounds.centerY;
    snappedY = CANVAS_CENTER_Y - draggedBounds.height / 2 + offsetY;
    snappedY = roundToGrid(snappedY, options?.gridSnapSize ?? 0);
    didSnapY = true;
    didSnapCanvasCenterY = true;
  }

  for (const other of otherElements) {
    // 자기 자신은 스킵
    if (other.id === draggedBounds.id) continue;

    // === X축 (수직 가이드라인) 스냅 체크 ===

    // 왼쪽 가장자리 정렬 (left-to-left)
    let diff = Math.abs(draggedBounds.left - other.left);
    if (diff <= threshold && diff < closestXDiff) {
      closestXDiff = diff;
      snappedX = other.left;
      didSnapX = true;
      didSnapCanvasCenterX = false;
    }

    // 오른쪽 가장자리 정렬 (right-to-right)
    diff = Math.abs(draggedBounds.right - other.right);
    if (diff <= threshold && diff < closestXDiff) {
      closestXDiff = diff;
      snappedX = other.right - draggedBounds.width;
      didSnapX = true;
      didSnapCanvasCenterX = false;
    }

    // 왼쪽-오른쪽 정렬 (left-to-right) - 임시 비활성화
    // diff = Math.abs(draggedBounds.left - other.right);
    // if (diff <= threshold && diff < closestXDiff) {
    //   closestXDiff = diff;
    //   snappedX = other.right;
    //   didSnapX = true;
    // }

    // 오른쪽-왼쪽 정렬 (right-to-left) - 임시 비활성화
    // diff = Math.abs(draggedBounds.right - other.left);
    // if (diff <= threshold && diff < closestXDiff) {
    //   closestXDiff = diff;
    //   snappedX = other.left - draggedBounds.width;
    //   didSnapX = true;
    // }

    // 중앙 정렬 (center-to-center X)
    diff = Math.abs(draggedBounds.centerX - other.centerX);
    if (diff <= threshold && diff < closestXDiff) {
      closestXDiff = diff;
      snappedX = other.centerX - draggedBounds.width / 2;
      didSnapX = true;
      didSnapCanvasCenterX = false;
    }

    // === Y축 (수평 가이드라인) 스냅 체크 ===

    // 상단 정렬 (top-to-top)
    diff = Math.abs(draggedBounds.top - other.top);
    if (diff <= threshold && diff < closestYDiff) {
      closestYDiff = diff;
      snappedY = other.top;
      didSnapY = true;
      didSnapCanvasCenterY = false;
    }

    // 하단 정렬 (bottom-to-bottom)
    diff = Math.abs(draggedBounds.bottom - other.bottom);
    if (diff <= threshold && diff < closestYDiff) {
      closestYDiff = diff;
      snappedY = other.bottom - draggedBounds.height;
      didSnapY = true;
      didSnapCanvasCenterY = false;
    }

    // 상단-하단 정렬 (top-to-bottom) - 임시 비활성화
    // diff = Math.abs(draggedBounds.top - other.bottom);
    // if (diff <= threshold && diff < closestYDiff) {
    //   closestYDiff = diff;
    //   snappedY = other.bottom;
    //   didSnapY = true;
    // }

    // 하단-상단 정렬 (bottom-to-top) - 임시 비활성화
    // diff = Math.abs(draggedBounds.bottom - other.top);
    // if (diff <= threshold && diff < closestYDiff) {
    //   closestYDiff = diff;
    //   snappedY = other.top - draggedBounds.height;
    //   didSnapY = true;
    // }

    // 중앙 정렬 (center-to-center Y)
    diff = Math.abs(draggedBounds.centerY - other.centerY);
    if (diff <= threshold && diff < closestYDiff) {
      closestYDiff = diff;
      snappedY = other.centerY - draggedBounds.height / 2;
      didSnapY = true;
      didSnapCanvasCenterY = false;
    }
  }

  // 스냅된 위치를 기준으로 가이드라인 생성
  const snappedBounds = calculateBounds(
    snappedX,
    snappedY,
    draggedBounds.width,
    draggedBounds.height,
    draggedBounds.id,
  );

  for (const other of otherElements) {
    if (other.id === draggedBounds.id) continue;

    // X축 가이드라인 (수직선)
    if (didSnapX) {
      // 왼쪽 가장자리 정렬
      if (Math.abs(snappedBounds.left - other.left) < 1) {
        guides.push({
          type: 'vertical',
          position: other.left,
          alignType: 'left',
        });
      }
      // 오른쪽 가장자리 정렬
      if (Math.abs(snappedBounds.right - other.right) < 1) {
        guides.push({
          type: 'vertical',
          position: other.right,
          alignType: 'right',
        });
      }
      // 왼쪽-오른쪽 정렬 - 임시 비활성화
      // if (Math.abs(snappedBounds.left - other.right) < 1) {
      //   guides.push({
      //     type: "vertical",
      //     position: other.right,
      //     alignType: "left",
      //   });
      // }
      // 오른쪽-왼쪽 정렬 - 임시 비활성화
      // if (Math.abs(snappedBounds.right - other.left) < 1) {
      //   guides.push({
      //     type: "vertical",
      //     position: other.left,
      //     alignType: "right",
      //   });
      // }
      // 중앙 정렬
      if (Math.abs(snappedBounds.centerX - other.centerX) < 1) {
        guides.push({
          type: 'vertical',
          position: other.centerX,
          alignType: 'center',
        });
      }
    }

    // Y축 가이드라인 (수평선)
    if (didSnapY) {
      // 상단 정렬
      if (Math.abs(snappedBounds.top - other.top) < 1) {
        guides.push({
          type: 'horizontal',
          position: other.top,
          alignType: 'top',
        });
      }
      // 하단 정렬
      if (Math.abs(snappedBounds.bottom - other.bottom) < 1) {
        guides.push({
          type: 'horizontal',
          position: other.bottom,
          alignType: 'bottom',
        });
      }
      // 상단-하단 정렬 - 임시 비활성화
      // if (Math.abs(snappedBounds.top - other.bottom) < 1) {
      //   guides.push({
      //     type: "horizontal",
      //     position: other.bottom,
      //     alignType: "top",
      //   });
      // }
      // 하단-상단 정렬 - 임시 비활성화
      // if (Math.abs(snappedBounds.bottom - other.top) < 1) {
      //   guides.push({
      //     type: "horizontal",
      //     position: other.top,
      //     alignType: "bottom",
      //   });
      // }
      // 중앙 정렬
      if (Math.abs(snappedBounds.centerY - other.centerY) < 1) {
        guides.push({
          type: 'horizontal',
          position: other.centerY,
          alignType: 'middle',
        });
      }
    }
  }

  // === 캔버스 중앙 기준 가이드라인 추가 ===
  // 그룹 선택 시에는 그룹의 중심을, 아니면 개별 요소의 중심을 기준으로
  const snappedCenterBounds = options?.groupBounds
    ? {
        // 그룹의 스냅 후 중심 계산 (드래그 요소의 이동량을 적용)
        centerX: options.groupBounds.centerX + (snappedX - draggedBounds.left),
        centerY: options.groupBounds.centerY + (snappedY - draggedBounds.top),
      }
    : snappedBounds;

  // X축: 요소(또는 그룹) 중심이 캔버스 가로 중앙에 정렬된 경우
  if (
    didSnapCanvasCenterX ||
    (didSnapX && Math.abs(snappedCenterBounds.centerX - CANVAS_CENTER_X) < 1)
  ) {
    guides.push({
      type: 'vertical',
      position: CANVAS_CENTER_X,
      alignType: 'center',
    });
  }

  // Y축: 요소(또는 그룹) 중심이 캔버스 세로 중앙에 정렬된 경우
  if (
    didSnapCanvasCenterY ||
    (didSnapY && Math.abs(snappedCenterBounds.centerY - CANVAS_CENTER_Y) < 1)
  ) {
    guides.push({
      type: 'horizontal',
      position: CANVAS_CENTER_Y,
      alignType: 'middle',
    });
  }

  // 중복 가이드라인 제거
  const uniqueGuides = guides.filter(
    (guide, index, self) =>
      index ===
      self.findIndex(
        (g) =>
          g.type === guide.type && Math.abs(g.position - guide.position) < 1,
      ),
  );

  // 간격 가이드 계산 (옵션으로 비활성화 가능)
  if (options?.disableSpacing) {
    return {
      snappedX,
      snappedY,
      guides: uniqueGuides,
      spacingGuides: [],
      didSnapX,
      didSnapY,
      didSpacingSnapX: false,
      didSpacingSnapY: false,
    };
  }

  const spacingResult = calculateSpacingGuides(
    {
      ...draggedBounds,
      left: snappedX,
      top: snappedY,
      right: snappedX + draggedBounds.width,
      bottom: snappedY + draggedBounds.height,
      centerX: snappedX + draggedBounds.width / 2,
      centerY: snappedY + draggedBounds.height / 2,
    },
    otherElements,
  );

  return {
    snappedX: spacingResult.didSpacingSnapX ? spacingResult.snappedX : snappedX,
    snappedY: spacingResult.didSpacingSnapY ? spacingResult.snappedY : snappedY,
    guides: uniqueGuides,
    spacingGuides: spacingResult.spacingGuides,
    didSnapX: didSnapX || spacingResult.didSpacingSnapX,
    didSnapY: didSnapY || spacingResult.didSpacingSnapY,
    didSpacingSnapX: spacingResult.didSpacingSnapX,
    didSpacingSnapY: spacingResult.didSpacingSnapY,
  };
}

/**
 * 가이드라인의 시작/끝 위치 계산 (시각화용)
 */
export function calculateGuideLineExtent(
  guide: GuideLine,
  draggedBounds: ElementBounds,
  otherElements: ElementBounds[],
): { start: number; end: number } {
  // 캔버스 중앙 가이드라인인지 확인
  const isCanvasCenterGuide =
    (guide.type === 'vertical' &&
      Math.abs(guide.position - CANVAS_CENTER_X) < 1) ||
    (guide.type === 'horizontal' &&
      Math.abs(guide.position - CANVAS_CENTER_Y) < 1);

  const relevantElements = otherElements.filter((el) => {
    if (el.id === draggedBounds.id) return false;

    if (guide.type === 'vertical') {
      // 수직 가이드라인: x 위치가 일치하는 요소
      return (
        Math.abs(el.left - guide.position) < 1 ||
        Math.abs(el.right - guide.position) < 1 ||
        Math.abs(el.centerX - guide.position) < 1
      );
    } else {
      // 수평 가이드라인: y 위치가 일치하는 요소
      return (
        Math.abs(el.top - guide.position) < 1 ||
        Math.abs(el.bottom - guide.position) < 1 ||
        Math.abs(el.centerY - guide.position) < 1
      );
    }
  });

  // 드래그 중인 요소도 포함
  relevantElements.push(draggedBounds);

  // 캔버스 중앙 가이드라인의 경우 더 긴 범위 표시
  const CANVAS_CENTER_GUIDE_EXTENSION = 500;

  if (guide.type === 'vertical') {
    const tops = relevantElements.map((el) => el.top);
    const bottoms = relevantElements.map((el) => el.bottom);
    const extension = isCanvasCenterGuide ? CANVAS_CENTER_GUIDE_EXTENSION : 20;
    return {
      start: Math.min(...tops) - extension,
      end: Math.max(...bottoms) + extension,
    };
  } else {
    const lefts = relevantElements.map((el) => el.left);
    const rights = relevantElements.map((el) => el.right);
    const extension = isCanvasCenterGuide ? CANVAS_CENTER_GUIDE_EXTENSION : 20;
    return {
      start: Math.min(...lefts) - extension,
      end: Math.max(...rights) + extension,
    };
  }
}

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
function calculateSpacingGuides(
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

/**
 * 크기 일치 스냅 계산 (리사이즈용)
 * 다른 요소와 동일한 width/height로 스냅
 * 여러 요소가 비슷한 크기일 경우, 가장 가까운 크기를 가진 요소에 스냅
 */
export function calculateSizeSnap(
  currentWidth: number,
  currentHeight: number,
  otherElements: ElementBounds[],
  draggedId: string = '',
): SizeSnapResult {
  const sizeMatchGuides: SizeMatchGuide[] = [];
  let snappedWidth = currentWidth;
  let snappedHeight = currentHeight;
  let didSnapWidth = false;
  let didSnapHeight = false;

  const others = otherElements.filter((el) => el.id !== draggedId);

  // 가장 가까운 매치를 추적하기 위한 변수
  let closestWidthDiff = Infinity;
  let closestHeightDiff = Infinity;
  let closestWidthMatch: ElementBounds | null = null;
  let closestHeightMatch: ElementBounds | null = null;

  // 첫 번째 패스: 임계값 내에서 가장 가까운 크기를 찾음
  for (const other of others) {
    // width 일치 체크 - 가장 가까운 것 선택
    const widthDiff = Math.abs(currentWidth - other.width);
    if (widthDiff <= SIZE_MATCH_THRESHOLD && widthDiff < closestWidthDiff) {
      closestWidthDiff = widthDiff;
      closestWidthMatch = other;
    }

    // height 일치 체크 - 가장 가까운 것 선택
    const heightDiff = Math.abs(currentHeight - other.height);
    if (heightDiff <= SIZE_MATCH_THRESHOLD && heightDiff < closestHeightDiff) {
      closestHeightDiff = heightDiff;
      closestHeightMatch = other;
    }
  }

  // 두 번째 패스: 가장 가까운 매치에 대한 스냅 적용
  if (closestWidthMatch) {
    snappedWidth = closestWidthMatch.width;
    didSnapWidth = true;
    sizeMatchGuides.push({
      type: 'size-match',
      dimension: 'width',
      value: closestWidthMatch.width,
      position: { x: closestWidthMatch.centerX, y: closestWidthMatch.top - 15 },
      matchedElementId: closestWidthMatch.id,
      matchedElementBounds: {
        left: closestWidthMatch.left,
        top: closestWidthMatch.top,
        width: closestWidthMatch.width,
        height: closestWidthMatch.height,
      },
    });
  }

  if (closestHeightMatch) {
    snappedHeight = closestHeightMatch.height;
    didSnapHeight = true;
    sizeMatchGuides.push({
      type: 'size-match',
      dimension: 'height',
      value: closestHeightMatch.height,
      position: {
        x: closestHeightMatch.right + 15,
        y: closestHeightMatch.centerY,
      },
      matchedElementId: closestHeightMatch.id,
      matchedElementBounds: {
        left: closestHeightMatch.left,
        top: closestHeightMatch.top,
        width: closestHeightMatch.width,
        height: closestHeightMatch.height,
      },
    });
  }

  return {
    snappedWidth,
    snappedHeight,
    sizeMatchGuides,
    didSnapWidth,
    didSnapHeight,
  };
}
