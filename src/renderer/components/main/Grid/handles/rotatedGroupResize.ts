import { snapToGrid } from '@hooks/Grid/utils';
import { EDITOR_BOUNDS_LIMITS } from '@src/types/editor';
import {
  SPRITE_CONSTRAINTS,
  type SpriteTransform,
} from '@src/types/key/sprites';
import { rotatePointAround } from '@utils/core/rotation';
import {
  GROUP_RESIZE_MIN_SIZE,
  type GroupResizeHandle,
  type GroupResizePlan,
} from './groupResizePlan';
import type { Bounds, ElementBounds } from './groupResizeUtils';
import { isBoundsTransitionWithinEditorLimits } from './resizeLimits';
import { screenDeltaToLocal } from './rotatedResize';

export interface GroupRotationFrame {
  bounds: Bounds;
  rotation: number;
}

interface RotatedGroupResizeOptions {
  rotationFrame: GroupRotationFrame;
  handle: GroupResizeHandle;
  startElementBounds: ElementBounds[];
  deltaX: number;
  deltaY: number;
  snapSize: number;
  maxSpriteScale?: number;
}

// 자세 이동값이 개별 clamp되기 전에 그룹 전체 확대를 멈춘다
export const spriteGroupScaleLimit = (
  sprites: ReadonlyArray<{
    idleTransform: SpriteTransform;
    poses: ReadonlyArray<{ transform: SpriteTransform }>;
  }>,
): number => {
  let limit = Number.POSITIVE_INFINITY;
  for (const sprite of sprites) {
    for (const transform of [
      sprite.idleTransform,
      ...sprite.poses.map((pose) => pose.transform),
    ]) {
      for (const value of [transform.x, transform.y]) {
        if (value === 0) continue;
        const bound =
          value > 0
            ? SPRITE_CONSTRAINTS.offset.max
            : SPRITE_CONSTRAINTS.offset.min;
        limit = Math.min(limit, Math.max(1, bound / value));
      }
    }
  }
  return limit;
};

export const calculateRotatedGroupResizePlan = ({
  rotationFrame,
  handle,
  startElementBounds,
  deltaX,
  deltaY,
  snapSize,
  maxSpriteScale = Number.POSITIVE_INFINITY,
}: RotatedGroupResizeOptions): GroupResizePlan => {
  const start = rotationFrame.bounds;
  const unchanged = (): GroupResizePlan => ({
    result: {
      groupBounds: { ...start },
      elementBounds: startElementBounds.map(({ element, bounds }) => ({
        element,
        bounds: { ...bounds },
      })),
      handle,
    },
    guides: { type: 'clear' },
  });
  const validBounds = (bounds: Bounds) =>
    [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) &&
    bounds.width > 0 &&
    bounds.height > 0;
  if (
    !validBounds(start) ||
    !Number.isFinite(rotationFrame.rotation) ||
    !Number.isFinite(deltaX) ||
    !Number.isFinite(deltaY) ||
    startElementBounds.length === 0 ||
    startElementBounds.some(({ bounds }) => !validBounds(bounds))
  ) {
    return unchanged();
  }

  const local = screenDeltaToLocal(deltaX, deltaY, rotationFrame.rotation);
  const horizontal =
    handle.dx !== 0 &&
    (handle.dy === 0 ||
      Math.abs(local.x / start.width) >= Math.abs(local.y / start.height));
  const size = horizontal ? start.width : start.height;
  const direction = horizontal ? handle.dx : handle.dy;
  const delta = horizontal ? local.x : local.y;
  const snappedDelta = snapSize > 0 ? snapToGrid(delta, snapSize) : delta;
  const candidateScale = 1 + (direction * snappedDelta) / size;
  if (!Number.isFinite(candidateScale) || candidateScale === 1)
    return unchanged();

  // 반대 모서리 또는 반대 변의 중앙을 화면 좌표에서 고정
  const center = {
    x: start.x + start.width / 2,
    y: start.y + start.height / 2,
  };
  const anchor = rotatePointAround(
    {
      x: center.x - (handle.dx * start.width) / 2,
      y: center.y - (handle.dy * start.height) / 2,
    },
    center,
    rotationFrame.rotation,
  );
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y))
    return unchanged();

  let minScale = 0;
  let maxScale = Math.min(Number.MAX_VALUE, maxSpriteScale);
  const { maxDimension, maxAbsCoordinate } = EDITOR_BOUNDS_LIMITS;
  for (const { bounds } of startElementBounds) {
    const guarded = [bounds.width, bounds.height].filter(
      (value) => value >= GROUP_RESIZE_MIN_SIZE,
    );
    if (guarded.length === 0) minScale = 1;
    for (const value of guarded) {
      let minimum = GROUP_RESIZE_MIN_SIZE / value;
      while (value * minimum < GROUP_RESIZE_MIN_SIZE)
        minimum += minimum * Number.EPSILON;
      minScale = Math.max(minScale, minimum);
    }
    maxScale = Math.min(
      maxScale,
      Math.max(maxDimension, bounds.width) / bounds.width,
      Math.max(maxDimension, bounds.height) / bounds.height,
    );
    // 모든 저장 좌표가 같은 배율을 허용해야 배치가 유지된다
    for (const axis of ['x', 'y'] as const) {
      const origin = bounds[axis];
      const slope = origin - anchor[axis];
      if (slope === 0) continue;
      const limit = Math.max(maxAbsCoordinate, Math.abs(origin));
      const first = 1 + (-limit - origin) / slope;
      const second = 1 + (limit - origin) / slope;
      minScale = Math.max(minScale, Math.min(first, second));
      maxScale = Math.min(maxScale, Math.max(first, second));
    }
  }
  let scale = Math.max(
    Math.min(minScale, 1),
    Math.min(Math.max(maxScale, 1), candidateScale),
  );
  const project = (bounds: Bounds): Bounds =>
    scale === 1
      ? { ...bounds }
      : {
          x: bounds.x + (bounds.x - anchor.x) * (scale - 1),
          y: bounds.y + (bounds.y - anchor.y) * (scale - 1),
          width: bounds.width * scale,
          height: bounds.height * scale,
        };

  // 한계의 부동소수 잔차도 요소별 보정 없이 공통 배율로 되돌린다
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const elementBounds = startElementBounds.map(({ element, bounds }) => ({
      element,
      bounds: project(bounds),
    }));
    if (
      elementBounds.every(({ bounds }, index) =>
        isBoundsTransitionWithinEditorLimits(
          startElementBounds[index].bounds,
          bounds,
        ),
      )
    ) {
      return {
        result: { groupBounds: project(start), elementBounds, handle },
        guides: { type: 'clear' },
      };
    }
    scale += (1 - scale) * 2 ** -20;
  }
  return unchanged();
};
