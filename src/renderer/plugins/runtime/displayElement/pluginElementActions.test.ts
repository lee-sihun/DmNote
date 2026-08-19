import { describe, expect, it, vi } from 'vitest';

vi.mock('@stores/plugin/usePluginDisplayElementStore', () => ({
  usePluginDisplayElementStore: { getState: () => ({ elements: [] }) },
}));
vi.mock('@plugins/runtime/displayElement/instancesCommitQueue', () => ({
  flushPluginInstancesEditSession: vi.fn(),
  rotatePluginInstancesEditSession: vi.fn(),
}));

import {
  materializePluginElementUpdate,
  mergePluginElementUpdatePatches,
} from './pluginElementActions';

describe('plugin element update patches', () => {
  it('partial position, size, settings를 현재 값에 병합한다', () => {
    const element = {
      id: 'item',
      fullId: 'plugin:item',
      pluginId: 'plugin',
      html: '<div />',
      position: { x: 10, y: 20 },
      measuredSize: { width: 120, height: 80 },
      settings: { accent: 'blue', opacity: 0.5 },
    } as Parameters<typeof materializePluginElementUpdate>[0];

    expect(
      materializePluginElementUpdate(element, {
        position: { y: 45 },
        measuredSize: { width: 240 },
        settings: { opacity: 0.8 },
      }),
    ).toMatchObject({
      position: { x: 10, y: 45 },
      measuredSize: { width: 240, height: 80 },
      settings: { accent: 'blue', opacity: 0.8 },
    });
  });

  it('연속 patch를 필드 단위로 병합한다', () => {
    expect(
      mergePluginElementUpdatePatches(
        { position: { x: 1 }, settings: { a: 1 } },
        { position: { y: 2 }, measuredSize: { width: 3 }, settings: { b: 2 } },
      ),
    ).toEqual({
      position: { x: 1, y: 2 },
      measuredSize: { width: 3 },
      settings: { a: 1, b: 2 },
    });
  });
});
