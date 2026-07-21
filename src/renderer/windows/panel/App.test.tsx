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
  default: ({ selectionSyncReady }: { selectionSyncReady?: boolean }) => (
    <div data-testid="properties-panel">
      <div
        className="dmn-panel-header"
        data-testid="panel-header"
        data-sync-ready={selectionSyncReady ? 'true' : 'false'}
      >
        <button type="button" data-testid="panel-header-button">
          action
        </button>
      </div>
    </div>
  ),
}));
vi.mock('./PanelDialogHost', () => ({ default: () => null }));
vi.mock('@api/modules/selectionSessionApi', () => ({
  panelWindowApi: {
    onCloseRequested: () => () => {},
    onPropertyModeRequested: () => () => {},
    ackClose: vi.fn(() => Promise.resolve()),
    startDragging: mocks.startDragging,
  },
}));
vi.mock('@stores/grid/usePanelWindowStore', () => ({
  reattachPropertiesPanel: vi.fn(() => Promise.resolve()),
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
});
