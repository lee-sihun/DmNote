import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JsPlugin } from '@src/types/plugin/js';

const mocks = vi.hoisted(() => ({
  currentPluginHealthRevision: vi.fn(),
  waitForPluginInjection: vi.fn(),
  load: vi.fn(),
  reload: vi.fn(),
  remove: vi.fn(),
  setPluginEnabled: vi.fn(),
  hasData: vi.fn(),
  clearByPrefix: vi.fn(),
}));

vi.mock('@stores/plugin/usePluginHealthStore', () => ({
  currentPluginHealthRevision: mocks.currentPluginHealthRevision,
  waitForPluginInjection: mocks.waitForPluginInjection,
}));

vi.mock('@api/modules/plugin/jsApi', () => ({
  jsApi: {
    load: mocks.load,
    reload: mocks.reload,
    remove: mocks.remove,
    setPluginEnabled: mocks.setPluginEnabled,
  },
}));

vi.mock('@api/modules/plugin/pluginApi', () => ({
  pluginApi: {
    storage: {
      hasData: mocks.hasData,
      clearByPrefix: mocks.clearByPrefix,
    },
  },
}));

import { createSettingsPluginLifecycleController } from './settingsPluginLifecycleController';

const makePlugin = (overrides: Partial<JsPlugin> = {}): JsPlugin => ({
  id: 'alpha-id',
  name: 'Alpha.js',
  path: '/plugins/Alpha.js',
  content: '// @id alpha\nrun()',
  enabled: true,
  ...overrides,
});

const translate = (
  key: string,
  params?: Record<string, string | number>,
): string => (params ? `${key}:${JSON.stringify(params)}` : key);

const createHarness = (jsPlugins: JsPlugin[] = []) => {
  const showAlert = vi.fn();
  const setPluginToDelete = vi.fn();
  const setDataDeleteModalOpen = vi.fn();
  const setIsReloadingPlugins = vi.fn();
  const setIsAddingPlugins = vi.fn();
  const setPendingPluginId = vi.fn();
  const reloadingPluginsRef = { current: false };
  const addingPluginsRef = { current: false };
  const pendingPluginRef = { current: null as string | null };
  const removingPluginRef = { current: null as string | null };

  const controller = createSettingsPluginLifecycleController({
    t: translate,
    showAlert,
    jsPlugins,
    setPluginToDelete,
    setDataDeleteModalOpen,
    setIsReloadingPlugins,
    setIsAddingPlugins,
    setPendingPluginId,
    reloadingPluginsRef,
    addingPluginsRef,
    pendingPluginRef,
    removingPluginRef,
  });

  return {
    ...controller,
    showAlert,
    setPluginToDelete,
    setDataDeleteModalOpen,
    setIsReloadingPlugins,
    setIsAddingPlugins,
    setPendingPluginId,
    reloadingPluginsRef,
    addingPluginsRef,
    pendingPluginRef,
    removingPluginRef,
  };
};

describe('Settings 플러그인 생명주기 controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentPluginHealthRevision.mockReturnValue(7);
    mocks.waitForPluginInjection.mockResolvedValue({
      outcome: 'settled',
      health: {},
    });
    mocks.load.mockResolvedValue({ success: true, added: [] });
    mocks.reload.mockResolvedValue({ updated: [] });
    mocks.remove.mockResolvedValue({ success: true });
    mocks.setPluginEnabled.mockResolvedValue({ success: true });
    mocks.hasData.mockResolvedValue(false);
    mocks.clearByPrefix.mockResolvedValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('추가 시 요청 전 revision을 잡고 주입 대상만 기다린 뒤 오류를 합산한다', async () => {
    const alpha = makePlugin();
    const disabled = makePlugin({
      id: 'disabled-id',
      name: 'Disabled.js',
      enabled: false,
    });
    const empty = makePlugin({
      id: 'empty-id',
      name: 'Empty.js',
      content: '',
    });
    const order: string[] = [];
    mocks.currentPluginHealthRevision.mockImplementation(() => {
      order.push('revision');
      return 7;
    });
    mocks.load.mockImplementation(async () => {
      order.push('load');
      return {
        success: true,
        added: [alpha, disabled, empty],
        errors: [{ path: '/bad.js', error: 'read failed' }],
      };
    });
    mocks.waitForPluginInjection.mockImplementation(async () => {
      order.push('injection');
      return {
        outcome: 'settled' as const,
        health: { 'alpha-id': { status: 'failed' as const, message: '' } },
      };
    });
    const harness = createHarness();

    await harness.handleAddPlugins();

    expect(order).toEqual(['revision', 'load', 'injection']);
    expect(mocks.waitForPluginInjection).toHaveBeenCalledWith(7, ['alpha-id']);
    expect(harness.showAlert).toHaveBeenCalledWith(
      'settings.jsAddPartial:{"count":3}\n/bad.js: read failed\n/plugins/Alpha.js: settings.jsRuntimeError',
    );
    expect(harness.setIsAddingPlugins.mock.calls).toEqual([[true], [false]]);
    expect(harness.addingPluginsRef.current).toBe(false);
  });

  it('리로드 주입이 정산되지 않으면 적용 실패로 세고 spinner 최소 시간 계약을 유지한다', async () => {
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(310);
    const alpha = makePlugin();
    mocks.reload.mockResolvedValue({ updated: [alpha] });
    mocks.waitForPluginInjection.mockResolvedValue({
      outcome: 'timeout',
      health: {},
    });
    const harness = createHarness([alpha]);

    await harness.handleReloadPlugins();

    expect(mocks.currentPluginHealthRevision).toHaveBeenCalledBefore(
      mocks.reload,
    );
    expect(mocks.waitForPluginInjection).toHaveBeenCalledWith(7, ['alpha-id']);
    expect(harness.showAlert).toHaveBeenCalledWith(
      'settings.jsReloadFailed\n/plugins/Alpha.js: settings.jsNotApplied',
    );
    expect(harness.setIsReloadingPlugins.mock.calls).toEqual([[true], [false]]);
    expect(harness.reloadingPluginsRef.current).toBe(false);
  });

  it('toggle은 pending 동안 중복 요청을 막고 실패를 알린 뒤 pending을 정산한다', async () => {
    mocks.setPluginEnabled.mockResolvedValue({ success: false });
    const harness = createHarness();

    const first = harness.handlePluginToggle('alpha-id', false);
    await harness.handlePluginToggle('beta-id', true);
    await first;

    expect(mocks.setPluginEnabled).toHaveBeenCalledTimes(1);
    expect(mocks.setPluginEnabled).toHaveBeenCalledWith('alpha-id', false);
    expect(harness.showAlert).toHaveBeenCalledWith(
      'settings.jsPluginToggleFailed',
    );
    expect(harness.setPendingPluginId.mock.calls).toEqual([
      ['alpha-id'],
      [null],
    ]);
    expect(harness.pendingPluginRef.current).toBeNull();
  });

  it('저장 데이터가 있으면 제거하지 않고 실제 namespace와 확인 모달 대상을 남긴다', async () => {
    mocks.hasData.mockResolvedValue(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const alpha = makePlugin();
    const harness = createHarness([alpha]);

    await harness.handlePluginRemove(alpha.id);

    expect(mocks.hasData).toHaveBeenCalledWith('alpha/');
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(harness.setPluginToDelete).toHaveBeenCalledWith({
      id: 'alpha-id',
      name: 'Alpha.js',
      namespace: 'alpha',
    });
    expect(harness.setDataDeleteModalOpen).toHaveBeenCalledWith(true);
    expect(harness.removingPluginRef.current).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      '[PluginRemove] namespace=',
      'alpha',
      'hasData=',
      true,
    );
  });

  it('플러그인만 제거하는 동안 중복 요청을 막고 성공 뒤 상태를 정산한다', async () => {
    let resolveRemove: ((result: { success: boolean }) => void) | undefined;
    mocks.remove.mockImplementation(
      () =>
        new Promise<{ success: boolean }>((resolve) => {
          resolveRemove = resolve;
        }),
    );
    const harness = createHarness();

    const first = harness.removePluginOnly('alpha-id');
    await harness.removePluginOnly('beta-id');

    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith('alpha-id');
    expect(harness.removingPluginRef.current).toBe('alpha-id');
    expect(harness.setPendingPluginId).toHaveBeenCalledTimes(1);
    expect(harness.setPendingPluginId).toHaveBeenCalledWith('alpha-id');

    resolveRemove?.({ success: true });
    await first;

    expect(harness.showAlert).not.toHaveBeenCalled();
    expect(harness.removingPluginRef.current).toBeNull();
    expect(harness.pendingPluginRef.current).toBeNull();
    expect(harness.setPendingPluginId.mock.calls).toEqual([
      ['alpha-id'],
      [null],
    ]);
    expect(harness.setDataDeleteModalOpen).toHaveBeenCalledWith(false);
    expect(harness.setPluginToDelete).toHaveBeenCalledWith(null);
  });

  it('플러그인만 제거에 실패해도 경고하고 상태를 정산한다', async () => {
    mocks.remove.mockResolvedValue({ success: false });
    const harness = createHarness();

    await harness.removePluginOnly('alpha-id');

    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith('alpha-id');
    expect(harness.showAlert).toHaveBeenCalledWith(
      'settings.jsPluginRemoveFailed',
    );
    expect(harness.removingPluginRef.current).toBeNull();
    expect(harness.pendingPluginRef.current).toBeNull();
    expect(harness.setPendingPluginId.mock.calls).toEqual([
      ['alpha-id'],
      [null],
    ]);
    expect(harness.setDataDeleteModalOpen).toHaveBeenCalledWith(false);
    expect(harness.setPluginToDelete).toHaveBeenCalledWith(null);
  });

  it('데이터 포함 제거는 remove 정산 뒤 prefix를 지우고 실패여도 모달 상태를 닫는다', async () => {
    const order: string[] = [];
    mocks.remove.mockImplementation(async () => {
      order.push('remove');
      return { success: false };
    });
    mocks.clearByPrefix.mockImplementation(async () => {
      order.push('clear');
      return 2;
    });
    const alpha = makePlugin();
    const harness = createHarness([alpha]);

    await harness.removePluginWithData(alpha.id);

    expect(order).toEqual(['remove', 'clear']);
    expect(mocks.clearByPrefix).toHaveBeenCalledWith('alpha/');
    expect(harness.showAlert).toHaveBeenCalledWith(
      'settings.jsPluginRemoveFailed',
    );
    expect(harness.setPendingPluginId.mock.calls).toEqual([
      ['alpha-id'],
      [null],
    ]);
    expect(harness.setDataDeleteModalOpen).toHaveBeenCalledWith(false);
    expect(harness.setPluginToDelete).toHaveBeenCalledWith(null);
  });
});
