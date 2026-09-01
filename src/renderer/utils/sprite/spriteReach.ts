import type {
  ReactiveSpritePosition,
  SpriteTransform,
} from '@src/types/key/sprites';

import { isRenderableImageRef } from '@utils/core/imageSource';

import { selectableSpritePoses } from './poseResolver';

import { anchorPx } from './spriteGeometry';

// 스프라이트 이미지 도달 범위 계산.
// 저장된 모든 상태(idle + pose)의 imageRect에 pivot 기준 scale·rotation·offset을
// 적용한 AABB의 합집합이다. 창 바운즈가 이 값을 포함해야 이미지가 활동 영역을
// 넘어도 네이티브 창 가장자리에서 잘리지 않는다.
// 반환 좌표계는 활동 영역(dx/dy) 로컬 기준

export interface SpriteAabb {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type SpriteReachGeometry = Pick<
  ReactiveSpritePosition,
  | 'baseImage'
  | 'imageRect'
  | 'pivot'
  | 'idleTransform'
  | 'poses'
  | 'transitionEasing'
>;

const CSS_NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?`;

const CUBIC_BEZIER_RE = new RegExp(
  String.raw`^cubic-bezier\(\s*(${CSS_NUMBER})\s*,\s*(${CSS_NUMBER})\s*,\s*(${CSS_NUMBER})\s*,\s*(${CSS_NUMBER})\s*\)$`,
  'i',
);

const LINEAR_FN_RE = /^linear\((.+)\)$/is;

// 진행률이 0~1을 벗어나지 않는 표준 키워드
const NON_OVERSHOOT_KEYWORDS = new Set([
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step-start',
  'step-end',
]);

// y(t) = 3(1-t)²t·y1 + 3(1-t)t²·y2 + t³ 의 [0, 1] 구간 최소·최대.
// 도함수(2차식) 근과 양 끝점만 후보로 보면 정확값이 나온다
const cubicBezierYRange = (
  y1: number,
  y2: number,
): { min: number; max: number } => {
  const evaluate = (t: number): number => {
    const u = 1 - t;
    return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t;
  };
  // y(t)는 제어점 y {0, y1, y2, 1}의 볼록 결합이라 항상 이 껍질 안에 있다.
  // min·max뿐이라 overflow가 없어, 해석적 계산을 믿을 수 없을 때 쓰는 보수적 상한
  const hull = { min: Math.min(0, y1, y2), max: Math.max(1, y1, y2) };
  // 비유한 y는 끝점 evaluate도 0 * Infinity = NaN이라 계산 전에 껍질로 나간다
  if (!Number.isFinite(y1) || !Number.isFinite(y2)) return hull;

  // dy/dt / 3 = a·t² + b·t + c
  const a = 3 * y1 - 3 * y2 + 1;
  const b = 2 * y2 - 4 * y1;
  const c = y1;
  // y가 유한해도 중간 연산이 넘칠 수 있다. 넘친 값으로 판별식을 구하면 NaN이 되고
  // NaN >= 0이 false라 극점을 통째로 놓쳐 범위를 {0, 1}로 오판한다
  if (!Number.isFinite(a) || !Number.isFinite(b)) return hull;

  const candidates = [0, 1];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) candidates.push(-c / b);
  } else {
    const discriminant = b * b - 4 * a * c;
    if (!Number.isFinite(discriminant)) return hull;
    if (discriminant >= 0) {
      const sqrtDiscriminant = Math.sqrt(discriminant);
      candidates.push(
        (-b - sqrtDiscriminant) / (2 * a),
        (-b + sqrtDiscriminant) / (2 * a),
      );
    }
  }
  let min = Infinity;
  let max = -Infinity;
  for (const t of candidates) {
    if (!Number.isFinite(t) || t < 0 || t > 1) continue;
    const value = evaluate(t);
    if (!Number.isFinite(value)) return hull;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
};

// easing 출력(보간 진행률)의 최소·최대.
// 해석하지 못하는 문자열은 렌더가 폴백 곡선으로 강등하고 그 곡선도 [0, 1]이라
// 여기서 같은 값을 돌려주면 도달 계산과 실제 전환이 어긋나지 않는다
export const easingOutputRange = (
  easing: string,
): { min: number; max: number } => {
  const trimmed = easing.trim();
  const lower = trimmed.toLowerCase();
  if (NON_OVERSHOOT_KEYWORDS.has(lower) || lower.startsWith('steps(')) {
    return { min: 0, max: 1 };
  }
  const bezier = CUBIC_BEZIER_RE.exec(trimmed);
  if (bezier) {
    const [x1, y1, x2, y2] = bezier.slice(1, 5).map(Number);
    // x 제어점이 0~1 밖이면 무효 선언, 스냅 전환
    if (!(x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1)) {
      return { min: 0, max: 1 };
    }
    const range = cubicBezierYRange(y1, y2);
    return { min: Math.min(0, range.min), max: Math.max(1, range.max) };
  }
  const linearFn = LINEAR_FN_RE.exec(trimmed);
  if (linearFn) {
    // linear()는 구간별 선형이라 극값이 항상 정지점에 있다
    let min = 0;
    let max = 1;
    for (const stop of linearFn[1].split(',')) {
      const value = Number.parseFloat(stop.trim());
      if (!Number.isFinite(value)) return { min: 0, max: 1 };
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    return { min, max };
  }
  return { min: 0, max: 1 };
};

// 진행률 p가 [0, 1]을 벗어나는 최대 폭
const easingOvershootEpsilon = (easing: string): number => {
  const { min, max } = easingOutputRange(easing);
  return Math.max(max - 1, -min, 0);
};

const STEPS_FN_RE = new RegExp(
  String.raw`^steps\(\s*([+-]?\d+)\s*(?:,\s*(jump-start|jump-end|jump-none|jump-both|start|end)\s*)?\)$`,
  'i',
);

// <linear-stop> = <number> && <linear-stop-length>? - 백분율 단독 스톱은 무효다.
// 파싱을 parseFloat에 맡기면 `1%`나 괄호가 새는 `1)`이 유한값으로 통과한다
const LINEAR_STOP_RE = new RegExp(
  String.raw`^${CSS_NUMBER}(?:\s+${CSS_NUMBER}%){0,2}$`,
);

// 도달 범위를 정적으로 계산할 수 있는 문법인지. CSS transition은 무효 문자열을
// 선언째 버리고 넘어가지만 WAAPI는 TypeError를 던져 재생이 끊기므로, 두 채널이
// 같은 값을 쓰려면 여기서 문법을 확정해야 한다.
// 통과 = 엔진 지원 보장이 아니다. linear()는 Chrome 113·Safari 17.2부터라
// macOS 11의 WebKit이나 구형 OBS의 CEF는 거부한다 - 그쪽은 재생 시점 폴백이 맡는다.
// 명세상 유효해도 뺀 것들
//   - calc()·var(): 출력 범위를 정적으로 못 구해 창 여유를 잡을 수 없다
//   - 위치 우선 linear 정지점(`75% 0.25`): WebKit이 거부해 프리셋이 플랫폼을
//     넘을 때 동작이 갈린다
const isRenderableEasing = (easing: string): boolean => {
  const trimmed = easing.trim();
  const lower = trimmed.toLowerCase();
  if (NON_OVERSHOOT_KEYWORDS.has(lower)) return true;

  const steps = STEPS_FN_RE.exec(trimmed);
  // jump-none은 구간이 둘 이상이어야 성립한다
  if (steps) {
    const count = Number(steps[1]);
    if (count < 1) return false;
    return count > 1 || steps[2]?.toLowerCase() !== 'jump-none';
  }

  const bezier = CUBIC_BEZIER_RE.exec(trimmed);
  // x 제어점이 0~1 밖이면 무효 곡선. 비유한 y는 엔진이 유한값으로 잘라
  // 도달 계산과 실제 전환이 갈리므로 linear() 정지점과 같은 기준으로 강등한다
  if (bezier) {
    const [x1, y1, x2, y2] = bezier.slice(1, 5).map(Number);
    return (
      x1 >= 0 &&
      x1 <= 1 &&
      x2 >= 0 &&
      x2 <= 1 &&
      Number.isFinite(y1) &&
      Number.isFinite(y2)
    );
  }

  const linearFn = LINEAR_FN_RE.exec(trimmed);
  if (linearFn) {
    const stops = linearFn[1].split(',').map((stop) => stop.trim());
    // 스톱은 둘 이상이어야 한다 - linear(0)은 목록 최소 개수를 못 채워 무효다.
    // 무한대 스톱은 엔진이 유한값으로 잘라 도달 계산과 실제 전환이 갈리므로 함께 강등
    return (
      stops.length >= 2 &&
      stops.every(
        (stop) =>
          LINEAR_STOP_RE.test(stop) && Number.isFinite(Number.parseFloat(stop)),
      )
    );
  }
  return false;
};

// 지나침 폭이 1 이상이면 재타깃 반복마다 지나침 위에서 다시 출발해 누적이
// 발산하고, 어떤 유한한 창 여유로도 클리핑을 막을 수 없다. 그런 easing은
// 렌더에서 표준 곡선으로 강등해 도달 계산과 실제 전환이 같은 상한을 공유한다.
// 문법 자체가 무효인 값도 같은 곡선으로 강등한다
export const SPRITE_SAFE_FALLBACK_EASING = 'ease';

export const resolveSpriteRenderEasing = (easing: string): string =>
  isRenderableEasing(easing) && easingOvershootEpsilon(easing) < 1
    ? easing
    : SPRITE_SAFE_FALLBACK_EASING;

// 전환이 목표를 지나칠 수 있는 비율. 보간값 v = a + p(b - a)에서 진행률 p가
// [0, 1]을 벗어나는 최대 폭 e를 구하고, 전환 중 재타깃이 반복되면 지나침 위에서
// 다시 출발해 누적되므로 기하급수 극한 e/(1-e)를 상한으로 쓴다.
// e >= 1은 렌더가 폴백 곡선으로 강등하므로 강등 후 곡선 기준으로 계산한다
export const easingOvershootExtension = (easing: string): number => {
  const epsilon = easingOvershootEpsilon(resolveSpriteRenderEasing(easing));
  if (epsilon === 0) return 0;
  return epsilon / (1 - epsilon);
};

// 렌더 가능한 이미지가 하나도 없으면 null.
// 해석기 4단계의 평균 상태는 x·y·scale이 상태 값들의 볼록 결합이라 아래
// 범위 계산에 자동으로 포함되고, rotation 원형 평균은 회전 동일 시 같은 각,
// 상이 시 원 상한이 모든 각을 커버한다
export const computeSpriteReachAabb = (
  sprite: SpriteReachGeometry,
  liveTriggerIds: ReadonlySet<string>,
): SpriteAabb | null => {
  // 재생될 수 없는 자세는 창을 넓히지 않는다. 키를 지운 뒤에도 여유가 남으면
  // 레이아웃이 되돌아오지 않는다. 선택 가능 판정은 해석기와 같은 전처리에서
  // 파생시켜 두 규칙이 갈릴 수 없게 한다
  const reachablePoses = selectableSpritePoses(sprite.poses, liveTriggerIds);
  const hasImage =
    isRenderableImageRef(sprite.baseImage) ||
    reachablePoses.some((pose) => isRenderableImageRef(pose.imageOverride));
  if (!hasImage) return null;

  const transforms: SpriteTransform[] = [
    sprite.idleTransform,
    ...reachablePoses.map((pose) => pose.transform),
  ];

  const extension = easingOvershootExtension(sprite.transitionEasing);
  const extendedRange = (values: number[]): { lo: number; hi: number } => {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const margin = extension * (hi - lo);
    return { lo: lo - margin, hi: hi + margin };
  };
  const offsetX = extendedRange(transforms.map((t) => t.x));
  const offsetY = extendedRange(transforms.map((t) => t.y));
  const scale = extendedRange(transforms.map((t) => t.scale));
  const rotationsDiffer = transforms.some(
    (t) => t.rotation !== transforms[0].rotation,
  );

  const { imageRect, pivot } = sprite;
  const { x: pivotX, y: pivotY } = anchorPx(imageRect, pivot);
  // pivot 기준 상대 좌표 네 모서리
  const corners: Array<[number, number]> = [
    [imageRect.x - pivotX, imageRect.y - pivotY],
    [imageRect.x + imageRect.width - pivotX, imageRect.y - pivotY],
    [imageRect.x - pivotX, imageRect.y + imageRect.height - pivotY],
    [
      imageRect.x + imageRect.width - pivotX,
      imageRect.y + imageRect.height - pivotY,
    ],
  ];

  if (rotationsDiffer) {
    // 상태 간 회전이 다르면 전환 중간 각의 AABB가 양 끝 AABB를 벗어날 수 있다.
    // pivot에서 최원점까지 반경의 원을 상한으로 각 offset 위치에 적용해 합집합
    let radius = 0;
    for (const [vx, vy] of corners) {
      radius = Math.max(radius, Math.hypot(vx, vy));
    }
    radius *= Math.max(Math.abs(scale.lo), Math.abs(scale.hi));
    return {
      minX: pivotX + offsetX.lo - radius,
      minY: pivotY + offsetY.lo - radius,
      maxX: pivotX + offsetX.hi + radius,
      maxY: pivotY + offsetY.hi + radius,
    };
  }

  // 회전 동일: CSS rotate와 같은 방향(y축 아래, 양수 시계방향)으로 모서리 변환.
  // 모서리 좌표는 scale·offset에 선형이라 극단값 조합만 보면 된다
  const angle = transforms[0].rotation * (Math.PI / 180);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let cornerXLo = Infinity;
  let cornerXHi = -Infinity;
  let cornerYLo = Infinity;
  let cornerYHi = -Infinity;
  for (const [vx, vy] of corners) {
    const rotatedX = cos * vx - sin * vy;
    const rotatedY = sin * vx + cos * vy;
    for (const s of [scale.lo, scale.hi]) {
      cornerXLo = Math.min(cornerXLo, rotatedX * s);
      cornerXHi = Math.max(cornerXHi, rotatedX * s);
      cornerYLo = Math.min(cornerYLo, rotatedY * s);
      cornerYHi = Math.max(cornerYHi, rotatedY * s);
    }
  }
  return {
    minX: pivotX + offsetX.lo + cornerXLo,
    minY: pivotY + offsetY.lo + cornerYLo,
    maxX: pivotX + offsetX.hi + cornerXHi,
    maxY: pivotY + offsetY.hi + cornerYHi,
  };
};
