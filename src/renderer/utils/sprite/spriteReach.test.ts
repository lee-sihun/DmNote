import { describe, expect, it } from 'vitest';

import type { SpritePose, SpriteTransform } from '@src/types/key/sprites';
import { DEFAULT_SPRITE_TRANSITION_EASING } from '@src/types/key/sprites';

import {
  computeSpriteReachAabb,
  easingOutputRange,
  easingOvershootExtension,
  resolveSpriteRenderEasing,
  SPRITE_SAFE_FALLBACK_EASING,
  type SpriteReachGeometry,
} from './spriteReach';

const OVERSHOOT_EASING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

const makeTransform = (
  overrides: Partial<SpriteTransform> = {},
): SpriteTransform => ({
  x: 0,
  y: 0,
  rotation: 0,
  scale: 1,
  ...overrides,
});

const makePose = (
  poseId: string,
  transform: Partial<SpriteTransform> = {},
  imageOverride: string | null = null,
): SpritePose => ({
  contactPoint: { x: 0.5, y: 1 },
  poseId,
  triggers: [poseId],
  transform: makeTransform(transform),
  imageOverride,
});

// 활동 영역 200x200에 imageRect가 영역 전체, pivot 중앙 (기본 생성값 형태)
const makeSprite = (
  overrides: Partial<SpriteReachGeometry> = {},
): SpriteReachGeometry => ({
  baseImage: 'base.png',
  imageRect: { x: 0, y: 0, width: 200, height: 200 },
  pivot: { x: 0.5, y: 0.5 },
  idleTransform: makeTransform(),
  poses: [],
  transitionEasing: DEFAULT_SPRITE_TRANSITION_EASING,
  ...overrides,
});

describe('computeSpriteReachAabb', () => {
  it('변환 없는 스프라이트는 imageRect 그대로', () => {
    const reach = computeSpriteReachAabb(makeSprite());
    expect(reach).toEqual({ minX: 0, minY: 0, maxX: 200, maxY: 200 });
  });

  it('45도 회전은 대각선 오버행을 만든다', () => {
    const reach = computeSpriteReachAabb(
      makeSprite({ idleTransform: makeTransform({ rotation: 45 }) }),
    );
    // pivot 중앙 기준 반대각 100*sqrt(2)
    expect(reach?.minX).toBeCloseTo(-41.4214, 3);
    expect(reach?.minY).toBeCloseTo(-41.4214, 3);
    expect(reach?.maxX).toBeCloseTo(241.4214, 3);
    expect(reach?.maxY).toBeCloseTo(241.4214, 3);
  });

  it('회전 방향은 CSS rotate와 같다 (y축 아래, 양수 시계방향)', () => {
    const reach = computeSpriteReachAabb(
      makeSprite({
        pivot: { x: 0, y: 0 },
        idleTransform: makeTransform({ rotation: 90 }),
      }),
    );
    expect(reach?.minX).toBeCloseTo(-200, 6);
    expect(reach?.maxX).toBeCloseTo(0, 6);
    expect(reach?.minY).toBeCloseTo(0, 6);
    expect(reach?.maxY).toBeCloseTo(200, 6);
  });

  it('offset 이동은 AABB를 그대로 평행 이동한다', () => {
    const reach = computeSpriteReachAabb(
      makeSprite({ idleTransform: makeTransform({ x: 300, y: -50 }) }),
    );
    expect(reach).toEqual({ minX: 300, minY: -50, maxX: 500, maxY: 150 });
  });

  it('scale 확대는 pivot 기준으로 사방으로 커진다', () => {
    const reach = computeSpriteReachAabb(
      makeSprite({ idleTransform: makeTransform({ scale: 2 }) }),
    );
    expect(reach).toEqual({ minX: -100, minY: -100, maxX: 300, maxY: 300 });
  });

  it('상태 간 회전이 다르면 최원점 반경의 원을 상한으로 잡는다', () => {
    const reach = computeSpriteReachAabb(
      makeSprite({ poses: [makePose('p1', { rotation: 90 })] }),
    );
    // 중간 각(예: 45도)의 대각선까지 커버해야 한다
    expect(reach?.minX).toBeCloseTo(-41.4214, 3);
    expect(reach?.maxX).toBeCloseTo(241.4214, 3);
    expect(reach?.minY).toBeCloseTo(-41.4214, 3);
    expect(reach?.maxY).toBeCloseTo(241.4214, 3);
  });

  it('회전 상이 + offset 상이는 각 offset 위치의 원 합집합이다', () => {
    const reach = computeSpriteReachAabb(
      makeSprite({ poses: [makePose('p1', { x: 500, rotation: 90 })] }),
    );
    expect(reach?.minX).toBeCloseTo(-41.4214, 3);
    expect(reach?.maxX).toBeCloseTo(741.4214, 3);
  });

  it('오버슈트 easing은 상태 범위 밖 여유를 더한다', () => {
    const noOvershoot = computeSpriteReachAabb(
      makeSprite({ poses: [makePose('p1', { x: 100 })] }),
    );
    expect(noOvershoot?.minX).toBeCloseTo(0, 6);
    expect(noOvershoot?.maxX).toBeCloseTo(300, 6);

    const withOvershoot = computeSpriteReachAabb(
      makeSprite({
        poses: [makePose('p1', { x: 100 })],
        transitionEasing: OVERSHOOT_EASING,
      }),
    );
    // e = 0.0978, 재타깃 상한 e/(1-e) = 0.1084, 여유 = 0.1084 * 100
    expect(withOvershoot?.minX).toBeCloseTo(-10.84, 1);
    expect(withOvershoot?.maxX).toBeCloseTo(310.84, 1);
  });

  it('렌더 가능한 이미지가 없으면 null', () => {
    expect(computeSpriteReachAabb(makeSprite({ baseImage: null }))).toBeNull();
  });

  it('pose imageOverride만 있어도 도달 범위를 계산한다', () => {
    const reach = computeSpriteReachAabb(
      makeSprite({
        baseImage: null,
        poses: [makePose('p1', { x: 100 }, 'override.png')],
      }),
    );
    expect(reach?.maxX).toBeCloseTo(300, 6);
  });
});

describe('easingOutputRange', () => {
  it('기본 easing과 키워드는 0~1을 벗어나지 않는다', () => {
    expect(easingOutputRange(DEFAULT_SPRITE_TRANSITION_EASING)).toEqual({
      min: 0,
      max: 1,
    });
    expect(easingOutputRange('linear')).toEqual({ min: 0, max: 1 });
    expect(easingOutputRange('ease-in-out')).toEqual({ min: 0, max: 1 });
  });

  it('오버슈트 cubic-bezier의 최대 출력을 정확히 구한다', () => {
    expect(easingOutputRange(OVERSHOOT_EASING).max).toBeCloseTo(1.0978, 3);
    expect(easingOutputRange(OVERSHOOT_EASING).min).toBe(0);
  });

  it('linear() 함수는 정지점 최소·최대를 쓴다', () => {
    expect(easingOutputRange('linear(0, 1.5, 1)')).toEqual({
      min: 0,
      max: 1.5,
    });
    expect(easingOutputRange('linear(-0.2, 0.5 50%, 1)').min).toBe(-0.2);
  });

  it('해석 불가 문자열은 스냅 전환이라 0~1로 본다', () => {
    expect(easingOutputRange('not-an-easing')).toEqual({ min: 0, max: 1 });
    // x 제어점이 0~1 밖이면 CSS 선언 자체가 무효
    expect(easingOutputRange('cubic-bezier(2, 5, 0.5, 1)')).toEqual({
      min: 0,
      max: 1,
    });
  });
});

describe('easingOvershootExtension', () => {
  it('오버슈트 없는 easing은 0', () => {
    expect(easingOvershootExtension(DEFAULT_SPRITE_TRANSITION_EASING)).toBe(0);
    expect(easingOvershootExtension('linear')).toBe(0);
  });

  it('재타깃 누적 상한 e/(1-e)를 적용한다', () => {
    expect(easingOvershootExtension(OVERSHOOT_EASING)).toBeCloseTo(0.1084, 3);
    expect(easingOvershootExtension('linear(0, 1.5, 1)')).toBeCloseTo(1, 6);
  });

  it('지나침 폭 1 이상은 폴백 곡선으로 강등되어 여유 0', () => {
    expect(resolveSpriteRenderEasing('cubic-bezier(0.5, 10, 0.5, -9)')).toBe(
      SPRITE_SAFE_FALLBACK_EASING,
    );
    expect(easingOvershootExtension('cubic-bezier(0.5, 10, 0.5, -9)')).toBe(0);
    expect(easingOvershootExtension('linear(0, 2.5, 1)')).toBe(0);
  });

  it('지나침 폭 1 미만 easing은 강등 없이 유지된다', () => {
    expect(resolveSpriteRenderEasing(OVERSHOOT_EASING)).toBe(OVERSHOOT_EASING);
    expect(resolveSpriteRenderEasing('linear')).toBe('linear');
  });
});
