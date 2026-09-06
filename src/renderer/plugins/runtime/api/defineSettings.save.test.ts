// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePropertiesPanelStore } from '@stores/grid/usePropertiesPanelStore';
import { cancelPluginSettingsSessionForPlugin } from '../pluginSettingsSession';
import { createDefineSettings } from './defineSettings';
import type { PluginSettingsDefinition } from '@src/types/plugin/api';

describe('플러그인 설정 저장 실패', () => {
  const set = vi.fn();
  const get = vi.fn();
  const onChange = vi.fn();
  let currentWindowType: typeof window.__dmn_window_type;

  beforeEach(() => {
    currentWindowType = window.__dmn_window_type;
    window.__dmn_window_type = 'main';
    set.mockReset().mockRejectedValue(new Error('disk write failed'));
    get.mockReset().mockResolvedValue({ enabled: false });
    onChange.mockReset();
  });

  afterEach(() => {
    cancelPluginSettingsSessionForPlugin('save-test');
    window.__dmn_window_type = currentWindowType;
    vi.restoreAllMocks();
  });

  const createSettings = (
    definition: PluginSettingsDefinition['settings'] = {
      enabled: { type: 'boolean', default: false, label: 'Enabled' },
    },
  ) =>
    createDefineSettings({
      pluginId: 'save-test',
      api: {},
      namespacedStorage: { get, set },
      registerCleanup: vi.fn(),
    } as never)({
      settings: definition,
      onChange,
    });

  it('패널 저장이 거부되면 열기 전 값보다 재조회한 저장값을 우선한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    get
      .mockResolvedValueOnce({ mode: 'opened' })
      .mockResolvedValue({ mode: 'stored' });
    const settings = createSettings({
      mode: { type: 'string', default: 'default', label: 'Mode' },
    });
    await Promise.resolve();
    const opened = settings.open();
    const panel = usePropertiesPanelStore.getState().pluginSettingsPanel!;
    expect(panel.originalSettings).toEqual({ mode: 'opened' });
    panel.onChange({ mode: 'attempted' });
    expect(settings.get()).toEqual({ mode: 'attempted' });

    await expect(
      panel.onConfirm({ mode: 'attempted' }, { mode: 'opened' }),
    ).rejects.toThrow('disk write failed');

    await expect(opened).resolves.toBe(false);
    expect(settings.get()).toEqual({ mode: 'stored' });
    expect(onChange).not.toHaveBeenCalled();
    expect(usePropertiesPanelStore.getState().pluginSettingsPanel).toBeNull();
  });

  it('저장에 성공한 경우에만 완료 알림과 성공 결과를 반환한다', async () => {
    set.mockResolvedValue(undefined);
    const settings = createSettings();
    await Promise.resolve();
    const opened = settings.open();
    const panel = usePropertiesPanelStore.getState().pluginSettingsPanel!;
    panel.onChange({ enabled: true });
    await panel.onConfirm({ enabled: true }, { enabled: false });

    await expect(opened).resolves.toBe(true);
    expect(settings.get()).toEqual({ enabled: true });
    expect(onChange).toHaveBeenCalledWith(
      { enabled: true },
      { enabled: false },
    );
  });

  it.each(['set', 'reset'] as const)(
    '%s 저장 실패를 호출자에게 전달하고 메모리를 저장값으로 복원한다',
    async (method) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      get.mockResolvedValue({ enabled: true });
      const settings = createSettings();
      await Promise.resolve();

      await expect(
        method === 'set' ? settings.set({ enabled: false }) : settings.reset(),
      ).rejects.toThrow('disk write failed');

      expect(settings.get()).toEqual({ enabled: true });
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it('실패한 이전 저장의 재조회가 이후 편집을 덮지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const settings = createSettings();
    await Promise.resolve();
    let rejectWrite!: (error: Error) => void;
    let resolveRead!: (value: Record<string, unknown>) => void;
    set.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectWrite = reject;
      }),
    );
    get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    const failed = settings.set({ enabled: true });
    const rejection = expect(failed).rejects.toThrow('old write failed');
    rejectWrite(new Error('old write failed'));
    await Promise.resolve();
    set.mockResolvedValue(undefined);
    await settings.set({ enabled: false, label: 'newer' });
    resolveRead({ enabled: true, label: 'old' });
    await rejection;

    expect(settings.get()).toEqual({ enabled: false, label: 'newer' });
  });

  it('저장값 재조회도 실패하면 편집 전 값으로 복원한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const settings = createSettings();
    await Promise.resolve();
    get.mockRejectedValue(new Error('read failed'));
    await expect(settings.set({ enabled: true })).rejects.toThrow(
      'disk write failed',
    );
    expect(settings.get()).toEqual({ enabled: false });
  });
});
