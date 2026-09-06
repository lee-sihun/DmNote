import { describe, expect, it } from 'vitest';

import type {
  ReactiveSpritePosition,
  SpritePose,
} from '@src/types/key/sprites';

import { makeSpritePose, makeSpritePosition } from './spriteFixtures';
import { rotatePointAround } from '@utils/core/rotation';
import {
  boxSpritePlacement,
  compensateTransformForPivotChange,
  fitSpriteBoundsToNaturalSize,
  isSameSpritePlacement,
  placeSpriteVisual,
  spriteIdleVisual,
  spritePoseVisual,
  spriteReferenceScale,
  spriteReferenceSize,
  spritePivotChangePatch,
  compensateTransformForPivotDelta,
  compensateTransformForPosePivotDelta,
  pivotForHandleTarget,
  pivotHandleLocalPoint,
  posePivotForHandleTarget,
  posePivotHandleLocalPoint,
  snapPivotToPreset,
  snapPosePivotToPreset,
  spritePosePivotChangePatch,
} from './spritePlacement';

// 상자 200x100, 기준 이미지 400x200(배율 0.5), 기준점은 상자 가운데
const referenceSprite = () =>
  makeSpritePosition({
    baseImage: 'base.png',
    width: 200,
    height: 100,
    pivot: { x: 0.5, y: 0.5 },
    referenceNaturalSize: { source: 'base.png', width: 400, height: 200 },
  });

const renderedPoseCorners = (
  sprite: ReactiveSpritePosition,
  pose: SpritePose,
): Array<{ x: number; y: number }> => {
  const placement = placeSpriteVisual(sprite, spritePoseVisual(sprite, pose));
  const axis = {
    x: sprite.pivot.x * sprite.width,
    y: sprite.pivot.y * sprite.height,
  };
  const rad = (pose.transform.rotation * Math.PI) / 180;
  const cos = Math.cos(rad) * pose.transform.scale;
  const sin = Math.sin(rad) * pose.transform.scale;
  const { rect } = placement;
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ].map((corner) => {
    const dx = corner.x - axis.x;
    const dy = corner.y - axis.y;
    return {
      x: axis.x + pose.transform.x + dx * cos - dy * sin,
      y: axis.y + pose.transform.y + dx * sin + dy * cos,
    };
  });
};

const renderedPoseAxis = (
  sprite: ReactiveSpritePosition,
  pose: SpritePose,
): { x: number; y: number } => ({
  x: sprite.pivot.x * sprite.width + pose.transform.x,
  y: sprite.pivot.y * sprite.height + pose.transform.y,
});

const expectSameCorners = (
  actual: Array<{ x: number; y: number }>,
  expected: Array<{ x: number; y: number }>,
) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((corner, index) => {
    expect(corner.x).toBeCloseTo(expected[index].x, 8);
    expect(corner.y).toBeCloseTo(expected[index].y, 8);
  });
};

describe('spriteReferenceSize', () => {
  it('base가 있으면 base에 결합된 기준만 유효하다', () => {
    expect(spriteReferenceSize(referenceSprite())).toEqual({
      width: 400,
      height: 200,
    });
    expect(
      spriteReferenceSize({
        baseImage: 'other.png',
        referenceNaturalSize: { source: 'base.png', width: 400, height: 200 },
      }),
    ).toBeNull();
  });

  it('base가 없으면 결합 없는 기준만 유효하다', () => {
    expect(
      spriteReferenceSize({
        baseImage: null,
        referenceNaturalSize: { source: null, width: 300, height: 300 },
      }),
    ).toEqual({ width: 300, height: 300 });
    expect(
      spriteReferenceSize({
        baseImage: '',
        referenceNaturalSize: { source: 'gone.png', width: 300, height: 300 },
      }),
    ).toBeNull();
  });
});

describe('spriteReferenceScale', () => {
  it('상자 ÷ 기준 크기의 축별 배율', () => {
    expect(spriteReferenceScale(referenceSprite())).toEqual({
      x: 0.5,
      y: 0.5,
    });
    expect(
      spriteReferenceScale({ ...referenceSprite(), width: 200, height: 200 }),
    ).toEqual({ x: 0.5, y: 1 });
  });

  it('기준 크기가 없거나 stale이면 배율이 없다', () => {
    expect(
      spriteReferenceScale({
        ...referenceSprite(),
        referenceNaturalSize: null,
      }),
    ).toBeNull();
    expect(
      spriteReferenceScale({ ...referenceSprite(), baseImage: 'other.png' }),
    ).toBeNull();
  });
});

describe('placeSpriteVisual', () => {
  it('기준 크기가 없으면 이미지를 요소 상자에 그대로 놓는다', () => {
    const sprite = makeSpritePosition({ baseImage: 'base.png' });
    const placement = placeSpriteVisual(sprite, spriteIdleVisual(sprite));
    expect(placement).toEqual(boxSpritePlacement(sprite));
    expect(placement.rect).toEqual({ x: 0, y: 0, width: 200, height: 200 });
    expect(placement.pivot).toBe(sprite.pivot);
  });

  it('기본 이미지는 항상 요소 상자를 정확히 채운다', () => {
    const sprite = referenceSprite();
    const placement = placeSpriteVisual(sprite, spriteIdleVisual(sprite));
    expect(placement.rect).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(placement.pivot).toEqual({ x: 0.5, y: 0.5 });
  });

  it('크기가 다른 자세 이미지는 같은 기준점을 P에 맞추고 기준 배율로 그려진다', () => {
    const sprite = referenceSprite();
    const pose = makeSpritePose({
      poseId: 'p',
      imageOverride: 'hand.png',
      imageOverrideMetrics: { source: 'hand.png', width: 400, height: 400 },
    });
    const visual = spritePoseVisual(sprite, pose);
    expect(visual.sourcePoseId).toBe('p');
    expect(visual.naturalSize).toEqual({ width: 400, height: 400 });
    const placement = placeSpriteVisual(sprite, visual);
    // P=(100, 50), W·H=200, 기준점이 이미지 가운데
    expect(placement.rect).toEqual({ x: 0, y: -50, width: 200, height: 200 });
    expect(placement.pivot).toBe(sprite.pivot);
  });

  it('독립 상태 기준점은 그 이미지의 점을 공통 축 P에 맞춘다', () => {
    const sprite = referenceSprite();
    const pose = makeSpritePose({
      poseId: 'p',
      pivot: { x: 0.25, y: 0.75 },
      imageOverride: 'hand.png',
      imageOverrideMetrics: { source: 'hand.png', width: 400, height: 400 },
    });
    const placement = placeSpriteVisual(sprite, spritePoseVisual(sprite, pose));
    // P=(100, 50), W·H=200, 상태 기준점=(50, 150)
    expect(placement.rect).toEqual({
      x: 50,
      y: -100,
      width: 200,
      height: 200,
    });
    expect(placement.pivot).toEqual({ x: 0.25, y: 0.75 });
  });

  it('경로가 어긋난 크기는 stale이라 상자 배치로 폴백한다', () => {
    const sprite = referenceSprite();
    const pose = makeSpritePose({
      imageOverride: 'new.png',
      imageOverrideMetrics: { source: 'old.png', width: 400, height: 400 },
    });
    const visual = spritePoseVisual(sprite, pose);
    expect(visual.naturalSize).toBeNull();
    expect(placeSpriteVisual(sprite, visual).rect).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
  });

  it('공백 override는 기본 이미지 visual이다', () => {
    const sprite = referenceSprite();
    const visual = spritePoseVisual(
      sprite,
      makeSpritePose({ imageOverride: ' ' }),
    );
    expect(visual.src).toBe('base.png');
    expect(visual.sourcePoseId).toBeNull();
  });
});

describe('isSameSpritePlacement', () => {
  it('rect와 기준점이 값으로 같을 때만 참이다', () => {
    const sprite = referenceSprite();
    const a = placeSpriteVisual(sprite, spriteIdleVisual(sprite));
    const b = placeSpriteVisual(
      structuredClone(sprite),
      spriteIdleVisual(sprite),
    );
    expect(isSameSpritePlacement(a, b)).toBe(true);
    expect(isSameSpritePlacement(a, { ...a, pivot: { x: 0, y: 0.5 } })).toBe(
      false,
    );
    expect(
      isSameSpritePlacement(a, { ...a, rect: { ...a.rect, width: 1 } }),
    ).toBe(false);
  });
});

describe('fitSpriteBoundsToNaturalSize', () => {
  it('배치가 회전했어도 이미지 교체의 기준점 화면 위치를 보존한다', () => {
    const pivot = { x: 0.2, y: 0.9 };
    for (const rotation of [0, 30, 90, 179, -180]) {
      const before = { dx: 10, dy: 20, width: 200, height: 200, rotation };
      const after = fitSpriteBoundsToNaturalSize(before, pivot, {
        width: 400,
        height: 200,
      });
      const point = (bounds: typeof after) =>
        rotatePointAround(
          {
            x: bounds.dx + bounds.width * pivot.x,
            y: bounds.dy + bounds.height * pivot.y,
          },
          { x: bounds.dx + bounds.width / 2, y: bounds.dy + bounds.height / 2 },
          rotation,
        );
      expect(point(after).x).toBeCloseTo(point(before).x, 8);
      expect(point(after).y).toBeCloseTo(point(before).y, 8);
      expect(after.width / after.height).toBe(2);
    }
  });
  it('상자를 이미지 비율로 줄이되 기준점 위치는 그대로 둔다', () => {
    const bounds = { dx: 10, dy: 20, width: 200, height: 200 };
    // 가운데 기준점 - 상자가 세로로 줄어도 P는 제자리
    expect(
      fitSpriteBoundsToNaturalSize(
        bounds,
        { x: 0.5, y: 0.5 },
        { width: 400, height: 200 },
      ),
    ).toEqual({ dx: 10, dy: 70, width: 200, height: 100 });
    // 왼쪽 위 기준점 - 비트맵 왼쪽 위가 상자 왼쪽 위에 붙는다
    expect(
      fitSpriteBoundsToNaturalSize(
        bounds,
        { x: 0, y: 0 },
        { width: 400, height: 200 },
      ),
    ).toEqual({ dx: 10, dy: 20, width: 200, height: 100 });
    // 비율이 이미 같으면 변화 없음
    expect(
      fitSpriteBoundsToNaturalSize(
        bounds,
        { x: 0.3, y: 0.9 },
        { width: 50, height: 50 },
      ),
    ).toEqual(bounds);
  });
});

describe('compensateTransformForPivotChange', () => {
  it('회전·배율 없는 기본 이미지는 기준점을 옮겨도 이동값이 변하지 않는다', () => {
    // t' = t + (I − sR)(P − P'), sR = I이면 보정항이 0
    const sprite = referenceSprite();
    const transform = { x: 12, y: -6, rotation: 0, scale: 1 };
    expect(
      compensateTransformForPivotChange(
        sprite,
        spriteIdleVisual(sprite),
        transform,
        { x: 0, y: 0 },
      ),
    ).toEqual(transform);
  });

  it('배율 2 기본 이미지는 기준점 이동만큼 그림이 밀리지 않게 보정한다', () => {
    // P=(100, 50) → P'=(0, 0), (I − 2I)(P − P') = −(100, 50)
    const sprite = referenceSprite();
    const transform = { x: 0, y: 0, rotation: 0, scale: 2 };
    expect(
      compensateTransformForPivotChange(
        sprite,
        spriteIdleVisual(sprite),
        transform,
        { x: 0, y: 0 },
      ),
    ).toEqual({ x: -100, y: -50, rotation: 0, scale: 2 });
  });
});

describe('spritePivotChangePatch', () => {
  it('보정이 이동값 범위를 넘는 기준점은 patch를 만들지 않는다', () => {
    // 200x100 기본 이미지, 180° 회전·배율 10, x=1900에서 기준점을 (0.5,0.5)→(0,0.5)로
    // 옮기면 정확한 보정 x는 3000 - 범위(±2000)를 넘으므로 일부만 클램프해 그림이
    // 움직이는 대신 변경 자체를 거절한다
    const sprite = makeSpritePosition({
      width: 200,
      height: 100,
      pivot: { x: 0.5, y: 0.5 },
      idleTransform: { x: 1900, y: 0, rotation: 180, scale: 10 },
    });
    expect(spritePivotChangePatch(sprite, { x: 0, y: 0.5 })).toBeNull();
    expect(
      compensateTransformForPivotChange(
        sprite,
        spriteIdleVisual(sprite),
        sprite.idleTransform,
        { x: 0, y: 0.5 },
      ),
    ).toBeNull();
  });

  it('범위 안이면 기본 이미지를 보정하고 연결 상태는 새 축을 따라가게 한다', () => {
    const sprite = makeSpritePosition({
      width: 200,
      height: 100,
      pivot: { x: 0.5, y: 0.5 },
      idleTransform: { x: 0, y: 0, rotation: 0, scale: 2 },
      poses: [
        makeSpritePose({
          poseId: 'p',
          triggers: ['k'],
          transform: { x: 10, y: 0, rotation: 90, scale: 1 },
        }),
      ],
    });
    const patch = spritePivotChangePatch(sprite, { x: 0, y: 0 });
    expect(patch).not.toBeNull();
    expect(patch!.pivot).toEqual({ x: 0, y: 0 });
    // 기본: (I − 2I)(P − P') = −(100, 50)
    expect(patch!.idleTransform).toEqual({
      x: -100,
      y: -50,
      rotation: 0,
      scale: 2,
    });
    // 연결 상태는 이동값을 보정하지 않아 기준점 화면 좌표가 기본 축과 함께 움직인다
    expect(patch!.poses[0].transform.x).toBe(10);
    expect(patch!.poses[0].transform.y).toBe(0);
    expect(patch!.poses[0].transform.rotation).toBe(90);
  });

  it('공통 기준점 변경은 연결 상태 축만 따라가고 독립 상태 이미지는 제자리에 둔다', () => {
    const sprite = referenceSprite();
    sprite.poses = [
      makeSpritePose({
        poseId: 'linked',
        pivot: null,
        transform: { x: 7, y: -4, rotation: 23, scale: 1.3 },
        imageOverride: 'linked.png',
        imageOverrideMetrics: {
          source: 'linked.png',
          width: 300,
          height: 500,
        },
      }),
      makeSpritePose({
        poseId: 'independent',
        pivot: { x: 0.2, y: 0.8 },
        transform: { x: -11, y: 9, rotation: -41, scale: 0.7 },
        imageOverride: 'independent.png',
        imageOverrideMetrics: {
          source: 'independent.png',
          width: 500,
          height: 300,
        },
      }),
    ];
    const linkedAxisBefore = renderedPoseAxis(sprite, sprite.poses[0]);
    const independentBefore = renderedPoseCorners(sprite, sprite.poses[1]);
    const patch = spritePivotChangePatch(sprite, { x: 0.1, y: 0.9 })!;
    const changed = { ...sprite, ...patch };

    expect(changed.poses[0].pivot).toBeNull();
    expect(changed.poses[0].transform).toEqual(sprite.poses[0].transform);
    expect(changed.poses[1].pivot).toEqual({ x: 0.2, y: 0.8 });
    const linkedAxisAfter = renderedPoseAxis(changed, changed.poses[0]);
    expect(linkedAxisAfter.x - linkedAxisBefore.x).toBeCloseTo(-80, 8);
    expect(linkedAxisAfter.y - linkedAxisBefore.y).toBeCloseTo(40, 8);
    expectSameCorners(
      renderedPoseCorners(changed, changed.poses[1]),
      independentBefore,
    );
  });
});

describe('spritePosePivotChangePatch', () => {
  it('상태 기준점을 분리하고 다시 연결해도 이미지 모서리가 움직이지 않는다', () => {
    const sprite = referenceSprite();
    const linked = makeSpritePose({
      poseId: 'pose',
      pivot: null,
      transform: { x: 12, y: -8, rotation: 37, scale: 1.4 },
      imageOverride: 'pose.png',
      imageOverrideMetrics: { source: 'pose.png', width: 360, height: 440 },
    });
    const before = renderedPoseCorners(sprite, linked);

    const detachedPatch = spritePosePivotChangePatch(sprite, linked, {
      x: 0.15,
      y: 0.85,
    })!;
    const detached = { ...linked, ...detachedPatch };
    expect(detached.pivot).toEqual({ x: 0.15, y: 0.85 });
    expectSameCorners(renderedPoseCorners(sprite, detached), before);

    const linkedPatch = spritePosePivotChangePatch(sprite, detached, null)!;
    const relinked = { ...detached, ...linkedPatch };
    expect(relinked.pivot).toBeNull();
    expectSameCorners(renderedPoseCorners(sprite, relinked), before);
  });
});

describe('기준점 드래그 프레임', () => {
  const frame = {
    box: { width: 200, height: 100 },
    rect: { width: 200, height: 100 },
    pivot: { x: 0.5, y: 0.5 },
    transform: { x: 10, y: 5, rotation: 90, scale: 0.5 },
  };

  it('표식 자리는 P + t + sR·Δ이고 역변환이 같은 기준점을 되돌린다', () => {
    const next = { x: 0.8, y: 0.3 };
    // Δ = (60, −20) → R(90°)·Δ·0.5 = (10, 30) → (100+10+10, 50+5+30)
    const at = pivotHandleLocalPoint(frame, next);
    expect(at.x).toBeCloseTo(120, 9);
    expect(at.y).toBeCloseTo(85, 9);
    const back = pivotForHandleTarget(frame, at);
    expect(back.x).toBeCloseTo(0.8, 9);
    expect(back.y).toBeCloseTo(0.3, 9);
    // 보정 transform으로 그린 P' + t'도 같은 자리
    const compensated = compensateTransformForPivotDelta(frame, next)!;
    expect(160 + compensated.x).toBeCloseTo(120, 9);
    expect(30 + compensated.y).toBeCloseTo(85, 9);
  });

  it('배율이 작으면 포인터 이동량이 그만큼 큰 기준점 변화가 된다', () => {
    const small = {
      ...frame,
      transform: { x: 0, y: 0, rotation: 0, scale: 0.1 },
    };
    // 표식 5px 이동 = 이미지 좌표 50px = 기준점 0.25
    const next = pivotForHandleTarget(small, { x: 105, y: 50 });
    expect(next.x).toBeCloseTo(0.75, 9);
    expect(next.y).toBeCloseTo(0.5, 9);
    expect(pivotHandleLocalPoint(small, next).x).toBeCloseTo(105, 9);
  });

  it('닿을 수 없는 target은 0..1로 잘린다', () => {
    expect(pivotForHandleTarget(frame, { x: 10000, y: -10000 })).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe('상태 기준점 드래그 프레임', () => {
  const frame = {
    axis: { x: 100, y: 50 },
    rect: { width: 240, height: 120 },
    pivot: { x: 0.25, y: 0.75 },
    transform: { x: -6, y: 9, rotation: -30, scale: 1.25 },
  };

  it('표식 자리와 역변환이 같은 상태 기준점을 되돌린다', () => {
    const next = { x: 0.8, y: 0.2 };
    const at = posePivotHandleLocalPoint(frame, next);
    const back = posePivotForHandleTarget(frame, at);
    expect(back.x).toBeCloseTo(next.x, 9);
    expect(back.y).toBeCloseTo(next.y, 9);
    const compensated = compensateTransformForPosePivotDelta(frame, next)!;
    expect(frame.axis.x + compensated.x).toBeCloseTo(at.x, 9);
    expect(frame.axis.y + compensated.y).toBeCloseTo(at.y, 9);
  });

  it('9점 프리셋은 상태 이미지 기준으로 스냅한다', () => {
    const center = posePivotHandleLocalPoint(frame, { x: 0.5, y: 0.5 });
    expect(
      snapPosePivotToPreset(frame, { x: center.x + 2, y: center.y - 2 }, 8),
    ).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe('snapPivotToPreset', () => {
  const frame = {
    box: { width: 200, height: 150 },
    rect: { width: 200, height: 150 },
    pivot: { x: 0.5, y: 0.5 },
    transform: { x: 0, y: 0, rotation: 0, scale: 1 },
  };

  it('반경 안 프리셋 중 가장 가까운 것을 고른다', () => {
    // 오른쪽 변 중앙 (200, 75)에서 3px 안쪽
    expect(snapPivotToPreset(frame, { x: 197, y: 75 }, 8)).toEqual({
      x: 1,
      y: 0.5,
    });
    expect(snapPivotToPreset(frame, { x: 150, y: 75 }, 8)).toBeNull();
  });

  it('배율이 작아 프리셋이 몰리면 반경을 이웃 간격 절반 아래로 눌러 옆 프리셋으로 튀지 않는다', () => {
    const small = {
      ...frame,
      transform: { x: 0, y: 0, rotation: 0, scale: 0.1 },
    };
    // 이웃 간격 7.5px → 반경 3.25px. 중앙에서 1px 위는 위 프리셋(6.5px)이 아니라 중앙
    expect(snapPivotToPreset(small, { x: 100, y: 74 }, 8)).toEqual({
      x: 0.5,
      y: 0.5,
    });
    // 반경 밖은 스냅 없음
    expect(snapPivotToPreset(small, { x: 100, y: 71 }, 8)).toBeNull();
  });
});
