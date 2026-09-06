import { describe, expect, it } from 'vitest';
import {
  pointsAabb,
  resolveRotationDrag,
  rotatePointAround,
  rotatedRectAabb,
  rotatedRectCorners,
  wrapDegrees,
} from './rotation';

const near = (value: number, expected: number) =>
  expect(value).toBeCloseTo(expected, 6);

describe('wrapDegrees', () => {
  it.each([
    [0, 0],
    [90, 90],
    [180, 180],
    [-180, 180],
    [181, -179],
    [-181, 179],
    [360, 0],
    [-360, 0],
    [540, 180],
    [359.5, -0.5],
  ])('%s → %s', (input, expected) => {
    expect(wrapDegrees(input)).toBeCloseTo(expected, 9);
  });
});

describe('resolveRotationDrag', () => {
  it('포인터 각도 차를 저장 각도에 더한다', () => {
    const quarter = Math.PI / 2;
    near(
      resolveRotationDrag({
        base: 10,
        startAngle: 0,
        angle: quarter,
        snap: false,
      }),
      100,
    );
  });

  it('±180 경계를 넘으면 최단 호로 접는다', () => {
    near(
      resolveRotationDrag({
        base: 170,
        startAngle: 0,
        angle: Math.PI / 6,
        snap: false,
      }),
      -160,
    );
  });

  it('스냅은 15° 격자로 반올림하고 경계에서도 범위 안이다', () => {
    near(
      resolveRotationDrag({
        base: 0,
        startAngle: 0,
        angle: (22 * Math.PI) / 180,
        snap: true,
      }),
      15,
    );
    near(
      resolveRotationDrag({
        base: 175,
        startAngle: 0,
        angle: (10 * Math.PI) / 180,
        snap: true,
      }),
      180,
    );
  });
});

describe('rotatePointAround', () => {
  it('90° 회전은 시계방향(y 아래 양수)이다', () => {
    const rotated = rotatePointAround({ x: 1, y: 0 }, { x: 0, y: 0 }, 90);
    near(rotated.x, 0);
    near(rotated.y, 1);
  });

  it('0°는 같은 좌표를 돌려준다', () => {
    expect(rotatePointAround({ x: 3, y: 4 }, { x: 1, y: 1 }, 0)).toEqual({
      x: 3,
      y: 4,
    });
  });
});

describe('rotatedRectAabb', () => {
  it('0°는 원래 상자다', () => {
    expect(rotatedRectAabb(10, 20, 100, 40, 0)).toEqual({
      minX: 10,
      minY: 20,
      maxX: 110,
      maxY: 60,
    });
  });

  it('90°는 폭과 높이가 바뀐 채 중심을 유지한다', () => {
    const aabb = rotatedRectAabb(0, 0, 100, 40, 90);
    near(aabb.minX, 30);
    near(aabb.maxX, 70);
    near(aabb.minY, -30);
    near(aabb.maxY, 70);
  });

  it('닫힌 식과 꼭짓점 열거가 같은 상자를 준다', () => {
    for (const deg of [-170, -45, 12.5, 33, 60, 135, 180]) {
      const closed = rotatedRectAabb(5, 7, 120, 48, deg);
      const enumerated = pointsAabb(rotatedRectCorners(5, 7, 120, 48, deg));
      near(closed.minX, enumerated.minX);
      near(closed.minY, enumerated.minY);
      near(closed.maxX, enumerated.maxX);
      near(closed.maxY, enumerated.maxY);
    }
  });

  it('회전해도 상자 중심은 그대로다', () => {
    const aabb = rotatedRectAabb(10, 10, 80, 20, 37);
    near((aabb.minX + aabb.maxX) / 2, 50);
    near((aabb.minY + aabb.maxY) / 2, 20);
  });
});
