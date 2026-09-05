import { describe, expect, it } from 'vitest';
import type {
  CanonicalKeyPosition,
  CanonicalStatItemPosition,
} from '@src/types/editor';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import { createSelectionClipboardSnapshot } from './selectionClipboard';

describe('createSelectionClipboardSnapshot', () => {
  it('선택 순서대로 미할당 키와 native·plugin payload를 동결한다', () => {
    const key = { id: 'key', dx: 1, dy: 2 } as CanonicalKeyPosition;
    const stat = {
      id: 'stat',
      dx: 3,
      dy: 4,
      statType: 'total',
    } as CanonicalStatItemPosition;
    const plugin = {
      id: 'instance',
      fullId: 'plugin::instance',
      pluginId: 'plugin',
      position: { x: 5, y: 6 },
    } as PluginDisplayElementInternal;

    const snapshot = createSelectionClipboardSnapshot({
      selectedElements: [
        { type: 'plugin', id: plugin.fullId },
        { type: 'key', id: key.id, index: 0 },
        { type: 'stat', id: stat.id, index: 0 },
        { type: 'graph', id: 'missing', index: 0 },
      ],
      keyMappings: [''],
      keyPositions: [key],
      statPositions: [stat],
      graphPositions: [],
      knobPositions: [],
      pluginElements: [plugin],
      selectedGroupIds: [],
      layerGroups: [],
      collapsedGroupIds: new Set(),
    });

    expect(snapshot.items.map((item) => item.type)).toEqual([
      'plugin',
      'key',
      'stat',
    ]);
    expect(snapshot.items[0]).not.toHaveProperty('element.fullId');
    expect(snapshot.items[1]).toMatchObject({ type: 'key', keyCode: '' });
    expect(
      snapshot.items[1].type === 'key' && snapshot.items[1].position,
    ).not.toBe(key);
  });

  it('존재하는 선택 그룹만 접힘 상태와 함께 보존한다', () => {
    const snapshot = createSelectionClipboardSnapshot({
      selectedElements: [],
      keyMappings: [],
      keyPositions: [],
      statPositions: [],
      graphPositions: [],
      knobPositions: [],
      pluginElements: [],
      selectedGroupIds: ['collapsed', 'missing', 'open'],
      layerGroups: [
        { id: 'collapsed', name: 'Collapsed' },
        { id: 'open', name: 'Open' },
      ],
      collapsedGroupIds: new Set(['collapsed']),
    });

    expect(snapshot.groups).toEqual([
      { id: 'collapsed', name: 'Collapsed', collapsed: true },
      { id: 'open', name: 'Open', collapsed: undefined },
    ]);
  });
});
