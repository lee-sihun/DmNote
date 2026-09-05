import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObsStatus } from '@src/types/obs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const obsHarness = vi.hoisted(() => ({
  appRestart: vi.fn(),
  clearSelection: vi.fn(),
  copyText: vi.fn(),
  onStatus: vi.fn(),
  overlayResizeAnchor: 'top-left',
  overlaySetAnchor: vi.fn(),
  regenerateToken: vi.fn(),
  setAngleMode: vi.fn(),
  setAutoUpdateEnabled: vi.fn(),
  setDeveloperModeEnabled: vi.fn(),
  setHardwareAcceleration: vi.fn(),
  setKeyCounterEnabled: vi.fn(),
  setLanguage: vi.fn(),
  setNoteEffect: vi.fn(),
  setOverlayLocked: vi.fn(),
  setOverlayResizeAnchor: vi.fn(),
  setShortcuts: vi.fn(),
  setTrayEnabled: vi.fn(),
  setUseCustomCSS: vi.fn(),
  setUseCustomJS: vi.fn(),
  setAlwaysOnTop: vi.fn(),
  settingsUpdate: vi.fn(),
  start: vi.fn(),
  status: vi.fn(),
  statusListener: null as null | ((status: ObsStatus) => void),
  stop: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock('@hooks/useLenis', () => ({
  useLenis: () => ({ scrollContainerRef: { current: null } }),
}));
vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { count?: number }) =>
      params?.count === undefined ? key : `${key}:${params.count}`,
    i18n: { changeLanguage: vi.fn(), language: 'ko' },
  }),
}));
vi.mock('@stores/useSettingsStore', () => ({
  useSettingsStore: () => ({
    hardwareAcceleration: true,
    setHardwareAcceleration: obsHarness.setHardwareAcceleration,
    alwaysOnTop: false,
    setAlwaysOnTop: obsHarness.setAlwaysOnTop,
    overlayLocked: false,
    setOverlayLocked: obsHarness.setOverlayLocked,
    angleMode: 'd3d11',
    setAngleMode: obsHarness.setAngleMode,
    noteEffect: true,
    setNoteEffect: obsHarness.setNoteEffect,
    trayEnabled: true,
    setTrayEnabled: obsHarness.setTrayEnabled,
    autoUpdateEnabled: true,
    setAutoUpdateEnabled: obsHarness.setAutoUpdateEnabled,
    developerModeEnabled: false,
    setDeveloperModeEnabled: obsHarness.setDeveloperModeEnabled,
    useCustomCSS: false,
    setUseCustomCSS: obsHarness.setUseCustomCSS,
    customCSSPath: '',
    useCustomJS: false,
    setUseCustomJS: obsHarness.setUseCustomJS,
    jsPlugins: [],
    language: 'ko',
    setLanguage: obsHarness.setLanguage,
    overlayResizeAnchor: obsHarness.overlayResizeAnchor,
    setOverlayResizeAnchor: obsHarness.setOverlayResizeAnchor,
    keyCounterEnabled: true,
    setKeyCounterEnabled: obsHarness.setKeyCounterEnabled,
    shortcuts: {},
    setShortcuts: obsHarness.setShortcuts,
  }),
}));
vi.mock('@stores/data/useKeyStore', () => ({
  useKeyStore: {
    getState: () => ({ positions: {}, keyMappings: {} }),
    setState: vi.fn(),
  },
}));
vi.mock('@stores/grid/useGridSelectionStore', () => ({
  useGridSelectionStore: {
    getState: () => ({ clearSelection: obsHarness.clearSelection }),
  },
}));
vi.mock('@stores/data/useStatItemStore', () => ({
  useStatItemStore: { getState: () => ({ positions: {} }) },
}));
vi.mock('@stores/data/useGraphItemStore', () => ({
  useGraphItemStore: { getState: () => ({ positions: {} }) },
}));
vi.mock('@stores/data/useKnobItemStore', () => ({
  useKnobItemStore: { getState: () => ({ positions: {} }) },
}));
vi.mock('@stores/data/useLayerGroupStore', () => ({
  useLayerGroupStore: { getState: () => ({ layerGroups: {} }) },
}));
vi.mock('@components/main/common/dropdown/Dropdown', () => ({
  default: ({
    options,
    value,
    onChange,
    placeholder,
  }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  }) => (
    <select
      aria-label={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('@components/main/common/ReloadButton', () => ({
  default: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
vi.mock('@components/main/common/SettingRow', () => ({
  SettingCard: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  SettingRow: ({
    label,
    children,
  }: {
    label: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div data-setting-row="true">
      <div>{label}</div>
      {children}
    </div>
  ),
  SettingToggleRow: ({
    label,
    checked,
    onToggle,
  }: {
    label: React.ReactNode;
    checked: boolean;
    onToggle: () => void;
  }) => (
    <button
      type="button"
      data-toggle-label={String(label)}
      aria-pressed={checked}
      onClick={onToggle}
    />
  ),
}));
vi.mock('@components/main/Modal/content/dialogs/PluginDataDeleteModal', () => ({
  PluginDataDeleteModal: () => null,
}));
vi.mock('@hooks/ui/useDeferredHover', () => ({
  useDeferredHover: () => [null, vi.fn()],
}));
vi.mock('@hooks/ui/useRetainedValue', () => ({
  useRetainedWhileOpen: (_open: boolean, value: unknown) => value,
}));
vi.mock('@components/main/SettingsPreview', () => ({ default: () => null }));
vi.mock('@components/main/SettingsPanel/SettingsSidePanel', () => ({
  default: () => null,
}));
vi.mock('@components/main/SettingsPanel/ShortcutsPanelContent', () => ({
  default: () => null,
}));
vi.mock('@components/main/SettingsPanel/PluginsPanelContent', () => ({
  default: () => null,
}));
vi.mock('@components/main/SettingsPanel/CssPanelContent', () => ({
  default: () => null,
}));
vi.mock('@components/main/SettingsPanel/KeySoundOutputSettings', () => ({
  default: () => null,
}));
vi.mock('@components/main/settingsPluginLifecycleController', () => ({
  createSettingsPluginLifecycleController: () => ({
    canReloadPlugins: true,
    handleReloadPlugins: vi.fn(),
    handleAddPlugins: vi.fn(),
    handlePluginToggle: vi.fn(),
    handlePluginRemove: vi.fn(),
    removePluginOnly: vi.fn(),
    removePluginWithData: vi.fn(),
  }),
}));
vi.mock('@utils/core/platform', () => ({ isMac: () => false }));
vi.mock('@hooks/app/useUpdateCheck', () => ({
  useUpdateCheck: () => ({ checkForUpdates: vi.fn(), isChecking: false }),
}));
vi.mock('@api/modules/settingsApi', () => ({
  settingsApi: { update: obsHarness.settingsUpdate },
}));
vi.mock('@api/modules/obsApi', () => ({
  obsApi: {
    status: obsHarness.status,
    onStatus: obsHarness.onStatus,
    start: obsHarness.start,
    stop: obsHarness.stop,
    regenerateToken: obsHarness.regenerateToken,
  },
}));
vi.mock('@api/modules/overlayApi', () => ({
  overlayApi: { setLock: vi.fn(), setAnchor: obsHarness.overlaySetAnchor },
}));
vi.mock('@api/modules/cssApi', () => ({
  cssApi: { toggle: vi.fn() },
}));
vi.mock('@api/modules/jsApi', () => ({
  jsApi: { toggle: vi.fn() },
}));
vi.mock('@api/modules/keysApi', () => ({
  keysApi: { resetCounters: vi.fn(), resetAll: vi.fn() },
}));
vi.mock('@api/modules/appApi', () => ({
  appApi: { restart: obsHarness.appRestart },
  windowApi: { openDevtoolsAll: vi.fn() },
}));

import Settings from './Settings';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const STOPPED_STATUS: ObsStatus = {
  running: false,
  port: 16899,
  clientCount: 0,
};

const RUNNING_STATUS: ObsStatus = {
  running: true,
  port: 16899,
  clientCount: 2,
  localIp: '192.168.0.10',
  token: 'secret',
};

const createShowAlertMock = () =>
  vi.fn<(msg: string, confirmText?: string) => void>();

const createShowConfirmMock = () =>
  vi.fn<
    (
      msg: string,
      onConfirm: () => void,
      options?: {
        onCancel?: () => void;
        confirmText?: string;
        cancelText?: string;
        danger?: boolean;
      },
    ) => void
  >();

describe('Settings OBS controller surface', () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let showAlert: ReturnType<typeof createShowAlertMock>;
  let showConfirm: ReturnType<typeof createShowConfirmMock>;

  const renderSettings = async () => {
    await act(async () => {
      root?.render(
        <Settings showAlert={showAlert} showConfirm={showConfirm} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const obsToggle = (): HTMLButtonElement =>
    container.querySelector('[data-toggle-label="settings.obsMode"]')!;

  const copyButton = (): HTMLButtonElement =>
    [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'settings.obsCopyUrl',
    )!;

  const regenerateButton = (): HTMLButtonElement =>
    container.querySelector('[title="settings.obsTokenRegen"]')!;

  const resizeAnchorSelect = (): HTMLSelectElement =>
    container.querySelector('[aria-label="settings.selectAnchor"]')!;

  const changeResizeAnchor = (value: string) => {
    const select = resizeAnchorSelect();
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value',
    )?.set?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const settle = async () => {
    await act(async () => {
      for (let index = 0; index < 5; index += 1) {
        await Promise.resolve();
      }
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal('__APP_VERSION__', 'test');
    obsHarness.statusListener = null;
    obsHarness.overlayResizeAnchor = 'top-left';
    obsHarness.setOverlayResizeAnchor.mockImplementation((value: string) => {
      obsHarness.overlayResizeAnchor = value;
    });
    obsHarness.overlaySetAnchor.mockResolvedValue(undefined);
    obsHarness.status.mockResolvedValue(STOPPED_STATUS);
    obsHarness.onStatus.mockImplementation(
      (listener: (status: ObsStatus) => void) => {
        obsHarness.statusListener = listener;
        return obsHarness.unsubscribe;
      },
    );
    obsHarness.start.mockResolvedValue(RUNNING_STATUS);
    obsHarness.stop.mockResolvedValue(STOPPED_STATUS);
    obsHarness.regenerateToken.mockResolvedValue(RUNNING_STATUS);
    obsHarness.settingsUpdate.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: obsHarness.copyText },
    });
    obsHarness.copyText.mockResolvedValue(undefined);
    showAlert = createShowAlertMock();
    showConfirm = createShowConfirmMock();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('initial status·onStatus와 5초 polling의 clientCount 동일성 계약을 유지한다', async () => {
    obsHarness.status.mockResolvedValueOnce(RUNNING_STATUS);
    await renderSettings();

    expect(obsHarness.status).toHaveBeenCalledTimes(1);
    expect(obsHarness.onStatus).toHaveBeenCalledOnce();
    expect(obsToggle().getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('settings.obsClients:2');

    act(() => {
      obsHarness.statusListener?.({ ...RUNNING_STATUS, clientCount: 4 });
    });
    expect(container.textContent).toContain('settings.obsClients:4');

    obsHarness.status.mockResolvedValueOnce({
      ...STOPPED_STATUS,
      clientCount: 4,
    });
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(obsToggle().getAttribute('aria-pressed')).toBe('true');

    obsHarness.status.mockResolvedValueOnce({
      ...STOPPED_STATUS,
      clientCount: 5,
    });
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(obsToggle().getAttribute('aria-pressed')).toBe('false');
  });

  it('unmount는 in-flight status 반영을 막고 unsubscribe 뒤 polling timer를 해제한다', async () => {
    const initial = deferred<ObsStatus>();
    const poll = deferred<ObsStatus>();
    obsHarness.status
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(poll.promise);
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    await renderSettings();
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    act(() => root?.unmount());
    root = null;
    expect(obsHarness.unsubscribe).toHaveBeenCalledOnce();
    expect(clearIntervalSpy).toHaveBeenCalledOnce();
    expect(obsHarness.unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(
      clearIntervalSpy.mock.invocationCallOrder[0],
    );
    expect(vi.getTimerCount()).toBe(0);

    initial.resolve(RUNNING_STATUS);
    poll.resolve(RUNNING_STATUS);
    await settle();
  });

  it('start/stop은 optimistic 상태→OBS API→설정 저장 순서와 in-flight gate를 유지한다', async () => {
    const start = deferred<ObsStatus>();
    const stop = deferred<ObsStatus>();
    obsHarness.start.mockReturnValueOnce(start.promise);
    obsHarness.stop.mockReturnValueOnce(stop.promise);
    await renderSettings();

    act(() => obsToggle().click());
    expect(obsToggle().getAttribute('aria-pressed')).toBe('true');
    act(() => obsToggle().click());
    expect(obsHarness.start).toHaveBeenCalledOnce();

    start.resolve(RUNNING_STATUS);
    await settle();
    expect(obsHarness.settingsUpdate.mock.calls).toEqual([
      [{ obsModeEnabled: true }],
    ]);
    expect(obsHarness.start.mock.invocationCallOrder[0]).toBeLessThan(
      obsHarness.settingsUpdate.mock.invocationCallOrder[0],
    );

    act(() => obsToggle().click());
    expect(obsToggle().getAttribute('aria-pressed')).toBe('false');
    stop.resolve(STOPPED_STATUS);
    await settle();
    expect(obsHarness.settingsUpdate.mock.calls.slice(1)).toEqual([
      [{ obsModeEnabled: false }],
    ]);
  });

  it.each([
    ['start', STOPPED_STATUS, 'settings.obsStartFailed'],
    ['stop', RUNNING_STATUS, 'settings.obsStopFailed'],
  ] as const)(
    '%s 실패는 optimistic 상태를 rollback하고 alert 뒤 finally에서 gate를 연다',
    async (operation, initialStatus, alertKey) => {
      obsHarness.status.mockResolvedValueOnce(initialStatus);
      const api = operation === 'start' ? obsHarness.start : obsHarness.stop;
      api.mockRejectedValueOnce(new Error(`${operation} failure`));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await renderSettings();

      act(() => obsToggle().click());
      await settle();

      expect(obsToggle().getAttribute('aria-pressed')).toBe(
        String(initialStatus.running),
      );
      expect(showAlert).toHaveBeenCalledWith(alertKey);
      act(() => obsToggle().click());
      await settle();
      expect(api).toHaveBeenCalledTimes(2);
    },
  );

  it('OBS start 뒤 settings 저장 실패도 optimistic 상태를 rollback하고 finally에서 gate를 연다', async () => {
    obsHarness.settingsUpdate.mockRejectedValueOnce(
      new Error('settings update failure'),
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await renderSettings();

    act(() => obsToggle().click());
    await settle();

    expect(obsHarness.start).toHaveBeenCalledOnce();
    expect(obsHarness.settingsUpdate).toHaveBeenCalledWith({
      obsModeEnabled: true,
    });
    expect(obsToggle().getAttribute('aria-pressed')).toBe('false');
    expect(showAlert).toHaveBeenCalledWith('settings.obsStartFailed');

    obsHarness.settingsUpdate.mockResolvedValue(undefined);
    act(() => obsToggle().click());
    await settle();
    expect(obsHarness.start).toHaveBeenCalledTimes(2);
  });

  it('OBS URL copy 성공은 완료 알림, clipboard 실패는 URL fallback을 표시한다', async () => {
    obsHarness.status.mockResolvedValueOnce(RUNNING_STATUS);
    await renderSettings();

    act(() => copyButton().click());
    await settle();
    expect(obsHarness.copyText).toHaveBeenCalledWith(
      'http://192.168.0.10:16899?token=secret',
    );
    expect(showAlert).toHaveBeenLastCalledWith('settings.obsCopied');

    showAlert.mockClear();
    obsHarness.copyText.mockRejectedValueOnce(new Error('clipboard denied'));
    act(() => copyButton().click());
    await settle();
    expect(showAlert).toHaveBeenCalledWith(
      'http://192.168.0.10:16899?token=secret',
    );
  });

  it('token confirm cancel과 비동기 finally가 중복 gate를 정확히 해제한다', async () => {
    obsHarness.status.mockResolvedValueOnce(RUNNING_STATUS);
    const regeneration = deferred<ObsStatus>();
    obsHarness.regenerateToken.mockReturnValueOnce(regeneration.promise);
    await renderSettings();

    act(() => regenerateButton().click());
    act(() => regenerateButton().click());
    expect(showConfirm).toHaveBeenCalledOnce();
    const firstOptions = showConfirm.mock.calls[0][2] as {
      onCancel: () => void;
    };
    act(() => firstOptions.onCancel());

    act(() => regenerateButton().click());
    expect(showConfirm).toHaveBeenCalledTimes(2);
    const confirm = showConfirm.mock.calls[1][1] as () => Promise<void>;
    let confirming!: Promise<void>;
    act(() => {
      confirming = confirm();
    });
    act(() => regenerateButton().click());
    expect(showConfirm).toHaveBeenCalledTimes(2);

    regeneration.resolve({ ...RUNNING_STATUS, token: 'next' });
    await act(async () => confirming);
    act(() => regenerateButton().click());
    expect(showConfirm).toHaveBeenCalledTimes(3);
    expect(showConfirm.mock.calls[0][0]).toBe('settings.obsTokenRegenMessage');
    expect(showConfirm.mock.calls[0][2]).toMatchObject({
      confirmText: 'settings.obsTokenRegenConfirm',
    });
  });

  it('resize anchor 옵션 번역·순서와 직접 적용의 무재시작·무알림 계약을 유지한다', async () => {
    await renderSettings();

    expect(
      [...resizeAnchorSelect().options].map(({ value, text }) => ({
        value,
        text,
      })),
    ).toEqual([
      { value: 'top-left', text: 'settings.topLeft' },
      { value: 'bottom-left', text: 'settings.bottomLeft' },
      { value: 'top-right', text: 'settings.topRight' },
      { value: 'bottom-right', text: 'settings.bottomRight' },
      { value: 'center', text: 'settings.center' },
    ]);

    act(() => changeResizeAnchor('bottom-left'));
    await settle();

    expect(obsHarness.setOverlayResizeAnchor).toHaveBeenCalledWith(
      'bottom-left',
    );
    expect(obsHarness.overlaySetAnchor).toHaveBeenCalledWith('bottom-left');
    expect(obsHarness.settingsUpdate).not.toHaveBeenCalled();
    expect(obsHarness.appRestart).not.toHaveBeenCalled();
    expect(showAlert).not.toHaveBeenCalled();
    expect(showConfirm).not.toHaveBeenCalled();
  });

  it('rapid anchor 변경은 첫 요청과 최신 pending만 순서대로 적용한다', async () => {
    const first = deferred<void>();
    const latest = deferred<void>();
    obsHarness.overlaySetAnchor
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(latest.promise);
    await renderSettings();

    act(() => {
      changeResizeAnchor('top-right');
      changeResizeAnchor('bottom-left');
      changeResizeAnchor('center');
    });

    expect(obsHarness.setOverlayResizeAnchor.mock.calls).toEqual([
      ['top-right'],
      ['bottom-left'],
      ['center'],
    ]);
    expect(obsHarness.overlaySetAnchor.mock.calls).toEqual([['top-right']]);

    first.resolve();
    await settle();
    expect(obsHarness.overlaySetAnchor.mock.calls).toEqual([
      ['top-right'],
      ['center'],
    ]);

    latest.resolve();
    await settle();
  });

  it('선행 실패와 최신 pending이 공존하면 중간 rollback 없이 최신 요청을 계속한다', async () => {
    const first = deferred<void>();
    const latest = deferred<void>();
    obsHarness.overlaySetAnchor
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(latest.promise);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await renderSettings();

    act(() => changeResizeAnchor('top-right'));
    act(() => changeResizeAnchor('bottom-right'));
    first.reject(new Error('first failed'));
    await settle();

    expect(obsHarness.setOverlayResizeAnchor.mock.calls).toEqual([
      ['top-right'],
      ['bottom-right'],
    ]);
    expect(obsHarness.overlaySetAnchor.mock.calls).toEqual([
      ['top-right'],
      ['bottom-right'],
    ]);

    latest.resolve();
    await settle();
  });

  it('최종 실패는 마지막 성공 anchor로 rollback하고 다음 요청 gate를 연다', async () => {
    obsHarness.overlaySetAnchor
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('latest failed'))
      .mockResolvedValueOnce(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await renderSettings();

    act(() => changeResizeAnchor('top-right'));
    await settle();
    act(() => changeResizeAnchor('bottom-left'));
    await settle();

    expect(obsHarness.setOverlayResizeAnchor.mock.calls).toEqual([
      ['top-right'],
      ['bottom-left'],
      ['top-right'],
    ]);
    expect(console.error).toHaveBeenCalledWith(
      'Failed to set overlay anchor',
      expect.any(Error),
    );

    act(() => changeResizeAnchor('center'));
    await settle();
    expect(obsHarness.overlaySetAnchor.mock.calls).toEqual([
      ['top-right'],
      ['bottom-left'],
      ['center'],
    ]);
  });

  it('idle authoritative anchor 변경은 이후 실패 rollback 기준을 갱신한다', async () => {
    await renderSettings();
    obsHarness.overlayResizeAnchor = 'center';
    await renderSettings();
    obsHarness.setOverlayResizeAnchor.mockClear();
    obsHarness.overlaySetAnchor.mockRejectedValueOnce(
      new Error('set anchor failed'),
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    act(() => changeResizeAnchor('bottom-right'));
    await settle();

    expect(obsHarness.setOverlayResizeAnchor.mock.calls).toEqual([
      ['bottom-right'],
      ['center'],
    ]);
  });

  it('unmount 뒤 늦은 실패도 기존처럼 마지막 confirmed anchor rollback을 수행한다', async () => {
    const pending = deferred<void>();
    obsHarness.overlaySetAnchor.mockReturnValueOnce(pending.promise);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await renderSettings();

    act(() => changeResizeAnchor('top-right'));
    act(() => root?.unmount());
    root = null;
    pending.reject(new Error('late failure'));
    await settle();

    expect(obsHarness.setOverlayResizeAnchor.mock.calls).toEqual([
      ['top-right'],
      ['top-left'],
    ]);
  });
});
