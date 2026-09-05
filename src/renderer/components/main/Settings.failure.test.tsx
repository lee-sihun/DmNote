// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@stores/useSettingsStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { getDefaultSettingsState } from '@src/renderer/defaults';
import { beginEditorWriteBarrier } from '@src/renderer/editor/runtime/editorWriteBarrier';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  restart: vi.fn(),
  resetAll: vi.fn(),
  regenerateToken: vi.fn(),
  changeLanguage: vi.fn(),
  removePlugin: vi.fn(),
  hasPluginData: vi.fn(),
  clearPluginData: vi.fn(),
  setLock: vi.fn(),
  toggleCss: vi.fn(),
  toggleJs: vi.fn(),
  setAnchor: vi.fn(),
  stopObs: vi.fn(),
  setSoundBackend: vi.fn(),
  getSoundState: vi.fn(),
}));
vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: mocks.changeLanguage },
  }),
}));
vi.mock('@utils/core/platform', () => ({ isMac: () => false }));
vi.mock('@hooks/useLenis', () => ({
  useLenis: () => ({ scrollContainerRef: vi.fn() }),
}));
vi.mock('@hooks/app/useUpdateCheck', () => ({
  useUpdateCheck: () => ({ checkForUpdates: vi.fn(), isChecking: false }),
}));
vi.mock('@api/modules/settingsApi', () => ({
  settingsApi: { update: mocks.update },
}));
vi.mock('@api/modules/appApi', () => ({
  appApi: { restart: mocks.restart },
  windowApi: { openDevtoolsAll: vi.fn() },
}));
vi.mock('@api/modules/keysApi', () => ({
  keysApi: { resetAll: mocks.resetAll },
}));
vi.mock('@api/modules/overlayApi', () => ({
  overlayApi: { setLock: mocks.setLock, setAnchor: mocks.setAnchor },
}));
vi.mock('@api/modules/cssApi', () => ({ cssApi: { toggle: mocks.toggleCss } }));
vi.mock('@api/modules/jsApi', () => ({
  jsApi: { remove: mocks.removePlugin, toggle: mocks.toggleJs },
}));
vi.mock('@api/modules/pluginApi', () => ({
  pluginApi: {
    storage: {
      hasData: mocks.hasPluginData,
      clearByPrefix: mocks.clearPluginData,
    },
  },
}));
vi.mock('@api/modules/obsApi', () => ({
  obsApi: {
    status: vi.fn(async () => ({
      running: true,
      port: 1234,
      clientCount: 0,
      token: 'original',
    })),
    onStatus: vi.fn(() => vi.fn()),
    regenerateToken: mocks.regenerateToken,
    stop: mocks.stopObs,
  },
}));
vi.mock('@api/modules/resourceApi', () => ({
  keySoundOutputApi: {
    listDevices: vi.fn(async () => ({
      defaultDevice: true,
      system: [{ id: 'device-a', name: 'Speaker' }],
      asio: [],
    })),
    getState: mocks.getSoundState,
    setBackend: mocks.setSoundBackend,
  },
}));
vi.mock('@components/main/common/Dropdown', () => ({
  default: ({
    value,
    onChange,
    options,
    disabled,
  }: {
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    disabled?: boolean;
  }) => (
    <select
      value={value}
      disabled={disabled}
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
  default: ({
    title,
    disabled,
    onClick,
  }: {
    title: string;
    disabled?: boolean;
    onClick: () => void;
  }) => (
    <button title={title} disabled={disabled} onClick={onClick}>
      {title}
    </button>
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
    <div data-label={typeof label === 'string' ? label : undefined}>
      {label}
      {children}
    </div>
  ),
  SettingToggleRow: ({
    label,
    checked,
    onToggle,
  }: {
    label: string;
    checked: boolean;
    onToggle: () => void;
  }) => (
    <button data-toggle={label} aria-pressed={checked} onClick={onToggle}>
      {label}
    </button>
  ),
}));
vi.mock('@components/main/SettingsPreview', () => ({ default: () => null }));
vi.mock('@components/main/SettingsPanel/ShortcutsPanelContent', () => ({
  default: () => null,
}));
vi.mock('@components/main/SettingsPanel/CssPanelContent', () => ({
  default: () => null,
}));
vi.mock('@components/main/SettingsPanel/SettingsSidePanel', () => ({
  default: ({
    activePanel,
    pages,
  }: {
    activePanel: string;
    pages: { key: string; content: React.ReactNode }[];
  }) => pages.find((page) => page.key === activePanel)?.content,
}));
vi.mock('@components/main/SettingsPanel/PluginsPanelContent', () => ({
  default: ({ onRemove }: { onRemove: (id: string) => void }) => (
    <button data-remove-plugin onClick={() => onRemove('plugin-a')}>
      삭제
    </button>
  ),
}));
vi.mock('@components/main/Modal/content/dialogs/PluginDataDeleteModal', () => ({
  PluginDataDeleteModal: ({
    isOpen,
    onConfirm,
  }: {
    isOpen: boolean;
    onConfirm: (withData: boolean) => void;
  }) =>
    isOpen ? (
      <button data-delete-with-data onClick={() => onConfirm(true)}>
        데이터 포함 삭제
      </button>
    ) : null,
}));

import Settings from './Settings';

describe('Settings 실패 안내와 상태 보존', () => {
  let root: Root;
  let host: HTMLDivElement;
  const showAlert = vi.fn();
  const showConfirm = vi.fn();
  const button = (text: string) =>
    Array.from(host.querySelectorAll('button')).find(
      (node) => node.textContent === text,
    )!;
  const choose = (label: string, value: string) =>
    act(() => {
      const select = host.querySelector<HTMLSelectElement>(
        `[data-label="${label}"] select`,
      )!;
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  const confirm = () =>
    act(async () => {
      await showConfirm.mock.lastCall![1]();
    });

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('__APP_VERSION__', 'test');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const mock of Object.values(mocks))
      mock.mockReset().mockResolvedValue(undefined);
    mocks.hasPluginData.mockResolvedValue(true);
    showAlert.mockReset();
    showConfirm.mockReset();
    mocks.getSoundState.mockResolvedValue({
      requested: { kind: 'defaultDevice' },
      effective: { kind: 'defaultDevice' },
      error: null,
      errorCode: null,
      asioAvailable: false,
    });
    useSettingsStore.setState({
      ...getDefaultSettingsState(),
      language: 'ko',
      angleMode: 'd3d11',
      jsPlugins: [
        {
          id: 'plugin-a',
          name: 'plugin-a.js',
          content: '// @id plugin-a',
          enabled: true,
        },
      ] as never,
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root.render(<Settings showAlert={showAlert} showConfirm={showConfirm} />),
    );
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('전체 초기화가 실패하면 선택과 데이터를 보존하고 안내한다', async () => {
    const before = useKeyStore.getState().keyMappings;
    const selection = [{ type: 'key' as const, id: 'key-a', index: 0 }];
    useGridSelectionStore.getState().setSelectedElements(selection);
    mocks.resetAll.mockRejectedValue(new Error('reset failed'));
    act(() => button('settings.resetData').click());
    await confirm();
    expect(mocks.resetAll).toHaveBeenCalledOnce();
    expect(useKeyStore.getState().keyMappings).toBe(before);
    expect(useGridSelectionStore.getState().selectedElements).toEqual(
      selection,
    );
    expect(showAlert).toHaveBeenCalledWith('common.actionFailed');
  });

  it('OBS 토큰 재생성이 실패하면 자동 재시도 없이 안내한다', async () => {
    mocks.regenerateToken.mockRejectedValue(new Error('token failed'));
    act(() => button('settings.obsTokenRegen').click());
    await confirm();
    expect(mocks.regenerateToken).toHaveBeenCalledOnce();
    expect(showAlert).toHaveBeenCalledWith('common.actionFailed');
  });

  it('각도 모드 저장이 실패하면 기존 모드를 유지하고 재시작하지 않는다', async () => {
    mocks.update.mockRejectedValue(new Error('settings failed'));
    choose('settings.graphicsOption', 'gl');
    await confirm();
    expect(useSettingsStore.getState().angleMode).toBe('d3d11');
    expect(mocks.restart).not.toHaveBeenCalled();
    expect(showAlert).toHaveBeenCalledWith('common.saveFailed');
  });

  it('각도 모드 저장 후 재시작만 실패하면 저장한 모드를 유지한다', async () => {
    mocks.restart.mockRejectedValue(new Error('restart failed'));
    choose('settings.graphicsOption', 'gl');
    await confirm();
    expect(useSettingsStore.getState().angleMode).toBe('gl');
    expect(showAlert).toHaveBeenCalledWith('common.restartFailed');
  });

  it('언어 저장 실패가 기존 선택을 바꾸지 않는다', async () => {
    const failure = Promise.reject(new Error('language failed'));
    void failure.catch(() => {});
    mocks.changeLanguage.mockReturnValue(failure);
    choose('settings.language', 'en');
    await act(async () => {
      await Promise.resolve();
    });
    expect(useSettingsStore.getState().language).toBe('ko');
    expect(showAlert).toHaveBeenCalledWith('common.saveFailed');
  });

  it('플러그인 제거가 거절되면 저장된 데이터를 삭제하지 않는다', async () => {
    mocks.removePlugin.mockResolvedValue({ success: false });
    act(() => button('settings.managePlugins').click());
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-remove-plugin]')!.click(),
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-delete-with-data]')!.click(),
    );
    expect(mocks.removePlugin).toHaveBeenCalledWith('plugin-a');
    expect(mocks.clearPluginData).not.toHaveBeenCalled();
    expect(showAlert).toHaveBeenCalledWith('settings.jsPluginRemoveFailed');
  });

  it('OBS 종료 후 설정 저장만 실패하면 실제 종료 상태를 유지한다', async () => {
    mocks.stopObs.mockResolvedValue({
      running: false,
      port: 1234,
      clientCount: 0,
      token: 'original',
    });
    mocks.update.mockRejectedValue(new Error('settings failed'));
    const toggle = host.querySelector<HTMLButtonElement>(
      '[data-toggle="settings.obsMode"]',
    )!;
    await act(async () => toggle.click());
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(mocks.stopObs).toHaveBeenCalledOnce();
    expect(showAlert).toHaveBeenCalledWith('common.saveFailed');
  });

  it('OBS 종료 응답과 뒤따르는 설정 저장까지 종료 정산이 기다린다', async () => {
    let finishStop!: (status: unknown) => void;
    let finishSettings!: () => void;
    mocks.stopObs.mockReturnValue(
      new Promise((resolve) => {
        finishStop = resolve;
      }),
    );
    mocks.update.mockReturnValue(
      new Promise<void>((resolve) => {
        finishSettings = resolve;
      }),
    );
    act(() =>
      host
        .querySelector<HTMLButtonElement>('[data-toggle="settings.obsMode"]')!
        .click(),
    );
    const drain = beginEditorWriteBarrier();
    let settled = false;
    const result = drain().then((value) => {
      settled = true;
      return value;
    });
    await act(async () => {
      await Promise.resolve();
    });
    const settledBeforeStop = settled;
    await act(async () => {
      finishStop({
        running: false,
        port: 1234,
        clientCount: 0,
        token: 'original',
      });
    });
    const settledBeforeSettings = settled;
    await act(async () => {
      finishSettings();
      await result;
    });
    expect(settledBeforeStop).toBe(false);
    expect(settledBeforeSettings).toBe(false);
    expect(await result).toBe(true);
    expect(mocks.update).toHaveBeenCalledWith({ obsModeEnabled: false });
  });

  it('OBS 종료 명령 자체가 실패하면 실행 상태를 되돌리고 안내한다', async () => {
    mocks.stopObs.mockRejectedValue(new Error('stop failed'));
    const drain = beginEditorWriteBarrier();
    const toggle = host.querySelector<HTMLButtonElement>(
      '[data-toggle="settings.obsMode"]',
    )!;
    await act(async () => toggle.click());
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(showAlert).toHaveBeenCalledWith('settings.obsStopFailed');
    expect(await drain()).toBe(false);
  });

  it('오버레이 기준점 저장 실패를 되돌리고 안내한다', async () => {
    const before = useSettingsStore.getState().overlayResizeAnchor;
    mocks.setAnchor.mockRejectedValue(new Error('anchor failed'));
    choose(
      'settings.resizeAnchor',
      before === 'top-left' ? 'bottom-right' : 'top-left',
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(useSettingsStore.getState().overlayResizeAnchor).toBe(before);
    expect(showAlert).toHaveBeenCalledWith('common.saveFailed');
  });

  it('사운드 출력 저장 실패를 안내하고 실제 장치 선택을 다시 읽는다', async () => {
    mocks.setSoundBackend.mockRejectedValue(new Error('sound failed'));
    const select = Array.from(host.querySelectorAll('select')).find((node) =>
      Array.from(node.options).some(
        (option) => option.textContent === 'Speaker',
      ),
    )!;
    act(() => {
      select.value = Array.from(select.options).find(
        (option) => option.textContent === 'Speaker',
      )!.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(select.value).toBe('defaultDevice');
    expect(mocks.getSoundState).toHaveBeenCalledTimes(2);
    expect(showAlert).toHaveBeenCalledWith('common.saveFailed');
  });

  it('데이터 없는 플러그인은 사전 조회와 뒤따르는 제거까지 정산한다', async () => {
    let finishCheck!: (value: boolean) => void;
    let finishRemove!: (value: unknown) => void;
    mocks.hasPluginData.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finishCheck = resolve;
      }),
    );
    mocks.removePlugin.mockReturnValue(
      new Promise((resolve) => {
        finishRemove = resolve;
      }),
    );
    act(() => button('settings.managePlugins').click());
    act(() =>
      host.querySelector<HTMLButtonElement>('[data-remove-plugin]')!.click(),
    );
    const drain = beginEditorWriteBarrier();
    let settled = false;
    const result = drain().then((value) => {
      settled = true;
      return value;
    });
    await act(async () => {
      await Promise.resolve();
    });
    const settledBeforeCheck = settled;
    await act(async () => {
      finishCheck(false);
    });
    const settledBeforeRemove = settled;
    await act(async () => {
      finishRemove({ success: true });
      await result;
    });
    expect(settledBeforeCheck).toBe(false);
    expect(settledBeforeRemove).toBe(false);
    expect(await result).toBe(true);
    expect(mocks.removePlugin).toHaveBeenCalledOnce();
    expect(mocks.clearPluginData).not.toHaveBeenCalled();
  });

  it('데이터가 있는 플러그인은 확인창을 열고 정산 대기를 해제한다', async () => {
    let finishCheck!: (value: boolean) => void;
    mocks.hasPluginData.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finishCheck = resolve;
      }),
    );
    act(() => button('settings.managePlugins').click());
    act(() =>
      host.querySelector<HTMLButtonElement>('[data-remove-plugin]')!.click(),
    );
    const drain = beginEditorWriteBarrier();
    let settled = false;
    const result = drain().then((value) => {
      settled = true;
      return value;
    });
    await act(async () => {
      await Promise.resolve();
    });
    const settledBeforeCheck = settled;
    await act(async () => {
      finishCheck(true);
      await result;
    });
    expect(settledBeforeCheck).toBe(false);
    expect(await result).toBe(true);
    expect(host.querySelector('[data-delete-with-data]')).not.toBeNull();
    expect(mocks.removePlugin).not.toHaveBeenCalled();
    expect(mocks.clearPluginData).not.toHaveBeenCalled();
  });

  it('플러그인 사전 조회가 실패하면 삭제하지 않고 정산도 실패한다', async () => {
    mocks.hasPluginData.mockRejectedValue(new Error('read failed'));
    act(() => button('settings.managePlugins').click());
    const drain = beginEditorWriteBarrier();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-remove-plugin]')!.click(),
    );
    expect(await drain()).toBe(false);
    expect(mocks.removePlugin).not.toHaveBeenCalled();
    expect(mocks.clearPluginData).not.toHaveBeenCalled();
    expect(showAlert).toHaveBeenCalledWith('settings.jsPluginRemoveFailed');
  });

  it('플러그인 제거 성공 후에만 선택한 저장 데이터를 삭제한다', async () => {
    mocks.removePlugin.mockResolvedValue({ success: true });
    act(() => button('settings.managePlugins').click());
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-remove-plugin]')!.click(),
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-delete-with-data]')!.click(),
    );
    expect(mocks.clearPluginData).toHaveBeenCalledWith('plugin-a/');
    expect(mocks.removePlugin.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clearPluginData.mock.invocationCallOrder[0],
    );
  });

  it('언어 저장 응답을 기다리는 동안 중복 선택을 막고 성공 후 반영한다', async () => {
    let finish!: () => void;
    mocks.changeLanguage.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    choose('settings.language', 'en');
    const select = host.querySelector<HTMLSelectElement>(
      '[data-label="settings.language"] select',
    )!;
    expect(select.disabled).toBe(true);
    expect(useSettingsStore.getState().language).toBe('ko');
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(select.disabled).toBe(false);
    expect(useSettingsStore.getState().language).toBe('en');
    expect(mocks.changeLanguage).toHaveBeenCalledOnce();
  });

  it.each([
    'settings.alwaysOnTop',
    'settings.overlayLock',
    'settings.noteEffect',
    'settings.trayEnabled',
    'settings.autoUpdate',
    'settings.developerMode',
    'settings.keyCounter',
  ])('%s 저장 실패를 표시한다', async (label) => {
    mocks.update.mockRejectedValue(new Error('write failed'));
    mocks.setLock.mockRejectedValue(new Error('write failed'));
    const toggle = host.querySelector<HTMLButtonElement>(
      `[data-toggle="${label}"]`,
    )!;
    expect(toggle).not.toBeNull();
    const before = toggle.getAttribute('aria-pressed');
    await act(async () => toggle.click());
    expect(toggle.getAttribute('aria-pressed')).toBe(before);
    expect(showAlert).toHaveBeenCalledWith('common.saveFailed');
  });
});
