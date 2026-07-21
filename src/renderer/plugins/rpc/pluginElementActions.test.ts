import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendPluginRpc: vi.fn(),
  sendBridgeMessageBestEffort: vi.fn(),
  updateElement: vi.fn(),
  setElements: vi.fn(),
  rotateEditSession: vi.fn(),
  elements: [] as Array<{
    fullId: string;
    pluginId: string;
  }>,
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
    getState: () => ({
      elements: mocks.elements,
      setElements: mocks.setElements,
      updateElement: mocks.updateElement,
    }),
  },
}));

vi.mock('@plugins/runtime/displayElement/instancesCommitQueue', () => ({
  rotatePluginInstancesEditSession: mocks.rotateEditSession,
}));

describe('plugin element panel queue', () => {
  let actions: typeof import('./pluginElementActions');

  beforeEach(async () => {
    vi.resetModules();
    mocks.sendPluginRpc.mockReset();
    mocks.sendBridgeMessageBestEffort.mockReset();
    mocks.updateElement.mockReset();
    mocks.setElements.mockReset();
    mocks.rotateEditSession.mockReset();
    mocks.elements = [];
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

  it('main의 discrete 삭제는 대상 플러그인별 세션을 먼저 분리한다', () => {
    window.__dmn_window_type = 'main';
    mocks.elements = [
      { fullId: 'plugin-a:one', pluginId: 'plugin-a' },
      { fullId: 'plugin-a:two', pluginId: 'plugin-a' },
      { fullId: 'plugin-b:one', pluginId: 'plugin-b' },
      { fullId: 'plugin-c:one', pluginId: 'plugin-c' },
    ];

    actions.deletePluginElements([
      'plugin-a:one',
      'plugin-a:two',
      'plugin-b:one',
    ]);

    expect(mocks.rotateEditSession).toHaveBeenCalledTimes(2);
    expect(mocks.rotateEditSession).toHaveBeenCalledWith('plugin-a');
    expect(mocks.rotateEditSession).toHaveBeenCalledWith('plugin-b');
    expect(mocks.setElements).toHaveBeenCalledWith([
      { fullId: 'plugin-c:one', pluginId: 'plugin-c' },
    ]);
  });

  it('main의 가시성 변경은 대상 플러그인별 세션을 먼저 분리한다', () => {
    window.__dmn_window_type = 'main';
    mocks.elements = [
      { fullId: 'plugin-a:one', pluginId: 'plugin-a' },
      { fullId: 'plugin-a:two', pluginId: 'plugin-a' },
      { fullId: 'plugin-b:one', pluginId: 'plugin-b' },
    ];

    actions.setPluginElementsHidden([
      { fullId: 'plugin-a:one', hidden: true },
      { fullId: 'plugin-a:two', hidden: true },
      { fullId: 'plugin-b:one', hidden: false },
    ]);

    expect(mocks.rotateEditSession).toHaveBeenCalledTimes(2);
    expect(mocks.rotateEditSession).toHaveBeenCalledWith('plugin-a');
    expect(mocks.rotateEditSession).toHaveBeenCalledWith('plugin-b');
    expect(mocks.rotateEditSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateElement.mock.invocationCallOrder[0]!,
    );
    expect(mocks.updateElement).toHaveBeenCalledTimes(3);
  });

  it('main의 레이어 순서 변경은 대상 플러그인별 세션을 먼저 분리한다', () => {
    window.__dmn_window_type = 'main';
    mocks.elements = [
      { fullId: 'plugin-a:one', pluginId: 'plugin-a' },
      { fullId: 'plugin-b:one', pluginId: 'plugin-b' },
    ];

    actions.setPluginElementZIndexes([
      { fullId: 'plugin-a:one', zIndex: 10 },
      { fullId: 'plugin-b:one', zIndex: 9 },
    ]);

    expect(mocks.rotateEditSession).toHaveBeenCalledTimes(2);
    expect(mocks.rotateEditSession).toHaveBeenCalledWith('plugin-a');
    expect(mocks.rotateEditSession).toHaveBeenCalledWith('plugin-b');
    expect(mocks.rotateEditSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateElement.mock.invocationCallOrder[0]!,
    );
    expect(mocks.updateElement).toHaveBeenCalledTimes(2);
  });
});
