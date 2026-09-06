import { describe, expect, it } from 'vitest';
import { aggregateMixedValue } from './mixedValue';

describe('aggregateMixedValue', () => {
  it('빈 목록에는 기본값을 반환한다', () => {
    expect(aggregateMixedValue([], (value) => value, 'default')).toEqual({
      isMixed: false,
      value: 'default',
    });
  });

  it('undefined를 기본값으로 정규화한 뒤 혼합 여부를 계산한다', () => {
    expect(
      aggregateMixedValue(
        [{ value: undefined }, { value: 4 }],
        (item) => item.value,
        4,
      ),
    ).toEqual({ isMixed: false, value: 4 });
  });

  it('객체 값은 기존 직렬화 비교 규칙을 유지한다', () => {
    expect(
      aggregateMixedValue(
        [{ value: { x: 1 } }, { value: { x: 2 } }],
        (item) => item.value,
        { x: 0 },
      ),
    ).toEqual({ isMixed: true, value: { x: 1 } });
  });
});
