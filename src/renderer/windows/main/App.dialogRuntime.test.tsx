import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface AlertProps {
  isOpen: boolean;
  message: string;
  type: 'alert' | 'confirm' | 'custom';
  confirmText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

interface ColorPickerProps {
  open: boolean;
  color: string;
  onColorChange: (color: string) => void;
  onColorChangeComplete: (color: string) => void;
  onClose: () => void;
}

const mocks = vi.hoisted(() => ({
  alertProps: null as AlertProps | null,
  customDialogProps: null as AlertProps | null,
  colorPickerProps: [] as ColorPickerProps[],
  checkForUpdates: vi.fn(),
  setGridAreaHovered: vi.fn(),
  t: (key: string) => `translated:${key}`,
  updateRuntime: {
    updateAvailable: false,
    isLatestVersion: false,
    updateInfo: null,
    dismissUpdate: vi.fn(),
    skipVersion: vi.fn(),
    checkForUpdates: vi.fn(),
    runAutoUpdate: vi.fn(),
    isAutoUpdating: false,
    autoUpdatePhase: null,
    autoUpdateProgress: null,
  },
}));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: mocks.t }),
}));
vi.mock('@components/main/TitleBar', () => ({ default: () => null }));
vi.mock('@hooks/app/useCustomCssInjection', () => ({
  useCustomCssInjection: vi.fn(),
}));
vi.mock('@hooks/app/useCustomJsInjection', () => ({
  useCustomJsInjection: vi.fn(),
}));
vi.mock('@hooks/app/useBlockBrowserShortcuts', () => ({
  useBlockBrowserShortcuts: vi.fn(),
}));
vi.mock('@hooks/panel/usePanelCloseRequest', () => ({
  usePanelCloseRequest: vi.fn(),
}));
vi.mock('@components/main/Tool/ToolBar', () => ({ default: () => null }));
vi.mock('@components/main/Grid', () => ({ default: () => null }));
vi.mock('@components/main/Settings', () => ({ default: () => null }));
vi.mock('@hooks/useKeyManager', () => ({
  useKeyManager: () => ({
    keyMappings: { '4key': [] },
    positions: { '4key': [] },
    handleKeyMappingChange: vi.fn(),
    handleResetCurrentMode: vi.fn(),
    handleUndo: vi.fn(),
    handleRedo: vi.fn(),
  }),
}));
vi.mock('@hooks/Modal/usePalette', () => ({
  usePalette: () => ({
    color: '#ffffff',
    palette: false,
    setPalette: vi.fn(),
    handleColorChange: vi.fn(),
    handlePaletteClose: vi.fn(),
  }),
}));
vi.mock('@components/main/Modal/content/dialogs/Alert', () => ({
  default: (props: AlertProps) => {
    if (props.type === 'custom') mocks.customDialogProps = props;
    else mocks.alertProps = props;
    return null;
  },
}));
vi.mock('@components/main/Modal/content/settings/NoteSetting', () => ({
  default: () => null,
}));
vi.mock('@components/main/Modal/content/dialogs/UpdateModal', () => ({
  default: () => null,
}));
vi.mock('@components/main/Modal/content/dialogs/updateActionLabel', () => ({
  resolveAutoUpdateActionLabel: () => 'update',
}));
vi.mock('@components/main/Grid/PropertiesPanelHost', () => ({
  default: () => null,
}));
vi.mock('@components/main/Modal/popupLayer', () => ({
  isModalLayerActive: () => false,
}));
vi.mock('@stores/useSettingsStore', () => ({
  useSettingsStore: () => ({
    noteEffect: false,
    angleMode: 'degrees',
    setAngleMode: vi.fn(),
    language: 'ko',
    setLanguage: vi.fn(),
    noteSettings: {},
    setNoteSettings: vi.fn(),
    autoUpdateEnabled: false,
    developerModeEnabled: false,
    shortcuts: {},
  }),
}));
vi.mock('@components/main/Modal/floatingPopup/FloatingPopup', () => ({
  default: () => null,
}));
vi.mock('@hooks/ui/usePopupPresence', () => ({
  useModalPresence: () => ({
    mounted: false,
    state: 'entering',
    cycle: 0,
  }),
}));
vi.mock('@hooks/ui/useRetainedValue', () => ({
  useRetainedWhileOpen: (_open: boolean, value: unknown) => value,
}));
vi.mock('@components/main/Modal/PopupExit', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@components/main/Modal/content/pickers/color/Palette', () => ({
  default: () => null,
}));
vi.mock('@components/main/Modal/content/pickers/color/ColorPicker', () => ({
  default: (props: ColorPickerProps) => {
    mocks.colorPickerProps.push(props);
    return null;
  },
}));
vi.mock('@stores/data/useKeyStore', () => ({
  useKeyStore: () => ({
    selectedKeyType: '4key',
    setSelectedKeyType: vi.fn(),
    isBootstrapped: true,
  }),
}));
vi.mock('@hooks/app/useAppBootstrap', () => ({ useAppBootstrap: vi.fn() }));
vi.mock('@hooks/app/usePluginDisplayElementsResponder', () => ({
  usePluginDisplayElementsResponder: vi.fn(),
}));
vi.mock('@hooks/app/useUpdateCheck', () => ({
  UpdateInstalledRestartFailedError: class extends Error {
    originalError: unknown;
    constructor(originalError: unknown) {
      super('restart failed');
      this.originalError = originalError;
    }
  },
  useUpdateCheck: () => mocks.updateRuntime,
  hasPendingPostUpdateReleaseNotice: () => false,
  clearPendingPostUpdateReleaseNotice: vi.fn(),
}));
vi.mock('@stores/grid/usePropertiesPanelStore', () => ({
  usePropertiesPanelStore: {
    getState: () => ({ requestCanvasPanelToggle: vi.fn() }),
  },
}));
vi.mock('@stores/grid/usePanelHostStore', () => ({
  usePanelHostStore: <T,>(selector: (state: { placement: string }) => T) =>
    selector({ placement: 'docked' }),
}));
vi.mock('@stores/grid/useGridSelectionStore', () => ({
  useGridSelectionStore: {
    getState: () => ({ clearSelection: vi.fn() }),
  },
}));
vi.mock(
  '@src/renderer/editor/runtime/lifecycle/historyEditorFlushLock',
  () => ({
    isHistoryEditorFlushLocked: () => false,
  }),
);
vi.mock('@hooks/useOptimisticBooleanCommit', () => ({
  useOptimisticBooleanCommit: ({
    canonicalValue,
  }: {
    canonicalValue: boolean;
  }) => ({ value: canonicalValue, toggle: vi.fn() }),
}));
vi.mock('@api/modules/editor/keysApi', () => ({
  keysApi: { resetCountersMode: vi.fn() },
}));
vi.mock('@api/modules/app/settingsApi', () => ({
  settingsApi: { update: vi.fn() },
}));
vi.mock('@api/modules/app/appApi', () => ({
  appApi: { openExternal: vi.fn() },
}));
vi.mock('@stores/useUIStore', () => ({
  useUIStore: <T,>(
    selector: (state: {
      setGridAreaHovered: typeof mocks.setGridAreaHovered;
    }) => T,
  ) => selector({ setGridAreaHovered: mocks.setGridAreaHovered }),
}));

import App from './App';

const renderUpdate = async (callback: () => void) => {
  await act(async () => {
    callback();
    await Promise.resolve();
  });
};

describe('main dialog runtime 계약', () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;

  beforeEach(async () => {
    mocks.alertProps = null;
    mocks.customDialogProps = null;
    mocks.colorPickerProps.length = 0;
    mocks.updateRuntime.checkForUpdates.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
    await act(async () => {
      root.render(<App />);
    });
  });

  afterEach(() => {
    if (mounted) {
      act(() => root.unmount());
    }
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('alert와 confirm 교체 시 이전 요청을 cancel로 settle한다', async () => {
    const firstCancel = vi.fn();
    await renderUpdate(() => {
      window.__dmn_showConfirm?.('first confirm', vi.fn(), {
        onCancel: firstCancel,
      });
    });
    await renderUpdate(() => {
      window.__dmn_showAlert?.('replacement alert');
    });
    expect(firstCancel).toHaveBeenCalledOnce();

    const alertDismiss = vi.fn();
    await renderUpdate(() => {
      window.__dmn_showAlert?.('second alert', undefined, alertDismiss);
    });
    await renderUpdate(() => {
      window.__dmn_showConfirm?.('replacement confirm', vi.fn());
    });
    expect(alertDismiss).toHaveBeenCalledOnce();
  });

  it('confirm과 cancel은 먼저 닫아 콜백이 연 다음 dialog를 보존한다', async () => {
    await renderUpdate(() => {
      window.__dmn_showConfirm?.('confirm source', () => {
        window.__dmn_showAlert?.('opened from confirm');
      });
    });
    await renderUpdate(() => {
      mocks.alertProps?.onConfirm();
    });
    expect(mocks.alertProps).toMatchObject({
      isOpen: true,
      message: 'opened from confirm',
    });

    await renderUpdate(() => {
      window.__dmn_showConfirm?.('cancel source', vi.fn(), {
        onCancel: () => {
          window.__dmn_showAlert?.('opened from cancel');
        },
      });
    });
    await renderUpdate(() => {
      mocks.alertProps?.onCancel();
    });
    expect(mocks.alertProps).toMatchObject({
      isOpen: true,
      message: 'opened from cancel',
    });
  });

  it('언마운트에서 대기 중 alert와 custom dialog를 cancel로 settle한다', async () => {
    const alertCancel = vi.fn();
    const customCancel = vi.fn();
    await renderUpdate(() => {
      window.__dmn_showConfirm?.('pending', vi.fn(), {
        onCancel: alertCancel,
      });
      window.__dmn_showCustomDialog?.('<p>pending</p>', {
        onCancel: customCancel,
      });
    });

    act(() => root.unmount());
    mounted = false;

    expect(alertCancel).toHaveBeenCalledOnce();
    expect(customCancel).toHaveBeenCalledOnce();
  });

  it('custom dialog 교체를 settle하고 dialog 소유 color surface를 함께 닫는다', async () => {
    const firstCancel = vi.fn();
    await renderUpdate(() => {
      window.__dmn_showCustomDialog?.('<p>first</p>', {
        onCancel: firstCancel,
      });
    });
    await renderUpdate(() => {
      window.__dmn_showCustomDialog?.('<p>second</p>');
    });
    expect(firstCancel).toHaveBeenCalledOnce();

    const dialogRoot = document.createElement('div');
    dialogRoot.setAttribute('data-plugin-dialog-content', '');
    const anchor = document.createElement('button');
    dialogRoot.appendChild(anchor);
    const onClose = vi.fn();
    await renderUpdate(() => {
      window.__dmn_showColorPicker?.({
        initialColor: '#111111',
        onColorChange: vi.fn(),
        referenceElement: anchor,
        onClose,
      });
    });
    await renderUpdate(() => {
      mocks.customDialogProps?.onCancel();
    });

    expect(onClose).toHaveBeenCalledOnce();
    expect(window.__dmn_getColorPickerState?.().isOpen).toBe(false);
  });

  it('color picker는 같은 id를 toggle하고 다른 id는 timer 뒤 전환한다', async () => {
    vi.useFakeTimers();
    const firstClose = vi.fn();
    await renderUpdate(() => {
      window.__dmn_showColorPicker?.({
        initialColor: '#111111',
        onColorChange: vi.fn(),
        id: 'first',
        onClose: firstClose,
      });
    });
    await renderUpdate(() => {
      window.__dmn_showColorPicker?.({
        initialColor: '#222222',
        onColorChange: vi.fn(),
        id: 'first',
      });
    });
    expect(firstClose).toHaveBeenCalledOnce();
    expect(window.__dmn_getColorPickerState?.()).toMatchObject({
      isOpen: false,
      id: 'first',
    });

    await renderUpdate(() => {
      window.__dmn_showColorPicker?.({
        initialColor: '#333333',
        onColorChange: vi.fn(),
        id: 'source',
      });
    });
    await renderUpdate(() => {
      window.__dmn_showColorPicker?.({
        initialColor: '#444444',
        onColorChange: vi.fn(),
        id: 'target',
      });
    });
    expect(window.__dmn_getColorPickerState?.()).toMatchObject({
      isOpen: false,
      id: 'source',
    });

    await act(async () => {
      vi.runOnlyPendingTimers();
      await Promise.resolve();
    });
    expect(window.__dmn_getColorPickerState?.()).toMatchObject({
      isOpen: true,
      id: 'target',
      color: '#444444',
    });
  });

  it('퇴장 중 이전 color picker 세션 callback을 새 세션과 분리한다', async () => {
    vi.useFakeTimers();
    const firstChange = vi.fn();
    const firstComplete = vi.fn();
    const nextChange = vi.fn();
    const nextComplete = vi.fn();
    await renderUpdate(() => {
      window.__dmn_showColorPicker?.({
        initialColor: '#111111',
        onColorChange: firstChange,
        onColorChangeComplete: firstComplete,
        id: 'first',
      });
    });
    const firstSession = mocks.colorPickerProps.at(-1);

    await renderUpdate(() => {
      window.__dmn_showColorPicker?.({
        initialColor: '#222222',
        onColorChange: nextChange,
        onColorChangeComplete: nextComplete,
        id: 'next',
      });
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
      await Promise.resolve();
    });
    const nextSession = mocks.colorPickerProps.at(-1);

    await renderUpdate(() => {
      firstSession?.onColorChange('#aaaaaa');
      firstSession?.onColorChangeComplete('#bbbbbb');
      nextSession?.onColorChange('#cccccc');
      nextSession?.onColorChangeComplete('#dddddd');
    });

    expect(firstChange).toHaveBeenCalledWith('#aaaaaa');
    expect(firstComplete).toHaveBeenCalledWith('#bbbbbb');
    expect(nextChange).toHaveBeenCalledWith('#cccccc');
    expect(nextComplete).toHaveBeenCalledWith('#dddddd');
  });

  it('global API를 매 render 최신 함수로 교체하고 unmount에서 제거한다', async () => {
    const initialShowAlert = window.__dmn_showAlert;
    expect(initialShowAlert).toBeTypeOf('function');
    expect(window.__dmn_showConfirm).toBeTypeOf('function');
    expect(window.__dmn_showCustomDialog).toBeTypeOf('function');
    expect(window.__dmn_showColorPicker).toBeTypeOf('function');
    expect(window.__dmn_getColorPickerState).toBeTypeOf('function');

    await renderUpdate(() => {
      initialShowAlert?.('translated fallback');
    });
    expect(mocks.alertProps?.confirmText).toBe('translated:common.confirm');
    expect(window.__dmn_showAlert).not.toBe(initialShowAlert);

    act(() => root.unmount());
    mounted = false;
    expect(window.__dmn_showAlert).toBeUndefined();
    expect(window.__dmn_showConfirm).toBeUndefined();
    expect(window.__dmn_showCustomDialog).toBeUndefined();
    expect(window.__dmn_showColorPicker).toBeUndefined();
    expect(window.__dmn_getColorPickerState).toBeUndefined();
  });
});
