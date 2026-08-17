import { describe, expect, it } from 'vitest';
import { elementBoundsChanged, type ElementBounds } from './groupResizeUtils';

const ID_A = '00000000-0000-0000-0000-000000000001';

const boundsAt = (index: number, width = 40): ElementBounds => ({
  element: { type: 'key', id: ID_A, index },
  bounds: { x: 10, y: 20, width, height: 50 },
});

describe('elementBoundsChanged', () => {
  it('같은 요소의 locator index만 바뀌면 변경으로 취급하지 않는다', () => {
    expect(elementBoundsChanged([boundsAt(0)], [boundsAt(1)])).toBe(false);
  });

  it('같은 요소의 실제 bounds가 바뀌면 변경으로 취급한다', () => {
    expect(elementBoundsChanged([boundsAt(0)], [boundsAt(1, 41)])).toBe(true);
  });
});
