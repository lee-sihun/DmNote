import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SPRITE_ACTIVATION,
  DEFAULT_SPRITE_CONTACT_POINT,
  DEFAULT_SPRITE_PRESS_DURATION_MS,
  DEFAULT_SPRITE_TRANSITION_EASING,
  DEFAULT_SPRITE_TRANSITION_MS,
  SPRITE_CONSTRAINTS,
  reactiveSpritePositionInputSchema,
  reactiveSpritePositionSchema,
  spriteAnchorSchema,
  spriteRectSchema,
  spriteTransformSchema,
} from '../src/types/key/sprites';

// Rust 테스트(src-tauri models)와 같은 fixture를 공유해, 프론트 zod 경계와
// 백엔드 검증 상수가 기계적으로 일치함을 고정한다. 한쪽만 바뀌면 프론트가
// 통과시킨 커밋을 백엔드가 거부하는(또는 역방향) 침묵 드리프트가 된다
const FIXTURE_PATH = join(
  __dirname,
  'fixtures',
  'sprite-constraint-parity.json',
);

interface SpriteConstraintFixture {
  offset: { min: number; max: number };
  rotation: { min: number; max: number };
  scale: { min: number; max: number };
  anchor: { min: number; max: number };
  transitionMs: { min: number; max: number };
  imageRect: { coordMin: number; coordMax: number; dimensionMax: number };
  resizeMinDimension: number;
  maxPoses: number;
  maxTriggersPerPose: number;
  pressDurationMs: { min: number; max: number };
  defaultTransitionMs: number;
  defaultTransitionEasing: string;
  defaultActivation: string;
  defaultPressDurationMs: number;
  defaultContactPoint: { x: number; y: number };
}

const fixture = JSON.parse(
  readFileSync(FIXTURE_PATH, 'utf8'),
) as SpriteConstraintFixture;

const baseSprite = () => ({
  id: '00000000-0000-4000-8000-0000000000a0',
  dx: 0,
  dy: 0,
  width: 200,
  height: 200,
  hidden: false,
  zIndex: null,
  className: null,
  useInlineStyles: null,
  baseImage: null,
  imageFit: null,
  imageRect: { x: 0, y: 0, width: 200, height: 200 },
  pivot: { x: 0.5, y: 0.5 },
  idleTransform: { x: 0, y: 0, rotation: 0, scale: 1 },
  poses: [] as unknown[],
  activation: 'whileHeld',
  pressDurationMs: 300,
  transitionMs: 90,
  transitionEasing: 'cubic-bezier(0.4, 0, 0.2, 1)',
});

const pose = (poseId: string, triggers: string[]) => ({
  poseId,
  triggers,
  transform: { x: 0, y: 0, rotation: 0, scale: 1 },
  imageOverride: null,
  contactPoint: { x: 0.5, y: 1 },
});

describe('sprite constraint parity (fixture)', () => {
  it('fixture는 SPRITE_CONSTRAINTS 항목을 전수 커버한다', () => {
    // triggerIdMaxLength는 FE 전용 방어선(백엔드는 UUID 형식 검증 전담)이라
    // 파리티 대상에서 의도적으로 제외 - 새 constraint가 생기면 여기서 실패한다
    const constraintKeys = Object.keys(SPRITE_CONSTRAINTS)
      .filter((key) => key !== 'triggerIdMaxLength')
      .sort();
    const fixtureKeys = Object.keys(fixture)
      .filter((key) => !key.startsWith('default'))
      .sort();
    expect(fixtureKeys).toEqual(constraintKeys);
  });

  it('SPRITE_CONSTRAINTS 수치는 fixture와 일치한다', () => {
    expect(SPRITE_CONSTRAINTS.offset).toEqual(fixture.offset);
    expect(SPRITE_CONSTRAINTS.rotation).toEqual(fixture.rotation);
    expect(SPRITE_CONSTRAINTS.scale).toEqual(fixture.scale);
    expect(SPRITE_CONSTRAINTS.anchor).toEqual(fixture.anchor);
    expect(SPRITE_CONSTRAINTS.transitionMs).toEqual(fixture.transitionMs);
    expect(SPRITE_CONSTRAINTS.imageRect).toEqual(fixture.imageRect);
    expect(SPRITE_CONSTRAINTS.resizeMinDimension).toBe(
      fixture.resizeMinDimension,
    );
    expect(SPRITE_CONSTRAINTS.maxPoses).toBe(fixture.maxPoses);
    expect(SPRITE_CONSTRAINTS.maxTriggersPerPose).toBe(
      fixture.maxTriggersPerPose,
    );
    expect(SPRITE_CONSTRAINTS.pressDurationMs).toEqual(fixture.pressDurationMs);
  });

  it('전환 기본값은 fixture와 일치한다 - easing은 바이트 단위 동일해야 프리셋 매칭이 산다', () => {
    expect(DEFAULT_SPRITE_TRANSITION_MS).toBe(fixture.defaultTransitionMs);
    expect(DEFAULT_SPRITE_TRANSITION_EASING).toBe(
      fixture.defaultTransitionEasing,
    );
    expect(DEFAULT_SPRITE_ACTIVATION).toBe(fixture.defaultActivation);
    expect(DEFAULT_SPRITE_PRESS_DURATION_MS).toBe(
      fixture.defaultPressDurationMs,
    );
    expect(DEFAULT_SPRITE_CONTACT_POINT).toEqual(fixture.defaultContactPoint);
  });

  it('transform 스칼라는 fixture 경계에서 통과하고 근소 초과에서 거부된다', () => {
    const cases: Array<[string, number, number]> = [
      ['x', fixture.offset.min, fixture.offset.max],
      ['y', fixture.offset.min, fixture.offset.max],
      ['rotation', fixture.rotation.min, fixture.rotation.max],
      ['scale', fixture.scale.min, fixture.scale.max],
    ];
    const identity = { x: 0, y: 0, rotation: 0, scale: 1 };
    for (const [field, min, max] of cases) {
      expect(
        spriteTransformSchema.safeParse({ ...identity, [field]: min }).success,
      ).toBe(true);
      expect(
        spriteTransformSchema.safeParse({ ...identity, [field]: max }).success,
      ).toBe(true);
      expect(
        spriteTransformSchema.safeParse({ ...identity, [field]: min - 0.001 })
          .success,
      ).toBe(false);
      expect(
        spriteTransformSchema.safeParse({ ...identity, [field]: max + 0.001 })
          .success,
      ).toBe(false);
    }
  });

  it('pivot·imageRect·transitionMs도 fixture 경계를 그대로 강제한다', () => {
    expect(
      spriteAnchorSchema.safeParse({ x: fixture.anchor.max, y: 0 }).success,
    ).toBe(true);
    expect(
      spriteAnchorSchema.safeParse({ x: fixture.anchor.max + 0.001, y: 0 })
        .success,
    ).toBe(false);

    const rect = { x: 0, y: 0, width: 200, height: 200 };
    expect(
      spriteRectSchema.safeParse({ ...rect, x: fixture.imageRect.coordMax })
        .success,
    ).toBe(true);
    expect(
      spriteRectSchema.safeParse({ ...rect, x: fixture.imageRect.coordMax + 1 })
        .success,
    ).toBe(false);
    expect(
      spriteRectSchema.safeParse({
        ...rect,
        width: fixture.imageRect.dimensionMax,
      }).success,
    ).toBe(true);
    expect(
      spriteRectSchema.safeParse({
        ...rect,
        width: fixture.imageRect.dimensionMax + 1,
      }).success,
    ).toBe(false);

    expect(
      reactiveSpritePositionSchema.safeParse({
        ...baseSprite(),
        transitionMs: fixture.transitionMs.max,
      }).success,
    ).toBe(true);
    expect(
      reactiveSpritePositionSchema.safeParse({
        ...baseSprite(),
        transitionMs: fixture.transitionMs.max + 1,
      }).success,
    ).toBe(false);

    for (const value of [
      fixture.pressDurationMs.min,
      fixture.pressDurationMs.max,
    ]) {
      expect(
        reactiveSpritePositionSchema.safeParse({
          ...baseSprite(),
          pressDurationMs: value,
        }).success,
      ).toBe(true);
    }
    expect(
      reactiveSpritePositionSchema.safeParse({
        ...baseSprite(),
        pressDurationMs: fixture.pressDurationMs.min - 1,
      }).success,
    ).toBe(false);
    expect(
      reactiveSpritePositionSchema.safeParse({
        ...baseSprite(),
        pressDurationMs: fixture.pressDurationMs.max + 1,
      }).success,
    ).toBe(false);
  });

  it('canonical은 새 필드를 요구하고 input은 생략을 허용한다 - 구 플러그인 patch 호환', () => {
    const {
      activation: _activation,
      pressDurationMs: _pressDurationMs,
      ...legacySprite
    } = baseSprite();
    const { contactPoint: _contactPoint, ...legacyPose } = pose('p', ['t']);
    const legacy = { ...legacySprite, poses: [legacyPose] };
    expect(reactiveSpritePositionSchema.safeParse(legacy).success).toBe(false);
    expect(reactiveSpritePositionInputSchema.safeParse(legacy).success).toBe(
      true,
    );
  });

  it('input 스키마 컬렉션 상한은 fixture 값에서 통과하고 +1에서 거부된다', () => {
    const triggersAtCap = Array.from(
      { length: fixture.maxTriggersPerPose },
      (_, i) => `trigger-${i}`,
    );
    expect(
      reactiveSpritePositionInputSchema.safeParse({
        ...baseSprite(),
        poses: [pose('p', triggersAtCap)],
      }).success,
    ).toBe(true);
    expect(
      reactiveSpritePositionInputSchema.safeParse({
        ...baseSprite(),
        poses: [pose('p', [...triggersAtCap, 'trigger-over'])],
      }).success,
    ).toBe(false);

    const posesAtCap = Array.from({ length: fixture.maxPoses }, (_, i) =>
      pose(`p-${i}`, [`t-${i}`]),
    );
    expect(
      reactiveSpritePositionInputSchema.safeParse({
        ...baseSprite(),
        poses: posesAtCap,
      }).success,
    ).toBe(true);
    expect(
      reactiveSpritePositionInputSchema.safeParse({
        ...baseSprite(),
        poses: [...posesAtCap, pose('p-over', ['t-over'])],
      }).success,
    ).toBe(false);
  });
});
