import { describe, expect, it } from 'vitest';
import {
  accumulatedTransformLinear,
  cornersMatchRect,
  hitRectsFromMeasurements,
  HIT_RECTS_TOTAL_MAX,
  HIT_STRIPS_PER_REGION_MAX,
  HIT_STRIPS_TOTAL_BUDGET,
  IDENTITY_LINEAR,
  isIdentityLinear,
  multiplyLinear,
  parseTransformLinear,
  polygonHitStrips,
  stripBudgetPerRegion,
  transformedBoxCorners,
  type HitPoint,
  type Linear2D,
} from './hitRegionShape';

const near = (value: number, expected: number, digits = 6) =>
  expect(value).toBeCloseTo(expected, digits);

const rotationMatrix = (deg: number) => {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return `matrix(${cos}, ${sin}, ${-sin}, ${cos}, 100, 50)`;
};

describe('parseTransformLinear', () => {
  it('none·이동만 있는 변환은 항등이다', () => {
    expect(parseTransformLinear('none')).toEqual(IDENTITY_LINEAR);
    expect(parseTransformLinear(undefined)).toEqual(IDENTITY_LINEAR);
    expect(
      isIdentityLinear(parseTransformLinear('matrix(1, 0, 0, 1, 120, 30)')!),
    ).toBe(true);
    expect(
      isIdentityLinear(
        parseTransformLinear(
          'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 40, 20, 0, 1)',
        )!,
      ),
    ).toBe(true);
  });

  it('회전 행렬의 선형부를 읽는다', () => {
    const linear = parseTransformLinear(rotationMatrix(90));
    expect(linear).not.toBeNull();
    near(linear!.a, 0);
    near(linear!.b, 1);
    near(linear!.c, -1);
    near(linear!.d, 0);
  });

  it('평면 밖 성분이 있는 matrix3d는 복원 불가(null)다', () => {
    expect(
      parseTransformLinear(
        'matrix3d(1, 0, 0, 0, 0, 0.7, 0.7, 0, 0, -0.7, 0.7, 0, 0, 0, 0, 1)',
      ),
    ).toBeNull();
  });

  it('형식이 아니거나 비유한값이면 null이다', () => {
    expect(parseTransformLinear('rotate(45deg)')).toBeNull();
    expect(parseTransformLinear('matrix(1, 0, 0, NaN, 0, 0)')).toBeNull();
  });
});

describe('accumulatedTransformLinear', () => {
  interface FakeElement {
    parentElement: FakeElement | null;
    transform: string;
    rotate?: string;
    scale?: string;
    zoom?: string;
    offsetPath?: string;
  }
  const chain = (
    ...styles: Array<{
      transform: string;
      rotate?: string;
      scale?: string;
      zoom?: string;
      offsetPath?: string;
    }>
  ) => {
    // styles[0]이 루트, 마지막이 대상 노드
    let parent: FakeElement | null = null;
    let node: FakeElement | null = null;
    for (const style of styles) {
      node = { parentElement: parent, ...style };
      parent = node;
    }
    return node!;
  };
  const read = (element: Element) => {
    const fake = element as unknown as FakeElement;
    return {
      transform: fake.transform,
      rotate: fake.rotate,
      scale: fake.scale,
      offsetPath: fake.offsetPath,
      zoom: fake.zoom,
    };
  };

  it('조상 배율과 자기 회전을 누적한다', () => {
    const node = chain(
      { transform: 'none' },
      { transform: 'matrix(2, 0, 0, 2, 0, 0)' },
      { transform: rotationMatrix(90) },
    );
    const linear = accumulatedTransformLinear(
      node as unknown as Element,
      read,
    )!;
    // scale(2) · rotate(90): (1,0) → (0,2)
    near(linear.a, 0);
    near(linear.b, 2);
    near(linear.c, -2);
    near(linear.d, 0);
  });

  it('서로 상쇄되는 부모·자식 회전은 항등이 된다', () => {
    const node = chain(
      { transform: rotationMatrix(30) },
      { transform: rotationMatrix(-30) },
    );
    expect(
      isIdentityLinear(
        accumulatedTransformLinear(node as unknown as Element, read)!,
      ),
    ).toBe(true);
  });

  it('개별 변환 속성 rotate·scale이 걸린 요소는 복원하지 않고 AABB로 둔다', () => {
    for (const style of [
      { transform: 'none', rotate: '90deg' },
      { transform: 'none', scale: '2' },
      { transform: rotationMatrix(30), rotate: '0 0 -1 90deg' },
    ]) {
      expect(
        accumulatedTransformLinear(chain(style) as unknown as Element, read),
      ).toBeNull();
    }
    const ancestorOnly = chain(
      { transform: rotationMatrix(30) },
      { transform: 'none', rotate: 'none', scale: 'none' },
    );
    expect(
      accumulatedTransformLinear(ancestorOnly as unknown as Element, read),
    ).not.toBeNull();
  });

  it('AABB가 같아도 모션 경로가 꼭짓점 방향을 바꾸면 조상부터 폴백한다', () => {
    const center = { x: 200, y: 200 };
    const restored = transformedBoxCorners(
      center,
      100,
      60,
      parseTransformLinear(rotationMatrix(30))!,
    );
    const actual = transformedBoxCorners(
      center,
      100,
      60,
      parseTransformLinear(rotationMatrix(-30))!,
    );
    const xs = actual.map(({ x }) => x);
    const ys = actual.map(({ y }) => y);
    const rect = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
    expect(cornersMatchRect(restored, rect)).toBe(true);
    const wrongStrips = polygonHitStrips(restored);
    expect(
      wrongStrips.some(
        (strip) =>
          actual[1].x >= strip.x &&
          actual[1].x <= strip.x + strip.width &&
          actual[1].y >= strip.y &&
          actual[1].y <= strip.y + strip.height,
      ),
    ).toBe(false);
    const node = chain(
      { transform: 'none', offsetPath: 'path("M0,0 L100,0")' },
      { transform: rotationMatrix(30) },
    );
    expect(
      accumulatedTransformLinear(node as unknown as Element, read),
    ).toBeNull();
    expect(hitRectsFromMeasurements([{ aabb: rect, corners: null }])).toEqual([
      rect,
    ]);
  });

  it('3D 조상이나 CSS zoom이 있으면 복원 불가다', () => {
    const perspective = chain(
      {
        transform:
          'matrix3d(1, 0, 0, 0, 0, 0.7, 0.7, 0, 0, -0.7, 0.7, 0, 0, 0, 0, 1)',
      },
      { transform: rotationMatrix(45) },
    );
    expect(
      accumulatedTransformLinear(perspective as unknown as Element, read),
    ).toBeNull();
    const zoomed = chain(
      { transform: 'none', zoom: '2' },
      { transform: rotationMatrix(45) },
    );
    expect(
      accumulatedTransformLinear(zoomed as unknown as Element, read),
    ).toBeNull();
  });
});

describe('multiplyLinear', () => {
  it('outer · inner 순서로 곱한다', () => {
    const scale: Linear2D = { a: 2, b: 0, c: 0, d: 3 };
    const shear: Linear2D = { a: 1, b: 0, c: 1, d: 1 };
    expect(multiplyLinear(scale, shear)).toEqual({ a: 2, b: 0, c: 2, d: 3 });
  });
});

describe('transformedBoxCorners', () => {
  it('90° 회전 상자의 꼭짓점을 중심 기준으로 복원한다', () => {
    const linear = parseTransformLinear(rotationMatrix(90))!;
    const corners = transformedBoxCorners({ x: 100, y: 100 }, 100, 40, linear);
    near(corners[0].x, 120);
    near(corners[0].y, 50);
    near(corners[2].x, 80);
    near(corners[2].y, 150);
  });
});

describe('polygonHitStrips', () => {
  const square = (size: number, deg: number): HitPoint[] =>
    transformedBoxCorners(
      { x: 200, y: 200 },
      size,
      size,
      parseTransformLinear(rotationMatrix(deg))!,
    );

  it('축 정렬 사각형(0°·90°)은 띠 하나다', () => {
    expect(polygonHitStrips(square(60, 0))).toEqual([
      { x: 170, y: 170, width: 60, height: 60 },
    ]);
    const rotated = polygonHitStrips(square(60, 90));
    expect(rotated).toHaveLength(1);
    near(rotated[0].x, 170);
    near(rotated[0].width, 60);
  });

  it('45° 마름모는 띠들이 다각형을 덮되 띠 안 최대 폭을 넘지 않는다', () => {
    const strips = polygonHitStrips(square(60, 45), {
      stripHeight: 6,
      maxStrips: 32,
    });
    const half = (60 * Math.SQRT2) / 2;
    expect(strips.length).toBeGreaterThan(8);
    for (const strip of strips) {
      const yMid = strip.y + strip.height / 2;
      const trueHalfWidth = half - Math.abs(yMid - 200);
      expect(strip.x).toBeLessThanOrEqual(200 - trueHalfWidth + 1e-6);
      expect(strip.x + strip.width).toBeGreaterThanOrEqual(
        200 + trueHalfWidth - 1e-6,
      );
      const nearest = Math.min(Math.max(200, strip.y), strip.y + strip.height);
      const maxHalfWidth = half - Math.abs(nearest - 200);
      expect(strip.width).toBeLessThanOrEqual(maxHalfWidth * 2 + 1e-6);
    }
    expect(strips[0].width).toBeLessThan(
      strips[Math.floor(strips.length / 2)].width,
    );
  });

  it('꼭짓점이 모자라거나 비유한값이면 빈 배열이다', () => {
    expect(
      polygonHitStrips([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toEqual([]);
    expect(
      polygonHitStrips([
        { x: 0, y: 0 },
        { x: Number.NaN, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ]),
    ).toEqual([]);
  });

  it('띠 개수는 상한을 넘지 않는다', () => {
    expect(
      polygonHitStrips(square(600, 30), { stripHeight: 6, maxStrips: 16 }),
    ).toHaveLength(16);
  });
});

describe('stripBudgetPerRegion / hitRectsFromMeasurements', () => {
  const diagonal = 80 * Math.SQRT2;
  const rotatedBox = (offset: number) => ({
    aabb: { x: offset, y: 0, width: diagonal, height: diagonal },
    corners: transformedBoxCorners(
      { x: offset + diagonal / 2, y: diagonal / 2 },
      80,
      80,
      parseTransformLinear(rotationMatrix(45))!,
    ),
  });

  it('회전 요소가 적으면 요소당 상한까지 쓴다', () => {
    expect(stripBudgetPerRegion(8, 0)).toBe(HIT_STRIPS_PER_REGION_MAX);
  });

  it('회전 요소가 많으면 소프트 예산을 나눠 갖되 최소 1개는 남긴다', () => {
    expect(stripBudgetPerRegion(100, 0)).toBe(
      Math.floor(HIT_STRIPS_TOTAL_BUDGET / 100),
    );
    expect(stripBudgetPerRegion(5000, 0)).toBe(1);
  });

  it('257개 회전 요소도 백엔드 상한 안에서 전부 살아남는다', () => {
    const boxes = Array.from({ length: 257 }, (_, index) =>
      rotatedBox(index * 200),
    );
    const rects = hitRectsFromMeasurements(boxes);
    expect(rects.length).toBeLessThanOrEqual(HIT_RECTS_TOTAL_MAX);
    // 요소마다 최소 한 띠 - 어떤 키도 히트 영역을 잃지 않는다
    const covered = boxes.filter((box) =>
      rects.some(
        (rect) =>
          rect.x >= box.aabb.x - 1e-6 &&
          rect.x + rect.width <= box.aabb.x + box.aabb.width + 1e-6,
      ),
    );
    expect(covered).toHaveLength(257);
  });

  it('비회전 요소는 AABB 그대로, 회전 요소는 띠로 섞여 나온다', () => {
    const plain = {
      aabb: { x: 500, y: 500, width: 60, height: 60 },
      corners: null,
    };
    const rects = hitRectsFromMeasurements([plain, rotatedBox(0)]);
    expect(rects[0]).toEqual(plain.aabb);
    expect(rects.length).toBeGreaterThan(2);
  });
});
