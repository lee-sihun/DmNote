import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendPluginRpc: vi.fn(),
  setPluginAuthorityGeneration: vi.fn(),
  sendBridgeMessageBestEffort: vi.fn(),
  listeners: new Map<string, (payload: unknown) => void>(),
}));

vi.mock('./pluginRpcClient', () => ({
  sendPluginRpc: mocks.sendPluginRpc,
  setPluginAuthorityGeneration: mocks.setPluginAuthorityGeneration,
}));

vi.mock('./pluginElementActions', () => ({
  currentAuthorityModelRevision: () => 0,
}));

vi.mock('@utils/plugin/bridgeMessages', () => ({
  sendBridgeMessageBestEffort: mocks.sendBridgeMessageBestEffort,
}));

describe('plugin settings panel write drain', () => {
  let mirror: typeof import('./pluginSettingsMirror');
  let panelStore: typeof import('@stores/grid/usePropertiesPanelStore');

  beforeEach(async () => {
    vi.resetModules();
    mocks.sendPluginRpc.mockReset();
    mocks.setPluginAuthorityGeneration.mockReset();
    mocks.sendBridgeMessageBestEffort.mockReset();
    mocks.listeners.clear();
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        bridge: {
          on: vi.fn((event: string, listener: (payload: unknown) => void) => {
            mocks.listeners.set(event, listener);
            return () => mocks.listeners.delete(event);
          }),
        },
      },
    });
    mirror = await import('./pluginSettingsMirror');
    panelStore = await import('@stores/grid/usePropertiesPanelStore');
  });

  it('in-flight 1개 뒤 연속 change를 최신 full settings 1개로 합친다', async () => {
    const changeResolvers: Array<(value: unknown) => void> = [];
    mocks.sendPluginRpc.mockImplementation((operation: string) => {
      if (operation === 'settings:mounted') {
        return Promise.resolve({ kind: 'ok', response: { modelRevision: 1 } });
      }
      return new Promise((resolve) => changeResolvers.push(resolve));
    });

    const stop = mirror.initPluginSettingsMirror();
    mocks.listeners.get('plugin:settingsSession:open')?.({
      sessionId: 'session-1',
      pluginId: 'settings-plugin',
      leaseEpoch: 3,
      descriptorGeneration: 1,
      lastSeq: 0,
      authorityGeneration: 2,
      settings: { label: 'old', size: 10 },
      originalSettings: { label: 'old', size: 10 },
      resolvedSchema: {},
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const payload =
      panelStore.usePropertiesPanelStore.getState().pluginSettingsPanel;
    payload?.onChange({ label: 'new', size: 10 });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const changes = () =>
      mocks.sendPluginRpc.mock.calls.filter(
        ([operation]) => operation === 'settings:change',
      );
    expect(changes()).toHaveLength(1);
    expect(changes()[0]?.[1]).toMatchObject({
      seq: 1,
      settings: { label: 'new', size: 10 },
    });

    for (let size = 11; size <= 110; size += 1) {
      payload?.onChange({ label: 'new', size });
    }

    const drained = mirror.drainPendingPluginSettingsWrites();
    changeResolvers[0]?.({
      kind: 'ok',
      response: { modelRevision: 2 },
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(changes()).toHaveLength(2);
    expect(changes()[1]?.[1]).toMatchObject({
      seq: 2,
      settings: { label: 'new', size: 110 },
    });
    changeResolvers[1]?.({
      kind: 'ok',
      response: { modelRevision: 3 },
    });

    await expect(drained).resolves.toBe(true);
    stop();
  });

  it('응답 불명인 최신값을 새 seq로 재전송해 ACK를 확인한다', async () => {
    const changeOutcomes = [
      { kind: 'unknown' },
      { kind: 'ok', response: { modelRevision: 4 } },
    ];
    mocks.sendPluginRpc.mockImplementation((operation: string) => {
      if (operation === 'settings:mounted') {
        return Promise.resolve({ kind: 'ok', response: { modelRevision: 1 } });
      }
      return Promise.resolve(changeOutcomes.shift());
    });

    const stop = mirror.initPluginSettingsMirror();
    mocks.listeners.get('plugin:settingsSession:open')?.({
      sessionId: 'session-2',
      pluginId: 'settings-plugin',
      leaseEpoch: 1,
      descriptorGeneration: 2,
      lastSeq: 0,
      authorityGeneration: 2,
      settings: { enabled: false },
      originalSettings: { enabled: false },
      resolvedSchema: {},
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    panelStore.usePropertiesPanelStore
      .getState()
      .pluginSettingsPanel?.onChange({ enabled: true });

    await expect(mirror.drainPendingPluginSettingsWrites()).resolves.toBe(true);
    const changeCalls = mocks.sendPluginRpc.mock.calls.filter(
      ([operation]) => operation === 'settings:change',
    );
    expect(changeCalls).toHaveLength(2);
    expect(changeCalls.map(([, payload]) => payload.seq)).toEqual([1, 2]);
    expect(changeCalls[1]?.[1].settings).toEqual({ enabled: true });
    stop();
  });

  it('confirm은 in-flight change 뒤에 마지막 full settings로 전송된다', async () => {
    let resolveChange!: (value: unknown) => void;
    let resolveConfirm!: (value: unknown) => void;
    mocks.sendPluginRpc.mockImplementation((operation: string) => {
      if (operation === 'settings:mounted') {
        return Promise.resolve({ kind: 'ok', response: { modelRevision: 1 } });
      }
      if (operation === 'settings:change') {
        return new Promise((resolve) => {
          resolveChange = resolve;
        });
      }
      if (operation === 'settings:confirm') {
        return new Promise((resolve) => {
          resolveConfirm = resolve;
        });
      }
      return Promise.resolve({ kind: 'ok', response: { modelRevision: 1 } });
    });

    const stop = mirror.initPluginSettingsMirror();
    mocks.listeners.get('plugin:settingsSession:open')?.({
      sessionId: 'session-confirm',
      pluginId: 'settings-plugin',
      leaseEpoch: 1,
      descriptorGeneration: 3,
      lastSeq: 0,
      settings: { label: 'old' },
      originalSettings: { label: 'old' },
      resolvedSchema: {},
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const payload =
      panelStore.usePropertiesPanelStore.getState().pluginSettingsPanel;
    payload?.onChange({ label: 'preview' });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    payload?.onChange({ label: 'unsent' });
    const confirmed = payload?.onConfirm(
      { label: 'confirmed' },
      { label: 'old' },
    );
    const drained = mirror.drainPendingPluginSettingsWrites();

    expect(
      mocks.sendPluginRpc.mock.calls.some(
        ([operation]) => operation === 'settings:confirm',
      ),
    ).toBe(false);
    resolveChange({ kind: 'ok', response: { modelRevision: 2 } });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const operations = mocks.sendPluginRpc.mock.calls.map(([operation]) =>
      String(operation),
    );
    expect(operations).toEqual([
      'settings:mounted',
      'settings:change',
      'settings:confirm',
    ]);
    const confirmPayload = mocks.sendPluginRpc.mock.calls.find(
      ([operation]) => operation === 'settings:confirm',
    )?.[1];
    expect(confirmPayload).toMatchObject({
      lastSeq: 1,
      settings: { label: 'confirmed' },
    });

    resolveConfirm({ kind: 'ok', response: { modelRevision: 3 } });
    await expect(confirmed).resolves.toBeUndefined();
    await expect(drained).resolves.toBe(true);
    stop();
  });

  it('cancel은 unsent latest를 버리고 in-flight change 뒤에 전송된다', async () => {
    let resolveChange!: (value: unknown) => void;
    let resolveCancel!: (value: unknown) => void;
    mocks.sendPluginRpc.mockImplementation((operation: string) => {
      if (operation === 'settings:mounted') {
        return Promise.resolve({ kind: 'ok', response: { modelRevision: 1 } });
      }
      if (operation === 'settings:change') {
        return new Promise((resolve) => {
          resolveChange = resolve;
        });
      }
      if (operation === 'settings:cancel') {
        return new Promise((resolve) => {
          resolveCancel = resolve;
        });
      }
      return Promise.resolve({ kind: 'ok', response: { modelRevision: 1 } });
    });

    const stop = mirror.initPluginSettingsMirror();
    mocks.listeners.get('plugin:settingsSession:open')?.({
      sessionId: 'session-cancel',
      pluginId: 'settings-plugin',
      leaseEpoch: 1,
      descriptorGeneration: 4,
      lastSeq: 0,
      settings: { enabled: false },
      originalSettings: { enabled: false },
      resolvedSchema: {},
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const payload =
      panelStore.usePropertiesPanelStore.getState().pluginSettingsPanel;
    payload?.onChange({ enabled: true });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    payload?.onChange({ enabled: false });
    payload?.onCancel({ enabled: false });
    const drained = mirror.drainPendingPluginSettingsWrites();

    resolveChange({ kind: 'ok', response: { modelRevision: 2 } });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(
      mocks.sendPluginRpc.mock.calls.map(([operation]) => String(operation)),
    ).toEqual(['settings:mounted', 'settings:change', 'settings:cancel']);

    resolveCancel({ kind: 'ok', response: { modelRevision: 3 } });
    await expect(drained).resolves.toBe(true);
    stop();
  });

  it('session gone 응답은 로컬 view를 닫고 drain을 실패시킨다', async () => {
    mocks.sendPluginRpc.mockImplementation((operation: string) => {
      if (operation === 'settings:mounted') {
        return Promise.resolve({ kind: 'ok', response: { modelRevision: 1 } });
      }
      return Promise.resolve({
        kind: 'error',
        errorCode: 'SESSION_LEASE_STALE',
      });
    });

    const stop = mirror.initPluginSettingsMirror();
    mocks.listeners.get('plugin:settingsSession:open')?.({
      sessionId: 'session-stale',
      pluginId: 'settings-plugin',
      leaseEpoch: 1,
      descriptorGeneration: 5,
      lastSeq: 0,
      settings: { enabled: false },
      originalSettings: { enabled: false },
      resolvedSchema: {},
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    panelStore.usePropertiesPanelStore
      .getState()
      .pluginSettingsPanel?.onChange({ enabled: true });

    await expect(mirror.drainPendingPluginSettingsWrites()).resolves.toBe(
      false,
    );
    expect(
      panelStore.usePropertiesPanelStore.getState().pluginSettingsPanel,
    ).toBeNull();
    stop();
  });
});
