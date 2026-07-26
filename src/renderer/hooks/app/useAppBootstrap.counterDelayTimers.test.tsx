import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getKeyCounterSignal,
  setKeyCounter,
} from '@stores/signals/keyCounterSignals';
import { useSettingsStore } from '@stores/useSettingsStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface MockKeyState {
  selectedKeyType: string;
  isBootstrapped: boolean;
  customTabs: unknown[];
}

type MockKeyStoreListener = (
  state: MockKeyState,
  previousState: MockKeyState,
) => void;

const mocks = vi.hoisted(() => ({
  counterChangedListener: null as null | ((payload: unknown) => void),
  countersChangedListener: null as null | ((payload: unknown) => void),
  modeChangedListener: null as null | ((payload: unknown) => void),
  bootstrap: vi.fn(),
  keyState: {
    selectedKeyType: '4key',
    isBootstrapped: true,
    customTabs: [],
  } as MockKeyState,
  keyStoreListeners: new Set<MockKeyStoreListener>(),
}));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@stores/data/useKeyStore', () => ({
  useKeyStore: {
    getState: vi.fn(() => mocks.keyState),
    setState: vi.fn(
      (
        update:
          | Partial<MockKeyState>
          | ((state: MockKeyState) => Partial<MockKeyState>),
      ) => {
        const previousState = mocks.keyState;
        const patch =
          typeof update === 'function' ? update(previousState) : update;
        mocks.keyState = { ...previousState, ...patch };
        mocks.keyStoreListeners.forEach((listener) => {
          listener(mocks.keyState, previousState);
        });
      },
    ),
    subscribe: vi.fn((listener: MockKeyStoreListener) => {
      mocks.keyStoreListeners.add(listener);
      return () => mocks.keyStoreListeners.delete(listener);
    }),
  },
}));
vi.mock('@stores/data/useStatItemStore', () => ({
  useStatItemStore: { getState: vi.fn(() => ({ positions: {} })) },
}));
vi.mock('@stores/data/useGraphItemStore', () => ({
  useGraphItemStore: { getState: vi.fn(() => ({ positions: {} })) },
}));
vi.mock('@stores/data/useKnobItemStore', () => ({
  useKnobItemStore: { getState: vi.fn(() => ({ positions: {} })) },
}));
vi.mock('@stores/data/useLayerGroupStore', () => ({
  useLayerGroupStore: { getState: vi.fn(() => ({ layerGroups: {} })) },
}));
vi.mock('@stores/useFontStore', () => ({
  useFontStore: { getState: vi.fn(() => ({})), setState: vi.fn() },
  syncFontCSS: vi.fn(),
}));
vi.mock('@api/pluginDisplayElements', () => ({
  getUndoRedoInProgress: vi.fn(() => false),
}));
vi.mock('@api/modules/obsApi', () => ({
  obsApi: { onResync: vi.fn(() => vi.fn()) },
}));
vi.mock('@api/modules/shared', () => ({
  notifyLocaleChanged: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
}));
vi.mock('@api/modules/appApi', () => ({
  acknowledgeLifecycleAfterEditorFlush: vi.fn(),
  cancelLifecycleEditorFlush: vi.fn(),
}));
vi.mock('@src/renderer/editor/runtime/editorStateCoordinator', () => ({
  editorCoordinator: {
    subscribe: vi.fn(() => vi.fn()),
    getState: vi.fn(() => ({
      conflict: null,
      failureKind: null,
      error: null,
    })),
    resolveConflict: vi.fn(),
    start: vi.fn(),
    sync: vi.fn(),
  },
}));
vi.mock('@api/modules/selectionSessionApi', () => ({
  panelWindowApi: {
    onVisibility: vi.fn(() => vi.fn()),
    isOpen: vi.fn(),
    takeViewState: vi.fn(),
  },
}));
vi.mock('@src/renderer/editor/runtime/selectionSync', () => ({
  initSelectionSync: vi.fn(),
  resetSelectionForModeChange: vi.fn(),
}));
vi.mock('@stores/grid/usePanelWindowStore', () => ({
  usePanelWindowStore: { getState: vi.fn(() => ({ setDetached: vi.fn() })) },
}));
vi.mock('@stores/grid/panelViewHandoff', () => ({
  applyPanelViewState: vi.fn(),
}));
vi.mock('@plugins/rpc/pluginRpcHandler', () => ({
  initPluginRpcHandler: vi.fn(),
}));
vi.mock('@plugins/rpc/pluginSettingsSession', () => ({
  initPluginSettingsSessionHost: vi.fn(),
  notePanelVisibilityForSettingsSession: vi.fn(),
}));
vi.mock('@plugins/runtime/displayElement/instancesUndoSync', () => ({
  initPluginInstancesUndoSync: vi.fn(),
}));
vi.mock('@api/modules/historyApi', () => ({
  historyApi: { onStatus: vi.fn(() => vi.fn()) },
}));
vi.mock('@stores/data/useHistoryStatusStore', () => ({
  useHistoryStatusStore: { getState: vi.fn(() => ({ applyStatus: vi.fn() })) },
  syncHistoryStatus: vi.fn(),
}));
vi.mock('@src/renderer/editor/runtime/lifecycleEditorFlush', () => ({
  flushFocusedEditorForLifecycle: vi.fn(),
}));
vi.mock('@src/renderer/editor/runtime/historyEditorFlushLock', () => ({
  acquireHistoryEditorFlushLock: vi.fn(),
  releaseHistoryEditorFlushLock: vi.fn(),
  resetHistoryEditorFlushLock: vi.fn(),
}));
vi.mock('@src/renderer/defaults', () => ({
  initDefaults: vi.fn(),
  getDefaultNoteSettings: vi.fn(() => ({
    frameLimit: 0,
    speed: 400,
    trackHeight: 300,
    reverse: false,
    fadePosition: 'auto',
    fadeTopPx: 50,
    fadeBottomPx: 0,
    reverseFadeTopPx: 0,
    reverseFadeBottomPx: 50,
    delayedNoteEnabled: false,
    shortNoteThresholdMs: 50,
    shortNoteMinLengthPx: 30,
    keyDisplayDelayMs: 0,
  })),
  getDefaultFontSettings: vi.fn(() => ({ customFonts: [] })),
  getDefaultGridSettings: vi.fn(() => ({})),
  getDefaultShortcuts: vi.fn(() => ({})),
}));
vi.mock('@utils/grid/cursorUtils', () => ({
  initializeCursorSystem: vi.fn(),
  refreshCursorSettings: vi.fn(() => Promise.resolve()),
}));

import { useAppBootstrap } from './useAppBootstrap';

const Harness = () => {
  useAppBootstrap();
  return null;
};

const makeApiMock = () =>
  ({
    app: { bootstrap: mocks.bootstrap },
    settings: { onChanged: vi.fn(() => vi.fn()) },
    keys: {
      onModeChanged: vi.fn((listener: (payload: unknown) => void) => {
        mocks.modeChangedListener = listener;
        return vi.fn();
      }),
      onCountersChanged: vi.fn((listener: (payload: unknown) => void) => {
        mocks.countersChangedListener = listener;
        return vi.fn();
      }),
      onCounterChanged: vi.fn((listener: (payload: unknown) => void) => {
        mocks.counterChangedListener = listener;
        return vi.fn();
      }),
      customTabs: { onChanged: vi.fn(() => vi.fn()) },
    },
    noteTab: {
      onChanged: vi.fn(() => vi.fn()),
      onChangedAll: vi.fn(() => vi.fn()),
    },
    presets: { onSnapshot: vi.fn(() => vi.fn()) },
    overlay: {
      onLock: vi.fn(() => vi.fn()),
      onAnchor: vi.fn(() => vi.fn()),
    },
    css: {
      onUse: vi.fn(() => vi.fn()),
      onContent: vi.fn(() => vi.fn()),
    },
    js: {
      onUse: vi.fn(() => vi.fn()),
      onState: vi.fn(() => vi.fn()),
    },
  } as unknown as Window['api']);

describe('카운터 지연 타이머', () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let originalApi: Window['api'];
  let originalWindowType: typeof window.__dmn_window_type;

  const emitCounter = (count: number, mode = '4key', key = 'KeyK') => {
    act(() => {
      mocks.counterChangedListener?.({
        mode,
        key,
        count,
      });
    });
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    originalApi = window.api;
    originalWindowType = window.__dmn_window_type;
    window.__dmn_window_type = 'overlay';
    window.api = makeApiMock();
    mocks.bootstrap.mockReset();
    mocks.bootstrap.mockReturnValue(new Promise(() => {}));
    mocks.counterChangedListener = null;
    mocks.countersChangedListener = null;
    mocks.modeChangedListener = null;
    mocks.keyState = {
      selectedKeyType: '4key',
      isBootstrapped: true,
      customTabs: [],
    };
    mocks.keyStoreListeners.clear();
    setKeyCounter('4key', 'KeyK', 0);
    setKeyCounter('8key', 'KeyL', 0);
    useSettingsStore.setState((state) => ({
      noteSettings: {
        ...state.noteSettings,
        keyDisplayDelayMs: 30000,
      },
      tabNoteOverrides: {},
    }));

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
    await act(async () => {
      root.render(<Harness />);
    });
  });

  afterEach(() => {
    if (mounted) {
      act(() => root.unmount());
    }
    container.remove();
    window.api = originalApi;
    window.__dmn_window_type = originalWindowType;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('지연 설정 변경 시 대기 중인 카운터를 예약 순서대로 반영한다', () => {
    const transitions: number[] = [];
    const unsubscribe = getKeyCounterSignal('4key', 'KeyK').subscribe(
      (value) => {
        transitions.push(value);
      },
    );
    transitions.length = 0;

    emitCounter(1);
    emitCounter(2);
    expect(vi.getTimerCount()).toBe(2);

    act(() => {
      useSettingsStore.setState((state) => ({
        noteSettings: {
          ...state.noteSettings,
          keyDisplayDelayMs: 10000,
        },
      }));
    });

    expect(vi.getTimerCount()).toBe(0);
    expect(transitions).toEqual([1, 2]);
    expect(getKeyCounterSignal('4key', 'KeyK').value).toBe(2);

    const transitionCount = transitions.length;
    vi.advanceTimersByTime(30000);
    expect(transitions).toHaveLength(transitionCount);
    expect(getKeyCounterSignal('4key', 'KeyK').value).toBe(2);

    emitCounter(3);
    vi.advanceTimersByTime(9999);
    expect(getKeyCounterSignal('4key', 'KeyK').value).toBe(2);
    vi.advanceTimersByTime(1);
    expect(getKeyCounterSignal('4key', 'KeyK').value).toBe(3);
    unsubscribe();
  });

  it('지연을 0으로 변경해도 대기 중인 카운터를 즉시 반영한다', () => {
    emitCounter(3);
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      useSettingsStore.setState((state) => ({
        noteSettings: {
          ...state.noteSettings,
          keyDisplayDelayMs: 0,
        },
      }));
    });

    expect(vi.getTimerCount()).toBe(0);
    expect(getKeyCounterSignal('4key', 'KeyK').value).toBe(3);
    vi.advanceTimersByTime(30000);
    expect(getKeyCounterSignal('4key', 'KeyK').value).toBe(3);
  });

  it('활성 탭 오버라이드 변경 시 대기 값을 반영하고 새 지연을 사용한다', () => {
    emitCounter(1);
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      useSettingsStore.setState({
        tabNoteOverrides: {
          '4key': { keyDisplayDelayMs: 10000 },
        },
      });
    });

    expect(vi.getTimerCount()).toBe(0);
    expect(getKeyCounterSignal('4key', 'KeyK').value).toBe(1);

    emitCounter(2);
    vi.advanceTimersByTime(9999);
    expect(getKeyCounterSignal('4key', 'KeyK').value).toBe(1);
    vi.advanceTimersByTime(1);
    expect(getKeyCounterSignal('4key', 'KeyK').value).toBe(2);
  });

  it('탭 전환 시 이전 탭 대기 값을 반영하고 새 탭 지연을 사용한다', () => {
    act(() => {
      useSettingsStore.setState({
        tabNoteOverrides: {
          '4key': { keyDisplayDelayMs: 30000 },
          '8key': { keyDisplayDelayMs: 10000 },
        },
      });
    });

    emitCounter(1);
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      mocks.modeChangedListener?.({ mode: '8key' });
    });

    expect(vi.getTimerCount()).toBe(0);
    expect(getKeyCounterSignal('4key', 'KeyK').value).toBe(1);

    emitCounter(1, '8key', 'KeyL');
    vi.advanceTimersByTime(9999);
    expect(getKeyCounterSignal('8key', 'KeyL').value).toBe(0);
    vi.advanceTimersByTime(1);
    expect(getKeyCounterSignal('8key', 'KeyL').value).toBe(1);
  });

  it('카운터 reset 스냅샷 수신 시 모든 카운터 타이머를 취소한다', () => {
    const transitions: number[] = [];
    const unsubscribe = getKeyCounterSignal('4key', 'KeyK').subscribe(
      (value) => {
        transitions.push(value);
      },
    );
    transitions.length = 0;

    emitCounter(4);
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      mocks.countersChangedListener?.({ '4key': { KeyK: 0 } });
    });

    expect(vi.getTimerCount()).toBe(0);
    expect(transitions).not.toContain(4);
    vi.advanceTimersByTime(30000);
    expect(getKeyCounterSignal('4key', 'KeyK').value).toBe(0);
    unsubscribe();
  });

  it('unmount 시 모든 카운터 타이머를 취소한다', () => {
    const transitions: number[] = [];
    const unsubscribe = getKeyCounterSignal('4key', 'KeyK').subscribe(
      (value) => {
        transitions.push(value);
      },
    );
    transitions.length = 0;

    emitCounter(5);
    expect(vi.getTimerCount()).toBe(1);

    act(() => root.unmount());
    mounted = false;

    expect(vi.getTimerCount()).toBe(0);
    expect(transitions).not.toContain(5);
    vi.advanceTimersByTime(30000);
    expect(getKeyCounterSignal('4key', 'KeyK').value).toBe(0);
    unsubscribe();
  });
});
