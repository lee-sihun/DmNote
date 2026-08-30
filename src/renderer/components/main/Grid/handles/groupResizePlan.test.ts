import { describe, expect, it } from 'vitest';

import {
  calculateGroupResizePlan,
  type GroupResizeHandle,
} from './groupResizePlan';
import type { ElementBounds } from './groupResizeUtils';

const ID_A = '00000000-0000-0000-0000-000000000001';
const ID_B = '00000000-0000-0000-0000-000000000002';

const elementBounds: ElementBounds[] = [
  {
    element: { type: 'key', id: ID_A, index: 0 },
    bounds: { x: 100, y: 200, width: 40, height: 40 },
  },
  {
    element: { type: 'key', id: ID_B, index: 1 },
    bounds: { x: 160, y: 240, width: 40, height: 40 },
  },
];

const handle = (
  id: string,
  dx: -1 | 0 | 1,
  dy: -1 | 0 | 1,
): GroupResizeHandle => ({
  id,
  cursor:
    dx === 0
      ? 'ns-resize'
      : dy === 0
      ? 'ew-resize'
      : id === 'nw' || id === 'se'
      ? 'nwse-resize'
      : 'nesw-resize',
  x: 0,
  y: 0,
  dx,
  dy,
  type: dx !== 0 && dy !== 0 ? 'corner' : dy !== 0 ? 'edge-h' : 'edge-v',
});

const calculate = (
  resizeHandle: GroupResizeHandle,
  pointerX = 20,
  pointerY = 10,
  overrides: Partial<Parameters<typeof calculateGroupResizePlan>[0]> = {},
) =>
  calculateGroupResizePlan({
    handle: resizeHandle,
    startMouseX: 0,
    startMouseY: 0,
    pointerX,
    pointerY,
    zoom: 1,
    snapSize: 1,
    startGroupBounds: { x: 100, y: 200, width: 100, height: 80 },
    startElementBounds: elementBounds,
    maxShrinkX: 90,
    maxShrinkY: 70,
    smartSnap: { type: 'unchanged' },
    ...overrides,
  });

describe('calculateGroupResizePlan', () => {
  it.each([
    ['nw', -1, -1, { x: 120, y: 210, width: 80, height: 70 }],
    ['n', 0, -1, { x: 100, y: 210, width: 100, height: 70 }],
    ['ne', 1, -1, { x: 100, y: 210, width: 120, height: 70 }],
    ['w', -1, 0, { x: 120, y: 200, width: 80, height: 80 }],
    ['e', 1, 0, { x: 100, y: 200, width: 120, height: 80 }],
    ['sw', -1, 1, { x: 120, y: 200, width: 80, height: 90 }],
    ['s', 0, 1, { x: 100, y: 200, width: 100, height: 90 }],
    ['se', 1, 1, { x: 100, y: 200, width: 120, height: 90 }],
  ] as const)('%s 방향은 고정 반대편을 유지한다', (id, dx, dy, expected) => {
    expect(calculate(handle(id, dx, dy)).result.groupBounds).toEqual(expected);
  });

  it('corner는 두 축을, edge는 자기 축만 요소에 스케일한다', () => {
    const corner = calculate(handle('se', 1, 1)).result.elementBounds[0];
    const edge = calculate(handle('e', 1, 0)).result.elementBounds[0];

    expect(corner.bounds).toEqual({
      x: 100,
      y: 200,
      width: 48,
      height: 45,
    });
    expect(edge.bounds).toEqual({
      x: 100,
      y: 200,
      width: 48,
      height: 40,
    });
  });

  it('client delta를 zoom으로 보정한 뒤 grid에 스냅한다', () => {
    const plan = calculate(handle('se', 1, 1), 26, 26, {
      zoom: 2,
      snapSize: 5,
    });

    expect(plan.result.groupBounds).toEqual({
      x: 100,
      y: 200,
      width: 115,
      height: 95,
    });
  });

  it('리사이즈 불가능한 요소는 원래 bounds를 유지한 채 최종 그룹에 포함한다', () => {
    const fixed: ElementBounds = {
      element: { type: 'plugin', id: 'fixed' },
      bounds: { x: 80, y: 180, width: 30, height: 30 },
    };
    const plan = calculate(handle('se', 1, 1), 20, 10, {
      nonResizableElementBounds: [fixed],
    });

    expect(plan.result.elementBounds).toHaveLength(2);
    expect(plan.result.groupBounds).toEqual({
      x: 80,
      y: 180,
      width: 140,
      height: 110,
    });
    expect(fixed.bounds).toEqual({ x: 80, y: 180, width: 30, height: 30 });
  });
});
