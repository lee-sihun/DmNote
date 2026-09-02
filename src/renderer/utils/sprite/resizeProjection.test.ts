import { describe, expect, it } from 'vitest';

import {
  isSameSpriteBounds,
  projectSpriteResize,
  spriteResizeRatio,
} from './resizeProjection';

const basePosition = () => ({
  id: 'sprite-1',
  dx: 10,
  dy: 20,
  width: 200,
  height: 100,
  imageRect: { x: 40, y: -10, width: 160, height: 80 },
  pivot: { x: 0.5, y: 0.5 },
  idleTransform: { x: 12, y: -6, rotation: 15, scale: 1.5 },
  poses: [
    {
      poseId: 'pose-1',
      transform: { x: -30, y: 44, rotation: -90, scale: 0.5 },
      contactPoint: { x: 0.5, y: 1 },
      imagePivot: null,
      imageOverrideMetrics: null,
    },
  ],
  transitionMs: 90,
});

describe('projectSpriteResize', () => {
  it('bounds 교체와 함께 imageRect·transform 오프셋을 축별 배율로 스케일한다', () => {
    const next = projectSpriteResize(basePosition(), {
      dx: 5,
      dy: 8,
      width: 400,
      height: 50,
    });
    expect(next.dx).toBe(5);
    expect(next.dy).toBe(8);
    expect(next.width).toBe(400);
    expect(next.height).toBe(50);
    // sx=2, sy=0.5
    expect(next.imageRect).toEqual({ x: 80, y: -5, width: 320, height: 40 });
    expect(next.idleTransform).toEqual({
      x: 24,
      y: -3,
      rotation: 15,
      scale: 1.5,
    });
    expect(next.poses[0].transform).toEqual({
      x: -60,
      y: 22,
      rotation: -90,
      scale: 0.5,
    });
  });

  it('rotation·scale·pivot·contactPoint와 나머지 필드는 불변이다', () => {
    const position = basePosition();
    const next = projectSpriteResize(position, {
      dx: 0,
      dy: 0,
      width: 100,
      height: 50,
    });
    expect(next.pivot).toEqual(position.pivot);
    expect(next.poses[0].contactPoint).toEqual(position.poses[0].contactPoint);
    expect(next.poses[0].poseId).toBe('pose-1');
    expect(next.id).toBe(position.id);
    expect(next.transitionMs).toBe(90);
  });

  it('동일 bounds면 원본 참조를 그대로 반환한다 (noChange)', () => {
    const position = basePosition();
    const next = projectSpriteResize(position, {
      dx: 10,
      dy: 20,
      width: 200,
      height: 100,
    });
    expect(next).toBe(position);
  });

  it('순수 이동(치수 불변)은 콘텐츠를 건드리지 않는다', () => {
    const position = basePosition();
    const next = projectSpriteResize(position, {
      dx: 300,
      dy: -40,
      width: 200,
      height: 100,
    });
    expect(next.imageRect).toEqual(position.imageRect);
    expect(next.idleTransform).toEqual(position.idleTransform);
    expect(next.poses[0].transform).toEqual(position.poses[0].transform);
  });

  it('배율 1은 클램프 없는 passthrough - 하한 미만 치수·범위 밖 오프셋 보존', () => {
    const position = {
      ...basePosition(),
      imageRect: { x: 40, y: -10, width: 1e-7, height: 80 },
      idleTransform: { x: 5000, y: -6, rotation: 0, scale: 1 },
    };
    const next = projectSpriteResize(position, {
      dx: 300,
      dy: -40,
      width: 200,
      height: 100,
    });
    expect(next.imageRect.width).toBe(1e-7);
    expect(next.idleTransform.x).toBe(5000);
  });

  it('스케일 결과는 offset·imageRect 한계에 클램프된다', () => {
    const position = {
      ...basePosition(),
      idleTransform: { x: 1500, y: -1500, rotation: 0, scale: 1 },
    };
    const next = projectSpriteResize(position, {
      dx: 0,
      dy: 0,
      width: 2000,
      height: 1000,
    });
    // sx=sy=10: 15000 → 2000, -15000 → -2000
    expect(next.idleTransform.x).toBe(2000);
    expect(next.idleTransform.y).toBe(-2000);
  });

  it('무효 prev 치수는 해당 축을 무배율로 방어한다', () => {
    const position = { ...basePosition(), width: 0 };
    const next = projectSpriteResize(position, {
      dx: 10,
      dy: 20,
      width: 300,
      height: 100,
    });
    expect(next.width).toBe(300);
    expect(next.imageRect.x).toBe(40);
    expect(next.imageRect.width).toBe(160);
  });
});

describe('spriteResizeRatio', () => {
  it('언더플로 0은 허용하고 비유한은 1로 방어한다', () => {
    expect(spriteResizeRatio(4, 5e-324)).toBe(0);
    expect(spriteResizeRatio(5e-324, 32768)).toBe(1);
    expect(spriteResizeRatio(Number.NaN, 100)).toBe(1);
    expect(spriteResizeRatio(100, Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('isSameSpriteBounds', () => {
  it('네 값 전부 일치할 때만 참이다', () => {
    const position = basePosition();
    expect(
      isSameSpriteBounds(position, { dx: 10, dy: 20, width: 200, height: 100 }),
    ).toBe(true);
    expect(
      isSameSpriteBounds(position, { dx: 10, dy: 20, width: 200, height: 101 }),
    ).toBe(false);
  });
});
