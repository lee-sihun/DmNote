// 오버레이 히트 창은 사각형 목록만 받는다(Windows 영역 합집합, macOS 키별 패널).
// 회전·배율이 걸린 요소는 화면 꼭짓점을 복원한 뒤 얇은 가로 띠로 쪼개 같은 계약에 싣는다.
// 알파 기반 창 모양처럼 플랫폼이 보장하지 않는 기제에 기대지 않고, 오차는 띠 높이 이내다

import { pointsAabb } from '@utils/element/rotation';

export interface HitPoint {
  x: number;
  y: number;
}

export interface HitRegionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 2D 아핀 선형부. x' = a·x + c·y, y' = b·x + d·y (CSS matrix 표기)
export interface Linear2D {
  a: number;
  b: number;
  c: number;
  d: number;
}

export const IDENTITY_LINEAR: Linear2D = Object.freeze({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
});

const IDENTITY_EPSILON = 1e-6;

export const isIdentityLinear = (linear: Linear2D): boolean =>
  Math.abs(linear.a - 1) < IDENTITY_EPSILON &&
  Math.abs(linear.b) < IDENTITY_EPSILON &&
  Math.abs(linear.c) < IDENTITY_EPSILON &&
  Math.abs(linear.d - 1) < IDENTITY_EPSILON;

// 조상(outer)을 자식(inner) 뒤에 적용: screen = outer · inner
export const multiplyLinear = (outer: Linear2D, inner: Linear2D): Linear2D => ({
  a: outer.a * inner.a + outer.c * inner.b,
  b: outer.b * inner.a + outer.d * inner.b,
  c: outer.a * inner.c + outer.c * inner.d,
  d: outer.b * inner.c + outer.d * inner.d,
});

// getComputedStyle(node).transform 문자열에서 선형부만 읽는다.
// none·이동만은 항등, 평면 밖 성분(3D·원근)이 있으면 null(복원 불가)
export const parseTransformLinear = (
  transform: string | null | undefined,
): Linear2D | null => {
  if (!transform || transform === 'none') return IDENTITY_LINEAR;
  const match = /^(matrix3d|matrix)\(([^)]*)\)$/.exec(transform.trim());
  if (!match) return null;
  const values = match[2].split(',').map((part) => Number(part.trim()));
  if (values.some((value) => !Number.isFinite(value))) return null;
  if (match[1] === 'matrix') {
    if (values.length !== 6) return null;
    return { a: values[0], b: values[1], c: values[2], d: values[3] };
  }
  if (values.length !== 16) return null;
  const [
    m11,
    m12,
    m13,
    m14,
    m21,
    m22,
    m23,
    m24,
    m31,
    m32,
    m33,
    m34,
    ,
    ,
    m43,
    m44,
  ] = values;
  const flat =
    [m13, m14, m23, m24, m31, m32, m34, m43].every(
      (value) => Math.abs(value) < IDENTITY_EPSILON,
    ) &&
    Math.abs(m33 - 1) < IDENTITY_EPSILON &&
    Math.abs(m44 - 1) < IDENTITY_EPSILON;
  return flat ? { a: m11, b: m12, c: m21, d: m22 } : null;
};

export interface TransformStyleReader {
  (element: Element): {
    transform: string;
    rotate?: string;
    scale?: string;
    zoom?: string;
    offsetPath?: string;
  };
}

const isTransformPropertySet = (value: string | undefined): boolean =>
  !!value && value !== 'none';

// 요소 하나의 변환 선형부. 앱은 transform만 쓰므로 개별 속성 rotate·scale이 걸린
// 요소(사용자 CSS)는 복원하지 않고 AABB로 둔다 - 파서를 늘리는 대신 보수적 폴백
export const elementTransformLinear = (style: {
  transform: string;
  rotate?: string;
  scale?: string;
  offsetPath?: string;
}): Linear2D | null => {
  if (isTransformPropertySet(style.rotate)) return null;
  if (isTransformPropertySet(style.scale)) return null;
  // 모션 경로는 같은 AABB 안에서도 다른 각도의 꼭짓점을 만들 수 있다
  if (isTransformPropertySet(style.offsetPath)) return null;
  return parseTransformLinear(style.transform);
};

// 노드에서 문서 루트까지 변환 선형부를 누적한다. 커스텀 CSS가 조상 transform에
// scale·rotate를 걸어도 화면 꼭짓점이 맞는다. 3D·원근이나 CSS zoom처럼 선형부만으로
// 복원할 수 없는 조합은 null - 호출부가 AABB로 폴백한다
export const accumulatedTransformLinear = (
  node: Element,
  readStyle: TransformStyleReader,
): Linear2D | null => {
  let linear = IDENTITY_LINEAR;
  let current: Element | null = node;
  while (current) {
    const style = readStyle(current);
    if (
      style.zoom &&
      style.zoom !== '1' &&
      style.zoom !== 'normal' &&
      style.zoom !== ''
    ) {
      return null;
    }
    const own = elementTransformLinear(style);
    if (!own) return null;
    if (!isIdentityLinear(own)) linear = multiplyLinear(own, linear);
    current = current.parentElement;
  }
  return linear;
};

// 변환 전 상자 크기와 변환 후 AABB 중심으로 화면 꼭짓점을 복원한다.
// 2D 아핀이면 상자 중심은 변환 후 AABB 중심과 같아 transform-origin과 무관하다.
// 좌상·우상·우하·좌하 순
export const transformedBoxCorners = (
  center: HitPoint,
  width: number,
  height: number,
  linear: Linear2D,
): [HitPoint, HitPoint, HitPoint, HitPoint] => {
  const hw = width / 2;
  const hh = height / 2;
  const map = (x: number, y: number): HitPoint => ({
    x: center.x + linear.a * x + linear.c * y,
    y: center.y + linear.b * x + linear.d * y,
  });
  return [map(-hw, -hh), map(hw, -hh), map(hw, hh), map(-hw, hh)];
};

// 복원한 꼭짓점의 AABB가 실측 AABB와 같아야 2D 아핀 복원이 맞다. 원근·z 이동처럼
// 선형부로 읽지 못한 변환은 여기서 걸러 호출부가 AABB로 폴백한다
export const HIT_CORNER_MATCH_TOLERANCE_PX = 0.5;

export const cornersMatchRect = (
  corners: readonly HitPoint[],
  rect: HitRegionRect,
  tolerance = HIT_CORNER_MATCH_TOLERANCE_PX,
): boolean => {
  const box = polygonAabb(corners);
  return (
    Math.abs(box.x - rect.x) <= tolerance &&
    Math.abs(box.y - rect.y) <= tolerance &&
    Math.abs(box.x + box.width - (rect.x + rect.width)) <= tolerance &&
    Math.abs(box.y + box.height - (rect.y + rect.height)) <= tolerance
  );
};

export const HIT_STRIP_HEIGHT_PX = 6;
export const HIT_STRIPS_PER_REGION_MAX = 32;
// 백엔드 validate_hit_rects의 MAX_HIT_RECTS(4096)와 같은 값 - 넘기면 갱신 전체가 거부된다
export const HIT_RECTS_TOTAL_MAX = 4096;
// 띠 합계의 소프트 예산 - macOS는 띠마다 패널 창이 생기므로 회전 요소가 많으면 세분도를 낮춘다
export const HIT_STRIPS_TOTAL_BUDGET = 512;

// 회전 요소 하나가 쓸 수 있는 띠 개수. 요소마다 최소 1개는 보장한다
export const stripBudgetPerRegion = (
  rotatedCount: number,
  plainCount: number,
): number => {
  if (rotatedCount <= 0) return 0;
  const hardShare = Math.floor(
    (HIT_RECTS_TOTAL_MAX - plainCount) / rotatedCount,
  );
  const softShare = Math.floor(HIT_STRIPS_TOTAL_BUDGET / rotatedCount);
  return Math.max(1, Math.min(HIT_STRIPS_PER_REGION_MAX, hardShare, softShare));
};

interface StripOptions {
  stripHeight?: number;
  maxStrips?: number;
}

const AXIS_EPSILON = 1e-3;

const polygonAabb = (points: readonly HitPoint[]): HitRegionRect => {
  const { minX, minY, maxX, maxY } = pointsAabb(points);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

// 모든 변이 가로 또는 세로면 AABB 하나가 곧 다각형이다 (0°·90° 회전, 배율)
const isAxisAligned = (points: readonly HitPoint[]): boolean =>
  points.every((point, index) => {
    const next = points[(index + 1) % points.length];
    return (
      Math.abs(point.x - next.x) < AXIS_EPSILON ||
      Math.abs(point.y - next.y) < AXIS_EPSILON
    );
  });

// 볼록 다각형을 가로 띠 사각형으로 근사한다. 띠마다 다각형과 띠의 교집합 x 범위를
// 잡으므로 결과는 다각형을 덮되 띠 높이만큼만 바깥으로 삐져나온다
export const polygonHitStrips = (
  points: readonly HitPoint[],
  {
    stripHeight = HIT_STRIP_HEIGHT_PX,
    maxStrips = HIT_STRIPS_PER_REGION_MAX,
  }: StripOptions = {},
): HitRegionRect[] => {
  if (points.length < 3) return [];
  if (
    points.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    )
  ) {
    return [];
  }
  const aabb = polygonAabb(points);
  if (aabb.width <= 0 || aabb.height <= 0) return [];
  if (isAxisAligned(points)) return [aabb];

  const count = Math.min(
    Math.max(1, Math.ceil(aabb.height / stripHeight)),
    Math.max(1, maxStrips),
  );
  const bandHeight = aabb.height / count;
  const strips: HitRegionRect[] = [];
  for (let index = 0; index < count; index += 1) {
    const top = aabb.y + bandHeight * index;
    const bottom =
      index === count - 1 ? aabb.y + aabb.height : top + bandHeight;
    let minX = Infinity;
    let maxX = -Infinity;
    const take = (x: number) => {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    };
    for (let edge = 0; edge < points.length; edge += 1) {
      const p = points[edge];
      const q = points[(edge + 1) % points.length];
      if (p.y >= top && p.y <= bottom) take(p.x);
      const dy = q.y - p.y;
      if (Math.abs(dy) < IDENTITY_EPSILON) continue;
      for (const level of [top, bottom]) {
        const t = (level - p.y) / dy;
        if (t >= 0 && t <= 1) take(p.x + (q.x - p.x) * t);
      }
    }
    if (!Number.isFinite(minX) || maxX - minX <= 0) continue;
    strips.push({ x: minX, y: top, width: maxX - minX, height: bottom - top });
  }
  return strips;
};

export interface MeasuredHitBox {
  aabb: HitRegionRect;
  // 회전·배율이 걸린 요소만 채운다. 없으면 AABB 그대로
  corners: readonly HitPoint[] | null;
}

// 측정 결과 목록을 히트 사각형 목록으로. 회전 요소 수에 따라 띠 예산을 나눈다
export const hitRectsFromMeasurements = (
  boxes: readonly MeasuredHitBox[],
): HitRegionRect[] => {
  const rotatedCount = boxes.filter((box) => box.corners !== null).length;
  const maxStrips = stripBudgetPerRegion(
    rotatedCount,
    boxes.length - rotatedCount,
  );
  const rects: HitRegionRect[] = [];
  for (const box of boxes) {
    if (box.corners) {
      const strips = polygonHitStrips(box.corners, { maxStrips });
      if (strips.length > 0) {
        rects.push(...strips);
        continue;
      }
    }
    rects.push(box.aabb);
  }
  return rects;
};
