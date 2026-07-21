import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import { useKeyStore } from '@stores/data/useKeyStore';
import {
  getKeySignal,
  resetAllKeySignals,
  setKeyActive,
} from '@stores/signals/keySignals';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  keyEventListener: null as null | ((payload: unknown) => void),
  unsubscribeKeyEvents: vi.fn(),
  updateTrackLayouts: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  currentMonitor: vi.fn(),
  getCurrentWindow: () => ({
    startDragging: vi.fn(() => Promise.resolve()),
  }),
  Window: { getByLabel: vi.fn() },
}));
vi.mock('@tauri-apps/api/dpi', () => ({
  LogicalPosition: class LogicalPosition {},
  PhysicalPosition: class PhysicalPosition {},
}));
vi.mock('@tauri-apps/api/menu', () => ({
  Menu: { new: vi.fn() },
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
vi.mock('@hooks/app/useBlockBrowserShortcuts', () => ({
  useBlockBrowserShortcuts: vi.fn(),
}));
vi.mock('@hooks/app/useAppBootstrap', () => ({ useAppBootstrap: vi.fn() }));
vi.mock('@hooks/overlay/useBuiltinStatsSubscription', () => ({
  useBuiltinStatsSubscription: vi.fn(),
}));
vi.mock('@hooks/overlay/useNoteSystem', () => ({
  useNoteSystem: () => ({
    notesRef: { current: {} },
    subscribe: vi.fn(() => () => {}),
    handleKeyDown: vi.fn(),
    handleKeyUp: vi.fn(),
    finalizeAllActive: vi.fn(),
    noteBuffer: {},
    updateTrackLayouts: mocks.updateTrackLayouts,
  }),
}));
vi.mock('@stores/data/useStatItemStore', () => ({
  useStatItemStore: <T,>(
    selector: (state: { positions: Record<string, never[]> }) => T,
  ) => selector({ positions: {} }),
}));
vi.mock('@stores/data/useGraphItemStore', () => ({
  useGraphItemStore: <T,>(
    selector: (state: { positions: Record<string, never[]> }) => T,
  ) => selector({ positions: {} }),
}));
vi.mock('@stores/data/useKnobItemStore', () => ({
  useKnobItemStore: <T,>(
    selector: (state: { positions: Record<string, never[]> }) => T,
  ) => selector({ positions: {} }),
}));
vi.mock('@stores/useSettingsStore', () => {
  const state = {
    developerModeEnabled: false,
    backgroundColor: 'transparent',
    alwaysOnTop: false,
    trayEnabled: true,
    setAlwaysOnTop: vi.fn(),
    noteSettings: {
      frameLimit: 0,
      speed: 500,
      trackHeight: 300,
      reverse: false,
      fadePosition: 'auto',
      fadeTopPx: 0,
      fadeBottomPx: 0,
      reverseFadeTopPx: 0,
      reverseFadeBottomPx: 0,
      delayedNoteEnabled: false,
      shortNoteThresholdMs: 0,
      shortNoteMinLengthPx: 0,
      keyDisplayDelayMs: 0,
    },
    tabNoteOverrides: {},
    noteEffect: false,
    gridSettings: { overlayPadding: 30 },
    overlayResizeAnchor: 'center',
    keyCounterEnabled: false,
  };
  return {
    useSettingsStore: <T,>(selector: (value: typeof state) => T) =>
      selector(state),
  };
});
vi.mock('@stores/plugin/usePluginDisplayElementStore', () => ({
  usePluginDisplayElementStore: <T,>(
    selector: (state: { elements: never[] }) => T,
  ) => selector({ elements: [] }),
}));
vi.mock('@components/shared/OverlayScene', () => ({ default: () => null }));
vi.mock('@hooks/shared/useLayoutComputation', () => ({
  computeLayout: () => ({
    bounds: null,
    displayPositions: [],
    displayStatPositions: [],
    displayGraphPositions: [],
    displayKnobPositions: [],
    positionOffset: { x: 0, y: 0 },
    webglTracks: [],
  }),
}));
vi.mock('@utils/core/axisEventBus', () => ({
  axisEventBus: { initialize: vi.fn() },
}));
vi.mock('@utils/core/keyEventBus', () => ({
  keyEventBus: {
    subscribe: vi.fn((listener: (payload: unknown) => void) => {
      mocks.keyEventListener = listener;
      return mocks.unsubscribeKeyEvents;
    }),
    initialize: vi.fn(() => Promise.resolve()),
  },
}));

import App from './App';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const flushAsync = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe('overlay active key reconciliation', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalApi: Window['api'];

  beforeEach(async () => {
    originalApi = window.api;
    mocks.bootstrap.mockReset();
    mocks.bootstrap.mockResolvedValue({ activeKeys: [] });
    mocks.keyEventListener = null;
    mocks.unsubscribeKeyEvents.mockClear();
    mocks.updateTrackLayouts.mockClear();
    window.api = {
      app: { bootstrap: mocks.bootstrap },
    } as unknown as Window['api'];
    useKeyStore.setState({
      selectedKeyType: '4key',
      customTabs: [],
      keyMappings: {
        '4key': ['KeyK', 'KeyJ'],
        '8key': ['KeyQ'],
      },
      positions: { '4key': [], '8key': [] },
      canonicalPositions: { '4key': [], '8key': [] },
      isBootstrapped: true,
      isLocalUpdateInProgress: false,
    });
    resetAllKeySignals();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();
    mocks.bootstrap.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    resetAllKeySignals();
    window.api = originalApi;
    vi.restoreAllMocks();
  });

  it('positions 변경에는 눌림 상태를 재설정하지 않는다', async () => {
    setKeyActive('KeyK', true);

    await act(async () => {
      useKeyStore.setState({
        positions: {
          '4key': [createDefaultKeyPosition(10, 20)],
          '8key': [],
        },
      });
    });
    await flushAsync();

    expect(getKeySignal('KeyK').value).toBe(true);
    expect(mocks.bootstrap).not.toHaveBeenCalled();
  });

  it('현재 매핑에서 제거된 활성 키를 오래된 스냅샷으로 되살리지 않는다', async () => {
    setKeyActive('KeyK', true);
    setKeyActive('KeyJ', true);
    mocks.bootstrap.mockResolvedValue({ activeKeys: ['KeyK', 'KeyJ'] });

    await act(async () => {
      useKeyStore.setState((state) => ({
        keyMappings: { ...state.keyMappings, '4key': ['KeyJ'] },
      }));
    });
    await flushAsync();

    expect(getKeySignal('KeyK').value).toBe(false);
    expect(getKeySignal('KeyJ').value).toBe(true);
    expect(mocks.bootstrap).toHaveBeenCalledOnce();
  });

  it('다른 탭의 매핑 변경은 현재 눌림 상태를 건드리지 않는다', async () => {
    setKeyActive('KeyK', true);

    await act(async () => {
      useKeyStore.setState((state) => ({
        keyMappings: { ...state.keyMappings, '8key': ['KeyW'] },
      }));
    });
    await flushAsync();

    expect(getKeySignal('KeyK').value).toBe(true);
    expect(mocks.bootstrap).not.toHaveBeenCalled();
  });

  it('키 순서·중복·빈값만 바뀌면 같은 매핑으로 취급한다', async () => {
    setKeyActive('KeyK', true);

    await act(async () => {
      useKeyStore.setState((state) => ({
        keyMappings: {
          ...state.keyMappings,
          '4key': ['', 'KeyJ', 'KeyK', 'KeyK'],
        },
      }));
    });
    await flushAsync();

    expect(getKeySignal('KeyK').value).toBe(true);
    expect(mocks.bootstrap).not.toHaveBeenCalled();
  });

  it('다음 매핑 전환 뒤 도착한 이전 hydration을 무시한다', async () => {
    const first = deferred<{ activeKeys: string[] }>();
    const second = deferred<{ activeKeys: string[] }>();
    mocks.bootstrap
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    await act(async () => {
      useKeyStore.setState((state) => ({
        keyMappings: { ...state.keyMappings, '4key': ['KeyJ'] },
      }));
    });
    await flushAsync();
    await act(async () => {
      useKeyStore.setState((state) => ({
        keyMappings: { ...state.keyMappings, '4key': ['KeyL'] },
      }));
    });
    await flushAsync();
    expect(mocks.bootstrap).toHaveBeenCalledTimes(2);

    second.resolve({ activeKeys: ['KeyL'] });
    await flushAsync();
    expect(getKeySignal('KeyL').value).toBe(true);

    first.resolve({ activeKeys: ['KeyJ'] });
    await flushAsync();
    expect(getKeySignal('KeyJ').value).toBe(false);
    expect(getKeySignal('KeyL').value).toBe(true);
  });
});
