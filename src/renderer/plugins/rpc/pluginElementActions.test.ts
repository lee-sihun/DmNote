import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendPluginRpc: vi.fn(),
  sendBridgeMessageBestEffort: vi.fn(),
  updateElement: vi.fn(),
}));

vi.mock('./pluginRpcClient', () => ({
  sendPluginRpc: mocks.sendPluginRpc,
}));

vi.mock('@utils/plugin/bridgeMessages', () => ({
  sendBridgeMessageBestEffort: mocks.sendBridgeMessageBestEffort,
}));

vi.mock('@utils/plugin/panelModelSync', () => ({
  PANEL_MODEL_REQUEST_MESSAGE: 'panel:model:request',
  getPluginPanelModelRevision: () => 0,
}));

vi.mock('@stores/plugin/usePluginDisplayElementStore', () => ({
  usePluginDisplayElementStore: {
    getState: () => ({ elements: [], updateElement: mocks.updateElement }),
  },
}));

describe('plugin element panel queue', () => {
  let actions: typeof import('./pluginElementActions');

  beforeEach(async () => {
    vi.resetModules();
    mocks.sendPluginRpc.mockReset();
    mocks.sendBridgeMessageBestEffort.mockReset();
    mocks.updateElement.mockReset();
    window.__dmn_window_type = 'panel';
    actions = await import('./pluginElementActions');
  });

  it('in-flight 뒤의 중첩 patch를 필드 단위로 병합하고 drain한다', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    mocks.sendPluginRpc.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    actions.updatePluginElement('plugin:item', { position: { x: 100 } });
    actions.updatePluginElement('plugin:item', { position: { y: 200 } });
    actions.updatePluginElement('plugin:item', {
      settings: { accent: 'cyan' },
    });

    const drained = actions.drainPendingPluginElementWrites();
    expect(mocks.sendPluginRpc).toHaveBeenCalledTimes(1);

    resolvers[0]?.({ kind: 'ok', response: { modelRevision: 1 } });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(mocks.sendPluginRpc).toHaveBeenCalledTimes(2);
    expect(mocks.sendPluginRpc.mock.calls[1]?.[1]).toEqual({
      fullId: 'plugin:item',
      patch: {
        position: { y: 200 },
        settings: { accent: 'cyan' },
      },
    });

    resolvers[1]?.({ kind: 'ok', response: { modelRevision: 2 } });
    await expect(drained).resolves.toBe(true);
  });

  it('partial position, size, settings를 최신 authority 값에 병합한다', () => {
    const element = {
      id: 'item',
      fullId: 'plugin:item',
      pluginId: 'plugin',
      html: '<div />',
      position: { x: 10, y: 20 },
      measuredSize: { width: 120, height: 80 },
      settings: { accent: 'blue', opacity: 0.5 },
    } as Parameters<typeof actions.materializePluginElementUpdate>[0];

    expect(
      actions.materializePluginElementUpdate(element, {
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
});
