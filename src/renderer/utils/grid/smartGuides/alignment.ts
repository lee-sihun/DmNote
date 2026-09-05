import { roundToGrid } from '../gridSnap';
import { CANVAS_CENTER_X, CANVAS_CENTER_Y, calculateBounds } from './bounds';
import { calculateSpacingGuides } from './spacing';
import type {
  ElementBounds,
  GuideLine,
  SnapPointsOptions,
  SnapResult,
} from './types';

// 스냅 거리 임계값 (픽셀)
const SNAP_THRESHOLD = 8;

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
