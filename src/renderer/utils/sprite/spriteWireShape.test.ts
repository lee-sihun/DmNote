import { makeSpritePose, makeSpritePosition } from './spriteFixtures';
import { describe, expect, it } from 'vitest';

import type {
  ReactiveSpritePosition,
  SpritePose,
} from '@src/types/key/sprites';

import { toSpriteWireShape } from './spriteWireShape';

const basePose = (overrides: Partial<SpritePose> = {}): SpritePose =>
  makeSpritePose({ triggers: ['key-1'], ...overrides });

const basePosition = (): ReactiveSpritePosition => makeSpritePosition();

describe('toSpriteWireShape', () => {
  it('명시 null layerName·groupId 키를 제거한다', () => {
    const shaped = toSpriteWireShape({
      ...basePosition(),
      layerName: null,
      groupId: null,
    });

    expect('layerName' in shaped).toBe(false);
    expect('groupId' in shaped).toBe(false);
  });

  it('명시 undefined 키도 제거한다', () => {
    const shaped = toSpriteWireShape({
      ...basePosition(),
      layerName: undefined,
      groupId: undefined,
    });

    expect('layerName' in shaped).toBe(false);
    expect('groupId' in shaped).toBe(false);
  });

  it('문자열 값은 보존한다', () => {
    const shaped = toSpriteWireShape({
      ...basePosition(),
      layerName: '왼손',
      groupId: 'group-1',
    });

    expect(shaped.layerName).toBe('왼손');
    expect(shaped.groupId).toBe('group-1');
  });

  it('두 키가 이미 부재면 같은 객체를 반환한다', () => {
    const position = basePosition();

    expect(toSpriteWireShape(position)).toBe(position);
  });

  it('자세의 명시 null name 키를 제거하고 문자열 이름은 보존한다', () => {
    const shaped = toSpriteWireShape({
      ...basePosition(),
      poses: [
        basePose({ name: null }),
        basePose({ poseId: 'pose-2', name: '왼팔 올림' }),
      ],
    });

    expect('name' in shaped.poses[0]).toBe(false);
    expect(shaped.poses[1].name).toBe('왼팔 올림');
  });

  it('자세 name 키가 이미 부재면 poses 배열을 재생성하지 않는다', () => {
    const position = { ...basePosition(), poses: [basePose()] };

    expect(toSpriteWireShape(position)).toBe(position);
  });

  it('클릭순 트리거를 백엔드 정규화와 같은 정렬·중복 제거로 맞춘다', () => {
    const shaped = toSpriteWireShape({
      ...basePosition(),
      poses: [
        basePose({ triggers: ['key-b', 'key-a', 'key-b'] }),
        basePose({ poseId: 'pose-2', triggers: ['key-c'] }),
      ],
    });

    expect(shaped.poses[0].triggers).toEqual(['key-a', 'key-b']);
    expect(shaped.poses[1].triggers).toEqual(['key-c']);
  });

  it('이미 정규형인 트리거는 자세·poses identity를 보존한다', () => {
    const pose = basePose({ triggers: ['key-a', 'key-b'] });
    const position = { ...basePosition(), poses: [pose] };

    const shaped = toSpriteWireShape(position);

    expect(shaped).toBe(position);
    expect(shaped.poses[0]).toBe(pose);
    expect(shaped.poses[0].triggers).toBe(pose.triggers);
  });

  it('트리거만 비정규면 해당 자세만 재생성한다', () => {
    const normalized = basePose({ triggers: ['key-a'] });
    const unordered = basePose({
      poseId: 'pose-2',
      triggers: ['key-z', 'key-a'],
    });
    const position = { ...basePosition(), poses: [normalized, unordered] };

    const shaped = toSpriteWireShape(position);

    expect(shaped).not.toBe(position);
    expect(shaped.poses[0]).toBe(normalized);
    expect(shaped.poses[1].triggers).toEqual(['key-a', 'key-z']);
  });

  it('다른 null 필드는 건드리지 않는다', () => {
    const shaped = toSpriteWireShape({
      ...basePosition(),
      layerName: null,
      groupId: 'group-1',
    });

    expect(shaped.baseImage).toBeNull();
    expect(shaped.className).toBeNull();
    expect(shaped.useInlineStyles).toBeNull();
    expect(shaped.zIndex).toBeNull();
    expect(shaped.referenceNaturalSize).toBeNull();
    expect(shaped.groupId).toBe('group-1');
  });
});
