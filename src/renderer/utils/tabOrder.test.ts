import { describe, expect, it } from 'vitest';

import {
  buildOrderedTabs,
  clampBarCount,
  isBuiltinTabId,
  MAX_BAR_SLOTS,
  swapTabs,
  type TabPlacement,
} from './tabOrder';

const tabs = [
  { id: 'custom-a', name: '연습' },
  { id: 'custom-b', name: '기록' },
];
const label = (id: string) => `${id.replace('key', '')}버튼`;

const placement = (barCount = 4): TabPlacement => ({
  order: ['4key', '5key', '6key', '8key', 'custom-a', 'custom-b'],
  barCount,
});

describe('buildOrderedTabs', () => {
  it('순서대로 내장 라벨과 커스텀 이름을 섞어 낸다', () => {
    const result = buildOrderedTabs(
      ['4key', 'custom-b', '8key', 'custom-a'],
      tabs,
      label,
    );

    expect(result).toEqual([
      { id: '4key', name: '4버튼', isBuiltin: true },
      { id: 'custom-b', name: '기록', isBuiltin: false },
      { id: '8key', name: '8버튼', isBuiltin: true },
      { id: 'custom-a', name: '연습', isBuiltin: false },
    ]);
  });

  it('순서에만 있고 실체가 없는 커스텀 id는 버린다', () => {
    expect(
      buildOrderedTabs(['4key', 'ghost'], tabs, label).map((tab) => tab.id),
    ).toEqual(['4key']);
  });

  it('부트스트랩 전 빈 순서는 내장 모드로 폴백한다', () => {
    expect(buildOrderedTabs([], tabs, label).map((tab) => tab.id)).toEqual([
      '4key',
      '5key',
      '6key',
      '8key',
    ]);
  });
});

describe('clampBarCount', () => {
  it('상한과 하한 밖의 값을 조용히 끌어들인다', () => {
    expect(clampBarCount(0, 6)).toBe(1);
    expect(clampBarCount(-3, 6)).toBe(1);
    expect(clampBarCount(9, 6)).toBe(MAX_BAR_SLOTS);
    expect(clampBarCount(3, 6)).toBe(3);
  });

  it('순서 길이보다 클 수 없다', () => {
    expect(clampBarCount(4, 2)).toBe(2);
  });
});

describe('swapTabs', () => {
  it('두 탭이 자리를 맞바꾼다', () => {
    const next = swapTabs(placement(), '5key', '8key');

    expect(next.order).toEqual([
      '4key',
      '8key',
      '6key',
      '5key',
      'custom-a',
      'custom-b',
    ]);
    expect(next.barCount).toBe(4);
  });

  it('바에 하나만 있어도 팝업 탭과는 바꿀 수 있다', () => {
    const next = swapTabs(placement(1), '4key', 'custom-b');

    expect(next.order[0]).toBe('custom-b');
    // 바에 있는 개수는 그대로다 - 빈 바가 되지 않는다
    expect(next.barCount).toBe(1);
  });

  it('교체는 id를 늘리거나 잃지 않는다', () => {
    const base = placement();
    const next = swapTabs(base, '4key', 'custom-b');

    expect(new Set(next.order).size).toBe(next.order.length);
    expect([...next.order].sort()).toEqual([...base.order].sort());
  });

  it('같은 탭이거나 없는 탭이면 그대로 둔다', () => {
    const base = placement();
    expect(swapTabs(base, '5key', '5key')).toBe(base);
    expect(swapTabs(base, '5key', 'ghost')).toBe(base);
  });
});

describe('isBuiltinTabId', () => {
  it('내장 모드만 참이다', () => {
    expect(isBuiltinTabId('6key')).toBe(true);
    expect(isBuiltinTabId('custom-a')).toBe(false);
  });
});
