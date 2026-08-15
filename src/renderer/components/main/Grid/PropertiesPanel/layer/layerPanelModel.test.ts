import { describe, expect, it } from 'vitest';

import { buildLayerItems } from './layerPanelModel';

const plugin = (fullId: string, tabId?: string, groupId?: string) =>
  ({
    id: fullId,
    fullId,
    pluginId: 'plugin-a',
    definitionId: 'plugin-a',
    position: { x: 0, y: 0 },
    tabId,
    zIndex: 1,
    hidden: false,
    groupId,
  } as never);

describe('layer panel plugin mode scope', () => {
  it('현재 mode와 전역 plugin만 포함하고 다른 mode는 제외한다', () => {
    const items = buildLayerItems({
      selectedKeyType: '4key',
      positions: {},
      keyMappings: {},
      statPositions: {},
      graphPositions: {},
      knobPositions: {},
      pluginElements: [
        plugin('same', '4key'),
        plugin('global'),
        plugin('other', '7key'),
      ],
      layerGroupsForMode: [],
    });

    expect(items.map((item) => item.id).sort()).toEqual(['global', 'same']);
  });

  it('plugin groupId는 현재 mode에 def가 있을 때만 노출한다', () => {
    const items = buildLayerItems({
      selectedKeyType: '4key',
      positions: {},
      keyMappings: {},
      statPositions: {},
      graphPositions: {},
      knobPositions: {},
      pluginElements: [
        plugin('grouped', '4key', 'group-a'),
        plugin('dangling', '4key', 'group-missing'),
      ],
      layerGroupsForMode: [{ id: 'group-a', name: 'Group A' }],
    });

    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get('grouped')?.groupId).toBe('group-a');
    // dangling group_id는 무소속으로 취급 - 유령 그룹 헤더 방지
    expect(byId.get('dangling')?.groupId).toBeUndefined();
  });
});
