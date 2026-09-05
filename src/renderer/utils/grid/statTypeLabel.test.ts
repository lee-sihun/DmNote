import { describe, expect, it } from 'vitest';
import { getLooseStatTypeLabel, getStatTypeLabel } from './statTypeLabel';

describe('statTypeLabel', () => {
  it.each([
    ['kps', 'KPS'],
    ['kpsAvg', 'AVG'],
    ['kpsMax', 'MAX'],
    ['total', 'Total'],
  ] as const)('%s 유형의 표시 이름을 반환한다', (statType, expected) => {
    expect(getStatTypeLabel(statType)).toBe(expected);
    expect(getLooseStatTypeLabel(statType)).toBe(expected);
  });

  it('엄격한 모델의 빈 유형은 기존처럼 KPS로 대체한다', () => {
    expect(getStatTypeLabel()).toBe('KPS');
    expect(getStatTypeLabel(null)).toBe('KPS');
  });

  it('느슨한 런타임 값은 기존처럼 알 수 없는 유형을 그대로 표시한다', () => {
    expect(getLooseStatTypeLabel('custom')).toBe('custom');
    expect(getLooseStatTypeLabel('')).toBe('');
  });
});
