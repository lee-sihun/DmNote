import { describe, expect, it } from 'vitest';

import {
  findDuplicateTriggerPose,
  reactiveSpritePositionInputSchema,
  reactiveSpritePositionSchema,
  type SpritePose,
} from './sprites';

// 백엔드 직렬화 실물 형태. layerName·groupId는 None이면 키 자체가 생략된다
// (다른 요소 위치와 같은 관례) - 부재를 거부하면 부트스트랩 검증이 통째로 실패한다
const backendWireSprite = {
  baseImage: null,
  className: null,
  dx: 625,
  dy: 130,
  height: 215,
  hidden: false,
  id: '566b0333-494c-4d47-a76d-506b71e5ac4c',
  idleTransform: { rotation: 0, scale: 1, x: 0, y: 0 },
  pivot: { x: 0.5, y: 0.5 },
  poses: [],
  activation: 'whileHeld',
  pressDurationMs: 300,
  transitionEasing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  transitionMs: 90,
  useInlineStyles: null,
  width: 210,
  zIndex: null,
};

describe('reactiveSpritePositionSchema', () => {
  it('layerName·groupId가 생략된 백엔드 직렬화 형태를 허용한다', () => {
    expect(
      reactiveSpritePositionSchema.safeParse(backendWireSprite).success,
    ).toBe(true);
  });

  it('layerName·groupId가 null로 온 형태도 허용한다', () => {
    expect(
      reactiveSpritePositionSchema.safeParse({
        ...backendWireSprite,
        layerName: null,
        groupId: null,
      }).success,
    ).toBe(true);
  });

  it('layerName·groupId 문자열 값을 보존 허용한다', () => {
    expect(
      reactiveSpritePositionSchema.safeParse({
        ...backendWireSprite,
        layerName: '왼손',
        groupId: 'group-1',
      }).success,
    ).toBe(true);
  });
});

describe('reactiveSpritePositionSchema wire 계약', () => {
  const withPose = (pose: Partial<SpritePose>) => ({
    ...backendWireSprite,
    poses: [
      {
        poseId: 'pose-1',
        triggers: ['566b0333-494c-4d47-a76d-506b71e5ac4c'],
        transform: { x: 0, y: 0, rotation: 0, scale: 1 },
        imageOverride: null,
        imageOverrideMetrics: null,
        ...pose,
      },
    ],
  });

  it('빈 트리거 자세도 인입은 허용한다 - 복구 store 서빙이 부트스트랩을 죽이면 안 된다', () => {
    expect(
      reactiveSpritePositionSchema.safeParse(withPose({ triggers: [] }))
        .success,
    ).toBe(true);
  });

  it('input 스키마는 트리거 개수·id 길이 상한을 넘으면 거부한다', () => {
    const tooMany = Array.from({ length: 513 }, (_, i) => `id-${i}`);
    expect(
      reactiveSpritePositionInputSchema.safeParse(
        withPose({ triggers: tooMany }),
      ).success,
    ).toBe(false);
    expect(
      reactiveSpritePositionInputSchema.safeParse(
        withPose({ triggers: ['a'.repeat(65)] }),
      ).success,
    ).toBe(false);
  });

  it('canonical 스키마는 상한 밖 컬렉션 서빙도 허용한다 - grandfather 데이터가 부트스트랩을 죽이면 안 된다', () => {
    const tooMany = Array.from({ length: 513 }, (_, i) => `id-${i}`);
    expect(
      reactiveSpritePositionSchema.safeParse(withPose({ triggers: tooMany }))
        .success,
    ).toBe(true);
    expect(
      reactiveSpritePositionSchema.safeParse(withPose({ triggers: [''] }))
        .success,
    ).toBe(true);
  });

  it('input 스키마는 poseId 누락을 허용한다 - 백엔드가 새 id를 발급하는 공개 계약', () => {
    expect(
      reactiveSpritePositionInputSchema.safeParse(
        withPose({ poseId: undefined }),
      ).success,
    ).toBe(true);
    expect(
      reactiveSpritePositionSchema.safeParse(withPose({ poseId: undefined }))
        .success,
    ).toBe(false);
  });

  it('id는 생략만 허용하고 명시 null은 거부한다 - Rust String decode와 동일', () => {
    const { id: _id, ...withoutId } = backendWireSprite;
    expect(reactiveSpritePositionSchema.safeParse(withoutId).success).toBe(
      true,
    );
    expect(
      reactiveSpritePositionSchema.safeParse({
        ...backendWireSprite,
        id: null,
      }).success,
    ).toBe(false);
    expect(
      reactiveSpritePositionInputSchema.safeParse({
        ...backendWireSprite,
        id: null,
      }).success,
    ).toBe(false);
  });

  it('zIndex·transitionMs 소수는 Rust 정수 decode와 같이 거부한다', () => {
    expect(
      reactiveSpritePositionSchema.safeParse({
        ...backendWireSprite,
        zIndex: 1.5,
      }).success,
    ).toBe(false);
    expect(
      reactiveSpritePositionSchema.safeParse({
        ...backendWireSprite,
        transitionMs: 90.5,
      }).success,
    ).toBe(false);
  });

  it('상태 기준점은 생략·null·0..1 값을 허용하고 범위 밖은 거부한다', () => {
    expect(reactiveSpritePositionSchema.safeParse(withPose({})).success).toBe(
      true,
    );
    expect(
      reactiveSpritePositionSchema.safeParse(withPose({ pivot: null })).success,
    ).toBe(true);
    expect(
      reactiveSpritePositionSchema.safeParse(
        withPose({ pivot: { x: 0, y: 1 } }),
      ).success,
    ).toBe(true);
    expect(
      reactiveSpritePositionInputSchema.safeParse(
        withPose({ pivot: { x: -0.001, y: 0.5 } }),
      ).success,
    ).toBe(false);
  });
});

describe('findDuplicateTriggerPose', () => {
  const pose = (poseId: string, triggers: string[]): SpritePose => ({
    imageOverrideMetrics: null,
    poseId,
    triggers,
    transform: { x: 0, y: 0, rotation: 0, scale: 1 },
    imageOverride: null,
  });

  it('빈 트리거 자세는 미완성 draft라 중복으로 판정하지 않는다', () => {
    expect(findDuplicateTriggerPose([pose('a', []), pose('b', [])])).toBeNull();
  });

  it('순서·중복 트리거가 달라도 같은 집합이면 뒤 자세를 반환한다', () => {
    const duplicate = pose('b', ['k2', 'k1', 'k1']);
    expect(findDuplicateTriggerPose([pose('a', ['k1', 'k2']), duplicate])).toBe(
      duplicate,
    );
  });

  it('빈 자세가 섞여 있어도 실제 중복은 검출한다', () => {
    const duplicate = pose('c', ['k1']);
    expect(
      findDuplicateTriggerPose([pose('a', ['k1']), pose('b', []), duplicate]),
    ).toBe(duplicate);
  });

  it('서로 다른 집합은 중복이 아니다', () => {
    expect(
      findDuplicateTriggerPose([pose('a', ['k1']), pose('b', ['k1', 'k2'])]),
    ).toBeNull();
  });
});
