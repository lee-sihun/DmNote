import { rotatePointAround } from '@utils/core/rotation';
import { EDITOR_BOUNDS_LIMITS } from '@src/types/editor';
import type { CursorType } from '@utils/grid/cursorUtils';
import type { Bounds } from './groupResizeUtils';
import { isBoundsTransitionWithinEditorLimits } from './resizeLimits';

// 회전한 요소의 리사이즈. 핸들·드래그는 요소 로컬 축(회전한 틀)을 따르고
// 저장은 축 정렬 논리 상자로 남긴다

// 화면 이동량을 요소 로컬 축 이동량으로
export const screenDeltaToLocal = (
  deltaX: number,
  deltaY: number,
  rotation: number,
): { x: number; y: number } =>
  rotatePointAround({ x: deltaX, y: deltaY }, ORIGIN, -rotation);

const ORIGIN = Object.freeze({ x: 0, y: 0 });

// 로컬 프레임에서 반대 변을 고정하고 계산한 상자를, 화면에서도 그 변이 고정되도록
// 논리 상자로 되돌린다. 중심 이동량만 회전시키면 되고 크기는 그대로다
export const anchorRotatedResize = (
  start: Bounds,
  local: Bounds,
  rotation: number,
): Bounds => {
  if (rotation === 0) return local;
  const startCx = start.x + start.width / 2;
  const startCy = start.y + start.height / 2;
  const shift = rotatePointAround(
    {
      x: local.x + local.width / 2 - startCx,
      y: local.y + local.height / 2 - startCy,
    },
    ORIGIN,
    rotation,
  );
  return {
    x: startCx + shift.x - local.width / 2,
    y: startCy + shift.y - local.height / 2,
    width: local.width,
    height: local.height,
  };
};

// 회전 뒤 새로 움직이는 저장 좌표도 제한하면서 반대 변의 앵커를 보존한다
export const constrainRotatedResize = (
  start: Bounds,
  candidate: Bounds,
): Bounds => {
  if (isBoundsTransitionWithinEditorLimits(start, candidate)) return candidate;
  const { maxDimension, maxAbsCoordinate } = EDITOR_BOUNDS_LIMITS;
  let fraction = 1;
  for (const field of ['x', 'y', 'width', 'height'] as const) {
    const before = start[field];
    const after = candidate[field];
    if (!Number.isFinite(before) || !Number.isFinite(after))
      return { ...start };
    const coordinate = field === 'x' || field === 'y';
    const limit = Math.max(
      coordinate ? maxAbsCoordinate : maxDimension,
      Math.abs(before),
    );
    const lower = coordinate ? -limit : 0;
    if (after > limit)
      fraction = Math.min(fraction, (limit - before) / (after - before));
    if (after < lower)
      fraction = Math.min(fraction, (lower - before) / (after - before));
  }
  fraction = Math.max(0, fraction);
  for (let attempt = 0; attempt < 8 && fraction > 0; attempt += 1) {
    const result = {
      x: start.x + (candidate.x - start.x) * fraction,
      y: start.y + (candidate.y - start.y) * fraction,
      width: start.width + (candidate.width - start.width) * fraction,
      height: start.height + (candidate.height - start.height) * fraction,
    };
    if (isBoundsTransitionWithinEditorLimits(start, result)) return result;
    fraction *= 1 - 2 ** -20;
  }
  return { ...start };
};

const RESIZE_CURSORS: readonly CursorType[] = [
  'ew-resize',
  'nwse-resize',
  'ns-resize',
  'nesw-resize',
];

// 핸들 방향(dx, dy)을 회전시킨 화면 각도로 커서를 고른다. 45° 단위 4종
export const resizeCursorForHandle = (
  dx: number,
  dy: number,
  rotation: number,
): CursorType => {
  const base = (Math.atan2(dy, dx) * 180) / Math.PI;
  let angle = (base + rotation) % 180;
  if (angle < 0) angle += 180;
  const index = Math.round(angle / 45) % 4;
  return RESIZE_CURSORS[index];
};
