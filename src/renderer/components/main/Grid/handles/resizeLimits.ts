import { EDITOR_BOUNDS_LIMITS } from '@src/types/editor';

export interface ResizeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const { maxDimension, maxAbsCoordinate } = EDITOR_BOUNDS_LIMITS;

const coordinateWithinLimit = (value: number): boolean =>
  Number.isFinite(value) && Math.abs(value) <= maxAbsCoordinate;

const dimensionWithinLimit = (value: number): boolean =>
  Number.isFinite(value) && value > 0 && value <= maxDimension;

// editor.rs numeric_metric_non_increasing 미러 - 범위 밖 현재값은 그대로 두거나
// 절댓값(좌표)·크기(치수)가 줄어드는 후보만 받는다
const nonIncreasing = (
  current: number,
  candidate: number,
  dimension: boolean,
): boolean => {
  if (!Number.isFinite(current) || !Number.isFinite(candidate)) {
    return Object.is(current, candidate);
  }
  if (dimension && (current <= 0 || candidate <= 0)) {
    return Object.is(current, candidate);
  }
  return dimension
    ? candidate <= current
    : Math.abs(candidate) <= Math.abs(current);
};

// 백엔드 validate_bounds_metrics와 같은 판정. 저장 좌표(왼쪽·위)의 절댓값과
// 치수(0 < v ≤ 상한)만 보고 오른쪽·아래 가장자리는 보지 않는다
export const isBoundsWithinEditorLimits = (bounds: ResizeBounds): boolean =>
  coordinateWithinLimit(bounds.x) &&
  coordinateWithinLimit(bounds.y) &&
  dimensionWithinLimit(bounds.width) &&
  dimensionWithinLimit(bounds.height);

/**
 * 현재값을 아는 전이 판정 - 백엔드의 legacy 관용까지 미러한다. 이미 범위 밖인
 * 항목은 그대로 두거나 줄이는 후보를 통과시키므로, 폭이 범위 밖인 옛 요소도
 * 높이만 바꾸는 리사이즈는 막히지 않는다
 */
export const isBoundsTransitionWithinEditorLimits = (
  current: ResizeBounds,
  candidate: ResizeBounds,
): boolean => {
  const coordinate = (before: number, after: number) =>
    coordinateWithinLimit(after) ||
    (!coordinateWithinLimit(before) && nonIncreasing(before, after, false));
  const dimension = (before: number, after: number) =>
    dimensionWithinLimit(after) ||
    (!dimensionWithinLimit(before) && nonIncreasing(before, after, true));
  return (
    coordinate(current.x, candidate.x) &&
    coordinate(current.y, candidate.y) &&
    dimension(current.width, candidate.width) &&
    dimension(current.height, candidate.height)
  );
};
