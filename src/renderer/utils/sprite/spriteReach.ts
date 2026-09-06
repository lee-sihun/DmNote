import type {
  ReactiveSpritePosition,
  SpriteTransform,
} from '@src/types/key/sprites';

import { isRenderableImageRef } from '@utils/core/imageSource';
import { pointsAabb, rotatePointAround } from '@utils/core/rotation';

import {
  resolveSpriteTarget,
  selectableSpritePoses,
  spriteTriggerIds,
  type SpriteTargetResolution,
} from './poseResolver';

import { anchorPx } from './spriteGeometry';
import {
  placeSpriteVisual,
  spriteIdleVisual,
  spritePoseVisual,
  type SpritePlacement,
} from './spritePlacement';

// 스프라이트 이미지 도달 범위 계산.
// 저장된 모든 상태(idle + pose)의 이미지 배치에 축 기준 scale·rotation·offset을
// 적용한 AABB의 합집합이다. 기본 이미지는 배치가 요소 상자 하나이고, 크기가 다른
// 자세 이미지는 배치가 달라 각 배치에 전체 transform 범위를 곱해 보수적으로 합친다.
// 창 바운즈가 이 값을 포함해야 이미지가 요소 상자를 넘어도 네이티브 창
// 가장자리에서 잘리지 않는다. 반환 좌표계는 요소 상자(dx/dy) 로컬 기준

export interface SpriteAabb {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type SpriteReachGeometry = Pick<
  ReactiveSpritePosition,
  | 'baseImage'
  | 'width'
  | 'height'
  | 'pivot'
  | 'referenceNaturalSize'
  | 'idleTransform'
  | 'poses'
  | 'transitionEasing'
> &
  Partial<Pick<ReactiveSpritePosition, 'rotation'>>;

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

// 스프라이트 하나의 눌림 조합 상한. 반응 키가 10개를 넘는 문서는 사실상 없고,
// 넘으면 2^g가 급격히 커진다. 초과분은 자세 범위 과대 근사로 폴백한다.
// 레이아웃 전체 합계 예산은 호출부가 따로 건다 - 이 상한만으로는 스프라이트가
// 많은 문서의 총 비용을 막지 못한다
const MAX_REACH_ENUMERATION_GROUPS = 10;

// 실제로 만들어질 수 있는 눌림 상태마다 해석기를 돌려 나온 transform 목록.
// 같은 canonical 키에 묶인 트리거는 항상 함께 눌린다 - 잎이 canonical 신호로
// pressed 집합을 만들기 때문이다. 그래서 그룹 단위 on/off의 모든 조합이 곧
// 도달 가능한 상태다. canonical끼리는 독립으로 본다: 백엔드가 전이를 개별
// 이벤트로 순차 발행하고 프론트도 하나씩 적용해서, 물리적으로 불가능해 보이는
// 중간 조합('A+B'만 켜지고 'A'는 아직 꺼진 순간)도 실제로 해석기에 들어간다.
// 상한 초과면 null - 호출부가 기존 과대 근사로 돌아간다
const canonicalGroups = (
  sprite: SpriteReachGeometry,
  canonicalByTrigger: ReadonlyMap<string, string>,
): Array<Set<string>> => {
  const groupsByCanonical = new Map<string, Set<string>>();
  for (const pose of sprite.poses) {
    for (const trigger of pose.triggers) {
      const canonical = canonicalByTrigger.get(trigger);
      if (canonical === undefined) continue;
      const group = groupsByCanonical.get(canonical) ?? new Set<string>();
      group.add(trigger);
      groupsByCanonical.set(canonical, group);
    }
  }
  return [...groupsByCanonical.values()];
};

/**
 * 열거 비용 추정치. 상태 수 x 상태당 순회량이고, 그룹 수가 상한을 넘으면 Infinity.
 * 호출부가 레이아웃 전체 합계를 먼저 재고 예산을 넘으면 모든 스프라이트를 함께
 * 폴백시킨다 - 일부만 열거하면 스프라이트 순서에 따라 창 크기가 달라진다
 */
export const spriteReachEnumerationCost = (
  sprite: SpriteReachGeometry,
  canonicalByTrigger: ReadonlyMap<string, string>,
): number => {
  const groups = canonicalGroups(sprite, canonicalByTrigger);
  if (groups.length > MAX_REACH_ENUMERATION_GROUPS)
    return Number.POSITIVE_INFINITY;
  // 그룹 구성은 고유 키가 아니라 자세마다의 트리거 등장을 전부 훑는다. 자세 64개가
  // 같은 키 512개를 반복 참조하면 3만 번이라, 고유 수만 세면 크게 과소평가된다.
  // 비용 계산과 실제 열거에서 한 번씩 돌므로 두 배로 잡는다
  const triggerReferences = sprite.poses.reduce(
    (sum, pose) => sum + pose.triggers.length,
    0,
  );
  const activeIds = groups.reduce((sum, group) => sum + group.size, 0);
  // 상태마다 활성 id 복사 + 해석기의 트리거·단일 자세 순회 + 활성 집합 정렬
  const perState =
    activeIds + spriteTriggerIds(sprite.poses).length + sprite.poses.length + 1;
  return triggerReferences * 2 + 2 ** groups.length * perState;
};

const enumerateReachableTargets = (
  sprite: SpriteReachGeometry,
  canonicalByTrigger: ReadonlyMap<string, string>,
): SpriteTargetResolution[] | null => {
  const groups = canonicalGroups(sprite, canonicalByTrigger);
  if (groups.length > MAX_REACH_ENUMERATION_GROUPS) return null;

  const targets: SpriteTargetResolution[] = [];
  const stateCount = 2 ** groups.length;
  for (let mask = 0; mask < stateCount; mask++) {
    const pressed = new Set<string>();
    for (let index = 0; index < groups.length; index++) {
      if (mask & (1 << index)) {
        for (const trigger of groups[index]) pressed.add(trigger);
      }
    }
    targets.push(resolveSpriteTarget(sprite, pressed));
  }
  return targets;
};

// 렌더 가능한 이미지가 하나도 없으면 null.
// 해석기 4단계의 평균 상태는 x·y·scale이 상태 값들의 볼록 결합이라 아래
// 범위 계산에 자동으로 포함되고, rotation 원형 평균은 회전 동일 시 같은 각,
// 상이 시 원 상한이 모든 각을 커버한다
export const computeSpriteReachAabb = (
  sprite: SpriteReachGeometry,
  canonicalByTrigger: ReadonlyMap<string, string>,
  options: { enumerate?: boolean } = {},
): SpriteAabb | null => {
  // 상태를 열거하면 자세를 개별로 세는 과대 근사가 사라진다 - 같은 물리 키에
  // 묶인 자세들은 평균으로만 도달하므로 범위가 그만큼 좁아진다.
  // 이미지 판정도 같은 열거 결과로 해야 한다: 조합 자세가 공동 활성화 때문에
  // 정확 일치할 수 없으면 그 override는 어떤 상태에서도 그려지지 않는다
  const targets =
    options.enumerate === false
      ? null
      : enumerateReachableTargets(sprite, canonicalByTrigger);

  let transforms: SpriteTransform[];
  let placements: SpritePlacement[];
  if (targets) {
    if (!targets.some((target) => isRenderableImageRef(target.imageSrc)))
      return null;
    transforms = targets.map((target) => target.transform);
    placements = targets.map((target) =>
      placeSpriteVisual(sprite, target.visual),
    );
  } else {
    // 폴백도 재생될 수 없는 자세는 빼야 키를 지운 뒤 여유가 회수된다.
    // 선택 가능 판정은 해석기와 같은 전처리에서 파생시켜 규칙이 갈릴 수 없게 한다
    const reachablePoses = selectableSpritePoses(
      sprite.poses,
      new Set(canonicalByTrigger.keys()),
    );
    const hasImage =
      isRenderableImageRef(sprite.baseImage) ||
      reachablePoses.some((pose) => isRenderableImageRef(pose.imageOverride));
    if (!hasImage) return null;
    transforms = [
      sprite.idleTransform,
      ...reachablePoses.map((pose) => pose.transform),
    ];
    placements = [
      placeSpriteVisual(sprite, spriteIdleVisual(sprite)),
      ...reachablePoses.map((pose) =>
        placeSpriteVisual(sprite, spritePoseVisual(sprite, pose)),
      ),
    ];
  }

  const extension = easingOvershootExtension(sprite.transitionEasing);
  const extendedRange = (values: number[]): { lo: number; hi: number } => {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const margin = extension * (hi - lo);
    return { lo: lo - margin, hi: hi + margin };
  };
  let offsetX = extendedRange(transforms.map((t) => t.x));
  let offsetY = extendedRange(transforms.map((t) => t.y));
  const baseRotation = sprite.rotation ?? 0;
  const boxCenter = { x: sprite.width / 2, y: sprite.height / 2 };
  if (baseRotation !== 0) {
    // 배치 회전은 자세 이동 범위도 함께 돌린다. 자세의 보간 각도는 그대로 둔다
    const rotated = pointsAabb(
      [
        { x: offsetX.lo, y: offsetY.lo },
        { x: offsetX.lo, y: offsetY.hi },
        { x: offsetX.hi, y: offsetY.lo },
        { x: offsetX.hi, y: offsetY.hi },
      ].map((point) => rotatePointAround(point, { x: 0, y: 0 }, baseRotation)),
    );
    offsetX = { lo: rotated.minX, hi: rotated.maxX };
    offsetY = { lo: rotated.minY, hi: rotated.maxY };
  }
  const scale = extendedRange(transforms.map((t) => t.scale));
  const rotationsDiffer = transforms.some(
    (t) => t.rotation !== transforms[0].rotation,
  );
  const rotation = transforms[0].rotation + baseRotation;

  // 같은 배치는 한 번만 계산 - 원본 크기를 모르면 상태 수와 무관하게 배치가 하나다
  const seen = new Set<string>();
  let union: SpriteAabb | null = null;
  for (const placement of placements) {
    const { rect, pivot } = placement;
    const key = `${rect.x},${rect.y},${rect.width},${rect.height},${pivot.x},${pivot.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const aabb = placementReachAabb(placement, {
      offsetX,
      offsetY,
      scale,
      rotation,
      rotationsDiffer,
      baseRotation,
      boxCenter,
    });
    union = union
      ? {
          minX: Math.min(union.minX, aabb.minX),
          minY: Math.min(union.minY, aabb.minY),
          maxX: Math.max(union.maxX, aabb.maxX),
          maxY: Math.max(union.maxY, aabb.maxY),
        }
      : aabb;
  }
  return union;
};

interface ReachTransformRanges {
  offsetX: { lo: number; hi: number };
  offsetY: { lo: number; hi: number };
  scale: { lo: number; hi: number };
  rotation: number;
  rotationsDiffer: boolean;
  baseRotation: number;
  boxCenter: { x: number; y: number };
}

// 배치 하나의 AABB - 축 기준 상대 모서리에 transform 범위를 적용한다
const placementReachAabb = (
  placement: SpritePlacement,
  ranges: ReachTransformRanges,
): SpriteAabb => {
  const { rect, pivot } = placement;
  const { offsetX, offsetY, scale } = ranges;
  const { x: pivotX, y: pivotY } = anchorPx(rect, pivot);
  const layoutPivot = rotatePointAround(
    { x: pivotX, y: pivotY },
    ranges.boxCenter,
    ranges.baseRotation,
  );
  // pivot 기준 상대 좌표 네 모서리
  const corners: Array<[number, number]> = [
    [rect.x - pivotX, rect.y - pivotY],
    [rect.x + rect.width - pivotX, rect.y - pivotY],
    [rect.x - pivotX, rect.y + rect.height - pivotY],
    [rect.x + rect.width - pivotX, rect.y + rect.height - pivotY],
  ];

  if (ranges.rotationsDiffer) {
    // 상태 간 회전이 다르면 전환 중간 각의 AABB가 양 끝 AABB를 벗어날 수 있다.
    // pivot에서 최원점까지 반경의 원을 상한으로 각 offset 위치에 적용해 합집합
    let radius = 0;
    for (const [vx, vy] of corners) {
      radius = Math.max(radius, Math.hypot(vx, vy));
    }
    radius *= Math.max(Math.abs(scale.lo), Math.abs(scale.hi));
    return {
      minX: layoutPivot.x + offsetX.lo - radius,
      minY: layoutPivot.y + offsetY.lo - radius,
      maxX: layoutPivot.x + offsetX.hi + radius,
      maxY: layoutPivot.y + offsetY.hi + radius,
    };
  }

  // 회전 동일: CSS rotate와 같은 방향(y축 아래, 양수 시계방향)으로 모서리 변환.
  // 모서리 좌표는 scale·offset에 선형이라 극단값 조합만 보면 된다
  const angle = ranges.rotation * (Math.PI / 180);
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
    minX: layoutPivot.x + offsetX.lo + cornerXLo,
    minY: layoutPivot.y + offsetY.lo + cornerYLo,
    maxX: layoutPivot.x + offsetX.hi + cornerXHi,
    maxY: layoutPivot.y + offsetY.hi + cornerYHi,
  };
};
