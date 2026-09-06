import { describe, expect, it } from 'vitest';
import {
  computeTrackGeometry,
  groupSameFlowAngles,
  sameFlowStartShift,
  trackDirectionVector,
  trackRectFromOrigin,
  translateTrackGeometry,
} from './trackGeometry';

const near = (value: number, expected: number) =>
  expect(value).toBeCloseTo(expected, 6);

describe('computeTrackGeometry', () => {
  const key = { keyX: 100, keyY: 200, keyWidth: 60, keyHeight: 40 };

  it('회전 0은 기존 위로 자람 지오메트리와 같다', () => {
    const geometry = computeTrackGeometry({
      ...key,
      rotation: 0,
      trackHeight: 300,
    });
    expect(geometry.origin).toEqual({ x: 100, y: 200 });
    expect(geometry.direction).toEqual({ x: 0, y: -1 });
    expect(geometry.cross).toEqual({ x: 1, y: 0 });
    expect(geometry.crossSize).toBe(60);
    expect(geometry.rect).toEqual({
      minX: 100,
      minY: -100,
      maxX: 160,
      maxY: 200,
    });
  });

  it('노트 폭·정렬·오프셋은 로컬 프레임에서 적용된다', () => {
    const geometry = computeTrackGeometry({
      ...key,
      rotation: 0,
      trackHeight: 300,
      noteWidth: 20,
      noteAlignment: 'right',
      noteOffsetX: 5,
      noteOffsetY: -7,
    });
    expect(geometry.origin).toEqual({ x: 145, y: 193 });
    expect(geometry.crossSize).toBe(20);
  });

  it('회전 0에서만 자동 보정 히트라인을 쓴다', () => {
    const corrected = computeTrackGeometry({
      ...key,
      rotation: 0,
      trackHeight: 300,
      hitline: 150,
    });
    expect(corrected.origin.y).toBe(150);
    const rotated = computeTrackGeometry({
      ...key,
      rotation: 30,
      trackHeight: 300,
      hitline: 150,
    });
    const own = computeTrackGeometry({
      ...key,
      rotation: 30,
      trackHeight: 300,
    });
    expect(rotated.origin).toEqual(own.origin);
  });

  it('90° 회전은 키 오른쪽 변에서 오른쪽으로 흐른다', () => {
    const geometry = computeTrackGeometry({
      keyX: 0,
      keyY: 0,
      keyWidth: 100,
      keyHeight: 40,
      rotation: 90,
      trackHeight: 200,
    });
    near(geometry.origin.x, 70);
    near(geometry.origin.y, -30);
    near(geometry.direction.x, 1);
    near(geometry.direction.y, 0);
    near(geometry.cross.x, 0);
    near(geometry.cross.y, 1);
    near(geometry.rect.minX, 70);
    near(geometry.rect.maxX, 270);
    near(geometry.rect.minY, -30);
    near(geometry.rect.maxY, 70);
  });

  it('회전해도 히트라인 코너는 키 중심에서 같은 거리다', () => {
    for (const rotation of [-135, -45, 17, 60, 180]) {
      const geometry = computeTrackGeometry({
        ...key,
        rotation,
        trackHeight: 120,
      });
      const cx = key.keyX + key.keyWidth / 2;
      const cy = key.keyY + key.keyHeight / 2;
      near(
        Math.hypot(geometry.origin.x - cx, geometry.origin.y - cy),
        Math.hypot(key.keyWidth / 2, key.keyHeight / 2),
      );
      near(Math.hypot(geometry.direction.x, geometry.direction.y), 1);
    }
  });

  it('rect는 네 꼭짓점의 AABB이고 trackRectFromOrigin과 같다', () => {
    const geometry = computeTrackGeometry({
      ...key,
      rotation: 37,
      trackHeight: 150,
      noteWidth: 24,
    });
    const rebuilt = trackRectFromOrigin(
      geometry.origin,
      geometry.direction,
      150,
      24,
    );
    near(rebuilt.minX, geometry.rect.minX);
    near(rebuilt.minY, geometry.rect.minY);
    near(rebuilt.maxX, geometry.rect.maxX);
    near(rebuilt.maxY, geometry.rect.maxY);
  });
});

describe('trackDirectionVector', () => {
  it.each([
    [0, 0, -1],
    [90, 1, 0],
    [180, 0, 1],
    [-90, -1, 0],
  ])('%s° → (%s, %s)', (rotation, x, y) => {
    const vector = trackDirectionVector(rotation);
    near(vector.x, x);
    near(vector.y, y);
  });
});

describe('sameFlowStartShift / translateTrackGeometry', () => {
  const geometryOf = (input: {
    keyX: number;
    keyY: number;
    keyWidth: number;
    keyHeight: number;
    rotation: number;
  }) => computeTrackGeometry({ ...input, trackHeight: 200 });

  it('회전 0에서 같은 방향 키들은 가장 위 상변에 맞춘다', () => {
    const upper = geometryOf({
      keyX: 0,
      keyY: 50,
      keyWidth: 60,
      keyHeight: 60,
      rotation: 0,
    });
    const lower = geometryOf({
      keyX: 100,
      keyY: 120,
      keyWidth: 60,
      keyHeight: 60,
      rotation: 0,
    });
    const shift = sameFlowStartShift(lower.origin, lower.direction, [
      upper.origin,
    ]);
    near(shift, 70);
    near(translateTrackGeometry(lower, shift).origin.y, 50);
    expect(
      sameFlowStartShift(upper.origin, upper.direction, [lower.origin]),
    ).toBe(0);
  });

  it('혼자인 키는 자기 상변에서 시작한다', () => {
    const key = geometryOf({
      keyX: 100,
      keyY: 100,
      keyWidth: 60,
      keyHeight: 60,
      rotation: -51.4,
    });
    expect(sameFlowStartShift(key.origin, key.direction, [])).toBe(0);
  });

  it('같은 각도의 큰 키와 작은 키는 큰 키의 상변에 공통선을 둔다', () => {
    const tall = geometryOf({
      keyX: 100,
      keyY: 100,
      keyWidth: 20,
      keyHeight: 300,
      rotation: 90,
    });
    const short = geometryOf({
      keyX: 100,
      keyY: 100,
      keyWidth: 20,
      keyHeight: 20,
      rotation: 90,
    });
    near(tall.origin.x, 260);
    const tallShift = sameFlowStartShift(tall.origin, tall.direction, [
      short.origin,
    ]);
    const shortShift = sameFlowStartShift(short.origin, short.direction, [
      tall.origin,
    ]);
    expect(tallShift).toBe(0);
    near(
      translateTrackGeometry(short, shortShift).origin.x,
      translateTrackGeometry(tall, tallShift).origin.x,
    );
  });

  it('이동 0은 같은 객체를 돌려준다', () => {
    const geometry = geometryOf({
      keyX: 0,
      keyY: 0,
      keyWidth: 60,
      keyHeight: 60,
      rotation: 30,
    });
    expect(translateTrackGeometry(geometry, 0)).toBe(geometry);
  });
});

describe('groupSameFlowAngles', () => {
  it('오차 안의 각도를 한 묶음으로, 밖은 따로 묶는다', () => {
    expect(groupSameFlowAngles([-51.4, 90, -51.1, 90.3, -52.2])).toEqual([
      [4],
      [0, 2],
      [1, 3],
    ]);
  });

  it('정확히 같은 각도는 순서대로 묶인다', () => {
    expect(groupSameFlowAngles([45, 45, 45])).toEqual([[0, 1, 2]]);
  });

  it('±180 경계를 지난 같은 방향도 한 묶음으로 판정한다', () => {
    expect(groupSameFlowAngles([-180, 180])).toHaveLength(1);
    const groups = groupSameFlowAngles([-179.8, 179.9, 90]);
    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.includes(0))).toContain(1);
    expect(groups.find((group) => group.includes(2))).toEqual([2]);
  });

  it('경계를 넘는 묶음도 전체 각도 폭이 허용 오차를 넘지 않는다', () => {
    const rotations = [-180, -179.6, 179.7];
    const groups = groupSameFlowAngles(rotations);
    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.includes(0))).toContain(2);
    expect(groups.find((group) => group.includes(1))).toEqual([1]);
  });

  it('빈 입력은 빈 배열이다', () => {
    expect(groupSameFlowAngles([])).toEqual([]);
  });
});
