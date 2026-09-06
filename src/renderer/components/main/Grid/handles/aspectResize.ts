import { EDITOR_BOUNDS_LIMITS } from '@src/types/editor';
import { clamp } from '@utils/core/clamp';
import { DEG_TO_RAD } from '@utils/core/rotation';
import { anchorRotatedResize } from './rotatedResize';

import {
  isBoundsTransitionWithinEditorLimits,
  type ResizeBounds,
} from './resizeLimits';

// 비율 고정 리사이즈는 배율 하나로만 움직인다. 배율을 허용 범위로 자르고 잡지 않은
// 가장자리를 고정해 두 치수를 함께 바꾸면 비율이 정확히 유지된다. 단일 핸들과
// 스마트 스냅 재유도가 같은 함수를 쓴다

export interface ResizeAxisHandle {
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
}

export type AspectPrimaryAxis = 'width' | 'height';

export interface ScaleRange {
  min: number;
  max: number;
}

// 앵커별 저장 좌표는 origin + slope·(s - 1). 범위를 풀 때 (s - 1) 기준으로 써야
// s=1이 정확히 시작 좌표가 된다 - origin + size 같은 합을 먼저 만들면 극단 좌표에서
// 정밀도가 깨져 빈 구간이 나온다. dir 1은 시작 가장자리 고정(좌표 불변),
// 0은 중앙 고정, -1은 반대 가장자리 고정
const anchorSlope = (size: number, dir: -1 | 0 | 1): number =>
  dir === 1 ? 0 : dir === 0 ? -size / 2 : -size;

// -limit ≤ origin + slope·(s - 1) ≤ limit 을 만족하는 s 구간
const coordinateScaleRange = (
  origin: number,
  slope: number,
  limit: number,
): ScaleRange => {
  const lo = 1 + (-limit - origin) / slope;
  const hi = 1 + (limit - origin) / slope;
  return slope > 0 ? { min: lo, max: hi } : { min: hi, max: lo };
};

/**
 * 비율 고정 배율의 허용 범위
 * - 하한은 시작 시 minSize 이상인 축만 기준으로 잡아 이미 얇은 축을 억지로 키우지
 * 않고, 두 축 모두 얇으면 현재보다 축소를 막는다. 상한은 두 치수와 저장 좌표
 * 양쪽 부등식에서 나온다 (좌표 조건은 하한에도 기여한다 - 상단 가장자리가 좌표
 * 상한 근처면 중앙 앵커 축소가 좌표를 밖으로 민다)
 * - 유효한 시작이면 s=1이 항상 구간 안이고, 범위 밖 legacy 시작은 s=1 쪽으로 닫는다
 */
export const aspectScaleRange = (
  start: ResizeBounds,
  handle: ResizeAxisHandle,
  minSize: number,
  rotation = 0,
): ScaleRange => {
  const { maxDimension, maxAbsCoordinate } = EDITOR_BOUNDS_LIMITS;
  const guarded = [start.width, start.height].filter((size) => size >= minSize);
  let min =
    guarded.length === 0
      ? 1
      : Math.max(...guarded.map((size) => minSize / size));
  // minSize / size 가 아래로 반올림되면 size * min 이 9.999…로 저장되고 다음 드래그에서
  // 얇은 축으로 분류돼 하한이 뚫린다 - 보호 축이 전부 하한 이상이 될 때까지 한 ulp씩 올린다
  while (guarded.some((size) => size * min < minSize)) {
    min += min * Number.EPSILON;
  }
  let max = Math.min(maxDimension / start.width, maxDimension / start.height);
  const cos = Math.cos(rotation * DEG_TO_RAD);
  const sin = Math.sin(rotation * DEG_TO_RAD);
  const axes: Array<[number, number]> =
    rotation === 0
      ? [
          [start.x, anchorSlope(start.width, handle.dx)],
          [start.y, anchorSlope(start.height, handle.dy)],
        ]
      : [
          [
            start.x,
            (cos * start.width * handle.dx -
              sin * start.height * handle.dy -
              start.width) /
              2,
          ],
          [
            start.y,
            (sin * start.width * handle.dx +
              cos * start.height * handle.dy -
              start.height) /
              2,
          ],
        ];
  for (const [origin, slope] of axes) {
    if (slope === 0) continue;
    const range = coordinateScaleRange(origin, slope, maxAbsCoordinate);
    min = Math.max(min, range.min);
    max = Math.min(max, range.max);
  }
  // 유효한 시작이면 s=1이 구간 안이다. 극단값의 부동소수 오차나 legacy 시작이
  // 구간을 비우지 않게 1을 명시적으로 포함하고, 극소 치수에서 상한 나눗셈이
  // 넘치면 유한값으로 막는다 (배율 자체가 표현 불가면 뒤의 settle이 닫는다)
  const finiteMax = Number.isFinite(max) ? max : Number.MAX_VALUE;
  return { min: Math.min(min, 1), max: Math.max(finiteMax, 1) };
};

export interface ExactAxisSize {
  axis: AspectPrimaryAxis;
  size: number;
}

// 잡지 않은 가장자리 고정 - 위치는 치수 차이의 몫으로 잡아 스냅된 정수 치수가
// 정수 위치를 만든다 (배율 곱은 410이 409.99999999999994가 된다)
const anchorFraction = (dir: -1 | 0 | 1): number =>
  dir === 1 ? 0 : dir === 0 ? 0.5 : 1;

/**
 * 두 치수에 같은 배율, 잡지 않은 가장자리 고정. s=1이면 시작 bounds 그대로
 * - exact는 배율의 출처인 축의 스냅·클램프된 치수 - 그 축은 곱셈 대신 그 값을 써
 * 그리드 정수를 보존한다
 */
export const scaleBoundsAnchored = (
  start: ResizeBounds,
  scale: number,
  handle: ResizeAxisHandle,
  exact?: ExactAxisSize,
): ResizeBounds => {
  if (scale === 1) return { ...start };
  const width = exact?.axis === 'width' ? exact.size : start.width * scale;
  const height = exact?.axis === 'height' ? exact.size : start.height * scale;
  return {
    x: start.x + (start.width - width) * anchorFraction(handle.dx),
    y: start.y + (start.height - height) * anchorFraction(handle.dy),
    width,
    height,
  };
};

/**
 * 배율을 범위로 자르고, 최종 bounds가 백엔드 전이 검증을 통과할 때까지 s를 1 쪽으로
 * 조금씩 물린다 (경계값 역산의 부동소수 오차 대비). 그래도 통과하지 못하면 1로
 * 닫는다 - 시작 bounds 그대로는 백엔드가 항상 받으므로 무효 bounds는 절대 내보내지
 * 않는다 (극소 치수처럼 배율이 표현 범위를 넘는 경우)
 */
export const settleAspectScale = (
  start: ResizeBounds,
  scale: number,
  handle: ResizeAxisHandle,
  range: ScaleRange,
  exact?: ExactAxisSize,
  rotation = 0,
): number => {
  let settled = clamp(Number.isFinite(scale) ? scale : 1, range.min, range.max);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const exactSize = settled === scale ? exact : undefined;
    if (
      isBoundsTransitionWithinEditorLimits(
        start,
        anchorRotatedResize(
          start,
          scaleBoundsAnchored(start, settled, handle, exactSize),
          rotation,
        ),
      )
    ) {
      return settled;
    }
    settled += (1 - settled) * 2 ** -20;
  }
  return 1;
};

/**
 * 기준 축 후보 크기 → 배율. snapSize는 방향별 그리드 스냅(오른쪽·아래는 크기,
 * 왼쪽·위는 움직이는 가장자리 좌표)을 호출자가 넣는다. 스냅이 범위 밖 배율을
 * 만들면 그 프레임은 스냅을 버리고 원래 후보를 쓴다 - 얇은 요소는 그리드 한 칸이
 * 치수 0으로 무너지고, 상한 근처는 스냅이 범위를 넘는다
 */
export interface AspectPrimaryScale {
  scale: number;
  /** 배율의 출처가 된 기준 축 치수 - 클램프에 걸리지 않았으면 스냅·후보 값 그대로 */
  exact: ExactAxisSize;
}

export const aspectScaleFromPrimary = (
  start: ResizeBounds,
  primary: AspectPrimaryAxis,
  candidateSize: number,
  snapSize: (size: number) => number,
  range: ScaleRange,
): AspectPrimaryScale => {
  const startSize = primary === 'width' ? start.width : start.height;
  const snappedSize = snapSize(candidateSize);
  const snapped = snappedSize / startSize;
  const useSnapped = snapped >= range.min && snapped <= range.max;
  const chosenSize = useSnapped ? snappedSize : candidateSize;
  const chosen = chosenSize / startSize;
  // 극소 시작 치수는 배율이 표현 범위를 넘는다. 그 배율로는 비율을 지킬 수 없으니
  // 이 프레임은 움직이지 않는다 (1은 시작 bounds 그대로)
  if (!Number.isFinite(chosen)) {
    return { scale: 1, exact: { axis: primary, size: startSize } };
  }
  const scale = clamp(chosen, range.min, range.max);
  return {
    scale,
    exact: {
      axis: primary,
      size: scale === chosen ? chosenSize : startSize * scale,
    },
  };
};

/** 배율 출처 축의 정확한 치수 - settle이 배율을 옮겼으면 다시 곱한다 */
export const exactSizeFor = (
  start: ResizeBounds,
  scale: number,
  fromScale: number,
  exact: ExactAxisSize,
): ExactAxisSize =>
  scale === fromScale
    ? exact
    : {
        axis: exact.axis,
        size: (exact.axis === 'width' ? start.width : start.height) * scale,
      };

// double 한 칸(ulp) - 배율 비교 허용치의 단위
const ulpOf = (value: number): number =>
  2 ** (Math.floor(Math.log2(Math.abs(value))) - 52);

/**
 * 두 변이 같은 배율로 움직였는지 - 테스트·검증용 불변식. 반대 축은 곱셈 한 번으로
 * 만들어지므로 정상 범위 double에서는 몇 ulp 안에 든다
 */
export const isSameAspect = (
  start: ResizeBounds,
  next: ResizeBounds,
  toleranceUlps = 4,
): boolean => {
  const sx = next.width / start.width;
  const sy = next.height / start.height;
  return Math.abs(sx - sy) <= toleranceUlps * ulpOf(Math.max(sx, sy));
};
