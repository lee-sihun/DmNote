import { describe, expect, it } from 'vitest';
import { stableStringify } from '@utils/core/stableStringify';

describe('stableStringify', () => {
  it('키 순서만 다른 동일 내용을 같게 직렬화한다', () => {
    const a = { x: 1, y: { b: 2, a: 3 } };
    const b = { y: { a: 3, b: 2 }, x: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('배열 순서는 보존한다', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
    expect(stableStringify([{ b: 1, a: 2 }])).toBe(
      stableStringify([{ a: 2, b: 1 }]),
    );
  });

  it('내용이 다르면 다르게 직렬화한다', () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });

  it('원시값과 null을 처리한다', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(3)).toBe('3');
    expect(stableStringify('s')).toBe('"s"');
  });
});
