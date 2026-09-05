import { describe, expect, it } from 'vitest';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import {
  moveSelectedNativePositions,
  moveSelectedPluginElements,
  selectedPluginIds,
} from './selectionMovement';

describe('selectionMovement', () => {
  it('선택한 native ID만 이동하고 다른 모드와 미선택 참조를 보존한다', () => {
    const selected = { id: 'selected', dx: 1, dy: 2, width: 60 };
    const untouched = { id: 'untouched', dx: 3, dy: 4, width: 70 };
    const otherMode = [{ id: 'other', dx: 5, dy: 6, width: 80 }];
    const source = { mode: [selected, untouched], other: otherMode };

    const result = moveSelectedNativePositions(
      source,
      'mode',
      new Set(['selected']),
      10,
      -5,
    );

    expect(result.mode[0]).toEqual({
      id: 'selected',
      dx: 11,
      dy: -3,
      width: 60,
    });
    expect(result.mode[1]).toBe(untouched);
    expect(result.other).toBe(otherMode);
  });

  it('plugin 이동과 plugin별 scope 중복 제거를 같은 안정 ID 집합으로 계산한다', () => {
    const elements = [
      {
        fullId: 'plugin:first',
        pluginId: 'plugin',
        position: { x: 1, y: 2 },
      },
      {
        fullId: 'plugin:second',
        pluginId: 'plugin',
        position: { x: 3, y: 4 },
      },
      {
        fullId: 'other:first',
        pluginId: 'other',
        position: { x: 5, y: 6 },
      },
    ] as PluginDisplayElementInternal[];
    const selected = new Set(['plugin:first', 'plugin:second']);

    expect(selectedPluginIds(elements, selected)).toEqual(['plugin']);
    const moved = moveSelectedPluginElements(elements, selected, 2, 3);
    expect(moved.map((element) => element.position)).toEqual([
      { x: 3, y: 5 },
      { x: 5, y: 7 },
      { x: 5, y: 6 },
    ]);
    expect(moved[2]).toBe(elements[2]);
  });
});
