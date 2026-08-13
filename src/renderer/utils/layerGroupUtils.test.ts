import { describe, expect, it } from 'vitest';

import { orderPastedItemsByFrozenZ } from './layerGroupUtils';

describe('orderPastedItemsByFrozenZ', () => {
  it('원본 스택 순서를 따른다 (payload 타입 순서가 아니라)', () => {
    // 마퀴 선택은 key를 먼저 담으므로 payload는 [key, stat]이지만
    // 원본에서는 stat이 위에 있다
    const ordered = orderPastedItemsByFrozenZ([
      { id: 'key', zIndex: 1 },
      { id: 'stat', zIndex: 5 },
    ]);

    expect(ordered.map((item) => item.id)).toEqual(['stat', 'key']);
  });

  it('같은 타입 안에서도 z 내림차순을 따른다', () => {
    const ordered = orderPastedItemsByFrozenZ([
      { id: 'a', zIndex: 0 },
      { id: 'b', zIndex: 9 },
      { id: 'c', zIndex: 4 },
    ]);

    expect(ordered.map((item) => item.id)).toEqual(['b', 'c', 'a']);
  });

  it('z가 같으면 payload 순서를 유지한다', () => {
    const ordered = orderPastedItemsByFrozenZ([
      { id: 'first', zIndex: 3 },
      { id: 'second', zIndex: 3 },
      { id: 'third', zIndex: 3 },
    ]);

    expect(ordered.map((item) => item.id)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });
});
