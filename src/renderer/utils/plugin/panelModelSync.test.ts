import { describe, expect, it } from 'vitest';

import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import { toPluginPanelElementView } from './panelModelSync';

const makeElement = (): PluginDisplayElementInternal => ({
  id: 'element-a',
  fullId: 'plugin-a:element-a',
  pluginId: 'plugin-a',
  definitionId: 'definition-a',
  html: '<div>large render payload</div>',
  position: { x: 10, y: 20 },
  measuredSize: { width: 120, height: 80 },
  estimatedSize: { width: 100, height: 60 },
  resizeAnchor: 'center',
  zIndex: 7,
  hidden: true,
  settings: {
    label: 'panel',
    nested: { visible: true, callback: () => {} },
  },
  state: { transient: 'do-not-send' },
  style: { color: 'red' },
  onClick: () => {},
  contextMenu: {
    enableDelete: true,
    customItems: [
      {
        id: 'custom',
        label: 'Custom',
        onClick: () => {},
      },
    ],
  },
  tabId: '4key',
});

describe('plugin panel element projection', () => {
  it('패널 편집에 필요한 필드만 투영한다', () => {
    const view = toPluginPanelElementView(makeElement());

    expect(view).toMatchObject({
      id: 'element-a',
      fullId: 'plugin-a:element-a',
      pluginId: 'plugin-a',
      definitionId: 'definition-a',
      position: { x: 10, y: 20 },
      measuredSize: { width: 120, height: 80 },
      estimatedSize: { width: 100, height: 60 },
      resizeAnchor: 'center',
      zIndex: 7,
      hidden: true,
      settings: { label: 'panel', nested: { visible: true } },
      tabId: '4key',
    });
    expect(view).not.toHaveProperty('html');
    expect(view).not.toHaveProperty('state');
    expect(view).not.toHaveProperty('style');
    expect(view).not.toHaveProperty('onClick');
    expect(view).not.toHaveProperty('contextMenu');
  });
});
