import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  readyListener: null as null | (() => void),
  customCssInjection: vi.fn(),
  handleUndo: vi.fn(),
  handleRedo: vi.fn(),
  applyPanelViewState: vi.fn(),
  startDragging: vi.fn((_clientX: number, _clientY: number) =>
    Promise.resolve(),
  ),
  reattach: vi.fn(() => Promise.resolve('done')),
  alert: vi.fn(() => Promise.resolve()),
  remoteSheetActive: false,
  remoteSheetFailed: null as null | (() => void),
  closeRequestedListener: null as
    | null
    | ((payload: { requestId: string }) => void),
  ackClose: vi.fn((_requestId: string) => Promise.resolve(true)),
}));

vi.mock('@hooks/app/useAppBootstrap', () => ({ useAppBootstrap: vi.fn() }));
vi.mock('@hooks/app/useCustomCssInjection', () => ({
  useCustomCssInjection: mocks.customCssInjection,
}));
vi.mock('@hooks/app/useBlockBrowserShortcuts', () => ({
  useBlockBrowserShortcuts: vi.fn(),
}));
vi.mock('@utils/core/platform', () => ({ isMac: () => true }));
vi.mock('@hooks/app/usePluginPanelModelMirror', () => ({
  usePluginPanelModelMirror: vi.fn(),
}));
vi.mock('@hooks/useKeyManager', () => ({
  useKeyManager: () => ({
    handlePositionChange: vi.fn(),
    handleKeyStyleUpdate: vi.fn(),
    handleKeyBatchStyleUpdate: vi.fn(),
    handleKeyPreview: vi.fn(),
    handleKeyBatchPreview: vi.fn(),
    handleKeyMappingChange: vi.fn(),
    handleUndo: mocks.handleUndo,
    handleRedo: mocks.handleRedo,
  }),
}));
vi.mock('@components/main/Grid/PropertiesPanel', () => ({
  default: ({
    selectionSyncReady,
    onDetachAction,
  }: {
    selectionSyncReady?: boolean;
    onDetachAction?: () => void;
  }) => (
    <div data-testid="properties-panel">
      <div
        className="dmn-panel-header"
        data-testid="panel-header"
        data-sync-ready={selectionSyncReady ? 'true' : 'false'}
      >
        <button
          type="button"
          data-testid="panel-header-button"
          onClick={onDetachAction}
        >
          action
        </button>
      </div>
    </div>
  ),
}));
vi.mock('./PanelDialogHost', () => ({ default: () => null }));
vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@api/modules/selectionSessionApi', () => ({
  panelWindowApi: {
    onCloseRequested: (listener: (payload: { requestId: string }) => void) => {
      mocks.closeRequestedListener = listener;
      return () => {};
    },
    onPropertyModeRequested: () => () => {},
    ackClose: (requestId: string) => mocks.ackClose(requestId),
    applyNativeChrome: vi.fn(() => Promise.resolve(false)),
    startDragging: mocks.startDragging,
  },
}));
vi.mock('@stores/grid/usePanelWindowStore', () => ({
  reattachPropertiesPanel: () => mocks.reattach(),
}));
vi.mock('@stores/grid/useRemoteSheetStore', () => ({
  useRemoteSheetStore: (
    selector: (state: { active: { requestId: string } | null }) => unknown,
  ) =>
    selector({ active: mocks.remoteSheetActive ? { requestId: 'r1' } : null }),
  isRemoteSheetActive: () => mocks.remoteSheetActive,
  listenRemoteSheetHost: (onFailed: () => void) => {
    mocks.remoteSheetFailed = onFailed;
    return () => {};
  },
}));
vi.mock('@stores/grid/panelViewHandoff', () => ({
  applyPanelViewState: mocks.applyPanelViewState,
}));
vi.mock('@plugins/rpc/pluginSettingsMirror', () => ({
  initPluginSettingsMirror: () => () => {},
}));
vi.mock('@plugins/rpc/pluginRpcClient', () => ({
  startPluginRpcClient: () => () => {},
}));
vi.mock('@src/renderer/editor/runtime/selectionSync', () => ({
  onSelectionSyncReady: (listener: () => void) => {
    mocks.readyListener = listener;
    return () => {};
  },
}));
import App from './App';

const initialViewState = {
  mode: 'property' as const,
  activeTab: 'grid' as const,
  propertyActiveTab: 'note' as const,
};

describe('detached panel selection sync gate', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.readyListener = null;
    mocks.customCssInjection.mockClear();
    mocks.handleUndo.mockClear();
    mocks.handleRedo.mockClear();
    mocks.applyPanelViewState.mockClear();
    mocks.startDragging.mockClear();
    mocks.reattach.mockReset();
    mocks.reattach.mockResolvedValue('done');
    mocks.alert.mockClear();
    mocks.remoteSheetActive = false;
    mocks.ackClose.mockClear();
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { ui: { dialog: { alert: mocks.alert } } },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<App initialViewState={initialViewState} />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('does not mount PropertiesPanel before sync or the fail-open timeout', () => {
    act(() => vi.advanceTimersByTime(599));
    expect(
      container.querySelector('[data-testid="properties-panel"]'),
    ).toBeNull();
    expect(mocks.applyPanelViewState).not.toHaveBeenCalled();
  });

  it('mounts fail-open at 600ms while preserving not-ready state', () => {
    act(() => vi.advanceTimersByTime(600));
    expect(
      container
        .querySelector('[data-testid="panel-header"]')
        ?.getAttribute('data-sync-ready'),
    ).toBe('false');
    expect(mocks.applyPanelViewState).toHaveBeenCalledWith(initialViewState);
  });

  it('동기화 완료 뒤 본문 공개 전에 전달된 뷰를 적용한다', () => {
    act(() => mocks.readyListener?.());

    expect(mocks.applyPanelViewState).toHaveBeenCalledWith(initialViewState);
    expect(
      container.querySelector('[data-testid="properties-panel"]'),
    ).not.toBeNull();
  });

  it('reactively upgrades a fail-open panel when sync later resolves', () => {
    act(() => vi.advanceTimersByTime(600));
    expect(
      container
        .querySelector('[data-testid="panel-header"]')
        ?.getAttribute('data-sync-ready'),
    ).toBe('false');

    act(() => mocks.readyListener?.());

    expect(
      container
        .querySelector('[data-testid="panel-header"]')
        ?.getAttribute('data-sync-ready'),
    ).toBe('true');
  });

  it('routes a blank header drag through the panel native command', () => {
    act(() => mocks.readyListener?.());
    const header = container.querySelector<HTMLElement>(
      '[data-testid="panel-header"]',
    );
    const event = new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: 34,
      clientY: 16,
    });

    act(() => header?.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(mocks.startDragging).toHaveBeenCalledWith(34, 16);
  });

  it('does not start a window drag from a header control', () => {
    act(() => mocks.readyListener?.());
    const button = container.querySelector<HTMLElement>(
      '[data-testid="panel-header-button"]',
    );

    act(() =>
      button?.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
          cancelable: true,
        }),
      ),
    );

    expect(mocks.startDragging).not.toHaveBeenCalled();
  });

  it('분리 WebView에도 custom CSS를 주입한다', () => {
    expect(mocks.customCssInjection).toHaveBeenCalled();
  });

  it('입력 포커스 밖에서는 undo와 redo 단축키를 처리한다', () => {
    const undoEvent = new KeyboardEvent('keydown', {
      key: 'z',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const redoEvent = new KeyboardEvent('keydown', {
      key: 'z',
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      document.body.dispatchEvent(undoEvent);
      document.body.dispatchEvent(redoEvent);
    });

    expect(undoEvent.defaultPrevented).toBe(true);
    expect(redoEvent.defaultPrevented).toBe(true);
    expect(mocks.handleUndo).toHaveBeenCalledTimes(1);
    expect(mocks.handleRedo).toHaveBeenCalledTimes(1);
  });

  it('입력 요소의 native undo는 가로채지 않는다', () => {
    const input = document.createElement('input');
    document.body.append(input);
    const undoEvent = new KeyboardEvent('keydown', {
      key: 'z',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => input.dispatchEvent(undoEvent));

    expect(undoEvent.defaultPrevented).toBe(false);
    expect(mocks.handleUndo).not.toHaveBeenCalled();
    input.remove();
  });

  it('정산 실패로 되돌리지 못하면 알리고, 정상 복귀에는 알리지 않는다', async () => {
    act(() => mocks.readyListener?.());
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="panel-header-button"]',
    )!;

    await act(async () => button.click());
    expect(mocks.reattach).toHaveBeenCalledTimes(1);
    expect(mocks.alert).not.toHaveBeenCalled();

    mocks.reattach.mockResolvedValue('blocked');
    await act(async () => button.click());
    expect(mocks.alert).toHaveBeenCalledWith('propertiesPanel.attachFailed', {
      confirmText: 'common.ok',
    });

    // 진행 중 중복 호출은 사용자 잘못이 아니므로 조용히 넘어간다
    mocks.reattach.mockResolvedValue('busy');
    await act(async () => button.click());
    expect(mocks.alert).toHaveBeenCalledTimes(1);
  });

  it('메인 창 시트가 떠 있으면 패널을 잠그고 재부착 경로를 막는다', async () => {
    mocks.remoteSheetActive = true;
    act(() => root.render(<App initialViewState={initialViewState} />));
    act(() => mocks.readyListener?.());

    const lock = container.querySelector<HTMLElement>(
      '[data-testid="remote-sheet-lock"]',
    );
    expect(lock).not.toBeNull();
    const panelWrapper = container.querySelector<HTMLElement>(
      '[data-testid="properties-panel"]',
    )!.parentElement!;
    expect(panelWrapper.hasAttribute('inert')).toBe(true);

    // Cmd+W는 무시
    const closeKey = new KeyboardEvent('keydown', {
      key: 'w',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => window.dispatchEvent(closeKey));
    expect(closeKey.defaultPrevented).toBe(false);
    expect(mocks.reattach).not.toHaveBeenCalled();

    // 닫기 요청은 ack만 하고 재부착은 건너뛴다 - 안 하면 백엔드가 창을 파괴한다
    await act(async () => mocks.closeRequestedListener?.({ requestId: 'c1' }));
    expect(mocks.ackClose).toHaveBeenCalledWith('c1');
    expect(mocks.reattach).not.toHaveBeenCalled();
  });

  it('메인이 시트 요청을 받지 못하면 안내를 띄운다', async () => {
    expect(mocks.remoteSheetFailed).not.toBeNull();
    await act(async () => mocks.remoteSheetFailed?.());
    expect(mocks.alert).toHaveBeenCalledWith(
      'propertiesPanel.remoteSheetFailed',
      {
        confirmText: 'common.ok',
      },
    );
  });

  it('시트가 없으면 닫기 요청이 ack 뒤 재부착으로 이어진다', async () => {
    act(() => mocks.readyListener?.());
    await act(async () => mocks.closeRequestedListener?.({ requestId: 'c2' }));
    expect(mocks.ackClose).toHaveBeenCalledWith('c2');
    expect(mocks.reattach).toHaveBeenCalledTimes(1);
  });
});
