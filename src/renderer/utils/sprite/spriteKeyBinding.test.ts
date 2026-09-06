import { describe, expect, it } from 'vitest';

import type { KeySlot } from '@src/types/key/keys';

import { buildSpriteKeyCanonicalMap } from './spriteKeyBinding';

describe('buildSpriteKeyCanonicalMap', () => {
  it('단일 키 슬롯을 id -> canonical로 매핑한다', () => {
    const keys: KeySlot[] = ['KeyA', 'KeyB'];
    const positions = [{ id: 'el-1' }, { id: 'el-2' }];

    const map = buildSpriteKeyCanonicalMap(keys, positions);

    expect(map.size).toBe(2);
    expect(map.get('el-1')).toBe('KeyA');
    expect(map.get('el-2')).toBe('KeyB');
  });

  it('멀티 슬롯은 all/any 구분자로 합성한 canonical을 쓴다', () => {
    const keys: KeySlot[] = [
      { keys: ['LControl', 'KeyZ'], match: 'all' },
      { keys: ['KeyZ', 'KeyB'], match: 'any' },
    ];
    const positions = [{ id: 'el-all' }, { id: 'el-any' }];

    const map = buildSpriteKeyCanonicalMap(keys, positions);

    expect(map.get('el-all')).toBe('LControl+KeyZ');
    expect(map.get('el-any')).toBe('KeyZ|KeyB');
  });

  it('빈 슬롯은 제외한다', () => {
    const keys: KeySlot[] = ['', 'KeyC'];
    const positions = [{ id: 'el-empty' }, { id: 'el-c' }];

    const map = buildSpriteKeyCanonicalMap(keys, positions);

    expect(map.size).toBe(1);
    expect(map.has('el-empty')).toBe(false);
    expect(map.get('el-c')).toBe('KeyC');
  });

  it('id 없는 위치는 제외한다', () => {
    const keys: KeySlot[] = ['KeyA', 'KeyB', 'KeyC'];
    const positions = [{ id: null }, {}, { id: 'el-c' }];

    const map = buildSpriteKeyCanonicalMap(keys, positions);

    expect(map.size).toBe(1);
    expect(map.get('el-c')).toBe('KeyC');
  });

  it('두 배열 길이가 달라도 짧은 쪽까지만 짝을 만든다', () => {
    const keysLonger: KeySlot[] = ['KeyA', 'KeyB', 'KeyC'];
    const positionsShorter = [{ id: 'el-1' }];
    expect(buildSpriteKeyCanonicalMap(keysLonger, positionsShorter).size).toBe(
      1,
    );

    const keysShorter: KeySlot[] = ['KeyA'];
    const positionsLonger = [{ id: 'el-1' }, { id: 'el-2' }];
    const map = buildSpriteKeyCanonicalMap(keysShorter, positionsLonger);
    expect(map.size).toBe(1);
    expect(map.has('el-2')).toBe(false);
  });

  it('입력이 비면 빈 맵을 돌려준다', () => {
    expect(buildSpriteKeyCanonicalMap([], []).size).toBe(0);
  });
});
