import { describe, expect, it } from 'vitest';

import { clamp } from './clamp';

describe('clamp', () => {
  it('범위 안의 값은 그대로 둔다', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('경계 밖은 가까운 경계로 접는다', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
  });

  it('역전 범위에서는 max가 이긴다 (백엔드 클램프와 같은 순서)', () => {
    expect(clamp(7, 10, 5)).toBe(5);
  });

  it('NaN은 그대로 통과한다 - 입력 검증은 호출부 몫', () => {
    expect(Number.isNaN(clamp(Number.NaN, 0, 10))).toBe(true);
  });
});
