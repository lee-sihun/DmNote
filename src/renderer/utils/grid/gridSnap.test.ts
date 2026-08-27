import { describe, expect, it } from 'vitest';
import { roundToGrid } from './gridSnap';

describe('roundToGrid', () => {
  it('양수 그리드면 배수로 반올림한다', () => {
    expect(roundToGrid(322.5, 5)).toBe(325);
    expect(roundToGrid(12.4, 5)).toBe(10);
  });

  it('0이면 값을 그대로 둔다', () => {
    expect(roundToGrid(322.5, 0)).toBe(322.5);
    expect(roundToGrid(12.4, 0)).toBe(12.4);
  });
});
