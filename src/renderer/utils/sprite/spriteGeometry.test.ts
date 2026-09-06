import { describe, expect, it } from 'vitest';

import { anchorPx, anchorToPercent, percentToAnchor } from './spriteGeometry';

describe('spriteGeometry', () => {
  it('앵커를 이미지 상자 안의 로컬 px로 옮긴다', () => {
    const rect = { x: 10, y: 20, width: 200, height: 100 };
    expect(anchorPx(rect, { x: 0.5, y: 1 })).toEqual({ x: 110, y: 120 });
    expect(anchorPx(rect, { x: 0, y: 0 })).toEqual({ x: 10, y: 20 });
  });

  it('백분율 표시는 소수 첫째 자리까지 반올림한다', () => {
    expect(anchorToPercent(0.5)).toBe(50);
    expect(anchorToPercent(0.1234)).toBe(12.3);
    expect(anchorToPercent(1)).toBe(100);
  });

  it('백분율을 되돌릴 때 앵커 범위를 벗어나지 않는다', () => {
    expect(percentToAnchor(50)).toBe(0.5);
    expect(percentToAnchor(-40)).toBe(0);
    expect(percentToAnchor(1000)).toBe(1);
  });

  it('표시와 되돌리기가 왕복한다', () => {
    for (const value of [0, 0.25, 0.5, 0.999, 1]) {
      expect(percentToAnchor(anchorToPercent(value))).toBeCloseTo(value, 3);
    }
  });
});
