import { describe, expect, it } from 'vitest';

import { addKey, createDefaultKeyPosition, duplicateKey } from './keys';
import type { KeyMappings, KeyPositions } from '@src/types/key/keys';

// 생성·복제는 항상 새 신원을 받는다. source id를 물려받으면 커밋 후보 안
// 중복 ID로 백엔드가 원자 거절한다 (stable-id-contract 2·4절)
describe('요소 신원 발급', () => {
  it('신규 생성마다 서로 다른 id를 발급한다', () => {
    const first = createDefaultKeyPosition();
    const second = createDefaultKeyPosition();

    expect(first.id).toBeTruthy();
    expect(second.id).toBeTruthy();
    expect(first.id).not.toBe(second.id);
  });

  it('복제본은 source의 id를 물려받지 않는다', () => {
    const mappings: KeyMappings = { '4key': ['KeyA'] };
    const source = createDefaultKeyPosition(10, 20);
    const positions: KeyPositions = { '4key': [source] };

    const result = duplicateKey(mappings, positions, '4key', 0, 30, 40);

    expect(result).not.toBeNull();
    const cloned = result!.positions['4key'][1];
    expect(cloned.id).toBeTruthy();
    expect(cloned.id).not.toBe(source.id);
    // 신원 외 스타일은 복제된다
    expect(cloned.width).toBe(source.width);
  });

  it('addKey 경로도 새 id를 발급한다', () => {
    const result = addKey({}, {}, '4key', 0, 0);

    expect(result.positions['4key'][0].id).toBeTruthy();
  });
});
