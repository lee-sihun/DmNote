// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resetCountersMode: vi.fn(),
  confirm: null as Promise<unknown> | null,
  checkForUpdates: vi.fn(),
}));
vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@hooks/app/useCustomCssInjection', () => ({
  useCustomCssInjection: vi.fn(),
}));
vi.mock('@hooks/app/useCustomJsInjection', () => ({
  useCustomJsInjection: vi.fn(),
}));
vi.mock('@hooks/app/useAppBootstrap', () => ({ useAppBootstrap: vi.fn() }));
vi.mock('@hooks/app/usePluginDisplayElementsResponder', () => ({
  usePluginDisplayElementsResponder: vi.fn(),
}));
vi.mock('@hooks/app/useBlockBrowserShortcuts', () => ({
  useBlockBrowserShortcuts: vi.fn(),
}));
vi.mock('@hooks/panel/usePanelCloseRequest', () => ({
  usePanelCloseRequest: vi.fn(),
}));
vi.mock('@hooks/app/useUpdateCheck', () => ({
  useUpdateCheck: () => ({ checkForUpdates: mocks.checkForUpdates }),
  hasPendingPostUpdateReleaseNotice: () => false,
  clearPendingPostUpdateReleaseNotice: vi.fn(),
  UpdateInstalledRestartFailedError: class extends Error {},
}));
vi.mock('@hooks/useKeyManager', () => ({
  useKeyManager: () => ({
    keyMappings: {},
    positions: {},
    handleResetCurrentMode: vi.fn(),
  }),
}));
vi.mock('@hooks/Modal/usePalette', () => ({
  usePalette: () => ({
    palette: false,
    color: 'transparent',
    setPalette: vi.fn(),
  }),
}));
vi.mock('@api/modules/keysApi', () => ({
  keysApi: { resetCountersMode: mocks.resetCountersMode },
}));
vi.mock('@components/main/TitleBar', () => ({ default: () => null }));
vi.mock('@components/main/EditorSaveNotice', () => ({ default: () => null }));
vi.mock('@components/main/Grid', () => ({ default: () => null }));
vi.mock('@components/main/Settings', () => ({ default: () => null }));
vi.mock('@components/main/Grid/PropertiesPanelHost', () => ({
  default: () => null,
}));
vi.mock('@components/main/Modal/PopupExit', () => ({ default: () => null }));
vi.mock('@components/main/Modal/FloatingPopup', () => ({
  default: () => null,
}));
vi.mock('@components/main/Modal/content/dialogs/UpdateModal', () => ({
  default: () => null,
}));
vi.mock('@components/main/Modal/content/settings/NoteSetting', () => ({
  default: () => null,
}));
vi.mock('@components/main/Modal/content/pickers/Palette', () => ({
  default: () => null,
}));
vi.mock('@components/main/Modal/content/pickers/ColorPicker', () => ({
  default: () => null,
}));
vi.mock('@components/main/Tool/ToolBar', () => ({
  default: ({ onResetCounters }: { onResetCounters: () => void }) => (
    <button data-reset-counters onClick={onResetCounters}>
      카운터 초기화
    </button>
  ),
}));
vi.mock('@components/main/Modal/content/dialogs/Alert', () => ({
  default: ({
    isOpen,
    message,
    onConfirm,
  }: {
    isOpen: boolean;
    message: string;
    onConfirm: () => void | Promise<void>;
  }) =>
    isOpen ? (
      <div data-alert>
        {message}
        <button
          data-confirm
          onClick={() => {
            mocks.confirm = Promise.resolve(onConfirm());
            void mocks.confirm.catch(() => {});
          }}
        >
          확인
        </button>
      </div>
    ) : null,
}));

import App from './App';

describe('App 비동기 확인 동작', () => {
  let root: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    mocks.resetCountersMode.mockReset();
    mocks.confirm = null;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(<App />));
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });
  const confirmReset = () => {
    act(() =>
      host.querySelector<HTMLButtonElement>('[data-reset-counters]')!.click(),
    );
    act(() => host.querySelector<HTMLButtonElement>('[data-confirm]')!.click());
  };

  it('카운터 초기화 확인은 저장 응답을 받은 뒤 완료된다', async () => {
    let finish!: () => void;
    mocks.resetCountersMode.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    confirmReset();
    let completed = false;
    void mocks.confirm!.then(() => {
      completed = true;
    });
    await act(async () => {
      await Promise.resolve();
    });
    const completedBeforeWrite = completed;
    await act(async () => {
      finish();
      await mocks.confirm;
    });
    expect(completedBeforeWrite).toBe(false);
    expect(mocks.resetCountersMode).toHaveBeenCalledOnce();
  });

  it('카운터 초기화 실패는 처리되지 않은 예외 대신 사용자에게 안내한다', async () => {
    mocks.resetCountersMode.mockRejectedValue(
      new Error('counter reset failed'),
    );
    confirmReset();
    await act(async () => {
      await mocks.confirm;
    });
    expect(host.querySelector('[data-alert]')?.textContent).toContain(
      'common.actionFailed',
    );
    expect(mocks.resetCountersMode).toHaveBeenCalledOnce();
  });
});
