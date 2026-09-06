import { describe, expect, it } from 'vitest';

import {
  collectElementsInKeyRange,
  getKeySelectionBounds,
} from './rangeSelection';

describe('getKeySelectionBounds', () => {
  it('키 위치를 선택 앵커로 변환하며 0 크기의 기존 폴백을 유지한다', () => {
    expect(
      getKeySelectionBounds({ dx: 3, dy: 4, width: 0, height: 0 }),
    ).toEqual({ x: 3, y: 4, width: 60, height: 60 });
  });
});

describe('collectElementsInKeyRange', () => {
  it('키 앵커와 클릭 키 사이의 모든 요소를 기존 타입 순서로 수집한다', () => {
    const selected = collectElementsInKeyRange(
      { x: 0, y: 0, width: 60, height: 60 },
      { id: 'key:two', dx: 200, dy: 100, width: 60, height: 60 },
      {
        mode: 'default',
        keyPositions: [
          { id: 'key:one', dx: 0, dy: 0 },
          { id: 'key:two', dx: 200, dy: 100 },
          { id: 'key:outside', dx: 400, dy: 400 },
        ],
        pluginElements: [
          {
            fullId: 'plugin:one',
            position: { x: 100, y: 50 },
            measuredSize: { width: 20, height: 20 },
          },
        ],
        statPositions: [{ id: 'stat:one', dx: 20, dy: 70 }],
        graphPositions: [{ id: 'graph:one', dx: 60, dy: 20 }],
        knobPositions: [{ id: 'knob:one', dx: 160, dy: 70 }],
        spritePositions: [{ id: 'sprite:one', dx: 40, dy: 40 }],
      },
    );

    expect(selected.map(({ type, id }) => `${type}:${id}`)).toEqual([
      'key:key:one',
      'key:key:two',
      'plugin:plugin:one',
      'stat:stat:one',
      'graph:graph:one',
      'knob:knob:one',
      'sprite:sprite:one',
    ]);
  });

  it('다른 탭·미측정 plugin과 숨은 native 요소를 제외한다', () => {
    const selected = collectElementsInKeyRange(
      { x: 0, y: 0, width: 60, height: 60 },
      { id: 'key:two', dx: 200, dy: 100 },
      {
        mode: 'default',
        keyPositions: [],
        pluginElements: [
          {
            fullId: 'plugin:other-tab',
            tabId: 'other',
            position: { x: 10, y: 10 },
            measuredSize: { width: 20, height: 20 },
          },
          {
            fullId: 'plugin:unmeasured',
            position: { x: 10, y: 10 },
          },
        ],
        statPositions: [{ id: 'stat:hidden', dx: 10, dy: 10, hidden: true }],
        graphPositions: [null, undefined],
        knobPositions: [{ id: 'knob:outside', dx: 500, dy: 500 }],
        spritePositions: [
          { id: 'sprite:hidden', dx: 10, dy: 10, hidden: true },
        ],
      },
    );

    expect(selected).toEqual([]);
  });

  it('0 크기는 기존 || 기본값 계약으로 선택 영역을 확장한다', () => {
    const selected = collectElementsInKeyRange(
      { x: 0, y: 0, width: 10, height: 10 },
      { id: 'clicked', dx: 20, dy: 20, width: 0, height: 0 },
      {
        mode: 'default',
        keyPositions: [{ id: 'edge', dx: 70, dy: 70, width: 1, height: 1 }],
        pluginElements: [],
        statPositions: [],
        graphPositions: [],
        knobPositions: [],
        spritePositions: [],
      },
    );

    expect(selected).toEqual([{ type: 'key', id: 'edge', index: 0 }]);
  });
});
