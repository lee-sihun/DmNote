import { describe, expect, it } from 'vitest';

import { buildLayerItems } from './layerPanelModel';

const plugin = (fullId: string, tabId?: string) =>
  ({
    id: fullId,
    fullId,
    pluginId: 'plugin-a',
    definitionId: 'plugin-a',
    position: { x: 0, y: 0 },
    tabId,
    zIndex: 1,
    hidden: false,
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
    });

    expect(items.map((item) => item.id).sort()).toEqual(['global', 'same']);
  });
});
